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
      if (method === "agents.profileSets.delete") return { deleted: true };
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

async function mount(client: FielddClient, onDone: (end: string) => void): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(FielddProvider, { client }, createElement(ProfilesWizardPane, { onDone })),
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
  await click("Add a profile…");
  // the card grows into the pane: This Mac folds to its agents' names
  expect(container?.querySelector(".vf-profiles-pane-row")).toBeNull();
  expect(text()).toContain("Claude Code, Codex");
  await type("Work");
  await click("Next");
  expect(text()).toContain("Sign in to an agent in Work");
  await click("Claude Code");
  expect(client.request).toHaveBeenCalledWith(
    "agents.profileSets.create",
    expect.objectContaining({ label: "Work" }),
  );
  expect(client.request).toHaveBeenCalledWith("agents.profiles.create", {
    set: "work",
    provider: "claude",
  });
  expect(client.request).toHaveBeenCalledWith("agents.profiles.login", {
    profileId: "p-work-claude",
  });
  expect(container?.querySelector('[data-signin-terminal="login-work"]')).not.toBeNull();
  // the login is open in its profile's folder
  await frame([
    THIS_MAC,
    {
      ...WORK_SET,
      personas: [workPersona({ signingIn: { sessionId: "login-work", since: LATER } })],
    },
  ]);
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
    expect(text()).toContain("Finish or cancel the sign-in first.");
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
    expect(client.request).not.toHaveBeenCalledWith("agents.profileSets.delete", expect.anything());
    expect(button("Continue").disabled).toBe(false);
  });

  it("leaves nothing behind when the sign-in is cancelled", async () => {
    const client = daemon(feedOf([THIS_MAC]), [install("claude"), install("codex")]);
    await mount(client, vi.fn());
    await addWork(client);
    await click("Cancel");
    expect(client.request).toHaveBeenCalledWith("terminal.terminate", { sessionId: "login-work" });
    await frame([THIS_MAC, { ...WORK_SET, personas: [workPersona()] }]);
    expect(client.request).toHaveBeenCalledWith("agents.profileSets.delete", { set: "work" });
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
    expect(client.request).not.toHaveBeenCalledWith("agents.profileSets.delete", expect.anything());
    await click("Sign in again");
    expect(
      vi.mocked(client.request).mock.calls.filter(([method]) => method === "agents.profiles.login"),
    ).toHaveLength(2);
  });
});
