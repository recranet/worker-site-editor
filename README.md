# worker-site-editor

Text editing for Recranet's customer sites on Cloudflare Workers (sites from [recranet/worker-site-starter](https://github.com/recranet/worker-site-starter)). One versioned package instead of a copy per site.

## Core and extensions

The core is small:

- Sign-in through the console's OpenID provider (`auth.recranet.dev`, `auth.elloro.dev`) with Better Auth: a mail link for the customer, the console for staff. The site keeps no passwords or users; the session is an encrypted cookie.
- `/admin/`: the Portable Text editor, one screen per editable text, in Dutch. Its paths are English: `/admin/texts/<page>/<name>/`, `/admin/fields/<page>/`, `/admin/collections/<collection>/`. Built-in: bold, italic, underline, strike-through, H2, H3, quote, lists, link, and with an R2 bucket one image and a gallery.
- Texts in the site's D1, images in its R2 bucket (optional), scaled by Cloudflare Images (optional).
- Page fields (a heading, a banner, a list of slides) and collections (projects, news): items the customer adds, orders, hides and removes.
- Rendering of the texts for the pages.
- `defineBlock` and `defineBlockEditor`: the registration point for blocks, with their own editor UI.

Everything else is an extension, in `@recranet/worker-site-editor/extensions`: the starter's page blocks (hero, feature, cards, features, stats, cta, marquee, map, accordion, quote, checklist, labels) and example text styles (highlight, footnote, lead, button link). They use the same API a site's own blocks do. A site registers the ones it wants, copies one to change it, or writes its own. A block that several sites need moves into the extensions.

What stays in the site: its pages and which texts are editable, its choice of extensions and text styles, its own blocks, its stylesheet, its bindings and secrets. The package declares no bindings; the site passes them in.

## Install

```bash
pnpm add @recranet/worker-site-editor hono @portabletext/editor @base-ui/react react react-dom
```

`hono`, `@portabletext/editor`, `@base-ui/react`, `react` and `react-dom` are peer dependencies: the site installs them, so the core and the site's block editors share one copy of each. Libraries only the core uses (Better Auth, `@portabletext/to-html`) are the package's own dependencies.

## Wire a site

### Bindings and secrets

In `cloudflare.config.ts`, next to the site's other bindings:

```ts
env: {
	// The texts.
	DB: bindings.d1({ id: "<DATABASE_ID>" }),
	// Sign-in: the console tenant's issuer and the customer the site belongs to.
	AUTH_ISSUER: bindings.text("https://auth.recranet.dev"),
	CUSTOMER_ID: bindings.text("<CUSTOMER_ID>"),
	OIDC_CLIENT_ID: bindings.text("<CLIENT_ID>"),
	OIDC_CLIENT_SECRET: bindings.secret(),
	BETTER_AUTH_SECRET: bindings.secret(),
	// Images (optional): the bucket, and Cloudflare Images to scale them.
	MEDIA: bindings.r2({ name: "<BUCKET_NAME>" }),
	IMAGES: bindings.images(),
},
```

The OIDC client comes from `console oidc-clients create <customer-id> -t <tenant> --name <host> --redirect-uri https://<host>/api/auth/callback/console` (the `workers:console-oidc` skill). Its secret goes straight into `.dev.vars` as `OIDC_CLIENT_SECRET`, never through chat. `BETTER_AUTH_SECRET` encrypts the session cookie: `openssl rand -base64 32`, also in `.dev.vars`. `cf deploy --secrets-file .dev.vars` uploads both.

### The editor (server)

Once, at module scope, with the bindings from `cloudflare:workers`:

