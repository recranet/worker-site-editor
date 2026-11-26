import { defineBlock } from "../../blocks.ts";
import { paragraphs } from "../ui.tsx";

// A quote with its source. The smallest block: two fields and a render.
export const quote = defineBlock({
	name: "quote",
	label: "Citaat met bron",
	fields: [
		{ name: "text", label: "Citaat", kind: "textarea", required: true },
		{ name: "source", label: "Bron", kind: "text" },
	],
	render: (value) => (
		<figure>
			<blockquote class="text-xl [&_p:last-child]:mb-0">{paragraphs(value.text)}</blockquote>
			{value.source && (
				<figcaption class="text-sm text-muted before:content-['—_']">
					<cite>{value.source}</cite>
				</figcaption>
			)}
		</figure>
	),
});
