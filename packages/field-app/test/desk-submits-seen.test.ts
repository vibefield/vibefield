// @vitest-environment node
// smoke:canvas's IDLE evidence (2026-10-26): the desk door keeps a watched queue's submits — each one's time and its
// command buffers' labels, the submitter's own tag — so the row can say WHO submitted for a still page in hand. The
// queue's own submit still runs; a queue is watched once; only the newest SUBMITS_KEPT are kept.

import { describe, expect, it } from "vitest";
import { SUBMITS_KEPT, submitsSeenOn, watchSubmits } from "../src/field/desk/desk-door";

function fakeQueue(): { queue: GPUQueue; ran: string[][] } {
  const ran: string[][] = [];
  const queue = {
    submit: (buffers: Iterable<GPUCommandBuffer>) => {
      ran.push([...buffers].map((b) => b.label));
    },
  } as unknown as GPUQueue;
  return { queue, ran };
}

const buffer = (label: string): GPUCommandBuffer => ({ label }) as unknown as GPUCommandBuffer;

describe("the desk door's submit watch", () => {
  it("keeps each submit's labels in order, and the queue's own submit still runs", () => {
    const { queue, ran } = fakeQueue();
    watchSubmits(queue);
    queue.submit([buffer("desk-live/still")]);
    queue.submit([buffer(""), buffer("comment-pad/ink grow")]);
    expect(ran).toEqual([["desk-live/still"], ["", "comment-pad/ink grow"]]);
    const seen = submitsSeenOn(queue) ?? [];
    expect(seen.map((s) => s.labels)).toEqual([["desk-live/still"], ["", "comment-pad/ink grow"]]);
    expect(seen[1]!.t).toBeGreaterThanOrEqual(seen[0]!.t);
  });

  it("watches a queue once: a second call neither wraps again nor starts over", () => {
    const { queue, ran } = fakeQueue();
    watchSubmits(queue);
    queue.submit([buffer("a")]);
    watchSubmits(queue);
    queue.submit([buffer("b")]);
    expect(ran).toEqual([["a"], ["b"]]);
    expect(submitsSeenOn(queue)?.map((s) => s.labels)).toEqual([["a"], ["b"]]);
  });

  it("keeps only the newest SUBMITS_KEPT", () => {
    const { queue } = fakeQueue();
    watchSubmits(queue);
    for (let i = 0; i < SUBMITS_KEPT + 5; i += 1) queue.submit([buffer(`s${i}`)]);
    const seen = submitsSeenOn(queue) ?? [];
    expect(seen).toHaveLength(SUBMITS_KEPT);
    expect(seen[0]!.labels).toEqual(["s5"]);
    expect(seen.at(-1)!.labels).toEqual([`s${SUBMITS_KEPT + 4}`]);
  });

  it("an unwatched queue has kept nothing", () => {
    expect(submitsSeenOn(fakeQueue().queue)).toBeUndefined();
  });
});
