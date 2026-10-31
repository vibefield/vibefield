// @vitest-environment happy-dom
/**
 * HN-D3 — THE DESK'S COPY (DESIGN.md §8 "The desk's Copy", "The missing face"; R15 as amended, DK-D26, PT-4; plan
 * addendum (50)): what a copy is called and the words it keeps (copy-face.ts), and THE ACT (copy-to-hand.ts) over a real
 * field engine and a desk handle that keeps ICE's doors' contract — a lone note dealt as a TEXT card of its writing;
 * anything else as a PICTURE card, its still the anchor's box less the brackets' outset, taken WITHOUT the selection's
 * marks by ICE's own capture (`capture({ rect, marks: false })`, I40 — the act writes no selection at all), in hand
 * the object's DRAWN box; and no picture to take, no card, said. HN-5: what the card holds goes on the system clipboard
 * FIRST, through the one copy door — a note's words through the host's copy door, a picture's PNG through the
 * clipboard's picture door with the words the objects keep beside it in the same one write (LC-19) — and a copy the
 * clipboard refused deals nothing, the line saying why.
 */
import { type CanvasEngine, type Entity, selectedEntities, setWidgetProps } from "@vibecook/ice";
import type { SelectionAnchor } from "@vibecook/ice/desk";
import { type ClipboardCopyRefusal, IPC_CHANNELS } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CopiedObject,
  copiedWords,
  copyName,
  firstChars,
  NAME_CHARS,
  noteWords,
} from "../src/field/desk/copy/copy-face";
import { lastCopy } from "../src/field/desk/copy/copy-record";
import {
  BRACKETS,
  captureRect,
  copySelection,
  insetBox,
} from "../src/field/desk/copy/copy-to-hand";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { deskObjects, type MountedDesk } from "../src/field/desk/desk-door";
import type { ObjectWords } from "../src/field/desk/desk-object-words";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";
import { CardStore } from "../src/frame/cards/cards-store";
import { hearLineSays } from "../src/frame/line-door";

const words = (type: string, title: string, state: ObjectWords["state"] = null): ObjectWords => ({
  type,
  title,
  state,
  label: state === null ? title : `${title} · ${state}`,
});
const note = (
  props: Record<string, unknown>,
  state: ObjectWords["state"] = null,
): CopiedObject => ({
  type: "desk.note",
  words: words("desk.note", "Note", state),
  props,
});
const clock: CopiedObject = {
  type: "vibefield.example.desk-clock",
  words: words("vibefield.example.desk-clock", "Clock"),
  props: { seconds: false },
};

describe("what a copy is called, and the words it keeps (copy-face.ts)", () => {
  it("a lone NOTE with writing is its words — one with none, several, or any other kind are not", () => {
    expect(noteWords([note({ text: "Ship it. Then the covers.", paper: "yellow" })])).toBe(
      "Ship it. Then the covers.",
    );
    expect(noteWords([note({ text: "   " })])).toBeNull();
    expect(noteWords([note({ text: "a" }), clock])).toBeNull();
    expect(noteWords([clock])).toBeNull();
  });

  it('names any other kind by its NAME ("Clock"), several by their count, an empty note by its type', () => {
    expect(copyName([clock])).toBe("Clock");
    expect(copyName([note({ text: "a" }), clock])).toBe("2 objects");
    expect(copyName([clock, clock, clock])).toBe("3 objects");
    expect(copyName([note({ text: "" })])).toBe("Note");
  });

  it("a MISSING FACE is named by its type — never its word", () => {
    expect(copyName([{ ...clock, words: words(clock.type, "Clock", "plugin off") }])).toBe("Clock");
    const noKind = { type: "acme.widget", words: words("acme.widget", "acme.widget", "no kind") };
    expect(copyName([{ ...noKind, props: {} }])).toBe("acme.widget");
  });

  it("PT-4: an object showing a LIVE page is called by its page — its title, else its address — cut at 24", () => {
    const pane = (live: string | undefined, state: ObjectWords["state"] = null): CopiedObject => ({
      type: "vibefield.browser-pane",
      words: words("vibefield.browser-pane", "Browser", state),
      props: { url: "https://lumen.example/reader" },
      ...(live === undefined ? {} : { live }),
    });
    expect(copyName([pane("Lumen — Reader")])).toBe("Lumen — Reader");
    expect(copyName([pane("lumen.example")])).toBe("lumen.example");
    expect(copyName([pane("A very long title that runs past the card's room")])).toBe(
      "A very long title that r…",
    );
    // no page shown: its type's name, as any kind; a missing face names its type, whatever a page was called
    expect(copyName([pane(undefined)])).toBe("Browser");
    expect(copyName([pane("   ")])).toBe("Browser");
    expect(copyName([pane("Lumen — Reader", "plugin off")])).toBe("Browser");
  });

  it("counts 24 CHARACTERS — by code point, the runs of white space one space; no cut when it fits", () => {
    expect(NAME_CHARS).toBe(24);
    expect(firstChars("a\n\n  b")).toBe("a b");
    expect(firstChars("x".repeat(24))).toBe("x".repeat(24));
    expect(firstChars("x".repeat(25))).toBe(`${"x".repeat(24)}…`);
    expect(firstChars(`${"🙂".repeat(30)}`)).toBe(`${"🙂".repeat(24)}…`);
    expect(firstChars("   ")).toBeNull();
  });

  it("gives the system clipboard the words the objects keep, in selection order — none from a kind that keeps none", () => {
    expect(copiedWords([note({ text: "hello", seeds: "x" }), clock, note({ text: "again" })])).toBe(
      "hello\n\nagain",
    );
    expect(copiedWords([clock])).toBeNull();
    expect(copiedWords([note({ text: "   " })])).toBeNull();
  });
});

