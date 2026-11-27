import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminData } from "../src/admin-data.ts";
import { collectionSeed, collectionSeedBatch, createEditor, slugify } from "../src/index.ts";
import { hasFields } from "../src/fields.ts";
import {
	createItem,
	itemPage,
	listItems,
	moveItem,
	readItem,
	readPageFields,
	readText,
	saveItem,
	saveText,
	setPublished,
	deleteItem,
	savePageFields,
} from "../src/store.ts";
import { testD1 } from "./d1.ts";
import { ISSUER, CUSTOMER, mockProvider } from "./provider.ts";
import { collections, pages, signIn, site } from "./site.tsx";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const image = { src: "/media/0b2c7c1e-1f7a-4f0e-9a39-1f1f1f1f1f1f.png", alt: "Gevel" };

async function seed(db: D1Database) {
	await db.exec(
		collectionSeed("projects", collections.projects, [
			{
				slug: "villa-aan-zee",
				title: "Villa aan zee",
				fields: { place: "Ouddorp", categories: ["living"], image },
				texts: { body: "Een villa.\n\nIn de duinen." },
			},
			{ slug: "kantoor", title: "Kantoor", fields: { place: "Goes", categories: ["work"] } },
			{ slug: "schuur", title: "Schuur", fields: { place: "Kapelle" }, published: false },
		]),
	);
}

describe("fields", () => {
	it("checks choices: known options, no doubles", () => {
		const fields = collections.projects.fields;
		expect(hasFields({ place: "Goes", categories: ["living", "work"] }, fields)).toBe(true);
		expect(hasFields({ place: "Goes", categories: [] }, fields)).toBe(true);
		expect(hasFields({ place: "Goes", categories: ["shop"] }, fields)).toBe(false);
		expect(hasFields({ place: "Goes", categories: ["work", "work"] }, fields)).toBe(false);
		expect(hasFields({ place: "Goes", categories: "work" }, fields)).toBe(false);
		expect(
			hasFields({}, [
				{ name: "c", label: "C", kind: "choices", options: { a: "A" }, required: true },
			]),
		).toBe(false);
	});

	it("makes slugs from titles", () => {
		expect(slugify("Villa aan Zee, Ouddorp")).toBe("villa-aan-zee-ouddorp");
		expect(slugify("Café Één")).toBe("cafe-een");
		expect(slugify("!!!")).toBe("item");
	});
});

