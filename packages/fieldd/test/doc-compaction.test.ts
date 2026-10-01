// DS-5d — COMPACTION on one desktop (design-06 §4; the mesh rows are
// doc-compaction-mesh.test.ts). A compacted canvas's base is a Loro SHALLOW
// snapshot framed by the ICE1 rule: history below the watermark lives in the
// state alone. Everything here is measured against loro-crdt 1.13.8's own
// behaviour (scratch probes, recorded in the commits): a doc loaded from a
// shallow snapshot exports only shallow snapshots, ICE opens one, an export
// "from" below the root starts AT the root, and an op whose base lies below
// the root PANICS the doc it is imported into.
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOC_SYNC_RECORD, type DocSyncMeta } from "@vibefield/contracts";
import { decodeImportBlobMeta, LoroDoc, VersionVector } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentService, type DocumentServiceOptions } from "../src/doc-service";
import { liftIce1, wrapIce1 } from "../src/ice1-envelope";
import { LibraryDocService, systemAccount, systemDocId } from "../src/library-doc";
import { decodeVersion, EMPTY_VERSION, loroBlobMode } from "../src/loro-host";
import { HEADER, Renderer, replay } from "./loro-renderer";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const META: DocSyncMeta = { baseEpoch: 0, engineSchema: 2, savedAt: 1 };

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-compact-"));
  dirs.push(dir);
  return dir;
}

function service(dir = dataDir(), opts: Partial<DocumentServiceOptions> = {}): DocumentService {
  return new DocumentService({ residency: false, ...opts, dataDir: dir });
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

/** The Loro payload of an ICE1 envelope. */
function payloadOf(envelope: Uint8Array): Uint8Array {
  const lifted = liftIce1(envelope);
  if (!lifted.ok) throw new Error(`not liftable: ${lifted.reason}`);
  return lifted.payload;
}

/** The shape that panics a shallow host (measured): Z on peer 1 and X on peer
 * 2, concurrent, over one shared op. The SHALLOW base is peer 1's doc at its
 * head (base + Z): its root is {1: 2}, and X's base (1:0) lies below it. */
function concurrentPair(): {
  shallowBase: Uint8Array;
  root: VersionVector;
  xAlone: Uint8Array;
  fullWithX: Uint8Array;
} {
  const one = new LoroDoc();
  one.setPeerId(1n);
  one.getMap("board").set("base", "b");
  one.commit();
  const two = new LoroDoc();
  two.setPeerId(2n);
  two.import(one.export({ mode: "snapshot" }));
  const twoAtBase = two.oplogVersion();
  one.getMap("board").set("z", "Z");
  one.commit();
  two.getMap("board").set("x", "X");
  two.commit();
  const full = new LoroDoc();
  full.import(one.export({ mode: "snapshot" }));
  full.import(two.export({ mode: "snapshot" }));
  return {
    shallowBase: one.export({ mode: "shallow-snapshot", frontiers: one.oplogFrontiers() }),
    root: one.oplogVersion(),
    xAlone: two.export({ mode: "update", from: twoAtBase }),
    fullWithX: full.export({ mode: "snapshot" }),
  };
}

/** A renderer whose doc carries history, compacted at its head — what a window
 * opened on a compacted canvas holds. */
function shallowWindow(peer: bigint): Renderer {
  const w = new Renderer(peer);
  w.edit("a", "1");
  w.edit("b", "2");
  const base = w.doc.export({ mode: "shallow-snapshot", frontiers: w.doc.oplogFrontiers() });
  const opened = new Renderer(peer + 100n);
  opened.apply(base);
  return opened;
}

describe("DS-5d — a canvas on a shallow base stays in Loro custody", () => {
  it("across a restart it is hosted from its base: it answers VERSION and bootstraps a holder", async () => {
    // Before DS-5d the host was rebuilt only from a FULL snapshot, so the
    // first reload after a compaction would have put the canvas in opaque
    // custody — no VERSION, no merge, the legacy HAVE ferry.
    const dir = dataDir();
    const docs = service(dir);
    const { docId } = await docs.create("board");
    const w = shallowWindow(1n);
    const checkpoint = w.checkpoint();
    // what ICE writes once its doc came from a shallow base (the probe)
    expect(loroBlobMode(payloadOf(checkpoint))).toBe("shallow-snapshot");
    await put(docs, docId, "checkpoint", checkpoint);
    await put(docs, docId, "update", w.edit("c", "3"));
    docs.dispose();

    const again = service(dir);
    const stated = await again.hostVersion(docId);
    expect(stated).toMatchObject({ hasCheckpoint: true, baseEpoch: 0 });
    // An empty holder is sent the base and the update since it, and opens it.
    const answer = await again.hostAnswer(docId, {
      version: EMPTY_VERSION().encode(),
      hasCheckpoint: false,
      baseEpoch: 0,
    });
    expect(answer?.snapshot).not.toBeNull();
    const fresh = new Renderer(9n);
    fresh.apply(payloadOf(answer?.snapshot as Uint8Array));
    if (answer?.update) fresh.apply(answer.update);
    expect(fresh.board()).toEqual({ a: "1", b: "2", c: "3" });
    again.dispose();
  });

  it("a window's shallow checkpoint folds, keeping what the host held beyond it", async () => {
    const dir = dataDir();
    const docs = service(dir);
    const { docId } = await docs.create("board");
    const w = shallowWindow(1n);
    await put(docs, docId, "checkpoint", w.checkpoint());
    docs.dispose();
    // A restart, then a peer's edit lands that the window never saw.
    const again = service(dir);
    const peer = await replay(again, docId, 7n);
    const outcome = await again.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: peer.edit("peer", "edit"),
    });
    expect(outcome.applied).toBe(true);
    // The window checkpoints again (its own new edit folded in) …
    w.editUnsent("mine", "too");
    await put(again, docId, "checkpoint", w.checkpoint());
    // … and the peer's edit is kept as the residual: nothing lost.
    expect((await replay(again, docId)).board()).toEqual({
      a: "1",
      b: "2",
      mine: "too",
      peer: "edit",
    });
    expect(await again.hostVersion(docId)).not.toBeNull();
    again.dispose();
  });
});

