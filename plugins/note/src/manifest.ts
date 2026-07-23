import type { PluginManifestV1 } from "@vibefield/contracts";

// C1a — the first CANONICAL manifest (plugin spec §7.1): the full durable
// contract, from which the host reconstructs the prefab (§12.2). Values are
// the retired defineWidget call verbatim (2026-07-23 inventory). id RATIFIED
// at C2 (2026-07-23): vibefield.note — forever, it lives in boards (§21.2);
// entries.renderer names the artifact P2 packaging makes real.

export const noteManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: "vibefield.note",
  version: "0.1.0",
  title: "Notes",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: ["onWidget:vibefield.note"],
  capabilities: [], // pure-canvas plugin: no fabric access
  contributes: {
    widgets: [
      {
        type: "vibefield.note",
        title: "Note",
        description: "A sticky note — double-click to edit",
        category: "Cards",
        preview: { kind: "color", value: "#f6e7a9" }, // the sticky surface
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 260, h: 180 },
        minSize: { w: 120, h: 80 },
        interaction: { selectable: true, movable: true, resizable: true, snap: "target" },
        provides: ["widget"],
        props: {
          text: { kind: "string", default: "" },
          color: { kind: "string", default: "#f6e7a9" },
        },
        groups: {}, // group-less: everything rides the `vibefield.note:props` component
      },
    ],
  },
};
