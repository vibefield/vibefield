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
  type FrozenReading,
  firstRunContrast,
  firstRunGpu,
  firstRunRows,
  frameStats,
  frozenRegion,
  type GlassSeen,
  type GpuSample,
  glassDrawnBy,
  gpuOver,
  heard,
  type InksSeen,
  inkCuts,
  judgeBand,
  judgeContrast,
  judgeFrame,
  judgeFrozen,
  judgeHandOver,
  judgeHolds,
  judgeLogo,
  judgeOpening,
  judgeRecorded,
  judgeSignIn,
  type LogoSeen,
  listFits,
  measureMark,
  PAGE_WORDS,
  parseGpuBusy,
  parseWalk,
  passedOver,
  readFrozen,
  type SignInSeen,
  type StageReading,
  shotDirRefusal,
  splashLook,
  TEAR_NOT_OPEN,
  WALKED_FACES,
  type WordSeen,
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
  it("names four walks: day and night on the live field, the page with no WebGPU by day, and the catalog", () => {
    expect(FIRST_RUN_WALKS).toEqual({
      day: { dark: false, webgpu: true },
      night: { dark: true, webgpu: true },
      "no-webgpu": { dark: false, webgpu: false },
      // the catalog judged: its frames by day, then by night through the catalog's own toggle
      catalog: { dark: false, webgpu: true },
    });
    expect(["day", "night", "no-webgpu", "catalog"].map(parseWalk)).toEqual([
      "day",
      "night",
      "no-webgpu",
      "catalog",
    ]);
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

describe('FG-O2\'s judge: every word on the glass at 4.5:1 (DESIGN.md §8 "Its words read")', () => {
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
  const word = (
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    over: Partial<WordSeen> = {},
  ): WordSeen => ({
    x,
    y,
    width,
    height,
    text,
    shown: 1,
    lines: [{ x, y, width, height }],
    off: false,
    fading: false,
    cut: null,
    color: "rgba(28, 28, 30, 0.7)",
    list: null,
    ...over,
  });
  const seen = (over: Partial<InksSeen> = {}): InksSeen => ({
    view: { width: 60, height: 30 },
    wizard: false,
    field: "live",
    canvas: 1,
    stage: null,
    words: [],
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

  it("holds a word as it stands, dimmed or not, and passes over one that does not show as it stands, saying why", () => {
    const label = word(10, 10, 20, 6, "Agents");
    expect(passedOver(label, null)).toBeNull();
    // dimmed to stay so, it is held as it shows; in a control that is off, or fading in, it is passed over
    expect(passedOver({ ...label, shown: 0.55 }, null)).toBeNull();
    expect(passedOver({ ...label, shown: 0.4, off: true }, null)).toBe(
      "in a control that is off (0.4)",
    );
    expect(passedOver({ ...label, shown: 0.6, fading: true }, null)).toBe("fading (0.6)");
    expect(passedOver({ ...label, fading: true }, null)).toBeNull();
    expect(passedOver({ ...label, cut: "list" }, null)).toBe("cut off at its list's edge");
    expect(passedOver({ ...label, cut: "box" }, null)).toBe("cut off by its box");
    expect(passedOver({ ...label, cut: "head" }, null)).toBe("under its list's pinned head");
    // a list 100 tall whose foot fades over its last 20: a word ending in that foot stands under the fade; one ending
    // above it, or in a list that wears no fade, is held
    const list = { x: 0, y: 0, width: 60, height: 100, masked: true };
    expect(passedOver({ ...label, y: 76, list }, null)).toBe("under its list's fade");
    expect(passedOver({ ...label, y: 74, list }, null)).toBeNull();
    expect(passedOver({ ...label, y: 76, list: { ...list, masked: false } }, null)).toBeNull();
    // read on the capture's other side: held where it stood as it stands, within the slack
    expect(passedOver(label, [label])).toBeNull();
    expect(passedOver(label, [{ ...label, x: 10.8 }])).toBeNull();
    expect(passedOver(label, [{ ...label, y: 14 }])).toBe("changed under the capture");
    expect(passedOver(label, [{ ...label, text: "Agent" }])).toBe("changed under the capture");
    expect(passedOver(label, [{ ...label, shown: 0.9, fading: true }])).toBe(
      "changed under the capture",
    );
    expect(passedOver(label, [])).toBe("changed under the capture");
  });

  it("cuts every word from its still by its own lines, holds each at 4.5:1, and prints the lowest and every short one", () => {
    // a window 60 × 30 at 2 to the px on a glass of 200: the stage line's glyph cores at 40, a label's at 120, two
    // buttons' at 40, and a voice of two lines at 90 with a darker mark between its lines' ends
    const still = capture(60, 30, 2, 200, [
      { x0: 2, x1: 4, y0: 1, y1: 3, level: 40 },
      { x0: 14, x1: 15, y0: 2, y1: 3, level: 120 },
      { x0: 26, x1: 27, y0: 2, y1: 3, level: 40 },
      { x0: 50, x1: 51, y0: 2, y1: 3, level: 40 },
      { x0: 4, x1: 6, y0: 11, y1: 13, level: 90 },
      { x0: 4, x1: 6, y0: 16, y1: 18, level: 90 },
      { x0: 12, x1: 18, y0: 15, y1: 19, level: 0 },
    ]);
    const long = "Your agents keep their history on this Mac, and the field can read it";
    const you = word(12, 0, 10, 5, "You");
    const onward = word(24, 0, 10, 5, "Continue");
    const back = word(36, 0, 10, 5, "Back");
    const next = word(48, 0, 10, 5, "Next");
    const voice = word(0, 10, 20, 9, long, {
      lines: [
        { x: 0, y: 10, width: 20, height: 4 },
        { x: 0, y: 15, width: 10, height: 4 },
      ],
    });
    const later = word(30, 10, 10, 5, "Set up later", { shown: 0.5, fading: true });
    const agents = seen({ wizard: true, words: [you, onward, back, next, voice, later] });
    // Back stood 3 lower when the page was read before the capture
    const before = seen({
      wizard: true,
      words: [you, onward, { ...back, y: 3 }, next, voice, later],
    });
    const cuts = [
      ...inkCuts("01-splash.png", still, seen({ stage: words(0, 0, 10, 5, "loading the field") }), [
        "stage",
      ]),
      ...inkCuts("05-agents.png", still, agents, ["words"], before),
    ];
    const glass = [200, 200, 200];
    const contrast = firstRunContrast(cuts);
    expect(contrast).toEqual({
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
      words: [
        {
          at: "05-agents.png",
          judged: 4,
          lowest: [
            ["You", 2.6],
            [`${long.slice(0, 47)}…`, 4.1],
            ["Continue", 8.8],
          ],
          short: [
            {
              text: "You",
              color: "rgba(28, 28, 30, 0.7)",
              ground: glass,
              ink: [120, 120, 120],
              ratio: 2.6,
            },
            {
              text: long,
              color: "rgba(28, 28, 30, 0.7)",
              ground: glass,
              ink: [90, 90, 90],
              ratio: 4.1,
            },
          ],
          passed: [
            ["Back", "changed under the capture", 1],
            ["Set up later", "fading (0.5)", 1],
          ],
        },
      ],
    });
    expect(judgeContrast(contrast)).toEqual([
      'on 05-agents.png "You" reads 2.6:1 ([200,200,200] → [120,120,120]) in rgba(28, 28, 30, 0.7), under 4.5:1',
      `on 05-agents.png "${long}" reads 4.1:1 ([200,200,200] → [90,90,90]) in rgba(28, 28, 30, 0.7), under 4.5:1`,
    ]);
  });

  it("cuts a word it passes over too and prints its ratio beside why, never judging it", () => {
    // the catalog judged's follow-up 1: an off group's label at its dim, its glyph cores at 120 on a glass of 200
    const still = capture(60, 30, 2, 200, { x0: 2, x1: 6, y0: 1, y1: 4, level: 120 });
    const label = word(0, 0, 10, 5, "Face", { shown: 0.45, off: true });
    const contrast = firstRunContrast(
      inkCuts("02-field.png", still, seen({ wizard: true, words: [label] }), ["words"]),
    );
    expect(contrast.words).toEqual([
      {
        at: "02-field.png",
        judged: 0,
        lowest: [],
        short: [],
        passed: [["Face", "in a control that is off (0.45)", 2.6]],
      },
    ]);
    expect(judgeContrast(contrast)).toEqual([]);
  });

  it("judges the splash's stage line as it is cut: under 4.5:1 it is red with its numbers", () => {
    const stage: StageReading = {
      at: "01-splash.png",
      said: "loading the field",
      field: "waking",
      canvas: 0,
      ground: [200, 200, 200],
      ink: [90, 90, 90],
      ratio: 4.1,
      shown: 1,
    };
    expect(judgeContrast({ stage, words: [] })).toEqual([
      "the splash's stage line reads 4.1:1 ([200,200,200] → [90,90,90]) on 01-splash.png, under 4.5:1",
    ]);
    expect(
      judgeContrast({ stage: { ...stage, ink: [40, 40, 40], ratio: 8.8 }, words: [] }),
    ).toEqual([]);
  });

  it("says what it could not read: no still prints nothing, and a capture not the window's size is red, unread", () => {
    expect(firstRunContrast([])).toEqual({ stage: null, words: [] });
    expect(judgeContrast({ stage: null, words: [] })).toEqual([]);
    const odd = new Uint8Array(4 * 7);
    const contrast = firstRunContrast([
      ...inkCuts("01-splash.png", odd, seen({ stage: words(0, 0, 10, 5, "loading the field") }), [
        "stage",
      ]),
      ...inkCuts(
        "11-connect.png",
        odd,
        seen({ wizard: true, words: [word(0, 0, 10, 5, "Not now")] }),
        ["words"],
      ),
    ]);
    expect(contrast).toEqual({
      stage: {
        at: "01-splash.png",
        said: "loading the field",
        field: "live",
        canvas: 1,
        ground: null,
        ink: null,
        ratio: null,
        shown: 1,
      },
      words: [
        {
          at: "11-connect.png",
          judged: 1,
          lowest: [["Not now", null]],
          short: [
            {
              text: "Not now",
              color: "rgba(28, 28, 30, 0.7)",
              ground: null,
              ink: null,
              ratio: null,
            },
          ],
          passed: [],
        },
      ],
    });
    expect(judgeContrast(contrast)).toEqual([
      "the splash's stage line could not be cut from 01-splash.png",
      'on 11-connect.png "Not now" could not be cut from its still',
    ]);
  });
});

describe("FG-O2's judge: a word under its list's pinned head (item 254)", () => {
  // The judge's finder of words (PAGE_WORDS' wordsIn) run on a page of boxes: the few calls it makes of the DOM,
  // faked. A box computes every property the finder reads, at its initial value unless set (one it reads that the
  // fake does not compute is a red, never an undefined), and takes the box it is given; a text's lines take theirs.
  type Css = Readonly<Record<string, string>>;
  interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }
  const INITIAL: Css = {
    visibility: "visible",
    color: "rgb(28, 28, 30)",
    opacity: "1",
    display: "block",
    position: "static",
    zIndex: "auto",
    overflowX: "visible",
    overflowY: "visible",
    textOverflow: "clip",
    backgroundColor: "rgba(0, 0, 0, 0)",
    maskImage: "none",
    webkitMaskImage: "none",
    transform: "none",
    translate: "none",
    rotate: "none",
    scale: "none",
    filter: "none",
    backdropFilter: "none",
    perspective: "none",
    clipPath: "none",
    isolation: "auto",
    mixBlendMode: "normal",
    contain: "none",
    containerType: "normal",
    willChange: "auto",
  };
  const client = ({ x, y, width, height }: Rect) => ({
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  });
  class PageText {
    parentElement: PageBox | null = null;
    constructor(
      readonly data: string,
      readonly lines: readonly Rect[],
    ) {}
  }
  class PageBox {
    parentElement: PageBox | null = null;
    readonly style: Css;
    constructor(
      css: Css,
      readonly rect: Rect,
      readonly kids: ReadonlyArray<PageBox | PageText>,
    ) {
      this.style = { ...INITIAL, ...css };
      for (const kid of kids) kid.parentElement = this;
    }
    getBoundingClientRect() {
      return client(this.rect);
    }
    getAnimations(): readonly unknown[] {
      return [];
    }
    closest(): null {
      return null;
    }
    contains(other: PageBox | PageText): boolean {
      for (let at: PageBox | PageText | null = other; at !== null; at = at.parentElement)
        if (at === this) return true;
      return false;
    }
    querySelectorAll(selector: string): PageBox[] {
      if (selector !== "*") throw new Error(`the fake page selects only "*", never ${selector}`);
      return inOrder(this).filter((at): at is PageBox => at instanceof PageBox && at !== this);
    }
    compareDocumentPosition(other: PageBox): number {
      const order = inOrder(rootOf(this));
      return (
        (order.indexOf(other) > order.indexOf(this) ? 4 : 2) |
        (this.contains(other) ? 16 : 0) |
        (other.contains(this) ? 8 : 0)
      );
    }
  }
  /** A box and everything in it, in tree order; and the page a box stands in. */
  const inOrder = (at: PageBox): Array<PageBox | PageText> => [
    at,
    ...at.kids.flatMap((kid) => (kid instanceof PageBox ? inOrder(kid) : [kid])),
  ];
  const rootOf = (at: PageBox): PageBox =>
    at.parentElement === null ? at : rootOf(at.parentElement);
  const wordsIn = new Function(
    "document",
    "NodeFilter",
    "Node",
    "getComputedStyle",
    `${PAGE_WORDS}\n  return wordsIn;`,
  )(
    {
      createTreeWalker: (scope: PageBox) => {
        const texts = inOrder(scope).filter((at): at is PageText => at instanceof PageText);
        let next = 0;
        return { nextNode: () => texts[next++] ?? null };
      },
      createRange: () => {
        let lines: readonly Rect[] = [];
        return {
          selectNodeContents: (text: PageText) => {
            lines = text.lines;
          },
          getClientRects: () => lines.map(client),
        };
      },
    },
    { SHOW_TEXT: 4 },
    {
      DOCUMENT_POSITION_PRECEDING: 2,
      DOCUMENT_POSITION_FOLLOWING: 4,
      DOCUMENT_POSITION_CONTAINS: 8,
      DOCUMENT_POSITION_CONTAINED_BY: 16,
    },
    (at: PageBox) =>
      new Proxy(at.style, {
        get: (style, name) => {
          if (typeof name !== "string") return undefined;
          if (!(name in style)) throw new Error(`the fake page computes no ${name}`);
          return style[name];
        },
      }),
  ) as (scope: PageBox) => WordSeen[];

  // The profiles pane's card on the glass as 586438a91 pins it (field-app's setup/profiles-pane.css): its head stuck
  // to the top of the list that scrolls (position: sticky, z-index 1, on --vf-chrome-solid, #ffffff by day), over
  // the card's rows as they scroll under it. The list 400 × 300; the head 40 tall at its top, its name on it; the
  // row's plan, one line, where the row stands.
  const NAME: Rect = { x: 12, y: 12, width: 60, height: 16 };
  /** the plan's line wholly under the head (0 to 40), and with its top 8 under it */
  const UNDER: Rect = { x: 300, y: 10, width: 80, height: 16 };
  const HALF: Rect = { x: 300, y: 32, width: 80, height: 16 };
  const pane = (plan: Rect, { head = {}, row = {} }: { head?: Css; row?: Css } = {}): PageBox =>
    new PageBox({}, { x: 0, y: 0, width: 400, height: 300 }, [
      new PageBox(
        { overflowX: "auto", overflowY: "auto" },
        { x: 0, y: 0, width: 400, height: 300 },
        [
          new PageBox({}, { x: 0, y: -20, width: 400, height: 220 }, [
            new PageBox(
              {
                position: "sticky",
                zIndex: "1",
                display: "flex",
                backgroundColor: "rgb(255, 255, 255)",
                ...head,
              },
              { x: 0, y: 0, width: 400, height: 40 },
              [new PageText("This Mac", [NAME])],
            ),
            new PageBox(row, { x: 0, y: plan.y - 6, width: 400, height: plan.height + 12 }, [
              new PageText("ChatGPT Pro", [plan]),
            ]),
          ]),
        ],
      ),
    ]);
  const planOn = (scope: PageBox): WordSeen | undefined =>
    wordsIn(scope).find((word) => word.text === "ChatGPT Pro");

  it("(i) drops a line wholly under an opaque head its list pins over it: at the head's z-index 1, or with none, as a pinned box paints over the list's in-flow rows", () => {
    expect(wordsIn(pane(UNDER)).map((word) => word.text)).toEqual(["This Mac"]);
    expect(wordsIn(pane(UNDER, { head: { zIndex: "auto" } })).map((word) => word.text)).toEqual([
      "This Mac",
    ]);
  });

  it("(ii) cuts a line partly under it to the part the head leaves, and says the word stands under its list's pinned head", () => {
    const half = planOn(pane(HALF));
    expect(half?.cut).toBe("head");
    expect(half?.lines).toEqual([{ x: 300, y: 40, width: 80, height: 8 }]);
    expect([half?.y, half?.height]).toEqual([40, 8]);
    expect(half === undefined ? undefined : passedOver(half, null)).toBe(
      "under its list's pinned head",
    );
  });

  it("(iii) never clips a word by its own head: the pinned box's own words are on the still, whole", () => {
    const name = wordsIn(pane(UNDER)).find((word) => word.text === "This Mac");
    expect(name?.cut).toBeNull();
    expect(name?.lines).toEqual([NAME]);
  });

  it("(iv) never clips under a translucent head, its background's alpha under 1 or the box less than opaque: the word shows through it and is measured as it shows", () => {
    for (const head of [{ backgroundColor: "rgba(255, 255, 255, 0.6)" }, { opacity: "0.6" }]) {
      const shown = planOn(pane(UNDER, { head }));
      expect(shown?.cut).toBeNull();
      expect(shown?.lines).toEqual([UNDER]);
      expect(shown === undefined ? undefined : passedOver(shown, null)).toBeNull();
    }
  });

  it("(v) reads the stacking, never assumes it: a row that paints over the head — its z-index over the head's, or on the head's layer and after it in tree order — is on the still, whole", () => {
    const over: ReadonlyArray<readonly [Css, Css]> = [
      [{}, { position: "relative", zIndex: "2" }],
      [{ zIndex: "auto" }, { position: "relative" }],
    ];
    for (const [head, row] of over) {
      const shown = planOn(pane(UNDER, { head, row }));
      expect(shown?.cut).toBeNull();
      expect(shown?.lines).toEqual([UNDER]);
    }
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

describe("FG-6's frozen frame (DESIGN.md §8 \"Held to the browser's glass\")", () => {
  // a 600 × 500 window, its glass 400 × 300 at 100, 100 with corners of 32, at its own size, the logo's box at its
  // centre
  const seen: GlassSeen = {
    box: { x: 100, y: 100, width: 400, height: 300 },
    radius: 32,
    fit: 1,
    drawn: "field",
    logo: { x: 250, y: 220, width: 100, height: 60 },
    mark: null,
    view: { width: 600, height: 500 },
  };
  /** A capture of the window at `density` (BGRA), each px the grey `level` gives at its centre in CSS px. */
  const shot = (density: number, level: (x: number, y: number) => number): Uint8Array => {
    const w = seen.view.width * density;
    const h = seen.view.height * density;
    const bgra = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l = level((x + 0.5) / density, (y + 0.5) / density);
        bgra.set([l, l, l, 255], (y * w + x) * 4);
      }
    }
    return bgra;
  };

  it("holds the field's glass to DESIGN.md §8's bars", () => {
    const design = readFileSync(resolve(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");
    const bars =
      /\*\*Held to the browser's glass\*\*.*? differ by a mean of at most ([\d.]+) inside the glass, ([\d.]+) in its shadow and ([\d.]+) on the logo/.exec(
        design,
      );
    expect(bars?.slice(1).map(Number)).toEqual([
      FIRST_RUN.frozen.inside,
      FIRST_RUN.frozen.shadow,
      FIRST_RUN.frozen.logo,
    ]);
  });

  it("waits for the glass drawn as it is wanted: by the field, or by the browser in the field's held mark, never the brand's (FG-6's follow-up 3)", () => {
    expect(glassDrawnBy(seen, true)).toBe(true);
    expect(glassDrawnBy({ ...seen, drawn: null }, true)).toBe(false);
    expect(glassDrawnBy({ ...seen, drawn: null, mark: "field" }, false)).toBe(true);
    // the browser's glass with the brand's mark on its logo: the judge would read the logo against the brand's still
    expect(glassDrawnBy({ ...seen, drawn: null }, false)).toBe(false);
    expect(glassDrawnBy({ ...seen, mark: "field" }, false)).toBe(false);
    expect(glassDrawnBy(null, true)).toBe(false);
  });

  it("places a window's px on the glass: on its logo, inside past its edge's hairlines, in the ring of its shadow, or on none", () => {
    expect(frozenRegion(seen, 300, 250)).toBe("logo");
    expect(frozenRegion(seen, 150, 150)).toBe("inside");
    // its edge, with its two hairlines
    expect(frozenRegion(seen, 104, 250)).toBe("inside");
    expect(frozenRegion(seen, 101, 250)).toBeNull();
    expect(frozenRegion(seen, 99.5, 250)).toBeNull();
    // the ring of its shadow, round its corners too, and the field past it
    expect(frozenRegion(seen, 70, 250)).toBe("shadow");
    expect(frozenRegion(seen, 102, 102)).toBe("shadow");
    expect(frozenRegion(seen, 30, 250)).toBeNull();
    // at the glass's fit
    const half = { ...seen, fit: 0.5 };
    expect(frozenRegion(half, 102, 250)).toBe("inside");
    expect(frozenRegion(half, 60, 250)).toBeNull();
  });

  it("reads the field's two captures apart over the window, and its glass against the browser's by region, at any density", () => {
    // square corners, so a region's px are the paint's
    const square = { ...seen, radius: 0 };
    const inLogo = (x: number, y: number) => x >= 250 && x < 350 && y >= 220 && y < 280;
    const inGlass = (x: number, y: number) => x >= 100 && x < 500 && y >= 100 && y < 400;
    for (const density of [1, 2]) {
      const field = shot(density, () => 200);
      const browser = shot(density, (x, y) => (inLogo(x, y) ? 205 : inGlass(x, y) ? 201 : 202));
      // the field again, but 10 apart over a block the logo's size: a field that moved there
      const moved = shot(density, (x, y) => (inLogo(x, y) ? 210 : 200));
      const reading = readFrozen(field, browser, field, square);
      expect(reading).toEqual({
        held: 0,
        regions: {
          inside: { diff: 1, px: (394 * 294 - 6000) * density * density },
          shadow: { diff: 2, px: expect.any(Number) },
          logo: { diff: 5, px: 6000 * density * density },
        },
      });
      expect(reading?.regions.shadow.px).toBeGreaterThan(0);
      expect(readFrozen(field, browser, moved, square)?.held).toBe(0.2);
    }
    // nothing off a capture that is no picture of the window read: an empty one (a hidden window's), one of another
    // window's size (600 × 400), or three not one size
    const field = shot(1, () => 200);
    const empty = new Uint8Array(0);
    const other = new Uint8Array(600 * 400 * 4);
    expect(readFrozen(empty, empty, empty, seen)).toBeNull();
    expect(readFrozen(other, other, other, seen)).toBeNull();
    expect(readFrozen(field, field.subarray(4), field, seen)).toBeNull();
  });

  it("passes a held frame within §8's bars, and at them, and finds a frame not held, a region over its bar, and one with no px", () => {
    const within: FrozenReading = {
      held: 0,
      regions: {
        inside: { diff: 1.1, px: 400_000 },
        shadow: { diff: 0.3, px: 90_000 },
        logo: { diff: 2.4, px: 39_424 },
      },
    };
    expect(judgeFrozen(within)).toEqual([]);
    expect(
      judgeFrozen({
        held: 0.1,
        regions: {
          inside: { diff: 2, px: 1 },
          shadow: { diff: 1, px: 1 },
          logo: { diff: 6, px: 1 },
        },
      }),
    ).toEqual([]);
    expect(
      judgeFrozen({
        ...within,
        regions: {
          ...within.regions,
          inside: { diff: 2.4, px: 400_000 },
          shadow: { diff: 0, px: 0 },
        },
      }),
    ).toEqual([
      "on the frozen frame the field's glass differs from the browser's by 2.4 inside the glass, over DESIGN.md §8's 2",
      "the frozen frame has no px in its shadow",
    ]);
    // a frame not held is said alone: what differs then is no longer one frame
    expect(
      judgeFrozen({
        held: 0.4,
        regions: { ...within.regions, logo: { diff: 9, px: 39_424 } },
      }),
    ).toEqual([
      "the field did not hold its frame: its two captures with the field's glass differ by 0.4 (at most 0.1)",
    ]);
    expect(judgeFrozen(null)).toEqual(["the frozen frame's captures are no picture of the window"]);
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
        // a page with no field's door: the frozen frame finds nothing to hold, and the walk goes on
        "on the live field the field's door held no frame (window.__vfField)",
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
    `fs.appendFileSync(process.env.FIRST_RUN_RECORD, JSON.stringify({ argv: process.argv.slice(2), walk: process.env.VF_FIRST_RUN_WALK ?? null, shotDir: process.env.VF_SMOKE_SHOT_DIR ?? null, mark: process.env.VF_SMOKE_RUN ?? null, catalog: process.env.VF_CATALOG_RENDERER ?? null, userData, theme }) + "\\n");\n` +
    `process.exit(process.env.VF_FIRST_RUN_WALK === process.env.FIRST_RUN_RED ? 2 : 0);\n`;
  interface Launched {
    argv: string[];
    walk: string | null;
    shotDir: string | null;
    mark: string | null;
    catalog: string | null;
    userData: string;
    theme: { preference?: string } | null;
  }
  // four stand-in launches and four censuses (`smoke-daemons.mjs`); smoke-profile.test.ts measured one launch and its
  // census at up to 9 s on a loaded host, so four get the room of four and more
  const ROWS_BUDGET_MS = 60_000;
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
    "runs the four walks in order, each on a fresh profile seeded with its theme, its stills kept outside it",
    { timeout: ROWS_BUDGET_MS },
    () => {
      const { result, launched, shots } = run([], null);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`FIRST_RUN_SHOTS ${shots}\n`);
      expect(launched.map((l) => l.walk)).toEqual(["day", "night", "no-webgpu", "catalog"]);
      // light and dark both explicit, in the app's own store, before the boot
      expect(launched.map((l) => l.theme)).toEqual([
        { preference: "light" },
        { preference: "dark" },
        { preference: "light" },
        { preference: "light" },
      ]);
      expect(launched.map((l) => l.argv.slice(1))).toEqual([
        [`--user-data-dir=${launched[0]?.userData}`, "--smoke-first-run"],
        [`--user-data-dir=${launched[1]?.userData}`, "--smoke-first-run"],
        [`--user-data-dir=${launched[2]?.userData}`, "--smoke-first-run", "--smoke-no-webgpu"],
        [`--user-data-dir=${launched[3]?.userData}`, "--smoke-first-run"],
      ]);
      // the catalog's walk alone is handed the design build, where `build:design` writes it
      expect(launched.map((l) => l.catalog)).toEqual([
        null,
        null,
        null,
        resolve(desktopRoot, "../../.vibefield/studio/catalog-renderer"),
      ]);
      expect(new Set(launched.map((l) => l.userData)).size).toBe(4);
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
      expect(all.launched.map((l) => l.walk)).toEqual(["day", "night", "no-webgpu", "catalog"]);
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

// Item 253 (g), 2026-11-08 — History's red with no row names the agent index's own state, in the frame every door says
// it in (`the agent index is unconfigured: <detail>`, fieldd's rosettad-supervisor.ts), as the seeded-session rung of
// smoke.ts says it: the red's cause in its own words. The module is read through its namespace, so the red before the
// export is this row's assertion, never a load error.
describe("History's count judged (judgeHistoryRows)", () => {
  it("names the agent index's state in a red with no row (item 253 (g))", async () => {
    const walk: Record<string, unknown> = { ...(await import("../src/testing/smoke-first-run")) };
    expect(typeof walk["judgeHistoryRows"]).toBe("function");
    const judge = walk["judgeHistoryRows"] as (
      rows: number,
      index: { readonly phase: string; readonly detail: string | null } | null,
    ) => string | null;
    const unconfigured = {
      phase: "unconfigured",
      detail: "no rosettad binary was configured (FIELDD_ROSETTAD_BIN)",
    };
    const none = "History shows 0 rows, not the typed agent's one";
    expect(judge(1, null)).toBeNull();
    expect(judge(1, unconfigured)).toBeNull();
    expect(judge(0, unconfigured)).toBe(
      `${none} — the agent index is unconfigured: ${unconfigured.detail}`,
    );
    expect(judge(0, { phase: "restarting", detail: null })).toBe(
      `${none} — the agent index is restarting`,
    );
    // an index that serves, or one this walk could not read, leaves the count alone to say it
    expect(judge(0, { phase: "ready", detail: null })).toBe(none);
    expect(judge(0, null)).toBe(none);
    // more rows than the typed agent's one is no index's absence
    expect(judge(2, unconfigured)).toBe("History shows 2 rows, not the typed agent's one");
  });
});
