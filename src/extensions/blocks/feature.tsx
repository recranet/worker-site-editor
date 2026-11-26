import { defineBlock } from "../../blocks.ts";
import { Buttons, buttonsField, Image, paragraphs, SectionHeader, titleField } from "../ui.tsx";

// Text and buttons beside an image, the image left or right from lg up.
export const feature = defineBlock({
	name: "feature",
	label: "Tekst naast afbeelding",
	section: true,
	fields: [
		{ name: "headline", label: "Bovenregel", kind: "text" },
		titleField,
		{ name: "text", label: "Tekst", kind: "textarea" },
		{ name: "image", label: "Afbeelding", kind: "image", required: true },
		{ name: "caption", label: "Onderschrift", kind: "text" },
		{
			name: "align",
			label: "Afbeelding",
			kind: "select",
			options: { left: "Links", right: "Rechts" },
		},
		buttonsField,
	],
	render(value, ctx) {
		const right = value.align === "right";
		return (
			<section>
				<div class="container">
					<div class="grid items-center gap-6 lg:grid-cols-12">
						<figure class={right ? "lg:col-span-5 lg:col-start-8 lg:row-start-1" : "lg:col-span-5"}>
							<Image
								image={value.image}
								ctx={ctx}
								class="h-auto max-w-full rounded-md"
								sizes="(min-width: 62rem) 42vw, 100vw"
							/>
							{value.caption && (
								<figcaption class="mt-2 text-sm text-muted">{value.caption}</figcaption>
							)}
						</figure>
						<article
							class={`article ${right ? "lg:col-span-6 lg:col-start-1 lg:row-start-1" : "lg:col-span-6 lg:col-start-7"}`}
						>
							<SectionHeader headline={value.headline} title={value.title} class="mb-0!" />
							{paragraphs(value.text)}
							<Buttons buttons={value.buttons} />
						</article>
					</div>
				</div>
			</section>
		);
	},
});
