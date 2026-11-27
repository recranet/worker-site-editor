import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Just enough of D1 for the package (prepare, bind, all, first, run) on an
// in-memory SQLite with the package's migrations, in order.
export function testD1(): D1Database {
	const sqlite = new DatabaseSync(":memory:");
	const dir = join(import.meta.dirname, "../migrations");
	for (const file of readdirSync(dir).sort()) sqlite.exec(readFileSync(join(dir, file), "utf8"));
	const prepare = (sql: string) => {
		let params: unknown[] = [];
		const stmt = {
			bind(...values: unknown[]) {
				params = values;
				return stmt;
			},
			async all() {
				return { results: sqlite.prepare(sql).all(...(params as never[])), success: true };
			},
			async first() {
				return sqlite.prepare(sql).get(...(params as never[])) ?? null;
			},
			async run() {
				sqlite.prepare(sql).run(...(params as never[]));
				return { success: true };
			},
		};
		return stmt;
	};
	// Several statements at once, as a seed file holds.
	const exec = async (sql: string) => {
		sqlite.exec(sql);
		return { count: 0, duration: 0 };
	};
	return { prepare, exec } as unknown as D1Database;
}

// A small R2 stand-in: put and get by name.
export function testR2(): R2Bucket & { objects: Map<string, { body: Uint8Array; type: string }> } {
	const objects = new Map<string, { body: Uint8Array; type: string }>();
	return {
		objects,
		async put(
			name: string,
			body: ReadableStream,
			options: { httpMetadata: { contentType: string } },
		) {
			const bytes = new Uint8Array(await new Response(body).arrayBuffer());
			objects.set(name, { body: bytes, type: options.httpMetadata.contentType });
			return {};
		},
		async get(name: string) {
			const o = objects.get(name);
			if (!o) return null;
			return {
				body: new Response(o.body).body,
				httpEtag: '"etag"',
				writeHttpMetadata: (h: Headers) => h.set("content-type", o.type),
			};
		},
	} as never;
}
