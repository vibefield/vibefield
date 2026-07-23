import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
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
    expect(registry.hasWidget("vibefield.field-tools.folder")).toBe(true);
    expect(registry.hasWidget("vibefield.field-tools.comment")).toBe(true);
    expect(registry.ownerOf("vibefield.field-tools.folder")).toBe("vibefield.field-tools");
    const widgets = registry.plugin("vibefield.field-tools")?.v1.contributes?.widgets ?? [];
    expect(widgets.find((w) => w.type === "vibefield.field-tools.folder")?.container).toEqual({
      accepts: ["widget"],
      provides: ["widget"],
    });
    expect(
      widgets.find((w) => w.type === "vibefield.field-tools.comment")?.interaction?.sweepContained,
    ).toBe(true);
    // silhouette CSS derives straight from the SafePreview (C1c)
    expect(
      safePreviewToCss(widgets.find((w) => w.type === "vibefield.field-tools.folder")?.preview),
    ).toBe("#1D1D2B");
    expect(
      safePreviewToCss(widgets.find((w) => w.type === "vibefield.field-tools.comment")?.preview),
    ).toContain("linear-gradient");
  });

  it("the committed vibefield.plugin.json is the canonical emission (regen: pnpm gen:manifest)", () => {
    const result = validatePluginManifest(fieldToolsManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
