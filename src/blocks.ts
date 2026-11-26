import type { HtmlEscapedString } from "hono/utils/html";
import {
	hasFields,
	isMediaImage,
	type Field,
	type FieldValues,
	type ImageValue,
} from "./fields.ts";
import { textStyleSets, type TextStyles } from "./text-styles.ts";

// A paragraph, heading or list item, as stored. Marks name a decorator or the
// _key of one of the block's markDefs (a link and its href).
export type TextBlock = {
	_type: "block";
	_key?: string;
	style?: string;
	listItem?: string;
	level?: number;
	markDefs?: { _type: string; _key: string; href?: string }[];
	children: { _type: string; _key?: string; text?: string; marks?: string[] }[];
};

// Any block in a text: a text block, an image, a gallery or a site's own
// block (defineBlock), as stored.
export type Block = TextBlock | { _type: string; _key?: string; [field: string]: unknown };

// What a block's render gets besides its value: the site's image helpers,
// which know whether Cloudflare Images scales uploads (createEditor `images`).
export type RenderContext = {
	// One <img>, with a srcset when the image is an upload and scaling is on.
	// `sizes` says how wide it shows. Returns "" for an image that isn't safe.
	image(image: ImageValue, options?: { sizes?: string; class?: string; eager?: boolean }): string;
	// The srcset for an upload `width` pixels wide, or undefined.
	srcset(src: string, width?: number): string | undefined;
};

type Rendered = string | HtmlEscapedString | { toString(): string };

export type BlockDefinition = {
	name: string;
	// The name in the editor's "Onderdeel" menu and on the block's card.
	label: string;
	// Full width on the page (texts().page), or in the text column.
	section: boolean;
	fields: readonly Field[];
	render(
		value: { _type: string; _key: string } & Record<string, unknown>,
		ctx: RenderContext,
	): Rendered;
};

// A site's own block type. The fields give the editor's form and the check on
// save; `render` turns a saved, checked block into HTML for the page. Field
// values are text (escape them: Hono JSX does), images and lists.
export function defineBlock<const Fs extends readonly Field[]>(definition: {
	name: string;
	label: string;
	section?: boolean;
	fields: Fs;
	render(value: { _type: string; _key: string } & FieldValues<Fs>, ctx: RenderContext): Rendered;
}): BlockDefinition {
	if (BUILT_IN.has(definition.name) || definition.name === "block")
		throw new Error(`block name "${definition.name}" is built in`);
	if (!/^[a-z][a-zA-Z0-9-]*$/.test(definition.name))
		throw new Error(`block name "${definition.name}": letters, digits and - only`);
	return {
		...definition,
		section: definition.section ?? false,
		render: definition.render as BlockDefinition["render"],
	};
}

// The built-in block objects, rendered by render.ts: one image, and a gallery.
const BUILT_IN = new Set(["image", "gallery"]);

const STYLES = ["normal", "h2", "h3", "blockquote"];
const DECORATORS = ["strong", "em", "underline", "strike-through"];
const ANNOTATIONS = ["link"];
const LISTS = new Set(["bullet", "number"]);

// What a site's texts may hold: the built-ins, its text styles and its blocks.
export type Schema = ReturnType<typeof createSchema>;

export function createSchema(blocks: readonly BlockDefinition[], textStyles: TextStyles) {
	const byName = new Map<string, BlockDefinition>();
	for (const block of blocks) {
		if (byName.has(block.name)) throw new Error(`block "${block.name}" is registered twice`);
		byName.set(block.name, block);
	}
	const own = textStyleSets(textStyles);
	return {
		blocks: byName,
		textStyles,
		styles: new Set([...STYLES, ...own.styles]),
		decorators: new Set([...DECORATORS, ...own.decorators]),
		annotations: new Set([...ANNOTATIONS, ...own.annotations]),
		known: (type: string) => type === "block" || BUILT_IN.has(type) || byName.has(type),
	};
}

