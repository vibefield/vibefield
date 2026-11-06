// UM-1 (track UM; UM-D3, D4, D13 and D15 at their leans, James 2026-11-06 03:11Z) — one profile's meters, pure
// (`src/usage/meters.ts`): every plan read through Settings' own join, in the order a glance can trust, with the
// tightest window, the forecast, the budget's pace-less rule and the pace rule's orange.

import {
  AGENT_CATALOG_IDS,
  type AgentAccountUsageEntry,
  type AgentAccountUsageMetric,
  type AgentPersona,
  type AgentPlan,
  type AgentProfileSet,
} from "@vibefield/contracts";
import { planTitle } from "@vibefield/puppeteer-views";
import { describe, expect, it } from "vitest";
import { resetWords, usageLines } from "../src/panels/agents/profiles-model";
import {
  durationWords,
  forecastOf,
  meterWindows,
  type PlanMeter,
  type ProfileMeters,
  planMeters,
  RESET_BY_DAY_MINUTES,
  resetForm,
  tightestWindow,
} from "../src/usage/meters";

const NOW = new Date("2026-11-06T12:00:00.000Z");
/** an instant `minutes` from now, as the wire spells it */
const from = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString();

/** A window `minutes` long that resets `resetsIn` minutes from now (its elapsed share follows), `used` spent. */
function window(
  id: string,
  used: number,
  minutes: number,
  resetsIn: number,
  over: Partial<AgentAccountUsageMetric> = {},
): AgentAccountUsageMetric {
  return {
    id,
    label: id.toUpperCase(),
    kind: "window",
    usedPercent: used,
    durationMinutes: minutes,
    resetsAt: from(resetsIn),
    ...over,
  };
}
/** a window `used` spent, `elapsed` of its `minutes` gone */
const paced = (id: string, used: number, elapsed: number, minutes = 300) =>
  window(id, used, minutes, ((100 - elapsed) / 100) * minutes);

function persona(
  provider: string,
  profileId: string,
  over: Partial<AgentPersona> = {},
): AgentPersona {
  return {
    profileId,
    provider,
    label: "Default",
    kind: profileId.endsWith(":native-default") ? "native-default" : "managed",
    createdAt: "2026-11-01T00:00:00.000Z",
    identity: { loggedIn: true, email: "kim@example.com", verifiedAt: "2026-11-06T11:00:00.000Z" },
    ...over,
  };
}
const own = (provider: string, over: Partial<AgentPersona> = {}) =>
  persona(provider, `${provider}:native-default`, over);

function plan(
  id: string,
  namedBy: string | undefined,
  holders: readonly string[],
  over: Partial<AgentPlan> = {},
): AgentPlan {
  return {
    id,
    service: { id, label: id },
    account: { email: "kim@example.com", plan: "max" },
    ...(namedBy !== undefined ? { namedBy } : {}),
    holders: [...holders],
    alsoIn: [],
    ...over,
  };
}
/** A plan named by an agent's own sign-in, held by it alone. */
const ownPlan = (id: string, provider: string) =>
  plan(id, `${provider}:native-default`, [`${provider}:native-default`]);

function profile(
  personas: AgentPersona[],
  plans: AgentPlan[],
  over: Partial<AgentProfileSet> = {},
): AgentProfileSet {
  return {
    id: "native",
    kind: "native",
    label: "This Mac",
    default: true,
    createdAt: "1970-01-01T00:00:00.000Z",
    personas,
    plans,
    ...over,
  };
}

/** A reading of a sign-in: the provider's unkeyed row for an agent's own folder, else the persona's. */
function row(
  provider: string,
  metrics: AgentAccountUsageMetric[],
  over: Partial<AgentAccountUsageEntry> = {},
): AgentAccountUsageEntry {
  return {
    provider,
    label: provider,
    state: "available",
    metrics,
    fetchedAt: from(-1),
    ...over,
  };
}

