// @vitest-environment happy-dom

import type { FielddClient } from "@vibefield/fieldd-client";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootRoot } from "../src/boot/BootRoot";
import type { BootMachine, BootOnboarding, BootView } from "../src/boot/machine";
import { OnboardingWizard } from "../src/boot/onboarding/OnboardingWizard";
import { type FieldHost, type FieldUserProfile, setHost } from "../src/host";

// UA-3w — the Setup Assistant (spec §6). The cases that matter are the ones
// where the wizard must NOT behave like a form: it is entered from durable
// facts rather than remembered position (W6), it never blocks on validation
// (W2), every skip states where the question went (W3), and its last act is a
// durable write that is also the only thing allowed to end it (W5).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTING_UP_BEAT_MS = 900;
const READY_BEAT_MS = 700;
const ENTRY_SETTLE_MS = 1_200;

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

const NO_LINK = { link: null, meshEnabled: false, nodeState: null, authUrl: null };
const LINKED = {
  link: {
    login: "james@example.com",
    tailnet: "example.ts.net",
    linkedAt: "2026-08-05T09:00:00.000Z",
  },
  meshEnabled: true,
  nodeState: "running",
  authUrl: null,
};

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

function host(usersUpdate: NonNullable<FieldHost["usersUpdate"]> | null): void {
  setHost({
    logger: noopLogger,
    getConnection: async () => ({ port: 1, token: "test" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    ...(usersUpdate === null ? {} : { usersUpdate }),
  });
}

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
  it("walks a fresh install: name and accent, the real stages, a named skip, then the flag", async () => {
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
    expect(
      container?.querySelectorAll('[role="radiogroup"][aria-label="Accent color"] input'),
    ).toHaveLength(8);
    // accent-1 is preselected, so Continue always writes a color — which is
    // what makes `color` a trustworthy "pane 2 happened" fact for W6.
    const first = container?.querySelector<HTMLInputElement>('input[aria-label="accent-1"]');
    expect(first?.checked).toBe(true);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(name, "James");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container?.querySelector<HTMLInputElement>('input[aria-label="accent-3"]')?.click();
    });
    await click("Continue");
    expect(updates).toEqual([{ name: "James", color: "accent-3" }]);

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
    expect(onComplete).not.toHaveBeenCalled();
    await tick(READY_BEAT_MS);
    expect(updates).toEqual([{ name: "James", color: "accent-3" }, { onboarded: true }]);
    expect(onComplete).toHaveBeenCalledTimes(1);
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
    // Nothing to go back to, so nothing offers to.
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
    expect(updates).toEqual([{ name: "james", color: "accent-1" }, { onboarded: true }]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("resumes a second user from users.json the same way as any other (W6)", async () => {
    const updates: unknown[] = [];
    host(
      vi.fn(async (params: Record<string, unknown>) => {
        updates.push(params);
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

    // A color on the record means pane 2 completed — the derivation does not
    // care which variant asked it.
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

    // A color on the record means pane 2 completed, and no link means pane 4
    // is the first thing still unanswered.
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
        link: { ...LINKED, link: null, authUrl: "https://login.tailscale.com/a/abc" },
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
    expect(updates).toEqual([{ name: "james", color: "accent-1" }]);
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

    const styles = Array.from(container?.querySelectorAll("style") ?? [])
      .map((tag) => tag.textContent ?? "")
      .join("\n");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain("vf-wizard-fade");
    // Every animated control carries the escape hatch too (M6).
    expect(button("Get started").className).toContain("motion-reduce:transition-none");
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
    const styles = Array.from(container?.querySelectorAll("style") ?? [])
      .map((tag) => tag.textContent ?? "")
      .join("\n");
    expect(styles).toContain("border-radius: 32px");
    expect(styles).toContain("width: min(calc(100vw - 2rem), 44rem)");
    expect(styles).toContain("height: min(calc(100vh - 2rem), 32rem)");
    expect(styles).toContain("background: rgba(255, 255, 255, 0.55)");
    expect(styles).toContain("backdrop-filter: blur(32px) saturate(1.12)");

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
