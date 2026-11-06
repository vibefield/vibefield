// UM-1 (UM-D16 = E, "Bands", round 3) — the Bands circle's geometry, pure (`src/usage/bands.ts`): every plan of a
// profile on one circle, five hours inside, the week outside, a model's week a hairline at full size, a budget both;
// the detail by the size's level, the centre, the hot dot (Settings' pace rule, UM-D3) and the words. The numbers are
// the ruled drawing's (draft/profile-meters/round4/src/p3e-dials.js); the phone is held to them by the bands golden.

import type {
  AgentAccountUsageEntry,
  AgentAccountUsageMetric,
  AgentPersona,
  AgentProfileSet,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  PHONE_BANDS_GOLDEN,
  PHONE_BANDS_NOW,
  PHONE_BANDS_SIZES,
  PHONE_GOLDEN_MIRRORS,
  PHONE_VIEW_MIRROR,
  phoneBandsGolden,
} from "../perf/lib/phone-goldens";
import {
  arcPath,
  type BandsArc,
  type BandsGeometry,
  type BandsPlan,
  bandsGeometry,
  bandsLabel,
  bandsLevel,
  bandsOf,
} from "../src/usage/bands";
import { type PlanMeter, planMeters } from "../src/usage/meters";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const DEG = Math.PI / 180;
const from = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString();

/** a window `used` spent, `elapsed` of its `minutes` gone */
function paced(
  id: string,
  used: number,
  elapsed: number,
  minutes = 300,
  over: Partial<AgentAccountUsageMetric> = {},
): AgentAccountUsageMetric {
  return {
    id,
    label: id.toUpperCase(),
    kind: "window",
    usedPercent: used,
    durationMinutes: minutes,
    resetsAt: from(((100 - elapsed) / 100) * minutes),
    ...over,
  };
}
const budget = (used: number): AgentAccountUsageMetric => ({
  id: "cr",
  label: "CR",
  kind: "budget",
  usedPercent: used,
});

const own = (provider: string, over: Partial<AgentPersona> = {}): AgentPersona => ({
  profileId: `${provider}:native-default`,
  provider,
  label: "Default",
  kind: "native-default",
  createdAt: "2026-11-01T00:00:00.000Z",
  identity: { loggedIn: true, email: "kim@example.com", verifiedAt: "2026-11-06T11:00:00.000Z" },
  ...over,
});

/** This Mac with one sign-in per agent (each on no plan, so each its own entry), read from `rows`. */
function meters(
  agents: ReadonlyArray<
    readonly [string, AgentAccountUsageMetric[] | Partial<AgentAccountUsageEntry>]
  >,
  personas: Partial<Record<string, Partial<AgentPersona>>> = {},
): PlanMeter[] {
  const set: AgentProfileSet = {
    id: "native",
    kind: "native",
    label: "This Mac",
    default: true,
    createdAt: "1970-01-01T00:00:00.000Z",
    personas: agents.map(([provider]) => own(provider, personas[provider] ?? {})),
    plans: [],
  };
  const rows: AgentAccountUsageEntry[] = agents.map(([provider, reading]) => ({
    provider,
    label: provider,
    state: "available",
    metrics: Array.isArray(reading) ? reading : [],
    fetchedAt: from(-1),
    ...(Array.isArray(reading) ? {} : reading),
  }));
  return planMeters(set, rows, NOW).entries;
}

function only<T>(value: T | undefined, what: string): T {
  expect(value, what).toBeDefined();
  return value as T;
}
const planAt = (geometry: BandsGeometry, index: number): BandsPlan =>
  only(geometry.plans[index], `plan ${index}`);
const arcsOf = (plan: BandsPlan, band: BandsArc["band"], part?: BandsArc["part"]) =>
  plan.arcs.filter((arc) => arc.band === band && (part === undefined || arc.part === part));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The drawing's radii at a size: the rim, the outer and inner bands, both bands at once, and the hole. */
