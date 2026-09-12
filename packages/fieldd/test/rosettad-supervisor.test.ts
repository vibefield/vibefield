// RosettadSupervisor rows (AR-0, slice S2): the kill matrix for the index
// daemon, against a SCRIPTED rosettad that speaks the real readiness contract
// (test/fixtures/fake-rosettad.mjs) — so every row runs in the ordinary gate
// with no cargo build behind it — plus one opt-in row against the REAL binary
// when FIELDD_ROSETTAD_BIN names it (`pnpm siblings:build`; `pnpm siblings`
// prints the path). State SEQUENCES are the assertions, never wall-clock
// precision: this host runs loaded.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "@rosetta/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  ROSETTAD_UNCONFIGURED,
  type RosettadPhase,
  type RosettadState,
  RosettadSupervisor,
  type RosettadTimings,
} from "../src/rosettad-supervisor";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");

const T: Partial<RosettadTimings> = {
  STARTUP_TIMEOUT_MS: 1_500,
  SHUTDOWN_TIMEOUT_MS: 2_000,
  RESTART_BASE_MS: 20,
  RESTART_MAX_MS: 80,
  STABLE_AFTER_MS: 10_000,
  RESTART_MAX: 3,
  RESTART_WINDOW_MS: 5_000,
};

let sups: RosettadSupervisor[] = [];
let dirs: string[] = [];

afterEach(async () => {
  for (const s of sups) await s.stop();
  sups = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "vf-rosettad-"));
  dirs.push(d);
  return d;
}

/** The fake speaks through the spawn seam: `bin` stays the honest "what would
 * be spawned" string while the child is node running the script. */
function fakeSpawner(mode: string, extraEnv: Record<string, string> = {}): typeof spawn {
  return ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE, ...args], {
      ...options,
      env: { ...process.env, FAKE_ROSETTAD_MODE: mode, ...extraEnv },
    })) as unknown as typeof spawn;
}

function rig(
  mode: string,
  extra: Partial<ConstructorParameters<typeof RosettadSupervisor>[0]> = {},
) {
  const root = tmp();
  const transitions: RosettadState[] = [];
  const sup = new RosettadSupervisor({
    bin: "/nonexistent/rosettad-stand-in",
    dbPath: join(root, "index", "rosetta.db"),
    announceDir: join(root, "daemons"),
    expectedProtocolVersion: PROTOCOL_VERSION,
    spawnProcess: fakeSpawner(mode),
    timings: T,
    ...extra,
  });
  sup.on("transition", (s: RosettadState) => transitions.push(s));
  sups.push(sup);
  return { sup, root, transitions, phases: () => transitions.map((s) => s.phase) };
}

