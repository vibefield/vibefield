/**
 * DESIGN.md §9 — sizes as Finder counts them, in thousands. `sizeWords` is the frame's: a size beside a
 * bound is rounded up and the bound down, so the two never read as equal, and the unit is chosen after
 * the rounding (HN B2: the copy door's refusals and a card's facts say their sizes through it, as the D6
 * refusal always has).
 */
import { describe, expect, it } from "vitest";
import { sizeWords } from "../src/format/bytes";

describe("sizeWords — a size in the frame's words (§9)", () => {
  it("says bytes below a kilobyte, one byte as one", () => {
    expect(sizeWords(1)).toBe("1 byte");
    expect(sizeWords(999)).toBe("999 bytes");
  });

  it("chooses the unit after rounding, so nothing reads 1000 KB", () => {
    expect(sizeWords(999_600)).toBe("1 MB");
    expect(sizeWords(999_999, Math.ceil)).toBe("1 MB");
  });

  it("rounds a size up and its bound down, so a refusal never names two equal figures", () => {
    expect(sizeWords(65_537, Math.ceil)).toBe("66 KB");
    expect(sizeWords(65_536, Math.floor)).toBe("65 KB");
    expect(sizeWords(80_000, Math.ceil)).toBe("80 KB");
  });

  it("says megabytes and gigabytes to a tenth", () => {
    expect(sizeWords(67_108_864, Math.floor)).toBe("67.1 MB");
    expect(sizeWords(2_500_000_000)).toBe("2.5 GB");
  });
});
