import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { until } from "./ws-rpc";

interface Fixture {
  root: string;
  logRoot: string;
  daemon: FielddDaemon;
  native: MockMgmtServer;
}

const fixtures: Fixture[] = [];
const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = join(HERE, "fixtures", "service-roots", "svc");
const SERVICE_ID = "vibefield.fixture.svc";

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
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await native.start();
  const daemon = await bootstrap({
    dataDir,
    logRoot,
    controlPort: 0,
    dataPort: 0,
    pluginRoots: { bundled: [SERVICE_ROOT] },
  });
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
    expect(daemon.pluginLogging).not.toBeNull();
    expect(daemon.health().logging).toMatchObject({
      stream: "system/fieldd",
      service: "fieldd",
      writerState: "healthy",
    });
    await until(
      () =>
        daemon.plugins.snapshot().plugins.find((plugin) => plugin.id === SERVICE_ID)?.service ===
        "active",
      8_000,
    );
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
    // POSIX mode bits are a no-op on Windows (WIN-D4). CORRECTED 2026-08-11: this used to
    // claim the ACL boundary was "proven by the packaged gate" — no packaged gate runs on
    // Windows (WIN-8 is not started), so nothing proved it. WIN-10 gives the boundary a real
    // Windows expression and asserts it directly; see the ACL rows in
    // packages/{logging,audit,users,electron-shell}/test and fieldd's product-surface.
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }

    const pluginFile = join(logRoot, "plugins", "service.ndjson");
    const pluginRaw = readFileSync(pluginFile, "utf8");
    const pluginRecords = pluginRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    for (const line of pluginRaw.trim().split("\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(16 * 1024);
    }
    expect(pluginRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "plugin.output",
          msg: "fixture service stdout",
          service: "fieldd",
          role: "worker",
          component: "plugin.service",
          plugin: {
            id: SERVICE_ID,
            version: "0.1.0",
            installRevision: expect.stringMatching(/^[0-9a-f]{12}$/),
            entry: "service",
            installSource: "bundled",
            trust: "r0-bundled",
          },
          attrs: { source: "stdout", truncated: false },
        }),
        expect.objectContaining({
          event: "plugin.log",
          msg: "fixture service activated",
          attrs: { source: "fixture", bootstrapToken: "[redacted]" },
        }),
      ]),
    );
    expect(raw).not.toContain("fixture service stdout");
    expect(pluginRaw).not.toContain("plugin-secret-canary-abcdefghijklmnopqrstuvwxyz");
    if (process.platform !== "win32") {
      expect(statSync(pluginFile).mode & 0o777).toBe(0o600);
    }
  }, 15_000);
});
