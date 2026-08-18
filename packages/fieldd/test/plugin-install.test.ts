import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SOCKETS } from "@vibefield/contracts";
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { semverNewer } from "../src/plugin-install";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// PLUG-P7 — the §5.3.1 distribution chain END TO END, dogfooding the REAL
// example plugin: pack examples/plugins/kv-service with the real packer,
// publish it into a SIGNED fixture registry (file://), install through
// plugins.install (signature → sha256 → traversal-proof unpack → provenance
// sidecar → §9 re-scan), watch the service ACTIVATE, then uninstall with
// data preserved (§16.5).

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_DIR = join(HERE, "..", "..", "..", "examples", "plugins", "kv-service");
const KV_ID = "vibefield.example.kv";

async function setup(options: { withUpdate?: boolean } = {}): Promise<{
  daemon: FielddDaemon;
  dataDir: string;
  registryDir: string;
  publicKey: string;
}> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-install-"));
  const registryDir = mkdtempSync(join(tmpdir(), "vf-registry-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  cleanup.push(() => rmSync(registryDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());

  // pack the REAL example plugin and publish it into a signed fixture registry
  const { bytes } = await packVfplugin({ rootDir: KV_DIR });
  const keys = generateRegistryKeypair();
  const releases = [{ manifestDir: KV_DIR, artifactBytes: bytes }];
  if (options.withUpdate === true) {
    const updateRoot = join(registryDir, "kv-0.2.0-source");
    cpSync(KV_DIR, updateRoot, { recursive: true });
    const updateManifestPath = join(updateRoot, "vibefield.plugin.json");
    const updateManifest = JSON.parse(readFileSync(updateManifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    updateManifest.version = "0.2.0";
    writeFileSync(updateManifestPath, `${JSON.stringify(updateManifest, null, 2)}\n`);
    const update = await packVfplugin({ rootDir: updateRoot });
    releases.unshift({ manifestDir: updateRoot, artifactBytes: update.bytes });
  }
  buildFixtureRegistry({
    dir: registryDir,
    plugins: releases,
    secretKey: keys.secretKey,
  });

  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    registryUrl: pathToFileURL(join(registryDir, "index.json")).href,
    registryPublicKey: keys.publicKey,
  });
  cleanup.push(() => daemon.stop());
  return { daemon, dataDir, registryDir, publicKey: keys.publicKey };
}

async function shellRpc(daemon: FielddDaemon): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, daemon.shellToken, "shell-main");
  return rpc;
}

