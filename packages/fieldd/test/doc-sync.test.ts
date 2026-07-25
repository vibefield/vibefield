// C6-3f — the storage half of cross-device doc sync.
//
// Two things are proven here, and they are the two the plan said to settle
// before any of this was written (thinking-c6 §5, answered by probe in §8):
//
//   1. A peer's opaque update record, RE-FRAMED onto our own journal head,
//      replays converged. Verbatim append is impossible — the journal is a
//      linear chain and a peer's revision ids belong to the peer's chain — so
//      re-framing is the whole mechanism, and this is where it is checked
//      against real Loro rather than asserted in a comment.
//   2. The epoch fence (S4) holds. Appending is safe WITHIN an epoch and never
//      across one, and getting that wrong is how two devices diverge with
//      neither noticing.
//
// No mesh here on purpose: this is the half that can be proven without a
// tailnet, so it is proven on every commit. The lane wiring is C6-3g.
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOC_SYNC_RECORD,
  type DocSyncRecord,
  decodeDocSyncRecord,
  encodeDocSyncRecord,
} from "@vibefield/contracts";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentService } from "../src/doc-service";
import { RpcCallError } from "../src/native-link";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function service(): { docs: DocumentService; dataDir: string } {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-docsync-"));
  dirs.push(dataDir);
  return { docs: new DocumentService({ dataDir }), dataDir };
}

/** An ICE1 envelope as far as fieldd is concerned: the magic gate is the ONLY
 * inspection it performs (B3 shape A). The document's content lives entirely in
 * journal records here, which is exactly what the sync path ferries — so the
 * test never has to pretend it can parse a real checkpoint. */
function ice1(filler = "checkpoint"): Uint8Array {
  return new Uint8Array([0x49, 0x43, 0x45, 0x31, ...new TextEncoder().encode(filler)]);
}

const EMPTY_VERSION = new LoroDoc().version();

/** One opaque Loro update record, the shape the renderer produces. */
function edit(peerId: bigint, key: string, value: string): Uint8Array {
  const doc = new LoroDoc();
  doc.setPeerId(peerId);
  doc.getMap("board").set(key, value);
  doc.commit();
  return doc.export({ mode: "update", from: EMPTY_VERSION });
}

/** Replay a stored doc the way readDoc's consumer does: the checkpoint is
 * opaque, every journal record imports in stored order. */
function replay(updates: Uint8Array[]): Record<string, unknown> {
  const doc = new LoroDoc();
  doc.setPeerId(99n);
  for (const u of updates) doc.import(u);
  return doc.toJSON().board as Record<string, unknown>;
}

function remote(
  payload: Uint8Array,
  baseEpoch = 0,
  kind: number = DOC_SYNC_RECORD.UPDATE,
): DocSyncRecord {
  return decodeDocSyncRecord(
    encodeDocSyncRecord(kind, { baseEpoch, engineSchema: 11, savedAt: 1 }, payload),
  );
}

async function seeded(docs: DocumentService): Promise<string> {
  const entry = await docs.create("board");
  await docs.writeDoc(entry.docId, ice1(), {
    revisionId: randomUUID(),
    kind: "checkpoint",
    engineSchema: 11,
    savedAt: 1,
    byteLength: ice1().byteLength,
  });
  return entry.docId;
}

