import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as catalogModule from "../src/testing/smoke-catalog";
import {
  CATALOG,
  CATALOG_ERRORS,
  CATALOG_PAGE,
  type CatalogDriver,
  type CatalogFace,
  catalogAt,
  catalogCuts,
  catalogRows,
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
import { tempDir } from "./temp-dir";

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

// Item 264 — the walk captures a still document. The catalog animates every scroll (`html { scroll-behavior: smooth }`),
// and three of its views keep themselves in view as they mount (Godview's last run, and the Peek's rows in Godview and
// in History), so the document can still be moving when the walk is ready: row 1 (2026-11-08) caught the welcome
// frame's still holding History's Peek plate, and fd's witness stopped at the walk's very first capture, the day
// ramp's, on a bare UnknownVizError (read as the same race, never proven).
// Read through the module's namespace, so the module loads before these exist.
const exported = <T>(name: string): T => (catalogModule as unknown as Record<string, T>)[name] as T;
type Reading = { at: number; top: number | null };
type StillSince = (readings: readonly Reading[], quietMs: number) => number | null;
type MovedDuring = (
  at: string,
  before: number | null,
  after: number | null,
  times?: 1 | 2,
) => string | null;

/** Row 3c's MEASURED load (2026-11-08 20:40Z, the instrument's scroll events): the document's scrollTop, by ms. */
const ROW_3C: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1926, 432.5],
  [1963, 56149.5],
  [1993, 60543],
  [2020, 63294.5],
  [2074, 65825.5],
  [2639, 77013.5],
];
/** Where row 3c's document stood `at` ms into its load. */
const row3cAt = (at: number): number =>
  [...ROW_3C].reverse().find(([when]) => when <= at)?.[1] ?? 0;
/** The walk's own reading of that load: every 100 ms, from 0 to `until`. */
const sampled = (until: number): Reading[] => {
  const out: Reading[] = [];
  for (let at = 0; at <= until; at += 100) out.push({ at, top: row3cAt(at) });
  return out;
};

describe("the walk captures a still document (item 264)", () => {
  it("says the document still only once it has rested a whole second, over row 3c's measured load", () => {
    const stillSince = exported<StillSince>("stillSince");
    expect(typeof stillSince).toBe("function");
    expect(stillSince(sampled(3600), 1000)).toBeNull();
    expect(stillSince(sampled(3700), 1000)).toBe(2700);
  });

  it("never says still while the page keeps moving, nor without a position", () => {
    const stillSince = exported<StillSince>("stillSince");
    expect(typeof stillSince).toBe("function");
    const moving = Array.from({ length: 30 }, (_, i) => ({
      at: i * 100,
      top: i % 2 === 0 ? 0 : 24.5,
    }));
    expect(stillSince(moving, 1000)).toBeNull();
    expect(
      stillSince(
        [
          { at: 0, top: null },
          { at: 2000, top: null },
        ],
        1000,
      ),
    ).toBeNull();
    expect(stillSince([], 1000)).toBeNull();
  });

  it("says a move during a capture in the walk's own words, once and twice, and nothing when it held", () => {
    const movedDuring = exported<MovedDuring>("movedDuring");
    expect(typeof movedDuring).toBe("function");
    expect(movedDuring("day 01 welcome", 73271, 89062)).toBe(
      "on day 01 welcome the catalog's document moved during the capture (73271 → 89062)",
    );
    expect(movedDuring("day text ramp", 1239.5, 89062, 2)).toBe(
      "on day text ramp the catalog's document moved during the capture (1239.5 → 89062), twice",
    );
    expect(movedDuring("day 01 welcome", 73271, 73271)).toBeNull();
    // a position the page could not read never held
    expect(movedDuring("day 01 welcome", 73271, null)).toBe(
      "on day 01 welcome the catalog's document moved during the capture (73271 → null)",
    );
  });

  it("waits for a still document before each theme's first capture, brackets every capture, and says every re-walk (held in the source)", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "testing", "smoke-catalog.ts"),
      "utf8",
    );
    // the walk's theme loop (judgeCatalog's stands earlier in the file)
    const loop = source.slice(source.lastIndexOf('for (const theme of ["day", "night"] as const)'));
    const wait = loop.indexOf("await untilStill(theme)");
    expect(wait).toBeGreaterThan(-1);
    expect(wait).toBeLessThan(loop.indexOf('page<boolean>("showRamp()")'));
    // one capture in the walk, and it is the bracketed one: from a face's settled read (its own `top`, VF-PM's (b)) or
    // from just before the ramp's capture, to just after it
    expect(source.match(/webContents\.capturePage\(/gu)?.length).toBe(1);
    expect(source).toMatch(
      /const capture = async[\s\S]*?scrollTop\(\)[\s\S]*?capturePage\([\s\S]*?scrollTop\(\)/u,
    );
    expect(CATALOG_PAGE).toContain("scrollTop: () =>");
    expect((CATALOG as unknown as Record<string, unknown>)["stillMs"]).toBe(1000);
    expect((CATALOG as unknown as Record<string, unknown>)["stillPollMs"]).toBe(100);
    // the verdict record says every re-walk, empty on a clean run, never dropped
    expect(source).toContain('facts["recaptured"] = recaptured;');
  });
});

