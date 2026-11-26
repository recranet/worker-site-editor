// Extension blocks and text styles: examples of the extension API that a site
// can register as they are. Each block is one defineBlock (fields and render);
// some also have their own editor UI in "@recranet/worker-site-editor/extensions/admin".
//
//   import { hero, quote } from "@recranet/worker-site-editor/extensions";
//   createEditor({ blocks: [hero, quote], … });
export { accordion } from "./blocks/accordion.tsx";
export { cards } from "./blocks/cards.tsx";
export { checklist } from "./blocks/checklist.tsx";
export { cta } from "./blocks/cta.tsx";
export { feature } from "./blocks/feature.tsx";
export { features } from "./blocks/features.tsx";
export { hero } from "./blocks/hero.tsx";
export { labels } from "./blocks/labels.tsx";
export { map } from "./blocks/map.tsx";
export { marquee } from "./blocks/marquee.tsx";
export { quote } from "./blocks/quote.tsx";
export { stats } from "./blocks/stats.tsx";
export { button, footnote, highlight, lead } from "./text-styles.ts";
