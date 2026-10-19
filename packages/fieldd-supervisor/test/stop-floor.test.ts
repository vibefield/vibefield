import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFielddSupervisor, productPath } from "../src/index";
import { createHarness, FIXTURE_READY, type Harness, waitDead } from "./helpers";

// stop-owned ends the floor its fieldd's record names AT THE STOP: fieldd
// rewrites product.json's `nativePid` whenever its floor changes (a respawn, a
// hello stating another pid), so the copy the probe read can name a floor that
// has gone. The record is read fresh before the stop verb and believed only
// while it is still this fieldd's — its pid the child's, its bootId the
// probe's; any other record leaves the probe's value. fieldd's stop removes the
// record, and the stand-in here does too at SIGTERM, so a read moved after the
// SIGTERM finds none and the first row goes red. Every "floor" here is a child
// process this suite owns.

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A stand-in floor: an idle child of this suite, killed in cleanup. */
function floorStandIn(): number {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)"], {
    stdio: "ignore",
  });
  h.trackPid(child.pid);
  return child.pid as number;
}

/** A spawned fieldd stand-in whose record names `nativePid` at the probe. */
async function spawnWithFloor(nativePid: number) {
  const { port, token } = await h.startProduct();
  const root = h.mkRoot();
  const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_READY);
  const sup = h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: [script] },
      environment: {
        CV: CONTRACTS_VERSION,
        TEST_PRODUCT_PORT: String(port),
        SHELL_TOKEN: token,
        NATIVE_PID: String(nativePid),
        REMOVE_RECORD_ON_TERM: "1", // as fieldd's stop does: a read after it would find none
      },
      shutdownPolicy: "stop-owned",
      adoptProbeMs: 300,
      readinessDeadlineMs: 3000,
    }),
  );
  const handle = await sup.ensure();
  expect(handle.ownership).toBe("spawned");
  expect(handle.info.nativePid, "the probe read the boot's record").toBe(nativePid);
  return { root, port, token, handle };
}

describe("stop-owned ends the floor the record names at the stop", () => {
  it("a floor respawned after the probe is the one signalled, not the probe's", async () => {
    const probed = floorStandIn();
    const respawned = floorStandIn();
    const { root, port, token, handle } = await spawnWithFloor(probed);
    // fieldd respawned its floor: the same fieldd, the same boot, the next floor
    h.writeRunFiles(root, {
      port,
      pid: handle.childPid as number,
      token,
      bootId: handle.info.bootId,
      nativePid: respawned,
    });

    await handle.stopOwned();
    expect(await waitDead(respawned), "the floor of record at the stop").toBe(true);
    expect(alive(probed), "the probe's floor is no longer the record's").toBe(true);
  });

  const strangers: Array<[string, { pid?: number; bootId?: string }]> = [
    ["another daemon's pid", { pid: process.pid }],
    ["another boot", { bootId: "boot-successor" }],
  ];
  it.each(strangers)(
    "a record that is no longer this fieldd's (%s) leaves the probe's floor",
    async (_label, stranger) => {
      const probed = floorStandIn();
      const named = floorStandIn();
      const { root, port, token, handle } = await spawnWithFloor(probed);
      h.writeRunFiles(root, {
        port,
        pid: stranger.pid ?? (handle.childPid as number),
        token,
        bootId: stranger.bootId ?? handle.info.bootId,
        nativePid: named,
      });

      await handle.stopOwned();
      expect(await waitDead(probed), "the probe's floor, exactly as before").toBe(true);
      expect(alive(named), "another daemon's floor is not this stop's").toBe(true);
    },
  );

  it("no record at the stop leaves the probe's floor", async () => {
    const probed = floorStandIn();
    const { root, handle } = await spawnWithFloor(probed);
    rmSync(productPath(root), { force: true });

    await handle.stopOwned();
    expect(await waitDead(probed)).toBe(true);
  });
});
