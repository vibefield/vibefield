#!/usr/bin/env node
// `node packaging/run-smoke.mjs <electron flags…>` — one Electron smoke (or lab) on a
// FRESH profile (DK-5): every `pnpm smoke:*` runs through here instead of `electron .`.
// It mints the profile under the OS temp, starts Electron on this app with it as
// `--user-data-dir` and the flags it was given, and once Electron has exited removes
// the profile and exits with Electron's own code — so the app's shared profile (the
// owner's theme, renderer storage, the desk's byte store) is never written by a smoke.
// DK-18 (39): the run is MARKED (`VF_SMOKE_RUN`, the profile's name, in Electron's
// environment — every process the smoke starts inherits it), and once Electron has exited
// the row is taken: no daemon of the run lives (`smoke-daemons.mjs`, `SMOKE_DAEMONS`). One
// left is reaped and makes the run red.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { leftByRun, SMOKE_RUN_ENV } from "./smoke-daemons.mjs";
import { mintSmokeProfile } from "./smoke-profile.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = createRequire(import.meta.url)("electron");
const profile = mintSmokeProfile();
const mark = basename(profile.dir);

const child = spawn(electronPath, [desktopRoot, profile.arg, ...process.argv.slice(2)], {
  cwd: desktopRoot,
  env: { ...process.env, [SMOKE_RUN_ENV]: mark },
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

const settle = async (code) => {
  const daemons = await leftByRun(mark);
  process.stdout.write(`SMOKE_DAEMONS ${JSON.stringify(daemons)}\n`);
  if (daemons.left.length > 0) {
    process.stderr.write(
      `run-smoke: ${daemons.left.length} process(es) of this run outlived the smoke (reaped): ${daemons.left
        .map((p) => `${p.name} ${p.pid}`)
        .join(", ")}\n`,
    );
  }
  const removed = profile.remove();
  process.stdout.write(
    `SMOKE_PROFILE_REMOVED ${JSON.stringify({ userData: profile.dir, removed })}\n`,
  );
  const clean = removed && daemons.left.length === 0;
  process.exit(clean ? code : code === 0 ? 1 : code);
};
child.once("error", (error) => {
  process.stderr.write(`run-smoke: Electron did not start: ${error.message}\n`);
  void settle(2);
});
child.once("exit", (code, signal) => {
  void settle(code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0)));
});
