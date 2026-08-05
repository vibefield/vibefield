// @vitest-environment happy-dom

import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FieldHost, setHost } from "../src/host";
import { AccountSection } from "../src/panels/AccountSection";

// UA-3: the Account surface is the first page whose two halves come from
// DIFFERENT owners — the supervisor bridge for the profile, the product socket
// for posture — so the cases that matter are the ones where only one of them is
// there. None of them may be a blank page or a crash.

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

const PROFILE = {
  userId: "01J8ZQ7W9K3M5N7P9R1T3V5X7Z",
  fuid: 1,
  name: "James",
  color: "accent-3",
  resident: true,
  onboarded: true,
};

/** The supervisor half. `usersUpdate: null` is a host WITHOUT the bridge — a
 * browser harness, or a shell built before the seam landed. */
function host(usersUpdate: NonNullable<FieldHost["usersUpdate"]> | null): void {
  setHost({
    logger: noopLogger,
    getConnection: async () => ({ port: 1, token: "test" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    ...(usersUpdate === null ? {} : { usersUpdate }),
  });
}

/** The product half. `link` undefined makes `user.link.subscribe` REJECT, which
 * is what a daemon without the UA-3 method actually does. */
function client(options: { link?: unknown; preferences?: Record<string, unknown> }): FielddClient {
  const preferences = options.preferences ?? { showTray: true, backgroundShell: true };
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
    root?.render(createElement(FielddProvider, { client: fieldd }, createElement(AccountSection)));
    await Promise.resolve();
    await Promise.resolve();
  });
}

const text = (): string => container?.textContent ?? "";

describe("AccountSection", () => {
  it("renders all four sections and seeds the profile from an empty update", async () => {
    const usersUpdate = vi.fn(async () => PROFILE);
    host(usersUpdate);
    await mount(
      client({ link: { link: null, meshEnabled: false, nodeState: null, authUrl: null } }),
    );

    expect(text()).toContain("Profile");
    expect(text()).toContain("Connect your devices");
    expect(text()).toContain("Sync posture");
    expect(text()).toContain("Keep running in background");

    // The read is the empty update — no separate read method to keep in step.
    expect(usersUpdate).toHaveBeenCalledWith({});

    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(name?.value).toBe("James");
    expect(name?.disabled).toBe(false);
    const accent = container?.querySelector<HTMLInputElement>('input[aria-label="accent-3"]');
    expect(accent?.checked).toBe(true);
    expect(text()).toContain("user 1");
  });

  it("disables the supervisor-owned controls and says why when the bridge is absent", async () => {
    host(null);
    await mount(
      client({ link: { link: null, meshEnabled: false, nodeState: null, authUrl: null } }),
    );

    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(name?.disabled).toBe(true);
    const residency = container?.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(residency?.disabled).toBe(true);
    const accents = container?.querySelectorAll<HTMLInputElement>(
      '[role="radiogroup"][aria-label="Accent color"] input[type="radio"]',
    );
    expect(accents).toHaveLength(8);
    expect(Array.from(accents ?? []).every((chip) => chip.disabled)).toBe(true);
    expect(text()).toContain("no supervisor bridge");
    expect(text()).toContain("Residency is a supervisor setting");

    // The product half is unaffected — posture is still live.
    const posture = container?.querySelectorAll<HTMLInputElement>(
      '[role="radiogroup"][aria-label="Sync posture"] input[type="radio"]',
    );
    expect(posture).toHaveLength(2);
    expect(posture?.[0]?.disabled).toBe(false);
  });

  it("survives a daemon with no link method and says so", async () => {
    host(vi.fn(async () => PROFILE));
    await mount(client({}));

    expect(text()).toContain("Link service unavailable");
    expect(text()).toContain("Everything local keeps working");
    // The rest of the page is intact — an absent method is not a dead page.
    expect(text()).toContain("Sync posture");
  });

  it("names the linked account and holds the unlink behind a second step", async () => {
    host(vi.fn(async () => PROFILE));
    const fieldd = client({
      link: {
        link: {
          login: "james@example.com",
          tailnet: "example.ts.net",
          linkedAt: "2026-08-05T09:00:00.000Z",
        },
        meshEnabled: true,
        nodeState: "running",
        authUrl: null,
      },
    });
    await mount(fieldd);

    expect(text()).toContain("james@example.com");
    expect(text()).toContain("example.ts.net");

    const unlink = (): HTMLButtonElement | undefined =>
      Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
        (button) => button.textContent === "Unlink",
      );
    await act(async () => unlink()?.click());
    // Armed, not done: the first click asks, and names what a relink costs.
    expect(fieldd.request).not.toHaveBeenCalled();
    expect(text()).toContain("mints a fresh node identity");

    await act(async () => unlink()?.click());
    expect(fieldd.request).toHaveBeenCalledWith("user.link.unlink", {});
  });

  it("offers the browser flow while the node waits for authentication", async () => {
    host(vi.fn(async () => PROFILE));
    await mount(
      client({
        link: {
          link: null,
          meshEnabled: true,
          nodeState: "needs-login",
          authUrl: "https://login.tailscale.com/a/abc123",
        },
      }),
    );

    const anchor = container?.querySelector<HTMLAnchorElement>(
      'a[href^="https://login.tailscale.com"]',
    );
    expect(anchor?.textContent).toBe("authenticate");
    expect(anchor?.target).toBe("_blank");
    expect(text()).toContain("Waiting for you to finish in the browser");
  });

  it("says plainly that the mesh is env-gated today", async () => {
    host(vi.fn(async () => PROFILE));
    await mount(
      client({ link: { link: null, meshEnabled: false, nodeState: null, authUrl: null } }),
    );

    expect(text()).toContain("Mesh networking is off on this device");
    expect(text()).toContain("FIELD_NATIVE_MESH");
  });

  it("writes the posture key as a plain string and reflects the stored value", async () => {
    host(vi.fn(async () => PROFILE));
    const fieldd = client({
      link: { link: null, meshEnabled: false, nodeState: null, authUrl: null },
      preferences: { showTray: true, backgroundShell: true, syncPosture: "opt-in" },
    });
    await mount(fieldd);

    const posture = container?.querySelectorAll<HTMLInputElement>(
      '[role="radiogroup"][aria-label="Sync posture"] input[type="radio"]',
    );
    expect(posture?.[0]?.checked).toBe(false);
    expect(posture?.[1]?.checked).toBe(true);

    await act(async () => posture?.[0]?.click());
    expect(fieldd.request).toHaveBeenCalledWith("storage.appPreferences.set", {
      key: "mesh.syncPosture",
      value: "automatic",
    });
  });

  it("keeps the profile honest when the supervisor refuses the read", async () => {
    host(vi.fn(async () => Promise.reject(new Error("users.json is locked"))));
    await mount(
      client({ link: { link: null, meshEnabled: false, nodeState: null, authUrl: null } }),
    );

    expect(text()).toContain("Profile unavailable");
    expect(text()).toContain("users.json is locked");
    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(name?.disabled).toBe(true);
  });
});
