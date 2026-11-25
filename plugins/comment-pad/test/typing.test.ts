// TYPING ON THE PAD — the kit's written part (IK, 2026-11-25; ICE I60's `inkPart`, `inkTyping`, `inkActs`), as the pad
// declares it, on a fake world and a fake document. The kit's own rows hold what typing IS (the carry, the paste, the acts'
// letters); these hold what the PAD gives it and keeps of it: the marks its words take and its acts (the words bar's); the
// sink that tells its writing the draft, how the draft's glyphs came, the caret and the selection; its sheet — the pad's
// TEXT PART the desk's one editor is lent to: a tap on a pad takes the editor with the caret where it fell on the writing, a
// tap on anything else is not the pad's, the field is the draft's while it is open and the cell's between drafts, 1 s idle
// lands the draft as ONE transaction writing the words, their hand and their marks together, Escape lets go, a read-only
// document's pad is read and never written; and its GEOMETRY — the editor stood over the writing box on screen, a world
// point in the layout's units and back through the pad as drawn. The real engine's rows (a document, its undo, the acts
// run by `ops.runMenuAction`) are the host's: packages/field-app/test/comment-pad-plugin.test.ts.
import {
  Active,
  Camera,
  type EditorLease,
  type Entity,
  type HandMetrics,
  HIGHLIGHTERS,
  INK_ACTS,
  INK_FIELDS,
  type InkValue,
  inkOf,
  layoutText,
  type MenuActionDef,
  type ObjectDomHost,
  PENS,
} from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  COMMENT_PAD_PART,
  COMMENT_PAD_TYPE,
  commentPad,
  commentPadKind,
  createPadSheet,
  PAD_HAND,
  PAD_MARKS,
  padActs,
  padGeometry,
  padSink,
  writingBox,
} from "../src";

const INK = { name: "vibefield.comment-pad:ink" };
const PROPS = { name: "vibefield.comment-pad:props" };
const PAD = 7 as Entity;
const NOT_A_PAD = 9 as Entity;
const OK_REPORT = {
  docSchema: 3,
  localSchema: 3,
  newerInDoc: [],
  olderInDoc: [],
  renamedInDoc: {},
};

/** The compiled object as the kit reads it: its ink cell by its group's name (its three fields) and its sheet's `seed`. */
const OBJECT = {
  type: COMMENT_PAD_TYPE,
  groups: [
    { name: "ink", component: INK, fields: { text: {}, seeds: {}, marks: {} } },
    { name: "props", component: PROPS, fields: { pen: {}, accent: {}, seed: {} } },
  ],
  propToGroup: {
    text: "ink",
    seeds: "ink",
    marks: "ink",
    pen: "props",
    accent: "props",
    seed: "props",
  },
};

function fakeWorld() {
  const cells = new Map<string, unknown>();
  const tags = new Set<string>([`${PAD}:active`, `${NOT_A_PAD}:active`]);
  const alive = new Set<Entity>([PAD, NOT_A_PAD]);
  const key = (e: Entity, c: { name: string }) => `${e}:${c.name}`;
  cells.set(key(PAD, INK), { text: "first", seeds: "", marks: "" });
  cells.set(key(PAD, PROPS), { pen: "ball", accent: "indigo", seed: 5 });
  const world = {
    get: (e: Entity, c: { name: string }) => {
      // the object's type, as core's `PrefabId` holds it: the kit asks which type an entity is
      if (/PrefabId/.test(c.name))
        return alive.has(e) ? { id: e === PAD ? COMMENT_PAD_TYPE : "other.kind" } : undefined;
      return cells.get(key(e, c));
    },
    has: () => false,
    isAlive: (e: Entity) => alive.has(e),
    hasTag: (e: Entity, t: unknown) => t === Active && tags.has(`${e}:active`),
    edit: (e: Entity) => ({
      set: (c: { name: string }, v: unknown) => {
        cells.set(key(e, c), v);
      },
    }),
    getResource: (r: unknown) => (r === Camera ? { x: -100, y: -50, zoom: 2 } : undefined),
  };
  return {
    world,
    cells,
    tags,
    alive,
    ink: () => cells.get(key(PAD, INK)) as { text: string; seeds: string; marks: string },
  };
}

