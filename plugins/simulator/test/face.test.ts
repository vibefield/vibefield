// THE HONEST FACES (src/face.ts, notice.ts, notice-canvas.ts — the PT-S design §3, DESIGN.md §9): each of the nine states drawn
// as the pane's laws say — the stream; a still at 0.7 with its mark; a still at 0.16 under words; the panel off with words —
// its act offered only where the host can run it; a host that says no word read by its face's coarse state; and the words
// laid on the screen in its own points, wrapped to three lines, drawn as their light over black, their block alone.
import {
  LIVE_SIMULATOR_STATES,
  type LiveSimulatorState,
  type LiveState,
} from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  actAt,
  drawWords,
  FACE_ACTS,
  FACE_LINES,
  FACE_SHOWS,
  facePlan,
  faceState,
  NO_FACE,
  NOTICE_LINES,
  NOTICE_SCALE,
  noticeBlock,
  noticeKey,
  noticeLayout,
  PHONE,
  type WordsContext,
  wrapLines,
} from "../src";

const LIVE: LiveState = { is: "live" };
const words = (is: LiveSimulatorState, act?: () => void) => ({
  extra: { simulator: { is, ...(act === undefined ? {} : { act }) } },
});

describe("the nine faces, drawn as the pane's laws say", () => {
  it("names a line, an act and what the screen shows for every one of the SDK's nine states — no state left out", () => {
    for (const is of LIVE_SIMULATOR_STATES) {
      expect(FACE_LINES, is).toHaveProperty(is);
      expect(FACE_ACTS, is).toHaveProperty(is);
      expect(FACE_SHOWS, is).toHaveProperty(is);
    }
    expect(Object.keys(FACE_LINES).sort()).toEqual([...LIVE_SIMULATOR_STATES].sort());
  });

  it("draws each state: the stream at 1; a still at 0.7 with its mark; a still at 0.16 under words; no still where there is none", () => {
    const plan = (is: LiveSimulatorState, texture = true) =>
      facePlan(words(is), LIVE, "iPhone 17 Pro", texture);
    expect(plan("live")).toMatchObject({
      frame: true,
      brightness: 1,
      mark: "none",
      line: null,
      act: null,
    });
    expect(plan("at-rest")).toMatchObject({
      frame: true,
      brightness: PHONE.display.still,
      mark: "rest",
      line: null,
    });
    expect(plan("booting")).toMatchObject({
      frame: true,
      brightness: PHONE.display.still,
      mark: "boot",
      line: null,
    });
    expect(plan("off")).toMatchObject({
      frame: true,
      brightness: PHONE.display.stillUnder,
      mark: "none",
      line: "iPhone 17 Pro is off",
    });
    expect(plan("no-window")).toMatchObject({
      frame: true,
      brightness: PHONE.display.stillUnder,
      line: "The Simulator's window is closed",
    });
    expect(plan("stopped")).toMatchObject({
      frame: true,
      brightness: PHONE.display.stillUnder,
      line: "The Simulator stopped",
    });
    for (const is of ["no-simulator", "no-permission", "no-device"] as const)
      expect(plan(is), is).toMatchObject({ frame: false, mark: "none" });
    expect(plan("no-device").line).toBe("There's no iPhone 17 Pro on this Mac");
    expect(plan("no-simulator").line).toBe("The iOS Simulator isn't on this Mac");
    expect(plan("no-permission").line).toBe(
      "VibeField needs Screen Recording to show the Simulator",
    );
    // a still is shown only where the face holds one — never a mark over nothing
    expect(plan("at-rest", false)).toMatchObject({ frame: false, mark: "none" });
  });

  it("offers a state's act only where the host can run it — and names the device by the host's word for it, else the phone's", () => {
    const boot = () => {};
    expect(facePlan(words("off"), LIVE, "iPhone 8", true).act).toBeNull();
    const off = facePlan(words("off", boot), LIVE, "iPhone 8", true);
    expect(off.act?.label).toBe("Boot");
    expect(off.act?.run).toBe(boot);
    expect(facePlan(words("no-device", boot), LIVE, "iPhone 8", true).act?.label).toBe("Create it");
    expect(facePlan(words("no-window", boot), LIVE, "iPhone 8", true).act?.label).toBe("Show it");
    expect(facePlan(words("no-permission", boot), LIVE, "iPhone 8", true).act?.label).toBe(
      "Open Settings",
    );
    expect(facePlan(words("stopped", boot), LIVE, "iPhone 8", true).act?.label).toBe("Try again");
    // a state with no act offers none, whatever the host hands
    expect(facePlan(words("live", boot), LIVE, "iPhone 8", true).act).toBeNull();
    expect(facePlan(words("booting", boot), LIVE, "iPhone 8", true).act).toBeNull();
    // the host's name for the device wins
    expect(
      facePlan(
        { extra: { simulator: { is: "off", device: "Test Phone" } } },
        LIVE,
        "iPhone 8",
        true,
      ).line,
    ).toBe("Test Phone is off");
  });

  it("reads a host that says no word by its face's coarse state — live, at rest, stopped (its retry the act) — and nothing for one starting", () => {
    expect(faceState({}, { is: "live" })?.face.is).toBe("live");
    expect(faceState({}, { is: "paused" })?.face.is).toBe("at-rest");
    const retry = () => {};
    const failed = faceState({}, { is: "failed", reason: "producer-crashed", retry });
    expect(failed?.face.is).toBe("stopped");
    expect(failed?.retry).toBe(retry);
    expect(facePlan({}, { is: "failed", reason: "x", retry }, "iPhone 8", true).act?.run).toBe(
      retry,
    );
    expect(faceState({}, { is: "starting" })).toBeUndefined();
    expect(faceState({}, { is: "closed" })).toBeUndefined();
    expect(facePlan({}, { is: "starting" }, "iPhone 8", true)).toEqual(NO_FACE);
    // a word it cannot read is no word: the coarse state speaks
    expect(faceState({ extra: { simulator: { is: "asleep" } } }, { is: "live" })?.face.is).toBe(
      "live",
    );
  });
});

