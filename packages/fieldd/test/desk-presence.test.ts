import type { ObjectIntent } from "@vibefield/contracts";
import { OBJECT_LIMITS, ObjectsPresenceSnapshot } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeskVerbs } from "../src/tool-plane/rooms/desk/verbs";
import {
  type Answer,
  cleanupWorlds,
  type DeskWorld,
  DOC,
  ordinaryWindow,
  world,
} from "./desk-fixtures";

// OB-4 (§7; OB-L5, OB-L6, OB-D9, OB-D11) — who is at work on what, the person's hand over everything, one holder at a
// time on a `one` kind, and the agents' separate undo, against a real DeskObjects and a scripted window.

afterEach(() => {
  cleanupWorlds();
  vi.useRealTimers();
});

const A = { runtimeRunId: "run-a" };
const B = { runtimeRunId: "run-b" };

function room(h: DeskWorld, respond: (i: ObjectIntent) => Answer | undefined = ordinaryWindow) {
  return { verbs: createDeskVerbs({ objects: h.desk }), win: h.window(respond) };
}

function handed(h: DeskWorld, key = "k1", to: string[] = ["run-a"], kind = "desk.note") {
  const ref = h.refOf(key, kind);
  for (const run of to) h.desk.hand(ref, run);
  return ref;
}

const statesOn = (h: DeskWorld, ref: string) =>
  ObjectsPresenceSnapshot.parse(h.desk.presence.snapshot()).objects.find((o) => o.ref === ref)
    ?.agents;

describe("the states of §7", () => {
  it("says open once an object is open, reading while a read is in flight, acting while an act is", async () => {
    let t = 100;
    const h = world({ now: () => t });
    const { verbs } = room(h, (intent) =>
      intent.op === "read" ? undefined : ordinaryWindow(intent),
    );
    const ref = handed(h);
    await verbs.object_open(A, { ref });
    expect(statesOn(h, ref)).toEqual([
      { run: "run-a", handle: "claude·a", agent: "claude", state: "open", since: 100 },
    ]);
    t = 200;
    void verbs.object_read(A, { ref, tool: "read_text" });
    await Promise.resolve();
    expect(statesOn(h, ref)?.[0]).toMatchObject({ state: "reading", since: 200 });
  });

  it("drops back to open when the answer arrives, and says failed for an operation that failed", async () => {
    const h = world();
    let failing = false;
    const { verbs } = room(h, (intent) => {
      if (intent.op === "act" && failing) return { ok: false, fact: "failed", text: "It broke." };
      return ordinaryWindow(intent);
    });
    const ref = handed(h);
    await verbs.object_act(A, { doing: "Change", ref, tool: "write_text", input: { text: "a" } });
    expect(statesOn(h, ref)?.[0]?.state).toBe("open");
    failing = true;
    await verbs
      .object_act(A, { doing: "Change", ref, tool: "write_text", input: { text: "b" } })
      .catch(() => undefined);
    expect(statesOn(h, ref)?.[0]?.state).toBe("failed");
  });

  it("says needs-you when the window says so", async () => {
    const h = world();
    const { verbs } = room(h, (intent) =>
      intent.op === "act" ? { ok: false, fact: "needs-you", text: "Sign in first." } : undefined,
    );
    const ref = handed(h);
    await verbs
      .object_act(A, { doing: "Change", ref, tool: "write_text", input: { text: "a" } })
      .catch(() => undefined);
    expect(statesOn(h, ref)?.[0]?.state).toBe("needs-you");
  });

  it("says released, stays long enough to be seen leaving, then goes", async () => {
    vi.useFakeTimers();
    const h = world({ releasedShownMs: 1_000 });
    const { verbs } = room(h);
    const ref = handed(h);
    await verbs.object_open(A, { ref });
    await verbs.object_release(A, { ref });
    expect(statesOn(h, ref)?.[0]?.state).toBe("released");
    expect(h.desk.presence.agentsOn(ref)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(statesOn(h, ref)).toBeUndefined();
  });

  it("drops an object from every list when the window says it is gone", async () => {
    const h = world();
    const { verbs } = room(h, (intent) => {
      if (intent.op === "read") return { ok: false, fact: "gone", text: "It's gone." };
      return ordinaryWindow(intent);
    });
    const ref = handed(h);
    await verbs.object_open(A, { ref });
    await verbs.object_read(A, { ref, tool: "read_text" }).catch(() => undefined);
    expect(statesOn(h, ref)).toBeUndefined();
  });

  it("takes an agent off every object when its run ends", async () => {
    vi.useFakeTimers();
    const h = world({ releasedShownMs: 1_000 });
    const { verbs } = room(h);
    const ref = handed(h, "k1");
    await verbs.object_open(A, { ref });
    h.desk.runEnded("run-a");
    expect(statesOn(h, ref)?.[0]?.state).toBe("released");
  });

  it("tells each list who else is on an object", async () => {
    const h = world();
    const { verbs } = room(h);
    const ref = handed(h, "k1", ["run-a", "run-b"]);
    await verbs.object_open(A, { ref });
    const manual = (await verbs.object_open(B, { ref })) as {
      object: { agents: { handle: string; state: string }[] };
    };
    expect(manual.object.agents).toEqual([
      { handle: "claude·a", state: "open" },
      { handle: "claude·b", state: "open" },
    ]);
  });
});

describe("the person's hand wins (OB-L5)", () => {
  it("pauses every agent on an object, answers acts held, and picks up where each was when it lifts", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const ref = handed(h, "k1", ["run-a", "run-b"]);
    await verbs.object_open(A, { ref });
    await verbs.object_open(B, { ref });
    h.desk.held(DOC, "k1", true);
    expect(statesOn(h, ref)?.map((a) => a.state)).toEqual(["paused", "paused"]);
    const sentBefore = win.seen.length;
    await expect(
      verbs.object_act(A, { doing: "Change", ref, tool: "write_text", input: { text: "a" } }),
    ).rejects.toMatchObject({ details: { fact: "held" }, retryable: true });
    expect(win.seen.length).toBe(sentBefore);
    h.desk.held(DOC, "k1", false);
    expect(statesOn(h, ref)?.map((a) => a.state)).toEqual(["open", "open"]);
  });

  it("forgets a hand when the window that held it closes: nobody is left to lift it", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const ref = handed(h);
    await verbs.object_open(A, { ref });
    h.desk.held(DOC, "k1", true);
    win.dispose();
    expect(statesOn(h, ref)?.[0]?.state).toBe("open");
    expect(h.desk.presence.isHeld(ref)).toBe(false);
  });

  it("ignores a hand on an object no agent has ever been named on", () => {
    const h = world();
    expect(() => h.desk.held(DOC, "nobody-named-this", true)).not.toThrow();
    expect(h.desk.presence.snapshot().objects).toEqual([]);
  });
});

