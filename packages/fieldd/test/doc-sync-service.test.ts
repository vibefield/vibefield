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
  type DocSyncIntent,
  decodeDocSyncDigest,
  decodeDocSyncRecord,
  encodeDocSyncHave,
  encodeDocSyncRecord,
  MESHDATA_INBOUND_LANE_ID_BASE,
  type MeshSyncPosture,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSyncIntent } from "../src/app-preferences";
import { contentIdOf, DocumentService } from "../src/doc-service";
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

function harness(peerIds: string[] = ["peer-a"]) {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-syncsvc-"));
  dirs.push(dataDir);
  const control = new FakeControl();
  const bytes = new FakeBytes();
  let sync: DocSyncService | undefined;
  const docs = new DocumentService({ dataDir, onCommit: (c) => sync?.onCommit(c) });
  /** id → online; tests flip entries to take a peer off the mesh (C6-4). */
  const peerState = new Map(peerIds.map((id) => [id, true]));
  /** UA-6: the daemon's own fold, in miniature — the doc's answer over the
   * user's posture. Wiring the REAL resolver here is the point: a test that
   * injected a hand-written predicate would prove the gates work and say
   * nothing about whether the daemon asks them the right question. */
  const posture = { value: "automatic" as MeshSyncPosture };
  let nextLaneId = 1;
  sync = new DocSyncService({
    docs,
    control,
    bytes,
    allocateLaneId: () => nextLaneId++,
    peers: async () => [...peerState].map(([id, online]) => ({ id, online })),
    resolveIntent: (docId) => resolveSyncIntent(docs.syncIntentOf(docId), posture.value),
  });
  return { docs, control, bytes, sync, peerState, posture };
}

/** The C6-4 fold for one doc, as `doc.sync.subscribe` would publish it. */
function stateOf(sync: DocSyncService, docId: string): string | undefined {
  return sync.statuses().find((s) => s.docId === docId)?.state;
}

