import { createHash } from "node:crypto";
import { ROWS, RowsDigest } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogTable,
  createRowsPump,
  digestOfKeys,
  RowsCopy,
  type RowsEmit,
} from "../src/catalog-rows";

// DS-L3 — the rows protocol's machinery (catalog-rows.ts): the source table
// with its journal, one subscriber's pump, and the reader's copy. The
// boundaries are the protocol's: a kept cursor RESUMES while the journal
// covers it and RESETS the frame it stops; a snapshot is paged under the
// budget at one `{epoch, revision}`; the key digest is order-free and a
// mismatch at the same cursor is a reset, never a repair.

interface Row {
  id: string;
  title: string;
}

const keyOf = (row: Row): string => row.id;
const row = (id: string, title = id): Row => ({ id, title });
const table = (opts: { journalDepth?: number; pageBytes?: number; epoch?: string } = {}) =>
  new CatalogTable<Row>({ epoch: opts.epoch ?? "boot-1", keyOf, ...opts });
const parseRow = (raw: unknown): Row | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { id, title } = raw as Record<string, unknown>;
  return typeof id === "string" && typeof title === "string" ? { id, title } : undefined;
};
const copyOf = () => new RowsCopy<Row>({ keyOf, parseRow });
const sorted = (rows: Row[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

describe("CatalogTable — frames and the journal", () => {
  it("one revision per frame; an unchanged upsert and an absent removal make no frame", () => {
    const t = table();
    const first = t.upsert([row("a"), row("b")]);
    expect(first).toMatchObject({ epoch: "boot-1", since: 0, revision: 1 });
    expect(first?.upserts.map(keyOf)).toEqual(["a", "b"]);
    expect(t.upsert([row("a")])).toBeNull(); // equal to what is held
    expect(t.remove(["zzz"])).toBeNull(); // not held
    const second = t.apply({ upserts: [row("a", "A2")], removed: ["b"] });
    expect(second).toMatchObject({ since: 1, revision: 2, removed: ["b"] });
    expect(second?.upserts).toEqual([row("a", "A2")]);
    expect(t.revision).toBe(2);
    expect(t.rows()).toEqual([row("a", "A2")]);
  });

  it("replaceAll diffs a fresh snapshot: changed and new rows upsert, missing keys are removed", () => {
    const t = table();
    t.upsert([row("a"), row("b"), row("c")]);
    const delta = t.replaceAll([row("a"), row("c", "C2"), row("d")]);
    expect(delta?.upserts.map(keyOf).sort()).toEqual(["c", "d"]);
    expect(delta?.removed).toEqual(["b"]);
    expect(t.replaceAll([row("a"), row("c", "C2"), row("d")])).toBeNull(); // nothing moved
  });

  it("a kept cursor resumes while the journal covers it, and resets the frame it stops", () => {
    const t = table({ journalDepth: 3 });
    for (let i = 1; i <= 5; i += 1) t.upsert([row(`k${i}`)]); // revisions 1..5; frames 3..5 kept
    expect(t.deltaSince(1)).toBeNull(); // frame 2 is gone
    const fromTwo = t.deltaSince(2);
    expect(fromTwo).toMatchObject({ since: 2, revision: 5 });
    expect(fromTwo?.upserts.map(keyOf).sort()).toEqual(["k3", "k4", "k5"]);
    expect(t.deltaSince(5)).toMatchObject({ since: 5, revision: 5, upserts: [], removed: [] });
    expect(t.deltaSince(6)).toBeNull(); // a reader from the future is not this epoch's
    expect(t.open({ epoch: "boot-1", revision: 2 }).kind).toBe("resumed");
    expect(t.open({ epoch: "boot-1", revision: 1 }).kind).toBe("snapshot");
    expect(t.open({ epoch: "boot-0", revision: 5 }).kind).toBe("snapshot");
    expect(t.open(undefined).kind).toBe("snapshot");
  });

  it("the catch-up carries the CURRENT row of every changed key, and a removal as removed", () => {
    const t = table();
    t.upsert([row("a"), row("b"), row("c")]); // 1
    t.upsert([row("a", "A2")]); // 2
    t.upsert([row("b", "B2")]); // 3
    t.remove(["b"]); // 4
    t.upsert([row("a", "A3")]); // 5
    const plan = t.open({ epoch: "boot-1", revision: 1 });
    expect(plan.kind).toBe("resumed");
    if (plan.kind !== "resumed") return;
    expect(plan.resumed).toEqual({ epoch: "boot-1", revision: 1 });
    expect(plan.catchUp?.upserts).toEqual([row("a", "A3")]);
    expect(plan.catchUp?.removed).toEqual(["b"]);
    expect(plan.catchUp).toMatchObject({ since: 1, revision: 5 });
    // at the head: resumed with nothing owed
    const head = t.open({ epoch: "boot-1", revision: 5 });
    expect(head).toMatchObject({ kind: "resumed", catchUp: null });
  });

  it("a catch-up larger than a page resets instead of resuming", () => {
    const t = table({ pageBytes: 2_048 });
    t.upsert([row("seed")]);
    t.upsert(Array.from({ length: 80 }, (_, i) => row(`k${i}`, "x".repeat(40))));
    expect(t.deltaSince(1)).not.toBeNull(); // the journal covers it…
    expect(t.open({ epoch: "boot-1", revision: 1 }).kind).toBe("snapshot"); // …but it is too big
  });
});

describe("CatalogTable — snapshot pages", () => {
  it("pages under the budget at one {epoch, revision}; every page but the last says more", () => {
    const t = table({ pageBytes: 2_048 });
    const rows = Array.from({ length: 120 }, (_, i) =>
      row(`k${String(i).padStart(3, "0")}`, "t".repeat(30)),
    );
    t.upsert(rows);
    const pages = t.snapshotPages();
    expect(pages.length).toBeGreaterThan(2);
    for (const [i, page] of pages.entries()) {
      expect(page.epoch).toBe("boot-1");
      expect(page.revision).toBe(1);
      expect(page.more === true).toBe(i < pages.length - 1);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(2_048);
      expect(Object.keys(page).sort()).toEqual(
        i < pages.length - 1
          ? ["epoch", "more", "revision", "rows"]
          : ["epoch", "revision", "rows"],
      );
    }
    expect(pages.flatMap((page) => page.rows)).toEqual(rows);
  });

  it("a row larger than a page travels alone; an empty table is one empty page", () => {
    const t = table({ pageBytes: 1_024 });
    t.upsert([row("small"), row("huge", "h".repeat(4_000)), row("tail")]);
    const pages = t.snapshotPages();
    expect(pages.map((page) => page.rows.map(keyOf))).toEqual([["small"], ["huge"], ["tail"]]);
    expect(table().snapshotPages()).toEqual([{ epoch: "boot-1", revision: 0, rows: [] }]);
  });

  it("the default budget is the registry's", () => {
    expect(table().pageBytes).toBe(ROWS.SNAPSHOT_PAGE_BYTES);
  });
});

describe("the key digest", () => {
  it("is sha256 over the sorted keys joined by newlines, whatever the insertion order", () => {
    const one = table();
    one.upsert([row("b"), row("a"), row("c")]);
    const two = table();
    two.upsert([row("c")]);
    two.upsert([row("a"), row("b")]);
    const expected = createHash("sha256").update("a\nb\nc").digest("hex");
    expect(one.digest().keysHash).toBe(expected);
    expect(two.digest().keysHash).toBe(expected);
    expect(one.digest().count).toBe(3);
    expect(RowsDigest.safeParse(one.digest()).success).toBe(true);
    expect(ROWS.DIGEST_ALGORITHM).toBe("sha256");
  });

  it("moves with membership and not with content", () => {
    const t = table();
    t.upsert([row("a"), row("b")]);
    const before = t.digest().keysHash;
    t.upsert([row("a", "renamed")]);
    expect(t.digest().keysHash).toBe(before);
    t.remove(["b"]);
    expect(t.digest().keysHash).not.toBe(before);
    expect(digestOfKeys("e", 0, []).keysHash).toBe(createHash("sha256").update("").digest("hex"));
  });
});

describe("the pump and the copy — one subscriber, end to end", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** a copy fed by a pump, the way ProductAPI and a peer's client wire them */
  function follow(
    t: CatalogTable<Row>,
    copy: RowsCopy<Row>,
    opts: { minIntervalMs?: number; digestIntervalMs?: number } = {},
  ) {
    const frames: Array<{ payload: unknown; kind: "delta" | "snapshot" }> = [];
    const outcomes: unknown[] = [];
    const emit: RowsEmit = (payload, kind) => {
      frames.push({ payload, kind });
      outcomes.push(copy.apply(payload));
    };
    const pump = createRowsPump({
      table: t,
      since: copy.cursor(),
      emit,
      minIntervalMs: opts.minIntervalMs ?? 100,
      digestIntervalMs: opts.digestIntervalMs ?? 0,
    });
    outcomes.push(copy.apply(pump.open));
    pump.start();
    return { pump, frames, outcomes };
  }

  it("a fresh reader takes the paged snapshot, then coalesced deltas at its own floor", () => {
    const t = table({ pageBytes: 1_024 });
    t.upsert(Array.from({ length: 40 }, (_, i) => row(`k${i}`, "v".repeat(20))));
    const copy = copyOf();
    const { pump, frames } = follow(t, copy, { minIntervalMs: 100 });
    expect(frames.filter((f) => f.kind === "snapshot").length).toBeGreaterThan(0); // pages 2..n
    expect(sorted(copy.rows())).toEqual(sorted(t.rows()));
    expect(copy.cursor()).toEqual({ epoch: "boot-1", revision: 1 });

    const before = frames.length;
    t.upsert([row("k1", "one")]);
    vi.advanceTimersByTime(0); // the first change after a quiet spell goes at once
    t.upsert([row("k2", "two")]);
    t.remove(["k3"]);
    vi.advanceTimersByTime(50);
    expect(frames.length).toBe(before + 1); // the floor holds the next two
    vi.advanceTimersByTime(60);
    expect(frames.length).toBe(before + 2); // …and sends them as ONE delta
    const last = frames.at(-1);
    expect(last?.kind).toBe("delta");
    expect(Object.keys(last?.payload as object).sort()).toEqual([
      "epoch",
      "removed",
      "revision",
      "since",
      "upserts",
    ]);
    expect(last?.payload).toMatchObject({ since: 2, revision: 4, removed: ["k3"] });
    expect(sorted(copy.rows())).toEqual(sorted(t.rows()));
    expect(copy.cursor()).toEqual({ epoch: "boot-1", revision: 4 });

    pump.dispose();
    t.upsert([row("after-dispose")]);
    vi.advanceTimersByTime(1_000);
    expect(frames.at(-1)).toBe(last); // disposed means disposed
  });

  it("a reader that kept its cursor resumes with one catch-up delta", () => {
    const t = table();
    t.upsert([row("a"), row("b")]);
    const copy = copyOf();
    follow(t, copy).pump.dispose();
    t.upsert([row("c")]);
    t.remove(["a"]);
    const { frames, outcomes } = follow(t, copy);
    expect(outcomes[0]).toEqual({ changed: false }); // the {resumed} answer
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ kind: "delta", payload: { since: 1, revision: 3 } });
    expect(sorted(copy.rows())).toEqual([row("b"), row("c")]);
  });

  it("a reader that fell out of the journal between flushes is RESET with pages", () => {
    const t = table({ journalDepth: 2 });
    t.upsert([row("a")]);
    const copy = copyOf();
    const { frames } = follow(t, copy, { minIntervalMs: 1_000 });
    t.upsert([row("b")]);
    vi.advanceTimersByTime(0); // sent at once: revision 2
    for (let i = 0; i < 5; i += 1) t.upsert([row(`n${i}`)]); // 3..7 inside the floor
    vi.advanceTimersByTime(1_000);
    const last = frames.at(-1);
    expect(last?.kind).toBe("snapshot"); // the journal no longer reaches revision 2
    expect(last?.payload).toMatchObject({ epoch: "boot-1", revision: 7 });
    expect(sorted(copy.rows())).toEqual(sorted(t.rows()));
  });

  it("a caught-up reader hears the digest; a copy that drifted resets on it", () => {
    const t = table();
    t.upsert([row("a"), row("b")]);
    const copy = copyOf();
    const { outcomes } = follow(t, copy, { digestIntervalMs: 1_000 });
    vi.advanceTimersByTime(1_000);
    expect(outcomes.at(-1)).toEqual({ changed: false }); // agrees

    // a copy that drifted at the SAME cursor (a missed removal): reset, never repair
    const drifted = new RowsCopy<Row>(
      { keyOf, parseRow },
      { epoch: "boot-1", revision: 1, rows: [row("a"), row("b"), row("ghost")] },
    );
    const heartbeat = {
      epoch: "boot-1",
      since: 1,
      revision: 1,
      upserts: [],
      removed: [],
      digest: t.digest(),
    };
    expect(drifted.apply(heartbeat)).toMatchObject({ changed: false, resubscribe: "reset" });
    // …and a copy at another revision does not compare at all
    const behind = new RowsCopy<Row>(
      { keyOf, parseRow },
      { epoch: "boot-1", revision: 0, rows: [row("ghost")] },
    );
    expect(behind.apply(heartbeat)).toEqual({ changed: false });
  });
});

