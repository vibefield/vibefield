// @vitest-environment happy-dom

import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_CATALOG } from "@vibefield/contracts/agent-catalog";
import { dealFace, effectiveFaces } from "@vibefield/contracts/user-face";
import type { FielddClient } from "@vibefield/fieldd-client";
import { createElement, act as reactAct } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, vi, it as vitestIt } from "vitest";
import { BootRoot } from "../src/boot/BootRoot";
import type { BootMachine, BootOnboarding, BootView } from "../src/boot/machine";
import { OnboardingWizard } from "../src/boot/onboarding/OnboardingWizard";
import { type FieldHost, type FieldUserProfile, type FieldUserRoster, setHost } from "../src/host";

// UA-3w — the Setup Assistant (spec §6). The cases that matter are the ones
// where the wizard must NOT behave like a form: it is entered from durable
// facts rather than remembered position (W6), it never blocks on validation
// (W2), every skip states where the question went (W3), and its answers end in
// a durable write that is the only thing allowed to release the boot (W5).
// AO-1 (track AO, AO-D2): pane 3 is retired, and Setting up is the end of
// every path — the write, the desk opening beneath the glass in the boot
// machine's own words, then the welcome and the hand-over.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Item 82 — no act() outlives its row. React keeps one act scope for the whole
 * module (`actScopeDepth`), and an act still pending when its row timed out held
 * it open: every act after it nested inside, flushed nothing, and the rows behind
 * read an empty DOM, so one slow row was 40 reds (item 81's verify at
 * `6e0da9902`, 2026-10-27). Each row runs in a scope of its own instead: vitest
 * aborts the row's signal at its timeout, which ends the act the row was in; a
 * row that is over starts no other; and afterEach lets the row's acts close
 * before the next row mounts. */
interface Row {
  signal: AbortSignal;
  /** Rejects with the row's own timeout once vitest aborts its signal. */
  ended: Promise<never>;
}
const row = new AsyncLocalStorage<Row>();
const rowActs: Promise<void>[] = [];

function inRow(body: () => void | Promise<void>) {
  return ({ signal }: { signal: AbortSignal }): void | Promise<void> => {
    const ended = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    ended.catch(() => undefined); // a row that times out between acts races nothing
    return row.run({ signal, ended }, body);
  };
}

function it(name: string, body: () => void | Promise<void>, timeout?: number): void {
  vitestIt(name, inRow(body), timeout);
}
/** A row that must fail: item 82's own proof times one out on purpose. */
it.fails = (name: string, body: () => void | Promise<void>, timeout?: number): void => {
  vitestIt.fails(name, inRow(body), timeout);
};

function act(callback: () => void | Promise<void>): Promise<void> {
  const current = row.getStore();
  current?.signal.throwIfAborted();
  return reactAct(() => {
    const result = callback();
    if (current === undefined || !(result instanceof Promise)) return result;
    const open = Promise.race([result, current.ended]);
    rowActs.push(open);
    return open;
  });
}

/** DESIGN.md §6, the hand-over: the welcome's beat before the glass leaves. */
const WELCOME_BEAT_MS = 1_400;
/** DESIGN.md §8 (AO-D4): how long past the desk Setting up waits for History's
 * first pass before it offers Start now. */