describe("DS-5d — nobody is answered from below a compacted root", () => {
  it("a window or a holder that lacks the root gets nothing, never a delta it cannot apply", async () => {
    // Loro exports "from" below a shallow root FROM the root (measured): the
    // bytes would hold ops whose base the receiver can never be sent — strata
    // quarantines a window on the first pending import.
    const docs = service();
    const { docId } = await docs.create("board");
    const { shallowBase, root } = concurrentPair();
    await put(docs, docId, "checkpoint", wrapIce1(HEADER, shallowBase));
    const below = EMPTY_VERSION().encode();
    expect(await docs.windowUpdateSince(docId, below)).toBeNull();
    expect(
      await docs.hostAnswer(docId, { version: below, hasCheckpoint: true, baseEpoch: 0 }),
    ).toBeNull();
    // At the root, the ordinary answers stand.
    expect(await docs.windowUpdateSince(docId, root.encode())).toBeNull(); // lacks nothing
    expect(
      await docs.hostAnswer(docId, { version: root.encode(), hasCheckpoint: true, baseEpoch: 0 }),
    ).toMatchObject({ snapshot: null, update: null });
    docs.dispose();
  });
});

describe("DS-5d — an import that panics Loro is contained", () => {
  it("a peer's record whose base lies below the root is declined and the canvas keeps answering", async () => {
    // Measured: importing X (its base below the root) PANICS the shallow doc
    // (RuntimeError: unreachable) and that doc holds its lock for good.
    // Before DS-5d the panicked doc stayed the host: every later VERSION,
    // window read and save on the canvas threw until fieldd restarted.
    const docs = service();
    const { docId } = await docs.create("board");
    const { shallowBase, xAlone } = concurrentPair();
    await put(docs, docId, "checkpoint", wrapIce1(HEADER, shallowBase));
    const before = await docs.readDoc(docId);
    const outcome = await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: xAlone,
    });
    expect(outcome).toEqual({ applied: false, reason: "undecodable" });
    // The host is rebuilt from disk, which never moved.
    expect(await docs.hostVersion(docId)).toMatchObject({ hasCheckpoint: true });
    expect((await docs.readDoc(docId))?.updates).toEqual(before?.updates);
    expect((await replay(docs, docId)).board()).toEqual({ base: "b", z: "Z" });
    docs.dispose();
  });

  it("a window's update that panics the host is refused, and the next save still lands", async () => {
    const docs = service();
    const { docId } = await docs.create("board");
    const { shallowBase, xAlone } = concurrentPair();
    await put(docs, docId, "checkpoint", wrapIce1(HEADER, shallowBase));
    await expect(put(docs, docId, "update", xAlone)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    const w = await replay(docs, docId, 5n);
    await put(docs, docId, "update", w.edit("after", "the refusal"));
    expect((await replay(docs, docId)).board()).toEqual({
      base: "b",
      z: "Z",
      after: "the refusal",
    });
    docs.dispose();
  });

  it("a checkpoint the compacted host cannot take is REFUSED — never written over the base", async () => {
    // A window that built across the root (a full doc holding X) saves a
    // checkpoint. Before DS-5d an import failure sent the doc to opaque
    // custody and stored the window's checkpoint AS the base: every edit the
    // host held beyond it was gone from disk, and the canvas stopped merging.
    const docs = service();
    const { docId } = await docs.create("board");
    const { shallowBase, fullWithX } = concurrentPair();
    await put(docs, docId, "checkpoint", wrapIce1(HEADER, shallowBase));
    const peer = await replay(docs, docId, 7n);
    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: peer.edit("kept", "yes"),
    });
    const before = await docs.readDoc(docId);
    await expect(put(docs, docId, "checkpoint", wrapIce1(HEADER, fullWithX))).rejects.toMatchObject(
      { kind: "PRECONDITION_FAILED" },
    );
    const after = await docs.readDoc(docId);
    expect(Buffer.compare(Buffer.from(after?.bytes ?? []), Buffer.from(before?.bytes ?? []))).toBe(
      0,
    );
    expect((await replay(docs, docId)).board()).toEqual({ base: "b", z: "Z", kept: "yes" });
    expect(await docs.hostVersion(docId)).not.toBeNull(); // still in Loro custody
    docs.dispose();
  });
});

