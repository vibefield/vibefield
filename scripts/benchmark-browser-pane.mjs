#!/usr/bin/env node
// Uses the product canvas smoke with a fresh profile. Build the worktree first.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "canvas" },
    label: { type: "string", default: "candidate" },
    out: { type: "string" },
    seconds: { type: "string", default: "12" },
    warmup: { type: "string", default: "20" },
    fps: { type: "string", default: "60" },
    agent: { type: "string" },
    panes: { type: "string", default: "1" },
    interactive: { type: "boolean", default: false },
    ui: { type: "boolean", default: false },
    "playback-only": { type: "boolean", default: false },
    "source-fps": { type: "string" },
    "source-only": { type: "boolean", default: false },
  },
});
const ui = values.ui || values["playback-only"];
if (![1, 2, 4, 6].includes(Number(values.panes))) throw Error("--panes must be 1, 2, 4 or 6");
if (ui && (values.mode !== "canvas" || Number(values.panes) !== 1))
  throw Error("UI playback checks require canvas mode and one pane");
if (values.interactive && (values.mode !== "canvas" || (!ui && Number(values.panes) < 2)))
  throw Error("--interactive requires a canvas UI playback check or --panes 2, 4 or 6");
if (values.mode === "native" && Number(values.panes) > 1)
  throw Error("Multi-pane runs use canvas mode");
if (!["canvas", "native"].includes(values.mode)) throw Error("--mode must be canvas or native");
for (const k of ["seconds", "warmup"])
  if (!(Number(values[k]) >= 1 && Number(values[k]) <= 120))
    throw Error(`--${k} must be 1–120 seconds`);
if (![60, 120].includes(Number(values.fps))) throw Error("--fps must be 60 or 120");
if (values["source-fps"] && ![30, 60, 120].includes(Number(values["source-fps"])))
  throw Error("--source-fps must be 30, 60 or 120");
if (Number(values.panes) > 1 && (values["source-fps"] || values["source-only"]))
  throw Error("Source diagnostics require one pane");
if (!/^[a-zA-Z0-9_-]+$/.test(values.label)) throw Error("--label must be a short name");
const base = join(repo, ".vibefield/browser-perf");
mkdirSync(base, { recursive: true });
const out = resolve(values.out ?? join(base, `${values.label}-${Date.now()}`));
const reportName = ui ? "ui-report.json" : "report.json";
if (existsSync(join(out, reportName)))
  throw Error("Use a new output directory; an existing report will not be replaced");
mkdirSync(out, { recursive: true });
const lock = join(base, "run.lock");
const fd = openSync(lock, "wx");
writeFileSync(fd, String(process.pid));
closeSync(fd);
try {
  const hashes = {};
  for (const file of [
    "packages/electron-shell/dist/main/index.cjs",
    "packages/electron-shell/dist/preload/index.cjs",
    "packages/electron-shell/dist/testing/smoke.cjs",
    "plugins/browser-pane/dist/renderer.js",
  ]) {
    if (existsSync(join(repo, file)))
      hashes[file] = createHash("sha256")
        .update(readFileSync(join(repo, file)))
        .digest("hex");
  }
  writeFileSync(
    join(out, "build.json"),
    JSON.stringify(
      {
        commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
        status: execFileSync("git", ["status", "--short"], { cwd: repo, encoding: "utf8" }),
        hashes,
        options: values,
      },
      null,
      2,
    ),
  );
  const log = openSync(join(out, "run.log"), "w");
  const child = spawn(
    process.execPath,
    [join(repo, "apps/desktop/packaging/run-smoke.mjs"), "--smoke-canvas", "--browser-perf"],
    {
      cwd: repo,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        VF_BROWSER_PERF_OUT: out,
        VF_BROWSER_PERF_MODE: values.mode,
        VF_BROWSER_PERF_VARIANT: values.label,
        VF_BROWSER_PERF_MS: String(Number(values.seconds) * 1000),
        VF_BROWSER_PERF_WARM_MS: String(Number(values.warmup) * 1000),
        VF_BROWSER_PERF_FPS: values.fps,
        VF_BROWSER_PERF_PANES: values.panes,
        ...(values.interactive ? { VF_BROWSER_PERF_INTERACTIVE: "1" } : {}),
        ...(ui ? { VF_BROWSER_PERF_UI: "1" } : {}),
        ...(values["playback-only"] ? { VF_BROWSER_PERF_MEDIA_ONLY: "1" } : {}),
        ...(values["source-fps"] ? { VF_BROWSER_PERF_SOURCE_FPS: values["source-fps"] } : {}),
        ...(values["source-only"] ? { VF_BROWSER_PERF_SOURCE_ONLY: "1" } : {}),
        VF_BROWSER_PERF_NODE_BIN: process.execPath,
        ...(values.agent ? { VF_BROWSER_PERF_AGENT_BIN: resolve(values.agent) } : {}),
      },
    },
  );
  console.log(`Benchmark running: ${join(out, "run.log")}`);
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const code = await new Promise((res, rej) => {
      child.once("error", rej);
      child.once("exit", (code) => res(code ?? 1));
    });
    process.exitCode = code;
    console.log(`Benchmark ${code === 0 ? "completed" : "failed"}: ${join(out, reportName)}`);
  } finally {
    closeSync(log);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
} finally {
  unlinkSync(lock);
}
