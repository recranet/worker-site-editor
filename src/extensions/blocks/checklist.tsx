import { defineBlock } from "../../blocks.ts";
import { Check } from "../ui.tsx";

// A list with check icons, each item a bold label and an optional line.
export const checklist = defineBlock({
	name: "checklist",
	label: "Vinkjeslijst",
	fields: [
		{
			name: "items",
			label: "Punten",
			item: "Punt",
			kind: "items",
			fields: [
				{ name: "label", label: "Punt", kind: "text", required: true },
				{ name: "text", label: "Uitleg", kind: "text" },
			],
		},
	],
	render: (value) => (
		<dl class="flex flex-col gap-1">
			{(value.items ?? []).map((item) => (
				<div class="flex gap-4">
					<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-light text-primary">
						<Check class="size-4" />
					</div>
					<div>
						<dt class="font-bold">{item.label}</dt>
						{item.text && <dd class="mb-2">{item.text}</dd>}
					</div>
				</div>
			))}
		</dl>
	),
});
