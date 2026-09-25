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
  AgentAccountUsageBatch,
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
import { UsageTimeline } from "../src/panels/agents/ProfilesView";
import {
  accountWords,
  deleteWords,
  emptyProfilesContext,
  profilePage,
  resetWords,
  signedInUnder,
  signInLines,
  usageFigurePlace,
  usageLines,
  usageWindowLabel,
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
    // grok signs in, but never says who
    identity: ["claude", "codex"],
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

const USAGE_BATCH: AgentAccountUsageBatch = { entries: USAGE, generatedAt: READ };

// ── the model ──

describe("the profiles model", () => {
  const context = {
    ...emptyProfilesContext(feed([NATIVE, WORK])),
    providers: PROVIDERS,
    installs: INSTALLS,
    usage: USAGE,
  };

  it("a profile lists every sign-in it holds; This Mac every installed agent in its own folder", () => {
    const work = profilePage(WORK, context);
    expect(work.rows.map((row) => [row.label, row.fact])).toEqual([
      ["Claude Code", "Max · kim@work.example"],
    ]);
    expect(work.facts).toBe("1 agent");
    // installed, can sign in, not here yet
    expect(work.addable.map((agent) => agent.label)).toEqual(["Codex", "Grok"]);

    const mac = profilePage(NATIVE, context);
    // signed in or not: each is there, in its own folder
    expect(mac.rows.map((row) => [row.label, row.fact])).toEqual([
      ["Claude Code", "Max · me@home.example"],
      ["Codex", "Not signed in"],
    ]);
    expect(mac.facts).toBe("2 agents · each in its own folder · default for new sessions");
    expect(mac.inOn).toBe("on This Mac");
  });

  it("offers every agent that signs in, and says of one that never says who only that", () => {
    const grok = persona({
      profileId: "p-grok",
      provider: "grok",
      folder: "~/…/profiles/work/grok-1a2b3c4d",
    });
    const withGrok = profilePage(set({ id: "work", personas: [WORK_CLAUDE, grok] }), context);
    const row = withGrok.rows.find((candidate) => candidate.provider === "grok");
    expect(row).toMatchObject({ state: "unverifiable", fact: "Doesn't say who is signed in" });
    // and a profile without it offers it in Add agent… like any other
    expect(profilePage(WORK, context).addable.map((agent) => agent.provider)).toContain("grok");
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

  it("keeps the % at the head, in pixels: inside short of the light, else after the head", () => {
    // James's cards: a 218 px track, a 21 px figure
    const at = (used: number, elapsed?: number) =>
      usageFigurePlace({ track: 218, figure: 21, used, elapsed });
    // 61 %: the fill holds it, 12 px short of the head (the 10 px glow and 2 more)
    expect(at(61)).toMatchObject({ inside: true, x: 218 * 0.61 - 12 - 21 });
    // 13 %: too short to hold it — 5 px after the head
    expect(at(13)).toMatchObject({ inside: false, x: 218 * 0.13 + 5 });
    // nothing used: the figure starts the track
    expect(at(0)).toMatchObject({ inside: false, x: 5 });
    // over the limit rides a full track, inside
    expect(at(130).inside).toBe(true);
    // a track too narrow for either place keeps it on the track
    expect(usageFigurePlace({ track: 20, figure: 21, used: 100 }).x).toBe(0);
  });

  it("never lets the now line touch the %: within 3 px of it, the line gives way", () => {
    const at = (used: number, elapsed?: number) =>
      usageFigurePlace({ track: 218, figure: 21, used, elapsed });
    // James's two cases (pass 21): the line met the % sign of 18 % and the 6 of 61 %
    expect(at(18, 30)).toMatchObject({ lineGives: false });
    expect(at(61, 48.5)).toMatchObject({ inside: true, lineGives: true });
    // the line just past a head too short to hold the figure: it gives way
    expect(at(13, 15)).toMatchObject({ inside: false, lineGives: true });
    // far away, the line is whole; no clock, no line
    expect(at(2, 37).lineGives).toBe(false);
    expect(at(90).lineGives).toBe(false);
    // every used × time pair: a whole line never comes within 3 px of the figure
    for (let used = 0; used <= 100; used++) {
      for (let elapsed = 0; elapsed <= 100; elapsed++) {
        const place = at(used, elapsed);
        if (place.lineGives) continue;
        const now = (218 * elapsed) / 100;
        const clear = now + 1 + 3 <= place.x || now - 1 - 3 >= place.x + 21;
        expect(clear, `${used} % used, ${elapsed} % of the time`).toBe(true);
      }
    }
  });

  it("names a window under a heading by its length, and keeps a reserve out of sight until it is in play", () => {
    expect([300, 10_080, 1440, 90].map((minutes) => usageWindowLabel(minutes))).toEqual([
      "5H",
      "7D",
      "1D",
      "90M",
    ]);
    const week = (usedPercent: number) => ({
      id: "codex:primary:window",
      label: "7D",
      kind: "window",
      usedPercent,
      durationMinutes: 10_080,
      resetsAt: new Date(NOW.getTime() + 3 * 24 * 60 * 60_000).toISOString(),
    });
    const reserve = (usedPercent: number) => ({
      id: "gpt-reserve:primary:window",
      label: "GPT RESERVE 7D",
      kind: "window",
      usedPercent,
      durationMinutes: 10_080,
      resetsAt: new Date(NOW.getTime() + 6 * 24 * 60 * 60_000).toISOString(),
      group: { id: "gpt-reserve", label: "Luna Reserve", standby: true },
    });
    // untouched, with the week to spare: only the plan's own window
    expect(usageLines([week(25), reserve(0)], NOW).map((line) => line.label)).toEqual(["7D"]);
    // the week spent: the reserve comes into sight, under its heading, named by its window
    const spent = usageLines([week(100), reserve(0)], NOW);
    expect(spent.map((line) => [line.label, line.group?.label])).toEqual([
      ["7D", undefined],
      ["7D", "Luna Reserve"],
    ]);
    // some of it used: in sight whatever the week says
    expect(usageLines([week(40), reserve(3)], NOW)).toHaveLength(2);
    // a model family is no standby: always shown, headed
    const fable = usageLines(
      [
        {
          ...week(4),
          id: "fable",
          label: "FABLE",
          group: { id: "scope:fable", label: "Fable only" },
        },
      ],
      NOW,
    );
    expect(fable[0]).toMatchObject({
      label: "7D",
      group: { id: "scope:fable", label: "Fable only" },
    });
  });

  it("says the account once when its organisation is only named after it", () => {
    expect(
      accountWords({ email: "kim@home.example", organization: "kim@home.example's Organization" }),
    ).toBe("kim@home.example");
    expect(accountWords({ email: "kim@work.example", organization: "Northlight" })).toBe(
      "kim@work.example · Northlight",
    );
    expect(accountWords({ account: "Kim", organization: "kim’s workspace" })).toBe("Kim");
  });

  it("heads each part of the plan once and draws the line as the space between two rounded ends", async () => {
    await mount(
      createElement(UsageTimeline, {
        label: "Google AI",
        lines: [
          {
            id: "g5",
            label: "5H",
            usedPercent: 0,
            resets: true,
            hot: false,
            elapsedPercent: 0,
            reset: "5h",
            group: { id: "gemini-models", label: "Gemini models" },
          },
          {
            id: "g7",
            label: "7D",
            usedPercent: 0,
            resets: true,
            hot: false,
            elapsedPercent: 0,
            reset: "Thu 10:49",
            group: { id: "gemini-models", label: "Gemini models" },
          },
          {
            id: "c5",
            label: "5H",
            usedPercent: 61,
            resets: true,
            hot: true,
            elapsedPercent: 48.5,
            reset: "2h 34m",
            group: { id: "claude-and-gpt-models", label: "Claude and GPT models" },
          },
        ],
      }),
    );
    const headings = [...(container?.querySelectorAll(".vf-profiles-usage-group") ?? [])];
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Gemini models",
      "Claude and GPT models",
    ]);
    // the heading is said in each line's own words, not twice
    expect(headings.every((heading) => heading.getAttribute("aria-hidden") === "true")).toBe(true);
    const lines = [...(container?.querySelectorAll("[role=listitem]") ?? [])];
    expect(lines.map((line) => line.getAttribute("aria-label"))).toEqual([
      "Gemini models, 5H: 0% used, resets in 5h",
      "Gemini models, 7D: 0% used, resets in Thu 10:49",
      "Claude and GPT models, 5H: 61% used, resets in 2h 34m, ahead of pace",
    ]);
    // the line: 2 px, its four corners opened into 2 px quarter circles, 6 px where it meets the edges
    const now = container?.querySelector<HTMLElement>(".vf-profiles-usage-now");
    expect(now?.style.width).toBe("6px");
    expect(now?.dataset["outline"]).toBe(
      "M0 0A2 2 0 0 1 2 2L2 12A2 2 0 0 1 0 14L6 14A2 2 0 0 1 4 12L4 2A2 2 0 0 1 6 0Z",
    );
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

function fake(doors: Record<string, Door>, initialUsage: AgentAccountUsageBatch = USAGE_BATCH) {
  let onUsage: ((batch: AgentAccountUsageBatch) => void) | undefined;
  const request = vi.fn(async (method: string, params?: unknown) => {
    const door = doors[method];
    if (door === undefined) throw new Error(`unexpected request: ${method}`);
    return await door((params ?? {}) as Record<string, unknown>);
  });
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    request,
    subscribe: vi.fn(async (method: string, _params: unknown, onData: typeof onUsage) => {
      if (method !== "agents.usage.subscribe")
        throw new Error(`unexpected subscription: ${method}`);
      onUsage = onData;
      return {
        subId: "usage",
        snapshot: initialUsage,
        unsubscribe: () => undefined,
      };
    }),
  } as unknown as FielddClient;
  return {
    client,
    emitUsage: (batch: AgentAccountUsageBatch) => onUsage?.(batch),
    calls: (method: string) =>
      request.mock.calls.filter(([called]) => called === method).map(([, params]) => params),
  };
}

function doors(over: Record<string, Door> = {}): Record<string, Door> {
  return {
    "agent.providers": () => ({ providers: PROVIDERS }),
    "agents.installs": () => ({ installs: INSTALLS, machineScope: true }),
    "agents.usage": () => USAGE_BATCH,
    "agents.profileSets.list": () => feed([NATIVE, WORK]),
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
  vi.restoreAllMocks();
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
  render: (next: {
    feed?: AgentsProfileSetsListResult | null;
    route?: ProfilesRoute;
  }) => Promise<void>;
  onRoute: ReturnType<typeof vi.fn>;
  onLeave: ReturnType<typeof vi.fn>;
  onSubpage: ReturnType<typeof vi.fn>;
  onOpenApp: ReturnType<typeof vi.fn>;
}

async function mountSection(
  client: FielddClient,
  initial: { feed: AgentsProfileSetsListResult | null; route: ProfilesRoute },
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

async function windowEvent(type: "focus" | "blur"): Promise<void> {
  await act(async () => window.dispatchEvent(new FocusEvent(type)));
  await settle();
}

describe("usage freshness when visiting settings", () => {
  it("refreshes This Mac's identities on entry, return, and button clicks, without changing managed profiles", async () => {
    const f = fake(doors());
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "native" },
    });
    expect(f.calls("agents.profileSets.list")).toEqual([{ refresh: true }]);
    await windowEvent("blur");
    await windowEvent("focus");
    expect(f.calls("agents.profileSets.list")).toHaveLength(2);
    await click(button("Refresh usage"));
    expect(f.calls("agents.profileSets.list")).toHaveLength(3);
    await section.render({ route: { kind: "agent", set: "native", provider: "codex" } });
    expect(f.calls("agents.profileSets.list")).toHaveLength(4);
    await section.render({ route: { kind: "profile", set: "work" } });
    await windowEvent("blur");
    await windowEvent("focus");
    expect(f.calls("agents.profileSets.list")).toHaveLength(4);
  });

  it("keeps a successful usage reading when the independent identity request fails", async () => {
    const nativeUsage = {
      ...USAGE_BATCH,
      generatedAt: new Date(Date.parse(READ) + 1_000).toISOString(),
      entries: [{ ...USAGE[0]!, profileId: "claude:native-default" }],
    };
    const f = fake(
      doors({
        "agents.usage": () => nativeUsage,
        "agents.profileSets.list": () => {
          throw new Error("Connection lost");
        },
      }),
    );
    await mountSection(f.client, {
      feed: feed([NATIVE]),
      route: { kind: "profile", set: "native" },
    });
    expect(text()).toContain("91%");
    expect(container?.querySelector('[role="alert"]')).toBeNull();
    await click(button("Refresh usage"));
    expect(text()).toContain("91%");
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "Sign-ins couldn't be refreshed",
    );
    expect(button("Refresh usage").disabled).toBe(false);
  });

  it("refreshes each page when its accounts arrive, without refreshing on ordinary feed updates", async () => {
    const f = fake(doors());
    const section = await mountSection(f.client, {
      feed: null,
      route: { kind: "profile", set: "work" },
    });
    expect(f.calls("agents.usage")).toEqual([]);
    await section.render({ feed: feed([NATIVE, WORK]) });
    expect(f.calls("agents.usage")).toEqual([
      { refresh: true, profileIds: [WORK_CLAUDE.profileId] },
    ]);
    expect(text()).not.toContain("Usage checked");
    await section.render({ feed: feed([NATIVE, { ...WORK, label: "Office" }]) });
    expect(f.calls("agents.usage")).toHaveLength(1);
    await section.render({ route: { kind: "agent", set: "work", provider: "claude" } });
    expect(f.calls("agents.usage")).toHaveLength(2);
    expect(f.calls("agents.usage").at(-1)).toEqual({
      refresh: true,
      profileIds: [WORK_CLAUDE.profileId],
    });
    await section.render({ route: { kind: "profile", set: "work" } });
    expect(f.calls("agents.usage")).toHaveLength(3);
  });

  it("updates the meters on returning to the window, not when moving focus between controls", async () => {
    let next = USAGE_BATCH;
    const f = fake(doors({ "agents.usage": () => next }));
    await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    const name = container?.querySelector('input[aria-label="Profile name"]');
    expect(name).not.toBeNull();
    await act(async () => {
      name?.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      name?.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    });
    expect(f.calls("agents.usage")).toHaveLength(1);
    await windowEvent("blur");
    next = {
      generatedAt: new Date(Date.parse(READ) + 60_000).toISOString(),
      entries: [{ ...USAGE[0]!, metrics: [{ ...USAGE[0]!.metrics[0]!, usedPercent: 37 }] }],
    };
    await windowEvent("focus");
    expect(f.calls("agents.usage")).toHaveLength(2);
    expect(text()).toContain("37%");
    expect(text()).not.toContain("Usage checked");
    await windowEvent("focus");
    expect(f.calls("agents.usage")).toHaveLength(2);
  });

  it("combines visibility and focus events in either order when returning from another screen", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const visibility = async (value: boolean): Promise<void> => {
      hidden.mockReturnValue(value);
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      await settle();
    };
    const f = fake(doors());
    await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    await windowEvent("blur");
    await visibility(true);
    expect(f.calls("agents.usage")).toHaveLength(1);
    await visibility(false);
    await windowEvent("focus");
    expect(f.calls("agents.usage")).toHaveLength(2);
    await visibility(true);
    await windowEvent("blur");
    await windowEvent("focus");
    expect(f.calls("agents.usage")).toHaveLength(2);
    await visibility(false);
    expect(f.calls("agents.usage")).toHaveLength(3);
  });

  it("coalesces returns during a refresh, then reads a newly opened profile after it finishes", async () => {
    let finish: ((batch: AgentAccountUsageBatch) => void) | undefined;
    const readUsage = vi
      .fn<Door>()
      .mockReturnValue(USAGE_BATCH)
      .mockImplementationOnce(
        () =>
          new Promise<AgentAccountUsageBatch>((resolve) => {
            finish = resolve;
          }),
      );
    const f = fake(doors({ "agents.usage": readUsage }));
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    expect(button("Refreshing…").disabled).toBe(true);
    await windowEvent("blur");
    await windowEvent("focus");
    expect(f.calls("agents.usage")).toHaveLength(1);
    await section.render({ route: { kind: "profile", set: "native" } });
    expect(f.calls("agents.usage")).toHaveLength(1);
    await act(async () => finish?.(USAGE_BATCH));
    await settle();
    expect(f.calls("agents.usage")).toEqual([
      { refresh: true, profileIds: [WORK_CLAUDE.profileId] },
      { refresh: true, profileIds: NATIVE.personas.map((item) => item.profileId) },
    ]);
    expect(button("Refresh usage").disabled).toBe(false);
  });

  it("stops refreshing when the page closes and refreshes again when reopened", async () => {
    const f = fake(doors());
    const initial = {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" } as const,
    };
    await mountSection(f.client, initial);
    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    await windowEvent("blur");
    await windowEvent("focus");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(f.calls("agents.usage")).toHaveLength(1);
    await mountSection(f.client, initial);
    expect(f.calls("agents.usage")).toHaveLength(2);
  });

  it("leaves empty and new profile pages alone and keeps automatic failures quiet", async () => {
    const f = fake(
      doors({
        "agents.usage": () => {
          throw new Error("offline");
        },
      }),
    );
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, { ...WORK, personas: [] }]),
      route: { kind: "profile", set: "work" },
    });
    await windowEvent("blur");
    await windowEvent("focus");
    expect(f.calls("agents.usage")).toEqual([]);
    await section.render({ route: { kind: "new" } });
    await windowEvent("blur");
    await windowEvent("focus");
    expect(f.calls("agents.usage")).toEqual([]);
    await section.render({ feed: feed([NATIVE, WORK]), route: { kind: "profile", set: "work" } });
    expect(f.calls("agents.usage")).toHaveLength(1);
    expect(container?.querySelector('[role="alert"]')).toBeNull();
    expect(text()).toContain("91%");
    expect(button("Refresh usage").disabled).toBe(false);
    await click(button("Refresh usage"));
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "Usage couldn't be refreshed",
    );
  });
});

