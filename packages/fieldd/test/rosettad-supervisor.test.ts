// RosettadSupervisor rows (AR-0, slice S2 + the review fixes): the kill matrix
// for the index daemon, against a SCRIPTED rosettad that speaks the real
// readiness contract (test/fixtures/fake-rosettad.mjs) — so every row runs in
// the ordinary gate with no cargo build behind it — plus opt-in rows against
// the REAL binary when FIELDD_ROSETTAD_BIN names it (`pnpm siblings:build`;
// `pnpm siblings` prints the path). State SEQUENCES are the assertions, never
// wall-clock precision: this host runs loaded.
import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "@rosetta/protocol/protocol-version";
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
  KILL_WAIT_MS: 1_000,
  RESTART_BASE_MS: 20,
  RESTART_MAX_MS: 80,
  STABLE_AFTER_MS: 10_000,
  RESTART_MAX: 3,
  RESTART_WINDOW_MS: 5_000,
};

let sups: RosettadSupervisor[] = [];
let dirs: string[] = [];
let strays: ChildProcess[] = [];

afterEach(async () => {
  for (const s of sups) await s.stop();
  sups = [];
  for (const p of strays) {
    if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
  }
  strays = [];
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
  extra: Partial<ConstructorParameters<typeof RosettadSupervisor>[0]> & { root?: string } = {},
) {
  const { root: givenRoot, ...options } = extra;
  const root = givenRoot ?? tmp();
  const transitions: RosettadState[] = [];
  const sup = new RosettadSupervisor({
    bin: "/nonexistent/rosettad-stand-in",
    dbPath: join(root, "index", "rosetta.db"),
    announceDir: join(root, "index", "daemons"),
    expectedProtocolVersion: PROTOCOL_VERSION,
    spawnProcess: fakeSpawner(mode),
    timings: T,
    ...options,
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

/** A daemon NOT under any supervisor — the orphan a dead fieldd leaves behind.
 * Resolves once it has said ready (its announce file exists by then). */
async function orphan(
  bin: string,
  root: string,
  env: Record<string, string> = {},
): Promise<{ pid: number; origin: string; announce: string; proc: ChildProcess }> {
  const args = [
    "serve",
    "--db",
    join(root, "index", "rosetta.db"),
    "--addr",
    "127.0.0.1:0",
    "--json",
    "--announce",
    "--announce-dir",
    join(root, "index", "daemons"),
    "--home",
    join(root, "home"),
  ];
  mkdirSync(join(root, "index"), { recursive: true });
  const proc =
    bin === FAKE
      ? spawn(process.execPath, [FAKE, ...args], { env: { ...process.env, ...env } })
      : spawn(bin, args, { env: { ...process.env, ...env } });
  strays.push(proc);
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (c: string) => {
      err += c;
    });
    proc.on("exit", (code) => reject(new Error(`orphan exited ${code} before ready: ${err}`)));
    proc.stdout?.on("data", (chunk: string) => {
      out += chunk;
      const line = out.split("\n").find((l) => l.includes('"ready"'));
      if (line === undefined) return;
      const ready = JSON.parse(line) as { origin: string; announce: string };
      resolve({ pid: proc.pid as number, origin: ready.origin, announce: ready.announce, proc });
    });
  });
}

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
    // pid-named JSON under the announce dir — HERE fieldd's private one, never
    // rosetta's shared default — and the ready line names it
    expect(s.announce).toBe(join(root, "index", "daemons", `${pid}.json`));
    expect(existsSync(s.announce as string)).toBe(true);
    const announced = JSON.parse(readFileSync(s.announce as string, "utf8"));
    expect(announced.origin).toBe(origin);
    expect(announced.schema).toBe("rosetta-daemon/1");
    // the projection (FielddHealth.rosettad) is the phase — the origin and the
    // announce path are fieldd-internal (EL7: rosettad is unauthenticated)
    expect(sup.health()).toEqual({
      phase: "ready",
      detail: null,
      pid,
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(Object.keys(sup.health()).sort()).toEqual(["detail", "phase", "pid", "protocolVersion"]);

    await sup.stop();
    expect(sup.state().phase).toBe("stopped");
    expect(alive(pid)).toBe(false); // stop() resolved AFTER the real exit
    expect(readdirSync(join(root, "index", "daemons"))).toEqual([]); // SIGINT ran the guard
    expect(sup.state().origin).toBeNull();
  });

  it("a crash after ready restarts the daemon: a NEW pid, ready again, the interim state carries its last stderr", async () => {
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
    // the detail names the exit AND what the daemon said last — the lock error
    // or the panic is what a human needs, never a bare code
    expect(restarting?.detail).toMatch(/exited \(3\)/);
    expect(restarting?.detail).toMatch(/simulated crash after ready/);
    expect(alive(firstPid)).toBe(false);
    expect(sup.state().origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await sup.stop();
  });

  it("a bogus binary path is TERMINAL: failed, no child, no retry, and start() resolves null", async () => {
    const root = tmp();
    const sup = new RosettadSupervisor({
      bin: join(root, "does-not-exist", "rosettad"),
      dbPath: join(root, "index", "rosetta.db"),
      announceDir: join(root, "index", "daemons"),
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

  it("a crash before any output restarts (non-terminal) with its stderr in the detail, and stop() during the retry window is clean", async () => {
    const { sup, transitions } = rig("crash-on-start");
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "restarting", 2_000);
    expect(transitions.find((t) => t.phase === "restarting")?.detail).toMatch(
      /exited \(2\) — fake rosettad: refusing to start/,
    );
    await sup.stop();
    expect(sup.state().phase).toBe("stopped");
    await new Promise((r) => setTimeout(r, 150));
    expect(sup.state().phase).toBe("stopped"); // the pending retry was cancelled
  });

  it("requestRestart on a LIVE daemon bounces it — a new pid, ready again — without charging the intensity window", async () => {
    // RESTART_MAX 1: a single charged stamp inside the window means the NEXT
    // crash trips to "failed". A requested exit must not be that stamp.
    const { sup, transitions } = rig("ok", { timings: { ...T, RESTART_MAX: 1 } });
    await sup.start();
    const firstPid = sup.state().pid as number;
    const origin = await sup.requestRestart();
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(sup.state().phase).toBe("ready");
    const secondPid = sup.state().pid as number;
    expect(secondPid).not.toBe(firstPid);
    expect(alive(firstPid)).toBe(false);
    expect(
      transitions.some((t) => t.phase === "restarting" && t.detail === "restart requested"),
    ).toBe(true);
    // the witness: one genuine crash is still within the budget, so the daemon
    // comes back — had the request burnt a stamp, this would be "failed"
    process.kill(secondPid, "SIGKILL");
    await until(
      () => sup.state().phase === "ready" && sup.state().pid !== secondPid,
      4_000,
      "a third generation after one real crash",
    );
    expect(sup.state().phase).toBe("ready");
    await sup.stop();
  });

  it("an orphan rosettad over the same projection (a dead fieldd's child) is put down before the new generation starts", async () => {
    const root = tmp();
    const left = await orphan(FAKE, root, { FAKE_ROSETTAD_MODE: "ok" });
    expect(existsSync(left.announce)).toBe(true);
    expect(alive(left.pid)).toBe(true);
    // a status probe on the announced origin answers as rosettad — the
    // identity the orphan pass requires before it signals anything
    const status = await fetch(`${left.origin}/api/status`);
    expect(status.headers.get("x-rosetta-protocol-version")).toBe(String(PROTOCOL_VERSION));

    const { sup } = rig("ok", { root });
    const origin = await sup.start();
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(sup.state().pid).not.toBe(left.pid);
    expect(alive(left.pid)).toBe(false); // put down first
    expect(existsSync(left.announce)).toBe(false);
    // only the new generation's file remains
    expect(readdirSync(join(root, "index", "daemons"))).toEqual([`${sup.state().pid}.json`]);
    await sup.stop();
  });

  it("the orphan pass removes a stale file (dead pid) and leaves a live pid that does not answer as rosettad alone", async () => {
    const root = tmp();
    const dir = join(root, "index", "daemons");
    mkdirSync(dir, { recursive: true });
    // a pid that is certainly dead: a child that already exited
    const gone = spawn(process.execPath, ["-e", ""]);
    await new Promise<void>((resolve) => gone.on("exit", () => resolve()));
    const deadPid = gone.pid as number;
    const announce = (pid: number, origin: string) =>
      `${JSON.stringify({
        schema: "rosetta-daemon/1",
        origin,
        pid,
        protocol_version: PROTOCOL_VERSION,
        db: join(root, "index", "rosetta.db"),
        started_at: Date.now(),
      })}\n`;
    writeFileSync(join(dir, `${deadPid}.json`), announce(deadPid, "http://127.0.0.1:65000"));
    // OUR OWN pid is alive, but nothing rosetta-shaped answers on port 1 —
    // an unproven identity is never signalled (pid reuse is the risk)
    writeFileSync(join(dir, `${process.pid}.json`), announce(process.pid, "http://127.0.0.1:1"));
    writeFileSync(join(dir, "garbage.json"), "not json\n");
    writeFileSync(
      join(dir, "other-schema.json"),
      `${JSON.stringify({ schema: "rosetta-daemon/99" })}\n`,
    );

    const { sup } = rig("ok", { root, timings: { ...T, ORPHAN_PROBE_TIMEOUT_MS: 500 } });
    expect(await sup.start()).toMatch(/^http:/);
    const remaining = readdirSync(dir).sort();
    expect(remaining).toContain(`${process.pid}.json`); // left alone
    expect(remaining).toContain("other-schema.json"); // not ours to judge
    expect(remaining).not.toContain(`${deadPid}.json`); // stale, removed
    expect(remaining).not.toContain("garbage.json"); // never an announcement
    expect(remaining).toContain(`${sup.state().pid}.json`);
    await sup.stop();
  });

  it("the unconfigured projection is honest, frozen, and carries no origin field at all", () => {
    expect(ROSETTAD_UNCONFIGURED.phase).toBe("unconfigured");
    expect(ROSETTAD_UNCONFIGURED.detail).toContain("FIELDD_ROSETTAD_BIN");
    expect(Object.isFrozen(ROSETTAD_UNCONFIGURED)).toBe(true);
    expect(Object.keys(ROSETTAD_UNCONFIGURED).sort()).toEqual([
      "detail",
      "phase",
      "pid",
      "protocolVersion",
    ]);
  });
});

// The live rows: the REAL rosettad, opt-in. `pnpm siblings:build` then
// FIELDD_ROSETTAD_BIN=$(node scripts/siblings.mjs bin) \
//   pnpm --filter @vibefield/fieldd test -- rosettad-supervisor
const REAL_BIN = process.env["FIELDD_ROSETTAD_BIN"];
describe.skipIf(REAL_BIN === undefined || REAL_BIN === "" || !existsSync(REAL_BIN))(
  "RosettadSupervisor — the real rosettad (opt-in via FIELDD_ROSETTAD_BIN)",
  () => {
    it("serves a fresh projection: ready on a loopback port at the client's protocol, announce file in the private dir, clean SIGINT", async () => {
      const root = tmp();
      const sup = new RosettadSupervisor({
        bin: REAL_BIN as string,
        dbPath: join(root, "index", "rosetta.db"),
        announceDir: join(root, "index", "daemons"),
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
      expect(sup.state().announce).toBe(
        join(root, "index", "daemons", `${sup.state().pid as number}.json`),
      );
      expect(existsSync(sup.state().announce as string)).toBe(true);
      const pid = sup.state().pid as number;
      await sup.stop();
      expect(alive(pid)).toBe(false);
      expect(existsSync(join(root, "index", "daemons", `${pid}.json`))).toBe(false);
    });

    it("the projection lock is real (the control): a second rosettad over a live projection exits on it, naming the owner", async () => {
      const root = tmp();
      const first = await orphan(REAL_BIN as string, root);
      const second = spawn(
        REAL_BIN as string,
        [
          "serve",
          "--db",
          join(root, "index", "rosetta.db"),
          "--addr",
          "127.0.0.1:0",
          "--json",
          "--home",
          join(root, "home"),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      strays.push(second);
      let err = "";
      second.stderr?.setEncoding("utf8");
      second.stderr?.on("data", (c: string) => {
        err += c;
      });
      const code = await new Promise<number | null>((resolve) => second.on("exit", resolve));
      expect(code).not.toBe(0);
      expect(err).toMatch(/already owned by another/);
      first.proc.kill("SIGINT");
      await until(() => !alive(first.pid), 10_000, "the first daemon gone");
    });

    it("an orphan REAL rosettad holding the projection lock is put down, and the new generation becomes ready", async () => {
      const root = tmp();
      const left = await orphan(REAL_BIN as string, root);
      const sup = new RosettadSupervisor({
        bin: REAL_BIN as string,
        dbPath: join(root, "index", "rosetta.db"),
        announceDir: join(root, "index", "daemons"),
        home: join(root, "home"),
        expectedProtocolVersion: PROTOCOL_VERSION,
        timings: { STARTUP_TIMEOUT_MS: 30_000 },
      });
      sups.push(sup);
      const origin = await sup.start();
      expect(origin, sup.state().detail ?? "").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(alive(left.pid)).toBe(false);
      expect(existsSync(left.announce)).toBe(false);
      expect(sup.state().pid).not.toBe(left.pid);
      await sup.stop();
    });
  },
);
