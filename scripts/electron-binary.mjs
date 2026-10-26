#!/usr/bin/env node
// Electron's binary, fetched and proven before anything reads it (2026-10-26). Electron 43 has NO postinstall: its
// package's index.js downloads the binary (`dist/`, then `path.txt` naming it) at the first plain
// `require("electron")`, so `pnpm install` leaves none, and whatever requires Electron first downloads it mid-run. On
// CI that was a unit test, while the smoke launcher's rows read path.txt (main's verify 40333930954). Two callers
// fetch it here instead: CI's verify job, right after its install, and `siblings use` (RD-2), whose shape switch
// re-creates Electron's store directory without it. The fetch is Electron's own install.js (its `install-electron`
// bin: @electron/get's cache, checked against the package's checksums.json). The proof is the one Electron's index.js
// leans on: path.txt present, and the binary it names executable.

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `{ binary }` when path.txt names an executable file under `dist/`; `{ missing }`, in words, otherwise. */
function installedBinary(dir) {
  const pathFile = join(dir, "path.txt");
  if (!existsSync(pathFile)) return { missing: "no path.txt" };
  const named = readFileSync(pathFile, "utf8");
  const binary = join(dir, "dist", named);
  try {
    accessSync(binary, constants.X_OK);
  } catch {
    return { missing: `path.txt names dist/${named}, which is not an executable file` };
  }
  return { binary };
}

/** THIS tree's Electron, given its binary: fetched by its own install.js when it is not installed, then proven.
 * Returns null when no Electron resolves from apps/desktop, else `{ binary, installed }` (`installed`: fetched now).
 * Throws, in words, when the binary cannot be proven after the fetch. */
export function ensureElectronBinary(root = REPO_ROOT) {
  // THIS tree's Electron only — the desktop's own node_modules, then the root's — never Node's search beyond the root
  // (a parent directory's or a global folder's Electron is not the one the desktop runs)
  const found = [
    join(root, "apps", "desktop", "node_modules", "electron"),
    join(root, "node_modules", "electron"),
  ].find((candidate) => existsSync(join(candidate, "package.json")));
  if (found === undefined) return null;
  const dir = realpathSync(found);
  const before = installedBinary(dir);
  if (before.binary !== undefined) return { binary: before.binary, installed: false };
  const run = spawnSync(process.execPath, [join(dir, "install.js")], {
    cwd: dir,
    stdio: "inherit",
  });
  const after = installedBinary(dir);
  if (run.status !== 0 || after.binary === undefined) {
    throw new Error(
      `Electron's binary is not installed at ${dir} (${before.missing}), and its install.js did not restore it (exit ${run.status}${after.missing === undefined ? "" : `; ${after.missing}`}) — run \`node install.js\` there`,
    );
  }
  return { binary: after.binary, installed: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const electron = ensureElectronBinary();
    if (electron === null) {
      console.error(
        "electron-binary FAIL: no Electron resolves from apps/desktop — run `pnpm install` first",
      );
      process.exit(1);
    }
    console.log(
      `electron-binary: ${relative(realpathSync(REPO_ROOT), electron.binary)} is executable (${electron.installed ? "fetched now by Electron's install.js" : "already installed"})`,
    );
  } catch (error) {
    console.error(`electron-binary FAIL: ${error.message}`);
    process.exit(1);
  }
}