describe("a peer's record on our journal", () => {
  it("re-frames onto our own head and replays converged", async () => {
    // THE PAYOFF. A edits locally; B's record arrives over the mesh; the stored
    // journal must replay to a doc containing both, in either arrival order.
    const { docs } = service();
    const docId = await seeded(docs);

    const fromA = edit(1n, "fromA", "alpha");
    const fromB = edit(2n, "fromB", "beta");

    await docs.writeDoc(docId, fromA, {
      revisionId: randomUUID(),
      kind: "update",
      baseRevisionId: (await docs.readDocMeta(docId))?.revisionId,
      engineSchema: 11,
      savedAt: 2,
      byteLength: fromA.byteLength,
    });
    const outcome = await docs.applyRemoteRecord(docId, remote(fromB));
    expect(outcome.applied).toBe(true);

    const stored = await docs.readDoc(docId);
    expect(stored?.updates).toHaveLength(2);
    expect(replay(stored?.updates ?? [])).toEqual({ fromA: "alpha", fromB: "beta" });
  });

  it("keeps the peer's bytes byte-for-byte — it re-frames the RECORD, not the payload", async () => {
    const { docs } = service();
    const docId = await seeded(docs);
    const fromB = edit(2n, "fromB", "beta");
    await docs.applyRemoteRecord(docId, remote(fromB));
    const stored = await docs.readDoc(docId);
    expect([...(stored?.updates[0] ?? [])]).toEqual([...fromB]);
  });

  it("converges the same whichever order the two records land in", async () => {
    // Loro's merge is order-independent, but the JOURNAL is a sequence — this
    // is the assertion that our storage does not accidentally reintroduce an
    // ordering requirement the data model does not have.
    const fromA = edit(1n, "fromA", "alpha");
    const fromB = edit(2n, "fromB", "beta");
    const results: Record<string, unknown>[] = [];
    for (const order of [
      [fromA, fromB],
      [fromB, fromA],
    ]) {
      const { docs } = service();
      const docId = await seeded(docs);
      for (const payload of order) {
        expect((await docs.applyRemoteRecord(docId, remote(payload))).applied).toBe(true);
      }
      results.push(replay((await docs.readDoc(docId))?.updates ?? []));
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual({ fromA: "alpha", fromB: "beta" });
  });

  it("declines an unknown record kind instead of throwing", async () => {
    // Tolerant reader: a newer peer may ship a kind this fieldd has no opinion
    // about, and that is not a reason to tear a lane down.
    const { docs } = service();
    const docId = await seeded(docs);
    const outcome = await docs.applyRemoteRecord(docId, remote(new Uint8Array([1]), 0, 200));
    expect(outcome).toEqual({ applied: false, reason: "unknown-kind" });
  });

  it("declines a record for a doc it has never heard of", async () => {
    const { docs } = service();
    const outcome = await docs.applyRemoteRecord(randomUUID(), remote(edit(2n, "x", "y")));
    expect(outcome).toEqual({ applied: false, reason: "unknown-doc" });
  });
});

describe("bootstrap by snapshot", () => {
  it("seeds a doc that has no content yet", async () => {
    const { docs } = service();
    const entry = await docs.create("board"); // catalogued, no bytes
    const snapshot = ice1("from-the-peer");
    const outcome = await docs.applyRemoteRecord(
      entry.docId,
      remote(snapshot, 0, DOC_SYNC_RECORD.SNAPSHOT),
    );
    expect(outcome.applied).toBe(true);
    const stored = await docs.readDoc(entry.docId);
    expect([...(stored?.bytes ?? [])]).toEqual([...snapshot]);
  });

  it("refuses to replace content it already has", async () => {
    // fieldd CANNOT merge two checkpoints — it cannot read them — and writeDoc
    // replaces rather than merges. Accepting one over local content would
    // destroy work that Loro itself would have merged happily. Declining is the
    // honest answer; merging belongs to the renderer, which holds the live doc.
    const { docs } = service();
    const docId = await seeded(docs);
    const before = await docs.readDoc(docId);
    const outcome = await docs.applyRemoteRecord(
      docId,
      remote(ice1("the-peers-board"), 0, DOC_SYNC_RECORD.SNAPSHOT),
    );
    expect(outcome).toEqual({ applied: false, reason: "would-clobber" });
    const after = await docs.readDoc(docId);
    expect([...(after?.bytes ?? [])]).toEqual([...(before?.bytes ?? [])]);
  });
});

describe("the epoch fence (S4)", () => {
  it("declines a peer record from another epoch rather than appending across it", async () => {
    const { docs } = service();
    const docId = await seeded(docs);
    const outcome = await docs.applyRemoteRecord(docId, remote(edit(2n, "late", "record"), 1));
    expect(outcome).toEqual({ applied: false, reason: "epoch-mismatch" });
    expect((await docs.readDoc(docId))?.updates).toHaveLength(0);
  });

  it("refuses a local update that names the wrong epoch", async () => {
    const { docs } = service();
    const docId = await seeded(docs);
    const payload = edit(1n, "a", "b");
    await expect(
      docs.writeDoc(docId, payload, {
        revisionId: randomUUID(),
        kind: "update",
        baseRevisionId: (await docs.readDocMeta(docId))?.revisionId,
        baseEpoch: 7,
        engineSchema: 11,
        savedAt: 2,
        byteLength: payload.byteLength,
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
  });

  it("refuses an update that declares NO epoch once the doc has been compacted", async () => {
    // `doc.compact` does not exist yet, so the epoch is synthesized — building
    // the ferry first and retrofitting the fence later is exactly how a peer
    // diverges silently, so the fence is tested before it can be reached.
    const { docs, dataDir } = service();
    const docId = await seeded(docs);
    const registryPath = join(dataDir, "registries", "field.docs.v1.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry[0].baseEpoch = 1; // as a compaction would leave it
    writeFileSync(registryPath, JSON.stringify(registry));

    const reopened = new DocumentService({ dataDir });
    expect(reopened.list()[0]?.baseEpoch).toBe(1);
    const payload = edit(1n, "a", "b");
    const attempt = reopened.writeDoc(docId, payload, {
      revisionId: randomUUID(),
      kind: "update",
      baseRevisionId: (await reopened.readDocMeta(docId))?.revisionId,
      // no baseEpoch — the pre-C6-3f client shape
      engineSchema: 11,
      savedAt: 2,
      byteLength: payload.byteLength,
    });
    await expect(attempt).rejects.toBeInstanceOf(RpcCallError);
    await expect(attempt).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    // …and it says which epoch to re-bootstrap onto, rather than only "no".
    await attempt.catch((e: RpcCallError) => {
      expect(e.message).toMatch(/epoch 1/);
    });
  });

  it("admits an undeclared epoch while the doc has never been compacted", async () => {
    // The renderer does not send baseEpoch yet, and every doc is at epoch 0 —
    // so the fence must not break the client that exists today.
    const { docs } = service();
    const docId = await seeded(docs);
    const payload = edit(1n, "a", "b");
    const meta = await docs.writeDoc(docId, payload, {
      revisionId: randomUUID(),
      kind: "update",
      baseRevisionId: (await docs.readDocMeta(docId))?.revisionId,
      engineSchema: 11,
      savedAt: 2,
      byteLength: payload.byteLength,
    });
    expect(meta.journalEntries).toBe(1);
  });
});

describe("the head that moved under a writer", () => {
  it("accepts an update composed against a revision a peer has since displaced", async () => {
    // THE CONTRACT CHANGE. doclane tracks the head from its own PUT_OK, so a
    // peer's append makes the renderer's next save name a stale base. Before
    // C6-3f that was PRECONDITION_FAILED — i.e. every save during a peer's edit
    // would fail. It is now an ordinary append, because replay converges
    // whatever the order (measured, §8 Q1).
    const { docs } = service();
    const docId = await seeded(docs);
    const headTheRendererKnows = (await docs.readDocMeta(docId))?.revisionId;

    // a peer's record lands in between
    await docs.applyRemoteRecord(docId, remote(edit(2n, "fromB", "beta")));

    const fromA = edit(1n, "fromA", "alpha");
    const meta = await docs.writeDoc(docId, fromA, {
      revisionId: randomUUID(),
      kind: "update",
      baseRevisionId: headTheRendererKnows, // stale, and that is now fine
      engineSchema: 11,
      savedAt: 3,
      byteLength: fromA.byteLength,
    });
    expect(meta.journalEntries).toBe(2);
    expect(replay((await docs.readDoc(docId))?.updates ?? [])).toEqual({
      fromA: "alpha",
      fromB: "beta",
    });
  });
});
