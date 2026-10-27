// @vitest-environment happy-dom

import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FieldHost, setHost } from "../src/host";
import { DevicesSection } from "../src/panels/DevicesSection";

// TS-3a (track TS, TS-D3): Settings → Devices, the account's reach — the link
// (moved from Account, on the shared door), This Mac, the account's devices,
// new projects' posture (moved from Account) and the network's details. Every
// face the link can show must be a page, never a blank or a crash.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

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

/** An unlinked desktop, as UA-P-0a's daemon reports one: `meshEnabled` is
 * FALSE because the mesh derives from the link, and the posture word is what
 * says so. Before UA-P-0g the renderer read that false as "the mesh is
 * switched off" and offered nothing. */
const OFFLINE = {
  link: null,
  meshEnabled: false,
  nodeState: null,
  authUrl: null,
  linkState: "offline",
  linkDetail: null,
};

/** A refusal on the wire, with the daemon's own sentence. */
const refused = (linkState: string, linkDetail: string): Record<string, unknown> => ({
  link: null,
  meshEnabled: false,
  nodeState: null,
  authUrl: null,
  linkState,
  linkDetail,
});

/** The supervisor half. `usersUpdate: null` is a host WITHOUT the bridge — a
 * browser harness, or a shell built before the seam landed. `users` is UA-5's
 * half of the same door: each member absent independently, because a shell
 * that predates the switcher has the profile write and nothing else. */
function host(
  usersUpdate: NonNullable<FieldHost["usersUpdate"]> | null,
  users: {
    list?: NonNullable<FieldHost["usersList"]>;
    create?: NonNullable<FieldHost["usersCreate"]>;
    switch?: NonNullable<FieldHost["usersSwitch"]>;
  } = {},
): void {
  setHost({
    logger: noopLogger,
    getConnection: async () => ({ port: 1, token: "test" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    ...(usersUpdate === null ? {} : { usersUpdate }),
    ...(users.list === undefined ? {} : { usersList: users.list }),
    ...(users.create === undefined ? {} : { usersCreate: users.create }),
    ...(users.switch === undefined ? {} : { usersSwitch: users.switch }),
  });
}

/** The product half. `link` undefined makes `user.link.subscribe` REJECT, which
 * is what a daemon without the UA-3 method actually does. */
function client(options: {
  link?: unknown;
  preferences?: Record<string, unknown>;
  devices?: unknown[];
}): FielddClient {
  // UA-6 made syncPosture REQUIRED in the effective snapshot — a real daemon
  // always folds it, so the fake must too (a partial snapshot reads as
  // unavailable, which is its own test below, not this one's subject).
  const preferences = options.preferences ?? {
    showTray: true,
    backgroundShell: true,
    syncPosture: "automatic",
  };
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      if (method === "storage.appPreferences.subscribe") {
        return { subId: "app-preferences", snapshot: preferences, unsubscribe: () => undefined };
      }
      if (method === "user.link.subscribe") {
        if (options.link === undefined) throw new Error("method not found: user.link.subscribe");
        return { subId: "user-link", snapshot: options.link, unsubscribe: () => undefined };
      }
      if (method === "device.subscribe") {
        return {
          subId: "devices",
          snapshot: options.devices ?? [],
          unsubscribe: (): void => undefined,
        };
      }
      if (method === "system.health.subscribe") {
        return { subId: "health", snapshot: null, unsubscribe: (): void => undefined };
      }
      throw new Error(`unexpected subscription: ${method}`);
    }),
    request: vi.fn(async () => ({ ok: true })),
  } as unknown as FielddClient;
}

async function mount(fieldd: FielddClient): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(FielddProvider, { client: fieldd }, createElement(DevicesSection)));
    await Promise.resolve();
    await Promise.resolve();
  });
}

const text = (): string => container?.textContent ?? "";

/** Enough microtask turns for a write's promise chain to settle. */
const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

/** The one phrase for the act, found the way a person finds it: by its label. */
const linkAct = (): HTMLButtonElement | undefined =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (button) => button.textContent === "Continue with Tailscale",
  );

const LINK = {
  login: "james@example.com",
  tailnet: "example.ts.net",
  linkedAt: "2026-08-05T09:00:00.000Z",
};

/** A linked desktop, with the floor's facts (TS-1): its name in Tailscale, the
 * console, and the sign-in's expiry. */
const LINKED = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  link: LINK,
  meshEnabled: true,
  nodeState: "Running",
  authUrl: null,
  linkState: "linked",
  linkDetail: null,
  machineName: "truffle-vibefield-studio",
  adminUrl: "https://login.tailscale.com/admin/machines",
  keyExpiresAt: Date.UTC(2027, 3, 24),
  ...patch,
});

