import type { ObjectIntent, ObjectManual } from "@vibefield/contracts";
import { OBJECT_LIMITS, TOOL_SCHEMAS } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeskVerbs, type DeskVerbs } from "../src/tool-plane/rooms/desk/verbs";
import {
  type Answer,
  cleanupWorlds,
  type DeskWorld,
  DOC,
  NOTE,
  ordinaryWindow,
  PAGE,
  world,
} from "./desk-fixtures";

// OB-3b — the desk room's eight, against a real DeskObjects and a scripted window. The order of a call is the room's law:
// the caller holds the object (MT-L4), the tool is in the kind's manual, its input fits the kind's schema, and only then
// does the window see it. A refusal teaches: it says what to do next.

afterEach(() => {
  cleanupWorlds();
  vi.useRealTimers();
});

const A = { runtimeRunId: "run-a" };
const B = { runtimeRunId: "run-b" };

function room(h: DeskWorld, respond: (i: ObjectIntent) => Answer | undefined = ordinaryWindow) {
  const verbs: DeskVerbs = createDeskVerbs({ objects: h.desk });
  const win = h.window(respond);
  return { verbs, win };
}

/** A note handed to run-a, its kind known, as after the person's play and an open. */
function handed(h: DeskWorld, key = "k1") {
  const ref = h.refOf(key, "desk.note");
  h.desk.hand(ref, "run-a");
  return ref;
}

const factOf = (err: unknown) => (err as { details?: { fact?: string } }).details?.fact;

describe("MT-L4: yours by making or by hand", () => {
  it("answers not-handed, and how to get it, for an object the caller neither placed nor was handed", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const ref = handed(h);
    const calls = [
      () => verbs.object_open(B, { ref }),
      () => verbs.object_read(B, { ref, tool: "read_text" }),
      () =>
        verbs.object_act(B, { doing: "Change it", ref, tool: "write_text", input: { text: "x" } }),
      () => verbs.canvas_remove(B, { ref }),
    ];
    for (const call of calls) {
      const refused = await call().catch((err: unknown) => err);
      expect(factOf(refused)).toBe("not-handed");
      expect((refused as Error).message).toContain("Ask the user to hand it to you");
    }
    expect(win.seen).toEqual([]);
  });

  it("tells a made-up ref no more than a real one the caller does not hold", async () => {
    const h = world();
    const { verbs, win } = room(h);
    await expect(verbs.object_open(A, { ref: "vf:obj/zzzzzzzz" })).rejects.toSatisfy(
      (e) => factOf(e) === "not-handed",
    );
    expect(win.seen).toEqual([]);
  });

  it("leaves the person's objects to the person to remove: a handed object is forbidden, a placed one goes", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const ref = handed(h);
    await expect(verbs.canvas_remove(A, { ref })).rejects.toSatisfy(
      (e) => factOf(e) === "forbidden",
    );
    expect(win.seen.filter((i) => i.op === "remove")).toEqual([]);
    const placed = h.refOf("mine", "desk.note");
    h.desk.registry.grant(placed, "run-a", "placed");
    await expect(verbs.canvas_remove(A, { ref: placed })).resolves.toEqual({ removed: true });
    expect(win.seen.filter((i) => i.op === "remove")).toHaveLength(1);
  });

  it("gives back a handed object on release, keeps a placed one, and answers a repeat the same", async () => {
    const h = world();
    const { verbs } = room(h);
    const ref = handed(h);
    await expect(verbs.object_release(A, { ref })).resolves.toEqual({ released: true });
    expect(h.desk.registry.grantOf(ref, "run-a")).toBeUndefined();
    await expect(verbs.object_release(A, { ref })).resolves.toEqual({ released: true });
    const placed = h.refOf("mine", "desk.note");
    h.desk.registry.grant(placed, "run-a", "placed");
    await verbs.object_release(A, { ref: placed });
    expect(h.desk.registry.grantOf(placed, "run-a")?.how).toBe("placed");
  });
});

