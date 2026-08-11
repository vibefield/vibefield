import { readFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { repoRoot } from "./paths.mjs";
import { isPidAlive, waitForPidExit } from "./processes.mjs";

// UA-D10 — run-file paths come from the contracts LAYOUT registry. The dev
// runner is plain .mjs with no build step, so it reads the COMMITTED generated
// artifact rather than importing the TS source (gen freshness is verify-gated).
const LAYOUT = createRequire(import.meta.url)(
  join(repoRoot, "packages", "contracts", "gen", "layout.json"),
);

/** UA-1 — run files live under the attached user's root. Resolve it from
 * users.json (lastAttached → fuid); a pre-user-shaped root answers itself,
 * so the runner keeps working across the migration boundary. */
export async function resolvePairRoot(dataRoot) {
  try {
    const users = JSON.parse(await readFile(join(dataRoot, ...LAYOUT.USERS_FILE), "utf8"));
    const active = users.users?.find?.((u) => u.userId === users.lastAttached) ?? users.users?.[0];
    if (active && Number.isInteger(active.fuid) && active.fuid > 0) {
      return join(dataRoot, ...LAYOUT.USERS_DIR, String(active.fuid));
    }
  } catch {
    /* absent or unreadable users.json — legacy root */
  }
  return dataRoot;
}

export async function readDevProduct(dataRoot) {
  try {
    const pairRoot = await resolvePairRoot(dataRoot);
    const value = JSON.parse(await readFile(join(pairRoot, ...LAYOUT.PRODUCT_JSON), "utf8"));
    if (
      !Number.isInteger(value.pid) ||
      value.pid <= 0 ||
      (value.nativePid !== null &&
        value.nativePid !== undefined &&
        (!Number.isInteger(value.nativePid) || value.nativePid <= 0)) ||
      (value.buildId !== null && value.buildId !== undefined && typeof value.buildId !== "string")
    ) {
      return null;
    }
    return {
      pid: value.pid,
      nativePid: value.nativePid ?? null,
      buildId: value.buildId ?? null,
    };
  } catch {
    return null;
  }
}

export async function stopVerifiedDevProduct(product, expectedBuildId, log, dataRoot) {
  if (!product) return;
  if (product.buildId !== expectedBuildId) {
    const live = [product.pid, product.nativePid].filter((pid) => pid !== null && isPidAlive(pid));
    if (live.length > 0) {
      throw new Error(
        `refusing to stop dev daemon pid ${live.join(", ")}: product build identity does not match`,
      );
    }
    if (dataRoot) await clearDeadDevProductFiles(dataRoot, product);
    return;
  }

  await stopPid(product.pid, "fieldd", log, true);
  if (product.nativePid !== null) {
    await stopPid(product.nativePid, "field-native", log, false);
  }
  if (dataRoot) await clearDeadDevProductFiles(dataRoot, product);
}

export async function clearDeadDevProductFiles(dataRoot, expectedProduct, pidAlive = isPidAlive) {
  const current = await readDevProduct(dataRoot);
  if (
    !current ||
    current.pid !== expectedProduct.pid ||
    current.nativePid !== expectedProduct.nativePid ||
    current.buildId !== expectedProduct.buildId
  ) {
    return false;
  }
  const live = [current.pid, current.nativePid].filter((pid) => pid !== null && pidAlive(pid));
  if (live.length > 0) return false;

  const pairRoot = await resolvePairRoot(dataRoot);
  await unlinkIfPresent(join(pairRoot, ...LAYOUT.SHELL_TOKEN));
  await unlinkIfPresent(join(pairRoot, ...LAYOUT.PRODUCT_JSON));
  return true;
}

async function stopPid(pid, label, log, force) {
  if (!isPidAlive(pid)) return;
  log.info(`stopping dev-owned ${label} pid ${pid}`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  if (await waitForPidExit(pid, 3_000)) return;
  if (!force) {
    log.warn(`${label} pid ${pid} did not exit after SIGTERM`);
    return;
  }
  process.kill(pid, "SIGKILL");
  await waitForPidExit(pid, 1_000);
}

async function unlinkIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
