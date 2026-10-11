/**
 * PT-5a (ruling 6) — PUT-DOWN, in the product (testing/smoke-put-down.ts): the judge the row holds the product to — a kind
 * struck out while its object is IN HAND is put down by the host, on the desk again wearing the missing face — passing what
 * the product does and failing, in words, an object held forever, one that vanished, one that draws; and a row that proved
 * nothing says so.
 */
import { describe, expect, it } from "vitest";
import { judgePutDown, PUT_DOWN, type PutDownSeen } from "../src/testing/smoke-put-down";

const TYPE = "vibefield.example.desk-clock.clock.fragile";
const TITLE = "Fragile clock";
const GREEN: PutDownSeen = {
  laid: true,
  held: true,
  struck: true,
  downMs: 240,
  picked: TYPE,
  words: "Fragile clock · can't draw",
  census: 1,
};

describe("PUT-DOWN — a kind struck out while in hand is put down by the host", () => {
  it("passes: seen in hand, struck there, the hand empty with nothing pressed, the clock where it lay as its missing face", () => {
    expect(judgePutDown(GREEN, TYPE, TITLE)).toEqual([]);
    expect(judgePutDown({ ...GREEN, downMs: 0 }, TYPE, TITLE)).toEqual([]);
  });

  it("FAILS an object held forever: the kind struck, the hand never emptied", () => {
    expect(judgePutDown({ ...GREEN, downMs: null }, TYPE, TITLE)).toEqual([
      "PUT-DOWN: the struck kind's object is STILL IN THE HAND — the host did not put it down (ICE's `ops.putDown` is not handed to the desk's layer)",
    ]);
  });

  it("fails one that vanished, one picked as something else, and one that still draws", () => {
    expect(judgePutDown({ ...GREEN, census: 0, picked: null }, TYPE, TITLE)).toEqual([
      "PUT-DOWN: 0 of the clock on the board after the put-down, not the one laid",
      `PUT-DOWN: where the clock lay the desk picks null, not the clock (${TYPE})`,
    ]);
    expect(judgePutDown({ ...GREEN, picked: "vibefield.note" }, TYPE, TITLE)).toEqual([
      `PUT-DOWN: where the clock lay the desk picks "vibefield.note", not the clock (${TYPE})`,
    ]);
    expect(judgePutDown({ ...GREEN, words: "Fragile clock" }, TYPE, TITLE)).toEqual([
      'PUT-DOWN: the bar\'s words for the clock are "Fragile clock", not "Fragile clock · can\'t draw" — it does not wear the missing face',
    ]);
  });

  it("a row that proved nothing says so, and says nothing else", () => {
    expect(judgePutDown({ ...GREEN, laid: false }, TYPE, TITLE)).toEqual([
      "PUT-DOWN: the clock that breaks in hand was not found on the desk — the row proved nothing",
    ]);
    expect(judgePutDown({ ...GREEN, held: false, downMs: null }, TYPE, TITLE)).toEqual([
      "PUT-DOWN: the clock was never seen in hand — the row proved nothing",
    ]);
    expect(judgePutDown({ ...GREEN, struck: false }, TYPE, TITLE)).toEqual([
      "PUT-DOWN: the clock's kind was not struck out while it was held — the row proved nothing",
    ]);
  });

  it("lays its clock beside the fault rows' three, and waits for the strike and the put-down", () => {
    expect(PUT_DOWN.at).toEqual({ x: 560, y: 960, w: 150, h: 150 });
    expect(PUT_DOWN.struckWithinMs).toBeGreaterThan(PUT_DOWN.downWithinMs);
  });
});
