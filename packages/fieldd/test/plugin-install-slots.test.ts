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
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import { PLUGIN_CURRENT_POINTER_FILE } from "../src/plugin-artifact-store";
import { RegistryInstallService } from "../src/plugin-install";
import { PluginRegistryService } from "../src/plugin-registry";

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_SOURCE = join(HERE, "..", "..", "..", "examples", "plugins", "kv-service");
const KV_ID = "vibefield.example.kv";
let cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function temp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function release(workRoot: string, version: string) {
  const root = join(workRoot, version);
  cpSync(KV_SOURCE, root, { recursive: true });
  const manifestPath = join(root, "vibefield.plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const { bytes } = await packVfplugin({ rootDir: root });
  // MK-2c: VibeField's own rung, signed by the test's key (the gate refuses a community entry)
  return { manifestDir: root, artifactBytes: bytes, rung: "R1" as const };
}

describe("PRC-5b registry installer slots", () => {
  it("keeps discovery on old bytes until the durable candidate pointer commits", async () => {
    const dataDir = temp("vf-install-slots-data-");
    const registryDir = temp("vf-install-slots-registry-");
    const releaseWork = temp("vf-install-slots-releases-");
    const installedRoot = join(dataDir, "plugins", "installed");
    mkdirSync(installedRoot, { recursive: true });

    const older = await release(releaseWork, "0.1.0");
    const newer = await release(releaseWork, "0.2.0");
    const keys = generateRegistryKeypair();
    buildFixtureRegistry({
      dir: registryDir,
      secretKey: keys.secretKey,
      plugins: [newer, older],
    });

    const plugins = new PluginRegistryService({
      dataDir,
      roots: { bundled: [], devLinked: [], installed: [installedRoot] },
    });
    cleanup.push(() => plugins.dispose());
    await plugins.refresh();
    const installer = new RegistryInstallService({
      dataDir,
      plugins,
      registryUrl: pathToFileURL(join(registryDir, "index.json")).href,
      registryPublicKey: keys.publicKey,
    });

    const first = await installer.prepare({ id: KV_ID, version: "0.1.0" });
    expect(plugins.get(KV_ID)).toBeUndefined();
    expect(first.runtime.root).toBe(first.artifact.root);
    expect(first.runtime.record.installRevision).toBe(first.artifact.slot);
    expect(first.runtime.manifest.version).toBe("0.1.0");
    expect(existsSync(join(installedRoot, KV_ID, PLUGIN_CURRENT_POINTER_FILE))).toBe(false);
    await installer.commit(first);

    const oldRoot = plugins.rootPath(KV_ID);
    expect(plugins.get(KV_ID)?.version).toBe("0.1.0");
    expect(plugins.get(KV_ID)?.installRevision).toBe(first.artifact.slot);
    expect(oldRoot).toBe(first.artifact.root);
    expect(plugins.commitEpoch(KV_ID)).toBe(1);

    const candidate = await installer.prepare({ id: KV_ID });
    expect(candidate.version).toBe("0.2.0");
    expect(candidate.runtime.root).toBe(candidate.artifact.root);
    expect(candidate.runtime.record.installRevision).toBe(candidate.artifact.slot);
    expect(candidate.artifact.root).not.toBe(oldRoot);
    expect(plugins.get(KV_ID)?.version).toBe("0.1.0");
    expect(plugins.rootPath(KV_ID)).toBe(oldRoot);
    expect(readFileSync(join(candidate.artifact.root, "vibefield.plugin.json"), "utf8")).toContain(
      '"version": "0.2.0"',
    );

    await installer.commit(candidate);
    expect(plugins.get(KV_ID)?.version).toBe("0.2.0");
    expect(plugins.get(KV_ID)?.installRevision).toBe(candidate.artifact.slot);
    expect(plugins.rootPath(KV_ID)).toBe(candidate.artifact.root);
    expect(plugins.commitEpoch(KV_ID)).toBe(2);
    expect(readFileSync(join(oldRoot!, "vibefield.plugin.json"), "utf8")).toContain(
      '"version": "0.1.0"',
    );

    const restarted = new PluginRegistryService({
      dataDir,
      roots: { bundled: [], devLinked: [], installed: [installedRoot] },
    });
    cleanup.push(() => restarted.dispose());
    await restarted.refresh();
    expect(restarted.get(KV_ID)?.version).toBe("0.2.0");
    expect(restarted.commitEpoch(KV_ID)).toBe(2);
  });

  // Item 322 — the installer's side. The artifact it fetched matched the signed index; the folder already at that
  // artifact's slot does not hold the artifact's files. It is refused as an artifact mismatch, the kind the window
  // already has a sentence for, and the folder is left as it was found.
  it("item 322: a revision at the slot that is not the artifact's files is refused", async () => {
    const dataDir = temp("vf-install-slots-data-");
    const registryDir = temp("vf-install-slots-registry-");
    const releaseWork = temp("vf-install-slots-releases-");
    const installedRoot = join(dataDir, "plugins", "installed");
    mkdirSync(installedRoot, { recursive: true });

    const only = await release(releaseWork, "0.1.0");
    const keys = generateRegistryKeypair();
    buildFixtureRegistry({ dir: registryDir, secretKey: keys.secretKey, plugins: [only] });

    const plugins = new PluginRegistryService({
      dataDir,
      roots: { bundled: [], devLinked: [], installed: [installedRoot] },
    });
    cleanup.push(() => plugins.dispose());
    await plugins.refresh();
    const installer = new RegistryInstallService({
      dataDir,
      plugins,
      registryUrl: pathToFileURL(join(registryDir, "index.json")).href,
      registryPublicKey: keys.publicKey,
    });

    const first = await installer.prepare({ id: KV_ID, version: "0.1.0" });
    // the same folder with one file a line longer; its marker still names the artifact
    const manifestPath = join(first.artifact.root, "vibefield.plugin.json");
    writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")}\n`);
    const found = readFileSync(manifestPath, "utf8");

    const refusal = await installer.prepare({ id: KV_ID, version: "0.1.0" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).toMatchObject({
      name: "RpcCallError",
      kind: "PRECONDITION_FAILED",
      details: { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
    });
    // the refusal's words name no path
    expect((refusal as Error).message).not.toContain(dataDir);
    // what was there stays as it was found, and nothing is published
    expect(readFileSync(manifestPath, "utf8")).toBe(found);
    expect(existsSync(join(installedRoot, KV_ID, PLUGIN_CURRENT_POINTER_FILE))).toBe(false);
    expect(plugins.get(KV_ID)).toBeUndefined();
  });

  // Item 279 (S2) — the installer's side. A folder under the installed root that VibeField's own
  // install did not publish (a manifest and a provenance file, no pointer) is not an install. An
  // install over it is a first install, at epoch 1, and that folder is never copied into a
  // revision. It is laid after the registry's first walk, so this row holds the installer alone.
  it("item 279: an install over a flat folder is a first install, and the folder is not made a revision", async () => {
    const dataDir = temp("vf-install-slots-data-");
    const registryDir = temp("vf-install-slots-registry-");
    const releaseWork = temp("vf-install-slots-releases-");
    const installedRoot = join(dataDir, "plugins", "installed");
    mkdirSync(installedRoot, { recursive: true });

    const only = await release(releaseWork, "0.1.0");
    const keys = generateRegistryKeypair();
    buildFixtureRegistry({ dir: registryDir, secretKey: keys.secretKey, plugins: [only] });

    const plugins = new PluginRegistryService({
      dataDir,
      roots: { bundled: [], devLinked: [], installed: [installedRoot] },
    });
    cleanup.push(() => plugins.dispose());
    await plugins.refresh();
    const installer = new RegistryInstallService({
      dataDir,
      plugins,
      registryUrl: pathToFileURL(join(registryDir, "index.json")).href,
      registryPublicKey: keys.publicKey,
    });

    // the flat folder: the release's manifest, and a provenance file naming a hash that is not
    // the release's; no pointer. Written file by file, since the plugin's source folder holds a
    // node_modules of links.
    const flat = join(installedRoot, KV_ID);
    const flatSlot = "c".repeat(64);
    mkdirSync(flat);
    cpSync(join(only.manifestDir, "vibefield.plugin.json"), join(flat, "vibefield.plugin.json"));
    const provenance = { artifactSha256: `sha256:${flatSlot}` };
    writeFileSync(join(flat, ".vf-registry.json"), `${JSON.stringify(provenance)}\n`);

    const first = await installer.prepare({ id: KV_ID, version: "0.1.0" });
    expect(first.baseSlot).toBeNull();
    expect(first.baseCommitEpoch).toBe(0);
    expect(existsSync(join(flat, PLUGIN_CURRENT_POINTER_FILE))).toBe(false);
    expect(existsSync(join(flat, "revisions", flatSlot))).toBe(false);

    await installer.commit(first);
    expect(plugins.get(KV_ID)?.installRevision).toBe(first.artifact.slot);
    expect(plugins.commitEpoch(KV_ID)).toBe(1);
    // the flat manifest is still there, and nothing reads it
    expect(existsSync(join(flat, "vibefield.plugin.json"))).toBe(true);
  });
});
