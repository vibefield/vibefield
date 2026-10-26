// RosettadSupervisor rows (AR-0, slice S2 + the review fixes): the kill matrix
// for the index daemon, against a SCRIPTED rosettad that speaks the real
// readiness contract (test/fixtures/fake-rosettad.mjs) — so every row runs in
// the ordinary gate with no cargo build behind it — plus opt-in rows against
// the REAL binary when FIELDD_ROSETTAD_BIN names it (`pnpm siblings:build`;
// `pnpm siblings` prints the path). State SEQUENCES are the assertions, never
// wall-clock precision: this host runs loaded.
import { type ChildProcess, spawn } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYOUT } from "@vibefield/contracts";
import { PROTOCOL_VERSION } from "@vibefield/rosetta-protocol/protocol-version";
import { afterEach, describe, expect, it } from "vitest";
import {
  ROSETTAD_UNCONFIGURED,
  type RosettadPhase,
  type RosettadState,
  RosettadSupervisor,
  type RosettadTimings,
  rosettadAllowOrigins,
  rosettadUnconfigured,
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

/** AR-8b — where a root's per-start credential files go (LAYOUT's segments,
 * spelled from the registry like daemon.ts spells them) */
function authFiles(root: string): { tokenFile: string; grantKeyFile: string } {
  return {
    tokenFile: join(root, ...LAYOUT.INDEX_TOKEN_FILE),
    grantKeyFile: join(root, ...LAYOUT.INDEX_GRANT_KEY_FILE),
  };
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
    ...authFiles(root),
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
  extraArgs: readonly string[] = [],
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
    ...extraArgs,
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
      ...authFiles(root),
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

  // Item 65 — the exit is composed when stderr has ENDED. Node fires 'exit' before the child's stdio drains, so on a
  // loaded host the last words (a refusal, the wrong binary's flag error, rosetta's schema mismatch) could land after
  // the detail was written and the retry scheduled. FAKE_ROSETTAD_LATE_STDERR_MS makes that order deterministic: a
  // grandchild holding the inherited stderr writes them after the fake has exited.
  const LATE = { FAKE_ROSETTAD_LATE_STDERR_MS: "300" };

  it("item 65 — a crash whose last words reach stderr AFTER its exit still carries them in the detail", async () => {
    const { sup, transitions } = rig("crash-on-start", {
      spawnProcess: fakeSpawner("crash-on-start", LATE),
    });
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "restarting", 4_000);
    expect(transitions.find((t) => t.phase === "restarting")?.detail).toMatch(
      /exited \(2\) — fake rosettad: refusing to start/,
    );
    await sup.stop();
  });

  it("item 65 — an older binary whose words trail its exit is TERMINAL at once: never retried as a crash", async () => {
    const handed: Handed[] = [];
    const { sup, phases } = rig("old-binary", {
      spawnProcess: handingSpawner("old-binary", handed, LATE),
    });
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "failed", 4_000, "failed");
    expect(sup.state().detail).toMatch(/does not know --token-file.*wrong binary/);
    // and stays there: one generation, no retry scheduled for it
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sup.state().phase).toBe("failed");
    expect(handed).toHaveLength(1);
    expect(phases()).not.toContain("restarting");
  });

  it("item 65 — a stderr something else holds open past the drain bound: the exit is composed AT the bound, and the detail says the stream was still open", async () => {
    const { sup, transitions } = rig("crash-on-start", {
      spawnProcess: fakeSpawner("crash-on-start", { FAKE_ROSETTAD_LATE_STDERR_MS: "3000" }),
      timings: { ...T, STDERR_DRAIN_MS: 200 },
    });
    const started = Date.now();
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "restarting", 2_000);
    // composed at the bound, never when the grandchild lets go of the pipe (3 s)
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(transitions.find((t) => t.phase === "restarting")?.detail).toBe(
      "rosettad exited (2); its stderr still open after 200 ms",
    );
    await sup.stop();
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

  it("a packaged fieldd says it in a person's words — no variable, no daemon's name (AR-8, L3)", () => {
    // vitest runs fieldd from source, so the constant above is the developer's
    // sentence; the packaged one is the single executable's
    // (verify-history-package.mjs reads it from the real SEA).
    const packaged = rosettadUnconfigured(true);
    expect(packaged).toEqual({ ...ROSETTAD_UNCONFIGURED, detail: packaged.detail });
    expect(Object.isFrozen(packaged)).toBe(true);
    expect(rosettadUnconfigured(false)).toEqual(ROSETTAD_UNCONFIGURED);
    const words = packaged.detail ?? "";
    expect(words).not.toMatch(/FIELDD|rosettad|_BIN|\(/);
    expect(words).toContain("VibeField");
    // it completes the frame every door says it in, so it starts lower-case
    expect(`the agent index is unconfigured: ${words}`).toMatch(
      /^the agent index is unconfigured: [a-z]/,
    );
  });
});

