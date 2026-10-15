import { describe, expect, it } from "vitest";
import {
  type CensusCount,
  compareDotted,
  compareSemver,
  type DecideContext,
  type DecideState,
  decideUpdate,
  type PolicyLevers,
} from "../../src/main/updates/decide";

// WP12b (EDP §11.1, D14) — the ONE decision as a truth table: every row names its trigger, state, census and the
// action. Tray, Settings and the quit flow render this output and decide nothing themselves.

const base: DecideContext = {
  trigger: "manual",
  enabled: true,
  lastCheckAt: null,
  now: 10_000_000,
  staleMs: 1_000_000,
  declined: [],
  applyWired: false,
};

const rows: ReadonlyArray<
  readonly [
    string,
    DecideState,
    CensusCount,
    Partial<DecideContext>,
    ReturnType<typeof decideUpdate>,
  ]
> = [
  ["a launch checks", { kind: "idle" }, 0, { trigger: "launch" }, { kind: "check" }],
  ["a manual check checks", { kind: "idle" }, 0, { trigger: "manual" }, { kind: "check" }],
  [
    "single-flight: checking",
    { kind: "checking" },
    0,
    { trigger: "manual" },
    { kind: "none", reason: "in-flight" },
  ],
  [
    "single-flight: downloading",
    { kind: "downloading", version: "1.0.0" },
    0,
    { trigger: "launch" },
    { kind: "none", reason: "in-flight" },
  ],
  [
    "off: no automatic check",
    { kind: "idle" },
    0,
    { trigger: "launch", enabled: false },
    { kind: "none", reason: "disabled" },
  ],
  [
    "off: no resume check",
    { kind: "idle" },
    0,
    { trigger: "resume", enabled: false },
    { kind: "none", reason: "disabled" },
  ],
  [
    "off: a person's check still runs",
    { kind: "idle" },
    0,
    { trigger: "manual", enabled: false },
    { kind: "check" },
  ],
  [
    "a resume checks when never checked",
    { kind: "idle" },
    0,
    { trigger: "resume" },
    { kind: "check" },
  ],
  [
    "a resume skips a fresh check",
    { kind: "idle" },
    0,
    { trigger: "resume", lastCheckAt: 9_500_000 },
    { kind: "none", reason: "fresh" },
  ],
  [
    "a resume checks a stale one",
    { kind: "idle" },
    0,
    { trigger: "resume", lastCheckAt: 1 },
    { kind: "check" },
  ],
  [
    "available downloads",
    { kind: "available", version: "1.0.0" },
    0,
    { trigger: "available" },
    { kind: "download", version: "1.0.0" },
  ],
  [
    "available but declined",
    { kind: "available", version: "1.0.0" },
    0,
    { trigger: "available", declined: ["1.0.0"] },
    { kind: "none", reason: "declined" },
  ],
  [
    "available but off",
    { kind: "available", version: "1.0.0" },
    0,
    { trigger: "available", enabled: false },
    { kind: "none", reason: "disabled" },
  ],
  [
    "staged with live sessions is held (EDP-35)",
    { kind: "staged", version: "1.0.0" },
    2,
    { trigger: "downloaded", applyWired: true },
    { kind: "hold", version: "1.0.0", reason: "sessions" },
  ],
  [
    "staged before WP12c's gate is held",
    { kind: "staged", version: "1.0.0" },
    0,
    { trigger: "downloaded" },
    { kind: "hold", version: "1.0.0", reason: "apply-unbuilt" },
  ],
  [
    "staged with the gate and no sessions is offered",
    { kind: "staged", version: "1.0.0" },
    0,
    { trigger: "downloaded", applyWired: true },
    { kind: "offer-restart", version: "1.0.0" },
  ],
  [
    "staged with an UNKNOWN census is held — never read as zero (§10 S1)",
    { kind: "staged", version: "1.0.0" },
    "unknown",
    { trigger: "downloaded", applyWired: true },
    { kind: "hold", version: "1.0.0", reason: "census-unknown" },
  ],
  [
    "an unknown census holds even where the gate is unbuilt",
    { kind: "staged", version: "1.0.0" },
    "unknown",
    { trigger: "downloaded" },
    { kind: "hold", version: "1.0.0", reason: "census-unknown" },
  ],
  [
    "a declined staged version is never offered",
    { kind: "staged", version: "1.0.0" },
    0,
    { trigger: "downloaded", applyWired: true, declined: ["1.0.0"] },
    { kind: "none", reason: "declined" },
  ],
];

