import type {
  AgentAccountUsageEntry,
  AgentAccountUsageMetric,
  AgentPersona,
  AgentProfileSet,
} from "@vibefield/contracts";
import type { MonitorSpawnFuel, MonitorSpawnFuelArc } from "@vibefield/puppeteer-view-sdk";
import { menuOf } from "@vibefield/puppeteer-view-sdk/toolkit";
import { describe, expect, it } from "vitest";
import { profileTabs } from "../src/godview/monitor/profile-tabs";
import {
  HERE_DEVICE_ID,
  signedInLabels,
  spawnMenuOf,
  targetsHere,
} from "../src/godview/monitor/spawn-menu";
import { columnCircles } from "../src/godview/profiles-column/ProfilesColumn";
import { planMeters } from "../src/usage/meters";
import { spawnFuelMap, spawnFuelOf } from "../src/usage/spawn-fuel";

// SB-3 — the spawn menu as a pure function of the profile tabs' feed: this
// desktop alone (SB-D9), reading until the feed answers, then its profiles in
// the tabs' order with the tabs' fields and who is signed in under each.

const AT = "2026-09-30T12:00:00.000Z";

function persona(
  profileId: string,
  provider: string,
  kind: AgentPersona["kind"],
  loggedIn?: boolean,
): AgentPersona {
  return {
    profileId,
    provider,
    label: provider,
    kind,
    createdAt: AT,
    ...(loggedIn === undefined ? {} : { identity: { loggedIn, verifiedAt: AT } }),
  };
}

function set(
  id: string,
  label: string,
  personas: AgentPersona[],
  extra: Partial<AgentProfileSet> = {},
): AgentProfileSet {
  return {
    id,
    kind: id === "native" ? "native" : "managed",
    label,
    default: false,
    createdAt: AT,
    personas,
    ...extra,
  };
}

// This Mac: Claude's own folder signed in, Codex's read and signed out.
const NATIVE = set("native", "This Mac", [
  persona("claude:native-default", "claude", "native-default", true),
  persona("codex:native-default", "codex", "native-default", false),
]);
// Work: the default; a Claude sign-in (any state counts — the profile holds it).
const WORK = set("work", "Work", [persona("w-claude", "claude", "managed")], {
  glyph: "briefcase",
  default: true,
});
const DEMO = set("demo", "Demo", [], { glyph: "flask" });

describe("the spawn menu (SB-3)", () => {
  it("offers this desktop alone, reading its profiles until the feed answers", () => {
    expect(spawnMenuOf(null, [])).toEqual({
      devices: [{ id: HERE_DEVICE_ID, label: "This Mac", self: true, state: "reading" }],
    });
    // reading is no choice yet: the hold creates at once, under nothing named
    const menu = menuOf(spawnMenuOf(null, []));
    expect(menu.kind).toBe("instant");
    expect(menu.hub.profile).toBeNull();
  });

  it("lists the profiles in the tabs' order with the tabs' fields and who is signed in under each", () => {
    const sets = [NATIVE, WORK, DEMO];
    const tabs = profileTabs(sets, []);
    const blockedTabs = tabs.map((tab) => (tab.id === "demo" ? { ...tab, blocked: true } : tab));
    const menu = spawnMenuOf(sets, blockedTabs);
    expect(menu.devices).toHaveLength(1);
    expect(menu.devices[0]).toMatchObject({ id: HERE_DEVICE_ID, self: true, state: "ready" });
    expect(menu.devices[0]?.profiles).toEqual([
      {
        id: "native",
        label: "This Mac",
        kind: "native",
        isDefault: false,
        signedIn: ["Claude Code"],
      },
      {
        id: "work",
        label: "Work",
        glyph: "briefcase",
        kind: "managed",
        isDefault: true,
        signedIn: ["Claude Code"],
      },
      {
        id: "demo",
        label: "Demo",
        glyph: "flask",
        kind: "managed",
        isDefault: false,
        blocked: true,
        signedIn: [],
      },
    ]);
  });

  it("blooms two or more profiles with the default at the hub, and makes one profile no choice", () => {
    const bloom = menuOf(spawnMenuOf([NATIVE, WORK, DEMO], []));
    expect(bloom.kind).toBe("profiles");
    expect(bloom.hub.profile?.id).toBe("work");
    const one = menuOf(spawnMenuOf([NATIVE], []));
    expect(one.kind).toBe("instant");
    expect(one.hub.profile?.id).toBe("native");
  });

  it("names a signed-in agent once, by the catalog's label, and This Mac's only when signed in", () => {
    expect(signedInLabels(NATIVE)).toEqual(["Claude Code"]);
    const twice = set("twice", "Twice", [
      persona("a", "claude", "managed"),
      persona("b", "claude", "managed"),
      persona("c", "unknown-agent", "managed"),
    ]);
    expect(signedInLabels(twice)).toEqual(["Claude Code", "unknown-agent"]);
  });

  it("asks only this desktop for a terminal", () => {
    expect(targetsHere(undefined)).toBe(true);
    expect(targetsHere({})).toBe(true);
    expect(targetsHere({ deviceId: HERE_DEVICE_ID, profileSet: "work" })).toBe(true);
    expect(targetsHere({ deviceId: "mini" })).toBe(false);
  });
});

