import { describe, expect, it } from "vitest";
import {
  frameOf,
  lampOn,
  NO_TURN,
  normalOf,
  stepTurn,
  TURN,
  TURN_STILL,
  type Turn,
  type TurnSpring,
  turnAtRest,
  turnToward,
} from "../src/frame/cards/lamp/turn";
import { PRESS } from "../src/frame/cards/press/press-numbers";

// THE TURN (DESIGN.md §8 "Picking one up"; §6 "The hand", the turn; §5 "The lamp, live"; item 596): a card picked up
// turns toward the pointer on a spring, and the lamp lights it as it turns. The pure half: its numbers are the doc's,
// the pointer asks the card to face it, the spring arrives and never throws the card, the card's frame is CSS's
// `rotateY(y) rotateX(x)`, and the lamp's light on a flat card is the press's own diffuse.

const WIN = { width: 1180, height: 780 } as const;
const MIDDLE = { x: WIN.width / 2, y: 392 } as const;
const HALF = { x: WIN.width / 2, y: WIN.height / 2 } as const;

/** The spring walked `seconds` on at sixty frames a second. */
function walk(from: TurnSpring, to: Turn, seconds: number): TurnSpring {
  let spring = from;
  for (let frame = 0; frame < Math.round(seconds * 60); frame += 1)
    spring = stepTurn(spring, to, 1 / 60);
  return spring;
}

describe("the turn's numbers are the round's (DESIGN.md §8 'Picking one up', §6)", () => {
  it("turns 0.30 about its level and 0.42 about its upright, on a spring of 300 and 27, seen from 1000", () => {
    expect(TURN.reach).toEqual({ x: 0.3, y: 0.42 });
    expect(TURN.spring).toEqual({ stiffness: 300, damping: 27 });
    expect(TURN.eye).toBe(1000);
  });
});

describe("where the pointer asks a held card to turn", () => {
  it("nowhere with no pointer, and nowhere with the pointer on its middle", () => {
    expect(turnToward(null, MIDDLE, HALF)).toEqual(NO_TURN);
    expect(turnToward(MIDDLE, MIDDLE, HALF)).toEqual({ x: 0, y: 0 });
  });

  it("toward the pointer: up and right at the window's top right, down and left at its bottom left", () => {
    const upRight = turnToward({ x: MIDDLE.x + HALF.x, y: MIDDLE.y - HALF.y }, MIDDLE, HALF);
    expect(upRight.x).toBeCloseTo(0.3, 10);
    expect(upRight.y).toBeCloseTo(0.42, 10);
    const downLeft = turnToward({ x: MIDDLE.x - HALF.x, y: MIDDLE.y + HALF.y }, MIDDLE, HALF);
    expect(downLeft.x).toBeCloseTo(-0.3, 10);
    expect(downLeft.y).toBeCloseTo(-0.42, 10);
  });

  it("by how far the pointer stands from the card's middle across half the window, and no further at its edge", () => {
    const half = turnToward({ x: MIDDLE.x + HALF.x / 2, y: MIDDLE.y }, MIDDLE, HALF);
    expect(half.y).toBeCloseTo(0.21, 10);
    expect(half.x).toBe(0);
    const past = turnToward({ x: MIDDLE.x + HALF.x * 3, y: MIDDLE.y - HALF.y * 3 }, MIDDLE, HALF);
    expect(past).toEqual({ x: 0.3, y: 0.42 });
  });

  it("faces the pointer: the card's normal leans the pointer's way", () => {
    const [nx, ny, nz] = normalOf(turnToward({ x: WIN.width, y: 0 }, MIDDLE, HALF));
    expect(nx).toBeGreaterThan(0);
    expect(ny).toBeLessThan(0);
    expect(nz).toBeGreaterThan(0.8);
  });
});

describe("the spring it turns on", () => {
  const TO: Turn = { x: 0.3, y: 0.42 };

  it("arrives: within a hundredth of the way in half a second, and at rest within a second", () => {
    const soon = walk(TURN_STILL, TO, 0.5);
    expect(Math.abs(soon.at.x - TO.x)).toBeLessThan(0.003);
    expect(Math.abs(soon.at.y - TO.y)).toBeLessThan(0.0042);
    expect(turnAtRest(walk(TURN_STILL, TO, 1), TO)).toBe(true);
    expect(turnAtRest(TURN_STILL, TO)).toBe(false);
    expect(turnAtRest(TURN_STILL, NO_TURN)).toBe(true);
  });

  it("is held, not thrown: it passes where it is going by no more than a twentieth", () => {
    let spring = TURN_STILL;
    let most = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      spring = stepTurn(spring, TO, 1 / 60);
      most = Math.max(most, spring.at.y);
    }
    expect(most).toBeGreaterThan(TO.y);
    expect(most).toBeLessThan(TO.y * 1.05);
  });

  it("moves no further in a frame that came late than in a thirtieth of a second", () => {
    const late = stepTurn(TURN_STILL, TO, 3);
    const bound = stepTurn(TURN_STILL, TO, 1 / 30);
    expect(late).toEqual(bound);
    expect(stepTurn(TURN_STILL, TO, 0)).toBe(TURN_STILL);
  });
});