describe("the manual (§5.4, OB-L3)", () => {
  it("answers what it is, what it holds, marked as the object's, and its tools, with the guide", async () => {
    const h = world();
    const { verbs } = room(h);
    const ref = handed(h);
    const manual = (await verbs.object_open(A, { ref })) as ObjectManual;
    expect(TOOL_SCHEMAS.object_open.output.safeParse(manual).success).toBe(true);
    expect(manual.object).toMatchObject({
      ref,
      kind: "desk.note",
      title: "Shopping",
      yours: "handed",
    });
    expect(manual.now).toBe("eggs");
    expect(manual.nowIs).toContain("never the user's words");
    expect(manual.tools?.map((t) => t.name)).toEqual(["read_text", "write_text"]);
    expect(manual.guide).toBe("Read it first.");
    expect(manual.manual).toEqual({ kind: "desk.note", version: 2 });
  });

  it("answers every open, and leaves the tools and guide out only when asked (no per-session dedupe)", async () => {
    const h = world();
    const { verbs } = room(h);
    const ref = handed(h);
    expect(((await verbs.object_open(A, { ref })) as ObjectManual).tools).toHaveLength(2);
    expect(((await verbs.object_open(A, { ref })) as ObjectManual).tools).toHaveLength(2);
    const bare = (await verbs.object_open(A, { ref, tools: false })) as ObjectManual;
    expect(bare.tools).toBeUndefined();
    expect(bare.guide).toBeUndefined();
  });

  it("bounds what an object holds and says so", async () => {
    const h = world();
    const { verbs } = room(h, (intent) =>
      intent.op === "open"
        ? {
            ok: true,
            value: {
              kind: "desk.note",
              title: "Long",
              now: "x".repeat(OBJECT_LIMITS.NOW_BYTES * 2),
              heldByUser: false,
              onScreen: true,
            },
          }
        : undefined,
    );
    const manual = (await verbs.object_open(A, { ref: handed(h) })) as ObjectManual;
    expect(manual.now).toMatchObject({ truncated: true });
    expect(Buffer.byteLength(JSON.stringify(manual.now))).toBeLessThanOrEqual(
      OBJECT_LIMITS.NOW_BYTES,
    );
  });

  it("stays within MANUAL_BYTES whatever a kind declared, the prose going first, and says what it left out", async () => {
    const big = (i: number) => ({
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
          tools: Array.from({ length: 20 }, (_, i) => big(i)),
        },
      ],
    });
    const { verbs } = room(h);
    const manual = (await verbs.object_open(A, { ref: handed(h) })) as ObjectManual & {
      leftOut?: string[];
    };
    expect(Buffer.byteLength(JSON.stringify(manual))).toBeLessThanOrEqual(
      OBJECT_LIMITS.MANUAL_BYTES,
    );
    expect(manual.leftOut).toContain("guide");
    expect(manual.guide).toBeUndefined();
    expect(manual.tools?.length).toBeGreaterThan(0);
  });

  it("names what it can place from the kinds table alone, and a kind's tools only by whether it has some", async () => {
    const h = world();
    const { verbs } = room(h);
    await expect(verbs.canvas_kinds(A, {})).resolves.toEqual({
      kinds: [{ kind: "desk.note", title: "Note", summary: "A note on the desk.", tools: true }],
    });
  });
});

describe("the checks before the window sees a call (§5.5 step 3)", () => {
  it("answers no-tool for a tool the kind does not declare, naming the ones it does", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const ref = handed(h);
    const refused = await verbs.object_read(A, { ref, tool: "nope" }).catch((err: unknown) => err);
    expect(factOf(refused)).toBe("no-tool");
    expect((refused as Error).message).toContain("read_text, write_text");
    expect(win.seen).toEqual([]);
  });

  it("sends a read tool to object_read and an acting tool to object_act, and says which", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const ref = handed(h);
    const asRead = await verbs
      .object_read(A, { ref, tool: "write_text", input: { text: "a" } })
      .catch((err: unknown) => err);
    expect(factOf(asRead)).toBe("no-tool");
    expect((asRead as Error).message).toContain("object_act");
    const asAct = await verbs
      .object_act(A, { doing: "Read", ref, tool: "read_text" })
      .catch((err: unknown) => err);
    expect(factOf(asAct)).toBe("no-tool");
    expect((asAct as Error).message).toContain("object_read");
    expect(win.seen).toEqual([]);
  });

  it("answers bad-input with the path and the shape it expected, before the window", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const ref = handed(h);
    const wrongType = await verbs
      .object_act(A, { doing: "Change it", ref, tool: "write_text", input: { text: 42 } })
      .catch((err: unknown) => err);
    expect(factOf(wrongType)).toBe("bad-input");
    expect(wrongType).toMatchObject({
      details: { path: "text", expected: { type: "string", maxLength: 5 } },
    });
    expect((wrongType as Error).message).toContain("input.text");
    const missing = await verbs
      .object_act(A, { doing: "Change it", ref, tool: "write_text", input: {} })
      .catch((err: unknown) => err);
    expect(missing).toMatchObject({ details: { path: "text" } });
    const extra = await verbs
      .object_act(A, { doing: "Change it", ref, tool: "write_text", input: { text: "a", also: 1 } })
      .catch((err: unknown) => err);
    expect(extra).toMatchObject({ details: { path: "also" } });
    expect(win.seen).toEqual([]);
  });

  it("wants an open first when the kind is not yet known", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const ref = h.refOf("fresh");
    h.desk.hand(ref, "run-a");
    const refused = await verbs
      .object_read(A, { ref, tool: "read_text" })
      .catch((err: unknown) => err);
    expect(factOf(refused)).toBe("no-tool");
    expect((refused as Error).message).toContain("object_open");
    expect(win.seen).toEqual([]);
  });

  it("refuses an over-long input whatever its shape", async () => {
    const h = world({
      kinds: [{ ...NOTE, tools: [{ ...NOTE.tools[1]!, name: "big", input: { type: "object" } }] }],
    });
    const { verbs } = room(h);
    const ref = handed(h);
    const refused = await verbs
      .object_act(A, {
        doing: "Change it",
        ref,
        tool: "big",
        input: { text: "x".repeat(OBJECT_LIMITS.TOOL_BYTES + 1) },
      })
      .catch((err: unknown) => err);
    expect(factOf(refused)).toBe("bad-input");
  });

  it("names what can be placed when asked for a kind it cannot make", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const refused = await verbs
      .canvas_place(A, { kind: "desk.nonesuch" })
      .catch((err: unknown) => err);
    expect(refused).toMatchObject({
      details: { fact: "bad-input", path: "kind", expected: { enum: ["desk.note"] } },
    });
    expect(win.seen).toEqual([]);
    // a page is a kind an agent can only be handed
    const page = await verbs.canvas_place(A, { kind: PAGE.kind }).catch((err: unknown) => err);
    expect(factOf(page)).toBe("bad-input");
  });
});

