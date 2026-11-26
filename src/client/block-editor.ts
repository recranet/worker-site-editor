import type { ReactNode } from "react";
import type { ImageValue } from "../fields.ts";

// A block's stored fields, as the editor holds them.
export type BlockFields = { [field: string]: unknown };

// A block's own UI in the admin, for the block of the same name that the
// server registers with defineBlock. Both parts are optional: without `Edit`
// the dialog is the form generated from the block's fields, without `Preview`
// the editor shows the block as a card with its label and first text.
export type BlockEditor = {
	name: string;
	// The dialog's content when the block is inserted or edited. `onChange`
	// merges fields into the value; Toepassen writes them into the block.
	Edit?: (props: {
		value: BlockFields;
		onChange: (next: BlockFields) => void;
		// Uploads an image to the site's bucket; put the result in an image field.
		upload: (file: File, alt: string) => Promise<ImageValue>;
		// Whether the site has a bucket for images.
		media: boolean;
		// The generated inputs for some or all fields, to mix with your own.
		fields: (names?: string[]) => ReactNode;
	}) => ReactNode;
	// How the block shows inside the text, under its label.
	Preview?: (props: { value: BlockFields }) => ReactNode;
	// An extra check before Toepassen, after the fields' own (required, …).
	// Returns what's wrong, in Dutch, or "" when the value is fine. The server
	// checks the fields again on save.
	check?: (value: BlockFields) => string;
};

export function defineBlockEditor(editor: BlockEditor): BlockEditor {
	return editor;
}
