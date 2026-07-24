import { monitorEventLoopDelay } from "node:perf_hooks";
import { LOG_STREAMS } from "../packages/contracts/src/registries";
import { createRendererLoggingClient } from "../packages/electron-shell/src/renderer-host/renderer-logger";
import { createNodeLogging, PluginLogRouter } from "../packages/logging/src/index";

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

async function rendererEventLoopTrial(withLogging: boolean): Promise<{
  p99Ms: number;
  emitted: number;
  elapsedMs: number;
}> {
  const durationMs = 1_500;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  const client = withLogging
    ? createRendererLoggingClient({
        send: () => true,
        component: "renderer.benchmark",
      })
    : null;
  let emitted = 0;
  const started = performance.now();
  delay.enable();
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const elapsed = performance.now() - started;
      const target = Math.floor(elapsed); // 1 record/ms = 1,000 records/sec
      while (emitted < target) {
        client?.logger.info("renderer.benchmark.stress", "renderer stress record");
        emitted += 1;
      }
      if (elapsed >= durationMs) {
        clearInterval(timer);
        resolve();
      }
    }, 10);
  });
  const elapsedMs = performance.now() - started;
  delay.disable();
  client?.close();
  return {
    p99Ms: Number((delay.percentile(99) / 1_000_000).toFixed(3)),
    emitted,
    elapsedMs: Number(elapsedMs.toFixed(1)),
  };
}

async function measureRenderer(iterations: number): Promise<{
  scenarios: Scenario[];
  sentBatches: number;
  sentRecords: number;
  maxBatchRecords: number;
  maxBatchBytes: number;
  floodQueueRecords: number;
  floodQueueBytes: number;
  floodDropped: number;
  eventLoop: {
    baselineP99Ms: number;
    stressP99Ms: number;
    regressionP99Ms: number;
    emitted: number;
    elapsedMs: number;
  };
}> {
  let sentBatches = 0;
  let sentRecords = 0;
  let maxBatchRecords = 0;
  let maxBatchBytes = 0;
  const client = createRendererLoggingClient({
    send(raw) {
      const batch = JSON.parse(raw) as { records: unknown[] };
      sentBatches += 1;
      sentRecords += batch.records.length;
      maxBatchRecords = Math.max(maxBatchRecords, batch.records.length);
      maxBatchBytes = Math.max(maxBatchBytes, Buffer.byteLength(raw, "utf8"));
      return true;
    },
    component: "renderer.benchmark",
  });
  const samples = new Float64Array(iterations);
  let measuredNs = 0n;
  for (let index = 0; index < iterations; index += 1) {
    const started = process.hrtime.bigint();
    client.logger.info("renderer.benchmark.accepted", "accepted renderer record");
    const elapsed = process.hrtime.bigint() - started;
    measuredNs += elapsed;
    samples[index] = Number(elapsed) / 1_000;
    if ((index + 1) % 50 === 0) client.flush();
  }
  client.flush();
  client.close();

  const floodIterations = Math.min(10_000, Math.max(2_000, Math.floor(iterations / 5)));
  const disconnected = createRendererLoggingClient({
    send: () => false,
    component: "renderer.benchmark",
  });
  for (let index = 0; index < floodIterations; index += 1) {
    disconnected.logger.info("renderer.benchmark.flood", "disconnected renderer record", {
      index,
    });
  }
  const flood = disconnected.health();
  disconnected.close();

  const baselineDelay = await rendererEventLoopTrial(false);
  const stressDelay = await rendererEventLoopTrial(true);
  return {
    scenarios: [result("accepted-renderer-enqueue", samples, measuredNs)],
    sentBatches,
    sentRecords,
    maxBatchRecords,
    maxBatchBytes,
    floodQueueRecords: flood.queueRecords,
    floodQueueBytes: flood.queueBytes,
    floodDropped: Object.values(flood.dropped).reduce((sum, count) => sum + count, 0),
    eventLoop: {
      baselineP99Ms: baselineDelay.p99Ms,
      stressP99Ms: stressDelay.p99Ms,
      regressionP99Ms: Number(Math.max(0, stressDelay.p99Ms - baselineDelay.p99Ms).toFixed(3)),
      emitted: stressDelay.emitted,
      elapsedMs: stressDelay.elapsedMs,
    },
  };
}

async function measurePluginFlood(
  iterations: number,
  logRoot: string,
): Promise<{
  scenario: Scenario;
  attempted: number;
  accepted: number;
  droppedRate: number;
  activeEntries: number;
  dropSummaries: number;
  queueHighWaterRecords: number;
  queueHighWaterBytes: number;
  ringHighWaterRecords: number;
  ringHighWaterBytes: number;
}> {
  const sink = await createNodeLogging({
    logRoot,
    stream: LOG_STREAMS.PLUGINS_SERVICE,
    service: "fieldd",
    role: "worker",
    bootId: "benchmark-boot",
    instanceId: "benchmark-instance",
    component: "plugin.service",
    emergency: () => undefined,
  });
  const router = new PluginLogRouter({ sink });
  const provenance = {
    id: "vibefield.benchmark",
    version: "1.0.0",
    installRevision: "benchmark-revision",
    entry: "service" as const,
    installSource: "dev-link" as const,
    trust: "r3-dev" as const,
  };
  const floodIterations = Math.max(2_000, iterations);
  const samples = new Float64Array(floodIterations + 20);
  let measuredNs = 0n;
  for (let index = 0; index < floodIterations; index += 1) {
    const started = process.hrtime.bigint();
    router.accept(provenance, {
      level: "info",
      message: "plugin flood record",
      fields: { index },
    });
    const elapsed = process.hrtime.bigint() - started;
    measuredNs += elapsed;
    samples[index] = Number(elapsed) / 1_000;
  }
  // Prove the low-severity flood cannot consume the warning/error reserve.
  for (let index = 0; index < 20; index += 1) {
    const started = process.hrtime.bigint();
    router.accept(provenance, {
      level: "error",
      message: "plugin high-severity reserve record",
      fields: { index },
    });
    const elapsed = process.hrtime.bigint() - started;
    measuredNs += elapsed;
    samples[floodIterations + index] = Number(elapsed) / 1_000;
  }
  const routeHealth = router.health();
  router.close();
  await sink.flush();
  const sinkHealth = sink.health();
  const dropSummaries = sink
    .recent()
    .records.filter((record) => record.event === "plugin.logging.records_dropped").length;
  await sink.close();
  return {
    scenario: result("plugin-flood-route", samples, measuredNs),
    attempted: samples.length,
    accepted: routeHealth.accepted,
    droppedRate: routeHealth.droppedRate,
    activeEntries: routeHealth.activeEntries,
    dropSummaries,
    queueHighWaterRecords: sinkHealth.queue.highWaterRecords,
    queueHighWaterBytes: sinkHealth.queue.highWaterBytes,
    ringHighWaterRecords: sinkHealth.ring.highWaterRecords,
    ringHighWaterBytes: sinkHealth.ring.highWaterBytes,
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
  renderer: Awaited<ReturnType<typeof measureRenderer>>;
  plugin: Awaited<ReturnType<typeof measurePluginFlood>>;
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
  const [renderer, plugin] = await Promise.all([
    measureRenderer(iterations),
    measurePluginFlood(iterations, logRoot),
  ]);
  return {
    scenarios: [
      result("disabled-node-debug", disabledSamples, disabledNs),
      result("accepted-node-enqueue", acceptedSamples, acceptedNs),
      ...renderer.scenarios,
      plugin.scenario,
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
    renderer,
    plugin,
  };
}
