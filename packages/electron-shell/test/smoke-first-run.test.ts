import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserWindow } from "electron";
import { describe, expect, it } from "vitest";
import {
  cancelClearOfFade,
  expectedLogoBox,
  type FaceSeen,
  FIRST_RUN,
  FIRST_RUN_MARK,
  FIRST_RUN_WALKS,
  type FirstRunRecord,
  type FrameSeen,
  firstRunContrast,
  firstRunGpu,
  firstRunRows,
  frameStats,
  type GpuSample,
  gpuOver,
  heard,
  type InksSeen,
  inkCuts,
  judgeBand,
  judgeFrame,
  judgeHandOver,
  judgeHolds,
  judgeLogo,
  judgeOpening,
  judgeRecorded,
  judgeSignIn,
  type LogoSeen,
  listFits,
  measureMark,
  parseGpuBusy,
  parseWalk,
  type SignInSeen,
  shotDirRefusal,
  splashLook,
  TEAR_NOT_OPEN,
  WALKED_FACES,
  type WordsSeen,
} from "../src/testing/smoke-first-run";
import type { StagedTypedAgent } from "../src/testing/typed-agent";
import { fakeElectron } from "./fake-electron";

// FG — the first-run smoke's judges (desk-gates row 32), its harness copy of the field's mark, and its launcher. The
// walk itself runs only on a host with a GPU and a window (the landing gate); what it judges, and how its launcher
// seeds and keeps each walk, holds here.

const here = dirname(fileURLToPath(import.meta.url));

describe("the harness's copy of the field's mark (FIRST_RUN_MARK)", () => {
  it("is field-mark.ts's FIELD_MARK and FIELD_STILLS, and logoBox's rule", () => {
    const source = readFileSync(
      resolve(here, "../../field-app/src/boot/splash/field-mark.ts"),
      "utf8",
    );
    const mark = /export const FIELD_MARK = \{ width: (\d+), height: (\d+) \} as const;/.exec(
      source,
    );
    expect(mark?.slice(1).map(Number)).toEqual([
      FIRST_RUN_MARK.mark.width,
      FIRST_RUN_MARK.mark.height,
    ]);
    for (const name of ["wide", "tall"] as const) {
      const still = new RegExp(
        `${name}: \\{ width: (\\d+), height: (\\d+), density: (\\d+) \\}`,
      ).exec(source);
      const want = FIRST_RUN_MARK.stills[name];
      expect(still?.slice(1).map(Number), name).toEqual([want.width, want.height, want.density]);
    }
    // the rule `expectedLogoBox` copies: the picture by the window's aspect, then a cover fit at its density
    expect(source).toContain("if (!still || width <= 0 || height <= 0) return FIELD_MARK;");
    expect(source).toContain("width / height > 1 ? FIELD_STILLS.wide : FIELD_STILLS.tall");
    expect(source).toContain(
      "Math.max(width / picture.width, height / picture.height) * picture.density",
    );
  });

  it("gives the mark on the live field, and the still's own mark cover-fitted over the still", () => {
    expect(expectedLogoBox(1180, 780, false)).toEqual({ width: 128, height: 77 });
    const wide = expectedLogoBox(1180, 780, true);
    expect(wide.width).toBeCloseTo(128 * (780 / 900), 6);
    expect(wide.height).toBeCloseTo(77 * (780 / 900), 6);
    expect(expectedLogoBox(780, 1688, true)).toEqual({ width: 256, height: 154 });
    // the tall still stands from an aspect of 1:1 down
    expect(expectedLogoBox(800, 800, true).width).toBeCloseTo(128 * (800 / 780) * 2, 6);
    expect(expectedLogoBox(0, 780, true)).toEqual({ width: 128, height: 77 });
  });
});

describe("the walks and where their stills may go", () => {
  it("names three walks: day and night on the live field, and the page with no WebGPU by day", () => {
    expect(FIRST_RUN_WALKS).toEqual({
      day: { dark: false, webgpu: true },
      night: { dark: true, webgpu: true },
      "no-webgpu": { dark: false, webgpu: false },
    });
    expect(["day", "night", "no-webgpu"].map(parseWalk)).toEqual(["day", "night", "no-webgpu"]);
    expect([undefined, "", "dusk", "toString"].map(parseWalk)).toEqual([null, null, null, null]);
  });

  it("refuses a folder a green run's teardown removes, and keeps any other", () => {
    expect(shotDirRefusal("/tmp/vf-smoke-k3/users/01J/shots")).toContain("vf-smoke-k3");
    expect(shotDirRefusal("/var/folders/x/T/vf-smoke-profile-a1/shots")).toContain(
      "vf-smoke-profile-a1",
    );
    expect(shotDirRefusal("/var/folders/x/T/vf-first-run-shots-a1/day")).toBeNull();
    expect(
      shotDirRefusal("/Volumes/SamsungRed/lanes/fg/logs/mini/run41/first-run/night"),
    ).toBeNull();
  });
});

const record = (faces: FaceSeen[], now = 100_000): FirstRunRecord => ({
  faces,
  progress: [],
  leaving: [],
  opening: [],
  tear: [],
  frames: { rest: null, tear: null },
  now,
  epoch: 1_790_000_000_000,
});

