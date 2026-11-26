// Puts the admin's browser bundle (dist/client, from `vite build`) in
// dist/assets.js as strings, so a site's Worker serves it without a build
// step of its own. Runs after tsc in `pnpm build`.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const js = readFileSync("dist/client/admin.js", "utf8");
const css = readFileSync("dist/client/admin.css", "utf8");
const hash = createHash("sha256").update(js).update(css).digest("hex").slice(0, 10);

writeFileSync(
	"dist/assets.js",
	`export const adminJs = ${JSON.stringify(js)};\nexport const adminCss = ${JSON.stringify(css)};\nexport const hash = ${JSON.stringify(hash)};\n`,
);
writeFileSync("dist/assets.d.ts", readFileSync("src/assets.d.ts", "utf8"));
console.log(`dist/assets.js: admin ${hash}, ${Math.round((js.length + css.length) / 1024)} kB`);
