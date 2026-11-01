import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATALOG_ERRORS,
  CATALOG_PAGE,
  type CatalogFace,
  catalogAt,
  catalogCuts,
  catalogShot,
  judgeCatalog,
  judgeRamp,
  type RampSeen,
  rampReadings,
} from "../src/testing/smoke-catalog";
import { cutChip } from "../src/testing/smoke-contrast";
import {
  FIRST_RUN_PAGE,
  firstRunContrast,
  judgeContrast,
  PAGE_WORDS,
  type WordSeen,
} from "../src/testing/smoke-first-run";

// FG — the catalog judged (desk-gates row 32's fourth walk, `catalog`): the design catalog's Setup Assistant frames,
// every face their controls offer by day and by night, judged by row 32's own measure, and DESIGN.md §2.4's ramp
// measured on the catalog's "Text ramp" (item 127). The walk runs only on a host with a window (the landing gate);
// what it judges, and how it names and cuts what it captures, is pinned here.

/** A BGRA picture `width` × `height`, every pixel `ground`, with `ink` laid where `inked` says. */
const picture = (
  width: number,
  height: number,
  ground: number,
  ink: number,
  inked: (x: number, y: number) => boolean,
): Uint8Array => {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const v = inked(x, y) ? ink : ground;
      px.set([v, v, v, 255], (y * width + x) * 4);
    }
  return px;
};

const word = (text: string, x: number, y: number, width: number, height: number): WordSeen => ({
  x,
  y,
  width,
  height,
  lines: [{ x, y, width, height }],
  text,
  shown: 1,
  off: false,
  fading: false,
  cut: null,
  color: "rgb(28, 28, 30)",
  list: null,
});

describe("the same measure as row 32's", () => {
  it("finds the words on the page with row 32's own finder, byte for byte", () => {
    expect(PAGE_WORDS).toContain("const wordsIn = (scope) =>");
    expect(FIRST_RUN_PAGE).toContain(PAGE_WORDS);
    expect(CATALOG_PAGE).toContain(PAGE_WORDS);
  });

  it("names each face by its theme, its frame and the choices that stand it, and its still after it", () => {
    const face = (theme: "day" | "night", index: string, preview: string, choices: string[]) =>
      catalogAt({ theme, index, preview, choices });
    expect(face("day", "02", "field", ["error"])).toBe("day 02 field (error)");
    expect(face("night", "06", "connect", ["ask", "what it sees"])).toBe(
      "night 06 connect (ask, what it sees)",
    );
    expect(face("day", "A4", "setting-up-write-failed", [])).toBe("day A4 setting-up-write-failed");
    expect(catalogShot(7, "night 06 connect (ask, what it sees)")).toBe(
      "007-night-06-connect-ask-what-it-sees.jpg",
    );
  });

  it("cuts a face's words from the frame's own capture, its boxes moved from the window onto the frame", () => {
    // the frame stands at (100, 50) in the window and is captured alone, 40 × 20; the word's glyphs ink part of its box
    const frame = { x: 100, y: 50, width: 40, height: 20 };
    const bitmap = picture(40, 20, 240, 40, (x, y) => x >= 5 && x < 9 && y >= 2 && y < 5);
    const seen = {
      view: { width: 1600, height: 900 },
      words: [word("Name", 104, 51, 8, 6)],
    };
    const cuts = catalogCuts("day 02 field (fresh)", bitmap, frame, seen, seen);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({
      words: "words",
      at: "day 02 field (fresh)",
      text: "Name",
      passed: null,
    });
    expect(cuts[0]?.px).toEqual(
      cutChip(bitmap, { width: 40, height: 20 }, { x: 4, y: 1, width: 8, height: 6 }),
    );
    // and they are judged as row 32 judges them, at §8's 4.5:1
    const contrast = firstRunContrast(cuts);
    expect(contrast.words.map((still) => [still.at, still.judged])).toEqual([
      ["day 02 field (fresh)", 1],
    ]);
    expect(judgeContrast(contrast)).toEqual([]);
  });
});

/** A face as the walk records it. */
const face = (
  theme: "day" | "night",
  index: string,
  preview: string,
  choices: string[],
  rest: Partial<CatalogFace> = {},
): CatalogFace => ({
  at: catalogAt({ theme, index, preview, choices }),
  theme,
  index,
  preview,
  choices,
  fit: 1,
  alert: null,
  ...rest,
});