/** What the supervisor handed one spawn, read AT the spawn — the files exist
 * then and are gone once the generation is ready. */
interface Handed {
  args: string[];
  tokenFile: string;
  grantKeyFile: string;
  token: string;
  key: Buffer;
  tokenMode: number;
  keyMode: number;
  dirMode: number;
}

function handingSpawner(
  mode: string,
  handed: Handed[],
  extraEnv: Record<string, string> = {},
): typeof spawn {
  return ((_bin: string, args: readonly string[], options: object) => {
    const value = (flag: string): string => args[args.indexOf(flag) + 1] as string;
    const tokenFile = value("--token-file");
    const grantKeyFile = value("--grant-key-file");
    handed.push({
      args: [...args],
      tokenFile,
      grantKeyFile,
      token: readFileSync(tokenFile, "latin1"),
      key: readFileSync(grantKeyFile),
      tokenMode: statSync(tokenFile).mode & 0o777,
      keyMode: statSync(grantKeyFile).mode & 0o777,
      dirMode: statSync(dirname(tokenFile)).mode & 0o777,
    });
    return spawn(process.execPath, [FAKE, ...args], {
      ...options,
      env: { ...process.env, FAKE_ROSETTAD_MODE: mode, ...extraEnv },
    });
  }) as unknown as typeof spawn;
}

const statusWith = async (
  origin: string,
  authorization?: string,
): Promise<{ status: number; reason: string | null; protocol: string | null }> => {
  const response = await fetch(
    `${origin}/api/status`,
    authorization === undefined ? {} : { headers: { authorization } },
  );
  await response.body?.cancel();
  return {
    status: response.status,
    reason: response.headers.get("x-rosetta-auth"),
    protocol: response.headers.get("x-rosetta-protocol-version"),
  };
};

