// WP8c (build-wp8-bundled-plugins.md W3; WP8-D5, D7; trust-and-distribution.md §5): a KEYED bundled root through
// PluginRegistryService — the trust-root first (against the app's root keys), then the signed index (against the
// document's `bundled` role) and every listed plugin's bytes. The six cases of the kit's verifier, now as rows and
// root problems, plus a trust-root no app key signed, and the unkeyed development walk unchanged. Every key is
// minted for the test and dropped with it.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUNDLED_PLUGIN_INDEX_FILE,
  BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE,
  PluginRegistrySnapshot,
} from "@vibefield/contracts";
import {
  buildBundledIndex,
  canonicalJson,
  generateRegistryKeypair,
  signRegistryIndex,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import { PluginRegistryService } from "../src/plugin-registry";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function manifest(id: string): Record<string, unknown> {
  const objectType = `${id}.card`;
  return {
    manifestVersion: 1,
    id,
    version: "0.1.0",
    title: id,
    engines: { app: ">=0.0.0", contracts: "^0.1.0" },
    entries: { renderer: "./renderer.js" },
    activation: [`onObject:${objectType}`],
    capabilities: [],
    contributes: {
      objects: [
        {
          type: objectType,
          title: "Card",
          schemaVersion: 1,
          size: { w: 200, h: 120 },
          provides: ["desk.object"],
          binding: { kind: "card" },
        },
      ],
    },
  };
}

function sourcePlugin(root: string, id: string): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "vibefield.plugin.json"), `${JSON.stringify(manifest(id), null, 2)}\n`);
  writeFileSync(join(dir, "renderer.js"), `export default "${id}";\n`);
  return dir;
}

const otherPlatform = process.platform === "win32" ? "linux-x64" : "win32-x64";

/** A staged keyed root: a trust-root signed by its own root key, and two plugins under a signed index. */
async function keyedRoot(opts: { platform?: string } = {}) {
  const work = tmp("plugreg-bundled-");
  const rootA = generateRegistryKeypair();
  const rootB = generateRegistryKeypair();
  const release = generateRegistryKeypair();
  const bundled = generateRegistryKeypair();
  const registry = generateRegistryKeypair();
  const doc = {
    schemaVersion: 1,
    version: 1,
    expires: "2099-01-01T00:00:00Z",
    root: { threshold: 1, keys: [rootA.publicKey, rootB.publicKey] },
    roles: {
      release: { threshold: 1, keys: [release.publicKey] },
      bundled: { threshold: 1, keys: [bundled.publicKey] },
      registry: { threshold: 1, keys: [registry.publicKey] },
    },
  };
  const docBytes = Buffer.from(canonicalJson(doc));
  const trustRootPath = join(work, "trust-root.json");
  writeFileSync(trustRootPath, docBytes);
  writeFileSync(`${trustRootPath}.sig`, `${signRegistryIndex(docBytes, rootA.secretKey)}\n`);
  const sources = join(work, "src");
  const stageRoot = join(work, "bundled");
  const result = await buildBundledIndex({
    stageRoot,
    plugins: [
      { rootDir: sourcePlugin(sources, "vibefield.fixture.alpha") },
      { rootDir: sourcePlugin(sources, "vibefield.fixture.beta") },
    ],
    appVersion: "0.9.0",
    ...(opts.platform !== undefined ? { platform: opts.platform } : {}),
    secretKey: bundled.secretKey,
  });
  const service = (rootKeys = [rootA.publicKey, rootB.publicKey]) => {
    const svc = new PluginRegistryService({
      dataDir: tmp("plugreg-data-"),
      roots: { bundled: [stageRoot], devLinked: [] },
      bundledTrust: { trustRootPath, rootKeys },
    });
    cleanup.push(() => svc.dispose());
    return svc;
  };
  return { stageRoot, trustRootPath, result, service, rootA };
}

const row = (svc: PluginRegistryService, id: string) =>
  svc.snapshot().plugins.find((p) => p.id === id);

