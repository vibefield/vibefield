/**
 * DK-18 — the product desk rig's missing acts (testing/smoke-desk-rig.ts): every kind the pegboard hangs taken off it by
 * the pointer — one object more, the one selection under the release, the board folded, the kind not faulted, its face
 * DRAWN (judged by how much of the release's region it changed and by its colours and contrast, never by a hash), one undo
 * step back — and the take's landing timed by the K-H discipline (the minimum over the kinds against the budget).
 */
import { describe, expect, it } from "vitest";
import { judgeLanded, judgeTake, TAKE, type TakeSeen } from "../src/testing/smoke-desk-rig";

/** DK-18's probe, by day: the note taken off the Paper category and dropped where nothing picks. */
const NOTE: TakeSeen = {
  type: "desk.note",
  category: "paper",
  counts: { before: 1, after: 2, undone: 1 },
  selected: { count: 1, under: true },
  picked: "desk.note",
  faulted: false,
  folded: true,
  face: { px: 102_400, changed: 42_080, colors: 192, lumaRange: 210 },
  landedMs: 8.5,
};

describe("TAKE — a kind taken off the pegboard by the pointer, drawn where it was dropped", () => {
  it("passes the probe's note, and the mini mat's flat face (a mat on the mat) by its own numbers", () => {
    expect(judgeTake(NOTE)).toEqual([]);
    expect(
      judgeTake({
        ...NOTE,
        type: "desk.minimat",
        face: { px: 102_400, changed: 81_041, colors: 27, lumaRange: 47 },
      }),
    ).toEqual([]);
  });

  it("passes a calendar whose paper picks its day — the selection's box holds the release", () => {
    expect(judgeTake({ ...NOTE, type: "desk.calendar", picked: null })).toEqual([]);
  });

  it("refuses a take that laid nothing, or two", () => {
    expect(judgeTake({ ...NOTE, counts: { before: 1, after: 1, undone: 1 } })[0]).toMatch(
      /laid 0, not one/,
    );
    expect(judgeTake({ ...NOTE, counts: { before: 1, after: 3, undone: 1 } })[0]).toMatch(
      /laid 2, not one/,
    );
  });

  it("refuses an object not selected under the release, a board left out, a faulted kind", () => {
    expect(judgeTake({ ...NOTE, selected: { count: 1, under: false } })[0]).toMatch(
      /not the one selection under the release/,
    );
    expect(judgeTake({ ...NOTE, selected: { count: 0, under: false } })[0]).toMatch(
      /not the one selection/,
    );
    expect(judgeTake({ ...NOTE, folded: false })).toEqual([
      "desk.note: the board stayed out after the take",
    ]);
    expect(judgeTake({ ...NOTE, faulted: true })[0]).toMatch(/refused or struck/);
  });

  it("refuses a face not drawn there — the region all but unchanged — and a flat one", () => {
    // the night probe's note: its paper by night is near the mat's grey, 0.5 % of the region moved
    expect(
      judgeTake({ ...NOTE, face: { px: 102_400, changed: 534, colors: 44, lumaRange: 63 } })[0],
    ).toMatch(/changed 0.5 % of the release's region — not drawn there/);
    expect(
      judgeTake({ ...NOTE, face: { px: 102_400, changed: 40_000, colors: 3, lumaRange: 2 } })[0],
    ).toMatch(/the face is flat/);
    expect(judgeTake({ ...NOTE, face: null })).toEqual([
      "desk.note: no capture answered for its face",
    ]);
  });

  it("refuses a take ⌘Z did not take back in one step", () => {
    expect(judgeTake({ ...NOTE, counts: { before: 1, after: 2, undone: 2 } })[0]).toMatch(
      /⌘Z did not take the take back in one step/,
    );
  });
});

describe("LANDED (K-H) — the minimum over the takes against the budget", () => {
  it("passes the probe's eight takes, under a load of 140–180", () => {
    const landed = judgeLanded([8.1, 8.5, 3.7, 7.3, 6.1, 4.9, 7, 6.6]);
    expect(landed.problems).toEqual([]);
    expect(landed.min).toBe(3.7);
    expect(landed.n).toBe(8);
  });

  it("holds the MINIMUM: a burst in some takes is load, every take over the budget is a regression", () => {
    expect(judgeLanded([8, 900, 7, 1_200, 6]).problems).toEqual([]);
    expect(judgeLanded([300, 400, 260, 280, 900]).problems[0]).toMatch(
      new RegExp(
        `fastest take landed 260 ms after its release, over the budget's ${TAKE.landBudgetMs}`,
      ),
    );
  });

  it("refuses fewer than five takes timed — a minimum of fewer says nothing", () => {
    expect(judgeLanded([5, 6, null, null]).problems[0]).toMatch(/2 takes timed/);
  });
});
