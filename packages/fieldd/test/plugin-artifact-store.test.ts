import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLUGIN_CURRENT_POINTER_FILE,
  PluginArtifactStore,
  resolveInstalledArtifactRoot,
} from "../src/plugin-artifact-store";

const PLUGIN_ID = "com.example.update";
const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function store(hooks: ConstructorParameters<typeof PluginArtifactStore>[1] = {}) {
  const root = await mkdtemp(join(tmpdir(), "vf-plugin-artifacts-"));
  roots.push(root);
  return new PluginArtifactStore(root, hooks);
}

async function writeArtifact(root: string, version: string, artifactSha256: string): Promise<void> {
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(
    join(root, "vibefield.plugin.json"),
    `${JSON.stringify({ id: PLUGIN_ID, version })}\n`,
  );
  await writeFile(
    join(root, "dist", "renderer.js"),
    `export const version = ${JSON.stringify(version)};\n`,
  );
  await writeFile(
    join(root, ".vf-registry.json"),
    `${JSON.stringify({ artifactSha256, indexRef: "file:///registry/index.json", publisher: "test" })}\n`,
  );
}

async function stage(value: PluginArtifactStore, version: string, artifactSha256: string) {
  return await value.stage({
    pluginId: PLUGIN_ID,
    artifactSha256,
    prepare: async (root) => writeArtifact(root, version, artifactSha256),
  });
}

async function legacy(value: PluginArtifactStore, artifactSha256 = sha("a")): Promise<void> {
  await mkdir(value.pluginRoot(PLUGIN_ID), { recursive: true });
  await writeArtifact(value.pluginRoot(PLUGIN_ID), "1.0.0", artifactSha256);
}

describe("PRC-5b immutable plugin artifact slots", () => {
  it("adopts a flat install, stages privately, then flips one small pointer", async () => {
    const value = await store();
    await legacy(value);
    const old = await value.adoptLegacy(PLUGIN_ID);
    expect(old?.pointer.artifactSha256).toBe(sha("a"));
    expect(await resolveInstalledArtifactRoot(value.installedRoot, PLUGIN_ID)).toBe(old?.root);

    const candidate = await stage(value, "2.0.0", sha("b"));
    expect((await value.current(PLUGIN_ID))?.root).toBe(old?.root);
    expect(await readFile(join(candidate.root, "dist", "renderer.js"), "utf8")).toContain("2.0.0");

    await value.commit(candidate, old?.pointer.slot ?? null);
    expect((await value.current(PLUGIN_ID))?.root).toBe(candidate.root);
    expect(await readFile(join(old!.root, "dist", "renderer.js"), "utf8")).toContain("1.0.0");
    expect(
      await readFile(join(value.pluginRoot(PLUGIN_ID), "vibefield.plugin.json"), "utf8"),
    ).toContain("1.0.0");
  });

  it("discards a failed pre-commit candidate but never the current artifact", async () => {
    const value = await store();
    const first = await stage(value, "1.0.0", sha("a"));
    await value.commit(first, null);
    const failed = await stage(value, "2.0.0", sha("b"));

    await expect(value.discard(failed)).resolves.toBe(true);
    expect((await value.current(PLUGIN_ID))?.root).toBe(first.root);
    await expect(value.discard(first)).resolves.toBe(false);
    expect((await value.current(PLUGIN_ID))?.root).toBe(first.root);
  });

  it("a failure after pointer fsync but before rename leaves old current", async () => {
    const initial = await store();
    const first = await stage(initial, "1.0.0", sha("a"));
    await initial.commit(first, null);
    const candidate = await stage(initial, "2.0.0", sha("b"));
    const failing = new PluginArtifactStore(initial.installedRoot, {
      beforeCurrentPublish: () => {
        throw new Error("simulated power loss before pointer rename");
      },
    });

    await expect(failing.commit(candidate, first.slot)).rejects.toThrow("simulated power loss");
    expect((await initial.current(PLUGIN_ID))?.root).toBe(first.root);
    expect(await readFile(join(candidate.root, "dist", "renderer.js"), "utf8")).toContain("2.0.0");
    expect(
      (await readdir(initial.pluginRoot(PLUGIN_ID))).filter((name) =>
        name.startsWith(`${PLUGIN_CURRENT_POINTER_FILE}.tmp-`),
      ),
    ).toEqual([]);
  });

  it("compare-and-swap refuses a late concurrent candidate", async () => {
    const value = await store();
    const first = await stage(value, "1.0.0", sha("a"));
    await value.commit(first, null);
    const second = await stage(value, "2.0.0", sha("b"));
    const third = await stage(value, "3.0.0", sha("c"));

    await value.commit(second, first.slot);
    await expect(value.commit(third, first.slot)).rejects.toThrow(/stale current pointer/);
    expect((await value.current(PLUGIN_ID))?.root).toBe(second.root);
  });

  it("an invalid published pointer fails closed instead of falling back to legacy", async () => {
    const value = await store();
    await legacy(value);
    await writeFile(
      join(value.pluginRoot(PLUGIN_ID), PLUGIN_CURRENT_POINTER_FILE),
      `${JSON.stringify({
        version: 1,
        pluginId: PLUGIN_ID,
        slot: "../escape",
        artifactSha256: sha("a"),
        committedAt: Date.now(),
      })}\n`,
    );

    await expect(resolveInstalledArtifactRoot(value.installedRoot, PLUGIN_ID)).rejects.toThrow(
      /invalid current artifact pointer/,
    );
  });

  it("boot recovery removes only hidden staging/pointer temps", async () => {
    const value = await store();
    const first = await stage(value, "1.0.0", sha("a"));
    await value.commit(first, null);
    await mkdir(join(value.installedRoot, ".staging-orphan"));
    await writeFile(
      join(value.pluginRoot(PLUGIN_ID), `${PLUGIN_CURRENT_POINTER_FILE}.tmp-orphan`),
      "partial",
    );

    await expect(value.recover()).resolves.toEqual({ removed: 2 });
    expect((await value.current(PLUGIN_ID))?.root).toBe(first.root);
    expect(await readFile(join(first.root, "dist", "renderer.js"), "utf8")).toContain("1.0.0");
  });
});
