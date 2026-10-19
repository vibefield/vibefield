// TC-S1 kill-matrix rows (terminal-custody spec §11), against the REAL
// field-native binary:
//   · floor SIGKILL → auto-respawn, honest loss report, fresh pid;
//   · mgmt wedge (SIGSTOP) → detected as "unresponsive" — DISTINCT from
//     crash — then recovery on SIGCONT with the SAME pid (no needless kill);
//   · respawn intensity → the permanent honest "gone" + the restart
//     affordance bringing the plane back on purpose.
// And the wedge ladder's rows (WG-D1, draft/thinking-floor-wedge.md §6), on
// the supervision-timings seam so a SIGSTOP past the bound takes seconds:
//   · an EMPTY floor stopped past the bound is restarted: a fresh pid;
//   · a floor holding a session is held, never killed — its doors answer
//     UNAVAILABLE {native, unresponsive} meanwhile — and SIGCONT brings the
//     same pid back with the session alive in its cell;
//   · a fieldd booting against a floor that accepts and never answers the
//     hello refuses its boot, and kills nothing.
// The 250ms detection figure is the design budget; assertions carry loaded-
// host slack (state correctness is the gate — this Mac runs at load 20–200)
// and the measured number rides the assertion message.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYOUT, ProductInfo } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, type FielddDaemon } from "../src/index";
import type { NativeSupervisionTimings } from "../src/native-supervisor";
import { nativeBinPath, waitForMgmtEndpoint } from "./native-harness";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = nativeBinPath(ROOT);

let children: ChildProcess[] = [];
let dirs: string[] = [];
let daemons: FielddDaemon[] = [];

afterEach(async () => {
  for (const d of daemons) await d.stop().catch(() => undefined);
  daemons = [];
  const exits = children.map((c) =>
    c.exitCode !== null || c.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          c.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
  );
  for (const c of children) {
    try {
      c.kill("SIGCONT"); // a SIGSTOPped child ignores SIGKILL until resumed
    } catch {}
    c.kill("SIGKILL");
  }
  await Promise.all(exits);
  children = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  dirs = [];
});

function nativeEnv(dataDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FIELD_NATIVE_DATA_DIR: dataDir,
    FIELD_LOG_DIR: join(dataDir, "logs"),
    FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
  };
}