// For the page and the editor: drops what the site no longer has, so removing
// a text style or a block never breaks a saved text. Its paragraphs show as
// normal ones, its marks as plain text, and an unknown block is left out.
// The stored value keeps them (keepUnknown).
export function clean(value: Block[], schema: Schema): Block[] {
	return value.flatMap((b): Block[] => {
		if (typeof b !== "object" || b === null) return [];
		if (b._type !== "block") return schema.known(b._type) ? [b] : [];
		const block = b as TextBlock;
		if (!Array.isArray(block.children)) return [];
		const markDefs = (block.markDefs ?? []).filter((def) => schema.annotations.has(def._type));
		const keys = new Set(markDefs.map((def) => def._key));
		const known = (mark: string) => schema.decorators.has(mark) || keys.has(mark);
		return [
			{
				...block,
				style: schema.styles.has(block.style ?? "normal") ? block.style : "normal",
				listItem: block.listItem && LISTS.has(block.listItem) ? block.listItem : undefined,
				markDefs,
				children: block.children.map((child) => ({
					...child,
					marks: child.marks?.filter(known),
				})),
			},
		];
	});
}

// On save: the stored blocks of a type the site doesn't know (any more) go
// back in, each after the block it followed, so a site that drops a block
// type for a while loses no text. The editor never had them.
export function keepUnknown(stored: Block[], posted: Block[], schema: Schema): Block[] {
	const out = [...posted];
	stored.forEach((block, i) => {
		if (schema.known(block._type)) return;
		let at = 0;
		for (let j = i - 1; j >= 0; j--) {
			const key = stored[j]._key;
			const found = key === undefined ? -1 : out.findIndex((b) => b._key === key);
			if (found >= 0) {
				at = found + 1;
				break;
			}
		}
		out.splice(at, 0, block);
	});
	return out;
}

// The editor's JSON as posted. Only blocks the site knows, with known styles,
// marks and fields, and not too large. Rendering escapes the text.
export function parseBlocks(json: string, schema: Schema): Block[] | undefined {
	if (json.length > 200_000) return undefined;
	try {
		const value: unknown = JSON.parse(json);
		if (!Array.isArray(value)) return undefined;
		return value.every((b) => isBlock(b, schema)) ? value : undefined;
	} catch {
		return undefined;
	}
}

function isBlock(b: unknown, schema: Schema): boolean {
	if (typeof b !== "object" || b === null) return false;
	const block = b as Record<string, unknown>;
	if (typeof block._key !== "string" || block._key.length > 100) return false;
	if (block._type === "block") return isTextBlock(block, schema);
	if (block._type === "image") return isMediaImage(block);
	if (block._type === "gallery") {
		const list = block.images;
		return (
			Array.isArray(list) &&
			list.length > 0 &&
			list.length <= 60 &&
			list.every(isMediaImage) &&
			Object.keys(block).every((k) => ["_type", "_key", "images"].includes(k))
		);
	}
	const own = typeof block._type === "string" ? schema.blocks.get(block._type) : undefined;
	return own !== undefined && hasFields(block, own.fields);
}

function isTextBlock(block: Record<string, unknown>, schema: Schema): boolean {
	const { style, listItem, markDefs = [], children } = block as Partial<TextBlock>;
	if (!Array.isArray(children) || !Array.isArray(markDefs)) return false;
	if (style !== undefined && !schema.styles.has(style)) return false;
	if (listItem !== undefined && !LISTS.has(listItem)) return false;
	if (!markDefs.every((def) => schema.annotations.has(def?._type))) return false;
	const keys = new Set(markDefs.map((def) => def._key));
	return children.every(
		(child) =>
			typeof child === "object" &&
			child !== null &&
			(child.text === undefined || typeof child.text === "string") &&
			(child.marks ?? []).every((mark) => schema.decorators.has(mark) || keys.has(mark)),
	);
}

// A default text: a string (a blank line starts a new paragraph) or blocks.
export function textToBlocks(text: string | readonly Block[]): Block[] {
	if (typeof text !== "string") return [...text];
	return text.split(/\n\s*\n/).map((paragraph, i) => ({
		_type: "block",
		_key: `default${i}`,
		style: "normal",
		markDefs: [],
		children: [{ _type: "span", _key: `default${i}s`, text: paragraph.trim(), marks: [] }],
	}));
}
