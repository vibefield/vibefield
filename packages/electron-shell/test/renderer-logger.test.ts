import type { RendererLogBatchV1 } from "@vibefield/contracts/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRendererLoggingClient } from "../src/renderer-host/renderer-logger";

afterEach(() => {
  vi.useRealTimers();
});

describe("bounded renderer logging client", () => {
  it("batches normal flow at 100 ms and caps each batch at 50 records", () => {
    vi.useFakeTimers();
    const sent: RendererLogBatchV1[] = [];
    const client = createRendererLoggingClient({
      send(raw) {
        sent.push(JSON.parse(raw));
        return true;
      },
      now: () => 100,
    });
    for (let index = 0; index < 75; index += 1) {
      client.logger.info("renderer.test.recorded", "record", { index });
    }
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.records).toHaveLength(50);
    vi.advanceTimersByTime(100);
    expect(sent[1]?.records).toHaveLength(25);
    expect(client.health()).toMatchObject({
      queueRecords: 0,
      accepted: 75,
      sentBatches: 2,
      sentRecords: 75,
    });
  });

  it("flushes errors promptly without turning each ordinary record into IPC", () => {
    vi.useFakeTimers();
    const sent: RendererLogBatchV1[] = [];
    const client = createRendererLoggingClient({
      send(raw) {
        sent.push(JSON.parse(raw));
        return true;
      },
    });
    client.logger.info("renderer.test.started", "started");
    client.logger.error("renderer.test.failed", "failed", new Error("boom"));
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.records.map((record) => record.level)).toEqual(["info", "error"]);
  });

  it("never invokes getters and sends only detached JSON-safe values", () => {
    vi.useFakeTimers();
    let getterCalls = 0;
    const hostile = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "must not run";
      },
    });
    const sent: RendererLogBatchV1[] = [];
    const client = createRendererLoggingClient({
      send(raw) {
        sent.push(JSON.parse(raw));
        return true;
      },
    });
    client.logger.warn("renderer.test.hostile_seen", "hostile", { hostile });
    vi.advanceTimersByTime(100);
    expect(getterCalls).toBe(0);
    expect(sent[0]?.records[0]?.attrs).toEqual({ hostile: {} });
  });

  it("bounds a disconnected queue and reports lower-level drops in the next batch", () => {
    vi.useFakeTimers();
    let connected = false;
    const sent: RendererLogBatchV1[] = [];
    const client = createRendererLoggingClient({
      send(raw) {
        if (!connected) return false;
        sent.push(JSON.parse(raw));
        return true;
      },
    });
    for (let index = 0; index < 1_100; index += 1) {
      client.logger.info("renderer.test.pressure", "low", { index });
    }
    for (let index = 0; index < 5; index += 1) {
      client.logger.error("renderer.test.pressure", "high", undefined, { index });
    }
    vi.advanceTimersByTime(0);
    expect(client.health().queueRecords).toBeLessThanOrEqual(1_000);
    expect(client.health().queueBytes).toBeLessThanOrEqual(2 * 1024 * 1024);

    connected = true;
    vi.advanceTimersByTime(100);
    expect(sent[0]?.dropped?.info).toBeGreaterThan(0);
    expect(sent[0]?.records.some((record) => record.level === "error")).toBe(true);
  });
});