function radii(size: number) {
  const level = size >= 150 ? 3 : size >= 72 ? 2 : size >= 38 ? 1 : 0;
  const markZone = level >= 3 ? 25 : level === 2 ? 15.5 : 0;
  const band =
    level >= 3
      ? clamp(size * 0.046, 8, 11)
      : level === 2
        ? clamp(size * 0.052, 4, 5.6)
        : clamp(size * 0.066, 2.6, 3.4);
  const gap = level >= 3 ? 2.6 : level === 2 ? 1.6 : 1.1;
  const rim = size / 2 - markZone - (level >= 3 ? 6.5 : 0) - (level >= 1 ? 0.8 : 0.5);
  return {
    band,
    gap,
    rim,
    outer: rim - band / 2,
    inner: rim - band - gap - band / 2,
    both: rim - band - gap / 2,
    hole: rim - band - gap - band - (level >= 3 ? 7 : level === 2 ? 5 : 2.5),
    markZone,
  };
}

describe("UM-1 — the Bands circle's levels and bands", () => {
  it("draws by the size's level: 0 below 38, 1 to 71, 2 to 149, 3 from 150", () => {
    expect([26, 37, 38, 40, 54, 71, 72, 149, 150, 206, 212].map(bandsLevel)).toEqual([
      0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 3,
    ]);
    expect(bandsGeometry(212, meters([["claude", [paced("5h", 20, 50)]]])).level).toBe(3);
  });

  it("five hours or less inside, the most pressed longer whole-plan window outside, a model's week the hairline", () => {
    const [entry] = meters([
      [
        "claude",
        [
          paced("5h", 30, 50),
          paced("7d", 40, 50, 10_080),
          paced("30d", 90, 95, 43_200),
          paced("fable", 4, 50, 10_080, { group: { id: "scope:fable", label: "Fable only" } }),
        ],
      ],
    ]);
    const bands = bandsOf(only(entry, "the reading"));
    expect(bands.short?.line.id).toBe("5h");
    expect(bands.long?.line.id).toBe("30d");
    expect(bands.group?.line.id).toBe("fable");
    expect(bands.budget).toBeUndefined();
    const [credit] = meters([["grok", [budget(30)]]]);
    expect(bandsOf(only(credit, "the budget")).budget?.line.id).toBe("cr");
    // a plan with no reading has no bands
    const [waiting] = meters([["claude", { state: "unavailable" }]]);
    expect(bandsOf(only(waiting, "the retry"))).toEqual({});
  });
});

