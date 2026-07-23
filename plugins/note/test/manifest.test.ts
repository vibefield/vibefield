import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { PluginRegistry, safePreviewToCss } from "@vibefield/plugin-runtime";
import { describe, expect, it } from "vitest";
import { noteBindings, noteManifest } from "../src";

// The plugin contract in miniature, C1a edition: the CANONICAL manifest
// V1-validates at registration, declared types match provided bindings
// exactly, and the derived legacy view keeps tray consumers whole (preview
// CSS from SafePreview) until C1c converts them.
describe("plugin-note", () => {
  it("registers the canonical manifest and serves its declared widget types", () => {
    const registry = new PluginRegistry();
    const impls = Object.fromEntries(Object.keys(noteBindings).map((t) => [t, {}]));
    registry.registerV1(noteManifest, impls);
    expect(registry.hasWidget("note.card")).toBe(true);
    expect(registry.ownerOf("note.card")).toBe("note");
    expect([...registry.allWidgets().keys()]).toEqual(
      (noteManifest.contributes?.widgets ?? []).map((w) => w.type),
    );
    // tray silhouette CSS derives straight from the SafePreview (C1c)
    expect(safePreviewToCss(registry.plugin("note")?.v1.contributes?.widgets?.[0]?.preview)).toBe(
      "#f6e7a9",
    );
  });

  it("the committed vibefield.plugin.json is the canonical emission (regen: pnpm gen:manifest)", () => {
    const result = validatePluginManifest(noteManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
