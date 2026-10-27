import type { IndexStatus } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexStatusFeed, statusSettled } from "../src/index-status-feed";

// AO-4b — `index.status.subscribe`'s one poller (index-status-feed.ts): one read
// a tick for every listener, and only while anyone listens; a second while
// History reads, half a minute once nothing is read, at once on a poke (the
// daemon's phase moved). The door's own floor and dedupe are `wholeValueDoor`'s.

const status = (phase: string, readiness?: string): IndexStatus =>
  ({
    phase,
    rosettad: { phase: "ready", detail: null, pid: 1, protocolVersion: 20 },
    enrollment: { enabledKinds: [], runtimes: [], retired: [], updatedAt: null },
    runtimes: [],
    ...(readiness === undefined
      ? {}
      : {
          search: {
            reachable: true,
            capabilities: { sessionScope: true, prefix: true },
            readiness,
          },
        }),
  }) as IndexStatus;

const TICKS = { importMs: 1_000, restMs: 30_000 };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A feed over a scripted daemon whose next answer the test sets. */
function feed(first: IndexStatus) {
  let answer = first;
  const read = vi.fn(async () => answer);
  return {
    feed: new IndexStatusFeed({ read, ticks: TICKS }),
    read,
    answer: (next: IndexStatus) => {
      answer = next;
    },
  };
}

describe("AO-4b — the status feed: one poller while anyone listens", () => {
  it("reads once for the first holder, shares it with the next, and ticks every second while History reads", async () => {
    const f = feed(status("backfilling"));
    const a = await f.feed.open();
    const b = await f.feed.open();
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(b.current().phase).toBe("backfilling");
    const heard = vi.fn();
    a.onChange(heard);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(f.read).toHaveBeenCalledTimes(4);
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it("slows to half a minute once nothing is read, and reads at once on a poke", async () => {
    const f = feed(status("live", "ready"));
    await f.feed.open();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.read).toHaveBeenCalledTimes(1);
    // a consent restarted the daemon: its phase moved
    f.answer(status("starting"));
    f.feed.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.read).toHaveBeenCalledTimes(2);
    // and the fast tick is back while it reads
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.read).toHaveBeenCalledTimes(3);
  });

  it("stops with the last holder, and a later holder reads afresh rather than hours-old news", async () => {
    const f = feed(status("backfilling"));
    const a = await f.feed.open();
    const b = await f.feed.open();
    a.close();
    a.close(); // twice is once
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.read).toHaveBeenCalledTimes(2);
    b.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.feed.holders).toBe(0);
    f.feed.poke(); // nobody listens: nothing read
    await vi.advanceTimersByTimeAsync(0);
    expect(f.read).toHaveBeenCalledTimes(2);
    f.answer(status("live", "ready"));
    const c = await f.feed.open();
    expect(f.read).toHaveBeenCalledTimes(3);
    expect(c.current().phase).toBe("live");
  });

  it("a first read that fails is the open's failure; a later one keeps the last status", async () => {
    const read = vi.fn(async (): Promise<IndexStatus> => {
      throw new Error("the agent index did not answer");
    });
    const failing = new IndexStatusFeed({ read, ticks: TICKS });
    await expect(failing.open()).rejects.toThrow("did not answer");
    expect(failing.holders).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(read).toHaveBeenCalledTimes(1);

    const f = feed(status("backfilling"));
    const lease = await f.feed.open();
    f.read.mockRejectedValueOnce(new Error("the agent index did not answer"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lease.current().phase).toBe("backfilling");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.read).toHaveBeenCalledTimes(3);
  });

  it("calls a status settled when nothing is left to read", () => {
    expect(statusSettled(status("live", "ready"))).toBe(true);
    expect(statusSettled(status("live", "failed"))).toBe(true);
    expect(statusSettled(status("live", "building"))).toBe(false);
    expect(statusSettled(status("live", "catching-up"))).toBe(false);
    for (const phase of ["unconfigured", "awaiting_consent", "metadata_ready", "failed", "stopped"])
      expect(statusSettled(status(phase)), phase).toBe(true);
    for (const phase of ["starting", "discovering", "backfilling", "finalizing", "publishing"])
      expect(statusSettled(status(phase)), phase).toBe(false);
  });
});
