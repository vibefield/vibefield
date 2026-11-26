// @vitest-environment node
/**
 * Item 550 (2026-11-18) — THE AT-WORK STORE and the rows it holds (DESIGN.md §8 "At work on the mat"; item 550a's ids).
 * The window's one reading of who is at work on the mounted board's objects, fed by the applier's own presence feed
 * (never a second subscription): it keeps one board, by object key; it reads each row tolerantly, keeping item 550a's
 * ids (`project`, `spark`, `startedBy`) only when each is well-typed; it is stable between changes, for
 * `useSyncExternalStore`; and it is EMPTY whenever no feed stands — the applier clears it when it stops, when the feed
 * ends or is refused, and when the client leaves ready — so nothing on the desk claims work. The first board after a
 * clear (the replay's snapshot) LANDS its runs: already at work, never arriving.
 *
 * The rows under "the applier keeps it" are red until item 550's half of the applier lands in `applier.ts`: the
 * publish, the clears, and the door's `ready`.
 */
import type { ObjectsPresenceSnapshot } from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DeskAgentDoor,
  deskAgentDoorOver,
  followDeskAgent,
} from "../src/field/desk/agent/applier";
import { readAtWorkRow } from "../src/field/desk/at-work/at-work-rows";
import {
  type AtWorkStore,
  atWorkStore,
  createAtWorkStore,
} from "../src/field/desk/at-work/at-work-store";
import { type MountedDesk, publishDesk } from "../src/field/desk/desk-door";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { type RendererLogger, setRendererLogger } from "../src/logging";

const SPARK = "sp-vela0001";
const OTHER_SPARK = "sp-lyra0001";

const agent = (run: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  run,
  handle: `${run} in vibe-field`,
  agent: "agent",
  state: "open",
  since: 1,
  ...extra,
});

const object = (
  key: string,
  agents: readonly Record<string, unknown>[],
  docId = "doc-1",
): ObjectsPresenceSnapshot["objects"][number] => ({
  ref: `vf:obj/${key.padEnd(8, "0").slice(0, 8)}`,
  docId,
  key,
  agents: agents as ObjectsPresenceSnapshot["objects"][number]["agents"],
});

const snapshot = (...objects: ObjectsPresenceSnapshot["objects"]): ObjectsPresenceSnapshot => ({
  objects,
});

const runsOf = (store: AtWorkStore, key: string): string[] =>
  store
    .current("doc-1")
    .objects.get(key)
    ?.agents.map((row) => row.run) ?? [];

describe("the rows — the contract's row and item 550a's ids, read tolerantly", () => {
  it("keeps the project, the spark and the spark that started the run when each is well-typed", () => {
    const row = readAtWorkRow(
      agent("r", {
        project: { name: "vibe-field", seq: 3, ink: 41 },
        spark: SPARK,
        startedBy: OTHER_SPARK,
        lastChange: { label: "Added 2 ideas", extra: true },
        unknown: "kept out",
      }),
    );
    expect(row).toEqual({
      run: "r",
      handle: "r in vibe-field",
      agent: "agent",
      state: "open",
      since: 1,
      lastChange: { label: "Added 2 ideas" },
      project: { name: "vibe-field", seq: 3, ink: 41 },
      spark: SPARK,
      startedBy: OTHER_SPARK,
    });
  });

  it("drops an id that is not well-typed and keeps the row without it", () => {
    const row = readAtWorkRow(
      agent("r", { project: { name: "", seq: "3", ink: -1 }, spark: "vela", startedBy: 7 }),
    );
    expect(row).toEqual({
      run: "r",
      handle: "r in vibe-field",
      agent: "agent",
      state: "open",
      since: 1,
    });
    const fractional = readAtWorkRow(agent("r", { project: { seq: 2.5, name: "x" } }));
    expect(fractional?.project).toEqual({ name: "x" });
  });

  it("reads no row the contract cannot read", () => {
    expect(readAtWorkRow({ run: "r", agent: "agent", state: "open", since: 1 })).toBeNull();
    expect(readAtWorkRow(agent("r", { state: "dancing" }))).toBeNull();
    expect(readAtWorkRow(null)).toBeNull();
  });

  it("reads a row with none of item 550a's ids, as every row reads until fieldd sends them, as no project and no spark", () => {
    // until 550a's fieldd sends the ids, this is every row: its mark wears the neutral pearl and no sticker a crew star
    // (the model's rows hold that); a pearl then is the build's honest state, never a bug
    const row = readAtWorkRow(agent("r"));
    expect(row).toEqual({
      run: "r",
      handle: "r in vibe-field",
      agent: "agent",
      state: "open",
      since: 1,
    });
    expect(row?.project).toBeUndefined();
    expect(row?.spark).toBeUndefined();
    expect(row?.startedBy).toBeUndefined();
  });
});

