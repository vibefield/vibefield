#!/usr/bin/env node
// The real Godview smoke, with a Chromium profile owned by this process.
// Build the desktop first, or use pnpm smoke:godview to build and run together.
// This is the way to run it: the bare `electron . --smoke-godview` refuses
// without the `--user-data-dir` this runner creates and removes.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
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
          env: process.env,
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
    if (result.signal !== null) throw new Error(`Godview smoke died with ${result.signal}`);
    if (result.code !== 0) return result.code ?? 1;
    if (verdicts.length !== 1) throw new Error("Missing or duplicate Godview smoke verdict");
    const verdict = JSON.parse(verdicts[0]);
    if (verdict.ok !== true) throw new Error("Godview smoke did not report success");
    assertLabProfileProof(verdict.profile, "Godview smoke", { expectedId: id });
    return 0;
  });
} catch (error) {
  console.error(`GODVIEW SMOKE FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
