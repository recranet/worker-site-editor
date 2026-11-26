import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Tests run in Node: D1 is node:sqlite with the package's migration
// (test/d1.ts), the provider a fetch mock (test/provider.ts), and the admin
// bundle a stub, so they need no build.
export default defineConfig({
	oxc: { jsx: { runtime: "automatic", importSource: "hono/jsx" } },
	resolve: {
		alias: [
			{
				find: /^\.\/assets\.js$/,
				replacement: join(import.meta.dirname, "test/assets-stub.ts"),
			},
		],
	},
	test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"] },
});
