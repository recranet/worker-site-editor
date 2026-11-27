import { raw } from "hono/html";
import { uriLooksSafe } from "@portabletext/to-html";
import { defineBlock, type RenderContext } from "../../blocks.ts";
import type { ImageValue } from "../../fields.ts";
import { introField, paragraphs, SectionHeader, titleField } from "../ui.tsx";

type Card = {
	title: string;
	text?: string;
	href?: string;
	image?: ImageValue;
	style?: "default" | "overlay" | "text";
};

// Cards in a grid: three columns from lg, or `bento` (wide, narrow, narrow,
// wide on a 12-column grid; suits overlay and text cards).
export const cards = defineBlock({
	name: "cards",
	label: "Kaarten",
	section: true,
	fields: [
		titleField,
		introField,
		{
			name: "layout",
			label: "Indeling",
			kind: "select",
			options: { grid: "Raster", bento: "Bento" },
		},
		{
			name: "cards",
			label: "Kaarten",
			item: "Kaart",
			kind: "items",
			fields: [
				{ name: "title", label: "Titel", kind: "text", required: true },
				{ name: "text", label: "Tekst", kind: "textarea" },
				{ name: "href", label: "Link", kind: "url" },
				{ name: "image", label: "Afbeelding", kind: "image" },
				{
					name: "style",
					label: "Stijl",
					kind: "select",
					options: {
						default: "Afbeelding boven de tekst",
						overlay: "Tekst over de afbeelding",
						text: "Alleen tekst",
					},
				},
			],
		},
	],
	render(value, ctx) {
		const bento = ["lg:col-span-8", "lg:col-span-4", "lg:col-span-4", "lg:col-span-8"];
		const list = value.cards ?? [];
		return (
			<section class="overflow-hidden">
				<div class="container">
					<SectionHeader
						title={value.title}
						intro={paragraphs(value.intro)}
						class="mx-auto text-center lg:w-2/3"
					/>
					{value.layout === "bento" ? (
						<div class="grid auto-rows-[20rem] gap-4 md:grid-cols-2 lg:auto-rows-[24rem] lg:grid-cols-12 xl:gap-6">
							{list.map((card, i) => (
								<div class={bento[i % bento.length]}>
									<CardView card={card} ctx={ctx} />
								</div>
							))}
						</div>
					) : (
						<div class="grid auto-rows-fr gap-4 md:grid-cols-2 lg:grid-cols-3 xl:gap-6">
							{list.map((card) => (
								<CardView card={card} ctx={ctx} />
							))}
						</div>
					)}
				</div>
			</section>
		);
	},
});

// `default` image above the text, `overlay` text on a darkened image, `text`
// text on the primary colour. With a link the whole card is clickable.
function CardView({ card, ctx }: { card: Card; ctx: RenderContext }) {
	const shell =
		"group relative flex h-full flex-col overflow-hidden rounded-md shadow-sm transition-all duration-200 focus-within:outline-4 focus-within:outline-primary/25 hover:-translate-y-1 hover:shadow-md";
	const zoom = "transition-transform duration-200 group-hover:scale-105";
	const sizes = "(min-width: 62rem) 33vw, (min-width: 48rem) 50vw, 100vw";
	const link = card.href && uriLooksSafe(card.href) && (
		<a href={card.href} class="stretched-link">
			<span class="sr-only">{card.title}</span>
		</a>
	);
	const style = card.image ? (card.style ?? "default") : "text";
	if (style === "overlay" && card.image) {
		return (
			<div class={`${shell} min-h-80 bg-dark text-white`}>
				{link}
				<div class="absolute inset-0 overflow-hidden">
					{raw(ctx.image(card.image, { class: `size-full object-cover ${zoom}`, sizes }))}
				</div>
				<div class="absolute inset-0 flex flex-col justify-end overflow-hidden p-flow">
					<div class="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-b from-transparent to-black/75"></div>
					<h3 class="relative z-1 mb-0 heading-3">{card.title}</h3>
					{card.text && <div class="relative z-1">{card.text}</div>}
				</div>
			</div>
		);
	}
	if (style === "default" && card.image) {
		return (
			<div class={`${shell} border border-black/15 bg-white`}>
				{link}
				<div class="overflow-hidden">
					{raw(ctx.image(card.image, { class: `aspect-[4/3] w-full object-cover ${zoom}`, sizes }))}
				</div>
				<div class="p-flow">
					<h3 class="mb-0 heading-4">{card.title}</h3>
					{card.text && <div>{card.text}</div>}
				</div>
			</div>
		);
	}
	return (
		<div class={`${shell} justify-end bg-primary p-flow text-white`}>
			{link}
			<h3 class="mb-0 heading-3">{card.title}</h3>
			{card.text && <div>{card.text}</div>}
		</div>
	);
}