describe("UM-1 — each plan's segment", () => {
  it("one plan takes the whole turn from the top; several share it with gaps between", () => {
    const one = bandsGeometry(40, meters([["claude", [paced("5h", 20, 50)]]]));
    expect(planAt(one, 0)).toMatchObject({ from: -90, span: 360 });
    const three = bandsGeometry(
      40,
      meters([
        ["claude", [paced("5h", 20, 50)]],
        ["codex", [paced("5h", 30, 50)]],
        ["grok", [paced("5h", 40, 50)]],
      ]),
    );
    const { inner } = radii(40);
    const gap = 2.8 / inner / DEG;
    const span = (360 - 3 * gap) / 3;
    expect(three.plans.map((plan) => plan.key)).toEqual([
      "agent:claude:native-default",
      "agent:codex:native-default",
      "agent:grok:native-default",
    ]);
    three.plans.forEach((plan, index) => {
      expect(plan.from).toBeCloseTo(-90 + gap / 2 + index * (span + gap), 6);
      expect(plan.span).toBeCloseTo(span, 6);
    });
  });

  it("puts the bands at the drawing's radii, a model's week outside them only at full size", () => {
    const entries = meters([
      [
        "claude",
        [
          paced("5h", 30, 50),
          paced("7d", 40, 50, 10_080),
          paced("fable", 4, 50, 10_080, { group: { id: "scope:fable", label: "Fable only" } }),
        ],
      ],
    ]);
    for (const size of [26, 40, 54, 88, 206, 212]) {
      const plan = planAt(bandsGeometry(size, entries), 0);
      const want = radii(size);
      expect(arcsOf(plan, "outer", "track")[0]?.r, `${size} outer`).toBeCloseTo(want.outer, 6);
      expect(arcsOf(plan, "inner", "track")[0]?.r, `${size} inner`).toBeCloseTo(want.inner, 6);
      expect(arcsOf(plan, "outer", "track")[0]?.width, `${size} band`).toBeCloseTo(want.band, 6);
      const hairline = arcsOf(plan, "hairline");
      if (size >= 150) {
        expect(hairline.map((arc) => arc.part)).toEqual(["track", "fill"]);
        expect(hairline[0]?.r).toBeCloseTo(want.rim + 3.5 + 1.5, 6);
        expect(hairline[0]).toMatchObject({ width: 3, cap: "round" });
      } else expect(hairline, `${size} has no hairline`).toEqual([]);
      expect(bandsGeometry(size, entries).centre.r, `${size} hole`).toBeCloseTo(want.hole, 6);
    }
  });

  it("draws a window as Settings' C1 bent round: track, fill, the lit head's six steps from level 2, the notch at the time gone", () => {
    const entries = meters([["claude", [paced("7d", 50, 60, 10_080)]]]);
    const big = planAt(bandsGeometry(212, entries), 0);
    const outer = arcsOf(big, "outer");
    expect(outer.map((arc) => arc.part)).toEqual([
      "track",
      "fill",
      "head",
      "head",
      "head",
      "head",
      "head",
      "head",
    ]);
    // a whole turn stops just short of closing
    expect(outer[0]).toMatchObject({ from: -90, cap: "butt", paint: { tone: "ink", percent: 8 } });
    expect(outer[0]?.to).toBeCloseTo(-90 + 359.9, 6);
    expect(outer[1]).toMatchObject({ from: -90, cap: "butt", paint: { tone: "ink", percent: 28 } });
    expect(outer[1]?.to).toBeCloseTo(-90 + 180, 6);
    expect(outer.slice(2).map((arc) => arc.paint)).toEqual(
      [9, 19, 29, 39, 49, 58].map((percent) => ({ tone: "ink", percent })),
    );
    // the head ends on the fill's end
    expect(outer.at(-1)?.to).toBeCloseTo(90, 6);
    // the inner band holds no window of five hours: an empty track
    expect(arcsOf(big, "inner").map((arc) => [arc.part, arc.paint])).toEqual([
      ["empty", { tone: "ink", percent: 5 }],
    ]);
    const [notch] = big.notches;
    const { outer: r, band } = radii(212);
    const angle = (-90 + 360 * 0.6) * DEG;
    expect(notch?.x1).toBeCloseTo(106 + (r - band / 2 - 3) * Math.cos(angle), 6);
    expect(notch?.y2).toBeCloseTo(106 + (r + band / 2 + 3) * Math.sin(angle), 6);
    expect(notch).toMatchObject({ width: 2, paint: { tone: "ink", percent: 84 }, opacity: 1 });
    // small: round ends, a solid fill, no head; the notch lies past the round start
    const small = planAt(bandsGeometry(40, entries), 0);
    expect(arcsOf(small, "outer").map((arc) => [arc.part, arc.cap])).toEqual([
      ["track", "round"],
      ["fill", "round"],
    ]);
    expect(arcsOf(small, "outer", "fill")[0]?.paint).toEqual({ tone: "ink", percent: 64 });
    expect(small.notches[0]?.width).toBe(1.25);
    // the smallest draws no notch
    expect(planAt(bandsGeometry(26, entries), 0).notches).toEqual([]);
  });

  it("ahead of pace the fill is orange and its head lit in white; a kept reading's fill fades to half", () => {
    const hot = planAt(bandsGeometry(212, meters([["claude", [paced("7d", 70, 40, 10_080)]]])), 0);
    expect(arcsOf(hot, "outer", "fill")[0]?.paint).toEqual({ tone: "hot", percent: 88 });
    expect(arcsOf(hot, "outer", "head").map((arc) => arc.paint)).toEqual(
      [6, 12, 19, 26, 33, 40].map((percent) => ({ tone: "light", percent })),
    );
    const kept = planAt(
      bandsGeometry(
        212,
        meters([
          ["claude", { metrics: [paced("7d", 30, 40, 10_080)], state: "unavailable", stale: true }],
        ]),
      ),
      0,
    );
    expect(arcsOf(kept, "outer", "fill")[0]?.opacity).toBe(0.5);
    expect(arcsOf(kept, "outer", "track")[0]?.opacity).toBe(1);
  });

  it("a budget fills both bands, with no notch", () => {
    const plan = planAt(bandsGeometry(212, meters([["grok", [budget(30)]]])), 0);
    const { both, band, gap } = radii(212);
    expect(plan.arcs.map((arc) => [arc.band, arc.part])).toEqual([
      ["both", "track"],
      ["both", "fill"],
      ...Array.from({ length: 6 }, () => ["both", "head"]),
    ]);
    expect(plan.arcs[0]?.r).toBeCloseTo(both, 6);
    expect(plan.arcs[0]?.width).toBeCloseTo(band * 2 + gap, 6);
    expect(plan.notches).toEqual([]);
  });

  it("a plan that needs you is one dashed thread across both bands; a first read breathes", () => {
    const entries = meters(
      [
        ["kimi", { state: "unauthenticated" }],
        ["antigravity", { state: "unavailable" }],
      ],
      {},
    );
    const geometry = bandsGeometry(212, [
      ...entries,
      ...planMeters(
        {
          id: "native",
          kind: "native",
          label: "This Mac",
          default: true,
          createdAt: "1970-01-01T00:00:00.000Z",
          personas: [own("claude")],
          plans: [],
        },
        [],
        NOW,
      ).entries,
    ]);
    const { both, band, gap } = radii(212);
    // drawn in the order given: the needs first here, the first read last
    const [signIn, retry, first] = geometry.plans;
    expect(first?.arcs.map((arc) => [arc.band, arc.part, arc.paint])).toEqual([
      ["both", "breath", { tone: "ink", percent: 16 }],
    ]);
    const thread = Math.max(1.15, (band * 2 + gap) * 0.24);
    expect(signIn?.arcs).toEqual([
      expect.objectContaining({
        band: "both",
        part: "thread",
        cap: "round",
        paint: { tone: "ink", percent: 46 },
        dash: [0.01, Math.max(2.5, thread * 2.6)],
      }),
    ]);
    expect(signIn?.arcs[0]?.r).toBeCloseTo(both, 6);
    expect(signIn?.arcs[0]?.width).toBeCloseTo(thread, 6);
    expect(retry?.arcs[0]?.paint).toEqual({ tone: "ink", percent: 38 });
  });
});

