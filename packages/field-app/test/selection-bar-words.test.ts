// @vitest-environment node
/**
 * IK — WHAT THE WORDS BAR SAYS (field/desk/bar/bar-words.ts; DESIGN.md §8 "The words bar" — Order, The rows, The
 * highlighters; ICE I60 on I61/I62's act shape). While a sheet is written and words on it are selected, the anchor's
 * `words.menu` holds the object's WORDS acts as slots; the bar prints them as the kind declares them, read off their own
 * data, never their ids:
 *   a choice act (`choices`) a 44 × 32 cell with the words' current value — the `current` choice's swatch, a dot for a pen
 *   and a stripe for a highlighter (by the act's GLYPH, `pen` or `highlighter`), hollow when none is shared — then its
 *   choices as their own row (None hollow among stripes);
 *   a toggle (`pressed`) on while its kind says so; a plain act its glyph or its label; a rule where the run changes; the
 *   desk's More at the end (it grows the words' menu, V5b); a slot's declared keys in its tip; `enabled: false` dim.
 * A swatch is the CSS colour a kind says (the pad's, `inkActs({ colour })`); where it says none (ICE's own note) a pen's or a
 * highlighter's choice is drawn from the desk's own palette by its NAME, so the bar shows no colour the host never named.
 */
import type { MenuSlot } from "@vibecook/ice/desk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSlot,
  type SwatchPalette,
  swatchFor,
  type WordsCell,
  type WordsFace,
  wordsCells,
  wordsKey,
} from "../src/field/desk/bar/bar-words";
import { deskLook } from "../src/field/desk/desk-layer";

afterEach(() => {
  vi.restoreAllMocks();
});

const PENS = ["felt", "ball", "fountain", "red"] as const;
const HIGHLIGHTERS = ["yellow", "green", "pink", "blue", "orange"] as const;
const titled = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/** A kind's own colours for the roles (the pad's `colour(role)`): one CSS string each, none the desk palette's. */
const PAD_COLOUR = (role: string): string => `rgb(${role.length} ${role.charCodeAt(4)} 9)`;

/**
 * ICE's ink acts as the anchor carries them (this build's `inkActs`: ids `ink.*`, glyphs `pen` and `highlighter` by name,
 * the marks' keys declared, the words' value as `current` on one choice), each as it stands for the words now. `colour`:
 * the kind's (the pad's) — absent, its choices carry no swatch (ICE's own note).
 */
function inkMenu(
  now: { pen?: string; highlight?: string; strike?: boolean; underline?: boolean } = {},
  colour?: (role: string) => string,
): MenuSlot[] {
  const swatch = (role: string) => (colour === undefined ? {} : { swatch: colour(role) });
  const current = (id: string, at: string | undefined) => (id === at ? { current: true } : {});
  return [
    {
      id: "ink.pen",
      label: "Pen",
      glyph: "pen",
      choices: PENS.map((n) => ({
        id: n,
        label: `${titled(n)} pen`,
        ...swatch(`pen.${n}`),
        ...current(n, now.pen),
      })),
    },
    {
      id: "ink.highlight",
      label: "Highlight",
      glyph: "highlighter",
      keys: "⇧⌘H",
      choices: [
        ...HIGHLIGHTERS.map((n) => ({
          id: n,
          label: titled(n),
          ...swatch(`highlight.${n}`),
          ...current(n, now.highlight),
        })),
        { id: "none", label: "None", ...current("none", now.highlight) },
      ],
    },
    {
      id: "ink.strike",
      label: "Strike",
      glyph: "strike",
      keys: "⇧⌘X",
      pressed: now.strike ?? false,
    },
    {
      id: "ink.underline",
      label: "Underline",
      glyph: "underline",
      keys: "⌘U",
      pressed: now.underline ?? false,
    },
    { id: "ink.clear", label: "Clear", glyph: "clear-marks" },
  ];
}

/** The product's palette, as the stage dresses the desk in the light theme. */
const LIGHT = deskLook("light").palette;