function only<T>(value: T | undefined, what: string): T {
  expect(value, what).toBeDefined();
  return value as T;
}
const entryOf = (meters: ProfileMeters, key: string): PlanMeter =>
  only(
    meters.entries.find((entry) => entry.key === key),
    key,
  );
const kinds = (meters: ProfileMeters) =>
  meters.entries.map((entry) =>
    entry.kind === "needs-you"
      ? `${entry.key} ${entry.kind} ${entry.need}`
      : entry.kind === "no-meter"
        ? `${entry.key} ${entry.kind} ${entry.why}`
        : `${entry.key} ${entry.kind}`,
  );
const reading = (entry: PlanMeter) => {
  expect(entry.kind, entry.key).toBe("reading");
  return entry as Extract<PlanMeter, { kind: "reading" }>;
};

describe("UM-1 — a plan's reading is Settings' join", () => {
  it("is the reading of the sign-in that named its account, its windows Settings' C1 lines", () => {
    const metrics = [paced("5h", 30, 50), paced("7d", 40, 60, 10_080)];
    const meters = planMeters(
      profile([own("claude")], [ownPlan("anthropic", "claude")]),
      [row("claude", metrics)],
      NOW,
    );
    expect(meters.entries.map((entry) => entry.key)).toEqual(["plan:anthropic"]);
    const entry = reading(entryOf(meters, "plan:anthropic"));
    expect(entry).toMatchObject({
      provider: "claude",
      agent: "Claude Code",
      title: planTitle({ id: "anthropic", label: "anthropic" }, "max"),
      profileId: "claude:native-default",
      plan: { id: "anthropic", account: "kim@example.com" },
      stale: false,
    });
    expect(entry.windows.map((each) => each.line)).toEqual(usageLines(metrics, NOW));
    expect(entry.windows.map((each) => each.metric)).toEqual(metrics);
  });

  it("reads a profile's sign-in by its own row, never the agent's own folder's", () => {
    const work = persona("claude", "work-claude");
    const meters = planMeters(
      profile([work], [plan("anthropic", "work-claude", ["work-claude"])], {
        id: "work",
        kind: "managed",
        label: "Work",
      }),
      [
        row("claude", [paced("5h", 10, 50)]),
        row("claude", [paced("5h", 70, 50)], { profileId: "work-claude" }),
      ],
      NOW,
    );
    expect(reading(entryOf(meters, "plan:anthropic")).tightest.line.usedPercent).toBe(70);
  });

  it("lists every plan once and every agent on no plan as its own entry, named by the catalog", () => {
    const hermes = persona("hermes", "work-hermes");
    const codex = persona("codex", "work-codex", { identity: undefined });
    const meters = planMeters(
      profile(
        [codex, hermes],
        [
          plan("nous", "work-hermes", ["work-hermes"]),
          plan("anthropic", undefined, ["work-hermes"], { account: undefined }),
        ],
        { id: "work", kind: "managed", label: "Work" },
      ),
      [],
      NOW,
    );
    expect(meters.entries.map((entry) => entry.key).sort()).toEqual(
      ["agent:work-codex", "plan:anthropic", "plan:nous"].sort(),
    );
    expect(entryOf(meters, "agent:work-codex")).toMatchObject({
      provider: "codex",
      agent: "Codex",
      title: "Codex",
      profileId: "work-codex",
    });
    // a plan no agent names wears its holder's mark
    expect(entryOf(meters, "plan:anthropic")).toMatchObject({
      provider: "hermes",
      kind: "no-meter",
    });
  });

  it("lists This Mac's installed agents and one signing in, as Settings' page does; a profile lists every sign-in", () => {
    const personas = [
      own("claude"),
      own("codex"),
      own("grok", { signingIn: { sessionId: "s", since: from(-2) } }),
    ];
    const plans = [ownPlan("anthropic", "claude"), ownPlan("openai", "codex")];
    const installed = new Set(["claude"]);
    expect(
      planMeters(profile(personas, plans), [], NOW, installed).entries.map((entry) => entry.key),
    ).toEqual(["plan:anthropic", "agent:grok:native-default"]);
    expect(planMeters(profile(personas, plans), [], NOW).entries.map((entry) => entry.key)).toEqual(
      ["plan:anthropic", "plan:openai", "agent:grok:native-default"],
    );
    const managed = profile(personas, plans, { id: "work", kind: "managed", label: "Work" });
    expect(planMeters(managed, [], NOW, installed).entries).toHaveLength(3);
  });
});

