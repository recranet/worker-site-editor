import { Hono, type Context } from "hono";
import { csrf } from "hono/csrf";
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import type { AdminData, AdminLink } from "./admin-data.ts";
import { createAuth, PROVIDER_ID, type Auth, type AuthOptions } from "./auth.ts";
import {
	clean,
	keepUnknown,
	parseBlocks,
	textToBlocks,
	type Block,
	type Schema,
} from "./blocks.ts";
import { isItemId, isSlug, slugify, type CollectionDefinition } from "./collections.ts";
import type { PageDefinition } from "./editor.ts";
import { hasFields, type Field } from "./fields.ts";
import { serveMedia, uploadMedia } from "./media.ts";
import {
	createItem,
	deleteItem,
	itemPage,
	listItems,
	moveItem,
	readItem,
	readItemBySlug,
	readPageFields,
	readText,
	savePageFields,
	saveItem,
	saveText,
	setPublished,
	type StoredItem,
} from "./store.ts";

// The customer's admin: one screen per text at /admin/texts/<page>/<name>/,
// a page's fields at /admin/fields/<page>/, a collection's list at
// /admin/collections/<collection>/ and an item below it (<id>/, and its texts
// at <id>/texts/<name>/).
// The server renders the shell with the screen's data as JSON; the browser
// bundle (client/admin.tsx, React with Base UI) renders the screen from it.
// Save and sign-out are plain form POSTs with a 303 back.

