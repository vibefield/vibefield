import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { PluginRegistry, safePreviewToCss } from "@vibefield/plugin-runtime";
import { describe, expect, it } from "vitest";
import { widgetlabBindings, widgetlabManifest } from "../src";

// C1b·2: the canonical manifest V1-validates at registration; node ports ride
// as DATA; the derived legacy view keeps tray/mini silhouettes whole (a color,
// a gradient) until C1c converts the consumers.
describe("plugin-widgetlab", () => {
  it("registers the canonical manifest and serves all declared widget types", () => {
    const registry = new PluginRegistry();
    const impls = Object.fromEntries(Object.keys(widgetlabBindings).map((t) => [t, {}]));
    registry.registerV1(widgetlabManifest, impls);
    expect(widgetlabManifest.contributes?.widgets).toHaveLength(18); // 8 cards + 7 GL + 3 nodes
    expect([...registry.allWidgets().keys()].sort()).toEqual(
      (widgetlabManifest.contributes?.widgets ?? []).map((w) => w.type).sort(),
    );
    expect(registry.ownerOf("widgetlab.clock")).toBe("widgetlab");

    // node ports survive to v1 (the wire-editor trio's whole reason for being)
    const widgets = registry.plugin("widgetlab")?.v1.contributes?.widgets ?? [];
    expect(widgets.find((w) => w.type === "widgetlab.filter")?.ports).toEqual([
      { id: "in", side: "w", accepts: ["signal"] },
      { id: "out", side: "e", accepts: ["signal"] },
    ]);

    // silhouette CSS derives straight from the SafePreview (C1c)
    expect(safePreviewToCss(widgets.find((w) => w.type === "widgetlab.calendar")?.preview)).toBe(
      "#ffffff",
    );
    expect(
      safePreviewToCss(widgets.find((w) => w.type === "widgetlab.weather")?.preview),
    ).toContain("linear-gradient");
  });

  it("the committed vibefield.plugin.json is the canonical emission (regen: pnpm gen:manifest)", () => {
    const result = validatePluginManifest(widgetlabManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