describe("a keyed bundled root (WP8c)", () => {
  it("registers every plugin of a verified index with its artifact hash and a provenance block", async () => {
    const { service, result } = await keyedRoot();
    const svc = service();
    await svc.refresh();
    const snap = svc.snapshot();
    expect(PluginRegistrySnapshot.safeParse(snap).success).toBe(true);
    expect(snap.problems).toEqual([]);
    const alpha = row(svc, "vibefield.fixture.alpha");
    const pinned = result.index.plugins["vibefield.fixture.alpha"]?.artifactSha256;
    expect(alpha?.source).toBe("bundled");
    expect(alpha?.state).not.toBe("invalid");
    expect(alpha?.installRevision).toBe(pinned?.slice("sha256:".length));
    expect(alpha?.registry).toEqual({
      indexRef: BUNDLED_PLUGIN_INDEX_FILE,
      artifactSha256: pinned,
      publisher: "vibefield",
    });
    expect(row(svc, "vibefield.fixture.beta")?.state).not.toBe("invalid");
  });

  it("a flipped byte refuses THAT row, naming the file; the other registers", async () => {
    const { service, stageRoot } = await keyedRoot();
    const js = join(stageRoot, "vibefield.fixture.alpha", "renderer.js");
    const bytes = readFileSync(js);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    writeFileSync(js, bytes);
    const svc = service();
    await svc.refresh();
    const alpha = row(svc, "vibefield.fixture.alpha");
    expect(alpha?.state).toBe("invalid");
    expect(alpha?.enabled).toBe(false);
    expect(alpha?.lastError).toEqual({
      kind: "PLUGIN_ARTIFACT_MISMATCH",
      message: "renderer.js does not match the bundled index",
    });
    expect(row(svc, "vibefield.fixture.beta")?.state).not.toBe("invalid");
    expect(svc.snapshot().problems).toEqual([]);
  });

  it("an extra file and a missing file each refuse their plugin", async () => {
    const { service, stageRoot } = await keyedRoot();
    writeFileSync(join(stageRoot, "vibefield.fixture.alpha", "payload.js"), "steal()\n");
    rmSync(join(stageRoot, "vibefield.fixture.beta", "renderer.js"));
    const svc = service();
    await svc.refresh();
    expect(row(svc, "vibefield.fixture.alpha")?.lastError?.message).toBe(
      "payload.js is not in the bundled index",
    );
    expect(row(svc, "vibefield.fixture.beta")?.lastError?.message).toBe("renderer.js is missing");
  });

  it("a forged index signature refuses the ROOT: one problem, no row from it", async () => {
    const { service, stageRoot } = await keyedRoot();
    const stranger = generateRegistryKeypair();
    const indexPath = join(stageRoot, BUNDLED_PLUGIN_INDEX_FILE);
    const forged = Buffer.from(readFileSync(indexPath, "utf8").replace("0.9.0", "0.9.1"));
    writeFileSync(indexPath, forged);
    writeFileSync(
      join(stageRoot, BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE),
      `${signRegistryIndex(forged, stranger.secretKey)}\n`,
    );
    const svc = service();
    await svc.refresh();
    const snap = svc.snapshot();
    expect(snap.plugins.filter((p) => p.source === "bundled")).toEqual([]);
    expect(snap.problems).toEqual([
      {
        root: "bundled",
        error: {
          kind: "PLUGIN_ARTIFACT_MISMATCH",
          message: "the bundled index's signature does not verify against the app's bundled key",
        },
      },
    ]);
  });

  it("a root staged for another platform refuses the ROOT", async () => {
    const { service } = await keyedRoot({ platform: otherPlatform });
    const svc = service();
    await svc.refresh();
    expect(svc.snapshot().plugins).toEqual([]);
    expect(svc.snapshot().problems[0]?.error.message).toMatch(/was staged for/);
  });

  it("a trust-root no app root key signed refuses the ROOT before any index is read", async () => {
    const { service } = await keyedRoot();
    const svc = service([generateRegistryKeypair().publicKey, generateRegistryKeypair().publicKey]);
    await svc.refresh();
    expect(svc.snapshot().plugins).toEqual([]);
    expect(svc.snapshot().problems[0]?.error.message).toMatch(
      /^the app's trust-root does not verify: the trust-root is signed by 0 of the app's root keys/,
    );
  });

  it("an UNKEYED bundled root walks by manifest as before — the developer's own tree", async () => {
    const { stageRoot } = await keyedRoot();
    const svc = new PluginRegistryService({
      dataDir: tmp("plugreg-data-"),
      roots: { bundled: [stageRoot], devLinked: [] },
    });
    cleanup.push(() => svc.dispose());
    await svc.refresh();
    const alpha = row(svc, "vibefield.fixture.alpha");
    expect(alpha?.state).not.toBe("invalid");
    expect(alpha?.registry).toBeUndefined();
  });
});
