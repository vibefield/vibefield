#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const MAX_CYCLES = 10_000;
const LITERAL_CLAIM_MS = 24 * 60 * 60 * 1_000;
const MAX_DELAY_MS = 5 * 60 * 1_000;
const STDERR_TAIL_BYTES = 256 * 1024;
const SAMPLE_PREFIX = "PLUGIN_RUNTIME_SOAK_SAMPLE ";
const VERDICT_PREFIX = "PLUGIN_RUNTIME_SOAK ";
let activeChild = null;

function fail(message) {
  throw new Error(message);
}

function integer(raw, name, minimum, maximum) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function positiveNumber(raw, name, maximum) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    fail(`${name} must be greater than zero and at most ${maximum}`);
  }
  return value;
}

function parseArgs(argv) {
  let cycles;
  let durationMs;
  let cycleDelayMs;
  let warmupSamples;
  let minimumGradedSamples;
  let output;
  let footprint = process.platform === "darwin";
  let injectMainListener = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--cycles":
        if (durationMs !== undefined) fail("--cycles cannot be combined with a duration");
        cycles = integer(argv[++index], "--cycles", 1, MAX_CYCLES);
        break;
      case "--minutes": {
        if (cycles !== undefined || durationMs !== undefined) fail("select exactly one run length");
        const minutes = positiveNumber(argv[++index], "--minutes", 24 * 60);
        durationMs = Math.round(minutes * 60_000);
        if (durationMs < 1_000) fail("--minutes must select at least one second");
        break;
      }
      case "--hours": {
        if (cycles !== undefined || durationMs !== undefined) fail("select exactly one run length");
        const hours = positiveNumber(argv[++index], "--hours", 24);
        durationMs = Math.round(hours * 3_600_000);
        break;
      }
      case "--cycle-delay-ms":
        cycleDelayMs = integer(argv[++index], "--cycle-delay-ms", 0, MAX_DELAY_MS);
        break;
      case "--warmup-samples":
        warmupSamples = integer(argv[++index], "--warmup-samples", 0, MAX_CYCLES - 1);
        break;
      case "--minimum-graded-samples":
        minimumGradedSamples = integer(argv[++index], "--minimum-graded-samples", 1, MAX_CYCLES);
        break;
      case "--output":
        output = argv[++index];
        if (typeof output !== "string" || output.length === 0 || output.length > 4_096) {
          fail("--output must be a bounded file path");
        }
        break;
      case "--footprint":
        footprint = true;
        break;
      case "--no-footprint":
        footprint = false;
        break;
      case "--inject-main-listener-leak":
        injectMainListener = true;
        break;
      default:
        fail(`unknown argument: ${argument ?? "<missing>"}`);
    }
  }
  if (cycles === undefined && durationMs === undefined) cycles = 3;
  const plannedSamples = cycles ?? MAX_CYCLES;
  const resolvedWarmup = warmupSamples ?? (cycles === undefined ? 8 : Math.min(1, cycles - 1));
  if (resolvedWarmup >= plannedSamples) fail("warmup must leave at least one graded sample");
  const resolvedMinimum =
    minimumGradedSamples ?? (cycles === undefined ? 24 : Math.max(1, cycles - resolvedWarmup));
  if (cycles !== undefined && resolvedWarmup + resolvedMinimum > cycles) {
    fail("warmup + minimum graded samples exceeds --cycles");
  }
  return {
    cycles: cycles ?? null,
    durationMs: durationMs ?? null,
    cycleDelayMs: cycleDelayMs ?? (durationMs === undefined ? 0 : 45_000),
    warmupSamples: resolvedWarmup,
    minimumGradedSamples: resolvedMinimum,
    footprint,
    injectMainListener,
    output,
  };
}

function childEnvironment(options) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VF_PLUGIN_RUNTIME_SOAK")) delete env[key];
  }
  env.VF_PLUGIN_RUNTIME_SOAK = "1";
  env.VF_PLUGIN_RUNTIME_SOAK_CYCLE_DELAY_MS = String(options.cycleDelayMs);
  env.VF_PLUGIN_RUNTIME_SOAK_WARMUP_SAMPLES = String(options.warmupSamples);
  env.VF_PLUGIN_RUNTIME_SOAK_MIN_GRADED_SAMPLES = String(options.minimumGradedSamples);
  if (options.cycles === null) {
    env.VF_PLUGIN_RUNTIME_SOAK_DURATION_MS = String(options.durationMs);
  } else {
    env.VF_PLUGIN_RUNTIME_SOAK_CYCLES = String(options.cycles);
  }
  if (options.footprint) env.VF_PLUGIN_RUNTIME_SOAK_FOOTPRINT = "1";
  if (options.injectMainListener) env.VF_PLUGIN_RUNTIME_SOAK_INJECT = "main-listener";
  return env;
}

function appendTail(current, chunk) {
  const next = current + String(chunk);
  return Buffer.byteLength(next) <= STDERR_TAIL_BYTES
    ? next
    : Buffer.from(next).subarray(-STDERR_TAIL_BYTES).toString("utf8");
}

