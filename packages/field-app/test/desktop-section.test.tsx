// @vitest-environment happy-dom

import type { DesktopShellState } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopSection } from "../src/panels/DesktopSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function client(preferences: { showTray: boolean; backgroundShell: boolean }): FielddClient {
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      if (method !== "storage.appPreferences.subscribe") {
        throw new Error(`unexpected subscription: ${method}`);
      }
      return {
        subId: "app-preferences",
        // The daemon publishes the EFFECTIVE snapshot — every key with its
        // default already folded in — so the fake must too, or the section
        // reads a partial snapshot no daemon would ever send. `syncPosture`
        // joined that snapshot with UA-6; this section does not render it.
        snapshot: { ...preferences, syncPosture: "automatic" },
        unsubscribe: () => undefined,
      };
    }),
    request: vi.fn(async () => ({ ok: true })),
  } as unknown as FielddClient;
}

async function mount(
  fieldd: FielddClient,
  platform: "darwin" | "win32" | "linux",
  desktopState: DesktopShellState | null = null,
): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(
        FielddProvider,
        { client: fieldd },
        createElement(DesktopSection, { platform, desktopState }),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DesktopSection", () => {
  it("shows both Linux controls and writes only the exact preference key", async () => {
    const fieldd = client({ showTray: true, backgroundShell: true });
    await mount(fieldd, "linux");
    const switches = container?.querySelectorAll<HTMLButtonElement>('[role="switch"]');
    // the status item, the close behavior, and (AL-3) asking before a quit that ends sessions
    expect(switches).toHaveLength(3);
    expect(switches?.[0]?.getAttribute("aria-checked")).toBe("true");
    expect(switches?.[1]?.getAttribute("aria-checked")).toBe("true");

    await act(async () => switches?.[0]?.click());
    expect(fieldd.request).toHaveBeenCalledWith("storage.appPreferences.set", {
      key: "desktop.showTray",
      value: false,
    });
  });

  it("hides the inapplicable close behavior on macOS", async () => {
    await mount(client({ showTray: true, backgroundShell: true }), "darwin");
    expect(container?.querySelectorAll('[role="switch"]')).toHaveLength(3);
    expect(container?.textContent).not.toContain("Keep running after window closes");
  });

  // AL-3 — "Do not ask again" in the quit box turns it off; this switch turns it back on
  it("asks before quitting by default, and writes only desktop.confirmQuit", async () => {
    const fieldd = client({ showTray: true, backgroundShell: true });
    await mount(fieldd, "darwin");
    const ask = container?.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Ask before quitting"]',
    );
    expect(ask?.getAttribute("aria-checked")).toBe("true");
    await act(async () => ask?.click());
    expect(fieldd.request).toHaveBeenCalledWith("storage.appPreferences.set", {
      key: "desktop.confirmQuit",
      value: false,
    });
  });

  it("defaults the global shortcut on, exposes conflicts, and writes its preference", async () => {
    const fieldd = client({ showTray: true, backgroundShell: true });
    await mount(fieldd, "darwin", {
      tray: {
        availability: "available",
        placement: "visible",
        backgroundShellEffective: false,
        issue: null,
      },
      screenshotHotkey: {
        status: "conflict",
        accelerator: "Control+Command+A",
        message: "Another app is using this shortcut.",
      },
    });
    const toggle = container?.querySelector<HTMLButtonElement>(
      '[aria-label="Global screenshot shortcut"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(container?.textContent).toContain("any app or display");
    expect(container?.textContent).toContain("Another app");
    await act(async () => toggle?.click());
    expect(fieldd.request).toHaveBeenCalledWith("storage.appPreferences.set", {
      key: "desktop.screenshotHotkey",
      value: false,
    });
  });

  it("disables background residency when the status item is hidden", async () => {
    await mount(client({ showTray: false, backgroundShell: true }), "win32");
    const switches = container?.querySelectorAll<HTMLButtonElement>('[role="switch"]');
    expect(switches?.[1]?.disabled).toBe(true);
    expect(container?.textContent).toContain("requires the status item");
  });

  it("surfaces native tray failure and renders background residency as ineffective", async () => {
    await mount(client({ showTray: true, backgroundShell: true }), "linux", {
      tray: {
        availability: "unavailable",
        placement: "unknown",
        backgroundShellEffective: false,
        issue: {
          code: "DESKTOP_TRAY_UNAVAILABLE",
          message: "Status item unavailable for this session. Closing this window quits VibeField.",
        },
      },
    });
    const switches = container?.querySelectorAll<HTMLButtonElement>('[role="switch"]');
    expect(switches?.[0]?.getAttribute("aria-checked")).toBe("true");
    expect(switches?.[1]?.getAttribute("aria-checked")).toBe("false");
    expect(switches?.[1]?.disabled).toBe(true);
    expect(container?.textContent).toContain("Closing this window quits VibeField");
    expect(container?.textContent).toContain("DESKTOP_TRAY_UNAVAILABLE");
  });

  it("explains when macOS has overflow-hidden a successfully created status item", async () => {
    await mount(client({ showTray: true, backgroundShell: true }), "darwin", {
      tray: {
        availability: "available",
        placement: "offscreen",
        backgroundShellEffective: false,
        issue: {
          code: "DESKTOP_TRAY_OFFSCREEN",
          message:
            "VibeField created its status item, but macOS placed it outside the visible menu bar.",
        },
      },
    });
    expect(container?.textContent).toContain("outside the visible menu bar");
    expect(container?.textContent).toContain("DESKTOP_TRAY_OFFSCREEN");
  });
});
