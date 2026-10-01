// @vitest-environment node
// DS-5 — THE WITNESS for §1.2 defect 2: "an open window on B is pushed A's
// update". Real fieldd, the real DocManager and lane client, a real ICE engine
// bound through the real bindPersistence; the PEER desktop is a second ICE
// engine that opens the same canvas and edits it, and its outbound record is
// handed to fieldd exactly as a doc-sync lane would hand it
// (`applyRemoteRecord`). The window must gain the peer's widget with no
// reopen — and stay out of quarantine, because a push is exported from what
// fieldd can prove the window holds.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineQuery, ENGINE_SCHEMA_VERSION, Position, PrefabId } from "@vibecook/ice";
import { DOC_SYNC_RECORD, LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { bootstrap, type FielddDaemon } from "@vibefield/fieldd";
import { MockMgmtServer } from "@vibefield/fieldd/testing";
import { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBoardStatus } from "../src/board-status";
import { DocManager } from "../src/doc-manager";
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
      if (pending.seed) seedField(ce, session, registry);
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
    const type = [...registry.allWidgets().keys()][0];
    if (type === undefined) throw new Error("no widget type registered");
    peer.ops.spawnWidget(type, { x: 4_000, y: 4_000, w: 200, h: 120 });
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
