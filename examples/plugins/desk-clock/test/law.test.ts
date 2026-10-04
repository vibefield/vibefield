// PORTED VERBATIM from ICE's worked third-party kind (`infinite-canvas-engine/examples/desk-clock/test/law.test.ts`, design-016 K8b) — re-wrapped by this repo's formatter.

// The desk clock's law (design-016 K8b): the time it shows, its hands, its zone, and the wake's arithmetic — pure.
import { describe, expect, it } from "vitest";
import {
  CLOCK,
  caseOf,
  clockReach,
  EARLY_MS,
  handAngles,
  keyAt,
  nextMoveAt,
  offsetAt,
  SHOP_TIME,
  stepOf,
  timeOfDay,
  zoneMinutes,
  zoneOf,
} from "../src/law";

const deg = (r: number): number => (r * 180) / Math.PI;
/** 2026-09-28 10:08:42 UTC, epoch ms. */
const AT = Date.UTC(2026, 8, 28, 10, 8, 42);

describe("the time a desk clock shows", () => {
  it("reads a zone as the prop spells it — `local`, `Z`/`UTC`, ±HH:MM, ±HHMM — and nothing else", () => {
    expect(zoneMinutes("local")).toBeUndefined();
    expect(zoneMinutes("Z")).toBe(0);
    expect(zoneMinutes("UTC")).toBe(0);
    expect(zoneMinutes("+09:00")).toBe(540);
    expect(zoneMinutes("-05:30")).toBe(-330);
    expect(zoneMinutes("+0545")).toBe(345);
    expect(zoneMinutes("UTC+01:00")).toBe(60);
    expect(zoneMinutes("+15:00")).toBeUndefined();
    expect(zoneMinutes("Tokyo")).toBeUndefined();
    expect(zoneOf(540)).toBe("+09:00");
    expect(zoneOf(-330)).toBe("-05:30");
    expect(zoneOf(0)).toBe("+00:00");
    expect(zoneMinutes(zoneOf(-570))).toBe(-570);
  });

  it("`local` is the host's zone at that moment; an unreadable zone keeps the host's, never a wrong hour", () => {
    expect(offsetAt("local", AT)).toBe(-new Date(AT).getTimezoneOffset());
    expect(offsetAt("Mars/Olympus", AT)).toBe(-new Date(AT).getTimezoneOffset());
    expect(offsetAt("+09:00", AT)).toBe(540);
  });

  it("the time of day is whole seconds since the zone's midnight, wrapping both ways", () => {
    expect(timeOfDay(AT, "+00:00")).toBe(10 * 3600 + 8 * 60 + 42);
    expect(timeOfDay(AT, "+09:00")).toBe(19 * 3600 + 8 * 60 + 42);
    expect(timeOfDay(AT, "-11:00")).toBe(23 * 3600 + 8 * 60 + 42); // the day before
    expect(timeOfDay(AT + 999, "+00:00")).toBe(timeOfDay(AT, "+00:00")); // a clock shows a second at a time
  });

  it("the hands: clockwise from twelve; with seconds the minute and hour creep each second, without they step each minute", () => {
    const tod = 10 * 3600 + 8 * 60 + 42;
    const on = handAngles(tod, true);
    expect(deg(on.second)).toBeCloseTo(252, 9);
    expect(deg(on.minute)).toBeCloseTo(8 * 6 + 42 * 0.1, 9);
    expect(deg(on.hour)).toBeCloseTo(300 + 8.7 * 0.5, 9);
    const off = handAngles(tod, false);
    expect(deg(off.minute)).toBeCloseTo(48, 9);
    expect(deg(off.hour)).toBeCloseTo(304, 9);
    expect(handAngles(tod + 1, false)).toMatchObject({ minute: off.minute, hour: off.hour });
    expect(handAngles(12 * 3600, true)).toEqual({ hour: 0, minute: 0, second: 0 });
    // the shop's 10:10:30 — the specimen's
    expect(deg(handAngles(SHOP_TIME, true).hour)).toBeCloseTo(305 + 0.25, 9);
  });
});

describe("the wake's arithmetic (a frame exactly when a hand must move)", () => {
  it("a second clock moves once a second, a minute clock once a minute — on the wall clock's boundaries, a hair early", () => {
    expect(stepOf(true)).toBe(1000);
    expect(stepOf(false)).toBe(60_000);
    const wall = AT + 300;
    const k = keyAt(wall, 1000);
    expect(nextMoveAt(k, 1000)).toBe(AT + 1000 - EARLY_MS);
    expect(keyAt(nextMoveAt(k, 1000), 1000)).toBe(k + 1); // read at its wake, the key has turned
    expect(keyAt(nextMoveAt(k, 1000) - 1, 1000)).toBe(k); // …and not a millisecond before it
    const km = keyAt(wall, 60_000);
    expect(nextMoveAt(km, 60_000) - wall).toBeLessThanOrEqual(60_000);
    expect(new Date(nextMoveAt(km, 60_000) + EARLY_MS).getUTCSeconds()).toBe(0);
  });

  it("the case in a hand is bigger and higher; the reach holds its shadow at full lift", () => {
    expect(caseOf(150, 0)).toEqual({ radius: 75, lift: 0, scale: 1 });
    const held = caseOf(150, 1);
    expect(held.radius).toBeCloseTo(75 * CLOCK.lift.scale, 9);
    expect(held.lift).toBe(CLOCK.lift.height);
    expect(clockReach()).toBeGreaterThan(
      CLOCK.shadow.slopeMax * (CLOCK.height.case + CLOCK.lift.height),
    );
  });
});
