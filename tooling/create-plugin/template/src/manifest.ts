import type { PluginManifestV1 } from "@vibefield/contracts";

// The CANONICAL manifest (plugin spec §7.1): the durable contract, from which
// the host reconstructs the prefab (§12.2). This file is the ONLY writer of
// `vibefield.plugin.json` — edit here, then run `pnpm gen:manifest`. Hand-edit
// the JSON and `pnpm plugin check` refuses it with `manifest-stale`.
//
// The declaration is durable in the strongest sense: the canvas stores documents
// against `type` and against each prop NAME, so those outlive any particular
// implementation of this widget. Everything else here can change freely.
//
// Note the import: `import type`. This file is imported by plain Node during
// scaffolding (before any dependency is installed), which type stripping allows
// only while every import is erasable. A value import here is legal TypeScript
// and would still be fine for the plugin — it just moves manifest emit behind an
// install.

export const manifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: "{{id}}",
  version: "0.1.0",
  title: "{{title}}",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: ["onWidget:{{widgetType}}"],
  capabilities: [], // a pure-canvas plugin asks for nothing
  contributes: {
    widgets: [
      {
        type: "{{widgetType}}",
        title: "{{title}}",
        description: "A scaffolded card — edit src/renderer.tsx to make it yours",
        category: "Cards",
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 260, h: 180 },
        minSize: { w: 120, h: 80 },
        interaction: { selectable: true, movable: true, resizable: true, snap: "target" },
        provides: ["widget"],
        props: {
          text: { kind: "string", default: "", maxLength: 4000 },
        },
        groups: {}, // group-less: every prop rides the default `props` component
      },
    ],
  },
};
