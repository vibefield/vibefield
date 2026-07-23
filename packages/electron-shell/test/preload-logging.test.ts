import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { PreloadLogBridge, type RendererLogPort } from "../src/preload/logging";

class FakePort implements RendererLogPort {
  readonly messages: string[] = [];
  started = 0;
  closed = 0;
  fail = false;

  postMessage(message: string): void {
    if (this.fail) throw new Error("disconnected");
    this.messages.push(message);
  }

  start(): void {
    this.started += 1;
  }

  close(): void {
    this.closed += 1;
  }
}

describe("preload renderer-log bridge", () => {
  it("queues bounded batches until the transferred port arrives", () => {
    const bridge = new PreloadLogBridge();
    expect(bridge.submit('{"v":1,"records":[1]}')).toBe(true);
    const port = new FakePort();
    bridge.attach(port);
    expect(port.started).toBe(1);
    expect(port.messages).toEqual(['{"v":1,"records":[1]}']);
    expect(bridge.health()).toEqual({ pendingBatches: 0, pendingBytes: 0, connected: true });
  });

  it("rejects non-strings, oversized UTF-8, and an unbounded pre-port burst", () => {
    const bridge = new PreloadLogBridge();
    expect(bridge.submit({})).toBe(false);
    expect(bridge.submit("🙂".repeat(LOG_TRANSPORT_LIMITS.RENDERER_BATCH_BYTES / 2))).toBe(false);
    for (let index = 0; index < LOG_TRANSPORT_LIMITS.RENDERER_BATCHES_PER_SECOND * 2; index += 1) {
      expect(bridge.submit(String(index))).toBe(true);
    }
    expect(bridge.submit("overflow")).toBe(false);
  });

  it("replaces and closes ports exactly once and refuses after close", () => {
    const bridge = new PreloadLogBridge();
    const first = new FakePort();
    const second = new FakePort();
    bridge.attach(first);
    bridge.attach(second);
    expect(first.closed).toBe(1);
    bridge.close();
    bridge.close();
    expect(second.closed).toBe(1);
    expect(bridge.submit("after-close")).toBe(false);
  });
});
