import type { PluginManifestV1 } from "@vibefield/contracts";

// The field tools (Track D3): organizational actors — not demos. Containers
// are the product's workstream primitive (design-00 §3.3); comments are the
// UE-Blueprint spatial grouping. Plugin id "field" stays the dev alias until
// C2 ratifies vibefield.field-tools (P-2: the TYPE strings are forever —
// they live in boards).
//
// C1b — canonical V1: the retired defineWidget calls verbatim. Folder is the
// one CONTAINER (accepts/provides reparent via ChildOf); the comment is NOT a
// container — sweepContained makes membership SPATIAL (a move claims what's
// fully inside; drag-out is just leaving). Both provide "widget" so they file
// into accepting folders.

export const fieldToolsManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: "field",
  version: "0.1.0",
  title: "Field tools",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: ["onWidget:field.folder", "onWidget:field.comment"],
  capabilities: [], // pure-canvas plugin: no fabric access
  contributes: {
    widgets: [
      {
        type: "field.folder",
        title: "Folder",
        description: "A container — drop cards in, double-click to enter",
        category: "Tools",
        preview: { kind: "color", value: "#1D1D2B" }, // FOLDER_BG (folder.tsx keeps the live constant)
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 329, h: 345 },
        interaction: {
          selectable: true,
          movable: true,
          resizable: false,
          snap: "both",
          dragOn: "press",
        },
        // Folders are widgets too (2026-07-17): container.provides lets a
        // folder file into another folder — nesting was engine-supported all
        // along, only the missing Provides blocked the match.
        container: { accepts: ["widget"], provides: ["widget"] },
        props: {
          title: { kind: "string", default: "Folder" },
          accent: { kind: "string", default: "#7B96FF" },
        },
        groups: {},
      },
      {
        type: "field.comment",
        title: "Comment",
        description: "Wrap widgets in a tinted group — C wraps the selection",
        category: "Tools",
        // the comment's translucent indigo tint (its real body) — minis and
        // tray tiles read as "a comment", not a blank card
        preview: {
          kind: "gradient",
          value: "linear-gradient(135deg, rgba(99, 102, 241, 0.45), rgba(99, 102, 241, 0.18))",
        },
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 400, h: 300 },
        interaction: {
          selectable: true,
          movable: true,
          resizable: true,
          snap: "target",
          dragOn: "press",
          sweepContained: true,
        },
        // Comments are widgets too (2026-07-18): provides lets a comment (and
        // its swept group) FILE INTO an accepting folder.
        provides: ["widget"],
        props: {
          title: { kind: "string", default: "Comment" },
          color: { kind: "string", default: "#6366F1" },
        },
        groups: {},
      },
    ],
  },
};
