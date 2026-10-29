import { describe, expect, it, vi } from "vitest";
import {
  installWindowChords,
  type WindowChordActs,
  type WindowChordInput,
  type WindowChordTarget,
  windowChordOf,
} from "../src/main/window-chords";

// The chords main takes before any page is offered them: ⌃⌘A (SNAP-3), because
// the canvas keymap's ⌘A select-all swallowed the menu's accelerator, and ⌘Q and
// ⌃⌘F (AL-9, AL-D14/D15), because a terminal pane's ghosttea claimed both and the
// menu never heard them (`draft/thinking-app-lifecycle.md` §9). Whether macOS
// DELIVERS a chord to `before-input-event` is a physical question no row here can
// answer (memory `keybindings-need-a-delivery-probe`); ⌃⌘A's delivery through
// this door is measured, and James's rows 1 and 5 measure the other two.

const key = (over: Partial<WindowChordInput> = {}): WindowChordInput => ({
  type: "keyDown",
  key: "q",
  code: "KeyQ",
  control: false,
  meta: true,
  alt: false,
  shift: false,
  ...over,
});

const screenshotKey = (over: Partial<WindowChordInput> = {}): WindowChordInput =>
  key({ key: "a", code: "KeyA", control: true, ...over });

describe("windowChordOf — ⌘Q, ⌃⌘F and ⌃⌘A on macOS", () => {
  it("⌘Q is quit on keyDown, either case; a repeat still names the chord", () => {
    expect(windowChordOf(key(), "darwin")).toBe("quit");
    expect(windowChordOf(key({ key: "Q" }), "darwin")).toBe("quit");
    expect(windowChordOf(key({ type: "keyUp" }), "darwin")).toBeNull();
    // the installer swallows a repeat without acting on it (below)
    expect(windowChordOf(key({ isAutoRepeat: true }), "darwin")).toBe("quit");
  });

  it("⌃⌘F is full screen; ⌘F (search's) and ⌃⌘Q are not", () => {
    expect(windowChordOf(key({ key: "f", code: "KeyF", control: true }), "darwin")).toBe(
      "full-screen",
    );
    expect(windowChordOf(key({ key: "F", code: "KeyF", control: true }), "darwin")).toBe(
      "full-screen",
    );
    expect(windowChordOf(key({ key: "f", code: "KeyF" }), "darwin")).toBeNull();
    expect(windowChordOf(key({ control: true }), "darwin")).toBeNull();
  });

  it("⌃⌘A is the screenshot; not ⌘A (select all), ⌃A, ⌃⌘⇧A or ⌃⌥⌘A", () => {
    expect(windowChordOf(screenshotKey(), "darwin")).toBe("screenshot");
    expect(windowChordOf(screenshotKey({ key: "A" }), "darwin")).toBe("screenshot");
    expect(windowChordOf(screenshotKey({ control: false }), "darwin")).toBeNull();
    expect(windowChordOf(screenshotKey({ meta: false }), "darwin")).toBeNull();
    expect(windowChordOf(screenshotKey({ shift: true }), "darwin")).toBeNull();
    expect(windowChordOf(screenshotKey({ alt: true }), "darwin")).toBeNull();
    expect(windowChordOf(screenshotKey({ key: "s", code: "KeyS" }), "darwin")).toBeNull();
  });

  it("is never ⇧⌘Q, ⌥⌘Q, a bare Q or ⌃Q — a person's own binding on those stays theirs", () => {
    expect(windowChordOf(key({ shift: true }), "darwin")).toBeNull();
    expect(windowChordOf(key({ alt: true }), "darwin")).toBeNull();
    expect(windowChordOf(key({ meta: false }), "darwin")).toBeNull();
    expect(windowChordOf(key({ meta: false, control: true }), "darwin")).toBeNull();
    expect(
      windowChordOf(key({ key: "f", code: "KeyF", control: true, shift: true }), "darwin"),
    ).toBeNull();
  });

  it("on a non-Latin layout, names the physical key's letter, as macOS and ghosttea do", () => {
    // Russian: the Q, F and A keys type й, а and ф
    expect(windowChordOf(key({ key: "й", code: "KeyQ" }), "darwin")).toBe("quit");
    expect(windowChordOf(key({ key: "а", code: "KeyF", control: true }), "darwin")).toBe(
      "full-screen",
    );
    expect(windowChordOf(screenshotKey({ key: "ф", code: "KeyA" }), "darwin")).toBe("screenshot");
    // the fallback needs a letter key's physical code; the layout's letter alone names nothing
    const { code: _code, ...noPhysicalKey } = key({ key: "й" });
    expect(windowChordOf(noPhysicalKey, "darwin")).toBeNull();
    expect(windowChordOf(key({ key: "й", code: "Digit1" }), "darwin")).toBeNull();
  });

  it("on a Latin layout, the layout's own letter decides, never the physical key", () => {
    // Dvorak: the Q key types ', and Q sits on the X key
    expect(windowChordOf(key({ key: "'", code: "KeyQ" }), "darwin")).toBeNull();
    expect(windowChordOf(key({ key: "q", code: "KeyX" }), "darwin")).toBe("quit");
  });

  it("off the Mac takes only the screenshot, as Alt+A (SNAP-D3's spelling)", () => {
    expect(windowChordOf(key(), "win32")).toBeNull();
    expect(windowChordOf(key({ meta: false, control: true, shift: true }), "linux")).toBeNull();
    expect(windowChordOf(key({ key: "f", code: "KeyF", control: true }), "linux")).toBeNull();
    const altA = screenshotKey({ control: false, meta: false, alt: true });
    expect(windowChordOf(altA, "win32")).toBe("screenshot");
    expect(windowChordOf(screenshotKey(), "win32")).toBeNull();
    expect(windowChordOf(altA, "darwin")).toBeNull();
  });
});

