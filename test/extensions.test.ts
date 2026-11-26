import { describe, expect, it } from "vitest";
import { createSchema, parseBlocks } from "../src/blocks.ts";
import * as ext from "../src/extensions/index.ts";
import { pages } from "./site.tsx";
import { createEditor } from "../src/index.ts";

const image = {
	src: "/media/0b2c7c1e-1f7a-4f0e-9a39-1f1f1f1f1f1f.jpg",
	alt: "Strand",
	width: 1600,
	height: 900,
};
const items = (...rows: Record<string, unknown>[]) => rows.map((r, i) => ({ _key: `k${i}`, ...r }));

// One filled-in value per extension block, as the editor would save it.
const samples: Record<string, Record<string, unknown>> = {
	hero: {
		title: "Welkom",
		intro: "Aan zee.",
		image,
		variant: "split",
		buttons: items({ label: "Boek", href: "/boeken/" }),
	},
	feature: {
		title: "Ligging",
		text: "Vlak bij zee.",
		image,
		align: "right",
		caption: "Het strand",
	},
	cards: {
		title: "Kaarten",
		layout: "bento",
		cards: items({ title: "Een", image, style: "overlay", href: "/een/" }, { title: "Twee" }),
	},
	features: { title: "Kenmerken", items: items({ title: "Snel", text: "Heel snel" }) },
	stats: { items: items({ value: "25+", label: "jaar" }) },
	cta: {
		title: "Kom langs",
		text: "We zijn open.",
		buttons: items({ label: "Contact", href: "/contact/", style: "outline" }),
	},
	marquee: { speed: "fast", items: items({ text: "Zon" }, { text: "Zee" }) },
	map: { title: "Route", query: "Middelburg" },
	accordion: { items: items({ title: "Honden?", text: "Ja.\n\nAangelijnd." }) },
	quote: { text: "Prachtig", source: "Gast" },
	checklist: { items: items({ label: "Wifi", text: "Overal" }) },
	labels: { items: items({ text: "Honden welkom" }) },
};

const blocks = Object.values(ext).filter((v): v is (typeof ext)["hero"] => "render" in v);

describe("extension blocks", () => {
	it("are all here, each with a sample", () => {
		expect(blocks.map((b) => b.name).sort()).toEqual(Object.keys(samples).sort());
	});

	const editor = createEditor({ pages, blocks, images: {} as ImagesBinding });
	const schema = createSchema(blocks, {});

	for (const block of blocks) {
		it(`${block.name}: saves its sample and renders it`, () => {
			const value = { _type: block.name, _key: "x", ...samples[block.name] };
			expect(parseBlocks(JSON.stringify([value]), schema)).toEqual([value]);
			const html = editor.render([value]).toString();
			expect(html.length).toBeGreaterThan(20);
			expect(html).not.toContain("undefined");
		});
	}

	it("escape what the customer typed", () => {
		const html = editor
			.render([{ _type: "quote", _key: "q", text: "<img src=x onerror=alert(1)>" }])
			.toString();
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
	});

	it("give uploads a srcset when Images scales them", () => {
		const html = editor.render([{ _type: "hero", _key: "h", ...samples.hero }]).toString();
		expect(html).toContain("?w=960 960w");
	});

	it("open accordion items one at a time per block", () => {
		const html = editor
			.render([{ _type: "accordion", _key: "faq", ...samples.accordion }])
			.toString();
		expect(html).toContain('name="accordion-faq"');
	});

	it("leave out a button with an unsafe link", () => {
		const html = editor
			.render([
				{
					_type: "cta",
					_key: "c",
					title: "x",
					buttons: items({ label: "Kwaad", href: "javascript:alert(1)" }),
				},
			])
			.toString();
		expect(html).not.toContain("javascript:");
	});
});

describe("extension text styles", () => {
	it("render under the keys the site gives them", () => {
		const editor = createEditor({
			pages,
			textStyles: {
				decorators: { highlight: ext.highlight, footnote: ext.footnote },
				blockStyles: { lead: ext.lead },
				linkStyles: { button: ext.button },
			},
		});
		const html = editor
			.render([
				{
					_type: "block",
					_key: "a",
					style: "lead",
					markDefs: [{ _type: "button", _key: "l", href: "/boeken/" }],
					children: [
						{ _type: "span", _key: "s1", text: "Groen", marks: ["highlight"] },
						{ _type: "span", _key: "s2", text: "1", marks: ["footnote"] },
						{ _type: "span", _key: "s3", text: "Boek", marks: ["l"] },
					],
				},
			])
			.toString();
		expect(html).toBe(
			'<p class="lead"><mark class="highlight">Groen</mark><sup class="footnote">1</sup><a href="/boeken/" class="btn btn-primary">Boek</a></p>',
		);
	});
});
