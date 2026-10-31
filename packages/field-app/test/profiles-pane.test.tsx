// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentInstall,
  AgentPersona,
  AgentProfileSet,
  AgentProviderSummary,
  AgentsProfileSetsListResult,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WizardShellView } from "../src/boot/onboarding/wizard-ui";
import { type FieldHost, setHost } from "../src/host";
import { emptyProfilesContext } from "../src/panels/agents/profiles-model";
import { ProfilesWizardPane } from "../src/setup/ProfilesWizardPane";
import { profilesPaneModel, profilesPaneShows } from "../src/setup/profiles-pane";

// AO-5 (track AO; AO-D6, AO-D7; DESIGN.md §8 "The Setup Assistant's agent
// chapter" — Profiles) — the chapter's second pane: This Mac in the person's own
// sign-ins, and Add a profile… in place — a name, the agent, then its own login
// in the pane on Agent Profiles' sign-in controller. The profile is kept once
// its agent says who signed in; Cancel deletes it again; a login that ends
// before the agent says who leaves it unkept, never deleted unasked.

vi.mock("../src/panels/agents/SignInTerminal", () => ({
  SignInTerminal: ({ terminal }: { terminal: { sessionId: string } }) =>
    createElement("div", { "data-signin-terminal": terminal.sessionId }, "terminal"),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const NOW = new Date("2026-10-27T12:00:00.000Z");
const READ = "2026-10-27T09:00:00.000Z";
/** an identity read after any login a test starts */
const LATER = "2026-10-27T12:05:00.000Z";

/** A file by its path from this suite's folder. */
const read = (path: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), "utf8");

const PROFILES_CSS = read("../src/setup/profiles-pane.css");

/** One number a stylesheet states, by the rule that states it. */
function px(css: string, rule: RegExp): number {
  const found = css.match(rule)?.[1];
  if (found === undefined) throw new Error(`no ${rule} in the stylesheet`);
  return Number(found);
}

/** The glass's rule for a list that can outgrow its pane's body (DESIGN.md §4
 * `--vf-scroll-fade`, the face deck's): it scrolls within itself, edge-faded,
 * with no scrollbar, and gives back the 4 that keep a focus ring in its clip. */
const scrollsWithin = (list: string): string =>
  [
    `.vf-wizard-shell[data-size="glass"] ${list} {`,
    "  min-height: 0;",
    "  margin: -4px -4px 0;",
    "  padding: 4px 4px var(--vf-scroll-fade);",
    "  overflow-y: auto;",
    "  scroll-padding-bottom: var(--vf-scroll-fade);",
    "  mask-image: linear-gradient(to bottom, black calc(100% - var(--vf-scroll-fade)), transparent);",
    "  scrollbar-width: none;",
    "}",
    "",
    `.vf-wizard-shell[data-size="glass"] ${list}::-webkit-scrollbar {`,
    "  display: none;",
    "}",
  ].join("\n");

const PROVIDERS: AgentProviderSummary[] = [
  { id: "claude", label: "Claude Code", available: true, resumable: true, personas: [] },
  { id: "codex", label: "Codex", available: true, resumable: true, personas: [] },
];
const install = (provider: string): AgentInstall => ({
  provider,
  executable: `/usr/local/bin/${provider}`,
  realPath: `/usr/local/bin/${provider}`,
  version: "1.0.0",
  method: "native-installer",
  autoUpdate: "enabled",
  active: true,
});

const native = (
  provider: string,
  identity: AgentPersona["identity"] | undefined,
): AgentPersona => ({
  profileId: `${provider}:native-default`,
  provider,
  label: "Default",
  kind: "native-default",
  createdAt: READ,
  set: "native",
  ...(identity !== undefined ? { identity } : {}),
});

const THIS_MAC: AgentProfileSet = {
  id: "native",
  kind: "native",
  label: "This Mac",
  default: true,
  createdAt: READ,
  personas: [
    native("claude", { loggedIn: true, email: "me@home.example", verifiedAt: READ }),
    native("codex", { loggedIn: false, verifiedAt: READ }),
  ],
};

const feedOf = (sets: AgentProfileSet[]): AgentsProfileSetsListResult => ({
  sets,
  signIn: ["claude", "codex"],
  identity: ["claude", "codex"],
  signOut: [],
  reading: false,
});

const WORK_SET: AgentProfileSet = {
  id: "work",
  kind: "managed",
  label: "Work",
  glyph: "briefcase",
  default: false,
  createdAt: NOW.toISOString(),
  personas: [],
};
const workPersona = (over: Partial<AgentPersona> = {}): AgentPersona => ({
  profileId: "p-work-claude",
  provider: "claude",
  label: "Work",
  kind: "managed",
  createdAt: NOW.toISOString(),
  set: "work",
  ...over,
});

describe("the Profiles pane's model", () => {
  it("draws This Mac in its own sign-ins: who, or a way to sign in", () => {
    const model = profilesPaneModel({
      ...emptyProfilesContext(feedOf([THIS_MAC])),
      providers: PROVIDERS,
      installs: [install("claude"), install("codex")],
    });
    expect(model.thisMac?.rows).toEqual([
      {
        provider: "claude",
        profileId: "claude:native-default",
        label: "Claude Code",
        fact: "Signed in as me@home.example",
      },
      {
        provider: "codex",
        profileId: "codex:native-default",
        label: "Codex",
        fact: "Not signed in",
        signIn: "first",
      },
    ]);
    expect(model.addable.map((agent) => agent.provider)).toEqual(["claude", "codex"]);
    expect(profilesPaneShows(model)).toBe(true);
  });

  it("asks a lapsed sign-in to sign in again (the page's §10 row)", () => {
    const model = profilesPaneModel({
      ...emptyProfilesContext(feedOf([THIS_MAC])),
      providers: PROVIDERS,
      installs: [install("claude"), install("codex")],
      // the account's usage says the folder's sign-in has lapsed
      usage: [
        {
          provider: "claude",
          label: "Claude Code",
          state: "unauthenticated",
          metrics: [],
          fetchedAt: READ,
        },
      ],
    });
    expect(model.thisMac?.rows[0]).toMatchObject({
      provider: "claude",
      fact: "Sign-in expired · me@home.example",
      signIn: "again",
    });
  });

  it("has nothing to explain where no agent is in This Mac's folders (AO-L2)", () => {
    const model = profilesPaneModel({
      ...emptyProfilesContext(feedOf([THIS_MAC])),
      providers: PROVIDERS,
      installs: [],
    });
    expect(profilesPaneShows(model)).toBe(false);
  });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let push: ((payload: unknown) => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  push = null;
  setHost({
    logger: noopLogger,
    getConnection: async () => ({ port: 1, token: "test" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    platform: "darwin",
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

/** A login's terminal ticket: the contracts' golden, under another session. */
function ticket(sessionId: string): Record<string, unknown> {
  const golden = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../contracts/fixtures/agents-profiles-login.valid.json",
      ),
      "utf8",
    ),
  ) as { terminal: Record<string, unknown> & { session?: Record<string, unknown> } };
  const terminal = golden.terminal;
  return {
    ...terminal,
    sessionId,
    ...(terminal.session !== undefined ? { session: { ...terminal.session, id: sessionId } } : {}),
  };
}

function daemon(feed: AgentsProfileSetsListResult | null, installs: AgentInstall[]): FielddClient {
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string, _params: unknown, frame: (p: unknown) => void) => {
      if (method === "agents.profileSets.subscribe") {
        if (feed === null) throw new Error("method not found: agents.profileSets.subscribe");
        push = frame;
        return { subId: "profiles", snapshot: feed, unsubscribe: () => undefined };
      }
      if (method === "agents.usage.subscribe") throw new Error("no usage here");
      throw new Error(`unexpected subscription: ${method}`);
    }),
    request: vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "agent.providers") return { providers: PROVIDERS };
      if (method === "agents.installs") return { installs };
      if (method === "agents.profileSets.create") {
        return {
          set: { ...WORK_SET, label: String(params.label), glyph: String(params.glyph) },
        };
      }
      if (method === "agents.profiles.create") return { persona: workPersona() };
      if (method === "agents.profiles.login") {
        return {
          persona: workPersona(),
          terminal: ticket(params.profileId === "p-work-claude" ? "login-work" : "login-mac"),
        };
      }
      if (method === "agents.profileSets.discard") return { discarded: true, stopped: 0 };
      if (method === "terminal.terminate") return { ok: true };
      return { ok: true };
    }),
  } as unknown as FielddClient;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let hop = 0; hop < 8; hop += 1) await Promise.resolve();
  });
}

