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
  face: { emoji: "🦊" },
  resident: true,
  onboarded: true,
};

/** The Face row's act, found by its words. */
const changeFace = (): HTMLButtonElement | undefined =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (button) => button.textContent?.trim() === "Change…",
  );

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
function client(options: { link?: unknown; preferences?: Record<string, unknown> }): FielddClient {
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

/** Enough microtask turns for a write's promise chain to settle. */
const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

/** Type into a React-controlled input the way a keyboard does: through the
 * native value setter, then the input event React listens for. */
const typeInto = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

/** The one phrase for the act, found the way a person finds it: by its label. */
const linkAct = (): HTMLButtonElement | undefined =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (button) => button.textContent === "Continue with Tailscale",
  );

describe("AccountSection", () => {
  it("renders all four sections and seeds the profile from an empty update", async () => {
    const usersUpdate = vi.fn(async () => PROFILE);
    host(usersUpdate);
    await mount(client({ link: OFFLINE }));

    expect(text()).toContain("Profile");
    expect(text()).toContain("Connect your devices");
    expect(text()).toContain("Sync posture");
    expect(text()).toContain("Keep running in background");

    // The read is the empty update — no separate read method to keep in step.
    expect(usersUpdate).toHaveBeenCalledWith({});

    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(name?.value).toBe("James");
    expect(name?.disabled).toBe(false);
    // UA-D17 — the profile shows a face, never a colour, and says whose it is.
    expect(container?.querySelector('[role="img"][aria-label="James, 🦊"]')).not.toBeNull();
    expect(changeFace()?.disabled).toBe(false);
    expect(text()).not.toContain("accent");
    expect(text()).toContain("user 1");
  });

  it("disables the supervisor-owned controls and says why when the bridge is absent", async () => {
    host(null);
    await mount(client({ link: OFFLINE }));

    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(name?.disabled).toBe(true);
    const residency = container?.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(residency?.disabled).toBe(true);
    // No profile, no face to change — and the button says so by being inert.
    expect(changeFace()?.disabled).toBe(true);
    expect(text()).toContain("no supervisor bridge");
    expect(text()).toContain("Residency is a supervisor setting");

    // The product half is unaffected — posture is still live.
    const posture = container?.querySelectorAll<HTMLInputElement>(
      '[role="radiogroup"][aria-label="Sync posture"] input[type="radio"]',
    );
    expect(posture).toHaveLength(2);
    expect(posture?.[0]?.disabled).toBe(false);
  });

  it("changes the face through the picker, and greys the one another user wears", async () => {
    const writes: unknown[] = [];
    const usersUpdate = vi.fn(async (params: Record<string, unknown>) => {
      writes.push(params);
      return { ...PROFILE, ...params };
    });
    host(usersUpdate, {
      list: vi.fn(async () => ({
        attachedUserId: PROFILE.userId,
        users: [
          PROFILE,
          {
            userId: "01K0000000000000000000000B",
            fuid: 2,
            name: "Work",
            face: { emoji: "🐙" },
            resident: true,
            onboarded: true,
          },
        ],
      })),
    });
    await mount(client({ link: OFFLINE }));
    await act(async () => changeFace()?.click());

    const worn = container?.querySelector<HTMLInputElement>('input[aria-label="🐙, worn by Work"]');
    expect(worn?.disabled).toBe(true);
    expect(container?.querySelector<HTMLInputElement>('input[aria-label="🦊"]')?.checked).toBe(
      true,
    );

    await act(async () => {
      container?.querySelector<HTMLInputElement>('input[aria-label="🐧"]')?.click();
      await Promise.resolve();
    });
    // Only the face moves; an absent frame stays absent (a sticker).
    expect(writes.at(-1)).toEqual({ face: { emoji: "🐧" } });
    expect(container?.querySelector('[role="img"][aria-label="James, 🐧"]')).not.toBeNull();
  });

  it("says main's refusal of a face in its own words", async () => {
    let read = true;
    host(
      vi.fn(async (params: Record<string, unknown>) => {
        if (read && Object.keys(params).length === 0) return PROFILE;
        read = false;
        throw new Error("Work already wears 🐧 on this machine.");
      }),
    );
    await mount(client({ link: OFFLINE }));
    await act(async () => changeFace()?.click());
    await act(async () => {
      container?.querySelector<HTMLInputElement>('input[aria-label="🐧"]')?.click();
      await Promise.resolve();
    });
    expect(text()).toContain("Work already wears 🐧 on this machine.");
  });

  it("keeps the deck live through a write, and writes only the latest waiting choice", async () => {
    const writes: unknown[] = [];
    let release = (): void => undefined;
    host(
      vi.fn(async (params: Record<string, unknown>) => {
        if (Object.keys(params).length === 0) return PROFILE;
        writes.push(params);
        // The first write is held until the test lets it go.
        if (writes.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return { ...PROFILE, ...params };
      }),
    );
    await mount(client({ link: OFFLINE }));
    await act(async () => changeFace()?.click());
    const cell = (emoji: string): HTMLInputElement | null | undefined =>
      container?.querySelector<HTMLInputElement>(`input[aria-label="${emoji}"]`);
    await act(async () => {
      cell("🐧")?.click();
      await flush();
    });
    // A write in flight disables nothing: a disabled radio cannot hold the
    // focus an arrow key just moved to it.
    expect(cell("🐼")?.disabled).toBe(false);
    await act(async () => {
      cell("🐼")?.click();
      await flush();
    });
    await act(async () => {
      cell("🦉")?.click();
      await flush();
    });
    expect(cell("🦉")?.checked).toBe(true); // the choice shows at once
    await act(async () => {
      release();
      await flush();
    });
    // 🐼 was overtaken while it waited, so it is never written.
    expect(writes).toEqual([{ face: { emoji: "🐧" } }, { face: { emoji: "🦉" } }]);
    expect(container?.querySelector('[role="img"][aria-label="James, 🦉"]')).not.toBeNull();
  });

  it("refuses a typed face that already means something, in place and before any write", async () => {
    const usersUpdate = vi.fn(async (params: Record<string, unknown>) => ({
      ...PROFILE,
      ...params,
    }));
    host(usersUpdate);
    await mount(client({ link: OFFLINE }));
    await act(async () => changeFace()?.click());
    const input = container?.querySelector<HTMLInputElement>('input[aria-label="Any emoji"]');
    await act(async () => {
      if (input) typeInto(input, "🔥");
    });
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "🔥 already means something in VibeField, so it can't be a face.",
    );
    // Only the profile read reached main.
    expect(usersUpdate.mock.calls.every(([params]) => Object.keys(params).length === 0)).toBe(true);
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
        linkState: "linked",
        linkDetail: null,
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
          linkState: "capturing",
          linkDetail: null,
        },
      }),
    );

    // TS-2 — the waiting face keeps its exits in reach (TS-D5): the address is
    // opened again by the door, never by a bare underlined word
    const labels = Array.from(container?.querySelectorAll("button") ?? []).map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(expect.arrayContaining(["Open again", "Copy link", "Cancel"]));
    expect(text()).toContain("Finish signing in in your browser");
  });

  // UA-P-0g — the act. Before this, an unlinked desktop (which is every fresh
  // install, and anything that pressed Unlink) had no way to link from the UI
  // at all: the daemon has had `user.link.begin` since UA-P-0a and nothing in
  // the renderer called it.

  it("offers the link act on an unlinked desktop and sends exactly one begin", async () => {
    host(vi.fn(async () => PROFILE));
    const fieldd = client({ link: OFFLINE });
    await mount(fieldd);

    // TS-D2 — the ordinary first-run state in its own words, never "offline"
    expect(text()).toContain("This Mac only");
    expect(text()).not.toContain("offline");
    // ...and the sentence that was false since UA-P-0a is gone with its face.
    expect(text()).not.toContain("FIELD_NATIVE_MESH");

    await act(async () => linkAct()?.click());
    expect(fieldd.request).toHaveBeenCalledTimes(1);
    expect(fieldd.request).toHaveBeenCalledWith("user.link.begin", {});
  });

  it("renders a refused begin instead of a blank, and keeps the act", async () => {
    host(vi.fn(async () => PROFILE));
    const fieldd = client({ link: OFFLINE });
    (fieldd.request as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("this user is already linked to a tailscale account; unlink first"),
    );
    await mount(fieldd);

    await act(async () => linkAct()?.click());

    expect(text()).toContain("already linked to a tailscale account; unlink first");
    expect(linkAct()?.disabled).toBe(false);
  });

  it("says what the node is doing while capture runs without an address yet", async () => {
    host(vi.fn(async () => PROFILE));
    await mount(
      client({
        link: {
          link: null,
          meshEnabled: true,
          nodeState: "Starting",
          authUrl: null,
          linkState: "capturing",
          linkDetail: null,
        },
      }),
    );

    expect(text()).toContain("Opening Tailscale…");
    // Capture is already running — offering to start it again would be a lie.
    expect(linkAct()).toBeUndefined();
  });

  it("speaks a corrupt link record verbatim and withholds an act that could only fail", async () => {
    host(vi.fn(async () => PROFILE));
    await mount(
      client({
        link: refused(
          "link_corrupt",
          "link.json is present but unusable: /Users/j/Library/VibeField/users/1/fieldd/link.json",
        ),
      }),
    );

    expect(text()).toContain("Link record unreadable");
    expect(text()).toContain("/Users/j/Library/VibeField/users/1/fieldd/link.json");
    expect(text()).toContain("moved aside");
    expect(linkAct()).toBeUndefined();
  });

  it("speaks a tagged node and offers the act again", async () => {
    host(vi.fn(async () => PROFILE));
    const fieldd = client({
      link: refused(
        "login_unavailable",
        "the tailnet has no user for this node (a tagged node cannot link)",
      ),
    });
    await mount(fieldd);

    expect(text()).toContain("No tailnet user for this node");
    expect(text()).toContain("a tagged node cannot link");

    await act(async () => linkAct()?.click());
    expect(fieldd.request).toHaveBeenCalledWith("user.link.begin", {});
  });

  it("names the other local user holding the account and offers the act again", async () => {
    host(vi.fn(async () => PROFILE));
    const fieldd = client({
      link: refused(
        "login_already_linked",
        'the local user "Work" is already linked to this tailscale account; unlink it first',
      ),
    });
    await mount(fieldd);

    expect(text()).toContain("Already linked by another user here");
    expect(text()).toContain('the local user "Work" is already linked');

    await act(async () => linkAct()?.click());
    expect(fieldd.request).toHaveBeenCalledWith("user.link.begin", {});
  });

  it("does not offer the act to a linked desktop — that path is unlink first", async () => {
    host(vi.fn(async () => PROFILE));
    await mount(
      client({
        link: {
          link: { login: "james@example.com", linkedAt: "2026-08-05T09:00:00.000Z" },
          meshEnabled: true,
          nodeState: "running",
          authUrl: null,
          linkState: "linked",
          linkDetail: null,
        },
      }),
    );

    expect(linkAct()).toBeUndefined();
    expect(text()).toContain("james@example.com");
  });

  it("reads a daemon that predates the posture word from what it did send", async () => {
    // Tolerant reader: no `linkState` on the wire, and the page still lands on
    // the offline face rather than throwing or going blank.
    host(vi.fn(async () => PROFILE));
    await mount(
      client({ link: { link: null, meshEnabled: false, nodeState: null, authUrl: null } }),
    );

    expect(text()).toContain("This Mac only");
    expect(linkAct()).not.toBeUndefined();
  });

  it("writes the posture key as a plain string and reflects the stored value", async () => {
    host(vi.fn(async () => PROFILE));
    const fieldd = client({
      link: OFFLINE,
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
    await mount(client({ link: OFFLINE }));

    expect(text()).toContain("Profile unavailable");
    expect(text()).toContain("users.json is locked");
    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(name?.disabled).toBe(true);
  });
});

