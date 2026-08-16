import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveSurfaceRuntimeAttachContext } from "../src/main/live-surfaces/runtime";
import { dropLiveSurfaceTextureFrame } from "../src/main/live-surfaces/texture-forwarder";
import { LiveSurfaceFixtureRuntime } from "../src/testing/live-surface-fixture-runtime";

describe("LiveSurfaceFixtureRuntime", () => {
  afterEach(() => vi.useRealTimers());

  it("emits only under live demand and silences the producer on pause", () => {
    vi.useFakeTimers();
    const runtime = new LiveSurfaceFixtureRuntime();
    const summaries: string[] = [];
    const context: LiveSurfaceRuntimeAttachContext = {
      attachmentId: "attachment_fixture_00000001",
      rendererGeneration: 1,
      operations: ["view"],
      publishSummary: (summary) => summaries.push(summary.state),
      publishCpuFrame: () => true,
      offerTextureFrame: (frame) => dropLiveSurfaceTextureFrame(frame, "closed"),
    };
    const attachment = runtime.attach(context);

    attachment.setDemand({
      revision: 1,
      mode: "live",
      targetFps: 30,
      priority: 50,
      interactive: false,
    });
    vi.advanceTimersByTime(100);
    expect(runtime.stats.offered).toBeGreaterThan(1);
    expect(runtime.stats.accepted).toBe(runtime.stats.offered);

    attachment.setDemand({
      revision: 2,
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
    });
    const pausedAt = runtime.stats.offered;
    vi.advanceTimersByTime(1_000);
    expect(runtime.stats.offered).toBe(pausedAt);
    expect(summaries).toEqual(["live", "paused"]);

    attachment.dispose();
    expect(runtime.stats).toMatchObject({
      attachments: 1,
      disposedAttachments: 1,
      demandUpdates: 2,
    });
  });
});
