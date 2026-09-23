// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dealFace, effectiveFaces } from "@vibefield/contracts/user-face";
import type { FielddClient } from "@vibefield/fieldd-client";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootRoot } from "../src/boot/BootRoot";
import type { BootMachine, BootOnboarding, BootView } from "../src/boot/machine";
import { OnboardingWizard } from "../src/boot/onboarding/OnboardingWizard";
import { type FieldHost, type FieldUserProfile, type FieldUserRoster, setHost } from "../src/host";

// UA-3w — the Setup Assistant (spec §6). The cases that matter are the ones
// where the wizard must NOT behave like a form: it is entered from durable
// facts rather than remembered position (W6), it never blocks on validation
// (W2), every skip states where the question went (W3), and its last act is a
// durable write that is also the only thing allowed to end it (W5).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTING_UP_BEAT_MS = 900;
const READY_BEAT_MS = 700;
const ENTRY_SETTLE_MS = 1_200;
const WIZARD_CSS = readFileSync(join(process.cwd(), "src/boot/onboarding/wizard-ui.css"), "utf8");

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

/** A user who has not been through setup — the only record that opens this. */
const FRESH: FieldUserProfile = {
  userId: "01J8ZQ7W9K3M5N7P9R1T3V5X7Z",
  fuid: 1,
  name: "james",
  resident: true,
  onboarded: false,
};

/** UA-D17 — the face the machine deals this user before pane 2 opens: the
 * contract's own deal, against nobody (the harness host has no roster door). */
const DEALT = dealFace(FRESH.userId, []);
const DEALT_FACE = { emoji: DEALT, frame: "sticker" } as const;

/** An unlinked desktop, as UA-P-0a's daemon reports one: `meshEnabled` is FALSE
 * because the mesh derives from the link, and the posture word is what says so.
 * UA-P-0g is where this pane stopped being a dead end for it. */
