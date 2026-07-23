import { LOG_STREAMS } from "../packages/contracts/src/registries";
import { createNodeLogging } from "../packages/logging/src/index";

interface Scenario {
  name: string;
  iterations: number;
  callsPerSecond: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
}

function percentile(sorted: Float64Array, quantile: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function result(name: string, samplesUs: Float64Array, measuredNs: bigint): Scenario {
  samplesUs.sort();
  return {
    name,
    iterations: samplesUs.length,
    callsPerSecond: Math.round((samplesUs.length * 1_000_000_000) / Number(measuredNs)),
    p50Us: Number(percentile(samplesUs, 0.5).toFixed(3)),
    p95Us: Number(percentile(samplesUs, 0.95).toFixed(3)),
    p99Us: Number(percentile(samplesUs, 0.99).toFixed(3)),
  };
}

export async function measureLoggingSink(
  iterations: number,
  logRoot: string,
): Promise<{
  scenarios: Scenario[];
  accepted: number;
  dropped: number;
  queueHighWaterRecords: number;
  ringHighWaterBytes: number;
}> {
  const sink = await createNodeLogging({
    logRoot,
    stream: LOG_STREAMS.SYSTEM_FIELDD,
    service: "fieldd",
    role: "daemon",
    bootId: "benchmark-boot",
    instanceId: "benchmark-instance",
    component: "benchmark",
    emergency: () => undefined,
  });
  const { logger } = sink;
  const warmup = Math.min(5_000, Math.max(1_000, Math.floor(iterations / 5)));
  for (let index = 0; index < warmup; index += 1) {
    logger.info("fieldd.benchmark.accepted", "accepted benchmark record");
  }
  await sink.flush();

  const disabledSamples = new Float64Array(iterations);
  let disabledNs = 0n;
  for (let index = 0; index < iterations; index += 1) {
    const started = process.hrtime.bigint();
    logger.debug("fieldd.benchmark.disabled", "disabled benchmark record");
    const elapsed = process.hrtime.bigint() - started;
    disabledNs += elapsed;
    disabledSamples[index] = Number(elapsed) / 1_000;
  }

  const acceptedBefore = sink.health().counters.accepted;
  const acceptedSamples = new Float64Array(iterations);
  let acceptedNs = 0n;
  const batchSize = 1_000;
  for (let offset = 0; offset < iterations; offset += batchSize) {
    const end = Math.min(iterations, offset + batchSize);
    for (let index = offset; index < end; index += 1) {
      const started = process.hrtime.bigint();
      logger.info("fieldd.benchmark.accepted", "accepted benchmark record");
      const elapsed = process.hrtime.bigint() - started;
      acceptedNs += elapsed;
      acceptedSamples[index] = Number(elapsed) / 1_000;
    }
    await sink.flush();
  }

  const health = sink.health();
  await sink.close();
  return {
    scenarios: [
      result("disabled-node-debug", disabledSamples, disabledNs),
      result("accepted-node-enqueue", acceptedSamples, acceptedNs),
    ],
    accepted: health.counters.accepted - acceptedBefore,
    dropped:
      health.counters.droppedTrace +
      health.counters.droppedDebug +
      health.counters.droppedInfo +
      health.counters.droppedWarn +
      health.counters.droppedError,
    queueHighWaterRecords: health.queue.highWaterRecords,
    ringHighWaterBytes: health.ring.highWaterBytes,
  };
}
