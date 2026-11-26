import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ObjectIntent, ObjectManual, PluginRecord } from "@vibefield/contracts";
import {
  AGENT_PLACEABLE_LIVE,
  OBJECT_LIMITS,
  ROOM_OPENER,
  SIMULATOR_BINDING_PROP,
  TOOL_SCHEMAS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DeskKind, pluginDeskKinds } from "../src/objects/kinds";
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

/** Item 559, 2026-11-18 — one sentence for every intent that left and was never answered (§5.5 step 7). */
const NO_ANSWER =
  "The window did not answer, so VibeField cannot tell whether this happened. Look before you try again.";

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

/** R-2: a kind whose agent tools are the pages room's rows: the browser pane's kind, its type and title as its manifest
 * names them, with the agent half that manifest will declare */
const BROWSER: DeskKind = {
  kind: "vibefield.browser-pane",
  title: "Browser",
  placeable: false,
  concurrency: "one",
  tools: [],
  version: 1,
  room: "pages",
};

describe("a kind whose tools are a room's rows (R-2)", () => {
  it("answers a kind that is both a room's and a live page's with the room's words first (the browser pane still is both: item 581 overturned 2026-11-24)", async () => {
    const both: DeskKind = { ...BROWSER, livePages: true };
    const h = world({ kinds: [NOTE, PAGE, both] });
    const { verbs, win } = room(h);
    const refused = await verbs.canvas_place(A, { kind: both.kind }).catch((err: unknown) => err);
    expect(refused).toMatchObject({ details: { fact: "no-tool", room: "pages" } });
    expect((refused as Error).message).toContain("not with canvas_place");
    expect((refused as Error).message).not.toContain("only the user adds those");
    expect(win.seen).toEqual([]);
  });

  it("answers canvas_place with no-tool naming the room's rows, before the window", async () => {
    const h = world({ kinds: [NOTE, PAGE, BROWSER] });
    const { verbs, win } = room(h);
    const refused = await verbs
      .canvas_place(A, { kind: BROWSER.kind })
      .catch((err: unknown) => err);
    expect(refused).toMatchObject({ details: { fact: "no-tool", room: "pages" } });
    expect((refused as { details: { tools: string[] } }).details.tools).toContain("browser_open");
    expect((refused as Error).message).toContain("browser_open");
    expect(win.seen).toEqual([]);
  });

  it("answers canvas_place on the browser pane as its own manifest declares it, before the window (2g)", async () => {
    // the pane's manifest read from its plugin folder, never copied: its agent half names the pages room
    const manifest = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../plugins/browser-pane/vibefield.plugin.json"),
        "utf8",
      ),
    ) as { id: string; capabilities: string[]; contributes: PluginRecord["contributions"] };
    // the record fieldd holds of it under `pnpm dev` and in a packaged build: bundled, asking what its manifest asks
    const record = {
      id: manifest.id,
      enabled: true,
      source: "bundled",
      requestedCapabilities: manifest.capabilities,
      grantedCapabilities: manifest.capabilities,
      contributions: manifest.contributes,
    };
    const pane = pluginDeskKinds([record as unknown as PluginRecord], () => undefined);
    expect(pane).toEqual([
      expect.objectContaining({ kind: "vibefield.browser-pane", room: "pages", placeable: false }),
    ]);
    const h = world({ kinds: [NOTE, PAGE, ...pane] });
    const { verbs, win } = room(h);
    const refused = await verbs
      .canvas_place(A, { kind: "vibefield.browser-pane", props: { url: "https://example.com/" } })
      .catch((err: unknown) => err);
    expect(refused).toMatchObject({ details: { fact: "no-tool", room: "pages" } });
    expect((refused as Error).message).toContain("not with canvas_place");
    expect(win.seen).toEqual([]);
    // item 581 overturned (2026-11-24): what an agent is told it can add names the pane, in its manifest's own
    // words, with the row that opens one
    const listed = (await verbs.canvas_kinds(A, {})) as {
      kinds: { kind: string; summary?: string; placeWith?: string }[];
    };
    const row = listed.kinds.find((kind) => kind.kind === "vibefield.browser-pane");
    expect(row).toMatchObject({ title: "Browser", tools: true, placeWith: "browser_open" });
    expect(row?.summary).toBe(manifest.contributes.objects[0]?.agent?.summary);
  });

  it("lists a room's kind beside what canvas_place places, naming the row that adds one: an agent that asks learns how to open a browser (item 581 overturned, 2026-11-24)", async () => {
    // the pane as the kinds table holds it: a room's kind and a live page's, never placeable by the desk
    const pane: DeskKind = { ...BROWSER, summary: "A web page on the desk.", livePages: true };
    const h = world({ kinds: [NOTE, PAGE, pane] });
    const { verbs, win } = room(h);
    const listed = await verbs.canvas_kinds(A, {});
    expect(listed).toEqual({
      kinds: [
        { kind: "desk.note", title: "Note", summary: "A note on the desk.", tools: true },
        {
          kind: BROWSER.kind,
          title: "Browser",
          summary: "A web page on the desk.",
          // its tools are the room's rows, and one of them adds it
          tools: true,
          placeWith: ROOM_OPENER.pages,
        },
      ],
    });
    expect(ROOM_OPENER.pages).toBe("browser_open");
    expect(TOOL_SCHEMAS.canvas_kinds.output.safeParse(listed).success).toBe(true);
    // listing it changes nothing of the door: canvas_place still answers with the room's rows, before the window
    const refused = await verbs.canvas_place(A, { kind: pane.kind }).catch((err: unknown) => err);
    expect(refused).toMatchObject({ details: { fact: "no-tool", room: "pages" } });
    expect(win.seen).toEqual([]);
  });

  it("answers object_read and object_act on one handed to the caller with no-tool naming the room's rows", async () => {
    const h = world({ kinds: [NOTE, PAGE, BROWSER] });
    const { verbs, win } = room(h);
    const ref = h.refOf("p1", BROWSER.kind);
    h.desk.hand(ref, "run-a");
    const read = await verbs.object_read(A, { ref, tool: "snapshot" }).catch((err: unknown) => err);
    const act = await verbs
      .object_act(A, { doing: "Click it", ref, tool: "click" })
      .catch((err: unknown) => err);
    for (const [refused, verb] of [
      [read, "object_read"],
      [act, "object_act"],
    ] as const) {
      expect(refused).toMatchObject({ details: { fact: "no-tool", room: "pages" } });
      expect((refused as Error).message).toContain(`not with ${verb}`);
      expect((refused as Error).message).toContain("browser_open");
      expect((refused as Error).message).not.toContain("gives you no tools");
    }
    expect(win.seen).toEqual([]);
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

  it("says another app's window, or a live page or device that could be the user's own, is the user's to add, and to ask, before the window (item 581, its words narrowed 2026-11-24)", async () => {
    // what the rule still keeps: a kind whose plugin asks a live pair and that the door's list does not name
    const live = {
      ...NOTE,
      kind: "example.live",
      title: "Live",
      placeable: false,
      livePages: true,
    } as const;
    const h = world({ kinds: [NOTE, PAGE, live] });
    const { verbs, win } = room(h);
    await expect(verbs.canvas_kinds(A, {})).resolves.toEqual({
      kinds: [{ kind: "desk.note", title: "Note", summary: "A note on the desk.", tools: true }],
    });
    const refused = await verbs.canvas_place(A, { kind: live.kind }).catch((err: unknown) => err);
    expect(refused).toMatchObject({
      details: { fact: "bad-input", path: "kind", expected: { enum: ["desk.note"] } },
    });
    expect((refused as Error).message).toBe(
      "input.kind: VibeField can't place example.live: it shows another app's window, or a live page or device " +
        "that could be the user's own, and only the user adds those to the desk. If you need one, ask the user. " +
        "It can place: desk.note.",
    );
    // the old words said every live page and device was the user's alone; an agent has its own of each now
    expect((refused as Error).message).not.toContain("a live page, device or app window");
    expect(win.seen).toEqual([]);
  });
});

