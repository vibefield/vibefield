// THE COMMENT PAD IN THE HOST (DK-8, DK-D14) — VibeField's own kind, a PLUGIN's (`plugins/comment-pad`, through
// `@vibefield/plugin-sdk/desk` alone), compiled by the host exactly as ICE compiles a built-in: the host reads the
// export its manifest row names (`objectBindingsFrom`), compiles the row's durable half with it through
// `defineObject` (`buildRegistry`), and the desk's catalog finds the kind by its OBJECT, places it, hangs it on no
// hook, and carries its DECLARED halves — its driver, its sheet (the text part the desk lends its one editor) and
// its menu. Then the whole road a line of text takes, on a REAL engine and document: the sheet the compiled
// object declares, its driver the one it declares, a draft written and landed as ONE transaction through the
// document's writer's gate — and one undo step takes the line back.
//
// IK (2026-11-25): the pad's writing is the KIT'S (ICE I60 — `inkPart`, `inkTyping`, `inkActs`), its words keep their
// MARKS (`ink`: the text, its seeds and its marks, one cell): the words bar's acts — Pen, Highlight, Strike, Underline,
// Clear — each ONE undoable step on the cell through `ops.runMenuAction`, an open draft landed first as its own; a word
// typed inside a highlight, and over one, keeps it; a copy lifts the words with their marks and a paste lays them back;
// a typing with its marks undone in one step.
import { defineQuery, Not, Position, PrefabId, Size, Specimen } from "@vibecook/ice";
import {
  CONTAINABLE,
  DESK_OBJECT,
  driversOf,
  type EditorLease,
  highlightOf,
  hostOf,
  INK_ACTS,
  inkOf,
  type ObjectDomHost,
  objectKindOf,
  penOf,
  strikeOf,
  underlineOf,
} from "@vibecook/ice/desk";
import * as pad from "@vibefield/plugin-comment-pad";
import { describe, expect, it } from "vitest";
import { buildDevRegistry, buildRegistry, createFieldEngine } from "../src/field-engine";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";

const { COMMENT_PAD_PART, COMMENT_PAD_TYPE, commentPadManifest } = pad;
const rows = commentPadManifest.contributes?.objects ?? [];

/** The registry a dev run builds with the pad's plugin ON: the host's own reading of its module. */
const withPad = () =>
  buildRegistry({
    generation: -1,
    staged: [],
    bundled: [
      {
        manifest: commentPadManifest,
        mod: pad.commentPadRenderer,
        objectBindings: objectBindingsFrom(pad, rows),
      },
    ],
  });

const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

/**
 * A pad on a REAL engine and document, written as the desk writes it: the driver the compiled object DECLARES, made on the
 * kind host; the sheet its DOM half DECLARES, over an editor that does what the platform's field does (its words, its caret
 * after an input, the field written by a paste).
 */