/** Both themes' faces: one face a frame, and the three error faces standing their line. */
const walked = (change: (f: CatalogFace) => CatalogFace = (f) => f): CatalogFace[] =>
  (["day", "night"] as const).flatMap((theme) =>
    Array.from({ length: CATALOG.frames }, (_, n) => {
      const error = CATALOG_ERRORS[n];
      return change(
        error === undefined
          ? face(theme, String(n + 1).padStart(2, "0"), `frame-${n}`, [])
          : face(theme, error.index, error.preview, [...error.choices], {
              alert: "That did not save.",
            }),
      );
    }),
  );

describe("the catalog's faces judged", () => {
  it("names the faces that stand the wizard's error line: You's refusal, and Setting up's two", () => {
    expect(CATALOG_ERRORS).toEqual([
      { index: "02", preview: "field", choices: ["error"] },
      { index: "A4", preview: "setting-up-write-failed", choices: [] },
      { index: "A5", preview: "setting-up-desk-failed", choices: [] },
    ]);
  });

  it("holds every frame in both themes, each glass at its own size, and the error line standing on its faces", () => {
    expect(judgeCatalog(walked())).toEqual([]);
  });

  it("is red on a frame that scales the glass under its size, and on one whose fit it could not read", () => {
    const scaled = walked((f) => (f.at === "day 02 field (error)" ? { ...f, fit: 0.7375 } : f));
    expect(judgeCatalog(scaled)).toEqual([
      "on day 02 field (error) the glass stands at fit 0.7375, under its own size (FG-L2's ground of 976 × 736)",
    ]);
    const unread = walked((f) =>
      f.at === "night A5 setting-up-desk-failed" ? { ...f, fit: null } : f,
    );
    expect(judgeCatalog(unread)).toEqual([
      "on night A5 setting-up-desk-failed the glass's fit could not be read",
    ]);
  });

  it("is red on an error face whose line never stood, and on a theme that met fewer faces or frames", () => {
    const silent = walked((f) =>
      f.at === "night A4 setting-up-write-failed" ? { ...f, alert: null } : f,
    );
    expect(judgeCatalog(silent)).toEqual([
      "by night the wizard's error line never stood on A4 setting-up-write-failed",
    ]);
    const short = walked().filter((f) => f.at !== "night 04 frame-3");
    expect(judgeCatalog(short)).toEqual([
      `by night the catalog showed ${CATALOG.frames - 1} frames, not ${CATALOG.frames}`,
      `the walk met ${CATALOG.frames} faces by day and ${CATALOG.frames - 1} by night`,
    ]);
  });
});

describe("DESIGN.md §2.4's ramp measured (item 127)", () => {
  // a chip 20 × 10 on white with an eighth of it inked: the ink as its tier lays #1C1C1E over the ground
  const chip = (alpha: number): Uint8Array =>
    picture(
      20,
      10,
      255,
      Math.round(28 * alpha + 255 * (1 - alpha)),
      (x, y) => (x + y * 20) % 8 === 0,
    );
  const seen = (tier: string, floor: number, x: number): RampSeen["chips"][number] => ({
    tier,
    ground: "--vf-chrome-solid",
    floor,
    x,
    y: 40,
    width: 20,
    height: 10,
    text: tier,
    shown: 1,
  });

  it("reads each chip on the specimen's own capture and holds it to its tier's floor", () => {
    // t3 at the old 45% beside t3 at 64%, cut from one capture of the specimen at (300, 40)
    const bitmap = new Uint8Array(40 * 10 * 4);
    const left = chip(0.45);
    const right = chip(0.64);
    for (let y = 0; y < 10; y += 1) {
      bitmap.set(left.subarray(y * 80, y * 80 + 80), y * 160);
      bitmap.set(right.subarray(y * 80, y * 80 + 80), y * 160 + 80);
    }
    const ramp: RampSeen = {
      view: { width: 1600, height: 900 },
      box: { x: 300, y: 40, width: 40, height: 10 },
      chips: [seen("t3", 4.5, 300), seen("t3", 4.5, 320)],
    };
    const readings = rampReadings("day", bitmap, ramp);
    expect(readings.map((r) => [r.tier, r.ratio])).toEqual([
      ["t3", 2.8],
      ["t3", 5.1],
    ]);
    expect(judgeRamp(readings)).toEqual([
      "by day t3 on --vf-chrome-solid reads 2.8:1 ([255,255,255] → [153,153,153]), under its floor 4.5:1 (DESIGN.md §2.4)",
    ]);
  });

  it("is red on a chip its capture could not give up", () => {
    expect(
      judgeRamp([
        {
          theme: "night",
          tier: "t4",
          ground: "--vf-fill",
          floor: 3,
          ratio: null,
          ink: null,
          groundRgb: null,
        },
      ]),
    ).toEqual(["by night t4 on --vf-fill could not be cut from its capture"]);
  });
});
