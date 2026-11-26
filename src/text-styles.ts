// A site's own text styles, on top of the built-in ones (bold, italic,
// underline, strike-through, headings h2 and h3, quote, lists, link). Each
// entry is a toolbar button in the editor (`label`, Dutch) and the HTML it
// renders as on the page and in the editor: `tag` with `class`. Classes come
// from the site's stylesheet, which the admin loads too (createEditor
// `stylesheet`), so the editor shows them as the page does.
//
// Keys are stored in the texts. Removing one is safe: a saved text that uses
// it shows that part as normal text.
export type TextStyles = {
	// Paragraph styles, like a lead paragraph: { lead: { label: "Intro", tag: "p", class: "lead" } }.
	blockStyles?: Record<string, { label: string; tag: string; class: string }>;
	// Styles for selected words, like a highlight or a footnote marker.
	decorators?: Record<string, { label: string; tag: string; class: string }>;
	// Links that look different, like a button. The editor asks for the address.
	linkStyles?: Record<string, { label: string; class: string }>;
};

const TAG = /^[a-z][a-z0-9]*$/;
const BUILT_IN = new Set([
	"normal",
	"h2",
	"h3",
	"blockquote",
	"strong",
	"em",
	"underline",
	"strike-through",
	"link",
]);

export function textStyleSets(textStyles: TextStyles) {
	const { blockStyles = {}, decorators = {}, linkStyles = {} } = textStyles;
	for (const [name, s] of [...Object.entries(blockStyles), ...Object.entries(decorators)]) {
		if (!TAG.test(s.tag))
			throw new Error(`text style "${name}": tag "${s.tag}" is not an HTML tag name`);
	}
	for (const name of [
		...Object.keys(blockStyles),
		...Object.keys(decorators),
		...Object.keys(linkStyles),
	]) {
		if (BUILT_IN.has(name)) throw new Error(`text style "${name}" is built in`);
	}
	return {
		styles: Object.keys(blockStyles),
		decorators: Object.keys(decorators),
		annotations: Object.keys(linkStyles),
	};
}