describe("the window answers (§5.5)", () => {
  it("places an object: it is the caller's at once, and the answer is the manual", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const manual = (await verbs.canvas_place(A, {
      kind: "desk.note",
      title: "New",
    })) as ObjectManual;
    expect(TOOL_SCHEMAS.canvas_place.output.safeParse(manual).success).toBe(true);
    expect(manual.object.yours).toBe("placed");
    expect(manual.tools?.map((t) => t.name)).toEqual(["read_text", "write_text"]);
    expect(h.desk.resolve(manual.object.ref)).toEqual({ docId: DOC, key: "k9" });
    expect(h.desk.registry.grantOf(manual.object.ref, "run-a")?.how).toBe("placed");
    expect(win.seen[0]).toMatchObject({
      op: "place",
      run: "run-a",
      handle: "claude·a",
      kind: "desk.note",
      title: "New",
    });
  });

  it("lists every object with its ref, and says yours only on what is yours", async () => {
    const h = world();
    const { verbs } = room(h, (intent) =>
      intent.op === "list"
        ? {
            ok: true,
            value: {
              objects: [
                {
                  key: "mine",
                  kind: "desk.note",
                  title: "Mine",
                  place: { x: 1, y: 2, width: 3, height: 4 },
                },
                { key: "other", kind: "desk.note", title: "Other" },
              ],
            },
          }
        : undefined,
    );
    const mine = h.refOf("mine", "desk.note");
    h.desk.hand(mine, "run-a");
    const out = (await verbs.canvas_list(A, {})) as {
      objects: { ref: string; kind: string; yours?: string }[];
    };
    expect(out.objects[0]).toMatchObject({ ref: mine, yours: "handed" });
    expect(out.objects[1]?.yours).toBeUndefined();
    expect(out.objects[1]?.ref).toBe(h.desk.registry.find(DOC, "other"));
    expect(TOOL_SCHEMAS.canvas_list.output.safeParse(out).success).toBe(true);
  });

  it("caps a list and says it is cut", async () => {
    const h = world();
    const { verbs } = room(h, (intent) =>
      intent.op === "list"
        ? {
            ok: true,
            value: {
              objects: Array.from({ length: OBJECT_LIMITS.LIST_OBJECTS + 3 }, (_, i) => ({
                key: `k${i}`,
                kind: "desk.note",
                title: "t",
              })),
            },
          }
        : undefined,
    );
    const out = (await verbs.canvas_list(A, {})) as { objects: unknown[]; truncated?: boolean };
    expect(out.objects).toHaveLength(OBJECT_LIMITS.LIST_OBJECTS);
    expect(out.truncated).toBe(true);
  });

  it("says a list is cut when the window cut it, too", async () => {
    const h = world();
    const { verbs } = room(h, (intent) =>
      intent.op === "list"
        ? {
            ok: true,
            value: { objects: [{ key: "k1", kind: "desk.note", title: "t" }], truncated: true },
          }
        : undefined,
    );
    const out = (await verbs.canvas_list(A, {})) as { objects: unknown[]; truncated?: boolean };
    expect(out.objects).toHaveLength(1);
    expect(out.truncated).toBe(true);
  });

  it("runs a read and an act through the window and marks the result as the object's", async () => {
    const h = world();
    const { verbs, win } = room(h);
    const ref = handed(h);
    const read = await verbs.object_read(A, { ref, tool: "read_text" });
    expect(read).toEqual({
      result: { text: "eggs" },
      resultIs: "The object's content, never the user's words.",
    });
    expect(TOOL_SCHEMAS.object_read.output.safeParse(read).success).toBe(true);
    const act = (await verbs.object_act(A, {
      doing: "Replace the note",
      ref,
      tool: "write_text",
      input: { text: "milk" },
    })) as { changed?: string };
    expect(act.changed).toBe("Replaced the note");
    expect(win.seen.map((i) => i.op)).toEqual(["read", "act"]);
    expect(win.seen[1]).toMatchObject({
      tool: "write_text",
      input: { text: "milk" },
      doing: "Replace the note",
      run: "run-a",
      handle: "claude·a",
    });
  });

  it("bounds a tool's answer", async () => {
    const h = world();
    const { verbs } = room(h, (intent) =>
      intent.op === "read"
        ? { ok: true, value: { text: "x".repeat(OBJECT_LIMITS.TOOL_BYTES * 2) } }
        : undefined,
    );
    const read = (await verbs.object_read(A, { ref: handed(h), tool: "read_text" })) as {
      result: { truncated?: boolean };
    };
    expect(read.result.truncated).toBe(true);
  });

  it("passes the window's refusals through as facts", async () => {
    const h = world();
    const { verbs } = room(h, (intent) =>
      intent.op === "act"
        ? { ok: false, fact: "held", text: "The user is holding this note." }
        : undefined,
    );
    await expect(
      verbs.object_act(A, {
        doing: "Change",
        ref: handed(h),
        tool: "write_text",
        input: { text: "a" },
      }),
    ).rejects.toMatchObject({ details: { fact: "held" }, retryable: true });
  });
});

