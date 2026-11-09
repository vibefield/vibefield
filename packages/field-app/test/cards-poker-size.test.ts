import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HELD_SCALE } from "../src/frame/cards/CardsView";
import {
  CARD_H,
  CARD_LIFT,
  CARD_PEEK,
  CARD_REACH,
  CARD_W,
  FAN_MAX_PITCH,
  FAN_MAX_TILT,
  HAND_REACH,
  layoutCards,
  reachLift,
} from "../src/frame/cards/cards-model";

// CS-D8 A, ruled by James 2026-11-09 (DESIGN.md §8 "The hand"): the card is poker's 120 × 168, a fifth wider than HN's,
// and the fan's numbers are the same law read at that size — the pitch 0.635 of the width, the lift the height less the
// peek plus 8, the reach 120 × pitch / 66. The peek, the tilt and the foot's band do not move.

describe("the poker card (CS-D8 A)", () => {
  it("is 120 × 168, and held up reads at 288 × 403", () => {
    expect([CARD_W, CARD_H]).toEqual([120, 168]);
    expect(HELD_SCALE).toBe(2.4);
    expect([Math.round(CARD_W * HELD_SCALE), Math.round(CARD_H * HELD_SCALE)]).toEqual([288, 403]);
  });

  it("fans by the same law at that size, and still peeks 68", () => {
    expect(FAN_MAX_PITCH).toBe(Math.round(CARD_W * 0.635));
    expect(FAN_MAX_PITCH).toBe(76);
    expect(CARD_LIFT).toBe(CARD_H - CARD_PEEK + 8);
    expect(CARD_LIFT).toBe(108);
    expect(CARD_REACH).toBe(Math.round((120 * FAN_MAX_PITCH) / 66));
    expect(CARD_REACH).toBe(138);
    expect(CARD_PEEK).toBe(68);
    expect(FAN_MAX_TILT).toBe(6.5);
    expect(HAND_REACH).toEqual({ band: 214, lift: 108 });
  });

  it("spaces a roomy fan at 76 and lifts the card under the pointer whole", () => {
    const { slots } = layoutCards(3, { width: 1800, height: 780 }, 376);
    expect((slots[1]?.x ?? 0) - (slots[0]?.x ?? 0)).toBe(76);
    const middle = (slots[1]?.x ?? 0) + CARD_W / 2;
    expect(reachLift(slots, middle)[1]).toBe(1);
  });

  it("draws the card at the model's size", () => {
    const css = readFileSync(join(__dirname, "../src/frame/cards/cards.css"), "utf8");
    expect(css).toContain(`width: ${CARD_W}px;`);
    expect(css).toContain(`height: ${CARD_H}px;`);
  });
});
