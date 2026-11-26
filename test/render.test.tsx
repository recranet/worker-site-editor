import { describe, expect, it, vi } from "vitest";
import { defineBlock } from "../src/index.ts";
import { saveText } from "../src/store.ts";
import { site } from "./site.tsx";

const p = (key: string, text: string, marks: string[] = [], markDefs: unknown[] = []) => ({
	_type: "block",
	_key: key,
	style: "normal",
	markDefs,
	children: [{ _type: "span", _key: `${key}s`, text, marks }],
});

describe("texts()", () => {
	it("renders the default text until the customer saves", async () => {
		const { editor } = site();
		const text = await editor.texts("home");
		expect(String(text("intro"))).toBe("<p>Intro.</p>");
		expect(String(text("body"))).toBe("<p>Welkom.</p><p>Tweede alinea.</p>");
	});

	it("renders the saved text with the site's styles and blocks", async () => {
		const { editor, db } = site();
		await saveText(
			db,
			"home",
			"body",
			[
				p("a", "Let op", ["highlight"]),
				p("b", "Contact", ["l"], [{ _type: "button", _key: "l", href: "/contact/" }]),
				{ _type: "quote", _key: "q", text: "<script>x</script>", source: "Klant" },
			],
			"test@example.test",
		);
		const html = String((await editor.texts("home"))("body"));
		expect(html).toContain('<p><mark class="highlight">Let op</mark></p>');
		expect(html).toContain('<a href="/contact/" class="btn">Contact</a>');
		expect(html).toContain("<blockquote>&lt;script&gt;x&lt;/script&gt;</blockquote>");
		expect(html).toContain("<figcaption>Klant</figcaption>");
	});

	it("skips a block type the site doesn't know instead of failing", async () => {
		const { editor, db } = site();
		await saveText(
			db,
			"home",
			"body",
			[p("a", "Voor"), { _type: "slider", _key: "s" }, p("b", "Na")],
			"x",
		);
		expect(String((await editor.texts("home"))("body"))).toBe("<p>Voor</p><p>Na</p>");
	});

	it("renders section blocks full width and the rest in the text column", async () => {
		const { editor, db } = site({ column: (html) => `<div class="col">${html}</div>` });
		await saveText(
			db,
			"home",
			"body",
			[
				{
					_type: "hero",
					_key: "h",
					title: "Welkom",
					buttons: [{ _key: "b", label: "Kom", href: "/contact/" }],
				},
				p("a", "Een"),
				{ _type: "quote", _key: "q", text: "Mooi" },
				p("b", "Twee"),
			],
			"x",
		);
		const html = String((await editor.texts("home")).page("body"));
		expect(html).toBe(
			'<header class="hero"><h1>Welkom</h1><a href="/contact/">Kom</a></header>' +
				'<div class="col"><p>Een</p><figure class="quote"><blockquote>Mooi</blockquote></figure><p>Twee</p></div>',
		);
	});

	it("leaves out a block whose render throws", async () => {
		const broken = defineBlock({
			name: "broken",
			label: "Kapot",
			fields: [],
			render: () => {
				throw new Error("boom");
			},
		});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const { editor } = site({ blocks: [broken] });
		expect(String(editor.render([p("a", "Tekst"), { _type: "broken", _key: "k" }]))).toBe(
			"<p>Tekst</p>",
		);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it("shows the defaults without a database", async () => {
		const { editor, request } = site({ db: undefined });
		expect(editor.editing).toBe(false);
		expect(String((await editor.texts("contact"))("body"))).toBe("<p>Bel ons.</p>");
		expect((await request("/admin/")).status).toBe(404);
	});
});

describe("images", () => {
	const upload = {
		_type: "image",
		_key: "i",
		src: "/media/0b2c7c1e-1f7a-4f0e-9a39-1f1f1f1f1f1f.jpg",
		alt: 'Een "boot"',
		width: 2000,
		height: 1000,
	};

	it("renders an upload, with a srcset only when Images scales them", async () => {
		const plain = site().editor.render([upload]).toString();
		expect(plain).toContain(
			'src="/media/0b2c7c1e-1f7a-4f0e-9a39-1f1f1f1f1f1f.jpg" alt="Een &quot;boot&quot;"',
		);
		expect(plain).not.toContain("srcset");
		const scaled = site({ images: {} as ImagesBinding })
			.editor.render([upload])
			.toString();
		expect(scaled).toContain("?w=480 480w");
		expect(scaled).toContain("?w=1920 1920w");
		expect(scaled).not.toContain("?w=2560");
	});

	it("never renders an image from elsewhere", () => {
		const html = site()
			.editor.render([{ ...upload, src: "https://evil.test/x.jpg" }])
			.toString();
		expect(html).toBe("");
	});
});