describe("decideUpdate — the truth table", () => {
  it.each(rows)("%s", (_name, state, census, context, expected) => {
    expect(decideUpdate(state, census, { ...base, ...context })).toEqual(expected);
  });

  it("never offers a restart while sessions live, whatever else holds", () => {
    for (const applyWired of [true, false]) {
      for (const census of [1, "unknown"] as const) {
        const action = decideUpdate({ kind: "staged", version: "1.0.0" }, census, {
          ...base,
          trigger: "downloaded",
          applyWired,
        });
        expect(action.kind).not.toBe("offer-restart");
      }
      const action = decideUpdate({ kind: "staged", version: "1.0.0" }, 1, {
        ...base,
        trigger: "downloaded",
        applyWired,
      });
      expect(action.kind).not.toBe("offer-restart");
    }
  });
});

// WP12d (L3b-i, build-wp12-updater.md §12 B1/B3; the PM's ruling 2026-10-15 16:03Z) — the policy's levers at the ONE
// decision site, and the census gating only a release that touches the floor.
describe("the levers (B1) and the native plane (B3)", () => {
  const V = "0.9.0-nightly.20261016";
  const open: PolicyLevers = {
    killSwitch: false,
    yanked: [],
    floors: {},
    requireUserConfirmation: false,
  };
  const available: DecideState = { kind: "available", version: V };
  const staged: DecideState = { kind: "staged", version: V };
  const at = (
    trigger: DecideContext["trigger"],
    extra: Partial<DecideContext>,
    state: DecideState,
    census: CensusCount = 0,
  ) => decideUpdate(state, census, { ...base, applyWired: true, trigger, ...extra });

  it("a found release: the kill switch, a yank and an unmet floor each refuse the download, named", () => {
    expect(at("available", { policy: { ...open, killSwitch: true } }, available)).toEqual({
      kind: "none",
      reason: "killed",
    });
    expect(at("available", { policy: { ...open, yanked: [V] } }, available)).toEqual({
      kind: "none",
      reason: "yanked",
    });
    const floored = { ...open, floors: { os: "15.0" } };
    expect(at("available", { policy: floored, hostOs: "14.6.1" }, available)).toEqual({
      kind: "none",
      reason: "floor-unmet",
    });
    // an unreadable host version reads as below a declared floor (fail closed)
    expect(at("available", { policy: floored, hostOs: null }, available)).toMatchObject({
      reason: "floor-unmet",
    });
    expect(at("available", { policy: floored, hostOs: "15.1.0" }, available)).toEqual({
      kind: "download",
      version: V,
    });
    // no verified policy yet: no lever can bite
    expect(at("available", { policy: null }, available)).toEqual({ kind: "download", version: V });
  });

  it("a staged release any lever refuses is discarded — a kill too, since B6 deletes the payload (L3b-ii)", () => {
    expect(at("downloaded", { policy: { ...open, killSwitch: true } }, staged)).toEqual({
      kind: "discard",
      version: V,
      reason: "killed",
    });
    expect(at("downloaded", { policy: { ...open, yanked: [V] } }, staged)).toEqual({
      kind: "discard",
      version: V,
      reason: "yanked",
    });
    expect(
      at("downloaded", { policy: { ...open, floors: { os: "99" } }, hostOs: "15.1" }, staged),
    ).toEqual({ kind: "discard", version: V, reason: "floor-unmet" });
    // a lever outranks the census: a killed release is discarded, never held as "sessions"
    expect(at("downloaded", { policy: { ...open, killSwitch: true } }, staged, 3)).toMatchObject({
      kind: "discard",
      reason: "killed",
    });
  });

  it("the census gates only a release that touches the floor", () => {
    expect(at("downloaded", { policy: open }, staged, 2)).toEqual({
      kind: "hold",
      version: V,
      reason: "sessions",
    });
    expect(at("downloaded", { policy: open, nativeTouched: false }, staged, 2)).toEqual({
      kind: "offer-restart",
      version: V,
    });
    expect(at("downloaded", { policy: open, nativeTouched: false }, staged, "unknown")).toEqual({
      kind: "offer-restart",
      version: V,
    });
    // absent = touched (the fail-safe)
    expect(at("downloaded", { policy: open }, staged, "unknown")).toMatchObject({
      reason: "census-unknown",
    });
  });

  it("compares dotted and semver versions, failing closed on a part that is not a number", () => {
    expect(compareDotted("15.1.0", "15.0")).toBeGreaterThan(0);
    expect(compareDotted("14.6.1", "15")).toBeLessThan(0);
    expect(compareDotted("15", "15.0.0")).toBe(0);
    expect(compareDotted("15.x", "15")).toBeNaN();
    expect(compareSemver("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0-beta.2", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0-beta.10", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-nightly.20261016", "1.0.0-nightly.20261015")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
  });
});
