// DS-5 — DocumentService in LORO custody (DS-D18 RULED (a)). The renderer
// here is a plain LoroDoc framed by the ICE1 rule the spike proved: fieldd
// never reads the schema, so any Loro content drives exactly the paths ICE's
// does (the spike's own fixtures prove the frame on ICE-written bytes).
//
// The replay helper applies fieldd's at-rest doc the way a renderer does —
// checkpoint, then every journal record — and FAILS on a pending import,
// because strata quarantines a store permanently on one.
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOC_SYNC_RECORD, type DocSyncMeta } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { type DocCommit, DocumentService } from "../src/doc-service";
import { liftIce1 } from "../src/ice1-envelope";
import { EMPTY_VERSION, LoroHost, updateCarriesChanges } from "../src/loro-host";
import { Renderer, replay } from "./loro-renderer";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const META: DocSyncMeta = { baseEpoch: 0, engineSchema: 2, savedAt: 1 };

function service(onCommit?: (c: DocCommit) => void): DocumentService {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-host-"));
  dirs.push(dataDir);
  return new DocumentService({ dataDir, ...(onCommit ? { onCommit } : {}) });
}

async function put(
  docs: DocumentService,
  docId: string,
  kind: "checkpoint" | "update",
  bytes: Uint8Array,
): Promise<void> {
  await docs.writeDoc(docId, bytes, {
    revisionId: randomUUID(),
    kind,
    ...(kind === "update"
      ? { baseRevisionId: (await docs.readDocMeta(docId))?.revisionId ?? randomUUID() }
      : {}),
    engineSchema: 2,
    savedAt: Date.now(),
    byteLength: bytes.byteLength,
  });
}

/** DS-5c — a service whose host can be watched, on a clock the test moves. */
function resident(clock: { now: number }): { docs: DocumentService; host: LoroHost } {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-host-evict-"));
  dirs.push(dataDir);
  const host = new LoroHost();
  const docs = new DocumentService({
    dataDir,
    host,
    now: () => clock.now,
    residency: { idleMs: 1_000, sweepMs: 10 },
  });
  return { docs, host };
}

/** Long enough for several residency sweeps on a loaded machine. */
const sweeps = (): Promise<void> => new Promise((r) => setTimeout(r, 150));

const revisionFiles = (docs: DocumentService, docId: string): string[] =>
  readdirSync(join((docs as unknown as { docsDir: string }).docsDir, docId, "revisions")).filter(
    (f) => !f.includes(".tmp-"),
  );