const button = (label: string): HTMLButtonElement | undefined =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === label,
  );

describe("Settings → Devices: the Tailscale card (TS-D1, TS-D2, TS-D4)", () => {
  it("survives a daemon with no link method and says so", async () => {
    host(null);
    await mount(client({}));
    expect(text()).toContain("This daemon does not report link status");
  });

  it("says This Mac only, never offline, and begins with exactly one begin", async () => {
    host(null);
    const fieldd = client({ link: OFFLINE });
    await mount(fieldd);
    expect(container?.querySelector(".vf-devices-state")?.textContent).toBe("This Mac only");
    expect(container?.querySelector('[aria-label="Tailscale"]')).not.toBeNull();
    await act(async () => linkAct()?.click());
    expect(fieldd.request).toHaveBeenCalledTimes(1);
    expect(fieldd.request).toHaveBeenCalledWith("user.link.begin", {});
  });

  it("renders a refused begin instead of a blank, and keeps the act", async () => {
    host(null);
    const fieldd = client({ link: OFFLINE });
    (fieldd.request as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("link.json is present but unusable: /x/link.json"),
    );
    await mount(fieldd);
    await act(async () => linkAct()?.click());
    await act(flush);
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain("/x/link.json");
    expect(linkAct()).not.toBeUndefined();
  });

  it("names the connected account in green, with the console and the two acts", async () => {
    host(null);
    await mount(client({ link: LINKED() }));
    const state = container?.querySelector(".vf-devices-state");
    expect(state?.textContent).toBe("Connected");
    expect(state?.getAttribute("data-tone")).toBe("healthy");
    expect(text()).toContain("james@example.com");
    expect(text()).toContain("example.ts.net");
    const manage = Array.from(container?.querySelectorAll("a") ?? []).find(
      (anchor) => anchor.textContent === "Manage in Tailscale ↗",
    );
    expect(manage?.getAttribute("href")).toBe("https://login.tailscale.com/admin/machines");
    expect(manage?.getAttribute("target")).toBe("_blank");
    // a linked desktop is never offered the act again: that path is Disconnect
    expect(linkAct()).toBeUndefined();
    expect(button("Disconnect…")).not.toBeUndefined();
    expect(button("Use another account")).not.toBeUndefined();
  });

  it("disconnects through a sheet that says where the record stays (TS-D14)", async () => {
    host(null);
    const fieldd = client({ link: LINKED() });
    await mount(fieldd);
    await act(async () => button("Disconnect…")?.click());
    // the sheet asks; nothing has happened yet
    expect(fieldd.request).not.toHaveBeenCalled();
    expect(text()).toContain("Disconnect this Mac?");
    expect(text()).toContain("stays listed in your admin console until you remove it there");
    await act(async () => button("Disconnect")?.click());
    expect(fieldd.request).toHaveBeenCalledWith("user.link.unlink", {});
  });

  it("closes a sheet on Esc and on Cancel, and asks nothing", async () => {
    host(null);
    const fieldd = client({ link: LINKED() });
    await mount(fieldd);
    await act(async () => button("Disconnect…")?.click());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(text()).not.toContain("Disconnect this Mac?");
    await act(async () => button("Disconnect…")?.click());
    await act(async () => button("Cancel")?.click());
    expect(text()).not.toContain("Disconnect this Mac?");
    expect(fieldd.request).not.toHaveBeenCalled();
  });

  it("offers another account as a new user (TS-D12), only where one can be made", async () => {
    // a roster that has been read is what says a user can be made here
    host(null, {
      list: async () => ({
        attachedUserId: "01J8ZQ7W9K3M5N7P9R1T3V5X7Z",
        users: [
          {
            userId: "01J8ZQ7W9K3M5N7P9R1T3V5X7Z",
            fuid: 1,
            name: "James",
            face: { emoji: "🦊" },
            resident: true,
            onboarded: true,
          },
        ],
      }),
      create: vi.fn(async () => {
        throw new Error("not in this row");
      }),
    });
    await mount(client({ link: LINKED() }));
    await act(flush);
    await act(async () => button("Use another account")?.click());
    expect(text()).toContain("A second Tailscale account is a second user on this Mac");
    expect(button("New user…")).not.toBeUndefined();
  });

  it("keeps the browser's exits while the sign-in waits on the person", async () => {
    host(null);
    await mount(
      client({
        link: {
          ...OFFLINE,
          meshEnabled: true,
          linkState: "capturing",
          authUrl: "https://login.tailscale.com/a/abc",
          machineName: "truffle-vibefield-studio",
        },
      }),
    );
    expect(text()).toContain("Finish signing in in your browser");
    expect(text()).toContain("Tailscale will ask to connect truffle-vibefield-studio");
    for (const exit of ["Open again", "Copy link", "Cancel"]) expect(button(exit)).toBeDefined();
  });

  it("names the approval an admin owes, with the console", async () => {
    host(null);
    await mount(
      client({
        link: {
          ...OFFLINE,
          meshEnabled: true,
          linkState: "awaiting_approval",
          machineName: "truffle-vibefield-studio",
          adminUrl: "https://login.tailscale.com/admin/machines",
        },
      }),
    );
    expect(container?.querySelector(".vf-devices-state")?.textContent).toBe("Waiting for approval");
    expect(text()).toContain("This Mac shows as truffle-vibefield-studio");
  });

  it("renews a lapsed sign-in with one click", async () => {
    host(null);
    const fieldd = client({ link: LINKED({ linkState: "expired", nodeState: "NeedsLogin" }) });
    await mount(fieldd);
    expect(container?.querySelector(".vf-devices-state")?.textContent).toBe("Sign-in expired");
    await act(async () => button("Sign in again")?.click());
    expect(fieldd.request).toHaveBeenCalledWith("user.link.renew", {});
  });

  it("speaks each refusal in the daemon's words and offers another account where it can", async () => {
    for (const [state, detail, offered] of [
      ["login_already_linked", 'the local user "Work" is already linked', true],
      ["login_unavailable", "a tagged node cannot link", true],
      ["link_corrupt", "link.json is present but unusable: /x/link.json", false],
    ] as const) {
      host(null);
      await mount(client({ link: refused(state, detail) }));
      expect(text()).toContain(detail);
      expect(button("Use another account") !== undefined).toBe(offered);
      act(() => root?.unmount());
      root = null;
      container?.remove();
      container = null;
    }
  });
});