describe("the store", () => {
  it("keeps the board it is told, by key: the objects agents are at work on, their readable rows", () => {
    const store = createAtWorkStore();
    store.publish(
      "doc-1",
      snapshot(
        object("k1", [agent("a"), { run: "unreadable" }, agent("b")]),
        object("k2", [agent("c")], "doc-2"),
        object("k3", []),
      ),
    );
    const board = store.current("doc-1");
    expect(board.docId).toBe("doc-1");
    expect([...board.objects.keys()]).toEqual(["k1"]);
    expect(runsOf(store, "k1")).toEqual(["a", "b"]);
  });

  it("answers an empty board to any other board, and the same object each time until a change", () => {
    const store = createAtWorkStore();
    store.publish("doc-1", snapshot(object("k1", [agent("a")])));
    const elsewhere = store.current("doc-2");
    expect(elsewhere.objects.size).toBe(0);
    expect(store.current("doc-2")).toBe(elsewhere);
    const here = store.current("doc-1");
    expect(store.current("doc-1")).toBe(here);
    store.publish("doc-1", snapshot(object("k1", [agent("a"), agent("b")])));
    expect(store.current("doc-1")).not.toBe(here);
  });

  it("replaces one board with another", () => {
    const store = createAtWorkStore();
    store.publish("doc-1", snapshot(object("k1", [agent("a")])));
    store.publish("doc-2", snapshot(object("k9", [agent("z")], "doc-2")));
    expect(store.current("doc-1").objects.size).toBe(0);
    expect([...store.current("doc-2").objects.keys()]).toEqual(["k9"]);
  });

  it("tells its listeners of a change, never of an unmoved board, and nothing once they leave", () => {
    const store = createAtWorkStore();
    const heard = vi.fn();
    const off = store.subscribe(heard);
    store.publish("doc-1", snapshot(object("k1", [agent("a")])));
    store.publish("doc-1", snapshot(object("k1", [agent("a")])));
    expect(heard).toHaveBeenCalledTimes(1);
    store.publish("doc-1", snapshot(object("k1", [agent("a", { state: "reading", since: 2 })])));
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    store.publish("doc-1", snapshot(object("k1", [agent("a")])));
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("empties on a clear, counts it, and tells its listeners once; clearing an empty store tells nobody", () => {
    const store = createAtWorkStore();
    const heard = vi.fn();
    store.subscribe(heard);
    store.publish("doc-1", snapshot(object("k1", [agent("a")])));
    store.clear();
    const board = store.current("doc-1");
    expect(board.objects.size).toBe(0);
    expect(board.docId).toBeNull();
    expect(board.epoch).toBe(1);
    expect(heard).toHaveBeenCalledTimes(2);
    store.clear();
    expect(store.current("doc-1").epoch).toBe(1);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("lands the runs on the first board after a clear, and only while they stay", () => {
    const store = createAtWorkStore();
    const landed = (): string[] => [...(store.current("doc-1").landed.get("k1") ?? [])];
    store.publish("doc-1", snapshot(object("k1", [agent("a")])));
    expect(landed()).toEqual(["a"]);
    store.publish("doc-1", snapshot(object("k1", [agent("a"), agent("b")])));
    expect(landed()).toEqual(["a"]);
    store.publish("doc-1", snapshot(object("k1", [agent("b")])));
    expect(landed()).toEqual([]);
    // a landed run that left and came back arrives
    store.publish("doc-1", snapshot(object("k1", [agent("a"), agent("b")])));
    expect(landed()).toEqual([]);
    store.clear();
    store.publish("doc-1", snapshot(object("k1", [agent("a"), agent("b")])));
    expect(landed()).toEqual(["a", "b"]);
  });

  it("publishes the first board after a clear even when it reads as the board before", () => {
    const store = createAtWorkStore();
    const heard = vi.fn();
    store.subscribe(heard);
    store.publish("doc-1", snapshot(object("k1", [agent("a")])));
    store.clear();
    store.publish("doc-1", snapshot(object("k1", [agent("a")])));
    expect(heard).toHaveBeenCalledTimes(3);
    expect(runsOf(store, "k1")).toEqual(["a"]);
  });
});

describe("the applier keeps it (item 550's half of the applier)", () => {
  const QUIET: RendererLogger = {
    child: () => QUIET,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    isLevelEnabled: () => false,
  };
  const ends: (() => void)[] = [];
  afterEach(() => {
    for (const end of ends.splice(0)) end();
    atWorkStore.clear();
    vi.useRealTimers();
    setRendererLogger(QUIET);
  });

  function mount(): MountedDesk {
    const ce = createFieldEngine(buildRegistry());
    ce.docs.create();
    ce.step(1);
    return {
      engine: ce,
      handle: {} as never,
      generation: 1,
      mount: 0,
      theme: "light",
      docId: "doc-1",
    } as MountedDesk;
  }

  /** A door whose presence feed refuses its first asks with `refusals`, then opens; its readiness is the test's. */
  function wire(refusals: unknown[] = []) {
    let onSnapshot: ((payload: unknown) => void) | undefined;
    let ended: ((error: unknown) => void) | undefined;
    let onReady: ((ready: boolean) => void) | undefined;
    const value: DeskAgentDoor = {
      intents: async () => () => undefined,
      answer: async () => ({ taken: true }),
      presence: async (snapshotOf, onEnded) => {
        const refusal = refusals.shift();
        if (refusal !== undefined) throw refusal;
        onSnapshot = snapshotOf;
        ended = onEnded;
        return () => undefined;
      },
      held: async () => ({}),
      ready: (onChange) => {
        onReady = onChange;
        return () => {
          onReady = undefined;
        };
      },
    };
    return {
      value,
      send: (payload: unknown) => onSnapshot?.(payload),
      end: (error: unknown) => ended?.(error),
      ready: (ready: boolean) => onReady?.(ready),
      listening: () => onReady !== undefined,
    };
  }

  function follow(door: { readonly value: DeskAgentDoor }): () => void {
    const unpublish = publishDesk(mount());
    const stop = followDeskAgent(door.value, {});
    ends.push(stop, unpublish);
    return stop;
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const held = (key = "k1"): string[] | undefined => {
    const found = atWorkStore.current("doc-1").objects.get(key);
    return found?.agents.map((r) => r.run);
  };
  const at = snapshot(
    object("k1", [agent("a"), agent("b", { project: { seq: 2 } })]),
    object("kx", [agent("x")], "doc-2"),
  );

  it("publishes each snapshot of its own board into the window's store", async () => {
    const door = wire();
    follow(door);
    await settle();
    door.send(at);
    expect(held()).toEqual(["a", "b"]);
    expect(atWorkStore.current("doc-1").objects.has("kx")).toBe(false);
    expect(atWorkStore.current("doc-1").objects.get("k1")?.agents[1]?.project).toEqual({ seq: 2 });
  });

  it("clears it when the applier stops: a remount, a user switch", async () => {
    const door = wire();
    const stop = follow(door);
    await settle();
    door.send(at);
    const epoch = atWorkStore.current("doc-1").epoch;
    stop();
    expect(held()).toBeUndefined();
    expect(atWorkStore.current("doc-1").epoch).toBe(epoch + 1);
    expect(door.listening()).toBe(false);
  });

  it("clears it when the presence feed is ended for good", async () => {
    setRendererLogger(QUIET);
    const door = wire();
    follow(door);
    await settle();
    door.send(at);
    door.end(new FielddRpcError("NOT_FOUND", "gone", false));
    expect(held()).toBeUndefined();
  });

  it("clears it when the presence feed is refused, and the next ask's snapshot refills it, landed", async () => {
    setRendererLogger(QUIET);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // what an earlier feed left: stale rows the refusal must not leave standing
    atWorkStore.publish("doc-1", at);
    const door = wire([new FielddRpcError("UNAVAILABLE", "connection closed", true)]);
    follow(door);
    await vi.advanceTimersByTimeAsync(0);
    expect(held()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    door.send(at);
    expect(held()).toEqual(["a", "b"]);
    expect([...(atWorkStore.current("doc-1").landed.get("k1") ?? [])]).toEqual(["a", "b"]);
  });

  it("clears it when the client leaves ready, and the replay's snapshot refills it with its runs landed", async () => {
    const door = wire();
    follow(door);
    await settle();
    door.send(at);
    door.ready(false);
    expect(held()).toBeUndefined();
    door.ready(true);
    expect(held()).toBeUndefined();
    door.send(at);
    expect(held()).toEqual(["a", "b"]);
    expect([...(atWorkStore.current("doc-1").landed.get("k1") ?? [])]).toEqual(["a", "b"]);
  });

  it("never clears a board another applier holds, once it has stopped", async () => {
    const door = wire();
    const stop = follow(door);
    await settle();
    stop();
    atWorkStore.publish("doc-1", at);
    door.end(new FielddRpcError("NOT_FOUND", "gone", false));
    door.ready(false);
    expect(held()).toEqual(["a", "b"]);
  });

  it("hears the client's readiness through the door, ready or not", () => {
    const listeners = new Set<() => void>();
    const client = {
      status: "ready" as string,
      request: async () => ({}),
      subscribe: async () => ({ subId: "s", snapshot: { objects: [] }, unsubscribe() {} }),
      onStatusChange(fn: () => void) {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    };
    const door = deskAgentDoorOver(client as unknown as Parameters<typeof deskAgentDoorOver>[0]);
    const heard: boolean[] = [];
    const off = door.ready?.((ready) => heard.push(ready));
    client.status = "reconnecting";
    for (const fn of listeners) fn();
    client.status = "ready";
    for (const fn of listeners) fn();
    expect(heard).toEqual([false, true]);
    off?.();
    expect(listeners.size).toBe(0);
  });
});
