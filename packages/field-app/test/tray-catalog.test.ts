import type { PluginManifestV1 } from "@vibefield/contracts";
import { PluginRegistry } from "@vibefield/plugin-runtime";
import { describe, expect, it } from "vitest";
import { buildCatalog, CATEGORIES } from "../src/hud/tray-catalog";

// buildCatalog is the old Objects sheet's tile list, a pure derivation over a live
// PluginRegistry (no ICE, no DOM). Its tiles were the plugins' WIDGET rows; DK-8 retired
// `contributes.widgets`, and the rows a registry carries now are OBJECTS — which hang on the
// desk's pegboard, drawn by their own kinds, never as tiles here. The pegboard behind the
// line's ⊕ replaces the sheet and this module at DK-13. (The rows this file held — the widget
// join, its category and SafePreview silhouette, and the `gl → 3D` fallback DK-2 left red for
// DK-13 — retired with the widget rows they joined.)

const objectManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: "fake",
  version: "0.0.0",
  title: "Fake",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [],
  capabilities: [],
  contributes: {
    objects: [
      {
        type: "fake.pad",
        title: "Fake pad",
        schemaVersion: 1,
        size: { w: 220, h: 280 },
        provides: ["fake.pad", "desk.object"],
        props: {},
        groups: {},
        tray: {
          category: "comments",
          label: "Fake pad",
          hang: { w: 110, h: 140, accessory: "hook", pegs: [[0, -0.5]] },
        },
        binding: { kind: "pad" },
      },
    ],
  },
};

describe("buildCatalog (the old Objects sheet, until DK-13)", () => {
  it("lists no tile for an object row — an object hangs on the pegboard, not in the sheet", () => {
    const registry = new PluginRegistry<string>();
    registry.registerV1(objectManifest, { "fake.pad": "kind" });
    expect(registry.plugin("fake")?.objectContributions).toHaveLength(1);
    expect(buildCatalog(registry)).toEqual([]);
  });

  it("keeps the sheet's shelves until the sheet itself goes", () => {
    expect(CATEGORIES).toEqual(["All", "Cards", "3D", "Nodes", "Tools"]);
  });
});
