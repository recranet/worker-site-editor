import { raw } from "hono/html";
import { defineBlock } from "../../blocks.ts";
import { Check, introField, paragraphs, SectionHeader, titleField } from "../ui.tsx";

// Selling points: `grid` three columns with a round icon above the text,
// `list` one column with the icon beside it. Without an image, a check.
export const features = defineBlock({
	name: "features",
	label: "Kenmerken",
	section: true,
	fields: [
		titleField,
		introField,
		{
			name: "layout",
			label: "Indeling",
			kind: "select",
			options: { grid: "Raster", list: "Lijst" },
		},
		{
			name: "items",
			label: "Kenmerken",
			item: "Kenmerk",
			kind: "items",
			fields: [
				{ name: "title", label: "Titel", kind: "text", required: true },
				{ name: "text", label: "Tekst", kind: "textarea" },
				{ name: "image", label: "Icoon", kind: "image" },
			],
		},
	],
	render(value, ctx) {
		const list = value.layout === "list";
		return (
			<section>
				<div class="container">
					<SectionHeader
						title={value.title}
						intro={paragraphs(value.intro)}
						class="mx-auto text-center lg:w-2/3"
					/>
					<div class={list ? "grid gap-6 lg:w-2/3" : "grid gap-6 md:grid-cols-2 lg:grid-cols-3"}>
						{(value.items ?? []).map((item) => (
							<div class={list ? "flex items-start gap-4" : "flex flex-col gap-4"}>
								<div class="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-light text-primary">
									{item.image ? (
										raw(ctx.image(item.image, { class: "size-full object-cover", sizes: "5rem" }))
									) : (
										<Check class="size-6" />
									)}
								</div>
								<div>
									<h3 class="mb-2 heading-5">{item.title}</h3>
									{item.text && <p class="mb-0 whitespace-pre-line">{item.text}</p>}
								</div>
							</div>
						))}
					</div>
				</div>
			</section>
		);
	},
});
