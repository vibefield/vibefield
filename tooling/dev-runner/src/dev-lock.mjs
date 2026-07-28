import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { isPidAlive } from "./processes.mjs";
import { clearDeadDevProductFiles, readDevProduct } from "./product.mjs";

const OWNER_FILE = "owner.json";
const RECLAIM_DIRECTORY = ".reclaim";

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
  const ownerPath = join(lockDir, OWNER_FILE);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const initial = {
      version: 1,
      repoRoot,
      runnerPid,
      electronPid: null,
      buildId: null,
      startedAt: Date.now(),
    };
    if (await publishInitializedLock(lockDir, initial)) {
      try {
        // Publication is atomic: every contender sees either no lock or this
        // complete owner record. Check the daemon root only after publication,
        // while this runner has exclusive authority to clean stale run files.
        const existingProduct = await readDevProduct(dataRoot);
        const existingLive = [existingProduct?.pid, existingProduct?.nativePid].filter(
          (pid) => Number.isInteger(pid) && pidAlive(pid),
        );
        if (existingLive.length > 0) {
          // Daemons outlive Electron by design (dev is leave-running), so a
          // crashed runner strands a live pair here. Refusal stays the safe
          // default (pid reuse makes blind kills wrong), but the message must
          // carry the remedy or the user is stuck.
          throw new DevLockError(
            `the development data root still has live daemon pid ${existingLive.join(
              ", ",
            )} — a previous dev session exited uncleanly; stop them with: kill ${existingLive.join(" ")}`,
          );
        }
        if (existingProduct) {
          await clearDeadDevProductFiles(dataRoot, existingProduct, pidAlive);
        }
      } catch (error) {
        await removeOwnedLock(lockDir, runnerPid);
        throw error;
      }
      return createHandle({ lockDir, ownerPath, record: initial, runnerPid });
    }

    const stale = await readOwner(ownerPath);
    const product = await readDevProduct(dataRoot);
    const live = liveOwners(stale, product, pidAlive);
    if (live.length > 0) {
      throw new DevLockError(describeLiveStack(live));
    }

    if (!(await reclaimStaleLock({ lockDir, runnerPid, dataRoot, pidAlive }))) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  throw new DevLockError("development lock changed while it was being acquired");
}

async function publishInitializedLock(lockDir, record) {
  const candidate = await mkdtemp(`${lockDir}.candidate-${record.runnerPid}-`);
  const candidateOwner = join(candidate, OWNER_FILE);
  let published = false;
  try {
    await writeOwner(candidateOwner, record);
    try {
      await rename(candidate, lockDir);
      published = true;
      return true;
    } catch (error) {
      if (!destinationAlreadyExists(error)) throw error;
      return false;
    }
  } finally {
    if (!published) {
      await unlinkIfPresent(candidateOwner);
      await rmdirIfPresent(candidate);
    }
  }
}

async function reclaimStaleLock({ lockDir, runnerPid, dataRoot, pidAlive }) {
  const claimPath = join(lockDir, RECLAIM_DIRECTORY);
  try {
    await mkdir(claimPath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    throw error;
  }

  let claimAtCanonicalPath = true;
  try {
    // Revalidate after winning the in-directory claim. No other compliant
    // reclaimer can replace this directory while the claim is present.
    const stale = await readOwner(join(lockDir, OWNER_FILE));
    const product = await readDevProduct(dataRoot);
    const live = liveOwners(stale, product, pidAlive);
    if (live.length > 0) {
      throw new DevLockError(describeLiveStack(live));
    }

    const entries = await readdir(lockDir);
    const unexpected = entries.filter(
      (entry) => entry !== OWNER_FILE && entry !== RECLAIM_DIRECTORY,
    );
    if (unexpected.length > 0) {
      throw new DevLockError(
        `development lock contains unexpected entries: ${unexpected.sort().join(", ")}`,
      );
    }

    // Move the claimed directory out of the canonical namespace atomically.
    // A contender can now publish a fully initialized replacement, but it
    // cannot delete or mutate this reclaimer's private quarantine.
    const quarantine = `${lockDir}.reclaimed-${runnerPid}-${randomBytes(6).toString("hex")}`;
    await rename(lockDir, quarantine);
    claimAtCanonicalPath = false;
    await unlinkIfPresent(join(quarantine, OWNER_FILE));
    await rmdir(join(quarantine, RECLAIM_DIRECTORY));
    await rmdir(quarantine);
    return true;
  } finally {
    if (claimAtCanonicalPath) await rmdirIfPresent(claimPath);
  }
}

function describeLiveStack(live) {
  const names = live.map(([name, pid]) => `${name} pid ${pid}`).join(", ");
  const daemonsOnly = live.every(([name]) => name === "fieldd" || name === "field-native");
  if (!daemonsOnly) return `another development stack is still live (${names})`;
  // Runner and Electron are gone but the pair survived (dev is
  // leave-running): tell the user how to get unstuck instead of only why.
  return `another development stack is still live (${names}) — the previous runner is gone; stop the daemons with: kill ${live
    .map(([, pid]) => pid)
    .join(" ")}`;
}

function liveOwners(owner, product, pidAlive) {
  return [
    ["runner", owner?.runnerPid],
    ["Electron", owner?.electronPid],
    ["fieldd", product?.pid],
    ["field-native", product?.nativePid],
  ].filter(([, pid]) => Number.isInteger(pid) && pidAlive(pid));
}

async function removeOwnedLock(lockDir, runnerPid) {
  const ownerPath = join(lockDir, OWNER_FILE);
  const onDisk = await readOwner(ownerPath);
  if (onDisk?.runnerPid !== runnerPid) return;
  await unlinkIfPresent(ownerPath);
  await rmdirIfPresent(lockDir);
}

function destinationAlreadyExists(error) {
  return error?.code === "EEXIST" || error?.code === "ENOTEMPTY" || error?.code === "EPERM";
}

async function unlinkIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function rmdirIfPresent(path) {
  try {
    await rmdir(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
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
