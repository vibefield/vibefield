// @vitest-environment node
/**
 * Item 550 (2026-11-19; track EY, EY-1) — WHEN THE AT-WORK MARK HAS LEFT AN OBJECT (DESIGN.md §8 "At work on the mat").
 * A pane an agent's run made leaves the desk on its at-work leaving, so the store answers when that leaving is over:
 * `whenAtWorkLeft(objectKey, then)` calls `then` AT_WORK_LEAVE_MS after the object's last at-work row stopped (released,
 * or gone from the feed), at once when none was at work, when the object is not on the board and when the feed clears,
 * and never later than OBJECT_ROOM.RELEASED_SHOWN_MS after the call; once, never inside the call, with a cancel. It reads
 * the store and its clock, never the layer: the layer steps an object only while it is placed and on screen in a shown
 * layer, and a made pane is often none of those.
 *
 * Every row here asks for a call: the door's red never calls `then`, so each fails at its assertion.
 */
import { OBJECT_ROOM, type ObjectsPresenceSnapshot } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AT_WORK_LEAVE_MS, AT_WORK_MOTION } from "../src/field/desk/at-work/at-work-model";
import {
  type AtWorkStore,
  atWorkStore,
  createAtWorkStore,
  whenAtWorkLeft,
} from "../src/field/desk/at-work/at-work-store";

const agent = (run: string, state = "open", since = 1): Record<string, unknown> => ({
  run,
  handle: `${run} in vibe-field`,
  agent: "agent",
  state,
  since,
});

const object = (
  key: string,
  agents: readonly Record<string, unknown>[],
): ObjectsPresenceSnapshot["objects"][number] => ({
  ref: `vf:obj/${key.padEnd(8, "0").slice(0, 8)}`,
  docId: "doc-1",
  key,
  agents: agents as ObjectsPresenceSnapshot["objects"][number]["agents"],
});

const snapshot = (...objects: ObjectsPresenceSnapshot["objects"]): ObjectsPresenceSnapshot => ({
  objects,
});

/** A store on the fake clock, and a door on `key` that counts its calls. */
function door(store: AtWorkStore, key = "pane"): { calls: () => number; cancel: () => void } {
  let calls = 0;
  const cancel = whenAtWorkLeft(
    key,
    () => {
      calls += 1;
    },
    store,
  );
  return { calls: () => calls, cancel };
}

/** Let the clock run `ms`, and every microtask it queued. */
const pass = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

let store: AtWorkStore;

beforeEach(() => {
  vi.useFakeTimers();
  store = createAtWorkStore(() => Date.now());
});

afterEach(() => {
  atWorkStore.clear();
  vi.useRealTimers();
});

describe("the leaving's length — the model's own", () => {
  it("is the sticker's peel's end, past the stroke's reel: 495 ms, inside the released row's stay", async () => {
    expect(AT_WORK_LEAVE_MS).toBe(AT_WORK_MOTION.peelAtMs + AT_WORK_MOTION.peelMs);
    expect(AT_WORK_LEAVE_MS).toBeGreaterThanOrEqual(AT_WORK_MOTION.eraseMs);
    expect(AT_WORK_LEAVE_MS).toBe(495);
    expect(AT_WORK_LEAVE_MS).toBeLessThan(OBJECT_ROOM.RELEASED_SHOWN_MS);
    store.publish("doc-1", snapshot(object("pane", [agent("a")])));
    const left = door(store);
    store.publish("doc-1", snapshot(object("pane", [agent("a", "released", 2)])));
    await pass(AT_WORK_LEAVE_MS);
    expect(left.calls()).toBe(1);
  });
});

