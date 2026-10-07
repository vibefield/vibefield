/**
 * DK-15 — smoke:canvas's COVER rows, their judges (testing/smoke-covers.ts) held on records shaped as DK-15's first probe
 * read them in the product: the rise in the ruled order with the park inside the cover's own fade, the fade over the live
 * desk and never a blank frame, the hold, the recede, a re-capture's order, and thaw first on the way back.
 */
import { describe, expect, it } from "vitest";
import {
  alphaOf,
  COVERS,
  type CoverPassSeen,
  type CoverRecorded,
  type CoverRecordSeen,
  type CoverSample,
  i39Of,
  judgeAgain,
  judgeBack,
  judgeFade,
  judgeHold,
  judgeRecede,
  judgeRise,
  scaleOf,
} from "../src/testing/smoke-covers";
import type { StillnessSample } from "../src/testing/smoke-stillness";

/** The History rise of the first probe: a 2360-px still of a 1180-px view at DPR 2, parked 26 ms after the rise. */
const RISE: CoverRecordSeen = {
  seq: 3,
  view: "history",
  reduced: false,
  rose: 37_340,
  passes: [
    {
      reason: "rise",
      asked: 37_340,
      capture: {
        asked: 37_341,
        answered: 37_362.7,
        width: 2360,
        height: 1496,
        viewWidth: 1180,
        pxPerCss: 2,
      },
      blur: { px: 80, ms: 1.5 },
      face: "still",
      swapped: 37_363,
      hidden: 37_363,
      frozen: 37_363.1,
      parked: 37_366,
    },
  ],
  steps: ["capture", "blur", "swap", "hide", "freeze", "park"],
  said: null,
};

const sample = (over: Partial<CoverSample>): CoverSample => ({
  t: 0,
  cover: "down",
  opacity: 0,
  canvas: "visible",
  display: "block",
  still: "none",
  stillVisible: "hidden",
  transform: "matrix(1, 0, 0, 1, 0, 0)",
  frames: 100,
  submits: 110,
  parked: false,
  ...over,
});

/** A rise as the recorder saw it: two frames down, the cover up over the live desk, the swap at 37 363, the recede. */
const RISEN: CoverRecorded = {
  t0: 37_300,
  samples: [
    sample({ t: 37_310 }),
    sample({ t: 37_327 }),
    sample({ t: 37_344, cover: "up", opacity: 0, frames: 101 }),
    sample({ t: 37_361, cover: "up", opacity: 0.1, frames: 102 }),
    sample({
      t: 37_378,
      cover: "up",
      opacity: 0.3,
      canvas: "hidden",
      still: "still",
      stillVisible: "visible",
      frames: 103,
    }),
    sample({
      t: 38_000,
      cover: "up",
      opacity: 1,
      canvas: "hidden",
      still: "still",
      stillVisible: "visible",
      transform: "matrix(0.98, 0, 0, 0.98, 0, 0)",
      frames: 103,
    }),
  ],
  events: [
    { type: "transitionstart", property: "transform", t: 37_364 },
    { type: "transitionend", property: "transform", t: 37_929 },
  ],
  transition: "transform 0.56s cubic-bezier(0.25, 1, 0.3, 1)",
};

describe("judgeRise — capture → blur once → swap → hide → freeze → park, the park within the cover's fade", () => {
  it("passes the probe's History rise", () => {
    expect(judgeRise(RISE, 1180, 2360)).toEqual([]);
  });

  it("holds the budget inside the cover's own 240 ms fade", () => {
    expect(COVERS.parkBudgetMs).toBe(240);
    const late = {
      ...RISE,
      passes: [{ ...RISE.passes[0], parked: RISE.rose + 300 }],
    } as CoverRecordSeen;
    expect(judgeRise(late, 1180, 2360)).toEqual([
      "the park came 300 ms after the rise, over its 240 ms budget",
    ]);
  });

  it("refuses a freeze taken before the still stood (the old order: freeze in a passive effect, no still)", () => {
    const early = {
      ...RISE,
      steps: ["freeze", "capture", "blur", "swap", "hide", "park"],
      passes: [{ ...RISE.passes[0], frozen: 37_341 }],
    } as CoverRecordSeen;
    const problems = judgeRise(early, 1180, 2360);
    expect(problems).toContain("the freeze came before the still stood");
    expect(problems.some((p) => p.startsWith("the rise ran"))).toBe(true);
  });

  it("refuses a blur that is not 40 CSS px × the still's px per CSS px", () => {
    const css40 = {
      ...RISE,
      passes: [{ ...RISE.passes[0], blur: { px: 40, ms: 1 } }],
    } as CoverRecordSeen;
    expect(judgeRise(css40, 1180, 2360)).toEqual([
      "the blur is 40 px, not 40 CSS px × 2 px per CSS px = 80",
    ]);
  });

  it("refuses a still that is not the desk as it drew, and a capture that answered nothing", () => {
    expect(judgeRise(RISE, 1180, 2318)).toEqual([
      "the still is 2360 px wide, not the desk's drawn 2318",
    ]);
    const nothing = {
      ...RISE,
      passes: [
        {
          ...RISE.passes[0],
          capture: { ...RISE.passes[0]?.capture, width: null, pxPerCss: null },
          face: "ground",
        },
      ],
    } as CoverRecordSeen;
    expect(judgeRise(nothing, 1180, 2360)).toEqual(
      expect.arrayContaining([
        "the capture answered nothing",
        "the face under the cover is ground, not the still",
      ]),
    );
  });

  it("refuses a desk that never parked", () => {
    const { parked: _never, ...unparked } = RISE.passes[0] as CoverPassSeen;
    const awake: CoverRecordSeen = { ...RISE, steps: RISE.steps.slice(0, 5), passes: [unparked] };
    expect(judgeRise(awake, 1180, 2360)).toContain("the desk never parked under the cover");
  });
});

