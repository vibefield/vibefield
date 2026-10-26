import { PRODUCT_API_LIMITS } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  atFloor,
  type DeltaFrame,
  diffRows,
  type FrameKind,
  projectRows,
  RevisionedSubscription,
  type SnapshotFrame,
  snapshotDeltaView,
  wholeValueDoor,
  wholeValueView,
} from "../src/projection";
import { FRAME_OVERHEAD_BYTES, meterRow, snapshotPages } from "../src/rows-pages";

// SP-1 (SP-L4) — the projection helper's own rows: idle sends nothing, the
// floor holds under churn, every subscriber keeps its own floor and chain, and
// a lost frame is repaired by a replacement rather than a delta the subscriber
// can no longer apply. The field board's rows (agent-field.test.ts) are the
// same machinery seen through the board, and stay as they were.

interface Item {
  id: string;
  status: string;
  /** churn the projection drops, like a usage sample */
  noise?: number;
}

/** a keyed table whose rows carry their own revision, like the field's */
function itemProjection() {
  return projectRows({
    project: (item: Item) => ({ id: item.id, status: item.status }),
    keyOf: (row: { id: string; status: string }) => row.id,
    stamp: (row: { id: string; status: string }, revision: number) => ({ ...row, revision }),
  });
}

/** a source of items with a change signal */
function source(initial: Item[]) {
  let items = initial;
  const listeners = new Set<() => void>();
  return {
    list: () => items,
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    set(next: Item[]) {
      items = next;
      for (const fn of [...listeners]) fn();
    },
    /** a signal with nothing behind it */
    poke() {
      for (const fn of [...listeners]) fn();
    },
    get listeners() {
      return listeners.size;
    },
  };
}

type Sent<T> = { at: number; frame: T; kind: FrameKind };

describe("projectRows — a keyed table whose idle costs nothing", () => {
  it("bumps a row's revision only when its PROJECTION changed, and the table's once per change", () => {
    const table = itemProjection();
    expect(table.apply([{ id: "a", status: "idle" }])).toMatchObject({ since: 0, revision: 1 });
    // only what the projection drops moved: nothing at all
    expect(table.apply([{ id: "a", status: "idle", noise: 7 }])).toBeNull();
    expect(table.snapshot()).toEqual({
      revision: 1,
      rows: [{ id: "a", status: "idle", revision: 1 }],
    });
    const change = table.apply([{ id: "a", status: "working" }]);
    expect(change).toEqual({
      since: 1,
      revision: 2,
      upserts: [{ id: "a", status: "working", revision: 2 }],
      removed: [],
    });
  });

  it("removes by KEY, and a row that leaves and returns starts its own count again", () => {
    const table = itemProjection();
    table.apply([
      { id: "a", status: "idle" },
      { id: "b", status: "idle" },
    ]);
    table.apply([
      { id: "a", status: "working" },
      { id: "b", status: "idle" },
    ]);
    expect(table.apply([{ id: "b", status: "idle" }])).toEqual({
      since: 2,
      revision: 3,
      upserts: [],
      removed: ["a"],
    });
    expect(
      table.apply([
        { id: "b", status: "idle" },
        { id: "a", status: "working" },
      ])?.upserts,
    ).toEqual([{ id: "a", status: "working", revision: 1 }]);
  });

  it("hands out copies, so a consumer cannot mutate the table it will diff against", () => {
    const table = itemProjection();
    table.apply([{ id: "a", status: "idle" }]);
    const held = table.snapshot();
    (held.rows[0] as { status: string }).status = "blocked";
    expect(table.snapshot().rows[0]?.status).toBe("idle");
    expect(table.apply([{ id: "a", status: "idle" }])).toBeNull();
  });
});