const until = async (cond: () => boolean, ms: number, what: string): Promise<number> => {
  const t0 = Date.now();
  const deadline = t0 + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`until(${what}): never held within ${ms}ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
  return Date.now() - t0;
};

/** WG-D1's ladder on a scale a row can wait out: the redial at 1 s, the bound
 * at 3 s, the drain wait 2 s; the headless deadline out of reach. */
const WEDGE: Partial<NativeSupervisionTimings> = {
  WEDGE_REDIAL_MS: 1_000,
  WEDGE_CONFIRM_MS: 3_000,
  WEDGE_RECOUNT_MS: 500,
  WEDGE_HEADLESS_MS: 120_000,
  KILL_DRAIN_WAIT_MS: 2_000,
};

/** Is a process alive? Signal 0 asks the kernel without delivering anything. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** product.json's `nativePid` — the floor of record — read from the data dir
 * as a shell reads it. */
function recordedNativePid(dir: string): number | null {
  const raw = readFileSync(join(dir, ...LAYOUT.PRODUCT_JSON), "utf8");
  return ProductInfo.parse(JSON.parse(raw)).nativePid;
}

/** Boots a supervised pair: the spawner is the SAME shape bin.ts hands the
 * daemon, and every child it makes lands in the teardown list. */
async function bootSupervisedPair(
  timings?: Partial<NativeSupervisionTimings>,
): Promise<{ daemon: FielddDaemon; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "vf-sup-"));
  dirs.push(dir);
  const spawner = (): number | undefined => {
    const child = spawn(BIN, [], { env: nativeEnv(dir), stdio: "ignore" });
    children.push(child);
    return child.pid;
  };
  const firstPid = spawner();
  await waitForMgmtEndpoint(dir, 10_000);
  const daemon = await bootstrap({
    dataDir: dir,
    controlPort: 0,
    ...(firstPid !== undefined ? { nativePid: firstPid } : {}),
    nativeSpawner: spawner,
    ...(timings !== undefined ? { nativeSupervisionTimings: timings } : {}),
  });
  daemons.push(daemon);
  return { daemon, dir };
}

describe("TC-S1 floor supervision matrix (real field-native)", () => {
  it("row: floor SIGKILL → auto-respawn with a fresh pid, link back up", async () => {
    const { daemon, dir } = await bootSupervisedPair();
    await until(() => daemon.health().nativeLink.state === "up", 10_000, "initial up");
    const pid = daemon.health().nativePid;
    expect(pid).not.toBeNull();
    expect(recordedNativePid(dir), "the boot's record names the spawned floor").toBe(pid);
    process.kill(pid as number, "SIGKILL");
    const ms = await until(
      () => daemon.health().nativeLink.state === "up" && daemon.health().nativePid !== pid,
      20_000,
      "respawned up",
    );
    expect(daemon.health().nativePid, `respawn took ${ms}ms`).not.toBe(pid);
    expect(daemon.health().nativeConnected).toBe(true);
    // the record follows the respawn: the floor that replaced the killed one
    expect(recordedNativePid(dir)).toBe(daemon.health().nativePid);
  }, 40_000);

  it("row: mgmt wedge (SIGSTOP) → unresponsive, distinct state; SIGCONT → same pid recovers", async () => {
    const { daemon } = await bootSupervisedPair();
    await until(() => daemon.health().nativeLink.state === "up", 10_000, "initial up");
    const pid = daemon.health().nativePid as number;
    process.kill(pid, "SIGSTOP");
    // detection-to-STATE: design budget 250ms; loaded-host slack ×6. The
    // measured number rides the failure message either way.
    const detectMs = await until(
      () => daemon.health().nativeLink.state === "unresponsive",
      5_000,
      "wedge detected",
    );
    expect(detectMs, `wedge detected in ${detectMs}ms (design budget 250ms)`).toBeLessThanOrEqual(
      1_500,
    );
    // resume well inside the redial (10 s): the ladder takes no step at all
    process.kill(pid, "SIGCONT");
    await until(() => daemon.health().nativeLink.state === "up", 5_000, "recovered");
    // the same pid — detection was reversible state, not a kill
    expect(daemon.health().nativePid).toBe(pid);
  }, 40_000);

  it("row: respawn intensity trips to gone; the restart affordance brings it back", async () => {
    const { daemon, dir } = await bootSupervisedPair();
    await until(() => daemon.health().nativeLink.state === "up", 10_000, "initial up");
    // kill every floor the instant it reports in: 3 respawns land inside the
    // window, the 4th death trips the bound — the machine stops ON PURPOSE
    let lastPid = daemon.health().nativePid as number;
    for (;;) {
      process.kill(lastPid, "SIGKILL");
      await until(
        () => {
          const h = daemon.health();
          return (
            h.nativeLink.state === "gone" ||
            (h.nativeLink.state === "up" && h.nativePid !== lastPid)
          );
        },
        20_000,
        "respawn or gone",
      );
      const h = daemon.health();
      if (h.nativeLink.state === "gone") break;
      expect(recordedNativePid(dir), "the record follows each respawn").toBe(h.nativePid);
      lastPid = h.nativePid as number;
    }
    expect(daemon.health().nativeLink.detail).toContain("intensity");
    await daemon.nativeSupervisor.requestRestart();
    await until(
      () => daemon.health().nativeLink.state === "up" && daemon.health().nativePid !== lastPid,
      20_000,
      "manual restart up",
    );
    expect(recordedNativePid(dir)).toBe(daemon.health().nativePid);
  }, 120_000);

  it("row WG-1: an EMPTY floor stopped past the bound is restarted through the drain ladder — a fresh pid", async () => {
    const { daemon, dir } = await bootSupervisedPair(WEDGE);
    const sup = daemon.nativeSupervisor;
    await until(() => sup.state === "up", 10_000, "initial up");
    const pid = sup.currentPid as number;
    process.kill(pid, "SIGSTOP");
    // detection, the redial at 1 s, the bound at 3 s, an empty census, SIGTERM
    // (held pending by the stop), the 2 s drain wait, SIGKILL, the respawn
    const ms = await until(
      () => sup.state === "up" && sup.currentPid !== pid,
      30_000,
      "restarted up",
    );
    expect(sup.currentPid, `restarted in ${ms}ms`).not.toBe(pid);
    expect(alive(pid), "the stopped floor was ended").toBe(false);
    // the record names the restarted floor, never the one the ladder ended
    expect(recordedNativePid(dir)).toBe(daemon.health().nativePid);
  }, 60_000);

  it("row WG-2: a floor holding a session is held past the bound, never killed; SIGCONT recovers the same pid with the session alive", async () => {
    const { daemon } = await bootSupervisedPair(WEDGE);
    const sup = daemon.nativeSupervisor;
    await until(() => sup.state === "up", 10_000, "initial up");
    const pid = sup.currentPid as number;
    const { sessionId } = await daemon.terminals.create({ shell: "/bin/cat" });
    process.kill(pid, "SIGSTOP");
    await until(() => sup.health().sessionsAtRisk === 1, 20_000, "held with its count");
    expect(sup.state).toBe("unresponsive");
    expect(daemon.health().nativeLink).toMatchObject({ state: "unresponsive", sessionsAtRisk: 1 });
    // WG-D4 — a door that rides the floor's mgmt path is refused at once, never sent
    await expect(daemon.native.request("native.mesh.peers.list", {})).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "native", state: "unresponsive" },
    });
    // well past the bound, and the floor is still the one that was stopped
    await new Promise((r) => setTimeout(r, 3_000));
    expect(alive(pid)).toBe(true);
    expect(sup.currentPid).toBe(pid);
    process.kill(pid, "SIGCONT");
    await until(() => sup.state === "up", 20_000, "recovered");
    expect(sup.currentPid).toBe(pid);
    // the session lives in its cell, and its PTY still takes input
    const census = await daemon.terminals.floorCensus(false);
    expect(census.complete).toBe(true);
    expect(census.live).toContain(sessionId);
    await expect(
      daemon.terminals.automate(sessionId, { kind: "text", text: "still here\n" }),
    ).resolves.toMatchObject({ accepted: true });
  }, 60_000);

  it("row WG-3: a fieldd booting against a floor that accepts and never answers the hello refuses its boot, and kills nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-sup-"));
    dirs.push(dir);
    const child = spawn(BIN, [], { env: nativeEnv(dir), stdio: "ignore" });
    children.push(child);
    await waitForMgmtEndpoint(dir, 10_000);
    const pid = child.pid as number;
    process.kill(pid, "SIGSTOP"); // the listener's backlog still accepts the dial
    // the floor answers, so bin.ts adopts it: no pid, the spawner held
    const booting = bootstrap({
      dataDir: dir,
      controlPort: 0,
      nativeSpawner: () => undefined,
      nativeSupervisionTimings: WEDGE,
    });
    await expect(booting).rejects.toThrow(/hello|readiness deadline/);
    expect(alive(pid), "the floor that never answered is not this fieldd's to end").toBe(true);
  }, 60_000);
});
