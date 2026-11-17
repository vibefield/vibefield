import type { ObjectIntent, ObjectManual } from "@vibefield/contracts";
import { OBJECT_LIMITS, OBJECT_ROOM } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeskKind } from "../src/objects/kinds";
import { AgentUndoShelf, type KeptChange } from "../src/objects/undo";
import { createDeskVerbs } from "../src/tool-plane/rooms/desk/verbs";
import {
  cleanupWorlds,
  type DeskWorld,
  DOC,
  NOTE,
  ordinaryWindow,
  PAGE,
  world,
} from "./desk-fixtures";

// The independent review of OB-3 and OB-4: each of these is a way the room could say something untrue or lose something
// the person is owed, reproduced first.
//
// Given an injected `bornFor`, `marks` and (where a row gives one) `key`: every row here builds its desk through
// desk-fixtures.ts, which hands the store and the desk those collaborators, and shows the store's rule given them.
// That production binds the real ones is proved by the rows through the real daemon,
// `packages/fieldd/test/custody-boot.test.ts`.

afterEach(() => {
  cleanupWorlds();
  vi.useRealTimers();
});

const A = { runtimeRunId: "run-a" };
const B = { runtimeRunId: "run-b" };

const quietWindow = (h: DeskWorld) => h.window(() => undefined);

function handed(h: DeskWorld, key = "k1", kind = "desk.note", to = "run-a") {
  const ref = h.refOf(key, kind);
  h.desk.hand(ref, to);
  return ref;
}

const answer = (h: DeskWorld, intent: ObjectIntent | undefined, value: unknown) =>
  h.desk.intents.answer(
    { intent: intent?.intent ?? "", ok: true, value, inverse: { was: 1 }, changed: "Changed" },
    "tok-window",
  );

const rowOn = (h: DeskWorld, ref: string, run: string) =>
  h.desk.presence
    .snapshot()
    .objects.find((o) => o.ref === ref)
    ?.agents.find((a) => a.run === run);

describe("a late answer revives nothing (presence, §7; MT-L4)", () => {
  it("leaves a taken-back agent released when its read's answer arrives, and goes on to leave", async () => {
    vi.useFakeTimers();
    const h = world({ releasedShownMs: 1_000 });
    const verbs = createDeskVerbs({ objects: h.desk });
    const win = quietWindow(h);
    const ref = handed(h);
    const read = verbs.object_read(A, { ref, tool: "read_text" }).catch((err: unknown) => err);
    await Promise.resolve();
    h.desk.takeBack(ref, "run-a");
    answer(h, win.seen[0], { text: "secret" });
    await expect(read).resolves.toMatchObject({ details: { fact: "not-handed" } });
    expect(rowOn(h, ref, "run-a")?.state).toBe("released");
    await vi.advanceTimersByTimeAsync(1_001);
    expect(rowOn(h, ref, "run-a")).toBeUndefined();
  });

  it("does not put a taken-back agent on the object when its open is answered", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    const win = quietWindow(h);
    const ref = handed(h);
    const opened = verbs.object_open(A, { ref }).catch((err: unknown) => err);
    h.desk.takeBack(ref, "run-a");
    answer(h, win.seen[0], {
      kind: "desk.note",
      title: "t",
      now: "words",
      heldByUser: false,
      onScreen: true,
    });
    await expect(opened).resolves.toMatchObject({ details: { fact: "not-handed" } });
    expect(rowOn(h, ref, "run-a")).toBeUndefined();
  });

  it("still tells an act's answer, and keeps its undo: the change happened", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    const win = quietWindow(h);
    const ref = handed(h);
    const acted = verbs.object_act(A, {
      doing: "Change",
      ref,
      tool: "write_text",
      input: { text: "a" },
    });
    h.desk.takeBack(ref, "run-a");
    answer(h, win.seen[0], { done: true });
    await expect(acted).resolves.toMatchObject({ changed: "Changed" });
    expect(h.desk.undo.newest(DOC, ref, "run-a")?.label).toBe("Changed");
    expect(rowOn(h, ref, "run-a")?.state).toBe("released");
  });

  it("does not grant a placed object to a run that ended while the window placed it", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    const win = quietWindow(h);
    const placed = verbs.canvas_place(A, { kind: "desk.note" }).catch((err: unknown) => err);
    h.runs.set("run-a", "ended");
    h.desk.runEnded("run-a");
    answer(h, win.seen[0], {
      key: "k9",
      kind: "desk.note",
      title: "Made",
      now: "",
      heldByUser: false,
      onScreen: true,
    });
    await expect(placed).resolves.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "desk", state: "run-ended" },
    });
    expect(h.desk.grants()).toEqual([]);
  });
});

