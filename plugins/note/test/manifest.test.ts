import { PluginRegistry } from "@vibefield/plugin-runtime";
import { describe, expect, it } from "vitest";
import { noteManifest, noteWidgets } from "../src";

// The plugin contract in miniature: declared widget types and provided
// implementations must match exactly (registry-enforced at register time).
describe("plugin-note", () => {
  it("registers cleanly and serves its declared widget types", () => {
    const registry = new PluginRegistry();
    registry.register(noteManifest, noteWidgets);
    expect(registry.hasWidget("note.card")).toBe(true);
    expect([...registry.allWidgets().keys()]).toEqual(noteManifest.widgets.map((w) => w.type));
  });
});
