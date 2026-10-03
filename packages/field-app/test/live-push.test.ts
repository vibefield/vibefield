// @vitest-environment node
// DS-5 — THE WITNESS for §1.2 defect 2: "an open window on B is pushed A's
// update". Real fieldd, the real DocManager and lane client, a real ICE engine
// bound through the real bindPersistence; the PEER desktop is a second ICE
// engine that opens the same canvas and edits it, and its outbound record is
// handed to fieldd exactly as a doc-sync lane would hand it
// (`applyRemoteRecord`). The window must gain the peer's widget with no
// reopen — and stay out of quarantine, because a push is exported from what
// fieldd can prove the window holds.
//
// DK-4 — PHASE 2'S WITNESS (plan §9): a fresh board seeded with the desk's six
// converges across TWO TABS through fieldd — a note typed in tab A appears in
// tab B's desk, a mini mat moved in B lands in A, and the two hold one board.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CanvasEngine,
  type DocSession,
  defineQuery,
  ENGINE_SCHEMA_VERSION,
  type Entity,
  guardedTransaction,
  Position,
  PrefabId,
} from "@vibecook/ice";
import {
  createNoteTyping,
  MINIMAT_TYPE,
  NOTE_INK,
  NOTE_PROPS,
  NOTE_TYPE,
} from "@vibecook/ice/desk/objects";
import { DOC_SYNC_RECORD, LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { bootstrap, type FielddDaemon } from "@vibefield/fieldd";
import { MockMgmtServer } from "@vibefield/fieldd/testing";
import { FielddClient } from "@vibefield/fieldd-client";
import { LoroDoc } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBoardStatus } from "../src/board-status";
import { DocManager } from "../src/doc-manager";
import { deskCensus } from "../src/field/desk/desk-door";
import { SEED_TYPES } from "../src/field/desk/desk-seed";
import { bindPersistence } from "../src/field/persistence-controller";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});
beforeEach(() => {
  localStorage.removeItem("vf-last-doc");
});