function fakeDocs(w: ReturnType<typeof fakeWorld>, opts: { readOnly?: boolean } = {}) {
  const commits: unknown[] = [];
  const opened = {
    store: {
      transaction: (fn: (tx: unknown) => void) => {
        const tx = {
          edit: (e: Entity) => {
            const editor = {
              set: (c: { name: string }, v: unknown) => {
                commits.push(v);
                w.world.edit(e).set(c, v);
                return editor;
              },
            };
            return editor;
          },
        };
        fn(tx);
      },
    },
    liveWriter: {},
    readOnly: opts.readOnly ?? false,
    versionReport: () => OK_REPORT,
  };
  return { docs: { current: () => opened }, commits };
}

/** The hand's metrics the tests lay with: every glyph half an em (the layout is the kit's). */
const METRICS: HandMetrics = { ascent: 0.8, descent: 0.25, advance: () => 0.5 };
const BOX = writingBox(220, 280);
const laidOf = (text: string) =>
  layoutText(text, BOX, PAD_HAND, METRICS, 5, inkOf({ text }, 5).seeds);

function fakeWriting() {
  const drafts: { text: string | undefined; how: string | undefined }[] = [];
  const carets: (number | undefined)[] = [];
  const selections: ([number, number] | undefined)[] = [];
  return {
    drafts,
    carets,
    selections,
    writing: {
      setDraft: (_e: Entity, d: InkValue | undefined, arrived?: { how: string }) =>
        drafts.push({ text: d?.text, how: arrived?.how }),
      setCaret: (_e: Entity | undefined, i?: number) => carets.push(i),
      setSelection: (e: Entity | undefined, from?: number, to?: number) =>
        selections.push(e === undefined ? undefined : [from ?? 0, to ?? 0]),
      layoutOf: () => laidOf("first"),
    },
  };
}

describe("the pad's words and their acts", () => {
  it("take every mark the kit has, and its acts are the words bar's: Pen, Highlight, Strike, Underline, Clear — on the words", () => {
    expect([...PAD_MARKS]).toEqual([...INK_FIELDS]);
    const acts = padActs().map((a) => [a.id, a.on]);
    expect(acts).toEqual(Object.values(INK_ACTS).map((id) => [id, "words"]));
    expect(commentPad.menu?.map((a) => a.id)).toEqual(Object.values(INK_ACTS));
  });

  it("their choices carry the pad's own inks as CSS swatches (round two): none before its kind made a look, then the theme's — and a theme change follows", () => {
    const act = (id: string): MenuActionDef | undefined => padActs().find((a) => a.id === id);
    const swatches = (id: string) =>
      act(id)
        ?.choices?.({} as never)
        ?.map((c) => [c.id, c.swatch]);
    // before any desk asked the kind for its look, no colour is said (the bar draws the choices by name)
    expect(swatches(INK_ACTS.pen)).toEqual(PENS.map((n) => [n, undefined]));
    const palette = (tint: number) => ({
      pens: Object.fromEntries(PENS.map((n, i) => [n, { css: `rgb(${i} 0 ${tint})` }])),
      calendars: {
        highlighters: Object.fromEntries(
          HIGHLIGHTERS.map((n, i) => [n, { css: `rgb(0 ${i} ${tint})` }]),
        ),
      },
    });
    const kind = commentPadKind();
    kind.theme?.(palette(1) as never);
    expect(swatches(INK_ACTS.pen)).toEqual(PENS.map((n, i) => [n, `rgb(${i} 0 1)`]));
    // the bound acts (the binding's own `menu`) read the same look, at each read
    const bound = commentPad.menu?.find((a) => a.id === INK_ACTS.highlight);
    expect(bound?.choices?.({} as never)?.map((c) => [c.id, c.swatch])).toEqual([
      ...HIGHLIGHTERS.map((n, i) => [n, `rgb(0 ${i} 1)`]),
      ["none", undefined],
    ]);
    // the theme changes: the colours follow
    kind.theme?.(palette(2) as never);
    expect(swatches(INK_ACTS.highlight)?.[0]).toEqual(["yellow", "rgb(0 0 2)"]);
  });

  it("tell the pad's writing the draft and how its glyphs came, the caret and the selection", () => {
    const fw = fakeWriting();
    const sink = padSink(() => fw.writing as never);
    sink.draft?.(PAD, inkOf({ text: "first!" }, 5), { from: 5, to: 6, how: "typed" });
    sink.draft?.(PAD, undefined);
    sink.caret?.(PAD, 3);
    sink.selection?.(PAD, 1, 4);
    sink.selection?.(undefined);
    expect(fw.drafts).toEqual([
      { text: "first!", how: "typed" },
      { text: undefined, how: undefined },
    ]);
    expect(fw.carets).toEqual([3]);
    expect(fw.selections).toEqual([[1, 4], undefined]);
  });
});

