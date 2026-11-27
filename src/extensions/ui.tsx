import { uriLooksSafe } from "@portabletext/to-html";
import type { Child } from "hono/jsx";

// The pieces the extension blocks share. They use the starter's classes:
// Tailwind utilities (the site's Tailwind scans the package, README) and the
// starter's own in src/styles/app.css (container, btn, heading-3, p-flow,
// mb-section-half, hero-shade, animate-marquee, …). A site without those
// copies the block and changes the markup.

export type Button = { label: string; href: string; style?: "default" | "outline" };

// A row of buttons. `on="dark"` gives the white variants for coloured panels;
// `on="image"` keeps the filled button and makes the outline one white.
export function Buttons(props: { buttons?: Button[]; on?: "dark" | "image"; class?: string }) {
	const buttons = (props.buttons ?? []).filter((b) => b.label && uriLooksSafe(b.href));
	if (buttons.length === 0) return null;
	const style = (b: Button) => {
		if (b.style === "outline") return props.on ? "btn-outline-white" : "btn-outline-primary";
		return props.on === "dark" ? "btn-white" : "btn-primary";
	};
	return (
		<div class={props.class ?? "flex flex-wrap gap-2"}>
			{buttons.map((b) => (
				<a class={`btn ${style(b)}`} href={b.href}>
					{b.label}
				</a>
			))}
		</div>
	);
}

// A section's heading: an optional small line above, the title and an intro.
export function SectionHeader(props: {
	title?: string;
	headline?: string;
	h1?: boolean;
	intro?: Child;
	class?: string;
}) {
	if (!props.title && !props.headline && !props.intro) return null;
	return (
		<header class={`mb-section-half ${props.class ?? ""}`}>
			{props.headline && <div>{props.headline}</div>}
			{props.title &&
				(props.h1 ? (
					<h1 class="not-last:mb-5">{props.title}</h1>
				) : (
					<h2 class="not-last:mb-5">{props.title}</h2>
				))}
			{props.intro && <div class="[&_p:last-child]:mb-0">{props.intro}</div>}
		</header>
	);
}

// A plain text field: a blank line starts a new paragraph, a single line break stays.
export function paragraphs(text?: string) {
	const t = text?.trim();
	if (!t) return undefined;
	return t.split(/\n\s*\n/).map((p) => <p class="whitespace-pre-line">{p.trim()}</p>);
}

export function Check(props: { class: string }) {
	return (
		<svg class={`fill-current ${props.class}`} aria-hidden="true" viewBox="0 0 448 512">
			<path d="M438 68.5c10.8 7.7 13.2 22.7 5.5 33.5l-264 368c-4.1 5.7-10.5 9.4-17.5 9.9S148 478 143 473L7 337c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0L157 419 404.5 74c7.7-10.8 22.7-13.2 33.5-5.5z" />
		</svg>
	);
}

// The fields several blocks share.
export const buttonsField = {
	name: "buttons",
	label: "Knoppen",
	item: "Knop",
	kind: "items",
	fields: [
		{ name: "label", label: "Tekst", kind: "text", required: true },
		{ name: "href", label: "Link", kind: "url", required: true },
		{
			name: "style",
			label: "Stijl",
			kind: "select",
			options: { default: "Gevuld", outline: "Omlijnd" },
		},
	],
} as const;
export const titleField = { name: "title", label: "Titel", kind: "text" } as const;
export const introField = { name: "intro", label: "Introductie", kind: "textarea" } as const;