// UA-5 §6.3 — the switcher. What matters here is that ONE click hands the
// window over and the page never pretends to know more than it does: the
// reload is the only feedback there is, an absent door is a sentence rather
// than an empty list, and a refused roster does not take the page with it.

const OTHER = {
  userId: "01K0000000000000000000000B",
  fuid: 2,
  name: "Work",
  // A pre-v0.3 user, never attached since: an accent and no face. The roster
  // draws the machine's deal for them, never the accent.
  color: "accent-5",
  resident: true,
  onboarded: true,
};

const ROSTER = { attachedUserId: PROFILE.userId, users: [PROFILE, OTHER] };

const row = (name: string): HTMLButtonElement | null =>
  container?.querySelector<HTMLButtonElement>(`button[aria-label="Switch to ${name}"]`) ?? null;

const newUser = (): HTMLButtonElement | undefined =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (button) => button.textContent?.trim() === "New user…",
  );

const withLink = (): FielddClient => client({ link: OFFLINE });

describe("AccountSection users switcher", () => {
  it("lists the machine's users and marks the attached one as current", async () => {
    const usersList = vi.fn(async () => ROSTER);
    host(
      vi.fn(async () => PROFILE),
      {
        list: usersList,
        create: vi.fn(async () => OTHER),
        switch: vi.fn(async () => OTHER),
      },
    );
    await mount(withLink());

    // Two reads of one roster: the switcher's, and the profile's — which needs
    // to know the faces other users wear before it can offer the picker (I-2).
    expect(usersList).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Users");
    expect(text()).toContain("Work");

    // The attached user is not a control — switching to who you already are is
    // a no-op, so it wears the marker instead of a button.
    expect(row("James")).toBeNull();
    expect(container?.querySelector('[aria-current="true"]')?.textContent).toContain("James");
    expect(text()).toContain("current");
    // ...and everyone else is one click away, named by what the click does.
    expect(row("Work")).not.toBeNull();
    expect(row("Work")?.disabled).toBe(false);
  });

  it("re-reads the list when a face is written on the same page", async () => {
    let face = PROFILE.face;
    host(
      vi.fn(async (params: Record<string, unknown>) => {
        if (params.face !== undefined) face = params.face as typeof face;
        return { ...PROFILE, face };
      }),
      {
        list: vi.fn(async () => ({
          attachedUserId: PROFILE.userId,
          users: [{ ...PROFILE, face }, OTHER],
        })),
      },
    );
    await mount(withLink());
    expect(container?.querySelector('[aria-current="true"]')?.textContent).toContain("🦊");
    await act(async () => changeFace()?.click());
    await act(async () => {
      container?.querySelector<HTMLInputElement>('input[aria-label="🐧"]')?.click();
      await flush();
    });
    // The current user's row changes with the Face row above it.
    expect(container?.querySelector('[aria-current="true"]')?.textContent).toContain("🐧");
  });

  it("switches on one click and leaves the pressed control disabled for the reload", async () => {
    const usersSwitch = vi.fn(async () => OTHER);
    host(
      vi.fn(async () => PROFILE),
      {
        list: vi.fn(async () => ROSTER),
        create: vi.fn(async () => OTHER),
        switch: usersSwitch,
      },
    );
    await mount(withLink());

    await act(async () => row("Work")?.click());

    expect(usersSwitch).toHaveBeenCalledWith({ userId: OTHER.userId });
    // The window is on its way out: nothing re-enables, and no second act can
    // race the first one's attach.
    expect(row("Work")?.disabled).toBe(true);
    expect(newUser()?.disabled).toBe(true);
    expect(text()).not.toContain("Switching…");
  });

  it("mints a new user without asking for a name — the wizard does that", async () => {
    const usersCreate = vi.fn(async () => OTHER);
    host(
      vi.fn(async () => PROFILE),
      {
        list: vi.fn(async () => ROSTER),
        create: usersCreate,
      },
    );
    await mount(withLink());

    await act(async () => newUser()?.click());

    expect(usersCreate).toHaveBeenCalledWith({});
    expect(newUser()?.disabled).toBe(true);
    expect(text()).toContain("setup asks the new user for a name");
  });

  it("says a refused switch out loud and gives the control back", async () => {
    host(
      vi.fn(async () => PROFILE),
      {
        list: vi.fn(async () => ROSTER),
        switch: vi.fn(async () => Promise.reject(new Error("users.json is locked"))),
      },
    );
    await mount(withLink());

    await act(async () => row("Work")?.click());

    // A rejection means no reload is coming, so the row must be pressable again.
    expect(text()).toContain("users.json is locked");
    expect(row("Work")?.disabled).toBe(false);
  });

  it("renders the block disabled with the honest line when the bridge is absent", async () => {
    host(null);
    await mount(withLink());

    expect(text()).toContain("Users");
    expect(text()).toContain("cannot be listed or switched from here");
    expect(newUser()?.disabled).toBe(true);
    expect(container?.querySelector("[aria-current]")).toBeNull();
    // The rest of the page is untouched — one absent door is not a dead page.
    expect(text()).toContain("Sync posture");
  });

  it("never leaves a row disabled without saying why", async () => {
    // A host holding one verb of the door and not the others. Contrived, but
    // the alternative render is a list of controls that answer nothing.
    host(
      vi.fn(async () => PROFILE),
      { list: vi.fn(async () => ROSTER) },
    );
    await mount(withLink());

    expect(row("Work")?.disabled).toBe(true);
    expect(text()).toContain("not switch to them");
  });

  it("keeps the page intact when the roster read is refused", async () => {
    host(
      vi.fn(async () => PROFILE),
      {
        list: vi.fn(async () => Promise.reject(new Error("users.json is locked"))),
        create: vi.fn(async () => OTHER),
      },
    );
    await mount(withLink());

    expect(text()).toContain("Users unavailable");
    expect(text()).toContain("users.json is locked");
    // Minting does not depend on the read that failed.
    expect(newUser()?.disabled).toBe(false);
    expect(text()).toContain("Sync posture");
    expect(text()).toContain("Connect your devices");
  });
});
