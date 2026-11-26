/** @jsxImportSource react */
import { useState } from "react";
import { defineBlockEditor, type BlockFields } from "../../client/block-editor.ts";

type Label = { _key: string; text: string };
const items = (value: BlockFields) => (Array.isArray(value.items) ? (value.items as Label[]) : []);

// One text area, a label per line, instead of the generated list form.
// Stored as the block's fields say: items with a _key and text.
export const labelsEditor = defineBlockEditor({
	name: "labels",
	Edit({ value, onChange }) {
		const [text, setText] = useState(() =>
			items(value)
				.map((i) => i.text)
				.join("\n"),
		);
		return (
			<label className="field">
				<span>Labels, één per regel</span>
				<textarea
					className="input textarea"
					rows={6}
					value={text}
					onChange={(event) => {
						setText(event.target.value);
						const old = items(value);
						onChange({
							items: event.target.value
								.split("\n")
								.map((line) => line.trim())
								.filter(Boolean)
								.map((line, i) => ({
									_key: old[i]?._key ?? `l${Date.now().toString(36)}${i}`,
									text: line,
								})),
						});
					}}
				/>
			</label>
		);
	},
	Preview: ({ value }) => (
		<ul className="flex flex-wrap gap-2">
			{items(value).map((item) => (
				<li key={item._key} className="badge rounded-full border border-border bg-light">
					{item.text}
				</li>
			))}
		</ul>
	),
	check: (value) => (items(value).length === 0 ? "Vul minstens één label in." : ""),
});