const until = async (cond: () => boolean, ms = 4_000, what = "condition"): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`until(${what}): never held within ${ms}ms`);
    await new Promise((r) => setTimeout(r, 15));
  }
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("RosettadSupervisor — the index daemon's kill matrix (AR-0 S2)", () => {
  it("ready → announce file present → stop() SIGINTs, awaits the exit, the file is gone", async () => {
    const { sup, root } = rig("ok");
    const origin = await sup.start();
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const s = sup.state();
    expect(s.phase).toBe("ready");
    expect(s.origin).toBe(origin);
    expect(s.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(s.pid).not.toBeNull();
    const pid = s.pid as number;
    // the announce file is rosetta's contract with sibling apps (RFC 007): a
    // pid-named JSON under the announce dir, and the ready line names it
    expect(s.announce).toBe(join(root, "daemons", `${pid}.json`));
    expect(existsSync(s.announce as string)).toBe(true);
    const announced = JSON.parse(readFileSync(s.announce as string, "utf8"));
    expect(announced.origin).toBe(origin);
    expect(announced.schema).toBe("rosetta-daemon/1");

    await sup.stop();
    expect(sup.state().phase).toBe("stopped");
    expect(alive(pid)).toBe(false); // stop() resolved AFTER the real exit
    expect(readdirSync(join(root, "daemons"))).toEqual([]); // SIGINT ran the guard
    expect(sup.state().origin).toBeNull();
  });

  it("a crash after ready restarts the daemon: a NEW pid, ready again, honest interim state", async () => {
    const { sup, transitions, phases } = rig("crash-after-ready");
    const first = await sup.start();
    expect(first).not.toBeNull();
    const firstPid = sup.state().pid as number;
    // the fake exits 3 shortly after ready; the supervisor must notice, say so,
    // and bring a fresh generation up — never two children at once
    await until(
      () => sup.state().phase === "ready" && sup.state().pid !== firstPid,
      4_000,
      "a second ready generation",
    );
    expect(phases()).toContain("restarting");
    const restarting = transitions.find((t) => t.phase === "restarting");
    expect(restarting?.detail).toMatch(/exited/);
    expect(alive(firstPid)).toBe(false);
    expect(sup.state().origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await sup.stop();
  });

  it("a bogus binary path is TERMINAL: failed, no child, no retry, and start() resolves null", async () => {
    const root = tmp();
    const sup = new RosettadSupervisor({
      bin: join(root, "does-not-exist", "rosettad"),
      dbPath: join(root, "index", "rosetta.db"),
      expectedProtocolVersion: PROTOCOL_VERSION,
      timings: T,
    });
    sups.push(sup);
    const phases: RosettadPhase[] = [];
    sup.on("transition", (s: RosettadState) => phases.push(s.phase));
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "failed", 2_000, "failed");
    const s = sup.state();
    expect(s.detail).toMatch(/ENOENT/);
    expect(s.detail).toContain("does-not-exist");
    expect(s.pid).toBeNull();
    // the control: an honest terminal state STAYS — nothing schedules a retry
    await new Promise((r) => setTimeout(r, 250));
    expect(sup.state().phase).toBe("failed");
    expect(phases.filter((p) => p === "restarting")).toEqual([]);
  });

  it("a protocol mismatch is TERMINAL and the wrong daemon is put down", async () => {
    const { sup } = rig("wrong-protocol");
    expect(await sup.start()).toBeNull();
    const s = sup.state();
    expect(s.phase).toBe("failed");
    expect(s.detail).toMatch(/protocol 1 .* expects \d+/);
    const pid = s.pid;
    await until(() => sup.state().pid === null, 3_000, "the mismatched child reaped");
    if (pid !== null) expect(alive(pid)).toBe(false);
    expect(sup.state().phase).toBe("failed"); // still terminal after the reap
  });

  it("a non-loopback origin is refused as terminal (the daemon must never be reachable off-host)", async () => {
    const { sup } = rig("bad-origin");
    expect(await sup.start()).toBeNull();
    expect(sup.state().phase).toBe("failed");
    expect(sup.state().detail).toMatch(/non-loopback/);
  });

  it("a daemon that never says ready is restarted with backoff, then bounded: failed + requestRestart", async () => {
    const { sup, phases } = rig("silent", {
      timings: { ...T, STARTUP_TIMEOUT_MS: 120, RESTART_MAX: 2, RESTART_WINDOW_MS: 10_000 },
    });
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "failed", 6_000, "intensity trip");
    expect(sup.state().detail).toMatch(/restart intensity exceeded/);
    // exactly RESTART_MAX retries were scheduled before the machine gave up
    expect(phases().filter((p) => p === "restarting").length).toBeGreaterThanOrEqual(2);
    // the affordance: a human says try again → the window resets, one launch runs
    const again = sup.requestRestart();
    await until(
      () => sup.state().phase === "starting" || sup.state().phase === "restarting",
      1_000,
    );
    expect(await again).toBeNull(); // the fake is still silent — but it TRIED
    await sup.stop();
  });

  it("a crash before any output restarts (non-terminal) and stop() during the retry window is clean", async () => {
    const { sup } = rig("crash-on-start");
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "restarting", 2_000);
    await sup.stop();
    expect(sup.state().phase).toBe("stopped");
    await new Promise((r) => setTimeout(r, 150));
    expect(sup.state().phase).toBe("stopped"); // the pending retry was cancelled
  });

  it("the unconfigured projection is honest and frozen", () => {
    expect(ROSETTAD_UNCONFIGURED.phase).toBe("unconfigured");
    expect(ROSETTAD_UNCONFIGURED.detail).toContain("FIELDD_ROSETTAD_BIN");
    expect(Object.isFrozen(ROSETTAD_UNCONFIGURED)).toBe(true);
  });
});

// The live row: the REAL rosettad, opt-in. `pnpm siblings:build` then
// FIELDD_ROSETTAD_BIN=$(node scripts/siblings.mjs bin) \
//   pnpm --filter @vibefield/fieldd test -- rosettad-supervisor
const REAL_BIN = process.env["FIELDD_ROSETTAD_BIN"];
describe.skipIf(REAL_BIN === undefined || !existsSync(REAL_BIN))(
  "RosettadSupervisor — the real rosettad (opt-in via FIELDD_ROSETTAD_BIN)",
  () => {
    it("serves a fresh projection: ready on a loopback port at the client's protocol, announce file, clean SIGINT", async () => {
      const root = tmp();
      const sup = new RosettadSupervisor({
        bin: REAL_BIN as string,
        dbPath: join(root, "index", "rosetta.db"),
        announceDir: join(root, "daemons"),
        // an EMPTY home: the daemon discovers no runtimes and serves a bare
        // projection — the row proves the seam, not the indexing
        home: join(root, "home"),
        expectedProtocolVersion: PROTOCOL_VERSION,
        timings: { STARTUP_TIMEOUT_MS: 30_000 },
      });
      sups.push(sup);
      const origin = await sup.start();
      expect(origin, sup.state().detail ?? "").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const status = await fetch(`${origin}/api/status`);
      expect(status.headers.get("x-rosetta-protocol-version")).toBe(String(PROTOCOL_VERSION));
      expect(sup.state().announce).not.toBeNull();
      expect(existsSync(sup.state().announce as string)).toBe(true);
      const pid = sup.state().pid as number;
      await sup.stop();
      expect(alive(pid)).toBe(false);
      expect(existsSync(join(root, "daemons", `${pid}.json`))).toBe(false);
    });
  },
);
