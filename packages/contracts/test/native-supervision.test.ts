import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HelloAck, RpcRequest } from "../src/envelope";
import { ErrorData, UnavailableDetails } from "../src/errors";
import { METHODS, MGMT_NOTIFICATIONS, NativeTickNotification } from "../src/methods";
import {
  NATIVE_REFUSALS,
  NATIVE_SUPERVISION,
  NativeDeadlinePassedDetails,
  NativeLinkHealth,
  NativeLinkState,
  NativeTickParams,
  NativeUnavailableDetails,
  PingAck,
  SystemNativeRestartParams,
  SystemNativeRestartResult,
} from "../src/mgmt";
import { CELL_SUPERVISION, NATIVE_FLOOR_TICK } from "../src/registries";

// WG-D0…WG-D6 (`draft/thinking-floor-wedge.md`, ruled 2026-10-19) — the wedge
// ladder's contract. Detection stays a reversible state; the kill clock is
// silence of REPLIES; a redial comes before anything irreversible; past the
// bound the census decides, and live sessions end only by the person's consent
// or, headless, when the floor is stalled whole. These rows pin the numbers and
// the shapes both daemons build that ladder from; fixtures.test.ts parses every
// fixture by its prefix, and fixture_parity.rs reads the floor's half in Rust.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

describe("NATIVE_SUPERVISION — the ladder's bounds (WG-D1; WG-D2's first values)", () => {
  const t = NATIVE_SUPERVISION;

  it("keeps detection where it was: a state after two misses at 100/100/50 ms, a request at 10 s", () => {
    expect(t.HEARTBEAT_INTERVAL_MS).toBe(100);
    expect(t.HEARTBEAT_DEADLINE_MS).toBe(100);
    expect(t.HEARTBEAT_PROBE_DEADLINE_MS).toBe(50);
    expect(t.HEARTBEAT_MISS_THRESHOLD).toBe(2);
    expect(t.REQUEST_DEADLINE_MS).toBe(10_000);
  });

  it("pins WG-D2's first values: a re-ruling moves them here, with a dated note at source", () => {
    expect(t.WEDGE_REDIAL_MS).toBe(10_000);
    expect(t.WEDGE_CONFIRM_MS).toBe(60_000);
    expect(t.WEDGE_HEADLESS_MS).toBe(600_000);
    expect(t.WEDGE_RESTART_MAX).toBe(3);
    expect(t.WEDGE_RESTART_WINDOW_MS).toBe(600_000);
  });

  it("orders the rungs: the redial once the oldest request has timed out, the bound, then headless", () => {
    expect(t.WEDGE_REDIAL_MS).toBeGreaterThanOrEqual(t.REQUEST_DEADLINE_MS);
    expect(t.WEDGE_CONFIRM_MS).toBeGreaterThan(t.WEDGE_REDIAL_MS);
    expect(t.WEDGE_HEADLESS_MS).toBeGreaterThan(t.WEDGE_CONFIRM_MS);
  });

  it("gives wedge restarts an intensity bound that can trip, which the crash path's never could", () => {
    // a wedge restart needs WEDGE_CONFIRM_MS of silence first, so the crash
    // budget's window never holds two of them…
    expect(t.RESPAWN_WINDOW_MS).toBeLessThanOrEqual(t.WEDGE_CONFIRM_MS);
    // …while WEDGE_RESTART_MAX of them fit inside the wedge window, so a floor
    // that wedges on every boot reaches `gone` instead of dying once a minute
    const fastest = t.WEDGE_RESTART_MAX * t.WEDGE_CONFIRM_MS;
    expect(fastest).toBeLessThanOrEqual(t.WEDGE_RESTART_WINDOW_MS);
  });

  it("waits out the floor's own drain before any SIGKILL", () => {
    // field-native's terminal stop path collects its cells' drain reports for
    // DRAIN_BUDGET_MS + EXIT_GRACE_MS + 1 s, then exits
    const collects = CELL_SUPERVISION.DRAIN_BUDGET_MS + CELL_SUPERVISION.EXIT_GRACE_MS + 1_000;
    expect(t.KILL_DRAIN_WAIT_MS).toBe(collects + 1_000);
    // the old rung was 2 s: it cut the agent cell's drain at 02:24:56Z
    expect(t.KILL_DRAIN_WAIT_MS).toBeGreaterThan(2_000);
  });

  it("counts a held floor again many times before its headless deadline", () => {
    // the recount is what lets sessions that end on a held floor reach the
    // empty-floor restart, and what keeps the health block's count current
    expect(t.WEDGE_RECOUNT_MS).toBeGreaterThan(0);
    expect(t.WEDGE_RECOUNT_MS).toBeLessThan(t.WEDGE_HEADLESS_MS - t.WEDGE_CONFIRM_MS);
  });

  it("reads a tick three of the floor's intervals old as no tick", () => {
    expect(NATIVE_FLOOR_TICK.INTERVAL_MS).toBe(1_000);
    expect(t.TICK_STALE_MS).toBe(3 * NATIVE_FLOOR_TICK.INTERVAL_MS);
    expect(t.TICK_STALE_MS).toBeLessThan(t.WEDGE_CONFIRM_MS);
  });
});

