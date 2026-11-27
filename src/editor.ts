import { raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { AuthInput, AuthOptions } from "./auth.ts";
import { createSchema, textToBlocks, type Block, type BlockDefinition } from "./blocks.ts";
import { checkCollections, type CollectionDefinition, type Item } from "./collections.ts";
import { hasFields, type Field, type FieldValues } from "./fields.ts";
import { createRenderer, renderContext } from "./render.ts";
import { createRoutes } from "./routes.tsx";
import {
	itemPage,
	listItems,
	readItemBySlug,
	readPage,
	readPageFields,
	type StoredItem,
} from "./store.ts";
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
	// Values the customer edits in a form on the page (a heading, a banner, a
	// list of slides), with the field kinds blocks have. texts(page).fields
	// gives them.
	fields?: readonly Field[];
	// Shows until the customer saves the page's form. Checked against
	// `fields` when the editor is created.
	defaults?: Record<string, unknown>;
};

type FieldsOf<D> = D extends { fields: infer F extends readonly Field[] } ? FieldValues<F> : {};

export type EditorOptions<
	P extends Record<string, PageDefinition>,
	C extends Record<string, CollectionDefinition> = {},
> = {
	// The site's pages, in the switcher's order.
	pages: P;
	// The site's collections (projects, news), after the pages in the switcher.
	// The keys are stored with the items: renaming one loses them.
	collections?: C;
	// The texts' database (the site's D1 binding). Without `db` and `auth` the
	// site has no admin and its pages show the default texts.
	db?: D1Database;
	// Sign-in through the console's OpenID provider. Pass the env values as they
	// are: with one missing, editing is off.
	auth?: AuthInput;
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
	// Where the site's admin bundle is served: its entry calls mountAdmin
	// (README, "The admin bundle"). Default /admin/admin.js and /admin/style.css,
	// the starter's build output; in `cf dev` the entry's source path.
	admin?: { script: string; style?: string };
	// Wraps the paragraphs between section blocks in texts().page(). Default
	// none: the HTML as it is.
	column?: (html: string) => string;
};

// The editor for one site. Call it once, at module scope, with the bindings
// from `import { env } from "cloudflare:workers"`; the package declares none.
export function createEditor<
	const P extends Record<string, PageDefinition>,
	const C extends Record<string, CollectionDefinition> = {},
>(options: EditorOptions<P, C>) {
	const schema = createSchema(options.blocks ?? [], options.textStyles ?? {});
	const ctx = renderContext(options.images !== undefined);
	const renderer = createRenderer(schema, ctx);
	const column = options.column ?? ((html: string) => html);
	const auth = complete(options.auth);
	const db = options.db;
	const editing = db !== undefined && auth !== undefined;
	const collections: Record<string, CollectionDefinition> = options.collections ?? {};
	checkCollections(collections);
	for (const [page, def] of Object.entries(options.pages)) {
		if (def.defaults && !hasFields(def.defaults, def.fields ?? []))
			throw new Error(`page "${page}": defaults don't fit its fields`);
	}

	const routes = createRoutes({
		pages: options.pages,
		collections,
		schema,
		db: editing ? db : undefined,
		auth,
		media: options.media,
		images: options.images,
		stylesheet: options.stylesheet ?? "/style.css",
		admin: options.admin ?? { script: "/admin/admin.js", style: "/admin/style.css" },
	});

	// `text(name)` renders one text as HTML; `text.page(name)` renders it as
	// the page's sections: each section block on its own, the blocks between
	// them in the text column; `text.value(name)` is its Portable Text.
	function textsFrom<Name extends string>(value: (name: Name) => Block[]) {
		const text = (name: Name): HtmlEscapedString => raw(renderer.html(value(name)));
		return Object.assign(text, {
			page: (name: Name): HtmlEscapedString => raw(renderer.sections(value(name), column)),
			value,
		});
	}

	// A page's texts in one query, and its field values (a second one when
	// the page has fields) as `.fields`.
	async function texts<K extends keyof P & string>(page: K) {
		type Name = keyof P[K]["texts"] & string;
		const def = options.pages[page];
		const [saved, fields] = await Promise.all([
			db ? readPage(db, page) : new Map<string, Block[]>(),
			db && def.fields ? readPageFields(db, page) : undefined,
		]);
		const text = textsFrom<Name>(
			(name) => saved.get(name) ?? textToBlocks(def.texts[name].default),
		);
		return Object.assign(text, {
			fields: (fields ?? def.defaults ?? {}) as FieldsOf<P[K]>,
		});
	}

	function toItem<K extends keyof C & string>(collection: K, stored: StoredItem): Item<C[K]> {
		const { id, slug, title } = stored;
		return {
			id,
			slug,
			title,
			path: collections[collection].path({ id, slug, title }),
			fields: stored.fields as Item<C[K]>["fields"],
		};
	}

	// A collection's shown items in the customer's order, without their
	// texts: for overviews.
	async function items<K extends keyof C & string>(collection: K): Promise<Item<C[K]>[]> {
		if (!db) return [];
		const stored = await listItems(db, collection, { published: true });
		return stored.map((item) => toItem(collection, item));
	}

	// One shown item by its slug, with its texts as `text` (the same as
	// texts(page) gives). Undefined for an unknown or hidden slug: the
	// site's route answers 404.
	async function item<K extends keyof C & string>(collection: K, slug: string) {
		type Name = keyof C[K]["texts"] & string;
		if (!db) return undefined;
		const stored = await readItemBySlug(db, collection, slug);
		if (!stored || !stored.published) return undefined;
		const saved = await readPage(db, itemPage(collection, stored.id));
		return {
			...toItem(collection, stored),
			text: textsFrom<Name>((name) => saved.get(name) ?? []),
		};
	}

	return {
		// Whether the admin is on (db and complete auth options).
		editing,
		// /admin/*, /api/auth/* and /media/*: app.route("/", editor.routes).
		routes,
		texts,
		items,
		item,
		// Any Portable Text as HTML, with the site's styles and blocks.
		render: (value: Block[]): HtmlEscapedString => raw(renderer.html(value)),
		// The image helpers blocks get, for page code.
		image: ctx.image,
		srcset: ctx.srcset,
	};
}

// Editing needs every auth option. A missing secret turns the admin off
// instead of failing the whole site; the log says what's missing. Without
// any value (a site that doesn't edit yet) it's off without a word.
function complete(auth: AuthInput | undefined): AuthOptions | undefined {
	if (!auth) return undefined;
	const keys = ["issuer", "customerId", "clientId", "clientSecret", "secret"] as const;
	const missing = keys.filter((k) => !auth[k]);
	if (missing.length === 0) return auth as AuthOptions;
	if (missing.length < keys.length)
		console.error(`worker-site-editor: editing is off, auth is missing ${missing.join(", ")}`);
	return undefined;
}
