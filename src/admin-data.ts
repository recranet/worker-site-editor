import type { Block } from "./blocks.ts";
import type { Field } from "./fields.ts";
import type { TextStyles } from "./text-styles.ts";

// A link in the admin: the switcher's entries and an item's tabs.
export type AdminLink = { href: string; label: string };

// One of the admin's screens.
export type AdminScreen =
	// A text in the Portable Text editor: a page's, or an item's (with `tabs`).
	| { kind: "text"; title: string; value: Block[]; tabs?: AdminLink[] }
	// A page's fields.
	| { kind: "fields"; title: string; fields: readonly Field[]; value: Record<string, unknown> }
	// A collection's items: order, add, hide, delete.
	| {
			kind: "collection";
			title: string;
			// "Project", for "Nieuw project" and the delete question.
			item: string;
			// The collection's admin URL; the actions post below it.
			href: string;
			items: { id: string; title: string; published: boolean; href: string; path: string }[];
	  }
	// An item's title, slug and fields, with tabs for its texts.
	| {
			kind: "item";
			title: string;
			item: string;
			slug: string;
			fields: readonly Field[];
			value: Record<string, unknown>;
			tabs: AdminLink[];
			// The collection's admin URL, for "Terug naar …".
			back: AdminLink;
	  };

// What the admin's browser code (client/admin.tsx) gets, as JSON in the page:
// the switcher, the open screen, and what the editor offers on this site.
export type AdminData = {
	email: string;
	// The switcher: the pages with their texts (and fields), then the collections.
	nav: { title: string; links: AdminLink[] }[];
	// The switcher's entry for this screen.
	current: string;
	// "Bekijk de pagina": the page or item on the site; none for a hidden item.
	pagePath?: string;
	saved: boolean;
	screen: AdminScreen;
	// Whether images can be added (a media bucket).
	media: boolean;
	blocks: { name: string; label: string; section: boolean; fields: readonly Field[] }[];
	textStyles: TextStyles;
};