describe("the floor's tick (WG-D6)", () => {
  it("is a notification the floor sends, never a method fieldd calls", () => {
    expect(MGMT_NOTIFICATIONS.TICK).toBe("native.lifecycle.tick");
    expect(METHODS.some((m) => m.method === MGMT_NOTIFICATIONS.TICK)).toBe(false);
    const frame = NativeTickNotification.parse(fixture("native-tick.valid.json"));
    expect(frame.method).toBe(MGMT_NOTIFICATIONS.TICK);
    expect("id" in frame).toBe(false);
  });

  it("carries the boot, the floor's clock and a count, all integers", () => {
    const tick = { bootId: "b1c2d3e4", ts: 1_792_376_697_001, seq: 0 };
    expect(NativeTickParams.parse(tick)).toEqual(tick);
    expect(NativeTickParams.safeParse({ ...tick, seq: -1 }).success).toBe(false);
    expect(NativeTickParams.safeParse({ ...tick, seq: 0.5 }).success).toBe(false);
    expect(NativeTickParams.safeParse({ ...tick, ts: 1.5 }).success).toBe(false);
    expect(NativeTickParams.safeParse({ bootId: "b1c2d3e4", ts: 1 }).success).toBe(false);
  });
});

describe("the pong, the pid and the deadline (WG-E2, WG-D6)", () => {
  it("keeps the floor's clock on the pong, so a late one can be attributed", () => {
    const ack = PingAck.parse(fixture("ping-ack.valid.json"));
    expect(Number.isSafeInteger(ack.ts)).toBe(true);
  });

  it("lets the hello ack state the floor's pid, and keeps its absence an absence", () => {
    const floor = {
      contractsVersion: "0.1.0",
      serverKind: "field-native" as const,
      grantedScopes: [],
    };
    expect(HelloAck.parse(fixture("hello-ack.pid.json")).pid).toBe(25821);
    expect(HelloAck.parse(floor).pid).toBeUndefined();
    for (const pid of [0, -1, 1.5, "25821"])
      expect(HelloAck.safeParse({ ...floor, pid }).success, String(pid)).toBe(false);
  });

  it("lets a request carry the instant fieldd gives up on it, and runs one without as ever", () => {
    const carried = RpcRequest.parse(fixture("rpc-request.deadline.json"));
    expect(carried.deadlineAt).toBe(1_792_376_706_980);
    expect(RpcRequest.parse(fixture("rpc-request.valid.json")).deadlineAt).toBeUndefined();
    const bare = { jsonrpc: "2.0", id: 1, method: "native.mesh.serve.list" };
    expect(RpcRequest.safeParse({ ...bare, deadlineAt: 1.5 }).success).toBe(false);
    expect(RpcRequest.safeParse({ ...bare, deadlineAt: -1 }).success).toBe(false);
  });

  it("declares the heartbeat beside the hello on the mgmt surface", () => {
    const mgmt = METHODS.filter((m) => m.surface === "mgmt").map((m) => m.method);
    expect(mgmt).toContain("native.lifecycle.hello");
    expect(mgmt).toContain("native.lifecycle.ping");
  });

  it("pins the floor's TIMEOUT for a request past its deadline in the registry's words", () => {
    const refusal = ErrorData.parse(fixture("error-data.native-deadline-passed.json"));
    expect(refusal).toMatchObject({ kind: "TIMEOUT", retryable: true });
    const details = NativeDeadlinePassedDetails.parse(refusal.details);
    expect(details.service).toBe(NATIVE_REFUSALS.SERVICE);
    expect(details.reason).toBe(NATIVE_REFUSALS.REASON_DEADLINE_PASSED);
    expect(details.at).toBeGreaterThan(details.deadlineAt);
  });
});

