#!/usr/bin/env node
import { readFileSync } from "node:fs";

const percentile = (values, q) => {
  const a = values.slice().sort((a, b) => a - b);
  return a[Math.min(a.length - 1, Math.floor(a.length * q))] ?? null;
};
for (const path of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  if (report.mode === "multi") {
    const average = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    console.log(
      JSON.stringify(
        {
          path,
          mode: report.mode,
          variant: report.variant,
          ok: report.ok,
          error: report.error,
          panes: report.panes,
          sameDocuments: report.pages?.every((p) =>
            report.finalPages?.some(
              (f) =>
                f.key === p.key &&
                f.webContentsId === p.webContentsId &&
                f.facts.timeOrigin === p.facts.timeOrigin,
            ),
          ),
          agent: report.agentBrowser,
          agentRendering: report.agentRendering,
          rows: report.phases.map((p) => ({
            phase: p.phase,
            deskFps: p.deskFps,
            paneFps: p.panes.map((f) => f.paneFps),
            sourceRafFps: p.panes.map((f) => f.sourceRafFps),
            sourcePaintFps: p.panes.map((f) => f.sourcePaintFps),
            textureSizes: p.panes.map((f) => [f.texture?.width, f.texture?.height]),
            textureMiB: p.panes.reduce((sum, f) => sum + (f.texture?.bytes ?? 0), 0) / 1024 / 1024,
            capturedMpixPerSecond:
              p.panes.reduce(
                (sum, f) => sum + f.sharedPaints * (f.size?.width ?? 0) * (f.size?.height ?? 0),
                0,
              ) /
              p.ms /
              1000,
            cpuFallbackPaints: p.panes.reduce((sum, f) => sum + f.cpuPaints, 0),
            appCpuMean: average(
              p.processMetrics.map((sample) => sample.reduce((sum, m) => sum + m.cpu, 0)),
            ),
            gpuProcessCpuMean: average(
              p.processMetrics.map((sample) =>
                sample.filter((m) => m.type === "GPU").reduce((sum, m) => sum + m.cpu, 0),
              ),
            ),
          })),
        },
        null,
        2,
      ),
    );
    continue;
  }
  const rows = report.phases.map((p) => {
    // Each scheduled wheel carries eight page CSS pixels. A coalesced CDP
    // command represents several original inputs; grade ALL of their waits,
    // including the oldest, not just the newest input in each batch.
    const queue = [];
    let represented = 0;
    for (const command of p.cdpInput ?? []) {
      if (command.params?.type !== "mouseWheel") continue;
      const count = Math.round(command.params.deltaY / 8);
      for (let n = 0; n < count; n++) {
        const sent = p.sent[represented++];
        if (sent) queue.push(command.at - sent.at);
      }
    }
    return {
      phase: p.phase,
      pageRafFps: p.sourceRafFps,
      panePresentFps: p.paneFps,
      paintFps: p.sourcePaintFps,
      sourceRafP95Ms: p.sourceRafIntervals.p95,
      sharedPaints: p.paints.shared,
      cpuPaints: p.paints.cpu,
      wheelSent: p.phase === "wheel" ? p.sent.length : 0,
      wheelTravelDelivered: p.received.wheels.reduce((s, e) => s + e.dy, 0),
      wheelQueueSamples: queue.length,
      wheelQueueP50Ms: percentile(queue, 0.5),
      wheelQueueP95Ms: percentile(queue, 0.95),
      wheelQueueMaxMs: percentile(queue, 1),
    };
  });
  console.log(
    JSON.stringify(
      {
        path,
        mode: report.mode,
        variant: report.variant,
        ok: report.ok,
        error: report.error,
        displayHz: report.display.displayFrequency,
        viewport: [report.page?.width, report.page?.height, report.page?.dpr],
        sameTarget: report.target?.targetInfo.targetId === report.finalTarget?.targetInfo.targetId,
        nativeFrameRate: report.nativeFrameRate,
        sourceFpsOverride: report.sourceFpsOverride,
        sourceOnly: report.sourceOnly,
        sameDocument: report.page?.timeOrigin === report.finalPage?.timeOrigin,
        agent: report.agentBrowser,
        agentRendering: report.agentRendering,
        rows,
      },
      null,
      2,
    ),
  );
}