describe("the holds (FG-L5, FG-D20; DESIGN.md §6's floor)", () => {
  const line = (face: string, shownAt: number, leaveAt: number): FaceSeen => ({
    face,
    hold: "line",
    shownAt,
    fullAt: shownAt + 240,
    leaveAt,
    goneAt: leaveAt + 120,
    logo: "shown",
    glass: "field",
    lines: ["Looking for your agents…"],
  });

  it("passes a hold that stood its floor with the logo and one line, and leaves the panes alone", () => {
    const judged = judgeHolds(
      record([
        {
          face: "welcome",
          hold: "card",
          shownAt: 10,
          fullAt: 250,
          leaveAt: 3_000,
          logo: "shown",
          lines: [],
        },
        { face: "field", hold: null, shownAt: 3_200, fullAt: 3_440 },
        line("agents:looking", 4_000, 4_820),
        // two frames short at the two ends of its sampling is the floor still
        line("history:looking", 6_000, 6_766),
      ]),
    );
    expect(judged.problems).toEqual([]);
    expect(judged.held).toEqual([
      "welcome 2990ms",
      "agents:looking 820ms",
      "history:looking 766ms",
    ]);
  });

  it("finds a hold that left before its floor, one without the logo, and one that said two lines", () => {
    const short = judgeHolds(record([line("agents:looking", 4_000, 4_400)]));
    expect(short.problems).toEqual([
      'the hold "agents:looking" stood 400ms from its fade in, under the floor\'s 800',
    ]);
    expect(judgeHolds(record([line("x", 0, 765)])).problems).toHaveLength(1);
    const bare = judgeHolds(record([{ ...line("connect:asking", 0, 900), logo: null }]));
    expect(bare.problems).toEqual(['the hold "connect:asking" stood without the logo']);
    const two = judgeHolds(record([{ ...line("deriving", 0, 900), lines: ["One.", "Two."] }]));
    expect(two.problems).toEqual(['the hold "deriving" said ["One.","Two."], not one line']);
  });

  it("holds a hold whose fade in began to its floor though it never came whole, and skips one never shown", () => {
    const begun: FaceSeen = { face: "agents:looking", hold: "line", shownAt: 1_000, goneAt: 1_500 };
    expect(judgeHolds(record([begun])).problems).toEqual([
      'the hold "agents:looking" stood 500ms from its fade in, under the floor\'s 800',
    ]);
    expect(judgeHolds(record([{ ...begun, goneAt: 1_900 }])).problems).toEqual([]);
    const never: FaceSeen = { face: "history:looking", hold: "line", goneAt: 2_000 };
    expect(judgeHolds(record([never]))).toEqual({ held: [], problems: [] });
    // still standing when the walk read it: measured to the reading
    expect(judgeHolds(record([{ face: "x", hold: "line", shownAt: 99_500 }])).held).toEqual([
      "x 500ms",
    ]);
  });

  it("says the recorder lost the walk when a face the walk stood on was never seen to show", () => {
    const shown = WALKED_FACES.map((face): FaceSeen => ({ face, hold: null, shownAt: 1 }));
    expect(judgeRecorded(record(shown))).toEqual([]);
    const lost = judgeRecorded(
      record(
        shown
          .filter((f) => f.face !== "history")
          .map((f) => (f.face === "profiles" ? { face: f.face, hold: null } : f)),
      ),
    );
    expect(lost).toEqual([
      "the page's recorder never saw profiles, history show: it lost the walk",
    ]);
  });
});

describe("the band (FG-D22 A): Setting up's segment", () => {
  it("advances with the boot's progress and stands full", () => {
    expect(
      judgeBand([
        [0, 0],
        [400, 0.3],
        [900, 1],
      ]),
    ).toEqual([]);
    expect(judgeBand([])).toEqual(["Setting up's segment never carried the boot's progress"]);
    expect(judgeBand([[0, 1]])).toEqual(["Setting up's segment never advanced: it began full"]);
    expect(
      judgeBand([
        [0, 0],
        [10, 0.5],
      ]),
    ).toEqual(["Setting up's segment never came full (it reached 0.500)"]);
    expect(
      judgeBand([
        [0, 0],
        [10, 1],
        [20, 0.4],
      ]),
    ).toEqual(["Setting up's segment came full, then fell to 0.400"]);
  });
});

describe("the hand-over (FG-5; DESIGN.md §6)", () => {
  it("passes the glass's words and then its clearing, each once, however long or short each stood", () => {
    expect(
      judgeHandOver([
        [61_200, "words"],
        [62_080, "clear"],
      ]),
    ).toEqual([]);
    // a loaded host's pace is no step of its own: order alone is judged
    expect(
      judgeHandOver([
        [61_200, "words"],
        [61_201, "clear"],
      ]),
    ).toEqual([]);
    expect(
      judgeHandOver([
        [61_200, "words"],
        [64_000, "clear"],
      ]),
    ).toEqual([]);
    // a step heard twice over is one step
    expect(
      judgeHandOver([
        [61_200, "words"],
        [61_300, "words"],
        [62_080, "clear"],
      ]),
    ).toEqual([]);
  });

  it("finds a glass that never stepped out, never cleared, cleared first, or stepped back", () => {
    expect(judgeHandOver([])).toEqual(["the glass never stepped out: no hand-over was heard"]);
    expect(judgeHandOver([[61_200, "words"]])).toEqual([
      'the glass stepped out ["words"], not its words and then its clearing',
    ]);
    expect(judgeHandOver([[61_200, "clear"]])).toEqual([
      'the glass stepped out ["clear"], not its words and then its clearing',
    ]);
    expect(
      judgeHandOver([
        [61_200, "clear"],
        [62_080, "words"],
      ]),
    ).toEqual(['the glass stepped out ["clear","words"], not its words and then its clearing']);
    expect(
      judgeHandOver([
        [61_200, "words"],
        [62_080, "clear"],
        [62_300, "words"],
      ]),
    ).toEqual([
      'the glass stepped out ["words","clear","words"], not its words and then its clearing',
    ]);
    expect(
      judgeHandOver([
        [61_200, "words"],
        [61_500, null],
        [62_080, "clear"],
      ]),
    ).toEqual([
      'the glass stepped out ["words",null,"clear"], not its words and then its clearing',
    ]);
  });
});

