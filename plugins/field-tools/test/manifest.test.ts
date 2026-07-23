import { PluginRegistry, safePreviewToCss } from "@vibefield/plugin-runtime";
import { describe, expect, it } from "vitest";
import { fieldToolsBindings, fieldToolsManifest } from "../src";

// C1b: the canonical manifest V1-validates at registration; container and
// sweepContained ride as DATA; the derived legacy view keeps tray/mini
// silhouettes whole (folder color, comment gradient) until C1c.
describe("plugin-field-tools", () => {
  it("registers the canonical manifest and serves both tools", () => {
    const registry = new PluginRegistry();
    const impls = Object.fromEntries(Object.keys(fieldToolsBindings).map((t) => [t, {}]));
    registry.registerV1(fieldToolsManifest, impls);
    expect(registry.hasWidget("field.folder")).toBe(true);
    expect(registry.hasWidget("field.comment")).toBe(true);
    expect(registry.ownerOf("field.folder")).toBe("field");
    const widgets = registry.plugin("field")?.v1.contributes?.widgets ?? [];
    expect(widgets.find((w) => w.type === "field.folder")?.container).toEqual({
      accepts: ["widget"],
      provides: ["widget"],
    });
    expect(widgets.find((w) => w.type === "field.comment")?.interaction?.sweepContained).toBe(true);
    // silhouette CSS derives straight from the SafePreview (C1c)
    expect(safePreviewToCss(widgets.find((w) => w.type === "field.folder")?.preview)).toBe(
      "#1D1D2B",
    );
    expect(safePreviewToCss(widgets.find((w) => w.type === "field.comment")?.preview)).toContain(
      "linear-gradient",
    );
  });
});
