// @vitest-environment happy-dom

import type { DeviceInfo } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdatesDevicesSection } from "../src/panels/UpdatesDevicesSection";

// AU-3 (AU-D13 A) — Settings → Updates' "Your devices" on its real controller over a fake fieldd: the roster's
// desktops in the versions they run, the attention ink where a version keeps one from connecting, and an honest line
// when fieldd can't be read (the updater beside it reads the host bridge, so the page stands either way).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CURRENT = "0.1.0-nightly.20261028";

const device = (over: Partial<DeviceInfo> & { deviceId: string }): DeviceInfo => ({
  name: over.deviceId,
  platform: "darwin",
  contractsVersion: "1.0.0",
  capabilities: { terminalHost: true, docHost: true, push: false },
  self: false,
  online: true,
  lastSeenAt: 1,
  ...over,
});

const ROSTER: DeviceInfo[] = [
  device({ deviceId: "james-mbp", self: true, appVersion: CURRENT }),
  device({ deviceId: "mac-mini", appVersion: CURRENT }),
  device({ deviceId: "studio-imac", appVersion: "0.1.0-nightly.20261027" }),
  device({
    deviceId: "lab-pc",
    platform: "win32",
    contractsVersion: "0.4.0",
    state: "incompatible",
  }),
  device({
    deviceId: "james-phone",
    platform: "ios",
    capabilities: { terminalHost: false, docHost: false, push: true },
  }),
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function fieldd(roster: DeviceInfo[] | Error): FielddClient {
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      if (method !== "device.subscribe") throw new Error(`unexpected subscribe: ${method}`);
      if (roster instanceof Error) throw roster;
      return { subId: "devices", snapshot: roster, unsubscribe: () => undefined };
    }),
    request: vi.fn(),
  } as unknown as FielddClient;
}

async function mount(
  client: FielddClient,
  props: { current?: string; linked?: boolean } = {},
): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(FielddProvider, { client }, createElement(UpdatesDevicesSection, props)),
    );
  });
}

const rows = (): HTMLLIElement[] => [
  ...(container?.querySelectorAll<HTMLLIElement>("[data-updates-devices] li") ?? []),
];

describe("Your devices (Settings → Updates)", () => {
  it("lists each desktop, this Mac first, in friendly words with the exact version as its title", async () => {
    await mount(fieldd(ROSTER), { current: CURRENT, linked: true });
    expect(rows().map((row) => row.textContent)).toEqual([
      "james-mbpThe Oct 28 nightlyThis Mac",
      "lab-pcUpdate VibeField there to connect",
      "mac-miniThe Oct 28 nightlySame as this Mac",
      "studio-imacThe Oct 27 nightlyOlder than this Mac",
    ]);
    expect(rows()[0]?.hasAttribute("data-self")).toBe(true);
    expect(rows()[0]?.querySelector("[title]")?.getAttribute("title")).toBe(CURRENT);
    // the OS marks, a phone left out
    expect(rows().map((row) => row.querySelector("svg")?.getAttribute("data-os"))).toEqual([
      "macos",
      "windows",
      "macos",
      "macos",
    ]);
    expect(container?.textContent).not.toContain("james-phone");
    expect(container?.textContent).not.toContain("Connect to see your other devices here.");
  });

  it("puts a desktop its version keeps from connecting in the attention ink", async () => {
    await mount(fieldd(ROSTER), { current: CURRENT, linked: true });
    const lab = rows().find((row) => row.textContent?.startsWith("lab-pc"));
    expect(lab?.querySelector('[data-tone="attention"]')?.textContent).toBe(
      "Update VibeField there to connect",
    );
  });

  it("says how to see the rest when this Mac stands alone", async () => {
    await mount(fieldd([ROSTER[0] as DeviceInfo]), { current: CURRENT, linked: false });
    expect(rows()).toHaveLength(1);
    expect(container?.textContent).toContain("Connect to see your other devices here.");
  });

  it("says so when fieldd can't be read, never a blank", async () => {
    await mount(fieldd(new Error("fieldd is restarting")), { current: CURRENT });
    expect(container?.textContent).toContain("Your devices");
    expect(container?.textContent).toContain("VibeField can't read your devices right now.");
    expect(rows()).toHaveLength(0);
  });
});