/** The pane alone, or (`onGlass`) in the glass's own shell, as the wizard
 * stands it. */
async function mount(
  client: FielddClient,
  onDone: (end: string) => void,
  onGlass = false,
): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const pane = createElement(ProfilesWizardPane, { onDone });
  await act(async () => {
    root?.render(
      createElement(
        FielddProvider,
        { client },
        onGlass
          ? createElement(WizardShellView, {
              dark: false,
              onToggleTheme: () => undefined,
              children: pane,
            })
          : pane,
      ),
    );
  });
  await flush();
}

const text = (): string => container?.textContent ?? "";
function button(label: string): HTMLButtonElement {
  const found = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (found === undefined) throw new Error(`no button labelled "${label}" in: ${text()}`);
  return found;
}
async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
  await flush();
}
async function type(value: string): Promise<void> {
  const input = container?.querySelector<HTMLInputElement>("#vf-profiles-pane-name");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function frame(sets: AgentProfileSet[]): Promise<void> {
  await act(async () => push?.(feedOf(sets)));
  await flush();
}

/** Add a profile… → "Work" → Claude Code: the login opens in the pane. */
async function addWork(client: FielddClient): Promise<void> {
  await openWork(client);
  // the login is open in its profile's folder
  await frame([
    THIS_MAC,
    {
      ...WORK_SET,
      personas: [workPersona({ signingIn: { sessionId: "login-work", since: LATER } })],
    },
  ]);
}

/** As `addWork`, short of the feed's answer: the login is open, and the feed
 * has not yet said the new profile is there. */
async function openWork(client: FielddClient): Promise<void> {
  await click("Add a profile…");
  // the card grows into the pane: This Mac folds to its agents' names
  expect(container?.querySelector(".vf-profiles-pane-row")).toBeNull();
  expect(text()).toContain("Claude Code, Codex");
  await type("Work");
  await click("Next");
  expect(text()).toContain("Sign in to an agent in Work");
  await click("Claude Code");
  // AO-D14 — made as a draft as its login starts
  expect(client.request).toHaveBeenCalledWith(
    "agents.profileSets.create",
    expect.objectContaining({ label: "Work", draft: true }),
  );
  expect(client.request).toHaveBeenCalledWith("agents.profiles.create", {
    set: "work",
    provider: "claude",
  });
  expect(client.request).toHaveBeenCalledWith("agents.profiles.login", {
    profileId: "p-work-claude",
  });
  expect(container?.querySelector('[data-signin-terminal="login-work"]')).not.toBeNull();
}

describe("the Profiles pane on the wizard's glass", () => {
  it("teaches a profile with This Mac's own sign-ins, and records the step on Continue", async () => {
    const client = daemon(feedOf([THIS_MAC]), [install("claude"), install("codex")]);
    const onDone = vi.fn();
    await mount(client, onDone);
    expect(text()).toContain("Every subscription, side by side.");
    expect(text()).toContain("Signed in as me@home.example");
    expect(text()).toContain("Another plan, for work or a client? Give it a profile.");
    expect(text()).toContain("Add one anytime in Settings → Agent Profiles.");
    await click("Continue");
    expect(client.request).toHaveBeenCalledWith("setup.answer", {
      step: "profiles",
      state: "answered",
    });
    expect(onDone).toHaveBeenCalledWith("answered");
  });

  it("moves on by itself, recording nothing, with nothing to explain (AO-L2)", async () => {
    const onDone = vi.fn();
    const client = daemon(null, [install("claude")]);
    await mount(client, onDone);
    expect(onDone).toHaveBeenCalledWith("skipped");
    expect(client.request).not.toHaveBeenCalledWith("setup.answer", expect.anything());
  });

  it("tells a second person on this Mac whose sign-ins This Mac's are (the page's §10 row)", async () => {
    const client = daemon(feedOf([THIS_MAC]), [install("claude"), install("codex")]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          FielddProvider,
          { client },
          createElement(ProfilesWizardPane, { onDone: vi.fn(), shared: true }),
        ),
      );
    });
    await flush();
    expect(text()).toContain(
      "These sign-ins belong to this Mac, so everyone using VibeField here shares them.",
    );
    expect(button("Add a profile…")).toBeDefined();
  });

  it("runs This Mac's own login in the pane for an agent not signed in", async () => {
    const client = daemon(feedOf([THIS_MAC]), [install("claude"), install("codex")]);
    await mount(client, vi.fn());
    await click("Sign in to Codex on This Mac");
    expect(client.request).toHaveBeenCalledWith("agents.profiles.login", {
      profileId: "codex:native-default",
    });
    expect(container?.querySelector('[data-signin-terminal="login-mac"]')).not.toBeNull();
  });

  it("keeps a new profile once its agent says who signed in", async () => {
    const client = daemon(feedOf([THIS_MAC]), [install("claude"), install("codex")]);
    const onDone = vi.fn();
    await mount(client, onDone);
    await addWork(client);
    // Continue waits while the login is open
    expect(button("Continue").disabled).toBe(true);
    expect(container?.querySelector(".vf-wizard-later")?.textContent).toBe(
      "Finish or cancel the sign-in first.",
    );
    await frame([
      THIS_MAC,
      {
        ...WORK_SET,
        personas: [
          workPersona({
            identity: { loggedIn: true, email: "kim@work.example", verifiedAt: LATER },
          }),
        ],
      },
    ]);
    expect(text()).toContain(
      "Work is ready. It starts with clean settings: its own skills and servers.",
    );
    expect(client.request).not.toHaveBeenCalledWith(
      "agents.profileSets.discard",
      expect.anything(),
    );
    expect(button("Continue").disabled).toBe(false);
  });

  it("leaves nothing behind when the sign-in is cancelled", async () => {
    const client = daemon(feedOf([THIS_MAC]), [install("claude"), install("codex")]);
    await mount(client, vi.fn());
    await addWork(client);
    await click("Cancel");
    expect(client.request).toHaveBeenCalledWith("terminal.terminate", { sessionId: "login-work" });
    await frame([THIS_MAC, { ...WORK_SET, personas: [workPersona()] }]);
    expect(client.request).toHaveBeenCalledWith("agents.profileSets.discard", { set: "work" });
    expect(button("Add a profile…")).toBeDefined();
  });

  it("never deletes a profile whose login ended before its agent said who — it asks", async () => {
    const client = daemon(feedOf([THIS_MAC]), [install("claude"), install("codex")]);
    await mount(client, vi.fn());
    await addWork(client);
    await frame([THIS_MAC, { ...WORK_SET, personas: [workPersona()] }]);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(text()).toContain(
      "The sign-in ended before Claude Code said who is signed in. Sign in again when you're ready.",
    );
    expect(client.request).not.toHaveBeenCalledWith(
      "agents.profileSets.discard",
      expect.anything(),
    );
    await click("Sign in again");
    expect(
      vi.mocked(client.request).mock.calls.filter(([method]) => method === "agents.profiles.login"),
    ).toHaveLength(2);
  });

  it("scrolls its cards within themselves on the glass, the fact standing under them, and brings the login into view clear of the fade (FG-L3)", async () => {
    // a login's card (its terminal 240) is more than the body's 322 holds beside This Mac and the
    // fact, by the CSS's own numbers; happy-dom lays nothing out, so a scroll is the call itself (the
    // pixels are FG-4b's console rows)
    const proto: { scrollIntoView?: (options?: unknown) => void } = Element.prototype as never;
    const original = proto.scrollIntoView;
    const scrolled: Element[] = [];
    proto.scrollIntoView = function (this: Element): void {
      scrolled.push(this);
    };
    try {
      const client = daemon(feedOf([THIS_MAC]), [install("claude"), install("codex")]);
      await mount(client, vi.fn(), true);
      await addWork(client);
      const cards = container?.querySelector(".vf-profiles-pane-cards");
      // the cards scroll; the fact stands under them, outside the scroll, and Continue on the foot
      expect(
        Array.from(
          container?.querySelector(".vf-profiles-pane")?.children ?? [],
          (part) => part.className,
        ),
      ).toEqual(["vf-profiles-pane-cards", "vf-profiles-pane-note"]);
      expect(cards?.querySelector('[data-signin-terminal="login-work"]')).not.toBeNull();
      expect(cards?.querySelector('button[type="submit"]')).toBeNull();
      // each step the add opened came into view within the cards, the login's last
      expect(scrolled.length).toBeGreaterThan(0);
      expect(scrolled.every((target) => cards?.contains(target) === true)).toBe(true);
      expect(scrolled.at(-1)?.querySelector('[data-signin-terminal="login-work"]')).not.toBeNull();
      expect(cards?.matches('.vf-wizard-shell[data-size="glass"] .vf-profiles-pane-cards')).toBe(
        true,
      );
      expect(PROFILES_CSS).toContain(
        '.vf-wizard-shell[data-size="glass"] .vf-profiles-pane {\n  min-height: 0;\n}',
      );
      expect(PROFILES_CSS).toContain(scrollsWithin(".vf-profiles-pane-cards"));
    } finally {
      if (original === undefined) Reflect.deleteProperty(proto, "scrollIntoView");
      else proto.scrollIntoView = original;
    }
  });

  it("brings the login into view again when its profile's own card lands above it after the login opened (row 32 at run52b, class B)", async () => {
    // the feed answers on its own clock: on a warm Mac the login opens first, and the new
    // profile's card, set in above it after, pushed the login's Cancel under the pane's foot
    const proto: { scrollIntoView?: (options?: unknown) => void } = Element.prototype as never;
    const original = proto.scrollIntoView;
    const scrolled: Element[] = [];
    proto.scrollIntoView = function (this: Element): void {
      scrolled.push(this);
    };
    try {
      const client = daemon(feedOf([THIS_MAC]), [install("claude"), install("codex")]);
      await mount(client, vi.fn(), true);
      await openWork(client);
      const cards = container?.querySelector(".vf-profiles-pane-cards");
      expect(cards?.querySelector('section[aria-label="Work"]')).toBeNull();
      const opened = scrolled.length;
      await frame([
        THIS_MAC,
        {
          ...WORK_SET,
          personas: [workPersona({ signingIn: { sessionId: "login-work", since: LATER } })],
        },
      ]);
      // the new profile's card stands above the open login…
      const work = cards?.querySelector('section[aria-label="Work"]');
      const login = cards?.querySelector('[data-signin-terminal="login-work"]');
      expect(work).not.toBeNull();
      expect(login).not.toBeNull();
      expect(
        (work?.compareDocumentPosition(login as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // …and the login came into view again once it landed
      const since = scrolled.slice(opened);
      expect(since.length).toBeGreaterThan(0);
      expect(since.at(-1)?.contains(login as Node)).toBe(true);
    } finally {
      if (original === undefined) Reflect.deleteProperty(proto, "scrollIntoView");
      else proto.scrollIntoView = original;
    }
  });

  it("stands a login's terminal 190 on the glass, so its whole card, Cancel with it, comes into view above the cards' fade (FG-4a)", async () => {
    const client = daemon(feedOf([THIS_MAC]), [install("claude"), install("codex")]);
    await mount(client, vi.fn(), true);
    await click("Sign in to Codex on This Mac");
    const terminalBox = container?.querySelector(".vf-profiles-signin-body");
    expect(
      terminalBox?.matches('.vf-wizard-shell[data-size="glass"] .vf-profiles-signin-body'),
    ).toBe(true);
    expect(PROFILES_CSS).toContain(
      '.vf-wizard-shell[data-size="glass"] .vf-profiles-signin-body {\n  height: var(--vf-glass-signin-height);\n}',
    );
    // the fit, from the stylesheets it stands on (happy-dom lays nothing out). The card is the
    // terminal and its chrome: the output's head (its padding, 11px at the body's 1.5, its hairline),
    // the output's two borders, the gap and the Cancel row's button
    const tokens = read("../../design-kit/src/tokens.css");
    const output = read("../src/panels/agents/agents-settings.css");
    const signIn = read("../src/panels/agents/profiles-settings.css");
    const terminal = px(tokens, /--vf-glass-signin-height: (\d+)px;/u);
    const fade = px(tokens, /--vf-scroll-fade: (\d+)px;/u);
    const headPadding = px(output, /\n\.vf-agents-output-head \{[^}]*padding: (\d+)px 12px;/u);
    const headFont = px(output, /\n\.vf-agents-output-head \{[^}]*font-size: (\d+)px;/u);
    const gap = px(signIn, /\n\.vf-profiles-signin \{[^}]*gap: (\d+)px;/u);
    const button = px(
      read("../../design-kit/src/primitives.css"),
      /\n\.vf-ui-button \{[^}]*height: (\d+)px;/u,
    );
    const chrome = headPadding + headFont * 1.5 + headPadding + 1 + 2 + gap + button;
    // the cards' room above the fade: the body (the frame's 504 less the head — the title's 28 at
    // 1.15, 8, a two-line voice of 14 at 1.45 — the 20 under it, and the foot — 16, the actions'
    // 2 and 40, 8, the later line's 17 less its 2), less the fact's line of 18 and its gap of 10,
    // the 4 given back, less the fade
    const body = 504 - (28 * 1.15 + 8 + 2 * 14 * 1.45) - 20 - (16 + 2 + 40 + 8 - 2 + 17);
    const clear = body - 18 - 10 + 4 - fade;
    expect(terminal).toBe(190);
    expect(chrome).toBe(79.5);
    expect(terminal + chrome).toBeLessThanOrEqual(clear);
    // Settings' own 240 would leave Cancel a scroll away
    const settings = px(signIn, /\n\.vf-profiles-signin-body \{\s*height: (\d+)px;/u);
    expect(settings + chrome).toBeGreaterThan(clear);
    expect(read("../../../DESIGN.md")).toContain("| `--vf-glass-signin-height` | `190px` |");
  });
});