/** A face as one word: `dot:<ink>`, `stripe:hollow`, `glyph:<name>`, `label`. */
const faceOf = (face: WordsFace): string =>
  face.by === "swatch"
    ? `${face.swatch.shape}:${face.swatch.ink ?? "hollow"}`
    : face.by === "glyph"
      ? `glyph:${typeof face.glyph === "string" ? face.glyph : "path"}`
      : "label";

/** The row as a reader meets it: each cell's kind and id, `|` a rule. */
const said = (cells: readonly WordsCell[]): string[] =>
  cells.map((cell) => {
    switch (cell.kind) {
      case "rule":
        return "|";
      case "more":
        return "more";
      case "toggle":
        return `toggle:${cell.id}${cell.on ? ":on" : ""}`;
      default:
        return `${cell.kind}:${cell.id}`;
    }
  });

const choice = (cells: readonly WordsCell[], id: string) => {
  const cell = cells.find((c) => c.kind === "choice" && c.id === id);
  if (cell?.kind !== "choice") throw new Error(`no choice act ${id}`);
  return cell;
};

describe("the words row", () => {
  it("in the kind's declared order: Pen ▾ · Highlight ▾ · rule · Strike · Underline · rule · Clear · More", () => {
    expect(said(wordsCells(inkMenu(), LIGHT))).toEqual([
      "choice:ink.pen",
      "choice:ink.highlight",
      "|",
      "toggle:ink.strike",
      "toggle:ink.underline",
      "|",
      "act:ink.clear",
      "more",
    ]);
  });

  it("reads each slot by its own data, never its id: a rule only where the run changes, More always last", () => {
    // the same acts under other names, toggles first — the bar prints what the kind declares
    const menu: MenuSlot[] = [
      { id: "a", label: "Bold", glyph: "strike", pressed: true },
      { id: "b", label: "Lean", pressed: false },
      { id: "c", label: "Wipe" },
      { id: "d", label: "Ink", choices: [{ id: "x", label: "X", swatch: "rgb(1 2 3)" }] },
    ];
    expect(said(wordsCells(menu, LIGHT))).toEqual([
      "toggle:a:on",
      "toggle:b",
      "|",
      "act:c",
      "|",
      "choice:d",
      "more",
    ]);
    // a kind with one act: no rule, More after it
    expect(said(wordsCells([{ id: "c", label: "Clear" }], LIGHT))).toEqual(["act:c", "more"]);
    // a choice act declaring an empty list of choices offers none: a plain act
    expect(said(wordsCells([{ id: "e", label: "Empty", choices: [] }], LIGHT))).toEqual([
      "act:e",
      "more",
    ]);
    const more = wordsCells([], LIGHT).at(-1);
    expect(more).toEqual({ kind: "more", label: "More", tip: "More" });
  });

  it("a toggle is on while its kind says so; its glyph and label as declared, its tip its label and its declared keys", () => {
    const cells = wordsCells(inkMenu({ underline: true }), LIGHT);
    const strike = cells.find((c) => c.kind === "toggle" && c.id === "ink.strike");
    const underline = cells.find((c) => c.kind === "toggle" && c.id === "ink.underline");
    expect(strike).toEqual({
      kind: "toggle",
      id: "ink.strike",
      label: "Strike",
      tip: "Strike  ⇧⌘X",
      disabled: false,
      glyph: "strike",
      on: false,
    });
    expect(underline?.kind === "toggle" && underline.on).toBe(true);
    const clear = cells.find((c) => c.kind === "act");
    expect(clear).toEqual({
      kind: "act",
      id: "ink.clear",
      label: "Clear",
      tip: "Clear",
      disabled: false,
      glyph: "clear-marks",
    });
  });
});

