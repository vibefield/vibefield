import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PluginArtifactStore } from "../src/plugin-artifact-store";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ID = "com.example.process-crash";
const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const roots: string[] = [];
const children = new Set<ChildProcess>();
let childBundle: string;

beforeAll(async () => {
  const buildRoot = await mkdtemp(join(tmpdir(), "vf-artifact-crash-build-"));
  roots.push(buildRoot);
  childBundle = join(buildRoot, "commit-child.cjs");
  await build({
    entryPoints: [join(HERE, "fixtures", "plugin-artifact-commit-child.ts")],
    outfile: childBundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });
});

afterEach(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  children.clear();
});

afterAll(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const installedRoot = await mkdtemp(join(tmpdir(), "vf-artifact-process-crash-"));
  roots.push(installedRoot);
  const store = new PluginArtifactStore(installedRoot);
  const old = await store.stage({
    pluginId: PLUGIN_ID,
    artifactSha256: sha("a"),
    prepare: async () => undefined,
  });
  await store.commit(old, null, 1);
  const candidate = await store.stage({
    pluginId: PLUGIN_ID,
    artifactSha256: sha("b"),
    prepare: async () => undefined,
  });
  return { installedRoot, store, old, candidate };
}

async function killAt(
  rig: Awaited<ReturnType<typeof fixture>>,
  failpoint: "before-rename" | "after-rename",
): Promise<void> {
  const child = fork(childBundle, [], {
    env: {
      ...process.env,
      VF_ARTIFACT_FAILPOINT: failpoint,
      VF_INSTALLED_ROOT: rig.installedRoot,
      VF_PLUGIN_ID: PLUGIN_ID,
      VF_CANDIDATE_SLOT: rig.candidate.slot,
      VF_CANDIDATE_SHA256: rig.candidate.artifactSha256,
      VF_CANDIDATE_ROOT: rig.candidate.root,
      VF_EXPECTED_SLOT: rig.old.slot,
      VF_COMMIT_EPOCH: "2",
    },
    silent: true,
  });
  children.add(child);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${failpoint}: child missed failpoint`)),
      5000,
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("message", (message) => {
      if (message !== "failpoint") return;
      clearTimeout(timeout);
      resolve();
    });
  });
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  children.delete(child);
}

describe("PRC-5g artifact pointer across real process death", () => {
  it("SIGKILL before rename reconstructs old artifact and epoch", async () => {
    const rig = await fixture();
    await killAt(rig, "before-rename");

    const restarted = new PluginArtifactStore(rig.installedRoot);
    await expect(restarted.recover()).resolves.toEqual({ removed: 1 });
    expect((await restarted.current(PLUGIN_ID))?.pointer).toMatchObject({
      slot: rig.old.slot,
      commitEpoch: 1,
    });
  });

  it("SIGKILL after rename reconstructs candidate artifact and epoch", async () => {
    const rig = await fixture();
    await killAt(rig, "after-rename");

    const restarted = new PluginArtifactStore(rig.installedRoot);
    await expect(restarted.recover()).resolves.toEqual({ removed: 0 });
    expect((await restarted.current(PLUGIN_ID))?.pointer).toMatchObject({
      slot: rig.candidate.slot,
      commitEpoch: 2,
    });
  });
});