describe("diffRows", () => {
  it("upserts what is new or not the same (in next's order), removes what left (in prev's order)", () => {
    const prev = [
      { k: "a", v: 1 },
      { k: "b", v: 1 },
      { k: "c", v: 1 },
    ];
    const next = [
      { k: "c", v: 2 },
      { k: "a", v: 1 },
      { k: "d", v: 1 },
    ];
    expect(diffRows(prev, next, (row) => row.k)).toEqual({
      upserts: [
        { k: "c", v: 2 },
        { k: "d", v: 1 },
      ],
      removed: ["b"],
    });
    // a caller's own notion of "the same" (the field compares row revisions)
    expect(
      diffRows(
        prev,
        next,
        (row) => row.k,
        () => true,
      ).upserts,
    ).toEqual([{ k: "d", v: 1 }]);
  });
});

describe("RevisionedSubscription — one subscriber of one source", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** a snapshot-delta subscriber over a keyed table (`resets` as asked) */
  function rowsSubscriber(
    src: ReturnType<typeof source>,
    opts: {
      minIntervalMs: number;
      resets?: boolean;
      emit?: (frame: unknown, kind: FrameKind) => void;
      /** item 60 — page a snapshot at this budget (rows-pages.ts) */
      pageBytes?: number;
    },
  ) {
    const table = itemProjection();
    table.apply(src.list());
    const sent: Sent<unknown>[] = [];
    const errors: unknown[] = [];
    const subscriber = new RevisionedSubscription({
      view: snapshotDeltaView({
        table: () => table.snapshot(),
        apply: () => table.apply(src.list()),
        revision: () => table.revision,
        epoch: "boot-1.1",
        ...(opts.resets === true ? { resets: true } : {}),
      }),
      subscribe: src.subscribe,
      emit: (frame, kind) => {
        opts.emit?.(frame, kind);
        sent.push({ at: Date.now(), frame, kind });
      },
      minIntervalMs: opts.minIntervalMs,
      onError: (error) => errors.push(error),
      ...(opts.pageBytes !== undefined
        ? {
            pages: ({ rows, ...base }: SnapshotFrame<unknown>) =>
              snapshotPages(base, rows.map(meterRow), opts.pageBytes as number),
          }
        : {}),
    });
    return { subscriber, sent, errors };
  }

  it("answers a snapshot that carries its revision and its chain", () => {
    const src = source([{ id: "a", status: "idle" }]);
    const { subscriber } = rowsSubscriber(src, { minIntervalMs: 250 });
    expect(subscriber.snapshot).toEqual({
      epoch: "boot-1.1",
      revision: 1,
      rows: [{ id: "a", status: "idle", revision: 1 }],
    });
    expect(subscriber.revision).toBe(1);
    subscriber.dispose();
  });

  it("idle sends nothing: no signal, nothing; a signal whose window moved nothing, nothing", () => {
    const src = source([{ id: "a", status: "idle" }]);
    const { subscriber, sent } = rowsSubscriber(src, { minIntervalMs: 250 });
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    // signals with only dropped churn behind them, and a flap that ends where it began
    src.set([{ id: "a", status: "idle", noise: 1 }]);
    src.poke();
    src.set([{ id: "a", status: "working" }]);
    src.set([{ id: "a", status: "idle" }]);
    vi.advanceTimersByTime(1_000);
    expect(sent).toEqual([]);
    expect(subscriber.revision).toBe(1);
    subscriber.dispose();
  });

  it("the floor holds under churn: one frame per window, never two closer than the floor, none lost", () => {
    const src = source([{ id: "a", status: "s0" }]);
    const { subscriber, sent } = rowsSubscriber(src, { minIntervalMs: 250 });
    // a change every 10 ms for two seconds
    for (let i = 1; i <= 200; i += 1) {
      src.set([{ id: "a", status: `s${i}` }]);
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(250);
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.length).toBeLessThanOrEqual(Math.ceil(2_000 / 250) + 1);
    for (let i = 1; i < sent.length; i += 1)
      expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(250);
    // a chain the reader applies frame by frame, ending at the last state
    let held = 1;
    for (const { frame, kind } of sent) {
      expect(kind).toBe("delta");
      expect((frame as DeltaFrame<unknown>).since).toBe(held);
      held = (frame as DeltaFrame<unknown>).revision;
    }
    expect((sent.at(-1)!.frame as DeltaFrame<{ status: string }>).upserts[0]?.status).toBe("s200");
    subscriber.dispose();
  });

  it("keeps each subscriber's floor and revision chain to itself (250 ms and 100 ms on one source)", () => {
    const src = source([{ id: "a", status: "idle" }]);
    const slow = rowsSubscriber(src, { minIntervalMs: 250 });
    const fast = rowsSubscriber(src, { minIntervalMs: 100 });
    src.set([{ id: "a", status: "working" }]);
    vi.advanceTimersByTime(100);
    expect(fast.sent).toHaveLength(1);
    expect(slow.sent).toHaveLength(0);
    src.set([{ id: "a", status: "blocked" }]);
    vi.advanceTimersByTime(100);
    expect(fast.sent).toHaveLength(2);
    expect(slow.sent).toHaveLength(0);
    vi.advanceTimersByTime(50);
    // the slow reader's ONE frame carries both moves, chained from its own snapshot
    expect(slow.sent).toHaveLength(1);
    expect(slow.sent[0]?.frame).toMatchObject({ since: 1, revision: 2 });
    expect(fast.sent.map(({ frame }) => (frame as DeltaFrame<unknown>).revision)).toEqual([2, 3]);
    slow.subscriber.dispose();
    fast.subscriber.dispose();
  });

  it("a gap resnapshots: a frame that did not land is replaced by a snapshot, never chained past", () => {
    const src = source([{ id: "a", status: "idle" }]);
    let fail = true;
    const { subscriber, sent, errors } = rowsSubscriber(src, {
      minIntervalMs: 250,
      resets: true,
      emit: () => {
        if (fail) {
          fail = false;
          throw new Error("socket died mid-frame");
        }
      },
    });
    src.set([{ id: "a", status: "working" }]);
    vi.advanceTimersByTime(250);
    expect(errors).toHaveLength(1);
    expect(subscriber.gapped).toBe(true);
    // the next change: a SNAPSHOT at the current revision, not a delta from 2
    src.set([
      { id: "a", status: "blocked" },
      { id: "b", status: "idle" },
    ]);
    vi.advanceTimersByTime(250);
    // (the recorder keeps only what was delivered: the lost delta is not in it)
    expect(sent.map(({ kind }) => kind)).toEqual(["snapshot"]);
    expect(sent[0]?.frame).toEqual({
      epoch: "boot-1.1",
      revision: 3,
      rows: [
        { id: "a", status: "blocked", revision: 3 },
        { id: "b", status: "idle", revision: 1 },
      ],
    });
    expect(subscriber.gapped).toBe(false);
    // and the chain resumes from the snapshot's revision
    src.set([{ id: "b", status: "idle" }]);
    vi.advanceTimersByTime(250);
    expect(sent[1]).toMatchObject({
      kind: "delta",
      frame: { since: 3, revision: 4, removed: ["a"] },
    });
    subscriber.dispose();
  });

  it("resnapshot() asks for the replacement from outside, at the floor", () => {
    const src = source([{ id: "a", status: "idle" }]);
    const { subscriber, sent } = rowsSubscriber(src, { minIntervalMs: 250, resets: true });
    subscriber.resnapshot();
    vi.advanceTimersByTime(249);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([
      {
        at: expect.any(Number),
        kind: "snapshot",
        frame: { epoch: "boot-1.1", revision: 1, rows: [{ id: "a", status: "idle", revision: 1 }] },
      },
    ]);
    subscriber.dispose();
  });

  /** five rows, two to a page: each row's JSON is about 40 bytes */
  const FIVE = ["a", "b", "c", "d", "e"].map((id) => ({ id, status: "idle" }));
  const TWO_ROWS = FRAME_OVERHEAD_BYTES + 90;
  const pageOf = (frame: unknown) =>
    frame as SnapshotFrame<{ id: string }> & { more?: true; page: number; pages: number };

  it("item 60 — a snapshot past its page goes out in pages: the open answers the first, sendRest the rest, a reset all", () => {
    const src = source(FIVE);
    const { subscriber, sent } = rowsSubscriber(src, {
      minIntervalMs: 250,
      resets: true,
      pageBytes: TWO_ROWS,
    });
    const first = pageOf(subscriber.snapshot);
    expect(first).toMatchObject({ epoch: "boot-1.1", revision: 1, more: true, page: 0, pages: 3 });
    expect(first.rows.map((row) => row.id)).toEqual(["a", "b"]);
    // nothing is owed before the owner says the open answer has gone
    vi.advanceTimersByTime(1_000);
    expect(sent).toEqual([]);

    subscriber.sendRest();
    expect(sent.map(({ kind }) => kind)).toEqual(["snapshot", "snapshot"]);
    const rest = sent.map(({ frame }) => pageOf(frame));
    expect(rest.map(({ page, more }) => [page, more])).toEqual([
      [1, true],
      [2, undefined],
    ]);
    for (const page of rest) expect(page).toMatchObject({ epoch: "boot-1.1", revision: 1 });
    // the reader's copy, assembled: every row, once, in order
    expect([first, ...rest].flatMap((page) => page.rows.map((row) => row.id))).toEqual(
      FIVE.map(({ id }) => id),
    );
    // once: the open's pages are not owed twice
    subscriber.sendRest();
    expect(sent).toHaveLength(2);

    // a reset is every page of the replacement, in order, at the floor
    subscriber.resnapshot();
    vi.advanceTimersByTime(250);
    const reset = sent.slice(2).map(({ frame, kind }) => ({ kind, ...pageOf(frame) }));
    expect(reset.map(({ kind, page, pages, more }) => [kind, page, pages, more])).toEqual([
      ["snapshot", 0, 3, true],
      ["snapshot", 1, 3, true],
      ["snapshot", 2, 3, undefined],
    ]);
    expect(subscriber.gapped).toBe(false);
    subscriber.dispose();
  });

  it("item 60 — a page that does not land stops the rest and keeps the gap; the repair sends every page again", () => {
    const src = source(FIVE);
    let delivered = 0;
    const { subscriber, sent, errors } = rowsSubscriber(src, {
      minIntervalMs: 250,
      resets: true,
      pageBytes: TWO_ROWS,
      // the reset's second page dies mid-frame, once
      emit: () => {
        delivered += 1;
        if (delivered === 2) throw new Error("socket died mid-page");
      },
    });
    subscriber.resnapshot();
    vi.advanceTimersByTime(250);
    expect(errors).toHaveLength(1);
    expect(subscriber.gapped).toBe(true);
    // the page after the lost one was never sent: a half snapshot is no snapshot
    expect(sent.map(({ frame }) => pageOf(frame).page)).toEqual([0]);

    subscriber.resnapshot();
    vi.advanceTimersByTime(250);
    expect(sent.slice(1).map(({ frame }) => pageOf(frame).page)).toEqual([0, 1, 2]);
    expect(subscriber.gapped).toBe(false);
    subscriber.dispose();
  });

  it("a view with no reset leaves the gap to its reader (the field's wire): the next delta names what was lost", () => {
    const src = source([{ id: "a", status: "idle" }]);
    let fail = true;
    const { subscriber, sent } = rowsSubscriber(src, {
      minIntervalMs: 250,
      emit: () => {
        if (fail) {
          fail = false;
          throw new Error("socket died mid-frame");
        }
      },
    });
    src.set([{ id: "a", status: "working" }]);
    vi.advanceTimersByTime(250);
    src.set([{ id: "a", status: "blocked" }]);
    vi.advanceTimersByTime(250);
    // the lost frame was 1 -> 2; the reader holds 1, and `since: 2` is its
    // signal to re-subscribe (the tolerant reader's own rule)
    expect(sent.map(({ kind, frame }) => [kind, (frame as DeltaFrame<unknown>).since])).toEqual([
      ["delta", 2],
    ]);
    expect(subscriber.gapped).toBe(false);
    subscriber.resnapshot(); // no reset: nothing to ask for
    vi.advanceTimersByTime(1_000);
    expect(sent).toHaveLength(1);
    subscriber.dispose();
  });

  it("a heartbeat speaks only into silence, and a gapped chain is repaired at the beat, not beaten on", () => {
    const src = source([{ id: "a", status: "idle" }]);
    const table = itemProjection();
    table.apply(src.list());
    const sent: Sent<unknown>[] = [];
    let fail = false;
    const subscriber = new RevisionedSubscription({
      view: snapshotDeltaView({
        table: () => table.snapshot(),
        apply: () => table.apply(src.list()),
        revision: () => table.revision,
        resets: true,
      }),
      subscribe: src.subscribe,
      emit: (frame, kind) => {
        if (fail) {
          fail = false;
          throw new Error("lost");
        }
        sent.push({ at: Date.now(), frame, kind });
      },
      minIntervalMs: 250,
      heartbeatMs: 1_000,
      onError: () => {},
    });
    vi.advanceTimersByTime(999);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent[0]).toMatchObject({
      kind: "delta",
      frame: { since: 1, revision: 1, upserts: [], removed: [] },
    });
    // a frame re-arms it: a moving table carries no heartbeat (t = 1250 → 2249)
    src.set([{ id: "a", status: "working" }]);
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(999);
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sent[2]).toMatchObject({ frame: { since: 2, revision: 2, upserts: [] } });
    // the next frame is lost (t = 2500); the beat repairs instead of beating (t = 3500)
    fail = true;
    src.set([{ id: "a", status: "blocked" }]);
    vi.advanceTimersByTime(250);
    expect(subscriber.gapped).toBe(true);
    expect(sent).toHaveLength(3);
    vi.advanceTimersByTime(1_000);
    expect(sent.at(-1)).toMatchObject({ kind: "snapshot", frame: { revision: 3 } });
    expect(subscriber.gapped).toBe(false);
    subscriber.dispose();
  });

  it("dispose lets go of the source and sends nothing after", () => {
    const src = source([{ id: "a", status: "idle" }]);
    const { subscriber, sent } = rowsSubscriber(src, { minIntervalMs: 250 });
    expect(src.listeners).toBe(1);
    src.set([{ id: "a", status: "working" }]);
    subscriber.dispose();
    expect(src.listeners).toBe(0);
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a source that fails to read is logged, and the subscription stands", () => {
    let broken = false;
    const src = source([{ id: "a", status: "idle" }]);
    const table = itemProjection();
    table.apply(src.list());
    const errors: unknown[] = [];
    const sent: unknown[] = [];
    const subscriber = new RevisionedSubscription({
      view: snapshotDeltaView({
        table: () => table.snapshot(),
        apply: () => {
          if (broken) throw new Error("the source is restarting");
          return table.apply(src.list());
        },
        revision: () => table.revision,
      }),
      subscribe: src.subscribe,
      emit: (frame) => sent.push(frame),
      minIntervalMs: 100,
      onError: (error) => errors.push(error),
    });
    broken = true;
    src.set([{ id: "a", status: "working" }]);
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    expect(errors).toHaveLength(1);
    broken = false;
    src.poke();
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([
      {
        since: 1,
        revision: 2,
        upserts: [{ id: "a", status: "working", revision: 2 }],
        removed: [],
      },
    ]);
    subscriber.dispose();
  });
});