const START_NOW_AFTER_MS = 8_000;
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
afterEach(async () => {
  await Promise.allSettled(rowActs.splice(0));
  if (root !== null) act(() => root?.unmount());
  root = null;
  mounted = null;
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

/** AO-2/AO-3/AO-5 — the ledger of someone who answered the agent chapter
 * before they quit: a record that resumes past the name lands where it did
 * before the chapter. */
const CHAPTER_ANSWERED = {
  format: 1,
  steps: {
    agents: { state: "answered", at: "2026-10-27T05:41:20.000Z" },
    profiles: { state: "answered", at: "2026-10-27T05:41:25.000Z" },
    history: { state: "answered", at: "2026-10-27T05:41:30.000Z" },
  },
  hidden: false,
};

/** AO-5 — an install as `agents.installs` answers it, for a catalog row. */
const installOf = (provider: string, version: string): Record<string, unknown> => ({
  provider,
  executable: `/usr/local/bin/${provider}`,
  realPath: `/usr/local/bin/${provider}`,
  version,
  method: "native-installer",
  autoUpdate: "enabled",
  active: true,
});
/** The catalog's supported agents — derived from the table, so no agent is
 * named here. */
const SUPPORTED = AGENT_CATALOG.filter((row) => row.status === "supported");

/** The product half. `link: undefined` makes `user.link.subscribe` REJECT,
 * which is what a daemon without the UA-3 method actually does. */
/** AO-4b — the daemon's next History status, pushed to whoever subscribed. */
let pushIndex: ((payload: unknown) => void) | null = null;

function client(
  options: {
    link?: unknown;
    preferences?: Record<string, unknown>;
    ledger?: unknown;
    /** History's status as `index.status.subscribe` answers it (absent: refused) */
    index?: unknown;
    /** AO-5 — what `agents.installs` answers, with the catalog beside it
     * (absent: the harness answers neither, and the Agents pane keeps looking) */
    installs?: readonly unknown[];
  } = {},
): FielddClient {
  const preferences = options.preferences ?? {
    showTray: true,
    backgroundShell: true,
    syncPosture: "automatic",
  };
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string, _params: unknown, frame: (p: unknown) => void) => {
      if (method === "index.status.subscribe" && options.index !== undefined) {
        pushIndex = frame;
        return { subId: "index-status", snapshot: options.index, unsubscribe: () => undefined };
      }
      if (method === "storage.appPreferences.subscribe") {
        return { subId: "app-preferences", snapshot: preferences, unsubscribe: () => undefined };
      }
      if (method === "user.link.subscribe") {
        if (options.link === undefined) throw new Error("method not found: user.link.subscribe");
        return { subId: "user-link", snapshot: options.link, unsubscribe: () => undefined };
      }
      // TS-2 — the Connect pane's arrival reads the account's devices
      if (method === "device.subscribe") {
        return { subId: "devices", snapshot: [], unsubscribe: () => undefined };
      }
      if (method === "setup.subscribe") {
        return {
          subId: "setup",
          snapshot: options.ledger ?? CHAPTER_ANSWERED,
          unsubscribe: () => undefined,
        };
      }
      throw new Error(`unexpected subscription: ${method}`);
    }),
    request: vi.fn(async (method: string) => {
      if (options.installs !== undefined && method === "agent.catalog") {
        return { catalog: AGENT_CATALOG };
      }
      if (options.installs !== undefined && method === "agents.installs") {
        return { installs: options.installs };
      }
      return { ok: true };
    }),
  } as unknown as FielddClient;
}

function onboarding(profile: Partial<FieldUserProfile> = {}): BootOnboarding {
  return { profile: { ...FRESH, ...profile } };
}

/** The boot machine's view, as the wizard is handed it. */
function bootAt(phase: BootView["phase"], patch: Partial<BootView> = {}): BootView {
  return { phase, unavailable: null, stage: "", progress: null, degradedReveal: false, ...patch };
}

interface MountProps {
  fieldd: FielddClient;
  onboarding: BootOnboarding;
  onComplete: (profile?: FieldUserProfile) => void;
  onReveal?: () => void;
  onRetry?: () => void;
  boot?: BootView;
}
let mounted: (MountProps & { boot: BootView }) | null = null;

function render(): void {
  if (mounted === null) return;
  root?.render(
    createElement(OnboardingWizard, {
      client: mounted.fieldd,
      onboarding: mounted.onboarding,
      boot: mounted.boot,
      onComplete: mounted.onComplete,
      onReveal: mounted.onReveal ?? (() => undefined),
      onRetry: mounted.onRetry ?? (() => undefined),
    }),
  );
}

async function mount(props: MountProps): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = { ...props, boot: props.boot ?? bootAt("onboarding") };
  await act(async () => render());
  // The entry pane may wait on the link snapshot (bounded) before it decides.
  await act(async () => {
    vi.advanceTimersByTime(ENTRY_SETTLE_MS);
  });
}

/** The boot machine moves on beneath the glass: the wizard is handed its view. */
async function boot(view: BootView): Promise<void> {
  if (mounted === null) throw new Error("nothing is mounted");
  mounted = { ...mounted, boot: view };
  await act(async () => render());
}

/** The visible title. Setting up's two titles share one cell (M1), and the one
 * not showing is hidden from assistive tech, so it is not the title. */
const title = (): string => {
  const heading = container?.querySelector("h1");
  const swap = heading?.querySelector(".vf-wizard-title-swap");
  if (swap === null || swap === undefined) return heading?.textContent ?? "";
  return Array.from(swap.children)
    .filter((part) => part.getAttribute("aria-hidden") !== "true")
    .map((part) => part.textContent ?? "")
    .join("");
};

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