describe("a profile's page", () => {
  it("refreshes its accounts once, shows the reply, then follows newer subscription readings", async () => {
    let finish: ((batch: AgentAccountUsageBatch) => void) | undefined;
    const readUsage = vi.fn<Door>().mockReturnValue(USAGE_BATCH);
    const f = fake(doors({ "agents.usage": readUsage }));
    await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    readUsage.mockImplementationOnce(
      () =>
        new Promise<AgentAccountUsageBatch>((resolve) => {
          finish = resolve;
        }),
    );
    await click(button("Refresh usage"));
    expect(button("Refreshing…").disabled).toBe(true);
    await click(button("Refreshing…"));
    expect(f.calls("agents.usage")).toEqual([
      { refresh: true, profileIds: [WORK_CLAUDE.profileId] },
      { refresh: true, profileIds: [WORK_CLAUDE.profileId] },
    ]);
    const reading = (percent: number, after: number): AgentAccountUsageBatch => ({
      generatedAt: new Date(Date.parse(READ) + after).toISOString(),
      entries: [{ ...USAGE[0]!, metrics: [{ ...USAGE[0]!.metrics[0]!, usedPercent: percent }] }],
    });
    await act(async () => finish?.(reading(36, 60_000)));
    expect(text()).toContain("36%");
    expect(text()).toContain("Usage checked");
    expect(button("Refresh usage").disabled).toBe(false);
    await act(async () => f.emitUsage(reading(71, 120_000)));
    expect(text()).toContain("71%");
    expect(text()).not.toContain("36%");
  });

  it("refreshes only the agent being viewed and preserves readings when the request fails", async () => {
    const f = fake(
      doors({
        "agents.usage": () => {
          throw new Error("Connection lost");
        },
      }),
    );
    await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "agent", set: "work", provider: "claude" },
    });
    await click(button("Refresh usage"));
    expect(f.calls("agents.usage")).toEqual([
      { refresh: true, profileIds: [WORK_CLAUDE.profileId] },
      { refresh: true, profileIds: [WORK_CLAUDE.profileId] },
    ]);
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "Usage couldn't be refreshed",
    );
    expect(text()).toContain("91%");
    expect(button("Refresh usage").disabled).toBe(false);
  });

  it("shows a provider's refusal and retry time alongside retained meters", async () => {
    const f = fake(
      doors({
        "agents.usage": () => ({
          generatedAt: new Date(Date.parse(READ) + 60_000).toISOString(),
          entries: [
            {
              ...USAGE[0]!,
              state: "rate-limited",
              stale: true,
              message: "Please wait before checking again",
              retryAt: new Date(Date.parse(READ) + 120_000).toISOString(),
            },
          ],
        }),
      }),
    );
    await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    await click(button("Refresh usage"));
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "Please wait before checking again",
    );
    expect(text()).toContain("Retry after");
    expect(text()).toContain("91%");
  });

  it("does not carry a late refresh notice to another profile", async () => {
    let fail: ((error: Error) => void) | undefined;
    const readUsage = vi.fn<Door>().mockReturnValue(USAGE_BATCH);
    const f = fake(doors({ "agents.usage": readUsage }));
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    readUsage.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await click(button("Refresh usage"));
    await section.render({ route: { kind: "profile", set: "native" } });
    await act(async () => fail?.(new Error("late failure")));
    expect(container?.querySelector('[role="alert"]')).toBeNull();
    expect(button("Refresh usage").disabled).toBe(false);
  });

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
    // the pane ends, then fieldd reads who signed in: the card waits for that read
    const ended = { ...codex, identity: signedIn("old@work.example", "Pro") };
    await section.render({ feed: feed([NATIVE, { ...WORK, personas: [WORK_CLAUDE, ended] }]) });
    expect(container?.querySelector("[data-signin-terminal]")).not.toBeNull();
    const done = {
      ...codex,
      identity: { ...signedIn("kim@work.example", "Pro"), verifiedAt: new Date().toISOString() },
    };
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
  it("shows pending usage instead of an unsupported sentence until the reading arrives", async () => {
    let finish: ((batch: AgentAccountUsageBatch) => void) | undefined;
    const f = fake(
      doors({
        "agents.usage": () =>
          new Promise<AgentAccountUsageBatch>((resolve) => {
            finish = resolve;
          }),
      }),
      { entries: [{ ...USAGE[0]!, state: "unsupported", metrics: [] }], generatedAt: READ },
    );
    await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "agent", set: "work", provider: "claude" },
    });
    expect(text()).toContain("Loading usage…");
    expect(text()).not.toContain("usage isn't reported");
    expect(container?.querySelector(".vf-profiles-usage-placeholder")).not.toBeNull();
    await act(async () =>
      finish?.({ ...USAGE_BATCH, generatedAt: new Date(Date.parse(READ) + 1_000).toISOString() }),
    );
    expect(text()).toContain("91%");
    expect(text()).not.toContain("Loading usage…");
    expect(container?.querySelector(".vf-profiles-usage-placeholder")).toBeNull();
  });

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

