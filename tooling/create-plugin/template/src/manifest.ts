import type { PluginManifestV1 } from "@vibefield/contracts";

// The CANONICAL manifest (plugin spec §7.1): the durable contract, from which
// the host reconstructs the object (§12.2). This file is the ONLY writer of
// `vibefield.plugin.json` — edit here, then run `pnpm gen:manifest`. Hand-edit
// the JSON and `pnpm plugin check` refuses it with `manifest-stale`.
//
// The declaration is durable in the strongest sense: the desk stores documents
// against `type` and against each prop NAME, so those outlive any particular
// implementation of this object. Everything else here can change freely — the
// kind that draws it (src/kind.ts) most of all.
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
  activation: ["onObject:{{objectType}}"],
  capabilities: [], // a kind draws what it is handed; it asks for nothing
  contributes: {
    objects: [
      {
        type: "{{objectType}}",
        title: "{{title}}",
        description: "A scaffolded object kind — edit src/kind.ts and src/shaders.wgsl to make it yours",
        schemaVersion: 1,
        size: { w: 120, h: 120 }, // what a new one spawns at, world units
        interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
        // what the desk PLACES BY — `desk.object` lies on the desk; add `desk.containable` (and a
        // `chip` in src/kind.ts) to let a mini mat hold it
        provides: ["{{objectType}}", "desk.object"],
        props: {
          color: { kind: "string", default: "#e4c46a", maxLength: 32 },
        },
        groups: {}, // group-less: every prop rides the default `props` component
        // the pegboard hangs it on a hook among the desk's things, drawn by the kind itself
        tray: {
          category: "things",
          label: "{{title}}",
          hang: { w: 96, h: 96, accessory: "hook", pegs: [[0, -0.5]] },
        },
        binding: { kind: "{{className}}" }, // the renderer module's export that draws it
      },
    ],
  },
};
