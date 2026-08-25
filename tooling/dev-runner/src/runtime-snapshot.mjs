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

const SNAPSHOT_VERSION = 2;
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
  let published = false;
  try {
    const layout = snapshotLayout(temporary, buildId, daemonBuildId, basename(paths.nativeOutput));
    await Promise.all([
      mkdir(join(layout.appRoot, "main"), { recursive: true }),
      mkdir(join(layout.appRoot, "preload"), { recursive: true }),
      mkdir(join(temporary, "fieldd"), { recursive: true }),
      mkdir(join(temporary, "native"), { recursive: true }),
    ]);
    await Promise.all([
      copyFile(paths.mainOutput, join(layout.appRoot, "main", "index.cjs")),
      copyFile(paths.preloadOutput, join(layout.appRoot, "preload", "index.cjs")),
      copyFile(paths.fielddOutput, layout.fielddOutput),
      copyFile(paths.serviceHarnessOutput, join(temporary, "fieldd", "service-harness.mjs")),
      copyFile(paths.fielddWasm, join(temporary, "fieldd", "loro_wasm_bg.wasm")),
      copyFile(paths.nativeOutput, layout.nativeOutput),
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
    const nativeMode = (await stat(paths.nativeOutput)).mode & 0o777;
    await chmod(layout.nativeOutput, nativeMode);

    if (!(await validate())) throw new RuntimeSnapshotChangedError();
    await writeFile(
      join(temporary, "runtime.json"),
      `${JSON.stringify(
        {
          version: SNAPSHOT_VERSION,
          buildId,
          daemonBuildId,
          nativeName: basename(paths.nativeOutput),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    try {
      await rename(temporary, destination);
      published = true;
      return snapshotLayout(destination, buildId, daemonBuildId, basename(paths.nativeOutput));
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
      return snapshotLayout(destination, buildId, daemonBuildId, basename(paths.nativeOutput));
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
    if (
      record?.version !== SNAPSHOT_VERSION ||
      record.buildId !== expectedBuildId ||
      !BUILD_ID.test(record.daemonBuildId ?? "") ||
      typeof record.nativeName !== "string" ||
      basename(record.nativeName) !== record.nativeName
    ) {
      return null;
    }
    return snapshotLayout(root, record.buildId, record.daemonBuildId, record.nativeName);
  } catch {
    return null;
  }
}

function snapshotLayout(root, buildId, daemonBuildId, nativeName) {
  return Object.freeze({
    buildId,
    daemonBuildId,
    root,
    appRoot: join(root, "app"),
    fielddOutput: join(root, "fieldd", "bin.cjs"),
    nativeOutput: join(root, "native", nativeName),
  });
}

function destinationAlreadyExists(error) {
  return error?.code === "EEXIST" || error?.code === "ENOTEMPTY" || error?.code === "EPERM";
}
