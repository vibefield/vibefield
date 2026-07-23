import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { fieldToolsManifest, fieldToolsRenderer } from "../src";

// C1b/P3a: the canonical manifest V1-validates; container and sweepContained
// ride as DATA on the manifest itself (no registry round-trip needed);
// ACTIVATION binds exactly the declared widget types (§12.1, proven against
// the SDK's mock host — no engine, no registry). Host-side integration
// (prefab building, tray silhouettes) lives in field-app's own suites.
describe("plugin-field-tools", () => {
  it("activation binds exactly the manifest's declared widget types", async () => {
    const declared = (fieldToolsManifest.contributes?.widgets ?? []).map((w) => w.type);
    const session = await activateWithMockHost(fieldToolsRenderer, {
      id: fieldToolsManifest.id,
      version: fieldToolsManifest.version,
      declaredWidgets: declared,
    });
    expect([...session.bindings.keys()]).toEqual(declared);
    for (const binding of session.bindings.values()) expect(binding.component).toBeDefined();
  });

  it("folder is the one container; comment's membership is spatial (sweepContained)", () => {
    const widgets = fieldToolsManifest.contributes?.widgets ?? [];
    expect(widgets.find((w) => w.type === "vibefield.field-tools.folder")?.container).toEqual({
      accepts: ["widget"],
      provides: ["widget"],
    });
    expect(
      widgets.find((w) => w.type === "vibefield.field-tools.comment")?.interaction?.sweepContained,
    ).toBe(true);
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
