/**
 * Item 327 — the desk smokes' shared guard (testing/smoke-desk-facts.ts): a row's press is judged by the count it asks
 * the anchor for, read until it is reached or five seconds pass, so a press that took no selection is said by the
 * press and never by the bar's wait after it. Both desk rows that select by a tap, HN-3's (smoke-desk-copy.ts) and
 * DK-11's (smoke-selection-bar.ts), ask it: held here in their source.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selectionWant, waitSelectionTook } from "../src/testing/smoke-desk-facts";

const testing = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "testing");

/** The counts a press is read as, in turn, and a clock that moves 60 ms with each pause. */
function scripted(counts: readonly (number | null)[]) {
  let reads = 0;
  let clock = 0;
  const pauses: number[] = [];
  return {
    count: async (): Promise<number | null> => counts[Math.min(reads++, counts.length - 1)] ?? null,
    pause: async (ms: number): Promise<void> => {
      pauses.push(ms);
      clock += ms;
    },
    now: (): number => clock,
    reads: (): number => reads,
    pauses,
  };
}

describe("the count a row's press asks for", () => {
  it("is 1 for a plain press, whatever stood selected", () => {
    expect(selectionWant(0, [])).toBe(1);
    expect(selectionWant(3, [])).toBe(1);
  });

  it("is one more than before under ⇧, and 1 when nothing was read", () => {
    expect(selectionWant(1, ["shift"])).toBe(2);
    expect(selectionWant(null, ["shift"])).toBe(1);
  });
});

describe("a press judged by the count it took", () => {
  it("passes once the count is reached, reading no further", async () => {
    const s = scripted([0, 0, 1, 5]);
    expect(await waitSelectionTook("desk.note", 1, s.count, s.pause, 5_000, s.now)).toBeNull();
    expect(s.reads()).toBe(3);
  });

  it("says the press when the count never comes, with the last count read", async () => {
    const s = scripted([0]);
    expect(await waitSelectionTook("desk.board", 1, s.count, s.pause, 5_000, s.now)).toBe(
      "the press on desk.board took no selection: count 0, not 1",
    );
  });

  it("says none when the desk answers no anchor", async () => {
    const s = scripted([null]);
    expect(await waitSelectionTook("desk.board", 1, s.count, s.pause, 5_000, s.now)).toBe(
      "the press on desk.board took no selection: count none, not 1",
    );
  });

  it("reads for five seconds and no longer, 60 ms apart", async () => {
    const s = scripted([1]);
    await waitSelectionTook("desk.note", 2, s.count, s.pause, 5_000, s.now);
    expect(s.pauses.every((ms) => ms === 60)).toBe(true);
    expect(s.pauses.length).toBe(Math.ceil(5_000 / 60));
  });
});

describe("the desk rows that select by a tap ask whether their press took", () => {
  for (const file of ["smoke-desk-copy.ts", "smoke-selection-bar.ts"]) {
    it(file, () => {
      const source = readFileSync(join(testing, file), "utf8");
      const start = source.indexOf("const select = async (");
      expect(start, `${file} has no select`).toBeGreaterThan(-1);
      const body = source.slice(start, source.indexOf("\n  };", start));
      expect(body).toContain("selectionWant(");
      expect(body).toContain("waitSelectionTook(");
      expect(body).toContain("UNDER(");
    });
  }
});
