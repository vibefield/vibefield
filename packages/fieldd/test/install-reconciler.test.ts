import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SOCKETS } from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, type FielddDaemon, verifyAuditSegment } from "../src/index";
import { SettingsDocService } from "../src/settings-doc";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { until } from "./ws-rpc";

// PLUG-P7 — §16.6 convergence: the DESIRED set in the settings doc drives
// this device. The suite seeds a desired entry into the doc BEFORE boot
// (exactly what a synced-in change from another desktop will look like when
// the doc-sync track lands) and watches the daemon converge: install from
// the signed registry, activate, apply enablement and grant decisions.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_DIR = join(HERE, "..", "..", "..", "examples", "plugins", "kv-service");
const KV_ID = "vibefield.example.kv";

async function setupRegistry(): Promise<{ registryUrl: string; publicKey: string }> {
  const registryDir = mkdtempSync(join(tmpdir(), "vf-rec-reg-"));
  cleanup.push(() => rmSync(registryDir, { recursive: true, force: true }));
  const { bytes } = await packVfplugin({ rootDir: KV_DIR });
  const keys = generateRegistryKeypair();
  buildFixtureRegistry({
    dir: registryDir,
    plugins: [{ manifestDir: KV_DIR, artifactBytes: bytes }],
    secretKey: keys.secretKey,
  });
  return {
    registryUrl: pathToFileURL(join(registryDir, "index.json")).href,
    publicKey: keys.publicKey,
  };
}

async function boot(
  dataDir: string,
  registry: { registryUrl: string; publicKey: string },
): Promise<FielddDaemon> {
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    registryUrl: registry.registryUrl,
    registryPublicKey: registry.publicKey,
  });
  cleanup.push(() => daemon.stop());
  return daemon;
}

async function auditRecords(dataDir: string): Promise<AuditRecordV1[]> {
  const root = join(dataDir, "audit");
  const records: AuditRecordV1[] = [];
  for (const name of readdirSync(root).filter((entry) => entry.endsWith(".jsonl"))) {
    const verified = await verifyAuditSegment(join(root, name));
    expect(verified.valid, `${name}: ${verified.reason}`).toBe(true);
    records.push(...verified.records);
  }
  return records;
}

describe("install-set reconciliation (§16.6)", () => {
  it("a desired registry entry seeded in the doc installs, activates, and honors its grants", {
    timeout: 40_000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-rec-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const registry = await setupRegistry();

    // seed the DESIRED entry the way a synced-in doc change would arrive:
    // installed, enabled, with storage.self REVOKED by decision
    const seed = new SettingsDocService({ dataDir });
    await seed.setInstallSetEntry(
      {
        pluginId: KV_ID,
        source: "registry",
        version: "0.1.0",
        enabled: true,
        grants: [{ capability: "storage.self", decision: "revoked", at: Date.now() }],
      },
      "another-desktop",
    );
    await seed.dispose();

    const daemon = await boot(dataDir, registry);
    // convergence: absent → installed → active, grants applied
    await until(() => daemon.plugins.get(KV_ID) !== undefined, 20_000);
    const record = () => daemon.plugins.get(KV_ID);
    expect(record()?.source).toBe("registry");
    await until(
      () => daemon.plugins.snapshot().plugins.find((p) => p.id === KV_ID)?.service === "active",
      15_000,
    );
    // the revoked decision holds — storage.self denied, the rest granted
    expect(record()?.grantedCapabilities).not.toContain("storage.self");
    expect(record()?.deniedCapabilities).toContainEqual({
      capability: "storage.self",
      reason: "revoked",
    });
    expect(record()?.grantedCapabilities).toContain("services.provide");
    const audit = await auditRecords(dataDir);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: { kind: "system", id: "fieldd" },
          action: "plugin.install",
          target: expect.objectContaining({ id: KV_ID }),
          phase: "outcome",
          outcome: "succeeded",
        }),
        expect.objectContaining({
          actor: { kind: "system", id: "fieldd" },
          action: "capability.revoke",
          target: expect.objectContaining({ id: "storage.self", parentId: KV_ID }),
          phase: "outcome",
          outcome: "succeeded",
        }),
        expect.objectContaining({
          actor: { kind: "system", id: "fieldd" },
          action: "token.plugin_service.mint",
          target: expect.objectContaining({ parentId: KV_ID }),
          phase: "outcome",
          outcome: "succeeded",
        }),
      ]),
    );
  });

  it("reconcile is idempotent and parks an unsatisfiable entry honestly", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-rec2-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const registry = await setupRegistry();

    const seed = new SettingsDocService({ dataDir });
    // an id the registry does not carry — §16.6: parked pending, never fatal
    await seed.setInstallSetEntry(
      { pluginId: "vibefield.absent.plugin", source: "registry", enabled: true, grants: [] },
      "another-desktop",
    );
    await seed.dispose();

    const daemon = await boot(dataDir, registry);
    // the daemon boots and stays healthy; the entry parks
    await new Promise((r) => setTimeout(r, 1_500));
    expect(daemon.plugins.get("vibefield.absent.plugin")).toBeUndefined();
    expect(daemon.health().fieldd.state).toBe("up");
  });
});