describe("a store that could not be read refuses before the desk is touched", () => {
  it("canvas_place asks the window nothing, so no object is orphaned", async () => {
    const h = world({
      readFile: (path) => {
        if (path.endsWith(".json")) throw Object.assign(new Error("EMFILE"), { code: "EMFILE" });
        return "";
      },
    });
    h.refOf("seed");
    const failed = h.reopen();
    const verbs = createDeskVerbs({ objects: failed });
    const sent: ObjectIntent[] = [];
    failed.subscribeDesk(DOC, "tok-window", (intent) => sent.push(intent));
    await expect(verbs.canvas_place(A, { kind: "desk.note" })).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "objects" },
    });
    expect(sent).toEqual([]);
  });
});

describe("a one kind's lease does not stick (OB-D9)", () => {
  const sparkPage = (h: DeskWorld) => {
    h.sparks.set("sp-7k2m9q4x", "Vela");
    for (const run of ["run-1", "run-2"]) {
      h.sparkRuns.set(run, "sp-7k2m9q4x");
      h.runs.set(run, "live");
    }
    return handed(h, "page", PAGE.kind, "run-1");
  };

  it("is the holder's, so a spark's next run is not told busy by its last", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(ordinaryWindow);
    const ref = sparkPage(h);
    await verbs.object_act({ runtimeRunId: "run-1" }, { doing: "Click", ref, tool: "click" });
    await verbs.object_act({ runtimeRunId: "run-2" }, { doing: "Click", ref, tool: "click" });
    expect(h.desk.presence.snapshot().objects[0]?.holder).toBe("run-2");
  });

  it("is dropped by a take-back even with no row on the object", () => {
    const h = world();
    const ref = handed(h, "page", PAGE.kind);
    h.desk.presence.claim(ref, "run-a");
    h.desk.takeBack(ref, "run-a");
    expect(h.desk.presence.holderOf(ref)).toBeUndefined();
  });

  it("clears who was waiting when the holder lets go: they ask again", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(ordinaryWindow);
    const ref = h.refOf("page");
    h.desk.hand(ref, "run-a");
    h.desk.hand(ref, "run-b");
    h.desk.registry.setKind(ref, PAGE.kind);
    await verbs.object_act(A, { doing: "Click", ref, tool: "click" });
    await verbs.object_act(B, { doing: "Click", ref, tool: "click" }).catch(() => undefined);
    expect(h.desk.presence.snapshot().objects[0]?.waiters).toEqual(["run-b"]);
    await verbs.object_release(A, { ref });
    expect(h.desk.presence.snapshot().objects[0]?.waiters).toBeUndefined();
  });
});

describe("the window cannot act on an intent fieldd has given up on (undo, OB-D11)", () => {
  it("carries when the intent expires: the answer's deadline, in ms since the epoch", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    const win = quietWindow(h);
    void verbs.object_open(A, { ref: handed(h) }).catch(() => undefined);
    expect(win.seen[0]?.expiresAt).toBe(1_000_000 + OBJECT_LIMITS.INTENT_ANSWER_MS);
  });
});