// AR-8b (RO-1, RO-10; rosetta docs/AUTH.md) — every generation behind a
// credential: a fresh bearer and grant key per start, owner-only files the
// daemon reads once and fieldd removes the moment it is ready, the pair held in
// memory beside the origin and never in the state; a daemon that does not
// enforce access, or does not know the flags, is the wrong binary.
describe("RosettadSupervisor — every generation behind a credential (AR-8b)", () => {
  it("hands each start a fresh bearer and grant key: owner-only files and the three flags, gone once ready; credentials() pairs with the origin", async () => {
    const handed: Handed[] = [];
    const { sup, root } = rig("ok", {
      spawnProcess: handingSpawner("ok", handed),
      allowOrigins: ["file://", "vibefield-app://shell", "http://localhost:5173"],
    });
    expect(sup.credentials()).toBeNull();
    const origin = (await sup.start()) as string;
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(handed).toHaveLength(1);
    const [first] = handed as [Handed];
    // where LAYOUT says, both flags, and only the origins rosetta accepts
    expect(first.tokenFile).toBe(join(root, ...LAYOUT.INDEX_TOKEN_FILE));
    expect(first.grantKeyFile).toBe(join(root, ...LAYOUT.INDEX_GRANT_KEY_FILE));
    const flagValues = (flag: string) =>
      first.args.flatMap((arg, at) => (arg === flag ? [first.args[at + 1]] : []));
    expect(flagValues("--token-file")).toEqual([first.tokenFile]);
    expect(flagValues("--grant-key-file")).toEqual([first.grantKeyFile]);
    expect(flagValues("--allow-origin")).toEqual([
      "vibefield-app://shell",
      "http://localhost:5173",
    ]);
    // AUTH.md §4's bounds and modes, as rosetta reads them
    expect(first.token).toMatch(/^[\x21-\x7e]{32,1024}$/);
    expect(first.key.length).toBeGreaterThanOrEqual(32);
    expect(first.tokenMode).toBe(0o600);
    expect(first.keyMode).toBe(0o600);
    expect(first.dirMode).toBe(0o700);
    // read once before it bound: gone once it is ready (AUTH.md §7)
    expect(existsSync(first.tokenFile)).toBe(false);
    expect(existsSync(first.grantKeyFile)).toBe(false);
    // the modes it reported, never the secrets
    expect(sup.state().auth).toEqual({
      bearer: true,
      grants: true,
      origins: ["vibefield-app://shell", "http://localhost:5173"],
    });
    const credentials = sup.credentials();
    expect(credentials?.authorization).toBe(`Bearer ${first.token}`);
    expect(Buffer.from(credentials?.grantKey ?? []).equals(first.key)).toBe(true);
    // a copy: a holder that scribbles on it changes nothing
    credentials?.grantKey.fill(0);
    expect(Buffer.from(sup.credentials()?.grantKey ?? []).equals(first.key)).toBe(true);
    // the daemon wants the bearer, and the bearer is what fieldd holds
    expect(await statusWith(origin)).toMatchObject({ status: 401, reason: "missing" });
    expect(await statusWith(origin, credentials?.authorization)).toMatchObject({ status: 200 });
    // and none of it reaches the state, the projection or the log-bound detail
    const serialized = JSON.stringify([sup.state(), sup.health()]);
    expect(serialized).not.toContain(first.token);
    expect(serialized).not.toContain(first.key.toString("base64url"));
    expect(Object.keys(sup.health()).sort()).toEqual(["detail", "phase", "pid", "protocolVersion"]);
    await sup.stop();
    expect(sup.credentials()).toBeNull();
    expect(existsSync(first.tokenFile)).toBe(false);
  });

  it("a restart mints both again — the old bearer opens nothing on the new generation — and no phase but ready holds credentials", async () => {
    const handed: Handed[] = [];
    const { sup } = rig("ok", { spawnProcess: handingSpawner("ok", handed) });
    const held: Array<{ phase: RosettadPhase; credentials: boolean; origin: boolean }> = [];
    sup.on("transition", (state: RosettadState) =>
      held.push({
        phase: state.phase,
        credentials: sup.credentials() !== null,
        origin: state.origin !== null,
      }),
    );
    await sup.start();
    const before = sup.credentials()?.authorization as string;
    await sup.requestRestart();
    await until(() => sup.state().phase === "ready", 4_000, "the second generation ready");
    expect(handed).toHaveLength(2);
    const [first, second] = handed as [Handed, Handed];
    expect(second.token).not.toBe(first.token);
    expect(second.key.equals(first.key)).toBe(false);
    expect(sup.credentials()?.authorization).toBe(`Bearer ${second.token}`);
    const origin = sup.state().origin as string;
    expect(await statusWith(origin, before)).toMatchObject({ status: 401, reason: "bad-token" });
    expect(await statusWith(origin, sup.credentials()?.authorization)).toMatchObject({
      status: 200,
    });
    // the credentials go wherever the origin goes, at every transition
    expect(held.some((h) => h.phase === "restarting")).toBe(true);
    for (const h of held) expect(h.credentials, h.phase).toBe(h.origin && h.phase === "ready");
  });

  it("a daemon whose ready line says nothing about access is the wrong binary: TERMINAL, never retried, no credentials", async () => {
    const handed: Handed[] = [];
    const { sup, phases } = rig("no-auth", { spawnProcess: handingSpawner("no-auth", handed) });
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "failed", 3_000, "failed");
    expect(sup.state().detail).toMatch(/without access control/);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sup.state().phase).toBe("failed");
    expect(handed).toHaveLength(1);
    expect(phases()).not.toContain("ready");
    expect(phases()).not.toContain("restarting");
    expect(sup.credentials()).toBeNull();
    expect(existsSync(handed[0]?.tokenFile as string)).toBe(false);
  });

  it("an older binary that does not know --token-file is TERMINAL too, however its exit races its words", async () => {
    const handed: Handed[] = [];
    const { sup, phases } = rig("old-binary", {
      spawnProcess: handingSpawner("old-binary", handed),
    });
    expect(await sup.start()).toBeNull();
    await until(
      () =>
        sup.state().phase === "failed" &&
        /does not know --token-file/.test(sup.state().detail ?? ""),
      4_000,
      "failed, naming the flag",
    );
    // the exit is composed once stderr has ended (item 65), so the line that
    // says why is read first; a retry can slip out only when the stream stays
    // open past STDERR_DRAIN_MS, and the answer still settles on the honest
    // terminal one and stays there
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sup.state().phase).toBe("failed");
    expect(sup.state().detail).toMatch(/wrong binary/);
    expect(handed.length).toBeLessThanOrEqual(2);
    expect(phases().slice(phases().lastIndexOf("failed") + 1)).toEqual([]);
    expect(sup.credentials()).toBeNull();
  });

  it("passes rosettad only the origins it accepts at start — a refused one would take the index down", () => {
    expect(
      rosettadAllowOrigins([
        "file://",
        "null",
        "*",
        "",
        "VibeField-App://Shell",
        "vibefield-app://shell",
        "http://localhost:5173",
        "https://x.test/path",
        "https://user@x.test",
        "https://*.x.test",
        "1http://x",
      ]),
    ).toEqual(["vibefield-app://shell", "http://localhost:5173"]);
  });

  it("an orphan a credentialed fieldd left behind is still identified — its 401 carries the protocol header — and put down", async () => {
    const root = tmp();
    const tokenFile = join(root, "orphan.token");
    writeFileSync(tokenFile, "x".repeat(40), { mode: 0o600 });
    const left = await orphan(FAKE, root, { FAKE_ROSETTAD_MODE: "ok" }, [
      "--token-file",
      tokenFile,
    ]);
    const probe = await statusWith(left.origin);
    expect(probe).toMatchObject({
      status: 401,
      reason: "missing",
      protocol: String(PROTOCOL_VERSION),
    });
    const { sup } = rig("ok", { root });
    expect(await sup.start()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(alive(left.pid)).toBe(false);
    expect(sup.state().pid).not.toBe(left.pid);
  });
});