describe("Agent Profiles, from the review (AR-S2b)", () => {
  it("a profile just made is not left before the feed has it: Create profile lands on its page", async () => {
    const f = fake(doors());
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "client-demo" },
    });
    // the route names a profile the feed has not shown yet — not a deleted one
    expect(section.onLeave).not.toHaveBeenCalled();
    // one the feed HAD shown and no longer does is where leaving is right
    await section.render({ route: { kind: "profile", set: "work" } });
    await section.render({ feed: feed([NATIVE]) });
    expect(section.onLeave).toHaveBeenCalled();
  });

  it("says a sign-out's outcome on the page it lands on, with what it does to the credential", async () => {
    const grok = persona({
      profileId: "p-grok",
      provider: "grok",
      folder: "~/…/profiles/work/grok-1a2b3c4d",
    });
    const withGrok = set({ id: "work", personas: [WORK_CLAUDE, grok] });
    const f = fake(
      doors({ "agents.profiles.delete": () => ({ deleted: true, credential: "unknown" }) }),
    );
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, withGrok]),
      route: { kind: "agent", set: "work", provider: "grok" },
    });
    await click(button("Sign out…"));
    await click(button("Sign out"));
    expect(section.onRoute).toHaveBeenCalledWith({ kind: "profile", set: "work" });
    // the page the panel moves to keeps the notice this act just set
    await section.render({ route: { kind: "profile", set: "work" } });
    expect(text()).toContain("Signed out of Grok in Work.");
    expect(text()).toContain(
      "Grok doesn't say where it keeps its sign-in, so only its folder is removed.",
    );
  });

  it("never carries an armed confirm to another profile's page", async () => {
    const personal = set({ id: "personal", label: "Personal", glyph: "house" });
    const f = fake(doors());
    const section = await mountSection(f.client, {
      feed: feed([NATIVE, WORK, personal]),
      route: { kind: "profile", set: "work" },
    });
    await click(button("Delete…"));
    expect(text()).toContain("Delete Work?");
    await section.render({ route: { kind: "profile", set: "personal" } });
    expect(text()).not.toContain("Delete Personal?");
    expect(hasButton("Delete…")).toBe(true);
  });

  it("runs one sign-in at a time", async () => {
    const codex = persona({ profileId: "p-codex", provider: "codex" });
    const grok = persona({ profileId: "p-grok", provider: "grok" });
    const f = fake(
      doors({
        "agents.profiles.create": (params) => ({
          persona: params.provider === "codex" ? codex : grok,
        }),
        "agents.profiles.login": (params) => ({
          persona: params.profileId === "p-codex" ? codex : grok,
          terminal: ticket(`login-${String(params.profileId)}`),
        }),
      }),
    );
    await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    await click(button("Add agent…"));
    await click(button("Codex"));
    // while it runs, Add agent… is not offered again
    expect(button("Add agent…").disabled).toBe(true);
    expect(f.calls("agents.profiles.login")).toHaveLength(1);
  });

  it("sends a name once, and puts it back when it is refused", async () => {
    let refuse = true;
    const f = fake(
      doors({
        "agents.profileSets.update": (params) => {
          if (refuse) throw new Error("taken");
          return { set: { ...WORK, ...params, id: "work" } };
        },
      }),
    );
    await mountSection(f.client, {
      feed: feed([NATIVE, WORK]),
      route: { kind: "profile", set: "work" },
    });
    const field = container?.querySelector<HTMLInputElement>('input[aria-label="Profile name"]');
    if (!field) throw new Error("no name field");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(field, "Office");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    await act(async () => field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await settle();
    // Return and then leaving the field send it once
    expect(f.calls("agents.profileSets.update")).toEqual([{ set: "work", label: "Office" }]);
    // refused: the field shows the name the profile still has
    expect(field.value).toBe("Work");
    refuse = false;
  });

  it("offers Cancel on a sign-in this page does not show, and ends it by the pane the feed names", async () => {
    const signing = persona({
      profileId: "p-codex",
      provider: "codex",
      signingIn: { sessionId: "login-elsewhere", since: READ },
    });
    const f = fake(doors({ "terminal.terminate": () => ({ terminated: true }) }));
    await mountSection(f.client, {
      feed: feed([NATIVE, set({ id: "work", personas: [WORK_CLAUDE, signing] })]),
      route: { kind: "profile", set: "work" },
    });
    await click(button("Cancel Codex's sign-in"));
    expect(f.calls("terminal.terminate")).toEqual([{ sessionId: "login-elsewhere" }]);
  });
});