describe("a choice act's cell and its row", () => {
  it("THE NOTE'S (no swatch said): the cell shows the words' current value from the desk's palette by NAME — their pen a dot, their highlighter a stripe", () => {
    const cells = wordsCells(inkMenu({ pen: "fountain", highlight: "yellow" }), LIGHT);
    expect(faceOf(choice(cells, "ink.pen").face)).toBe(`dot:${LIGHT.pens?.fountain?.css}`);
    expect(faceOf(choice(cells, "ink.highlight").face)).toBe(
      `stripe:${LIGHT.calendars?.highlighters?.yellow?.css}`,
    );
    expect(choice(cells, "ink.pen").tip).toBe("Pen");
    expect(choice(cells, "ink.highlight").tip).toBe("Highlight  ⇧⌘H");
  });

  it("THE PAD'S (a CSS colour said, `colour(role)`): each choice draws the colour its kind says, never the palette's", () => {
    const cells = wordsCells(inkMenu({ pen: "red", highlight: "blue" }, PAD_COLOUR), LIGHT);
    expect(faceOf(choice(cells, "ink.pen").face)).toBe(`dot:${PAD_COLOUR("pen.red")}`);
    expect(faceOf(choice(cells, "ink.highlight").face)).toBe(
      `stripe:${PAD_COLOUR("highlight.blue")}`,
    );
    expect(choice(cells, "ink.pen").choices.map((c) => faceOf(c.face))).toEqual(
      PENS.map((n) => `dot:${PAD_COLOUR(`pen.${n}`)}`),
    );
    // None says no colour: a hollow stripe among the stripes
    expect(choice(cells, "ink.highlight").choices.map((c) => faceOf(c.face))).toEqual([
      ...HIGHLIGHTERS.map((n) => `stripe:${PAD_COLOUR(`highlight.${n}`)}`),
      "stripe:hollow",
    ]);
  });

  it("hollow when the words share none, and for None: the shape of its act, no ink", () => {
    for (const colour of [undefined, PAD_COLOUR]) {
      const mixed = wordsCells(inkMenu({}, colour), LIGHT);
      expect(faceOf(choice(mixed, "ink.pen").face)).toBe("dot:hollow");
      expect(faceOf(choice(mixed, "ink.highlight").face)).toBe("stripe:hollow");
      const none = wordsCells(inkMenu({ highlight: "none" }, colour), LIGHT);
      expect(faceOf(choice(none, "ink.highlight").face)).toBe("stripe:hollow");
    }
  });

  it("its row: each choice its swatch, None hollow among the stripes, the words' choice on", () => {
    const cells = wordsCells(inkMenu({ pen: "ball", highlight: "pink" }), LIGHT);
    const pens = choice(cells, "ink.pen").choices;
    expect(pens.map((c) => [c.id, c.label, faceOf(c.face), c.on])).toEqual(
      PENS.map((n) => [n, `${titled(n)} pen`, `dot:${LIGHT.pens?.[n]?.css}`, n === "ball"]),
    );
    const highlights = choice(cells, "ink.highlight").choices;
    expect(highlights.map((c) => [c.id, faceOf(c.face), c.on])).toEqual([
      ...HIGHLIGHTERS.map((n) => [
        n,
        `stripe:${LIGHT.calendars?.highlighters?.[n]?.css}`,
        n === "pink",
      ]),
      ["none", "stripe:hollow", false],
    ]);
  });

  it("dot or stripe by the act's GLYPH, never its id: under any other glyph a colour said is a dot, and no colour said is a label", () => {
    const phones: MenuSlot = {
      id: "ink.highlight", // the id names nothing: the glyph does
      label: "Finish",
      glyph: "duplicate",
      choices: [
        { id: "yellow", label: "Gold", swatch: "rgb(200 180 90)", current: true },
        { id: "pink", label: "Rose" },
      ],
    };
    const cell = choice(wordsCells([phones], LIGHT), "ink.highlight");
    expect(faceOf(cell.face)).toBe("dot:rgb(200 180 90)");
    expect(cell.choices.map((c) => faceOf(c.face))).toEqual(["dot:rgb(200 180 90)", "dot:hollow"]);
    // no colour at all under a glyph that is no ink's: labels, and the act's own glyph for its value
    const fonts: MenuSlot = {
      id: "font",
      label: "Font",
      glyph: "chevron",
      choices: [
        { id: "a", label: "Upright", current: true },
        { id: "b", label: "Lean" },
      ],
    };
    const font = choice(wordsCells([fonts], LIGHT), "font");
    expect(faceOf(font.face)).toBe("glyph:chevron");
    expect(font.choices.map((c) => faceOf(c.face))).toEqual(["label", "label"]);
    const { glyph: _drop, ...bare } = fonts;
    expect(faceOf(choice(wordsCells([bare], LIGHT), "font").face)).toBe("label");
    // a kind's own drawing for the highlighter is no ink's glyph: its choices are labels (unless it says colours)
    const drawn = inkMenu().map((s) =>
      s.id === "ink.highlight" ? { ...s, glyph: { path: "M5 20h14" } } : s,
    );
    expect(
      choice(wordsCells(drawn, LIGHT), "ink.highlight").choices.map((c) => faceOf(c.face)),
    ).toEqual([...HIGHLIGHTERS.map(() => "label"), "label"]);
  });
});

