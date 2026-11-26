import { defineBlock } from "../../blocks.ts";
import { introField, paragraphs, SectionHeader, titleField } from "../ui.tsx";

// Key figures with a label: two per row, all in one row from lg up.
export const stats = defineBlock({
	name: "stats",
	label: "Kerncijfers",
	section: true,
	fields: [
		titleField,
		introField,
		{
			name: "items",
			label: "Cijfers",
			item: "Cijfer",
			kind: "items",
			fields: [
				{ name: "value", label: "Waarde", kind: "text", required: true },
				{ name: "label", label: "Omschrijving", kind: "text", required: true },
			],
		},
	],
	render: (value) => (
		<section>
			<div class="container">
				<SectionHeader
					title={value.title}
					intro={paragraphs(value.intro)}
					class="mx-auto text-center lg:w-2/3"
				/>
				<dl class="grid grid-cols-2 gap-6 text-center lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
					{(value.items ?? []).map((item) => (
						<div class="flex flex-col-reverse">
							<dt>{item.label}</dt>
							<dd class="mb-1 font-heading text-h2 leading-none font-bold text-primary">
								{item.value}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</section>
	),
});
