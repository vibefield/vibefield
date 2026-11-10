import { describe, expect, it, vi } from "vitest";
import { createQuitLatch, QUITTING_WORDS, QuitRefusal } from "../src/main/quit-latch";

// Item 290 (D4, James 2026-11-10 06:49Z; DESIGN.md §9 "The quit's words") — while a person's quit holds every pair, a
// switch and a new user are refused BEFORE they reach any coordinator, in James's words: the coordinator's own refusal
// ("fieldd is held for a stop: …") never travels up to a window. The words reach the Me menu as "Couldn't switch to
// Lee — VibeField is quitting." (`MeMenu.tsx:1138` → `refusalSentence`) and Settings → Account whole
// (`UserSwitcher.tsx:84`); the reason is the log's.
describe("the quit's latch (item 290, D4)", () => {
  it("while held, a switch and a new user are refused in James's words, never the service's, and the log hears which", () => {
    const onRefused = vi.fn();
    const latch = createQuitLatch({ onRefused });
    latch.hold();
    expect(latch.held).toBe(true);
    expect(() => latch.refuse("switch")).toThrow(QuitRefusal);
    let caught: unknown;
    try {
      latch.refuse("new-user");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QuitRefusal);
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
});
