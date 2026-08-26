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
    bridge.attach(port);

    expect(port.sent).toEqual([{ type: "studio.ready", protocol: 2 }]);
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
    bridge.attach(port);

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
    bridge.attach(first);

    first.close();
    expect(listener).toHaveBeenLastCalledWith({
      type: "studio.disconnected",
      reason: "transport-closed",
    });

    const second = new FakeRendererPort();
    bridge.attach(second);
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
    bridge.attach(port);

    expect(bridge.focusProduct()).toBe("studio-1");
    expect(port.sent.at(-1)).toEqual({ type: "product.focus", requestId: "studio-1" });
  });

  it("retains one product command until the renderer subscribes and acknowledges it", () => {
    const bridge = new ProductPreloadBridge("product-1");
    const port = new FakeRendererPort();
    bridge.attach(port);
    expect(port.sent).toEqual([{ type: "product.ready", protocol: 2, instanceId: "product-1" }]);

    port.receive({ type: "appearance.apply", revision: 1, serialized: "{}" });
    port.receive({ type: "appearance.clear", revision: 2, reason: "live-disabled" });
    const handler = vi.fn();
    bridge.subscribe(handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      type: "appearance.clear",
      revision: 2,
      reason: "live-disabled",
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
});