describe("storage", () => {
	it("keeps items in order: new ones on top and hidden, moves, show, delete with texts", async () => {
		const db = testD1();
		await seed(db);
		expect((await listItems(db, "projects")).map((i) => i.slug)).toEqual([
			"villa-aan-zee",
			"kantoor",
			"schuur",
		]);

		await createItem(db, "projects", { id: "n1", slug: "nieuw", title: "Nieuw" }, "a@b.test");
		const all = await listItems(db, "projects");
		expect(all[0]).toMatchObject({ id: "n1", published: false, fields: {} });

		await moveItem(db, "projects", "n1", 1);
		await moveItem(db, "projects", "n1", 1);
		expect((await listItems(db, "projects")).map((i) => i.id)).toEqual([
			"villa-aan-zee",
			"kantoor",
			"n1",
			"schuur",
		]);
		// Past the end: nothing moves.
		await moveItem(db, "projects", "villa-aan-zee", -1);
		expect((await listItems(db, "projects"))[0].id).toBe("villa-aan-zee");

		await saveItem(
			db,
			"projects",
			"n1",
			{ slug: "ander-adres", title: "Nieuw!", fields: { place: "Tholen" } },
			"a@b.test",
		);
		await setPublished(db, "projects", "n1", true, "a@b.test");
		expect(await readItem(db, "projects", "n1")).toMatchObject({
			slug: "ander-adres",
			title: "Nieuw!",
			fields: { place: "Tholen" },
			published: true,
		});
		expect((await listItems(db, "projects", { published: true })).map((i) => i.id)).not.toContain(
			"schuur",
		);

		expect(await readText(db, itemPage("projects", "villa-aan-zee"), "body")).toHaveLength(2);
		await deleteItem(db, "projects", "villa-aan-zee");
		expect(await readItem(db, "projects", "villa-aan-zee")).toBeUndefined();
		expect(await readText(db, itemPage("projects", "villa-aan-zee"), "body")).toBeUndefined();
	});

	it("keeps a page's fields as one object", async () => {
		const db = testD1();
		expect(await readPageFields(db, "contact")).toBeUndefined();
		await savePageFields(db, "contact", { heading: "Hallo" }, "a@b.test");
		await savePageFields(db, "contact", { heading: "Dag" }, "a@b.test");
		expect(await readPageFields(db, "contact")).toEqual({ heading: "Dag" });
	});

	it("seeds once: running the seed again changes nothing", async () => {
		const db = testD1();
		await seed(db);
		await saveItem(
			db,
			"projects",
			"kantoor",
			{ slug: "kantoor", title: "Ander kantoor", fields: { place: "Goes" } },
			"a@b.test",
		);
		await seed(db);
		expect(await listItems(db, "projects")).toHaveLength(3);
		expect((await readItem(db, "projects", "kantoor"))?.title).toBe("Ander kantoor");
	});

	it("seeds from the batch form (cf d1 raw --batch) the same as from the SQL", async () => {
		const items = [
			{
				slug: "villa-aan-zee",
				title: "Het 'huis'? Ja",
				fields: { place: "O'Neill" },
				texts: { body: "Een villa." },
			},
			{ slug: "kantoor", title: "Kantoor", fields: { place: "Goes" }, published: false },
		];
		const batch = collectionSeedBatch("projects", collections.projects, items);
		// Plain JSON with string params, as the batch file holds.
		expect(JSON.parse(JSON.stringify(batch))).toEqual(batch);
		expect(batch.every((s) => s.params.every((p) => typeof p === "string"))).toBe(true);

		const fromBatch = testD1();
		for (const s of batch)
			await fromBatch
				.prepare(s.sql)
				.bind(...s.params)
				.run();
		const fromSql = testD1();
		await fromSql.exec(collectionSeed("projects", collections.projects, items));
		for (const db of [fromBatch, fromSql]) {
			expect(await listItems(db, "projects")).toEqual([
				{
					id: "villa-aan-zee",
					slug: "villa-aan-zee",
					title: "Het 'huis'? Ja",
					position: 0,
					fields: { place: "O'Neill" },
					published: true,
				},
				{
					id: "kantoor",
					slug: "kantoor",
					title: "Kantoor",
					position: 1,
					fields: { place: "Goes" },
					published: false,
				},
			]);
			expect(await readText(db, itemPage("projects", "villa-aan-zee"), "body")).toHaveLength(1);
		}
	});

	it("refuses seed items that don't fit the collection", () => {
		const bad = (item: object) => () =>
			collectionSeed("projects", collections.projects, [item as never]);
		expect(bad({ slug: "a", title: "A", fields: { place: "X", colour: "red" } })).toThrow(/fields/);
		expect(bad({ slug: "a", title: "A", fields: {} })).toThrow(/fields/);
		expect(bad({ slug: "Not A Slug", title: "A", fields: { place: "X" } })).toThrow(/slug/);
		expect(bad({ slug: "a", title: "A", fields: { place: "X" }, texts: { other: "x" } })).toThrow(
			/text/,
		);
		// Quotes are escaped.
		expect(
			collectionSeed("projects", collections.projects, [
				{ slug: "a", title: "Het 'huis'", fields: { place: "O'Neill" } },
			]),
		).toContain("'Het ''huis'''");
	});
});

