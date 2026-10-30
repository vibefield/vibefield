// @vitest-environment happy-dom
import { PORTS, SHELL_CLIPBOARD } from "@vibefield/contracts";
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
import { cardsStore } from "../src/frame/cards/cards-store";
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

/** The window's half: Electron's diagnostics answering `local`, and its doors as `doors` say
 * (HN-5: `copyText` is the copy door a record's copy writes through). */
function windowHost(
  local: DiagnosticLogSnapshotV1,
  doors: Partial<NonNullable<FieldHost["diagnostics"]>> = {},
): FieldHost {
  return {
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
      previewSupport: vi.fn(),
      exportSupport: async () => ({
        v: 1,
        status: "cancelled",
        bundleId: "bundle-1",
      }),
      copyText: async () => undefined,
      ...doors,
    },
    getConnection: async () => ({ port: PORTS.FIELDD_WS_CONTROL, token: "test" }),
    onPrepareClose: () => () => undefined,
    completeClose() {},
  };
}

/** fieldd's half: its feed answering `remote`, and no leases. */
function fieldd(remote: DiagnosticLogSnapshotV1): FielddClient {
  return {
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
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function mount(host: FieldHost, client: FielddClient): Promise<HTMLDivElement> {
  setHost(host);
  const view = document.createElement("div");
  container = view;
  document.body.appendChild(view);
  root = createRoot(view);
  await act(async () => {
    root?.render(createElement(FielddProvider, { client }, createElement(DiagnosticsSection)));
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

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
    const view = await mount(windowHost(local, { previewSupport }), fieldd(remote));

    expect(view.textContent).toContain("desktop.viewer.local");
    expect(view.textContent).toContain("fieldd.viewer.remote");

    const previewButton = Array.from(view.querySelectorAll("button")).find(
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
    expect(view.textContent).toContain("Export preview");
  });
});

// HN-5 — a record's copy (DESIGN.md §8 "The hand", §8 "Copy"): the record's JSON on the system
// clipboard first, then a text card dealt from the button pressed, named by the record's own name
// — its event, over its message — never by the JSON's first "{"; the button says how it went in
// Settings' own words, "Copied" or "Couldn't copy", as Devices' do.
describe("a diagnostics record's copy (HN-5)", () => {
  const BOX = { left: 900, top: 210, width: 30, height: 16 };

  afterEach(() => {
    for (const card of cardsStore.snapshot().cards) cardsStore.remove(card.id);
  });

  /** The record's copy button, as the row lays it out. */
  function recordCopy(view: HTMLElement): HTMLButtonElement {
    const copy = Array.from(view.querySelectorAll("button")).find(
      (button) => button.textContent === "copy",
    );
    if (copy === undefined) throw new Error("no copy button on the record");
    vi.spyOn(copy, "getBoundingClientRect").mockReturnValue(BOX as DOMRect);
    return copy;
  }

  /** Let a copy land: the door's write, then the deal and the button's word. */
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
  };

  it("puts the record on the clipboard and deals a card named by its event", async () => {
    const copyText = vi.fn(async (_text: string) => undefined);
    const copied = record(1, "desktop", "desktop.viewer.local");
    const view = await mount(windowHost(snapshot([copied]), { copyText }), fieldd(snapshot([])));
    const copy = recordCopy(view);
    await act(async () => copy.click());
    await act(settle);
    const words = JSON.stringify(copied, null, 2);
    expect(copyText.mock.calls).toEqual([[words]]);
    const dealt = cardsStore.snapshot().cards.at(-1);
    expect(dealt).toMatchObject({
      kind: "text",
      title: "desktop.viewer.local",
      body: "record 1",
      bare: true,
      paste: words,
      origin: { view: "canvas", place: "Settings", how: "copy" },
    });
    expect(cardsStore.snapshot().arriving.get(dealt?.id ?? "")).toEqual(BOX);
    expect(copy.textContent).toBe("Copied");
  });

  it("deals nothing for a record past the clipboard's bound, and says Couldn't copy", async () => {
    const copyText = vi.fn(async (_text: string) => undefined);
    // a record's JSON, pretty-printed, can be past the words' bound: refused before any door
    const large = { ...record(1, "desktop", "desktop.viewer.large"), msg: "x".repeat(70_000) };
    expect(JSON.stringify(large, null, 2).length).toBeGreaterThan(
      SHELL_CLIPBOARD.WRITE_TEXT_MAX_BYTES,
    );
    const view = await mount(windowHost(snapshot([large]), { copyText }), fieldd(snapshot([])));
    const copy = recordCopy(view);
    await act(async () => copy.click());
    await act(settle);
    expect(copyText).not.toHaveBeenCalled();
    expect(cardsStore.snapshot().cards).toEqual([]);
    expect(copy.textContent).toBe("Couldn't copy");
  });
});