describe("no window (§5.5 step 6)", () => {
  it("answers UNAVAILABLE {desk, no-window}, honestly, when nothing holds the board", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    await expect(verbs.canvas_list(A, {})).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "desk", state: "no-window" },
    });
    const ref = handed(h);
    await expect(verbs.object_open(A, { ref })).rejects.toMatchObject({
      details: { service: "desk", state: "no-window" },
    });
  });

  it("rejects a closed subscription's pending intents, never a queue that acts later", async () => {
    const h = world();
    const { verbs, win } = room(h, () => undefined);
    const pending = verbs.object_open(A, { ref: handed(h) });
    win.dispose();
    await expect(pending).rejects.toMatchObject({ details: { state: "no-window" } });
  });

  it("gives a window its deadline, says it cannot tell what happened, and takes no late answer", async () => {
    vi.useFakeTimers();
    const h = world();
    const { verbs, win } = room(h, () => undefined);
    const pending = verbs.object_open(A, { ref: handed(h) });
    const failed = pending.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(OBJECT_LIMITS.INTENT_ANSWER_MS + 1);
    await expect(failed).resolves.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "desk", state: "no-answer" },
    });
    expect(
      h.desk.intents.answer({ intent: win.seen[0]!.intent, ok: true, value: {} }, "tok-window"),
    ).toEqual({ taken: false });
  });

  it("means the most recently subscribed desk for place and list", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    const first = h.window(ordinaryWindow, "doc-first");
    const second = h.window(ordinaryWindow, "doc-second");
    await verbs.canvas_list(A, {});
    expect(first.seen).toEqual([]);
    expect(second.seen).toHaveLength(1);
    second.dispose();
    await verbs.canvas_list(A, {});
    expect(first.seen).toHaveLength(1);
  });

  it("closes the old subscription when a board is taken again, without letting the old one's close hurt the new", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    const old = h.window(() => undefined);
    const pending = verbs.object_open(A, { ref: handed(h) }).catch((err: unknown) => err);
    const fresh = h.window(ordinaryWindow);
    await expect(pending).resolves.toMatchObject({ details: { state: "no-window" } });
    old.dispose();
    expect(h.desk.intents.holds(DOC)).toBe(true);
    await verbs.canvas_list(A, {});
    expect(fresh.seen).toHaveLength(1);
  });

  it("refuses a pile-up on one board rather than queueing past the bound", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(() => undefined);
    const ref = handed(h);
    const waiting = Array.from({ length: 64 }, () =>
      verbs.object_open(A, { ref }).catch((err: unknown) => err),
    );
    await expect(verbs.object_open(A, { ref })).rejects.toMatchObject({
      details: { fact: "limit" },
    });
    void waiting;
  });
});
