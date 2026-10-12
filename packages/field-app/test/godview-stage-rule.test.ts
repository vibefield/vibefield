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
 * sheet stands at `--vf-godview-deck-rest` (40 + the tuned basis, naming no
 * head) plus the shift, and the monitor's field ends 12 above the edge as last
 * set (`--vf-godview-field-foot`), never above its floor. The shift moves the
 * sheet, never the monitor's basis.
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
  DECK_HEAD_RESERVE,
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
  const tokens = expression.match(/--[\w-]+|[a-z]+|\d+(?:\.\d+)?(?:px|%)?|[(),+-]/g) ?? [];
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
    let value = term();
    while (peek() === "+" || peek() === "-") {
      const sign = take() === "+" ? 1 : -1;
      value += sign * term();
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
/** The root's two places, and the kit's two field numbers they read. */
const PLACES = {
  "--vf-godview-deck-rest": declared(godview, "--vf-godview-deck-rest"),
  "--vf-godview-field-foot": declared(godview, "--vf-godview-field-foot"),
  "--vf-godview-deck-field-floor": declared(tokens, "--vf-godview-deck-field-floor"),
  "--vf-godview-deck-field-gap": declared(tokens, "--vf-godview-deck-field-gap"),
};

const WINDOW = 800;
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
  { shift = 0, set = shift, tuned = "35%" }: { shift?: number; set?: number; tuned?: string } = {},
) {
  const scope = {
    ...PLACES,
    "--vf-monitor-stage-height": tuned,
    "--vf-godview-deck-shift": `${shift}px`,
    "--vf-godview-field-shift": `${set}px`,
    ...variables,
  };
  const pictureMonitor = evaluateLength(basis, scope, WINDOW);
  const edgeMonitor = evaluateLength(edgeBasis, scope, WINDOW);
  const sheet = evaluateLength(sheetTop, scope, WINDOW);
  const geometry = measureDeckEdge(laidOut(0, WINDOW), laidOut(sheet, WINDOW - sheet), null, shift);
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

describe("the bar's 40px go to the monitor, and the deck's edge rests where it did (GV-D1)", () => {
  it("writes the stage rule in the one wording the two lanes share", () => {
    expect(basis).toBe(
      "calc(max(var(--vf-monitor-stage-height, 35%), 170px) + (40px - var(--vf-godview-head-height, 40px)))",
    );
    // the deck's place at rest names no head: it holds whatever stands above the monitor (L8a)
    expect(PLACES["--vf-godview-deck-rest"]).toBe(
      "calc(40px + max(var(--vf-monitor-stage-height, 35%), 170px))",
    );
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

  it("gives the monitor exactly the bar's 40 at rest, so the deck's top edge stands where it stood", () => {
    const before = column(UNDER_THE_BAR);
    const after = column(UNDER_THE_HEAD);
    // 35% of 800, and the 40 the bar gave up
    expect(before.pictureMonitor).toBe(280);
    expect(after.pictureMonitor).toBe(320);
    // 40 + 280 under the bar, 0 + 320 under the head — and the placed sheet's rest is that foot
    expect(before.pictureEdge).toBe(320);
    expect(after.pictureEdge).toBe(before.pictureEdge);
    expect(after.edge).toBe(320);
    expect(before.edge).toBe(after.edge);
    // the floor is the monitor's own (170), and the bar's 40 ride on top of it too
    expect(column(UNDER_THE_BAR, { tuned: "10%" }).pictureEdge).toBe(40 + 170);
    expect(column(UNDER_THE_HEAD, { tuned: "10%" }).pictureEdge).toBe(210);
    expect(column(UNDER_THE_HEAD, { tuned: "10%" }).edge).toBe(210);
    // a tall tuning: 60% of 800
    expect(column(UNDER_THE_HEAD, { tuned: "60%" }).pictureEdge).toBe(
      column(UNDER_THE_BAR, { tuned: "60%" }).pictureEdge,
    );
    expect(column(UNDER_THE_HEAD, { tuned: "60%" }).edge).toBe(40 + 480);
  });

  it("keeps the sheet and the field where they stood at every shift, and measures back to the same rest", () => {
    for (const shift of [-264, -100, 0, 24, 96, 360]) {
      const before = column(UNDER_THE_BAR, { shift });
      const after = column(UNDER_THE_HEAD, { shift });
      // the shift moves the sheet, whatever the head
      expect(after.edge, `shift ${shift}`).toBe(before.edge);
      expect(after.edge, `shift ${shift}`).toBe(320 + shift);
      // the field ends 12 above the edge as set, never above its floor (220)
      expect(after.fieldFoot, `shift ${shift}`).toBe(before.fieldFoot);
      expect(after.fieldFoot, `shift ${shift}`).toBe(Math.max(220, 320 + shift - 12));
      // the shift is taken back out (`measureDeckEdge`'s idempotence), so a re-measure after
      // the edge moved still finds the rest
      expect(after.geometry.restTop, `shift ${shift}`).toBe(320);
      expect(before.geometry.restTop, `shift ${shift}`).toBe(320);
    }
    // a held edge moves the sheet, never the field: the field follows the edge as last set
    const held = column(UNDER_THE_HEAD, { shift: 200, set: 0 });
    expect(held.edge).toBe(520);
    expect(held.fieldFoot).toBe(308);
  });

  it("leaves the edge's bounds where they were: the head's reserve above, 120 above the foot below", () => {
    const before = deckEdgeBounds(column(UNDER_THE_BAR).geometry);
    const after = deckEdgeBounds(column(UNDER_THE_HEAD).geometry);
    expect(after).toEqual(before);
    // in the window: rest 320; the highest is the head's reserve, the lowest keeps the minimum
    expect(320 + after.min).toBe(DECK_HEAD_RESERVE);
    expect(320 + after.max).toBe(WINDOW - DECK_MIN_HEIGHT);
  });
});
