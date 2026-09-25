import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PORTS, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productPathSecret, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";

// P0-S (2026-09-24) — the floor outlives fieldd, and a fieldd that restarts
// under it must re-place its own tailnet door. The phone reaches a desktop
// through `product` on 9423, whose target is fieldd's EPHEMERAL control port
// and whose path secret is minted per fieldd BOOT (UA-P-0d, never on disk). The
// MeshClient used to ADOPT any desired serve the floor already listed — and
// `serve.list` carries no target or secret to compare — so the restarted
// fieldd kept its predecessor's door, aimed at a dead port with a dead secret,
// until the floor itself restarted. Measured before the fix with this exact
// composition: the target stayed on the first fieldd's port six seconds after
// the second one bound its own. Two daemons on ONE root, against ONE floor.

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

describe("P0-S — a fieldd restarted under a surviving floor re-places its product door", () => {
  it("aims the floor's product serve at the NEW fieldd, with the new boot's secret", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-p0s-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    writeLinkFixture(dataDir);
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const productTarget = () =>
      (mock.meshServes.get("product")?.target as { port?: number } | undefined)?.port;

    const first = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => first.stop());
    await poll(() => (productTarget() === first.controlPort ? true : undefined));
    const firstSecret = productPathSecret(mock);
    expect(mock.meshServes.get("product")?.listenPort).toBe(PORTS.FIELDD_PRODUCT_SERVE);
    await first.stop();

    // the floor still lists the dead fieldd's door
    expect(productTarget()).toBe(first.controlPort);

    const second = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => second.stop());
    expect(second.controlPort).not.toBe(first.controlPort);
    await poll(() => (productTarget() === second.controlPort ? true : undefined));
    // the replacement carries the NEW boot's secret — the door it points at is
    // the only one that knows it
    expect(productPathSecret(mock)).not.toBe(firstSecret);
    expect(mock.meshServes.get("product")?.listenPort).toBe(PORTS.FIELDD_PRODUCT_SERVE);
  }, 30_000);
});
