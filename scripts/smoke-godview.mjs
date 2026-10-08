#!/usr/bin/env node
// The real Godview smoke, with a Chromium profile owned by this process.
// Build the desktop first, or use pnpm smoke:godview to build and run together.
// This is the way to run it: the bare `electron . --smoke-godview` refuses
// without the `--user-data-dir` this runner creates and removes.
// DK-18 (39), the desk landing's hygiene, carried onto this runner at DK-19's
// merge of MV: the run is MARKED (`VF_SMOKE_RUN`, the profile's name, in
// Electron's environment — every process the smoke starts inherits it, and the
// smoke's own teardown stops and waits for them by it), and once Electron has
// closed the row is taken: no process of the run may outlive the smoke
// (`apps/desktop/packaging/smoke-daemons.mjs`, `SMOKE_DAEMONS`). One left is
// said, reaped, and makes the run red, as `run-smoke.mjs` does for the others.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { leftByRun, SMOKE_RUN_ENV } from "../apps/desktop/packaging/smoke-daemons.mjs";
import { assertLabProfileProof, withLabProfile } from "./godview-lab-arms.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--terminal-direct-proof")) {
  throw new Error("Usage: node scripts/smoke-godview.mjs [--terminal-direct-proof]");
}
const root = fileURLToPath(new URL("..", import.meta.url));
const desktop = join(root, "apps", "desktop");
const marker = "SMOKE_GODVIEW ";
// The desktop's own Electron binary — what `pnpm exec electron` runs, through
// the package's path export — spawned directly, with no shell: Windows cannot
// spawn pnpm (a .cmd) without one, and a shell would split a profile path that
// has a space in it.
const electron = createRequire(join(desktop, "package.json"))("electron");

try {
  process.exitCode = await withLabProfile(async ({ directory, id }) => {
    const mark = basename(directory);
    const verdicts = [];
    const result = await new Promise((done, fail) => {
      const child = spawn(
        electron,
        [
          ".",
          "--smoke-godview",
          ...args,
          `--user-data-dir=${directory}`,
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
        ],
        {
          cwd: desktop,
          env: { ...process.env, [SMOKE_RUN_ENV]: mark },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (line.startsWith(marker)) verdicts.push(line.slice(marker.length));
      });
      let spawnError;
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code, signal) => {
        if (spawnError) fail(spawnError);
        else done({ code, signal });
      });
    });
    // The row is taken whatever the verdict, so a run's leftovers are reaped even when it failed.
    const daemons = await leftByRun(mark);
    process.stdout.write(`SMOKE_DAEMONS ${JSON.stringify(daemons)}\n`);
    if (result.signal !== null) throw new Error(`Godview smoke died with ${result.signal}`);
    if (result.code !== 0) return result.code ?? 1;
    if (verdicts.length !== 1) throw new Error("Missing or duplicate Godview smoke verdict");
    const verdict = JSON.parse(verdicts[0]);
    if (verdict.ok !== true) throw new Error("Godview smoke did not report success");
    assertLabProfileProof(verdict.profile, "Godview smoke", { expectedId: id });
    if (daemons.left.length > 0) {
      throw new Error(
        `${daemons.left.length} process(es) of this run outlived the smoke (reaped): ${daemons.left
          .map((p) => `${p.name} ${p.pid}`)
          .join(", ")}`,
      );
    }
    return 0;
  });
} catch (error) {
  console.error(`GODVIEW SMOKE FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
