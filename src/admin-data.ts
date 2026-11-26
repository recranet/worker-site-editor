import type { Block } from "./blocks.ts";
import type { Field } from "./fields.ts";
import type { TextStyles } from "./text-styles.ts";

// What the admin's browser code (client/admin.tsx) gets, as JSON in the page:
// the texts by page for the switcher, the open text, and what the editor
// offers on this site.
export type AdminData = {
	email: string;
	pages: { title: string; texts: { value: string; label: string }[] }[];
	current: string;
	pagePath: string;
	value: Block[];
	saved: boolean;
	// Whether images can be added (a media bucket).
	media: boolean;
	blocks: { name: string; label: string; section: boolean; fields: readonly Field[] }[];
	textStyles: TextStyles;
};
