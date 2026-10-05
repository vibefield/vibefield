#!/usr/bin/env node
// THE ELECTRON 43 SIGTRAP PROBE's runner (build-mv M14, M32; MV-5) — launches the
// product in the Godview lab's `worker-windows` drive
// (`electron-shell/src/testing/godview-worker-windows.ts`): windows whose swarm
// runs its physics in the view's own worker are opened and destroyed, and the
// main process must live. A main process that dies comes back here as a signal,
// and the probe says so; a drive that fails says why. Nothing is shown, nothing
// takes focus, and no input reaches the operating system.
//
//   node scripts/godview-worker-windows.mjs [--dev] [--out <log>]
//
// `--dev` serves the renderer from a Vite dev server of its own (port 5299,
// strict) instead of the packaged entry, so the same drive proves the worker
// loads as a module worker under the dev server. Needs `build:all` first (main,
// preload, the packaged renderer for the default run).

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const dev = argv.includes("--dev");
const out = resolve(option("out", join(repoRoot, ".vibefield", "godview-worker-windows.log")));
const DEV_PORT = 5299;
const log = (line) => process.stdout.write(`${line}\n`);

/** The renderer's Vite dev server, up when it answers. */
async function startDevServer(lines) {
  const server = spawn("pnpm", ["exec", "vite", "--port", String(DEV_PORT), "--strictPort"], {
    cwd: join(repoRoot, "packages", "electron-shell"),
    env: { ...process.env, TMPDIR: "/tmp" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout.on("data", (chunk) => lines.push(`[vite] ${String(chunk).trimEnd()}`));
  server.stderr.on("data", (chunk) => lines.push(`[vite] ${String(chunk).trimEnd()}`));
  const url = `http://localhost:${DEV_PORT}/`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const answer = await fetch(url);
      if (answer.ok) return { server, url };
    } catch {
      // not up yet
    }
    if (server.exitCode !== null) throw new Error(`the dev server exited ${server.exitCode}`);
    if (Date.now() > deadline) throw new Error("the dev server never answered");
    await new Promise((done) => setTimeout(done, 500));
  }
}

function runLab(env, lines) {
  return new Promise((done, fail) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "electron",
        ".",
        "--godview-perf-lab",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
      {
        cwd: join(repoRoot, "apps", "desktop"),
        env: { ...process.env, TMPDIR: "/tmp", VF_GODVIEW_LAB: "worker-windows", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (line.startsWith("GODVIEW_WORKER_WINDOWS")) log(`  ${line.slice(0, 240)}`);
        lines.push(line);
      }
    });
    child.stderr.on("data", (chunk) => lines.push(String(chunk)));
    child.on("error", fail);
    child.on("exit", (code, signal) => done({ code, signal }));
  });
}

const lines = [];
let devServer = null;
let verdict = 1;
try {
  const env = {};
  if (dev) {
    devServer = await startDevServer(lines);
    env.VITE_DEV_SERVER_URL = devServer.url;
    env.VF_GODVIEW_LAB_RENDERER = "dev";
    log(`godview worker windows · dev server ${devServer.url}`);
  } else {
    log("godview worker windows · packaged renderer");
  }
  const { code, signal } = await runLab(env, lines);
  const ok = lines.some((line) => line.startsWith('GODVIEW_WORKER_WINDOWS {"kind":"ok"'));
  if (signal !== null) {
    log(`WORKER WINDOWS PROBE FAIL: electron died with ${signal}`);
  } else if (code !== 0 || !ok) {
    log(`WORKER WINDOWS PROBE FAIL: electron exited ${code}${ok ? "" : " without the drive's ok"}`);
  } else {
    log("WORKER WINDOWS PROBE OK");
    verdict = 0;
  }
} catch (error) {
  log(`WORKER WINDOWS PROBE FAIL: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (devServer !== null) {
    try {
      process.kill(-devServer.server.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  writeFileSync(out, lines.join("\n"));
  log(`log: ${out}`);
}
process.exit(verdict);
