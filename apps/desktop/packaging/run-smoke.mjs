#!/usr/bin/env node
// `node packaging/run-smoke.mjs <electron flags…>` — one Electron smoke (or lab) on a
// FRESH profile (DK-5): every `pnpm smoke:*` runs through here instead of `electron .`.
// It mints the profile under the OS temp, starts Electron on this app with it as
// `--user-data-dir` and the flags it was given, and once Electron has exited removes
// the profile and exits with Electron's own code — so the app's shared profile (the
// owner's theme, renderer storage, the desk's byte store) is never written by a smoke.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintSmokeProfile } from "./smoke-profile.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = createRequire(import.meta.url)("electron");
const profile = mintSmokeProfile();

const child = spawn(electronPath, [desktopRoot, profile.arg, ...process.argv.slice(2)], {
  cwd: desktopRoot,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

const settle = (code) => {
  const removed = profile.remove();
  process.stdout.write(
    `SMOKE_PROFILE_REMOVED ${JSON.stringify({ userData: profile.dir, removed })}\n`,
  );
  process.exit(removed ? code : code === 0 ? 1 : code);
};
child.once("error", (error) => {
  process.stderr.write(`run-smoke: Electron did not start: ${error.message}\n`);
  settle(2);
});
child.once("exit", (code, signal) => {
  settle(code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0)));
});
