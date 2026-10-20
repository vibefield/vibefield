import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

// 6 — TC-S2: the floor's cell joins it, beside the floor. A version-5 snapshot has no cell, and
// served again it would hand the floor nothing to spawn its terminals from.
// 7 — F1: the floor's freeway host joins them. A version-6 snapshot has no host, and its floor
// would say "the freeway host is not installed beside this floor" for as long as it ran.
const SNAPSHOT_VERSION = 7;
const BUILD_ID = /^dev-[a-f0-9]{24}$/;

export class RuntimeSnapshotChangedError extends Error {
  constructor() {
    super("runtime outputs changed while their development snapshot was being staged");
    this.name = "RuntimeSnapshotChangedError";
  }
}

export async function stageRuntimeSnapshot({
  paths,
  buildId,
  daemonBuildId,
  validate = async () => true,
}) {
  if (!BUILD_ID.test(buildId)) throw new Error(`invalid development build identity: ${buildId}`);
  if (!BUILD_ID.test(daemonBuildId)) {
    throw new Error(`invalid development daemon build identity: ${daemonBuildId}`);
  }
  await mkdir(paths.runtimeRoot, { recursive: true });
  const destination = join(paths.runtimeRoot, buildId);
  const existing = await readSnapshot(destination, buildId);
  if (existing !== null) return existing;

  const temporary = await mkdtemp(join(paths.runtimeRoot, `.next-${buildId}-`));
  const names = nativeNames(paths);
  let published = false;
  try {
    const layout = snapshotLayout(temporary, buildId, daemonBuildId, names);
    await Promise.all([
      mkdir(join(layout.appRoot, "main"), { recursive: true }),
      mkdir(join(layout.appRoot, "preload"), { recursive: true }),
      mkdir(join(temporary, "fieldd"), { recursive: true }),
      mkdir(join(temporary, "native"), { recursive: true }),
    ]);
    await Promise.all([
      copyFile(paths.mainOutput, join(layout.appRoot, "main", "index.cjs")),
      copyFile(paths.preloadOutput, join(layout.appRoot, "preload", "index.cjs")),
      copyFile(paths.studioPreloadOutput, join(layout.appRoot, "preload", "studio.cjs")),
      copyFile(paths.fielddOutput, layout.fielddOutput),
      copyFile(paths.serviceHarnessOutput, join(temporary, "fieldd", "service-harness.mjs")),
      copyFile(paths.fielddWasm, join(temporary, "fieldd", "loro_wasm_bg.wasm")),
      copyFile(paths.agentShimOutput, join(temporary, "fieldd", "agent-shim.cjs")),
      // FS-1a — the files worker's bundle and mille's engine, beside bin.cjs
      copyFile(paths.filesHostOutput, join(temporary, "fieldd", basename(paths.filesHostOutput))),
      copyFile(
        paths.milleNativeOutput,
        join(temporary, "fieldd", basename(paths.milleNativeOutput)),
      ),
      copyFile(paths.nativeOutput, layout.nativeOutput),
      // TC-S2 — the floor spawns its cell as its own SIBLING, so the cell rides beside it
      copyFile(paths.cellOutput, layout.cellOutput),
      // F1 — and its freeway host the same way (field-native `config.rs` `freeway_binary()`)
      copyFile(paths.freewayOutput, layout.freewayOutput),
      writeFile(
        join(layout.appRoot, "package.json"),
        `${JSON.stringify(
          {
            name: "vibefield-development-runtime",
            private: true,
            version: "0.0.0-dev",
            main: "main/index.cjs",
          },
          null,
          2,
        )}\n`,
      ),
    ]);
    // Each executable keeps its own mode: copyFile does not carry it.
    for (const [source, staged] of [
      [paths.nativeOutput, layout.nativeOutput],
      [paths.cellOutput, layout.cellOutput],
      [paths.freewayOutput, layout.freewayOutput],
    ]) {
      await chmod(staged, (await stat(source)).mode & 0o777);
    }

    if (!(await validate())) throw new RuntimeSnapshotChangedError();
    const record = { version: SNAPSHOT_VERSION, buildId, daemonBuildId, ...names };
    await writeFile(join(temporary, "runtime.json"), `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });

    try {
      await rename(temporary, destination);
      published = true;
      return snapshotLayout(destination, buildId, daemonBuildId, names);
    } catch (error) {
      if (!destinationAlreadyExists(error)) throw error;
      const concurrent = await readSnapshot(destination, buildId);
      if (concurrent !== null) return concurrent;
      // The occupant is not a valid snapshot for this identity (an older
      // snapshot version, or a torn write) — junk squatting on our name.
      // Clear it and publish; without this, a leftover v1 directory would
      // block this identity forever.
      await rm(destination, { recursive: true, force: true });
      await rename(temporary, destination);
      published = true;
      return snapshotLayout(destination, buildId, daemonBuildId, names);
    }
  } finally {
    if (!published) await rm(temporary, { recursive: true, force: true });
  }
}

export async function pruneRuntimeSnapshots(runtimeRoot, keepBuildIds) {
  let entries;
  try {
    entries = await readdir(runtimeRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() && BUILD_ID.test(entry.name) && !keepBuildIds.has(entry.name),
      )
      .map((entry) => rm(join(runtimeRoot, entry.name), { recursive: true, force: true })),
  );
}

async function readSnapshot(root, expectedBuildId) {
  try {
    const record = JSON.parse(await readFile(join(root, "runtime.json"), "utf8"));
    const names = {
      nativeName: record?.nativeName,
      cellName: record?.cellName,
      freewayName: record?.freewayName,
    };
    if (
      record?.version !== SNAPSHOT_VERSION ||
      record.buildId !== expectedBuildId ||
      !BUILD_ID.test(record.daemonBuildId ?? "") ||
      !Object.values(names).every(isBareName)
    ) {
      return null;
    }
    return snapshotLayout(root, record.buildId, record.daemonBuildId, names);
  } catch {
    return null;
  }
}

/** The floor's executables, staged side by side in `native/`: the floor finds its cell and
 * its freeway host as its own siblings (field-native `config.rs`: `cell_binary()`,
 * `freeway_binary()`). */
function nativeNames(paths) {
  return {
    nativeName: basename(paths.nativeOutput),
    cellName: basename(paths.cellOutput),
    freewayName: basename(paths.freewayOutput),
  };
}

function isBareName(name) {
  return typeof name === "string" && basename(name) === name;
}

function snapshotLayout(root, buildId, daemonBuildId, { nativeName, cellName, freewayName }) {
  return Object.freeze({
    buildId,
    daemonBuildId,
    root,
    appRoot: join(root, "app"),
    fielddOutput: join(root, "fieldd", "bin.cjs"),
    nativeOutput: join(root, "native", nativeName),
    cellOutput: join(root, "native", cellName),
    freewayOutput: join(root, "native", freewayName),
  });
}

function destinationAlreadyExists(error) {
  return error?.code === "EEXIST" || error?.code === "ENOTEMPTY" || error?.code === "EPERM";
}