async function seeded(docs: DocumentService, intent?: DocSyncIntent): Promise<string> {
  const entry = await docs.create("board");
  // Before the first commit, deliberately: the gates must be in force for the
  // save that CREATES the content, not merely for the ones after it.
  if (intent !== undefined) await docs.setSyncIntent(entry.docId, intent);
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
    // a redelivery is not a problem — the doc must REACH in step. Awaited
    // rather than read at a deadline: `syncing` derives from work still in
    // flight, so under a loaded machine a fixed sleep was reading the queue's
    // depth, not the protocol's answer (it flaked in a full-workspace run).
    await until(() => stateOf(sync, docId) === "in-step", "the redelivery to settle");
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
    await until(() => stateOf(sync, docId) === "epoch-stale", "the epoch-stale state");
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

describe("the honest sync state (C6-4)", () => {
  it("reads peer-offline, not in-step, when a commit reached nobody", async () => {
    // THE dishonesty this slice closes: the old shape settled back to idle
    // after a broadcast whether or not any lane carried it, so a doc read
    // "in step" while its commit reached no peer.
    const { docs, control, sync, peerState } = harness(["peer-a"]);
    peerState.set("peer-a", false);
    await sync.start();
    const docId = await seeded(docs);
    await until(() => stateOf(sync, docId) === "peer-offline", "the peer-offline state");
    // The roster already said offline — no dial was spent learning it.
    expect(control.opened).toHaveLength(0);
    const status = sync.statuses().find((s) => s.docId === docId);
    expect(status?.peers).toEqual([{ peer: "peer-a", reachable: false, lastExchangeAt: null }]);
  });

  it("reads peer-offline when the lane open itself fails", async () => {
    // An online-looking peer the mesh cannot actually reach: the failed open
    // is the fact, recorded per doc-peer rather than swallowed at info level.
    const { docs, control, sync } = harness(["peer-a"]);
    control.refuse = true;
    await sync.start();
    const docId = await seeded(docs);
    await until(() => stateOf(sync, docId) === "peer-offline", "the failed open to surface");
  });

  it("reads pending while a peer's digest names records we do not hold", async () => {
    // §8: a record whose causal dependencies have not arrived shows NOTHING in
    // the doc — however settled the board looks, it is not complete, and EL5
    // forbids the state saying otherwise.
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
    const enRoute = new Uint8Array([3, 1, 4]);
    bytes.deliver(
      laneId,
      encodeDocSyncHave(0, { hasCheckpoint: true, records: [contentIdOf(enRoute)] }),
    );
    await until(() => stateOf(sync, docId) === "pending", "the pending state");
    expect(sync.statuses().find((s) => s.docId === docId)?.pendingRecords).toBe(1);

    // The named record lands — by the SAME identity the digest spoke — and
    // the doc goes back to in step.
    bytes.deliver(laneId, record(enRoute));
    await until(() => stateOf(sync, docId) === "in-step", "the pending set to drain");
  });

  it("reads pending while an update has no checkpoint underneath it", async () => {
    // The bootstrap race, made ordinary by the HAVE exchange: an update
    // arriving before the checkpoint is declined would-clobber and re-greeted
    // for — but until the bootstrap lands the doc is INCOMPLETE, not busy.
    const { docs, control, bytes, sync } = harness();
    const entry = await docs.create("empty-here"); // registry entry, no content
    await sync.start();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "peer-a",
      protocol: "doc-sync",
      docId: entry.docId,
      inbound: true,
    });
    bytes.deliver(laneId, record(new Uint8Array([7, 7])));
    await until(() => stateOf(sync, entry.docId) === "pending", "the incomplete state");

    bytes.deliver(laneId, record(ice1(), DOC_SYNC_RECORD.SNAPSHOT));
    await until(() => stateOf(sync, entry.docId) === "in-step", "the bootstrap to land");
  });

  it("names a doc it does not have as peer-declined with a null name", async () => {
    // Doc EXISTENCE does not replicate yet: a peer syncing a doc this device
    // never created is declined unknown-doc, and the status says so honestly
    // instead of the doc simply not existing anywhere visible.
    const { control, bytes, sync } = harness();
    await sync.start();
    const ghostDocId = randomUUID();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "peer-a",
      protocol: "doc-sync",
      docId: ghostDocId,
      inbound: true,
    });
    bytes.deliver(laneId, record(new Uint8Array([1, 2])));
    await until(() => stateOf(sync, ghostDocId) === "peer-declined", "the declined state");
    const status = sync.statuses().find((s) => s.docId === ghostDocId);
    expect(status?.name).toBeNull();
    expect(status?.reason).toBe("unknown-doc");
  });

  it("folds roster liveness in, and re-greets a peer that returns", async () => {
    const { docs, control, bytes, sync } = harness(["peer-a"]);
    await sync.start();
    const docId = await seeded(docs);
    await until(() => stateOf(sync, docId) === "in-step", "the greeting to settle");

    // The roster says offline: reachability flips in seconds, not the minutes
    // a dead QUIC lane takes to admit it (F-C6-22).
    let online = false;
    const listeners: Array<() => void> = [];
    sync.attachLiveness({
      list: () => [{ id: "peer-a", online }],
      on: (cb) => {
        listeners.push(cb);
        return () => {};
      },
    });
    for (const cb of listeners) cb();
    await until(() => stateOf(sync, docId) === "peer-offline", "the roster fold");

    // The peer returns: the re-greet is the catch-up, so "open the laptop"
    // means "the docs catch up", not "nothing until the next local edit".
    const greetings = bytes.sent.filter((s) => s.kind === DOC_SYNC_RECORD.HAVE).length;
    online = true;
    for (const cb of listeners) cb();
    await until(
      () => bytes.sent.filter((s) => s.kind === DOC_SYNC_RECORD.HAVE).length > greetings,
      "the return re-greet",
    );
    await until(() => stateOf(sync, docId) === "in-step", "reachability to recover");
  });

  it("publishes status changes to subscribers, and detaches cleanly", async () => {
    const { docs, control, bytes, sync } = harness(["peer-a"]);
    await sync.start();
    const seen: string[][] = [];
    const off = sync.onStatusChanged((statuses) => seen.push(statuses.map((s) => s.state)));
    const docId = await seeded(docs);
    await until(() => seen.some((states) => states.includes("in-step")), "a published in-step");

    off();
    const before = seen.length;
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "peer-a",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    bytes.deliver(laneId, record(new Uint8Array([6])));
    await until(async () => (await docs.readDoc(docId))?.updates.length === 1, "the record");
    expect(seen.length).toBe(before); // detached means detached
  });

  it("marks the peer unreachable on a peer-unreachable lane close", async () => {
    // Minutes late (F-C6-22), but late truth is still truth — the close reason
    // is a per-peer fact, not floor litter.
    const { docs, control, sync } = harness(["peer-a"]);
    await sync.start();
    const docId = await seeded(docs);
    await until(() => control.opened.length === 1, "the outbound lane");
    const laneId = control.opened[0]?.laneId as number;
    control.announce({ kind: "closed", laneId, reason: "peer-unreachable" });
    await until(() => stateOf(sync, docId) === "peer-offline", "the unreachable fact");
  });
});

