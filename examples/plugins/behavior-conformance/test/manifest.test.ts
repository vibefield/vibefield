import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  behaviorConformanceCard,
  behaviorConformanceManifest,
  behaviorConformanceRenderer,
} from "../src";
import * as rendererModule from "../src/renderer";

describe("vibefield.behavior-conformance", () => {
  it("binds its signed behavior declarations through the SDK mock host, and no widget", async () => {
    const behaviors = behaviorConformanceManifest.contributes?.behaviors ?? [];
    const activation = await activateWithMockHost(behaviorConformanceRenderer, {
      id: behaviorConformanceManifest.id,
      version: behaviorConformanceManifest.version,
      declaredWidgets: [],
      declaredBehaviors: behaviors,
    });

    expect([...activation.bindings.keys()]).toEqual([]);
    expect([...activation.behaviors.keys()]).toEqual(behaviors.map((row) => row.id));
    await activation.close();
  });

  it("carries its riders on an OBJECT row whose kind is the module's own export (DK-4)", () => {
    const objects = behaviorConformanceManifest.contributes?.objects ?? [];
    expect(behaviorConformanceManifest.contributes?.widgets).toBeUndefined();
    expect(objects.map((row) => [row.type, row.binding.kind, row.provides])).toEqual([
      ["vibefield.behavior-conformance.card", "card", ["desk.object"]],
    ]);
    // the host reads a row's kind off the module's NAMESPACE by its binding name (spec §12.8)
    const namespace = rendererModule as unknown as Record<string, { kind?: { name?: unknown } }>;
    expect(namespace[objects[0]?.binding.kind ?? ""]?.kind?.name).toBe(objects[0]?.type);
  });

  it("DK-6 — its kind's create makes a REAL pass that draws nothing: no fault, no missing face", async () => {
    // the pass touches no device: the carrier has nothing to compile or upload
    const pass = await behaviorConformanceCard.kind.create({} as never, "bgra8unorm", {} as never);
    expect(pass.prepare({} as never, {} as never, [{}, {}])).toBe(0);
    expect(() => pass.drawRange({} as never, 0, 2)).not.toThrow();
    expect(pass.spawn({} as never)).toBe(pass);
    pass.dispose();
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