/** A lazy pane's code arrives INSIDE act, so React retries the suspended pane in
 * the test's own scope rather than on its scheduler; turns until `done` holds,
 * bounded, so a loaded host waits longer and a wrong pane still fails. */
async function arrive(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 20 && !done(); turn += 1) {
    await act(async () => {
      await vi.dynamicImportSettled();
      // A row that timed out while the code arrived goes no further: the clock
      // these turns would advance is the next row's (item 82).
      row.getStore()?.signal.throwIfAborted();
      vi.advanceTimersByTime(10);
      for (let hop = 0; hop < 8; hop += 1) await Promise.resolve();
    });
  }
}

/** AO-5 — Profiles has nothing to explain from this harness (its daemon has no
 * profiles feed), so once its code arrives it moves on by itself (AO-L2). */
async function pastProfiles(): Promise<void> {
  await arrive(() => title() !== "Every subscription, side by side.");
  expect(title()).not.toBe("Every subscription, side by side.");
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Setup Assistant", () => {
  it("walks a fresh install: name and face, a named skip, then Setting up over the desk it opens, the welcome and the hand-over", async () => {
    const updates: unknown[] = [];
    const usersUpdate = vi.fn(async (params: Record<string, unknown>) => {
      updates.push(params);
      return { ...FRESH, ...params } as FieldUserProfile;
    });
    host(usersUpdate);
    const onComplete = vi.fn();
    const onReveal = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete,
      onReveal,
    });

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

    // 3 — the agent chapter (AO-5): Agents opens on the inventory. This
    // harness's daemon has none to give, so the pane claims nothing, says it
    // is looking, and Continue moves on without recording anything.
    expect(title()).toBe("Your agents.");
    expect(text()).toContain("Looking on this Mac…");
    await click("Continue");
    await pastProfiles();

    // History (AO-3) asks whose past comes in; with no census to give it
    // says it is looking too, and Continue moves on.
    expect(text()).toContain("Bring in your past sessions.");
    expect(text()).not.toContain("Your field is already running"); // pane 3 retired (AO-D2)
    await click("Continue");

    // 4 — Connect. Skippable, and the skip says where the question went (W3).
    expect(text()).toContain("Your field, on every device.");
    expect(text()).toContain("Set up later — Settings → Devices");
    await click("Not now");

    // 5 — Setting up: the answers are written first, and only a landed write
    // releases the boot (W5) — the document opens beneath the glass.
    expect(updates).toEqual([
      { name: "James", face: { emoji: other, frame: "sticker" } },
      { onboarded: true },
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboarded: true }));
    expect(title()).toBe("Getting your desk ready.");
    // W4 — the desk's line is the boot machine's own phase and stage, never a bar.
    await boot(bootAt("warming", { stage: "drawing the board", progress: 0.6 }));
    const desk = container?.querySelector('.vf-wizard-phase[data-state="live"]');
    expect(desk?.textContent).toContain("Your desk");
    expect(desk?.textContent).toContain("drawing the board");
    expect(container?.querySelector('[role="progressbar"]')).toBeNull();
    // The welcome's words hold their cell from the start (M1), hidden until Ready.
    expect(container?.querySelector(".vf-wizard-title-swap")?.children).toHaveLength(2);
    expect(title()).not.toContain("Welcome");

    // 6 — the desk is warm and stable behind the glass: the title becomes the
    // welcome in place, with where Settings went said once (DESIGN.md §8)...
    await boot(bootAt("handing-over"));
    expect(container?.querySelector('.vf-wizard-phase[data-state="done"]')?.textContent).toContain(
      "Your desk",
    );
    expect(title()).toBe("Welcome to your field, James.");
    expect(
      container?.querySelector('.vf-wizard-ready-line[aria-hidden="false"]')?.textContent,
    ).toContain("Your face in the bottom-left corner opens Settings — so does");
    // ...and holds it one beat before the glass hands the window over (W5).
    await tick(WELCOME_BEAT_MS - 1);
    expect(onReveal).not.toHaveBeenCalled();
    await tick(1);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    // 30s: the file's first row pays its cold import, each lazy pane's code arriving
    // inside act on the way through: 1029–1347 ms alone (×5, 2026-10-27), 5022 ms under
    // item 81's verify at load 185 (item 82) — the 5s default flakes.
  }, 30_000);

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
    const onReveal = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ setupVariant: "migrated" }),
      onComplete,
      onReveal,
    });

    expect(text()).toContain("Your field now lives in a user");
    await click("Continue"); // → the name pane
    expect(container?.querySelector('input[aria-label="Your name"]')).not.toBeNull();
    await click("Continue"); // → straight to Setting up; no connect

    expect(text()).not.toContain("Your field, on every device.");
    expect(onComplete).toHaveBeenCalledTimes(1);
    await boot(bootAt("handing-over"));
    expect(title()).toBe("Welcome to your field, james.");
    await tick(WELCOME_BEAT_MS);
    expect(onReveal).toHaveBeenCalledTimes(1);
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
    const onReveal = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ setupVariant: "second-user" }),
      onComplete,
      onReveal,
    });

    // §6.2 — the name, then the rest. There is no Welcome: the field is already
    // set up and only this person is new.
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

    await click("Continue"); // the name → Agents (each person's own chapter)
    expect(title()).toBe("Your agents.");
    await click("Continue"); // → Profiles, which moves on here, → History
    await pastProfiles();
    expect(text()).toContain("Bring in your past sessions.");
    await click("Continue"); // → Connect
    expect(text()).toContain("Your field, on every device.");

    await click("Not now");
    // The write goes out at once, as for anyone...
    expect(updates).toEqual([{ name: "james", face: DEALT_FACE }, { onboarded: true }]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    // ...and with the desk ready there is no welcome beat: the greeting a first
    // run gets is never shown to the second user, and the glass hands over.
    await boot(bootAt("handing-over"));
    expect(text()).not.toContain("Welcome to your field");
    expect(onReveal).toHaveBeenCalledTimes(1);
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
    expect(text()).toContain("Your field, on every device.");
    expect(container?.querySelector('input[aria-label="Your name"]')).toBeNull();

    await click("Not now");
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

    await click("Not now");
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
    expect(text()).toContain("Your field, on every device.");
    expect(text()).not.toContain(
      "Manage all your agents and compose your agentic workflow in one place.",
    );
    expect(container?.querySelector('input[aria-label="Your name"]')).toBeNull();
  });

  it("resumes at Agents when the ledger holds no answer for it, before History (W6, AO-5)", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    await mount({
      fieldd: client({ link: NO_LINK, ledger: { format: 1, steps: {}, hidden: false } }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });
    // the name was answered (a legacy accent says so); the chapter was not
    expect(title()).toBe("Your agents.");
    expect(text()).not.toContain("Bring in your past sessions.");
    await click("Continue"); // nothing known from this harness's inventory
    await pastProfiles();
    expect(text()).toContain("Bring in your past sessions.");
  });

  it("records Agents answered from the inventory and moves on to History (AO-5)", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    const first = SUPPORTED[0];
    if (first === undefined) throw new Error("the catalog has no supported agent");
    const fieldd = client({
      link: NO_LINK,
      ledger: { format: 1, steps: {}, hidden: false },
      installs: [installOf(first.id, "2.1.270")],
    });
    await mount({ fieldd, onboarding: onboarding({ color: "accent-2" }), onComplete: vi.fn() });
    // the pane's code arrives, then the inventory's answer
    await arrive(() => title() === "Your agents are ready.");
    expect(title()).toBe("Your agents are ready.");
    expect(text()).toContain(first.label);
    await click("Continue");
    expect(fieldd.request).toHaveBeenCalledWith("setup.answer", {
      step: "agents",
      state: "answered",
    });
    await pastProfiles();
    expect(text()).toContain("Bring in your past sessions.");
  });

  it("resumes at History when the ledger holds no answer for it, before Connect (W6, AO-3)", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    await mount({
      fieldd: client({
        link: NO_LINK,
        ledger: {
          format: 1,
          steps: {
            agents: { state: "answered", at: "2026-10-27T05:41:20.000Z" },
            profiles: { state: "answered", at: "2026-10-27T05:41:25.000Z" },
          },
          hidden: false,
        },
      }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });
    // the name was answered (a legacy accent says so); History was not
    expect(text()).toContain("Bring in your past sessions.");
    expect(text()).not.toContain("Your field, on every device.");
    await click("Continue"); // nothing to ask from this harness's census
    expect(text()).toContain("Your field, on every device.");
  });

  it("does not re-ask a root that is already linked, and asks no sync question (TS-6, TS-D13)", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    await mount({
      fieldd: client({ link: LINKED }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    // straight to Setting up: the first new field after connecting asks it
    expect(container?.querySelector('ul[aria-label="Setting up"]')).not.toBeNull();
    expect(text()).not.toContain("Your field, on every device.");
    expect(container?.querySelector('[role="radiogroup"][aria-label="Sync posture"]')).toBeNull();
  });

  // TS-2 — the Connect pane (DESIGN.md §8): the payoff asked once,
  // one click to the browser through the shared door, waiting that keeps its
  // exits, approval and the refusals in a person's words, other ways in.

  it("names the machine while it waits, keeps its four exits, and opens only when asked", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    await mount({
      fieldd: client({
        link: {
          ...NO_LINK,
          meshEnabled: true,
          nodeState: "NeedsLogin",
          linkState: "capturing",
          authUrl: "https://login.tailscale.com/a/abc",
          machineName: "truffle-vibefield-studio",
        },
      }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    expect(title()).toBe("Finish in your browser.");
    expect(text()).toContain("Tailscale will ask to connect truffle-vibefield-studio.");
    for (const exit of ["Open again", "Copy link", "Sign in on your phone", "Cancel"]) {
      expect(button(exit)).not.toBeUndefined();
    }
    // a capture this pane did not start opens nothing by itself (TS-D5)
    expect(opened).not.toHaveBeenCalled();
    await click("Open again");
    expect(opened).toHaveBeenCalledWith(
      "https://login.tailscale.com/a/abc",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("asks once with the payoff, and begins the link with exactly one begin", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    const fieldd = client({ link: NO_LINK });
    await mount({
      fieldd,
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    expect(title()).toBe("Your field, on every device.");
    expect(text()).toContain("Private network by Tailscale.");
    // ...and the sentence that was false since UA-P-0a is gone with its face.
    expect(text()).not.toContain("FIELD_NATIVE_MESH");

    await click("Continue with Tailscale");
    expect(fieldd.request).toHaveBeenCalledTimes(1);
    expect(fieldd.request).toHaveBeenCalledWith("user.link.begin", {});
  });

  it("is Not now on Esc, like the button", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    expect(title()).toBe("Your field, on every device.");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(title()).not.toBe("Your field, on every device.");
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

    await click("Continue with Tailscale");

    expect(text()).toContain("move it aside to link again: /x/link.json");
    expect(container?.querySelector('[role="alert"]')).not.toBeNull();
    // A refusal is not a trap: the pane's other ways out are still there (W3).
    expect(button("Not now")).not.toBeUndefined();
    expect(button("Other ways to sign in")).not.toBeUndefined();
  });

  it("says each refused posture in a person's words, keeping the daemon's sentence", async () => {
    const cases = [
      {
        wire: refused(
          "login_unavailable",
          "the tailnet has no user for this node (a tagged node cannot link)",
        ),
        title: "That sign-in can't own this Mac.",
        act: true,
      },
      {
        wire: refused(
          "login_already_linked",
          'the local user "Work" is already linked to this tailscale account; unlink it first',
        ),
        title: "That account already has a field here.",
        act: true,
      },
      {
        wire: refused("link_corrupt", "link.json is present but unusable: /x/link.json"),
        title: "This Mac's link record is damaged.",
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

      expect(title()).toBe(shape.title);
      expect(text()).toContain(String(shape.wire.linkDetail));
      // The act is offered only where asking again is a real act: a corrupt
      // record refuses `begin` by construction until the file is moved aside.
      const offered = Array.from(container?.querySelectorAll("button") ?? []).some(
        (candidate) => candidate.textContent?.trim() === "Use another account",
      );
      expect(offered).toBe(shape.act);

      await act(async () => root?.unmount());
      root = null;
      container?.remove();
      container = null;
    }
  });

  it("starts over for another account: the refused identity is archived before the new sign-in", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    const fieldd = client({
      link: refused(
        "login_already_linked",
        'the local user "Work" is already linked to this tailscale account; unlink it first',
      ),
    });
    await mount({
      fieldd,
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    await click("Use another account");
    // the refused capture kept its keys: a plain begin would sign the same
    // account in again, so unlink archives them first
    expect(
      (fieldd.request as ReturnType<typeof vi.fn>).mock.calls.map(([method]) => method),
    ).toEqual(["user.link.unlink", "user.link.begin"]);
  });

  it("names the machine an admin approves, and lets the person carry on", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    await mount({
      fieldd: client({
        link: {
          ...NO_LINK,
          meshEnabled: true,
          nodeState: "NeedsMachineAuth",
          linkState: "awaiting_approval",
          machineName: "truffle-vibefield-studio",
          adminUrl: "https://login.tailscale.com/admin/machines",
        },
      }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
    });

    expect(title()).toBe("Waiting for approval.");
    expect(text()).toContain("truffle-vibefield-studio");
    expect(button("Copy a request for your admin")).not.toBeUndefined();
    await click("Tell me when it's approved");
    expect(title()).not.toBe("Waiting for approval.");
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

    expect(title()).toBe("Opening Tailscale…");
    expect(text()).toContain("Sign in or create an account at Tailscale");
    // Capture is already running — offering to start it again would be a lie.
    expect(
      Array.from(container?.querySelectorAll("button") ?? []).some(
        (candidate) => candidate.textContent?.trim() === "Continue with Tailscale",
      ),
    ).toBe(false);
    expect(button("Cancel")).not.toBeUndefined();
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

    await click("Not now"); // Connect → Setting up, whose first act is the write
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

    await click("Not now");
    await click("Continue anyway");
    // The boot proceeds — the wizard is a hold, never a trap — and the
    // unflipped record means it honestly asks again next launch.
    expect(onComplete).toHaveBeenCalledTimes(1);
    // Setting up carries on as for anyone: the desk opens beneath the glass.
    expect(title()).toBe("Getting your desk ready.");
    expect(text()).toContain("Your desk");
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
    expect(title()).toBe("Your agents.");
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
    const onReveal = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete,
      onReveal,
    });

    await click("Get started");
    await click("Continue"); // nothing to write to — the pane still advances
    await click("Continue"); // Agents, with no inventory from this harness
    await pastProfiles(); // Profiles, with nothing to explain
    await click("Continue"); // History, with nothing to ask from this harness
    await click("Not now");
    expect(onComplete).toHaveBeenCalledTimes(1);
    await boot(bootAt("handing-over"));
    await tick(WELCOME_BEAT_MS);
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("records Devices as put off in the ledger when the person moves on without a link (AO-2)", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    const fieldd = client({ link: NO_LINK });
    await mount({ fieldd, onboarding: onboarding({ color: "accent-2" }), onComplete: vi.fn() });
    await click("Not now");
    // Settings' "Finish setting up" lists it from here (AO-D10)...
    expect(fieldd.request).toHaveBeenCalledWith("setup.answer", {
      step: "devices",
      state: "later",
    });
  });

  it("asks nothing of the ledger for a linked person — a link answers Devices by itself", async () => {
    host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
    const fieldd = client({ link: LINKED });
    await mount({ fieldd, onboarding: onboarding({ color: "accent-2" }), onComplete: vi.fn() });
    // straight to Setting up: the sync question left setup at TS-6 (TS-D13)
    expect(container?.querySelector('ul[aria-label="Setting up"]')).not.toBeNull();
    expect(fieldd.request).not.toHaveBeenCalledWith("setup.answer", expect.anything());
  });

  it("says why a desk could not open beneath the glass, and its Retry is the boot's own", async () => {
    host(
      vi.fn(
        async (params: Record<string, unknown>) =>
          ({ ...FRESH, color: "accent-2", ...params }) as FieldUserProfile,
      ),
    );
    const onRetry = vi.fn();
    const onReveal = vi.fn();
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding({ color: "accent-2" }),
      onComplete: vi.fn(),
      onReveal,
      onRetry,
    });
    await click("Not now");
    await boot(
      bootAt("opening-document", {
        stage: "opening doc",
        unavailable: { phase: "opening-document", reason: "document open failed", retryable: true },
      }),
    );

    // The splash's rule, on the glass: the plain reason, then Retry (§8).
    const desk = container?.querySelector('.vf-wizard-phase[data-state="failed"]');
    expect(desk?.textContent).toContain("Your desk");
    expect(desk?.textContent).toContain("document open failed");
    await click("Retry");
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onReveal).not.toHaveBeenCalled();

    // The retried boot reaches the desk, and the end goes on as for anyone.
    await boot(bootAt("handing-over"));
    expect(title()).toBe("Welcome to your field, james.");
    await tick(WELCOME_BEAT_MS);
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  describe("History's line (AO-4b; AO-D4)", () => {
    /** History's status: brought in, and its one agent where `backfill` says. */
    const reading = (
      backfill: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      phase: "backfilling",
      rosettad: { phase: "ready", detail: null, pid: 1, protocolVersion: 20 },
      enrollment: { enabledKinds: ["claude-code"], runtimes: [], retired: [], updatedAt: null },
      runtimes: [
        {
          runtimeId: "rt-1",
          kind: "claude-code",
          provenance: "discovered",
          watched: true,
          backfill: {
            filesTotal: 5912,
            bytesTotal: 12_200_000_000,
            bytesStreamed: 0,
            records: 0,
            ...backfill,
          },
        },
      ],
      ...extra,
    });
    const FINDING = reading({ state: "skimming", filesSkimmed: 1215, sessionsTotal: 0 });
    // the skim has landed: rosetta queues the agent again to stream it
    const FOUND = reading(
      { state: "queued", filesSkimmed: 5912, sessionsTotal: 4441 },
      {
        projects: Array.from({ length: 74 }, (_, i) => ({
          key: `p1:project${i}`,
          sessionsTotal: 60,
          sessionsDone: 0,
          bytesTotal: 1,
          bytesStreamed: 0,
        })),
      },
    );
    const line = () => container?.querySelector(".vf-wizard-phase[data-state] + .vf-wizard-phase");

    async function toSettingUp(index: unknown, onReveal = vi.fn()): Promise<typeof onReveal> {
      host(vi.fn(async () => ({ ...FRESH, color: "accent-2" }) as FieldUserProfile));
      await mount({
        fieldd: client({ link: NO_LINK, index }),
        onboarding: onboarding({ color: "accent-2" }),
        onComplete: vi.fn(),
        onReveal,
      });
      await click("Not now"); // Connect, put off (TS-2's words)
      await boot(bootAt("handing-over"));
      return onReveal;
    }

    it("waits for the first pass in the room's own words, then says what it found and hands over", async () => {
      const onReveal = await toSettingUp(FINDING);
      expect(line()?.getAttribute("data-state")).toBe("live");
      expect(line()?.textContent).toContain("Discovering conversations · 1,215 files checked");
      // the desk is ready, but the first pass is not: no welcome yet
      expect(title()).toBe("Getting your desk ready.");
      await tick(WELCOME_BEAT_MS);
      expect(onReveal).not.toHaveBeenCalled();

      await act(async () => pushIndex?.(FOUND));
      expect(line()?.getAttribute("data-state")).toBe("done");
      expect(line()?.textContent).toContain(
        "4,441 sessions found in 74 projects · Reading conversations, in the background",
      );
      expect(title()).toBe("Welcome to your field, james.");
      await tick(WELCOME_BEAT_MS);
      expect(onReveal).toHaveBeenCalledTimes(1);
    });

    it("offers Start now 8s past the desk, and goes on without the first pass", async () => {
      const onReveal = await toSettingUp(FINDING);
      await tick(START_NOW_AFTER_MS - 1);
      expect(text()).not.toContain("Start now");
      await tick(1);
      expect(text()).toContain(
        "Finding sessions in a history this size takes longer. It carries on in History.",
      );
      await click("Start now");
      expect(title()).toBe("Welcome to your field, james.");
      // History carries on, and says so
      expect(line()?.getAttribute("data-state")).toBe("live");
      await tick(WELCOME_BEAT_MS);
      expect(onReveal).toHaveBeenCalledTimes(1);
    });

    it("lists no History and waits for none when nothing was brought in, or History cannot be had", async () => {
      for (const index of [
        { ...reading({ state: "queued", filesSkimmed: 0, sessionsTotal: 0 }) },
        undefined,
      ]) {
        const nothing =
          index === undefined
            ? undefined
            : {
                ...index,
                enrollment: { enabledKinds: [], runtimes: [], retired: [], updatedAt: null },
              };
        const onReveal = await toSettingUp(nothing);
        expect(line()).toBeNull();
        expect(title()).toBe("Welcome to your field, james.");
        await tick(WELCOME_BEAT_MS);
        expect(onReveal).toHaveBeenCalledTimes(1);
        await act(async () => root?.unmount());
        root = null;
        container?.remove();
        pushIndex = null;
      }
    });
  });

  it("cross-fades the welcome in place, and keeps reduced motion to fades with no breath", () => {
    // M1 — the two titles share one grid cell, so nothing below the title moves.
    expect(WIZARD_CSS).toMatch(/\.vf-wizard-title-swap \{[^}]*display: grid;/);
    expect(WIZARD_CSS).toMatch(/\.vf-wizard-title-swap > span \{[^}]*grid-area: 1 \/ 1;/);
    expect(WIZARD_CSS).toContain("transition: opacity 180ms ease");
    // §6's loop: the live phase breathes 1.1s, 1 → 1.06, and stops under M6.
    expect(WIZARD_CSS).toContain("animation: vf-wizard-breath 1.1s ease-in-out infinite alternate");
    expect(WIZARD_CSS).toMatch(/transform: scale\(1\.06\)/);
    const reduced = WIZARD_CSS.slice(WIZARD_CSS.indexOf("prefers-reduced-motion: reduce"));
    expect(reduced).toContain("transition-duration: 90ms");
    expect(reduced).toMatch(
      /\.vf-wizard-phase\[data-state="live"\] \.vf-wizard-phase-mark::before \{\s*animation: none;/,
    );
  });
});

describe("BootRoot during onboarding", () => {
  /** A hand-driven machine: its view moves when the test says, and it holds the
   * wizard (client live, the onboarding input set) from the start. */
  function heldMachine(initial: BootView = bootAt("onboarding")): {
    machine: BootMachine;
    set: (next: BootView) => Promise<void>;
  } {
    let view = initial;
    const listeners = new Set<() => void>();
    const fieldd = client({ link: NO_LINK });
    const input = onboarding();
    const machine: BootMachine = {
      view: () => view,
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      get ready() {
        return null;
      },
      get client() {
        return fieldd;
      },
      get onboarding() {
        return input;
      },
      start: () => {},
      retry: () => {},
      closePlugins: async () => undefined,
      completeOnboarding: vi.fn(),
      revealDesk: vi.fn(),
    };
    const set = async (next: BootView): Promise<void> => {
      view = next;
      await act(async () => {
        for (const fn of [...listeners]) fn();
      });
    };
    return { machine, set };
  }

  async function mountBoot(machine: BootMachine): Promise<void> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(BootRoot, { machine }));
    });
  }

  it("gives the wizard the splash's layer and ground, and stands the splash face down", async () => {
    host(vi.fn(async () => FRESH));
    const { machine } = heldMachine();
    await mountBoot(machine);

    // Same full-bleed ground the splash paints...
    const ground = container?.querySelector(".vf-splash");
    expect(ground).not.toBeNull();
    expect(ground?.className).toContain("absolute inset-0");
    // ...without the splash's own face: no bar, no stage line.
    expect(container?.querySelector('[role="progressbar"]')).toBeNull();
    expect(text()).toContain(
      "Manage all your agents and compose your agentic workflow in one place.",
    );
  });

  it("keeps the wizard's glass while the desk opens beneath it, then leaves as the splash would (AO-D2)", async () => {
    host(vi.fn(async () => FRESH));
    const { machine, set } = heldMachine();
    await mountBoot(machine);
    const ground = container?.querySelector(".vf-splash");

    // Past the hold the document opens, warms, settles and waits — and the
    // wizard keeps the window the whole way: the splash never comes back.
    for (const phase of ["opening-document", "warming", "stabilizing", "handing-over"] as const) {
      await set(bootAt(phase, { stage: phase === "warming" ? "drawing the board" : "" }));
      expect(container?.querySelector(".vf-splash")).toBe(ground);
      expect(container?.querySelector(".vf-wizard-shell")).not.toBeNull();
      expect(container?.querySelector('[role="progressbar"]')).toBeNull();
      expect(ground?.className).toContain("opacity-100");
    }

    // The reveal: the glass fades 240ms over the desk's settle, then is gone.
    await set(bootAt("interactive"));
    expect(ground?.className).toContain("opacity-0");
    expect(ground?.className).toContain("duration-[240ms]");
    expect(ground?.getAttribute("aria-hidden")).toBe("true");
    await tick(400);
    expect(container?.querySelector(".vf-splash")).toBeNull();
    expect(container?.querySelector(".vf-wizard-shell")).toBeNull();
  });
});

describe("item 82 — one slow row is one red", () => {
  it.fails("a row that times out inside an act fails alone (on purpose)", async () => {
    host(null);
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete: vi.fn(),
    });
    await act(() => new Promise<void>(() => undefined));
  }, 100);

  it("leaves the row after it a wizard that renders and answers", async () => {
    host(null);
    await mount({
      fieldd: client({ link: NO_LINK }),
      onboarding: onboarding(),
      onComplete: vi.fn(),
    });
    expect(text()).toContain("Welcome.");
    await click("Get started");
    expect(container?.querySelector<HTMLInputElement>('input[aria-label="Your name"]')?.value).toBe(
      "james",
    );
  });
});
