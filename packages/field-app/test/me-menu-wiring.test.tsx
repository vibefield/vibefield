// @vitest-environment happy-dom

import { act, createElement, type ReactElement, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { isSettingsChord, useMeMenuYields, useSettingsChord } from "../src/field/me-menu-wiring";

// UA-D19 — the spine's half of the Me menu (DESIGN.md §8), which ChromeLayer
// holds: ⌘, toggles Settings from anywhere, and the menu is one of the
// expanded surfaces, so another opening folds it. Pinned here at the hooks'
// grain, the way godview-freeze pins ChromeLayer's gates — ChromeLayer itself
// needs a canvas engine to mount.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function mount(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

const press = async (init: KeyboardEventInit): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    window.dispatchEvent(event);
  });
  return event;
};

describe("isSettingsChord", () => {
  it("is ⌘, or Ctrl+, and nothing near it", () => {
    expect(
      isSettingsChord({
        key: ",",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(true);
    expect(
      isSettingsChord({
        key: ",",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(true);
    expect(
      isSettingsChord({
        key: ",",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(false);
    expect(
      isSettingsChord({
        key: ",",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(false);
    expect(
      isSettingsChord({
        key: "<",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        repeat: false,
      }),
    ).toBe(false);
    expect(
      isSettingsChord({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(false);
  });

  it("ignores a held chord's repeats, which would flicker Settings open and shut", () => {
    expect(
      isSettingsChord({
        key: ",",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: true,
      }),
    ).toBe(false);
  });
});

describe("useSettingsChord", () => {
  let settingsOpen = false;
  function Spine(): ReactElement {
    const [open, setOpen] = useState(false);
    settingsOpen = open;
    const onOpen = useCallback(() => setOpen(true), []);
    const onClose = useCallback(() => setOpen(false), []);
    useSettingsChord(open, onOpen, onClose);
    return createElement("div");
  }

  it("toggles Settings from anywhere, and takes the chord from the page", async () => {
    await mount(createElement(Spine));
    const first = await press({ key: ",", metaKey: true });
    expect(settingsOpen).toBe(true);
    expect(first.defaultPrevented).toBe(true);
    await press({ key: ",", metaKey: true });
    expect(settingsOpen).toBe(false);
  });

  it("leaves every other key alone, and a repeat of its own", async () => {
    await mount(createElement(Spine));
    const other = await press({ key: "k", metaKey: true });
    expect(settingsOpen).toBe(false);
    expect(other.defaultPrevented).toBe(false);
    await press({ key: ",", metaKey: true, repeat: true });
    expect(settingsOpen).toBe(false);
  });

  it("stops listening when the spine goes away", async () => {
    await mount(createElement(Spine));
    await act(async () => root?.unmount());
    root = null;
    settingsOpen = false;
    await press({ key: ",", metaKey: true });
    expect(settingsOpen).toBe(false);
  });
});

describe("useMeMenuYields", () => {
  let setters: { me: (open: boolean) => void; other: (open: boolean) => void } | null = null;
  let meOpen = false;
  function Spine(): ReactElement {
    const [me, setMe] = useState(false);
    const [other, setOther] = useState(false);
    meOpen = me;
    setters = { me: setMe, other: setOther };
    const fold = useCallback(() => setMe(false), []);
    useMeMenuYields(me, other, fold);
    return createElement("div");
  }

  it("folds the menu when another expanded surface opens", async () => {
    await mount(createElement(Spine));
    await act(async () => setters?.me(true));
    expect(meOpen).toBe(true);
    await act(async () => setters?.other(true));
    expect(meOpen).toBe(false);
  });

  it("leaves the menu open while nothing else is", async () => {
    await mount(createElement(Spine));
    await act(async () => setters?.me(true));
    await act(async () => setters?.other(false));
    expect(meOpen).toBe(true);
  });
});