describe("registry install — §5.3.1 end to end (the dogfood chain)", () => {
  // generous cap: install + worker activation type-strips the contracts graph
  it("installs the packed example, activates it, and uninstall preserves data", {
    timeout: 40_000,
  }, async () => {
    const { daemon, dataDir } = await setup();
    const rpc = await shellRpc(daemon);

    // before: not installed
    expect(daemon.plugins.get(KV_ID)).toBeUndefined();

    const record = (await rpc.call("plugins.install", { id: KV_ID })) as {
      id: string;
      source: string;
      registry?: { artifactSha256: string; publisher: string };
    };
    expect(record.id).toBe(KV_ID);
    expect(record.source).toBe("registry");
    // §6.3 — verified provenance rides the row
    expect(record.registry?.artifactSha256).toMatch(/^sha256:[0-9a-f]{64}$/);

    // the installed service ACTIVATES through the real worker host
    await until(
      () => daemon.plugins.snapshot().plugins.find((p) => p.id === KV_ID)?.service === "active",
      15_000,
    );
    const kv = "x.vibefield.example.kv";
    expect(await rpc.call(`${kv}.set`, { key: "a", value: "1" })).toEqual({ ok: true });
    expect(await rpc.call(`${kv}.get`, { key: "a" })).toEqual({ value: "1" });

    // updates.check: current version ⇒ no updates, nothing missing
    const check = (await rpc.call("plugins.updates.check", {})) as {
      updates: unknown[];
      missing: string[];
    };
    expect(check.updates).toEqual([]);
    expect(check.missing).toEqual([]);

    // §16.5 — uninstall removes code, PRESERVES data
    await rpc.call("plugins.uninstall", { id: KV_ID });
    expect(daemon.plugins.get(KV_ID)).toBeUndefined();
    expect(existsSync(join(dataDir, "plugins", "installed", KV_ID))).toBe(false);
    expect(existsSync(join(dataDir, "plugins", KV_ID, "data", "kv.json"))).toBe(true);
    const off = await rpc.callErr(`${kv}.get`, { key: "a" });
    expect(off.data?.kind).toBe("NOT_FOUND");
  });

  it("updates an enabled service through the coordinated private-candidate barrier", {
    timeout: 40_000,
  }, async () => {
    const { daemon } = await setup({ withUpdate: true });
    const rpc = await shellRpc(daemon);

    const installed = (await rpc.call("plugins.install", {
      id: KV_ID,
      version: "0.1.0",
    })) as { version: string; installRevision: string };
    await until(
      () =>
        daemon.plugins.snapshot().plugins.find((record) => record.id === KV_ID)?.service ===
        "active",
      15_000,
    );
    const oldRevision = installed.installRevision;

    const updated = (await rpc.call("plugins.install", { id: KV_ID })) as {
      version: string;
      installRevision: string;
      service: string;
    };
    expect(updated.version).toBe("0.2.0");
    expect(updated.installRevision).not.toBe(oldRevision);
    expect(daemon.plugins.get(KV_ID)?.installRevision).toBe(updated.installRevision);
    await until(
      () =>
        daemon.plugins.snapshot().plugins.find((record) => record.id === KV_ID)?.service ===
        "active",
      15_000,
    );
    await expect(
      rpc.call("x.vibefield.example.kv.set", { key: "after-update", value: "ready" }),
    ).resolves.toEqual({ ok: true });
  });

  it("a tampered artifact is PLUGIN_ARTIFACT_MISMATCH, discarded, never partial", async () => {
    const { daemon, registryDir } = await setup();
    const rpc = await shellRpc(daemon);
    // flip bytes in the published artifact AFTER the index signed its hash
    const artifactsDir = join(registryDir, "artifacts");
    const name = `${KV_ID}@0.1.0.vfplugin`;
    const artifact = join(artifactsDir, name);
    const bytes = readFileSync(artifact);
    bytes[Math.floor(bytes.length / 2)] = (bytes[Math.floor(bytes.length / 2)] as number) ^ 0xff;
    writeFileSync(artifact, bytes);

    const err = await rpc.callErr("plugins.install", { id: KV_ID });
    expect((err.data?.details as { pluginKind?: string })?.pluginKind).toBe(
      "PLUGIN_ARTIFACT_MISMATCH",
    );
    expect(daemon.plugins.get(KV_ID)).toBeUndefined(); // nothing half-installed
  });

  it("a tampered INDEX refuses at the signature, before any artifact fetch", async () => {
    const { daemon, registryDir } = await setup();
    const rpc = await shellRpc(daemon);
    const indexPath = join(registryDir, "index.json");
    const text = readFileSync(indexPath, "utf8");
    writeFileSync(indexPath, text.replace(/"generatedAt":\s*\d+/, '"generatedAt": 1'));
    const err = await rpc.callErr("plugins.install", { id: KV_ID });
    expect(err.message).toContain("signature");
  });
});

describe("semverNewer", () => {
  it("orders plainly", () => {
    expect(semverNewer("1.0.1", "1.0.0")).toBe(true);
    expect(semverNewer("1.0.0", "1.0.0")).toBe(false);
    expect(semverNewer("0.9.9", "1.0.0")).toBe(false);
    expect(semverNewer("2.0.0", "1.9.9")).toBe(true);
  });
});