describe("wholeValueView — a stream of whole values, its wire untouched", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function stream(initial: string[], emit?: (frame: string[]) => void) {
    let value = initial;
    const listeners = new Set<() => void>();
    const sent: Sent<string[]>[] = [];
    const subscriber = new RevisionedSubscription({
      view: wholeValueView(() => value),
      subscribe: (onChange) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
      emit: (frame, kind) => {
        emit?.(frame);
        sent.push({ at: Date.now(), frame, kind });
      },
      minIntervalMs: 250,
      onError: () => {},
    });
    return {
      subscriber,
      sent,
      set(next: string[]) {
        value = next;
        for (const fn of [...listeners]) fn();
      },
      poke() {
        for (const fn of [...listeners]) fn();
      },
    };
  }

  it("opens with the value and sends the WHOLE newest value once per window, as a delta", () => {
    const s = stream(["a"]);
    expect(s.subscriber.snapshot).toEqual(["a"]);
    s.set(["a", "b"]);
    s.set(["a", "b", "c"]);
    vi.advanceTimersByTime(250);
    expect(s.sent).toEqual([{ at: expect.any(Number), frame: ["a", "b", "c"], kind: "delta" }]);
    // a signal whose value did not move sends nothing
    s.poke();
    vi.advanceTimersByTime(1_000);
    expect(s.sent).toHaveLength(1);
    s.subscriber.dispose();
  });

  it("a lost frame is healed by the newest value even when the source never moves again", () => {
    // the subscriber missed ["a","b"]; without the repair the next signal would
    // compare against what was SENT, find nothing new, and leave it at ["a"]
    let fail = true;
    const s = stream(["a"], () => {
      if (fail) {
        fail = false;
        throw new Error("lost");
      }
    });
    s.set(["a", "b"]);
    vi.advanceTimersByTime(250);
    expect(s.sent).toEqual([]);
    s.poke();
    vi.advanceTimersByTime(250);
    expect(s.sent).toEqual([{ at: expect.any(Number), frame: ["a", "b"], kind: "delta" }]);
    s.subscriber.dispose();
  });
});