```ts
// src/editor.ts
import { env } from "cloudflare:workers";
import { createEditor } from "@recranet/worker-site-editor";
import { hero, quote, highlight, footnote } from "@recranet/worker-site-editor/extensions";
import { openingHours } from "./blocks/opening-hours.tsx";

export const editor = createEditor({
	db: env.DB,
	auth: {
		issuer: env.AUTH_ISSUER,
		customerId: env.CUSTOMER_ID,
		clientId: env.OIDC_CLIENT_ID,
		clientSecret: env.OIDC_CLIENT_SECRET,
		secret: env.BETTER_AUTH_SECRET,
	},
	media: env.MEDIA, // leave out: no image or gallery
	images: env.IMAGES, // leave out: images at their original size
	blocks: [hero, quote, openingHours],
	textStyles: { decorators: { highlight, footnote } },
	// The editable texts per page, in the admin switcher's order. The keys are
	// the rows in D1: renaming one loses its saved text.
	pages: {
		home: {
			title: "Home",
			path: "/",
			texts: {
				body: { label: "Pagina", default: "Welkom.\n\nEen lege regel begint een nieuwe alinea." },
			},
		},
		contact: {
			title: "Contact",
			path: "/contact/",
			texts: { body: { label: "Pagina", default: "Neem contact met ons op." } },
		},
	},
});
```

Without `db`, or with an `auth` value missing, the site has no admin and the pages show the default texts. A missing secret turns editing off with an error in the log instead of failing the site.

Mount the routes (`/admin/*`, `/api/auth/*`, `/media/*`) and render the texts:

```tsx
// src/index.tsx
import { editor } from "./editor.ts";

app.get("/", async (c) => {
	const text = await editor.texts("home"); // one D1 query for the page
	return c.html(<Layout>{text.page("body")}</Layout>);
});

app.route("/", editor.routes);
```

- `text("body")` renders the text as HTML.
- `text.page("body")` renders it as the page's sections: blocks with `section: true` full width, everything between them in the text column (`column` option, a function that wraps their HTML; default no wrapper).
- `editor.render(value)` renders any Portable Text with the site's styles and blocks.

### The admin bundle (browser)

The site builds the admin's browser code with its own Vite, so its block editors land in the same bundle as the core's editor:

```ts
// src/admin.ts
import "@recranet/worker-site-editor/admin.css";
import { mountAdmin } from "@recranet/worker-site-editor/admin";
import { heroEditor } from "@recranet/worker-site-editor/extensions/admin";
import { openingHoursEditor } from "./blocks/opening-hours.editor.tsx";

mountAdmin({ editors: [heroEditor, openingHoursEditor] });
```

In `vite.config.ts` (the starter has this already, with `src/admin/admin.tsx` as input):

```ts
environments: {
	client: {
		build: {
			chunkSizeWarningLimit: 1000,
			rolldownOptions: {
				// Base UI marks its modules "use client", which means nothing here.
				onwarn(warning, warn) {
					if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
				},
				input: { admin: "src/admin.ts" },
				output: { entryFileNames: "admin/[name].js", assetFileNames: "admin/style[extname]" },
			},
		},
	},
},
```

The admin page loads `/admin/admin.js` and `/admin/style.css`. Under `cf dev` Vite serves the source instead; tell the editor:

```ts
admin: import.meta.env.DEV ? { script: "/src/admin.ts" } : undefined,
```

It also loads the site's stylesheet (`stylesheet` option, default `/style.css`) so texts look as on the page.

### Images and galleries

The built-in image and gallery render plain markup; the site styles them in its own CSS:

- an image: `<figure class="editor-image"><img …></figure>`
- a gallery: `<div class="gallery">` with an `<a href="…" data-gallery><img …></a>` per image

The starter's `src/styles/app.css` has the rules (a margin, rounded corners, a grid of square crops that zoom on hover), and its `public/gallery.js` opens `[data-gallery]` links in a lightbox.

### Tailwind

Only the extension blocks need this. They use Tailwind classes and the starter's own classes from its `app.css` (`container`, `btn`, `heading-3`, `p-flow`, `mb-section-half`, `hero-shade`, `animate-marquee`, …). Let the site's Tailwind see the package, in `src/styles/app.css`:

```css
@source "../../node_modules/@recranet/worker-site-editor/dist";
```

### Migrations