// ── THE ACT, over a real engine ───────────────────────────────────────────────────────────────────────────────────
const VIEW = { width: 1180, height: 780 };
const BOX = { x0: 400, y0: 300, x1: 600, y1: 450 };
const WRITING = "Ship the desk by Friday. Then the covers.";

let ce: CanvasEngine;
let noteE: Entity;
let padE: Entity;
let anchor: SelectionAnchor;
let calls: string[];
let desk: MountedDesk;
let captured: { rect?: unknown; marks?: unknown }[];
/** What the capture door answers: a still, or none (a desk that cannot draw). */
let gives: "still" | "none";
/** A capture held open by a test (the act's tail waits on it), released by `answer()`. */
let holdCapture: Promise<void> | null;
let store: CardStore;
/** What the system clipboard's doors were given — the words alone, the pictures and the words beside each — and
 * whether they take them. */
let clipboard: string[];
let pictures: { png: Uint8Array; text: string | undefined }[];
let clipboardTakes: boolean;
/** How the picture door refuses, when it does — typed, as the preload rejects, or with a
 * bridge's error; null: it takes it. */
let pictureRefusal: ClipboardCopyRefusal | Error | null;
/** What the frame said on the line. */
let said: string[];
let unhear: () => void;

const flush = async (): Promise<void> => {
  // the still, its PNG, then the clipboard's door before the deal (HN-5): enough turns for all of them
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

/** A note's writing, as its own editor leaves it: in its durable props. */
function write(entity: Entity, text: string): void {
  const doc = ce.docs.current()?.store;
  if (doc === undefined) throw new Error("no document");
  setWidgetProps(doc, ce.world, entity, { text });
  ce.world.sync();
}

beforeEach(async () => {
  ce = createFieldEngine(buildRegistry());
  await seedField(ce, ce.docs.create(), createDeskBlobStore());
  noteE = deskObjects(ce, "desk.note")[0]?.entity as Entity;
  padE = deskObjects(ce, "vibefield.comment-pad")[0]?.entity as Entity;
  calls = [];
  captured = [];
  gives = "still";
  holdCapture = null;
  clipboard = [];
  pictures = [];
  clipboardTakes = true;
  pictureRefusal = null;
  said = [];
  unhear = hearLineSays((text) => said.push(text));
  store = new CardStore(() => 5_000);
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
  ce.ops.setSelection([padE]);
  calls = [];
  vi.mocked(ce.ops.setSelection).mockClear();
  desk = {
    engine: ce,
    handle: {
      selection: { anchor: () => anchor, subscribe: () => () => undefined },
      capture: vi.fn(async (opts: { rect?: unknown; marks?: unknown }) => {
        calls.push("capture");
        captured.push(opts);
        if (holdCapture !== null) await holdCapture;
        if (gives === "none") return undefined;
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
  globalThis.URL.createObjectURL ??= () => "blob:x";
  globalThis.URL.revokeObjectURL ??= () => undefined;
});

afterEach(() => {
  unhear();
  ce.dispose();
  vi.restoreAllMocks();
});

const seams = () => ({
  encode: async () => new Uint8Array(new ArrayBuffer(321)),
  store,
  // the host's two clipboard doors (HN-5): the words', and the picture's
  host: {
    diagnostics: {
      copyText: async (text: string) => {
        clipboard.push(text);
        if (!clipboardTakes) throw new Error("the clipboard refused it");
      },
    },
    clipboard: {
      writeImage: async (png: Uint8Array, text?: string) => {
        pictures.push({ png, text });
        if (pictureRefusal !== null) throw pictureRefusal;
      },
    },
  },
});

describe("THE DESK'S COPY — the act (copy-to-hand.ts)", () => {
  it("deals a lone NOTE as a TEXT card of its writing from its own box, once its words are on the system clipboard — no still taken", async () => {
    write(noteE, WRITING);
    ce.ops.setSelection([noteE]);
    calls = [];
    vi.mocked(ce.ops.setSelection).mockClear();
    expect(copySelection(desk, "bar", seams())).toBe(true);
    // the clipboard is asked first (HN-5): nothing is dealt until it answered
    expect(clipboard).toEqual([WRITING]);
    expect(store.snapshot().cards).toEqual([]);
    await flush();
    const { cards, arriving } = store.snapshot();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: "text",
      title: "Ship the desk by Friday.",
      body: "Then the covers.",
      bare: false,
      paste: WRITING,
      origin: { view: "canvas", how: "copy" },
      at: 5_000,
    });
    // it leaves the objects' own box (the brackets' 6 off; the view at the window's 0, 0)
    const from = arriving.get(cards[0]?.id ?? "");
    expect(from).toEqual({ left: 406, top: 306, width: 188, height: 138 });
    await flush();
    expect(calls).toEqual([]);
    expect(clipboard).toEqual([WRITING]);
    expect(pictures).toEqual([]);
    expect(lastCopy()).toMatchObject({
      from: "bar",
      words: WRITING,
      wrote: true,
      kept: true,
      still: null,
      card: { kind: "text", title: "Ship the desk by Friday." },
      refused: null,
    });
    expect(ce.ops.setSelection).not.toHaveBeenCalled();
  });

  it("deals anything else as a PICTURE card titled by its name, its still the objects' own box WITHOUT the marks — the selection never touched", async () => {
    expect(copySelection(desk, "bar", seams())).toBe(true);
    expect(store.snapshot().cards).toEqual([]);
    await flush();
    // ICE draws the capture without the selection's marks (I40): no clear, no wait for the brackets, no put-back —
    // the act writes no selection, so nothing blinks for a peer
    expect(calls).toEqual(["capture", "close"]);
    expect(captured[0]).toEqual({
      rect: { x: 406, y: 306, width: 188, height: 138 },
      marks: false,
    });
    expect(ce.ops.setSelection).not.toHaveBeenCalled();
    expect(ce.ops.clearSelection).not.toHaveBeenCalled();
    expect(selectedEntities(ce.world)).toEqual([padE]);
    const { cards, arriving } = store.snapshot();
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card).toMatchObject({
      kind: "pict",
      title: "Comment pad",
      width: 376,
      height: 276,
      origin: { view: "canvas", how: "copy" },
      paste: "",
    });
    // the PNG is the card's own — no file on disk, so no path
    if (card?.kind !== "pict") throw new Error("not a picture card");
    expect(card.bytes?.size).toBe(321);
    expect(card.bytes?.type).toBe("image/png");
    expect(card.src).toMatch(/^blob:/u);
    expect(card.path).toBeUndefined();
    expect(arriving.get(card.id)).toEqual({ left: 406, top: 306, width: 188, height: 138 });
    // its picture went on the system clipboard first, through the picture door — the same PNG the card keeps
    // (HN-5, LC-9) — and a pad that keeps no words gives none beside it
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.png.byteLength).toBe(321);
    expect(pictures[0]?.text).toBeUndefined();
    expect(clipboard).toEqual([]);
    expect(lastCopy()).toMatchObject({
      from: "bar",
      words: null,
      wrote: true,
      marks: false,
      kept: true,
      rect: { x0: 406, y0: 306, x1: 594, y1: 444 },
      still: { width: 376, height: 276, bytes: 321 },
      card: { kind: "pict", title: "Comment pad" },
    });
  });

  it("records the marks as the capture door was HANDED them — and none for a text card, which asks no still", async () => {
    write(noteE, WRITING);
    ce.ops.setSelection([noteE]);
    expect(copySelection(desk, "bar", seams())).toBe(true);
    await flush();
    expect(captured).toEqual([]);
    expect(lastCopy()?.marks).toBeNull();
    // a picture: the record reads the option off the door's own call, never a constant of the act
    ce.ops.setSelection([padE]);
    expect(copySelection(desk, "bar", seams())).toBe(true);
    await flush();
    expect(captured).toHaveLength(1);
    expect(lastCopy()?.marks).toBe(captured[0]?.marks);
    expect(lastCopy()?.marks).toBe(false);
  });

  it('several: the union\'s 10 off, ONE picture card "2 objects" — its picture and the words they keep in one write', async () => {
    write(noteE, WRITING);
    ce.ops.setSelection([noteE, padE]);
    calls = [];
    vi.mocked(ce.ops.setSelection).mockClear();
    anchor = { ...anchor, count: 2 };
    expect(copySelection(desk, "menu", seams())).toBe(true);
    await flush();
    expect(calls).toEqual(["capture", "close"]);
    expect(captured[0]).toEqual({
      rect: { x: 410, y: 310, width: 180, height: 130 },
      marks: false,
    });
    expect(ce.ops.setSelection).not.toHaveBeenCalled();
    expect(store.snapshot().cards).toHaveLength(1);
    expect(store.snapshot().cards[0]).toMatchObject({ kind: "pict", title: "2 objects" });
    // the note's writing is the words they keep (the pad keeps none): on the system clipboard beside their picture, in
    // the picture door's ONE write (LC-19) — never a second write through the copy door, which would replace the first
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.text).toBe(WRITING);
    expect(clipboard).toEqual([]);
    expect(lastCopy()).toMatchObject({ from: "menu", kept: true, words: WRITING, wrote: true });
    expect(
      lastCopy()
        ?.objects.map((o) => o.name)
        .sort(),
    ).toEqual(["Comment pad", "Note"]);
  });

  it("IN HAND: the card flies from where the desk DRAWS the object, the still that box — nothing cleared, it stays held", async () => {
    const held = () => ({
      entity: noteE as number,
      frame: { cx: 590, cy: 382, hx: 120, hy: 160, s: 2, settled: true },
    });
    // the seeded note keeps no writing: it is copied as its picture
    expect(copySelection(desk, "hand", { ...seams(), held })).toBe(true);
    await flush();
    expect(calls).toEqual(["capture", "close"]);
    expect(captured[0]).toEqual({
      rect: { x: 470, y: 222, width: 240, height: 320 },
      marks: false,
    });
    const [card] = store.snapshot().cards;
    expect(card).toMatchObject({ kind: "pict", title: "Note" });
    expect(store.snapshot().arriving.get(card?.id ?? "")).toEqual({
      left: 470,
      top: 222,
      width: 240,
      height: 320,
    });
    expect(lastCopy()).toMatchObject({ from: "hand", marks: false, kept: true });
  });

  it("⌘C copies what is held when something is, and the selection when nothing is", async () => {
    const holding = () => ({
      entity: noteE as number,
      frame: { cx: 590, cy: 382, hx: 120, hy: 160, s: 2, settled: true },
    });
    expect(copySelection(desk, "key", { ...seams(), held: holding })).toBe(true);
    await flush();
    expect(store.snapshot().cards.at(-1)).toMatchObject({ kind: "pict", title: "Note" });
    expect(copySelection(desk, "key", { ...seams(), held: () => null })).toBe(true);
    await flush();
    expect(store.snapshot().cards.at(-1)).toMatchObject({ kind: "pict", title: "Comment pad" });
    expect(lastCopy()?.from).toBe("key");
  });

  it("deals NO card where no picture can be taken — and the line says why", async () => {
    // nothing of the box on the view: no rect to capture
    anchor = { ...anchor, box: { x0: 1300, y0: 900, x1: 1400, y1: 1000 } };
    expect(copySelection(desk, "bar", seams())).toBe(true);
    await flush();
    expect(calls).toEqual([]);
    expect(store.snapshot().cards).toEqual([]);
    expect(said).toEqual(["Not copied — it is off the screen"]);
    expect(lastCopy()).toMatchObject({ card: null, refused: "Not copied — it is off the screen" });
    // a desk that cannot draw: the capture door answers nothing
    anchor = { ...anchor, box: BOX };
    gives = "none";
    expect(copySelection(desk, "bar", seams())).toBe(true);
    await flush();
    expect(store.snapshot().cards).toEqual([]);
    expect(said.at(-1)).toBe("Not copied — the desk could not draw it");
  });

  it("the record OBSERVES the selection: the person's own change while the still is taken is said, and nothing is written over it", async () => {
    let answer: () => void = () => undefined;
    holdCapture = new Promise<void>((resolve) => {
      answer = resolve;
    });
    copySelection(desk, "bar", seams());
    await flush();
    expect(lastCopy()?.kept).toBeNull(); // the capture not yet answered
    ce.ops.setSelection([noteE]);
    calls = [];
    answer();
    await flush();
    expect(calls).toEqual(["close"]);
    expect(lastCopy()?.kept).toBe(false);
    expect(selectedEntities(ce.world)).toEqual([noteE]);
  });

  it("deals NO card when the system clipboard refuses the note's words — the line says why, and the record keeps it", async () => {
    write(noteE, WRITING);
    ce.ops.setSelection([noteE]);
    clipboardTakes = false;
    expect(copySelection(desk, "bar", seams())).toBe(true);
    await flush();
    // the hand is the clipboard you can see (HN-L1): what the clipboard did not take is no card
    expect(store.snapshot().cards).toEqual([]);
    expect(said).toEqual(["Not copied — the clipboard did not take the words"]);
    expect(lastCopy()).toMatchObject({
      wrote: false,
      card: null,
      refused: "Not copied — the clipboard did not take the words",
    });
  });

  it("deals NO card when the picture door refuses: its typed refusal in Copy's voice", async () => {
    pictureRefusal = { reason: "not-an-image" };
    expect(copySelection(desk, "bar", seams())).toBe(true);
    await flush();
    expect(pictures).toHaveLength(1);
    expect(store.snapshot().cards).toEqual([]);
    expect(said).toEqual(["Not copied — the picture could not be read"]);
    // the still was taken; it went nowhere
    expect(lastCopy()).toMatchObject({
      still: { width: 376, height: 276, bytes: 321 },
      wrote: false,
      card: null,
      refused: "Not copied — the picture could not be read",
    });
  });

  it("never says a bridge's error on the line: the door's own words stand for it", async () => {
    const remote = `Error invoking remote method '${IPC_CHANNELS.clipboardWriteImage}': Error: x`;
    pictureRefusal = new Error(remote);
    expect(copySelection(desk, "bar", seams())).toBe(true);
    await flush();
    expect(store.snapshot().cards).toEqual([]);
    expect(said).toEqual(["Not copied — the clipboard did not take the picture"]);
  });

  it("says a note past the clipboard's bound in sizes as §9 counts, asking no door", async () => {
    write(noteE, "x".repeat(80_000));
    ce.ops.setSelection([noteE]);
    expect(copySelection(desk, "bar", seams())).toBe(true);
    await flush();
    expect(clipboard).toEqual([]);
    expect(store.snapshot().cards).toEqual([]);
    expect(said).toEqual(["Not copied — the words hold 80 KB; the clipboard takes at most 65 KB"]);
    expect(lastCopy()).toMatchObject({ wrote: false, card: null });
  });

  it("does nothing with nothing selected", () => {
    ce.ops.clearSelection();
    calls = [];
    expect(copySelection(desk, "bar", seams())).toBe(false);
    expect(store.snapshot().cards).toEqual([]);
  });
});

describe("the geometry (copy-to-hand.ts)", () => {
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
});
