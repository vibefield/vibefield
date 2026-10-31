import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Electron's own seam for its binary (`ELECTRON_OVERRIDE_DIST_PATH`): a stand-in Node script at the path Electron's
 * package names, run in `dist`; a launcher spawns it as it would Electron. The path is asked of Electron's package in a
 * child, exactly as the `launcher` asks it. Under the override it names `<dist>/<path.txt>` when the binary is installed
 * and `<dist>/electron` when it is not, and never downloads, so a row on it needs no binary. The rows once read
 * path.txt themselves, a file only the download writes. Electron 43 has no postinstall, so on a fresh install it
 * appears at the run's first plain `require("electron")`, and the rows raced that (CI's verify 40333930954,
 * 2026-10-26). The launcher rows of smoke-profile.test.ts (run-smoke.mjs) and smoke-first-run.test.ts
 * (run-first-run.mjs) stand on it. */
export function fakeElectron(launcher: string, dist: string, body: string): void {
  const resolved = spawnSync(
    process.execPath,
    [
      "-e",
      'process.stdout.write(require("node:module").createRequire(process.argv[1])("electron"))',
      launcher,
    ],
    { encoding: "utf8", env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: dist } },
  );
  if (resolved.status !== 0) {
    throw new Error(`Electron's package does not resolve from the launcher: ${resolved.stderr}`);
  }
  const binary = resolved.stdout;
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, `#!${process.execPath}\n${body}`);
  chmodSync(binary, 0o755);
}
