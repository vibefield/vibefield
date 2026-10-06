// @vitest-environment happy-dom
/**
 * DK-14 — SEND TO… (DESIGN.md §8 "Send to…", "The missing face"; R15 as amended, DK-D26; plan addendum (50)): the chip's
 * FACE by kind and what it CARRIES (send-face.ts), where it is set in the draft and what a message says of it (draft.ts),
 * the line's door and its phase (line-send.ts), and THE ACT (send-to.ts) over a real field engine and a desk handle that
 * keeps ICE's doors' contract — the still's rect the anchor's box less the brackets' outset, the marks hidden FIRST by the
 * host's own doors (the selection cleared, the capture taken after they left, the selection put back), and in hand the
 * object's DRAWN box with nothing cleared.
 */
import type { CanvasEngine, Entity } from "@vibecook/ice";
import type { SelectionAnchor } from "@vibecook/ice/desk";
import { deskPalette } from "@vibecook/ice/desk/objects";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { deskObjects, type MountedDesk } from "../src/field/desk/desk-door";
import type { ObjectWords } from "../src/field/desk/desk-object-words";
import {
  CHIP_CHARS,
  chipFace,
  chipObjects,
  firstChars,
  type SentObject,
} from "../src/field/desk/send/send-face";
import {
  BRACKETS,
  captureRect,
  insetBox,
  MARKS_LEAVE_MS,
  MARKS_PATIENCE_MS,
  marksLeft,
  sendSelection,
} from "../src/field/desk/send/send-to";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";
import {
  chipMessage,
  chipPlace,
  type DeskChip,
  type DraftPart,
  draftMessage,
  insertChipAt,
} from "../src/frame/draft";
import {
  type LineSendTicket,
  lastSend,
  lineSendPhase,
  publishLineSend,
  SEND_MOTION,
  sendMotion,
  setLineSendPhase,
  subscribeLineSend,
  type WindowBox,
} from "../src/frame/line-send";

const words = (type: string, title: string, state: ObjectWords["state"] = null): ObjectWords => ({
  type,
  title,
  state,
  label: state === null ? title : `${title} · ${state}`,
});
const note = (props: Record<string, unknown>, state: ObjectWords["state"] = null): SentObject => ({
  type: "desk.note",
  words: words("desk.note", "Note", state),
  props,
});
const clock: SentObject = {
  type: "vibefield.example.desk-clock",
  words: words("vibefield.example.desk-clock", "Clock"),
  props: { seconds: false },
};
const palette = deskPalette("light");

describe("the chip's face (§8 'Send to…' — R15 as amended)", () => {
  it("a NOTE wears its paper and its ink through the palette, `snippets` and its first 24 characters", () => {
    const face = chipFace(
      [
        note({
          text: "Ship the desk by Friday, then the covers",
          paper: "yellow",
          pen: "fountain",
        }),
      ],
      palette,
    );
    expect(face).toEqual({
      glyph: "snippets",
      label: "Ship the desk by Friday,…",
      paper: palette.papers?.["yellow"]?.css,
      ink: palette.pens?.["fountain"]?.css,
    });
    expect(face.paper).toBe("#f6e7a9");
    expect(face.ink).toBe("#264a9a");
    // the palette's own colours, by name: another pen is another ink
    expect(chipFace([note({ text: "x", paper: "yellow", pen: "red" })], palette).ink).toBe(
      palette.pens?.["red"]?.css,
    );
  });

  it("counts 24 CHARACTERS — by code point, the runs of white space one space; no cut when it fits", () => {
    expect(CHIP_CHARS).toBe(24);
    expect(firstChars("a\n\n  b")).toBe("a b");
    expect(firstChars("x".repeat(24))).toBe("x".repeat(24));
    expect(firstChars("x".repeat(25))).toBe(`${"x".repeat(24)}…`);
    expect(firstChars(`${"🙂".repeat(30)}`)).toBe(`${"🙂".repeat(24)}…`);
    expect(firstChars("   ")).toBeNull();
  });

  it("an empty note says what it is — its type's name", () => {
    expect(chipFace([note({ text: "", paper: "yellow", pen: "fountain" })], palette).label).toBe(
      "Note",
    );
  });

  it('any other kind wears its NAME and no glyph ("Clock")', () => {
    expect(chipFace([clock], palette)).toEqual({ glyph: null, label: "Clock" });
  });

  it('several wear `package` and "N objects"', () => {
    expect(chipFace([note({ text: "a" }), clock], palette)).toEqual({
      glyph: "package",
      label: "2 objects",
    });
    expect(chipFace([clock, clock, clock], palette).label).toBe("3 objects");
  });

  it("a MISSING FACE wears its type's name — never its word, and never a note's paper", () => {
    const off = { ...clock, words: words(clock.type, "Clock", "plugin off") };
    expect(chipFace([off], palette)).toEqual({ glyph: null, label: "Clock" });
    const cantDraw = note({ text: "still written", paper: "yellow" }, "can't draw");
    expect(chipFace([cantDraw], palette)).toEqual({ glyph: null, label: "Note" });
    const noKind = {
      type: "acme.widget",
      words: words("acme.widget", "acme.widget", "no kind"),
      props: {},
    };
    expect(chipFace([noKind], palette).label).toBe("acme.widget");
  });

  it("CARRIES the objects' names and their durable text, in selection order (DK-D26)", () => {
    expect(chipObjects([note({ text: "hello", seeds: "x" }), clock])).toEqual([
      { type: "desk.note", name: "Note", text: "hello" },
      { type: "vibefield.example.desk-clock", name: "Clock", text: null },
    ]);
    expect(chipObjects([note({ text: "   " })])[0]?.text).toBeNull();
  });
});

