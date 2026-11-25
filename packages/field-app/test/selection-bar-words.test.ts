// @vitest-environment node
/**
 * IK — WHAT THE WORDS BAR SAYS (field/desk/bar/bar-words.ts; DESIGN.md §8 "The words bar" — Order, The rows, The
 * highlighters; ICE I60). While a sheet is written and words on it are selected, the anchor's `words.menu` holds the
 * object's WORDS acts as slots; the bar prints them as the kind declares them, read off their own data, never their ids:
 *   a choice act (`choices`) a 44 × 32 cell with the words' current value — the chosen swatch, a dot for a pen and a
 *   stripe for a highlighter, hollow when none is shared — then its choices as their own row (None hollow among stripes);
 *   a toggle (`pressed`) on while its kind says so; a plain act its glyph or its label; a rule where the run changes; the
 *   desk's More at the end, waiting (its rows need ICE's editor command).
 * A swatch is a palette ROLE the desk's own palette draws (the pens a note writes with, the calendar's five highlighters),
 * so the bar shows no colour the host never named; a role the palette lacks draws hollow and is said once.
 */
import type { MenuSlot } from "@vibecook/ice/desk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  missingSwatches,
  readSlot,
  resetMissingSwatchesForTest,
  type SwatchPalette,
  sayMissingSwatches,
  swatchFor,
  swatchOf,
  type WordsCell,
  type WordsFace,
  wordsCells,
  wordsKey,
} from "../src/field/desk/bar/bar-words";
import { deskLook } from "../src/field/desk/desk-layer";
import { getRendererLogger } from "../src/logging";

afterEach(() => {
  resetMissingSwatchesForTest();
  vi.restoreAllMocks();
});

const PENS = ["felt", "ball", "fountain", "red"] as const;
const HIGHLIGHTERS = ["yellow", "green", "pink", "blue", "orange"] as const;
const titled = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/** ICE's ink acts as the anchor carries them (E6's `inkActs`: ids `ink.*`, swatch roles `pen.<name>`, `highlight.<name>`,
 * None without one), each as it stands for the words now. */