describe("the opening (FG-6c; DESIGN.md §6)", () => {
  const live = FIRST_RUN_WALKS.day;
  const still = FIRST_RUN_WALKS["no-webgpu"];

  it("knows every state FieldLayer.tsx's TearState names: tearing, open, and each way of not opening", () => {
    const source = readFileSync(resolve(here, "../../field-app/src/boot/FieldLayer.tsx"), "utf8");
    const union = /export type TearState = ((?:"[a-z]+"(?: \| )?)+);/.exec(source)?.[1];
    const states = [...(union ?? "").matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
    expect(states.sort()).toEqual(["tearing", "open", ...Object.keys(TEAR_NOT_OPEN)].sort());
  });

  it("hears each change once: a value set twice over is one", () => {
    expect(
      heard([
        [1, "tearing"],
        [2, "tearing"],
        [3, "open"],
      ]),
    ).toEqual(["tearing", "open"]);
    expect(heard([])).toEqual([]);
  });

  it("passes the live field opened by its tear, tearing and then open, however long the tear took", () => {
    expect(
      judgeOpening(
        live,
        [[63_100, "tear"]],
        [
          [63_700, "tearing"],
          [65_600, "open"],
        ],
      ),
    ).toEqual([]);
    // a loaded host's pace is no step of its own, and a value heard twice over is one
    expect(
      judgeOpening(
        FIRST_RUN_WALKS.night,
        [
          [63_100, "tear"],
          [63_101, "tear"],
        ],
        [
          [63_700, "tearing"],
          [66_500, "open"],
        ],
      ),
    ).toEqual([]);
  });

  it("passes the still opened by the fade, with nothing torn", () => {
    expect(judgeOpening(still, [[63_100, "fade"]], [])).toEqual([]);
  });

  it("finds a tear that did not open, in its own words: its bound, a lost device, or its reveal cut", () => {
    const opened: FirstRunRecord["opening"] = [[63_100, "tear"]];
    expect(
      judgeOpening(live, opened, [
        [63_700, "tearing"],
        [66_600, "bound"],
      ]),
    ).toEqual([
      "the tear did not open: bound, its bound passed first, so its frames came late or never",
    ]);
    expect(
      judgeOpening(live, opened, [
        [63_700, "tearing"],
        [63_710, "lost"],
      ]),
    ).toEqual(["the tear did not open: lost, its reveal failed (a lost device)"]);
    expect(
      judgeOpening(live, opened, [
        [63_700, "tearing"],
        [63_710, "cut"],
      ]),
    ).toEqual(["the tear did not open: cut, its reveal ended before the window opened"]);
  });

  it("finds the live field never opened, opened by the fade, never torn, still tearing, or torn out of order", () => {
    expect(judgeOpening(live, [], [])).toEqual([
      "the ground never opened: no opening was heard",
      "the field never tore: no tear was heard",
    ]);
    expect(judgeOpening(live, [[63_100, "fade"]], [])).toEqual([
      'the ground opened ["fade"], not by the tear',
      "the field never tore: no tear was heard",
    ]);
    expect(judgeOpening(live, [[63_100, "tear"]], [[63_700, "tearing"]])).toEqual([
      'the tear went ["tearing"], not tearing and then open',
    ]);
    expect(judgeOpening(live, [[63_100, "tear"]], [[63_700, "open"]])).toEqual([
      'the tear went ["open"], not tearing and then open',
    ]);
    expect(
      judgeOpening(
        live,
        [
          [63_100, "tear"],
          [63_200, "fade"],
        ],
        [
          [63_700, "tearing"],
          [65_600, "open"],
        ],
      ),
    ).toEqual(['the ground opened ["tear","fade"], not by the tear']);
  });

  it("finds the still opened by the tear, or torn", () => {
    expect(judgeOpening(still, [[63_100, "tear"]], [])).toEqual([
      'the ground opened ["tear"], not by the fade',
    ]);
    expect(
      judgeOpening(
        still,
        [[63_100, "fade"]],
        [
          [63_700, "tearing"],
          [65_600, "open"],
        ],
      ),
    ).toEqual(['over the still the field tore: ["tearing","open"]']);
  });
});

describe("FG-O3's read (FG-6c; printed, never judged)", () => {
  it("gives a stretch of frame intervals as its count, its median, its 95th by nearest rank and its most", () => {
    expect(frameStats(null)).toBeNull();
    expect(frameStats([])).toBeNull();
    expect(frameStats([16.7])).toEqual({ n: 1, p50: 16.7, p95: 16.7, max: 16.7 });
    const intervals = [...Array.from({ length: 19 }, () => 16.7), 41.23];
    expect(frameStats(intervals)).toEqual({ n: 20, p50: 16.7, p95: 16.7, max: 41.2 });
    expect(frameStats([33.4, 16.6, 16.8, 16.7])).toEqual({ n: 4, p50: 16.7, p95: 33.4, max: 33.4 });
  });

  const reading = (
    at: number,
    cpuSeconds: number | null,
    cpuPercent: number | null,
    busy: number | null,
  ): GpuSample => ({
    at,
    cpuSeconds,
    cpuPercent,
    busy,
  });

  it("reads the GPU process's CPU over a stretch from its seconds, and the GPU's busy share from its readings", () => {
    const samples = [
      reading(900, 9.9, 10, 12),
      reading(1_000, 10, 20, 30),
      reading(1_100, 10.05, 50, 50),
      reading(1_200, 10.1, 50, 70),
      reading(1_300, 11, 900, 0),
    ];
    // 0.1 s of CPU over 0.2 s of the wall: 50% of one core; the readings outside the stretch are not its own
    expect(gpuOver(samples, 1_000, 1_200)).toEqual({
      n: 3,
      cpu: 50,
      busy: { mean: 50, max: 70 },
    });
  });

  it("falls back to the percents after its first reading where Electron gives no seconds, and says what was not read", () => {
    const samples = [
      reading(1_000, null, 99, null),
      reading(1_100, null, 20, null),
      reading(1_200, null, 30, null),
    ];
    expect(gpuOver(samples, 1_000, 1_200)).toEqual({ n: 3, cpu: 25, busy: null });
    expect(
      gpuOver([reading(1_000, null, null, null), reading(1_100, null, null, null)], 0, 2_000),
    ).toEqual({
      n: 2,
      cpu: null,
      busy: null,
    });
  });

  it("reads nothing over a stretch with fewer than two readings", () => {
    expect(gpuOver([], 0, 1_000)).toBeNull();
    expect(gpuOver([reading(500, 1, 10, 10)], 0, 1_000)).toBeNull();
  });

  it("sets the page's moments beside main's readings by the wall's clock: the stretch before the hand-over, and the tear's", () => {
    // the page's clock at 70,000 read with the wall's at 1,790,000,070,000: the page's ms t is the wall's
    // 1,790,000,000,000 + t
    const wall = (ms: number): number => 1_790_000_000_000 + ms;
    const page: FirstRunRecord = {
      ...record([], 70_000),
      epoch: wall(70_000),
      leaving: [
        [61_200, "words"],
        [62_080, "clear"],
      ],
      opening: [[61_200, "tear"]],
      tear: [
        [62_680, "tearing"],
        [64_580, "open"],
      ],
      frames: { rest: [16.7, 16.7, 16.6], tear: [16.7, 33.4, 16.6, 16.8] },
    };
    const samples = [
      reading(wall(59_200), 1, 0, 10), // before the stretch before the hand-over
      reading(wall(59_400), 2, 0, 20),
      reading(wall(61_200), 2.36, 0, 30), // 0.36 s over 1.8 s: 20%
      reading(wall(62_680), 3, 0, 40),
      reading(wall(63_630), 3.38, 0, 60),
      reading(wall(64_580), 3.76, 0, 80), // 0.76 s over 1.9 s: 40%
      reading(wall(65_000), 9, 0, 0), // after the tear
    ];
    expect(firstRunGpu(page, samples)).toEqual({
      frames: {
        rest: { n: 3, p50: 16.7, p95: 16.7, max: 16.7 },
        tear: { n: 4, p50: 16.7, p95: 33.4, max: 33.4 },
      },
      load: {
        rest: { n: 2, cpu: 20, busy: { mean: 25, max: 30 } },
        tear: { n: 3, cpu: 40, busy: { mean: 60, max: 80 } },
      },
      readings: 7,
      busy: "read",
    });
    expect(FIRST_RUN.restMs).toBe(1_900);
  });

  it("reads no tear where none was heard, and says the busy share was not read where the host gave none", () => {
    const page: FirstRunRecord = {
      ...record([], 70_000),
      epoch: 1_790_000_070_000,
      leaving: [[61_200, "words"]],
      opening: [[61_200, "fade"]],
      frames: { rest: [16.7], tear: null },
    };
    const gpu = firstRunGpu(page, [
      reading(1_790_000_060_000, 1, 0, null),
      reading(1_790_000_061_000, 1.1, 0, null),
    ]);
    expect(gpu.frames.tear).toBeNull();
    expect(gpu.load.tear).toBeNull();
    expect(gpu.load.rest).toEqual({ n: 2, cpu: 10, busy: null });
    expect(gpu.busy).toBe("not read");
    expect(firstRunGpu(record([]), []).load).toEqual({ rest: null, tear: null });
  });

  it("finds the GPU's busy share in ioreg's reading of IOAccelerator, the busiest's where there are several", () => {
    const agx =
      '+-o AGXAcceleratorG13X  <class AGXAcceleratorG13X>\n    | "PerformanceStatistics" = {"Tiler Utilization %"=23,"Renderer Utilization %"=22,"Device Utilization %"=23}\n';
    expect(parseGpuBusy(agx)).toBe(23);
    expect(parseGpuBusy(`${agx}${agx.replace("=23}", "=71}")}`)).toBe(71);
    expect(parseGpuBusy("+-o IntelAccelerator\n")).toBeNull();
    expect(parseGpuBusy("")).toBeNull();
  });
});

/** A block of ink over CSS px [x0, x1) × [y0, y1). */
interface InkBlock {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly level: number;
}

/** A capture `width` × `height` CSS px at `density`, one grey, with blocks of ink on it. */
function capture(
  width: number,
  height: number,
  density: number,
  glass: number,
  ink: InkBlock | readonly InkBlock[] | null,
): Uint8Array {
  const blocks: readonly InkBlock[] = ink === null ? [] : "level" in ink ? [ink] : ink;
  const w = width * density;
  const h = height * density;
  const bgra = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const block = blocks.find(
        (b) =>
          x >= b.x0 * density && x < b.x1 * density && y >= b.y0 * density && y < b.y1 * density,
      );
      const level = block?.level ?? glass;
      bgra.set([level, level, level, 255], (y * w + x) * 4);
    }
  }
  return bgra;
}

