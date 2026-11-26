import { Hono } from "hono";
import {
	createEditor,
	defineBlock,
	type EditorOptions,
	type PageDefinition,
} from "../src/index.ts";
import { testD1 } from "./d1.ts";
import { CUSTOMER, ISSUER } from "./provider.ts";

// A site's block, as a site defines one: a quote with its source.
export const quote = defineBlock({
	name: "quote",
	label: "Citaat met bron",
	fields: [
		{ name: "text", label: "Citaat", kind: "textarea", required: true },
		{ name: "source", label: "Bron", kind: "text" },
		{ name: "link", label: "Link", kind: "url" },
	],
	render: (value) => (
		<figure class="quote">
			<blockquote>{value.text}</blockquote>
			{value.source && <figcaption>{value.source}</figcaption>}
		</figure>
	),
});

// A full-width one, with a list.
export const hero = defineBlock({
	name: "hero",
	label: "Hero",
	section: true,
	fields: [
		{ name: "title", label: "Titel", kind: "text", required: true },
		{ name: "image", label: "Afbeelding", kind: "image" },
		{
			name: "buttons",
			label: "Knoppen",
			item: "Knop",
			kind: "items",
			fields: [
				{ name: "label", label: "Tekst", kind: "text", required: true },
				{ name: "href", label: "Link", kind: "url", required: true },
			],
		},
	],
	render: (value, ctx) => (
		<header class="hero">
			<h1>{value.title}</h1>
			{value.image && (
				// ctx.image escapes and checks the src; Hono JSX would double-escape its string.
				<div class="hero-image" dangerouslySetInnerHTML={{ __html: ctx.image(value.image) }} />
			)}
			{value.buttons?.map((b) => (
				<a href={b.href}>{b.label}</a>
			))}
		</header>
	),
});

export const pages = {
	home: {
		title: "Home",
		path: "/",
		texts: {
			body: { label: "Pagina", default: "Welkom.\n\nTweede alinea." },
			intro: { label: "Introductie", default: "Intro." },
		},
	},
	contact: {
		title: "Contact",
		path: "/contact/",
		texts: { body: { label: "Pagina", default: "Bel ons." } },
	},
} satisfies Record<string, PageDefinition>;

export const auth = {
	issuer: ISSUER,
	customerId: CUSTOMER,
	clientId: "site-client",
	clientSecret: "site-secret",
	secret: "a-better-auth-secret-of-at-least-32-chars",
};

export function site(options: Partial<EditorOptions<typeof pages>> = {}) {
	const db = testD1();
	const editor = createEditor({
		pages,
		db,
		auth,
		blocks: [quote, hero],
		textStyles: {
			blockStyles: { lead: { label: "Intro", tag: "p", class: "lead" } },
			decorators: { highlight: { label: "Markeren", tag: "mark", class: "highlight" } },
			linkStyles: { button: { label: "Knop", class: "btn" } },
		},
		...options,
	});
	const app = new Hono();
	app.get("/", async (c) => {
		const text = await editor.texts("home");
		return c.html(<main>{text.page("body")}</main>);
	});
	app.route("/", editor.routes);
	const request = (path: string, init?: RequestInit) =>
		app.request(`https://site.test${path}`, init);
	return { app, db, editor, request };
}
