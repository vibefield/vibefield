import { describe, expect, it, vi } from "vitest";
import {
  createQuitLatch,
  latchedSwitch,
  QUITTING_WORDS,
  QuitRefusalError,
} from "../src/main/quit-latch";

// Item 290 (D4, James 2026-11-10 06:49Z; DESIGN.md §9 "The quit's words") — while a person's quit holds every pair, a
// switch and a new user are refused BEFORE they reach any coordinator, in James's words: the coordinator's own refusal
// ("fieldd is held for a stop: …") never travels up to a window; the reason is the log's. Since item 315 the window
// ignores a press while the quit's hold stands (its desktop state's `quitting`, told by `onHeld`), so no door draws
// these words; that a refusal crossing the preload carries no class's name is `preload-users.test.ts`'s to hold
// (item 314).
describe("the quit's latch (item 290, D4)", () => {
  it("while held, a switch and a new user are refused in James's words, never the service's, and the log hears which", () => {
    const onRefused = vi.fn();
    const latch = createQuitLatch({ onRefused });
    latch.hold();
    expect(latch.held).toBe(true);
    expect(() => latch.refuse("switch")).toThrow(QuitRefusalError);
    let caught: unknown;
    try {
      latch.refuse("new-user");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QuitRefusalError);
    expect((caught as Error).message).toBe("VibeField is quitting");
    expect((caught as Error).message).not.toMatch(/fieldd/i);
    expect(QUITTING_WORDS).toBe("VibeField is quitting");
    expect(onRefused.mock.calls).toEqual([["switch"], ["new-user"]]);
  });

  it("refuses nothing before the hold or after its release", () => {
    const onRefused = vi.fn();
    const latch = createQuitLatch({ onRefused });
    expect(() => latch.refuse("switch")).not.toThrow();
    latch.hold();
    latch.release();
    expect(latch.held).toBe(false);
    expect(() => latch.refuse("new-user")).not.toThrow();
    expect(onRefused).not.toHaveBeenCalled();
  });

  // Item 315 — the window learns of the hold from main's desktop state; the latch says when it is set and released.
  it("tells the window's state of the hold and of its release, once each, and never of a refusal", () => {
    const onHeld = vi.fn();
    const latch = createQuitLatch({ onHeld });
    latch.hold();
    expect(() => latch.refuse("switch")).toThrow(QuitRefusalError);
    latch.release();
    expect(onHeld.mock.calls).toEqual([[true], [false]]);
  });
});

// Item 290 (VF-PM's bound 3, 09:57:55Z) — a switch already starting when the quit's hold lands: its pair answers, and
// the switch is refused before it swaps the window, so nothing re-targets mid-quit. The pair it started is left up; the
// quit's second read stops it (`quit-gate.test.ts`, "a pair that comes up during the quit"). Each row drives the seam
// with its own latch, so it holds `latchedSwitch` alone.
describe("a switch under the quit's latch (item 290, latchedSwitch)", () => {
  function latchOf() {
    const state = { held: false };
    const refuse = vi.fn(() => {
      if (state.held) throw new QuitRefusalError();
    });
    return { state, latch: { refuse } };
  }

  it("a switch already starting when the hold lands never swaps: refused once its pair has answered", async () => {
    const { state, latch } = latchOf();
    let up!: (pair: string) => void;
    const start = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          up = resolve;
        }),
    );
    const swap = vi.fn((pair: string) => `swapped to ${pair}`);
    const switching = latchedSwitch(latch, "switch", start, swap);
    expect(start).toHaveBeenCalledTimes(1);
    state.held = true;
    up("Lee's pair");
    await expect(switching).rejects.toBeInstanceOf(QuitRefusalError);
    expect(swap).not.toHaveBeenCalled();
    expect(latch.refuse.mock.calls).toEqual([["switch"], ["switch"]]);
  });

  it("refused before it starts while the hold stands: nothing starts", async () => {
    const { state, latch } = latchOf();
    state.held = true;
    const start = vi.fn(async () => "Lee's pair");
    const swap = vi.fn();
    await expect(latchedSwitch(latch, "switch", start, swap)).rejects.toBeInstanceOf(
      QuitRefusalError,
    );
    expect(start).not.toHaveBeenCalled();
    expect(swap).not.toHaveBeenCalled();
  });

  it("with no hold it starts, then swaps with what started, and answers the swap's", async () => {
    const { latch } = latchOf();
    const swap = vi.fn((pair: string) => `swapped to ${pair}`);
    await expect(latchedSwitch(latch, "switch", async () => "Lee's pair", swap)).resolves.toBe(
      "swapped to Lee's pair",
    );
    expect(swap).toHaveBeenCalledWith("Lee's pair");
  });
});
