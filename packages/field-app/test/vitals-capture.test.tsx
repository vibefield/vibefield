// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VitalsCaptureState } from "@vibefield/contracts/vitals";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VitalsPlate } from "../src/design-system/VitalsPreview";
import {
  VITALS_CAPTURE_FIXTURE_STATES,
  vitalsCaptureFixture,
} from "../src/design-system/vitals-capture-fixtures";
import { vitalsFixtureModel } from "../src/design-system/vitals-fixtures";
import { Vitals } from "../src/vitals/Vitals";
import { VitalsCapture } from "../src/vitals/VitalsCapture";
import { VitalsView } from "../src/vitals/VitalsView";
import {
  CAPTURE_FAILURE_WORDS,
  CAPTURE_KIND_WORDS,
  CAPTURE_WORDS,
  failedWords,
  fileSizeWords,
  frameCountWords,
  lengthWords,
  runningWords,
  savedWords,
} from "../src/vitals/vitals-capture-words";
import type { VitalsCapturesDoor } from "../src/vitals/vitals-captures-door";

// VT-5 (track VT, 2026-11-24; DESIGN.md §8 "Vitals", "Captures"; §9 "Vitals' words") — the capture control: its words
// quoted from DESIGN.md, its four states, the intents it hands out, and its controller over a fake door (the Vitals
// window's preload). No Electron here: what main and fieldd do with an arm is `electron-shell`'s and `fieldd`'s tests.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const here = dirname(fileURLToPath(import.meta.url));
const design = (): string =>
  readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const render = (element: Parameters<Root["render"]>[0]): void => act(() => root.render(element));
const text = (selector: string): string[] =>
  [...host.querySelectorAll(selector)].map((el) => el.textContent ?? "");
const button = (words: string): HTMLButtonElement => {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.textContent === words,
  );
  if (found === undefined) throw new Error(`no button "${words}"`);
  return found;
};

const SAVED_FRAMES = {
  state: "saved",
  kind: "frames",
  seconds: 10,
  name: "frames-20261124T140700000Z.json",
  bytes: 214,
  frames: {
    frames: 581,
    seconds: 10.02,
    meanFps: 58,
    longestMs: 41.2,
    slowFrames: 12,
    longFrames: 2,
    gaps: 0,
  },
} as const satisfies VitalsCaptureState;

describe("VT-5 — the captures' words are DESIGN.md's", () => {
  it("says what, how long, the pill and its running word as §9 does", () => {
    const doc = design();
    for (const words of [
      ...Object.values(CAPTURE_KIND_WORDS),
      CAPTURE_WORDS.whatLabel,
      CAPTURE_WORDS.lengthLabel,
      lengthWords(10),
      lengthWords(20),
      lengthWords(30),
      CAPTURE_WORDS.capture,
      CAPTURE_WORDS.capturing,
      CAPTURE_WORDS.reveal,
      runningWords("trace", 12),
    ]) {
      expect(doc).toContain(`"${words}"`);
    }
    expect(runningWords("trace", 12)).toBe("App trace · 12 s left");
    // §8 names the three kinds and the pill in bold
    for (const words of [...Object.values(CAPTURE_KIND_WORDS), "Capture", "Capturing…"]) {
      expect(doc).toContain(`**${words}**`);
    }
  });

  it("says a saved file's size and one line of what it holds, as §9 quotes them", () => {
    const doc = design();
    expect(frameCountWords(SAVED_FRAMES.frames)).toBe(
      "58 frames a second · longest 41 ms · 12 over 16.7 ms · 2 over 50 ms",
    );
    const trace = savedWords({ ...SAVED_FRAMES, kind: "trace", seconds: 20, bytes: 4 * 1024 ** 2 });
    const profile = savedWords({ ...SAVED_FRAMES, kind: "profile", seconds: 20, bytes: 1 });
    expect(trace).toBe("4 MB · 20 s of the app · opens in Perfetto");
    expect(profile).toBe("1 KB · 20 s of fieldd · opens in Chrome's DevTools");
    for (const words of [
      frameCountWords(SAVED_FRAMES.frames),
      CAPTURE_WORDS.noFrames,
      "20 s of the app · opens in Perfetto",
      "20 s of fieldd · opens in Chrome's DevTools",
      fileSizeWords(4 * 1024 ** 2),
      CAPTURE_WORDS.traceNote,
    ]) {
      expect(doc).toContain(`"${words}"`);
    }
    // a small file is never "0 KB"
    expect(fileSizeWords(0)).toBe("1 KB");
    expect(frameCountWords({ ...SAVED_FRAMES.frames, frames: 0 })).toBe(CAPTURE_WORDS.noFrames);
  });

  it("says every reason a capture was not made, by its kind, as §9 lists them", () => {
    const doc = design();
    for (const words of Object.values(CAPTURE_FAILURE_WORDS)) expect(doc).toContain(`"${words}"`);
    expect(failedWords("profile", "no-fieldd")).toBe("fieldd profile · fieldd isn't answering.");
  });
});