describe("i39Of — ICE I39 at desk.4, named and not blamed", () => {
  it("names a desk drawing a smaller backing than its layout (the boot under the loading transform)", () => {
    expect(i39Of(1180, 2, 2318)).toEqual({ drawn: 2318, layout: 2360 });
    expect(i39Of(1180, 2, 2360)).toBeNull();
    expect(i39Of(1180, 2, null)).toBeNull();
  });
});

describe("judgeFade — over the LIVE desk, and never a blank frame", () => {
  it("passes the recorder's rise", () => {
    expect(judgeFade(RISEN, 37_363)).toEqual([]);
  });

  it("refuses a cover whose first frame already showed the still or an opaque cover", () => {
    const samples = RISEN.samples.map((s, i) =>
      i === 2 ? { ...s, opacity: 1, still: "still", stillVisible: "visible" } : s,
    );
    expect(judgeFade({ ...RISEN, samples }, 37_363)).toEqual([
      'the cover\'s first frame showed {"canvas":"visible","still":"still"}, not the live desk',
      "the cover's first frame was already opaque (1)",
    ]);
  });

  it("refuses a desk parked under the fade before its still stood — the old order, the freeze as the cover rose", () => {
    const samples = RISEN.samples.map((s, i) => (i === 3 ? { ...s, parked: true } : s));
    expect(judgeFade({ ...RISEN, samples }, 37_363)).toEqual([
      "the desk parked under the fade before its still stood (first at 61 ms)",
    ]);
  });

  it("refuses a frame with neither the desk nor its still — a blank", () => {
    const samples = RISEN.samples.map((s, i) => (i === 3 ? { ...s, canvas: "hidden" } : s));
    expect(judgeFade({ ...RISEN, samples }, 37_363)).toEqual([
      "1 frame(s) showed neither the desk nor its still (first at 61 ms)",
    ]);
  });

  it("refuses a desk frozen under the fade, a canvas set display:none, and a canvas left showing under the still", () => {
    const frozen = RISEN.samples.map((s) => ({ ...s, frames: 100 }));
    expect(judgeFade({ ...RISEN, samples: frozen }, 37_363)).toEqual([
      "the desk drew nothing under the cover's fade — not live",
    ]);
    const display = RISEN.samples.map((s, i) => (i === 5 ? { ...s, display: "none" } : s));
    expect(judgeFade({ ...RISEN, samples: display }, 37_363)).toEqual([
      "the desk canvas was set display:none",
    ]);
    const shown = RISEN.samples.map((s, i) => (i === 5 ? { ...s, canvas: "visible" } : s));
    expect(judgeFade({ ...RISEN, samples: shown }, 37_363)).toEqual([
      "the desk canvas was not hidden (by visibility) under the still",
    ]);
  });
});

describe("judgeHold — zero frames and zero submits from the park", () => {
  const at = (frames: number, submits: number): StillnessSample => ({
    frames,
    submits,
    wakes: {},
    timed: 0,
    outside: 0,
    resting: 0,
  });

  it("passes a still window of 3.2 s, and refuses one under 3 s or one the desk moved in", () => {
    expect(judgeHold(at(2896, 2934), at(2896, 2934), 3_201)).toEqual([]);
    expect(judgeHold(at(2896, 2934), at(2896, 2934), 1_201)).toEqual([
      "the hold lasted 1201 ms, under 3000 ms",
    ]);
    expect(judgeHold(at(2896, 2934), at(2896, 2934), 1_201, 1_200)).toEqual([]);
    const moved = judgeHold(at(2896, 2934), at(2896, 2935), 3_201);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatch(/^the desk ran under the cover/);
  });
});

