import { describe, expect, it, vi } from "vitest";
import {
  installWindowChords,
  type WindowChordInput,
  type WindowChordTarget,
  windowChordOf,
} from "../src/main/window-chords";

// AL-9 (AL-D14/D15): ⌘Q and ⌃⌘F are main's, taken before any page is offered
// them, because a terminal pane's ghosttea claimed both and the menu never heard
// them (`draft/thinking-app-lifecycle.md` §9). Whether macOS DELIVERS the chord to
// `before-input-event` is a physical question no row here can answer (memory
// `keybindings-need-a-delivery-probe`); ⌃⌘A's delivery through the same door is
// measured, and James's rows 1 and 5 measure these two.

const key = (over: Partial<WindowChordInput> = {}): WindowChordInput => ({
  type: "keyDown",
  key: "q",
  control: false,
  meta: true,
  alt: false,
  shift: false,
  ...over,
});

describe("windowChordOf — ⌘Q and ⌃⌘F on macOS", () => {
  it("⌘Q is quit on keyDown only, either case, never on auto-repeat", () => {
    expect(windowChordOf(key(), "darwin")).toBe("quit");
    expect(windowChordOf(key({ key: "Q" }), "darwin")).toBe("quit");
    expect(windowChordOf(key({ type: "keyUp" }), "darwin")).toBeNull();
    expect(windowChordOf(key({ isAutoRepeat: true }), "darwin")).toBeNull();
  });

  it("⌃⌘F is full screen; ⌘F (search's) and ⌃⌘Q are not", () => {
    expect(windowChordOf(key({ key: "f", control: true }), "darwin")).toBe("full-screen");
    expect(windowChordOf(key({ key: "F", control: true }), "darwin")).toBe("full-screen");
    expect(windowChordOf(key({ key: "f" }), "darwin")).toBeNull();
    expect(windowChordOf(key({ control: true }), "darwin")).toBeNull();
  });

  it("is never ⇧⌘Q, ⌥⌘Q, a bare Q or ⌃Q — a person's own binding on those stays theirs", () => {
    expect(windowChordOf(key({ shift: true }), "darwin")).toBeNull();
    expect(windowChordOf(key({ alt: true }), "darwin")).toBeNull();
    expect(windowChordOf(key({ meta: false }), "darwin")).toBeNull();
    expect(windowChordOf(key({ meta: false, control: true }), "darwin")).toBeNull();
    expect(windowChordOf(key({ key: "f", control: true, shift: true }), "darwin")).toBeNull();
  });

  it("takes nothing off the Mac until the Windows port measures it", () => {
    expect(windowChordOf(key(), "win32")).toBeNull();
    expect(windowChordOf(key({ meta: false, control: true, shift: true }), "linux")).toBeNull();
    expect(windowChordOf(key({ key: "f", control: true }), "linux")).toBeNull();
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

  it("⌘Q quits once and keeps the key from the page and the menu", () => {
    const { target, fire } = fakeWindow();
    const quit = vi.fn();
    installWindowChords(target, { quit }, "darwin");
    expect(fire(key())).toBe(true);
    expect(quit).toHaveBeenCalledTimes(1);
    // the release is not a second quit, and is not swallowed
    expect(fire(key({ type: "keyUp" }))).toBe(false);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("⌃⌘F toggles the window's full screen, in and out, and is swallowed", () => {
    const { target, fire, states } = fakeWindow();
    const quit = vi.fn();
    installWindowChords(target, { quit }, "darwin");
    expect(fire(key({ key: "f", control: true }))).toBe(true);
    expect(fire(key({ key: "f", control: true }))).toBe(true);
    expect(states).toEqual([true, false]);
    expect(quit).not.toHaveBeenCalled();
  });

  it("lets every other key through untouched — ⌘F stays search's, ⌘W stays the deck's", () => {
    const { target, fire, states } = fakeWindow();
    const quit = vi.fn();
    installWindowChords(target, { quit }, "darwin");
    expect(fire(key({ key: "f" }))).toBe(false);
    expect(fire(key({ key: "w" }))).toBe(false);
    expect(fire(key({ key: "Meta", meta: true }))).toBe(false);
    expect(quit).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });
});