const chip = (over: Partial<DeskChip> = {}): DeskChip => ({
  id: "c",
  kind: "desk",
  label: "Clock",
  glyph: null,
  objects: [{ type: "vibefield.example.desk-clock", name: "Clock", text: null }],
  still: null,
  ...over,
});

describe("the chip in the draft (§8 'Send to…': at the caret; a chip never splits a word)", () => {
  const text = (t: string): DraftPart => ({ kind: "text", text: t });
  it("sets it at the caret as a token, the caret after it and its space", () => {
    const out = insertChipAt([text("look at ")], { index: 0, offset: 8 }, chip());
    expect(out.parts).toEqual([text("look at "), { kind: "chip", chip: chip() }, text(" ")]);
    expect(out.caret).toBe(10);
  });

  it("moves on to the end of the word the caret stands in, and sets a space before it when it would touch one", () => {
    const out = insertChipAt([text("compare these")], { index: 0, offset: 10 }, chip());
    expect(out.parts).toEqual([text("compare these "), { kind: "chip", chip: chip() }, text(" ")]);
    expect(out.caret).toBe(16);
    expect(chipPlace([text("compare these")], { index: 0, offset: 10 })).toBe(13);
  });

  it("with no caret, at the draft's end — an empty draft takes it first", () => {
    expect(insertChipAt([], null, chip()).parts).toEqual([
      { kind: "chip", chip: chip() },
      text(" "),
    ]);
    expect(insertChipAt([], null, chip()).caret).toBe(2);
    const after = insertChipAt(
      [text("a "), { kind: "chip", chip: chip({ id: "d" }) }],
      null,
      chip(),
    );
    expect(after.parts).toEqual([
      text("a "),
      { kind: "chip", chip: chip({ id: "d" }) },
      text(" "),
      { kind: "chip", chip: chip() },
      text(" "),
    ]);
    expect(chipPlace([text("ab")], null)).toBe(2);
  });

  it("says what it carries in a message — names and durable text; a capture its path", () => {
    expect(chipMessage(chip())).toBe("Clock");
    expect(
      chipMessage(
        chip({ objects: [{ type: "desk.note", name: "Note", text: "ship\n the desk" }] }),
      ),
    ).toBe('Note: "ship the desk"');
    expect(
      chipMessage(
        chip({
          label: "2 objects",
          objects: [
            { type: "desk.note", name: "Note", text: "a" },
            { type: "x", name: "Clock", text: null },
          ],
        }),
      ),
    ).toBe('2 objects (Note: "a"; Clock)');
    expect(
      draftMessage([text("summarize "), { kind: "chip", chip: chip() }, text(" please")]),
    ).toBe("summarize Clock please");
    expect(chipMessage({ id: "p", kind: "capture", label: "1 × 1", path: "/s.png" })).toBe(
      "/s.png",
    );
  });
});

describe("the line's door and its phase (line-send.ts)", () => {
  it("the motion: 560 on a straight line 1.25 → 0.86, the @ 180 after; reduced, no flight and the @ after 90", () => {
    expect(SEND_MOTION).toMatchObject({
      flies: true,
      flightMs: 560,
      fromScale: 1.25,
      toScale: 0.86,
      atAfterMs: 180,
    });
    expect(sendMotion(true)).toMatchObject({ flies: false, atAfterMs: 90, fadeMs: 120 });
  });

  it("tells its readers each change of phase, once", () => {
    const heard: string[] = [];
    const off = subscribeLineSend(() => heard.push(lineSendPhase()));
    setLineSendPhase("flying");
    setLineSendPhase("flying");
    setLineSendPhase("listing");
    setLineSendPhase("idle");
    off();
    expect(heard).toEqual(["flying", "listing", "idle"]);
  });
});

