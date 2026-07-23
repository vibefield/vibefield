import { PluginRegistry } from "@vibefield/plugin-runtime";
import { describe, expect, it } from "vitest";
import { fieldToolsManifest, fieldToolsWidgets } from "../src";

// The plugin contract in miniature (note plugin's test pattern): declared
// widget types and provided implementations must match exactly.
describe("plugin-field-tools", () => {
  it("registers cleanly and serves its declared widget types", () => {
    const registry = new PluginRegistry();
    registry.register(fieldToolsManifest, fieldToolsWidgets);
    expect(registry.hasWidget("field.folder")).toBe(true);
    expect(registry.hasWidget("field.comment")).toBe(true);
    expect([...registry.allWidgets().keys()].sort()).toEqual(
      fieldToolsManifest.widgets.map((w) => w.type).sort(),
    );
  });
});