describe("the words on the screen — laid in its points, wrapped to three lines, their block alone", () => {
  const PRO: readonly [number, number] = [402, 874];
  const MINI: readonly [number, number] = [375, 812];

  it("sets the line as large as reads on a phone at rest — between 14 and 24 points — with the act's capsule under its lines", () => {
    const L = noticeLayout(PRO);
    expect(L.unit).toBeGreaterThanOrEqual(14);
    expect(L.unit).toBeLessThanOrEqual(24);
    expect(L.maxLines).toBe(NOTICE_LINES);
    const [, y1] = L.capsule(1);
    const [, y3] = L.capsule(3);
    expect(y3 - y1).toBeCloseTo(2 * L.lineHeight, 9);
    expect(y1).toBeGreaterThan(L.first);
    // its block sits a little above the screen's middle, on the screen
    expect(L.first).toBeGreaterThan(PRO[1] * 0.25);
    expect(y3).toBeLessThan(PRO[1] * 0.75);
    expect(noticeLayout(MINI).unit).toBeLessThanOrEqual(L.unit);
  });

  it("finds the capsule under a press — a finger's slop round it — and nowhere else", () => {
    const [cx, cy, hx, hy] = noticeLayout(PRO).capsule(2);
    expect(actAt(PRO, 2, cx, cy)).toBe(true);
    expect(actAt(PRO, 2, cx + hx, cy + hy)).toBe(true);
    expect(actAt(PRO, 2, cx, cy + hy * 3)).toBe(false);
    expect(actAt(PRO, 2, cx, noticeLayout(PRO).first)).toBe(false);
  });

  it("covers only the words' block — as wide as its widest line or its capsule, held on the screen — and keys a raster by what it says", () => {
    const [bx, by, bhx, bhy] = noticeBlock(PRO, 200, 1, true);
    expect(bx).toBe(PRO[0] / 2);
    expect(bhx).toBeGreaterThanOrEqual(100);
    expect(bhx).toBeLessThanOrEqual(PRO[0] / 2);
    expect(by - bhy).toBeGreaterThanOrEqual(0);
    expect(by + bhy).toBeLessThanOrEqual(PRO[1]);
    expect(noticeBlock(PRO, 200, 1, false)[3]).toBeLessThan(bhy);
    const spec = {
      points: PRO,
      scale: NOTICE_SCALE,
      words: { line: "iPhone 17 Pro is off", act: "Boot" },
      ink: "rgb(230 232 234)",
    };
    expect(noticeKey(spec)).toBe(noticeKey({ ...spec }));
    expect(noticeKey(spec)).not.toBe(
      noticeKey({ ...spec, words: { line: "iPhone 17 Pro is off", act: null } }),
    );
    expect(noticeKey(spec)).not.toBe(noticeKey({ ...spec, points: MINI }));
    expect(noticeKey(spec)).not.toBe(noticeKey({ ...spec, ink: "rgb(0 0 0)" }));
  });

  it("wraps a line at its spaces into at most three lines, the last cut to an ellipsis", () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapLines(measure, "The Simulator stopped", 400, 3)).toEqual(["The Simulator stopped"]);
    expect(
      wrapLines(measure, "VibeField needs Screen Recording to show the Simulator", 200, 3),
    ).toEqual(["VibeField needs", "Screen Recording to", "show the Simulator"]);
    const cut = wrapLines(
      measure,
      "one two three four five six seven eight nine ten eleven",
      100,
      3,
    );
    expect(cut).toHaveLength(3);
    expect(cut[2]?.endsWith("…")).toBe(true);
    expect(cut.every((line) => measure(line) <= 100)).toBe(true);
  });

  it("draws the words as their light over black, its canvas its block's texels — a capsule only where an act is offered", () => {
    const calls: string[] = [];
    const ctx = {
      setTransform: () => {},
      fillRect: () => calls.push("fillRect"),
      beginPath: () => {},
      roundRect: () => calls.push("roundRect"),
      stroke: () => calls.push("stroke"),
      measureText: (s: string) => ({ width: s.length * 9 }),
      fillText: (s: string) => calls.push(`text ${s}`),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      globalCompositeOperation: "source-over",
      strokeStyle: "",
      fillStyle: "",
      globalAlpha: 1,
      lineWidth: 1,
      font: "",
      textBaseline: "alphabetic",
      textAlign: "left",
    } as unknown as WordsContext;
    const canvas = { width: 1, height: 1 };
    const drawn = drawWords(canvas, ctx, {
      points: PRO,
      scale: NOTICE_SCALE,
      words: { line: "iPhone 17 Pro is off", act: "Boot" },
      ink: "rgb(230 232 234)",
    });
    expect(drawn.lines).toBe(1);
    expect(canvas.width).toBe(Math.round(2 * drawn.block[2] * NOTICE_SCALE));
    expect(canvas.height).toBe(Math.round(2 * drawn.block[3] * NOTICE_SCALE));
    expect(calls).toContain("text iPhone 17 Pro is off");
    expect(calls).toContain("text Boot");
    expect(calls).toContain("roundRect");
    calls.length = 0;
    drawWords(canvas, ctx, {
      points: PRO,
      scale: NOTICE_SCALE,
      words: { line: "The Simulator stopped", act: null },
      ink: "rgb(230 232 234)",
    });
    expect(calls).not.toContain("roundRect");
  });
});
