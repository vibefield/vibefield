import { agentViewFixture } from "@vibefield/puppeteer-view-sdk/testing";
import type { ProfileTab } from "@vibefield/puppeteer-views";
import { describe, expect, it } from "vitest";
import type { DeviceChoice } from "../src/godview/monitor/device-filter";
import { type LiveFiltersInput, liveFiltersOf } from "../src/godview/monitor/live-filters";
import type { MonitorAgent } from "../src/godview/monitor/types";

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