// DEBTS (fix7, PJ-7's first phone run) — a projection of another schema is the
// FIRST thing every user meets after a rosetta schema bump: `serve` fails closed
// by design (rosetta store/src/schema.rs), and five retries of a binary that can
// never open it ended in "use the restart affordance" — which no window offers.
// The upgrade path is rosetta's own explicit rebuild, run by the supervisor.
describe("RosettadSupervisor — a projection of another schema is rebuilt, not retried (DEBTS)", () => {
  type Rebuild = { pid: number; args: string[] };

  /** The fake over a projection stamped 24 (it expects 27), a home and a
   * record, its rebuild scripted; `rebuilds()` reads each rebuild's argv. */
  function upgradeRig(
    rebuild: "ok" | "fail" | "noop",
    options: { timings?: Partial<RosettadTimings>; env?: Record<string, string> } = {},
  ) {
    const root = tmp();
    const stamp = join(root, "schema-stamp");
    writeFileSync(stamp, "24\n");
    const log = join(root, "rebuilds.ndjson");
    const home = join(root, "home");
    mkdirSync(home, { recursive: true });
    const enrollFile = join(root, "index", "enrollment.json");
    mkdirSync(dirname(enrollFile), { recursive: true });
    writeFileSync(enrollFile, JSON.stringify({ format: 1, enabled_kinds: [], runtimes: [] }));
    const env = {
      FAKE_ROSETTAD_SCHEMA_FILE: stamp,
      FAKE_ROSETTAD_REBUILD: rebuild,
      FAKE_ROSETTAD_REBUILD_LOG: log,
      ...options.env,
    };
    const r = rig("ok", {
      root,
      home,
      enrollFile,
      spawnProcess: fakeSpawner("ok", env),
      ...(options.timings !== undefined ? { timings: options.timings } : {}),
    });
    const rebuilds = (): Rebuild[] =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as Rebuild)
        : [];
    return { ...r, stamp, home, enrollFile, rebuilds };
  }

  it("mismatch → rebuild (the same binary, serve's --db, --home and --enroll) → serving: rebuilding, then ready", async () => {
    const { sup, transitions, phases, root, stamp, home, enrollFile, rebuilds } = upgradeRig("ok");
    // the first generation exits on the mismatch: start() answers for it
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "ready", 6_000, "served after the rebuild");
    expect(sup.state().origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(rebuilds().map((r) => r.args)).toEqual([
      [
        "rebuild",
        "--db",
        join(root, "index", "rosetta.db"),
        "--home",
        home,
        "--enroll",
        enrollFile,
      ],
    ]);
    expect(readFileSync(stamp, "utf8").trim()).toBe("27");
    const rebuilding = transitions.find((t) => t.phase === "rebuilding");
    // said in the numbers rosetta gave, while no serve child is alive
    expect(rebuilding?.detail).toMatch(/schema 24.*27/);
    expect(rebuilding?.pid).toBeNull();
    expect(rebuilding?.origin).toBeNull();
    expect(phases()).not.toContain("failed");
    // (a "restarting" can precede it only when stderr stays open past
    // STDERR_DRAIN_MS, item 65; the retry it scheduled is taken back — the
    // intensity row)
    expect(phases().indexOf("rebuilding")).toBeLessThan(phases().lastIndexOf("ready"));
    await sup.stop();
  });

  it("item 65 — a mismatch whose words trail the exit is REBUILT, never retried as a crash first", async () => {
    const { sup, phases, rebuilds } = upgradeRig("ok", {
      env: { FAKE_ROSETTAD_LATE_STDERR_MS: "300" },
    });
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "ready", 6_000, "served after the rebuild");
    expect(rebuilds()).toHaveLength(1);
    // the mismatch was read before the exit was composed: rebuilding, then ready, no retry in between
    expect(phases().slice(0, phases().indexOf("rebuilding"))).not.toContain("restarting");
    expect(phases()).not.toContain("failed");
    await sup.stop();
  });

  it("a rebuild that fails ends in failed with rosetta's own reason — never the restart affordance — and stays there", async () => {
    const { sup, root, stamp, rebuilds } = upgradeRig("fail");
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "failed", 6_000, "failed");
    const detail = sup.state().detail ?? "";
    expect(detail).toContain(`no ledger at ${join(root, "index", "rosetta.ledger")}`);
    expect(detail).not.toMatch(/restart affordance|restart intensity/);
    // the old index is untouched and nothing is retried
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sup.state().phase).toBe("failed");
    expect(rebuilds()).toHaveLength(1);
    expect(readFileSync(stamp, "utf8").trim()).toBe("24");
    expect(sup.state().pid).toBeNull();
  });

  it("no rebuild loop: a second mismatch right after a rebuild is a real failure, said as one", async () => {
    const { sup, phases, rebuilds } = upgradeRig("noop");
    expect(await sup.start()).toBeNull();
    await until(() => sup.state().phase === "failed", 6_000, "failed");
    expect(sup.state().detail).toMatch(/schema 24.*27.*after (?:a|its) rebuild/);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sup.state().phase).toBe("failed");
    expect(rebuilds()).toHaveLength(1);
    expect(phases().filter((p) => p === "rebuilding")).toHaveLength(1);
  });

  it("the restart intensity is left untouched by a mismatch: one real crash after it still comes back", async () => {
    // RESTART_MAX 1: had the mismatch's exit been charged, the crash below
    // would trip to "failed" (the witness the requested-restart row uses)
    const { sup } = upgradeRig("ok", { timings: { ...T, RESTART_MAX: 1 } });
    await sup.start();
    await until(() => sup.state().phase === "ready", 6_000, "served after the rebuild");
    const served = sup.state().pid as number;
    process.kill(served, "SIGKILL");
    await until(
      () => sup.state().phase === "ready" && sup.state().pid !== served,
      6_000,
      "ready again after one real crash",
    );
    await sup.stop();
  });

  it("stop() during a rebuild puts the rebuild down and settles stopped — no serve after it", async () => {
    const { sup, phases, rebuilds } = upgradeRig("ok", {
      env: { FAKE_ROSETTAD_REBUILD_MS: "30000" },
    });
    void sup.start();
    await until(() => rebuilds().length === 1, 6_000, "the rebuild running");
    const rebuild = rebuilds()[0] as Rebuild;
    expect(sup.state().phase).toBe("rebuilding");
    await sup.stop();
    expect(alive(rebuild.pid)).toBe(false);
    expect(sup.state().phase).toBe("stopped");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(phases().slice(phases().indexOf("stopped") + 1)).toEqual([]);
  });
});