// ── THE ACT, over a real engine ───────────────────────────────────────────────────────────────────────────────────
const VIEW = { width: 1180, height: 780 };
const BOX = { x0: 400, y0: 300, x1: 600, y1: 450 };

let ce: CanvasEngine;
let noteE: Entity;
let clockLike: Entity;
let anchor: SelectionAnchor;
let calls: string[];
let frames: number;
let dirty: boolean;
let taken: { chip: DeskChip; from: WindowBox }[];
let attached: (unknown | null)[];
let unpublishLine: () => void;
let desk: MountedDesk;
let captured: { rect?: unknown }[];

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(async () => {
  ce = createFieldEngine(buildRegistry());
  await seedField(ce, ce.docs.create(), createDeskBlobStore());
  noteE = deskObjects(ce, "desk.note")[0]?.entity as Entity;
  clockLike = deskObjects(ce, "vibefield.comment-pad")[0]?.entity as Entity;
  calls = [];
  frames = 10;
  dirty = false;
  taken = [];
  attached = [];
  captured = [];
  anchor = {
    box: BOX,
    count: 1,
    locked: false,
    gesturing: false,
    editing: false,
    view: VIEW,
    rulers: null,
  };
  const origSet = ce.ops.setSelection.bind(ce.ops);
  const origClear = ce.ops.clearSelection.bind(ce.ops);
  vi.spyOn(ce.ops, "setSelection").mockImplementation((ids) => {
    calls.push(`select:${ids.length}`);
    origSet(ids);
  });
  vi.spyOn(ce.ops, "clearSelection").mockImplementation(() => {
    calls.push("clear");
    origClear();
  });
  ce.ops.setSelection([noteE]);
  calls = [];
  desk = {
    engine: ce,
    handle: {
      selection: { anchor: () => anchor, subscribe: () => () => undefined },
      perf: () => ({ frames }),
      dirty: () => dirty,
      capture: vi.fn(async (opts: { rect?: unknown }) => {
        calls.push("capture");
        captured.push(opts);
        return { width: 376, height: 276, close: () => calls.push("close") };
      }),
      canvas: document.createElement("canvas"),
    } as unknown as MountedDesk["handle"],
    generation: 1,
    mount: 0,
    theme: "light",
    words: (type) =>
      type === "desk.note"
        ? words(type, "Note")
        : words(type, type === "vibefield.comment-pad" ? "Comment pad" : type),
  };
  unpublishLine = publishLineSend({
    receive(c, from): LineSendTicket {
      taken.push({ chip: c, from });
      return { attach: (still) => attached.push(still) };
    },
  });
  globalThis.URL.createObjectURL ??= () => "blob:x";
});

afterEach(() => {
  unpublishLine();
  ce.dispose();
  vi.restoreAllMocks();
});

const seams = {
  encode: async () => new Uint8Array(new ArrayBuffer(321)),
  marks: async () => {
    calls.push("marks-left");
  },
};