// A real daemon boot, an autosave debounce (800 ms) and a push round trip.
vi.setConfig({ testTimeout: 30_000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(
  fn: () => boolean | Promise<boolean>,
  label: string,
  ms = 8_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await sleep(20);
  }
}

async function stack(): Promise<FielddDaemon> {
  const dir = mkdtempSync(join(tmpdir(), "vf-livepush-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "native", "run"), { recursive: true });
  writeFileSync(join(dir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(
    process.platform === "win32"
      ? pipeEndpointFor(dir, SOCKETS.MGMT)
      : join(dir, ...LAYOUT.MGMT_SOCKET),
  );
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir: dir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return daemon;
}

const widgetQ = defineQuery([Position, PrefabId]);
function widgetCount(ce: ReturnType<typeof createFieldEngine>): number {
  let n = 0;
  ce.world.query(widgetQ).each((b) => {
    for (const _ of b) n += 1;
  });
  return n;
}

describe("DS-5 — an open window is pushed a peer desktop's edit", () => {
  it("the peer's widget appears in the open window with no reopen, and the board stays live", async () => {
    const daemon = await stack();
    const client = new FielddClient({
      url: `ws://127.0.0.1:${daemon.controlPort}`,
      token: daemon.shellToken,
      clientKind: "debug",
    });
    client.connect();
    cleanup.push(() => client.close());
    const manager = new DocManager(client, { timeoutMs: 5_000 });
    await manager.boot();
    const pending = manager.getState().pending;
    if (pending === null || pending.lane == null) throw new Error("no pending session");
    const registry = buildRegistry();
    const ce = createFieldEngine(registry);
    cleanup.push(() => ce.dispose());
    if (pending.initialBytes !== null) {
      const res = ce.docs.open(pending.initialBytes);
      if (!res.ok) throw new Error(res.reason);
      for (const update of pending.initialUpdates) res.session.applyRemote(update);
    } else {
      const session = ce.docs.create();
      ce.world.sync();
      // the desk's first-run board, its print laid before the window's count is taken
      if (pending.seed) await seedField(ce, session);
    }
    ce.world.sync();
    manager.contentApplied(pending.generation);
    await until(() => manager.getState().phase === "ready", "the manager to be ready");
    const unbind = bindPersistence({ ce, manager, pending, lane: pending.lane });
    cleanup.push(() => unbind());
    const docId = pending.docId;

    // The window's autosave writes its first checkpoint (ICE starts dirty):
    // from here fieldd can PROVE what the window holds.
    await until(async () => (await daemon.docs.readDoc(docId)) !== null, "the first save");

    // The PEER desktop: opens the same canvas from what it was sent, edits.
    const stored = await daemon.docs.readDoc(docId);
    if (stored === null) throw new Error("nothing stored");
    const peer = createFieldEngine(buildRegistry());
    cleanup.push(() => peer.dispose());
    const opened = peer.docs.open(stored.bytes);
    if (!opened.ok) throw new Error(opened.reason);
    for (const update of stored.updates) opened.session.applyRemote(update);
    peer.world.sync();
    const outbound: Uint8Array[] = [];
    opened.session.store.subscribeOutbound((bytes) => outbound.push(bytes.slice()));
    // DK-3: on the desk the peer lays a desk OBJECT — the root places what provides
    // `desk.object`, and a VibeField widget type (the registry's first, the terminal
    // mirror) is refused `widget-not-allowed` there; the push is the same either way.
    peer.ops.spawnWidget(NOTE_TYPE, { x: 4_000, y: 4_000, w: 200, h: 200 });
    peer.world.sync();
    await until(() => outbound.length > 0, "the peer's outbound record");

    const before = widgetCount(ce);
    const outcome = await daemon.docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: { baseEpoch: 0, engineSchema: ENGINE_SCHEMA_VERSION, savedAt: Date.now() },
      payload: outbound[0] as Uint8Array,
    });
    expect(outcome.applied).toBe(true);
    await until(() => {
      ce.world.sync(); // the ICE binding drains inbound on sync (the frame loop's job)
      return widgetCount(ce) === before + 1;
    }, "the pushed widget to appear in the open window");
    expect(getBoardStatus().state).not.toBe("quarantined");
    await manager.shutdown();
  });
});

/** The one object of `type` on a board. */
function only(ce: CanvasEngine, type: string): Entity {
  const found: Entity[] = [];
  ce.world.query(widgetQ).each((b) => {
    for (const r of b)
      if (ce.world.get(b.entity(r), PrefabId)?.id === type) found.push(b.entity(r));
  });
  if (found.length !== 1) throw new Error(`${found.length} ${type} on the board`);
  return found[0] as Entity;
}

/** What a tab holds, as fieldd's version exchange speaks it (the VERSION record's version vector). */
function versionOf(session: DocSession): Uint8Array {
  const doc = new LoroDoc();
  doc.import(session.exportSnapshot());
  return doc.oplogVersion().encode();
}

/** A board's STATE: Loro's own JSON, its empty roots dropped — representation, not state (the
 * ICE1 probe's rule: a root with no op behind it is listed only when a snapshot came first). */
function stateOf(session: DocSession): Record<string, unknown> {
  const doc = new LoroDoc();
  doc.import(session.exportSnapshot());
  return Object.fromEntries(
    Object.entries(doc.toJSON() as Record<string, unknown>).filter(
      ([, value]) =>
        !(value !== null && typeof value === "object" && Object.keys(value).length === 0),
    ),
  );
}

describe("Phase 2's witness — a fresh board converges across two tabs through fieldd (DK-4)", () => {
  it("a note typed in A appears in B's desk, a mini mat moved in B lands in A, and the two hold one board", async () => {
    const daemon = await stack();
    const client = new FielddClient({
      url: `ws://127.0.0.1:${daemon.controlPort}`,
      token: daemon.shellToken,
      clientKind: "debug",
    });
    client.connect();
    cleanup.push(() => client.close());

    // TAB A — the window: the real DocManager, lane and persistence, a FRESH first-run board seeded
    // with the desk's six.
    const manager = new DocManager(client, { timeoutMs: 5_000 });
    await manager.boot();
    const pending = manager.getState().pending;
    if (pending === null || pending.lane == null) throw new Error("no pending session");
    expect(pending.seed).toBe(true);
    expect(pending.initialBytes).toBeNull(); // a fresh board, made on the desk
    const a = createFieldEngine(buildRegistry());
    cleanup.push(() => a.dispose());
    const sessionA = a.docs.create();
    await seedField(a, sessionA);
    a.world.sync();
    manager.contentApplied(pending.generation);
    await until(() => manager.getState().phase === "ready", "the manager to be ready");
    const unbind = bindPersistence({ ce: a, manager, pending, lane: pending.lane });
    cleanup.push(() => unbind());
    const docId = pending.docId;
    await until(async () => (await daemon.docs.readDoc(docId)) !== null, "A's first save");

    // TAB B — the other tab, a peer over fieldd's doc-sync exchange: it opens what fieldd holds, its
    // records reach fieldd as a sync lane hands them (`applyRemoteRecord`), and it asks fieldd for
    // what it lacks by its version (`hostAnswer` — the VERSION record's answer).
    const stored = await daemon.docs.readDoc(docId);
    if (stored === null) throw new Error("nothing stored");
    const b = createFieldEngine(buildRegistry());
    cleanup.push(() => b.dispose());
    const opened = b.docs.open(stored.bytes);
    if (!opened.ok) throw new Error(opened.reason);
    const sessionB = opened.session;
    for (const update of stored.updates) sessionB.applyRemote(update);
    b.world.sync();
    b.step(16); // the facade judges a board an applied record touched at its next publish
    const six = Object.fromEntries(SEED_TYPES.map((type) => [type, 1]));
    expect(deskCensus(a)).toEqual(six);
    expect(deskCensus(b)).toEqual(six);
    const pull = async (): Promise<void> => {
      const answer = await daemon.docs.hostAnswer(docId, {
        version: versionOf(sessionB),
        hasCheckpoint: true,
        baseEpoch: 0,
      });
      if (answer?.update != null) sessionB.applyRemote(answer.update);
      b.world.sync();
    };

    // 1. A NOTE TYPED IN A — through the note kind's own typing session (ICE's `createNoteTyping`:
    //    the claim, the live keystrokes, ONE commit at the session's end) — APPEARS IN B'S DESK.
    const noteA = only(a, NOTE_TYPE);
    const typing = createNoteTyping({
      world: a.world,
      docs: a.docs,
      ink: NOTE_INK,
      props: NOTE_PROPS,
    });
    expect(typing.begin(noteA)).toBe(true);
    for (const text of ["t", "ty", "typed in A"]) typing.input(text);
    typing.end();
    const noteB = only(b, NOTE_TYPE);
    expect(sessionB.store.keyOf(noteB)).toBe(sessionA.store.keyOf(noteA)); // one note, two tabs
    await until(async () => {
      await pull();
      return b.world.get(noteB, NOTE_INK)?.text === "typed in A";
    }, "A's typing in B's desk");

    // 2. A MINI MAT MOVED IN B — one move commit, the write path the desk's arrow nudge takes
    //    (`guardedTransaction` over `Position`) — LANDS IN A.
    b.step(32);
    const matB = only(b, MINIMAT_TYPE);
    const was = b.world.get(matB, Position);
    if (was === undefined) throw new Error("the mini mat has no position");
    const to = { x: was.x + 480, y: was.y - 240 };
    const outbound: Uint8Array[] = [];
    const offOut = sessionB.store.subscribeOutbound((bytes) => outbound.push(bytes.slice()));
    guardedTransaction(sessionB.store, b.world, (tx) => {
      tx.edit(matB).set(Position, to);
    });
    b.world.sync();
    await until(() => outbound.length > 0, "B's move on its way out");
    offOut();
    for (const payload of outbound) {
      const outcome = await daemon.docs.applyRemoteRecord(docId, {
        kind: DOC_SYNC_RECORD.UPDATE,
        meta: { baseEpoch: 0, engineSchema: ENGINE_SCHEMA_VERSION, savedAt: Date.now() },
        payload,
      });
      expect(outcome.applied).toBe(true);
    }
    const matA = only(a, MINIMAT_TYPE);
    await until(() => {
      a.world.sync(); // the window's lane pushed it; the binding drains inbound on sync
      const at = a.world.get(matA, Position);
      return at?.x === to.x && at?.y === to.y;
    }, "B's move in A's desk");

    // 3. ONE BOARD: what the two tabs hold is the same — the six, the typing, the move.
    await until(async () => {
      await pull();
      return JSON.stringify(stateOf(sessionA)) === JSON.stringify(stateOf(sessionB));
    }, "the two tabs to converge");
    expect(stateOf(sessionB)).toEqual(stateOf(sessionA));
    expect(deskCensus(a)).toEqual(six);
    expect(deskCensus(b)).toEqual(six);
    expect(a.world.get(noteA, NOTE_INK)?.text).toBe("typed in A");
    expect(b.world.get(matB, Position)).toEqual(to);
    expect(getBoardStatus().state).not.toBe("quarantined");
    await manager.shutdown();
  });
});
