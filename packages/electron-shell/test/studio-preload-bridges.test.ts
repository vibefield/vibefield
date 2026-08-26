import { describe, expect, it, vi } from "vitest";
import { ProductPreloadBridge } from "../src/studio/product-preload-bridge";
import { type RendererPort, StudioPreloadBridge } from "../src/studio/studio-preload-bridge";

class FakeRendererPort implements RendererPort {
  readonly sent: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  started = false;
  closed = false;

  postMessage(message: unknown): void {
    this.sent.push(message);
  }
  start(): void {
    this.started = true;
  }
  close(): void {
    this.closed = true;
    this.onclose?.();
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
}

describe("Studio preload bridges", () => {
  it("coalesces appearance proposals into one latest animation-frame slot", () => {
    const frames: Array<() => void> = [];
    const bridge = new StudioPreloadBridge((callback) => frames.push(callback));
    const port = new FakeRendererPort();
    bridge.attach(port, 1);

    expect(port.sent).toEqual([{ type: "studio.ready", protocol: 3 }]);
    expect(bridge.publish('{"reach":1}')).toBe("studio-1");
    expect(bridge.publish('{"reach":2}')).toBe("studio-2");
    expect(frames).toHaveLength(1);
    frames.shift()?.();
    expect(port.sent.at(-1)).toEqual({
      type: "appearance.publish",
      requestId: "studio-2",
      serialized: '{"reach":2}',
    });
  });

  it("validates host messages before notifying Studio renderer listeners", () => {
    const bridge = new StudioPreloadBridge((callback) => callback());
    const port = new FakeRendererPort();
    const listener = vi.fn();
    bridge.subscribe(listener);
    bridge.attach(port, 1);

    port.receive({ type: "execute", code: "arbitrary" });
    expect(listener).not.toHaveBeenCalled();
    port.receive({
      type: "studio.status",
      status: {
        productConnection: "connected",
        live: false,
        revision: null,
        appliedRevision: null,
        rejection: null,
      },
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("surfaces an unexpected port close without overwriting a host protocol reason", () => {
    const bridge = new StudioPreloadBridge((callback) => callback());
    const first = new FakeRendererPort();
    const listener = vi.fn();
    bridge.subscribe(listener);
    bridge.attach(first, 1);

    first.close();
    expect(listener).toHaveBeenLastCalledWith({
      type: "studio.disconnected",
      reason: "transport-closed",
    });

    const second = new FakeRendererPort();
    bridge.attach(second, 2);
    second.receive({ type: "studio.disconnected", reason: "version-mismatch" });
    second.close();
    expect(listener).toHaveBeenLastCalledWith({
      type: "studio.disconnected",
      reason: "version-mismatch",
    });
  });

  it("sends the bounded product-focus command directly", () => {
    const bridge = new StudioPreloadBridge((callback) => callback());
    const port = new FakeRendererPort();
    bridge.attach(port, 1);

    expect(bridge.focusProduct()).toBe("studio-1");
    expect(port.sent.at(-1)).toEqual({ type: "product.focus", requestId: "studio-1" });
  });

  it("retains one product command until the renderer subscribes and acknowledges it", () => {
    const bridge = new ProductPreloadBridge("product-1");
    const port = new FakeRendererPort();
    bridge.attach(port, 1);
    expect(port.sent).toEqual([]);
    connectProductBridge(port, "product-1");

    port.receive({ type: "appearance.apply", revision: 1, serialized: "{}" });
    port.receive({ type: "appearance.clear", revision: 2, reason: "live-disabled" });
    port.receive({ type: "execute", code: "arbitrary" });
    expect(bridge.physicalState()).toEqual({
      received: 3,
      parseFailures: 1,
      handlerAttached: false,
      dispatches: 0,
      completions: 0,
      pending: { type: "appearance.clear", revision: 2 },
      lastCommand: { type: "appearance.clear", revision: 2 },
      generation: 1,
      connected: true,
    });
    const handler = vi.fn();
    bridge.subscribe(handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      type: "appearance.clear",
      revision: 2,
      reason: "live-disabled",
    });
    expect(bridge.physicalState()).toMatchObject({
      handlerAttached: true,
      dispatches: 1,
      completions: 1,
      pending: null,
    });

    bridge.applied(2);
    bridge.rejected(3, "invalid-document");
    expect(port.sent.slice(-2)).toEqual([
      { type: "appearance.applied", revision: 2, instanceId: "product-1" },
      {
        type: "appearance.rejected",
        revision: 3,
        code: "invalid-document",
        instanceId: "product-1",
      },
    ]);
  });

  it("coalesces product context into one latest slot at the bounded cadence", () => {
    const flushes: Array<() => void> = [];
    const bridge = new ProductPreloadBridge("product-1", (callback) => flushes.push(callback));
    const port = new FakeRendererPort();

    bridge.context({ theme: "light", zoom: 1 });
    bridge.attach(port, 1);
    connectProductBridge(port, "product-1");
    bridge.context({ theme: "dark", zoom: 1.1 });
    bridge.context({ theme: "dark", zoom: 1.25 });
    expect(flushes).toHaveLength(1);
    flushes.shift()?.();
    expect(port.sent.at(-1)).toEqual({ type: "product.context", theme: "dark", zoom: 1.25 });

    bridge.context({ theme: "dark", zoom: 1.25 });
    expect(flushes).toHaveLength(0);
    bridge.context({ theme: "dark", zoom: 1.5 });
    expect(flushes).toHaveLength(1);
  });

  it("keeps the newest product port when transfers arrive out of order", () => {
    const bridge = new ProductPreloadBridge("product-1");
    const newest = new FakeRendererPort();
    const stale = new FakeRendererPort();

    bridge.attach(newest, 2);
    bridge.attach(stale, 1);
    connectProductBridge(newest, "product-1", "product-port-2");

    expect(stale.closed).toBe(true);
    expect(stale.sent).toEqual([]);
    expect(bridge.physicalState().generation).toBe(2);
  });

  it("keeps the newest Studio port when transfers arrive out of order", () => {
    const bridge = new StudioPreloadBridge((callback) => callback());
    const newest = new FakeRendererPort();
    const stale = new FakeRendererPort();

    bridge.attach(newest, 2);
    bridge.attach(stale, 1);

    expect(newest.sent).toEqual([{ type: "studio.ready", protocol: 3 }]);
    expect(stale.closed).toBe(true);
    expect(stale.sent).toEqual([]);
  });
});

function connectProductBridge(
  port: FakeRendererPort,
  instanceId: string,
  connectionId = "product-port-1",
): void {
  port.receive({ type: "product.connect", protocol: 3, connectionId });
  expect(port.sent.at(-1)).toEqual({
    type: "product.ready",
    protocol: 3,
    instanceId,
    connectionId,
  });
}
