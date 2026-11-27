import { textToBlocks, type Block } from "./blocks.ts";
import { hasFields, type Field, type FieldValues } from "./fields.ts";
import { itemPage } from "./store.ts";

// A list of items of one kind (projects, news) that the customer adds,
// orders, hides and removes in the admin. Items live in D1 only: a site seeds
// its existing ones once (collectionSeed) and keeps no item defaults in git.
export type CollectionDefinition = {
	// In the admin's switcher and the list's heading: "Projecten".
	label: string;
	// One item: "Project", as in "Nieuw project".
	item: string;
	// The item's fields besides its title and slug, as a block's.
	fields: readonly Field[];
	// The item's Portable Text texts, each with its own editor: "Tekst", "Foto's".
	texts: Record<string, { label: string }>;
	// The item's URL path, for the list's links and "Bekijk de pagina".
	path(item: { id: string; slug: string; title: string }): string;
};

// A collection in a file of its own, with its field names kept as literals so
// items() and item() are typed. Inline in createEditor({ collections }) needs
// no helper.
export function defineCollection<const C extends CollectionDefinition>(collection: C): C {
	return collection;
}

// An item as the site gets it: its fields typed from the collection's.
export type Item<C extends CollectionDefinition = CollectionDefinition> = {
	id: string;
	slug: string;
	title: string;
	path: string;
	fields: FieldValues<C["fields"]>;
};

// Lowercase letters, digits and single dashes: "villa-aan-zee".
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isSlug = (slug: string) => slug.length <= 100 && SLUG.test(slug);

// Collection names and ids are in the admin's URLs.
export const NAME = /^[a-z][a-z0-9-]*$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isItemId = (id: string) => ID.test(id);

// The slug for a title: "Villa aan Zee, Ouddorp" -> "villa-aan-zee-ouddorp".
export function slugify(title: string): string {
	const slug = title
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
		.replace(/-+$/, "");
	return slug || "item";
}

export function checkCollections(collections: Record<string, CollectionDefinition>) {
	for (const [name, collection] of Object.entries(collections)) {
		if (!NAME.test(name)) throw new Error(`collection name "${name}": a-z, 0-9 and - only`);
		for (const text of Object.keys(collection.texts)) {
			if (!NAME.test(text))
				throw new Error(`collection "${name}", text "${text}": a-z, 0-9 and - only`);
		}
	}
}

// One existing item for collectionSeed. `id` defaults to the slug, so running
// the same seed twice changes nothing. Texts are a string (a blank line starts
// a new paragraph) or Portable Text blocks.
export type SeedItem<C extends CollectionDefinition = CollectionDefinition> = {
	id?: string;
	slug: string;
	title: string;
	published?: boolean;
	fields?: FieldValues<C["fields"]>;
	texts?: { [N in keyof C["texts"]]?: string | readonly Block[] };
};

// One statement of a seed: the shape of `cf d1 raw --batch`.
export type SeedStatement = { sql: string; params: string[] };

const ITEM_INSERT =
	"INSERT OR IGNORE INTO item (collection, id, slug, title, position, fields, published, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
const TEXT_INSERT =
	"INSERT OR IGNORE INTO block (page, name, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)";

// The statements that add a collection's existing items, in the given order,
// with their texts. For a site's one-off import: write them as JSON to a file
// and run `cf d1 raw <db> --batch @seed.json`. Items whose id or slug is
// already there are skipped (INSERT OR IGNORE), so the customer's later
// changes stay. Throws on an item whose fields don't fit the collection's.
export function collectionSeedBatch<C extends CollectionDefinition>(
	name: string,
	collection: C,
	items: readonly SeedItem<C>[],
	by = "seed",
): SeedStatement[] {
	const now = new Date().toISOString();
	const statements: SeedStatement[] = [];
	items.forEach((item, position) => {
		const id = item.id ?? item.slug;
		const fields = (item.fields ?? {}) as Record<string, unknown>;
		if (!isSlug(item.slug)) throw new Error(`${name}: slug "${item.slug}" is not a valid slug`);
		if (!isItemId(id)) throw new Error(`${name}: id "${id}" is not a valid id`);
		if (!item.title.trim()) throw new Error(`${name} "${item.slug}": no title`);
		if (!hasFields(fields, collection.fields))
			throw new Error(`${name} "${item.slug}": fields don't fit the collection's`);
		// Numbers as strings too: the batch takes strings, the INTEGER columns convert them.
		statements.push({
			sql: ITEM_INSERT,
			params: [
				name,
				id,
				item.slug,
				item.title.trim(),
				String(position),
				JSON.stringify(fields),
				item.published === false ? "0" : "1",
				now,
				by,
			],
		});
		for (const [text, value] of Object.entries(item.texts ?? {})) {
			if (!Object.hasOwn(collection.texts, text))
				throw new Error(`${name} "${item.slug}": no text "${text}" in the collection`);
			if (value === undefined) continue;
			statements.push({
				sql: TEXT_INSERT,
				params: [
					itemPage(name, id),
					text,
					JSON.stringify(textToBlocks(value as string | readonly Block[])),
					now,
					by,
				],
			});
		}
	});
	return statements;
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

// The same as plain SQL, one statement per line, with the values inlined:
// for `cf d1 raw <db> --sql` or a look at what the seed does.
export function collectionSeed<C extends CollectionDefinition>(
	name: string,
	collection: C,
	items: readonly SeedItem<C>[],
	by = "seed",
): string {
	return collectionSeedBatch(name, collection, items, by)
		.map(({ sql, params }) =>
			sql
				.split("?")
				.map((part, i) => (i === 0 ? part : quote(params[i - 1]) + part))
				.join(""),
		)
		.map((line) => `${line};\n`)
		.join("");
}
