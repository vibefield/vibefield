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
 * What is under test is the rule AS WRITTEN: this evaluates the stylesheet's
 * own expression — no layout engine runs in a test — and measures the column
 * it makes the way the deck's edge measures it (`measureDeckEdge`). It holds
 * two things, the two that stay true whoever moves the edge's bounds: the
 * deck's top edge rests where it rested under the bar, and the lowest the edge
 * goes is where it was. How HIGH the edge may rise is the deck's own
 * (`deck-edge.ts`, the History lead's), and is not said here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DECK_MIN_HEIGHT, deckEdgeBounds, measureDeckEdge } from "../src/godview/deck-edge";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const godview = readFileSync(join(PACKAGE_ROOT, "src/godview/godview.css"), "utf8");
const head = readFileSync(join(PACKAGE_ROOT, "src/godview/godview-head.css"), "utf8");

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
    if (token.endsWith("%")) return (Number.parseFloat(token) / 100) * percentOf;
    if (/^\d/.test(token)) return Number.parseFloat(token);
    throw new Error(`unexpected ${token} in ${expression}`);
  };
  const value = sum();
  if (at !== tokens.length) throw new Error(`trailing ${tokens.slice(at).join(" ")}`);
  return value;
}

const stageRule = godview.match(/^\.vf-godview-monitor-stage \{([^}]*)\}/m)?.[1] ?? "";
/** The stage rule's flex basis on one line, as the formatter's line breaks leave it. */
const basis = (stageRule.match(/flex:\s*0 0\s*([^;]+);/)?.[1] ?? "")
  .replace(/\s+/g, " ")
  .replace(/\(\s+/g, "(")
  .replace(/\s+\)/g, ")")
  .trim();

const WINDOW = 800;
/** The column before the head: the bar's 40 in it, the head's height unset (the
 * rule's 40px fallback). */
const UNDER_THE_BAR = { bar: 40, variables: {} as Record<string, string> };
/** The column now: no bar, and the root's `--vf-godview-head-height: 0px`. */
const UNDER_THE_HEAD = { bar: 0, variables: { "--vf-godview-head-height": "0px" } };

function box(top: number, height: number): Element {
  const rect = { top, height, bottom: top + height, left: 0, right: 1200, width: 1200 };
  return { getBoundingClientRect: () => rect } as unknown as Element;
}

/** The column as the stylesheet lays it out — a bar of `bar` px (or none),
 * then the monitor at the rule's basis — measured as the deck's edge measures. */
function column(
  { bar, variables }: { bar: number; variables: Record<string, string> },
  { shift = 0, tuned = "35%" }: { shift?: number; tuned?: string } = {},
) {
  const monitorHeight = evaluateLength(
    basis,
    { "--vf-monitor-stage-height": tuned, "--vf-godview-deck-shift": `${shift}px`, ...variables },
    WINDOW,
  );
  const geometry = measureDeckEdge(box(0, WINDOW), box(bar, monitorHeight), shift);
  return {
    monitorHeight,
    geometry,
    /** the deck's top edge at rest, from the window's top */
    restEdge: bar + geometry.restMonitor,
    /** the deck's top edge as laid out, with the growth */
    edge: bar + monitorHeight,
  };
}

describe("the bar's 40px go to the monitor, and the deck's edge rests where it did (GV-D1)", () => {
  it("writes the stage rule in the one wording the two lanes share", () => {
    expect(basis).toBe(
      "calc(max(var(--vf-monitor-stage-height, 35%), 170px) + (40px - var(--vf-godview-head-height, 40px)) + max(0px, var(--vf-godview-deck-shift, 0px)))",
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
    expect(before.monitorHeight).toBe(280);
    expect(after.monitorHeight).toBe(320);
    expect(after.geometry.restMonitor - before.geometry.restMonitor).toBe(40);
    // 40 + 280 under the bar, 0 + 320 under the head
    expect(before.restEdge).toBe(320);
    expect(after.restEdge).toBe(before.restEdge);
    // the floor is the monitor's own (170), and the bar's 40 ride on top of it too
    expect(column(UNDER_THE_BAR, { tuned: "10%" }).restEdge).toBe(40 + 170);
    expect(column(UNDER_THE_HEAD, { tuned: "10%" }).restEdge).toBe(210);
    // a tall tuning: 60% of 800
    expect(column(UNDER_THE_HEAD, { tuned: "60%" }).restEdge).toBe(
      column(UNDER_THE_BAR, { tuned: "60%" }).restEdge,
    );
  });

  it("keeps the edge where it stood at every downward shift, and measures back to the same rest", () => {
    for (const shift of [0, 24, 96, 360]) {
      const before = column(UNDER_THE_BAR, { shift });
      const after = column(UNDER_THE_HEAD, { shift });
      expect(after.edge, `shift ${shift}`).toBe(before.edge);
      expect(after.edge, `shift ${shift}`).toBe(320 + shift);
      // the growth is taken back out (`measureDeckEdge`'s idempotence), so a
      // re-measure after the edge moved still finds the rest that includes the 40
      expect(after.geometry.restMonitor, `shift ${shift}`).toBe(320);
      expect(after.restEdge, `shift ${shift}`).toBe(before.restEdge);
    }
  });

  it("leaves the lowest the edge goes where it was: the room and the rest both grew by the bar's 40", () => {
    const before = column(UNDER_THE_BAR).geometry;
    const after = column(UNDER_THE_HEAD).geometry;
    expect(after.room - before.room).toBe(40);
    expect(deckEdgeBounds(after).max).toBe(deckEdgeBounds(before).max);
    // in the window: rest 320, and the deck keeps its minimum above the foot
    expect(320 + deckEdgeBounds(after).max).toBe(WINDOW - DECK_MIN_HEIGHT);
  });
});
