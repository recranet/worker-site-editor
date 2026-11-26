import { raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { AuthOptions } from "./auth.ts";
import { createSchema, textToBlocks, type Block, type BlockDefinition } from "./blocks.ts";
import { createRenderer, renderContext } from "./render.ts";
import { createRoutes } from "./routes.tsx";
import { readPage } from "./store.ts";
import type { TextStyles } from "./text-styles.ts";

// One page of the site with the texts the customer can edit. The key in
// `pages` and the text's name are the row's key in D1: renaming one loses
// its saved text.
export type PageDefinition = {
	// In the admin's switcher. A site in more languages adds it: "Home (EN)".
	title: string;
	// The page's URL path, for "Bekijk de pagina".
	path: string;
	texts: Record<
		string,
		{
			// In the switcher and the admin's title: "Pagina", "Introductie".
			label: string;
			// Shows until the customer saves: a string (a blank line starts a new
			// paragraph) or Portable Text blocks.
			default: string | readonly Block[];
		}
	>;
};

export type EditorOptions<P extends Record<string, PageDefinition>> = {
	// The site's pages, in the switcher's order.
	pages: P;
	// The texts' database (the site's D1 binding). Without `db` and `auth` the
	// site has no admin and its pages show the default texts.
	db?: D1Database;
	// Sign-in through the console's OpenID provider.
	auth?: AuthOptions;
	// The R2 bucket for images. Without it the editor has no image buttons.
	media?: R2Bucket;
	// Cloudflare Images, to serve uploads scaled with a srcset. Optional.
	images?: ImagesBinding;
	// The site's own block types (defineBlock), offered in the editor's
	// "Onderdeel" menu.
	blocks?: readonly BlockDefinition[];
	// The site's own text styles.
	textStyles?: TextStyles;
	// The site's stylesheet, loaded in the admin so texts look as on the page.
	stylesheet?: string | false;
	// Wraps the paragraphs between section blocks in texts().page().
	column?: (html: string) => string;
};

const defaultColumn = (html: string) =>
	`<section><div class="container"><div class="article max-w-3xl">${html}</div></div></section>`;

// The editor for one site. Call it once, at module scope, with the bindings
// from `import { env } from "cloudflare:workers"`; the package declares none.
export function createEditor<const P extends Record<string, PageDefinition>>(
	options: EditorOptions<P>,
) {
	const schema = createSchema(options.blocks ?? [], options.textStyles ?? {});
	const ctx = renderContext(options.images !== undefined);
	const renderer = createRenderer(schema, ctx);
	const column = options.column ?? defaultColumn;
	const auth = complete(options.auth);
	const db = options.db;
	const editing = db !== undefined && auth !== undefined;

	const routes = createRoutes({
		pages: options.pages,
		schema,
		db: editing ? db : undefined,
		auth,
		media: options.media,
		images: options.images,
		stylesheet: options.stylesheet ?? "/style.css",
	});

	// A page's texts in one query. `text(name)` renders one as HTML;
	// `text.page(name)` renders it as the page's sections: each section block
	// on its own, the blocks between them in the text column.
	async function texts<K extends keyof P & string>(page: K) {
		type Name = keyof P[K]["texts"] & string;
		const saved = db ? await readPage(db, page) : new Map<string, Block[]>();
		const defined = options.pages[page].texts;
		const value = (name: Name): Block[] => saved.get(name) ?? textToBlocks(defined[name].default);
		const text = (name: Name): HtmlEscapedString => raw(renderer.html(value(name)));
		return Object.assign(text, {
			page: (name: Name): HtmlEscapedString => raw(renderer.sections(value(name), column)),
			value,
		});
	}

	return {
		// Whether the admin is on (db and complete auth options).
		editing,
		// /admin/*, /api/auth/* and /media/*: app.route("/", editor.routes).
		routes,
		texts,
		// Any Portable Text as HTML, with the site's styles and blocks.
		render: (value: Block[]): HtmlEscapedString => raw(renderer.html(value)),
		// The image helpers blocks get, for page code.
		image: ctx.image,
		srcset: ctx.srcset,
	};
}

// Editing needs every auth option. A missing secret turns the admin off
// instead of failing the whole site; the log says what's missing.
function complete(auth: AuthOptions | undefined): AuthOptions | undefined {
	if (!auth) return undefined;
	const missing = (Object.keys(auth) as (keyof AuthOptions)[]).filter((k) => !auth[k]);
	for (const k of ["issuer", "customerId", "clientId", "clientSecret", "secret"] as const) {
		if (!(k in auth)) missing.push(k);
	}
	if (missing.length === 0) return auth;
	console.error(`worker-site-editor: editing is off, auth is missing ${missing.join(", ")}`);
	return undefined;
}