describe("snapshotDeltaView's frames are the field's shapes", () => {
  it("stamps the chain's epoch and shapes rows at send time", () => {
    const table = itemProjection();
    table.apply([{ id: "a", status: "idle" }]);
    const view = snapshotDeltaView({
      table: () => table.snapshot(),
      apply: () => table.apply([{ id: "a", status: "working" }]),
      revision: () => table.revision,
      epoch: "boot-9.4",
      present: (rows) => rows.map((row) => ({ ...row, shaped: true })),
    });
    const open: SnapshotFrame<unknown> = view.open();
    expect(open).toEqual({
      epoch: "boot-9.4",
      revision: 1,
      rows: [{ id: "a", status: "idle", revision: 1, shaped: true }],
    });
    expect(view.advance()).toEqual({
      epoch: "boot-9.4",
      since: 1,
      revision: 2,
      upserts: [{ id: "a", status: "working", revision: 2, shaped: true }],
      removed: [],
    });
    expect(view.heartbeat?.()).toEqual({
      epoch: "boot-9.4",
      since: 2,
      revision: 2,
      upserts: [],
      removed: [],
    });
    expect(view.reset).toBeUndefined();
  });
});

describe("atFloor — a declared floor is a floor", () => {
  it("serves a faster ask at the floor, honours a slower one, and defaults to the floor", () => {
    expect(atFloor(16, 100)).toBe(100);
    expect(atFloor(1_000, 100)).toBe(1_000);
    expect(atFloor(undefined, 500)).toBe(500);
  });
});

describe("wholeValueDoor — the install a whole-value door hands ProductAPI", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens with the value, frames the whole newest value as a delta at the stream floor, and lets go", () => {
    let value = { rows: ["a"] };
    const listeners = new Set<() => void>();
    const sent: Array<[unknown, FrameKind | undefined]> = [];
    const door = wholeValueDoor(
      {
        read: () => value,
        onChange: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      (payload, kind) => sent.push([payload, kind]),
    );
    expect(door.snapshot).toEqual({ rows: ["a"] });
    value = { rows: ["a", "b"] };
    for (const fn of [...listeners]) fn();
    value = { rows: ["a", "b", "c"] };
    for (const fn of [...listeners]) fn();
    vi.advanceTimersByTime(PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([[{ rows: ["a", "b", "c"] }, "delta"]]);
    door.dispose();
    expect(listeners.size).toBe(0);
  });
});