// ---- the epoch bump ----

const ACCOUNT = systemAccount("james@example.com", "fuid-a");
const DAY = 86_400_000;

const json = (v: VersionVector): Record<string, number> =>
  Object.fromEntries([...v.toJSON()].map(([p, c]) => [String(p), c]));

async function withLibrary(dir: string, docs: DocumentService): Promise<LibraryDocService> {
  const library = new LibraryDocService({ dataDir: dir, docId: systemDocId("library", ACCOUNT) });
  await library.ready();
  await docs.attachLibrary(library);
  return library;
}

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

/** The root a stored base trims to (its history starts AT it). */
function rootOf(envelope: Uint8Array): Record<string, number> {
  const base = new LoroDoc();
  base.import(payloadOf(envelope));
  return json(base.frontiersToVV(base.shallowSinceFrontiers()));
}

/** A canvas with a checkpoint and a journal of three updates; the versions
 * the window held along the way. */
async function journaled(docs: DocumentService): Promise<{
  docId: string;
  w: Renderer;
  atCheckpoint: VersionVector;
  low: VersionVector;
  high: VersionVector;
}> {
  const { docId } = await docs.create("board");
  const w = new Renderer(1n);
  w.edit("a", "1");
  await put(docs, docId, "checkpoint", w.checkpoint());
  const atCheckpoint = w.doc.oplogVersion();
  await put(docs, docId, "update", w.edit("b", "2"));
  const low = w.doc.oplogVersion();
  await put(docs, docId, "update", w.edit("c", "3"));
  const high = w.doc.oplogVersion();
  await put(docs, docId, "update", w.edit("d", "4"));
  return { docId, w, atCheckpoint, low, high };
}

