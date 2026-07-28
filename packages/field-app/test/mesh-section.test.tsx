// @vitest-environment happy-dom
/**
 * MeshSection's C6-4 sync rows against a fake FielddClient (diagnostics-section
 * pattern) and the module doc-sync store: honest words per state, counts in
 * tabular-nums, offline peers named by their ROSTER name, the last-exchange
 * clock as the freshness claim, and — just as load-bearing — no rows at all
 * when sync has nothing to say.
 */
import type { DocSyncStatus } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDocSyncStatuses, setDocSyncStatuses } from "../src/doc-sync-store";
import { MeshSection } from "../src/panels/MeshSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const device = (over: Record<string, unknown>) => ({
  deviceId: "dev",
  name: "device",
  platform: "darwin",
  headless: false,
  fielddVersion: "0.0.0",
  contractsVersion: "0.0.0",
  capabilities: { terminalHost: false, docHost: true, push: false },
  productEndpoint: { serve: "product" },
  bootId: "boot",
  publishedAt: 1,
  self: false,
  online: true,
  lastSeenAt: 1,
  ...over,
});

function fakeClient(): FielddClient {
  return {
    status: "connected",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      if (method === "system.health.subscribe") {
        return {
          subId: "health",
          snapshot: {
            native: { units: [{ unit: "mesh-gateway", state: "up" }] },
            mesh: { serves: [] },
          },
          unsubscribe: (): undefined => undefined,
        };
      }
      if (method === "device.subscribe") {
        return {
          subId: "devices",
          snapshot: [
            device({ deviceId: "dev-self", name: "alpha", self: true }),
            device({ deviceId: "dev-b", name: "beta", online: false }),
          ],
          unsubscribe: (): undefined => undefined,
        };
      }
      throw new Error(`unexpected subscription: ${method}`);
    }),
    request: vi.fn(),
  } as unknown as FielddClient;
}

function status(over: Partial<DocSyncStatus> & { docId: string }): DocSyncStatus {
  return {
    name: "Field",
    state: "in-step",
    pendingRecords: 0,
    peers: [{ peer: "dev-b", reachable: true, lastExchangeAt: 1_700_000_000_000 }],
    reason: null,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  act(() => resetDocSyncStatuses());
});

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(FielddProvider, { client: fakeClient() }, createElement(MeshSection)),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("MeshSection doc sync rows (C6-4)", () => {
  it("stays quiet when sync has nothing to say — no vacuous 'synced'", async () => {
    await mount();
    expect(container?.textContent).not.toContain("doc sync");
  });

  it("renders honest words, counts, named offline peers, and the last-exchange clock", async () => {
    act(() =>
      setDocSyncStatuses([
        status({ docId: "doc-1", name: "Field", state: "pending", pendingRecords: 2 }),
        status({
          docId: "doc-2",
          name: "Studio",
          state: "peer-offline",
          peers: [{ peer: "dev-b", reachable: false, lastExchangeAt: 1_700_000_000_000 }],
        }),
      ]),
    );
    await mount();
    const text = container?.textContent ?? "";
    expect(text).toContain("doc sync");
    expect(text).toContain("pending");
    expect(text).toContain("waiting on 2");
    expect(text).toContain("peer offline");
    // provenance: the offline peer is named from the ROSTER, not by raw id …
    expect(text).toContain("offline: beta");
    // … and the freshness claim is the clock, never "now" (F-C6-22).
    expect(text).toContain("last exchange");
  });

  it("renders a doc this device does not hold as a fact, not an alarm", async () => {
    act(() =>
      setDocSyncStatuses([
        status({ docId: "ghost", name: null, state: "peer-declined", reason: "unknown-doc" }),
      ]),
    );
    await mount();
    const text = container?.textContent ?? "";
    expect(text).toContain("a peer's doc · not held here");
    expect(text).toContain("declined");
    expect(text).toContain("unknown-doc"); // the verbatim reason, as provenance
  });
});
