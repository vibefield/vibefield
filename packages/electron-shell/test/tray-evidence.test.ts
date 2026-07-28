import type { LoggingHealthV1 } from "@vibefield/contracts/logging";
import { describe, expect, it, vi } from "vitest";
import { TrayEvidenceMonitor } from "../src/main/tray-evidence";

function writer(initial: LoggingHealthV1["writerState"] = "healthy") {
  let state = initial;
  const listeners = new Set<(value: LoggingHealthV1["writerState"]) => void>();
  return {
    source: {
      health: () => ({ writerState: state }) as LoggingHealthV1,
      subscribeWriterState: (listener: (value: LoggingHealthV1["writerState"]) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    set(next: LoggingHealthV1["writerState"]) {
      state = next;
      for (const listener of listeners) listener(next);
    },
  };
}

describe("TrayEvidenceMonitor", () => {
  it("tracks local writer degradation/recovery and live fieldd evidence health", () => {
    const desktop = writer();
    const renderer = writer();
    const changes = vi.fn();
    const monitor = new TrayEvidenceMonitor({
      writers: [desktop.source, renderer.source],
      localAvailable: true,
      onChange: changes,
    });

    expect(monitor.current()).toBe("healthy");
    monitor.updateRemote({
      audit: { state: "healthy" },
      logging: { writerState: "healthy" },
    });
    desktop.set("degraded");
    expect(monitor.current()).toBe("degraded");
    desktop.set("healthy");
    expect(monitor.current()).toBe("healthy");

    monitor.markRemoteUnavailable();
    expect(monitor.current()).toBe("degraded");
    monitor.updateRemote({
      audit: { state: "healthy" },
      logging: { writerState: "healthy" },
    });
    expect(monitor.current()).toBe("healthy");
    monitor.setLocalAvailable(false);
    expect(monitor.current()).toBe("degraded");
    expect(changes.mock.calls.map(([state]) => state)).toEqual([
      "degraded",
      "healthy",
      "degraded",
      "healthy",
      "degraded",
    ]);
  });
});