describe("the swatches: the kind's colours, else the desk's own palette by name (DESIGN.md §8 'The highlighters')", () => {
  it("a pen's name reads the pens the note writes with; a highlighter's, the calendar's five — in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const palette = deskLook(theme).palette;
      for (const n of PENS)
        expect(swatchFor({ shape: "dot", name: n }, palette)).toEqual({
          shape: "dot",
          ink: palette.pens?.[n]?.css,
        });
      for (const n of HIGHLIGHTERS)
        expect(swatchFor({ shape: "stripe", name: n }, palette)).toEqual({
          shape: "stripe",
          ink: palette.calendars?.highlighters?.[n]?.css,
        });
    }
    // the five are the calendar's own, named by DESIGN.md (§8 "The highlighters")
    expect(HIGHLIGHTERS.map((n) => LIGHT.calendars?.highlighters?.[n]?.css.toLowerCase())).toEqual([
      "#f2d64f",
      "#b4d98a",
      "#f0a9bf",
      "#a3cde8",
      "#f4b673",
    ]);
  });

  it("the note's row shows no colour the host never named: every ink in it is one of the palette's", () => {
    const palette: SwatchPalette = LIGHT;
    const named = new Set([
      ...Object.values(palette.pens ?? {}).map((t) => t.css),
      ...Object.values(palette.calendars?.highlighters ?? {}).map((t) => t.css),
    ]);
    const cells = wordsCells(inkMenu({ pen: "red", highlight: "orange" }), palette);
    const inks: string[] = [];
    for (const cell of cells) {
      if (cell.kind !== "choice") continue;
      for (const face of [cell.face, ...cell.choices.map((c) => c.face)])
        if (face.by === "swatch" && face.swatch.ink !== undefined) inks.push(face.swatch.ink);
    }
    expect(inks.length).toBe(2 + PENS.length + HIGHLIGHTERS.length);
    for (const ink of inks) expect(named.has(ink), ink).toBe(true);
  });

  it("a name the palette lacks — an unknown pen, a palette without highlighters, a prototype's name — draws hollow; a colour is drawn as said", () => {
    const palette: SwatchPalette = { pens: { felt: { css: "rgb(1 2 3)" } } };
    expect(swatchFor({ shape: "dot", name: "felt" }, palette).ink).toBe("rgb(1 2 3)");
    expect(swatchFor({ shape: "dot", name: "gold" }, palette)).toEqual({
      shape: "dot",
      ink: undefined,
    });
    expect(swatchFor({ shape: "stripe", name: "yellow" }, palette)).toEqual({
      shape: "stripe",
      ink: undefined,
    });
    expect(swatchFor({ shape: "dot", name: "toString" }, palette).ink).toBeUndefined();
    expect(swatchFor({ shape: "stripe", css: "rgb(4 5 6)" }, palette)).toEqual({
      shape: "stripe",
      ink: "rgb(4 5 6)",
    });
  });

  it("what the bar says of the acts is one key: the same slots read the same, a state that moved does not", () => {
    expect(wordsKey(inkMenu({ pen: "felt" }))).toBe(wordsKey(inkMenu({ pen: "felt" })));
    expect(wordsKey(inkMenu({ pen: "felt" }))).not.toBe(wordsKey(inkMenu({ pen: "red" })));
    expect(wordsKey(inkMenu({ strike: false }))).not.toBe(wordsKey(inkMenu({ strike: true })));
  });
});

