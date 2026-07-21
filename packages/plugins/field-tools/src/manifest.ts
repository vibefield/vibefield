import type { PluginManifest } from "@vibefield/plugin-runtime";

// The field tools (Track D3): organizational actors — not demos. Containers
// are the product's workstream primitive (design-00 §3.3); comments are the
// UE-Blueprint spatial grouping. Plugin id "field" → types field.folder /
// field.comment (P-2: ids are forever).

export const fieldToolsManifest: PluginManifest = {
  id: "field",
  version: "0.1.0",
  title: "Field tools",
  widgets: [
    {
      type: "field.folder",
      title: "Folder",
      defaultSize: { w: 329, h: 345 },
      description: "A container — drop cards in, double-click to enter",
      category: "Tools",
      preview: "#1D1D2B", // FOLDER_BG (folder.tsx keeps the live constant)
    },
    {
      type: "field.comment",
      title: "Comment",
      defaultSize: { w: 400, h: 300 },
      description: "Wrap widgets in a tinted group — C wraps the selection",
      category: "Tools",
      // the comment's translucent indigo tint (its real body) — minis and tray
      // tiles read as "a comment", not a blank card (widgetlab preview.ts)
      preview: "linear-gradient(135deg, rgba(99, 102, 241, 0.45), rgba(99, 102, 241, 0.18))",
    },
  ],
  scopes: [], // pure-canvas plugin: no fabric access
};