describe("FG-O2's contrast (printed, not judged yet)", () => {
  const words = (
    x: number,
    y: number,
    width: number,
    height: number,
    text = "",
    shown = 1,
  ): WordsSeen => ({
    x,
    y,
    width,
    height,
    text,
    shown,
  });
  const seen = (over: Partial<InksSeen> = {}): InksSeen => ({
    view: { width: 60, height: 30 },
    wizard: false,
    field: "live",
    canvas: 1,
    stage: null,
    steps: [],
    later: null,
    sub: null,
    ...over,
  });

  it("takes the splash's still on the field that has come, keeps one on a field still waking, and stops at the wizard", () => {
    const stage = words(20, 20, 10, 5, "loading the field");
    expect(splashLook(null)).toBe("stop");
    expect(splashLook(seen({ stage, wizard: true }))).toBe("stop");
    expect(splashLook(seen())).toBe("wait");
    expect(splashLook(seen({ stage: { ...stage, shown: 0.5 } }))).toBe("wait");
    expect(splashLook(seen({ stage, field: "waking", canvas: 0 }))).toBe("keep");
    // the live field fading in over its still (500ms)
    expect(splashLook(seen({ stage, canvas: 0.6 }))).toBe("keep");
    expect(splashLook(seen({ stage }))).toBe("take");
    expect(splashLook(seen({ stage, field: "still", canvas: null }))).toBe("take");
  });

  it("cuts each of the small words from its still, and prints its ground, its ink and their WCAG ratio", () => {
    // a window 60 × 30 at 2 to the px on a glass of 200: the stage line's glyph cores at 40, a label's at 120 and the
    // line under the actions' at 90
    const still = capture(60, 30, 2, 200, [
      { x0: 22, x1: 24, y0: 21, y1: 23, level: 40 },
      { x0: 2, x1: 3, y0: 2, y1: 3, level: 120 },
      { x0: 32, x1: 33, y0: 12, y1: 13, level: 90 },
    ]);
    const splash = seen({ stage: words(20, 20, 10, 5, "loading the field") });
    const connect = seen({
      steps: [
        { step: "you", state: "done", words: words(0, 0, 10, 5, "You") },
        { step: "devices", state: "now", words: null },
      ],
      later: words(30, 10, 10, 5, "Set up later — Settings → Devices", 0.98),
      sub: words(0, 0, 10, 5, "not asked of this still"),
    });
    const cuts = [
      ...inkCuts("01-splash.png", still, splash, ["stage"]),
      ...inkCuts("11-connect.png", still, connect, ["steps", "later"]),
    ];
    const glass = [200, 200, 200];
    expect(firstRunContrast(cuts)).toEqual({
      stage: {
        at: "01-splash.png",
        said: "loading the field",
        field: "live",
        canvas: 1,
        ground: glass,
        ink: [40, 40, 40],
        ratio: 8.8,
        shown: 1,
      },
      steps: {
        at: "11-connect.png",
        you: { state: "done", ground: glass, ink: [120, 120, 120], ratio: 2.6, shown: 1 },
      },
      later: { at: "11-connect.png", ground: glass, ink: [90, 90, 90], ratio: 4.1, shown: 0.98 },
      sub: null,
    });
  });

  it("says what it could not read: words never seen are null, and a capture not the window's size reads nothing", () => {
    expect(firstRunContrast([])).toEqual({ stage: null, steps: null, later: null, sub: null });
    const odd = inkCuts(
      "13-setting-up-welcome.png",
      new Uint8Array(4 * 7),
      seen({ sub: words(0, 0, 10, 5) }),
      ["sub"],
    );
    expect(firstRunContrast(odd).sub).toEqual({
      at: "13-setting-up-welcome.png",
      ground: null,
      ink: null,
      ratio: null,
      shown: 1,
    });
  });
});