describe("the agent's undo is not sent twice (OB-D11)", () => {
  it("answers a second undo while the first is in flight, and sends one", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    const win = h.window((intent) => (intent.op === "undo" ? undefined : ordinaryWindow(intent)));
    const ref = handed(h);
    await verbs.object_act(A, { doing: "Change", ref, tool: "write_text", input: { text: "a" } });
    const first = h.desk.undoAgent(ref, "run-a");
    await expect(h.desk.undoAgent(ref, "run-a")).resolves.toMatchObject({ undone: false });
    expect(win.seen.filter((i) => i.op === "undo")).toHaveLength(1);
    const undo = win.seen.find((i) => i.op === "undo");
    h.desk.intents.answer({ intent: undo?.intent ?? "", ok: true, value: {} }, "tok-window");
    await expect(first).resolves.toMatchObject({ undone: true });
  });

  it("can try again when the first attempt did not land", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    let refusing = true;
    h.window((intent) => {
      if (intent.op !== "undo") return ordinaryWindow(intent);
      return refusing ? { ok: false, fact: "held", text: "Hands off." } : { ok: true, value: {} };
    });
    const ref = handed(h);
    await verbs.object_act(A, { doing: "Change", ref, tool: "write_text", input: { text: "a" } });
    await expect(h.desk.undoAgent(ref, "run-a")).resolves.toMatchObject({ undone: false });
    refusing = false;
    await expect(h.desk.undoAgent(ref, "run-a")).resolves.toMatchObject({ undone: true });
  });
});

describe("a kind's schema is read as written", () => {
  const withInput = (input: Record<string, unknown>, name = "go"): DeskKind => ({
    ...NOTE,
    tools: [{ name, readOnly: false, description: "Go.", input }],
  });

  it("takes two tools whose schemas share an $id", async () => {
    const id = { $id: "https://example.com/input", type: "object" };
    const h = world({
      kinds: [
        {
          ...NOTE,
          tools: [...withInput({ ...id }, "one").tools, ...withInput({ ...id }, "two").tools],
        },
      ],
    });
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(ordinaryWindow);
    const ref = handed(h);
    await verbs.object_act(A, { doing: "Go", ref, tool: "one" });
    await expect(verbs.object_act(A, { doing: "Go", ref, tool: "two" })).resolves.toBeDefined();
  });

  it("refuses a `format` VibeField would not check, and sends nothing unchecked to the window", async () => {
    const h = world({
      kinds: [
        withInput({
          type: "object",
          properties: { at: { type: "string", format: "date-time" } },
        }),
      ],
    });
    const verbs = createDeskVerbs({ objects: h.desk });
    const win = h.window(ordinaryWindow);
    await expect(
      verbs.object_act(A, { doing: "Go", ref: handed(h), tool: "go", input: { at: "not a date" } }),
    ).rejects.toMatchObject({ details: { fact: "failed" } });
    expect(win.seen).toEqual([]);
  });

  it("still takes a property that happens to be named format", async () => {
    const h = world({
      kinds: [withInput({ type: "object", properties: { format: { type: "string" } } })],
    });
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(ordinaryWindow);
    await expect(
      verbs.object_act(A, { doing: "Go", ref: handed(h), tool: "go", input: { format: "md" } }),
    ).resolves.toBeDefined();
  });
});

