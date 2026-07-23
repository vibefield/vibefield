#!/usr/bin/env node
// LOG-L0 characterization harness. This measures the current direct-Console
// call path against an immediate discard destination; it is NOT a persistence
// benchmark and deliberately claims no queue, batching, backpressure, or
// durability. LOG-L1 keeps this baseline and adds sink-enqueue scenarios.
import { Console } from "node:console";
import { Writable } from "node:stream";

const HARNESS_VERSION = 1;
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

process.stdout.write(
  `${JSON.stringify(
    {
      harness: "vibefield.logging.console-baseline",
      harnessVersion: HARNESS_VERSION,
      runtime: process.version,
      platform: `${process.platform}-${process.arch}`,
      semantics: {
        destination: "immediate-discard",
        applicationQueue: "none",
        batching: "none",
        backpressurePolicy: "none",
        dropAccounting: "none",
        persistence: "none",
      },
      scenarios,
    },
    null,
    2,
  )}\n`,
);
