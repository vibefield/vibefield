import { describe, expect, it } from "vitest";
import {
  PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS,
  PluginRuntimeControllerDiagnostic,
  PluginRuntimeDiagnosticsSnapshot,
  PluginRuntimeReportParams,
  PluginRuntimeScopeDiagnostic,
} from "../src/plugin-diagnostics";

function target(pluginId: string, face: "renderer" | "service" = "renderer") {
  const base = {
    pluginId,
    artifact: { installRevision: "revision-1", manifestHash: "sha256:artifact-1" },
    authorityFingerprint: "[]",
    observedGrantGeneration: 0,
  } as const;
  return face === "renderer"
    ? { ...base, face, instanceKey: { windowId: "field" } }
    : { ...base, face, instanceKey: { deviceId: "device-a" } };
}

function controller(pluginId: string, face: "renderer" | "service" = "renderer") {
  const current = target(pluginId, face);
  return PluginRuntimeControllerDiagnostic.parse({
    label: `${face}:${pluginId}`,
    state: "active",
    desired: current,
    committed: current,
    desiredRevision: 1,
    blocked: null,
    scope: null,
    lastClose: null,
    force: { confirmedCount: 0, last: null },
    history: [],
    omittedHistory: 0,
  });
}

describe("PRC-6b runtime diagnostics contracts", () => {
  it("keeps renderer identity out of the report body and pins every target to its plugin/face", () => {
    const report = {
      pluginId: "com.example.diagnostics",
      sequence: 1,
      controller: controller("com.example.diagnostics"),
    };
    expect(PluginRuntimeReportParams.safeParse(report).success).toBe(true);
    expect(
      PluginRuntimeReportParams.safeParse({ ...report, participantId: "renderer:forged" }).success,
    ).toBe(false);
    expect(
      PluginRuntimeReportParams.safeParse({
        ...report,
        controller: controller("com.example.diagnostics", "service"),
      }).success,
    ).toBe(false);
    expect(
      PluginRuntimeReportParams.safeParse({
        ...report,
        controller: controller("com.example.someone-else"),
      }).success,
    ).toBe(false);
  });

  it("requires effect parents to precede children and ids to remain unique", () => {
    const base = {
      label: "renderer-scope",
      state: "open",
      quiescent: false,
      liveCount: 2,
      pendingSetups: 0,
      lateCleanups: 0,
      stats: { acquired: 2, disposed: 0, disposeErrors: 0, lateArrivals: 0 },
      errors: [],
      omittedErrors: 0,
      omittedEffects: 0,
    } as const;
    expect(
      PluginRuntimeScopeDiagnostic.safeParse({
        ...base,
        effects: [
          { id: 1, parentId: null, label: "parent", kind: "scope", status: "live" },
          { id: 2, parentId: 1, label: "child", kind: "resource", status: "live" },
        ],
      }).success,
    ).toBe(true);
    expect(
      PluginRuntimeScopeDiagnostic.safeParse({
        ...base,
        effects: [
          { id: 2, parentId: 1, label: "child", kind: "resource", status: "live" },
          { id: 1, parentId: null, label: "parent", kind: "scope", status: "live" },
        ],
      }).success,
    ).toBe(false);
  });

  it("enforces one global controller budget across every plugin row", () => {
    const plugins = Array.from(
      { length: PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.CONTROLLERS + 1 },
      (_, index) => {
        const pluginId = `com.example.runtime-${index}`;
        return {
          pluginId,
          registry: {
            state: "enabled",
            installRevision: "revision-1",
            manifestHash: "sha256:artifact-1",
            grantGeneration: 0,
            renderer: "active",
            service: "active",
          },
          commitEpoch: null,
          serviceController: controller(pluginId, "service"),
          serviceControllerOmitted: false,
          renderers: [],
          omittedRenderers: 0,
          update: null,
          issues: [],
          omittedIssues: 0,
        };
      },
    );

    expect(
      PluginRuntimeDiagnosticsSnapshot.safeParse({
        version: 1,
        generation: 1,
        capturedAt: 1,
        plugins,
        omittedPlugins: 0,
        omittedControllers: 0,
      }).success,
    ).toBe(false);
  });
});
