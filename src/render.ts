import {
	escapeHTML,
	toHTML,
	uriLooksSafe,
	type PortableTextComponents,
} from "@portabletext/to-html";
import {
	clean,
	type Block,
	type BlockDefinition,
	type RenderContext,
	type Schema,
} from "./blocks.ts";
import { isFieldImage, isMediaImage, MEDIA_SRC, type ImageValue } from "./fields.ts";

const attr = (value: string) => escapeHTML(value).replaceAll('"', "&quot;");

// The widths pages ask Cloudflare Images for; others get the original, so
// nobody can make the Worker transform an image at every width.
export const WIDTHS = [480, 960, 1440, 1920, 2560];

export function renderContext(scaling: boolean): RenderContext {
	const srcset = (src: string, width?: number) => {
		if (!scaling || !width || !MEDIA_SRC.test(src)) return undefined;
		const sizes = WIDTHS.filter((w) => w < width);
		return [...sizes.map((w) => `${src}?w=${w} ${w}w`), `${src} ${width}w`].join(", ");
	};
	return {
		srcset,
		image(image, options = {}) {
			if (!isFieldImage(image)) return "";
			const w = image.width;
			const h = image.height;
			const set = srcset(image.src, w);
			return [
				`<img src="${attr(image.src)}" alt="${attr(image.alt)}"`,
				w && h ? ` width="${w}" height="${h}"` : "",
				set ? ` srcset="${set}" sizes="${attr(options.sizes ?? "100vw")}"` : "",
				options.class ? ` class="${attr(options.class)}"` : "",
				options.eager ? ` fetchpriority="high"` : ` loading="lazy"`,
				` decoding="async">`,
			].join("");
		},
	};
}

// A site block's HTML. A render that throws or is async leaves the block out
// instead of failing the page; the log says which.
function renderBlock(
	block: BlockDefinition,
	value: { _type: string; _key: string } & Record<string, unknown>,
	ctx: RenderContext,
): string {
	try {
		const out = block.render(value, ctx);
		if (out instanceof Promise)
			throw new Error("render returned a Promise; blocks render synchronously");
		return String(out);
	} catch (e) {
		console.error(`block "${block.name}" (${value._key}) did not render:`, e);
		return "";
	}
}

type GalleryBlock = { _type: "gallery"; _key: string; images: (ImageValue & { _key?: string })[] };

export function createRenderer(schema: Schema, ctx: RenderContext) {
	const { blockStyles = {}, decorators = {}, linkStyles = {} } = schema.textStyles;
	const components: PortableTextComponents = {
		// The site's own paragraph styles; the built-in ones keep to-html's defaults.
		block: Object.fromEntries(
			Object.entries(blockStyles).map(([name, s]) => [
				name,
				({ children }) => `<${s.tag} class="${attr(s.class)}">${children ?? ""}</${s.tag}>`,
			]),
		),
		marks: {
			...Object.fromEntries(
				Object.entries(decorators).map(([name, d]) => [
					name,
					({ children }) => `<${d.tag} class="${attr(d.class)}">${children}</${d.tag}>`,
				]),
			),
			// A link with the style's classes. An unsafe URL leaves just the text, as with a plain link.
			...Object.fromEntries(
				Object.entries(linkStyles).map(([name, l]) => [
					name,
					({ children, value }) => {
						const href = typeof value?.href === "string" ? value.href : "";
						return uriLooksSafe(href)
							? `<a href="${attr(href)}" class="${attr(l.class)}">${children}</a>`
							: children;
					},
				]),
			),
		},
		types: {
			image: ({ value }: { value: ImageValue }) =>
				isMediaImage(value)
					? `<figure class="editor-image">${ctx.image(value, { sizes: "(min-width: 48rem) 42rem, 100vw" })}</figure>`
					: "",
			// Links to the large images, for the site to lay out as a grid (.gallery)
			// and its lightbox script to open ([data-gallery]). Plain markup: the
			// site styles .editor-image and .gallery.
			gallery: ({ value }: { value: GalleryBlock }) =>
				`<div class="gallery">${value.images
					.filter(isMediaImage)
					.map(
						(image) =>
							`<a href="${attr(image.src)}" data-gallery>${ctx.image(image, { sizes: "(min-width: 48rem) 33vw, 50vw" })}</a>`,
					)
					.join("")}</div>`,
			...Object.fromEntries(
				[...schema.blocks.values()].map((block) => [
					block.name,
					({ value }: { value: { _type: string; _key: string } & Record<string, unknown> }) =>
						renderBlock(block, value, ctx),
				]),
			),
		},
		// clean() already left out what the site doesn't know.
		unknownType: () => "",
		unknownMark: ({ children }) => children,
		unknownBlockStyle: ({ children }) => `<p>${children ?? ""}</p>`,
	};

	const html = (value: Block[]) =>
		toHTML(clean(value, schema) as Parameters<typeof toHTML>[0], {
			components,
			onMissingComponent: false,
		});

	return {
		html,
		// Section blocks on their own, full width; the blocks between them
		// together in the text column.
		sections(value: Block[], column: (html: string) => string) {
			const out: string[] = [];
			let run: Block[] = [];
			const flush = () => {
				if (run.length > 0) out.push(column(html(run)));
				run = [];
			};
			for (const block of clean(value, schema)) {
				if (schema.blocks.get(block._type)?.section) {
					flush();
					out.push(html([block]));
				} else run.push(block);
			}
			flush();
			return out.join("");
		},
	};
}
