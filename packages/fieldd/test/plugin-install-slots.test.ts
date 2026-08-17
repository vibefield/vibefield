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
  return { manifestDir: root, artifactBytes: bytes };
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
    expect(readFileSync(join(oldRoot!, "vibefield.plugin.json"), "utf8")).toContain(
      '"version": "0.1.0"',
    );
  });
});