describe("NativeLinkHealth — the native link's numbers (WG-D1)", () => {
  const files = readdirSync(FIXTURES).filter((f) => f.startsWith("native-link-health."));

  it("has a fixture for every state the link can be in", () => {
    const states = files.map((f) => NativeLinkHealth.parse(fixture(f)).state);
    expect(new Set(states)).toEqual(new Set(NativeLinkState.options));
  });

  it("states every number, and says unknown as null, never as 0 or by leaving it out", () => {
    const up = NativeLinkHealth.parse(fixture("native-link-health.up.json"));
    const nullable = [
      "pid",
      "lastReplyAgeMs",
      "lastTickAgeMs",
      "loopLagMs",
      "sessionsAtRisk",
      "headlessAt",
    ] as const;
    for (const key of nullable) {
      expect(NativeLinkHealth.safeParse({ ...up, [key]: null }).success, key).toBe(true);
      const without = Object.fromEntries(Object.entries(up).filter(([name]) => name !== key));
      expect(NativeLinkHealth.safeParse(without).success, key).toBe(false);
    }
    expect(NativeLinkHealth.safeParse({ ...up, sessionsAtRisk: -1 }).success).toBe(false);
    expect(NativeLinkHealth.safeParse({ ...up, pid: 0 }).success).toBe(false);
  });

  it("offers the person's restart past the bound, and arms the headless clause only with nobody to ask", () => {
    const offered = NativeLinkHealth.parse(fixture("native-link-health.unresponsive.json"));
    expect(offered.restartOffered).toBe(true);
    expect(offered.sessionsAtRisk).toBeGreaterThan(0);
    expect(offered.lastReplyAgeMs).toBeGreaterThanOrEqual(NATIVE_SUPERVISION.WEDGE_CONFIRM_MS);
    expect(offered.headlessAt).toBeNull();

    const headless = NativeLinkHealth.parse(fixture("native-link-health.headless.json"));
    expect(headless.restartOffered).toBe(false);
    expect(headless.lastTickAgeMs).toBeGreaterThan(NATIVE_SUPERVISION.TICK_STALE_MS);
    // the clause counts from when replies AND the tick had both gone silent.
    // Here the tick outlived the link's detection (a reader wedge that became a
    // floor stalled whole), so it proceeds later than WEDGE_HEADLESS_MS after
    // `since`, never on the last reply's clock alone
    expect(headless.headlessAt).not.toBeNull();
    expect(headless.lastTickAgeMs ?? 0).toBeLessThan(headless.lastReplyAgeMs ?? 0);
    const proceedsAfter = (headless.headlessAt ?? 0) - headless.since;
    expect(proceedsAfter).toBeGreaterThan(NATIVE_SUPERVISION.WEDGE_HEADLESS_MS);
  });
});

describe("system.native.restart — the person's consented restart (WG-D5)", () => {
  it("names the sessions it ends; an empty floor names none, and no list is no consent", () => {
    const named = SystemNativeRestartParams.parse(
      fixture("system-native-restart-params.valid.json"),
    );
    expect(named.sessions).toHaveLength(3);
    const zero = SystemNativeRestartParams.parse(
      fixture("system-native-restart-params.census-zero.json"),
    );
    expect(zero.sessions).toEqual([]);
    expect(SystemNativeRestartParams.safeParse({}).success).toBe(false);
    expect(SystemNativeRestartParams.safeParse({ sessions: [""] }).success).toBe(false);
  });

  it("answers the link's state in the supervisor's words", () => {
    const answer = SystemNativeRestartResult.parse(
      fixture("system-native-restart-result.valid.json"),
    );
    expect(NativeLinkState.options).toContain(answer.state);
    const notAState = SystemNativeRestartResult.safeParse({ state: "rebooting", detail: "" });
    expect(notAState.success).toBe(false);
  });
});

describe("the doors' answers while the floor is unresponsive (WG-D4)", () => {
  it("a door on the floor's mgmt path says native, unresponsive, retryable", () => {
    const refusal = ErrorData.parse(fixture("error-data.native-unresponsive.json"));
    expect(refusal).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    const details = NativeUnavailableDetails.parse(refusal.details);
    expect(details.service).toBe(NATIVE_REFUSALS.SERVICE);
    expect(details.state).toBe(NATIVE_REFUSALS.STATE_UNRESPONSIVE);
  });

  it("a cell that did not answer stays the terminal's, a different fact", () => {
    const refusal = ErrorData.parse(fixture("error-data.terminal-unresponsive.json"));
    expect(UnavailableDetails.parse(refusal.details)).toMatchObject({
      service: "terminal",
      state: "unresponsive",
    });
    expect(NativeUnavailableDetails.safeParse(refusal.details).success).toBe(false);
  });
});