describe("one holder at a time on a `one` kind (OB-D9)", () => {
  /** Two runs that both hold a `one` kind: the kind was unknown when the second was handed it. */
  const bothHold = (h: DeskWorld) => {
    const ref = h.refOf("page");
    h.desk.hand(ref, "run-a");
    h.desk.hand(ref, "run-b");
    h.desk.registry.setKind(ref, "vibefield.page");
    return ref;
  };

  it("lets the holder act and answers busy to another, who waits", async () => {
    const h = world();
    const { verbs } = room(h);
    const ref = bothHold(h);
    await verbs.object_act(A, { doing: "Click", ref, tool: "click" });
    await expect(verbs.object_act(B, { doing: "Click", ref, tool: "click" })).rejects.toMatchObject(
      { details: { fact: "busy" }, retryable: true },
    );
    const presence = h.desk.presence.snapshot().objects[0];
    expect(presence?.holder).toBe("run-a");
    expect(presence?.waiters).toEqual(["run-b"]);
  });

  it("frees the lease on release, so a waiter's next act holds it", async () => {
    const h = world();
    const { verbs } = room(h);
    const ref = bothHold(h);
    await verbs.object_act(A, { doing: "Click", ref, tool: "click" });
    await verbs.object_act(B, { doing: "Click", ref, tool: "click" }).catch(() => undefined);
    await verbs.object_release(A, { ref });
    await verbs.object_act(B, { doing: "Click", ref, tool: "click" });
    expect(h.desk.presence.snapshot().objects[0]?.holder).toBe("run-b");
  });

  it("handing it to another moves it, and the first gets not-handed", async () => {
    const h = world();
    const { verbs } = room(h);
    const ref = handed(h, "page", ["run-a"], "vibefield.page");
    await verbs.object_act(A, { doing: "Click", ref, tool: "click" });
    expect(h.desk.hand(ref, "run-b")).toEqual({ handed: true });
    await expect(verbs.object_act(A, { doing: "Click", ref, tool: "click" })).rejects.toMatchObject(
      { details: { fact: "not-handed" } },
    );
    expect(h.desk.presence.holderOf(ref)).toBe("run-b");
    await expect(
      verbs.object_act(B, { doing: "Click", ref, tool: "click" }),
    ).resolves.toBeDefined();
  });

  it("lets a many kind have everyone act at once", async () => {
    const h = world();
    const { verbs } = room(h);
    const ref = handed(h, "k1", ["run-a", "run-b"]);
    await verbs.object_act(A, { doing: "Change", ref, tool: "write_text", input: { text: "a" } });
    await verbs.object_act(B, { doing: "Change", ref, tool: "write_text", input: { text: "b" } });
    expect(h.desk.presence.snapshot().objects[0]?.holder).toBeUndefined();
  });
});

