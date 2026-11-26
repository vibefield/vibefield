// @vitest-environment node
/**
 * Item 550b (2026-11-24; track EY, EY-1 1f) — A RUN'S PANE LEAVES ON ITS AT-WORK LEAVING (DESIGN.md §8
 * "At work on the mat": "A pane an agent's run made leaves the desk on that leaving (`whenAtWorkLeft`): 495ms after the
 * last agent at work on it stops, at once when none was, and never later than 4 s after its run's end"). The one path a
 * run's pane leaves by (`made-panes.ts`) waits out the mark's leaving when its run's page was closed, and takes a page
 * that never reached the window off at once (it has no presence row, so it never will wait). It resolves the pane by
 * its durable key when it takes it off, never by an entity read before the wait, and a mount that goes takes nothing
 * off after it. CanvasStage's run's-end site leaves by it, and its teardown disposes it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Editing, type Entity, guardedTransaction } from "@vibecook/ice";
import { NOTE_TYPE } from "@vibecook/ice/desk/objects";
import { OBJECT_ROOM, type ObjectsPresenceSnapshot } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeskApplier } from "../src/field/desk/agent/applier";
import { madePaneLeaving } from "../src/field/desk/agent/made-panes";
import { AT_WORK_LEAVE_MS } from "../src/field/desk/at-work/at-work-model";
import { type AtWorkStore, createAtWorkStore } from "../src/field/desk/at-work/at-work-store";
import type { MountedDesk } from "../src/field/desk/desk-door";
import { buildRegistry, createFieldEngine } from "../src/field-engine";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A desk with one pane laid on it (a note stands in: the path takes any object), and its durable key. */
function board() {
  const ce = createFieldEngine(buildRegistry());
  ce.docs.create();
  ce.step(1);
  const desk = {
    engine: ce,
    handle: {} as never,
    generation: 1,
    mount: 0,
    theme: "light",
    docId: "doc-1",
  } as MountedDesk;
  const applier = createDeskApplier(desk, { onCanvas: () => true, handOn: () => false });
  const place = (): string => {
    const answer = applier.apply({
      intent: `i${Math.random()}`,
      run: "run-1",
      handle: "claude·2",
      expiresAt: Number.MAX_SAFE_INTEGER,
      op: "place",
      kind: NOTE_TYPE,
      props: {},
    } as never);
    if (!answer.ok) throw new Error(`refused: ${answer.fact}`);
    return (answer.value as { key: string }).key;
  };
  const stands = (key: string): boolean => {
    const e = ce.docs.current()?.store.resolve(key as never) as Entity | undefined;
    return e !== undefined && ce.world.isAlive(e);
  };
  return { ce, place, stands };
}

const row = (state: string, since = 1): Record<string, unknown> => ({
  run: "run-1",
  handle: "claude·2",
  agent: "agent",
  state,
  since,
});

const snapshot = (key: string, ...agents: Record<string, unknown>[]): ObjectsPresenceSnapshot => ({
  objects: [
    {
      ref: "vf:obj/pane0000",
      docId: "doc-1",
      key,
      agents: agents as ObjectsPresenceSnapshot["objects"][number]["agents"],
    },
  ],
});

const pass = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

let store: AtWorkStore;