function padDesk(text = "") {
  const registry = withPad();
  const widget = registry.allWidgets().get(COMMENT_PAD_TYPE);
  if (widget === undefined) throw new Error("the pad is not registered");
  const ce = createFieldEngine(registry);
  ce.docs.create();
  // laid outside the undo stack: every step these rows undo is the pad's writing
  ce.ops.spawnWidget(COMMENT_PAD_TYPE, {
    x: 0,
    y: 0,
    w: 220,
    h: 280,
    props: { text },
    undoable: false,
  });
  ce.world.sync();
  let padEntity: number | undefined;
  ce.world.query(objectsQ).each((batch) => {
    for (const row of batch) {
      const e = batch.entity(row);
      if (ce.world.get(e, PrefabId)?.id === COMMENT_PAD_TYPE) padEntity = e as number;
    }
  });
  if (padEntity === undefined) throw new Error("no pad was laid");
  const e = padEntity as never;
  const isPad = (x: unknown) => ce.world.get(x as never, PrefabId)?.id === COMMENT_PAD_TYPE;
  const driver = driversOf(widget)?.({
    world: ce.world,
    docs: ce.docs,
    local: undefined,
    look: () => undefined,
    isKind: isPad,
    kind: () => undefined,
    provides: () => undefined,
    geometryOf: () => undefined,
    heldToWorld: () => undefined,
    hand: () => undefined,
    refused: () => {},
    wake: () => {},
  } as never);
  let lent: EditorLease | undefined;
  const element = { selectionStart: 0, selectionEnd: 0, value: "" };
  const editor = {
    element,
    lend: (lease: EditorLease, index?: number) => {
      lent = lease;
      element.value = lease.value() ?? element.value;
      element.selectionStart = index ?? element.value.length;
      element.selectionEnd = element.selectionStart;
    },
    release: () => {
      const l = lent;
      lent = undefined;
      l?.ended();
    },
    lease: () => lent,
    write: (words: string, from: number, to: number) => {
      element.value = element.value.slice(0, from) + words + element.value.slice(to);
      element.selectionStart = from + words.length;
      element.selectionEnd = element.selectionStart;
      return true;
    },
    blur: () => {},
    follow: () => {},
    placement: () => null,
    command: async () => false,
    dispose: () => {},
  };
  const parts = hostOf(widget)?.text?.({
    container: {},
    world: ce.world,
    docs: ce.docs,
    use: () => undefined,
    editor,
    object: widget,
    driver,
    look: () => undefined,
    geometryOf: () => undefined,
    hand: () => undefined,
    heldToWorld: () => undefined,
    wake: () => {},
  } as unknown as ObjectDomHost);
  const sheet = parts?.[0] as pad.PadSheet | undefined;
  if (sheet === undefined) throw new Error("the pad declares no sheet");
  const inkCell = widget.groups.find((g) => g.name === "ink")?.component;
  if (inkCell === undefined) throw new Error("no ink cell");
  /** The pad's cell as the document holds it. */
  const cell = () =>
    (ce.world.get(e, inkCell) as { text: string; seeds: string; marks: string } | undefined) ?? {
      text: "",
      seeds: "",
      marks: "",
    };
  /** The marks the cell holds over [from, to), each field read by `read`. */
  const marks = (from: number, to: number, read: (m: number) => number) =>
    inkOf(cell(), 0).marks.slice(from, to).map(read);
  /** The lease the sheet took on the pad (the editor lent at `index`). */
  const lease = (index?: number): EditorLease => {
    expect(sheet.focus(e, index)).toBe(true);
    if (lent === undefined) throw new Error("the sheet took no lease");
    return lent;
  };
  /** What the platform does with a key or an IME commit: the field's words, the caret where the edit ends, then the input. */
  const type = (l: EditorLease, value: string, caret = value.length) => {
    element.value = value;
    element.selectionStart = caret;
    element.selectionEnd = caret;
    l.input(value);
  };
  /** Undo as ⌘Z does, the world shown the document (the bare engine projects at `sync`). */
  const undo = (): boolean => {
    const did = ce.docs.undo();
    ce.world.sync();
    return did;
  };
  return { ce, widget, e, sheet, editor, element, cell, marks, lease, type, undo, isPad };
}

/**
 * THE ACTS' ONE DOOR in these rows: an act run on the pad's words, and what an act shows for them (the words bar's state —
 * a choice's `chosen`, a toggle's `pressed`), as the desk's anchor reads them. ICE's menu-act shape moves once before its
 * release (`chosen` → a choice's `current`, `pressed` into the act's state, `runMenuAction`'s arguments): only this changes.
 */
function actsOn(p: ReturnType<typeof padDesk>) {
  const def = (id: string) => {
    const act = p.widget.menu.find((a) => a.id === id);
    if (act === undefined) throw new Error(`the pad offers no act ${id}`);
    return act;
  };
  const ctx = (from: number, to: number) => ({
    world: p.ce.world,
    entities: [p.e],
    props: (x: never) => propsOf(p, x),
    range: { entity: p.e, from, to },
  });
  return {
    run: (id: string, from: number, to: number, choice?: string): boolean =>
      p.ce.ops.runMenuAction(id, {
        ...(choice !== undefined ? { choice } : {}),
        range: { entity: p.e, from, to },
      }),
    state: (id: string, from: number, to: number) => {
      const act = def(id);
      const c = ctx(from, to) as never;
      return { chosen: act.chosen?.(c), pressed: act.pressed?.(c) };
    },
  };
}

/** A pad's props as an act reads them: every group's cell, flat. */
function propsOf(p: ReturnType<typeof padDesk>, e: never): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const g of p.widget.groups)
    Object.assign(out, (p.ce.world.get(e, g.component) as object | undefined) ?? {});
  return out;
}

