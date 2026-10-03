// @vitest-environment happy-dom
/**
 * GT-D21 — the chords VibeField keeps, and why they have to be caught where
 * they are. A focused Godview pane is ghosttea's: its workspace listens on the
 * window's capture phase and its terminal surface consumes at the target, both
 * stopping the event. These cases stand a pane in for that surface — a target
 * listener that stops propagation, as `TerminalSurface.onKeyDown` does — and
 * hold two facts: the product handler still hears the chord, and the pane
 * never does.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSettingsChord } from "../src/field/me-menu-wiring";
import {
  isClipboardTrayChord,
  isCommandPaletteChord,
  listenForProductChord,
  PRODUCT_CHORDS,
} from "../src/field/product-chords";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pane: HTMLElement | null = null;
let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  pane?.remove();
  root = null;
  host = null;
  pane = null;
});

/** A focused pane that consumes every key, as a ghosttea terminal does. */
function focusedPane(onKey: (event: KeyboardEvent) => void): HTMLElement {
  pane = document.createElement("div");
  pane.tabIndex = 0;
  pane.addEventListener("keydown", (event) => {
    onKey(event);
    event.preventDefault();
    event.stopPropagation();
  });
  document.body.appendChild(pane);
  pane.focus();
  return pane;
}

function press(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("the product chords (GT-D21)", () => {
  it("names each chord in Ghostty's spelling, beside the Ghostty default it overrides", () => {
    expect(PRODUCT_CHORDS.map((chord) => chord.trigger)).toEqual([
      "super+k",
      "super+,",
      "super+shift+v",
      // One Frame FR-2 (§11): Godview's New terminal, over ghostty's new_tab
      "super+t",
      // One Frame FR-1 (FC-D4): the four views, over ghostty's goto_tab
      "super+1",
      "super+2",
      "super+3",
      "super+4",
    ]);
    expect(
      isCommandPaletteChord({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(true);
    expect(
      isCommandPaletteChord({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(false);
    expect(
      isClipboardTrayChord({
        key: "V",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        repeat: false,
      }),
    ).toBe(true);
    expect(
      isClipboardTrayChord({
        key: "v",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(false);
  });

  it("hears ⌘K over a focused pane, and the pane never sees it", () => {
    const paneHeard = vi.fn();
    const target = focusedPane(paneHeard);
    const palette = vi.fn();
    const stop = listenForProductChord(isCommandPaletteChord, palette);

    press(target, { key: "k", metaKey: true });
    // An ordinary key still belongs to the pane.
    press(target, { key: "l", metaKey: false });

    expect(palette).toHaveBeenCalledTimes(1);
    expect(paneHeard.mock.calls.map(([event]) => (event as KeyboardEvent).key)).toEqual(["l"]);
    stop();
  });

  it("toggles Settings with ⌘, over a focused pane (ghosttea's open_config never runs)", () => {
    const paneHeard = vi.fn();
    const target = focusedPane(paneHeard);
    const onOpen = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Harness(): null {
      useSettingsChord(false, onOpen, vi.fn());
      return null;
    }
    act(() => root?.render(<Harness />));

    press(target, { key: ",", metaKey: true });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(paneHeard).not.toHaveBeenCalled();
  });

  it("was deaf to ⌘K in the bubble phase — the failure this table fixes", () => {
    // The control: the listener shape ⌘K used to have. A pane that consumes
    // the key leaves a bubble-phase window listener with nothing to hear.
    const target = focusedPane(() => undefined);
    const bubble = vi.fn();
    window.addEventListener("keydown", bubble);
    press(target, { key: "k", metaKey: true });
    window.removeEventListener("keydown", bubble);
    expect(bubble).not.toHaveBeenCalled();
  });
});
