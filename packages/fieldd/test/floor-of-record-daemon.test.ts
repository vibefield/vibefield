// product.json names the floor this fieldd is linked to (the floor of record,
// `NativeSupervisor.recordedFloorPid`), through the daemon's one writer and
// against the mock mgmt server (no cargo): an adopted floor by the pid its
// hello ack states, a respawned floor by the respawn's pid, and once stop has
// begun no floor event writes the file again. The supervisor's own rows are
// native-supervisor.test.ts ("the floor of record"); the real binary's are the
// respawn rows of native-supervision-matrix.test.ts.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, ProductInfo, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { until } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  const fns = cleanup.reverse();
  cleanup = [];
  for (const fn of fns) {
    try {
      await fn();
    } catch {
      /* already stopped */
    }
  }
});

/** A process that stands in for a floor: a pid this test owns, so whatever
 * names it, nothing a stray signal could hurt. */
function standIn(): number {
  const child: ChildProcess = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
    stdio: "ignore",
  });
  cleanup.push(() => {
    child.kill("SIGKILL");
  });
  return child.pid as number;
}

/** product.json's `nativePid`, read from the data dir as a shell reads it. */
function recordedNativePid(dataDir: string): number | null {
  const raw = readFileSync(join(dataDir, ...LAYOUT.PRODUCT_JSON), "utf8");
  return ProductInfo.parse(JSON.parse(raw)).nativePid;
}

async function setup(config: {
  /** the pid the mock floor's hello ack states */
  helloPid: number;
  /** the floor the caller spawned (bin.ts's `nativePid`); absent = adopted */
  nativePid?: number;
  /** the respawn seam, handed the mock floor so it can bring the endpoint back */
  nativeSpawner?: (floor: MockMgmtServer) => number | undefined;
}): Promise<{ mock: MockMgmtServer; daemon: FielddDaemon; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-floor-record-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.helloPid = config.helloPid;
  await mock.start();
  cleanup.push(() => mock.stop());
  const spawner = config.nativeSpawner;
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    ...(config.nativePid !== undefined ? { nativePid: config.nativePid } : {}),
    ...(spawner !== undefined ? { nativeSpawner: () => spawner(mock) } : {}),
  });
  cleanup.push(() => daemon.stop());
  return { mock, daemon, dataDir };
}

describe("product.json names the floor of record", () => {
  it("an adopted floor is named by the pid its hello ack states", async () => {
    const floor = standIn();
    const { daemon, dataDir } = await setup({ helloPid: floor });
    expect(recordedNativePid(dataDir)).toBe(floor);
    expect(daemon.nativeSupervisor.recordedFloorPid).toBe(floor);
    // health keeps its own meaning: the pid this fieldd can vouch for
    expect(daemon.health().nativePid).toBeNull();
    expect(daemon.health().nativeLink.pid).toBe(floor);
  });

  it("a respawn rewrites the record to the floor that replaced the dead one", async () => {
    const first = standIn();
    const respawned: number[] = [];
    const { mock, daemon, dataDir } = await setup({
      helloPid: first,
      nativePid: first,
      nativeSpawner: (floor) => {
        // the next floor: a process this test owns, and the endpoint answering
        // again with a hello that states its pid
        const pid = standIn();
        respawned.push(pid);
        floor.helloPid = pid;
        if (floor.server === null) void floor.start();
        return pid;
      },
    });
    expect(recordedNativePid(dataDir), "the boot's write: bin.ts's spawn").toBe(first);

    // the floor dies: its endpoint stops answering, and the link's redials fail
    // until the probe finds no listener and the supervisor respawns
    await mock.stop();
    await until(
      () => respawned.length > 0 && daemon.native.connected,
      15_000,
      "the respawned floor paired",
    );
    const next = respawned[0] as number;
    expect(daemon.health().nativePid).toBe(next);
    expect(recordedNativePid(dataDir)).toBe(next);
    expect(respawned, "one respawn: the double-spawn guard held").toHaveLength(1);
  }, 30_000);

  it("once stop has begun the record is gone, and no floor event writes it again", async () => {
    const { daemon, dataDir } = await setup({ helloPid: standIn() });
    const productPath = join(dataDir, ...LAYOUT.PRODUCT_JSON);
    expect(existsSync(productPath)).toBe(true);
    await daemon.stop();
    expect(existsSync(productPath)).toBe(false);
    // a floor announced after the stop — a hello's pid, a respawn's — is no
    // longer this fieldd's to record
    daemon.nativeSupervisor.emit("floor-of-record", { pid: standIn() });
    expect(existsSync(productPath)).toBe(false);
    expect(existsSync(`${productPath}.${process.pid}.tmp`)).toBe(false);
  });
});