describe("site API", () => {
	it("lists the shown items in order, with their path and fields", async () => {
		const s = site();
		await seed(s.db);
		const items = await s.editor.items("projects");
		expect(items).toEqual([
			{
				id: "villa-aan-zee",
				slug: "villa-aan-zee",
				title: "Villa aan zee",
				path: "/projecten/villa-aan-zee/",
				fields: { place: "Ouddorp", categories: ["living"], image },
			},
			{
				id: "kantoor",
				slug: "kantoor",
				title: "Kantoor",
				path: "/projecten/kantoor/",
				fields: { place: "Goes", categories: ["work"] },
			},
		]);
	});

	it("gets one item by slug with its texts; hidden or unknown is undefined", async () => {
		const s = site();
		await seed(s.db);
		const villa = await s.editor.item("projects", "villa-aan-zee");
		expect(villa?.fields.place).toBe("Ouddorp");
		expect(String(villa?.text("body"))).toBe("<p>Een villa.</p><p>In de duinen.</p>");
		expect(String(villa?.text.page("body"))).toContain('<div class="article max-w-3xl">');
		expect(villa?.text.value("photos")).toEqual([]);
		expect(await s.editor.item("projects", "schuur")).toBeUndefined();
		expect(await s.editor.item("projects", "bestaat-niet")).toBeUndefined();
	});

	it("gives a page's fields: the defaults until saved", async () => {
		const s = site();
		expect((await s.editor.texts("contact")).fields).toEqual({ heading: "Neem contact op" });
		await savePageFields(s.db, "contact", { heading: "Bel ons", banner: image }, "a@b.test");
		const contact = await s.editor.texts("contact");
		expect(contact.fields.heading).toBe("Bel ons");
		expect(contact.fields.banner).toEqual(image);
		// A page without fields has none.
		expect((await s.editor.texts("home")).fields).toEqual({});
	});

	it("has no items without a database", async () => {
		const editor = createEditor({ pages, collections });
		expect(await editor.items("projects")).toEqual([]);
		expect(await editor.item("projects", "kantoor")).toBeUndefined();
		expect((await editor.texts("contact")).fields).toEqual({ heading: "Neem contact op" });
	});

	it("refuses defaults that don't fit a page's fields, and bad collection names", () => {
		expect(() =>
			createEditor({
				pages: {
					p: {
						title: "P",
						path: "/",
						texts: {},
						fields: [{ name: "a", label: "A", kind: "text" }],
						defaults: { b: "x" },
					},
				},
			}),
		).toThrow(/defaults/);
		expect(() => createEditor({ pages, collections: { Projects: collections.projects } })).toThrow(
			/collection name/,
		);
	});
});

