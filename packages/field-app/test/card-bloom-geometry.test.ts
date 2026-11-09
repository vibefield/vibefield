import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_BLOOM,
  pickAt,
  placeBuds,
  sayPx,
  wordsTop,
} from "../src/frame/cards/bloom/bloom-geometry";

// THE CARD'S BLOOM (OB-D2, OB-D12 A; DESIGN.md §8 "The hand"): the spawn bloom's numbers, held to puppeteer's own table
// by reading it, since the package does not export it; and where its ring stands.

const WIN = { width: 1180, height: 780 };
const AT = { x: 590, y: 400 };

/** One number out of puppeteer-views' `views/swarm/bloom/constants.js`. */
function theirs(name: string): number {
  const file = join(
    __dirname,
    "../node_modules/@vibefield/puppeteer-views/dist/views/swarm/bloom/constants.js",
  );
  const found = readFileSync(file, "utf8").match(new RegExp(`\\b${name}: (\\d+(?:\\.\\d+)?),`));
  expect(found, name).not.toBeNull();
  return Number(found?.[1]);
}

describe("the card's bloom, its numbers", () => {
  it("are the spawn bloom's", () => {
    expect(CARD_BLOOM.ring).toBe(theirs("r1"));
    expect(CARD_BLOOM.bud).toBe(theirs("bud1"));
    expect(CARD_BLOOM.step).toBe(theirs("step1"));
    expect(CARD_BLOOM.dead).toBe(theirs("deadR"));
    expect(CARD_BLOOM.sector).toBe(theirs("sectorMax"));
    expect(CARD_BLOOM.slack).toBe(theirs("slack"));
    expect(CARD_BLOOM.settle).toBe(theirs("settle"));
    expect(CARD_BLOOM.hot).toBe(theirs("hot"));
    expect(CARD_BLOOM.pop).toBe(theirs("pop"));
    expect(CARD_BLOOM.stagger).toBe(theirs("stagger"));
    expect(CARD_BLOOM.retract).toBe(theirs("retract"));
    expect(CARD_BLOOM.reveal).toBe(theirs("reveal"));
    expect(CARD_BLOOM.sayMax).toBe(theirs("sayMax"));
    expect(CARD_BLOOM.sayMin).toBe(theirs("sayMin"));
    expect(CARD_BLOOM.sayGap).toBe(theirs("sayGap"));
    expect(CARD_BLOOM.arc).toBe(220);
    expect(CARD_BLOOM.hubScale).toBe(0.42);
  });
});

describe("the ring", () => {
  it("opens up, 92 out and 42° apart, in the card's order", () => {
    const { turn, step, buds } = placeBuds(4, AT, WIN);
    expect(turn).toBe(0);
    expect(step).toBe(42);
    expect(buds.map((b) => b.deg)).toEqual([-153, -111, -69, -27]);
    for (const b of buds) expect(Math.hypot(b.x - AT.x, b.y - AT.y)).toBeCloseTo(92, 5);
  });

  it("narrows to fit 220° when there are many", () => {
    const { step, buds } = placeBuds(8, AT, WIN);
    expect(step).toBeCloseTo(220 / 7, 5);
    const first = buds[0]?.deg ?? 0;
    const last = buds[7]?.deg ?? 0;
    expect(last - first).toBeCloseTo(220, 5);
  });

  it("stands one face straight up", () => {
    expect(placeBuds(1, AT, WIN).buds[0]?.deg).toBe(-90);
  });

  it("turns in 15° steps only as far as the window's edges force it, and never moves the hub", () => {
    const corner = { x: 90, y: 400 };
    const { turn, buds } = placeBuds(3, corner, WIN);
    expect(turn).not.toBe(0);
    expect(Math.abs(turn) % 15).toBe(0);
    for (const b of buds) {
      expect(b.x).toBeGreaterThan(70);
      expect(Math.hypot(b.x - corner.x, b.y - corner.y)).toBeCloseTo(92, 5);
    }
  });

  it("turns down when the window's top forces it", () => {
    const { turn, buds } = placeBuds(3, { x: 590, y: 60 }, WIN);
    expect(Math.abs(turn)).toBeGreaterThan(0);
    for (const b of buds) expect(b.y).toBeGreaterThan(44);
  });
});

describe("choosing by direction", () => {
  const placed = placeBuds(3, AT, WIN);

  it("inside the dead zone is the hub", () => {
    expect(pickAt({ x: AT.x + 10, y: AT.y - 10 }, AT, placed)).toBe("hub");
  });

  it("past it, the bud in that direction, at any distance up to the ring and its slack", () => {
    const b = placed.buds[0];
    if (b === undefined) throw new Error("no bud");
    const a = (b.deg * Math.PI) / 180;
    expect(pickAt({ x: AT.x + Math.cos(a) * 40, y: AT.y + Math.sin(a) * 40 }, AT, placed)).toBe(0);
    expect(pickAt({ x: AT.x + Math.cos(a) * 150, y: AT.y + Math.sin(a) * 150 }, AT, placed)).toBe(
      0,
    );
  });

  it("past the ring by 64 is open ground", () => {
    expect(pickAt({ x: AT.x, y: AT.y - 92 - 65 }, AT, placed)).toBeNull();
  });

  it("outside every bud's sector is open ground", () => {
    expect(pickAt({ x: AT.x, y: AT.y + 60 }, AT, placed)).toBeNull();
  });
});

describe("the words", () => {
  it("are 6.6% of the window's longer side, between 22 and 72", () => {
    expect(sayPx({ width: 1180, height: 780 })).toBe(72);
    expect(sayPx({ width: 600, height: 400 })).toBeCloseTo(39.6, 5);
    expect(sayPx({ width: 200, height: 120 })).toBe(22);
  });

  it("stand 40 clear above the bloom, or below it where that doesn't fit", () => {
    const above = wordsTop({ x: 590, y: 500 }, WIN, 100);
    expect(above).toBe(500 - 92 - 24 - 40 - 100);
    const below = wordsTop({ x: 590, y: 200 }, WIN, 100);
    expect(below).toBe(200 + 92 + 24 + 40);
  });
});
