import { defineBlock } from "../../blocks.ts";
import { Buttons, buttonsField, Image, paragraphs, titleField } from "../ui.tsx";

// A call to action on the dark primary colour, optionally over a darkened
// background image.
export const cta = defineBlock({
	name: "cta",
	label: "Oproep",
	section: true,
	fields: [
		titleField,
		{ name: "text", label: "Tekst", kind: "textarea" },
		{ name: "image", label: "Achtergrond", kind: "image" },
		buttonsField,
	],
	render: (value, ctx) => (
		<section class="relative bg-primary-dark! text-white">
			{value.image && (
				<div class="absolute inset-0">
					<Image image={value.image} ctx={ctx} class="size-full object-cover" />
					<div class="pointer-events-none absolute inset-0 bg-black/50"></div>
				</div>
			)}
			<div class="relative z-1 container text-center">
				<header class="mb-section-half [&_a]:text-inherit">
					{value.title && <h2 class="not-last:mb-5">{value.title}</h2>}
					{paragraphs(value.text)}
				</header>
				<Buttons buttons={value.buttons} on="dark" class="flex flex-wrap justify-center gap-2" />
			</div>
		</section>
	),
});
