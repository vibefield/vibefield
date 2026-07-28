#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { computeBuildId } from "./build-id.mjs";
import { createChangeBuffer } from "./change-buffer.mjs";
import { classifyCriticalChange, discoverPluginProjects } from "./critical-changes.mjs";
import { watchCriticalRoots } from "./critical-watcher.mjs";
import { acquireDevLock } from "./dev-lock.mjs";
import { createElectronStack } from "./electron-stack.mjs";
import { startEsbuildWatches } from "./esbuild-watches.mjs";
import { log } from "./log.mjs";
import { startNxWatcher } from "./nx-watcher.mjs";
import { workspacePaths as paths, repoRoot } from "./paths.mjs";
import { cargoCommand, pnpmCommand, runCommand, terminateChild } from "./processes.mjs";
import { createRestartCoordinator } from "./restart-coordinator.mjs";
import { handoffDesktopRuntime } from "./runtime-handoff.mjs";
import {
  pruneRuntimeSnapshots,
  RuntimeSnapshotChangedError,
  stageRuntimeSnapshot,
} from "./runtime-snapshot.mjs";
import { createCriticalTaskQueue } from "./task-queue.mjs";
import { createTypecheckScheduler } from "./typecheck-scheduler.mjs";
import { startRendererServer } from "./vite-server.mjs";

let devLock = null;
let builds = null;
let renderer = null;
let electron = null;
let restartCoordinator = null;
let criticalQueue = null;
let stopCriticalWatcher = null;
let nxWatcher = null;
let typechecks = null;
let pluginProjects = [];
let currentBuildId = null;
let currentRuntime = null;
let runtimeStarted = false;
let shuttingDown = false;
let shutdownPromise = null;
const criticalChanges = createChangeBuffer();
const transientChildren = new Set();
const crashTimes = [];

process.on("SIGINT", () => void shutdown(0, "SIGINT"));
process.on("SIGTERM", () => void shutdown(0, "SIGTERM"));
process.on("uncaughtException", (error) => void fatal(error));
process.on("unhandledRejection", (error) => void fatal(error));

async function main() {
  await Promise.all([
    mkdir(paths.dataRoot, { recursive: true }),
    mkdir(paths.logRoot, { recursive: true }),
    mkdir(paths.electronUserData, { recursive: true }),
  ]);
  devLock = await acquireDevLock({
    lockDir: paths.lockDir,
    dataRoot: paths.dataRoot,
    repoRoot,
  });

  // Observe critical source roots before any generator or native build reads
  // them. Until the serialized refresh queue exists, events are deduplicated
  // in memory and then drained through that queue without a hand-off gap.
  stopCriticalWatcher = watchCriticalRoots(criticalWatchRoots(), (file) => {
    criticalChanges.push(file);
  });
  pluginProjects = await discoverPluginProjects(repoRoot);
  log.info("preparing generated manifests and native contracts");
  await runTracked(pnpmCommand, ["-r", "--if-present", "run", "gen:manifest"], "plugin manifests");
  await runTracked(pnpmCommand, ["gen"], "contract generation");
  log.info("building the repository-owned native sidecar");
  await runTracked(cargoCommand, ["build", "-p", "field-native"], "field-native build");

  log.info("starting watched Electron/fieldd builds and the Vite renderer");
  builds = await startEsbuildWatches({
    paths,
    log,
    onArtifactChange: (name) => {
      crashTimes.length = 0;
      restartCoordinator?.request(name);
    },
  });
  renderer = await startRendererServer(paths);
  log.info(`renderer HMR listening at ${renderer.url}`);
  await builds.ready;

  electron = createElectronStack({
    paths,
    viteUrl: renderer.url,
    lock: devLock,
    log,
    onUnexpectedExit: handleElectronExit,
  });
  restartCoordinator = createRestartCoordinator({
    canRestart: () =>
      runtimeStarted &&
      !shuttingDown &&
      (electron?.running === false ||
        (builds?.allReady() === true &&
          criticalQueue?.busy !== true &&
          criticalQueue?.healthy !== false)),
    restart: restartDesktop,
    onError: (error) => void fatal(error),
  });

  criticalQueue = createCriticalQueue();
  builds.activate();
  criticalChanges.attach((file) => {
    const change = classifyCriticalChange(file, pluginProjects);
    if (change) criticalQueue.enqueue(change);
  });
  await criticalQueue.waitForIdle();
  if (!criticalQueue.healthy) {
    throw new Error("a critical source change failed while the desktop runtime was starting");
  }

  const initialRuntime = await waitForCurrentRuntime();
  const electronPid = await electron.start(initialRuntime);
  currentBuildId = initialRuntime.buildId;
  currentRuntime = initialRuntime;
  runtimeStarted = true;
  restartCoordinator.wake();
  await pruneSnapshots(initialRuntime.buildId);
  log.info(`desktop started (Electron pid ${electronPid}, build ${currentBuildId})`);

  typechecks = createTypechecks();
  nxWatcher = await startNxWatcher({
    repoRoot,
    eventScript: join(repoRoot, "tooling", "dev-runner", "src", "nx-watch-event.mjs"),
    onChange: ({ files }) => {
      typechecks.requestFiles(files);
      if (files.length > 0) {
        crashTimes.length = 0;
      }
      if (!electron.running && files.length > 0) {
        restartCoordinator.request("source changed after Electron exit");
      }
    },
    onUnexpectedExit: ({ code, signal }) => {
      void fatal(
        new Error(
          `Nx workspace watcher exited unexpectedly (${
            signal !== null ? `signal ${signal}` : `exit ${String(code)}`
          })`,
        ),
      );
    },
  });
  typechecks.requestFull();
  log.info("Nx is watching every workspace project; typechecks run in the background");
}