describe("the mark in the pixels (measureMark)", () => {
  it("finds the ink against its glass, centred in CSS px at any density", () => {
    for (const density of [1, 2]) {
      const seen = measureMark(
        capture(40, 30, density, 230, { x0: 15, x1: 25, y0: 10, y1: 20, level: 40 }),
        40,
        30,
      );
      expect(seen?.glass).toBe(230);
      expect(seen?.ink).toBe(40);
      expect(seen?.count).toBe(100 * density * density);
      expect(seen?.at.x).toBeCloseTo(20, 6);
      expect(seen?.at.y).toBeCloseTo(15, 6);
    }
  });

  it("centres the ink by its extent, never its weight: a mark heavier on one side stands where it is drawn (row 32 at run52b)", () => {
    // the field's mark carries more ink in its right lobe: run52b's day mark had 417 of its 657 ink px right of the
    // window's centre, its extent centred within 1 px and its mean 10 px right
    for (const density of [1, 2]) {
      const seen = measureMark(
        capture(40, 30, density, 230, [
          { x0: 10, x1: 12, y0: 10, y1: 20, level: 40 },
          { x0: 24, x1: 30, y0: 10, y1: 20, level: 40 },
        ]),
        40,
        30,
      );
      expect(seen?.count).toBe(80 * density * density);
      expect(seen?.at.x).toBeCloseTo(20, 6);
      expect(seen?.at.y).toBeCloseTo(15, 6);
    }
    // a mark drawn off its place is off by its extent too
    const off = measureMark(
      capture(40, 30, 1, 230, { x0: 18, x1: 30, y0: 10, y1: 20, level: 40 }),
      40,
      30,
    );
    expect(off?.at.x).toBeCloseTo(24, 6);
  });

  it("says no ink on a plain glass, and no picture for a buffer of another size", () => {
    expect(measureMark(capture(40, 30, 2, 230, null), 40, 30)?.count).toBe(0);
    expect(measureMark(new Uint8Array(4 * 80 * 60 - 4), 40, 30)).toBeNull();
    expect(measureMark(new Uint8Array(0), 40, 30)).toBeNull();
  });
});

