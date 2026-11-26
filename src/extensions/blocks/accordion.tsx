import { defineBlock } from "../../blocks.ts";
import { paragraphs } from "../ui.tsx";

// Questions and answers that open one at a time: <details> with a shared
// `name` (the block's key), so no script.
export const accordion = defineBlock({
	name: "accordion",
	label: "Uitklapvragen",
	fields: [
		{
			name: "items",
			label: "Vragen",
			item: "Vraag",
			kind: "items",
			fields: [
				{ name: "title", label: "Vraag", kind: "text", required: true },
				{ name: "text", label: "Antwoord", kind: "textarea", required: true },
			],
		},
	],
	render: (value) => (
		<div class="overflow-hidden rounded-md border border-border">
			{(value.items ?? []).map((item) => (
				<details
					name={`accordion-${value._key}`}
					class="group border-b border-border last:border-b-0"
				>
					<summary class="flex cursor-pointer list-none items-center gap-4 bg-white px-5 py-4 leading-tight font-bold transition-colors group-open:bg-light group-open:text-primary focus-visible:relative focus-visible:z-1 focus-visible:outline-4 focus-visible:outline-primary/25 [&::-webkit-details-marker]:hidden">
						{item.title}
						<svg
							class="ml-auto size-4 shrink-0 fill-current transition-transform duration-200 group-open:rotate-180"
							aria-hidden="true"
							viewBox="0 0 448 512"
						>
							<path d="M207.5 409c9.4 9.4 24.6 9.4 33.9 0l200-200c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-183 183-183-183c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l200 200z" />
						</svg>
					</summary>
					<div class="px-5 py-4 whitespace-pre-line [&_p:last-child]:mb-0">
						{paragraphs(item.text)}
					</div>
				</details>
			))}
		</div>
	),
});