export type RoutesConfig = {
	pages: Record<string, PageDefinition>;
	collections: Record<string, CollectionDefinition>;
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
	const { pages, collections, schema, db, auth, media, images } = config;
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
				errorCallbackURL: "/admin/?error=sign-in",
			},
			returnHeaders: true,
		});
		if (!response.url) throw new Error("no authorization URL from Better Auth");
		const res = c.redirect(response.url, 303);
		for (const cookie of headers.getSetCookie()) res.headers.append("set-cookie", cookie);
		return res;
	}

	// The retry button on the refused page.
	app.post("/admin/sign-in", signIn);

	// Back to the site: /admin/ would send the visitor straight to the provider.
	app.post("/admin/sign-out", async (c) => {
		const { headers } = await c.var.auth.api.signOut({
			headers: c.req.raw.headers,
			returnHeaders: true,
		});
		const res = c.redirect("/", 303);
		for (const cookie of headers.getSetCookie()) res.headers.append("set-cookie", cookie);
		return res;
	});

	// The switcher: per page its fields ("Gegevens") and texts, then the
	// collections. Items are reached through their collection's list.
	const nav: AdminData["nav"] = [
		...Object.entries(pages).map(([page, def]) => ({
			title: def.title,
			links: [
				...(def.fields?.length ? [{ href: `/admin/fields/${page}/`, label: "Gegevens" }] : []),
				...Object.entries(def.texts).map(([name, text]) => ({
					href: `/admin/texts/${page}/${name}/`,
					label: text.label,
				})),
			],
		})),
		...(Object.keys(collections).length > 0
			? [
					{
						title: "Collecties",
						links: Object.entries(collections).map(([name, def]) => ({
							href: `/admin/collections/${name}/`,
							label: def.label,
						})),
					},
				]
			: []),
	].filter((group) => group.links.length > 0);

	// Signed in: the first screen. Not signed in: the provider, or why it refused.
	app.get("/admin/", async (c) => {
		const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return c.req.query("error") === "sign-in" ? c.html(<Refused />) : signIn(c);
		const first = nav[0]?.links[0];
		if (!first) return c.text("Deze site heeft geen bewerkbare teksten.");
		return c.redirect(first.href, 303);
	});

	// Everything below needs a session.
	for (const path of [
		"/admin/texts/*",
		"/admin/fields/*",
		"/admin/collections/*",
		"/admin/media",
	]) {
		app.use(path, async (c, next) => {
			const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
			if (!session) return c.redirect("/admin/", 303);
			c.set("email", session.user.email);
			await next();
		});
	}

	// An image for a text; the editor puts the returned path in the text.
	app.post("/admin/media", (c) => (media ? uploadMedia(media, c.req.raw) : c.notFound()));

	// The shell with the screen's data; the browser bundle renders the screen.
	function screen(
		c: Context<Env>,
		title: string,
		data: Pick<AdminData, "current" | "pagePath" | "screen">,
	) {
		const all: AdminData = {
			email: c.var.email,
			nav,
			saved: c.req.query("saved") !== undefined,
			media: media !== undefined,
			blocks: [...schema.blocks.values()].map(({ name, label, section, fields }) => ({
				name,
				label,
				section,
				fields,
			})),
			textStyles: schema.textStyles,
			...data,
		};
		return c.html(
			<Shell title={title} stylesheet={config.stylesheet} admin={config.admin} script>
				<div id="admin"></div>
				{/* "<" escaped, so a text can't close the script tag. */}
				<script type="application/json" id="admin-data">
					{raw(JSON.stringify(all).replaceAll("<", "\\u003c"))}
				</script>
			</Shell>,
		);
	}

	const refuse = (c: Context, text: string) => c.text(text, 400);

	// The posted Portable Text, checked, with the stored blocks the site no
	// longer knows put back.
	async function saveTextFrom(c: Context<Env>, page: string, name: string) {
		const form = await c.req.formData();
		const posted = form.get("value");
		const value = typeof posted === "string" ? parseBlocks(posted, schema) : undefined;
		if (!value) return false;
		const stored: Block[] = (await readText(db!, page, name)) ?? [];
		await saveText(db!, page, name, keepUnknown(stored, value, schema), c.var.email);
		return true;
	}

	// The posted field values (JSON in `value`), or undefined when they don't
	// fit the fields.
	async function postedFields(form: FormData, fields: readonly Field[]) {
		const posted = form.get("value");
		if (typeof posted !== "string" || posted.length > 200_000) return undefined;
		try {
			const value: unknown = JSON.parse(posted);
			if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
			const record = value as Record<string, unknown>;
			return hasFields(record, fields) && !("_type" in record) && !("_key" in record)
				? record
				: undefined;
		} catch {
			return undefined;
		}
	}

	// Pages

	function findText(page: string, name: string) {
		if (!Object.hasOwn(pages, page)) return undefined;
		const def = pages[page];
		if (!Object.hasOwn(def.texts, name)) return undefined;
		return { page, name, def, text: def.texts[name] };
	}

	app.get("/admin/texts/:page/:name/", async (c) => {
		const found = findText(c.req.param("page"), c.req.param("name"));
		if (!found) return c.notFound();
		const stored = await readText(db, found.page, found.name);
		return screen(c, found.text.label, {
			current: `/admin/texts/${found.page}/${found.name}/`,
			pagePath: found.def.path,
			screen: {
				kind: "text",
				title: `${found.def.title}: ${found.text.label}`,
				value: clean(stored ?? textToBlocks(found.text.default), schema),
			},
		});
	});

	app.post("/admin/texts/:page/:name/", async (c) => {
		const found = findText(c.req.param("page"), c.req.param("name"));
		if (!found) return c.notFound();
		if (!(await saveTextFrom(c, found.page, found.name)))
			return refuse(c, "Deze tekst kan niet worden opgeslagen.");
		return c.redirect(`/admin/texts/${found.page}/${found.name}/?saved`, 303);
	});

	function findFields(page: string) {
		if (!Object.hasOwn(pages, page)) return undefined;
		const def = pages[page];
		return def.fields?.length ? { def, fields: def.fields } : undefined;
	}

	app.get("/admin/fields/:page/", async (c) => {
		const page = c.req.param("page");
		const found = findFields(page);
		if (!found) return c.notFound();
		const value = (await readPageFields(db, page)) ?? found.def.defaults ?? {};
		return screen(c, `${found.def.title}: Gegevens`, {
			current: `/admin/fields/${page}/`,
			pagePath: found.def.path,
			screen: {
				kind: "fields",
				title: `${found.def.title}: Gegevens`,
				fields: found.fields,
				value,
			},
		});
	});

	app.post("/admin/fields/:page/", async (c) => {
		const page = c.req.param("page");
		const found = findFields(page);
		if (!found) return c.notFound();
		const value = await postedFields(await c.req.formData(), found.fields);
		if (!value) return refuse(c, "Deze gegevens kunnen niet worden opgeslagen.");
		await savePageFields(db, page, value, c.var.email);
		return c.redirect(`/admin/fields/${page}/?saved`, 303);
	});

	// Collections

	const collectionHref = (name: string) => `/admin/collections/${name}/`;
	const itemHref = (name: string, id: string) => `/admin/collections/${name}/${id}/`;

	function findCollection(name: string) {
		return Object.hasOwn(collections, name) ? { name, def: collections[name] } : undefined;
	}

	async function findItem(name: string, id: string) {
		const collection = findCollection(name);
		if (!collection || !isItemId(id)) return undefined;
		const item = await readItem(db!, name, id);
		return item ? { ...collection, item } : undefined;
	}

	// The item's tabs: its fields, then each text.
	const tabs = (name: string, def: CollectionDefinition, id: string): AdminLink[] => [
		{ href: itemHref(name, id), label: "Gegevens" },
		...Object.entries(def.texts).map(([text, t]) => ({
			href: `${itemHref(name, id)}texts/${text}/`,
			label: t.label,
		})),
	];

	const itemPath = (def: CollectionDefinition, item: StoredItem) =>
		item.published ? def.path(item) : undefined;

	app.get("/admin/collections/:collection/", async (c) => {
		const found = findCollection(c.req.param("collection"));
		if (!found) return c.notFound();
		const { name, def } = found;
		const items = await listItems(db, name);
		return screen(c, def.label, {
			current: collectionHref(name),
			screen: {
				kind: "collection",
				title: def.label,
				item: def.item,
				href: collectionHref(name),
				items: items.map((item) => ({
					id: item.id,
					title: item.title,
					published: item.published,
					href: itemHref(name, item.id),
					path: def.path(item),
				})),
			},
		});
	});

	// A new item from its title, with a free slug made from it. It starts
	// hidden, on top of the list.
	app.post("/admin/collections/:collection/new", async (c) => {
		const found = findCollection(c.req.param("collection"));
		if (!found) return c.notFound();
		const form = await c.req.formData();
		const title = String(form.get("title") ?? "").trim();
		if (!title || title.length > 300) return refuse(c, "Geef een titel van hoogstens 300 tekens.");
		const base = slugify(title);
		let slug = base;
		for (let n = 2; await readItemBySlug(db, found.name, slug); n++) slug = `${base}-${n}`;
		const id = crypto.randomUUID();
		await createItem(db, found.name, { id, slug, title }, c.var.email);
		return c.redirect(itemHref(found.name, id), 303);
	});

	app.get("/admin/collections/:collection/:id/", async (c) => {
		const found = await findItem(c.req.param("collection"), c.req.param("id"));
		if (!found) return c.notFound();
		const { name, def, item } = found;
		return screen(c, item.title, {
			current: collectionHref(name),
			pagePath: itemPath(def, item),
			screen: {
				kind: "item",
				title: item.title,
				item: def.item,
				slug: item.slug,
				fields: def.fields,
				value: item.fields,
				tabs: tabs(name, def, item.id),
				back: { href: collectionHref(name), label: def.label },
			},
		});
	});

	app.post("/admin/collections/:collection/:id/", async (c) => {
		const found = await findItem(c.req.param("collection"), c.req.param("id"));
		if (!found) return c.notFound();
		const { name, def, item } = found;
		const form = await c.req.formData();
		const title = String(form.get("title") ?? "").trim();
		const slug = String(form.get("slug") ?? "").trim();
		const fields = await postedFields(form, def.fields);
		if (!title || title.length > 300) return refuse(c, "Geef een titel van hoogstens 300 tekens.");
		if (!isSlug(slug))
			return refuse(c, "Het adres mag alleen kleine letters, cijfers en streepjes bevatten.");
		if (!fields) return refuse(c, "Deze gegevens kunnen niet worden opgeslagen.");
		const other = await readItemBySlug(db, name, slug);
		if (other && other.id !== item.id) return refuse(c, `Het adres "${slug}" is al in gebruik.`);
		await saveItem(db, name, item.id, { title, slug, fields }, c.var.email);
		return c.redirect(`${itemHref(name, item.id)}?saved`, 303);
	});

	app.post("/admin/collections/:collection/:id/move", async (c) => {
		const found = await findItem(c.req.param("collection"), c.req.param("id"));
		if (!found) return c.notFound();
		const form = await c.req.formData();
		await moveItem(db, found.name, found.item.id, form.get("direction") === "up" ? -1 : 1);
		return c.redirect(collectionHref(found.name), 303);
	});

	// Showing needs the required fields: the site's render counts on them.
	app.post("/admin/collections/:collection/:id/visibility", async (c) => {
		const found = await findItem(c.req.param("collection"), c.req.param("id"));
		if (!found) return c.notFound();
		const show = (await c.req.formData()).get("visible") === "1";
		if (show && !hasFields(found.item.fields, found.def.fields))
			return refuse(c, `Vul eerst de verplichte velden in: ${found.item.title}.`);
		await setPublished(db, found.name, found.item.id, show, c.var.email);
		return c.redirect(collectionHref(found.name), 303);
	});

	app.post("/admin/collections/:collection/:id/delete", async (c) => {
		const found = await findItem(c.req.param("collection"), c.req.param("id"));
		if (!found) return c.notFound();
		await deleteItem(db, found.name, found.item.id);
		return c.redirect(collectionHref(found.name), 303);
	});

	function findItemText(found: { def: CollectionDefinition }, name: string) {
		return Object.hasOwn(found.def.texts, name) ? found.def.texts[name] : undefined;
	}

	app.get("/admin/collections/:collection/:id/texts/:name/", async (c) => {
		const found = await findItem(c.req.param("collection"), c.req.param("id"));
		const text = found && findItemText(found, c.req.param("name"));
		if (!found || !text) return c.notFound();
		const { name, def, item } = found;
		const stored = await readText(db, itemPage(name, item.id), c.req.param("name"));
		return screen(c, `${item.title}: ${text.label}`, {
			current: collectionHref(name),
			pagePath: itemPath(def, item),
			screen: {
				kind: "text",
				title: item.title,
				value: clean(stored ?? [], schema),
				tabs: tabs(name, def, item.id),
			},
		});
	});

	app.post("/admin/collections/:collection/:id/texts/:name/", async (c) => {
		const found = await findItem(c.req.param("collection"), c.req.param("id"));
		const text = found && findItemText(found, c.req.param("name"));
		if (!found || !text) return c.notFound();
		const page = itemPage(found.name, found.item.id);
		if (!(await saveTextFrom(c, page, c.req.param("name"))))
			return refuse(c, "Deze tekst kan niet worden opgeslagen.");
		return c.redirect(
			`${itemHref(found.name, found.item.id)}texts/${c.req.param("name")}/?saved`,
			303,
		);
	});

	function Refused() {
		return (
			<Shell title="Geen toegang" stylesheet={false} admin={config.admin}>
				<main class="refused">
					<h1>Geen toegang</h1>
					<p>Inloggen is niet gelukt. Dit adres heeft geen toegang tot deze site.</p>
					<form method="post" action="/admin/sign-in">
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
