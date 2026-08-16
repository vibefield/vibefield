import type { LiveSurfaceDemandV1 } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  LiveSurfaceDemandConflictError,
  LiveSurfaceDemandTracker,
  liveSurfaceDemandRequestsFrames,
} from "../src/demand";

function demand(revision: number, targetFps: 30 | 60 = 30): LiveSurfaceDemandV1 {
  return {
    revision,
    mode: "live",
    targetFps,
    targetRasterSize: { width: 1280, height: 800 },
    priority: 50,
    interactive: true,
  };
}

describe("LiveSurfaceDemandTracker", () => {
  it("accepts newer demand, ignores stale demand, and recognizes duplicates", () => {
    const tracker = new LiveSurfaceDemandTracker();
    expect(tracker.update(demand(2)).kind).toBe("accepted");
    expect(tracker.update(demand(1)).kind).toBe("stale");
    expect(tracker.update(demand(2)).kind).toBe("duplicate");
    expect(tracker.update(demand(3, 60))).toMatchObject({
      kind: "accepted",
      current: { revision: 3, targetFps: 60 },
    });
  });

  it("rejects conflicting reuse of a revision", () => {
    const tracker = new LiveSurfaceDemandTracker();
    tracker.update(demand(1));
    expect(() => tracker.update(demand(1, 60))).toThrow(LiveSurfaceDemandConflictError);
  });

  it("copies caller-owned demand and reports whether frames are requested", () => {
    const tracker = new LiveSurfaceDemandTracker();
    const input = demand(1);
    tracker.update(input);
    if (input.targetRasterSize !== undefined) input.targetRasterSize.width = 1;
    expect(tracker.current?.targetRasterSize?.width).toBe(1280);
    expect(liveSurfaceDemandRequestsFrames(tracker.current)).toBe(true);
    expect(
      liveSurfaceDemandRequestsFrames({
        revision: 2,
        mode: "paused",
        targetFps: 0,
        priority: 0,
        interactive: false,
      }),
    ).toBe(false);
  });
});
