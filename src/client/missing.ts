import type { Field } from "../fields.ts";

// The form values the admin edits, and what a form still misses before it
// saves. No DOM here: the tests check `missing` in Node.

export type Image = { _key?: string; src: string; alt: string; width?: number; height?: number };

// A part's stored fields (parts.ts), or a page's or item's.
export type PartValue = { _type?: string; _key?: string; [field: string]: unknown };
export type Row = { _key: string; [field: string]: unknown };

export const asText = (v: unknown) => (typeof v === "string" ? v : "");
export const asRows = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
export const asList = (v: unknown) =>
	Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
export const asImage = (v: unknown) =>
	typeof v === "object" && v !== null && typeof (v as Image).src === "string"
		? (v as Image)
		: undefined;

// What's missing before a part or item can be applied, or "" when it's complete.
export function missing(value: PartValue, fields: readonly Field[]): string {
	for (const f of fields) {
		const v = value[f.name];
		if (f.kind === "items") {
			for (const row of asRows(v)) {
				const problem = missing(row, f.fields);
				if (problem) return `${f.item}: ${problem}`;
			}
		} else if (f.kind === "image") {
			const image = asImage(v);
			if (!image && f.required) return `Kies een afbeelding bij ${f.label}.`;
			if (image && !f.decorative && image.alt.trim() === "")
				return `Beschrijf de afbeelding bij ${f.label} voor wie hem niet ziet.`;
		} else if (f.kind === "choices") {
			if (f.required && asList(v).length === 0) return `Kies minstens een ${f.label}.`;
		} else if ("required" in f && f.required && asText(v).trim() === "") {
			return `Vul ${f.label} in.`;
		}
	}
	return "";
}

// The accessible names of an image field's preview and controls. `field`
// names the field ("Banner bovenaan", "Foto van Kaart 2"). The stored name is
// a random id, so the preview without alt text says which field it shows.
export function imageNames(field: string, image: Image | undefined) {
	return {
		preview: image?.alt.trim() || `Gekozen afbeelding bij ${field}`,
		alt: `Alt-tekst bij ${field}`,
		remove: `Afbeelding bij ${field} verwijderen`,
		file: image ? `Andere afbeelding bij ${field} kiezen` : `Afbeelding bij ${field} kiezen`,
	};
}