describe("VT-5 — the control", () => {
  it("at rest: three kinds, three lengths, the pill, and the trace's note while a trace is chosen", () => {
    const onArm = vi.fn();
    render(createElement(VitalsCapture, { state: { state: "idle" }, onArm, onReveal: vi.fn() }));
    expect(text(".vf-ui-segmented button")).toEqual([
      "App trace",
      "fieldd profile",
      "Desk frames",
      "10 s",
      "20 s",
      "30 s",
    ]);
    expect(text(".vf-vitals-capture__note")).toEqual([CAPTURE_WORDS.traceNote]);
    act(() => button("Desk frames").click());
    expect(text(".vf-vitals-capture__note")).toEqual([]);
    act(() => button("20 s").click());
    act(() => button("Capture").click());
    expect(onArm).toHaveBeenCalledExactlyOnceWith("frames", 20);
  });

  it("while one runs: the pill says so with its hits off, both controls are off, and the seconds left are said", () => {
    const onArm = vi.fn();
    render(
      createElement(VitalsCapture, {
        state: { state: "running", kind: "profile", seconds: 30, endsAt: 0 },
        secondsLeft: 12,
        onArm,
        onReveal: vi.fn(),
      }),
    );
    const pill = button("Capturing…");
    expect(pill.disabled).toBe(true);
    expect(pill.hasAttribute("data-running")).toBe(true);
    const fieldsets = [...host.querySelectorAll<HTMLFieldSetElement>("fieldset")];
    expect(fieldsets.map((set) => set.disabled)).toEqual([true, true]);
    // the controls show what runs, not the person's pick
    expect(host.querySelector('button[data-id="profile"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(host.querySelector('button[data-id="30"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(text(".vf-vitals-capture__line")).toEqual(["fieldd profile · 12 s left"]);
    expect(text(".vf-vitals-capture__note")).toEqual([]);
    pill.click();
    expect(onArm).not.toHaveBeenCalled();
  });

  it("after: the file's name, its size and its line, and Show in Finder asks for that name", () => {
    const onReveal = vi.fn();
    render(createElement(VitalsCapture, { state: SAVED_FRAMES, onArm: vi.fn(), onReveal }));
    expect(text(".vf-vitals-capture__file")).toEqual([SAVED_FRAMES.name]);
    expect(text(".vf-vitals-capture__holds")).toEqual([
      "1 KB · 58 frames a second · longest 41 ms · 12 over 16.7 ms · 2 over 50 ms",
    ]);
    act(() => button("Show in Finder").click());
    expect(onReveal).toHaveBeenCalledExactlyOnceWith(SAVED_FRAMES.name);
  });

  it("a capture not made says its kind and why, never in red", () => {
    render(
      createElement(VitalsCapture, {
        state: { state: "failed", kind: "frames", reason: "no-desk" },
        onArm: vi.fn(),
        onReveal: vi.fn(),
      }),
    );
    expect(text(".vf-vitals-capture__line")).toEqual([
      "Desk frames · The desk's window isn't open.",
    ]);
    const sheet = readFileSync(join(here, "..", "src", "vitals", "vitals-capture.css"), "utf8");
    expect(sheet).not.toMatch(/--vf-(red|danger|error)/);
    expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("is drawn in the view only when a host hands it, at the left of the state's line", () => {
    render(createElement(VitalsView, { model: vitalsFixtureModel(), logs: [] }));
    expect(host.querySelector(".vf-vitals-capture")).toBeNull();
    render(
      createElement(VitalsView, {
        model: vitalsFixtureModel(),
        logs: [],
        capture: vitalsCaptureFixture("capture-idle"),
      }),
    );
    const top = host.querySelector(".vf-vitals__top");
    expect(top?.firstElementChild?.classList.contains("vf-vitals-capture")).toBe(true);
    expect(top?.lastElementChild?.classList.contains("vf-vitals__state")).toBe(true);
  });

  it("stands a plate per state on the shipping view", () => {
    for (const state of VITALS_CAPTURE_FIXTURE_STATES) {
      render(createElement(VitalsPlate, { state }));
      expect(
        host.querySelector(".vf-ds-vitals-plate > .vf-vitals .vf-vitals-capture"),
      ).not.toBeNull();
    }
  });
});

class FakeDoor implements VitalsCapturesDoor {
  handler: ((state: unknown) => void) | null = null;
  released = 0;
  arms: [string, number][] = [];
  reveals: string[] = [];
  constructor(private readonly now: unknown) {}
  current = async (): Promise<unknown> => this.now;
  arm = async (kind: string, seconds: number): Promise<unknown> => {
    this.arms.push([kind, seconds]);
    return { accepted: true };
  };
  reveal = async (name: string): Promise<unknown> => {
    this.reveals.push(name);
    return { revealed: true };
  };
  onState = (handler: (state: unknown) => void): (() => void) => {
    this.handler = handler;
    return () => {
      this.released += 1;
    };
  };
}

describe("VT-5 — the control's controller, over the window's door", () => {
  const door = (now: unknown) => new FakeDoor(now);
  const mount = async (captures: FakeDoor | undefined): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(Vitals, {
          door: {
            subscribe: () => () => undefined,
            ...(captures === undefined ? {} : { captures }),
          },
        }),
      );
      await Promise.resolve();
    });
  };

  it("draws no control for a host that offers no door", async () => {
    await mount(undefined);
    expect(host.querySelector(".vf-vitals-capture")).toBeNull();
  });

  it("asks the state on mount, hears every change, drops what does not parse, and lets go on unmount", async () => {
    const captures = door(SAVED_FRAMES);
    await mount(captures);
    expect(text(".vf-vitals-capture__file")).toEqual([SAVED_FRAMES.name]);
    act(() => captures.handler?.({ state: "running", kind: "trace", seconds: 99, endsAt: 0 }));
    expect(text(".vf-vitals-capture__file")).toEqual([SAVED_FRAMES.name]);
    act(() => captures.handler?.({ state: "failed", kind: "trace", reason: "busy" }));
    expect(text(".vf-vitals-capture__line")).toEqual(["App trace · Another capture is running."]);
    act(() => button("Capture").click());
    expect(captures.arms).toEqual([["trace", 10]]);
    act(() => captures.handler?.(SAVED_FRAMES));
    act(() => button("Show in Finder").click());
    expect(captures.reveals).toEqual([SAVED_FRAMES.name]);
    act(() => root.unmount());
    expect(captures.released).toBe(1);
    root = createRoot(host);
  });

  it("counts a running capture down by one clock, and holds no timer at rest", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(1_000_000);
    const captures = door({ state: "idle" });
    await mount(captures);
    expect(vi.getTimerCount()).toBe(0);
    act(() =>
      captures.handler?.({ state: "running", kind: "frames", seconds: 20, endsAt: 1_020_000 }),
    );
    expect(text(".vf-vitals-capture__line")).toEqual(["Desk frames · 20 s left"]);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(8_000));
    expect(text(".vf-vitals-capture__line")).toEqual(["Desk frames · 12 s left"]);
    act(() => captures.handler?.(SAVED_FRAMES));
    expect(vi.getTimerCount()).toBe(0);
  });
});
