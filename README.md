# worker-site-editor

Text editing for Recranet's customer sites on Cloudflare Workers (sites from [recranet/worker-site-starter](https://github.com/recranet/worker-site-starter)). One versioned package instead of a copy per site:

- `/admin/`: the Portable Text editor, one screen per editable text, in Dutch.
- Sign-in through the console's OpenID provider (`auth.recranet.dev`, `auth.elloro.dev`) with Better Auth: a mail link for the customer, the console for staff. The site keeps no passwords or users; the session is an encrypted cookie.
- Texts in the site's D1, images in its R2 bucket (optional), scaled by Cloudflare Images (optional).
- Rendering of the texts for the pages, with the site's own text styles and block types.

What stays in the site: its pages and which texts are editable, its text styles, its own blocks, its stylesheet, its bindings and secrets. The package declares no bindings; the site passes them in.

## Install

```bash
pnpm add @recranet/worker-site-editor
```

`hono` is a peer dependency: the site's own.

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

### The editor

Once, at module scope, with the bindings from `cloudflare:workers`:

```ts
// src/editor.ts
import { env } from "cloudflare:workers";
import { createEditor } from "@recranet/worker-site-editor";
import { blocks } from "./blocks.tsx";
import { textStyles } from "./text-styles.ts";

export const editor = createEditor({
	db: env.DB,
	auth: {
		issuer: env.AUTH_ISSUER,
		customerId: env.CUSTOMER_ID,
		clientId: env.OIDC_CLIENT_ID,
		clientSecret: env.OIDC_CLIENT_SECRET,
		secret: env.BETTER_AUTH_SECRET,
	},
	media: env.MEDIA, // leave out: no images
	images: env.IMAGES, // leave out: images at their original size
	blocks,
	textStyles,
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
- `text.page("body")` renders it as the page's sections: blocks with `section: true` full width, everything between them in the text column (`column` option, default the starter's `<section><div class="container"><div class="article max-w-3xl">…`).
- `editor.render(value)` renders any Portable Text with the site's styles and blocks.

The admin loads the site's stylesheet (`stylesheet` option, default `/style.css`) so texts look as on the page. Its own script and styles come from the package, served under `/admin/assets/`: the site builds nothing for the admin.

The built-in image and gallery blocks use Tailwind classes. Let the site's Tailwind see them, in `src/styles/app.css`:

```css
@source "../../node_modules/@recranet/worker-site-editor/dist";
```

A gallery renders its images as `<a data-gallery>` links; the starter's `public/gallery.js` opens them in a lightbox.

### Migrations

The table lives in the package's `migrations/`, tracked in its own table `editor_migrations` so it never mixes with the site's own migrations. Apply them to the site's D1 after install and after each update:

```bash
pnpm exec cf d1 migrations apply <database-id> --dir node_modules/@recranet/worker-site-editor/migrations --table editor_migrations
```

Add `--local` for `cf dev`. A site from the starter that already has the `block` table is fine: the first migration is `CREATE TABLE IF NOT EXISTS`. A package release that adds a migration says so in its notes.

## Custom blocks

A site's own block is one definition: its fields (the editor's form and the check on save) and its render (the page).

```tsx
// src/blocks.tsx
import { defineBlock } from "@recranet/worker-site-editor";

export const quote = defineBlock({
	name: "quote",
	label: "Citaat met bron", // in the editor's "Onderdeel" menu
	fields: [
		{ name: "text", label: "Citaat", kind: "textarea", required: true },
		{ name: "source", label: "Bron", kind: "text" },
	],
	render: (value) => (
		<figure class="quote">
			<blockquote>{value.text}</blockquote>
			{value.source && <figcaption>{value.source}</figcaption>}
		</figure>
	),
});

export const blocks = [quote];
```

- Field kinds: `text`, `textarea`, `url`, `select` (with `options`), `image`, and `items` (a list, each item with its own fields, no lists in lists). `required` makes the editor ask for it and the save refuse without it.
- `value` is typed from the fields. It was checked when saved: only known fields, safe URLs, images from `/media/` or the site's own files. Text is plain text: render it through JSX, which escapes it.
- `section: true` renders the block full width in `text.page()`; otherwise it sits in the text column.
- `render(value, ctx)` gets `ctx.image(image, { sizes, class, eager })`, an `<img>` string with a srcset when Images scales uploads, and `ctx.srcset(src, width)`. Render must be synchronous. A render that throws leaves the block out and logs.
- Names are stored in the texts. A block type the site removes is skipped on the page and in the editor, but stays in the stored text: the next save keeps it where it was, so adding the block back brings it back.
- A block that more sites need moves into this package.

## Text styles

On top of the built-in bold, italic, underline, strike-through, H2, H3, quote, lists and link:

```ts
// src/text-styles.ts
import type { TextStyles } from "@recranet/worker-site-editor";

export const textStyles: TextStyles = {
	blockStyles: { lead: { label: "Intro", tag: "p", class: "lead" } },
	decorators: { highlight: { label: "Markeren", tag: "mark", class: "highlight" } },
	linkStyles: { button: { label: "Knop", class: "btn btn-primary" } },
};
```

Each is a button in the editor and renders as `tag` with `class` on the page. Keys are stored; removing one shows that text as normal text.

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

The tests run in Node: D1 is `node:sqlite` with the package's migration, the provider a fetch mock. `pnpm build` builds the admin's browser bundle with Vite (`src/client/`), compiles the server code with `tsc` and embeds the bundle in `dist/assets.js`.

## Releases

CalVer as semver: `YYYYMMDD.0.N`, N counting from 1 per day. Set `version` in `package.json`, commit, and push an annotated tag with the same name: `.github/workflows/publish.yml` tests, builds and publishes to npm (public) through trusted publishing.