describe("the logo at the welcome's title card (FG-4b, FG-D24)", () => {
  const viewport = { width: 1180, height: 780 };
  const centred = (width: number, height: number) => ({
    x: 590 - width / 2,
    y: 390 - height / 2,
    width,
    height,
  });
  const live: LogoSeen = {
    shown: "shown",
    glass: "field",
    level: 1,
    visibility: "hidden",
    box: centred(128, 77),
    viewport,
    dark: false,
  };
  const day = { glass: 230, ink: 60, count: 500, at: { x: 590, y: 390 } };
  const night = { glass: 40, ink: 230, count: 500, at: { x: 590.5, y: 389 } };

  it("passes the field's own mark by day and by night, and the page's over the still", () => {
    expect(judgeLogo(live, FIRST_RUN_WALKS.day, day)).toEqual([]);
    expect(judgeLogo({ ...live, dark: true }, FIRST_RUN_WALKS.night, night)).toEqual([]);
    const still = expectedLogoBox(1180, 780, true);
    expect(
      judgeLogo(
        { ...live, glass: null, visibility: "visible", box: centred(still.width, still.height) },
        FIRST_RUN_WALKS["no-webgpu"],
        day,
      ),
    ).toEqual([]);
  });

  it("finds the logo the page drew over the live field, a box off its centre or size, and the wrong theme", () => {
    expect(
      judgeLogo({ ...live, glass: null, visibility: "visible" }, FIRST_RUN_WALKS.day, day),
    ).toEqual([
      "on the live field the glass is not the field's (data-glass)",
      "on the live field the page's own logo is not hidden",
    ]);
    expect(
      judgeLogo({ ...live, box: { ...live.box, x: live.box.x + 3 } }, FIRST_RUN_WALKS.day, day),
    ).toEqual(["the logo's box centres at 593.0, 390.0, not the window's 590, 390"]);
    expect(judgeLogo({ ...live, box: centred(110.9, 66.7) }, FIRST_RUN_WALKS.day, day)).toEqual([
      "the logo's box is 110.9 × 66.7, not the mark's 128.0 × 77.0",
    ]);
    expect(judgeLogo({ ...live, shown: null }, FIRST_RUN_WALKS.day, day)).toEqual([
      "the welcome stood without the logo (data-logo)",
    ]);
    expect(judgeLogo(live, FIRST_RUN_WALKS.night, night)).toEqual([
      "the page wears the light theme, not the walk's",
    ]);
  });

  it("finds a mark the pixels lack, off its centre, or in the wrong ink", () => {
    expect(judgeLogo(live, FIRST_RUN_WALKS.day, null)).toEqual([
      "no mark in the pixels around the logo's box",
    ]);
    expect(judgeLogo(live, FIRST_RUN_WALKS.day, { ...day, count: 0 })).toEqual([
      "no mark in the pixels around the logo's box",
    ]);
    expect(judgeLogo(live, FIRST_RUN_WALKS.day, { ...day, at: { x: 590, y: 396 } })).toEqual([
      "the mark's ink centres at 590.0, 396.0, not the window's 590, 390",
    ]);
    expect(judgeLogo(live, FIRST_RUN_WALKS.day, { ...day, ink: 220 })).toEqual([
      "by day the mark (220) is not inverted on its milk (230)",
    ]);
    expect(
      judgeLogo({ ...live, dark: true }, FIRST_RUN_WALKS.night, { ...night, ink: 50 }),
    ).toEqual(["by night the mark (50) is not white on its glass (40)"]);
  });
});

describe("the frame (FG-4a, FG-L3)", () => {
  const agents: FrameSeen = {
    fit: 1,
    frame: { x: 310, y: 138, width: 560, height: 504 },
    head: { x: 330, y: 158, width: 520, height: 80 },
    foot: { x: 330, y: 562, width: 520, height: 60 },
    primary: { x: 700, y: 572, width: 120, height: 36, label: "Continue" },
    scroller: {
      x: 330,
      y: 250,
      width: 520,
      height: 300,
      scrollHeight: 520,
      clientHeight: 300,
      scrollTop: 0,
      mask: "linear-gradient(black calc(100% - 20px), transparent)",
    },
  };
  const scrolled = (seen: FrameSeen): FrameSeen =>
    seen.scroller === null ? seen : { ...seen, scroller: { ...seen.scroller, scrollTop: 220 } };

  it("passes a list that scrolls within itself under its fade while the frame's parts stand", () => {
    expect(judgeFrame("Agents", agents, scrolled(agents))).toEqual([]);
    // the glass fitted at 0.9 (FG-L2): the frame and its parts drawn at 0.9 of the glass's own px
    const fitted: FrameSeen = {
      ...agents,
      fit: 0.9,
      frame: { x: 338, y: 163.2, width: 504, height: 453.6 },
      head: { x: 356, y: 181.2, width: 468, height: 72 },
      foot: { x: 356, y: 541.2, width: 468, height: 54 },
      primary: { x: 689, y: 550.2, width: 108, height: 32.4, label: "Continue" },
    };
    expect(judgeFrame("Agents", fitted, scrolled(fitted))).toEqual([]);
  });

  it("declares a list that fits its body, with its numbers, and still holds its fade and the frame's parts (row 32 at run52b)", () => {
    // two ready and More's seven in two columns fit the glass's body: the glass is one picture at every window size,
    // so no window makes the list outgrow it
    const fits: FrameSeen = {
      ...agents,
      scroller: agents.scroller && { ...agents.scroller, scrollHeight: 296 },
    };
    expect(judgeFrame("Agents", fits, fits)).toEqual([]);
    expect(listFits("Agents", fits)).toBe(
      "Agents: the list fits its body (296 in 300), so the row witnesses no scroll: the glass is one picture at every window size, and only a longer list outgrows it",
    );
    // the page's own px of slack: one more fits, two more outgrow and are judged
    const brim = (scrollHeight: number): FrameSeen => ({
      ...agents,
      scroller: agents.scroller && { ...agents.scroller, scrollHeight },
    });
    expect(listFits("Agents", brim(301))).not.toBeNull();
    expect(listFits("Agents", brim(302))).toBeNull();
    expect(judgeFrame("Agents", brim(302), brim(302))).toEqual([
      "Agents: the list did not scroll within itself",
    ]);
    expect(listFits("Agents", agents)).toBeNull();
    expect(listFits("Agents", { ...agents, scroller: null })).toBeNull();
    const bare = { ...fits, scroller: fits.scroller && { ...fits.scroller, mask: "none" } };
    expect(judgeFrame("Agents", bare, bare)).toEqual(["Agents: the list has no fade (mask none)"]);
    const out = {
      ...fits,
      primary: { x: 700, y: 640, width: 120, height: 36, label: "Continue" },
    };
    expect(judgeFrame("Agents", out, out)).toEqual([
      "Agents: the primary action stands outside the frame",
    ]);
  });

  it("finds a body with no list that scrolls, a list with no fade or that does not scroll, and parts that move or stand outside", () => {
    expect(judgeFrame("Agents", { ...agents, scroller: null }, agents)).toEqual([
      "Agents: no list in its body scrolls within itself",
    ]);
    const bare = { ...agents, scroller: agents.scroller && { ...agents.scroller, mask: "none" } };
    expect(judgeFrame("Agents", bare, scrolled(bare))).toEqual([
      "Agents: the list has no fade (mask none)",
    ]);
    expect(judgeFrame("Agents", agents, agents)).toEqual([
      "Agents: the list did not scroll within itself",
    ]);
    const moved = { ...scrolled(agents), head: { ...agents.head, y: 150 } } as FrameSeen;
    expect(judgeFrame("Agents", agents, moved)).toEqual([
      "Agents: the head moved with the list's scroll",
    ]);
    const out = {
      ...agents,
      primary: { x: 700, y: 640, width: 120, height: 36, label: "Continue" },
    };
    expect(judgeFrame("Agents", out, scrolled(out))).toEqual([
      "Agents: the primary action stands outside the frame",
    ]);
    expect(
      judgeFrame(
        "Agents",
        { ...agents, frame: { ...agents.frame, height: 560 } },
        scrolled(agents),
      )[0],
    ).toBe("Agents: the frame is 560.0 × 560.0, not 560 × 504 at the glass's fit 1.000");
  });

  const body = { x: 340, y: 270, width: 500, height: 170 };
  const cancel = { x: 760, y: 470, width: 80, height: 30, label: "Cancel" };
  const signIn: SignInSeen = {
    fit: 1,
    frame: agents.frame,
    body,
    cancel,
    cancelHit: true,
    scroller: { x: 330, y: 250, width: 520, height: 300 },
  };

  it("passes a login's terminal 170 tall with Cancel in view above the fade, and finds one that is not", () => {
    expect(judgeSignIn(signIn)).toEqual([]);
    expect(judgeSignIn({ ...signIn, body: { ...body, height: 160 } })).toEqual([
      "the login's terminal is 160.0 tall, not 170",
    ]);
    expect(judgeSignIn({ ...signIn, cancelHit: false })).toEqual([
      "a press at the login's Cancel does not reach it",
    ]);
    expect(judgeSignIn({ ...signIn, cancel: null })).toEqual(["the login has no Cancel"]);
  });

  it("says what it saw when Cancel stands under the list's fade: Cancel's box, the list's, the fade's top and how far under (row 32 at run53b)", () => {
    // its foot in the list's last 20 px, under the fade
    expect(judgeSignIn({ ...signIn, cancel: { ...cancel, y: 515 } })).toEqual([
      "the login's Cancel is not in view above the list's fade: Cancel at 760.0, 515.0, 80.0 × 30.0, the list at 330.0, 250.0, 520.0 × 300.0, its fade's top at 530.0: Cancel's foot 15.0 under it",
    ]);
    // row 32 at run53b: the add holding the login was taller than the list keeps above its fade, so a scroll by
    // `nearest` set its head on the list's top and left Cancel's foot 1.3 under the fade's top
    expect(
      judgeSignIn({
        ...signIn,
        cancel: { ...cancel, y: 490.3, height: 36 },
        scroller: { x: 300, y: 246.8, width: 580, height: 298.2 },
      }),
    ).toEqual([
      "the login's Cancel is not in view above the list's fade: Cancel at 760.0, 490.3, 80.0 × 36.0, the list at 300.0, 246.8, 580.0 × 298.2, its fade's top at 525.0: Cancel's foot 1.3 under it",
    ]);
    // a foot within half a px of the fade's top stands clear of it
    expect(judgeSignIn({ ...signIn, cancel: { ...cancel, y: 500.4 } })).toEqual([]);
    // the walk's facts carry how far it stands clear
    expect(cancelClearOfFade(signIn)).toBe(30);
    expect(cancelClearOfFade({ ...signIn, cancel: { ...cancel, y: 515 } })).toBe(-15);
    expect(cancelClearOfFade({ ...signIn, scroller: null })).toBeNull();
  });
});