describe("UM-1 — what a plan's meter says it is", () => {
  it("needs you: an expired, signed-out or signing-in sign-in asks to sign in; a reading not taken asks to retry", () => {
    const signedOut = own("claude", {
      identity: { loggedIn: false, verifiedAt: from(-5) },
    });
    const signingIn = own("codex", { signingIn: { sessionId: "s", since: from(-1) } });
    const unread = own("grok", { identity: undefined });
    const expired = own("kimi");
    const failed = own("antigravity");
    const limited = persona("claude", "work-claude");
    const unknown = persona("codex", "work-codex");
    const meters = planMeters(
      profile([signedOut, signingIn, unread, expired, failed, limited, unknown], []),
      [
        row("grok", [], { state: "unauthenticated" }),
        row("kimi", [], { state: "unauthenticated" }),
        row("antigravity", [], { state: "unavailable", retryable: true }),
        row("claude", [], { state: "rate-limited", profileId: "work-claude" }),
        row("codex", [], { state: "unknown", profileId: "work-codex" }),
      ],
      NOW,
    );
    expect(kinds(meters).sort()).toEqual(
      [
        "agent:claude:native-default needs-you sign-in",
        "agent:codex:native-default needs-you sign-in",
        "agent:grok:native-default needs-you sign-in",
        "agent:kimi:native-default needs-you sign-in",
        "agent:antigravity:native-default needs-you retry",
        "agent:work-claude needs-you retry",
        "agent:work-codex needs-you retry",
      ].sort(),
    );
    expect(entryOf(meters, "agent:kimi:native-default")).toMatchObject({
      right: { kind: "need", words: "not signed in", hot: false, icon: false },
    });
    expect(entryOf(meters, "agent:antigravity:native-default")).toMatchObject({
      right: { kind: "need", words: "couldn’t read" },
    });
  });

  it("an expired sign-in asks to sign in even over a kept reading; any other keeps its reading", () => {
    const kept = (provider: string) =>
      row(provider, [paced("5h", 20, 50)], { state: "unauthenticated", stale: true });
    const meters = planMeters(
      profile([own("claude"), own("codex", { identity: undefined })], []),
      [kept("claude"), kept("codex")],
      NOW,
    );
    expect(kinds(meters)).toEqual([
      "agent:codex:native-default reading",
      "agent:claude:native-default needs-you sign-in",
    ]);
  });

  it("no meter: an account no agent names, an agent that reports no usage, a reading with no window", () => {
    const meters = planMeters(
      profile(
        [own("claude"), own("codex"), own("grok"), own("opencode")],
        [
          plan("anthropic", undefined, ["claude:native-default"]),
          plan("openai", "codex:native-default", ["codex:native-default"], { account: undefined }),
        ],
      ),
      [row("grok", [], { state: "unsupported" }), row("opencode", [], { state: "available" })],
      NOW,
    );
    expect(kinds(meters)).toEqual([
      "plan:anthropic no-meter unnamed",
      "plan:openai no-meter unnamed",
      "agent:grok:native-default no-meter unreported",
      "agent:opencode:native-default no-meter no-windows",
    ]);
    // no reading, from an agent the catalog meters no usage for
    expect(kinds(planMeters(profile([own("opencode")], []), [], NOW))).toEqual([
      "agent:opencode:native-default no-meter unreported",
    ]);
  });

  it("a first read: a metered sign-in with no reading yet breathes, before the first batch and after it", () => {
    const set = profile([own("claude")], [ownPlan("anthropic", "claude")]);
    for (const rows of [[], [row("codex", [paced("5h", 10, 50)])]]) {
      expect(kinds(planMeters(set, rows, NOW))).toEqual(["plan:anthropic first-read"]);
    }
    expect(entryOf(planMeters(set, [], NOW), "plan:anthropic")).toMatchObject({
      right: { kind: "reading", words: "reading…", hot: false, icon: false },
    });
  });

  it("a kept reading draws its numbers and says its age", () => {
    const meters = planMeters(
      profile([own("claude")], [ownPlan("anthropic", "claude")]),
      [
        row("claude", [paced("5h", 20, 50)], {
          state: "unavailable",
          stale: true,
          fetchedAt: from(-32),
        }),
      ],
      NOW,
    );
    const entry = reading(entryOf(meters, "plan:anthropic"));
    expect(entry.stale).toBe(true);
    expect(entry.fetchedAt).toBe(from(-32));
    expect(entry.right).toEqual({ kind: "kept", words: "as of 32m ago", hot: false, icon: false });
    const unparsed = planMeters(
      profile([own("claude")], [ownPlan("anthropic", "claude")]),
      [row("claude", [paced("5h", 20, 50)], { stale: true, fetchedAt: "not a time" })],
      NOW,
    );
    expect(reading(entryOf(unparsed, "plan:anthropic")).right.words).toBe(
      "as of an earlier reading",
    );
  });
});

