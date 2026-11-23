import { agentViewFixture } from "@vibefield/puppeteer-view-sdk/testing";
import type { ProfileTab } from "@vibefield/puppeteer-views";
import { describe, expect, it } from "vitest";
import type { DeviceChoice } from "../src/godview/monitor/device-filter";
import {
  type LiveFiltersInput,
  liveFiltersOf,
  NO_COUNTED_ROWS,
} from "../src/godview/monitor/live-filters";
import type { MonitorAgent } from "../src/godview/monitor/types";
import { NO_WORK, SHELL_AGENT, workFacets } from "../src/godview/monitor/work-facets";

// SE-D1 A (2026-11-06; DESIGN.md §8 "Search — the Peek", the Filter menu and a
// typed name's offer): the view's filters as search reads them — which desktops
// and profiles are offered (GV-D3; TS-4's This Mac alone), and what each holds:
// a desktop its agents and its live sessions, a profile its sessions, Every
// profile every session. A count is every session's, whatever the other filter
// holds, as the drawing counts them; a peer's run is under no profile of this
// desktop's (the lens is this desktop's alone, the lead's ruling 16).

const HERE = { id: "here", name: "MacBook Pro", os: "mac" as const, self: true };
const STUDIO = { id: "studio", name: "studio", os: "linux" as const, self: false };

/** A row of this desktop's, under `profile` (or under none). */
const own = (id: string, profile?: string, kind: "agent" | "terminal" = "agent"): MonitorAgent =>
  agentViewFixture({
    id,
    kind,
    device: HERE,
    ...(profile === undefined ? {} : { profileSet: profile }),
  });
/** A peer's row, its owner's set id still on it: no profile of this desktop's counts it. */
const peer = (id: string): MonitorAgent =>
  agentViewFixture({ id, device: STUDIO, profileSet: "work" });

/** Three agents and a shell here (one under no profile), two agents on studio. */
const AGENTS: readonly MonitorAgent[] = [
  own("a1", "native"),
  own("a2", "work"),
  own("t1", "work", "terminal"),
  own("a3"),
  peer("p1"),
  peer("p2"),
];

const HERE_CHOICE: DeviceChoice = {
  id: "here",
  name: "MacBook Pro",
  os: "macos",
  here: true,
  state: "live",
  agents: 3,
};
const STUDIO_CHOICE: DeviceChoice = {
  id: "studio",
  name: "studio",
  os: "linux",
  here: false,
  state: "live",
  agents: 2,
};

const TABS: readonly ProfileTab[] = [
  { id: "native", label: "This Mac", kind: "native", isDefault: true },
  { id: "work", label: "Work", kind: "managed", glyph: "briefcase", blocked: true },
];

const input = (patch: Partial<LiveFiltersInput> = {}): LiveFiltersInput => ({
  devices: [HERE_CHOICE, STUDIO_CHOICE],
  desk: null,
  tabs: TABS,
  profile: null,
  connect: false,
  agents: AGENTS,
  here: "here",
  work: NO_WORK,
  project: null,
  agent: null,
  ...patch,
});

describe("the view's filters as search carries them (`live-filters.ts`, SE-D1)", () => {
  it("counts what each desktop and each profile holds — every session, the shells too, whatever the other filter is", () => {
    // the chosen ones are handed on as they stand; the counts never narrow by them
    expect(liveFiltersOf(input({ desk: "studio", profile: "work" }))).toEqual({
      desks: [
        {
          id: "here",
          name: "MacBook Pro",
          os: "macos",
          here: true,
          note: "3 agents",
          quiet: false,
          agents: 3,
          sessions: 4,
        },
        {
          id: "studio",
          name: "studio",
          os: "linux",
          here: false,
          note: "2 agents",
          quiet: false,
          agents: 2,
          sessions: 2,
        },
      ],
      desk: "studio",
      profiles: [
        { id: "native", label: "This Mac", kind: "native", isDefault: true, sessions: 1 },
        {
          id: "work",
          label: "Work",
          kind: "managed",
          glyph: "briefcase",
          blocked: true,
          sessions: 2,
        },
      ],
      profile: "work",
      projects: [],
      project: null,
      agents: [],
      agent: null,
      connect: false,
      sessions: 6,
    });
  });

  it("carries a chosen plan only while one stands (UM-5a), and it narrows no count", () => {
    expect(liveFiltersOf(input())).not.toHaveProperty("plan");
    const plan = { key: "native/plan:anthropic", label: "Claude Max", provider: "claude" };
    const filters = liveFiltersOf(input({ plan }));
    expect(filters.plan).toEqual(plan);
    expect(filters.sessions).toBe(6);
    expect(filters.profiles.map((entry) => entry.sessions)).toEqual([1, 2]);
  });

  it("offers no desktop with one desktop, and This Mac alone, counted, while it is not connected (TS-4)", () => {
    const mine = AGENTS.filter((row) => row.device.self);
    const one = liveFiltersOf(input({ devices: [HERE_CHOICE], agents: mine }));
    expect(one.desks).toEqual([]);
    expect(one.sessions).toBe(4);
    const unconnected = liveFiltersOf(
      input({ devices: [HERE_CHOICE], agents: mine, connect: true }),
    );
    expect(unconnected.connect).toBe(true);
    expect(unconnected.desks.map((desk) => [desk.id, desk.agents, desk.sessions])).toEqual([
      ["here", 3, 4],
    ]);
  });

  it("offers no profile while This Mac is the only one, and still counts every session", () => {
    const filters = liveFiltersOf(input({ tabs: null }));
    expect(filters.profiles).toEqual([]);
    expect(filters.sessions).toBe(6);
  });

  it("says a desktop that does not answer in its standing, quiet, and counts what it last held", () => {
    const asleep: DeviceChoice = { ...STUDIO_CHOICE, state: "asleep" };
    const [, studio] = liveFiltersOf(input({ devices: [HERE_CHOICE, asleep] })).desks;
    expect([studio?.note, studio?.quiet, studio?.agents, studio?.sessions]).toEqual([
      "asleep",
      true,
      2,
      2,
    ]);
  });
});