describe("the agent's own undo (OB-D11 A)", () => {
  it("offers what the agent last changed, undoes it newest first, and sends the kept inverse", async () => {
    const h = world();
    let n = 0;
    const { verbs, win } = room(h, (intent) => {
      if (intent.op === "act") {
        n += 1;
        return { ok: true, value: {}, inverse: { was: n }, changed: `Change ${n}` };
      }
      return ordinaryWindow(intent);
    });
    const ref = handed(h);
    await verbs.object_act(A, { doing: "One", ref, tool: "write_text", input: { text: "a" } });
    await verbs.object_act(A, { doing: "Two", ref, tool: "write_text", input: { text: "b" } });
    expect(statesOn(h, ref)?.[0]?.lastChange).toEqual({ label: "Change 2" });
    await expect(h.desk.undoAgent(ref, "run-a")).resolves.toEqual({
      undone: true,
      changed: "Change 2",
    });
    expect(win.seen.at(-1)).toMatchObject({ op: "undo", key: "k1", inverse: { was: 2 } });
    expect(statesOn(h, ref)?.[0]?.lastChange).toEqual({ label: "Change 1" });
    await h.desk.undoAgent(ref, "run-a");
    expect(statesOn(h, ref)?.[0]?.lastChange).toBeUndefined();
    await expect(h.desk.undoAgent(ref, "run-a")).resolves.toMatchObject({ undone: false });
  });

  it("keeps each agent's undo its own", async () => {
    const h = world();
    const { verbs } = room(h);
    const ref = handed(h, "k1", ["run-a", "run-b"]);
    await verbs.object_act(A, { doing: "One", ref, tool: "write_text", input: { text: "a" } });
    await expect(h.desk.undoAgent(ref, "run-b")).resolves.toMatchObject({ undone: false });
    await expect(h.desk.undoAgent(ref, "run-a")).resolves.toMatchObject({ undone: true });
  });

  it("drops a change that can never come good (a conflict), and keeps one that waits on the person", async () => {
    const h = world();
    let answer: Answer = { ok: false, fact: "held", text: "Hands off." };
    const { verbs } = room(h, (intent) => {
      if (intent.op === "undo") return answer;
      return ordinaryWindow(intent);
    });
    const ref = handed(h);
    await verbs.object_act(A, { doing: "One", ref, tool: "write_text", input: { text: "a" } });
    await expect(h.desk.undoAgent(ref, "run-a")).resolves.toEqual({
      undone: false,
      reason: "Hands off.",
    });
    expect(statesOn(h, ref)?.[0]?.lastChange).toBeDefined();
    answer = { ok: false, fact: "conflict", text: "It has changed since." };
    await expect(h.desk.undoAgent(ref, "run-a")).resolves.toEqual({
      undone: false,
      reason: "It has changed since.",
    });
    expect(statesOn(h, ref)?.[0]?.lastChange).toBeUndefined();
  });

  it("remaps a removed object's ref to the key its undo re-spawned it under", async () => {
    const h = world();
    const { verbs } = room(h, (intent) => {
      if (intent.op === "undo") return { ok: true, value: { key: "k-reborn" } };
      return ordinaryWindow(intent);
    });
    const ref = h.refOf("gone-key", "desk.note");
    h.desk.registry.grant(ref, "run-a", "placed");
    await verbs.canvas_remove(A, { ref });
    await expect(h.desk.undoAgent(ref, "run-a")).resolves.toMatchObject({ undone: true });
    expect(h.desk.resolve(ref)).toEqual({ docId: DOC, key: "k-reborn" });
    expect(h.desk.registry.find(DOC, "k-reborn")).toBe(ref);
    expect(h.desk.registry.find(DOC, "gone-key")).toBeUndefined();
  });

  it("takes a placed object off the desk's lists when its placing is undone", async () => {
    const h = world();
    const { verbs } = room(h);
    const manual = (await verbs.canvas_place(A, { kind: "desk.note", title: "New" })) as {
      object: { ref: string };
    };
    await h.desk.undoAgent(manual.object.ref, "run-a");
    expect(statesOn(h, manual.object.ref)).toBeUndefined();
  });

  it("keeps UNDO_KEPT changes per board, the oldest falling off, and stops offering what fell", async () => {
    const h = world();
    const { verbs } = room(h);
    const ref = handed(h);
    const other = handed(h, "k2");
    await verbs.object_act(A, {
      doing: "First",
      ref: other,
      tool: "write_text",
      input: { text: "a" },
    });
    for (let i = 0; i < OBJECT_LIMITS.UNDO_KEPT; i += 1)
      await verbs.object_act(A, { doing: `${i}`, ref, tool: "write_text", input: { text: "a" } });
    expect(statesOn(h, other)?.[0]?.lastChange).toBeUndefined();
    await expect(h.desk.undoAgent(other, "run-a")).resolves.toMatchObject({ undone: false });
  });
});

describe("the feed (`objects.presence.subscribe`)", () => {
  it("is whole lists of the contract's shape, and says what changed", async () => {
    const h = world();
    const { verbs } = room(h);
    let frames = 0;
    const off = h.desk.presence.onChange(() => {
      frames += 1;
    });
    const ref = handed(h);
    await verbs.object_open(A, { ref });
    expect(frames).toBeGreaterThan(0);
    const snap = h.desk.presence.snapshot();
    expect(ObjectsPresenceSnapshot.safeParse(snap).success).toBe(true);
    expect(snap.objects[0]).toMatchObject({ ref, docId: DOC, key: "k1" });
    off();
  });
});