// PU-R (UM-D7: b1 "bands", b2 "dash", b3 "age"; DESIGN.md §8 "Hold, reach, let go", §9 "The spawn bloom's words") — a
// profile's bud wears its Bands circle at 48 and 42, drawn by the column's own geometry and handed as strokes. Every
// number below is a literal worked by hand from DESIGN.md §8 "The Bands circle" (the 38-to-71 level: the band
// 0.066 × size, 1.1 apart, the rim 0.8 inside; one plan's round cap), never the code under test run again.

const NOW = new Date("2026-11-17T12:00:00.000Z");
const minutesFrom = (minutes: number): string =>
  new Date(NOW.getTime() + minutes * 60_000).toISOString();
/** a window of `minutes`, `used` full, its reset `left` minutes away (half the 5 hours gone at 150) */
const meter = (
  id: string,
  used: number,
  minutes: number,
  left: number,
): AgentAccountUsageMetric => ({
  id,
  label: id,
  kind: "window",
  usedPercent: used,
  durationMinutes: minutes,
  resetsAt: minutesFrom(left),
});
const FIVE_HOURS = (used: number, left = 150) => meter("5H", used, 300, left);
const SEVEN_DAYS = (used: number) => meter("7D", used, 10_080, 5_760);
/** a reading of one managed sign-in, taken a minute ago */
const reading = (
  profileId: string,
  metrics: AgentAccountUsageMetric[],
  extra: Partial<AgentAccountUsageEntry> = {},
): AgentAccountUsageEntry => ({
  provider: "claude",
  label: "Claude",
  profileId,
  state: "available",
  metrics,
  fetchedAt: minutesFrom(-1),
  ...extra,
});
const FUEL_SIZES = [48, 42];
/** one profile's fuel, its meters read at NOW as the column reads them */
const fuelOf = (
  personas: AgentPersona[],
  rows: AgentAccountUsageEntry[],
  usage: "available" | "unavailable" = "available",
): MonitorSpawnFuel =>
  spawnFuelOf(planMeters(set("work", "Work", personas), rows, NOW, { usage }).entries, FUEL_SIZES);
const CLAUDE = persona("w-claude", "claude", "managed");
const CLAUDE_TWO = persona("w-claude-2", "claude", "managed");
const arcsAt = (fuel: MonitorSpawnFuel, index = 0): readonly MonitorSpawnFuelArc[] =>
  fuel.drawn?.[index]?.arcs ?? [];
const fillOf = (fuel: MonitorSpawnFuel, index = 0): MonitorSpawnFuelArc | undefined =>
  arcsAt(fuel, index).find((arc) => arc.percent === 64 || arc.percent === 88);
const threadsOf = (fuel: MonitorSpawnFuel, index = 0): MonitorSpawnFuelArc[] =>
  arcsAt(fuel, index).filter((arc) => arc.dash !== undefined);

