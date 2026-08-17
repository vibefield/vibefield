import { MESHDATA_INBOUND_LANE_ID_BASE } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { LaneInfo } from "../src/doc-sync";
import {
  type PresenceLaneBytes,
  type PresenceLaneControl,
  PresenceRoomRouter,
} from "../src/presence-room";

class FakeControl implements PresenceLaneControl {
  opened: Array<{ laneId: number; peer: string; docId: string }> = [];
  closed: number[] = [];
  order: string[] = [];
  lanes: LaneInfo[] = [];
  gate: Promise<void> | null = null;
  #emit: ((payload: unknown, kind: "snapshot" | "delta") => void) | null = null;

  async open(req: {
    laneId: number;
    class: "lossy";
    peer: string;
    protocol: "presence";
    docId: string;
  }): Promise<void> {
    this.opened.push({ laneId: req.laneId, peer: req.peer, docId: req.docId });
    await this.gate;
  }

  async close(laneId: number): Promise<void> {
    this.closed.push(laneId);
    this.order.push(`close:${laneId}`);
  }

  async subscribe(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ lanes: LaneInfo[] }> {
    this.#emit = onEvent;
    return { lanes: this.lanes };
  }

  announce(payload: unknown, kind: "snapshot" | "delta" = "delta"): void {
    this.#emit?.(payload, kind);
  }
}

class FakeBytes implements PresenceLaneBytes {
  sent: Array<{ laneId: number; payload: Uint8Array }> = [];
  order: string[] = [];
  #handlers = new Map<number, (payload: Uint8Array) => void>();

  send(laneId: number, payload: Uint8Array): boolean {
    this.sent.push({ laneId, payload: payload.slice() });
    this.order.push(`send:${laneId}:${payload[0] ?? -1}`);
    return true;
  }

  async flush(laneId: number): Promise<void> {
    this.order.push(`flush:${laneId}`);
  }

  onLane(laneId: number, handler: (payload: Uint8Array) => void): void {
    this.#handlers.set(laneId, handler);
  }

  offLane(laneId: number): void {
    this.#handlers.delete(laneId);
  }

  deliver(laneId: number, payload: Uint8Array): void {
    this.#handlers.get(laneId)?.(payload);
  }

  claimed(laneId: number): boolean {
    return this.#handlers.has(laneId);
  }
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function harness(peers = [{ id: "peer-a", online: true }]) {
  const control = new FakeControl();
  const bytes = new FakeBytes();
  let nextLaneId = 8;
  const router = new PresenceRoomRouter({
    control,
    bytes,
    peers: async () => peers,
    allocateLaneId: () => nextLaneId++,
  });
  return { router, control, bytes };
}

describe("PresenceRoomRouter", () => {
  it("retains only the newest snapshot while a lane opens and fences it before close", async () => {
    const { router, control, bytes } = harness();
    let release!: () => void;
    control.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await router.start();
    const room = router.attach("doc-a", () => {});
    room.publish(new Uint8Array([1]));
    await until(() => control.opened.length === 1, "slow lane open");
    for (let value = 2; value <= 100; value++) room.publish(new Uint8Array([value]));
    expect(router.state()).toEqual({ rooms: 1, outbound: 0, inbound: 0, retainedBytes: 1 });

    release();
    await until(() => bytes.sent.length === 1, "newest snapshot send");
    expect(control.opened).toEqual([{ laneId: 8, peer: "peer-a", docId: "doc-a" }]);
    expect(Array.from(bytes.sent[0]?.payload ?? [])).toEqual([100]);

    room.publish(new Uint8Array([255]));
    await until(() => bytes.sent.at(-1)?.payload[0] === 255, "terminal snapshot send");
    await room.close();
    expect(bytes.order).toContain("flush:8");
    expect(control.order).toContain("close:8");
    expect(bytes.order.indexOf("flush:8")).toBeGreaterThan(bytes.order.indexOf("send:8:255"));
    expect(router.state()).toEqual({ rooms: 0, outbound: 0, inbound: 0, retainedBytes: 0 });
  });

  it("claims one inbound lane per peer and stale closes cannot erase its successor", async () => {
    const { router, control, bytes } = harness([]);
    const received: number[] = [];
    await router.start();
    const room = router.attach("doc-a", (payload) => received.push(payload[0] ?? -1));
    const first = MESHDATA_INBOUND_LANE_ID_BASE;
    const second = first + 1;
    control.announce({
      kind: "peerOpened",
      laneId: first,
      inbound: true,
      class: "lossy",
      protocol: "presence",
      peer: "peer-a",
      docId: "doc-a",
    });
    bytes.deliver(first, new Uint8Array([1]));
    control.announce({
      kind: "peerOpened",
      laneId: second,
      inbound: true,
      class: "lossy",
      protocol: "presence",
      peer: "peer-a",
      docId: "doc-a",
    });
    expect(bytes.claimed(first)).toBe(false);
    expect(bytes.claimed(second)).toBe(true);
    control.announce({ kind: "closed", laneId: first, peer: "peer-a", protocol: "presence" });
    bytes.deliver(second, new Uint8Array([2]));
    expect(received).toEqual([1, 2]);
    expect(router.state().inbound).toBe(1);

    await room.close();
    expect(bytes.claimed(second)).toBe(false);
    expect(router.state()).toEqual({ rooms: 0, outbound: 0, inbound: 0, retainedBytes: 0 });
  });

  it("ends repeated room generations with no handlers, lanes, or retained snapshots", async () => {
    const { router } = harness([]);
    await router.start();
    for (let generation = 0; generation < 32; generation++) {
      const room = router.attach("doc-a", () => {});
      room.publish(new Uint8Array([generation]));
      await room.close();
    }
    expect(router.state()).toEqual({ rooms: 0, outbound: 0, inbound: 0, retainedBytes: 0 });
    await router.stop();
  });
});
