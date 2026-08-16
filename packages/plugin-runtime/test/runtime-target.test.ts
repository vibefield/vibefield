import { describe, expect, it } from "vitest";
import {
  type BehaviorRuntimeTarget,
  projectPluginAuthority,
  type RendererRuntimeTarget,
  samePluginRuntimeObservation,
  samePluginRuntimeTarget,
} from "../src/index";

function renderer(over: Partial<RendererRuntimeTarget> = {}): RendererRuntimeTarget {
  return {
    face: "renderer",
    pluginId: "note",
    instanceKey: { windowId: "window-a" },
    artifact: {
      installRevision: "revision-a",
      manifestHash: `sha256:${"a".repeat(64)}`,
      approvedModuleGeneration: 3,
    },
    authorityFingerprint: "renderer:canvas.read",
    observedGrantGeneration: 7,
    ...over,
  };
}

describe("samePluginRuntimeTarget", () => {
  it("ignores a broad grant counter when projected authority is unchanged", () => {
    expect(samePluginRuntimeTarget(renderer(), renderer({ observedGrantGeneration: 8 }))).toBe(
      true,
    );
    expect(samePluginRuntimeObservation(renderer(), renderer({ observedGrantGeneration: 8 }))).toBe(
      false,
    );
  });

  it("projects canonical per-entry authority from the contracts eligibility table", () => {
    const grants = [
      "process.spawn",
      "terminal.attach",
      "canvas.read",
      "x.com.example.provider.consume",
      "canvas.read",
      "plugins.manage",
    ];
    const rendererProjection = projectPluginAuthority("renderer", grants);
    const reordered = projectPluginAuthority("renderer", [...grants].reverse());
    expect(rendererProjection).toEqual({
      capabilities: ["canvas.read", "terminal.attach", "x.com.example.provider.consume"],
      fingerprint: JSON.stringify([
        "v1",
        "renderer",
        ["canvas.read", "terminal.attach", "x.com.example.provider.consume"],
      ]),
    });
    expect(reordered.fingerprint).toBe(rendererProjection.fingerprint);
    expect(projectPluginAuthority("service", grants).capabilities).toEqual([
      "canvas.read",
      "process.spawn",
      "x.com.example.provider.consume",
    ]);
    expect(projectPluginAuthority("behavior", grants).capabilities).toEqual([
      "canvas.read",
      "terminal.attach",
      "x.com.example.provider.consume",
    ]);
  });

  it("changes for authority, artifact, instance, and runtime generations", () => {
    const target = renderer();
    expect(
      samePluginRuntimeTarget(target, renderer({ authorityFingerprint: "renderer:canvas.write" })),
    ).toBe(false);
    expect(
      samePluginRuntimeTarget(
        target,
        renderer({ artifact: { ...target.artifact, installRevision: "revision-b" } }),
      ),
    ).toBe(false);
    expect(
      samePluginRuntimeTarget(target, renderer({ instanceKey: { windowId: "window-b" } })),
    ).toBe(false);
    expect(samePluginRuntimeTarget(target, renderer({ runtimeGeneration: "engine-2" }))).toBe(
      false,
    );
  });

  it("compares every behavior identity field without concatenating keys", () => {
    const target: BehaviorRuntimeTarget = {
      face: "behavior",
      pluginId: "layout",
      instanceKey: {
        windowId: "window-a",
        documentId: "document-a",
        behaviorDeclarationId: "layout.graph",
      },
      artifact: {
        installRevision: "revision-a",
        manifestHash: `sha256:${"b".repeat(64)}`,
      },
      authorityFingerprint: "behavior:canvas.read",
      observedGrantGeneration: 2,
      runtimeGeneration: "engine-1",
    };
    expect(samePluginRuntimeTarget(target, { ...target })).toBe(true);
    expect(
      samePluginRuntimeTarget(target, {
        ...target,
        instanceKey: { ...target.instanceKey, documentId: "document-b" },
      }),
    ).toBe(false);
    expect(samePluginRuntimeTarget(target, renderer())).toBe(false);
    expect(samePluginRuntimeTarget(null, null)).toBe(true);
  });
});
