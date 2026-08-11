// @vitest-environment node
// (the desktop vitest default is happy-dom, whose WebSocket stub cannot dial a
// real loopback socket — this file needs Node's undici WebSocket end to end)
//
// The B4 launch pipeline against a REAL fieldd (mock mgmt, no cargo), playing
// FieldView's role by hand (apply pending → contentApplied): the first-run
// seed decision, rename, create/switch with the lane-drain law, the restart
// path honoring vf-last-doc, and the stale-last-doc fallback. Supersedes B3's
// board-daemon.test — the byte-identical restart survival lives in here now.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineQuery, ENGINE_SCHEMA_VERSION, Position, PrefabId } from "@vibecook/ice";
import { LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { bootstrap, type FielddDaemon } from "@vibefield/fieldd";
import { MockMgmtServer } from "@vibefield/fieldd/testing";
import { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DOC_NAME, DocManager } from "../src/doc-manager";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});
beforeEach(() => {
  localStorage.removeItem("vf-last-doc"); // the setup-shim storage persists across tests
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: condition timeout");
    await sleep(20);
  }
}

async function stack(dataDir?: string): Promise<{ dataDir: string; daemon: FielddDaemon }> {
  const dir = dataDir ?? mkdtempSync(join(tmpdir(), "vf-b4-"));
  if (dataDir === undefined) {
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "native", "run"), { recursive: true });
    writeFileSync(join(dir, "native", "pairing"), "ab".repeat(32));
    // WIN-D1: pipe name on win32, joined LAYOUT path on unix (what fieldd dials)
    const mock = new MockMgmtServer(
      process.platform === "win32"
        ? pipeEndpointFor(dir, SOCKETS.MGMT)
        : join(dir, ...LAYOUT.MGMT_SOCKET),
    );
    await mock.start();
    cleanup.push(() => mock.stop());
  }
  const daemon = await bootstrap({ dataDir: dir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return { dataDir: dir, daemon };
}

function managerFor(daemon: FielddDaemon): DocManager {
  const client = new FielddClient({
    url: `ws://127.0.0.1:${daemon.controlPort}`,
    token: daemon.shellToken,
    clientKind: "debug",
  });
  client.connect();
  cleanup.push(() => client.close());
  return new DocManager(client, { timeoutMs: 5_000 });
}

/** Play FieldView: apply the pending session to a real engine, report applied. */
function applyPending(manager: DocManager): ReturnType<typeof createFieldEngine> {
  const pending = manager.getState().pending;
  if (pending === null) throw new Error("no pending session");
  const registry = buildRegistry();
  const ce = createFieldEngine(registry);
  cleanup.push(() => ce.dispose());
  if (pending.initialBytes !== null) {
    const res = ce.docs.open(pending.initialBytes);
    if (!res.ok) throw new Error(`open failed: ${res.reason}`);
    for (const update of pending.initialUpdates) res.session.applyRemote(update);
    ce.world.sync();
  } else {
    const session = ce.docs.create();
    if (pending.seed) seedField(ce, session, registry);
    else ce.world.sync();
  }
  manager.contentApplied(pending.generation);
  return ce;
}

async function putCurrent(manager: DocManager, ce: ReturnType<typeof createFieldEngine>) {
  const pending = manager.getState().pending;
  const session = ce.docs.current();
  if (pending?.lane == null || session === undefined) throw new Error("no lane/session to put");
  const bytes = session.exportEnvelope(Date.now());
  await pending.lane.put(bytes, { engineSchema: ENGINE_SCHEMA_VERSION, savedAt: Date.now() });
  return bytes;
}

describe("DocManager launch pipeline (B4)", () => {
  it("first run creates + seeds the default doc, lands ready, remembers it", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();

    const pending = manager.getState().pending;
    expect(pending?.name).toBe(DEFAULT_DOC_NAME);
    expect(pending?.seed).toBe(true);
    expect(pending?.initialBytes).toBeNull();
    expect(pending?.lane).not.toBeNull();

    const ce = applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    expect(localStorage.getItem("vf-last-doc")).toBe(pending?.docId);
    await putCurrent(manager, ce);
    expect(daemon.docs.list()).toHaveLength(1);
  });

  it("rename round-trips to the daemon registry (label only)", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    applyPending(manager);
    await until(() => manager.getState().phase === "ready");

    const before = daemon.docs.list()[0];
    await manager.rename("Studio");
    expect(manager.getState().doc?.name).toBe("Studio");
    const after = daemon.docs.list()[0];
    expect(after?.name).toBe("Studio");
    expect(after?.updatedAt).toBe(before?.updatedAt); // recency is content, not labels
  });

  it("createDoc switches sessions, opens EMPTY, and drains the old lane", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const first = manager.getState().pending;
    const ce1 = applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    await putCurrent(manager, ce1);

    await manager.createDoc();
    const second = manager.getState().pending;
    expect(second?.docId).not.toBe(first?.docId);
    expect(second?.name).toBe("Untitled");
    expect(second?.seed).toBe(false); // user docs open empty — never the demo scene
    expect(second?.initialBytes).toBeNull();

    applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    // the drain law: the retired lane settles + closes once the successor applied
    await until(() => first?.lane?.status === "closed");
    expect(daemon.docs.list()).toHaveLength(2);
    expect(localStorage.getItem("vf-last-doc")).toBe(second?.docId);
    // 30s: two real engine seeds + lane cycles run 5-8s under full-suite
    // parallel load (device-finish flag, 2026-07-21) — the 5s default flakes.
  }, 30_000);

  it("the field-report flow: seed → new field is EMPTY → switch back restores", async () => {
    // James, 2026-07-21: "created new field, all the r3f 3d element and wires
    // are still showing, and when open original doc, nothing recovers." Each
    // applyPending builds a FRESH engine — exactly the app's remount-per-doc
    // design — so this pins the whole switch cycle headlessly.
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const original = manager.getState().pending;
    const ce1 = applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    const originalBytes = await putCurrent(manager, ce1);

    await manager.createDoc();
    const ce2 = applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    let widgets = 0;
    ce2.world.query(defineQuery([Position, PrefabId])).each((b) => {
      for (const _ of b) widgets += 1;
    });
    expect(widgets).toBe(0); // the new field is EMPTY — no leftover 3D cards/wires
    await putCurrent(manager, ce2);

    await manager.switchTo(original?.docId ?? "");
    const restored = manager.getState().pending;
    expect(restored?.docId).toBe(original?.docId);
    expect(Array.from(restored?.initialBytes ?? [])).toEqual(Array.from(originalBytes));
    const ce3 = applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    let restoredWidgets = 0;
    ce3.world.query(defineQuery([Position, PrefabId])).each((b) => {
      for (const _ of b) restoredWidgets += 1;
    });
    expect(restoredWidgets).toBe(21); // everything recovers
    // 30s: three engine seeds/opens + two switches (the same parallel-load flag).
  }, 30_000);

  it("restart honors vf-last-doc and restores byte-identical content", async () => {
    const { daemon, dataDir } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const docId = manager.getState().pending?.docId;
    const ce = applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    const bytes = await putCurrent(manager, ce);
    await manager.getState().pending?.lane?.drain();
    await daemon.stop();

    const { daemon: daemon2 } = await stack(dataDir);
    const manager2 = managerFor(daemon2);
    await manager2.boot();
    const pending2 = manager2.getState().pending;
    expect(pending2?.docId).toBe(docId);
    expect(pending2?.seed).toBe(false);
    expect(Array.from(pending2?.initialBytes ?? [])).toEqual(Array.from(bytes));
  });

  it("a stale vf-last-doc falls back to the most recent doc, never a blind seed", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const docId = manager.getState().pending?.docId;
    const ce = applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    await putCurrent(manager, ce);
    await manager.getState().pending?.lane?.drain();

    localStorage.setItem("vf-last-doc", "1f0d7a2e-3c44-4b8a-9e51-000000000000"); // gone
    const manager2 = managerFor(daemon);
    await manager2.boot();
    const pending2 = manager2.getState().pending;
    expect(pending2?.docId).toBe(docId); // most-recent fallback
    expect(pending2?.seed).toBe(false);
    expect(pending2?.initialBytes).not.toBeNull();
  });

  it("an unreachable daemon degrades to an in-memory seeded board, still ready", async () => {
    const client = new FielddClient({ url: "ws://127.0.0.1:1", token: "nope" });
    cleanup.push(() => client.close());
    const manager = new DocManager(client, { timeoutMs: 250 });
    await manager.boot();
    const pending = manager.getState().pending;
    expect(pending?.lane).toBeNull();
    expect(pending?.seed).toBe(true);
    applyPending(manager);
    await until(() => manager.getState().phase === "ready");
  });
});
