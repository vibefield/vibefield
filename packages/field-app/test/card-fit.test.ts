import { describe, expect, it } from "vitest";
import { fitName, fitWords, headOf, type Measure, NAME, WORDS } from "../src/frame/cards/card-fit";

/**
 * FACE-a (item 405) — how the face sets its one line of words and its window's words (DESIGN.md §8 "A card"; *Card
 * Stock* round 5, faces.js `head` and `WINDOW.text`), measured here by a fixed ruler: every character 0.6 of its size
 * wide, bold a tenth wider, and the tracking after each.
 */
const ruler: Measure = (text, px, weight, tracking) =>
  Array.from(text).length * (px * (weight === 700 ? 0.66 : 0.6) + tracking);

describe("the name, on one line of the head", () => {
  it("is set at 11.5 when it fits, and down in quarter steps to 10 before it is ever cut", () => {
    expect(NAME).toEqual({ max: 11.5, min: 10, step: 0.25, tracking: -0.22, room: 88.6 });
    expect(fitName("routes.ts", true, ruler)).toEqual({ px: 11.5, text: "routes.ts" });
    // thirteen characters fit from 10.5 down, never at 10.75
    expect(fitName("Release notes", false, ruler)).toEqual({ px: 10.5, text: "Release notes" });
  });

  it("cuts a file's name in its middle, as Finder cuts one, so its extension stays", () => {
    expect(fitName("cards-model-presenter.ts", true, ruler)).toEqual({
      px: 10,
      text: "cards-…ter.ts",
    });
  });

  it("cuts any other name after a whole word when that keeps more than half the line, else where it runs out", () => {
    expect(fitName("Never drop a paste unsaid.", false, ruler).text).toBe("Never drop a…");
    expect(fitName("Supercalifragilistic", false, ruler).text).toBe("Supercalifra…");
  });

  it("stands whole at its largest with no measure, and never reads past what could fit", () => {
    expect(fitName("Never drop a paste unsaid.", false, null)).toEqual({
      px: 11.5,
      text: "Never drop a paste unsaid.",
    });
    expect(fitName("x".repeat(5000), false, null).text).toHaveLength(120);
  });

  it("never splits a character in two", () => {
    expect(headOf("a🂡b", 2)).toBe("a");
    expect(headOf("a🂡b", 3)).toBe("a🂡");
    expect(headOf("ab", 5)).toBe("ab");
  });
});

describe("a text window's words", () => {
  it("are set at the largest of three sizes at which they all fit, and at the smallest they are cut", () => {
    expect(WORDS.sizes).toEqual([
      [8.4, 11.2],
      [7.4, 10],
      [6.4, 8.8],
    ]);
    expect(fitWords("Say its size.", ruler)).toEqual({ px: 8.4, pitch: 11.2, lines: 9 });
    // thirty short words: ten lines at 8.4 (one past its nine), eight at 7.4
    expect(fitWords("abcd ".repeat(30), ruler)).toEqual({ px: 7.4, pitch: 10, lines: 10 });
    // sixty: past both, so the smallest, cut at its eleven
    expect(fitWords("abcd ".repeat(60), ruler)).toEqual({ px: 6.4, pitch: 8.8, lines: 11 });
  });

  it("take the middle size with no measure", () => {
    expect(fitWords("Say its size.", null)).toEqual({ px: 7.4, pitch: 10, lines: 10 });
  });
});