beforeEach(() => {
  vi.useFakeTimers();
  store = createAtWorkStore(() => Date.now());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a run's pane leaves on its at-work leaving", () => {
  it("stays while an agent is at work on it, then leaves the whole leaving after its row is released", async () => {
    const { ce, place, stands } = board();
    const key = place();
    store.publish("doc-1", snapshot(key, row("reading")));
    const leaving = madePaneLeaving(ce, store);
    leaving.leave(key, "run-ended");
    await pass(1_000);
    expect(stands(key)).toBe(true);
    store.publish("doc-1", snapshot(key, row("released", 2)));
    await pass(AT_WORK_LEAVE_MS - 1);
    expect(stands(key)).toBe(true);
    await pass(1);
    expect(stands(key)).toBe(false);
  });

  it("leaves at once (after the call) when none is at work on it", async () => {
    const { ce, place, stands } = board();
    const key = place();
    const leaving = madePaneLeaving(ce, store);
    leaving.leave(key, "run-ended");
    await pass(0);
    expect(stands(key)).toBe(false);
  });

  it("leaves no later than the released row's stay after the call, a release that never comes included", async () => {
    const { ce, place, stands } = board();
    const key = place();
    store.publish("doc-1", snapshot(key, row("acting")));
    const leaving = madePaneLeaving(ce, store);
    leaving.leave(key, "run-ended");
    await pass(OBJECT_ROOM.RELEASED_SHOWN_MS - 1);
    expect(stands(key)).toBe(true);
    await pass(1);
    expect(stands(key)).toBe(false);
  });

  it("takes a page that never reached the window off at once, in the call", () => {
    const { ce, place, stands } = board();
    const key = place();
    store.publish("doc-1", snapshot(key, row("open")));
    madePaneLeaving(ce, store).leave(key, "never-reached");
    expect(stands(key)).toBe(false);
  });

  it("waits once for a key asked twice, and asks nothing of a pane gone meanwhile", async () => {
    const { ce, place, stands } = board();
    const key = place();
    store.publish("doc-1", snapshot(key, row("reading")));
    const leaving = madePaneLeaving(ce, store);
    leaving.leave(key, "run-ended");
    leaving.leave(key, "run-ended");
    await pass(0);
    expect(stands(key)).toBe(true);
    // the person deletes it while its mark is leaving: the path finds nothing to take off, and throws nothing
    const e = ce.docs.current()?.store.resolve(key as never) as Entity;
    const session = ce.docs.current();
    if (session === undefined) throw new Error("no document");
    guardedTransaction(session.store, ce.world, (tx) => tx.destroy(e), { undoable: true });
    ce.world.sync();
    store.publish("doc-1", snapshot(key, row("released", 2)));
    await pass(OBJECT_ROOM.RELEASED_SHOWN_MS);
    expect(stands(key)).toBe(false);
  });

  it("never takes it from under the person's hand: picked up during the wait, it stays when the wait ends", async () => {
    // DESIGN.md §8 "At work on the mat": "unless it is under the person's hand"; the 1f text: "never from under the
    // person's hand". The hand is read when the wait ends, not only at the loss (desk-live's probe), before it.
    const { ce, place, stands } = board();
    const key = place();
    let held = false;
    store.publish("doc-1", snapshot(key, row("reading")));
    const leaving = madePaneLeaving(ce, store, () => held);
    leaving.leave(key, "run-ended");
    store.publish("doc-1", snapshot(key, row("released", 2)));
    await pass(AT_WORK_LEAVE_MS - 1);
    held = true; // the person picks it up (⏎ or a double-click) inside the leaving
    await pass(OBJECT_ROOM.RELEASED_SHOWN_MS);
    expect(stands(key)).toBe(true);
    // put down later, it stays (desk-live's 1f closed still stands; this path is not asked again)
    held = false;
    await pass(OBJECT_ROOM.RELEASED_SHOWN_MS);
    expect(stands(key)).toBe(true);
  });

  it("reads the hand at the end of the wait as the applier does, by default (a pane ICE may let diverge)", async () => {
    const { ce, place, stands } = board();
    const key = place();
    store.publish("doc-1", snapshot(key, row("acting")));
    const leaving = madePaneLeaving(ce, store);
    leaving.leave(key, "run-ended");
    await pass(OBJECT_ROOM.RELEASED_SHOWN_MS - 1);
    // taken into the hand's editing inside the wait (the applier's own `held` read: the held entity, or one diverging)
    ce.world.addTag(ce.docs.current()?.store.resolve(key as never) as Entity, Editing);
    await pass(1);
    expect(stands(key)).toBe(true);
  });

  it("takes nothing off once its mount is disposed", async () => {
    const { ce, place, stands } = board();
    const key = place();
    store.publish("doc-1", snapshot(key, row("reading")));
    const leaving = madePaneLeaving(ce, store);
    leaving.leave(key, "run-ended");
    leaving.dispose();
    store.publish("doc-1", snapshot(key, row("released", 2)));
    await pass(OBJECT_ROOM.RELEASED_SHOWN_MS);
    expect(stands(key)).toBe(true);
    // and a leave after it is nothing
    leaving.leave(key, "run-ended");
    await pass(OBJECT_ROOM.RELEASED_SHOWN_MS);
    expect(stands(key)).toBe(true);
  });
});

describe("the run's-end site", () => {
  it("leaves by the leaver in CanvasStage, and the mount's teardown disposes it", () => {
    const stage = readFileSync(join(PACKAGE_ROOT, "src/field/CanvasStage.tsx"), "utf8");
    expect(stage).toContain("madePaneLeaving(ce)");
    expect(stage).toMatch(/madePanes\.leave\(key, /u);
    expect(stage).toContain("madePanes.dispose()");
    // the plain remove-at-once at the run's end is gone
    expect(stage).not.toContain('removeMadePane(entity, "run-ended")');
  });
});
