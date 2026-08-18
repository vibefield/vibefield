// TC-S1 kill-matrix rows (terminal-custody spec §11), against the REAL
// field-native binary:
//   · floor SIGKILL → auto-respawn, honest loss report, fresh pid;
//   · mgmt wedge (SIGSTOP) → detected as "unresponsive" — DISTINCT from
//     crash — then recovery on SIGCONT with the SAME pid (no needless kill);
//   · respawn intensity → the permanent honest "gone" + the restart
//     affordance bringing the plane back on purpose.
// The 250ms detection figure is the design budget; assertions carry loaded-
// host slack (state correctness is the gate — this Mac runs at load 20–200)
// and the measured number rides the assertion message.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, type FielddDaemon } from "../src/index";
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

/** Boots a supervised pair: the spawner is the SAME shape bin.ts hands the
 * daemon, and every child it makes lands in the teardown list. */
async function bootSupervisedPair(): Promise<{ daemon: FielddDaemon; dir: string }> {
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
  });
  daemons.push(daemon);
  return { daemon, dir };
}

describe("TC-S1 floor supervision matrix (real field-native)", () => {
  it("row: floor SIGKILL → auto-respawn with a fresh pid, link back up", async () => {
    const { daemon } = await bootSupervisedPair();
    await until(() => daemon.health().nativeLink === "up", 10_000, "initial up");
    const pid = daemon.health().nativePid;
    expect(pid).not.toBeNull();
    process.kill(pid as number, "SIGKILL");
    const ms = await until(
      () => daemon.health().nativeLink === "up" && daemon.health().nativePid !== pid,
      20_000,
      "respawned up",
    );
    expect(daemon.health().nativePid, `respawn took ${ms}ms`).not.toBe(pid);
    expect(daemon.health().nativeConnected).toBe(true);
  }, 40_000);

  it("row: mgmt wedge (SIGSTOP) → unresponsive, distinct state; SIGCONT → same pid recovers", async () => {
    const { daemon } = await bootSupervisedPair();
    await until(() => daemon.health().nativeLink === "up", 10_000, "initial up");
    const pid = daemon.health().nativePid as number;
    process.kill(pid, "SIGSTOP");
    // detection-to-STATE: design budget 250ms; loaded-host slack ×6. The
    // measured number rides the failure message either way.
    const detectMs = await until(
      () => daemon.health().nativeLink === "unresponsive",
      5_000,
      "wedge detected",
    );
    expect(detectMs, `wedge detected in ${detectMs}ms (design budget 250ms)`).toBeLessThanOrEqual(
      1_500,
    );
    // resume BEFORE the confirm window so the destructive rung must NOT fire
    process.kill(pid, "SIGCONT");
    await until(() => daemon.health().nativeLink === "up", 5_000, "recovered");
    // the same pid — detection was reversible state, not a kill
    expect(daemon.health().nativePid).toBe(pid);
  }, 40_000);

  it("row: respawn intensity trips to gone; the restart affordance brings it back", async () => {
    const { daemon } = await bootSupervisedPair();
    await until(() => daemon.health().nativeLink === "up", 10_000, "initial up");
    // kill every floor the instant it reports in: 3 respawns land inside the
    // window, the 4th death trips the bound — the machine stops ON PURPOSE
    let lastPid = daemon.health().nativePid as number;
    for (;;) {
      process.kill(lastPid, "SIGKILL");
      await until(
        () => {
          const h = daemon.health();
          return h.nativeLink === "gone" || (h.nativeLink === "up" && h.nativePid !== lastPid);
        },
        20_000,
        "respawn or gone",
      );
      const h = daemon.health();
      if (h.nativeLink === "gone") break;
      lastPid = h.nativePid as number;
    }
    expect(daemon.health().nativeLinkDetail).toContain("intensity");
    await daemon.nativeSupervisor.requestRestart();
    await until(
      () => daemon.health().nativeLink === "up" && daemon.health().nativePid !== lastPid,
      20_000,
      "manual restart up",
    );
  }, 120_000);
});
