import { defineConfig } from "vitest/config";

// Tests run in Node: D1 is node:sqlite with the package's migration
// (test/d1.ts), the provider a fetch mock (test/provider.ts).
export default defineConfig({
	oxc: { jsx: { runtime: "automatic", importSource: "hono/jsx" } },
	test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"] },
});
