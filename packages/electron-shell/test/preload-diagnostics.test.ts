import { LOG_STREAMS } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { type DiagnosticsRendererPort, PreloadDiagnosticsBridge } from "../src/preload/diagnostics";

const snapshot = {
  v: 1,
  producers: [],
  records: [],
  nextCursor: "cursor-1",
  droppedBefore: 0,
} as const;

class FakePort implements DiagnosticsRendererPort {
  readonly messages: string[] = [];
  started = 0;
  closed = 0;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  postMessage(message: string): void {
    this.messages.push(message);
  }

  start(): void {
    this.started += 1;
  }

  close(): void {
    this.closed += 1;
  }

  respond(index: number, result: unknown): void {
    const request = JSON.parse(this.messages[index] ?? "") as { id: string };
    this.onmessage?.({
      data: JSON.stringify({ v: 1, id: request.id, ok: true, result }),
    });
  }

  event(subId: string, eventKind: "delta" | "snapshot", payload: unknown): void {
    this.onmessage?.({
      data: JSON.stringify({ v: 1, kind: "event", subId, eventKind, payload }),
    });
  }
}

const query = {
  sources: [LOG_STREAMS.SYSTEM_DESKTOP],
  limit: 100,
} as const;

describe("preload diagnostics bridge", () => {
  it("queues a validated request until the host port arrives", async () => {
    const bridge = new PreloadDiagnosticsBridge();
    const pending = bridge.query(query);
    expect(bridge.health()).toEqual({
      connected: false,
      pendingRequests: 1,
      subscriptions: 0,
    });

    const port = new FakePort();
    bridge.attach(port);
    expect(port.started).toBe(1);
    expect(JSON.parse(port.messages[0] ?? "")).toMatchObject({
      v: 1,
      method: "query",
      params: query,
    });
    port.respond(0, snapshot);
    await expect(pending).resolves.toEqual(snapshot);
  });

  it("validates subscription snapshots and deltas before dispatching them", async () => {
    const bridge = new PreloadDiagnosticsBridge();
    const port = new FakePort();
    const events = vi.fn();
    bridge.attach(port);

    const pending = bridge.subscribe(query, events);
    port.respond(0, { subId: "local-1", snapshot });
    await expect(pending).resolves.toEqual({ subId: "local-1", snapshot });
    port.event("local-1", "delta", {
      v: 1,
      cursor: "cursor-2",
      records: [],
      droppedSincePrevious: 2,
    });
    expect(events).toHaveBeenCalledWith({
      kind: "delta",
      payload: {
        v: 1,
        cursor: "cursor-2",
        records: [],
        droppedSincePrevious: 2,
      },
    });

    const removed = bridge.unsubscribe("local-1");
    port.respond(1, { removed: true });
    await expect(removed).resolves.toEqual({ removed: true });
    expect(bridge.health().subscriptions).toBe(0);
  });

  it("rejects outstanding requests when a renderer-generation port is replaced", async () => {
    const bridge = new PreloadDiagnosticsBridge();
    const first = new FakePort();
    bridge.attach(first);
    const pending = bridge.query(query);

    const second = new FakePort();
    bridge.attach(second);
    await expect(pending).rejects.toMatchObject({
      kind: "DISCONNECTED",
    });
    expect(first.closed).toBe(1);
    expect(second.started).toBe(1);
    expect(bridge.health().pendingRequests).toBe(0);
  });

  it("fails closed when main sends an invalid response", async () => {
    const bridge = new PreloadDiagnosticsBridge();
    const port = new FakePort();
    bridge.attach(port);
    const pending = bridge.query(query);
    port.onmessage?.({ data: JSON.stringify({ v: 1, nope: true }) });
    await expect(pending).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
    expect(port.closed).toBe(1);
    expect(bridge.health().connected).toBe(false);
  });
});
