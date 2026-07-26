// C6-3g — the routing half of cross-device doc sync.
//
// DocSyncService against fakes for the two transports, so every rule about WHO
// gets told WHAT is checked on every commit. The transports themselves are
// proven elsewhere: the lane carries bytes across a real tailnet (C6-3d), and
// a re-framed record converges (C6-3f). What is left here is routing, and the
// routing has one rule that matters more than the rest — a record that came
// FROM a peer is never sent back, because two devices echoing each other never
// stops and looks like a busy network rather than a bug.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOC_SYNC_RECORD,
  decodeDocSyncDigest,
  decodeDocSyncRecord,
  encodeDocSyncHave,
  encodeDocSyncRecord,
  MESHDATA_INBOUND_LANE_ID_BASE,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentService } from "../src/doc-service";
import { DocSyncService, type LaneBytes, type LaneControl, type LaneInfo } from "../src/doc-sync";

let dirs: string[] = [];
afterEach(async () => {
  // Let outstanding broadcast work settle before the data dir vanishes under
  // it. Not papering over anything — the service deliberately never throws a
  // sync fault into a caller, so a torn-down directory would show up as log
  // noise attributed to whichever test happened to be running next.
  await new Promise((r) => setTimeout(r, 60));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

class FakeControl implements LaneControl {
  opened: { laneId: number; peer: string; docId: string | undefined }[] = [];
  closed: number[] = [];
  lanes: LaneInfo[] = [];
  refuse = false;
  #emit: ((payload: unknown, kind: "snapshot" | "delta") => void) | null = null;

  async open(req: {
    laneId: number;
    class: "reliable";
    peer: string;
    protocol: "doc-sync";
    docId?: string;
  }): Promise<void> {
    if (this.refuse) throw new Error("mesh node not up");
    this.opened.push({ laneId: req.laneId, peer: req.peer, docId: req.docId });
  }
  async close(laneId: number): Promise<void> {
    this.closed.push(laneId);
  }
  async subscribe(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ lanes: LaneInfo[] }> {
    this.#emit = onEvent;
    return { lanes: this.lanes };
  }
  announce(payload: unknown, kind: "snapshot" | "delta" = "delta"): void {
    this.#emit?.(payload, kind);
  }
}

class FakeBytes implements LaneBytes {
  sent: { laneId: number; kind: number; payload: Uint8Array }[] = [];
  throwOnSend = false;
  #handlers = new Map<number, (payload: Uint8Array) => void>();

  send(laneId: number, payload: Uint8Array): boolean {
    if (this.throwOnSend) throw new Error("meshdata send buffer is full");
    const record = decodeDocSyncRecord(payload);
    this.sent.push({ laneId, kind: record.kind, payload: record.payload });
    return true;
  }
  onLane(laneId: number, handler: (payload: Uint8Array) => void): void {
    this.#handlers.set(laneId, handler);
  }
  offLane(laneId: number): void {
    this.#handlers.delete(laneId);
  }
  deliver(laneId: number, payload: Uint8Array): void {
    this.#handlers.get(laneId)?.(payload);
  }
  claimed(laneId: number): boolean {
    return this.#handlers.has(laneId);
  }
}

function ice1(filler = "checkpoint"): Uint8Array {
  return new Uint8Array([0x49, 0x43, 0x45, 0x31, ...new TextEncoder().encode(filler)]);
}

function record(payload: Uint8Array, kind: number = DOC_SYNC_RECORD.UPDATE): Uint8Array {
  return encodeDocSyncRecord(kind, { baseEpoch: 0, engineSchema: 11, savedAt: 1 }, payload);
}

/** AWAITS the predicate. A `() => boolean` signature silently accepted async
 * predicates, and a pending Promise is truthy — so three assertions here passed
 * without ever checking anything. Caught by the typechecker, not by the suite,
 * which is the point of running it over tests too. */
async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

function harness(peers: string[] = ["peer-a"]) {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-syncsvc-"));
  dirs.push(dataDir);
  const control = new FakeControl();
  const bytes = new FakeBytes();
  let sync: DocSyncService | undefined;
  const docs = new DocumentService({ dataDir, onCommit: (c) => sync?.onCommit(c) });
  sync = new DocSyncService({
    docs,
    control,
    bytes,
    peers: async () => peers,
  });
  return { docs, control, bytes, sync };
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

describe("claiming the lanes a peer opened", () => {
  it("claims what is already open when it starts", async () => {
    // fieldd restarts while field-native keeps running (the two-plane law), so
    // lanes opened before this service existed are the normal case.
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    control.lanes = [
      {
        laneId: MESHDATA_INBOUND_LANE_ID_BASE,
        peer: "p",
        protocol: "doc-sync",
        docId,
        inbound: true,
      },
    ];
    await sync.start();
    expect(bytes.claimed(MESHDATA_INBOUND_LANE_ID_BASE)).toBe(true);
  });

  it("claims a lane announced after it started, and applies what arrives", async () => {
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    await sync.start();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE + 3;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "p",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });

    const update = new Uint8Array([7, 0, 0, 9]);
    bytes.deliver(laneId, record(update));
    await until(
      () => (docs.list().find((d) => d.docId === docId)?.sizeBytes ?? 0) > ice1().byteLength,
      "the peer's record to land",
    );
    const stored = await docs.readDoc(docId);
    expect([...(stored?.updates[0] ?? [])]).toEqual([...update]);
  });

  it("ignores lanes that are not ours to claim", async () => {
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    control.lanes = [
      // outbound — we opened it, nothing arrives on it
      { laneId: 1, peer: "p", protocol: "doc-sync", docId },
      // a different protocol on an inbound lane
      { laneId: MESHDATA_INBOUND_LANE_ID_BASE, peer: "p", protocol: "presence", inbound: true },
      // doc-sync with no doc — nowhere to deliver, so refused rather than guessed
      { laneId: MESHDATA_INBOUND_LANE_ID_BASE + 1, peer: "p", protocol: "doc-sync", inbound: true },
    ];
    await sync.start();
    expect(bytes.claimed(1)).toBe(false);
    expect(bytes.claimed(MESHDATA_INBOUND_LANE_ID_BASE)).toBe(false);
    expect(bytes.claimed(MESHDATA_INBOUND_LANE_ID_BASE + 1)).toBe(false);
  });

  it("re-derives its claims from a re-snapshot rather than patching them", async () => {
    // A re-snapshot means events were missed (broadcast lag, or a reconnect).
    // The lane table is the truth; the events are only how it is learned early.
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    const gone = MESHDATA_INBOUND_LANE_ID_BASE;
    const fresh = MESHDATA_INBOUND_LANE_ID_BASE + 9;
    control.lanes = [{ laneId: gone, peer: "p", protocol: "doc-sync", docId, inbound: true }];
    await sync.start();
    expect(bytes.claimed(gone)).toBe(true);

    control.announce(
      { lanes: [{ laneId: fresh, peer: "p", protocol: "doc-sync", docId, inbound: true }] },
      "snapshot",
    );
    expect(bytes.claimed(gone)).toBe(false);
    expect(bytes.claimed(fresh)).toBe(true);
  });

  it("drops a lane the peer closed", async () => {
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.lanes = [{ laneId, peer: "p", protocol: "doc-sync", docId, inbound: true }];
    await sync.start();
    control.announce({ kind: "closed", laneId, inbound: true, reason: "peer-closed" });
    expect(bytes.claimed(laneId)).toBe(false);
  });
});

describe("broadcasting what we commit", () => {
  it("opens a lane per peer and greets each with a HAVE, not with the document", async () => {
    // C6-3h. The old shape pushed the whole board down every new lane, because
    // the sender could not know what the peer held. It can now — by content id
    // — so a new lane costs a digest instead of a document.
    const { docs, control, bytes, sync } = harness(["peer-a", "peer-b"]);
    await sync.start();
    const docId = await seeded(docs); // the checkpoint IS the first commit
    await until(() => control.opened.length === 2, "a lane per peer");
    expect(control.opened.map((o) => o.peer)).toEqual(["peer-a", "peer-b"]);
    expect(control.opened.every((o) => o.docId === docId)).toBe(true);
    await until(() => bytes.sent.length >= 2, "the greetings to go out");
    expect(bytes.sent.every((s) => s.kind === DOC_SYNC_RECORD.HAVE)).toBe(true);
    // …and the greeting says what we hold, so the peer can ask for the rest.
    const digest = decodeDocSyncDigest(bytes.sent[0]?.payload ?? new Uint8Array());
    expect(digest.hasCheckpoint).toBe(true);
    expect(digest.records).toEqual([]);
  });

  it("answers a HAVE with only what the peer lacks", async () => {
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    const first = new Uint8Array([1, 1]);
    const second = new Uint8Array([2, 2]);
    for (const [i, payload] of [first, second].entries()) {
      await docs.writeDoc(docId, payload, {
        revisionId: randomUUID(),
        kind: "update",
        baseRevisionId: (await docs.readDocMeta(docId))?.revisionId,
        engineSchema: 11,
        savedAt: 2 + i,
        byteLength: payload.byteLength,
      });
    }
    await sync.start();
    const digest = await docs.syncDigest(docId);
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "peer-a",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    bytes.sent.length = 0;

    // The peer claims a checkpoint and the FIRST record only.
    bytes.deliver(
      laneId,
      encodeDocSyncHave(0, {
        hasCheckpoint: true,
        records: [digest?.records[0] as string],
      }),
    );
    await until(
      () => bytes.sent.some((s) => s.kind === DOC_SYNC_RECORD.UPDATE),
      "the missing record",
    );
    const content = bytes.sent.filter((s) => s.kind !== DOC_SYNC_RECORD.HAVE);
    expect(content).toHaveLength(1);
    expect([...(content[0]?.payload ?? [])]).toEqual([...second]);
  });

  it("sends the checkpoint only to a peer that has none", async () => {
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    await sync.start();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "peer-a",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    bytes.sent.length = 0;
    bytes.deliver(laneId, encodeDocSyncHave(0, { hasCheckpoint: false, records: [] }));
    await until(
      () => bytes.sent.some((s) => s.kind === DOC_SYNC_RECORD.SNAPSHOT),
      "the bootstrap checkpoint",
    );
  });

  it("says nothing to a HAVE from another epoch", async () => {
    // Answering would push records across a compaction boundary — the one
    // thing the S4 fence exists to prevent. The peer re-bootstraps instead.
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    await sync.start();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "peer-a",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    bytes.sent.length = 0;
    bytes.deliver(laneId, encodeDocSyncHave(9, { hasCheckpoint: false, records: [] }));
    await new Promise((r) => setTimeout(r, 120));
    expect(bytes.sent.filter((s) => s.kind !== DOC_SYNC_RECORD.HAVE)).toHaveLength(0);
  });

  it("takes a record it already holds as a no-op, not a second journal entry", async () => {
    // Content identity is what makes redelivery free — and redelivery is what
    // a reconnect, a second lane, or a crossed HAVE looks like from here.
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    await sync.start();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "peer-a",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    const payload = new Uint8Array([5, 5, 5]);
    bytes.deliver(laneId, record(payload));
    await until(async () => (await docs.readDoc(docId))?.updates.length === 1, "the first copy");
    bytes.deliver(laneId, record(payload));
    bytes.deliver(laneId, record(payload));
    await new Promise((r) => setTimeout(r, 120));
    expect((await docs.readDoc(docId))?.updates).toHaveLength(1);
    expect(sync.syncState(docId)).toBe("idle"); // a redelivery is not a problem
  });

  it("reuses the lane for later commits and sends only the new record", async () => {
    const { docs, control, bytes, sync } = harness();
    await sync.start();
    const docId = await seeded(docs);
    await until(() => bytes.sent.length === 1, "the bootstrap snapshot");

    const update = new Uint8Array([1, 2, 3]);
    await docs.writeDoc(docId, update, {
      revisionId: randomUUID(),
      kind: "update",
      baseRevisionId: (await docs.readDocMeta(docId))?.revisionId,
      engineSchema: 11,
      savedAt: 2,
      byteLength: update.byteLength,
    });
    await until(() => bytes.sent.length === 2, "the update to be broadcast");
    expect(control.opened).toHaveLength(1); // no second lane
    expect(bytes.sent[1]?.kind).toBe(DOC_SYNC_RECORD.UPDATE);
    expect([...(bytes.sent[1]?.payload ?? [])]).toEqual([...update]);
  });

  it("NEVER sends a peer's record back to the peers", async () => {
    // The rule that matters. Two devices echoing each other's updates converges
    // instantly and then never stops.
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    await sync.start();
    await until(() => bytes.sent.length >= 1, "the bootstrap");
    const contentBefore = bytes.sent.filter((s) => s.kind !== DOC_SYNC_RECORD.HAVE).length;

    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "p",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    bytes.deliver(laneId, record(new Uint8Array([9, 9, 9])));

    await until(
      async () => (await docs.readDoc(docId))?.updates.length === 1,
      "the peer's record to be stored",
    );
    // Give any (wrong) broadcast a generous chance to happen. A HAVE going out
    // is fine and expected — greeting a peer is not echoing its data; what must
    // never travel back is the RECORD.
    await new Promise((r) => setTimeout(r, 120));
    expect(bytes.sent.filter((s) => s.kind !== DOC_SYNC_RECORD.HAVE).length).toBe(contentBefore);
  });

  it("survives a peer with no lane and retries on the next commit", async () => {
    // Mesh down, peer unreachable, node not up — all ordinary. Nothing is
    // queued waiting: a queue that outlives its reason is how memory vanishes.
    const { docs, control, bytes, sync } = harness();
    control.refuse = true;
    await sync.start();
    const docId = await seeded(docs);
    await new Promise((r) => setTimeout(r, 60));
    expect(bytes.sent).toHaveLength(0);

    control.refuse = false;
    const update = new Uint8Array([4, 5]);
    await docs.writeDoc(docId, update, {
      revisionId: randomUUID(),
      kind: "update",
      baseRevisionId: (await docs.readDocMeta(docId))?.revisionId,
      engineSchema: 11,
      savedAt: 2,
      byteLength: update.byteLength,
    });
    await until(() => bytes.sent.length >= 1, "the retry to open a lane and greet");
    // A greeting, not the document: the peer answers with what it needs.
    expect(bytes.sent[0]?.kind).toBe(DOC_SYNC_RECORD.HAVE);
  });

  it("mints lane ids from fieldd's half of the space", async () => {
    // field-native refuses an id from the inbound half at the door, so a mint
    // that wandered up there would fail every open.
    const { docs, control, sync } = harness();
    await sync.start();
    await seeded(docs);
    await until(() => control.opened.length === 1, "a lane");
    expect(control.opened[0]?.laneId).toBeLessThan(MESHDATA_INBOUND_LANE_ID_BASE);
  });

  it("does not let a wedged lane throw into the write path", async () => {
    // Sync is a CONSUMER of durability. A send that fails must never turn a
    // committed revision into a failed one.
    const { docs, bytes, sync } = harness();
    await sync.start();
    bytes.throwOnSend = true;
    const docId = await seeded(docs); // must not reject
    expect(docs.list().find((d) => d.docId === docId)).toBeDefined();
    await new Promise((r) => setTimeout(r, 60));
    expect((await docs.readDoc(docId))?.bytes.byteLength).toBe(ice1().byteLength);
  });

  it("reports a declined record as sync state rather than swallowing it", async () => {
    // EL5: no silent divergence. A record from another epoch is not applied,
    // and that has to be visible to whatever renders sync state (C6-4).
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    await sync.start();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "p",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    bytes.deliver(
      laneId,
      encodeDocSyncRecord(
        DOC_SYNC_RECORD.UPDATE,
        { baseEpoch: 4, engineSchema: 11, savedAt: 1 },
        new Uint8Array([1]),
      ),
    );
    await until(() => sync.syncState(docId) === "epoch-stale", "the epoch-stale state");
  });

  it("keeps a lane alive through one undecodable record", async () => {
    // A peer running a newer build should degrade, not disconnect.
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    await sync.start();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "p",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    bytes.deliver(laneId, new Uint8Array([1, 2])); // shorter than a header
    expect(bytes.claimed(laneId)).toBe(true);

    const good = new Uint8Array([8, 8]);
    bytes.deliver(laneId, record(good));
    await until(
      async () => (await docs.readDoc(docId))?.updates.length === 1,
      "the next good record to land",
    );
  });
});