describe("sync intent — a doc that stays home (UA-D7)", () => {
  it("opens no lane for a local doc, however many times it is saved", async () => {
    // Gate (a). Not "opens one and sends nothing": the lane itself is traffic a
    // peer can see, and a doc that is staying home should be invisible on the
    // mesh rather than quietly present on it.
    const { docs, control, bytes, sync } = harness();
    await sync.start();
    const docId = await seeded(docs, "local");
    await docs.writeDoc(docId, new Uint8Array([1, 2, 3]), {
      revisionId: randomUUID(),
      kind: "update",
      baseRevisionId: (await docs.readDocMeta(docId))?.revisionId,
      engineSchema: 11,
      savedAt: 2,
      byteLength: 3,
    });
    // Generous, because the failure mode this guards is a LATE lane: the work
    // queue is async and an assertion that fired immediately would pass even
    // with every gate removed.
    await new Promise((r) => setTimeout(r, 120));
    expect(control.opened).toHaveLength(0);
    expect(bytes.sent).toHaveLength(0);
  });

  it("refuses the lane a peer opens for it, and opens no lane back", async () => {
    // Gate (b). The return lane matters as much as the handler: claiming used
    // to answer a peer's greeting with one, which for a local doc would put it
    // on the wire by way of being polite.
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs, "local");
    await sync.start();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE + 5;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "peer-a",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(bytes.claimed(laneId)).toBe(false);
    expect(control.opened).toHaveLength(0);
  });

  it("keeps a local doc out of the published fold entirely", async () => {
    // EL5. A gated doc can never reach in-step, pending, or anything else here,
    // so a row for it would be a state it is not in. The absence IS the
    // statement — the same argument that keeps `solo` off the wire.
    const { docs, control, sync } = harness();
    const docId = await seeded(docs, "local");
    await sync.start();
    control.announce({
      kind: "peerOpened",
      laneId: MESHDATA_INBOUND_LANE_ID_BASE + 6,
      peer: "peer-a",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(sync.statuses().find((s) => s.docId === docId)).toBeUndefined();
  });

  it("stands the refusal up as peer-declined once the doc syncs again", async () => {
    // The refusal is recorded while it is invisible, and that is deliberate:
    // flip the doc back and the standing difference is what shows — "records
    // were refused while this stayed home, the devices may differ" — through
    // the EXISTING derivation, with `local-only` carried verbatim as the
    // reason. No new state was added for any of this.
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs, "local");
    await sync.start();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE + 7;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "peer-a",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    await until(
      () => sync.statuses().length === 0 && !bytes.claimed(laneId),
      "the lane to be refused",
    );

    await docs.setSyncIntent(docId, "sync");
    const status = sync.statuses().find((s) => s.docId === docId);
    expect(status?.state).toBe("peer-declined");
    expect(status?.reason).toBe("local-only");
  });

  it("stops accepting records on a lane it had already claimed", async () => {
    // Intent flips while a lane is live and its handler is registered. "Keep
    // this local" has to bind to the DOC, not to the lanes that happened to
    // exist when it was said.
    const { docs, control, bytes, sync } = harness();
    const docId = await seeded(docs);
    await sync.start();
    const laneId = MESHDATA_INBOUND_LANE_ID_BASE + 8;
    control.announce({
      kind: "peerOpened",
      laneId,
      peer: "peer-a",
      protocol: "doc-sync",
      docId,
      inbound: true,
    });
    bytes.deliver(laneId, record(new Uint8Array([4, 4])));
    await until(
      async () => (await docs.readDoc(docId))?.updates.length === 1,
      "the first record to land while the doc still syncs",
    );

    await docs.setSyncIntent(docId, "local");
    bytes.deliver(laneId, record(new Uint8Array([5, 5, 5])));
    await new Promise((r) => setTimeout(r, 120));
    expect((await docs.readDoc(docId))?.updates).toHaveLength(1);
  });

  it("lets the posture answer for a doc that never said anything", async () => {
    // opt-in means "ask me": silence is local. An explicit `sync` still wins
    // over it, because the doc's own answer is the more specific one.
    const { docs, control, sync, posture } = harness();
    posture.value = "opt-in";
    await sync.start();
    const quiet = await seeded(docs);
    await new Promise((r) => setTimeout(r, 120));
    expect(control.opened).toHaveLength(0);

    const spoken = await docs.create("shared");
    await docs.setSyncIntent(spoken.docId, "sync");
    await docs.writeDoc(spoken.docId, ice1(), {
      revisionId: randomUUID(),
      kind: "checkpoint",
      engineSchema: 11,
      savedAt: 1,
      byteLength: ice1().byteLength,
    });
    await until(() => control.opened.length === 1, "the opted-in doc's lane");
    expect(control.opened[0]?.docId).toBe(spoken.docId);
    expect(sync.statuses().find((s) => s.docId === quiet)).toBeUndefined();
  });

  it("changes nothing for a doc with no intent under the default posture", async () => {
    // The zero-behavior-change claim, stated as a test rather than as prose.
    const { docs, control, bytes, sync } = harness();
    await sync.start();
    const docId = await seeded(docs);
    await until(
      () => bytes.sent.some((s) => s.kind === DOC_SYNC_RECORD.HAVE),
      "the ordinary lane and its greeting",
    );
    expect(control.opened).toHaveLength(1);
    expect(control.opened[0]?.docId).toBe(docId);
    expect(docs.syncIntentOf(docId)).toBeUndefined();
    expect(stateOf(sync, docId)).toBeDefined();
  });
});
