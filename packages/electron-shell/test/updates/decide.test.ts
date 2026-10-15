import { describe, expect, it } from "vitest";
import { type DecideContext, type DecideState, decideUpdate } from "../../src/main/updates/decide";

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
  readonly [string, DecideState, number, Partial<DecideContext>, ReturnType<typeof decideUpdate>]
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
      const action = decideUpdate({ kind: "staged", version: "1.0.0" }, 1, {
        ...base,
        trigger: "downloaded",
        applyWired,
      });
      expect(action.kind).not.toBe("offer-restart");
    }
  });
});
