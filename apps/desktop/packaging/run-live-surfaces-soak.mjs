#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_ITERATIONS = 1_000;
const MAX_MINUTES = 24 * 60;
const RESULT_PREFIX = "LIVE_SURFACES_LAB ";
let activeChild = null;

function fail(message) {
  throw new Error(message);
}

function positiveInteger(value, name, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    fail(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function positiveNumber(value, name, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    fail(`${name} must be greater than 0 and at most ${maximum}`);
  }
  return parsed;
}

function parseArgs(argv) {
  let minutes = 20;
  let iterations;
  let timeoutMs = 120_000;
  let sckFixture = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--minutes":
        minutes = positiveNumber(argv[++index], "--minutes", MAX_MINUTES);
        break;
      case "--iterations":
        iterations = positiveInteger(argv[++index], "--iterations", MAX_ITERATIONS);
        break;
      case "--per-run-timeout-ms":
        timeoutMs = positiveInteger(argv[++index], "--per-run-timeout-ms", 300_000);
        if (timeoutMs < 10_000) fail("--per-run-timeout-ms must be at least 10000");
        break;
      case "--sck-fixture":
        sckFixture = true;
        break;
      default:
        fail(`unknown argument: ${argument ?? "<missing>"}`);
    }
  }
  return {
    durationMs: minutes * 60_000,
    iterations,
    timeoutMs,
    sckFixture,
  };
}

function appendBounded(current, chunk) {
  const next = current + String(chunk);
  return Buffer.byteLength(next) > MAX_OUTPUT_BYTES ? null : next;
}

function parseVerdict(stdout) {
  const lines = stdout.split(/\r?\n/u);
  const line = lines.findLast((candidate) => candidate.startsWith(RESULT_PREFIX));
  if (line === undefined) fail("live surfaces lab emitted no structured verdict");
  const verdict = JSON.parse(line.slice(RESULT_PREFIX.length));
  if (verdict === null || typeof verdict !== "object" || typeof verdict.ok !== "boolean") {
    fail("live surfaces lab emitted an invalid structured verdict");
  }
  return verdict;
}

function labEnvironment(sckFixture) {
  const environment = { ...process.env };
  delete environment.VF_LIVE_SURFACES_SCK_LAB;
  delete environment.VF_LIVE_SURFACES_SIMULATOR_UDID;
  delete environment.VF_LIVE_SURFACES_SIMULATOR_ROTATE;
  delete environment.VF_LIVE_SURFACES_SIMULATOR_REQUIRE_INACTIVE_SPACE;
  environment.VF_LIVE_SURFACES_LAB_HEADLESS = "1";
  if (sckFixture) environment.VF_LIVE_SURFACES_SCK_LAB = "1";
  return environment;
}

async function runIteration({ desktopRoot, electronPath, timeoutMs, sckFixture, iteration }) {
  const child = spawn(
    electronPath,
    [desktopRoot, "--live-surfaces-lab", "-ApplePersistenceIgnoreState", "YES"],
    {
      cwd: desktopRoot,
      env: labEnvironment(sckFixture),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  activeChild = child;
  let stdout = "";
  let stderr = "";
  let terminalError;
  const append = (current, chunk) => {
    const next = appendBounded(current, chunk);
    if (next !== null) return next;
    terminalError ??= new Error(`live surfaces lab output exceeded ${MAX_OUTPUT_BYTES} bytes`);
    child.kill("SIGTERM");
    return current;
  };
  child.stdout.on("data", (chunk) => {
    stdout = append(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = append(stderr, chunk);
  });
  let outcome;
  try {
    outcome = await new Promise((resolveOutcome, rejectOutcome) => {
      let timedOut = false;
      let forceTimer;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
        forceTimer.unref();
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        rejectOutcome(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        if (terminalError !== undefined) {
          rejectOutcome(terminalError);
        } else if (timedOut) {
          rejectOutcome(new Error(`iteration ${iteration} exceeded ${timeoutMs}ms`));
        } else {
          resolveOutcome({ code, signal });
        }
      });
    });
  } finally {
    if (activeChild === child) activeChild = null;
  }
  const verdict = parseVerdict(stdout);
  if (outcome.code !== 0 || verdict.ok !== true) {
    const diagnostic = stderr.slice(-4_096).trim();
    fail(
      `iteration ${iteration} failed (${outcome.code ?? outcome.signal ?? "unknown"}): ${JSON.stringify(
        verdict,
      )}${diagnostic.length === 0 ? "" : `\n${diagnostic}`}`,
    );
  }
  return verdict;
}

process.once("SIGINT", () => {
  activeChild?.kill("SIGTERM");
  process.exitCode = 130;
});
process.once("SIGTERM", () => {
  activeChild?.kill("SIGTERM");
  process.exitCode = 143;
});

function emptyMetrics() {
  return {
    attachmentsCreated: 0,
    activeAttachments: 0,
    producerStarts: 0,
    producerRestarts: 0,
    framesObserved: 0,
    framesOffered: 0,
    framesAccepted: 0,
    framesDropped: 0,
    sharedFramesObserved: 0,
    cpuFramesObserved: 0,
    localReferencesReleased: 0,
    downstreamReferencesReleased: 0,
    referencesQuarantined: 0,
  };
}

function addMetrics(total, verdict) {
  const metrics = verdict.runtimeSupport?.totals;
  if (metrics === null || typeof metrics !== "object") {
    fail("live surfaces lab verdict omitted runtime support totals");
  }
  for (const key of Object.keys(total)) {
    const value = metrics[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(`live surfaces lab emitted an invalid ${key} counter`);
    }
    const next = total[key] + value;
    if (!Number.isSafeInteger(next)) fail(`aggregate ${key} counter overflowed`);
    total[key] = next;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const electronPath = createRequire(import.meta.url)("electron");
  if (typeof electronPath !== "string" || electronPath.length === 0) {
    fail("could not resolve the Electron executable");
  }
  const startedAt = performance.now();
  const metrics = emptyMetrics();
  let iterations = 0;
  for (;;) {
    iterations += 1;
    process.stderr.write(`Live Surfaces soak iteration ${iterations}…\n`);
    const verdict = await runIteration({
      desktopRoot,
      electronPath,
      timeoutMs: options.timeoutMs,
      sckFixture: options.sckFixture,
      iteration: iterations,
    });
    addMetrics(metrics, verdict);
    const elapsedMs = performance.now() - startedAt;
    if (
      (options.iterations !== undefined && iterations >= options.iterations) ||
      (options.iterations === undefined && elapsedMs >= options.durationMs)
    ) {
      process.stdout.write(
        `LIVE_SURFACES_SOAK ${JSON.stringify({
          ok: true,
          mode: options.sckFixture ? "sck-fixture" : "browser",
          iterations,
          elapsedMs: Math.round(elapsedMs),
          runtimeTotals: metrics,
        })}\n`,
      );
      return;
    }
    if (iterations >= MAX_ITERATIONS) fail(`soak exceeded ${MAX_ITERATIONS} iterations`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `LIVE_SURFACES_SOAK_FAILED ${error instanceof Error ? error.message : error}\n`,
  );
  if (process.exitCode === undefined) process.exitCode = 1;
});
