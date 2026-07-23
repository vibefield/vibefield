import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { noteManifest, noteRenderer } from "../src";

// The plugin contract in miniature, P3a edition: the CANONICAL manifest
// V1-validates, ACTIVATION binds exactly the declared widget types (§12.1,
// proven against the SDK's mock host — no engine, no registry), and the
// committed artifact is the canonical emission. Host-side integration
// (prefab building, tray silhouettes) lives in field-app's own suites.
describe("plugin-note", () => {
  it("activation binds exactly the manifest's declared widget types", async () => {
    const declared = (noteManifest.contributes?.widgets ?? []).map((w) => w.type);
    const session = await activateWithMockHost(noteRenderer, {
      id: noteManifest.id,
      version: noteManifest.version,
      declaredWidgets: declared,
    });
    expect([...session.bindings.keys()]).toEqual(declared);
    for (const binding of session.bindings.values()) expect(binding.component).toBeDefined();
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