describe("DS-5 — a doc in Loro custody", () => {
  it("a liftable checkpoint and its updates replay to the window's own document", async () => {
    const docs = service();
    const { docId } = await docs.create("board");
    const w = new Renderer(1n);
    w.edit("a", "1");
    await put(docs, docId, "checkpoint", w.checkpoint());
    await put(docs, docId, "update", w.edit("b", "2"));
    expect((await replay(docs, docId)).board()).toEqual({ a: "1", b: "2" });
    expect((await docs.hostVersion(docId))?.hasCheckpoint).toBe(true);
  });

  it("THE §1.2 DEFECT: a peer's checkpoint MERGES into a doc that holds content — not would-clobber", async () => {
    const docs = service();
    const { docId } = await docs.create("board");
    const here = new Renderer(1n);
    here.edit("mine", "kept");
    await put(docs, docId, "checkpoint", here.checkpoint());
    // A peer that bootstrapped from the same base, then edited, then FOLDED its
    // edits into a checkpoint (ICE's autosave does, on flush and every 64 appends).
    const peer = new Renderer(2n);
    peer.apply(
      liftIce1(here.checkpoint()).ok ? here.doc.export({ mode: "snapshot" }) : new Uint8Array(),
    );
    peer.edit("theirs", "folded");
    const outcome = await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.SNAPSHOT,
      meta: META,
      payload: peer.checkpoint(),
    });
    expect(outcome.applied).toBe(true);
    expect((await replay(docs, docId)).board()).toEqual({ mine: "kept", theirs: "folded" });
    // Delivered again, it is already held — nothing grows.
    const again = await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.SNAPSHOT,
      meta: META,
      payload: peer.checkpoint(),
    });
    expect(again).toEqual({ applied: false, reason: "already-held" });
  });

  it("opaque custody is untouched: a checkpoint the rule cannot lift still declines a peer's", async () => {
    const docs = service();
    const { docId } = await docs.create("legacy");
    const synthetic = new Uint8Array([
      0x49,
      0x43,
      0x45,
      0x31,
      ...new TextEncoder().encode("board"),
    ]);
    await put(docs, docId, "checkpoint", synthetic);
    expect(await docs.hostVersion(docId)).toBeNull();
    const peer = new Renderer(2n);
    peer.edit("x", "y");
    expect(
      await docs.applyRemoteRecord(docId, {
        kind: DOC_SYNC_RECORD.SNAPSHOT,
        meta: META,
        payload: peer.checkpoint(),
      }),
    ).toEqual({ applied: false, reason: "would-clobber" });
  });

  it("a renderer checkpoint keeps what the host holds BEYOND it as one residual record", async () => {
    const docs = service();
    const { docId } = await docs.create("board");
    const w = new Renderer(1n);
    w.edit("a", "1");
    await put(docs, docId, "checkpoint", w.checkpoint());
    await put(docs, docId, "update", w.edit("b", "2"));
    // A peer's edit lands while the window has not seen it.
    const peer = new Renderer(2n);
    peer.apply(w.doc.export({ mode: "snapshot" }));
    const fromPeer = peer.edit("p", "peer");
    expect(
      (
        await docs.applyRemoteRecord(docId, {
          kind: DOC_SYNC_RECORD.UPDATE,
          meta: META,
          payload: fromPeer,
        })
      ).applied,
    ).toBe(true);
    // The window checkpoints WITHOUT the peer's edit — before DS-5 that
    // replaced the journal holding it, and the edit was gone.
    w.edit("c", "3");
    await put(docs, docId, "checkpoint", w.checkpoint());
    const stored = await docs.readDoc(docId);
    expect(stored?.updates).toHaveLength(1); // the residual
    expect((await replay(docs, docId)).board()).toEqual({ a: "1", b: "2", c: "3", p: "peer" });
    // The replaced journal's files are gone; the new revision is checkpoint + residual.
    await new Promise((r) => setTimeout(r, 30));
    expect(revisionFiles(docs, docId)).toHaveLength(2);
  });

  it("an update the host already holds is absorbed — a pushed update's echo does not grow the journal", async () => {
    const commits: DocCommit[] = [];
    const docs = service((c) => commits.push(c));
    const { docId } = await docs.create("board");
    const w = new Renderer(1n);
    w.edit("a", "1");
    await put(docs, docId, "checkpoint", w.checkpoint());
    const peer = new Renderer(2n);
    peer.apply(w.doc.export({ mode: "snapshot" }));
    const pushed = peer.edit("p", "peer");
    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: pushed,
    });
    const journal = (await docs.readDoc(docId))?.updates.length;
    const announced = commits.length;
    // ICE's autosave journals an applied REMOTE update as the window's own append.
    await put(docs, docId, "update", pushed);
    expect((await docs.readDoc(docId))?.updates.length).toBe(journal);
    expect(commits.length).toBe(announced); // nothing to tell a peer
  });

  it("an update whose causal base is not held is refused, and nothing is journaled", async () => {
    const docs = service();
    const { docId } = await docs.create("board");
    const w = new Renderer(1n);
    w.edit("a", "1");
    await put(docs, docId, "checkpoint", w.checkpoint());
    const stranger = new Renderer(3n);
    stranger.edit("s1", "x");
    const dependent = (() => {
      const before = stranger.doc.oplogVersion();
      stranger.doc.getMap("board").set("s2", "y");
      stranger.doc.commit();
      return stranger.doc.export({ mode: "update", from: before });
    })();
    await expect(put(docs, docId, "update", dependent)).rejects.toThrow(/causal base/);
    expect((await docs.readDoc(docId))?.updates).toHaveLength(0);
  });

  it("a checkpoint's commit carries its DELTA — the folded edits no journal record held", async () => {
    const commits: DocCommit[] = [];
    const docs = service((c) => commits.push(c));
    const { docId } = await docs.create("board");
    const w = new Renderer(1n);
    w.edit("a", "1");
    await put(docs, docId, "checkpoint", w.checkpoint());
    const holder = new Renderer(2n);
    holder.apply(w.doc.export({ mode: "snapshot" }));
    // Two edits ICE never appended — flushed straight into a checkpoint.
    w.edit("folded1", "x");
    w.edit("folded2", "y");
    await put(docs, docId, "checkpoint", w.checkpoint());
    const last = commits.at(-1);
    expect(last?.kind).toBe("checkpoint");
    expect(last?.delta).toBeDefined();
    holder.apply(last?.delta as Uint8Array);
    expect(holder.board()).toEqual({ a: "1", folded1: "x", folded2: "y" });
  });

  it("hostAnswer bootstraps a holder with nothing and tops up a holder with something", async () => {
    const docs = service();
    const { docId } = await docs.create("board");
    const w = new Renderer(1n);
    w.edit("a", "1");
    await put(docs, docId, "checkpoint", w.checkpoint());
    await put(docs, docId, "update", w.edit("b", "2"));
    const empty = await docs.hostAnswer(docId, {
      version: EMPTY_VERSION().encode(),
      hasCheckpoint: false,
      baseEpoch: 0,
    });
    expect(empty?.snapshot).not.toBeNull();
    const fresh = new Renderer(5n);
    const lifted = liftIce1(empty?.snapshot as Uint8Array);
    if (!lifted.ok) throw new Error("answer is not an envelope");
    fresh.apply(lifted.payload);
    if (empty?.update) fresh.apply(empty.update);
    expect(fresh.board()).toEqual({ a: "1", b: "2" });
    // A holder that has everything is told nothing.
    const upToDate = await docs.hostAnswer(docId, {
      version: fresh.doc.oplogVersion().encode(),
      hasCheckpoint: true,
      baseEpoch: 0,
    });
    expect(upToDate).toMatchObject({ snapshot: null, update: null });
    // Another epoch is never answered (S4).
    expect(
      await docs.hostAnswer(docId, {
        version: EMPTY_VERSION().encode(),
        hasCheckpoint: true,
        baseEpoch: 1,
      }),
    ).toBeNull();
    const partial = await docs.hostAnswer(docId, {
      version: EMPTY_VERSION().encode(),
      hasCheckpoint: true,
      baseEpoch: 0,
    });
    expect(updateCarriesChanges(partial?.update as Uint8Array)).toBe(true);
  });
});