describe("the host compiles VibeField's comment pad as ICE compiles a built-in (K-L2)", () => {
  it("reads the export the row names, and the desk finds the kind by its OBJECT", () => {
    const widget = withPad().allWidgets().get(COMMENT_PAD_TYPE);
    expect(objectKindOf(widget)).toBe(pad.commentPad.kind);
    expect(widget?.stratum).toBe("things");
    expect(widget?.defaultSize).toEqual({ w: 220, h: 280 });
  });

  it("hangs it on no hook (Comment is its door), lays it on the desk and lets it into a mini mat by what it provides", () => {
    const widget = withPad().allWidgets().get(COMMENT_PAD_TYPE);
    expect(widget?.tray).toBeUndefined();
    expect(widget?.provides).toEqual([COMMENT_PAD_TYPE, DESK_OBJECT, CONTAINABLE]);
    const ce = createFieldEngine(withPad());
    expect(ce.catalog.placementFor(ce.catalog.rootCanvas.id).has(COMMENT_PAD_TYPE)).toBe(true);
    ce.dispose();
  });

  it("is a PRODUCT plugin: a dev run with no staged artifact registers it from the dev-bundled set, its kind bound", async () => {
    const widget = (await buildDevRegistry()).allWidgets().get(COMMENT_PAD_TYPE);
    expect(objectKindOf(widget)).toBe(pad.commentPad.kind);
  });

  it("compiles its writing as ONE cell (`ink`: the text, its seeds and its marks) and carries its DECLARED halves: its driver, its sheet and the words' acts", () => {
    const widget = withPad().allWidgets().get(COMMENT_PAD_TYPE);
    const ink = widget?.groups.find((g) => g.name === "ink");
    expect(Object.keys(ink?.fields ?? {}).sort()).toEqual(["marks", "seeds", "text"]);
    expect(driversOf(widget)).toBe(pad.padDriver);
    expect(typeof hostOf(widget)?.text).toBe("function");
    expect(widget?.menu.map((a) => [a.id, a.on])).toEqual(
      Object.values(INK_ACTS).map((id) => [id, "words"]),
    );
    expect(widget?.openable).toBe(false); // a pad is written in place, never picked up to be set
  });

  it("takes a LINE OF TEXT on a real document: its declared sheet leases the editor, the draft lands as ONE transaction, and one undo takes it back", () => {
    const p = padDesk();
    expect(p.sheet.part).toBe(COMMENT_PAD_PART);
    const lease = p.lease();
    expect(lease.value()).toBe("");
    for (const typed of ["a", "a l", "a line of text"]) p.type(lease, typed);
    expect(p.cell().text).toBe(""); // the document has not moved — the draft is the kit's, drawn by the pad
    lease.idle(); // the typing's end: ONE transaction
    expect(p.cell().text).toBe("a line of text");
    expect(lease.value()).toBe("a line of text");
    expect(p.undo()).toBe(true); // one undo step takes the whole line back, never a keystroke
    expect(p.cell().text).toBe("");
    p.ce.dispose();
  });

  it("a pad stored before the marks reads unmarked: its cell projects with the marks' default", () => {
    const p = padDesk("one two");
    expect(p.cell()).toMatchObject({ text: "one two", marks: "" });
    expect(actsOn(p).state(INK_ACTS.highlight, 4, 7).chosen).toBe("none");
    p.ce.dispose();
  });
});