describe("UM-D15 — the order a glance can trust", () => {
  it("readings, then those that need you, then no meter; the catalog's agent order within each, then the profile's", () => {
    const ids = AGENT_CATALOG_IDS;
    // the set lists them out of order, on purpose
    const set = profile(
      [
        own("opencode"),
        own("kimi", { identity: { loggedIn: false, verifiedAt: from(-5) } }),
        own("antigravity"),
        own("grok"),
        own("codex"),
        own("claude"),
        persona("claude", "claude-b"),
        own("newagent"),
      ],
      [plan("second", "claude-b", ["claude-b"]), ownPlan("first", "claude")],
    );
    const meters = planMeters(
      set,
      [
        row("claude", [paced("5h", 10, 50)]),
        row("claude", [paced("5h", 12, 50)], { profileId: "claude-b" }),
        row("grok", [paced("5h", 90, 95)]),
        row("codex", [], { state: "unavailable" }),
        row("newagent", [paced("5h", 5, 50)]),
      ],
      NOW,
    );
    expect(kinds(meters)).toEqual([
      // the profile's own order between its two Claude plans: the set lists "second" first
      "plan:second reading",
      "plan:first reading",
      "agent:grok:native-default reading",
      "agent:antigravity:native-default first-read",
      // an agent this build has no row for stands after every row
      "agent:newagent:native-default reading",
      "agent:codex:native-default needs-you retry",
      "agent:kimi:native-default needs-you sign-in",
      "agent:opencode:native-default no-meter unreported",
    ]);
    // the catalog's order, read from the catalog
    const rank = (provider: string) => ids.indexOf(provider);
    expect(rank("claude")).toBeLessThan(rank("grok"));
    expect(rank("grok")).toBeLessThan(rank("antigravity"));
    expect(rank("codex")).toBeLessThan(rank("kimi"));
  });
});

