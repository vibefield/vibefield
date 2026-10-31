// @vitest-environment happy-dom

import { PHONE_CODE_HOST, PHONE_CODE_SCHEME } from "@vibefield/contracts/phone-code";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, type ComponentProps, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardsStore } from "../src/frame/cards/cards-store";
import { type FieldHost, setHost } from "../src/host";
import {
  CONNECT_ASKS_LINE,
  CONNECT_ASKS_TITLE,
  DevicesSection,
} from "../src/panels/DevicesSection";

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

// TS-7b — the add-phone code as the Mac draws it; its scheme and host are contracts' (wall R6), the query is pinned here.
const phoneCode = (query: string) => `${PHONE_CODE_SCHEME}://${PHONE_CODE_HOST}?${query}`;

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

/** The page's props; its parameter is optional, so they are inferred with undefined. */
type DevicesProps = NonNullable<ComponentProps<typeof DevicesSection>>;

async function mount(fieldd: FielddClient, props: DevicesProps = {}): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(
        FielddProvider,
        { client: fieldd },
        createElement<DevicesProps>(DevicesSection, props),
      ),
    );
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

/** Type into a React-controlled input the way a keyboard does. */
const typeInto = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

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

  it("disconnects through a sheet that says it signs out of Tailscale too (TS-D14)", async () => {
    host(null);
    const fieldd = client({ link: LINKED() });
    await mount(fieldd);
    await act(async () => button("Disconnect…")?.click());
    // the sheet asks; nothing has happened yet
    expect(fieldd.request).not.toHaveBeenCalled();
    expect(text()).toContain("Disconnect this Mac?");
    expect(text()).toContain("It signs out of Tailscale too.");
    // where the record stays is said only after a sign-out that missed (below)
    expect(text()).not.toContain("stays listed in your admin console");
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

  it("adds a phone by a code that names the account and this Mac (TS-7b)", async () => {
    host(null);
    await mount(client({ link: LINKED() }));
    await act(async () => button("Add a device")?.click());
    expect(text()).toContain("Scan with VibeField on your iPhone.");
    expect(text()).toContain("Scan the code on your Mac");
    expect(text()).toContain("james@example.com");
    // no roster yet: this Mac is named as Tailscale names it
    expect(container?.querySelector("[data-code]")?.getAttribute("data-code")).toBe(
      phoneCode("login=james%40example.com&from=truffle-vibefield-studio"),
    );
    expect(
      container?.querySelector('canvas[aria-label="Scan with VibeField on your iPhone"]'),
    ).not.toBeNull();
  });

  it("names this Mac in the code by the roster's own name, the one the phone shows", async () => {
    host(null);
    await mount(
      client({
        link: LINKED(),
        devices: [
          {
            deviceId: "d-studio",
            name: "Studio",
            platform: "darwin",
            self: true,
            online: true,
            lastSeenAt: 0,
          },
        ],
      }),
    );
    await act(async () => button("Add a device")?.click());
    expect(container?.querySelector("[data-code]")?.getAttribute("data-code")).toBe(
      phoneCode("login=james%40example.com&from=Studio"),
    );
  });

  it("passes over a roster name the phone would refuse for the machine name", async () => {
    host(null);
    await mount(
      client({
        link: LINKED(),
        devices: [
          {
            deviceId: "d-studio",
            name: "James’s MacBook Pro in the upstairs studio, by the window, desk two",
            platform: "darwin",
            self: true,
            online: true,
            lastSeenAt: 0,
          },
        ],
      }),
    );
    await act(async () => button("Add a device")?.click());
    expect(container?.querySelector("[data-code]")?.getAttribute("data-code")).toBe(
      phoneCode("login=james%40example.com&from=truffle-vibefield-studio"),
    );
  });

  it("holds the code while no name for this Mac is known, and says what to do without it", async () => {
    host(null);
    await mount(client({ link: LINKED({ machineName: null }) }));
    await act(async () => button("Add a device")?.click());
    expect(container?.querySelector("[data-code]")).toBeNull();
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

describe("Settings → Devices: this Mac's own name (TS-3b, P9, TS-D17 A)", () => {
  const SELF = {
    deviceId: "d-self",
    name: "Studio.local",
    platform: "darwin",
    self: true,
    online: true,
    lastSeenAt: 0,
    nameSource: "hostname",
  };

  it("renames this Mac: Rename… opens the field, and Enter sends the words", async () => {
    host(null);
    const fieldd = client({ link: OFFLINE, devices: [SELF] });
    await mount(fieldd);
    // the name is the device's, linked or not
    expect(text()).toContain("Studio.local");
    expect(button("Use the computer's name")).toBeUndefined();
    await act(async () => button("Rename…")?.click());
    const field = container?.querySelector<HTMLInputElement>(
      'input[aria-label="This Mac\'s name"]',
    );
    expect(field?.value).toBe("Studio.local");
    await act(async () => {
      if (field) typeInto(field, "Studio");
    });
    await act(async () => {
      field?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(flush);
    expect(fieldd.request).toHaveBeenCalledWith("device.rename", { name: "Studio" });
  });

  it("cancels on Esc without asking anything", async () => {
    host(null);
    const fieldd = client({ link: OFFLINE, devices: [SELF] });
    await mount(fieldd);
    await act(async () => button("Rename…")?.click());
    const field = container?.querySelector<HTMLInputElement>(
      'input[aria-label="This Mac\'s name"]',
    );
    await act(async () => {
      field?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container?.querySelector('input[aria-label="This Mac\'s name"]')).toBeNull();
    expect(fieldd.request).not.toHaveBeenCalled();
  });

  it("offers the computer's name back once the name is the person's own", async () => {
    host(null);
    const fieldd = client({
      link: OFFLINE,
      devices: [{ ...SELF, name: "Studio", nameSource: "user" }],
    });
    await mount(fieldd);
    await act(async () => button("Use the computer's name")?.click());
    await act(flush);
    expect(fieldd.request).toHaveBeenCalledWith("device.rename", { name: null });
  });

  it("says the daemon's refusal under the field, in its words", async () => {
    host(null);
    const fieldd = client({ link: OFFLINE, devices: [SELF] });
    (fieldd.request as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("a device name is at most 128 characters (this one is 129)"),
    );
    await mount(fieldd);
    await act(async () => button("Rename…")?.click());
    await act(async () => button("Save")?.click());
    await act(flush);
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "a device name is at most 128 characters (this one is 129)",
    );
    // the field stays, with the words to fix
    expect(container?.querySelector('input[aria-label="This Mac\'s name"]')).not.toBeNull();
  });
});

/** `client`, with a hand on the link's subscription: `push` moves it as the
 * daemon would after an act, for every subscriber (the door's and the head's). */
function pushable(options: {
  link: unknown;
  request: (method: string, params: unknown) => Promise<unknown>;
}): { fieldd: FielddClient; push: (status: unknown) => Promise<void> } {
  const fieldd = client({ link: options.link });
  const onLink: Array<(status: unknown) => void> = [];
  const subscribe = fieldd.subscribe as unknown as ReturnType<typeof vi.fn>;
  const base = subscribe.getMockImplementation();
  subscribe.mockImplementation(
    async (method: string, params: unknown, onEvent?: (status: unknown) => void) => {
      if (method === "user.link.subscribe" && onEvent !== undefined) onLink.push(onEvent);
      return base?.(method, params, onEvent);
    },
  );
  (fieldd.request as ReturnType<typeof vi.fn>).mockImplementation(options.request);
  return {
    fieldd,
    push: async (status) => {
      await act(async () => {
        for (const onEvent of onLink) onEvent(status);
      });
    },
  };
}

describe("Settings → Devices on truffle 0.7.24 (TS-8b; TS-D14, D15, D16 A, T11)", () => {
  /** A standing link the network keeps down for sending no device logs. */
  const LOGS_REQUIRED = (): Record<string, unknown> =>
    LINKED({ linkState: "logs_required", nodeState: "Stopped" });

  const logsSwitch = (): HTMLButtonElement | null | undefined =>
    container?.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Send logs on this network"]',
    );

  it("says a network requires device logs, and Send logs on this network keeps the opt-in (TS-D16)", async () => {
    host(null);
    const fieldd = client({ link: LOGS_REQUIRED() });
    await mount(fieldd);
    const state = container?.querySelector(".vf-devices-state");
    expect(state?.textContent).toBe("Needs device logs");
    expect(state?.getAttribute("data-tone")).toBe("attention");
    expect(text()).toContain("VibeField sends none, so this Mac can't join this network.");
    // a standing link is offered no second begin and nothing to cancel
    expect(linkAct()).toBeUndefined();
    expect(button("Cancel")).toBeUndefined();
    await act(async () => button("Send logs on this network")?.click());
    expect(fieldd.request).toHaveBeenCalledTimes(1);
    expect(fieldd.request).toHaveBeenCalledWith("user.link.logs", { send: true });
  });

  it("begins a capture the network refused again, sending logs, or ends it (TS-D16)", async () => {
    host(null);
    const fieldd = client({ link: { ...OFFLINE, meshEnabled: true, linkState: "logs_required" } });
    await mount(fieldd);
    expect(container?.querySelector(".vf-devices-state")?.textContent).toBe("Needs device logs");
    await act(async () => button("Send logs on this network")?.click());
    expect(fieldd.request).toHaveBeenLastCalledWith("user.link.begin", { sendLogs: true });
    await act(async () => button("Cancel")?.click());
    expect(fieldd.request).toHaveBeenLastCalledWith("user.link.cancel", {});
  });

  it("says Tailnet Lock holds a connected Mac until a signing device trusts it (T11)", async () => {
    host(null);
    await mount(client({ link: LINKED({ needsSignature: true }) }));
    const state = container?.querySelector(".vf-devices-state");
    expect(state?.textContent).toBe("Not yet trusted");
    expect(state?.getAttribute("data-tone")).toBe("attention");
    expect(text()).toContain("Your network uses Tailnet Lock.");
    // it is connected: its acts stay
    expect(button("Disconnect…")).not.toBeUndefined();
  });

  it("names the embedded client, and sends logs from Network details' switch (TS-D15, D16)", async () => {
    host(null);
    const fieldd = client({ link: LINKED({ tailscaleVersion: "1.104.1" }) });
    await mount(fieldd);
    expect(text()).toContain("Tailscale 1.104.1");
    expect(text()).toContain("Off · VibeField sends none");
    expect(logsSwitch()?.getAttribute("aria-checked")).toBe("false");
    await act(async () => logsSwitch()?.click());
    expect(fieldd.request).toHaveBeenCalledWith("user.link.logs", { send: true });
  });

  it("reads Sent on this network once the person said so, and the switch turns it off", async () => {
    host(null);
    const fieldd = client({ link: LINKED({ sendLogs: true }) });
    await mount(fieldd);
    expect(text()).toContain("Sent on this network");
    expect(logsSwitch()?.getAttribute("aria-checked")).toBe("true");
    await act(async () => logsSwitch()?.click());
    expect(fieldd.request).toHaveBeenCalledWith("user.link.logs", { send: false });
  });

  it("says once, on the page, that a Disconnect could not sign out at Tailscale (TS-D14)", async () => {
    host(null);
    const { fieldd, push } = pushable({
      link: LINKED(),
      request: async (method) =>
        method === "user.link.unlink" ? { retired: true, signedOut: false } : { ok: true },
    });
    await mount(fieldd);
    await act(async () => button("Disconnect…")?.click());
    await act(async () => button("Disconnect")?.click());
    await act(flush);
    await push(OFFLINE);
    expect(text()).toContain(
      "This Mac couldn't reach Tailscale to sign out, so it stays listed in your admin console until you remove it there.",
    );
    const manage = Array.from(container?.querySelectorAll("a") ?? []).find(
      (anchor) => anchor.textContent === "Manage in Tailscale ↗",
    );
    expect(manage?.getAttribute("href")).toBe("https://login.tailscale.com/admin/machines");
  });

  it("says nothing more after a Disconnect that signed out", async () => {
    host(null);
    const { fieldd, push } = pushable({
      link: LINKED(),
      request: async (method) =>
        method === "user.link.unlink" ? { retired: true, signedOut: true } : { ok: true },
    });
    await mount(fieldd);
    await act(async () => button("Disconnect…")?.click());
    await act(async () => button("Disconnect")?.click());
    await act(flush);
    await push(OFFLINE);
    expect(container?.querySelector(".vf-devices-state")?.textContent).toBe("This Mac only");
    expect(text()).not.toContain("couldn't reach Tailscale");
  });
});

describe("Settings → Devices: asking again after Not now (TS-4; TS-D7)", () => {
  const asksSwitch = (): HTMLButtonElement | null | undefined =>
    container?.querySelector<HTMLButtonElement>(
      `[role="switch"][aria-label="${CONNECT_ASKS_TITLE}"]`,
    );

  it("offers the one switch while this Mac is not connected, on by default, and writes it", async () => {
    host(null);
    const fieldd = client({ link: OFFLINE });
    await mount(fieldd);
    expect(text()).toContain(CONNECT_ASKS_LINE);
    // an older daemon says nothing of it: on, as the contract reads its silence
    expect(asksSwitch()?.getAttribute("aria-checked")).toBe("true");
    await act(async () => asksSwitch()?.click());
    expect(fieldd.request).toHaveBeenCalledWith("storage.appPreferences.set", {
      key: "mesh.connectAsks",
      value: false,
    });
  });

  it("reads the stored switch, and is gone once connected", async () => {
    host(null);
    await mount(
      client({
        link: OFFLINE,
        preferences: {
          showTray: true,
          backgroundShell: true,
          syncPosture: "automatic",
          connectAsks: false,
        },
      }),
    );
    expect(asksSwitch()?.getAttribute("aria-checked")).toBe("false");
    act(() => root?.unmount());
    root = null;
    container?.remove();
    await mount(client({ link: LINKED() }));
    expect(asksSwitch()).toBeNull();
    expect(text()).not.toContain(CONNECT_ASKS_LINE);
  });

  it("begins the link once for Connect Your Devices…, and says the request was taken", async () => {
    host(null);
    const fieldd = client({ link: OFFLINE });
    const taken = vi.fn();
    await mount(fieldd, { connectPending: true, onConnectTaken: taken });
    await flush();
    expect(taken).toHaveBeenCalledTimes(1);
    expect(fieldd.request).toHaveBeenCalledTimes(1);
    expect(fieldd.request).toHaveBeenCalledWith("user.link.begin", {});
  });

  it("begins nothing over a link that already stands or a sign-in already waiting", async () => {
    host(null);
    for (const link of [LINKED(), { ...OFFLINE, linkState: "capturing", authUrl: "https://x" }]) {
      const fieldd = client({ link });
      const taken = vi.fn();
      await mount(fieldd, { connectPending: true, onConnectTaken: taken });
      await flush();
      expect(taken).toHaveBeenCalledTimes(1);
      expect(fieldd.request).not.toHaveBeenCalledWith("user.link.begin", {});
      act(() => root?.unmount());
      root = null;
      container?.remove();
    }
  });
});

describe("Settings → Devices: a copy deals a card from its button (HN-5)", () => {
  /** A host with the copy door: what it was given, and whether it takes it. */
  function withCopy(takes: boolean): string[] {
    const copied: string[] = [];
    setHost({
      logger: noopLogger,
      getConnection: async () => ({ port: 1, token: "test" }),
      onPrepareClose: () => () => undefined,
      completeClose: () => undefined,
      diagnostics: {
        copyText: async (words: string) => {
          copied.push(words);
          if (!takes) throw new Error("clipboard text is invalid or too large");
        },
      } as unknown as NonNullable<FieldHost["diagnostics"]>,
    });
    return copied;
  }

  /** The button's box, as the page lays it out. */
  const boxed = (label: string, box: { left: number; top: number }): HTMLButtonElement => {
    const pressed = button(label);
    if (pressed === undefined) throw new Error(`no ${label} button`);
    vi.spyOn(pressed, "getBoundingClientRect").mockReturnValue({
      ...box,
      width: 64,
      height: 24,
    } as DOMRect);
    return pressed;
  };

  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
  };

  afterEach(() => {
    for (const card of cardsStore.snapshot().cards) cardsStore.remove(card.id);
  });

  it("the machine's name: on the clipboard first, then a text card from Copy's box", async () => {
    const copied = withCopy(true);
    await mount(client({ link: LINKED() }));
    const copy = boxed("Copy", { left: 520, top: 300 });
    await act(async () => copy.click());
    await act(settle);
    expect(copied).toEqual(["truffle-vibefield-studio"]);
    const card = cardsStore.snapshot().cards.at(-1);
    expect(card).toMatchObject({
      kind: "text",
      paste: "truffle-vibefield-studio",
      origin: { view: "canvas", place: "Settings", how: "copy" },
    });
    expect(cardsStore.snapshot().arriving.get(card?.id ?? "")).toEqual({
      left: 520,
      top: 300,
      width: 64,
      height: 24,
    });
    expect(button("Copied")).not.toBeUndefined();
  });

  it("the sign-in link, dealt from Copy link's box", async () => {
    const copied = withCopy(true);
    const authUrl = "https://login.tailscale.com/a/abc";
    await mount(
      client({ link: { ...OFFLINE, meshEnabled: true, linkState: "capturing", authUrl } }),
    );
    await act(async () => boxed("Copy link", { left: 610, top: 180 }).click());
    await act(settle);
    expect(copied).toEqual([authUrl]);
    const card = cardsStore.snapshot().cards.at(-1);
    expect(card).toMatchObject({ kind: "text", paste: authUrl, origin: { place: "Settings" } });
    expect(cardsStore.snapshot().arriving.get(card?.id ?? "")).toMatchObject({
      left: 610,
      top: 180,
    });
  });

  it("a refused copy deals nothing, and the button says so in its own words", async () => {
    withCopy(false);
    await mount(client({ link: LINKED() }));
    await act(async () => boxed("Copy", { left: 520, top: 300 }).click());
    await act(settle);
    expect(cardsStore.snapshot().cards).toEqual([]);
    expect(button("Couldn't copy")).not.toBeUndefined();
  });
});
