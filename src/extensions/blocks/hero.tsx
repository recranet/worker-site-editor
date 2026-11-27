import { raw } from "hono/html";
import { defineBlock } from "../../blocks.ts";
import { Buttons, buttonsField, introField, paragraphs } from "../ui.tsx";

// The page's opening. `cover`: white text over the darkened image; `split`:
// text beside it. Without an image it is plain text. One image, no slider.
export const hero = defineBlock({
	name: "hero",
	label: "Hero",
	section: true,
	fields: [
		{ name: "title", label: "Titel", kind: "text", required: true },
		introField,
		{ name: "image", label: "Afbeelding", kind: "image" },
		{
			name: "variant",
			label: "Weergave",
			kind: "select",
			options: { cover: "Tekst over de afbeelding", split: "Tekst naast de afbeelding" },
		},
		buttonsField,
	],
	render(value, ctx) {
		const intro = paragraphs(value.intro);
		const body = (onImage: boolean) => (
			<div class="relative z-1 py-[min(60px,calc(24px+3vw))]">
				<h1 class="text-pretty hyphens-auto xl:text-display">{value.title}</h1>
				{intro && <div class="text-xl [&_a]:text-inherit [&_p:last-child]:mb-0">{intro}</div>}
				<Buttons
					buttons={value.buttons}
					on={onImage ? "image" : undefined}
					class="mt-4 flex flex-wrap gap-2"
				/>
			</div>
		);
		if (!value.image) {
			return (
				<section>
					<div class="container">{body(false)}</div>
				</section>
			);
		}
		if (value.variant === "split") {
			return (
				<section>
					<div class="container">
						<div class="grid items-center gap-6 lg:grid-cols-2 lg:gap-12">
							{body(false)}
							{raw(
								ctx.image(value.image, {
									class: "h-auto w-full rounded-md",
									sizes: "(min-width: 62rem) 50vw, 100vw",
									eager: true,
								}),
							)}
						</div>
					</div>
				</section>
			);
		}
		return (
			<section class="relative flex min-h-[max(60vh,30rem)] items-center overflow-hidden py-0! text-white">
				<div class="absolute inset-0">
					{raw(ctx.image(value.image, { class: "size-full object-cover", eager: true }))}
					<div class="hero-shade pointer-events-none absolute inset-0"></div>
				</div>
				<div class="container">{body(true)}</div>
			</section>
		);
	},
});