describe("UM-D13 — the tightest window and the profile's tightest plan", () => {
  it("ranks by pressure: ahead of pace before spent windows before fuller ones; the first of equals", () => {
    const windows = meterWindows(
      [paced("a", 50, 80), paced("b", 70, 90, 10_080), paced("c", 45, 30)],
      NOW,
    );
    expect(windows.map((each) => [each.line.id, Math.round(each.pressure)])).toEqual([
      ["a", 50],
      ["b", 70],
      ["c", 1045],
    ]);
    expect(tightestWindow(windows)?.line.id).toBe("c");
    expect(
      tightestWindow(meterWindows([paced("a", 50, 80), paced("b", 70, 90)], NOW))?.line.id,
    ).toBe("b");
    // spent: hot and over, beyond any window only ahead of pace
    const spent = meterWindows([paced("hot", 45, 30), window("full", 100, 10_080, 600)], NOW);
    expect(tightestWindow(spent)?.line.id).toBe("full");
    expect(
      tightestWindow(meterWindows([paced("x", 20, 50), paced("y", 20, 50)], NOW))?.line.id,
    ).toBe("x");
  });

  it("names the profile's tightest plan, and its hot rule is any plan's", () => {
    const meters = planMeters(
      profile(
        [own("claude"), own("codex")],
        [ownPlan("anthropic", "claude"), ownPlan("openai", "codex")],
      ),
      [
        row("claude", [paced("5h", 50, 80), paced("7d", 70, 90, 10_080)]),
        row("codex", [paced("5h", 45, 30)]),
      ],
      NOW,
    );
    expect(meters.tightest?.key).toBe("plan:openai");
    expect(meters.tightest?.tightest.line.id).toBe("5h");
    expect(meters.hot).toBe(true);
    expect(reading(entryOf(meters, "plan:anthropic"))).toMatchObject({ hot: false });
    expect(reading(entryOf(meters, "plan:anthropic")).tightest.line.id).toBe("7d");
    const calm = planMeters(
      profile([own("claude")], [ownPlan("anthropic", "claude")]),
      [row("claude", [paced("5h", 30, 50)])],
      NOW,
    );
    expect(calm.tightest?.key).toBe("plan:anthropic");
    expect(calm.hot).toBe(false);
  });
});

describe("UM-D3 — one meter: Settings' pace rule, and a budget with no pace", () => {
  it("every window's orange is Settings' isHot; a budget is pace-less — no now line, orange at 80", () => {
    const metrics = [
      paced("5h", 64, 50),
      // a budget the adapter gives a length and a reset: Settings' line would pace it
      window("credit", 50, 300, 240, { kind: "budget" }),
      window("credit-high", 85, 300, 240, { kind: "budget" }),
    ];
    const settings = usageLines(metrics, NOW);
    expect(settings.map((line) => [line.id, line.hot])).toEqual([
      ["5h", true],
      ["credit", true],
      ["credit-high", true],
    ]);
    const windows = meterWindows(metrics, NOW);
    expect(windows.map((each) => [each.line.id, each.budget, each.line.hot])).toEqual([
      ["5h", false, true],
      ["credit", true, false],
      ["credit-high", true, true],
    ]);
    expect(windows[0]?.line).toEqual(settings[0]);
    for (const budget of windows.slice(1)) {
      expect(budget.line.elapsedPercent).toBeUndefined();
      expect(budget.resetIn).toBeUndefined();
      expect(budget.forecast).toBeUndefined();
    }
  });
});