describe("a walk that stops (firstRunRows)", () => {
  it("says every problem it found before its stop, the stop last, and reads nothing after the walk (row 32 at run52b)", async () => {
    // a window the walk drives with no Electron: the welcome stands with its logo whole on the day's milk, the mark
    // drawn 10 px right of the window's centre, and the next pane's read rejects, as a renderer gone would
    const viewport = { width: 1180, height: 748 };
    const size = expectedLogoBox(viewport.width, viewport.height, false);
    const logo: LogoSeen = {
      shown: "shown",
      glass: "field",
      level: 1,
      visibility: "hidden",
      box: { x: 590 - size.width / 2, y: 374 - size.height / 2, ...size },
      viewport,
      dark: false,
    };
    const calls: string[] = [];
    let standing = 0;
    const answer = (call: string): unknown => {
      calls.push(call);
      if (call.includes("standing()")) {
        standing += 1;
        if (standing > 1) throw new Error("the renderer went away");
        return "welcome";
      }
      if (call.includes("logo()")) return logo;
      if (call.includes("target(")) return { hit: true, x: 590, y: 600 };
      return null;
    };
    const image = (rect?: { x: number; y: number; width: number; height: number }) => ({
      toPNG: () => Buffer.alloc(0),
      toBitmap: () =>
        Buffer.from(
          rect === undefined
            ? new Uint8Array(4)
            : capture(rect.width, rect.height, 1, 230, {
                x0: 600 - rect.x - 10,
                x1: 600 - rect.x + 10,
                y0: 374 - rect.y - 10,
                y1: 374 - rect.y + 10,
                level: 40,
              }),
        ),
    });
    const win = {
      loadURL: async () => undefined,
      isDestroyed: () => false,
      capturePage: async (rect?: { x: number; y: number; width: number; height: number }) =>
        image(rect),
      webContents: {
        debugger: { attach: () => undefined, sendCommand: async () => ({}) },
        executeJavaScript: async (code: string) => answer(code),
        sendInputEvent: () => undefined,
      },
    } as unknown as BrowserWindow;
    const shotDir = mkdtempSync(join(tmpdir(), "fg-walk-stops-"));
    const said: string[] = [];
    try {
      const { facts, problems } = await firstRunRows({
        win,
        viteUrl: "http://127.0.0.1:5173/",
        walk: "day",
        shotDir,
        staged: {} as StagedTypedAgent,
        users: { root: shotDir, userId: "ada" },
        say: (line) => said.push(line),
      });
      expect(problems).toEqual([
        "the mark's ink centres at 600.0, 374.0, not the window's 590, 374",
        "the walk stopped at you: the renderer went away",
      ]);
      expect(facts["stoppedAt"]).toBe("you");
      // the still of where it stood, and no read after the walk: the recorder, the holds, the band, users.json
      expect(facts["shots"]).toEqual([
        "01-welcome.png",
        "02-welcome-logo.png",
        "03-at-failure.png",
      ]);
      expect(calls.some((call) => call.includes("read()"))).toBe(false);
      expect(said.at(-1)).toBe("SMOKE_FIRST_RUN_STEP day you");
    } finally {
      rmSync(shotDir, { recursive: true, force: true });
    }
  });
});

