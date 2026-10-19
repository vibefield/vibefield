// @vitest-environment node
/**
 * GV-D1 — THE BAR LEFT THE COLUMN, AND THE DECK'S EDGE DID NOT MOVE.
 *
 * The instrument bar was the column's first 40px. The head that replaced it is
 * a row over the stage and takes no height, so the stage rule gives the monitor
 * what the bar held: `(40px − --vf-godview-head-height)`, 0 while a bar stands
 * (the rule's fallback) and 40 where the stage's root says the head's height is
 * 0. The History lead's lane writes the same rule, and the two are held to one
 * wording here.
 *
 * Since round 3's W4 the deck's edge is a PLACE: on a stage whose edge moves the
 * sheet stands at `--vf-godview-deck-rest` (naming no head) plus the shift, and
 * the monitor's field ends 12 above the edge as last set
 * (`--vf-godview-field-foot`), never above where it ends at rest (James,
 * 2026-10-19). The shift moves the sheet, never the monitor's basis.
 *
 * Since N15 (a) (James 2026-10-11; built 2026-10-12) rest is no tuning: it is
 * the drawing's share of the stage — 300 of its 780, 5/13 — never above the
 * floor, 232 (the field's least height, 220, and its 12 gap), and the monitor's basis is
 * rest less the head's height. The `Monitor height` slider and its 35% / 170px
 * rule are gone, and this file moved with the rule.
 *
 * What is under test is the rule AS WRITTEN: this evaluates the stylesheet's
 * own expressions — no layout engine runs in a test — and measures the column
 * they make the way the deck's edge measures it (`measureDeckEdge`, the
 * layout's `offset*`). It holds what stays true whoever moves the edge's
 * bounds: the deck's top edge rests where it rested under the bar, the sheet
 * and the field stand where they stood at every shift, and the edge's bounds
 * are the same under the bar and under the head.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DECK_FILL_LINE,
  DECK_MIN_HEIGHT,
  deckEdgeBounds,
  measureDeckEdge,
} from "../src/godview/deck-edge";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const godview = readFileSync(join(PACKAGE_ROOT, "src/godview/godview.css"), "utf8");
const head = readFileSync(join(PACKAGE_ROOT, "src/godview/godview-head.css"), "utf8");
const tokens = readFileSync(join(PACKAGE_ROOT, "../design-kit/src/tokens.css"), "utf8");

/** A CSS length expression of the stage rule's grammar — `calc`, `max`, `min`,
 * `var(name, fallback)`, `+`, `-`, px, and % of the column — to a number. */
function evaluateLength(
  expression: string,
  variables: Readonly<Record<string, string>>,
  percentOf: number,
): number {
  const tokens = expression.match(/--[\w-]+|[a-z]+|\d+(?:\.\d+)?(?:px|%)?|[(),+*/-]/g) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const take = (expected?: string): string => {
    const token = tokens[at];
    if (token === undefined || (expected !== undefined && token !== expected)) {
      throw new Error(`expected ${expected ?? "a token"} at ${at} in ${expression}`);
    }
    at += 1;
    return token;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === "+" || peek() === "-") {
      const sign = take() === "+" ? 1 : -1;
      value += sign * product();
    }
    return value;
  };
  // N15: rest's share is written as the drawing's fraction, `100% * 5 / 13`
  const product = (): number => {
    let value = term();
    while (peek() === "*" || peek() === "/") {
      const multiply = take() === "*";
      const by = term();
      value = multiply ? value * by : value / by;
    }
    return value;
  };
  const term = (): number => {
    const token = take();
    if (token === "(") {
      const inner = sum();
      take(")");
      return inner;
    }
    if (token === "calc") {
      take("(");
      const inner = sum();
      take(")");
      return inner;
    }
    if (token === "max" || token === "min") {
      take("(");
      const values = [sum()];
      while (peek() === ",") {
        take(",");
        values.push(sum());
      }
      take(")");
      return token === "max" ? Math.max(...values) : Math.min(...values);
    }
    if (token === "var") {
      take("(");
      const name = take();
      let fallback: number | undefined;
      if (peek() === ",") {
        take(",");
        fallback = sum();
      }
      take(")");
      const set = variables[name];
      if (set !== undefined) return evaluateLength(set, variables, percentOf);
      if (fallback === undefined) throw new Error(`${name} is not set and has no fallback`);
      return fallback;
    }
    if (token === "-") return -term();
    if (token.endsWith("%")) return (Number.parseFloat(token) / 100) * percentOf;
    if (/^\d/.test(token)) return Number.parseFloat(token);
    throw new Error(`unexpected ${token} in ${expression}`);
  };
  const value = sum();
  if (at !== tokens.length) throw new Error(`trailing ${tokens.slice(at).join(" ")}`);
  return value;
}

