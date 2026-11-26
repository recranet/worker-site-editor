// The admin's browser entry. A site's admin bundle (built by the site's Vite)
// imports it with its blocks' editors:
//
//   import "@recranet/worker-site-editor/admin.css";
//   import { mountAdmin } from "@recranet/worker-site-editor/admin";
//   mountAdmin({ editors: [heroEditor] });
export { mountAdmin } from "./admin.tsx";
export { defineBlockEditor, type BlockEditor, type BlockFields } from "./block-editor.ts";
export type { ImageValue } from "../fields.ts";