describe("RowsCopy — the reader's rules", () => {
  const at = (revision: number, rows: Row[], epoch = "boot-1") =>
    new RowsCopy<Row>({ keyOf, parseRow }, { epoch, revision, rows });
  const delta = (
    since: number,
    revision: number,
    upserts: Row[],
    removed: string[] = [],
    epoch = "boot-1",
  ) => ({
    epoch,
    since,
    revision,
    upserts,
    removed,
  });

  it("a delta applies when it brackets the copy — an OLD cursor's catch-up still lands", () => {
    const copy = at(7, [row("a"), row("b")]);
    // the manager replayed the first attach's params (since 5): the catch-up spans 5→9
    expect(copy.apply({ resumed: { epoch: "boot-1", revision: 5 } })).toEqual({ changed: false });
    expect(copy.apply(delta(5, 9, [row("a", "A9"), row("c")], ["b"]))).toEqual({ changed: true });
    expect(sorted(copy.rows())).toEqual([row("a", "A9"), row("c")]);
    expect(copy.cursor()).toEqual({ epoch: "boot-1", revision: 9 });
  });

  it("a stale delta is skipped; a gap asks for a re-subscribe from the cursor", () => {
    const copy = at(9, [row("a")]);
    expect(copy.apply(delta(7, 8, [row("x")]))).toEqual({ changed: false });
    expect(copy.rows()).toEqual([row("a")]);
    expect(copy.apply(delta(10, 11, [row("y")]))).toMatchObject({ resubscribe: "cursor" });
    expect(copy.rows()).toEqual([row("a")]);
  });

  it("another epoch resets; a resumed cursor this copy never held resets", () => {
    expect(at(3, []).apply(delta(3, 4, [row("a")], [], "boot-2"))).toMatchObject({
      resubscribe: "reset",
    });
    expect(at(3, []).apply({ resumed: { epoch: "boot-1", revision: 8 } })).toMatchObject({
      resubscribe: "reset",
    });
    expect(copyOf().apply(delta(0, 1, [row("a")]))).toMatchObject({ resubscribe: "reset" });
  });

  it("a paged snapshot replaces the copy only when its last page lands — in every spelling", () => {
    const copy = at(2, [row("old")]);
    expect(
      copy.apply({ snapshot: { epoch: "boot-2", revision: 5, rows: [row("p1")], more: true } }),
    ).toEqual({
      changed: false,
    });
    expect(copy.rows()).toEqual([row("old")]); // the old copy stays visible meanwhile
    expect(copy.apply({ epoch: "boot-2", revision: 5, rows: [row("p2")] })).toEqual({
      changed: true,
    });
    expect(sorted(copy.rows())).toEqual([row("p1"), row("p2")]);
    expect(copy.cursor()).toEqual({ epoch: "boot-2", revision: 5 });
    // the frame union's wrapper spelling
    expect(copy.apply({ delta: delta(5, 6, [row("p3")], [], "boot-2") })).toEqual({
      changed: true,
    });
    expect(copy.size).toBe(3);
  });

  it("a row the gate cannot read is dropped and reported; the frame still applies", () => {
    const dropped: unknown[] = [];
    const copy = new RowsCopy<Row>(
      { keyOf, parseRow, onDropped: (raw) => dropped.push(raw) },
      { epoch: "boot-1", revision: 1, rows: [] },
    );
    expect(copy.apply(delta(1, 2, [row("ok"), { id: 7 } as unknown as Row]))).toEqual({
      changed: true,
    });
    expect(copy.rows()).toEqual([row("ok")]);
    expect(dropped).toEqual([{ id: 7 }]);
    expect(copy.apply("garbage")).toMatchObject({ resubscribe: "cursor" });
    expect(
      copy.apply({ epoch: "boot-1", since: -1, revision: 2, upserts: [], removed: [] }),
    ).toMatchObject({
      resubscribe: "cursor",
    });
  });
});