describe("Settings → Devices: This Mac and your devices (TS-D3, TS-D9)", () => {
  it("names this Mac in Tailscale with Copy, and the sign-in's renewal by its date", async () => {
    host(null);
    await mount(client({ link: LINKED() }));
    expect(text()).toContain("truffle-vibefield-studio");
    expect(button("Copy")).not.toBeUndefined();
    expect(text()).toContain("Due by");
  });

  it("lists the account's devices as quiet rows, this Mac first", async () => {
    host(null);
    await mount(
      client({
        link: LINKED(),
        devices: [
          {
            deviceId: "d-pc",
            name: "Workshop PC",
            platform: "win32",
            self: false,
            online: false,
            lastSeenAt: 0,
          },
          {
            deviceId: "d-self",
            name: "Studio",
            platform: "darwin",
            self: true,
            online: true,
            lastSeenAt: 0,
          },
          {
            deviceId: "d-air",
            name: "MacBook Air",
            platform: "darwin",
            self: false,
            online: true,
            lastSeenAt: 0,
          },
        ],
      }),
    );
    const rows = Array.from(container?.querySelectorAll(".vf-devices-row") ?? []).map(
      (row) => row.textContent,
    );
    expect(rows).toEqual(["StudioThis Mac", "Workshop PCAway", "MacBook AirOnline"]);
  });

  it("adds a device by kind, in the account's own words", async () => {
    host(null);
    await mount(client({ link: LINKED() }));
    await act(async () => button("Add a device")?.click());
    expect(text()).toContain("On your iPhone, open VibeField and Continue with Tailscale");
    expect(text()).toContain("james@example.com");
  });

  it("asks nothing of an unlinked desktop's devices but to connect", async () => {
    host(null);
    await mount(client({ link: OFFLINE }));
    expect(button("Add a device")).toBeUndefined();
    expect(text()).toContain("Connect to see your other devices here.");
  });
});

describe("Settings → Devices: new projects (moved from Account, TS-D3)", () => {
  it("writes the posture key as a plain string and reflects the stored value", async () => {
    host(null);
    const fieldd = client({
      link: OFFLINE,
      preferences: { showTray: true, backgroundShell: true, syncPosture: "opt-in" },
    });
    await mount(fieldd);
    const cards = container?.querySelectorAll<HTMLInputElement>(
      '[role="radiogroup"][aria-label="Sync posture"] input[type="radio"]',
    );
    expect(cards?.[1]?.checked).toBe(true);
    await act(async () => cards?.[0]?.click());
    expect(fieldd.request).toHaveBeenCalledWith("storage.appPreferences.set", {
      key: "mesh.syncPosture",
      value: "automatic",
    });
  });

  it("keeps the network's details, collapsed", async () => {
    host(null);
    await mount(client({ link: OFFLINE }));
    const details = container?.querySelector("details.vf-devices-details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("Network details");
  });
});
