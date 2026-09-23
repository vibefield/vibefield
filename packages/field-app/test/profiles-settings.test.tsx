// @vitest-environment happy-dom
/**
 * Agent Profiles (the design record's R1, pass 16) against a fake FielddClient:
 * the sidebar lists every profile as a place; a profile's page shows its
 * sign-ins with the C1 timeline, adds an agent and signs it in on the page,
 * renames, re-marks, moves the default, and deletes behind the two-step
 * confirm; one agent inside a profile switches account, shows its folder and
 * signs out. The model joins the doors' answers and words them, inventing
 * nothing. The terminal a sign-in runs in is the pool's; here it is a stand-in.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentAccountUsageEntry,
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ProfilesRoute, ProfilesSection } from "../src/panels/agents/ProfilesSection";
import {
  deleteWords,
  emptyProfilesContext,
  percentPlace,
  profilePage,
  resetWords,
  signedInUnder,
  usageLines,
} from "../src/panels/agents/profiles-model";
import { SettingsDialog } from "../src/panels/SettingsDialog";

vi.mock("../src/panels/agents/SignInTerminal", () => ({
  SignInTerminal: ({ terminal }: { terminal: { sessionId: string } }) =>
    createElement("div", { "data-signin-terminal": terminal.sessionId }, "terminal"),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── fixtures ──

const NOW = new Date(2026, 8, 23, 12, 0, 0);
// read well before any login a test starts: an identity read AFTER a login began means it ended
const READ = "2026-09-01T09:00:00.000Z";

const PROVIDERS: AgentProviderSummary[] = [
  { id: "claude", label: "Claude Code", available: true, resumable: true, personas: [] },
  { id: "codex", label: "Codex", available: true, resumable: true, personas: [] },
  { id: "grok", label: "Grok", available: true, resumable: false, personas: [] },
];

const install = (provider: string, version: string): AgentInstall => ({
  provider,
  executable: `/Users/me/.local/bin/${provider}`,
  realPath: `/Users/me/.local/bin/${provider}`,
  version,
  method: "native-installer",
  autoUpdate: "enabled",
  active: true,
});
const INSTALLS = [
  install("claude", "2.3.0"),
  install("codex", "0.154.0"),
  install("grok", "1.0.41"),
];

function persona(
  over: Partial<AgentPersona> & Pick<AgentPersona, "profileId" | "provider">,
): AgentPersona {
  return { label: "Work", kind: "managed", createdAt: READ, set: "work", ...over };
}

const signedIn = (email: string, plan = "Max") => ({
  loggedIn: true,
  email,
  plan,
  verifiedAt: READ,
});

const WORK_CLAUDE = persona({
  profileId: "p-claude",
  provider: "claude",
  folder: "~/…/profiles/work/claude-0b7e2c4d",
  identity: signedIn("kim@work.example"),
});

function set(over: Partial<AgentProfileSet> & Pick<AgentProfileSet, "id">): AgentProfileSet {
  return {
    kind: "managed",
    label: "Work",
    glyph: "briefcase",
    default: false,
    createdAt: READ,
    folder: "~/…/profiles/work",
    personas: [],
    ...over,
  };
}

const NATIVE = set({
  id: "native",
  kind: "native",
  label: "This Mac",
  glyph: undefined,
  folder: undefined,
  default: true,
  personas: [
    persona({
      profileId: "claude:native-default",
      provider: "claude",
      kind: "native-default",
      label: "Default",
      set: "native",
      folder: "~/.claude",
      identity: signedIn("me@home.example"),
    }),
    persona({
      profileId: "codex:native-default",
      provider: "codex",
      kind: "native-default",
      label: "Default",
      set: "native",
      folder: "~/.codex",
      identity: { loggedIn: false, verifiedAt: READ },
    }),
  ],
});

const WORK = set({ id: "work", personas: [WORK_CLAUDE] });

function feed(sets: AgentProfileSet[], over: Partial<AgentsProfileSetsListResult> = {}) {
  return {
    sets,
    signIn: ["claude", "codex", "grok"],
    signOut: ["claude"],
    reading: false,
    ...over,
  };
}

const USAGE: AgentAccountUsageEntry[] = [
  {
    provider: "claude",
    label: "Claude Code",
    profileId: "p-claude",
    state: "available",
    fetchedAt: READ,
    metrics: [
      {
        id: "five-hour",
        label: "5H",
        kind: "window",
        usedPercent: 91,
        durationMinutes: 300,
        resetsAt: new Date(NOW.getTime() + 60 * 60_000).toISOString(),
      },
      {
        id: "seven-day",
        label: "7D",
        kind: "window",
        usedPercent: 12,
        durationMinutes: 7 * 24 * 60,
        resetsAt: new Date(NOW.getTime() + 3 * 24 * 60 * 60_000).toISOString(),
      },
    ],
  },
];

// ── the model ──

describe("the profiles model", () => {
  const context = {
    ...emptyProfilesContext(feed([NATIVE, WORK])),
    providers: PROVIDERS,
    installs: INSTALLS,
    usage: USAGE,
  };

  it("a profile lists every sign-in it holds; This Mac only the agents signed in to their own folders", () => {
    const work = profilePage(WORK, context);
    expect(work.rows.map((row) => [row.label, row.fact])).toEqual([
      ["Claude Code", "Max · kim@work.example"],
    ]);
    expect(work.facts).toBe("1 agent");
    // installed, can sign in, not here yet
    expect(work.addable.map((agent) => agent.label)).toEqual(["Codex", "Grok"]);

    const mac = profilePage(NATIVE, context);
    expect(mac.rows.map((row) => row.label)).toEqual(["Claude Code"]);
    expect(mac.facts).toBe("1 agent · each in its own folder · default for new sessions");
    expect(mac.inOn).toBe("on This Mac");
  });

  it("says what deleting takes, and why the default cannot go", () => {
    const work = profilePage(WORK, context);
    expect(deleteWords(work)).toMatchObject({
      blocked: false,
      description: "Deletes Work’s folder and the 1 sign-in in it.",
      question: "Delete Work?",
      what: "Its folder, ~/…/profiles/work, is deleted, with the sign-ins for Claude Code. Sessions running under Work stop first. Your subscriptions themselves aren’t touched.",
    });
    const theDefault = profilePage({ ...WORK, default: true }, context);
    expect(deleteWords(theDefault)).toMatchObject({
      blocked: true,
      description: "Work is the default for new sessions. Make another profile the default first.",
    });
  });

  it("draws C1: the window's time as the track, now where the time is, orange when ahead of pace", () => {
    const lines = usageLines(USAGE[0]!.metrics, NOW);
    // 5H: 4 of 5 hours gone (80%), 91% used — not ahead of pace
    expect(lines[0]).toMatchObject({ label: "5H", usedPercent: 91, reset: "1h", resets: true });
    expect(lines[0]!.elapsedPercent).toBeCloseTo(80, 5);
    expect(lines[0]!.hot).toBe(true);
    expect(lines[1]).toMatchObject({ label: "7D", hot: false });
    expect(resetWords(new Date(NOW.getTime() + 130 * 60_000), NOW)).toBe("2h 10m");
    // no length reported: no now line, and near the limit is what turns it orange
    const bare = usageLines([{ id: "x", label: "7D", kind: "window", usedPercent: 85 }], NOW);
    expect(bare[0]!.elapsedPercent).toBeUndefined();
    expect(bare[0]!.hot).toBe(true);
  });

  it("keeps the % off the now line: it steps to the line's free side when the two would touch", () => {
    // outside the fill, the line just past the head: the % starts after the line
    expect(percentPlace(12, 20)).toEqual({ inside: false, edge: 20 });
    expect(percentPlace(12, 24)).toEqual({ inside: false, edge: 24 });
    expect(percentPlace(12, 40)).toEqual({ inside: false, edge: 12 });
    expect(percentPlace(12, 5)).toEqual({ inside: false, edge: 12 });
    // inside the fill, the line just before the head: the % ends before the line
    expect(percentPlace(61, 55)).toEqual({ inside: true, edge: 55 });
    expect(percentPlace(61, 30)).toEqual({ inside: true, edge: 61 });
    expect(percentPlace(61, 70)).toEqual({ inside: true, edge: 61 });
    // no length reported, no line to avoid; over the limit rides the full track
    expect(percentPlace(44, undefined)).toEqual({ inside: true, edge: 44 });
    expect(percentPlace(130, 95)).toEqual({ inside: true, edge: 95 });
  });

  it("finds where an agent is signed in, profile by profile", () => {
    const found = signedInUnder([NATIVE, WORK], "claude", context);
    expect(found.map(({ set: s, row }) => [s.label, row.fact])).toEqual([
      ["This Mac", "Max · me@home.example"],
      ["Work", "Max · kim@work.example"],
    ]);
    // codex is signed out of its own folder: This Mac does not list it
    expect(signedInUnder([NATIVE, WORK], "codex", context)).toEqual([]);
  });
});

// ── the sidebar ──

describe("the Agent Profiles group in the sidebar", () => {
  it("lists every profile as a place, This Mac first, then New profile…", async () => {
    const onSelect = vi.fn();
    const onNew = vi.fn();
    await mount(
      createElement(SettingsDialog, {
        activePage: "profiles",
        onSelectPage: () => undefined,
        onClose: () => undefined,
        onUndo: () => undefined,
        onRedo: () => undefined,
        historyBusy: false,
        undoAvailable: false,
        redoAvailable: false,
        head: { title: "Work", description: "Agent profile" },
        profiles: {
          items: [
            { id: "native", label: "This Mac", mark: null },
            { id: "work", label: "Work", mark: null },
          ],
          current: "work",
          onSelect,
          onNew,
        },
        children: createElement("div"),
      }),
    );
    const group = container?.querySelector("[data-settings-profiles]");
    expect(group?.textContent).toContain("Agent Profiles");
    expect(button("Work agent profile").getAttribute("aria-current")).toBe("page");
    expect(button("This Mac agent profile").getAttribute("aria-current")).toBeNull();
    expect(container?.querySelector("h1")?.textContent).toBe("Work");
    await click(button("This Mac agent profile"));
    expect(onSelect).toHaveBeenCalledWith("native");
    await click(button("New profile…"));
    expect(onNew).toHaveBeenCalled();
  });
});

// ── the pages, against a fake fieldd ──

type Door = (params: Record<string, unknown>) => unknown;

function fake(doors: Record<string, Door>) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    const door = doors[method];
    if (door === undefined) throw new Error(`unexpected request: ${method}`);
    return await door((params ?? {}) as Record<string, unknown>);
  });
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    request,
    subscribe: vi.fn(async (method: string) => {
      if (method !== "agents.usage.subscribe")
        throw new Error(`unexpected subscription: ${method}`);
      return {
        subId: "usage",
        snapshot: { entries: USAGE, generatedAt: READ },
        unsubscribe: () => undefined,
      };
    }),
  } as unknown as FielddClient;
  return {
    client,
    calls: (method: string) =>
      request.mock.calls.filter(([called]) => called === method).map(([, params]) => params),
  };
}

function doors(over: Record<string, Door> = {}): Record<string, Door> {
  return {
    "agent.providers": () => ({ providers: PROVIDERS }),
    "agents.installs": () => ({ installs: INSTALLS, machineScope: true }),
    "agents.profileSets.update": (params) => ({ set: { ...WORK, ...params, id: "work" } }),
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(element: ReturnType<typeof createElement>): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
  await settle();
}

interface Section {
  render: (next: { feed?: AgentsProfileSetsListResult; route?: ProfilesRoute }) => Promise<void>;
  onRoute: ReturnType<typeof vi.fn>;
  onLeave: ReturnType<typeof vi.fn>;
  onSubpage: ReturnType<typeof vi.fn>;
  onOpenApp: ReturnType<typeof vi.fn>;
}

async function mountSection(
  client: FielddClient,
  initial: { feed: AgentsProfileSetsListResult; route: ProfilesRoute },
): Promise<Section> {
  const onRoute = vi.fn();
  const onLeave = vi.fn();
  const onSubpage = vi.fn();
  const onOpenApp = vi.fn();
  let state = initial;
  const element = () =>
    createElement(
      FielddProvider,
      { client },
      createElement(ProfilesSection, {
        platform: "darwin",
        feed: state.feed,
        route: state.route,
        onRoute,
        onLeave,
        onSubpage,
        onOpenApp,
        now: NOW,
      }),
    );
  await mount(element());
  return {
    render: async (next) => {
      state = { ...state, ...next };
      await act(async () => root?.render(element()));
      await settle();
    },
    onRoute,
    onLeave,
    onSubpage,
    onOpenApp,
  };
}

const text = (): string => container?.textContent ?? "";

function button(name: string): HTMLButtonElement {
  const buttons = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  const found = buttons.find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  if (found === undefined) {
    throw new Error(
      `no button "${name}" among: ${buttons.map((b) => b.textContent?.trim()).join(" | ")}`,
    );
  }
  return found;
}

const hasButton = (name: string): boolean => {
  try {
    button(name);
    return true;
  } catch {
    return false;
  }
};

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
  await settle();
}

describe("a profile's page", () => {
  it("shows its sign-ins with their usage, its settings, and a delete that asks first", async () => {
    const f = fake(
      doors({
        "agents.profileSets.delete": () => ({ deleted: true, stopped: 0 }),
      }),
    );
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    expect(container?.querySelector("h2")?.textContent).toBe("Work");
    expect(text()).toContain("1 agent");
    expect(text()).toContain("Max · kim@work.example");
    // C1: one line per window, said whole for a screen reader
    const lines = [...(container?.querySelectorAll("[role=listitem]") ?? [])].map((line) =>
      line.getAttribute("aria-label"),
    );
    expect(lines).toEqual([
      "5H: 91% used, resets in 1h, ahead of pace",
      expect.stringMatching(/^7D: 12% used, resets in /),
    ]);
    // not the default: the switch offers it, the delete is open
    const toggle = container?.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(toggle?.disabled).toBe(false);

    await click(button("Delete…"));
    expect(text()).toContain("Delete Work?");
    expect(text()).toContain(
      "Its folder, ~/…/profiles/work, is deleted, with the sign-ins for Claude Code.",
    );
    await click(button("Cancel"));
    expect(text()).not.toContain("Delete Work?");
    await click(button("Delete…"));
    await click(button("Delete Work"));
    expect(f.calls("agents.profileSets.delete")).toEqual([{ set: "work" }]);
    expect(section.onLeave).toHaveBeenCalled();
  });

  it("the default cannot be deleted, and the switch only ever moves the default TO a profile", async () => {
    const f = fake(doors());
    await mountSection(f.client, {
      feed: feed([
        { ...NATIVE, default: false },
        { ...WORK, default: true },
      ]),
      route: { kind: "profile", set: "work" },
    });
    expect(text()).toContain(
      "Work is the default for new sessions. Make another profile the default first.",
    );
    expect(button("Delete…").disabled).toBe(true);
    const toggle = container?.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(toggle?.disabled).toBe(true);
    expect(text()).toContain(
      "New sessions start here. To change that, turn this on in another profile.",
    );
  });

  it("renames on leaving the field, re-marks from the pop-up, and makes itself the default", async () => {
    const f = fake(doors());
    await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Profile name"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, "Acme");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => name?.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await settle();
    expect(f.calls("agents.profileSets.update")).toEqual([{ set: "work", label: "Acme" }]);

    await click(button("Glyph: briefcase"));
    await click(button("rocket"));
    expect(f.calls("agents.profileSets.update").at(-1)).toEqual({ set: "work", glyph: "rocket" });

    await click(
      container?.querySelector<HTMLButtonElement>('[role="switch"]') as HTMLButtonElement,
    );
    expect(f.calls("agents.profileSets.update").at(-1)).toEqual({ set: "work", default: true });
  });

  it("adds an agent: its sign-in runs in a terminal on the page and closes when the sign-in is known", async () => {
    const codex = persona({ profileId: "p-codex", provider: "codex" });
    const f = fake(
      doors({
        "agents.profiles.create": () => ({ persona: codex }),
        "agents.profiles.login": () => ({ persona: codex, terminal: ticket("login-1") }),
      }),
    );
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    await click(button("Add agent…"));
    expect(text()).toContain("Sign in to an agent in Work");
    await click(button("Codex"));
    expect(f.calls("agents.profiles.create")).toEqual([{ set: "work", provider: "codex" }]);
    expect(f.calls("agents.profiles.login")).toEqual([{ profileId: "p-codex" }]);
    expect(
      container?.querySelector("[data-signin-terminal]")?.getAttribute("data-signin-terminal"),
    ).toBe("login-1");
    expect(text()).toContain("Codex · sign in · Work");
    expect(text()).toContain(
      "This runs in Work’s folder, so the sign-in lands there and nowhere else.",
    );

    // the feed: signing in, then signed in — the card closes and says so
    const signing = { ...codex, signingIn: { sessionId: "login-1", since: READ } };
    await section.render({ feed: feed([NATIVE, { ...WORK, personas: [WORK_CLAUDE, signing] }]) });
    expect(container?.querySelector("[data-signin-terminal]")).not.toBeNull();
    const done = { ...codex, identity: signedIn("kim@work.example", "Pro") };
    await section.render({ feed: feed([NATIVE, { ...WORK, personas: [WORK_CLAUDE, done] }]) });
    expect(container?.querySelector("[data-signin-terminal]")).toBeNull();
    expect(text()).toContain("Signed in to Codex.");
    expect(text()).toContain("Pro · kim@work.example");
  });

  it("a cancelled add adds nothing: the pane ends and the empty sign-in goes again", async () => {
    const codex = persona({ profileId: "p-codex", provider: "codex" });
    const f = fake(
      doors({
        "agents.profiles.create": () => ({ persona: codex }),
        "agents.profiles.login": () => ({ persona: codex, terminal: ticket("login-2") }),
        "terminal.terminate": () => ({ terminated: true }),
        "agents.profiles.delete": () => ({ deleted: true }),
      }),
    );
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    await click(button("Add agent…"));
    await click(button("Codex"));
    const signing = { ...codex, signingIn: { sessionId: "login-2", since: READ } };
    await section.render({ feed: feed([NATIVE, { ...WORK, personas: [WORK_CLAUDE, signing] }]) });
    await click(button("Cancel"));
    expect(f.calls("terminal.terminate")).toEqual([{ sessionId: "login-2" }]);
    const nobody = { ...codex, identity: { loggedIn: false, verifiedAt: READ } };
    await section.render({ feed: feed([NATIVE, { ...WORK, personas: [WORK_CLAUDE, nobody] }]) });
    expect(f.calls("agents.profiles.delete")).toEqual([{ profileId: "p-codex" }]);
    expect(container?.querySelector("[data-signin-terminal]")).toBeNull();
  });

  it("an empty profile says what it is for, and offers Add agent… as its one act", async () => {
    const f = fake(doors());
    await mountSection(f.client, {
      feed: feed([NATIVE, set({ id: "client-demo", label: "Client demo", glyph: "flask" })]),
      route: { kind: "profile", set: "client-demo" },
    });
    expect(text()).toContain("No agents in Client demo yet");
    expect(text()).toContain(
      "Add an agent and sign in. It gets its own folder in Client demo; your other profiles stay as they are.",
    );
    expect(hasButton("Add agent…")).toBe(true);
  });
});

describe("one agent inside a profile", () => {
  it("names itself in the header, switches account, shows its folder, and signs out after asking", async () => {
    const f = fake(
      doors({
        "agents.profiles.login": () => ({ persona: WORK_CLAUDE, terminal: ticket("login-3") }),
        "agents.profiles.delete": () => ({ deleted: false, waiting: 2 }),
        "agents.profileSets.reveal": () => ({ revealed: true }),
      }),
    );
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "agent", set: "work", provider: "claude" },
    });
    const subpage = section.onSubpage.mock.calls.at(-1)?.[0];
    expect(subpage).toMatchObject({ title: "Claude Code", backLabel: "Back to Work" });
    expect(text()).toContain("Max");
    expect(text()).toContain("~/…/profiles/work/claude-0b7e2c4d");
    expect(text()).toContain("The app itself · shared by every agent profile");

    await click(button("Show in Finder: Claude Code’s folder in Work"));
    expect(f.calls("agents.profileSets.reveal")).toEqual([{ set: "work", provider: "claude" }]);

    await click(button("Switch account…"));
    expect(f.calls("agents.profiles.login")).toEqual([{ profileId: "p-claude" }]);
    expect(container?.querySelector("[data-signin-terminal]")).not.toBeNull();

    await click(button("Sign out…"));
    expect(text()).toContain("Sign out of Claude Code in Work?");
    expect(text()).toContain("Sessions running now keep going until they end.");
    await click(button("Sign out"));
    expect(f.calls("agents.profiles.delete")).toEqual([{ profileId: "p-claude" }]);
    expect(section.onRoute).toHaveBeenCalledWith({ kind: "profile", set: "work" });
    expect(text()).toContain(
      "Signed out of Claude Code in Work. The 2 sessions running under it keep going; its folder goes when they end.",
    );

    await click(button("Claude Code 2.3.0"));
    expect(section.onOpenApp).toHaveBeenCalledWith("claude");
  });

  it("This Mac offers a sign-out only where the agent's own command can do it", async () => {
    const f = fake(doors());
    const codexSignedIn = {
      ...NATIVE,
      personas: NATIVE.personas.map((p) =>
        p.provider === "codex" ? { ...p, identity: signedIn("me@home.example", "Plus") } : p,
      ),
    };
    const section = await mountSection(f.client, {
      feed: feed([codexSignedIn, WORK]),
      route: { kind: "agent", set: "native", provider: "codex" },
    });
    expect(hasButton("Sign out…")).toBe(false);
    await section.render({ route: { kind: "agent", set: "native", provider: "claude" } });
    expect(hasButton("Sign out…")).toBe(true);
  });
});

describe("a new profile", () => {
  it("suggests a glyph from the name until one is chosen, and makes the profile", async () => {
    const f = fake(
      doors({
        "agents.profileSets.create": (params) => ({
          set: set({ id: "client-demo", label: String(params.label), glyph: String(params.glyph) }),
        }),
      }),
    );
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "new" },
    });
    expect(button("Create profile").disabled).toBe(true);
    const name = container?.querySelector<HTMLInputElement>('input[aria-label="Name"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, "Client demo");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(button("flask").getAttribute("aria-checked")).toBe("true");
    expect(text()).toContain("Suggested from the name");
    await click(button("rocket"));
    expect(button("rocket").getAttribute("aria-checked")).toBe("true");
    await click(button("Create profile"));
    expect(f.calls("agents.profileSets.create")).toEqual([
      { label: "Client demo", glyph: "rocket" },
    ]);
    expect(section.onRoute).toHaveBeenCalledWith({ kind: "profile", set: "client-demo" });
  });
});

/** A real login answer's ticket (the contracts' own fixture), for one session id. */
function ticket(sessionId: string) {
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
