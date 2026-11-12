import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLUGIN_CURRENT_POINTER_FILE,
  PluginArtifactCommitIndeterminateError,
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
  it("stages privately, then flips one small pointer", async () => {
    const value = await store();
    const first = await stage(value, "1.0.0", sha("a"));
    await value.commit(first, null, 1);
    const old = await value.current(PLUGIN_ID);
    expect(old?.pointer.artifactSha256).toBe(sha("a"));
    expect(await resolveInstalledArtifactRoot(value.installedRoot, PLUGIN_ID)).toBe(old?.root);

    const candidate = await stage(value, "2.0.0", sha("b"));
    expect((await value.current(PLUGIN_ID))?.root).toBe(old?.root);
    expect(await readFile(join(candidate.root, "dist", "renderer.js"), "utf8")).toContain("2.0.0");

    await value.commit(candidate, old?.pointer.slot ?? null, 2);
    expect((await value.current(PLUGIN_ID))?.root).toBe(candidate.root);
    expect(await readFile(join(old!.root, "dist", "renderer.js"), "utf8")).toContain("1.0.0");
  });

  it("discards a failed pre-commit candidate but never the current artifact", async () => {
    const value = await store();
    const first = await stage(value, "1.0.0", sha("a"));
    await value.commit(first, null, 1);
    const failed = await stage(value, "2.0.0", sha("b"));

    await expect(value.discard(failed)).resolves.toBe(true);
    expect((await value.current(PLUGIN_ID))?.root).toBe(first.root);
    await expect(value.discard(first)).resolves.toBe(false);
    expect((await value.current(PLUGIN_ID))?.root).toBe(first.root);
  });

  it("a failure after pointer fsync but before rename leaves old current", async () => {
    const initial = await store();
    const first = await stage(initial, "1.0.0", sha("a"));
    await initial.commit(first, null, 1);
    const candidate = await stage(initial, "2.0.0", sha("b"));
    const failing = new PluginArtifactStore(initial.installedRoot, {
      beforeCurrentPublish: () => {
        throw new Error("simulated power loss before pointer rename");
      },
    });

    await expect(failing.commit(candidate, first.slot, 2)).rejects.toThrow("simulated power loss");
    expect((await initial.current(PLUGIN_ID))?.root).toBe(first.root);
    expect(await readFile(join(candidate.root, "dist", "renderer.js"), "utf8")).toContain("2.0.0");
    expect(
      (await readdir(initial.pluginRoot(PLUGIN_ID))).filter((name) =>
        name.startsWith(`${PLUGIN_CURRENT_POINTER_FILE}.tmp-`),
      ),
    ).toEqual([]);
  });

  it("a failure after rename is indeterminate and restart selects the complete candidate epoch", async () => {
    const initial = await store();
    const first = await stage(initial, "1.0.0", sha("a"));
    await initial.commit(first, null, 1);
    const candidate = await stage(initial, "2.0.0", sha("b"));
    const failing = new PluginArtifactStore(initial.installedRoot, {
      afterCurrentPublish: () => {
        throw new Error("simulated process death after pointer rename");
      },
    });

    await expect(failing.commit(candidate, first.slot, 2)).rejects.toBeInstanceOf(
      PluginArtifactCommitIndeterminateError,
    );
    const restarted = new PluginArtifactStore(initial.installedRoot);
    expect((await restarted.current(PLUGIN_ID))?.pointer).toMatchObject({
      slot: candidate.slot,
      artifactSha256: candidate.artifactSha256,
      commitEpoch: 2,
    });
  });

  it("reads a legacy v1 pointer as epoch 1 and writes the next artifact and epoch as v2", async () => {
    const value = await store();
    const first = await stage(value, "1.0.0", sha("a"));
    await value.commit(first, null, 1);
    const pointerPath = join(value.pluginRoot(PLUGIN_ID), PLUGIN_CURRENT_POINTER_FILE);
    const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as Record<string, unknown>;
    delete pointer.commitEpoch;
    pointer.version = 1;
    await writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);

    expect(
      (await new PluginArtifactStore(value.installedRoot).current(PLUGIN_ID))?.pointer,
    ).toMatchObject({ version: 2, slot: first.slot, commitEpoch: 1 });
    const second = await stage(value, "2.0.0", sha("b"));
    await value.commit(second, first.slot, 2);
    expect(JSON.parse(await readFile(pointerPath, "utf8"))).toMatchObject({
      version: 2,
      slot: second.slot,
      commitEpoch: 2,
    });
  });

  it("refuses skipped epochs and same-artifact retries carrying a different epoch", async () => {
    const value = await store();
    const first = await stage(value, "1.0.0", sha("a"));
    await expect(value.commit(first, null, 2)).rejects.toThrow(/expected commit epoch 1/);
    await value.commit(first, null, 1);
    await expect(value.commit(first, null, 2)).rejects.toThrow(/retry expected epoch 1/);
    const second = await stage(value, "2.0.0", sha("b"));
    await expect(value.commit(second, first.slot, 3)).rejects.toThrow(/expected commit epoch 2/);
  });

  it("compare-and-swap refuses a late concurrent candidate", async () => {
    const value = await store();
    const first = await stage(value, "1.0.0", sha("a"));
    await value.commit(first, null, 1);
    const second = await stage(value, "2.0.0", sha("b"));
    const third = await stage(value, "3.0.0", sha("c"));

    await value.commit(second, first.slot, 2);
    await expect(value.commit(third, first.slot, 3)).rejects.toThrow(/stale current pointer/);
    expect((await value.current(PLUGIN_ID))?.root).toBe(second.root);
  });

  it("an invalid published pointer fails closed, whatever lies beside it", async () => {
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
    await value.commit(first, null, 1);
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

// Item 322 — a revision slot is named by the artifact's hash, and a folder that is already there says so only by
// its own marker, which whoever wrote the folder also wrote. So a slot that exists is never taken on its marker's
// word: the caller's `prepare` (the unpack of the bytes it fetched and hashed, and its checks of them) always runs,
// and the folder is reused only when it holds exactly what `prepare` made.
describe("item 322: a revision slot that already exists is not taken on its marker's word", () => {
  const stagingLeft = async (value: PluginArtifactStore): Promise<string[]> =>
    (await readdir(value.installedRoot)).filter((name) => name.startsWith(".staging-"));

  it("refuses a slot whose files are not what prepare made, and leaves it", async () => {
    const value = await store();
    // a folder at the slot of sha("a"), with a marker that names sha("a"), holding other bytes
    const there = await stage(value, "0.0.0-other", sha("a"));

    await expect(stage(value, "1.0.0", sha("a"))).rejects.toMatchObject({
      name: "PluginArtifactSlotMismatchError",
    });
    // what was there is not replaced and not removed: it may be the current revision
    expect(await readFile(join(there.root, "dist", "renderer.js"), "utf8")).toContain(
      "0.0.0-other",
    );
    expect(await stagingLeft(value)).toEqual([]);
  });

  it("runs prepare for a slot that exists, and reuses it when the files are the same", async () => {
    const value = await store();
    let prepared = 0;
    const once = () =>
      value.stage({
        pluginId: PLUGIN_ID,
        artifactSha256: sha("a"),
        prepare: async (root) => {
          prepared += 1;
          await writeArtifact(root, "1.0.0", sha("a"));
        },
      });
    const first = await once();
    const second = await once();

    expect(prepared).toBe(2);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.root).toBe(first.root);
    expect(await stagingLeft(value)).toEqual([]);
  });

  it("hears a prepare that refuses, though the slot exists", async () => {
    const value = await store();
    await stage(value, "1.0.0", sha("a"));

    await expect(
      value.stage({
        pluginId: PLUGIN_ID,
        artifactSha256: sha("a"),
        prepare: async () => {
          throw new Error("the artifact's manifest names another plugin");
        },
      }),
    ).rejects.toThrow("the artifact's manifest names another plugin");
    expect(await stagingLeft(value)).toEqual([]);
  });

  it("tells a longer file, a missing file and an extra file", async () => {
    for (const change of ["longer", "missing", "extra"] as const) {
      const value = await store();
      await stage(value, "1.0.0", sha("a"));
      await expect(
        value.stage({
          pluginId: PLUGIN_ID,
          artifactSha256: sha("a"),
          prepare: async (root) => {
            await writeArtifact(root, "1.0.0", sha("a"));
            if (change === "longer") {
              const file = join(root, "dist", "renderer.js");
              await writeFile(file, `${await readFile(file, "utf8")}\n`);
            } else if (change === "missing") {
              await rm(join(root, "dist", "renderer.js"));
            } else {
              await writeFile(join(root, "dist", "more.js"), "export {};\n");
            }
          },
        }),
        change,
      ).rejects.toMatchObject({ name: "PluginArtifactSlotMismatchError" });
    }
  });
});