function createCriticalQueue() {
  let busy = false;
  const queue = createCriticalTaskQueue({
    handlers: {
      async allManifests() {
        log.info("plugin layout changed; regenerating all plugin manifests");
        await runTracked(
          pnpmCommand,
          ["-r", "--if-present", "run", "gen:manifest"],
          "plugin manifests",
        );
        pluginProjects = await discoverPluginProjects(repoRoot);
      },
      async manifest(project) {
        log.info(`regenerating ${project} manifest`);
        await runTracked(
          pnpmCommand,
          ["--filter", project, "run", "gen:manifest"],
          `${project} manifest`,
        );
        pluginProjects = await discoverPluginProjects(repoRoot);
      },
      async contracts() {
        log.info("contracts changed; regenerating schemas and Rust bindings");
        await runTracked(pnpmCommand, ["gen"], "contract generation");
      },
      async native() {
        log.info("native inputs changed; rebuilding field-native");
        await runTracked(cargoCommand, ["build", "-p", "field-native"], "field-native build");
      },
      async pluginRuntime() {
        pluginProjects = await discoverPluginProjects(repoRoot);
      },
    },
    onBusyChange(value) {
      busy = value;
      if (!value) restartCoordinator.wake();
    },
    onSuccess(batch) {
      crashTimes.length = 0;
      restartCoordinator.request(describeCriticalBatch(batch));
    },
    onFailure(error) {
      log.error(
        `generated/native refresh failed; keeping the current desktop alive: ${messageOf(error)}`,
      );
    },
  });

  return {
    enqueue: queue.enqueue,
    close: queue.close,
    waitForIdle: queue.waitForIdle,
    get busy() {
      return busy || queue.busy;
    },
    get healthy() {
      return queue.healthy;
    },
  };
}

function criticalWatchRoots() {
  return [
    paths.contractsSource,
    join(repoRoot, "packages", "contracts", "scripts"),
    paths.nativeSource,
    join(repoRoot, "tooling", "plugin-build", "src"),
    join(repoRoot, "plugins"),
    join(repoRoot, "examples", "plugins"),
  ];
}

function createTypechecks() {
  return createTypecheckScheduler({
    runFull: () =>
      runTracked(
        pnpmCommand,
        ["exec", "nx", "run-many", "-t", "typecheck", "--outputStyle=stream"],
        "workspace typecheck",
      ),
    runAffected: (files) =>
      runTracked(
        pnpmCommand,
        [
          "exec",
          "nx",
          "affected",
          "-t",
          "typecheck",
          `--files=${files.join(",")}`,
          "--outputStyle=stream",
        ],
        "affected typecheck",
      ),
    onStart: (files) => {
      log.info(files === null ? "background typecheck started" : "affected typecheck started");
    },
    onSuccess: () => {
      log.info("background typecheck is current");
    },
    onFailure: (error) => {
      log.warn(`typecheck failed; the running app is unchanged: ${messageOf(error)}`);
    },
  });
}

async function restartDesktop(reasons) {
  const result = await handoffDesktopRuntime({
    electron,
    currentBuildId,
    prepareRuntime: stageCurrentRuntime,
    isShuttingDown: () => shuttingDown,
  });
  if (result.status === "deferred") {
    log.info("restart paused until every changed runtime artifact is valid");
    restartCoordinator.request("pending valid runtime build");
    return;
  }
  if (result.status === "unchanged") {
    log.info(`runtime output unchanged (${reasons.join(", ")}); no restart needed`);
    return;
  }
  if (result.status !== "restarted") return;

  currentBuildId = result.runtime.buildId;
  currentRuntime = result.runtime;
  await pruneSnapshots(currentBuildId);
  log.info(
    `desktop restarted after ${reasons.join(", ")} (Electron pid ${result.pid}, build ${currentBuildId})`,
  );
}