describe("the pad's sheet — the kit's written part", () => {
  function sheetOn(opts: { readOnly?: boolean } = {}) {
    const w = fakeWorld();
    const d = fakeDocs(w, opts);
    const fw = fakeWriting();
    let lent: EditorLease | undefined;
    const element = { selectionStart: 0, selectionEnd: 0, value: "" };
    const editor = {
      element,
      lend: (lease: EditorLease, index?: number) => {
        lent = lease;
        element.value = lease.value() ?? element.value;
        element.selectionStart = index ?? 0;
        element.selectionEnd = index ?? 0;
      },
      release: (lease?: EditorLease) => {
        if (lent !== undefined && (lease === undefined || lease === lent)) {
          const l = lent;
          lent = undefined;
          l.ended();
        }
      },
      lease: () => lent,
      write: () => true,
      blur: () => {},
      follow: () => {},
      placement: () => null,
      command: async () => false,
      dispose: () => {},
    };
    const G = { centre: [100, 80], half: [110, 140], size: { w: 220, h: 280 }, scale: 1 };
    const host = {
      container: {},
      world: w.world,
      docs: d.docs,
      use: () => undefined,
      editor,
      object: OBJECT,
      driver: {
        isPad: (e: Entity) => e === PAD,
        writing: () => fw.writing,
        follow: () => {},
      },
      look: () => undefined,
      geometryOf: (e: Entity) => (e === PAD ? G : undefined),
      hand: () => undefined,
      heldToWorld: () => undefined,
      wake: () => {},
    } as unknown as ObjectDomHost;
    const sheet = createPadSheet(host);
    if (sheet === undefined) throw new Error("no sheet");
    /** A tap at a point of the writing box (pad units from its top-left), the pad at (100, 80) as drawn. */
    const tap = (hit: Entity | undefined, at: readonly [number, number] = [0, 0], found = true) =>
      sheet.tap?.({
        wx: 100 - 110 + BOX.x + at[0],
        wy: 80 - 140 + BOX.y + at[1],
        found,
        hit,
      } as never);
    /** What the platform does with a key: the field's words, its caret after them, then the input. */
    const type = (lease: EditorLease, value: string) => {
      element.value = value;
      element.selectionStart = value.length;
      element.selectionEnd = value.length;
      lease.input(value);
    };
    return { w, d, fw, sheet, editor, element, tap, type, take: (l: EditorLease) => (lent = l) };
  }

  it("names its part, and a TAP on a pad takes the editor with the caret where the tap fell on its writing; anything else is not the pad's", () => {
    const s = sheetOn();
    expect(s.sheet.part).toBe(COMMENT_PAD_PART);
    expect(s.tap(NOT_A_PAD)).toBeUndefined();
    expect(s.tap(undefined)).toBeUndefined();
    expect(s.tap(PAD, [0, 0], false)).toBeUndefined(); // the pointer is gone: the pad names no sheet to find
    const atStart = s.tap(PAD, [0.5, PAD_HAND.size * 0.5]);
    expect(atStart?.caret).toBe(0);
    expect(atStart?.lease.part).toBe(COMMENT_PAD_PART);
    expect(atStart?.lease.entity).toBe(PAD); // the words' menu is its own
    expect(atStart?.lease.label).toBe("write on the comment pad");
    // after its third letter, on its one line; past the line's end, low on the box: the words' end
    const third = laidOf("first").positions[2 * 3] ?? 0;
    expect(s.tap(PAD, [third + 0.5, PAD_HAND.size * 0.5])?.caret).toBe(3);
    expect(s.tap(PAD, [BOX.w - 4, BOX.h - 2])?.caret).toBe(5);
  });

  it("the field is the CELL's between drafts and the draft's while it is open; idle lands ONE transaction — the words, their hand and their marks; Escape lets go", () => {
    const s = sheetOn();
    const lease = s.tap(PAD)?.lease;
    if (lease === undefined) throw new Error("no lease");
    s.take(lease);
    s.element.value = "first";
    expect(lease.value()).toBe("first");
    s.type(lease, "first new");
    expect(lease.value()).toBeNull(); // a draft is open: the field is the truth
    expect(s.w.ink().text).toBe("first"); // the document has not moved
    expect(s.fw.drafts.at(-1)).toEqual({ text: "first new", how: "typed" });
    expect(s.fw.carets.at(-1)).toBe(9);
    expect(s.fw.selections.at(-1)).toEqual([9, 9]);
    lease.idle(); // 1 s without input: the draft lands
    expect(s.d.commits).toEqual([
      expect.objectContaining({ text: "first new", seeds: expect.any(String), marks: "" }),
    ]);
    expect(s.fw.drafts.at(-1)).toEqual({ text: undefined, how: undefined }); // the cell is drawn again
    expect(lease.value()).toBe("first new");
    lease.idle(); // nothing open: nothing lands
    expect(s.d.commits).toHaveLength(1);
    expect(lease.keydown({ key: "a" } as KeyboardEvent)).toBe(false);
    expect(lease.keydown({ key: "Escape" } as KeyboardEvent)).toBe(true);
    expect(s.sheet.editing()).toBeUndefined();
    expect(s.fw.carets.at(-1)).toBeUndefined(); // the caret and the wash go with the lease
    expect(s.fw.selections.at(-1)).toBeUndefined();
  });

  it("a draft that NETS TO NOTHING lands nothing; a lease ends when its pad is cut from the frame, and its draft lands as it does", () => {
    const s = sheetOn();
    const lease = s.tap(PAD)?.lease;
    if (lease === undefined) throw new Error("no lease");
    s.take(lease);
    s.type(lease, "firstX");
    s.type(lease, "first");
    lease.idle();
    expect(s.d.commits).toEqual([]);
    expect(lease.live?.()).toBe(true);
    s.w.tags.delete(`${PAD}:active`); // a nav cut: the pad is no longer in the frame
    expect(lease.live?.()).toBe(false);
    s.type(lease, "first, then cut");
    lease.ended();
    expect(s.w.ink().text).toBe("first, then cut");
  });

  it("a read-only document's pad is read, never written: a tap takes nothing", () => {
    expect(sheetOn({ readOnly: true }).tap(PAD)).toBeUndefined();
  });
});

