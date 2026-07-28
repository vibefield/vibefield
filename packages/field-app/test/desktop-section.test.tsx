// @vitest-environment happy-dom
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
        snapshot: preferences,
        unsubscribe: () => undefined,
      };
    }),
    request: vi.fn(async () => ({ ok: true })),
  } as unknown as FielddClient;
}

async function mount(fieldd: FielddClient, platform: "darwin" | "win32" | "linux"): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(
        FielddProvider,
        { client: fieldd },
        createElement(DesktopSection, { platform }),
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
    const inputs = container?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(inputs).toHaveLength(2);
    expect(inputs?.[0]?.checked).toBe(true);
    expect(inputs?.[1]?.checked).toBe(true);

    await act(async () => inputs?.[0]?.click());
    expect(fieldd.request).toHaveBeenCalledWith("storage.appPreferences.set", {
      key: "desktop.showTray",
      value: false,
    });
  });

  it("hides the inapplicable close behavior on macOS", async () => {
    await mount(client({ showTray: true, backgroundShell: true }), "darwin");
    expect(container?.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(container?.textContent).not.toContain("Keep running after window closes");
  });

  it("disables background residency when the status item is hidden", async () => {
    await mount(client({ showTray: false, backgroundShell: true }), "win32");
    const inputs = container?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(inputs?.[1]?.disabled).toBe(true);
    expect(container?.textContent).toContain("Requires the status item");
  });
});
