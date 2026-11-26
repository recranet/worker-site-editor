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