describe("SEND TO… — the act (send-to.ts)", () => {
  it("hands the line ONE chip from the selection's own box (the brackets' 6 off), then the still — the marks hidden FIRST", async () => {
    expect(sendSelection(desk, "bar", seams)).toBe(true);
    expect(taken).toHaveLength(1);
    const { chip: c, from } = taken[0]!;
    expect(c).toMatchObject({ kind: "desk", glyph: "snippets", still: null });
    expect(c.objects[0]?.type).toBe("desk.note");
    // the window's box of the objects themselves: the anchor's less the outset (the view at the window's 0, 0)
    expect(from).toEqual({ x0: 406, y0: 306, x1: 594, y1: 444 });
    await flush();
    // the order: the selection cleared, the marks let leave, THEN the capture, and the selection put back
    expect(calls).toEqual(["clear", "marks-left", "capture", "close", "select:1"]);
    expect(captured[0]).toEqual({ rect: { x: 406, y: 306, width: 188, height: 138 } });
    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({ width: 376, height: 276, bytes: 321 });
    expect(lastSend()).toMatchObject({
      from: "bar",
      marks: { cleared: true, restored: true },
      rect: { x0: 406, y0: 306, x1: 594, y1: 444 },
    });
  });

  it('several: the union\'s 10 off, `package` and "N objects", both put back', async () => {
    ce.ops.setSelection([noteE, clockLike]);
    calls = [];
    anchor = { ...anchor, count: 2 };
    expect(sendSelection(desk, "menu", seams)).toBe(true);
    expect(taken[0]?.chip).toMatchObject({ glyph: "package", label: "2 objects" });
    expect(taken[0]?.from).toEqual({ x0: 410, y0: 310, x1: 590, y1: 440 });
    await flush();
    expect(calls.at(-1)).toBe("select:2");
    expect(lastSend()?.from).toBe("menu");
  });

  it("puts nothing back over a selection the person made meanwhile", async () => {
    let release: () => void = () => undefined;
    const slow = {
      ...seams,
      marks: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    };
    sendSelection(desk, "bar", slow);
    ce.ops.setSelection([clockLike]);
    calls = [];
    release();
    await flush();
    expect(calls).toEqual(["capture", "close"]);
    // the record says so: the selection standing after is the person's, not the one put back
    expect(lastSend()?.marks.restored).toBe(false);
  });

  it("the record OBSERVES the marks hidden: a clear that left the selection standing is recorded as none", async () => {
    vi.mocked(ce.ops.clearSelection).mockImplementation(() => {
      calls.push("clear");
    });
    sendSelection(desk, "bar", seams);
    await flush();
    expect(lastSend()?.marks).toEqual({ cleared: false, restored: true });
  });

  it("takes nothing, clears nothing, when the line will not take the chip (another still landing)", async () => {
    unpublishLine();
    unpublishLine = publishLineSend({ receive: () => null });
    expect(sendSelection(desk, "bar", seams)).toBe(false);
    await flush();
    expect(calls).toEqual([]);
    expect(lastSend()?.taken).toBe(false);
  });

  it("IN HAND: the chip flies from where the desk DRAWS the object, the still that box — nothing cleared, it stays held", async () => {
    const held = () => ({
      entity: noteE as number,
      frame: { cx: 590, cy: 382, hx: 120, hy: 160, s: 2, settled: true },
    });
    expect(sendSelection(desk, "hand", { ...seams, held })).toBe(true);
    expect(taken[0]?.from).toEqual({ x0: 470, y0: 222, x1: 710, y1: 542 });
    await flush();
    expect(calls).toEqual(["capture", "close"]);
    expect(captured[0]).toEqual({ rect: { x: 470, y: 222, width: 240, height: 320 } });
    expect(lastSend()).toMatchObject({ from: "hand", marks: { cleared: false, restored: false } });
  });

  it("does nothing with nothing selected", () => {
    ce.ops.clearSelection();
    calls = [];
    expect(sendSelection(desk, "bar", seams)).toBe(false);
    expect(taken).toEqual([]);
  });
});

describe("the geometry and the wait (send-to.ts)", () => {
  it("the brackets' outset: 6 for one object, the union's 10 for several", () => {
    expect(BRACKETS).toEqual({ one: 6, several: 10 });
    expect(insetBox(BOX, 1)).toEqual({ x0: 406, y0: 306, x1: 594, y1: 444 });
    expect(insetBox(BOX, 3)).toEqual({ x0: 410, y0: 310, x1: 590, y1: 440 });
  });

  it("cuts the rect to the view; nothing on it, no rect", () => {
    expect(captureRect({ x0: -20, y0: 700, x1: 100, y1: 900 }, VIEW)).toEqual({
      x: 0,
      y: 700,
      width: 100,
      height: 80,
    });
    expect(captureRect({ x0: 1200, y0: 0, x1: 1300, y1: 10 }, VIEW)).toBeNull();
  });

  it("waits for a frame PRESENTED after the brackets' 120 ms leave — and no longer than its patience", async () => {
    let t = 0;
    let f = 0;
    const handle = { perf: () => ({ frames: f }), dirty: () => true } as never;
    const steps: number[] = [];
    await marksLeft(
      handle,
      () => t,
      async () => {
        t += 16;
        if (t > 60) f += 1; // the desk draws from 60 ms on
        steps.push(t);
      },
    );
    expect(MARKS_LEAVE_MS).toBe(120);
    // the first frame at or past 120 is the leave's; the next one presented is the first without the marks
    expect(steps.at(-1)).toBe(144);
    t = 0;
    const idle = { perf: () => ({ frames: 0 }), dirty: () => false } as never;
    await marksLeft(
      idle,
      () => t,
      async () => {
        t += 50;
      },
    );
    expect(t).toBeGreaterThanOrEqual(MARKS_PATIENCE_MS);
  });
});
