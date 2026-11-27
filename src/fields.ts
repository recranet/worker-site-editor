import { uriLooksSafe } from "@portabletext/to-html";

// A block's fields (defineBlock). One list serves three places: the admin
// builds the block's form from it, saving checks a posted block against it,
// and the block's render gets the checked value. Labels are Dutch: the
// customer sees them. Field names are stored in the texts.

export type ItemField =
	| {
			name: string;
			label: string;
			kind: "text" | "textarea" | "url";
			required?: boolean;
	  }
	// An image needs an alt text, unless it's `decorative` (a banner or a
	// background photo): then the admin asks none and stores alt "".
	| { name: string; label: string; kind: "image"; required?: boolean; decorative?: boolean }
	| { name: string; label: string; kind: "select"; options: Record<string, string> }
	// Several of the options (categories), stored as a list of their keys.
	| {
			name: string;
			label: string;
			kind: "choices";
			options: Record<string, string>;
			required?: boolean;
	  };

// A list of items, each with its own fields: no lists inside lists.
export type Field =
	| ItemField
	| { name: string; label: string; kind: "items"; item: string; fields: readonly ItemField[] };

// An image as stored: `src` is an upload (/media/<id>.<ext>) or a file the
// site ships (/img/logo.svg).
export type ImageValue = { src: string; alt: string; width?: number; height?: number };

type ValueOf<F> = F extends { kind: "items"; fields: infer I extends readonly ItemField[] }
	? ({ _key: string } & FieldValues<I>)[]
	: F extends { kind: "image" }
		? ImageValue
		: F extends { kind: "choices"; options: infer O }
			? (keyof O & string)[]
			: F extends { kind: "select"; options: infer O }
				? keyof O & string
				: string;

type Required<F> = F extends { required: true } ? true : false;

// The value a block's render gets for its fields: required ones always set,
// the others possibly missing.
export type FieldValues<Fs extends readonly Field[]> = {
	[F in Fs[number] as Required<F> extends true ? F["name"] : never]: ValueOf<F>;
} & {
	[F in Fs[number] as Required<F> extends true ? never : F["name"]]?: ValueOf<F>;
};

export const MEDIA_SRC = /^\/media\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/;
const SITE_SRC = /^\/(?!media\/)[\w-]+(\/[\w-]+)*\.(svg|png|jpg|jpeg|webp|avif)$/;

const size = (n: unknown) => n === undefined || (Number.isInteger(n) && (n as number) > 0);

// An uploaded image: image and gallery blocks only take those.
export function isMediaImage(i: unknown): boolean {
	return isImage(i, MEDIA_SRC);
}

// An image in a block's field: an upload or one of the site's own files.
export function isFieldImage(i: unknown): boolean {
	return isImage(i, MEDIA_SRC) || isImage(i, SITE_SRC);
}

function isImage(i: unknown, src: RegExp): boolean {
	if (typeof i !== "object" || i === null) return false;
	const image = i as Record<string, unknown>;
	return (
		typeof image.src === "string" &&
		src.test(image.src) &&
		typeof image.alt === "string" &&
		image.alt.length <= 300 &&
		size(image.width) &&
		size(image.height)
	);
}

// A block or one item of its lists: only its own fields (and _type, _key),
// each of the right kind.
export function hasFields(value: Record<string, unknown>, fields: readonly Field[]): boolean {
	const names = new Set(["_type", "_key", ...fields.map((f) => f.name)]);
	if (Object.keys(value).some((name) => !names.has(name))) return false;
	return fields.every((f) => isField(value[f.name], f));
}

function isField(value: unknown, field: Field): boolean {
	if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0))
		return !("required" in field && field.required);
	switch (field.kind) {
		case "text":
			return typeof value === "string" && value.length <= 300;
		case "textarea":
			return typeof value === "string" && value.length <= 5000;
		case "url":
			return typeof value === "string" && value.length <= 2000 && uriLooksSafe(value);
		case "select":
			return typeof value === "string" && Object.hasOwn(field.options, value);
		case "choices":
			return (
				Array.isArray(value) &&
				new Set(value).size === value.length &&
				value.every((v) => typeof v === "string" && Object.hasOwn(field.options, v))
			);
		// A decorative image's alt isn't read: one saved before the field
		// turned decorative still fits.
		case "image":
			return (
				isFieldImage(value) &&
				(field.decorative === true || (value as ImageValue).alt.trim() !== "")
			);
		case "items":
			return (
				Array.isArray(value) &&
				value.length <= 50 &&
				value.every(
					(item) => typeof item === "object" && item !== null && hasFields(item, field.fields),
				)
			);
	}
}