function inkMenu(
  now: { pen?: string; highlight?: string; strike?: boolean; underline?: boolean } = {},
): MenuSlot[] {
  return [
    {
      id: "ink.pen",
      label: "Pen",
      glyph: "pen",
      choices: PENS.map((n) => ({ id: n, label: `${titled(n)} pen`, swatch: `pen.${n}` })),
      ...(now.pen === undefined ? {} : { chosen: now.pen }),
    },
    {
      id: "ink.highlight",
      label: "Highlight",
      glyph: { path: "M5 20h14" },
      choices: [
        ...HIGHLIGHTERS.map((n) => ({ id: n, label: titled(n), swatch: `highlight.${n}` })),
        { id: "none", label: "None" },
      ],
      ...(now.highlight === undefined ? {} : { chosen: now.highlight }),
    },
    { id: "ink.strike", label: "Strike", glyph: "strike", pressed: now.strike ?? false },
    {
      id: "ink.underline",
      label: "Underline",
      glyph: "underline",
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
      { id: "d", label: "Ink", choices: [{ id: "x", label: "X", swatch: "pen.red" }] },
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
    expect(more).toEqual({ kind: "more", label: "More", tip: "More", waits: true });
  });

  it("a toggle is on while its kind says so; its glyph and label as declared, its tip its label (R1: no key)", () => {
    const cells = wordsCells(inkMenu({ underline: true }), LIGHT);
    const strike = cells.find((c) => c.kind === "toggle" && c.id === "ink.strike");
    const underline = cells.find((c) => c.kind === "toggle" && c.id === "ink.underline");
    expect(strike).toEqual({
      kind: "toggle",
      id: "ink.strike",
      label: "Strike",
      tip: "Strike",
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
  it("the cell shows the words' current value: their pen a dot in its ink, their highlighter a stripe in its own", () => {
    const cells = wordsCells(inkMenu({ pen: "fountain", highlight: "yellow" }), LIGHT);
    expect(faceOf(choice(cells, "ink.pen").face)).toBe(`dot:${LIGHT.pens?.fountain?.css}`);
    expect(faceOf(choice(cells, "ink.highlight").face)).toBe(
      `stripe:${LIGHT.calendars?.highlighters?.yellow?.css}`,
    );
    expect(choice(cells, "ink.pen").tip).toBe("Pen");
  });

  it("hollow when the words share none, and for None: the shape of its family, no ink", () => {
    const mixed = wordsCells(inkMenu(), LIGHT);
    expect(faceOf(choice(mixed, "ink.pen").face)).toBe("dot:hollow");
    expect(faceOf(choice(mixed, "ink.highlight").face)).toBe("stripe:hollow");
    const none = wordsCells(inkMenu({ highlight: "none" }), LIGHT);
    expect(faceOf(choice(none, "ink.highlight").face)).toBe("stripe:hollow");
    // a hollow names no role: nothing is said missing for it
    expect(missingSwatches(none)).toEqual([]);
  });

  it("its row: each choice its swatch in the palette's ink, None hollow among the stripes, the words' choice on", () => {
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

  it("a choice act whose choices are drawn by glyphs: the chosen one's glyph, else the act's own, else its label", () => {
    const fonts: MenuSlot = {
      id: "font",
      label: "Font",
      glyph: "pen",
      choices: [
        { id: "a", label: "Upright", glyph: "chevron" },
        { id: "b", label: "Lean" },
      ],
    };
    expect(faceOf(choice(wordsCells([{ ...fonts, chosen: "a" }], LIGHT), "font").face)).toBe(
      "glyph:chevron",
    );
    // the chosen one has neither swatch nor glyph: the act's own glyph
    const lean = choice(wordsCells([{ ...fonts, chosen: "b" }], LIGHT), "font");
    expect(faceOf(lean.face)).toBe("glyph:pen");
    expect(lean.choices.map((c) => faceOf(c.face))).toEqual(["glyph:chevron", "label"]);
    const { glyph: _drop, ...bare } = fonts;
    expect(faceOf(choice(wordsCells([bare], LIGHT), "font").face)).toBe("label");
  });
});

describe("the swatches: palette roles the desk's own palette draws (DESIGN.md §8 'The highlighters')", () => {
  it("a pen's role reads the pens the note writes with; a highlighter's, the calendar's five — in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const palette = deskLook(theme).palette;
      for (const n of PENS)
        expect(swatchOf(`pen.${n}`, palette)).toEqual({
          shape: "dot",
          ink: palette.pens?.[n]?.css,
          role: `pen.${n}`,
        });
      for (const n of HIGHLIGHTERS)
        expect(swatchOf(`highlight.${n}`, palette)).toEqual({
          shape: "stripe",
          ink: palette.calendars?.highlighters?.[n]?.css,
          role: `highlight.${n}`,
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

  it("the row shows no colour the host never named: every ink in it is one of the palette's", () => {
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

  it("a role the palette lacks — an unknown name, an unknown family, a palette without it — draws hollow, and is said ONCE", () => {
    const palette: SwatchPalette = { pens: { felt: { css: "rgb(1 2 3)" } } };
    expect(swatchOf("pen.felt", palette).ink).toBe("rgb(1 2 3)");
    expect(swatchOf("pen.gold", palette)).toEqual({
      shape: "dot",
      ink: undefined,
      role: "pen.gold",
    });
    expect(swatchOf("highlight.yellow", palette)).toEqual({
      shape: "stripe",
      ink: undefined,
      role: "highlight.yellow",
    });
    expect(swatchOf("marker.black", palette)).toEqual({
      shape: "dot",
      ink: undefined,
      role: "marker.black",
    });
    // a name from the object's prototype is no role of the palette's
    expect(swatchOf("pen.toString", palette).ink).toBeUndefined();
    const menu: MenuSlot[] = [
      {
        id: "ink.pen",
        label: "Pen",
        choices: [
          { id: "felt", label: "Felt pen", swatch: "pen.felt" },
          { id: "gold", label: "Gold pen", swatch: "pen.gold" },
        ],
        chosen: "gold",
      },
    ];
    const cells = wordsCells(menu, palette);
    expect(missingSwatches(cells)).toEqual(["pen.gold"]);
    const warn = vi.fn();
    vi.spyOn(getRendererLogger(), "child").mockReturnValue({
      ...getRendererLogger(),
      warn,
    } as never);
    sayMissingSwatches(cells);
    sayMissingSwatches(cells);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[2]).toEqual({ swatch: "pen.gold" });
  });

  it("what the bar says of the acts is one key: the same slots read the same, a state that moved does not", () => {
    expect(wordsKey(inkMenu({ pen: "felt" }))).toBe(wordsKey(inkMenu({ pen: "felt" })));
    expect(wordsKey(inkMenu({ pen: "felt" }))).not.toBe(wordsKey(inkMenu({ pen: "red" })));
    expect(wordsKey(inkMenu({ strike: false }))).not.toBe(wordsKey(inkMenu({ strike: true })));
  });
});

describe("the one adapter over ICE's slot shape (readSlot) — the only reader of choices, chosen, pressed, swatch, enabled", () => {
  it("reads a slot as the bar's: its kind of cell, its state now, its choices with what each swatch asks for", () => {
    const [pen, highlight, strike, , clear] = inkMenu({ pen: "ball", strike: true }).map(readSlot);
    expect(pen).toMatchObject({ id: "ink.pen", kind: "choice", pressed: false, enabled: true });
    expect(pen?.choices.map((c) => [c.id, c.swatch, c.current])).toEqual(
      PENS.map((n) => [n, { shape: "dot", role: `pen.${n}` }, n === "ball"]),
    );
    expect(highlight?.choices.at(-1)).toEqual({
      id: "none",
      label: "None",
      glyph: undefined,
      swatch: undefined,
      current: false,
    });
    expect(highlight?.choices[0]?.swatch).toEqual({ shape: "stripe", role: "highlight.yellow" });
    expect(strike).toMatchObject({ kind: "toggle", pressed: true, enabled: true });
    expect(clear).toMatchObject({ kind: "act", pressed: false, glyph: "clear-marks" });
  });

  it("draws a swatch from what it asks for: a role through the desk's palette, a colour as its kind says it", () => {
    expect(swatchFor({ shape: "dot", role: "pen.red" }, LIGHT)).toEqual({
      shape: "dot",
      ink: LIGHT.pens?.red?.css,
      role: "pen.red",
    });
    expect(swatchFor({ shape: "stripe", css: "rgb(1 2 3)" }, LIGHT)).toEqual({
      shape: "stripe",
      ink: "rgb(1 2 3)",
    });
    expect(swatchFor({ shape: "dot", css: "" }, LIGHT).ink).toBeUndefined();
  });

  it("a slot its kind says is not enabled is a DISABLED cell, whatever its kind; read where a build carries it", () => {
    const off = (slot: MenuSlot): MenuSlot => ({ ...slot, enabled: false }) as MenuSlot;
    const menu = inkMenu().map((slot) => (slot.id === "ink.clear" ? slot : off(slot)));
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
});
