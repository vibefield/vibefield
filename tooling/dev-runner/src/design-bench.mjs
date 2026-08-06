#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { repoRoot, workspacePaths } from "./paths.mjs";
import { startRendererServer } from "./vite-server.mjs";

export function designBenchPaths(root) {
  const runtimeRoot = join(root, ".vibefield", "ui-bench");
  const appRoot = join(runtimeRoot, "app");
  return Object.freeze({
    runtimeRoot,
    appRoot,
    userData: join(runtimeRoot, "electron-user-data"),
    mainEntry: join(root, "packages", "electron-shell", "src", "design-bench", "main.ts"),
    preloadEntry: join(root, "packages", "electron-shell", "src", "design-bench", "preload.ts"),
    mainOutput: join(appRoot, "main.cjs"),
    preloadOutput: join(appRoot, "preload.cjs"),
    manifest: join(appRoot, "package.json"),
  });
}

export function designBenchRendererUrl(baseUrl) {
  return new URL("design-system.html", baseUrl).href;
}

export function designBenchLaunchSpec({ electronExecutable, paths, rendererUrl, env }) {
  const launchEnv = {
    ...env,
    VIBEFIELD_UI_BENCH_URL: designBenchRendererUrl(rendererUrl),
  };
  // Electron main sets this only for Node-mode children. Inheriting it here
  // would turn the bench shell itself into a plain Node process.
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  return {
    command: electronExecutable,
    args: [`--user-data-dir=${paths.userData}`, paths.appRoot],
    options: {
      cwd: paths.appRoot,
      env: launchEnv,
      stdio: "inherit",
    },
  };
}

async function buildBenchShell(paths) {
  await mkdir(paths.appRoot, { recursive: true });
  await Promise.all([
    build({
      absWorkingDir: repoRoot,
      entryPoints: [paths.mainEntry],
      outfile: paths.mainOutput,
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      logLevel: "info",
    }),
    build({
      absWorkingDir: repoRoot,
      entryPoints: [paths.preloadEntry],
      outfile: paths.preloadOutput,
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      logLevel: "info",
    }),
    writeFile(
      paths.manifest,
      `${JSON.stringify(
        {
          name: "vibefield-ui-bench",
          private: true,
          main: "main.cjs",
        },
        null,
        2,
      )}\n`,
    ),
  ]);
}

export async function runDesignBench() {
  const paths = designBenchPaths(repoRoot);
  let renderer = null;
  let electron = null;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    electron?.kill("SIGTERM");
  };

  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await buildBenchShell(paths);
    renderer = await startRendererServer(workspacePaths);
    const electronExecutable = createRequire(import.meta.url)("electron");
    const launch = designBenchLaunchSpec({
      electronExecutable,
      paths,
      rendererUrl: renderer.url,
      env: process.env,
    });
    if (interrupted) return 0;
    process.stdout.write(
      `VibeField UI Bench renderer: ${launch.options.env.VIBEFIELD_UI_BENCH_URL}\n`,
    );
    electron = spawn(launch.command, launch.args, launch.options);

    const outcome = await new Promise((resolveOutcome, rejectOutcome) => {
      electron.once("error", rejectOutcome);
      electron.once("exit", (code, signal) => resolveOutcome({ code, signal }));
    });
    if (interrupted || outcome.code === 0) return 0;
    const detail = outcome.signal !== null ? `signal ${outcome.signal}` : `exit ${outcome.code}`;
    throw new Error(`VibeField UI Bench exited unexpectedly (${detail})`);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await renderer?.close();
  }
}

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  void runDesignBench()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
