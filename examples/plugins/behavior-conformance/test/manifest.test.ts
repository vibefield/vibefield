import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { behaviorConformanceManifest, behaviorConformanceRenderer } from "../src";

describe("vibefield.behavior-conformance", () => {
  it("binds its exact widget and signed behavior declarations through the SDK mock host", async () => {
    const widgets = (behaviorConformanceManifest.contributes?.widgets ?? []).map((row) => row.type);
    const behaviors = behaviorConformanceManifest.contributes?.behaviors ?? [];
    const activation = await activateWithMockHost(behaviorConformanceRenderer, {
      id: behaviorConformanceManifest.id,
      version: behaviorConformanceManifest.version,
      declaredWidgets: widgets,
      declaredBehaviors: behaviors,
    });

    expect([...activation.bindings.keys()]).toEqual(widgets);
    expect([...activation.behaviors.keys()]).toEqual(behaviors.map((row) => row.id));
    await activation.close();
  });

  it("keeps the committed manifest byte-identical to its validated canonical emission", () => {
    const result = validatePluginManifest(behaviorConformanceManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