describe("the manual's bounds are bytes (§5.4)", () => {
  it("cuts a guide by bytes, at a whole character", async () => {
    const h = world({ kinds: [{ ...NOTE, guide: "é".repeat(OBJECT_LIMITS.GUIDE_BYTES) }] });
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(ordinaryWindow);
    const manual = (await verbs.object_open(A, { ref: handed(h) })) as ObjectManual;
    expect(Buffer.byteLength(manual.guide ?? "")).toBeLessThanOrEqual(OBJECT_LIMITS.GUIDE_BYTES);
    expect(manual.guide?.length).toBeGreaterThan(0);
    expect(manual.guide?.endsWith("�")).toBe(false);
  });

  it("trims an over-budget manual's guide rather than dropping it, and says so", async () => {
    const tool = (i: number) => ({
      name: `tool${i}`,
      readOnly: true,
      description: "x".repeat(2_000),
      input: { type: "object", properties: {} },
    });
    const h = world({
      kinds: [
        {
          ...NOTE,
          guide: "y".repeat(OBJECT_LIMITS.GUIDE_BYTES),
          tools: Array.from({ length: 9 }, (_, i) => tool(i)),
        },
      ],
    });
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(ordinaryWindow);
    const manual = (await verbs.object_open(A, { ref: handed(h) })) as ObjectManual & {
      leftOut?: string[];
    };
    expect(Buffer.byteLength(JSON.stringify(manual))).toBeLessThanOrEqual(
      OBJECT_LIMITS.MANUAL_BYTES,
    );
    expect(manual.guide?.length).toBeGreaterThan(0);
    expect(manual.tools).toHaveLength(9);
    expect(manual.leftOut).toEqual(["guide"]);
  });
});

describe("a guide is said as whose it is (§11, MT-L6)", () => {
  it("names the plugin a guide came from, and marks none of VibeField's own", async () => {
    const h = world({
      kinds: [
        { ...NOTE, guideFrom: "Mind Maps" },
        { ...NOTE, kind: "desk.own" },
      ],
    });
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window((intent) =>
      intent.op === "open"
        ? {
            ok: true,
            value: {
              kind: intent.key === "own" ? "desk.own" : "desk.note",
              title: "t",
              now: "",
              heldByUser: false,
              onScreen: true,
            },
          }
        : undefined,
    );
    const manual = (await verbs.object_open(A, { ref: handed(h) })) as ObjectManual & {
      guideIs?: string;
    };
    expect(manual.guideIs).toContain("Mind Maps");
    const own = (await verbs.object_open(A, {
      ref: handed(h, "own", "desk.own"),
    })) as ObjectManual & {
      guideIs?: string;
    };
    expect(own.guideIs).toBeUndefined();
  });
});

describe("one agent cannot erase the person's undo (OB-D11)", () => {
  const change = (ref: string, holder: string, label = "c"): KeptChange => ({
    op: "act",
    ref,
    holder,
    key: ref,
    inverse: {},
    label,
  });

  it("bounds each agent on each object, so a chatty one leaves the others' alone", () => {
    const shelf = new AgentUndoShelf();
    shelf.keep(DOC, change("vf:obj/aaaaaaaa", "quiet", "quiet's"));
    shelf.keep(DOC, change("vf:obj/bbbbbbbb", "chatty", "chatty's first"));
    for (let i = 0; i < OBJECT_LIMITS.UNDO_KEPT; i += 1)
      shelf.keep(DOC, change("vf:obj/bbbbbbbb", "chatty", `${i}`));
    expect(shelf.newest(DOC, "vf:obj/aaaaaaaa", "quiet")?.label).toBe("quiet's");
    expect(shelf.newest(DOC, "vf:obj/bbbbbbbb", "chatty")?.label).toBe(
      `${OBJECT_LIMITS.UNDO_KEPT - 1}`,
    );
    expect(shelf.size(DOC)).toBe(OBJECT_LIMITS.UNDO_KEPT + 1);
  });

  it("holds a whole board to a ceiling of its own, the oldest going first", () => {
    const shelf = new AgentUndoShelf();
    const refOf = (i: number) => `vf:obj/${String(i).padStart(8, "0")}`;
    const fell: KeptChange[] = [];
    for (let i = 0; i <= OBJECT_ROOM.UNDO_BOARD_CEILING; i += 1)
      fell.push(...shelf.keep(DOC, change(refOf(i), "h")));
    expect(shelf.size(DOC)).toBe(OBJECT_ROOM.UNDO_BOARD_CEILING);
    expect(fell.map((c) => c.ref)).toEqual([refOf(0)]);
    expect(shelf.newest(DOC, refOf(0), "h")).toBeUndefined();
    expect(shelf.newest(DOC, refOf(500), "h")).toBeDefined();
  });
});