describe("the pad's words take the desk's marks (IK — the words bar's acts, ICE I60)", () => {
  it("each act is ONE undoable step on the cell — a pen, a highlighter, None, Strike and Underline as toggles, Clear — and its state is the words' own", () => {
    const p = padDesk("one two three");
    const acts = actsOn(p);
    // nothing marked: the sheet's own pen, no highlighter, the toggles off
    expect(acts.state(INK_ACTS.pen, 4, 7).chosen).toBe("ball");
    expect(acts.state(INK_ACTS.highlight, 4, 7).chosen).toBe("none");
    expect(acts.state(INK_ACTS.strike, 4, 7).pressed).toBe(false);
    expect(acts.run(INK_ACTS.highlight, 4, 7, "yellow")).toBe(true);
    expect(p.marks(4, 7, highlightOf)).toEqual([1, 1, 1]);
    expect(acts.state(INK_ACTS.highlight, 4, 7).chosen).toBe("yellow");
    expect(acts.run(INK_ACTS.pen, 4, 7, "red")).toBe(true);
    expect(p.marks(4, 7, penOf)).toEqual([4, 4, 4]); // red: PENS' fourth
    expect(acts.state(INK_ACTS.pen, 4, 7).chosen).toBe("red");
    expect(acts.run(INK_ACTS.strike, 0, 3)).toBe(true);
    expect(p.marks(0, 3, strikeOf)).toEqual([1, 1, 1]);
    expect(acts.state(INK_ACTS.strike, 0, 3).pressed).toBe(true);
    expect(acts.run(INK_ACTS.strike, 0, 3)).toBe(true); // pressed again: lifted
    expect(p.marks(0, 3, strikeOf)).toEqual([0, 0, 0]);
    expect(acts.run(INK_ACTS.underline, 8, 13)).toBe(true);
    expect(p.marks(8, 13, underlineOf)).toEqual([1, 1, 1, 1, 1]);
    expect(acts.run(INK_ACTS.highlight, 4, 7, "none")).toBe(true);
    expect(p.marks(4, 7, highlightOf)).toEqual([0, 0, 0]);
    expect(acts.run(INK_ACTS.clear, 0, 13)).toBe(true);
    expect(p.cell()).toMatchObject({ text: "one two three", marks: "" });
    // seven acts that moved something: seven steps, the words as they were at the end of them
    let undos = 0;
    while (p.undo()) undos += 1;
    expect(undos).toBe(7);
    expect(p.cell()).toMatchObject({ text: "one two three", marks: "" });
    p.ce.dispose();
  });

  it("an act on a pad with an OPEN draft lands the draft first — its own step — then marks the draft's words; the editor stays on it", () => {
    const p = padDesk("one two");
    const lease = p.lease();
    p.type(lease, "one two three");
    expect(p.cell().text).toBe("one two"); // the draft is open
    expect(actsOn(p).run(INK_ACTS.underline, 8, 13)).toBe(true); // "three", in the draft
    expect(p.cell().text).toBe("one two three");
    expect(p.marks(8, 13, underlineOf)).toEqual([1, 1, 1, 1, 1]);
    expect(p.sheet.editing()).toBe(p.e);
    expect(p.undo()).toBe(true); // the mark
    expect(p.cell()).toMatchObject({ text: "one two three", marks: "" });
    expect(p.undo()).toBe(true); // the draft
    expect(p.cell().text).toBe("one two");
    p.ce.dispose();
  });

  it("a word TYPED inside a highlight takes it, and one typed OVER highlighted words keeps it for the whole word; the typing with its marks lands as ONE step", () => {
    const p = padDesk("one two three");
    expect(actsOn(p).run(INK_ACTS.highlight, 4, 7, "green")).toBe(true);
    const lease = p.lease();
    p.type(lease, "one twXo three", 7); // a letter typed inside the highlighted "two"
    // "twXo" typed over as "Mon": the selection replaced by its first letter, then two more at its end
    p.type(lease, "one M three", 5);
    p.type(lease, "one Mo three", 6);
    p.type(lease, "one Mon three", 7);
    lease.idle();
    expect(p.cell().text).toBe("one Mon three");
    expect(p.marks(4, 7, highlightOf)).toEqual([2, 2, 2]); // green: the second
    expect(p.marks(0, 4, highlightOf)).toEqual([0, 0, 0, 0]);
    expect(p.undo()).toBe(true); // the typing, words and marks in one step
    expect(p.cell().text).toBe("one two three");
    expect(p.marks(4, 7, highlightOf)).toEqual([2, 2, 2]);
    p.ce.dispose();
  });

  it("a COPY lifts the words with their marks, and a PASTE lays them back marked — in a fresh hand, landed with the typing", () => {
    const p = padDesk("one two");
    expect(actsOn(p).run(INK_ACTS.strike, 4, 7)).toBe(true);
    const lease = p.lease();
    const lifted = lease.lift?.(4, 7);
    expect(lifted?.text).toBe("two");
    expect(lifted?.html).toContain("<s>two</s>");
    const piece = lifted?.piece;
    if (piece === undefined) throw new Error("the copy carried no piece");
    // pasted at the end, after a space: the piece's words and their strike
    p.type(lease, "one two ");
    expect(lease.lay?.({ text: "two", piece }, 8, 8)).toBe(true);
    expect(p.element.value).toBe("one two two");
    lease.idle();
    expect(p.cell().text).toBe("one two two");
    expect(p.marks(8, 11, strikeOf)).toEqual([1, 1, 1]);
    const seeds = inkOf(p.cell(), 0).seeds;
    expect(seeds.slice(8, 11)).not.toEqual(seeds.slice(4, 7)); // a fresh hand, never the copied letters' own
    p.ce.dispose();
  });
});
