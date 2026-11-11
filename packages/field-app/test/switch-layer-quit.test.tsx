// @vitest-environment happy-dom
/**
 * Item 315 (James, 2026-11-10: "it should not do anything, ignore the press"; "2. C") — the switch's layer learns that
 * VibeField is quitting from main's desktop state (`quitting`). BootRoot mounts the layer in every window state, the
 * Setup Assistant's chooser included, so it is the one reader the switch needs.
 */
import type { DesktopShellState } from "@vibefield/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEAVING_STATUS, SwitchLayer } from "../src/boot/SwitchScene";
import { isQuitHeld, resetSwitchForTests } from "../src/boot/switch";
import { type FieldHost, setHost } from "../src/host";

const noopLogger: FieldHost["logger"] = {
  child: () => noopLogger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
};

const tray = {
  availability: "available",
  placement: "visible",
  backgroundShellEffective: true,
  issue: null,
} as const;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  resetSwitchForTests();
});

describe("the switch's layer reads the quit from main's desktop state (item 315)", () => {
  it("subscribes on mount: quitting holds the window, a state without it clears it, and unmounting leaves", async () => {
    const seen: { deliver?: (state: DesktopShellState) => void } = {};
    const unsubscribe = vi.fn();
    setHost({
      logger: noopLogger,
      getConnection: async () => ({ port: 1, token: "test" }),
      onPrepareClose: () => () => undefined,
      completeClose: () => undefined,
      onDesktopState: (handler: (state: DesktopShellState) => void) => {
        seen.deliver = handler;
        return unsubscribe;
      },
    } as FieldHost);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(SwitchLayer, {
          boot: LEAVING_STATUS,
          ready: false,
          onRetry: () => undefined,
        }),
      );
    });
    expect(seen.deliver).toBeDefined();
    act(() => seen.deliver?.({ tray, quitting: true }));
    expect(isQuitHeld()).toBe(true);
    // an older shell's state says nothing of the quit: the window is not held
    act(() => seen.deliver?.({ tray }));
    expect(isQuitHeld()).toBe(false);
    await act(async () => root?.unmount());
    root = null;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
