// The admin side of the extension blocks: their own editor UI. A site
// registers an editor next to its block, in its admin entry:
//
//   import { mountAdmin } from "@recranet/worker-site-editor/admin";
//   import { heroEditor, labelsEditor } from "@recranet/worker-site-editor/extensions/admin";
//   mountAdmin({ editors: [heroEditor, labelsEditor] });
//
// Blocks without one get the form generated from their fields.
export { heroEditor } from "./hero.tsx";
export { labelsEditor } from "./labels.tsx";
