// @vitest-environment happy-dom

import {
  PluginRecord,
  PluginRuntimeControllerDiagnostic,
  PluginRuntimeDiagnosticsSnapshot,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginsSection } from "../src/panels/PluginsSection";
import { setPluginRegistrySnapshot } from "../src/plugin-host/plugin-registry-store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLUGIN_ID = "com.example.runtime-ui";
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function controller() {
  const target = {
    face: "renderer" as const,
    pluginId: PLUGIN_ID,
    artifact: { installRevision: "revision-1", manifestHash: `sha256:${"a".repeat(64)}` },
    authorityFingerprint: "[]",
    observedGrantGeneration: 0,
    instanceKey: { windowId: "field" },
  };
  return PluginRuntimeControllerDiagnostic.parse({
    label: `renderer:${PLUGIN_ID}`,
    state: "active",
    desired: target,
    committed: target,
    desiredRevision: 1,
    blocked: null,
    scope: null,
    lastClose: null,
    force: { confirmedCount: 0, last: null },
    history: [],
    omittedHistory: 0,
  });
}

function runtimeSnapshot() {
  return PluginRuntimeDiagnosticsSnapshot.parse({
    version: 1,
    generation: 3,
    capturedAt: 100,
    plugins: [
      {
        pluginId: PLUGIN_ID,
        registry: {
          state: "enabled",
          installRevision: "revision-1",
          manifestHash: `sha256:${"a".repeat(64)}`,
          grantGeneration: 0,
          renderer: "active",
          service: "none",
        },
        commitEpoch: 4,
        serviceController: null,
        serviceControllerOmitted: false,
        renderers: [
          {
            participantId: "renderer:window-a",
            incarnation: "document-a1",
            connected: false,
            status: "live",
            sequence: 2,
            receivedAt: 99,
            controller: controller(),
            behaviorGeneration: {
              pluginId: PLUGIN_ID,
              state: "active",
              target: {
                windowId: "field",
                documentId: "doc-a",
                runtimeGeneration: "engine-a",
              },
              rendererTargets: [
                {
                  face: "renderer",
                  pluginId: PLUGIN_ID,
                  artifact: {
                    installRevision: "revision-1",
                    manifestHash: `sha256:${"a".repeat(64)}`,
                  },
                  authorityFingerprint: "[]",
                  observedGrantGeneration: 0,
                  instanceKey: { windowId: "field" },
                },
              ],
              desiredCount: 1,
              installedCount: 1,
              blockedCount: 0,
              failedCount: 0,
              suspendedCount: 1,
              declarations: [
                {
                  declarationId: `${PLUGIN_ID}:layout`,
                  rendererTarget: 0,
                  status: "installed",
                  breaker: { strikes: 3, suspended: true },
                },
              ],
              omittedDeclarations: 0,
            },
          },
        ],
        omittedRenderers: 0,
        update: null,
        issues: [
          {
            code: "renderer-disconnected",
            severity: "warning",
            face: "renderer",
            participantId: "renderer:window-a",
            message: "renderer:window-a is disconnected; the last bounded report is retained",
          },
        ],
        omittedIssues: 0,
      },
    ],
    omittedPlugins: 0,
    omittedControllers: 0,
  });
}

function client(): FielddClient {
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    request: vi.fn(async () => ({ ok: true })),
    subscribe: vi.fn(async (method: string) => {
      if (method !== "plugins.runtime.subscribe") throw new Error(`unexpected ${method}`);
      return {
        subId: "plugin-runtime",
        snapshot: runtimeSnapshot(),
        unsubscribe: () => undefined,
      };
    }),
  } as unknown as FielddClient;
}

async function mount(): Promise<void> {
  const plugin = PluginRecord.parse({
    id: PLUGIN_ID,
    version: "1.0.0",
    title: "Runtime UI",
    source: "bundled",
    manifestHash: `sha256:${"a".repeat(64)}`,
    installRevision: "revision-1",
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: [],
    grantedCapabilities: [],
    contributions: {},
    renderer: "active",
    service: "none",
  });
  setPluginRegistrySnapshot({ generation: 1, plugins: [plugin], problems: [] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(FielddProvider, { client: client() }, createElement(PluginsSection)),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  setPluginRegistrySnapshot({ generation: 0, plugins: [], problems: [] });
});

describe("PluginsSection runtime diagnostics", () => {
  it("renders the bounded Doctor summary behind an explicit disclosure", async () => {
    await mount();
    const button = Array.from(container?.querySelectorAll("button") ?? []).find((candidate) =>
      candidate.textContent?.includes("Runtime · 1"),
    );
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(container?.textContent).not.toContain("commit epoch 4");

    await act(async () => button?.click());

    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(container?.textContent).toContain("commit epoch 4");
    expect(container?.textContent).toContain("0 connected · 1 renderer report");
    expect(container?.textContent).toContain("disconnected · active");
    expect(container?.textContent).toContain("Behaviors · doc-a");
    expect(container?.textContent).toContain("1/1 installed · 0 blocked · 1 suspended");
    expect(container?.textContent).toContain("target revision-1");
    expect(container?.textContent).toContain("3 strikes · breaker suspended");
    expect(container?.textContent).toContain("the last bounded report is retained");
  });
});
