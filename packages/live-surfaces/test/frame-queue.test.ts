import { describe, expect, it } from "vitest";
import {
  LatestLiveSurfaceFrameQueue,
  type LiveSurfaceFrameReleaseReason,
} from "../src/frame-queue";

interface TestFrame {
  readonly id: string;
}

interface TestMetadata {
  readonly producerEpoch: number;
  readonly sequence: string;
}

function frame(id: string, sequence: string, producerEpoch = 1) {
  return { value: { id }, metadata: { producerEpoch, sequence } };
}

describe("LatestLiveSurfaceFrameQueue", () => {
  it("keeps one in-flight and only the newest pending frame", () => {
    const releases: Array<[string, LiveSurfaceFrameReleaseReason]> = [];
    const queue = new LatestLiveSurfaceFrameQueue<TestFrame, TestMetadata>(
      1,
      (released, reason) => {
        releases.push([released.value.id, reason]);
      },
    );

    expect(queue.offer(frame("one", "1"))).toEqual({ kind: "accepted" });
    expect(queue.offer(frame("two", "2"))).toEqual({ kind: "replaced" });
    expect(releases).toEqual([["one", "superseded"]]);

    const two = queue.take();
    expect(two?.frame.value.id).toBe("two");
    expect(queue.take()).toBeNull();
    expect(queue.offer(frame("three", "3"))).toEqual({ kind: "accepted" });
    expect(queue.offer(frame("four", "4"))).toEqual({ kind: "replaced" });
    expect(queue.stats).toMatchObject({ pending: 1, inFlight: 1 });

    two?.release();
    two?.release();
    const four = queue.take();
    expect(four?.frame.value.id).toBe("four");
    four?.release();
    expect(releases).toEqual([
      ["one", "superseded"],
      ["three", "superseded"],
      ["two", "consumed"],
      ["four", "consumed"],
    ]);
    expect(queue.stats).toMatchObject({ offered: 4, accepted: 4, taken: 2, released: 4 });
  });

  it("rejects stale epochs, stale sequences, malformed sequences, and absent demand", () => {
    const releases: Array<[string, LiveSurfaceFrameReleaseReason]> = [];
    const queue = new LatestLiveSurfaceFrameQueue<TestFrame, TestMetadata>(
      2,
      (released, reason) => {
        releases.push([released.value.id, reason]);
      },
    );
    expect(queue.offer(frame("old-epoch", "1", 1))).toMatchObject({
      kind: "dropped",
      reason: "stale-epoch",
    });
    expect(queue.offer(frame("valid", "2", 2))).toEqual({ kind: "accepted" });
    expect(queue.offer(frame("old-sequence", "1", 2))).toMatchObject({
      kind: "dropped",
      reason: "stale-sequence",
    });
    expect(queue.offer(frame("bad-sequence", "-1", 2))).toMatchObject({
      kind: "dropped",
      reason: "protocol-violation",
    });
    queue.setAccepting(false);
    expect(queue.offer(frame("paused", "3", 2))).toMatchObject({
      kind: "dropped",
      reason: "not-demanded",
    });
    expect(releases).toEqual([
      ["old-epoch", "stale-epoch"],
      ["old-sequence", "stale-sequence"],
      ["bad-sequence", "protocol-violation"],
      ["valid", "not-demanded"],
      ["paused", "not-demanded"],
    ]);
  });

  it("drains pending and in-flight ownership exactly once on epoch reset", () => {
    const releases: Array<[string, LiveSurfaceFrameReleaseReason]> = [];
    const queue = new LatestLiveSurfaceFrameQueue<TestFrame, TestMetadata>(
      1,
      (released, reason) => {
        releases.push([released.value.id, reason]);
      },
    );
    queue.offer(frame("in-flight", "1"));
    const lease = queue.take();
    queue.offer(frame("pending", "2"));
    queue.resetEpoch(2);
    lease?.release();
    expect(releases).toEqual([
      ["pending", "epoch-reset"],
      ["in-flight", "epoch-reset"],
    ]);
    expect(queue.stats).toMatchObject({ pending: 0, inFlight: 0 });
    expect(() => queue.resetEpoch(1)).toThrow(/backwards/);
  });

  it("makes close terminal and releases every later arrival", () => {
    const releases: Array<[string, LiveSurfaceFrameReleaseReason]> = [];
    const queue = new LatestLiveSurfaceFrameQueue<TestFrame, TestMetadata>(
      1,
      (released, reason) => {
        releases.push([released.value.id, reason]);
      },
    );
    queue.offer(frame("pending", "1"));
    queue.close();
    queue.close();
    expect(queue.offer(frame("late", "2"))).toEqual({ kind: "dropped", reason: "closed" });
    expect(releases).toEqual([
      ["pending", "closed"],
      ["late", "closed"],
    ]);
    expect(() => queue.resetEpoch(2)).toThrow(/closed/);
  });

  it("attempts every drained release even when one callback fails", () => {
    const attempted: string[] = [];
    const queue = new LatestLiveSurfaceFrameQueue<TestFrame, TestMetadata>(1, (released) => {
      attempted.push(released.value.id);
      if (released.value.id === "pending") throw new Error("fixture release failure");
    });
    queue.offer(frame("in-flight", "1"));
    queue.take();
    queue.offer(frame("pending", "2"));
    expect(() => queue.resetEpoch(2)).toThrow(/fixture release failure/);
    expect(attempted).toEqual(["pending", "in-flight"]);
    expect(queue.stats).toMatchObject({ pending: 0, inFlight: 0, released: 2 });
  });
});
