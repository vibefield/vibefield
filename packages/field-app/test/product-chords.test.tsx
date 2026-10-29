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
  isCardsChord,
  isCommandPaletteChord,
  isCopyChord,
  isSearchChord,
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
      // the Peek (GV-D10, 2026-10-08): search, over ghostty's start_search
      "super+f",
      // the desk's Copy (HN-D3): over ghostty's copy_to_clipboard, which keeps it in a pane
      "super+c",
      // One Frame FR-1 (FC-D4): the four views, over ghostty's goto_tab
      "super+1",
      "super+2",
      "super+3",
      "super+4",
      // AL-9 (AL-D14/D15): the shell's two, over ghostty's quit and toggle_fullscreen
      "super+q",
      "super+ctrl+f",
    ]);
    // a chord main takes above the page is heard by no page listener, so it
    // carries no matcher (`ProductChord`'s two shapes hold that for the compiler)
    expect(
      PRODUCT_CHORDS.filter((chord) => chord.takenBy === "shell").map((chord) => chord.id),
    ).toEqual(["quit", "full-screen"]);
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
      isCardsChord({
        key: "V",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        repeat: false,
      }),
    ).toBe(true);
    expect(
      isCardsChord({
        key: "v",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(false);
    // HN: the clipboard tray's chord raises the hand now, its row named for it
    expect(PRODUCT_CHORDS.find((chord) => chord.trigger === "super+shift+v")).toMatchObject({
      id: "cards",
      label: "Your hand",
    });
    expect(PRODUCT_CHORDS.some((chord) => (chord.id as string) === "clipboard-tray")).toBe(false);
  });

  it("⌘F is search's — Ctrl+F off the Mac — never with ⇧ or ⌥, never the other platform's modifier, and SAYS when it is kept (K4)", () => {
    const key = (init: Partial<KeyboardEvent>) => ({
      key: "f",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      ...init,
    });
    expect(isSearchChord(key({ metaKey: true }), "mac")).toBe(true);
    expect(isSearchChord(key({ key: "F", metaKey: true }), "mac")).toBe(true);
    expect(isSearchChord(key({ ctrlKey: true }), "mac")).toBe(false);
    expect(isSearchChord(key({ metaKey: true, shiftKey: true }), "mac")).toBe(false);
    expect(isSearchChord(key({ metaKey: true, altKey: true }), "mac")).toBe(false);
    expect(isSearchChord(key({ ctrlKey: true }), "other")).toBe(true);
    expect(isSearchChord(key({ metaKey: true }), "other")).toBe(false);
    expect(isSearchChord(key({ key: "g", metaKey: true }), "mac")).toBe(false);
    const search = PRODUCT_CHORDS.find((chord) => chord.id === "search");
    expect(search).toMatchObject({
      trigger: "super+f",
      label: "Search",
      when: "while History or Godview is the view",
    });
    // the chords kept always say no when
    expect(PRODUCT_CHORDS.filter((chord) => chord.when !== undefined).map((c) => c.id)).toEqual([
      "search",
      "desk-copy",
    ]);
  });

  it("⌘C is the desk's Copy — Ctrl+C off the Mac — never with ⇧ or ⌥, never the other platform's modifier, and SAYS when it is kept (HN-D3)", () => {
    const key = (init: Partial<KeyboardEvent>) => ({
      key: "c",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      ...init,
    });
    expect(isCopyChord(key({ metaKey: true }), "mac")).toBe(true);
    expect(isCopyChord(key({ key: "C", metaKey: true }), "mac")).toBe(true);
    // Ctrl+C on the Mac is a shell's interrupt; ⇧⌘C and ⌥⌘C are other chords
    expect(isCopyChord(key({ ctrlKey: true }), "mac")).toBe(false);
    expect(isCopyChord(key({ metaKey: true, shiftKey: true }), "mac")).toBe(false);
    expect(isCopyChord(key({ metaKey: true, altKey: true }), "mac")).toBe(false);
    expect(isCopyChord(key({ ctrlKey: true }), "other")).toBe(true);
    expect(isCopyChord(key({ metaKey: true }), "other")).toBe(false);
    expect(isCopyChord(key({ key: "v", metaKey: true }), "mac")).toBe(false);
    expect(PRODUCT_CHORDS.find((chord) => chord.id === "desk-copy")).toMatchObject({
      trigger: "super+c",
      label: "Copy",
      when: "on the desk, with something selected",
      scope: "desk",
    });
    // kept only over the desk, which no pane is ever on — the one row the deck's keyboard page
    // leaves to Ghostty (terminal-keyboard-model.test.ts)
    expect(PRODUCT_CHORDS.filter((chord) => chord.scope === "desk").map((c) => c.id)).toEqual([
      "desk-copy",
    ]);
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
