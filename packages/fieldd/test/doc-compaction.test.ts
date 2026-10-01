// DS-5d — COMPACTION on one desktop (design-06 §4; the mesh rows are
// doc-compaction-mesh.test.ts). A compacted canvas's base is a Loro SHALLOW
// snapshot framed by the ICE1 rule: history below the watermark lives in the
// state alone. Everything here is measured against loro-crdt 1.13.8's own
// behaviour (scratch probes, recorded in the commits): a doc loaded from a
// shallow snapshot exports only shallow snapshots, ICE opens one, an export
// "from" below the root starts AT the root, and an op whose base lies below
// the root PANICS the doc it is imported into.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOC_SYNC_RECORD, type DocSyncMeta } from "@vibefield/contracts";
import { LoroDoc, type VersionVector } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentService, type DocumentServiceOptions } from "../src/doc-service";
import { liftIce1, wrapIce1 } from "../src/ice1-envelope";
import { EMPTY_VERSION, loroBlobMode } from "../src/loro-host";
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
