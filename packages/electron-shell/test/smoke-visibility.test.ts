// DK-11 — A FRAME COUNT NEEDS A DRAWN WINDOW (testing/smoke-visibility.ts): a GPU-on desk smoke row that counts frames is
// judged on a VISIBLE page — visible at both ends of its window and never non-visible in between (the page's recorder counts
// every transition, so a blink inside the window is caught though both ends read visible) — and a row whose page was hidden
// fails with the NAMED cause, "the window was hidden — occluded", never a frame verdict it could not have earned.
import { describe, expect, it } from "vitest";
import {
  DRAWN_BUDGET_MS,
  HIDDEN_CAUSE,
  hiddenDuring,
  neverDrawn,
  PAGE_VISIBILITY,
  type PageVisibility,
} from "../src/testing/smoke-visibility";

const seen = (over: Partial<PageVisibility> = {}): PageVisibility => ({
  visibility: "visible",
  hidden: 0,
  ...over,
});

describe("a frame-counting row's window, judged on its page's visibility", () => {
  it("passes a window visible at both ends with no transition in between", () => {
    expect(hiddenDuring("the busy second", seen({ hidden: 2 }), seen({ hidden: 2 }))).toBeNull();
  });

  it("names the cause for a BLINK inside the window, though both ends read visible", () => {
    const problem = hiddenDuring(
      "the busy second",
      seen({ hidden: 0 }),
      seen({ hidden: 1, lastHiddenAt: 1156 }),
    );
    expect(problem).toContain(`the busy second: ${HIDDEN_CAUSE}`);
    expect(problem).toContain("went non-visible 1 time(s) inside the window, last at 1156 ms");
  });

  it("names the cause for a window that starts or ends hidden", () => {
    expect(hiddenDuring("the rest window", seen({ visibility: "hidden" }), seen())).toContain(
      HIDDEN_CAUSE,
    );
    expect(
      hiddenDuring("the rest window", seen(), seen({ visibility: "hidden", hidden: 1 })),
    ).toContain('it read "visible" → "hidden"');
  });

  it("says a page that never became visible within its budget was hidden — occluded", () => {
    expect(HIDDEN_CAUSE).toBe("the window was hidden — occluded");
    expect(DRAWN_BUDGET_MS).toBe(10_000);
    expect(neverDrawn("the freeze row's busy second", seen({ visibility: "hidden" }), 10_012)).toBe(
      `the freeze row's busy second: the window was hidden — occluded — the page stayed "hidden" for 10012 ms, so no frame could be counted (the compositor's zero, not the desk's)`,
    );
  });

  it("arms ONE recorder in the page — every transition to a non-visible state counted, in the capture phase", () => {
    expect(PAGE_VISIBILITY).toContain('document.addEventListener("visibilitychange"');
    expect(PAGE_VISIBILITY).toContain('if (document.visibilityState !== "visible")');
    expect(PAGE_VISIBILITY).toContain("if (g.__vfSmokeVisibility === undefined)");
    expect(PAGE_VISIBILITY).toContain("{ capture: true }");
  });
});

describe("the page's whole life, since the window loaded (the occluded row)", () => {
  it("passes a page that never went non-visible, and names the cause for one that did — once is enough", async () => {
    const { hiddenSinceLoad } = await import("../src/testing/smoke-visibility");
    expect(hiddenSinceLoad("the occluded row", seen())).toBeNull();
    expect(hiddenSinceLoad("the occluded row", seen({ hidden: 1, lastHiddenAt: 7353 }))).toBe(
      `the occluded row: the window was hidden — occluded — the page went non-visible 1 time(s) since the window loaded, last at 7353 ms (it reads "visible"); a mode that counts frames must keep its page visible whole`,
    );
    expect(hiddenSinceLoad("the occluded row", seen({ visibility: "hidden" }))).toContain(
      'it reads "hidden"',
    );
  });
});