describe("DS-5d — the epoch bump", () => {
  it("past the journal threshold the host compacts AT the watermark: one shallow base, the epoch bumped in the registry, the stored revision and the library", async () => {
    const dir = dataDir();
    const docs = service(dir, { compaction: { records: 4 } });
    const library = await withLibrary(dir, docs);
    const moves: Array<[string, string]> = [];
    docs.onEpochChanged((docId, why) => moves.push([docId, why]));
    const { docId } = await docs.create("board");
    const w = new Renderer(1n);
    w.edit("a", "1");
    await put(docs, docId, "checkpoint", w.checkpoint());
    await put(docs, docId, "update", w.edit("b", "2"));
    await put(docs, docId, "update", w.edit("c", "3"));
    const studioAck = w.doc.oplogVersion();
    docs.setAcknowledgements(() => [{ device: "studio", ack: studioAck, seenAt: Date.now() }]);
    await put(docs, docId, "update", w.edit("d", "4"));
    expect(docs.list()[0]?.baseEpoch).toBe(0); // three records: under the threshold
    await put(docs, docId, "update", w.edit("e", "5")); // the fourth
    // The event fires last — after the stored revision, the registry and the library.
    await until(() => moves.length === 1, "the epoch bump");

    const stored = await docs.readDoc(docId);
    expect(stored?.updates).toEqual([]); // the journal is folded into the base
    expect(decodeImportBlobMeta(payloadOf(stored?.bytes as Uint8Array), false).mode).toBe(
      "shallow-snapshot",
    );
    // Trimmed exactly to the studio's acknowledgement — below it, never past.
    expect(rootOf(stored?.bytes as Uint8Array)).toEqual(json(studioAck));
    expect((await replay(docs, docId)).board()).toEqual({ a: "1", b: "2", c: "3", d: "4", e: "5" });
    expect(stored?.meta.baseEpoch).toBe(1);
    expect(library.get(docId)?.baseEpoch).toBe(1);
    expect(await docs.hostVersion(docId)).toMatchObject({ baseEpoch: 1, hasCheckpoint: true });
    expect(moves).toEqual([[docId, "compacted"]]);
    docs.dispose();
  });

  it("waits for every KNOWN holder: the lowest acknowledgement holds the root, one unseen thirty-one days is not waited for", async () => {
    const docs = service(undefined, { compaction: false });
    const { docId, atCheckpoint, low, high } = await journaled(docs);
    const now = Date.now();
    docs.setAcknowledgements(() => [
      { device: "studio", ack: high, seenAt: now },
      // offline ten days: remembered, and waited for
      { device: "laptop", ack: low, seenAt: now - 10 * DAY },
      // unseen past DS-D17's horizon: not waited for
      { device: "attic", ack: atCheckpoint, seenAt: now - 31 * DAY },
    ]);
    const outcome = await docs.compact(docId);
    expect(outcome).toMatchObject({
      compacted: true,
      baseEpoch: 1,
      counted: ["laptop", "studio"],
      retired: ["attic"],
    });
    expect(rootOf((await docs.readDoc(docId))?.bytes as Uint8Array)).toEqual(json(low));
    docs.dispose();
  });

  it("a holder that acknowledges nothing, or more than this desktop holds, BLOCKS the trim: no epoch, no write", async () => {
    const docs = service(undefined, { compaction: false });
    const { docId, high } = await journaled(docs);
    const before = await docs.readDoc(docId);
    const now = Date.now();
    docs.setAcknowledgements(() => [
      { device: "studio", ack: high, seenAt: now },
      { device: "laptop", ack: null, seenAt: now - 3 * DAY },
    ]);
    expect(await docs.compact(docId)).toEqual({
      compacted: false,
      reason: "unacknowledged",
      device: "laptop",
    });
    const ahead = [...high.toJSON()].map(([peer, counter]) => [peer, counter + 5] as const);
    docs.setAcknowledgements(() => [
      { device: "studio", ack: VersionVector.parseJSON(new Map(ahead)), seenAt: now },
    ]);
    expect(await docs.compact(docId)).toEqual({
      compacted: false,
      reason: "ahead-of-here",
      device: "studio",
    });
    const after = await docs.readDoc(docId);
    expect(docs.list()[0]?.baseEpoch).toBe(0);
    expect(after?.updates).toHaveLength(3);
    expect(Buffer.compare(Buffer.from(after?.bytes ?? []), Buffer.from(before?.bytes ?? []))).toBe(
      0,
    );
    docs.dispose();
  });

  it("a window open on the canvas holds the compaction; it runs when the window closes", async () => {
    const docs = service(undefined, { compaction: { records: 2 } });
    const { docId } = await docs.create("board");
    const w = new Renderer(1n);
    w.edit("a", "1");
    await put(docs, docId, "checkpoint", w.checkpoint());
    docs.writerAttached(docId);
    await put(docs, docId, "update", w.edit("b", "2"));
    await put(docs, docId, "update", w.edit("c", "3")); // past the threshold, window open
    expect(await docs.compact(docId)).toEqual({ compacted: false, reason: "window-open" });
    expect(docs.list()[0]?.baseEpoch).toBe(0);
    docs.writerDetached(docId);
    await until(() => docs.list()[0]?.baseEpoch === 1, "the compaction once the window closed");
    expect((await replay(docs, docId)).board()).toEqual({ a: "1", b: "2", c: "3" });
    docs.dispose();
  });

  it("a base that would not load is never written: a held op concurrent with the watermark refuses the trim", async () => {
    // Measured (loro-crdt 1.13.8): the shallow export succeeds and writes a
    // base no doc can import. The trial is what stands between that and disk.
    const docs = service(undefined, { compaction: false });
    const { docId } = await docs.create("board");
    const one = new LoroDoc();
    one.setPeerId(1n);
    one.getMap("board").set("base", "b");
    one.commit();
    await put(docs, docId, "checkpoint", wrapIce1(HEADER, one.export({ mode: "snapshot" })));
    const two = new LoroDoc();
    two.setPeerId(2n);
    two.import(one.export({ mode: "snapshot" }));
    const oneBefore = one.oplogVersion();
    const twoBefore = two.oplogVersion();
    one.getMap("board").set("z", "Z");
    one.commit();
    two.getMap("board").set("x", "X"); // concurrent with z
    two.commit();
    for (const payload of [
      one.export({ mode: "update", from: oneBefore }),
      two.export({ mode: "update", from: twoBefore }),
    ]) {
      expect(
        (await docs.applyRemoteRecord(docId, { kind: DOC_SYNC_RECORD.UPDATE, meta: META, payload }))
          .applied,
      ).toBe(true);
    }
    const before = await docs.readDoc(docId);
    // The studio holds base + z, not x: the meet puts z in and x out.
    docs.setAcknowledgements(() => [
      { device: "studio", ack: one.oplogVersion(), seenAt: Date.now() },
    ]);
    expect(await docs.compact(docId)).toMatchObject({ compacted: false, reason: "unloadable" });
    const after = await docs.readDoc(docId);
    expect(docs.list()[0]?.baseEpoch).toBe(0);
    expect(after?.updates).toHaveLength(before?.updates.length ?? -1);
    expect((await replay(docs, docId)).board()).toEqual({ base: "b", z: "Z", x: "X" });
    // Once the studio holds x too, nothing held is concurrent with the meet.
    const head = decodeVersion((await docs.hostVersion(docId))?.version ?? new Uint8Array());
    if (head === null) throw new Error("no head version");
    docs.setAcknowledgements(() => [{ device: "studio", ack: head, seenAt: Date.now() }]);
    expect(await docs.compact(docId)).toMatchObject({ compacted: true, baseEpoch: 1 });
    expect((await replay(docs, docId)).board()).toEqual({ base: "b", z: "Z", x: "X" });
    docs.dispose();
  });

  it("a restart after compaction loads the base and answers; current.json is the truth for the epoch", async () => {
    const dir = dataDir();
    const docs = service(dir, { compaction: false });
    const { docId, low } = await journaled(docs);
    docs.setAcknowledgements(() => [{ device: "studio", ack: low, seenAt: Date.now() }]);
    expect(await docs.compact(docId)).toMatchObject({ compacted: true, baseEpoch: 1 });
    // A second pass has nothing below the watermark left to trim.
    expect(await docs.compact(docId)).toEqual({ compacted: false, reason: "nothing-to-trim" });
    docs.dispose();

    const again = service(dir, { compaction: false });
    expect(again.list()[0]?.baseEpoch).toBe(1);
    expect(await again.hostVersion(docId)).toMatchObject({ baseEpoch: 1, hasCheckpoint: true });
    const answer = await again.hostAnswer(docId, {
      version: EMPTY_VERSION().encode(),
      hasCheckpoint: false,
      baseEpoch: 1,
    });
    const fresh = new Renderer(9n);
    fresh.apply(payloadOf(answer?.snapshot as Uint8Array));
    if (answer?.update) fresh.apply(answer.update);
    expect(fresh.board()).toEqual({ a: "1", b: "2", c: "3", d: "4" });
    again.dispose();

    // A crash between the stored revision and the registry write: the
    // registry still says 0, the revision says 1 — the revision wins.
    const registryPath = join(dir, "registries", "field.docs.v1.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry[0].baseEpoch = 0;
    writeFileSync(registryPath, JSON.stringify(registry));
    const third = service(dir, { compaction: false });
    expect(third.list()[0]?.baseEpoch).toBe(1);
    third.dispose();
  });
});
