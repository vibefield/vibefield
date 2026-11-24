import { VITALS_FRAMES } from "@vibefield/contracts/registries";
import { describe, expect, it } from "vitest";
import {
  type LongFrameClient,
  type LongFrameEntry,
  LongFrameReporter,
  platformLongFrames,
} from "../src/page-frames";

// VT-3c (track VT, 2026-11-24; VT-D10 A) — the desk's window says its long frames to fieldd: nothing at rest, one
// report a second at most, never two on their way, and a pause when fieldd is not recording. A fake observer, a
// fake clock and a fake client: what this proves is the module's own behaviour, not the platform's observer.

interface Sent {
  method: string;
  params: unknown;
  opts: { timeoutMs?: number } | undefined;
  answer(result: unknown): void;
  refuse(error: unknown): void;
}

function setup(options: { client?: "none" } = {}) {
  let now = 1_000;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let nextTimer = 1;
  const sent: Sent[] = [];
  let hear: ((entries: readonly LongFrameEntry[]) => void) | null = null;
  let stopped = 0;
  const client: LongFrameClient = {
    request: (method, params, opts) =>
      new Promise((resolve, reject) => {
        sent.push({ method, params, opts, answer: resolve, refuse: reject });
      }),
  };
  const reporter = new LongFrameReporter({
    client: () => (options.client === "none" ? null : client),
    source: (onEntries) => {
      hear = onEntries;
      return () => {
        stopped += 1;
      };
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  });
  return {
    reporter,
    sent,
    timers,
    stopped: () => stopped,
    frames: (...durations: number[]) => hear?.(durations.map((duration) => ({ duration }))),
    /** move the clock on and run every timer that came due */
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

const settle = async (): Promise<void> => {
  for (let index = 0; index < 5; index++) await Promise.resolve();
};

describe("VT-3c — the desk's window says its long frames", () => {
  it("holds no timer and sends nothing at rest, nor for frames under the line", () => {
    const page = setup();
    expect(page.reporter.hearing).toBe(true);
    expect(page.timers.size).toBe(0);
    page.advance(60_000);
    // a frame at the line is not over it
    page.frames(16.7, 33, VITALS_FRAMES.LONG_FRAME_MS);
    expect(page.timers.size).toBe(0);
    page.advance(5_000);
    expect(page.sent).toEqual([]);
  });

  it("starts one timer at its first long frame and sends one batch within a second", async () => {
    const page = setup();
    page.frames(80);
    expect(page.timers.size).toBe(1);
    page.frames(120, 51, 20);
    // more frames do not start a second timer
    expect(page.timers.size).toBe(1);
    page.advance(VITALS_FRAMES.REPORT_DELAY_MS - 1);
    expect(page.sent).toHaveLength(0);
    page.advance(1);
    expect(page.sent).toHaveLength(1);
    expect(page.sent[0]?.method).toBe("vitals.own.report");
    expect(page.sent[0]?.params).toEqual({ own: { longFrames: 3, longFrameMaxMs: 120 } });
    expect(page.sent[0]?.opts?.timeoutMs).toBe(VITALS_FRAMES.REPORT_TIMEOUT_MS);
    page.sent[0]?.answer({ accepted: true });
    await settle();
    // idle again
    expect(page.timers.size).toBe(0);
    page.advance(10_000);
    expect(page.sent).toHaveLength(1);
  });

  it("never has two reports on their way: frames heard meanwhile wait for the answer", async () => {
    const page = setup();
    page.frames(90);
    page.advance(VITALS_FRAMES.REPORT_DELAY_MS);
    expect(page.sent).toHaveLength(1);
    page.frames(200);
    page.frames(60);
    page.advance(10_000);
    expect(page.timers.size).toBe(0);
    expect(page.sent).toHaveLength(1);
    page.sent[0]?.answer({ accepted: true });
    await settle();
    expect(page.timers.size).toBe(1);
    page.advance(VITALS_FRAMES.REPORT_DELAY_MS);
    expect(page.sent).toHaveLength(2);
    expect(page.sent[1]?.params).toEqual({ own: { longFrames: 2, longFrameMaxMs: 200 } });
  });

  it("stops counting for a while when fieldd is not recording, then counts again", async () => {
    const page = setup();
    page.frames(70);
    page.advance(VITALS_FRAMES.REPORT_DELAY_MS);
    page.sent[0]?.answer({ accepted: false });
    await settle();
    page.frames(300);
    page.advance(VITALS_FRAMES.BACKOFF_MS - VITALS_FRAMES.REPORT_DELAY_MS);
    expect(page.timers.size).toBe(0);
    expect(page.sent).toHaveLength(1);
    page.advance(VITALS_FRAMES.REPORT_DELAY_MS);
    // the pause is over: the next long frame is said, and those of the pause never are
    page.frames(75);
    page.advance(VITALS_FRAMES.REPORT_DELAY_MS);
    expect(page.sent).toHaveLength(2);
    expect(page.sent[1]?.params).toEqual({ own: { longFrames: 1, longFrameMaxMs: 75 } });
  });

  it("pauses the same way when fieldd refuses the report", async () => {
    const page = setup();
    page.frames(70);
    page.advance(VITALS_FRAMES.REPORT_DELAY_MS);
    page.sent[0]?.refuse(new Error("FORBIDDEN_SCOPE"));
    await settle();
    page.frames(90);
    page.advance(VITALS_FRAMES.REPORT_DELAY_MS * 3);
    expect(page.sent).toHaveLength(1);
  });

  it("lets go of what it counted while there is no client, and bounds what one report says", () => {
    const none = setup({ client: "none" });
    none.frames(90);
    none.advance(VITALS_FRAMES.REPORT_DELAY_MS);
    expect(none.timers.size).toBe(0);

    const page = setup();
    page.frames(
      ...Array.from({ length: VITALS_FRAMES.FRAMES_PER_REPORT_MAX + 5 }, () => 60),
      VITALS_FRAMES.FRAME_MS_MAX + 1_000,
    );
    page.advance(VITALS_FRAMES.REPORT_DELAY_MS);
    expect(page.sent[0]?.params).toEqual({
      own: {
        longFrames: VITALS_FRAMES.FRAMES_PER_REPORT_MAX,
        longFrameMaxMs: VITALS_FRAMES.FRAME_MS_MAX,
      },
    });
  });

  it("stops its observer and its timer when disposed", () => {
    const page = setup();
    page.frames(90);
    page.reporter.dispose();
    expect(page.stopped()).toBe(1);
    expect(page.timers.size).toBe(0);
    page.frames(90);
    page.advance(10_000);
    expect(page.sent).toEqual([]);
  });

  it("hears nothing where the platform counts no long frame", () => {
    const saved = globalThis.PerformanceObserver;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: an engine without the observer
      (globalThis as any).PerformanceObserver = undefined;
      expect(platformLongFrames(() => undefined)).toBeNull();
      // biome-ignore lint/suspicious/noExplicitAny: an engine that counts neither kind
      (globalThis as any).PerformanceObserver = { supportedEntryTypes: ["mark", "measure"] };
      expect(platformLongFrames(() => undefined)).toBeNull();
    } finally {
      globalThis.PerformanceObserver = saved;
    }
  });

  it("prefers the long animation frame, else the long task", () => {
    const saved = globalThis.PerformanceObserver;
    const observed: string[] = [];
    class FakeObserver {
      static supportedEntryTypes = ["longtask"];
      observe(options: { type: string }): void {
        observed.push(options.type);
      }
      disconnect(): void {}
    }
    try {
      // biome-ignore lint/suspicious/noExplicitAny: a fake engine
      (globalThis as any).PerformanceObserver = FakeObserver;
      expect(platformLongFrames(() => undefined)).not.toBeNull();
      FakeObserver.supportedEntryTypes = ["longtask", "long-animation-frame"];
      expect(platformLongFrames(() => undefined)).not.toBeNull();
      expect(observed).toEqual(["longtask", "long-animation-frame"]);
    } finally {
      globalThis.PerformanceObserver = saved;
    }
  });
});