describe("the launcher (apps/desktop/packaging/run-first-run.mjs)", () => {
  const desktopRoot = resolve(here, "../../../apps/desktop");
  const launcher = join(desktopRoot, "packaging", "run-first-run.mjs");
  // a stand-in Electron that records what it was handed, the theme its profile held at its boot, and exits red for the
  // walk FIRST_RUN_RED names
  const STAND_IN =
    `const fs = require("node:fs");\n` +
    `const path = require("node:path");\n` +
    `const userData = process.argv.find((a) => a.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);\n` +
    `let theme = null;\n` +
    `try { theme = JSON.parse(fs.readFileSync(path.join(userData, "vibefield-theme.json"), "utf8")); } catch {}\n` +
    `fs.appendFileSync(process.env.FIRST_RUN_RECORD, JSON.stringify({ argv: process.argv.slice(2), walk: process.env.VF_FIRST_RUN_WALK ?? null, shotDir: process.env.VF_SMOKE_SHOT_DIR ?? null, mark: process.env.VF_SMOKE_RUN ?? null, userData, theme }) + "\\n");\n` +
    `process.exit(process.env.VF_FIRST_RUN_WALK === process.env.FIRST_RUN_RED ? 2 : 0);\n`;
  interface Launched {
    argv: string[];
    walk: string | null;
    shotDir: string | null;
    mark: string | null;
    userData: string;
    theme: { preference?: string } | null;
  }
  // three stand-in launches and three censuses (`smoke-daemons.mjs`); smoke-profile.test.ts measured one launch and its
  // census at up to 9 s on a loaded host, so three get the room of three and more
  const ROWS_BUDGET_MS = 45_000;
  const run = (args: string[], red: string | null) => {
    const dist = mkdtempSync(join(tmpdir(), "fg-fake-electron-"));
    const shots = mkdtempSync(join(tmpdir(), "fg-first-run-shots-"));
    const recorded = join(dist, "launched.jsonl");
    try {
      fakeElectron(launcher, dist, STAND_IN);
      const result = spawnSync(process.execPath, [launcher, ...args], {
        cwd: desktopRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          ELECTRON_OVERRIDE_DIST_PATH: dist,
          VF_SMOKE_SHOT_DIR: shots,
          FIRST_RUN_RECORD: recorded,
          FIRST_RUN_RED: red ?? "",
        },
      });
      const launched = existsSync(recorded)
        ? readFileSync(recorded, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line) as Launched)
        : [];
      return { result, launched, shots };
    } finally {
      rmSync(dist, { recursive: true, force: true });
      rmSync(shots, { recursive: true, force: true });
    }
  };

  it.skipIf(process.platform === "win32")(
    "runs the three walks in order, each on a fresh profile seeded with its theme, its stills kept outside it",
    { timeout: ROWS_BUDGET_MS },
    () => {
      const { result, launched, shots } = run([], null);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`FIRST_RUN_SHOTS ${shots}\n`);
      expect(launched.map((l) => l.walk)).toEqual(["day", "night", "no-webgpu"]);
      // light and dark both explicit, in the app's own store, before the boot
      expect(launched.map((l) => l.theme)).toEqual([
        { preference: "light" },
        { preference: "dark" },
        { preference: "light" },
      ]);
      expect(launched.map((l) => l.argv.slice(1))).toEqual([
        [`--user-data-dir=${launched[0]?.userData}`, "--smoke-first-run"],
        [`--user-data-dir=${launched[1]?.userData}`, "--smoke-first-run"],
        [`--user-data-dir=${launched[2]?.userData}`, "--smoke-first-run", "--smoke-no-webgpu"],
      ]);
      expect(new Set(launched.map((l) => l.userData)).size).toBe(3);
      for (const l of launched) {
        expect(l.shotDir).toBe(join(shots, l.walk ?? ""));
        expect(l.mark).toBe(basename(l.userData));
        expect(basename(l.userData).startsWith("vf-smoke-profile-")).toBe(true);
        expect(existsSync(l.userData), "the walk's profile is removed after it").toBe(false);
      }
      expect(result.stdout).toContain(`FIRST_RUN {"green":true,"walks":["day green`);
    },
  );

  it.skipIf(process.platform === "win32")(
    "runs every walk past a red one and exits red; runs a named walk alone; refuses a walk it does not know",
    { timeout: ROWS_BUDGET_MS },
    () => {
      const all = run([], "day");
      expect(all.result.status).toBe(1);
      expect(all.launched.map((l) => l.walk)).toEqual(["day", "night", "no-webgpu"]);
      expect(all.result.stdout).toContain(`FIRST_RUN_VERDICT {"walk":"day","ok":false,"code":2`);
      const night = run(["night"], null);
      expect(night.result.status).toBe(0);
      expect(night.launched.map((l) => [l.walk, l.theme?.preference])).toEqual([["night", "dark"]]);
      const unknown = run(["dusk"], null);
      expect(unknown.result.status).toBe(2);
      expect(unknown.result.stderr).toContain("no walk named dusk");
      expect(unknown.launched).toEqual([]);
    },
  );
});