const NO_LINK = {
  link: null,
  meshEnabled: false,
  nodeState: null,
  authUrl: null,
  linkState: "offline",
  linkDetail: null,
};
const LINKED = {
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});
afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function host(
  usersUpdate: NonNullable<FieldHost["usersUpdate"]> | null,
  extra: Partial<FieldHost> = {},
): void {
  setHost({
    logger: noopLogger,
    getConnection: async () => ({ port: 1, token: "test" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    ...(usersUpdate === null ? {} : { usersUpdate }),
    ...extra,
  });
}

/** A roster door whose one read lands only when the test says so. */
function lateRoster(): {
  usersList: () => Promise<FieldUserRoster>;
  land: (users: FieldUserProfile[]) => Promise<void>;
} {
  let resolve: (roster: FieldUserRoster) => void = () => undefined;
  const read = new Promise<FieldUserRoster>((settle) => {
    resolve = settle;
  });
  return {
    usersList: () => read,
    land: async (users) => {
      await act(async () => {
        resolve({ attachedUserId: FRESH.userId, users });
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

/** The machine's first user, set up — who a second user's chooser offers. */
const OWNER: FieldUserProfile = {
  userId: "01K0000000000000000000000A",
  fuid: 1,
  name: "James",
  face: { emoji: "🦊" },
  resident: true,
  onboarded: true,
};
/** The second user this window is setting up. */
const SECOND: FieldUserProfile = { ...FRESH, fuid: 2, setupVariant: "second-user" };

/** A chooser tile, found by what it does. */
const tile = (label: string): HTMLButtonElement | null =>
  container?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;

/** Let a roster read land. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Another user on the machine, already wearing `emoji`. */
const wearing = (emoji: string): FieldUserProfile => ({
  userId: "01K0000000000000000000000B",
  fuid: 2,
  name: "Work",
  face: { emoji },
  resident: true,
  onboarded: true,
});

/** The product half. `link: undefined` makes `user.link.subscribe` REJECT,
 * which is what a daemon without the UA-3 method actually does. */
function client(
  options: { link?: unknown; preferences?: Record<string, unknown> } = {},
): FielddClient {
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

function onboarding(profile: Partial<FieldUserProfile> = {}): BootOnboarding {
  return {
    profile: { ...FRESH, ...profile },
    stagesDone: ["waking the daemon", "loading the field"],
  };
}

async function mount(props: {
  fieldd: FielddClient;
  onboarding: BootOnboarding;
  onComplete: () => void;
}): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(OnboardingWizard, {
        client: props.fieldd,
        onboarding: props.onboarding,
        onComplete: props.onComplete,
      }),
    );
  });
  // The entry pane may wait on the link snapshot (bounded) before it decides.
  await act(async () => {
    vi.advanceTimersByTime(ENTRY_SETTLE_MS);
  });
}

const text = (): string => container?.textContent ?? "";

function button(label: string): HTMLButtonElement {
  const found = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no button labelled "${label}" in: ${text()}`);
  return found;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    button(label).click();
  });
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Setup Assistant", () => {
  it("walks a fresh install: name and face, the real stages, a named skip, then the flag", async () => {
    const updates: unknown[] = [];
    const usersUpdate = vi.fn(async (params: Record<string, unknown>) => {
      updates.push(params);
      return { ...FRESH, ...params } as FieldUserProfile;
    });
    host(usersUpdate);
    const onComplete = vi.fn();
    await mount({ fieldd: client({ link: NO_LINK }), onboarding: onboarding(), onComplete });

    // 1 — Welcome. One decision, and it is not a question (W1).
    expect(text()).toContain("Welcome.");
    expect(text()).toContain(
      "Manage all your agents and compose your agentic workflow in one place.",
    );
    await click("Get started");

    // 2 — the mandatory core: a name, PRE-FILLED (W2).
    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(name?.value).toBe("james");
    // The face was dealt before the pane opened (UA-D17): it is already on
    // screen, so Continue always writes one — which is what makes `face` a
    // trustworthy "pane 2 happened" fact for W6.
    expect(container?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      `james, ${DEALT}`,
    );
    // The picker is already open beside the name — the whole pane fits its
    // shell, so there is nothing to open and nothing to scroll to.
    const deck = container?.querySelectorAll<HTMLInputElement>(
      '[role="radiogroup"][aria-label="Face"] input',
    );
    expect(deck?.length).toBeGreaterThan(40);
    expect(
      container?.querySelector<HTMLInputElement>(`input[aria-label="${DEALT}"]`)?.checked,
    ).toBe(true);
    const other = DEALT === "🐧" ? "🦉" : "🐧";

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(name, "James");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector<HTMLInputElement>(`input[aria-label="${other}"]`)?.click();
    });
    await click("Continue");
    expect(updates).toEqual([{ name: "James", face: { emoji: other, frame: "sticker" } }]);

    // 3 — setting up: the stages this boot really passed, and no bar (W4).
    expect(text()).toContain("waking the daemon");
    expect(text()).toContain("loading the field");
    expect(container?.querySelector('[role="progressbar"]')).toBeNull();

    // ...and it advances on its own.
    await tick(SETTING_UP_BEAT_MS);
    expect(text()).toContain("Connect your devices");

    // 4 — skippable, and the skip says where the question went (W3).
    expect(text()).toContain("Set up later — Settings → Account");
    await click("Skip");

    // 5 — Ready: one beat, then the durable write, and only then the release.
    expect(text()).toContain("Welcome to your field, James");
    // ...and where Settings went, said once (DESIGN.md §8): a face does not
    // say "settings" the way the gear did.
    expect(text()).toContain("Your face in the bottom-left corner opens Settings — so does");
    expect(onComplete).not.toHaveBeenCalled();
    await tick(READY_BEAT_MS);
    expect(updates).toEqual([
      { name: "James", face: { emoji: other, frame: "sticker" } },
      { onboarded: true },
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("re-deals the proposal against the roster when it lands, if nobody picked", async () => {
    const roster = lateRoster();
    host(
      vi.fn(
        async (params: Record<string, unknown>) => ({ ...FRESH, ...params }) as FieldUserProfile,
      ),
      { usersList: roster.usersList },
    );
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete: vi.fn(),
    });
    await click("Get started");
    // Somebody else already wears the face dealt against nobody.
    const users = [FRESH, wearing(DEALT)];
    await roster.land(users);
    const redealt = effectiveFaces(users).get(FRESH.userId)?.face.emoji;
    expect(redealt).not.toBe(DEALT);
    expect(container?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      `james, ${redealt}`,
    );
  });

  it("keeps a face picked before the roster lands — a late read never re-deals a choice", async () => {
    const roster = lateRoster();
    host(
      vi.fn(
        async (params: Record<string, unknown>) => ({ ...FRESH, ...params }) as FieldUserProfile,
      ),
      { usersList: roster.usersList },
    );
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete: vi.fn(),
    });
    await click("Get started");
    const picked = DEALT === "🐧" ? "🦉" : "🐧";
    await act(async () => {
      container?.querySelector<HTMLInputElement>(`input[aria-label="${picked}"]`)?.click();
    });
    // The roster arrives after the pick, holding someone who wears the deal.
    await roster.land([FRESH, wearing(DEALT)]);
    expect(
      container?.querySelector<HTMLInputElement>(`input[aria-label="${picked}"]`)?.checked,
    ).toBe(true);
    expect(container?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      `james, ${picked}`,
    );
  });

  it("asks a migrated field two things, not five", async () => {
    const usersUpdate = vi.fn(
      async (params: Record<string, unknown>) =>
        ({
          ...FRESH,
          setupVariant: "migrated",
          ...params,
        }) as FieldUserProfile,
    );
    host(usersUpdate);
    const onComplete = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ setupVariant: "migrated" }),
      onComplete,
    });

    expect(text()).toContain("Your field now lives in a user");
    await click("Continue"); // → the name pane
    expect(container?.querySelector('input[aria-label="Your name"]')).not.toBeNull();
    await click("Continue"); // → straight to Ready; no setting-up, no connect

    expect(text()).toContain("Welcome to your field");
    expect(text()).not.toContain("Connect your devices");
    await tick(READY_BEAT_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("opens a second user at the name pane and ends without a greeting", async () => {
    const updates: unknown[] = [];
    // The variant rides the record's passthrough, so the answer to a write
    // carries it back — exactly as a real supervisor's whole-record answer does.
    const usersUpdate = vi.fn(async (params: Record<string, unknown>) => {
      updates.push(params);
      return { ...FRESH, setupVariant: "second-user", ...params } as FieldUserProfile;
    });
    host(usersUpdate);
    const onComplete = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ setupVariant: "second-user" }),
      onComplete,
    });

    // §6.2 — panes 2 → 4. There is no Welcome: the field is already set up and
    // only this person is new.
    expect(text()).not.toContain(
      "Manage all your agents and compose your agentic workflow in one place.",
    );
    expect(text()).not.toContain("Your field now lives in a user");
    expect(container?.querySelector('input[aria-label="Your name"]')).not.toBeNull();
    expect(text()).toContain("New user");
    // No roster door on this host, so no chooser to go back to — and nothing
    // offers to.
    expect(
      Array.from(container?.querySelectorAll("button") ?? []).some(
        (candidate) => candidate.textContent?.trim() === "Back",
      ),
    ).toBe(false);

    await click("Continue"); // pane 2 → 3
    expect(text()).toContain("Your field is already running");
    await tick(SETTING_UP_BEAT_MS);
    expect(text()).toContain("Connect your devices"); // pane 4

    await click("Skip");
    // No Ready beat: the write goes out immediately, and the greeting a first
    // run gets is never shown to the second user.
    await tick(0);
    expect(text()).not.toContain("Welcome to your field");
    expect(updates).toEqual([{ name: "james", face: DEALT_FACE }, { onboarded: true }]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("takes a second user's Back to the users chooser, and Continue setup back again", async () => {
    const usersSwitch = vi.fn(async () => OWNER);
    host(
      vi.fn(
        async (params: Record<string, unknown>) => ({ ...SECOND, ...params }) as FieldUserProfile,
      ),
      {
        usersList: async () => ({ attachedUserId: SECOND.userId, users: [OWNER, SECOND] }),
        usersSwitch,
      },
    );
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ fuid: 2, setupVariant: "second-user" }),
      onComplete: vi.fn(),
    });
    expect(text()).toContain("New user");

    // The user being set up already exists, so Back means: choose who to enter.
    await click("Back");
    await settle();
    expect(text()).toContain("Choose a user");
    expect(tile("Open James's field")).not.toBeNull();
    expect(tile("Continue setting up james")?.textContent).toContain("Setting up");

    await click("Continue setup");
    expect(container?.querySelector('input[aria-label="Your name"]')).not.toBeNull();

    // Choosing another user switches this window to them — the reload is the
    // feedback, so the tile says so and everything else waits.
    await click("Back");
    await settle();
    await act(async () => {
      tile("Open James's field")?.click();
      await Promise.resolve();
    });
    expect(usersSwitch).toHaveBeenCalledWith({ userId: OWNER.userId });
    expect(tile("Open James's field")?.textContent).toContain("Opening…");
    expect(tile("Continue setting up james")?.disabled).toBe(true);
  });

  it("says a refused switch on the chooser, in main's words, and gives the tiles back", async () => {
    host(
      vi.fn(async () => SECOND),
      {
        usersList: async () => ({ attachedUserId: SECOND.userId, users: [OWNER, SECOND] }),
        usersSwitch: vi.fn(async () => {
          throw new Error("a user switch is already in flight");
        }),
      },
    );
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ fuid: 2, setupVariant: "second-user" }),
      onComplete: vi.fn(),
    });
    await click("Back");
    await settle();
    await act(async () => {
      tile("Open James's field")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't open James's field — a user switch is already in flight.",
    );
    expect(tile("Open James's field")?.disabled).toBe(false);
  });

  it("resumes a second user from users.json the same way as any other (W6)", async () => {
    const updates: unknown[] = [];
    host(
      vi.fn(async (params: Record<string, unknown>) => {
        updates.push(params);
        return {
          ...FRESH,
          face: { emoji: "🐙" },
          setupVariant: "second-user",
          ...params,
        } as FieldUserProfile;
      }),
    );
    const onComplete = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ face: { emoji: "🐙" }, setupVariant: "second-user" }),
      onComplete,
    });

    // A face on the record means pane 2 completed (UA-D17) — the derivation does
    // not care which variant asked it.
    expect(text()).toContain("Connect your devices");
    expect(container?.querySelector('input[aria-label="Your name"]')).toBeNull();

    await click("Skip");
    await tick(0);
    expect(updates).toEqual([{ onboarded: true }]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("never claims a second user is set up on a flag write it could not land", async () => {
    let failFlag = true;
    host(
      vi.fn(async (params: Record<string, unknown>) => {
        if (params.onboarded === true && failFlag) throw new Error("users.json is locked");
        return {
          ...FRESH,
          color: "accent-2",
          setupVariant: "second-user",
          ...params,
        } as FieldUserProfile;
      }),
    );
    const onComplete = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ color: "accent-2", setupVariant: "second-user" }),
      onComplete,
    });

    await click("Skip");
    await tick(0);
    // The variant drops the greeting, never the honesty that goes with it.
    expect(onComplete).not.toHaveBeenCalled();
    expect(text()).toContain("Setup could not be recorded");
    expect(text()).toContain("setup asks again next time");

    failFlag = false;
    await click("Try again");
    await tick(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("resumes at the first unanswered pane after a quit — from users.json, not memory", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    // A pre-v0.3 record's accent means pane 2 was answered before faces
    // existed, and no link means pane 4 is the first thing still unanswered.
    expect(text()).toContain("Connect your devices");
    expect(text()).not.toContain(
      "Manage all your agents and compose your agentic workflow in one place.",
    );
    expect(container?.querySelector('input[aria-label="Your name"]')).toBeNull();
  });

  it("does not re-ask a root that is already linked — it moves on to the posture question", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    await mount({
      fieldd: client({ link: LINKED }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    expect(text()).toContain("What should new projects do?");
    expect(
      container?.querySelectorAll('[role="radiogroup"][aria-label="Sync posture"] input'),
    ).toHaveLength(2);
  });

  it("writes the posture through the same key and words as Settings → Account", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    const fieldd = client({ link: LINKED });
    await mount({ fieldd, onboarding: onboarding({ color: "accent-2" }), onComplete: vi.fn() });

    expect(text()).toContain("Sync new projects automatically");
    expect(text()).toContain("Ask per project");
    const cards = container?.querySelectorAll<HTMLInputElement>(
      '[role="radiogroup"][aria-label="Sync posture"] input[type="radio"]',
    );
    await act(async () => cards?.[1]?.click());
    expect(fieldd.request).toHaveBeenCalledWith("storage.appPreferences.set", {
      key: "mesh.syncPosture",
      value: "opt-in",
    });
  });

  it("names the tailnet on the linked face and offers the browser flow while it waits", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    await mount({
      fieldd: client({
        link: {
          ...LINKED,
          link: null,
          linkState: "capturing",
          authUrl: "https://login.tailscale.com/a/abc",
        },
      }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    const anchor = container?.querySelector<HTMLAnchorElement>(
      'a[href^="https://login.tailscale"]',
    );
    expect(anchor?.textContent).toBe("Link Tailscale account");
    expect(anchor?.target).toBe("_blank");
    expect(text()).toContain("Finish signing in in your browser");
  });

  // UA-P-0g — pane 4 is where the link BEGINS, on the same daemon method and
  // under the same phrase as Settings → Account. Before this it could only
  // report a link someone else had already made.

  it("begins the link from pane 4 and sends exactly one begin", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    const fieldd = client({ link: NO_LINK });
    await mount({
      fieldd,
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    expect(text()).toContain("Connect your devices");
    expect(text()).toContain("Not linked yet");
    // ...and the sentence that was false since UA-P-0a is gone with its face.
    expect(text()).not.toContain("FIELD_NATIVE_MESH");

    await click("Link Tailscale account");
    expect(fieldd.request).toHaveBeenCalledTimes(1);
    expect(fieldd.request).toHaveBeenCalledWith("user.link.begin", {});
  });

  it("renders a refused begin on the pane instead of swallowing it", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    const fieldd = client({ link: NO_LINK });
    (fieldd.request as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("link.json is present but unusable; move it aside to link again: /x/link.json"),
    );
    await mount({
      fieldd,
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    await click("Link Tailscale account");

    expect(text()).toContain("move it aside to link again: /x/link.json");
    expect(container?.querySelector('[role="alert"]')).not.toBeNull();
    // A refusal is not a trap: the pane's other ways out are still there (W3).
    expect(button("Continue")).not.toBeUndefined();
    expect(button("Skip")).not.toBeUndefined();
  });

  it("speaks each refused posture with the daemon's own sentence", async () => {
    const cases = [
      {
        wire: refused(
          "login_unavailable",
          "the tailnet has no user for this node (a tagged node cannot link)",
        ),
        title: "No tailnet user for this node",
        act: true,
      },
      {
        wire: refused(
          "login_already_linked",
          'the local user "Work" is already linked to this tailscale account; unlink it first',
        ),
        title: "Already linked by another user here",
        act: true,
      },
      {
        wire: refused("link_corrupt", "link.json is present but unusable: /x/link.json"),
        title: "Link record unreadable",
        act: false,
      },
    ];

    for (const shape of cases) {
      host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
      await mount({
        fieldd: client({ link: shape.wire }),
        onboarding: onboarding({ color: "accent-2" }),
        onComplete: vi.fn(),
      });

      expect(text()).toContain(shape.title);
      expect(text()).toContain(String(shape.wire.linkDetail));
      // The act is offered only where asking again is a real act: a corrupt
      // record refuses `begin` by construction until the file is moved aside.
      const offered = Array.from(container?.querySelectorAll("button") ?? []).some(
        (candidate) => candidate.textContent?.trim() === "Link Tailscale account",
      );
      expect(offered).toBe(shape.act);

      await act(async () => root?.unmount());
      root = null;
      container?.remove();
      container = null;
    }
  });

  it("says what capture is waiting on before the node offers an address", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    await mount({
      fieldd: client({
        link: { ...NO_LINK, meshEnabled: true, nodeState: "Starting", linkState: "capturing" },
      }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    expect(text()).toContain("Asking the tailnet who this node is");
    // Capture is already running — offering to start it again would be a lie.
    expect(
      Array.from(container?.querySelectorAll("button") ?? []).some(
        (candidate) => candidate.textContent?.trim() === "Link Tailscale account",
      ),
    ).toBe(false);
  });

  it("holds the pane and says why when the profile write is refused", async () => {
    host(vi.fn(async () => Promise.reject(new Error("users.json is locked"))));
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete: vi.fn(),
    });

    await click("Get started");
    await click("Continue"); // the write, which fails

    expect(text()).toContain("That did not save");
    expect(text()).toContain("users.json is locked");
    // Still on pane 2 — a refused write never counts as an answered question.
    expect(container?.querySelector('input[aria-label="Your name"]')).not.toBeNull();
    expect(text()).not.toContain("Welcome to your field");
  });

  it("never blocks Continue on an empty name — it keeps the one it came in with (W2)", async () => {
    const updates: unknown[] = [];
    host(
      vi.fn(async (params: Record<string, unknown>) => {
        updates.push(params);
        return { ...FRESH, ...params } as FieldUserProfile;
      }),
    );
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete: vi.fn(),
    });

    await click("Get started");
    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(name, "   ");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button("Continue").disabled).toBe(false);
    await click("Continue");
    expect(updates).toEqual([{ name: "james", face: DEALT_FACE }]);
  });

  it("never claims to be finished on a flag write it could not land", async () => {
    let failFlag = true;
    const usersUpdate = vi.fn(async (params: Record<string, unknown>) => {
      if (params.onboarded === true && failFlag) throw new Error("users.json is locked");
      return { ...FRESH, color: "accent-2", ...params } as FieldUserProfile;
    });
    host(usersUpdate);
    const onComplete = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete,
    });

    await click("Skip"); // pane 4 → Ready
    await tick(READY_BEAT_MS);
    // The hold is NOT released: nothing durable says setup happened.
    expect(onComplete).not.toHaveBeenCalled();
    expect(text()).toContain("Setup could not be recorded");
    expect(text()).toContain("setup asks again next time");

    failFlag = false;
    await click("Try again");
    await tick(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("lets a stuck flag write out to the field anyway, saying what that costs", async () => {
    host(
      vi.fn(async (params: Record<string, unknown>) => {
        if (params.onboarded === true) throw new Error("users.json is locked");
        return { ...FRESH, color: "accent-2", ...params } as FieldUserProfile;
      }),
    );
    const onComplete = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete,
    });

    await click("Skip");
    await tick(READY_BEAT_MS);
    await click("Continue anyway");
    // The boot proceeds — the wizard is a hold, never a trap — and the
    // unflipped record means it honestly asks again next launch.
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("is operable from the keyboard alone: the field takes focus and Enter advances", async () => {
    host(
      vi.fn(
        async (params: Record<string, unknown>) => ({ ...FRESH, ...params }) as FieldUserProfile,
      ),
    );
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete: vi.fn(),
    });

    await click("Get started");
    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(document.activeElement).toBe(name);

    // The primary action IS the form's submit, so Enter and the pointer take
    // the same path.
    const form = container?.querySelector("form");
    expect(button("Continue").type).toBe("submit");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(text()).toContain("Your field is already running");
  });

  it("respects reduced motion — the pane entrance has a fade fallback, no transitions survive", async () => {
    host(vi.fn(async () => FRESH));
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete: vi.fn(),
    });

    expect(WIZARD_CSS).toContain("prefers-reduced-motion: reduce");
    expect(WIZARD_CSS).toContain("vf-wizard-fade");
    // Every animated control carries the escape hatch too (M6).
    expect(button("Get started").className).toContain("motion-reduce:transition-none");
  });

  it("centres the shell safely, so a tall pane never loses its title above the fold", () => {
    // Pane 2 with its face picker open (UA-D17) is taller than a small shell.
    // Plain centring inside a scroller overflows both ways, and the top half
    // can never be scrolled to; `safe` sends the overflow downward only.
    expect(WIZARD_CSS).toMatch(/\.vf-wizard-shell-content \{[^}]*align-items: safe center;/);
  });

  it("puts every wizard pane on the shared rounded glass surface", async () => {
    host(vi.fn(async () => FRESH));
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete: vi.fn(),
    });

    const shell = container?.querySelector(".vf-wizard-shell");
    expect(shell).not.toBeNull();
    expect(container?.querySelector("form.vf-wizard-pane")).not.toBeNull();
    expect(WIZARD_CSS).toContain("border-radius: var(--vf-radius-island)");
    expect(WIZARD_CSS).toContain("width: min(calc(100vw - 2rem), 44rem)");
    expect(WIZARD_CSS).toContain("height: min(calc(100vh - 2rem), 32rem)");
    expect(WIZARD_CSS).toContain("background: var(--vf-wizard-surface)");
    expect(WIZARD_CSS).toContain("backdrop-filter: blur(32px) saturate(1.12)");

    await click("Get started");
    expect(container?.querySelector(".vf-wizard-shell")).toBe(shell);
    expect(container?.querySelector("form.vf-wizard-pane")).not.toBeNull();
  });

  it("keeps the app's round light/dark control in the shell", async () => {
    host(vi.fn(async () => FRESH));
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete: vi.fn(),
    });

    const toggle = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch to dark mode"]',
    );
    expect(toggle?.className).toContain("h-10 w-10");
    expect(toggle?.className).toContain("absolute top-5 right-5");
    await act(async () => toggle?.click());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(container?.querySelector('button[aria-label="Switch to light mode"]')).not.toBeNull();
  });

  it("keeps going when there is no supervisor bridge at all rather than trapping the boot", async () => {
    host(null);
    const onComplete = vi.fn();
    await mount({ fieldd: client({ link: NO_LINK }), onboarding: onboarding(), onComplete });

    await click("Get started");
    await click("Continue"); // nothing to write to — the pane still advances
    await tick(SETTING_UP_BEAT_MS);
    await click("Skip");
    await tick(READY_BEAT_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("BootRoot during onboarding", () => {
  /** The machine, held at the wizard: client live, document not yet open. */
  function heldMachine(): { machine: BootMachine; completeOnboarding: () => void } {
    const view: BootView = {
      phase: "onboarding",
      unavailable: null,
      stage: "",
      progress: null,
      degradedReveal: false,
    };
    const completeOnboarding = vi.fn();
    const machine: BootMachine = {
      view: () => view,
      subscribe: () => () => undefined,
      get ready() {
        return null;
      },
      get client() {
        return client({ link: NO_LINK });
      },
      get onboarding() {
        return onboarding();
      },
      start: () => {},
      retry: () => {},
      closePlugins: async () => undefined,
      completeOnboarding,
    };
    return { machine, completeOnboarding };
  }

  it("gives the wizard the splash's layer and ground, and stands the splash face down", async () => {
    host(vi.fn(async () => FRESH));
    const { machine } = heldMachine();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(BootRoot, { machine }));
    });

    // Same full-bleed ground the splash paints...
    const ground = container.querySelector(".vf-splash");
    expect(ground).not.toBeNull();
    expect(ground?.className).toContain("absolute inset-0");
    // ...without the splash's own face: no bar, no stage line.
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(text()).toContain(
      "Manage all your agents and compose your agentic workflow in one place.",
    );
  });
});