// The live rows: the REAL rosettad, opt-in. `pnpm siblings:build` then
// FIELDD_ROSETTAD_BIN=$(node scripts/siblings.mjs bin) \
//   pnpm --filter @vibefield/fieldd test -- rosettad-supervisor
const REAL_BIN = process.env["FIELDD_ROSETTAD_BIN"];
/** rosetta's own ground-truth Claude Code home (one session), from the pinned
 * checkout — the transcript agent-index-search's real row seeds too */
const GROUNDTRUTH = join(
  dirname(fileURLToPath(import.meta.url)),
  ...["..", "..", "..", "..", "rosetta-pin", "groundtruth", "claude-code", "fixtures"],
  ...["2.1.241", "basic-chat", "claude-config"],
);
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
        ...authFiles(root),
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

    it("AR-8b: the pin's rosettad comes up behind the three flags — its ready line says so, the bearer opens it, nothing else does", async () => {
      const root = tmp();
      const sup = new RosettadSupervisor({
        bin: REAL_BIN as string,
        dbPath: join(root, "index", "rosetta.db"),
        announceDir: join(root, "index", "daemons"),
        home: join(root, "home"),
        ...authFiles(root),
        allowOrigins: ["vibefield-app://shell", "file://"],
        expectedProtocolVersion: PROTOCOL_VERSION,
        timings: { STARTUP_TIMEOUT_MS: 30_000 },
      });
      sups.push(sup);
      const origin = await sup.start();
      expect(origin, sup.state().detail ?? "").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(sup.state().auth).toEqual({
        bearer: true,
        grants: true,
        origins: ["vibefield-app://shell"],
      });
      expect(existsSync(join(root, ...LAYOUT.INDEX_TOKEN_FILE))).toBe(false);
      expect(existsSync(join(root, ...LAYOUT.INDEX_GRANT_KEY_FILE))).toBe(false);
      const bare = await statusWith(origin as string);
      expect(bare).toMatchObject({
        status: 401,
        reason: "missing",
        protocol: String(PROTOCOL_VERSION),
      });
      expect(
        await statusWith(origin as string, "Bearer not-the-token-not-the-token-xx"),
      ).toMatchObject({
        status: 401,
        reason: "bad-token",
      });
      expect(await statusWith(origin as string, sup.credentials()?.authorization)).toMatchObject({
        status: 200,
      });
      await sup.stop();
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
        ...authFiles(root),
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

    it.skipIf(!existsSync(GROUNDTRUTH))(
      "DEBTS: a projection stamped with an older schema is rebuilt by the pin's own binary — its words matched, its rebuild run — and served",
      async () => {
        const root = tmp();
        const home = join(root, "home");
        // rosetta's own ground-truth transcript in an empty home: nothing of the
        // developer's is read, and the ledger the rebuild replays is real
        cpSync(GROUNDTRUTH, join(home, ".claude"), { recursive: true });
        const enrollFile = join(root, "index", "enrollment.json");
        mkdirSync(dirname(enrollFile), { recursive: true });
        writeFileSync(
          enrollFile,
          JSON.stringify({ format: 1, enabled_kinds: ["claude-code"], runtimes: [] }),
        );
        const dbPath = join(root, "index", "rosetta.db");
        const options = {
          bin: REAL_BIN as string,
          dbPath,
          announceDir: join(root, "index", "daemons"),
          home,
          enrollFile,
          ...authFiles(root),
          expectedProtocolVersion: PROTOCOL_VERSION,
          timings: { STARTUP_TIMEOUT_MS: 30_000 },
        };
        const first = new RosettadSupervisor(options);
        sups.push(first);
        const origin = await first.start();
        expect(origin, first.state().detail ?? "").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        await untilIngestLive(origin as string, first, 30_000);
        await first.stop();
        // SQLite's own header: the user version (rosetta's schema stamp) is
        // the big-endian word at byte 60 — set back three versions
        const current = schemaStamp(dbPath);
        expect(current).toBeGreaterThan(3);
        stampSchema(dbPath, current - 3);

        const second = new RosettadSupervisor(options);
        sups.push(second);
        const seen: RosettadState[] = [];
        second.on("transition", (s: RosettadState) => seen.push(s));
        expect(await second.start()).toBeNull(); // the mismatched generation
        await until(
          () => second.state().phase === "ready" || second.state().phase === "failed",
          60_000,
          "served or failed",
        );
        expect(second.state().phase, second.state().detail ?? "").toBe("ready");
        expect(seen.find((s) => s.phase === "rebuilding")?.detail).toContain(
          `schema ${current - 3} where this rosettad reads ${current}`,
        );
        await second.stop();
        expect(schemaStamp(dbPath)).toBe(current);
      },
    );
  },
);

/** SQLite's header word at byte 60, the user version (rosetta's stamp). */
function schemaStamp(db: string): number {
  return readFileSync(db).readUInt32BE(60);
}

function stampSchema(db: string, version: number): void {
  const word = Buffer.alloc(4);
  word.writeUInt32BE(version, 0);
  const fd = openSync(db, "r+");
  try {
    writeSync(fd, word, 0, 4, 60);
  } finally {
    closeSync(fd);
  }
}

/** The daemon's ingest says `live`: the ledger the rebuild needs is written. */
async function untilIngestLive(origin: string, sup: RosettadSupervisor, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    const credentials = sup.credentials();
    if (credentials !== null) {
      const body = (await fetch(`${origin}/api/status`, {
        headers: { authorization: credentials.authorization },
      })
        .then((response) => response.json())
        .catch(() => null)) as { daemon?: { ingest?: { phase?: string } } } | null;
      if (body?.daemon?.ingest?.phase === "live") return;
    }
    if (Date.now() > deadline) throw new Error(`the ingest never said live within ${ms}ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