describe("UM-D4 — the forecast, only while ahead of pace and before the reset", () => {
  it("says 'out in ~35m' at the meter's right, and 'Runs out in ~35m at this pace' in full", () => {
    const meters = planMeters(
      profile([own("codex")], [ownPlan("openai", "codex")]),
      [row("codex", [paced("5h", 82, 55), paced("7d", 47, 52, 10_080)])],
      NOW,
    );
    const entry = reading(entryOf(meters, "plan:openai"));
    expect(entry.tightest.line.id).toBe("5h");
    expect(entry.tightest.forecast).toMatchObject({
      words: "~35m",
      short: "out in ~35m",
      long: "Runs out in ~35m at this pace",
    });
    expect(entry.tightest.forecast?.minutes).toBeCloseTo(36.22, 2);
    expect(entry.right).toEqual({ kind: "forecast", words: "out in ~35m", hot: true, icon: false });
  });

  it("says the reset instead while not ahead, once spent, or for a budget", () => {
    const meters = planMeters(
      profile(
        [own("codex"), own("claude"), own("grok")],
        [ownPlan("openai", "codex"), ownPlan("anthropic", "claude"), ownPlan("xai", "grok")],
      ),
      [
        row("codex", [window("5h", 30, 300, 135)]),
        row("claude", [window("7d", 100, 10_080, 600)]),
        row("grok", [{ id: "cr", label: "CR", kind: "budget", usedPercent: 85 }]),
      ],
      NOW,
    );
    const calm = reading(entryOf(meters, "plan:openai"));
    expect(calm.tightest.forecast).toBeUndefined();
    expect(calm.right).toEqual({
      kind: "reset",
      words: resetWords(new Date(from(135)), NOW),
      hot: false,
      icon: true,
    });
    const spent = reading(entryOf(meters, "plan:anthropic"));
    expect(spent.tightest.forecast).toBeUndefined();
    expect(spent.right).toMatchObject({ kind: "reset", words: "10h", hot: true, icon: true });
    // a budget has no reset words: nothing at its right, its orange kept
    expect(reading(entryOf(meters, "plan:xai")).right).toEqual({
      kind: "none",
      words: "",
      hot: true,
      icon: false,
    });
  });

  it("rounds as the drawing does: to the minute under 10, to five under the hour, to fifteen from it", () => {
    const say = (usedPercent: number, elapsedPercent: number, durationMinutes = 300) =>
      forecastOf({
        usedPercent,
        elapsedPercent,
        durationMinutes,
        resetIn: ((100 - elapsedPercent) / 100) * durationMinutes,
        budget: false,
      })?.words;
    expect(say(97, 58)).toBe("~5m");
    expect(say(99.9, 90)).toBe("~1m");
    expect(say(82, 55)).toBe("~35m");
    // 58 minutes rounds to five as 60
    expect(say(70, 45.1)).toBe("~60m");
    expect(say(64, 50)).toBe("~1h 30m");
    expect(say(86, 70, 10_080)).toBe("~19h 15m");
    expect(say(50, 10, 43_200)).toBe("~3d");
  });

  it("never forecasts a budget, a spent window, one not ahead, one of no length, or past its reset", () => {
    const base = {
      usedPercent: 60,
      elapsedPercent: 50,
      durationMinutes: 300,
      resetIn: 150,
      budget: false,
    };
    expect(forecastOf(base)?.words).toBe("~1h 45m");
    expect(forecastOf({ ...base, budget: true })).toBeUndefined();
    expect(forecastOf({ ...base, usedPercent: 100 })).toBeUndefined();
    expect(forecastOf({ ...base, usedPercent: 30 })).toBeUndefined();
    expect(forecastOf({ ...base, durationMinutes: undefined })).toBeUndefined();
    expect(forecastOf({ ...base, elapsedPercent: undefined })).toBeUndefined();
    // the limit comes after the reset (100 minutes at this pace, 30 to the reset)
    expect(forecastOf({ ...base, resetIn: 30 })).toBeUndefined();
  });
});

describe("UM-1 — the words' lengths and the reset's form", () => {
  it("durationWords says a length as the drawing does, its carry exact", () => {
    expect(
      [0.2, 45, 59.6, 60, 130, 1439, 1440, 1500, 2850, 4320].map((minutes) =>
        durationWords(minutes),
      ),
    ).toEqual(["1m", "45m", "1h", "1h", "2h 10m", "23h 59m", "1d", "1d 1h", "2d", "3d"]);
  });

  it("resetForm agrees with Settings' resetWords: a length under a day, the day from it, 'now' once past", () => {
    const form = (resetsIn: number) => {
      const [first] = meterWindows([window("w", 10, 10_080, resetsIn)], NOW);
      return resetForm(only(first, `a window resetting in ${resetsIn}m`));
    };
    expect(RESET_BY_DAY_MINUTES).toBe(1440);
    expect(form(1439)).toBe("length");
    expect(resetWords(new Date(from(1439)), NOW)).toMatch(/^\d/u);
    expect(form(1440)).toBe("day");
    expect(resetWords(new Date(from(1440)), NOW)).not.toMatch(/^\d/u);
    expect(form(-5)).toBe("now");
    expect(resetWords(new Date(from(-5)), NOW)).toBe("now");
    const [noReset] = meterWindows([{ id: "n", label: "N", kind: "window", usedPercent: 4 }], NOW);
    expect(resetForm(only(noReset, "a window with no reset"))).toBeUndefined();
  });
});