// ── plans (AR-S2c, pass 19 P2): the cards on top, the badges on the agents ──

const ANTHROPIC = { id: "anthropic", label: "Anthropic" };
const OPENAI = { id: "openai", label: "OpenAI" };
const KIMI = { id: "kimi", label: "Moonshot AI" };
const GITHUB = { id: "github", label: "GitHub" };
const NOUS = { id: "nous", label: "Nous Research" };

const PLAN_PROVIDERS: AgentProviderSummary[] = [
  ...PROVIDERS,
  { id: "pi", label: "Pi", available: true, resumable: true, personas: [] },
  { id: "copilot", label: "GitHub Copilot", available: true, resumable: false, personas: [] },
  { id: "hermes", label: "Hermes", available: true, resumable: false, personas: [] },
];
const PLAN_INSTALLS = [
  ...INSTALLS,
  install("pi", "0.87.1"),
  install("copilot", "1.0.88"),
  install("hermes", "0.21.4"),
];

/** Work as fieldd reads it: Claude Code on Claude Max (near its limit); Codex's
 * sign-in lapsed; Pi runs on the Claude plan without naming the account, and
 * holds a Kimi sign-in nobody names and an OpenAI key; Copilot borrows the
 * GitHub CLI's account, the same as This Mac's. */
const P_CLAUDE = persona({
  profileId: "p-claude",
  provider: "claude",
  identity: signedIn("kim@work.example", "max"),
  holds: [
    {
      service: ANTHROPIC,
      email: "kim@work.example",
      plan: "max",
      key: false,
      planId: "anthropic",
      runsOn: true,
    },
  ],
});
const P_CODEX = persona({
  profileId: "p-codex",
  provider: "codex",
  identity: signedIn("kim@work.example", "pro"),
  holds: [
    {
      service: OPENAI,
      email: "kim@work.example",
      plan: "pro",
      key: false,
      planId: "openai",
      runsOn: true,
    },
  ],
});
const P_PI = persona({
  profileId: "p-pi",
  provider: "pi",
  identity: {
    loggedIn: true,
    signIns: [
      { service: KIMI, method: "oauth", subscription: true },
      { service: ANTHROPIC, method: "oauth", subscription: true, inUse: true },
      { service: OPENAI, method: "api-key" },
    ],
    verifiedAt: READ,
  },
  holds: [
    {
      service: KIMI,
      method: "oauth",
      subscription: true,
      key: false,
      planId: "kimi",
      runsOn: false,
    },
    {
      service: ANTHROPIC,
      method: "oauth",
      subscription: true,
      inUse: true,
      key: false,
      planId: "anthropic",
      runsOn: true,
    },
    { service: OPENAI, method: "api-key", key: true, runsOn: false },
  ],
});
const P_COPILOT = persona({
  profileId: "p-copilot",
  provider: "copilot",
  identity: {
    loggedIn: true,
    method: "gh-cli",
    account: "kimdev",
    borrowedFrom: "GitHub CLI",
    verifiedAt: READ,
  },
  holds: [
    {
      service: GITHUB,
      method: "gh-cli",
      account: "kimdev",
      borrowedFrom: "GitHub CLI",
      key: false,
      planId: "github",
      runsOn: true,
    },
  ],
});
const P_HERMES = persona({
  profileId: "p-hermes",
  provider: "hermes",
  identity: { loggedIn: false, signIns: [], verifiedAt: READ },
});