The table lives in the package's `migrations/`, tracked in its own table `editor_migrations` so it never mixes with the site's own migrations. Apply them to the site's D1 after install and after each update:

```bash
pnpm exec cf d1 migrations apply <database-id> --dir node_modules/@recranet/worker-site-editor/migrations --table editor_migrations
```

Add `--local` for `cf dev`. A site from the starter that already has the `block` table is fine: the first migration is `CREATE TABLE IF NOT EXISTS`. A package release that adds a migration says so in its notes.

- `0001_block.sql`: table `block`, the texts (a page's, and a collection item's under page `item:<collection>:<id>`).
- `0002_item_page_fields.sql`: table `item` (collection items) and `page_fields` (a page's field values).

## Page fields

A page can have fields beside its texts: values the customer edits in a form ("Gegevens" in the switcher), with the same field kinds as blocks.

```ts
pages: {
	home: {
		title: "Home",
		path: "/",
		fields: [
			{ name: "heading", label: "Kop", kind: "text", required: true },
			{ name: "banner", label: "Banner", kind: "image" },
			{
				name: "slides",
				label: "Dia's",
				item: "Dia",
				kind: "items",
				fields: [
					{ name: "image", label: "Afbeelding", kind: "image", required: true },
					{ name: "caption", label: "Onderschrift", kind: "text" },
				],
			},
		],
		// Until the customer saves the form. Checked against the fields at start.
		defaults: { heading: "Architectuur met aandacht" },
		texts: { body: { label: "Pagina", default: "Welkom." } },
	},
},
```

```tsx
const home = await editor.texts("home"); // texts and fields, two queries in parallel
home.fields.heading; // typed from the fields: string
home.fields.banner && editor.image(home.fields.banner, { sizes: "100vw", eager: true });
home.fields.slides?.map((slide) => slide.caption);
```

The saved form replaces the defaults as a whole: a field added later shows its default only on pages whose form was never saved.

## Collections

A collection is a list of items of one kind: projects, news. The customer adds, orders, hides and deletes items and edits every field and text of one; adding a project needs no developer. Items live in D1 only; the site keeps no item defaults in git and seeds its existing items once (below).

```ts
// src/collections.ts
import { defineCollection } from "@recranet/worker-site-editor";

export const projects = defineCollection({
	label: "Projecten",
	item: "Project",
	// Every item has a title and a slug; these come on top.
	fields: [
		{ name: "place", label: "Plaats", kind: "text", required: true },
		{ name: "year", label: "Jaar", kind: "text" },
		{
			name: "categories",
			label: "Categorieën",
			kind: "choices",
			options: { living: "Wonen", work: "Werken", care: "Zorg" },
		},
		{ name: "image", label: "Afbeelding", kind: "image", required: true },
	],
	// Portable Text texts per item, each with its own editor.
	texts: { body: { label: "Tekst" }, photos: { label: "Foto's" } },
	path: (item) => `/projecten/${item.slug}/`,
});

// src/editor.ts
createEditor({ pages, collections: { projects, news }, ... });
```

`defineCollection` keeps the field names as literals, so items are typed; a collection written inline in `createEditor` needs no helper. The collection's key (`projects`) is stored with its items: renaming it loses them.

```tsx
// The overview: the shown items in the customer's order, fields only.
app.get("/projecten/", async (c) => {
	const items = await editor.items("projects");
	return c.html(
		<Layout>
			{items.map((p) => (
				<a href={p.path}>
					{p.title}, {p.fields.place}
				</a>
			))}
		</Layout>,
	);
});

// One item by slug, with its texts. Unknown or hidden: undefined, so 404.
app.get("/projecten/:slug/", async (c) => {
	const project = await editor.item("projects", c.req.param("slug"));
	if (!project) return c.notFound();
	return c.html(
		<Layout title={project.title}>
			{project.text.page("body")}
			{project.text("photos")}
		</Layout>,
	);
});
```

- `editor.items(collection)`: `{ id, slug, title, path, fields }[]`, the shown items in order.
- `editor.item(collection, slug)`: the same plus `text`, which works as `texts(page)`'s result: `text(name)`, `text.page(name)`, `text.value(name)`. An item text the customer never saved is empty.
- In the admin the switcher lists the collections (under "Collecties"), not each item. The collection's screen lists its items with ↑/↓ to reorder, Tonen/Verbergen and Verwijderen (after a question), and adds one from a title. A new item goes on top, hidden; it can be shown once its required fields are filled in. The item's screen has tabs: "Gegevens" (title, slug and fields) and one per text.
- The slug is made from the title on create (`villa-aan-zee`, `-2` when taken) and the customer may change it. The item's texts are stored under its id, so a new slug keeps them; the old URL stops working.
- Field kind `choices`: several of `options` (categories), stored as a list of their keys.

### Seeding existing items

A site that moves fixed pages to a collection imports them once. `collectionSeedBatch` turns them into the batch file `cf d1 raw` runs:

```ts
// scripts/seed-projects.ts, run once: node scripts/seed-projects.ts > seed.json
// (src/collections.ts imports nothing from cloudflare:workers, so Node runs it)
import { collectionSeedBatch } from "@recranet/worker-site-editor";
import { projects } from "../src/collections.ts";

const batch = collectionSeedBatch("projects", projects, [
	{
		slug: "villa-aan-zee",
		title: "Villa aan zee",
		fields: {
			place: "Ouddorp",
			categories: ["living"],
			image: { src: "/img/villa.jpg", alt: "De villa" },
		},
		texts: { body: "Een villa in de duinen.\n\nTweede alinea." }, // or Portable Text blocks
	},
	// ... in the order the site shows them
]);
process.stdout.write(JSON.stringify(batch));
```

```bash
pnpm exec cf d1 raw <database-id> --batch @seed.json
```

Add `--local` for `cf dev`.

- Each item's `id` defaults to its slug. Items whose id or slug is already there are skipped, so running it again keeps the customer's changes.
- Fields are checked against the collection's; a misfit throws, naming the item. `published: false` seeds a hidden item.
- Images can be the site's own files (`/img/...`) or uploads already in the bucket (`/media/<id>.<ext>`).
- Delete the script, `seed.json` and the old fixed pages after the import: the items live in D1 from then on.

## Writing a block

A block has two halves with the same `name`: the server half (fields and page render) and, optionally, its own editor UI. They live in separate files because the server renders with Hono JSX and the admin with React.

### Server: `defineBlock`

```tsx
// src/blocks/opening-hours.tsx
import { defineBlock } from "@recranet/worker-site-editor";

export const openingHours = defineBlock({
	name: "openingHours",
	label: "Openingstijden", // in the editor's "Onderdeel" menu
	section: false, // true: full width in text.page()
	fields: [
		{ name: "title", label: "Titel", kind: "text" },
		{
			name: "days",
			label: "Dagen",
			item: "Dag",
			kind: "items",
			fields: [
				{ name: "day", label: "Dag", kind: "text", required: true },
				{ name: "hours", label: "Tijden", kind: "text", required: true },
			],
		},
	],
	render: (value) => (
		<dl class="opening-hours">
			{value.days?.map((d) => (
				<>
					<dt>{d.day}</dt>
					<dd>{d.hours}</dd>
				</>
			))}
		</dl>
	),
});
```

- Field kinds: `text`, `textarea`, `url`, `select` (with `options`), `choices` (several of `options`, a list of keys), `image`, and `items` (a list, each item with its own fields, no lists in lists). `required` makes the editor ask for it and the save refuse without it.
- An `image` needs an alt text before it saves: screen readers read it out, and WCAG asks a text alternative for every image that carries content. An image that only decorates, such as a banner or background photo, takes `decorative: true` (`{ name: "banner", label: "Banner", kind: "image", decorative: true }`): the editor asks no alt text, stores `alt: ""` and `ctx.image` renders `alt=""`, so screen readers skip it. This works the same in page fields, collection items, blocks and `items`.
- The fields are the stored shape and the server's check on every save: only known fields, safe URLs, images from `/media/` or the site's own files. Whatever the block's editor UI does, the saved value must fit them.
- `value` is typed from the fields. Text is plain text: render it through JSX, which escapes it.
- `render(value, ctx)` gets `ctx.image(image, { sizes, class, eager })`, an `<img>` string with a srcset when Images scales uploads, and `ctx.srcset(src, width)`. Render must be synchronous. A render that throws leaves the block out and logs.
- Names are stored in the texts. A block type the site removes is skipped on the page and in the editor, but stays in the stored text: the next save keeps it where it was, so adding the block back brings it back.

### Admin: `defineBlockEditor`

Without one, the block's dialog is a form generated from its fields and it shows in the text as a card with its label and first text. With one, the block brings its own UI:

```tsx
// src/blocks/opening-hours.editor.tsx
/** @jsxImportSource react */
import { defineBlockEditor } from "@recranet/worker-site-editor/admin";

export const openingHoursEditor = defineBlockEditor({
	name: "openingHours",
	// The dialog. onChange merges fields into the value; fields() gives the
	// generated inputs for some or all fields, to mix with your own.
	Edit: ({ value, onChange, fields }) => (
		<>
			{fields(["title"])}
			<button type="button" className="button small" onClick={() => onChange({ days: weekdays() })}>
				Ma–vr invullen
			</button>
			{fields(["days"])}
		</>
	),
	// How the block shows inside the text, under its label.
	Preview: ({ value }) => <p>{(value.days as unknown[] | undefined)?.length ?? 0} dagen</p>,
	// An extra check before Toepassen, in Dutch; "" when fine.
	check: (value) => (value.days ? "" : "Vul de dagen in."),
});
```

`Edit` also gets `upload(file, alt)` (puts an image in the site's bucket, for an image field) and `media` (whether the site has one). The admin's classes (`button`, `input`, `field`, …) are in `admin.css`; the site's stylesheet is loaded too.

The editor UI is React with Base UI and the Portable Text editor available. Those are peer dependencies, so a block editor that imports `@base-ui/react` or `react` uses the same copy as the core. Register the editor in the site's admin entry (`mountAdmin({ editors })`) and the block in `createEditor({ blocks })`; the browser warns about an editor without a block.

The extensions show the range: `quote` is fields and a render only, `hero` has a `Preview` and wraps the generated form, `labels` replaces the form with one text area.

## Text styles

On top of the built-ins, a site adds its own or picks the examples:

```ts
import type { TextStyles } from "@recranet/worker-site-editor";
import { highlight, footnote, lead, button } from "@recranet/worker-site-editor/extensions";

export const textStyles: TextStyles = {
	blockStyles: { lead },
	decorators: {
		highlight,
		footnote,
		smallCaps: { label: "Kleinkapitaal", tag: "span", class: "small-caps" },
	},
	linkStyles: { button },
};
```

Each is a button in the editor and renders as `tag` with `class` on the page. The keys are stored; removing one shows that text as normal text. The classes come from the site's stylesheet.

## Sign-in

`/admin/` sends the visitor straight to the provider. The customer gets a link by mail; staff click "Medewerker? Log in via de console" and come back signed in. The site checks the `<issuer>/customer_id` claim against `customerId`, so a client handed to the wrong site lets nobody in; a refused sign-in shows "Geen toegang" with a retry. The session lasts 12 hours. Failures and their causes: the `workers:console-oidc` skill.

## Development

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm check
```

```bash
pnpm build
```

The tests run in Node: D1 is `node:sqlite` with the package's migration, the provider a fetch mock. `pnpm build` compiles the server code (Hono JSX) and the admin code (React) with `tsc` into `dist/`; the site's Vite bundles the admin.

## Releases

CalVer as semver: `YYYYMMDD.0.N`, N counting from 1 per day. Set `version` in `package.json`, commit, and push an annotated tag with the same name: `.github/workflows/publish.yml` tests, builds and publishes to npm (public) through trusted publishing.
