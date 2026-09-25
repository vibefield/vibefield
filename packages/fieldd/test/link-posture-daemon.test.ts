import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";

// UA-P-0j — the posture re-ask, as the DAEMON wires it. `link-service.test.ts`
// drives the service's probe directly, which proves the service and nothing
// about daemon.ts: deleting the `native.on("connected", …)` line would leave
// every one of those rows green. What is under test here is that seam — a
// floor that dies under a live fieldd and comes back holding no posture (the
// real floor's boot default) is asked for the linked posture again, over the
// re-dialed link, with no fieldd restart.
//
// The mock models the floor's posture (`meshPosture`): `null` answers every
// mesh call but `start` with the floor's own `disabled`, and a respawn is
// `meshPosture = null` plus dropping the clients.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* an already-stopped daemon is fine */
    }
  }
  cleanup = [];
});

async function poll<T>(fn: () => T | undefined, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`poll timed out after ${ms}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("UA-P-0j — a floor respawned under fieldd is asked for its posture again", () => {
  it("re-asks for the LINKED posture over the re-dialed link, naming the same account", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-p0j-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    writeLinkFixture(dataDir);

    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    mock.meshPosture = null; // a floor boots holding nothing until it is asked
    await mock.start();
    cleanup.push(() => mock.stop());

    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    // the boot asks once, naming the account, and its first probe finds the
    // node the floor now holds
    await poll(() => (mock.meshStarts.length >= 1 ? true : undefined));
    expect(mock.meshStarts[0]).toEqual({ mode: "linked", login: TEST_LOGIN });
    await poll(() => (mock.meshCalls.includes("native.mesh.self") ? true : undefined));
    expect(daemon.native.connected).toBe(true);
    const connectionsBefore = mock.connections;

    // the floor dies and comes back holding nothing: the mgmt link drops, and
    // re-dials the same endpoint
    mock.meshPosture = null;
    mock.killClients();
    await poll(() => (mock.connections > connectionsBefore ? true : undefined));

    // …and the posture is asked for again, the same account, with no fieldd
    // restart — before UA-P-0j nothing asked, and the node stayed down
    await poll(() => (mock.meshStarts.length >= 2 ? true : undefined));
    expect(mock.meshStarts[1]).toEqual({ mode: "linked", login: TEST_LOGIN });
    expect(mock.meshPosture).toEqual({ mode: "linked", login: TEST_LOGIN });
    // exactly one re-ask: the floor holds the posture again, so the probes that
    // follow find a node and ask for nothing more
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mock.meshStarts).toHaveLength(2);
  });
});

// UA-P-0k — the other side of the same seam, found live on 2026-09-24: the
// floor answers `native.mesh.self` from its aggregated health, which catches up
// on its own task, so the probe right after a cold boot's ask can still read
// the boot default `disabled`. Restoring on that read asked twice, and the
// floor tore down the bring-up the first ask had begun. `meshHealthLag` models
// the lag; the row pins that the stale read really happened.
describe("UA-P-0k — a cold linked boot is asked for its posture once", () => {
  it("does not re-ask when the floor still reads `disabled` just after the boot's ask lands", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-p0k-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    writeLinkFixture(dataDir);

    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    mock.meshPosture = null; // a cold floor: no posture until it is asked…
    mock.meshHealthLag = 1; // …and its first `self` after the ask still reads the boot default
    await mock.start();
    cleanup.push(() => mock.stop());

    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    // the precondition, pinned: the boot's probe really was answered the stale
    // `disabled`, after the ask it follows had landed
    await poll(() => (mock.meshStaleAnswers >= 1 ? true : undefined));
    expect(mock.meshStarts).toEqual([{ mode: "linked", login: TEST_LOGIN }]);
    // a re-ask would follow that read at once — before UA-P-0k it did
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mock.meshStarts).toHaveLength(1);
    expect(mock.meshPosture).toEqual({ mode: "linked", login: TEST_LOGIN });
  });
});
