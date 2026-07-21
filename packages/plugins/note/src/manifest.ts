import type { PluginManifest } from "@vibefield/plugin-runtime";

export const noteManifest: PluginManifest = {
  id: "note",
  version: "0.1.0",
  title: "Notes",
  widgets: [
    {
      type: "note.card",
      title: "Note",
      defaultSize: { w: 260, h: 180 },
      description: "A sticky note — double-click to edit",
    },
  ],
  scopes: [], // pure-canvas plugin: no fabric access
};