describe("whenAtWorkLeft — then, once the mark has left the object", () => {
  it("waits while an agent is at work on it, then the whole leaving after its release", async () => {
    store.publish("doc-1", snapshot(object("pane", [agent("a")])));
    const left = door(store);
    await pass(1_000);
    expect(left.calls()).toBe(0);
    store.publish("doc-1", snapshot(object("pane", [agent("a", "released", 2)])));
    await pass(AT_WORK_LEAVE_MS - 1);
    expect(left.calls()).toBe(0);
    await pass(1);
    expect(left.calls()).toBe(1);
  });

  it("counts the leaving from when the store saw the row stop, a release before the call included", async () => {
    store.publish("doc-1", snapshot(object("pane", [agent("a")])));
    await pass(100);
    store.publish("doc-1", snapshot(object("pane", [agent("a", "released", 2)])));
    await pass(200);
    const left = door(store);
    await pass(AT_WORK_LEAVE_MS - 200 - 1);
    expect(left.calls()).toBe(0);
    await pass(1);
    expect(left.calls()).toBe(1);
  });

  it("lets a row gone from the feed without a release leave the same way", async () => {
    store.publish("doc-1", snapshot(object("pane", [agent("a")]), object("other", [agent("b")])));
    const left = door(store);
    await pass(200);
    store.publish("doc-1", snapshot(object("other", [agent("b")])));
    await pass(AT_WORK_LEAVE_MS - 1);
    expect(left.calls()).toBe(0);
    await pass(1);
    expect(left.calls()).toBe(1);
  });

  it("waits for every agent at work on the object: one released while another works", async () => {
    store.publish("doc-1", snapshot(object("pane", [agent("a"), agent("b")])));
    const left = door(store);
    await pass(100);
    store.publish("doc-1", snapshot(object("pane", [agent("a", "released", 2), agent("b")])));
    await pass(1_000);
    expect(left.calls()).toBe(0);
    store.publish(
      "doc-1",
      snapshot(object("pane", [agent("a", "released", 2), agent("b", "released", 3)])),
    );
    await pass(AT_WORK_LEAVE_MS - 1);
    expect(left.calls()).toBe(0);
    await pass(1);
    expect(left.calls()).toBe(1);
  });

  it("waits again when a run opens the object again before the leaving ends", async () => {
    store.publish("doc-1", snapshot(object("pane", [agent("a")])));
    const left = door(store);
    store.publish("doc-1", snapshot(object("pane", [agent("a", "released", 2)])));
    await pass(300);
    store.publish("doc-1", snapshot(object("pane", [agent("a", "open", 3)])));
    await pass(AT_WORK_LEAVE_MS);
    expect(left.calls()).toBe(0);
    store.publish("doc-1", snapshot(object("pane", [agent("a", "released", 4)])));
    await pass(AT_WORK_LEAVE_MS - 1);
    expect(left.calls()).toBe(0);
    await pass(1);
    expect(left.calls()).toBe(1);
  });
});

describe("at once — nothing is leaving", () => {
  it("calls at once when no agent is at work on the object, never inside the call", async () => {
    store.publish("doc-1", snapshot(object("other", [agent("b")])));
    const left = door(store);
    expect(left.calls()).toBe(0);
    await pass(0);
    expect(left.calls()).toBe(1);
  });

  it("calls at once when its last agent left longer ago than the leaving", async () => {
    store.publish("doc-1", snapshot(object("pane", [agent("a")])));
    store.publish("doc-1", snapshot(object("pane", [agent("a", "released", 2)])));
    await pass(AT_WORK_LEAVE_MS);
    const left = door(store);
    await pass(0);
    expect(left.calls()).toBe(1);
  });

  it("calls at once with no feed, and when the feed clears mid-leaving: the layer drops its marks with no leaving", async () => {
    const none = door(store);
    await pass(0);
    expect(none.calls()).toBe(1);
    store.publish("doc-1", snapshot(object("pane", [agent("a")])));
    store.publish("doc-1", snapshot(object("pane", [agent("a", "released", 2)])));
    const left = door(store);
    await pass(100);
    expect(left.calls()).toBe(0);
    store.clear();
    await pass(0);
    expect(left.calls()).toBe(1);
  });
});

describe("never held — the cap, once, and the cancel", () => {
  it("never waits past the released row's stay from the call: an agent that never stops does not hold it", async () => {
    store.publish("doc-1", snapshot(object("pane", [agent("a")])));
    const left = door(store);
    await pass(OBJECT_ROOM.RELEASED_SHOWN_MS - 1);
    expect(left.calls()).toBe(0);
    await pass(1);
    expect(left.calls()).toBe(1);
  });

  it("calls then at most once, and its cancel stops it; a second cancel is harmless", async () => {
    store.publish("doc-1", snapshot(object("pane", [agent("a")])));
    const kept = door(store);
    const cancelled = door(store);
    store.publish("doc-1", snapshot(object("pane", [agent("a", "released", 2)])));
    await pass(100);
    cancelled.cancel();
    cancelled.cancel();
    await pass(AT_WORK_LEAVE_MS);
    expect([kept.calls(), cancelled.calls()]).toEqual([1, 0]);
    store.publish("doc-1", snapshot(object("pane", [agent("a", "open", 3)])));
    store.publish("doc-1", snapshot(object("pane", [agent("a", "released", 4)])));
    store.clear();
    await pass(OBJECT_ROOM.RELEASED_SHOWN_MS);
    expect([kept.calls(), cancelled.calls()]).toEqual([1, 0]);
  });

  it("asks the window's store when it is handed none", async () => {
    let calls = 0;
    whenAtWorkLeft("pane", () => {
      calls += 1;
    });
    await pass(0);
    expect(calls).toBe(1);
  });
});