describe("the one adapter over ICE's slot shape (readSlot) — the only reader of choices, current, pressed, swatch, enabled, keys", () => {
  it("reads a slot as the bar's: its kind of cell, its state now, its choices with what each swatch asks for", () => {
    const [pen, highlight, strike, , clear] = inkMenu({ pen: "ball", strike: true }).map(readSlot);
    expect(pen).toMatchObject({ id: "ink.pen", kind: "choice", pressed: false, enabled: true });
    expect(pen?.choices.map((c) => [c.id, c.swatch, c.current])).toEqual(
      PENS.map((n) => [n, { shape: "dot", name: n }, n === "ball"]),
    );
    expect(highlight?.choices.at(-1)).toEqual({
      id: "none",
      label: "None",
      swatch: { shape: "stripe", name: "none" },
      current: false,
    });
    expect(highlight?.choices[0]?.swatch).toEqual({ shape: "stripe", name: "yellow" });
    expect(strike).toMatchObject({ kind: "toggle", pressed: true, enabled: true, keys: "⇧⌘X" });
    expect(clear).toMatchObject({ kind: "act", pressed: false, glyph: "clear-marks" });
    // the pad's: the colour its kind says
    const [padPen] = inkMenu({}, PAD_COLOUR).map(readSlot);
    expect(padPen?.choices[0]?.swatch).toEqual({ shape: "dot", css: PAD_COLOUR("pen.felt") });
  });

  it("a slot its kind says is not enabled (I61's `enabled: false`) is a DISABLED cell, whatever its kind", () => {
    const menu: MenuSlot[] = inkMenu().map((slot) =>
      slot.id === "ink.clear" ? slot : { ...slot, enabled: false },
    );
    expect(readSlot(menu[0] as MenuSlot).enabled).toBe(false);
    const cells = wordsCells(menu, LIGHT);
    expect(
      cells.flatMap((c) => (c.kind === "rule" || c.kind === "more" ? [] : [[c.id, c.disabled]])),
    ).toEqual([
      ["ink.pen", true],
      ["ink.highlight", true],
      ["ink.strike", true],
      ["ink.underline", true],
      ["ink.clear", false],
    ]);
  });

  it("the keys a slot declares are printed in its tip the bar's way; none declared, the label alone; an empty string none", () => {
    const menu = inkMenu().map((slot) => {
      if (slot.id === "ink.underline") {
        const { keys: _k, ...rest } = slot;
        return rest;
      }
      return slot.id === "ink.clear" ? { ...slot, keys: "" } : slot;
    });
    expect(menu.map(readSlot).map((s) => [s.id, s.keys])).toEqual([
      ["ink.pen", undefined],
      ["ink.highlight", "⇧⌘H"],
      ["ink.strike", "⇧⌘X"],
      ["ink.underline", undefined],
      ["ink.clear", undefined],
    ]);
    const tips = wordsCells(menu, LIGHT).flatMap((c) =>
      c.kind === "rule" ? [] : [c.kind === "more" ? `more ${c.tip}` : `${c.id} ${c.tip}`],
    );
    expect(tips).toEqual([
      "ink.pen Pen",
      "ink.highlight Highlight  ⇧⌘H",
      "ink.strike Strike  ⇧⌘X",
      "ink.underline Underline",
      "ink.clear Clear",
      "more More",
    ]);
  });
});