describe("the spawn bloom's fuel (UM-D7, bands)", () => {
  it("F1: one plan's reading is its circle at 48 and 42, the fill and the notch as the column draws them", () => {
    const fuel = fuelOf([CLAUDE], [reading("w-claude", [FIVE_HOURS(42)])]);
    expect(fuel.word).toBe("Claude Code: 42% of 5 hours");
    expect(fuel.drawn?.map((drawing) => drawing.size)).toEqual([48, 42]);
    // the week has no window: its band is the faint empty arc; the five hours: its track, then its fill
    expect(arcsAt(fuel)).toEqual([
      {
        r: 21.62,
        width: 3.17,
        from: -89,
        to: 269,
        tone: "ink",
        percent: 5,
        opacity: 1,
        cap: "butt",
      },
      {
        r: 17.35,
        width: 3.17,
        from: -84.77,
        to: 264.77,
        tone: "ink",
        percent: 12,
        opacity: 1,
        cap: "round",
      },
      {
        r: 17.35,
        width: 3.17,
        from: -84.77,
        to: 62.04,
        tone: "ink",
        percent: 64,
        opacity: 1,
        cap: "round",
      },
    ]);
    // half the five hours gone: the notch across the inner band, below the middle
    expect(fuel.drawn?.[0]?.notches).toEqual([
      {
        x1: 22.7,
        y1: 38.2,
        x2: 22.14,
        y2: 44.35,
        width: 1.25,
        tone: "ink",
        percent: 84,
        opacity: 1,
      },
    ]);
  });

  it("F2: a plan ahead of pace fills in the orange", () => {
    const fuel = fuelOf([CLAUDE], [reading("w-claude", [FIVE_HOURS(72)])]);
    expect(fillOf(fuel)).toMatchObject({ r: 17.35, tone: "hot", percent: 88, opacity: 1 });
  });

  it("F3: a reading kept after a refresh failed fills at half and says its age", () => {
    const fuel = fuelOf(
      [CLAUDE],
      [
        reading("w-claude", [FIVE_HOURS(42)], {
          state: "unavailable",
          stale: true,
          fetchedAt: minutesFrom(-5),
        }),
      ],
    );
    expect(fillOf(fuel)).toMatchObject({ tone: "ink", percent: 64, opacity: 0.5 });
    expect(fuel.word).toBe("Claude Code: 42% of 5 hours, as of 5m ago");
  });

  it("F4: a window read before its reset fills at half and says the reading's age", () => {
    const fuel = fuelOf(
      [CLAUDE],
      [reading("w-claude", [FIVE_HOURS(42, -10)], { fetchedAt: minutesFrom(-5) })],
    );
    expect(fillOf(fuel)).toMatchObject({ percent: 64, opacity: 0.5 });
    expect(fuel.word).toBe("Claude Code: 42% of 5 hours, as of 5m ago");
  });

  it("F4b: the running week decides while the five hours were read before their reset, and the age is said", () => {
    const fuel = fuelOf(
      [CLAUDE],
      [reading("w-claude", [FIVE_HOURS(42, -10), SEVEN_DAYS(30)], { fetchedAt: minutesFrom(-5) })],
    );
    expect(fuel.word).toBe("Claude Code: 30% of 7 days, as of 5m ago");
  });

  it("F5: a sign-in is the dashed thread across both bands, at 46%", () => {
    const signedOut = persona("w-claude", "claude", "managed", false);
    const fuel = fuelOf([signedOut], []);
    expect(arcsAt(fuel)).toHaveLength(1);
    expect(threadsOf(fuel)).toEqual([
      expect.objectContaining({
        r: 19.48,
        width: 1.78,
        dash: [0.01, 4.64],
        cap: "round",
        tone: "ink",
        percent: 46,
      }),
    ]);
    expect(fuel.word).toBe("Claude Code: not signed in");
  });

  it("F5b: a read that failed is the retry's thread, at 38%", () => {
    const fuel = fuelOf([CLAUDE], [reading("w-claude", [], { state: "unavailable" })]);
    expect(threadsOf(fuel)).toEqual([expect.objectContaining({ tone: "ink", percent: 38 })]);
    expect(fuel.word).toBe("Claude Code: couldn't read");
  });

  it("F5c: one plan reads and one needs you: the circle draws both, the words name the reading", () => {
    const fuel = fuelOf(
      [CLAUDE, CLAUDE_TWO],
      [reading("w-claude", [FIVE_HOURS(42)]), reading("w-claude-2", [], { state: "unavailable" })],
    );
    expect(fillOf(fuel)).toBeDefined();
    expect(threadsOf(fuel)).toEqual([expect.objectContaining({ percent: 38 })]);
    expect(fuel.word).toBe("Claude Code: 42% of 5 hours");
  });

  it("F6: while the usage cannot be read, each plan is the retry's thread, and no empty ring is handed", () => {
    const fuel = fuelOf([CLAUDE, CLAUDE_TWO], [], "unavailable");
    const threads = threadsOf(fuel);
    expect(threads).toHaveLength(2);
    for (const thread of threads) expect(thread).toMatchObject({ tone: "ink", percent: 38 });
    expect(arcsAt(fuel)).toHaveLength(2);
    expect(fuel.word).toBe("usage unavailable");
  });

  it("F6b: a profile with no meters keeps the plain bud and says so", () => {
    const fuel = fuelOf([], []);
    expect(fuel).toEqual({ word: "No meters" });
  });

  it("F6c: a first read keeps the plain bud: nothing in the bloom breathes", () => {
    const fuel = fuelOf([CLAUDE], []);
    expect(fuel).toEqual({ word: "Claude Code: reading" });
  });

  it("F6d: a first read beside a reading leaves its span empty: the reading's strokes are handed, no breath", () => {
    const fuel = fuelOf([CLAUDE, CLAUDE_TWO], [reading("w-claude", [FIVE_HOURS(42)])]);
    expect(fillOf(fuel)).toBeDefined();
    // the breath is the ink at 16% across both bands; none is handed
    expect(arcsAt(fuel).some((arc) => arc.percent === 16)).toBe(false);
    expect(threadsOf(fuel)).toEqual([]);
  });

  it("F7: a draft profile with no circle gets no fuel at all", () => {
    const draft = set("draft", "Draft", [persona("d-claude", "claude", "managed", false)], {
      draft: true,
    });
    const work = set("work", "Work", [CLAUDE]);
    const map = spawnFuelMap(
      columnCircles([work, draft], [reading("w-claude", [FIVE_HOURS(42)])], NOW, {
        usageUnavailable: false,
      }),
      FUEL_SIZES,
    );
    expect([...map.keys()]).toEqual(["work"]);
  });

  it("F8: the menu hands a profile its fuel, and the others are today's objects", () => {
    const sets = [NATIVE, WORK, DEMO];
    const tabs = profileTabs(sets, []);
    const fuel: MonitorSpawnFuel = { word: "Claude Code: 42% of 5 hours" };
    const plain = spawnMenuOf(sets, tabs);
    const worn = spawnMenuOf(sets, tabs, "This Mac", new Map([["work", fuel]]));
    const [native, work, demo] = worn.devices[0]?.profiles ?? [];
    expect(work?.fuel).toBe(fuel);
    expect(native).toEqual(plain.devices[0]?.profiles?.[0]);
    expect(demo).toEqual(plain.devices[0]?.profiles?.[2]);
    expect(native).not.toHaveProperty("fuel");
  });

  it("F9: the 42 drawing is its own, at its own radii", () => {
    const fuel = fuelOf(
      [CLAUDE, persona("w-claude-2", "claude", "managed", false)],
      [reading("w-claude", [FIVE_HOURS(42), SEVEN_DAYS(30)])],
    );
    const drawing = fuel.drawn?.[1];
    expect(drawing?.size).toBe(42);
    const radii = new Set(arcsAt(fuel, 1).map((arc) => arc.r));
    expect(radii).toEqual(new Set([18.81, 14.94, 16.88]));
    expect(threadsOf(fuel, 1)).toEqual([
      expect.objectContaining({ r: 16.88, width: 1.59, dash: [0.01, 4.15] }),
    ]);
  });

  it("F10 (guard): no one-arc field is handed, and every tone is the ink or the orange", () => {
    const fuel = fuelOf(
      [CLAUDE, persona("w-claude-2", "claude", "managed", false)],
      [reading("w-claude", [FIVE_HOURS(72), SEVEN_DAYS(30)])],
    );
    for (const key of ["usedPercent", "elapsedPercent", "hot", "stale", "unread"]) {
      expect(fuel).not.toHaveProperty(key);
    }
    const strokes = (fuel.drawn ?? []).flatMap((drawing) => [
      ...(drawing.arcs ?? []),
      ...(drawing.notches ?? []),
    ]);
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of strokes) expect(["ink", "hot"]).toContain(stroke.tone);
  });
});