/** A capture as the page held here takes it: the document moves `move` px during it, and `fails` throws as viz did. */
interface Capturing {
  readonly move?: number;
  readonly fails?: boolean;
}

/** The page held here, beyond its load: when it first stands (`ready()`, `readyAt` ms into its load), how each capture
 * moves the document (`capturing`, in the walk's order: each theme's ramp, then its face), a mover right after the
 * walk's first read of a face, its settled read (`afterFirstFace` px, as one the walk's own choice sets off), and the
 * Text ramp's box. */
interface HeldPage {
  readonly readyAt?: number;
  readonly capturing?: readonly Capturing[];
  readonly afterFirstFace?: number;
  readonly rampBox?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** The walk itself over a page held here, no Electron (item 264): one frame (01 welcome, no controls), a Text ramp of
 * no chips, the theme's toggle, and the document's position as `scroll` gives it by ms into the page's load. A frame's
 * read carries the document's position, read with its box. Its facts and problems, the position each capture met as
 * it began, and the lines the walk said. */
const walkOver = async (
  scroll: (elapsed: number) => number | null,
  held: HeldPage = {},
): Promise<{
  facts: Record<string, unknown>;
  problems: string[];
  met: Reading[];
  said: string[];
}> => {
  const { readyAt = 0, capturing = [], afterFirstFace = 0 } = held;
  const rampBox = held.rampBox ?? { x: 312, y: 300, width: 976, height: 240 };
  const start = Date.now();
  const met: Reading[] = [];
  const said: string[] = [];
  let moved = 0;
  let dark = false;
  let faceReads = 0;
  const top = (): number | null => {
    const at = scroll(Date.now() - start);
    return at === null ? null : at + moved;
  };
  const view = { width: 1600, height: 900 };
  const read = {
    view,
    box: { x: 312, y: 82, width: 976, height: 736 },
    fit: 1,
    standing: "welcome",
    settled: true,
    field: "still",
    covered: [],
    alert: null,
    words: [],
  };
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    ready: () => Date.now() - start >= readyAt,
    frames: () => [{ index: "01", preview: "welcome" }],
    dark: () => dark,
    turn: () => {
      dark = !dark;
      return true;
    },
    controls: () => [],
    show: () => true,
    face: () => {
      const seen = { ...read, top: top() };
      if (faceReads++ === 0) moved += afterFirstFace;
      return seen;
    },
    showRamp: () => true,
    ramp: () => ({ view, box: rampBox, chips: [] }),
    scrollTop: () => top(),
  };
  const win = {
    webContents: {
      // the walk's every call is `globalThis.__vfCatalog?.<call> ?? null`, answered by the page half's own names
      executeJavaScript: async (script: string): Promise<unknown> => {
        if (script === CATALOG_PAGE) return undefined;
        const call = /^globalThis\.__vfCatalog\?\.(.*) \?\? null$/su.exec(script)?.[1];
        if (call === undefined)
          throw new Error(`not one of the walk's calls: ${script.slice(0, 80)}`);
        return new Function("page", `return page.${call};`)(answers) ?? null;
      },
      capturePage: async () => {
        const capture = capturing[met.length] ?? {};
        met.push({ at: Date.now() - start, top: top() });
        moved += capture.move ?? 0;
        if (capture.fails === true) throw new Error("UnknownVizError");
        return { toJPEG: () => Buffer.alloc(0), toBitmap: () => Buffer.alloc(0) };
      },
    },
  };
  // the walk's stills land in a root of the test's own, removed when the test ends (item 153's harness)
  const walk = catalogRows({
    win: win as unknown as CatalogDriver["win"],
    shotDir: tempDir("vf-catalog-walk-"),
    say: (line) => said.push(line),
  });
  await vi.runAllTimersAsync();
  return { ...(await walk), met, said };
};

