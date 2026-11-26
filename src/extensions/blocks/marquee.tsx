import { defineBlock } from "../../blocks.ts";

// An endless line of large text. The items render twice so the loop has no
// gap; the copy is hidden from screen readers. Pauses on hover and stands
// still with reduced motion (the starter's animate-marquee utility).
export const marquee = defineBlock({
	name: "marquee",
	label: "Lopende tekst",
	section: true,
	fields: [
		{
			name: "speed",
			label: "Snelheid",
			kind: "select",
			options: { normal: "Normaal", slow: "Langzaam", fast: "Snel" },
		},
		{
			name: "items",
			label: "Teksten",
			item: "Tekst",
			kind: "items",
			fields: [{ name: "text", label: "Tekst", kind: "text", required: true }],
		},
	],
	render(value) {
		const duration = { slow: "50s", normal: "30s", fast: "15s" }[value.speed ?? "normal"];
		return (
			<section class="overflow-hidden">
				<div
					class="flex w-max animate-marquee hover:[animation-play-state:paused] motion-reduce:animate-none"
					style={`--marquee-duration: ${duration}`}
				>
					{[false, true].map((copy) => (
						<ul class="flex shrink-0" aria-hidden={copy ? "true" : undefined}>
							{(value.items ?? []).map((item) => (
								<li class="pr-12 font-heading text-h2 font-bold whitespace-nowrap text-primary after:pl-12 after:text-secondary after:content-['•']">
									{item.text}
								</li>
							))}
						</ul>
					))}
				</div>
			</section>
		);
	},
});
