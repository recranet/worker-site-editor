import { describe, expect, it } from "vitest";
import {
	clean,
	createSchema,
	defineBlock,
	keepUnknown,
	parseBlocks,
	type Block,
} from "../src/blocks.ts";
import { hero, quote } from "./site.tsx";

const schema = createSchema([quote, hero], {
	decorators: { highlight: { label: "Markeren", tag: "mark", class: "highlight" } },
});
const text = (key: string, t: string, marks: string[] = []): Block => ({
	_type: "block",
	_key: key,
	style: "normal",
	markDefs: [],
	children: [{ _type: "span", _key: `${key}s`, text: t, marks }],
});
const parse = (value: unknown) => parseBlocks(JSON.stringify(value), schema);

describe("defineBlock", () => {
	it("refuses a built-in or malformed name", () => {
		const def = { label: "x", fields: [], render: () => "" };
		expect(() => defineBlock({ name: "image", ...def })).toThrow(/built in/);
		expect(() => defineBlock({ name: "block", ...def })).toThrow(/built in/);
		expect(() => defineBlock({ name: "Not ok", ...def })).toThrow(/letters/);
	});

	it("refuses one name registered twice", () => {
		expect(() => createSchema([quote, quote], {})).toThrow(/twice/);
	});

	it("puts a block in the text column unless it says section", () => {
		expect(quote.section).toBe(false);
		expect(hero.section).toBe(true);
	});
});

describe("parseBlocks: what the editor may save", () => {
	it("takes text, a site style and a registered block", () => {
		const value = [
			text("a", "Hallo", ["strong", "highlight"]),
			{ _type: "quote", _key: "q", text: "Mooi", source: "Klant" },
			{
				_type: "hero",
				_key: "h",
				title: "Welkom",
				buttons: [{ _key: "b", label: "Contact", href: "/contact/" }],
			},
		];
		expect(parse(value)).toEqual(value);
	});

	it("refuses a block type the site doesn't have", () => {
		expect(parse([{ _type: "slider", _key: "s" }])).toBeUndefined();
	});

	it("refuses a block with a field it doesn't define", () => {
		expect(parse([{ _type: "quote", _key: "q", text: "x", onclick: "alert(1)" }])).toBeUndefined();
	});

	it("refuses a missing required field, also in a list item", () => {
		expect(parse([{ _type: "quote", _key: "q", source: "x" }])).toBeUndefined();
		expect(
			parse([{ _type: "hero", _key: "h", title: "x", buttons: [{ _key: "b", label: "Contact" }] }]),
		).toBeUndefined();
	});

	it("refuses an unsafe link and a foreign image", () => {
		expect(
			parse([{ _type: "quote", _key: "q", text: "x", link: "javascript:alert(1)" }]),
		).toBeUndefined();
		expect(
			parse([
				{
					_type: "hero",
					_key: "h",
					title: "x",
					image: { src: "https://evil.test/a.png", alt: "" },
				},
			]),
		).toBeUndefined();
	});

	it("refuses an unknown decorator and a block without a key", () => {
		expect(parse([text("a", "x", ["blink"])])).toBeUndefined();
		expect(parse([{ ...text("a", "x"), _key: undefined }])).toBeUndefined();
	});

	it("refuses what isn't a list of blocks", () => {
		expect(parseBlocks("{", schema)).toBeUndefined();
		expect(parseBlocks('{"_type":"block"}', schema)).toBeUndefined();
	});
});

describe("unknown blocks", () => {
	const stored: Block[] = [
		text("a", "Eerste"),
		{ _type: "slider", _key: "s1", slides: [] },
		{ _type: "slider", _key: "s2", slides: [] },
		text("b", "Tweede"),
		{ _type: "countdown", _key: "c" },
	];

	it("are left out for the page and the editor", () => {
		expect(clean(stored, schema).map((b) => b._key)).toEqual(["a", "b"]);
	});

	it("stay in the stored text, after the block they followed", () => {
		const posted = [text("b", "Tweede, aangepast"), text("n", "Nieuw"), text("a", "Eerste")];
		expect(keepUnknown(stored, posted, schema).map((b) => b._key)).toEqual([
			"b",
			"c",
			"n",
			"a",
			"s1",
			"s2",
		]);
	});

	it("go first when the block they followed is gone", () => {
		const posted = [text("x", "Alles nieuw")];
		expect(keepUnknown(stored, posted, schema).map((b) => b._key)).toEqual(["s1", "s2", "c", "x"]);
	});

	it("turn a removed style or mark into plain text", () => {
		const removed = createSchema([], {});
		const [block] = clean(
			[{ ...text("a", "x", ["highlight"]), style: "lead" }],
			removed,
		) as never[];
		expect(block).toMatchObject({ style: "normal", children: [{ marks: [] }] });
	});
});