const PLANNED = set({
  id: "work",
  personas: [P_CLAUDE, P_CODEX, P_PI, P_COPILOT, P_HERMES],
  plans: [
    {
      id: "anthropic",
      service: ANTHROPIC,
      account: { email: "kim@work.example", plan: "max" },
      namedBy: "p-claude",
      holders: ["p-claude", "p-pi"],
      alsoIn: [],
    },
    {
      id: "openai",
      service: OPENAI,
      account: { email: "kim@work.example", plan: "pro" },
      namedBy: "p-codex",
      holders: ["p-codex"],
      alsoIn: [],
    },
    { id: "kimi", service: KIMI, holders: ["p-pi"], alsoIn: [] },
    {
      id: "github",
      service: GITHUB,
      account: { account: "kimdev" },
      namedBy: "p-copilot",
      borrowedFrom: "GitHub CLI",
      holders: ["p-copilot"],
      alsoIn: ["native"],
    },
  ],
});

const PLAN_USAGE: AgentAccountUsageEntry[] = [
  USAGE[0]!,
  {
    provider: "codex",
    label: "Codex",
    profileId: "p-codex",
    state: "unauthenticated",
    fetchedAt: READ,
    metrics: [],
  },
];

const PLAN_ROUTES = {
  hermes: [
    { id: "portal", label: "Nous Portal", service: NOUS },
    { id: "provider", label: "Another provider…" },
  ],
};

