import { Hono, type Context } from "hono";
import { csrf } from "hono/csrf";
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import type { AdminData } from "./admin-data.ts";
import { createAuth, PROVIDER_ID, type Auth, type AuthOptions } from "./auth.ts";
import {
	clean,
	keepUnknown,
	parseBlocks,
	textToBlocks,
	type Block,
	type Schema,
} from "./blocks.ts";
import { serveMedia, uploadMedia } from "./media.ts";
import { readText, saveText } from "./store.ts";
import type { PageDefinition } from "./editor.ts";

// The customer's admin: one screen per text at /admin/teksten/<page>/<name>/.
// The server renders the shell with the screen's data as JSON; the browser
// bundle (client/admin.tsx, React with Base UI) renders the screen from it.
// Save and sign-out are plain form POSTs with a 303 back.

export type RoutesConfig = {
	pages: Record<string, PageDefinition>;
	schema: Schema;
	db?: D1Database;
	auth?: AuthOptions;
	media?: R2Bucket;
	images?: ImagesBinding;
	stylesheet: string | false;
	admin: { script: string; style?: string };
};

type Env = { Variables: { auth: Auth; email: string } };

export function createRoutes(config: RoutesConfig) {
	const { pages, schema, db, auth, media, images } = config;
	const app = new Hono<Env>();

	// Images in the texts, from R2. Public, like the pages that show them.
	app.get("/media/:name", (c) => {
		if (!media) return c.notFound();
		return serveMedia(media, images, c.req.param("name"), c.req.raw, (p) => waitUntil(c, p));
	});

	if (!db || !auth) {
		// Editing is off: no admin and no sign-in, the pages show the defaults.
		return app;
	}

	for (const path of ["/admin/*", "/api/auth/*"]) {
		app.use(path, async (c, next) => {
			c.set("auth", createAuth(auth, new URL(c.req.url).origin));
			c.header("cache-control", "no-store");
			await next();
		});
		app.use(path, csrf());
	}

	// Better Auth's own routes, of which the provider's callback is the one used.
	app.on(["GET", "POST"], "/api/auth/*", (c) => c.var.auth.handler(c.req.raw));

	// Sends the visitor to the provider's sign-in page, with Better Auth's state
	// cookie. The site has no sign-in page of its own.
	async function signIn(c: Context<Env>) {
		const { headers, response } = await c.var.auth.api.signInSocial({
			body: {
				provider: PROVIDER_ID,
				callbackURL: "/admin/",
				errorCallbackURL: "/admin/?fout=inloggen",
			},
			returnHeaders: true,
		});
		if (!response.url) throw new Error("no authorization URL from Better Auth");
		const res = c.redirect(response.url, 303);
		for (const cookie of headers.getSetCookie()) res.headers.append("set-cookie", cookie);
		return res;
	}

	// The retry button on the refused page.
	app.post("/admin/inloggen", signIn);

	// Back to the site: /admin/ would send the visitor straight to the provider.
	app.post("/admin/uitloggen", async (c) => {
		const { headers } = await c.var.auth.api.signOut({
			headers: c.req.raw.headers,
			returnHeaders: true,
		});
		const res = c.redirect("/", 303);
		for (const cookie of headers.getSetCookie()) res.headers.append("set-cookie", cookie);
		return res;
	});

	const texts = Object.entries(pages).flatMap(([page, def]) =>
		Object.keys(def.texts).map((name) => ({ page, name })),
	);

	// Signed in: the first text. Not signed in: the provider, or why it refused.
	app.get("/admin/", async (c) => {
		const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return c.req.query("fout") === "inloggen" ? c.html(<Refused />) : signIn(c);
		const first = texts[0];
		if (!first) return c.text("Deze site heeft geen bewerkbare teksten.");
		return c.redirect(`/admin/teksten/${first.page}/${first.name}/`, 303);
	});

	// Everything below needs a session.
	for (const path of ["/admin/teksten/*", "/admin/media"]) {
		app.use(path, async (c, next) => {
			const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
			if (!session) return c.redirect("/admin/", 303);
			c.set("email", session.user.email);
			await next();
		});
	}

	// An image for a text; the editor puts the returned path in the text.
	app.post("/admin/media", (c) => (media ? uploadMedia(media, c.req.raw) : c.notFound()));

	function find(page: string, name: string) {
		if (!Object.hasOwn(pages, page)) return undefined;
		const def = pages[page];
		if (!Object.hasOwn(def.texts, name)) return undefined;
		return { page, name, def, text: def.texts[name] };
	}

	app.get("/admin/teksten/:page/:name/", async (c) => {
		const found = find(c.req.param("page"), c.req.param("name"));
		if (!found) return c.notFound();
		const stored = await readText(db, found.page, found.name);
		const data: AdminData = {
			email: c.var.email,
			pages: Object.entries(pages).map(([page, def]) => ({
				title: def.title,
				texts: Object.entries(def.texts).map(([name, text]) => ({
					value: `${page}/${name}`,
					label: text.label,
				})),
			})),
			current: `${found.page}/${found.name}`,
			pagePath: found.def.path,
			value: clean(stored ?? textToBlocks(found.text.default), schema),
			saved: c.req.query("opgeslagen") !== undefined,
			media: media !== undefined,
			blocks: [...schema.blocks.values()].map(({ name, label, section, fields }) => ({
				name,
				label,
				section,
				fields,
			})),
			textStyles: schema.textStyles,
		};
		return c.html(
			<Shell title={found.text.label} stylesheet={config.stylesheet} admin={config.admin} script>
				<div id="admin"></div>
				{/* "<" escaped, so a text can't close the script tag. */}
				<script type="application/json" id="admin-data">
					{raw(JSON.stringify(data).replaceAll("<", "\\u003c"))}
				</script>
			</Shell>,
		);
	});

	app.post("/admin/teksten/:page/:name/", async (c) => {
		const found = find(c.req.param("page"), c.req.param("name"));
		if (!found) return c.notFound();
		const form = await c.req.formData();
		const posted = form.get("value");
		const value = typeof posted === "string" ? parseBlocks(posted, schema) : undefined;
		if (!value) return c.text("Deze tekst kan niet worden opgeslagen.", 400);
		const stored: Block[] = (await readText(db, found.page, found.name)) ?? [];
		await saveText(db, found.page, found.name, keepUnknown(stored, value, schema), c.var.email);
		return c.redirect(`/admin/teksten/${found.page}/${found.name}/?opgeslagen`, 303);
	});

	function Refused() {
		return (
			<Shell title="Geen toegang" stylesheet={false} admin={config.admin}>
				<main class="refused">
					<h1>Geen toegang</h1>
					<p>Inloggen is niet gelukt. Dit adres heeft geen toegang tot deze site.</p>
					<form method="post" action="/admin/inloggen">
						<button type="submit" class="button primary">
							Opnieuw inloggen
						</button>
					</form>
				</main>
			</Shell>
		);
	}

	return app;
}

// Outside a Worker (tests) there is no execution context: the cache write is skipped.
function waitUntil(c: Context, promise: Promise<unknown>) {
	try {
		c.executionCtx.waitUntil(promise);
	} catch {
		void promise.catch(() => {});
	}
}

function Shell(props: {
	title: string;
	stylesheet: string | false;
	// The site's admin bundle (createEditor `admin`).
	admin: { script: string; style?: string };
	script?: boolean;
	children: Child;
}) {
	return (
		<>
			{raw("<!doctype html>")}
			<html lang="nl">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<meta name="robots" content="noindex" />
					<title>{props.title} - Beheer</title>
					{/* The site's stylesheet, so texts look as on the page. */}
					{props.stylesheet && <link rel="stylesheet" href={props.stylesheet} />}
					{props.admin.style && <link rel="stylesheet" href={props.admin.style} />}
					{props.script && <script type="module" src={props.admin.script}></script>}
				</head>
				<body>{props.children}</body>
			</html>
		</>
	);
}