describe("UM-1 — the centre, the marks and the hot dot", () => {
  const hot = () =>
    meters([
      ["codex", [paced("5h", 82, 55), paced("7d", 47, 52, 10_080)]],
      ["kimi", { state: "unauthenticated" }],
    ]);

  it("shows only the profile's glyph at 40 and 54; nothing on the Me menu's 26", () => {
    for (const size of [40, 54]) {
      const geometry = bandsGeometry(size, hot(), { centre: "glyph" });
      const hole = radii(size).hole;
      expect(geometry.centre.items).toEqual([
        {
          kind: "glyph",
          x: size / 2,
          y: size / 2,
          size: Math.min(hole * 1.18, 20),
          paint: { tone: "ink", percent: 86 },
        },
      ]);
    }
    expect(bandsGeometry(26, hot(), { centre: "none" }).centre.items).toEqual([]);
  });

  it("speaks for the deciding plan: its figure while small, its mark over its percent from level 2, its window and forecast at full size", () => {
    const small = bandsGeometry(40, hot());
    expect(small.centre.items).toEqual([
      expect.objectContaining({
        kind: "text",
        role: "figure",
        text: "82",
        paint: { tone: "attention" },
      }),
    ]);
    // 88 keeps the small middle (its hole is under 15); 120 has room for the mark
    expect(bandsGeometry(88, hot()).centre.items.map((item) => item.kind)).toEqual(["text"]);
    const middle = bandsGeometry(120, hot());
    expect(middle.centre.items.map((item) => item.kind)).toEqual(["mark", "text"]);
    expect(middle.centre.items[1]).toMatchObject({ role: "figure", text: "82", percent: true });
    // the full middle needs a hole of 46: 232 (the page's opened circle), not 212, whose hole draws the mark and percent
    expect(bandsGeometry(212, hot()).centre.items.map((item) => item.kind)).toEqual([
      "mark",
      "text",
    ]);
    const full = bandsGeometry(232, hot());
    expect(
      full.centre.items.map((item) =>
        item.kind === "text" ? [item.role, item.text] : [item.kind],
      ),
    ).toEqual([["mark"], ["figure", "82"], ["sub", "of 5 hours"], ["say", "out in ~35m"]]);
    expect(full.centre.items[3]).toMatchObject({ weight: 650, paint: { tone: "attention" } });
    // with nothing read yet, an ellipsis; with only a need, its act
    const waiting = bandsGeometry(232, meters([["kimi", { state: "unauthenticated" }]]));
    expect(
      waiting.centre.items.map((item) =>
        item.kind === "text" ? [item.role, item.text] : [item.kind],
      ),
    ).toEqual([["mark"], ["act", "Sign in"], ["sub", "Kimi Code"]]);
    expect(waiting.centre.items[0]).toMatchObject({ badge: { need: "sign-in" } });
  });

  it("dims every plan but the one pointed at, and the middle speaks for it", () => {
    const entries = meters([
      ["claude", [paced("5h", 20, 50)]],
      ["codex", [paced("5h", 64, 50)]],
    ]);
    const geometry = bandsGeometry(212, entries, { focus: "agent:claude:native-default" });
    expect(geometry.plans.map((plan) => plan.dim)).toEqual([false, true]);
    expect(arcsOf(planAt(geometry, 1), "inner", "track")[0]?.opacity).toBe(0.28);
    expect(planAt(geometry, 1).mark?.opacity).toBe(0.28);
    expect(geometry.centre.items[1]).toMatchObject({ role: "figure", text: "20" });
  });

  it("marks each plan outside its bands from level 2, a need's badge at full size, and a crowded agent's glyph", () => {
    const entries = meters([
      ["codex", [paced("5h", 82, 55)]],
      ["kimi", { state: "unauthenticated" }],
    ]);
    expect(planAt(bandsGeometry(40, entries), 0).mark).toBeUndefined();
    const geometry = bandsGeometry(212, entries);
    const plan = planAt(geometry, 0);
    const { rim } = radii(212);
    const spot = rim + 6.5 + 4.5 + 8;
    const angle = (plan.from + plan.span / 2) * DEG;
    expect(plan.mark).toMatchObject({ provider: "codex", size: 16, paint: { tone: "attention" } });
    expect(plan.mark?.x).toBeCloseTo(106 + spot * Math.cos(angle), 6);
    expect(plan.mark?.y).toBeCloseTo(106 + spot * Math.sin(angle), 6);
    expect(planAt(geometry, 1).mark).toMatchObject({
      paint: { tone: "ink", percent: 46 },
      badge: { need: "sign-in", r: Math.max(4.2, 16 * 0.3) },
    });
    // two plans of one agent wear the profile's glyph when the view asks (an All view)
    const twice = planMeters(
      {
        id: "work",
        kind: "managed",
        label: "Work",
        default: false,
        createdAt: "1970-01-01T00:00:00.000Z",
        personas: [
          { ...own("claude"), profileId: "claude-a", kind: "managed" },
          { ...own("claude"), profileId: "claude-b", kind: "managed" },
        ],
        plans: [],
      },
      [
        {
          provider: "claude",
          label: "claude",
          profileId: "claude-a",
          state: "available",
          metrics: [paced("5h", 10, 50)],
          fetchedAt: from(-1),
        },
        {
          provider: "claude",
          label: "claude",
          profileId: "claude-b",
          state: "available",
          metrics: [paced("5h", 20, 50)],
          fetchedAt: from(-1),
        },
      ],
      NOW,
    ).entries;
    expect(
      bandsGeometry(212, twice, { crowd: true }).plans.map((each) => each.mark?.glyph?.size),
    ).toEqual([16 * 0.64, 16 * 0.64]);
    expect(bandsGeometry(212, twice).plans.map((each) => each.mark?.glyph)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("puts the hot dot at -45° on a profile's circle while a plan runs hot by the pace rule", () => {
    const geometry = bandsGeometry(54, hot(), { centre: "glyph", hotDot: true });
    const r = 54 / 2 - 3;
    expect(geometry.hotDot?.x).toBeCloseTo(27 + r * Math.cos(-45 * DEG), 6);
    expect(geometry.hotDot?.y).toBeCloseTo(27 + r * Math.sin(-45 * DEG), 6);
    expect(geometry.hotDot).toMatchObject({ r: Math.max(3.6, 54 * 0.085), ring: 1.6 });
    // 85% of five hours with 90% gone is on pace: no dot, where Godview's flat 80% would have lit it
    const calm = meters([["claude", [paced("5h", 85, 90)]]]);
    expect(bandsGeometry(54, calm, { hotDot: true }).hotDot).toBeUndefined();
    expect(bandsGeometry(54, hot()).hotDot).toBeUndefined();
  });

  it("answers a pointer per plan when asked", () => {
    const entries = meters([["claude", [paced("5h", 20, 50)]]]);
    const { inner, rim, band, markZone } = radii(212);
    const plan = planAt(bandsGeometry(212, entries, { hit: true }), 0);
    expect(plan.hit?.r).toBeCloseTo((inner + rim + markZone) / 2, 6);
    expect(plan.hit?.width).toBeCloseTo(rim + markZone - inner + band + 8, 6);
    expect(plan.hit).toMatchObject({ from: -90, to: 270 });
    expect(planAt(bandsGeometry(212, entries), 0).hit).toBeUndefined();
  });

  it("with nothing that meters or needs you, one dashed ring says No meters", () => {
    const geometry = bandsGeometry(40, meters([["opencode", { state: "unsupported" }]]));
    expect(geometry.empty).toEqual({
      r: 17,
      width: 1.2,
      paint: { tone: "ink", percent: 14 },
      dash: [2, 3],
    });
    expect(geometry.plans).toEqual([]);
    expect(geometry.label).toBe("No meters");
    expect(bandsGeometry(40, []).empty?.r).toBe(17);
  });
});

describe("UM-1 — the circle in words", () => {
  it("says Usage: and every plan on the circle, its tightest window, its forecast or its reset", () => {
    const entries = meters([
      [
        "claude",
        [
          paced("5h", 30, 50),
          paced("7d", 50, 90, 10_080, { group: { id: "g", label: "Fable only" } }),
        ],
      ],
      ["codex", [paced("5h", 82, 55)]],
      ["grok", [budget(30)]],
      ["kimi", { state: "unauthenticated" }],
      ["antigravity", { state: "unavailable" }],
      ["opencode", { state: "unsupported" }],
    ]);
    expect(bandsLabel(entries)).toBe(
      [
        "Usage: Claude Code: 50% of 7 days · Fable, resets in 16h 48m",
        "Codex: 82% of 5 hours, out in ~35m",
        "Grok: 30% of credits",
        "Kimi Code: not signed in",
        "Antigravity: couldn’t read",
      ].join("; "),
    );
    expect(bandsGeometry(212, entries).label).toBe(bandsLabel(entries));
    expect(bandsGeometry(212, entries).plans.map((plan) => plan.words)).toEqual(
      bandsLabel(entries).slice("Usage: ".length).split("; "),
    );
  });

  it("says a reset past as 'resets now', a kept reading by its age, and a first read as reading", () => {
    const entries = meters([
      ["claude", [paced("5h", 30, 100.5)]],
      [
        "codex",
        { metrics: [paced("5h", 30, 50)], state: "unavailable", stale: true, fetchedAt: from(-32) },
      ],
    ]);
    expect(bandsLabel(entries)).toBe(
      "Usage: Claude Code: 30% of 5 hours, resets now; Codex: 30% of 5 hours, as of 32m ago",
    );
  });
});

describe("UM-1 — arcs as paths", () => {
  it("draws a sweep past a half turn as two halves, clockwise", () => {
    expect(arcPath(20, { r: 10, from: -90, to: 0 })).toBe("M20 10A10 10 0 0 1 30 20");
    expect(arcPath(20, { r: 10, from: -90, to: 180 })).toBe(
      "M20 10A10 10 0 0 1 20 30A10 10 0 0 1 10 20",
    );
  });

  it("leaves out an arc too short to see and stops a whole turn just short of closing", () => {
    const one = planAt(bandsGeometry(212, meters([["claude", [paced("7d", 0.2, 40, 10_080)]]])), 0);
    // 0.2% is under the drawing's 0.4: no fill
    expect(arcsOf(one, "outer").map((arc) => arc.part)).toEqual(["track"]);
    const whole = planAt(
      bandsGeometry(212, meters([["claude", [paced("7d", 100, 40, 10_080)]]])),
      0,
    );
    const fill = arcsOf(whole, "outer", "fill")[0];
    expect(fill?.from).toBe(-90);
    expect(fill?.to).toBeCloseTo(-90 + 359.9, 6);
    expect(arcsOf(whole, "outer", "track")[0]?.to).toBeCloseTo(-90 + 359.9, 6);
  });
});

describe("UM-1 — the phone's bands golden", () => {
  it("records the contracts' profiles at 26, 54, 206 and 212, at the last day of their week, mirrored for the phone", () => {
    const golden = phoneBandsGolden() as {
      "//"?: string;
      now?: string;
      sizes?: Array<{ size: number }>;
      meters?: Array<{
        set: string;
        entries: Array<{ key: string; kind: string; need?: string }>;
        tightest: string | null;
        hot: boolean;
      }>;
      circles?: Array<{
        set: string;
        size: number;
        level: number;
        label: string;
        plans: unknown[];
      }>;
      calls?: { forecast?: Array<{ out: { words: string } | null }> };
    };
    expect(golden.now).toBe(PHONE_BANDS_NOW);
    expect(golden.sizes?.map((entry) => entry.size)).toEqual([26, 54, 206, 212]);
    expect(PHONE_BANDS_SIZES.map((entry) => entry.size)).toEqual([26, 54, 206, 212]);
    expect(golden.meters?.map((profile) => profile.set)).toEqual(["native", "work"]);
    const [thisMac, work] = golden.meters ?? [];
    expect(thisMac).toMatchObject({ tightest: "plan:anthropic", hot: true });
    expect(thisMac?.entries.map((entry) => `${entry.key} ${entry.kind}`)).toEqual([
      "plan:anthropic reading",
    ]);
    // Work: its Codex signing in needs you; Hermes's plans meter nothing (no agent names two of them, and
    // the catalog meters no usage for Hermes)
    expect(work?.entries.map((entry) => `${entry.key} ${entry.kind}`)).toEqual([
      "agent:0b7e2c4d-9a1f-4e58-8c1d-3f2a6b9e7d10 needs-you",
      "plan:nous no-meter",
      "plan:anthropic no-meter",
      "plan:github no-meter",
    ]);
    expect(work).toMatchObject({ tightest: null, hot: false });
    expect(
      golden.circles?.map(
        (circle) => `${circle.set} ${circle.size} ${circle.level} ${circle.plans.length}`,
      ),
    ).toEqual([
      "native 26 0 1",
      "native 54 1 1",
      "native 206 3 1",
      "native 212 3 1",
      "work 26 0 1",
      "work 54 1 1",
      "work 206 3 1",
      "work 212 3 1",
    ]);
    expect(golden.circles?.[0]?.label).toBe("Usage: Claude Max: 103% of 7 days, resets in 12h");
    expect(golden.calls?.forecast?.map((entry) => entry.out?.words ?? null)).toEqual([
      "~5m",
      "~1m",
      "~35m",
      "~60m",
      "~1h 30m",
      "~19h 15m",
      "~3d",
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(golden["//"]).toMatch(/never over a defect/u);
    expect(PHONE_GOLDEN_MIRRORS[PHONE_BANDS_GOLDEN]).toEqual([PHONE_VIEW_MIRROR]);
  });
});
