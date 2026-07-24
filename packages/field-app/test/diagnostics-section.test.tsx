// @vitest-environment happy-dom
import { PORTS } from "@vibefield/contracts";
import type {
  DiagnosticLogSnapshotV1,
  SupportBundlePreviewV1,
} from "@vibefield/contracts/diagnostics";
import type { LogRecordV1 } from "@vibefield/contracts/logging";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FieldHost, setHost } from "../src/host";
import {
  applyDiagnosticDelta,
  DiagnosticsSection,
  diagnosticSourceOf,
  mergeDiagnosticRecords,
} from "../src/panels/DiagnosticsSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noopLogger: FieldHost["logger"] = {
  child: () => noopLogger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
};

function record(
  seq: number,
  service: LogRecordV1["service"],
  event = `${service}.test.recorded`,
): LogRecordV1 {
  return {
    v: 1,
    time: 1_000 + seq,
    level: 30,
    severity: "INFO",
    event,
    msg: `record ${seq}`,
    service,
    role: service === "fieldd" ? "daemon" : "main",
    component: "diagnostics.test",
    pid: 10,
    bootId: `${service}-boot`,
    instanceId: `${service}-instance`,
    seq,
  };
}

function snapshot(records: LogRecordV1[]): DiagnosticLogSnapshotV1 {
  return {
    v: 1,
    producers: [],
    records,
    nextCursor: "cursor-1",
    droppedBefore: 0,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe("diagnostics viewer folds", () => {
  it("deduplicates, orders, caps, applies drop deltas, and derives physical sources", () => {
    const duplicate = record(1, "desktop");
    const merged = mergeDiagnosticRecords(
      [record(3, "fieldd"), duplicate],
      [duplicate, record(2, "renderer")],
    );
    expect(merged.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(
      mergeDiagnosticRecords(Array.from({ length: 1_010 }, (_, index) => record(index, "desktop"))),
    ).toHaveLength(1_000);
    expect(
      applyDiagnosticDelta(snapshot([duplicate]), {
        v: 1,
        cursor: "cursor-2",
        records: [record(2, "desktop")],
        droppedSincePrevious: 4,
      }),
    ).toMatchObject({
      nextCursor: "cursor-2",
      droppedBefore: 4,
      records: [{ seq: 1 }, { seq: 2 }],
    });
    expect(diagnosticSourceOf(record(1, "field-native"))).toBe("system/field-native");
    expect(
      diagnosticSourceOf({
        ...record(1, "renderer"),
        plugin: {
          id: "example.plugin",
          version: "1.0.0",
          installRevision: "revision-1",
          entry: "renderer",
          installSource: "bundled",
          trust: "r0-bundled",
        },
      }),
    ).toBe("plugins/renderer");
  });

  it("merges local and fieldd snapshots and previews the safe first-party default", async () => {
    const local = snapshot([record(1, "desktop", "desktop.viewer.local")]);
    const remote = snapshot([record(1, "fieldd", "fieldd.viewer.remote")]);
    const preview: SupportBundlePreviewV1 = {
      v: 1,
      previewId: "preview-1",
      expiresAt: Date.now() + 60_000,
      estimatedUncompressedBytes: 100,
      estimatedArchiveBytes: 100,
      manifest: {
        v: 1,
        bundleId: "bundle-1",
        createdAt: Date.now(),
        range: { from: Date.now() - 60_000, to: Date.now() },
        sources: ["system/desktop"],
        pluginAliases: [],
        includesAudit: false,
        crashArtifacts: [],
        sanitizerVersion: "support-v1",
        omittedRecords: 0,
        truncatedRecords: 0,
        files: [],
        totalBytes: 0,
        versions: {},
      },
      warnings: ["Support bundles can contain sensitive context."],
    };
    const previewSupport = vi.fn(async (_selection: unknown) => preview);
    const copyText = vi.fn(async () => undefined);
    const host: FieldHost = {
      logger: noopLogger,
      diagnostics: {
        query: async () => local,
        subscribe: async (_query, _onEvent) => ({
          snapshot: local,
          dispose: async () => undefined,
        }),
        createLease: vi.fn(),
        listLeases: async () => ({ v: 1, observedAt: Date.now(), leases: [] }),
        revokeLease: async () => ({ revoked: false }),
        openLogs: async () => undefined,
        listCrashes: async () => ({
          v: 1,
          observedAt: Date.now(),
          artifacts: [],
          cleanup: {
            deletedArtifacts: 0,
            deletedBytes: 0,
            failures: 0,
            skippedUnsafeEntries: 0,
          },
        }),
        markCrashViewed: async () => ({ viewed: false }),
        previewSupport,
        exportSupport: async () => ({
          v: 1,
          status: "cancelled",
          bundleId: "bundle-1",
        }),
        copyText,
      },
      getConnection: async () => ({ port: PORTS.FIELDD_WS_CONTROL, token: "test" }),
      onPrepareClose: () => () => undefined,
      completeClose() {},
    };
    setHost(host);
    const client = {
      subscribe: vi.fn(async () => ({
        subId: "remote-1",
        snapshot: remote,
        unsubscribe: () => undefined,
      })),
      request: vi.fn(async (method: string) => {
        if (method === "diagnostics.lease.list") {
          return { v: 1, observedAt: Date.now(), leases: [] };
        }
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as FielddClient;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(FielddProvider, { client }, createElement(DiagnosticsSection)));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("desktop.viewer.local");
    expect(container.textContent).toContain("fieldd.viewer.remote");
    const copy = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "copy",
    );
    await act(async () => copy?.click());
    expect(copyText).toHaveBeenCalledOnce();

    const previewButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Preview",
    );
    await act(async () => {
      previewButton?.click();
      await Promise.resolve();
    });
    expect(previewSupport).toHaveBeenCalledOnce();
    expect(previewSupport.mock.calls[0]?.[0]).toMatchObject({
      sources: [
        "system/desktop",
        "system/renderer",
        "system/utility",
        "system/fieldd",
        "system/field-native",
      ],
      pluginIds: [],
      includeAudit: false,
      crashArtifactIds: [],
    });
    expect(container.textContent).toContain("Export preview");
  });
});