describe("the card's frame once it is turned", () => {
  const dot = (a: readonly number[], b: readonly number[]): number =>
    a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);

  it("stands square at rest: its right, its down and its normal are the window's", () => {
    // a negated zero is −0, which `toEqual` tells from 0 and no reader of a frame does: read each as a plain number
    const plain = (values: readonly number[]): number[] => values.map((value) => value + 0);
    expect(plain(frameOf(NO_TURN))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(plain(normalOf(NO_TURN))).toEqual([0, 0, 1]);
  });

  it("is CSS's rotateY(y) rotateX(x): the normal of a card turned so", () => {
    const turn: Turn = { x: 0.3, y: 0.42 };
    const [nx, ny, nz] = normalOf(turn);
    expect(nx).toBeCloseTo(Math.sin(0.42) * Math.cos(0.3), 12);
    expect(ny).toBeCloseTo(-Math.sin(0.3), 12);
    expect(nz).toBeCloseTo(Math.cos(0.42) * Math.cos(0.3), 12);
  });

  it("stays a frame: three unit directions square to each other, however it is turned and turned over", () => {
    for (const about of [0, 0.7, Math.PI / 2, 2.2, Math.PI]) {
      const frame = frameOf({ x: -0.21, y: 0.37 }, about);
      const right = frame.slice(0, 3);
      const down = frame.slice(3, 6);
      const normal = frame.slice(6, 9);
      for (const axis of [right, down, normal]) expect(dot(axis, axis)).toBeCloseTo(1, 12);
      expect(dot(right, down)).toBeCloseTo(0, 12);
      expect(dot(right, normal)).toBeCloseTo(0, 12);
      expect(dot(down, normal)).toBeCloseTo(0, 12);
    }
  });

  it("turned over, the back faces where the face did: half a turn about its upright, and the same normal", () => {
    const turn: Turn = { x: 0.12, y: -0.3 };
    const face = normalOf(turn, 0);
    // the back stands half a turn further than the flip's own half turn
    const back = normalOf(turn, Math.PI + Math.PI);
    for (const i of [0, 1, 2]) expect(back[i]).toBeCloseTo(face[i] ?? 0, 12);
    // mid-flip, a quarter turn about its upright, the face is seen edge on from a card held flat
    expect(normalOf(NO_TURN, Math.PI / 2)[2]).toBeCloseTo(0, 12);
  });
});

describe("how brightly the lamp lights a card turned so (DESIGN.md §5 'The lamp, live')", () => {
  it("reads 1 held flat, by day and by night: the print's own light", () => {
    expect(lampOn(normalOf(NO_TURN), false)).toBeCloseTo(1, 12);
    expect(lampOn(normalOf(NO_TURN), true)).toBeCloseTo(1, 12);
  });

  it("falls to the room's ambient turned from the lamp, and brightens softly to 1.135 turned to it", () => {
    const from = normalOf({ x: -0.3, y: -0.42 });
    expect(lampOn(from, false)).toBeCloseTo(PRESS.ambient.day, 12);
    expect(lampOn(from, true)).toBeCloseTo(PRESS.ambient.night, 12);
    expect(lampOn(normalOf({ x: 0.3, y: 0.42 }), false)).toBeCloseTo(1.135, 2);
  });

  it("never passes 1.35, however squarely a card faces the lamp", () => {
    const length = Math.hypot(...PRESS.lamp);
    const atTheLamp = PRESS.lamp.map((value) => value / length) as [number, number, number];
    // no side faces the lamp more squarely than this, and there the light has bent over: 1.183 by day, 1.226 by night
    const byDay = lampOn(atTheLamp, false);
    const byNight = lampOn(atTheLamp, true);
    expect(byDay).toBeCloseTo(1.183, 3);
    expect(byNight).toBeCloseTo(1.226, 3);
    expect(Math.max(byDay, byNight)).toBeLessThan(1 + PRESS.diffuse.over);
    expect(PRESS.diffuse).toEqual({ low: 0.2, knee: 1.6, over: 0.35 });
  });
});