// WL-1 (2026-11-23; DESIGN.md §8 "Godview's work column", "The Filter menu"): the
// work column's projects and agents join Live now's filters, each group offered
// while the column draws it (two values, or its choice standing). While nobody
// reads the menu, only the chosen value stands, counted 0, so the button can
// name it and a session that starts or ends moves nothing.
describe("the work column's groups as search carries them (WL-1)", () => {
  const row = (
    id: string,
    project: string,
    provider: { id: string; label: string } | undefined,
    extra: Partial<MonitorAgent> = {},
  ): MonitorAgent =>
    agentViewFixture({
      id,
      device: HERE,
      project: { name: project, seq: project.length },
      ...(provider === undefined ? { kind: "terminal" as const } : { provider }),
      ...extra,
    });
  const ALPHA = { id: "alpha-agent", label: "Alpha" };
  const BETA = { id: "beta-agent", label: "Beta" };
  const rows: readonly MonitorAgent[] = [
    row("r1", "vibe-field", ALPHA, { createdAt: 1 }),
    row("r2", "vibe-field", BETA, { createdAt: 2, status: "blocked" }),
    row("r3", "billing-api", ALPHA, { createdAt: 3 }),
    row("r4", "billing-api", undefined, { createdAt: 4 }),
  ];
  const work = workFacets(rows);

  it("offers each project and agent with its sessions and its waits, in the order each first came", () => {
    const filters = liveFiltersOf(input({ agents: rows, work }));
    expect(filters.projects).toEqual([
      { id: "vibe-field", label: "vibe-field", seq: 10, waiting: true, sessions: 2 },
      { id: "billing-api", label: "billing-api", seq: 11, waiting: false, sessions: 2 },
    ]);
    expect(filters.agents).toEqual([
      { id: "alpha-agent", label: "Alpha", shell: false, waiting: false, sessions: 2 },
      { id: "beta-agent", label: "Beta", shell: false, waiting: true, sessions: 1 },
      { id: SHELL_AGENT, label: "Shell", shell: true, waiting: false, sessions: 1 },
    ]);
    expect(filters.project).toBeNull();
    expect(filters.agent).toBeNull();
  });

  it("offers no group of one value, unless it is the chosen one", () => {
    const one = workFacets([row("r1", "vibe-field", ALPHA)]);
    expect(liveFiltersOf(input({ work: one })).projects).toEqual([]);
    expect(liveFiltersOf(input({ work: one })).agents).toEqual([]);
    const chosen = liveFiltersOf(input({ work: one, project: "vibe-field" }));
    expect(chosen.projects.map((entry) => entry.id)).toEqual(["vibe-field"]);
    expect(chosen.project).toBe("vibe-field");
  });

  it("holds only the chosen value, counted 0, while nobody reads the menu", () => {
    const closed = liveFiltersOf(
      input({ agents: NO_COUNTED_ROWS, work, project: "billing-api", agent: BETA.id }),
    );
    expect(closed.projects).toEqual([
      { id: "billing-api", label: "billing-api", seq: 11, waiting: false, sessions: 0 },
    ]);
    expect(closed.agents).toEqual([
      { id: "beta-agent", label: "Beta", shell: false, waiting: false, sessions: 0 },
    ]);
    // nothing chosen, nothing held: the door is the same object as sessions come and go
    const none = liveFiltersOf(input({ agents: NO_COUNTED_ROWS, work }));
    expect(none.projects).toEqual([]);
    expect(none.agents).toEqual([]);
  });
});