describe("DS-5c — an idle document leaves memory and comes back on demand", () => {
  it("idle → evicted → a late VERSION reloads it from disk and answers exactly", async () => {
    // The review: `loro-host.ts:170` never evicted — every greeted canvas's
    // full history stayed resident for the daemon's life.
    const clock = { now: 1_800_000_000_000 };
    const { docs, host } = resident(clock);
    const { docId } = await docs.create("board");
    const w = new Renderer(1n);
    w.edit("a", "1");
    await put(docs, docId, "checkpoint", w.checkpoint());
    await put(docs, docId, "update", w.edit("b", "2"));
    expect(host.ids()).toContain(docId);
    const heldVersion = (await docs.holdings(() => true))[0]?.headVersion;

    clock.now += 2_000; // no window, nothing on its chain, no lane touching it
    await sweeps();
    expect(host.ids()).not.toContain(docId);
    // The holders slice still says what this desktop holds.
    expect((await docs.holdings(() => true))[0]?.headVersion).toBe(heldVersion);

    // A peer that holds nothing greets: answered from disk, exactly.
    const answer = await docs.hostAnswer(docId, {
      version: EMPTY_VERSION().encode(),
      hasCheckpoint: false,
      baseEpoch: 0,
    });
    const lifted = liftIce1(answer?.snapshot ?? new Uint8Array());
    if (!lifted.ok) throw new Error("the answer carried no checkpoint");
    const fresh = new Renderer(5n);
    fresh.apply(lifted.payload);
    if (answer?.update) fresh.apply(answer.update);
    expect(fresh.board()).toEqual({ a: "1", b: "2" });
    expect(host.ids()).toContain(docId); // reloaded, resident again
    docs.dispose();
  });

  it("an open window keeps it resident, and so does an import still pending its base", async () => {
    const clock = { now: 1_800_000_000_000 };
    const { docs, host } = resident(clock);
    const { docId } = await docs.create("board");
    const w = new Renderer(1n);
    w.edit("a", "1");
    await put(docs, docId, "checkpoint", w.checkpoint());

    docs.writerAttached(docId); // a window holds the lane
    clock.now += 2_000;
    await sweeps();
    expect(host.ids()).toContain(docId);
    docs.writerDetached(docId);

    // A peer's second edit arrives before its first: the host holds it PENDING —
    // ops disk does not hold, which eviction would lose.
    const peer = new Renderer(9n);
    peer.apply(w.doc.export({ mode: "snapshot" }));
    const first = peer.edit("p1", "x");
    const second = peer.edit("p2", "y");
    expect(
      await docs.applyRemoteRecord(docId, {
        kind: DOC_SYNC_RECORD.UPDATE,
        meta: META,
        payload: second,
      }),
    ).toMatchObject({ applied: false, reason: "pending" });
    clock.now += 2_000;
    await sweeps();
    expect(host.ids()).toContain(docId);

    // The base lands: both apply, both reach disk, and the doc may go.
    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: first,
    });
    clock.now += 2_000;
    await sweeps();
    expect(host.ids()).not.toContain(docId);
    expect((await replay(docs, docId)).board()).toEqual({ a: "1", p1: "x", p2: "y" });
    docs.dispose();
  });
});
