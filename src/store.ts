import type { Block } from "./blocks.ts";

// The texts in the site's D1, table `block` (migrations/0001_block.sql):
// one row per page and text, its value Portable Text as JSON.

export async function readPage(db: D1Database, page: string): Promise<Map<string, Block[]>> {
	const rows = await db
		.prepare("SELECT name, value FROM block WHERE page = ?")
		.bind(page)
		.all<{ name: string; value: string }>();
	const saved = new Map<string, Block[]>();
	for (const row of rows.results ?? []) {
		const value = parse(row.value);
		if (value) saved.set(row.name, value);
	}
	return saved;
}

export async function readText(db: D1Database, page: string, name: string) {
	const row = await db
		.prepare("SELECT value FROM block WHERE page = ? AND name = ?")
		.bind(page, name)
		.first<{ value: string }>();
	return row ? parse(row.value) : undefined;
}

export async function saveText(
	db: D1Database,
	page: string,
	name: string,
	value: Block[],
	by: string,
) {
	await db
		.prepare(
			`INSERT INTO block (page, name, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (page, name) DO UPDATE SET value = excluded.value,
			 updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
		)
		.bind(page, name, JSON.stringify(value), new Date().toISOString(), by)
		.run();
}

// A row that isn't a list of blocks shows the default text instead of failing the page.
function parse(json: string): Block[] | undefined {
	try {
		const value: unknown = JSON.parse(json);
		return Array.isArray(value) ? (value as Block[]) : undefined;
	} catch {
		console.error("stored text is not JSON");
		return undefined;
	}
}

// A page's field values (table `page_fields`, migrations/0002): one JSON
// object per page. Undefined until the customer saves the page's form.
export async function readPageFields(db: D1Database, page: string) {
	const row = await db
		.prepare("SELECT value FROM page_fields WHERE page = ?")
		.bind(page)
		.first<{ value: string }>();
	return row ? parseObject(row.value) : undefined;
}

export async function savePageFields(
	db: D1Database,
	page: string,
	value: Record<string, unknown>,
	by: string,
) {
	await db
		.prepare(
			`INSERT INTO page_fields (page, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
			 ON CONFLICT (page) DO UPDATE SET value = excluded.value,
			 updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
		)
		.bind(page, JSON.stringify(value), new Date().toISOString(), by)
		.run();
}

// A collection's item (table `item`, migrations/0002).
export type StoredItem = {
	id: string;
	slug: string;
	title: string;
	position: number;
	fields: Record<string, unknown>;
	published: boolean;
};

type ItemRow = Omit<StoredItem, "fields" | "published"> & { fields: string; published: number };

const toItem = (row: ItemRow): StoredItem => ({
	...row,
	fields: parseObject(row.fields) ?? {},
	published: row.published === 1,
});

// The page key of an item's texts in `block`. The id never changes, so a new
// slug keeps the texts.
export const itemPage = (collection: string, id: string) => `item:${collection}:${id}`;

const ITEM_COLUMNS = "id, slug, title, position, fields, published";

export async function listItems(
	db: D1Database,
	collection: string,
	options: { published?: boolean } = {},
): Promise<StoredItem[]> {
	const rows = await db
		.prepare(
			`SELECT ${ITEM_COLUMNS} FROM item WHERE collection = ?${options.published ? " AND published = 1" : ""}
			 ORDER BY position, slug`,
		)
		.bind(collection)
		.all<ItemRow>();
	return (rows.results ?? []).map(toItem);
}

export async function readItem(db: D1Database, collection: string, id: string) {
	const row = await db
		.prepare(`SELECT ${ITEM_COLUMNS} FROM item WHERE collection = ? AND id = ?`)
		.bind(collection, id)
		.first<ItemRow>();
	return row ? toItem(row) : undefined;
}

export async function readItemBySlug(db: D1Database, collection: string, slug: string) {
	const row = await db
		.prepare(`SELECT ${ITEM_COLUMNS} FROM item WHERE collection = ? AND slug = ?`)
		.bind(collection, slug)
		.first<ItemRow>();
	return row ? toItem(row) : undefined;
}

// A new item goes on top of the list, hidden until the customer shows it.
export async function createItem(
	db: D1Database,
	collection: string,
	item: { id: string; slug: string; title: string },
	by: string,
) {
	const top = await db
		.prepare("SELECT MIN(position) AS position FROM item WHERE collection = ?")
		.bind(collection)
		.first<{ position: number | null }>();
	await db
		.prepare(
			`INSERT INTO item (collection, id, slug, title, position, fields, published, updated_at, updated_by)
			 VALUES (?, ?, ?, ?, ?, '{}', 0, ?, ?)`,
		)
		.bind(
			collection,
			item.id,
			item.slug,
			item.title,
			(top?.position ?? 1) - 1,
			new Date().toISOString(),
			by,
		)
		.run();
}

export async function saveItem(
	db: D1Database,
	collection: string,
	id: string,
	item: { slug: string; title: string; fields: Record<string, unknown> },
	by: string,
) {
	await db
		.prepare(
			`UPDATE item SET slug = ?, title = ?, fields = ?, updated_at = ?, updated_by = ?
			 WHERE collection = ? AND id = ?`,
		)
		.bind(
			item.slug,
			item.title,
			JSON.stringify(item.fields),
			new Date().toISOString(),
			by,
			collection,
			id,
		)
		.run();
}

export async function setPublished(
	db: D1Database,
	collection: string,
	id: string,
	published: boolean,
	by: string,
) {
	await db
		.prepare(
			"UPDATE item SET published = ?, updated_at = ?, updated_by = ? WHERE collection = ? AND id = ?",
		)
		.bind(published ? 1 : 0, new Date().toISOString(), by, collection, id)
		.run();
}

// Moves an item one place up (-1) or down (1). Positions are renumbered
// 0..n-1 first, so seeded items with equal positions move too.
export async function moveItem(db: D1Database, collection: string, id: string, by: -1 | 1) {
	const items = await listItems(db, collection);
	const order = items.map((item) => item.id);
	const i = order.indexOf(id);
	const j = i + by;
	if (i < 0 || j < 0 || j >= order.length) return;
	[order[i], order[j]] = [order[j], order[i]];
	const positions = new Map(items.map((item) => [item.id, item.position]));
	for (const [position, itemId] of order.entries()) {
		if (positions.get(itemId) === position) continue;
		await db
			.prepare("UPDATE item SET position = ? WHERE collection = ? AND id = ?")
			.bind(position, collection, itemId)
			.run();
	}
}

// The item and its texts. Its images stay in R2, as a text's do.
export async function deleteItem(db: D1Database, collection: string, id: string) {
	await db.prepare("DELETE FROM block WHERE page = ?").bind(itemPage(collection, id)).run();
	await db.prepare("DELETE FROM item WHERE collection = ? AND id = ?").bind(collection, id).run();
}

function parseObject(json: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(json);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		console.error("stored fields are not JSON");
		return undefined;
	}
}
