import { defineBlock } from "../../blocks.ts";

// A row of small rounded labels. Its editor (extensions/client) is one text
// area, a label per line, instead of the generated list form.
export const labels = defineBlock({
	name: "labels",
	label: "Labels",
	fields: [
		{
			name: "items",
			label: "Labels",
			item: "Label",
			kind: "items",
			fields: [{ name: "text", label: "Tekst", kind: "text", required: true }],
		},
	],
	render: (value) => (
		<ul class="flex flex-wrap gap-2">
			{(value.items ?? []).map((item) => (
				<li class="badge rounded-full border border-border bg-light font-medium text-dark">
					{item.text}
				</li>
			))}
		</ul>
	),
});