describe("installWindowChords — before the page, and swallowed", () => {
  function fakeWindow(fullScreen = false): {
    target: WindowChordTarget;
    fire: (input: WindowChordInput) => boolean;
    states: boolean[];
  } {
    let listener: ((event: { preventDefault: () => void }, input: unknown) => void) | null = null;
    const states: boolean[] = [];
    let current = fullScreen;
    const target = {
      webContents: {
        on: (event: string, handler: typeof listener) => {
          if (event === "before-input-event") listener = handler;
        },
      },
      isFullScreen: () => current,
      setFullScreen: (flag: boolean) => {
        current = flag;
        states.push(flag);
      },
    } as unknown as WindowChordTarget;
    return {
      target,
      fire: (input) => {
        let prevented = false;
        listener?.({ preventDefault: () => (prevented = true) }, input);
        return prevented;
      },
      states,
    };
  }

  /** A window with every act wired, as the product window with its helper. */
  function wired() {
    const fake = fakeWindow();
    const acts = { quit: vi.fn(), screenshot: vi.fn() } satisfies WindowChordActs;
    installWindowChords(fake.target, acts, "darwin");
    return { ...fake, ...acts };
  }

  it("⌘Q quits once and keeps the key from the page and the menu", () => {
    const { fire, quit } = wired();
    expect(fire(key())).toBe(true);
    expect(quit).toHaveBeenCalledTimes(1);
    // the release is not a second quit, and is not swallowed
    expect(fire(key({ type: "keyUp" }))).toBe(false);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("⌃⌘F toggles the window's full screen, in and out, and is swallowed", () => {
    const { fire, states, quit } = wired();
    expect(fire(key({ key: "f", code: "KeyF", control: true }))).toBe(true);
    expect(fire(key({ key: "f", code: "KeyF", control: true }))).toBe(true);
    expect(states).toEqual([true, false]);
    expect(quit).not.toHaveBeenCalled();
  });

  it("⌃⌘A captures once and is swallowed, so the canvas never selects all", () => {
    const { fire, screenshot, quit } = wired();
    expect(fire(screenshotKey())).toBe(true);
    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it("a held chord's repeats are swallowed and act on nothing", () => {
    const { fire, quit, states, screenshot } = wired();
    // held ⌘Q: one quit; no repeat reaches a pane to put the terminals away
    expect(fire(key())).toBe(true);
    expect(fire(key({ isAutoRepeat: true }))).toBe(true);
    expect(fire(key({ isAutoRepeat: true }))).toBe(true);
    expect(quit).toHaveBeenCalledTimes(1);
    // held ⌃⌘F: one toggle; no repeat reaches the menu to flip it back
    const fullScreen = key({ key: "f", code: "KeyF", control: true });
    expect(fire(fullScreen)).toBe(true);
    expect(fire({ ...fullScreen, isAutoRepeat: true })).toBe(true);
    expect(states).toEqual([true]);
    // held ⌃⌘A: one capture; no repeat reaches the canvas's select-all
    expect(fire(screenshotKey())).toBe(true);
    expect(fire(screenshotKey({ isAutoRepeat: true }))).toBe(true);
    expect(screenshot).toHaveBeenCalledTimes(1);
  });

  it("with no capture to run (no helper, Studio's window), ⌃⌘A is left to the page and the menu", () => {
    const fake = fakeWindow();
    const quit = vi.fn();
    installWindowChords(fake.target, { quit }, "darwin");
    expect(fake.fire(screenshotKey())).toBe(false);
    expect(fake.fire(screenshotKey({ isAutoRepeat: true }))).toBe(false);
    expect(fake.fire(key())).toBe(true);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("lets every other key through untouched — ⌘F stays search's, ⌘W the deck's, ⌘A the canvas's", () => {
    const { fire, quit, states, screenshot } = wired();
    expect(fire(key({ key: "f", code: "KeyF" }))).toBe(false);
    expect(fire(key({ key: "w", code: "KeyW" }))).toBe(false);
    expect(fire(screenshotKey({ control: false }))).toBe(false);
    expect(fire(key({ key: "Meta", code: "MetaLeft" }))).toBe(false);
    expect(fire(key({ key: "Shift", code: "ShiftLeft", meta: false }))).toBe(false);
    expect(quit).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });
});
