// @vitest-environment node
/**
 * DK-11 — THE DESK'S NOTICES ON THE STATUS LINE (field/desk/desk-notices.ts; DESIGN.md §8 "The status line", "The
 * missing face"; R12, R24): each type on the board the desk draws as missing is said ONCE, in the bar's words — never
 * per frame, never for a type its kind draws; said again only for another word, or after it was drawn again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceMissing, resetDeskNoticesForTest } from "../src/field/desk/desk-notices";
import type { ObjectWordState, ObjectWords } from "../src/field/desk/desk-object-words";
import { resetStatusLineForTest, STATUS_STAND_MS, statusLineSaid } from "../src/frame/status-line";

beforeEach(() => {
  vi.useFakeTimers();
  resetStatusLineForTest();
  resetDeskNoticesForTest();
});

afterEach(() => {
  resetStatusLineForTest();
  vi.useRealTimers();
});

/** The words as the mount would say them: `missing` holds each missing type's word. */
const wordsFrom =
  (missing: Record<string, ObjectWordState>) =>
  (type: string): ObjectWords => {
    const title = type.split(".").at(-1) ?? type;
    const state = missing[type] ?? null;
    return { type, title, state, label: state === null ? title : `${title} · ${state}` };
  };

describe("the desk's notices on the status line (DK-11)", () => {
  it("says each missing type once, in the bar's words — and never a type its kind draws", () => {
    const words = wordsFrom({ "x.clock": "plugin off", "x.dial": "no kind" });
    announceMissing(["desk.note", "x.clock", "x.dial"], words);
    announceMissing(["desk.note", "x.clock", "x.dial"], words); // the next frame, the next status: nothing
    vi.advanceTimersByTime(STATUS_STAND_MS * 3); // one at a time: the second takes the line after the first
    expect(statusLineSaid()).toEqual([
      { id: "missing:x.clock:plugin off", text: "clock · plugin off" },
      { id: "missing:x.dial:no kind", text: "dial · no kind" },
    ]);
  });

  it("says a type again only for ANOTHER word, or once it was drawn again and is lost anew", () => {
    const stand = (): void => {
      vi.advanceTimersByTime(STATUS_STAND_MS);
    };
    announceMissing(["x.clock"], wordsFrom({ "x.clock": "plugin off" }));
    stand();
    announceMissing(["x.clock"], wordsFrom({ "x.clock": "plugin off" })); // the same word: nothing
    stand();
    announceMissing(["x.clock"], wordsFrom({ "x.clock": "can't draw" })); // another word: said
    stand();
    announceMissing(["x.clock"], wordsFrom({})); // drawn again: forgotten
    announceMissing(["x.clock"], wordsFrom({ "x.clock": "can't draw" })); // lost anew: said again
    stand();
    expect(statusLineSaid().map((n) => n.text)).toEqual([
      "clock · plugin off",
      "clock · can't draw",
      "clock · can't draw",
    ]);
  });
});
