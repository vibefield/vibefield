import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";

interface Fixture {
  root: string;
  logRoot: string;
  daemon: FielddDaemon;
  native: MockMgmtServer;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.daemon.stop();
    await fixture.native.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

async function setup(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "vf-fieldd-logging-"));
  const dataDir = join(root, "data");
  const logRoot = join(root, "logs");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  mkdirSync(join(dataDir, "registries"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  // Produces one of the migrated doc-service events during pre-listen
  // composition, proving the sink exists before product services.
  writeFileSync(join(dataDir, "registries", "field.docs.v1.json"), '[{"invalid":true}]\n');
  const native = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
  await native.start();
  const daemon = await bootstrap({ dataDir, logRoot, controlPort: 0, dataPort: 0 });
  const fixture = { root, logRoot, daemon, native };
  fixtures.push(fixture);
  return fixture;
}

describe("fieldd process-owned logging", () => {
  it("opens before services, exposes health, and drains lifecycle records on stop", async () => {
    const { daemon, logRoot } = await setup();
    const shellToken = daemon.shellToken;
    const pairingSecret = "ab".repeat(32);

    expect(daemon.logging).not.toBeNull();
    expect(daemon.health().logging).toMatchObject({
      stream: "system/fieldd",
      service: "fieldd",
      writerState: "healthy",
    });
    await daemon.stop();

    const file = join(logRoot, "system", "fieldd.ndjson");
    const raw = readFileSync(file, "utf8");
    const records = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string; component: string });
    const events = records.map((record) => record.event);

    expect(events).toEqual(
      expect.arrayContaining([
        "fieldd.lifecycle.boot_started",
        "fieldd.native_link.connected",
        "fieldd.docs.registry_entry_rejected",
        "fieldd.lifecycle.ready",
        "fieldd.lifecycle.stopping",
        "fieldd.lifecycle.stopped",
      ]),
    );
    expect(
      records.find((record) => record.event === "fieldd.docs.registry_entry_rejected")?.component,
    ).toBe("docs.service");
    expect(raw).not.toContain(shellToken);
    expect(raw).not.toContain(pairingSecret);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
