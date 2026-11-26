import { defineConfig } from "vite";

// The admin's browser bundle: React, Base UI and the Portable Text editor.
// scripts/embed-client.ts puts the output in dist/assets.js as strings.
export default defineConfig({
	build: {
		outDir: "dist/client",
		emptyOutDir: true,
		// About 850 kB: the admin only, public pages load none of it.
		chunkSizeWarningLimit: 1000,
		cssCodeSplit: false,
		rolldownOptions: {
			// Base UI marks its modules "use client", which means nothing here.
			onwarn(warning, warn) {
				if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
			},
			input: "src/client/main.ts",
			output: {
				// One file: the Worker serves it as one string.
				codeSplitting: false,
				entryFileNames: "admin.js",
				assetFileNames: "admin[extname]",
			},
		},
	},
});