function parseLine(line, prefix, label) {
  try {
    const value = JSON.parse(line.slice(prefix.length));
    if (value === null || typeof value !== "object") fail(`${label} is not an object`);
    return value;
  } catch (error) {
    fail(`${label} is invalid JSON: ${String(error)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const electronPath = createRequire(import.meta.url)("electron");
  if (typeof electronPath !== "string" || electronPath.length === 0) {
    fail("could not resolve the Electron executable");
  }
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const outputPath = resolve(
    desktopRoot,
    options.output ?? `build/evidence/plugin-runtime-soak-${stamp}.jsonl`,
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  const evidence = createWriteStream(outputPath, {
    fd: openSync(outputPath, "wx", 0o600),
    autoClose: true,
  });
  const evidenceDone = new Promise((resolveDone, rejectDone) => {
    evidence.once("close", resolveDone);
    evidence.once("error", rejectDone);
  });
  void evidenceDone.catch(() => undefined);
  evidence.write(
    `${JSON.stringify({
      type: "header",
      version: 1,
      startedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      options,
    })}\n`,
  );

  const child = spawn(
    electronPath,
    [desktopRoot, "--smoke-plugin-restart", "-ApplePersistenceIgnoreState", "YES"],
    {
      cwd: desktopRoot,
      env: childEnvironment(options),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  activeChild = child;
  let stderr = "";
  let verdict = null;
  let samples = 0;
  let lineError = null;
  child.stderr.on("data", (chunk) => {
    stderr = appendTail(stderr, chunk);
    process.stderr.write(chunk);
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  const linesClosed = new Promise((resolveClosed) => lines.once("close", resolveClosed));
  lines.on("line", (line) => {
    process.stdout.write(`${line}\n`);
    if (lineError !== null) return;
    try {
      if (line.startsWith(SAMPLE_PREFIX)) {
        const sample = parseLine(line, SAMPLE_PREFIX, "physical soak sample");
        samples += 1;
        evidence.write(
          `${JSON.stringify({ type: "sample", observedAt: new Date().toISOString(), sample })}\n`,
        );
      } else if (line.startsWith(VERDICT_PREFIX)) {
        verdict = parseLine(line, VERDICT_PREFIX, "physical soak verdict");
        evidence.write(
          `${JSON.stringify({ type: "verdict", observedAt: new Date().toISOString(), verdict })}\n`,
        );
      }
    } catch (error) {
      lineError = error instanceof Error ? error : new Error(String(error));
      child.kill("SIGTERM");
    }
  });

  const timeoutMs =
    options.durationMs === null
      ? Math.max(10 * 60_000, options.cycles * (120_000 + options.cycleDelayMs))
      : options.durationMs + 15 * 60_000;
  let timedOut = false;
  let forceTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    forceTimer.unref();
  }, timeoutMs);
  const outcome = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  clearTimeout(timer);
  if (forceTimer !== undefined) clearTimeout(forceTimer);
  activeChild = null;
  await linesClosed;
  evidence.end();
  await evidenceDone;

  if (lineError !== null) throw lineError;
  if (timedOut) fail(`physical soak exceeded its ${timeoutMs}ms runner deadline`);
  if (verdict === null) {
    fail(
      `physical soak emitted no structured verdict (${outcome.code ?? outcome.signal ?? "unknown"})${
        stderr.length === 0 ? "" : `\n${stderr.trim()}`
      }`,
    );
  }
  const actual = verdict.verdict?.verdict;
  const expected = options.injectMainListener ? "fail" : "pass";
  if (actual !== expected) {
    fail(
      `physical soak verdict was ${String(actual)}, expected ${expected}: ${JSON.stringify(verdict)}`,
    );
  }
  const expectedCode = options.injectMainListener ? 2 : 0;
  if (outcome.code !== expectedCode) {
    fail(
      `physical soak exited ${outcome.code ?? outcome.signal ?? "unknown"}, expected ${expectedCode}`,
    );
  }
  if (verdict.verdict?.sampleCount !== samples) {
    fail(
      `physical soak emitted ${samples} samples but its verdict grades ${String(
        verdict.verdict?.sampleCount,
      )}`,
    );
  }
  const literalClaim = options.durationMs === LITERAL_CLAIM_MS;
  const expectedClaim = literalClaim ? "24h" : "calibration";
  if (verdict.claim !== expectedClaim) {
    fail(`physical soak reported claim ${String(verdict.claim)}, expected ${expectedClaim}`);
  }
  if (
    (!literalClaim && verdict.claimSatisfied !== false) ||
    (literalClaim && !options.injectMainListener && verdict.claimSatisfied !== true)
  ) {
    fail(
      `physical soak claim boundary was inconsistent: ${JSON.stringify({
        literalClaim,
        claim: verdict.claim,
        claimSatisfied: verdict.claimSatisfied,
      })}`,
    );
  }
  if (
    options.injectMainListener &&
    !verdict.verdict.failures?.some(
      (failure) =>
        failure.kind === "structural-residue" && failure.metric === "plantedMainListeners",
    )
  ) {
    fail("planted listener control failed for an unrelated reason");
  }
  process.stdout.write(
    `PLUGIN_RUNTIME_SOAK_RUNNER ${JSON.stringify({
      ok: true,
      expectedVerdict: expected,
      samples,
      claim: verdict.claim,
      claimSatisfied: verdict.claimSatisfied,
      evidence: outputPath,
    })}\n`,
  );
}

process.once("SIGINT", () => {
  activeChild?.kill("SIGTERM");
  process.exitCode = 130;
});
process.once("SIGTERM", () => {
  activeChild?.kill("SIGTERM");
  process.exitCode = 143;
});

main().catch((error) => {
  process.stderr.write(
    `PLUGIN_RUNTIME_SOAK_RUNNER failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
