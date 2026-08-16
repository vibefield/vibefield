import {
  LIVE_SURFACE_PORT_BRIDGE_MESSAGE_V1,
  type LiveSurfacePortBootstrapV1,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  type LiveSurfaceMessagePort,
  type LiveSurfaceWindowMessageEvent,
  type LiveSurfaceWindowMessageTarget,
  receiveLiveSurfaceRendererTransport,
} from "../src/renderer";

class FakePort implements LiveSurfaceMessagePort {
  onmessage: LiveSurfaceMessagePort["onmessage"] = null;
  onmessageerror: (() => void) | null = null;
  peer: FakePort | null = null;
  private readonly queued: unknown[] = [];
  private started = false;

  postMessage(message: unknown): void {
    this.peer?.deliver(message);
  }

  start(): void {
    this.started = true;
    for (const message of this.queued.splice(0)) this.onmessage?.({ data: message });
  }

  close(): void {
    this.queued.length = 0;
  }

  private deliver(message: unknown): void {
    if (!this.started) this.queued.push(message);
    else this.onmessage?.({ data: message });
  }
}

function channel(): [FakePort, FakePort] {
  const a = new FakePort();
  const b = new FakePort();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

class FakeWindow implements LiveSurfaceWindowMessageTarget {
  readonly listeners = new Set<(event: LiveSurfaceWindowMessageEvent) => void>();

  addEventListener(
    _type: "message",
    listener: (event: LiveSurfaceWindowMessageEvent) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: LiveSurfaceWindowMessageEvent) => void,
  ): void {
    this.listeners.delete(listener);
  }

  dispatch(data: unknown, ports: readonly unknown[], source: unknown = this): void {
    let stopped = false;
    const event: LiveSurfaceWindowMessageEvent = {
      source,
      data,
      ports,
      stopImmediatePropagation: () => {
        stopped = true;
      },
    };
    for (const listener of [...this.listeners]) {
      listener(event);
      if (stopped) break;
    }
  }
}

const BRIDGE_NONCE = "bridge_nonce_00000000000000000001";

function bridgeMessage(bootstrap: LiveSurfacePortBootstrapV1, bridgeNonce = BRIDGE_NONCE) {
  return { type: LIVE_SURFACE_PORT_BRIDGE_MESSAGE_V1, bootstrap, bridgeNonce };
}

describe("receiveLiveSurfaceRendererTransport", () => {
  it("ignores foreign messages and consumes exactly one valid two-port handoff", async () => {
    const target = new FakeWindow();
    const rejected: string[] = [];
    const receiver = receiveLiveSurfaceRendererTransport(target, BRIDGE_NONCE, (reason) =>
      rejected.push(reason),
    );
    let observedByLateListener = 0;
    target.addEventListener("message", () => {
      observedByLateListener += 1;
    });
    const [control, host] = channel();
    const [frames] = channel();
    target.dispatch(bridgeMessage({ v: 1, rendererGeneration: 2 }), [control, frames], {});
    expect(target.listeners.size).toBe(2);
    expect(observedByLateListener).toBe(1);
    target.dispatch(
      bridgeMessage({ v: 1, rendererGeneration: 2 }, "attacker_nonce_000000000000000000"),
      [control, frames],
    );
    expect(rejected).toEqual(["invalid main-world live surface port handoff"]);
    expect(observedByLateListener).toBe(1);
    target.dispatch(bridgeMessage({ v: 1, rendererGeneration: 2 }), [control]);
    expect(rejected).toEqual([
      "invalid main-world live surface port handoff",
      "invalid main-world live surface port handoff",
    ]);
    expect(observedByLateListener).toBe(1);
    target.dispatch(bridgeMessage({ v: 1, rendererGeneration: 2 }), [control, frames]);
    const transport = await receiver.transport;
    expect(transport.rendererGeneration).toBe(2);
    expect(target.listeners.size).toBe(1);
    expect(observedByLateListener).toBe(1);
    host.start();
    host.postMessage({
      v: 1,
      type: "ready",
      bootstrap: { v: 1, rendererGeneration: 2 },
    });
    await expect(transport.ready).resolves.toBeUndefined();
  });

  it("can be disposed before handoff without creating a transport", () => {
    const target = new FakeWindow();
    const receiver = receiveLiveSurfaceRendererTransport(target, BRIDGE_NONCE);
    expect(target.listeners.size).toBe(1);
    receiver.dispose();
    receiver.dispose();
    expect(target.listeners.size).toBe(0);
  });
});