describe("the pad's geometry", () => {
  const G = { centre: [100, 80], half: [121, 154], size: { w: 220, h: 280 }, scale: 1.1 };
  const geometry = padGeometry(
    {
      world: fakeWorld().world as never,
      geometryOf: (e: Entity) => (e === PAD ? G : undefined),
    } as never,
    () => ({ layoutOf: () => laidOf("first") }) as never,
  );

  it("stands the editor over the WRITING BOX on screen, from the camera, in the pad's hand", () => {
    const flat = padGeometry(
      {
        world: fakeWorld().world as never,
        geometryOf: () => ({ centre: [100, 80], size: { w: 220, h: 280 }, scale: 1 }),
      } as never,
      () => undefined,
    );
    // the camera at (−100, −50), zoom 2; the pad's centre (100, 80), its top-left (−10, −60)
    expect(flat.place(PAD)).toMatchObject({
      x: (-10 + BOX.x + 100) * 2,
      y: (-60 + BOX.y + 50) * 2,
      w: BOX.w * 2,
      h: BOX.h * 2,
      fontPx: PAD_HAND.size * 2,
      wrap: true,
    });
  });

  it("maps a world point into the layout's units and back through the pad as drawn — a held pad's scale in — and nothing off the sheet", () => {
    const back = geometry.toWorld(PAD, 12, 30);
    if (back === undefined) throw new Error("no world point");
    const there = geometry.toLayout(PAD, back[0], back[1]);
    expect(there?.[0]).toBeCloseTo(12, 9);
    expect(there?.[1]).toBeCloseTo(30, 9);
    expect(back[0]).toBeCloseTo(100 + (BOX.x + 12 - 110) * 1.1, 9);
    expect(geometry.toLayout(PAD, 100 + 125, 80)).toBeUndefined(); // past the sheet's right edge
    expect(geometry.toLayout(NOT_A_PAD, 100, 80)).toBeUndefined();
    expect(geometry.layout(PAD)?.glyphs).toHaveLength(5);
  });
});