function plannedFeed(): AgentsProfileSetsListResult {
  const everyone = ["claude", "codex", "grok", "pi", "copilot", "hermes"];
  return feed([NATIVE, PLANNED], { signIn: everyone, identity: everyone, routes: PLAN_ROUTES });
}

describe("the plans a profile runs on (pass 19)", () => {
  const context = {
    ...emptyProfilesContext(plannedFeed()),
    providers: PLAN_PROVIDERS,
    installs: PLAN_INSTALLS,
    usage: PLAN_USAGE,
  };

  it("recovers Codex's plan after an unread identity without relocating its meters to the agent row", async () => {
    const nativeCodex = { ...NATIVE.personas[1]!, identity: undefined, holds: undefined };
    const unread = { ...NATIVE, personas: [nativeCodex], plans: [] };
    const nativeUsage = {
      ...USAGE_BATCH,
      entries: [
        { ...USAGE[0]!, provider: "codex", label: "Codex", profileId: nativeCodex.profileId },
      ],
    };
    const f = fake(doors({ "agents.usage": () => nativeUsage }), nativeUsage);
    const section = await mountSection(f.client, {
      feed: feed([unread]),
      route: { kind: "profile", set: "native" },
    });
    const codexRow = () => container?.querySelector('[data-provider="codex"]');
    expect(f.calls("agents.profileSets.list")).toEqual([{ refresh: true }]);
    expect(container?.querySelector('[data-plan="openai"]')).toBeNull();
    expect(codexRow()?.textContent).toContain("Not checked yet");
    expect(codexRow()?.querySelector('[role="table"]')).toBeNull();
    expect(text()).not.toContain("91%");

    await section.render({ feed: feed([unread], { reading: true }) });
    expect(codexRow()?.textContent).toContain("Checking…");
    expect(button("Refreshing…").disabled).toBe(true);
    const recovered = {
      ...unread,
      personas: [{ ...nativeCodex, identity: P_CODEX.identity, holds: P_CODEX.holds }],
      plans: [
        { ...PLANNED.plans![1]!, namedBy: nativeCodex.profileId, holders: [nativeCodex.profileId] },
      ],
    };
    await section.render({ feed: feed([recovered], { reading: true }) });
    const card = container?.querySelector('.vf-profiles-plan[data-plan="openai"]');
    expect(card?.textContent).toContain("ChatGPT Pro");
    expect(card?.textContent).toContain("91%");
    expect(card?.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "ChatGPT Pro: Refreshing usage",
    );
    expect(card?.textContent).not.toContain("Refreshing usage…");
    expect(codexRow()?.textContent).toContain("ChatGPT Pro");
    expect(codexRow()?.textContent).not.toContain("91%");
    await section.render({ feed: feed([recovered]) });
    expect(button("Refresh usage").disabled).toBe(false);
    expect(
      container?.querySelector('.vf-profiles-plan[data-plan="openai"]')?.textContent,
    ).toContain("91%");
    expect(f.calls("agents.usage")).toHaveLength(1);
  });

  it("loads missing meters, preserves arriving readings, and ends the placeholders after a failed refresh", async () => {
    let fail: ((error: Error) => void) | undefined;
    const f = fake(
      doors({
        "agent.providers": () => ({ providers: PLAN_PROVIDERS }),
        "agents.installs": () => ({ installs: PLAN_INSTALLS, machineScope: true }),
        "agents.usage": () =>
          new Promise<AgentAccountUsageBatch>((_resolve, reject) => {
            fail = reject;
          }),
      }),
      { entries: [PLAN_USAGE[1]!], generatedAt: READ },
    );
    await mountSection(f.client, { feed: plannedFeed(), route: { kind: "profile", set: "work" } });
    const card = (id: string) =>
      container?.querySelector<HTMLElement>(`.vf-profiles-plan[data-plan="${id}"]`);
    expect(card("anthropic")?.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Claude Max: Loading usage",
    );
    expect(
      card("anthropic")?.querySelector(".vf-profiles-plan-sentence")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(card("github")?.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Copilot: Loading usage",
    );
    expect(card("github")?.querySelector(".vf-profiles-usage-loading-caption")).toBeNull();
    expect(card("openai")?.textContent).toContain("Sign-in expired.");
    expect(card("openai")?.querySelector('[role="status"]')).toBeNull();
    expect(card("kimi")?.textContent).toContain("no agent here names one");
    expect(card("kimi")?.querySelector('[role="status"]')).toBeNull();

    await act(async () => f.emitUsage({ entries: PLAN_USAGE, generatedAt: READ }));
    expect(card("anthropic")?.textContent).toContain("91%");
    expect(card("anthropic")?.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Claude Max: Refreshing usage",
    );
    expect(card("anthropic")?.textContent).not.toContain("Refreshing usage…");
    expect(card("anthropic")?.querySelector(".vf-profiles-usage-placeholder")).toBeNull();
    expect(card("github")?.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Copilot: Loading usage",
    );

    await act(async () => fail?.(new Error("Connection lost")));
    expect(card("anthropic")?.textContent).toContain("91%");
    expect(card("github")?.textContent).toContain("Usage isn't reported for this subscription.");
    expect(container?.querySelector(".vf-profiles-usage-loading")).toBeNull();
    expect(button("Refresh usage").disabled).toBe(false);
  });

  it("makes each plan a card: the plan as its product names it, whose it is, and what is left", () => {
    const page = profilePage(PLANNED, context);
    expect(
      page.plans.map((card) => [
        card.title,
        card.account,
        card.users.map((user) => user.label),
        card.alsoIn,
      ]),
    ).toEqual([
      ["Claude Max", "kim@work.example", ["Claude Code", "Pi"], ""],
      ["ChatGPT Pro", "kim@work.example", ["Codex"], ""],
      ["Kimi", "Account not named", ["Pi"], ""],
      ["Copilot", "kimdev", ["GitHub Copilot"], "also on This Mac"],
    ]);
    // every window the account reports, on the card
    expect(page.plans[0]!.metrics.map((metric) => metric.label)).toEqual(["5H", "7D"]);
    // one sentence in place of the windows, and the one act that helps
    expect(page.plans[1]).toMatchObject({
      metrics: [],
      sentence: {
        attention: "Sign-in expired.",
        text: "What is left shows again once Codex signs in.",
      },
      act: { kind: "reauth", provider: "codex", label: "Sign in again" },
    });
    expect(page.plans[2]!.sentence).toEqual({
      text: "Pi doesn't say which Kimi account, and no agent here names one.",
    });
    expect(page.plans[3]).toMatchObject({
      note: "No Copilot sign-in of its own here: it runs as GitHub CLI's account, the same one as This Mac.",
      sentence: { text: "Usage isn't reported for this subscription." },
      act: { kind: "own", provider: "copilot", label: "Sign in to Copilot" },
    });
  });

  it("gives each agent the cards in small: the one it runs on first, a key dashed, a lapse said on its own", () => {
    const page = profilePage(PLANNED, context);
    const row = (provider: string) =>
      page.rows.find((candidate) => candidate.provider === provider)!;
    expect(
      row("pi").badges.map((badge) => [
        badge.title,
        badge.planId ?? null,
        badge.runsOn,
        badge.payAsYouGo,
      ]),
    ).toEqual([
      ["Claude Max", "anthropic", true, false],
      ["Kimi", "kimi", false, false],
      ["OpenAI API key", null, false, true],
    ]);
    expect(row("pi").unnamed).toBe("Pi doesn't say which account");
    // the lapse is Codex's own sign-in's: only its badge says expired
    expect(row("codex").badges).toEqual([
      expect.objectContaining({ title: "ChatGPT Pro", expired: true }),
    ]);
    expect(row("claude").badges).toEqual([
      expect.objectContaining({ title: "Claude Max", expired: false, runsOn: true }),
    ]);
    expect(row("claude").unnamed).toBeUndefined();
    // an agent whose folder holds several and holds nothing says so
    expect(row("hermes")).toMatchObject({
      state: "signed-out",
      several: true,
      fact: "Not signed in to anything yet",
      badges: [],
    });
  });

  it("lists a harness's sign-ins on its own page, each on its plan", () => {
    const page = profilePage(PLANNED, context);
    const pi = page.rows.find((candidate) => candidate.provider === "pi")!;
    expect(signInLines(pi, page.plans).map((line) => [line.title, line.inUse, line.fact])).toEqual([
      ["Claude Max", true, "Subscription · Pi doesn't say which account"],
      ["Kimi", false, "Subscription · Pi doesn't say which account"],
      ["OpenAI API key", false, "API key · pay as you go"],
    ]);
  });

  it("draws the cards on top and the badges on the rows; hovering either lights its partners", async () => {
    const f = fake(
      doors({
        "agent.providers": () => ({ providers: PLAN_PROVIDERS }),
        "agents.installs": () => ({ installs: PLAN_INSTALLS, machineScope: true }),
        "agents.profiles.login": () => ({ persona: P_COPILOT, terminal: ticket("login-own") }),
      }),
    );
    await mountSection(f.client, { feed: plannedFeed(), route: { kind: "profile", set: "work" } });
    expect(text()).toContain("What Work runs on");
    const cards = [...(container?.querySelectorAll<HTMLElement>(".vf-profiles-plan") ?? [])];
    expect(cards.map((card) => card.querySelector("h4")?.textContent)).toEqual([
      "Claude Max",
      "ChatGPT Pro",
      "Kimi",
      "Copilot",
    ]);
    const claudeCard = cards[0]!;
    // every window as a C1 line, said whole
    expect(
      [...claudeCard.querySelectorAll("[role=listitem]")].map((line) =>
        line.getAttribute("aria-label"),
      ),
    ).toEqual([
      "5H: 91% used, resets in 1h, ahead of pace",
      expect.stringMatching(/^7D: 12% used/),
    ]);
    expect(claudeCard.textContent).toContain("Claude Code, Pi");

    // the badge on Pi's row: the plan it runs on, filled, with the dot of a plan near its limit
    const piRow = container?.querySelector<HTMLElement>('[data-provider="pi"]');
    const piClaude = piRow?.querySelector<HTMLElement>('.vf-profiles-badge[data-plan="anthropic"]');
    expect(piClaude?.classList.contains("is-on")).toBe(true);
    expect(piClaude?.querySelector(".vf-profiles-badge-hot")).not.toBeNull();
    expect(piRow?.querySelector(".vf-profiles-badge.is-key")?.textContent).toContain(
      "OpenAI API key",
    );
    expect(piRow?.textContent).toContain("Pi doesn't say which account");

    // hover a badge: its card and every badge of that plan light; nothing else does
    await act(async () => {
      // React makes a pointer's enter from `pointerover`
      piClaude?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    const lit = () =>
      [...(container?.querySelectorAll<HTMLElement>(".is-lit") ?? [])].map(
        (element) => element.dataset.plan,
      );
    expect(lit()).toEqual(["anthropic", "anthropic", "anthropic"]);
    await act(async () => {
      // React makes a pointer's leave from `pointerout` toward what it moved to
      piClaude?.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(lit()).toEqual([]);

    // the borrowed card offers Copilot's own login, here in Work
    await click(button("Sign GitHub Copilot in with its own login, for Work alone"));
    expect(f.calls("agents.profiles.login")).toEqual([{ profileId: "p-copilot" }]);
  });

  it("adds a sign-in to a harness by one of its own routes", async () => {
    const hermes = persona({
      ...P_HERMES,
      identity: {
        loggedIn: true,
        method: "oauth",
        email: "kim@work.example",
        plan: "Plus",
        signIns: [
          {
            service: NOUS,
            method: "oauth",
            subscription: true,
            inUse: true,
            email: "kim@work.example",
            plan: "Plus",
          },
        ],
        verifiedAt: READ,
      },
      holds: [
        {
          service: NOUS,
          method: "oauth",
          subscription: true,
          inUse: true,
          email: "kim@work.example",
          plan: "Plus",
          key: false,
          planId: "nous",
          runsOn: true,
        },
      ],
    });
    const withHermes = {
      ...PLANNED,
      personas: [P_CLAUDE, hermes],
      plans: [
        {
          id: "nous",
          service: NOUS,
          account: { email: "kim@work.example", plan: "Plus" },
          namedBy: "p-hermes",
          holders: ["p-hermes"],
          alsoIn: [],
        },
      ],
    };
    const f = fake(
      doors({
        "agent.providers": () => ({ providers: PLAN_PROVIDERS }),
        "agents.installs": () => ({ installs: PLAN_INSTALLS, machineScope: true }),
        "agents.profiles.login": () => ({ persona: hermes, terminal: ticket("login-route") }),
      }),
    );
    const everyone = ["claude", "codex", "grok", "pi", "copilot", "hermes"];
    await mountSection(f.client, {
      feed: feed([NATIVE, withHermes], {
        signIn: everyone,
        identity: everyone,
        routes: PLAN_ROUTES,
      }),
      route: { kind: "agent", set: "work", provider: "hermes" },
    });
    expect(text()).toContain("Sign-ins");
    expect(text()).toContain("Nous Portal Plus");
    expect(text()).toContain("in use");
    expect(text()).toContain("Sign out of everything in Hermes");

    await click(button("Add a sign-in…"));
    const items = [...(container?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    expect(items.map((item) => item.textContent)).toEqual(["Nous Portal", "Another provider…"]);
    await click(items[1]!);
    expect(f.calls("agents.profiles.login")).toEqual([
      { profileId: "p-hermes", route: "provider" },
    ]);
    expect(container?.querySelector("[data-signin-terminal]")).not.toBeNull();
  });

  it("offers an empty harness one way in: add a sign-in", async () => {
    const f = fake(
      doors({
        "agent.providers": () => ({ providers: PLAN_PROVIDERS }),
        "agents.installs": () => ({ installs: PLAN_INSTALLS, machineScope: true }),
      }),
    );
    await mountSection(f.client, {
      feed: plannedFeed(),
      route: { kind: "agent", set: "work", provider: "hermes" },
    });
    expect(text()).toContain("Hermes isn't signed in to anything in Work");
    expect(text()).toContain(
      "Add a sign-in to any service it supports. It stays in Hermes's folder in Work.",
    );
    expect(hasButton("Add a sign-in…")).toBe(true);
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
