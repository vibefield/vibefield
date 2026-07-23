#!/usr/bin/env node
// Versioned LOG-L0–LOG-L3 harness. It retains the direct-Console discard
// baseline, measures the real bounded Node sink, and exercises the renderer
// queue/batcher plus a baseline-normalized 1,000-records/sec event-loop trial.
import { execFileSync } from "node:child_process";
import { Console } from "node:console";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

const HARNESS_VERSION = 3;
const DEFAULT_ITERATIONS = 50_000;

class ImmediateDiscard extends Writable {
  _write(_chunk, _encoding, callback) {
    callback();
  }
}

function percentile(sorted, quantile) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function measure(name, iterations, call) {
  for (let index = 0; index < 5_000; index += 1) call(index);

  const samplesUs = new Float64Array(iterations);
  const started = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) {
    const callStarted = process.hrtime.bigint();
    call(index);
    samplesUs[index] = Number(process.hrtime.bigint() - callStarted) / 1_000;
  }
  const elapsedNs = process.hrtime.bigint() - started;
  samplesUs.sort();

  return {
    name,
    iterations,
    callsPerSecond: Math.round((iterations * 1_000_000_000) / Number(elapsedNs)),
    p50Us: Number(percentile(samplesUs, 0.5).toFixed(3)),
    p95Us: Number(percentile(samplesUs, 0.95).toFixed(3)),
    p99Us: Number(percentile(samplesUs, 0.99).toFixed(3)),
  };
}

const iterationsArg = process.argv.indexOf("--iterations");
const parsedIterations =
  iterationsArg >= 0 ? Number.parseInt(process.argv[iterationsArg + 1] ?? "", 10) : NaN;
const iterations =
  Number.isSafeInteger(parsedIterations) && parsedIterations > 0
    ? parsedIterations
    : DEFAULT_ITERATIONS;

const sink = new ImmediateDiscard();
const currentConsole = new Console({ stdout: sink, stderr: sink, ignoreErrors: false });
const scenarios = [
  measure("simple-info", iterations, () => currentConsole.info("[fieldd] lifecycle ready")),
  measure("formatted-warning", iterations, (index) =>
    currentConsole.warn(
      `[doc-service] revision cleanup failed for doc_alias: EIO (attempt ${index & 7})`,
    ),
  ),
];
sink.end();

const workDir = mkdtempSync(join(tmpdir(), "vibefield-logging-bench-"));
let nodeSink;
try {
  const bundle = join(workDir, "sink-benchmark.cjs");
  const pnpmCli = process.env.npm_execpath;
  const command = pnpmCli ? process.execPath : "pnpm";
  const prefix = pnpmCli ? [pnpmCli] : [];
  execFileSync(
    command,
    [
      ...prefix,
      "--filter",
      "@vibefield/logging",
      "exec",
      "esbuild",
      join(process.cwd(), "scripts", "bench-logging-sink.ts"),
      "--bundle",
      "--platform=node",
      "--format=cjs",
      `--outfile=${bundle}`,
    ],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  const driver = createRequire(import.meta.url)(bundle);
  nodeSink = await driver.measureLoggingSink(iterations, join(workDir, "logs"));
  scenarios.push(...nodeSink.scenarios);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

process.stdout.write(
  `${JSON.stringify(
    {
      harness: "vibefield.logging.console-baseline",
      harnessVersion: HARNESS_VERSION,
      runtime: process.version,
      platform: `${process.platform}-${process.arch}`,
      semantics: {
        consoleBaseline: {
          destination: "immediate-discard",
          applicationQueue: "none",
          persistence: "none",
        },
        nodeSink: {
          destination: "process-owned NDJSON segment writer",
          applicationQueue: "bounded with reserved high-severity capacity",
          batching: "up to 128 records / 256 KiB per writer block",
          backpressurePolicy: "lower levels drop first",
          persistence: "flush between measurement batches",
        },
        rendererSink: {
          destination: "bounded renderer queue with serialized batch callback",
          applicationQueue: "1,000 records / 2 MiB; lower levels drop first",
          batching: "up to 50 records / 256 KiB",
          persistence: "Electron host route measured separately by conformance tests",
        },
      },
      nodeSinkHealth: {
        accepted: nodeSink.accepted,
        dropped: nodeSink.dropped,
        queueHighWaterRecords: nodeSink.queueHighWaterRecords,
        ringHighWaterBytes: nodeSink.ringHighWaterBytes,
      },
      rendererSinkHealth: {
        sentBatches: nodeSink.renderer.sentBatches,
        sentRecords: nodeSink.renderer.sentRecords,
        maxBatchRecords: nodeSink.renderer.maxBatchRecords,
        maxBatchBytes: nodeSink.renderer.maxBatchBytes,
        floodQueueRecords: nodeSink.renderer.floodQueueRecords,
        floodQueueBytes: nodeSink.renderer.floodQueueBytes,
        floodDropped: nodeSink.renderer.floodDropped,
      },
      rendererEventLoop: nodeSink.renderer.eventLoop,
      scenarios,
    },
    null,
    2,
  )}\n`,
);