function handleElectronExit({ code, signal }) {
  if (shuttingDown) return;
  if (code === 0) {
    void shutdown(0, "desktop window closed");
    return;
  }
  const now = Date.now();
  crashTimes.push(now);
  while (crashTimes[0] < now - 30_000) crashTimes.shift();
  log.error(
    `Electron exited unexpectedly (${signal !== null ? `signal ${signal}` : `exit ${String(code)}`})`,
  );
  if (crashTimes.length > 3) {
    log.warn("automatic restart paused after repeated exits; edit a workspace file to retry");
    return;
  }
  restartCoordinator.request("unexpected Electron exit");
}

async function buildIdentity() {
  return computeBuildId(repoRoot, buildIdentityInputs());
}

function buildIdentityInputs() {
  return [
    paths.mainOutput,
    paths.preloadOutput,
    paths.fielddOutput,
    paths.serviceHarnessOutput,
    paths.fielddWasm,
    paths.nativeOutput,
    ...pluginProjects.flatMap((project) => [
      join(repoRoot, project.manifestFile),
      ...(project.serviceEntry ? [join(repoRoot, project.serviceEntry)] : []),
    ]),
  ];
}

async function stageCurrentRuntime() {
  if (
    shuttingDown ||
    builds?.allReady() !== true ||
    criticalQueue?.busy === true ||
    criticalQueue?.healthy === false
  ) {
    return electron?.running === false ? currentRuntime : null;
  }
  const buildId = await buildIdentity();
  try {
    return await stageRuntimeSnapshot({
      paths,
      buildId,
      validate: async () =>
        !shuttingDown &&
        builds?.allReady() === true &&
        criticalQueue?.busy !== true &&
        criticalQueue?.healthy !== false &&
        (await buildIdentity()) === buildId,
    });
  } catch (error) {
    if (error instanceof RuntimeSnapshotChangedError) return null;
    throw error;
  }
}

async function waitForCurrentRuntime() {
  while (!shuttingDown) {
    await criticalQueue.waitForIdle();
    if (!criticalQueue.healthy) {
      throw new Error("critical runtime inputs are invalid");
    }
    const runtime = await stageCurrentRuntime();
    if (runtime !== null) return runtime;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("development runtime staging was interrupted by shutdown");
}

async function pruneSnapshots(current) {
  await pruneRuntimeSnapshots(paths.runtimeRoot, new Set([current])).catch((error) => {
    log.warn(`could not prune old development runtime snapshots: ${messageOf(error)}`);
  });
}

async function runTracked(command, args, label) {
  let child = null;
  try {
    return await runCommand({
      command,
      args,
      cwd: repoRoot,
      label,
      onSpawn(spawned) {
        child = spawned;
        transientChildren.add(spawned);
      },
    });
  } finally {
    if (child) transientChildren.delete(child);
  }
}

async function fatal(error) {
  log.error(messageOf(error));
  await shutdown(1, "fatal development-runner error");
}

function shutdown(code, reason) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    log.info(`stopping (${reason})`);
    runtimeStarted = false;
    restartCoordinator?.close();
    typechecks?.close();
    criticalQueue?.close();
    stopCriticalWatcher?.();
    stopCriticalWatcher = null;
    await nxWatcher?.close().catch((error) => log.warn(messageOf(error)));
    await electron?.stop().catch((error) => {
      code = 1;
      log.error(messageOf(error));
    });
    await Promise.allSettled(
      [...transientChildren].map((child) =>
        terminateChild(child, { graceMs: 2_000, killWaitMs: 1_000 }),
      ),
    );
    await builds?.close();
    await renderer?.close();
    await devLock?.release().catch((error) => {
      code = 1;
      log.error(`could not release development lock: ${messageOf(error)}`);
    });
    process.exitCode = code;
    log.info("stopped");
  })();
  return shutdownPromise;
}

function describeCriticalBatch(batch) {
  const labels = [];
  if (batch.contracts) labels.push("contracts");
  if (batch.native) labels.push("field-native");
  if (batch.allManifests || batch.manifests.length > 0) labels.push("plugin manifests");
  if (batch.runtime) labels.push("plugin runtime");
  return labels.join(" + ") || "runtime metadata";
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => void fatal(error));