describe("the walk over a page held here, no Electron (item 264)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const movedLines = (problems: readonly string[]): string[] =>
    problems.filter((problem) => problem.includes("moved during the capture"));
  const stopped = (problems: readonly string[]): string[] =>
    problems.filter((problem) => problem.startsWith("the walk stopped"));

  it("captures nothing before the document has rested a whole second, over row 3c's measured load", async () => {
    // the walk ready 2,100 ms into the load: after Godview's Peek has moved the document (its last event at 2,074)
    // and before History's Peek does (called at 2,523), the window row 1's welcome still implies. Row 3c's own walk
    // was ready at about 2,507 (its first centring at 2,657).
    const { facts, met, problems, said } = await walkOver(row3cAt, { readyAt: 2100 });
    expect(met[0]?.top).toBe(77013.5);
    expect(met[0]?.at).toBeGreaterThanOrEqual(2639 + 1000);
    expect(facts["recaptured"]).toEqual([]);
    expect(movedLines(problems)).toEqual([]);
    // the margin line, one per theme: how long the wait took, how long the document had rested when it ended, where,
    // and how often it moved meanwhile (by day History's Peek, once; by night nothing)
    expect(said.filter((line) => line.startsWith("CATALOG_STILL "))).toEqual([
      'CATALOG_STILL day {"waitedMs":1400,"restedMs":1000,"top":77013.5,"moves":1}',
      'CATALOG_STILL night {"waitedMs":1000,"restedMs":1000,"top":77013.5,"moves":0}',
    ]);
  });

  it("walks the face a measured mover lands in again, once the document rests, never twice, over row 3c's load", async () => {
    // the walk ready 400 ms into the load: its wait passes on the rest at 0 (reading (a)), and Godview's Peek moves the
    // document inside the day face's bracket, 0 → 56149.5 (fd's F3). The face is walked again once the document has
    // rested a whole second (fd's F2); without that wait, its second capture comes in the rest between the two Peeks,
    // at 65825.5.
    const { facts, met, problems } = await walkOver(row3cAt, { readyAt: 400 });
    expect(facts["recaptured"]).toEqual(["day 01 welcome"]);
    expect(movedLines(problems)).toEqual([]);
    expect(met.map((capture) => capture.top)).toEqual([0, 56149.5, 77013.5, 77013.5, 77013.5]);
    expect(facts["captureFailures"]).toEqual([]);
    expect(stopped(problems)).toEqual([]);
  });

  it("names no re-walk and no failed capture on a still document: the record's lists are there, and empty", async () => {
    const { facts, met, problems } = await walkOver(() => 0);
    expect(facts["recaptured"]).toEqual([]);
    expect(facts["captureFailures"]).toEqual([]);
    // by day and by night, the ramp and the one face, each captured once
    expect(met).toHaveLength(4);
    expect(movedLines(problems)).toEqual([]);
  });

  it("walks a capture the document moved during again, once, and names it", async () => {
    const { facts, met, problems } = await walkOver(() => 0, { capturing: [{ move: 500 }] });
    expect(facts["recaptured"]).toEqual(["day text ramp"]);
    expect(met.map((capture) => capture.top)).toEqual([0, 500, 500, 500, 500]);
    expect(movedLines(problems)).toEqual([]);
  });

  it("sees a mover that lands in a face's settle, after its settled read, and walks the face again", async () => {
    // the document moves 300 px right after the day face's settled read: inside its 150 ms settle, before its capture
    const { facts, met, problems } = await walkOver(() => 0, { afterFirstFace: 300 });
    expect(facts["recaptured"]).toEqual(["day 01 welcome"]);
    expect(met.map((capture) => capture.top)).toEqual([0, 300, 300, 300, 300]);
    expect(movedLines(problems)).toEqual([]);
  });

  it("is red when the document moves during the capture walked again too, in the walk's words", async () => {
    const moved = await walkOver(() => 0, { capturing: [{ move: 500 }, { move: 500 }] });
    expect(moved.facts["recaptured"]).toEqual(["day text ramp"]);
    expect(movedLines(moved.problems)).toEqual([
      "on day text ramp the catalog's document moved during the capture (500 → 1000), twice",
    ]);
    // quoting what the capture threw, when the second failed as the document moved (fd's F1)
    const failed = await walkOver(() => 0, {
      capturing: [{ move: 500 }, { move: 500, fails: true }],
    });
    expect(movedLines(failed.problems)).toEqual([
      "on day text ramp the catalog's document moved during the capture (500 → 1000), twice; the capture failed: UnknownVizError",
    ]);
  });

  it("walks a face again when viz fails while the document moves, keeps every failure, and lets one on a still document stand", async () => {
    const moving = await walkOver(() => 0, { capturing: [{}, { move: 300, fails: true }] });
    expect(moving.facts["recaptured"]).toEqual(["day 01 welcome"]);
    expect(moving.facts["captureFailures"]).toEqual([
      { at: "day 01 welcome", before: 0, after: 300, error: "UnknownVizError" },
    ]);
    expect(stopped(moving.problems)).toEqual([]);
    const still = await walkOver(() => 0, { capturing: [{ fails: true }] });
    expect(still.facts["recaptured"]).toEqual([]);
    expect(still.facts["captureFailures"]).toEqual([
      { at: "day text ramp", before: 0, after: 0, error: "UnknownVizError" },
    ]);
    expect(still.problems.at(-1)).toBe("the walk stopped: UnknownVizError");
  });

  it("says a Text ramp that does not stand whole in the window, before a capture that fails on it stops the walk", async () => {
    // fd's F4: the ramp held to the window as each face is, its rect named
    const { problems } = await walkOver(() => 0, {
      rampBox: { x: 312, y: 800, width: 976, height: 240 },
      capturing: [{ fails: true }],
    });
    expect(problems.slice(-2)).toEqual([
      'by day the Text ramp does not stand whole in the window: its rect {"x":312,"y":800,"width":976,"height":240} in 1600 × 900',
      "the walk stopped: UnknownVizError",
    ]);
  });

  it("is red when the document never rests, with its last positions, and captures nothing", async () => {
    const { met, problems } = await walkOver((at) => (Math.floor(at / 100) % 2 === 0 ? 0 : 24.5));
    expect(met).toEqual([]);
    expect(problems.at(-1)).toMatch(
      /^the walk stopped: by day the catalog's document never stood still for 1000ms within 30000ms \(its last positions: [0-9., ]+\)$/u,
    );
  });
});
