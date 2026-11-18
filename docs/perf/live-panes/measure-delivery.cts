import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import {
  MacosCaptureHelperSupervisor,
  type MacosCaptureSource,
} from "../../../packages/electron-shell/src/main/live-surfaces/macos-capture-helper";
import { loadMacosCaptureNativeAdapter } from "../../../packages/electron-shell/src/main/live-surfaces/macos-capture-native";

const native = resolve("apps/desktop/build/native/macos");
const percentiles = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => (sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : null);
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
};

async function measure(mode: "timer" | "notification", pid: number, title: string) {
  const addon = loadMacosCaptureNativeAdapter(join(native, "live-surface-adapter.node"));
  const { setFrameReadyCallback, ...legacy } = addon;
  if (!setFrameReadyCallback) throw new Error("Rebuild the native capture adapter");
  let drains = 0;
  let sampling = false;
  const waits: number[] = [];
  const supervisor = new MacosCaptureHelperSupervisor({
    helperPath: join(native, "live-surface-capture-helper"),
    adapter: {
      ...legacy,
      ...(mode === "notification" ? { setFrameReadyCallback } : {}),
      drain: (limit) => {
        drains++;
        const batch = addon.drain(limit);
        if (sampling)
          for (const frame of batch) {
            if (frame.queueWaitUs !== undefined) waits.push(frame.queueWaitUs / 1000);
          }
        return batch;
      },
    },
  });
  try {
    let source: MacosCaptureSource | undefined;
    for (let i = 0; i < 20 && !source; i++) {
      source = (await supervisor.enumerateWindows()).find(
        (window) => window.ownerPid === pid && window.title === title,
      );
      if (!source) await sleep(100);
    }
    if (!source) throw new Error("The run's own animation window was unavailable");

    const idleStart = performance.now();
    const idleBefore = drains;
    await sleep(2_000);
    const idleMs = performance.now() - idleStart;
    const idleDrains = drains - idleBefore;
    const gaps: number[] = [];
    let previous = 0;
    let frames = 0;
    let fault = "";
    const session = await supervisor.startSession({
      producerEpoch: 1,
      source: { kind: "sck-window", sourceRef: source.sourceRef, captureCursor: false },
      demand: { revision: 1, mode: "live", targetFps: 60 },
      onFrame: (frame) => {
        if (sampling) {
          const now = performance.now();
          if (previous) gaps.push(now - previous);
          previous = now;
          frames++;
        }
        frame.releaseLocal();
        frame.releaseLease("released");
      },
      onFault: (error) => {
        fault = error.message;
      },
    });
    try {
      await sleep(1_500);
      const before = drains;
      const start = performance.now();
      sampling = true;
      await sleep(6_000);
      sampling = false;
      const ms = performance.now() - start;
      if (fault || frames < 10) throw new Error(fault || "Insufficient captured frames");
      if (waits.length !== frames) throw new Error("Missing native queue timestamps");
      return {
        mode,
        ms,
        frames,
        fps: (frames * 1000) / ms,
        idleMs,
        idleDrains,
        activeDrains: drains - before,
        receiverQueueWaitMs: percentiles(waits),
        arrivalGapMs: percentiles(gaps),
      };
    } finally {
      await session.dispose();
    }
  } finally {
    await supervisor.dispose();
  }
}

async function run() {
  const file = process.argv[2];
  if (!file) throw new Error("Pass an output JSON path");
  const fixture = spawn(join(native, "live-surface-capture-fixture"), [], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const closed = once(fixture, "exit");
  const lines = createInterface({ input: fixture.stdout });
  try {
    const ready = await Promise.race([
      once(lines, "line").then(([line]) => JSON.parse(line)),
      closed.then(() => {
        throw new Error("Animation window exited before it was ready");
      }),
    ]);
    if (ready.pid !== fixture.pid || typeof ready.title !== "string")
      throw new Error("Wrong fixture window");
    const report = {
      fixtureHz: 30,
      requestedFps: 60,
      trials: [] as Awaited<ReturnType<typeof measure>>[],
    };
    for (const mode of ["timer", "notification", "notification", "timer"] as const) {
      const trial = await measure(mode, ready.pid, ready.title);
      report.trials.push(trial);
      writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify(trial));
    }
  } finally {
    lines.close();
    if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill("SIGTERM");
    await closed;
  }
}
run().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
