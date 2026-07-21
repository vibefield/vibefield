import { PluginRegistry } from "@vibefield/plugin-runtime";
import { describe, expect, it } from "vitest";
import { widgetlabManifest, widgetlabWidgets } from "../src";

// The plugin contract in miniature (note plugin's test pattern): declared
// widget types and provided implementations must match exactly.
describe("plugin-widgetlab", () => {
  it("registers cleanly and serves all declared widget types", () => {
    const registry = new PluginRegistry();
    registry.register(widgetlabManifest, widgetlabWidgets);
    expect(widgetlabManifest.widgets).toHaveLength(18); // 8 cards + 7 GL + 3 nodes
    expect([...registry.allWidgets().keys()].sort()).toEqual(
      widgetlabManifest.widgets.map((w) => w.type).sort(),
    );
  });
});