/** Item 581 overturned (2026-11-24): the iOS Simulator as the kinds table holds it once an agent may place it. Its kind is
 * the one contracts' AGENT_PLACEABLE_LIVE names under the Simulator's pair, never a second literal here. */
const [PHONE_KIND = ""] = AGENT_PLACEABLE_LIVE["ios-simulator"];
const PHONE: DeskKind = {
  kind: PHONE_KIND,
  title: "iOS Simulator",
  summary: "An iPhone simulator on the desk.",
  placeable: true,
  concurrency: "many",
  tools: [],
  version: 1,
};
/** A binding as Xcode names a model and an iOS: the two ids, and nothing else. */
const IPHONE = {
  deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
};
const NOT_THE_USERS =
  "input.props.binding: an iOS Simulator you place shows a device of its own, never one of the user's. Name its " +
  "deviceType and runtime and nothing else, or leave the binding out and the user chooses.";

describe("an iOS Simulator an agent places shows a device of its own, never the user's (item 581 overturned, 2026-11-24)", () => {
  const phoneRoom = () => {
    const h = world({ kinds: [NOTE, PAGE, PHONE] });
    return { h, ...room(h) };
  };
  /** The props of every place the window was asked. */
  const placedWith = (seen: readonly ObjectIntent[]) =>
    seen.flatMap((intent) => (intent.op === "place" ? [intent.props] : []));

  it("places one bound to nothing as given: the user chooses its iPhone", async () => {
    const { verbs, win } = phoneRoom();
    const unbound = { [SIMULATOR_BINDING_PROP]: { deviceType: "", runtime: "" } };
    // a binding the kind cannot read opens no face either: it is the window's to take or refuse, as given
    const unread = {
      [SIMULATOR_BINDING_PROP]: { deviceType: "iPhone 17 Pro", runtime: "iOS 26.1" },
    };
    await verbs.canvas_place(A, { kind: PHONE.kind });
    await verbs.canvas_place(A, { kind: PHONE.kind, props: { model: IPHONE.deviceType } });
    await verbs.canvas_place(A, { kind: PHONE.kind, props: unbound });
    await verbs.canvas_place(A, { kind: PHONE.kind, props: unread });
    expect(placedWith(win.seen)).toEqual([
      undefined,
      { model: IPHONE.deviceType },
      unbound,
      unread,
    ]);
  });

  it("writes a binding that names a model and an iOS alone as the phone's own device, as the user's setup writes it", async () => {
    const { verbs, win } = phoneRoom();
    const said = { finish: "silver", [SIMULATOR_BINDING_PROP]: { ...IPHONE } };
    const manual = (await verbs.canvas_place(A, { kind: PHONE.kind, props: said })) as ObjectManual;
    expect(manual.object.yours).toBe("placed");
    // the prop's cell as JSON reads the same
    await verbs.canvas_place(A, {
      kind: PHONE.kind,
      props: { [SIMULATOR_BINDING_PROP]: JSON.stringify(IPHONE) },
    });
    expect(placedWith(win.seen)).toEqual([
      { finish: "silver", [SIMULATOR_BINDING_PROP]: { ...IPHONE, dedicated: true } },
      { [SIMULATOR_BINDING_PROP]: { ...IPHONE, dedicated: true } },
    ]);
    // the caller's own input is not written on
    expect(said).toEqual({ finish: "silver", [SIMULATOR_BINDING_PROP]: IPHONE });
  });

  it("hands on a binding that asks for a device of its own as its two ids and the flag, nothing that rode along", async () => {
    const { verbs, win } = phoneRoom();
    await verbs.canvas_place(A, {
      kind: PHONE.kind,
      props: { [SIMULATOR_BINDING_PROP]: { ...IPHONE, dedicated: true } },
    });
    await verbs.canvas_place(A, {
      kind: PHONE.kind,
      props: {
        [SIMULATOR_BINDING_PROP]: { ...IPHONE, dedicated: true, instance: "k1", udid: "A1B2" },
      },
    });
    expect(placedWith(win.seen)).toEqual([
      { [SIMULATOR_BINDING_PROP]: { ...IPHONE, dedicated: true } },
      { [SIMULATOR_BINDING_PROP]: { ...IPHONE, dedicated: true } },
    ]);
  });

  it("refuses a binding that asks for anything else, in words, before the window: it would show one of the user's devices", async () => {
    const { h, verbs, win } = phoneRoom();
    for (const binding of [
      { ...IPHONE, dedicated: false },
      { ...IPHONE, dedicated: "true" },
      { ...IPHONE, instance: "k1" },
      { ...IPHONE, udid: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890" },
      JSON.stringify({ ...IPHONE, name: "My iPhone" }),
    ]) {
      const refused = await verbs
        .canvas_place(A, { kind: PHONE.kind, props: { [SIMULATOR_BINDING_PROP]: binding } })
        .catch((err: unknown) => err);
      expect(refused, JSON.stringify(binding)).toMatchObject({
        details: {
          fact: "bad-input",
          path: "props.binding",
          expected: { required: ["deviceType", "runtime"], additionalProperties: false },
        },
      });
      expect((refused as Error).message, JSON.stringify(binding)).toBe(NOT_THE_USERS);
    }
    expect(win.seen).toEqual([]);
    // nothing was placed, so nothing is the caller's
    expect(h.desk.registry.grantOf(h.refOf("k9", PHONE.kind), "run-a")).toBeUndefined();
  });

  it("places the bundled iOS Simulator as its own manifest declares it, on a device of its own: the kinds table and the door together", async () => {
    // the phone's manifest read from its plugin folder, never copied, in the record fieldd holds of a bundled plugin
    const manifest = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../plugins/simulator/vibefield.plugin.json"),
        "utf8",
      ),
    ) as { id: string; capabilities: string[]; contributes: PluginRecord["contributions"] };
    const record = {
      id: manifest.id,
      enabled: true,
      source: "bundled",
      requestedCapabilities: manifest.capabilities,
      grantedCapabilities: manifest.capabilities,
      contributions: manifest.contributes,
    };
    const phone = pluginDeskKinds([record as unknown as PluginRecord], () => undefined);
    expect(phone).toEqual([expect.objectContaining({ kind: PHONE.kind, placeable: true })]);
    const h = world({ kinds: [NOTE, PAGE, ...phone] });
    const { verbs, win } = room(h);
    // it is among what an agent is told it can place, by its manifest's own words
    const listed = (await verbs.canvas_kinds(A, {})) as { kinds: { kind: string }[] };
    expect(listed.kinds.map((kind) => kind.kind)).toContain(PHONE.kind);
    const manual = (await verbs.canvas_place(A, {
      kind: PHONE.kind,
      props: { [SIMULATOR_BINDING_PROP]: { ...IPHONE } },
    })) as ObjectManual;
    expect(manual.object).toMatchObject({ kind: PHONE.kind, yours: "placed" });
    expect(manual.tools).toEqual([]);
    expect(placedWith(win.seen)).toEqual([
      { [SIMULATOR_BINDING_PROP]: { ...IPHONE, dedicated: true } },
    ]);
  });

  it("holds the rule to the kinds contracts names: another kind's props reach the window as given", async () => {
    const { verbs, win } = phoneRoom();
    const props = { [SIMULATOR_BINDING_PROP]: { ...IPHONE, dedicated: false } };
    await verbs.canvas_place(A, { kind: NOTE.kind, props });
    expect(placedWith(win.seen)).toEqual([props]);
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

  it("answers a closed subscription's pending intents no-answer, never a queue that acts later (item 559)", async () => {
    // they left for the window, which may have done them before it closed: whether they happened is unknown
    const h = world();
    const { verbs, win } = room(h, () => undefined);
    const pending = verbs.object_open(A, { ref: handed(h) });
    win.dispose();
    await expect(pending).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      message: NO_ANSWER,
      details: { service: "desk", state: "no-answer" },
    });
  });

  it("says nothing was done only of an intent that never left: the window's send threw (item 559)", async () => {
    const h = world();
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(() => {
      throw new Error("the window's socket is gone");
    });
    await expect(verbs.object_open(A, { ref: handed(h) })).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      message: expect.stringContaining("nothing was done"),
      details: { service: "desk", state: "no-window" },
    });
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
      message: NO_ANSWER,
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
    // item 559: the old window was sent it and never answered, so it is no-answer, never "nothing was done"
    await expect(pending).resolves.toMatchObject({
      message: NO_ANSWER,
      details: { state: "no-answer" },
    });
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