describe("judgeRecede — 1 → 0.98 over 560 ms on the island curve, transform only", () => {
  it("passes the recorder's recede", () => {
    expect(judgeRecede(RISEN, 37_363)).toEqual([]);
  });

  it("refuses §6's 600 ms field recede, a recede that never ended, and one that did not reach 0.98", () => {
    expect(
      judgeRecede({ ...RISEN, transition: "transform 0.6s cubic-bezier(0.25, 1, 0.3, 1)" }, 37_363),
    ).toEqual([
      'the still\'s transition is "transform 0.6s cubic-bezier(0.25, 1, 0.3, 1)", not transform 560 ms on the island curve',
    ]);
    expect(judgeRecede({ ...RISEN, events: [] }, 37_363)).toEqual([
      "the still's recede never ended",
    ]);
    const unmoved = RISEN.samples.map((s) => ({ ...s, transform: "none" }));
    expect(judgeRecede({ ...RISEN, samples: unmoved }, 37_363)).toEqual([
      "the still settled at 1, not 0.98",
    ]);
  });

  it("refuses a still that moved more than its transform", () => {
    const events = [...RISEN.events, { type: "transitionend", property: "opacity", t: 37_500 }];
    expect(judgeRecede({ ...RISEN, events }, 37_363)).toEqual([
      'the still moved more than its transform (["transform","transform","opacity"])',
    ]);
  });
});

describe("judgeAgain — thaw → one frame → capture → swap → hide → freeze → park", () => {
  const THEMED: CoverRecordSeen = {
    ...RISE,
    passes: [
      ...RISE.passes,
      {
        reason: "theme",
        asked: 40_663.4,
        thawed: 40_663.5,
        frame: { frames: 1, at: 40_665.6 },
        capture: {
          asked: 40_665.6,
          answered: 40_693.7,
          width: 2360,
          height: 1496,
          viewWidth: 1180,
          pxPerCss: 2,
        },
        blur: { px: 80, ms: 0.8 },
        face: "still",
        swapped: 40_694.5,
        hidden: 40_694.5,
        frozen: 40_694.6,
        parked: 40_696.6,
      },
    ],
  };

  it("passes the probe's theme pass", () => {
    expect(judgeAgain(THEMED, "theme").problems).toEqual([]);
  });

  it("refuses no pass, a pass without its frame, and one captured before its thaw", () => {
    expect(judgeAgain(RISE, "resize").problems).toEqual([
      "no resize pass was taken under the cover",
    ]);
    const noFrame = {
      ...THEMED,
      passes: [THEMED.passes[0], { ...THEMED.passes[1], frame: undefined }],
    } as CoverRecordSeen;
    expect(judgeAgain(noFrame, "theme").problems).toEqual(["the theme pass never took frame"]);
    const early = {
      ...THEMED,
      passes: [THEMED.passes[0], { ...THEMED.passes[1], thawed: 40_700 }],
    } as CoverRecordSeen;
    expect(judgeAgain(early, "theme").problems).toEqual(["the theme pass took frame before thaw"]);
  });
});

describe("judgeBack — thaw first, the canvas at once under the lowering cover, the still dropped", () => {
  const LOWERED: CoverRecordSeen = {
    ...RISE,
    steps: [...RISE.steps, "thaw", "show", "drop"],
    lowered: 43_905,
    thawed: 43_905,
    shown: 43_905,
    dropped: 43_905,
  };
  const DOWN: CoverRecorded = {
    t0: 43_890,
    samples: [
      sample({
        t: 43_895,
        cover: "up",
        opacity: 1,
        canvas: "hidden",
        still: "still",
        stillVisible: "visible",
      }),
      sample({ t: 43_907, cover: "down", opacity: 1, frames: 2908 }),
      sample({ t: 44_800, cover: "down", opacity: 0, frames: 3015 }),
    ],
    events: [],
    transition: "",
  };

  it("passes the probe's History lowering", () => {
    expect(judgeBack(LOWERED, DOWN)).toEqual([]);
  });

  it("refuses the still dropped first, a canvas not shown at once, and a desk that never drew again", () => {
    const order = { ...LOWERED, steps: [...RISE.steps, "drop", "thaw", "show"] };
    expect(judgeBack(order, DOWN)).toEqual([
      'back to the canvas ran ["drop","thaw","show"], not thaw → show → drop',
    ]);
    const late = {
      ...DOWN,
      samples: DOWN.samples.map((s, i) =>
        i === 1 ? { ...s, canvas: "hidden", still: "still" } : s,
      ),
    };
    expect(judgeBack(LOWERED, late)).toEqual([
      "the desk was not shown at once (hidden)",
      "the still was not dropped (still)",
    ]);
    const dead = { ...DOWN, samples: DOWN.samples.map((s) => ({ ...s, frames: 2908 })) };
    expect(judgeBack(LOWERED, dead)).toEqual(["the desk did not draw again after the cover"]);
  });
});

describe("the readings", () => {
  it("reads a computed scale and a computed alpha", () => {
    expect(scaleOf("matrix(0.98, 0, 0, 0.98, 0, 0)")).toBeCloseTo(0.98);
    expect(scaleOf("none")).toBe(1);
    expect(alphaOf("color(srgb 0.109804 0.109804 0.117647 / 0.72)")).toBe(0.72);
    expect(alphaOf("rgba(28, 28, 30, 0.72)")).toBe(0.72);
    expect(alphaOf("rgb(61, 90, 48)")).toBe(1);
  });
});