/** A declaration's value on one line, as the formatter's line breaks leave it. */
const oneLine = (value: string): string =>
  value.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

/** The body of the rule whose selector starts a line of `sheet`, exactly. */
function ruleBody(sheet: string, selector: string): string {
  const at = sheet.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule ${selector}`);
  const open = sheet.indexOf("{", at);
  return sheet.slice(open + 1, sheet.indexOf("}", open));
}

/** A property's value in a rule body (or a whole sheet, for a custom property). */
function declared(body: string, property: string): string {
  const escaped = property.replace(/[-[\]]/g, "\\$&");
  const match = body.match(new RegExp(`^\\s*${escaped}:\\s*([^;]+);`, "m"));
  if (match?.[1] === undefined) throw new Error(`${property} is not declared`);
  return oneLine(match[1]);
}

const EDGE = ".vf-godview[data-godview-deck-edge]";
/** The stage rule's flex basis: the monitor's height on a stage whose edge never
 * moves (Settings' miniature, a catalog plate), with the sheet in flow under it. */
const basis = declared(ruleBody(godview, ".vf-godview-monitor-stage"), "flex").replace(/^0 0 /, "");
/** On a stage whose edge moves: the monitor's basis, and the sheet's top. */
const edgeBasis = declared(ruleBody(godview, `${EDGE} .vf-godview-monitor-stage`), "flex-basis");
const sheetTop = declared(ruleBody(godview, `${EDGE} .vf-godview-terminal-deck`), "top");
/** The root's two places, and the kit's four numbers they read. */
const PLACES = {
  "--vf-godview-deck-rest": declared(godview, "--vf-godview-deck-rest"),
  "--vf-godview-field-foot": declared(godview, "--vf-godview-field-foot"),
  "--vf-godview-deck-rest-share": declared(tokens, "--vf-godview-deck-rest-share"),
  "--vf-godview-deck-rest-floor": declared(tokens, "--vf-godview-deck-rest-floor"),
  "--vf-godview-deck-field-gap": declared(tokens, "--vf-godview-deck-field-gap"),
};

/** The ruled drawing's window: rest is 300 in it (N15 (a)). */
const WINDOW = 780;
/** The column before the head: the bar's 40 in it, the head's height unset (the
 * rule's 40px fallback). */
const UNDER_THE_BAR = { bar: 40, variables: {} as Record<string, string> };
/** The column now: no bar, and the root's `--vf-godview-head-height: 0px`. */
const UNDER_THE_HEAD = { bar: 0, variables: { "--vf-godview-head-height": "0px" } };

/** An element as the edge reads it: its layout box. */
function laidOut(offsetTop: number, offsetHeight: number): HTMLElement {
  return { offsetTop, offsetHeight } as unknown as HTMLElement;
}

/** The column as the stylesheet lays it out — a bar of `bar` px (or none), then
 * the monitor; the sheet in flow under a picture's monitor, or placed at the
 * edge — measured as the deck's edge measures. `shift` is the edge as it
 * stands, `set` the edge as last set (the field's). */
function column(
  { bar, variables }: { bar: number; variables: Record<string, string> },
  {
    shift = 0,
    set = shift,
    window = WINDOW,
  }: { shift?: number; set?: number; window?: number } = {},
) {
  const scope = {
    ...PLACES,
    "--vf-godview-deck-shift": `${shift}px`,
    "--vf-godview-field-shift": `${set}px`,
    ...variables,
  };
  const pictureMonitor = evaluateLength(basis, scope, window);
  const edgeMonitor = evaluateLength(edgeBasis, scope, window);
  const sheet = evaluateLength(sheetTop, scope, window);
  const geometry = measureDeckEdge(laidOut(0, window), laidOut(sheet, window - sheet), null, shift);
  return {
    geometry,
    pictureMonitor,
    /** a picture's deck top edge: the foot of its monitor, from the window's top */
    pictureEdge: bar + pictureMonitor,
    /** the placed sheet's top edge, from the window's top */
    edge: sheet,
    /** the monitor's field's foot on a stage whose edge moves */
    fieldFoot: bar + edgeMonitor,
  };
}

describe("the rule's evaluator, on its own", () => {
  it("multiplies and divides left to right, before it adds, so a slip fails here and not in the rule", () => {
    expect(evaluateLength("calc(100% * 5 / 13)", {}, WINDOW)).toBeCloseTo(300, 6);
    expect(evaluateLength("calc(100% / 13 * 5)", {}, WINDOW)).toBeCloseTo(300, 6);
    expect(evaluateLength("calc(78px / 13 / 2)", {}, WINDOW)).toBeCloseTo(3, 6);
    expect(evaluateLength("calc(12px + 100% * 5 / 13 - 2px)", {}, WINDOW)).toBeCloseTo(310, 6);
    expect(evaluateLength("calc(-264px + 100% * 5 / 13)", {}, WINDOW)).toBeCloseTo(36, 6);
  });
});

describe("the bar's 40px go to the monitor, and the deck's edge rests where it did (GV-D1)", () => {
  it("writes the stage rule in the one wording the two lanes share", () => {
    // N15 (a): the monitor's basis is rest less the head's height
    expect(basis).toBe("calc(var(--vf-godview-deck-rest) - var(--vf-godview-head-height, 40px))");
    // the deck's place at rest names no head: it holds whatever stands above the monitor (L8a)
    // — the drawing's share of the stage, never above the floor (N15 (a))
    expect(PLACES["--vf-godview-deck-rest"]).toBe(
      "max(var(--vf-godview-deck-rest-share), var(--vf-godview-deck-rest-floor))",
    );
    expect(PLACES["--vf-godview-deck-rest-share"]).toBe("calc(100% * 5 / 13)");
    expect(PLACES["--vf-godview-deck-rest-floor"]).toBe("232px");
    // no tuned height is left to read: the slider and its 35% / 170px went with N15
    expect(godview).not.toContain("--vf-monitor-stage-height");
    expect(sheetTop).toBe("calc(var(--vf-godview-deck-rest) + var(--vf-godview-deck-shift, 0px))");
    // the head's height is the basis's to give back on a stage whose edge moves too
    expect(edgeBasis).toBe(
      "calc(var(--vf-godview-field-foot) - var(--vf-godview-head-height, 40px))",
    );
    // …and the head's own sheet says, on the stage's root, that it takes no height from the
    // column; the rule's sheet sets it nowhere (one owner)
    const root = head.match(/^\.vf-godview \{([^}]*)\}/m)?.[1] ?? "";
    expect(root).toMatch(/--vf-godview-head-height: 0px;/);
    expect(godview).not.toMatch(/^\s*--vf-godview-head-height\s*:/m);
    // no bar is left in this sheet to take it
    expect(godview).not.toContain("vf-godview-header");
  });

  it("rests at the drawing's 300, gives the monitor the bar's 40 back, and holds the same share on any height (N15 (a))", () => {
    const before = column(UNDER_THE_BAR);
    const after = column(UNDER_THE_HEAD);
    // rest 300 of 780; the monitor is rest less the 40 the bar takes, or all of it under the head
    expect(before.pictureMonitor).toBeCloseTo(260, 6);
    expect(after.pictureMonitor).toBeCloseTo(300, 6);
    // 40 + 260 under the bar, 0 + 300 under the head — and the placed sheet's rest is that foot
    expect(before.pictureEdge).toBeCloseTo(300, 6);
    expect(after.pictureEdge).toBeCloseTo(before.pictureEdge, 6);
    expect(after.edge).toBeCloseTo(300, 6);
    expect(before.edge).toBeCloseTo(after.edge, 6);
    // the same share on another height: 5/13 of the stage
    for (const window of [650, 1040, 1300]) {
      expect(column(UNDER_THE_HEAD, { window }).edge, `${window}`).toBeCloseTo(
        (window * 5) / 13,
        6,
      );
      expect(column(UNDER_THE_BAR, { window }).pictureEdge, `${window}`).toBeCloseTo(
        (window * 5) / 13,
        6,
      );
    }
    // never above the floor, 232 — below a 603-tall stage the share would be
    for (const window of [600, 520, 400]) {
      expect(column(UNDER_THE_HEAD, { window }).edge, `${window}`).toBe(232);
      expect(column(UNDER_THE_BAR, { window }).pictureEdge, `${window}`).toBe(232);
      // the floor's reason: at rest the field still ends 12 above the edge
      expect(column(UNDER_THE_HEAD, { window }).fieldFoot, `${window}`).toBe(232 - 12);
    }
  });

  it("keeps the sheet and the field where they stood at every shift, and measures back to the same rest", () => {
    for (const shift of [-264, -100, 0, 24, 96, 360]) {
      const before = column(UNDER_THE_BAR, { shift });
      const after = column(UNDER_THE_HEAD, { shift });
      // the shift moves the sheet, whatever the head
      expect(after.edge, `shift ${shift}`).toBeCloseTo(before.edge, 6);
      expect(after.edge, `shift ${shift}`).toBeCloseTo(300 + shift, 6);
      // the field ends 12 above the edge as set, never above where it ends at rest (288)
      expect(after.fieldFoot, `shift ${shift}`).toBeCloseTo(before.fieldFoot, 6);
      expect(after.fieldFoot, `shift ${shift}`).toBeCloseTo(300 + Math.max(0, shift) - 12, 6);
      // the shift is taken back out (`measureDeckEdge`'s idempotence), so a re-measure after
      // the edge moved still finds the rest
      expect(after.geometry.restTop, `shift ${shift}`).toBeCloseTo(300, 6);
      expect(before.geometry.restTop, `shift ${shift}`).toBeCloseTo(300, 6);
    }
    // a held edge moves the sheet, never the field: the field follows the edge as last set
    const held = column(UNDER_THE_HEAD, { shift: 200, set: 0 });
    expect(held.edge).toBeCloseTo(500, 6);
    expect(held.fieldFoot).toBeCloseTo(288, 6);
  });

  it("never squeezes the field past rest: an edge set above it slides the sheet over the field rest gave (James, 2026-10-19)", () => {
    // "when at the default terminal pane height, the swarm area is at its min height, so when user
    // move the terminal pane further up, no more squeezing the swarm bounds"
    for (const window of [780, 1040, 520]) {
      const rest = column(UNDER_THE_HEAD, { window });
      // a step up, the fill line, and the window's top (a held edge let go there)
      for (const set of [-1, DECK_FILL_LINE - rest.edge, -rest.edge]) {
        const up = column(UNDER_THE_HEAD, { shift: set, window });
        expect(up.fieldFoot, `${window}/${set}`).toBeCloseTo(rest.fieldFoot, 6);
      }
      // at the fill line the sheet stands over the field
      const filled = column(UNDER_THE_HEAD, { shift: DECK_FILL_LINE - rest.edge, window });
      expect(filled.edge, `${window}`).toBeLessThan(filled.fieldFoot);
      // down from rest the field grows with the edge, 12 above it
      const down = column(UNDER_THE_HEAD, { shift: 96, window });
      expect(down.fieldFoot, `${window}`).toBeCloseTo(down.edge - 12, 6);
    }
    // the least field is rest's floor less its gap, 220: the shortest stage, with the edge up
    expect(column(UNDER_THE_HEAD, { shift: -100, window: 400 }).fieldFoot).toBe(220);
  });

  it("leaves the edge's bounds where they were: the head's reserve above, 120 above the foot below", () => {
    const before = deckEdgeBounds(column(UNDER_THE_BAR).geometry);
    const after = deckEdgeBounds(column(UNDER_THE_HEAD).geometry);
    expect(after).toEqual(before);
    // in the window: rest 300; the highest is the fill line, the lowest keeps the minimum
    expect(300 + after.min).toBeCloseTo(DECK_FILL_LINE, 6);
    expect(300 + after.max).toBeCloseTo(WINDOW - DECK_MIN_HEIGHT, 6);
  });
});
