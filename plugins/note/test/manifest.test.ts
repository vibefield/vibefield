import { PluginRegistry } from "@vibefield/plugin-runtime";
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
    // the derived legacy view: tray silhouette CSS survives the V1 conversion
    expect(registry.plugin("note")?.manifest.widgets[0]?.preview).toBe("#f6e7a9");
  });
});