describe("admin", () => {
	const customer = {
		sub: "c-1",
		email: "info@klant.test",
		email_verified: true,
		[`${ISSUER}/customer_id`]: Number(CUSTOMER),
	};
	beforeEach(() => {
		mockProvider(() => customer);
	});

	async function admin() {
		const s = site();
		await seed(s.db);
		const { jar } = await signIn(s);
		const get = (path: string) => s.request(path, { headers: { cookie: jar.header() } });
		const post = (path: string, body: Record<string, string>) =>
			s.request(path, {
				method: "POST",
				headers: { cookie: jar.header(), origin: "https://site.test" },
				body: new URLSearchParams(body),
			});
		const data = async (path: string) => {
			const html = await (await get(path)).text();
			const json = html.match(/<script type="application\/json" id="admin-data">(.*?)<\/script>/s);
			return JSON.parse(json![1]) as AdminData;
		};
		return { s, get, post, data };
	}

	it("shows pages with their fields and the collections in the switcher, not the items", async () => {
		const { data } = await admin();
		const screen = await data("/admin/texts/home/body/");
		expect(screen.nav.map((g) => g.title)).toEqual(["Home", "Contact", "Collecties"]);
		expect(screen.nav[1].links.map((l) => l.href)).toEqual([
			"/admin/fields/contact/",
			"/admin/texts/contact/body/",
		]);
		expect(screen.nav[2].links).toEqual([
			{ href: "/admin/collections/projects/", label: "Projecten" },
		]);
		expect(screen.current).toBe("/admin/texts/home/body/");
	});

	it("edits a page's fields", async () => {
		const { s, data, post } = await admin();
		const before = await data("/admin/fields/contact/");
		expect(before.screen).toMatchObject({ kind: "fields", value: { heading: "Neem contact op" } });
		expect(before.pagePath).toBe("/contact/");

		const value = { heading: "Bel ons", slides: [{ _key: "a", caption: "Een" }] };
		const save = await post("/admin/fields/contact/", { value: JSON.stringify(value) });
		expect(save.status).toBe(303);
		expect(save.headers.get("location")).toBe("/admin/fields/contact/?saved");
		expect((await s.editor.texts("contact")).fields).toEqual(value);

		// A required field missing, or one the page doesn't have: refused.
		expect((await post("/admin/fields/contact/", { value: "{}" })).status).toBe(400);
		const extra = JSON.stringify({ heading: "x", colour: "red" });
		expect((await post("/admin/fields/contact/", { value: extra })).status).toBe(400);
		// A page without fields has no fields screen.
		expect((await post("/admin/fields/home/", { value: "{}" })).status).toBe(404);
	});

	it("lists a collection's items, hidden ones too", async () => {
		const { data } = await admin();
		const list = await data("/admin/collections/projects/");
		expect(list.screen.kind).toBe("collection");
		if (list.screen.kind !== "collection") return;
		expect(list.screen.items.map((i) => [i.id, i.published])).toEqual([
			["villa-aan-zee", true],
			["kantoor", true],
			["schuur", false],
		]);
		expect(list.screen.items[0].href).toBe("/admin/collections/projects/villa-aan-zee/");
		expect(list.current).toBe("/admin/collections/projects/");
	});

	it("adds an item with a free slug, hidden, on top", async () => {
		const { s, post } = await admin();
		const add = await post("/admin/collections/projects/new", { title: "Kantoor" });
		expect(add.status).toBe(303);
		const [first] = await listItems(s.db, "projects");
		expect(add.headers.get("location")).toBe(`/admin/collections/projects/${first.id}/`);
		expect(first).toMatchObject({ slug: "kantoor-2", title: "Kantoor", published: false });
		expect((await post("/admin/collections/projects/new", { title: " " })).status).toBe(400);
	});

	it("saves an item's title, slug and fields", async () => {
		const { s, data, post } = await admin();
		const screen = await data("/admin/collections/projects/kantoor/");
		expect(screen.screen).toMatchObject({
			kind: "item",
			title: "Kantoor",
			slug: "kantoor",
			value: { place: "Goes", categories: ["work"] },
		});
		if (screen.screen.kind !== "item") return;
		expect(screen.screen.tabs.map((t) => t.label)).toEqual(["Gegevens", "Tekst", "Foto's"]);
		expect(screen.pagePath).toBe("/projecten/kantoor/");

		const fields = { place: "Middelburg", categories: ["work", "living"] };
		const save = await post("/admin/collections/projects/kantoor/", {
			title: "Kantoor Middelburg",
			slug: "kantoor-middelburg",
			value: JSON.stringify(fields),
		});
		expect(save.status).toBe(303);
		const saved = await s.editor.item("projects", "kantoor-middelburg");
		expect(saved).toMatchObject({ id: "kantoor", title: "Kantoor Middelburg", fields });
		expect(await s.editor.item("projects", "kantoor")).toBeUndefined();

		const refused = (body: Record<string, string>) =>
			post("/admin/collections/projects/kantoor/", {
				title: "Kantoor",
				slug: "kantoor",
				value: JSON.stringify({ place: "Goes" }),
				...body,
			});
		expect((await refused({ slug: "villa-aan-zee" })).status).toBe(400);
		expect((await refused({ slug: "Niet Goed" })).status).toBe(400);
		expect((await refused({ title: "" })).status).toBe(400);
		expect(
			(await refused({ value: JSON.stringify({ place: "Goes", categories: ["x"] }) })).status,
		).toBe(400);
		expect((await refused({ value: JSON.stringify({}) })).status).toBe(400);
	});

	it("edits an item's texts under its id, so a new slug keeps them", async () => {
		const { s, data, post } = await admin();
		const path = "/admin/collections/projects/villa-aan-zee/texts/photos/";
		const screen = await data(path);
		expect(screen.screen).toMatchObject({ kind: "text", value: [] });

		const value = [{ _type: "quote", _key: "q", text: "Mooi" }];
		const save = await post(path, { value: JSON.stringify(value) });
		expect(save.headers.get("location")).toBe(`${path}?saved`);
		expect(await readText(s.db, itemPage("projects", "villa-aan-zee"), "photos")).toEqual(value);
		expect((await post(path, { value: "[{}]" })).status).toBe(400);
		expect((await post("/admin/collections/projects/villa-aan-zee/texts/nope/", {})).status).toBe(
			404,
		);
	});

	it("moves, shows, hides and deletes items", async () => {
		const { s, post } = await admin();
		const order = async () => (await listItems(s.db, "projects")).map((i) => i.id);
		await post("/admin/collections/projects/kantoor/move", { richting: "omhoog" });
		expect(await order()).toEqual(["kantoor", "villa-aan-zee", "schuur"]);
		await post("/admin/collections/projects/kantoor/move", { richting: "omlaag" });
		expect(await order()).toEqual(["villa-aan-zee", "kantoor", "schuur"]);

		await post("/admin/collections/projects/kantoor/visibility", { zichtbaar: "0" });
		expect(await s.editor.item("projects", "kantoor")).toBeUndefined();
		await post("/admin/collections/projects/kantoor/visibility", { zichtbaar: "1" });
		expect(await s.editor.item("projects", "kantoor")).toBeDefined();

		// A new item can't be shown before its required fields are filled in.
		await post("/admin/collections/projects/new", { title: "Leeg" });
		const [empty] = await listItems(s.db, "projects");
		const show = await post(`/admin/collections/projects/${empty.id}/visibility`, {
			zichtbaar: "1",
		});
		expect(show.status).toBe(400);

		const del = await post("/admin/collections/projects/villa-aan-zee/delete", {});
		expect(del.headers.get("location")).toBe("/admin/collections/projects/");
		expect(await order()).not.toContain("villa-aan-zee");
	});

	it("answers 404 for unknown collections and items, and needs a session", async () => {
		const { s, get, post } = await admin();
		expect((await get("/admin/collections/nope/")).status).toBe(404);
		expect((await get("/admin/collections/projects/nope/")).status).toBe(404);
		expect((await get("/admin/collections/projects/..%2F/")).status).toBe(404);
		expect((await post("/admin/collections/nope/new", { title: "X" })).status).toBe(404);
		const anonymous = await s.request("/admin/collections/projects/");
		expect(anonymous.headers.get("location")).toBe("/admin/");
		const anonymousFields = await s.request("/admin/fields/contact/");
		expect(anonymousFields.headers.get("location")).toBe("/admin/");
	});

	it("sends the old Dutch screen paths on to the English ones", async () => {
		const { s } = await admin();
		for (const [from, to] of [
			["/admin/teksten/home/body/", "/admin/texts/home/body/"],
			["/admin/velden/contact/", "/admin/fields/contact/"],
			["/admin/collecties/projects/", "/admin/collections/projects/"],
			["/admin/collecties/projects/kantoor/", "/admin/collections/projects/kantoor/"],
			[
				"/admin/collecties/projects/kantoor/teksten/photos/",
				"/admin/collections/projects/kantoor/texts/photos/",
			],
		]) {
			const res = await s.request(from);
			expect(res.status).toBe(301);
			expect(res.headers.get("location")).toBe(to);
		}
	});
});
