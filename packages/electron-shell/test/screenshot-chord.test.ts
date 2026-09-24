import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  installScreenshotChord,
  isScreenshotChord,
  type ScreenshotChordInput,
} from "../src/main/screenshot-chord";

const chord = (over: Partial<ScreenshotChordInput> = {}): ScreenshotChordInput => ({
  type: "keyDown",
  key: "a",
  control: true,
  meta: true,
  alt: false,
  shift: false,
  ...over,
});

describe("isScreenshotChord — ⌃⌘A on macOS, Alt+A elsewhere (SNAP-D3's spelling)", () => {
  it("matches the darwin chord on keyDown only, either case, never on auto-repeat", () => {
    expect(isScreenshotChord(chord(), "darwin")).toBe(true);
    expect(isScreenshotChord(chord({ key: "A" }), "darwin")).toBe(true);
    expect(isScreenshotChord(chord({ type: "keyUp" }), "darwin")).toBe(false);
    expect(isScreenshotChord(chord({ isAutoRepeat: true }), "darwin")).toBe(false);
  });

  it("is not ⌘A (select all), ⌃A, ⌃⌘⇧A or ⌃⌥⌘A", () => {
    expect(isScreenshotChord(chord({ control: false }), "darwin")).toBe(false);
    expect(isScreenshotChord(chord({ meta: false }), "darwin")).toBe(false);
    expect(isScreenshotChord(chord({ shift: true }), "darwin")).toBe(false);
    expect(isScreenshotChord(chord({ alt: true }), "darwin")).toBe(false);
    expect(isScreenshotChord(chord({ key: "s" }), "darwin")).toBe(false);
  });

  it("is Alt+A on other platforms, and the darwin chord is not", () => {
    expect(isScreenshotChord(chord({ control: false, meta: false, alt: true }), "win32")).toBe(
      true,
    );
    expect(isScreenshotChord(chord(), "win32")).toBe(false);
    expect(isScreenshotChord(chord({ control: false, meta: false, alt: true }), "darwin")).toBe(
      false,
    );
  });
});

describe("installScreenshotChord — before the page, and swallowed", () => {
  function fakeInput(): {
    contents: WebContents;
    fire: (input: ScreenshotChordInput) => boolean;
  } {
    let listener: ((event: { preventDefault: () => void }, input: unknown) => void) | null = null;
    const contents = {
      on: (event: string, handler: typeof listener) => {
        if (event === "before-input-event") listener = handler;
      },
    } as unknown as WebContents;
    return {
      contents,
      fire: (input) => {
        let prevented = false;
        listener?.({ preventDefault: () => (prevented = true) }, input);
        return prevented;
      },
    };
  }

  it("captures once per chord and keeps the key from the page and the menu", () => {
    const { contents, fire } = fakeInput();
    const capture = vi.fn();
    installScreenshotChord(contents, capture, "darwin");
    expect(fire(chord())).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    // the release is not a second capture, and is not swallowed
    expect(fire(chord({ type: "keyUp" }))).toBe(false);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("lets every other key through untouched — ⌘A stays the canvas's select-all", () => {
    const { contents, fire } = fakeInput();
    const capture = vi.fn();
    installScreenshotChord(contents, capture, "darwin");
    expect(fire(chord({ control: false }))).toBe(false);
    expect(fire(chord({ key: "Shift", control: false, meta: false }))).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });
});
