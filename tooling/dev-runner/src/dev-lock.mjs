import { mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isPidAlive } from "./processes.mjs";
import { clearDeadDevProductFiles, readDevProduct } from "./product.mjs";

export class DevLockError extends Error {
  constructor(message) {
    super(message);
    this.name = "DevLockError";
  }
}

export async function acquireDevLock({
  lockDir,
  dataRoot,
  repoRoot,
  runnerPid = process.pid,
  pidAlive = isPidAlive,
}) {
  await mkdir(dirname(lockDir), { recursive: true });
  const ownerPath = join(lockDir, "owner.json");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDir);
      const existingProduct = await readDevProduct(dataRoot);
      const existingLive = [existingProduct?.pid, existingProduct?.nativePid].filter(
        (pid) => Number.isInteger(pid) && pidAlive(pid),
      );
      if (existingLive.length > 0) {
        await rmdir(lockDir);
        throw new DevLockError(
          `the development data root still has live daemon pid ${existingLive.join(", ")}`,
        );
      }
      if (existingProduct) {
        try {
          await clearDeadDevProductFiles(dataRoot, existingProduct, pidAlive);
        } catch (error) {
          await rmdir(lockDir);
          throw error;
        }
      }
      const initial = {
        version: 1,
        repoRoot,
        runnerPid,
        electronPid: null,
        buildId: null,
        startedAt: Date.now(),
      };
      await writeOwner(ownerPath, initial);
      return createHandle({ lockDir, ownerPath, record: initial, runnerPid });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    const stale = await readOwner(ownerPath);
    if (!stale) {
      throw new DevLockError(`development lock exists but has no valid owner record: ${ownerPath}`);
    }
    const product = await readDevProduct(dataRoot);
    const live = [
      ["runner", stale.runnerPid],
      ["Electron", stale.electronPid],
      ["fieldd", product?.pid],
      ["field-native", product?.nativePid],
    ].filter(([, pid]) => Number.isInteger(pid) && pidAlive(pid));
    if (live.length > 0) {
      throw new DevLockError(
        `another development stack is still live (${live
          .map(([name, pid]) => `${name} pid ${pid}`)
          .join(", ")})`,
      );
    }

    // The exact lock directory is known and contains only our owner record.
    // Refuse unexpected contents instead of recursively deleting them.
    await unlink(ownerPath);
    await rmdir(lockDir);
  }

  throw new DevLockError("development lock changed while it was being acquired");
}

function createHandle({ lockDir, ownerPath, record, runnerPid }) {
  let current = record;
  let released = false;
  return {
    get record() {
      return current;
    },
    async update(patch) {
      if (released) throw new DevLockError("development lock was already released");
      const onDisk = await readOwner(ownerPath);
      if (onDisk?.runnerPid !== runnerPid) {
        throw new DevLockError("development lock ownership changed unexpectedly");
      }
      current = { ...current, ...patch };
      const nextPath = `${ownerPath}.next-${runnerPid}`;
      await writeOwner(nextPath, current);
      await rename(nextPath, ownerPath);
    },
    async release() {
      if (released) return;
      released = true;
      const onDisk = await readOwner(ownerPath);
      if (onDisk?.runnerPid !== runnerPid) return;
      await unlink(ownerPath);
      await rmdir(lockDir);
    },
  };
}

async function readOwner(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      value?.version !== 1 ||
      !Number.isInteger(value.runnerPid) ||
      value.runnerPid <= 0 ||
      (value.electronPid !== null &&
        (!Number.isInteger(value.electronPid) || value.electronPid <= 0))
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function writeOwner(path, record) {
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
