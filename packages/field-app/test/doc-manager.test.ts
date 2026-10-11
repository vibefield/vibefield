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
import {
  createCanvasEngine,
  defineQuery,
  ENGINE_SCHEMA_VERSION,
  Position,
  PrefabId,
} from "@vibecook/ice";
import { LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { bootstrap, type FielddDaemon } from "@vibefield/fieldd";
import { MockMgmtServer } from "@vibefield/fieldd/testing";
import { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DOC_NAME, DocManager } from "../src/doc-manager";
import { stillKey } from "../src/doc-stills";
import { createDeskBlobStore, deskBlobs } from "../src/field/desk/desk-blobs";
import { deskCensus } from "../src/field/desk/desk-door";
import { SEED_TYPES } from "../src/field/desk/desk-seed";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";
import { pageStills } from "../src/surfaces/live/page-stills";

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
async function applyPending(manager: DocManager): Promise<ReturnType<typeof createFieldEngine>> {
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
    if (pending.seed) await seedField(ce, session, createDeskBlobStore());
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

    const ce = await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    expect(localStorage.getItem("vf-last-doc")).toBe(pending?.docId);
    await putCurrent(manager, ce);
    expect(daemon.docs.list()).toHaveLength(1);
  });

  it("rename round-trips to the daemon registry (label only)", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    await applyPending(manager);
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
    const ce1 = await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    await putCurrent(manager, ce1);

    await manager.createDoc();
    const second = manager.getState().pending;
    expect(second?.docId).not.toBe(first?.docId);
    expect(second?.name).toBe("Untitled");
    expect(second?.seed).toBe(false); // user docs open empty — never the demo scene
    expect(second?.initialBytes).toBeNull();

    await applyPending(manager);
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
    const ce1 = await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    const originalBytes = await putCurrent(manager, ce1);

    await manager.createDoc();
    const ce2 = await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    let widgets = 0;
    ce2.world.query(defineQuery([Position, PrefabId])).each((b) => {
      for (const _ of b) widgets += 1;
    });
    expect(widgets).toBe(0); // the new field is EMPTY — nothing left of the seeded desk
    await putCurrent(manager, ce2);

    await manager.switchTo(original?.docId ?? "");
    const restored = manager.getState().pending;
    expect(restored?.docId).toBe(original?.docId);
    expect(Array.from(restored?.initialBytes ?? [])).toEqual(Array.from(originalBytes));
    const ce3 = await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    // everything recovers — the seed's census, kind by kind (the one `__vfDesk.census()` reads)
    expect(deskCensus(ce3)).toEqual(Object.fromEntries(SEED_TYPES.map((type) => [type, 1])));
    // 30s: three engine seeds/opens + two switches (the same parallel-load flag).
  }, 30_000);

  it("restart honors vf-last-doc and restores byte-identical content", async () => {
    const { daemon, dataDir } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const docId = manager.getState().pending?.docId;
    const ce = await applyPending(manager);
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

  it("DK-5: a window reopens ITS board — not the last board another window opened; a new window reads the launch's", async () => {
    // sessionStorage is the window's own and outlives its renderer: a renderer replaced after a
    // daemon restart reopens what it held. Two windows on one shared `vf-last-doc` both reopened
    // the last board, and fieldd's single-writer lock refused the second (the restart soak).
    const store = new Map<string, string>();
    const session = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    };
    Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true });
    cleanup.push(() => {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    });
    const { daemon } = await stack();
    const first = managerFor(daemon);
    await first.boot();
    const mine = first.getState().pending?.docId ?? "";
    await putCurrent(first, await applyPending(first));
    await until(() => first.getState().phase === "ready");
    expect(store.get("vf-window-doc")).toBe(mine);
    await first.createDoc(); // the board another window opened last
    const theirs = first.getState().pending?.docId ?? "";
    await putCurrent(first, await applyPending(first));
    await until(() => first.getState().phase === "ready");
    await first.shutdown();
    expect(localStorage.getItem("vf-last-doc")).toBe(theirs);
    store.set("vf-window-doc", mine); // this window held `mine`

    const replaced = managerFor(daemon); // this window's renderer, replaced
    await replaced.boot();
    expect(replaced.getState().pending?.docId).toBe(mine);
    await replaced.shutdown();

    store.clear(); // a NEW window: no board of its own yet
    const fresh = managerFor(daemon);
    await fresh.boot();
    expect(fresh.getState().pending?.docId).toBe(theirs);
  }, 30_000);

  it("DK-9: a NEW window while another holds the last board opens the most recent board NO window holds — never the degraded session", async () => {
    const { daemon } = await stack();
    const a = managerFor(daemon);
    await a.boot(); // the first run: a seeded "Field", now held by window A's lane
    const held = a.getState().pending?.docId ?? "";
    await putCurrent(a, await applyPending(a));
    await until(() => a.getState().phase === "ready");
    expect(localStorage.getItem("vf-last-doc")).toBe(held);
    const other = (await a.refreshDocs()).length;
    const client = new FielddClient({
      url: `ws://127.0.0.1:${daemon.controlPort}`,
      token: daemon.shellToken,
      clientKind: "debug",
    });
    client.connect();
    cleanup.push(() => client.close());
    const free = ((await client.request("doc.create", { name: "Studio" })) as { docId: string })
      .docId;
    expect(other).toBe(1);

    const b = managerFor(daemon); // a NEW window: no board of its own
    await b.boot();
    const pending = b.getState().pending;
    expect(pending?.docId).toBe(free); // the last board was held: skipped, never waited on
    expect(pending?.lane).not.toBeNull();
    expect(pending?.seed).toBe(false);
    expect(b.getState().heldElsewhere).toBeUndefined();
    expect(a.getState().pending?.docId).toBe(held); // A keeps its board
  }, 30_000);

  it("DK-9: a NEW window when EVERY board is held opens a NEW board — empty, saved — never the degraded session", async () => {
    const { daemon } = await stack();
    const a = managerFor(daemon);
    await a.boot();
    const held = a.getState().pending?.docId ?? "";
    await putCurrent(a, await applyPending(a));
    await until(() => a.getState().phase === "ready");

    const b = managerFor(daemon);
    await b.boot();
    const pending = b.getState().pending;
    expect(pending?.docId).not.toBe(held);
    expect(pending?.docId).not.toBe("");
    expect(pending?.lane).not.toBeNull(); // a real board this window holds
    expect(pending?.seed).toBe(false); // the first-run composition is the first board's alone
    expect(pending?.name).toBe("Untitled");
    expect(b.getState().heldElsewhere).toBeUndefined();
    expect((await b.refreshDocs()).map((d) => d.docId)).toContain(pending?.docId);
  }, 30_000);

  it("DK-9: two NEW windows launching at once each land on a board of their own — never the degraded session", async () => {
    const { daemon } = await stack();
    const a = managerFor(daemon);
    const b = managerFor(daemon);
    await Promise.all([a.boot(), b.boot()]);
    const [pa, pb] = [a.getState().pending, b.getState().pending];
    expect(pa?.lane).not.toBeNull();
    expect(pb?.lane).not.toBeNull();
    expect(pa?.docId).not.toBe("");
    expect(pb?.docId).not.toBe("");
    expect(pa?.docId).not.toBe(pb?.docId);
    expect(a.getState().heldElsewhere).toBeUndefined();
    expect(b.getState().heldElsewhere).toBeUndefined();
  }, 30_000);

  it("DK-9: a window whose OWN board another window holds falls back to the in-memory session the pill names — the explicit open's fallback", async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "sessionStorage", {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
      },
      configurable: true,
    });
    cleanup.push(() => {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    });
    const { daemon } = await stack();
    const a = managerFor(daemon);
    await a.boot();
    const held = a.getState().pending?.docId ?? "";
    const name = a.getState().pending?.name ?? "";
    await putCurrent(a, await applyPending(a));
    await until(() => a.getState().phase === "ready");
    expect(store.get("vf-window-doc")).toBe(held);

    // window B's renderer was replaced while its board (`held`) was taken by A: B asks for it BY NAME
    const b = managerFor(daemon);
    await b.boot();
    const pending = b.getState().pending;
    expect(pending?.lane).toBeNull(); // in memory: nothing it does is saved
    expect(pending?.docId).toBe("");
    expect(pending?.seed).toBe(false); // an empty board in its place, never a demo board
    expect(b.getState().heldElsewhere).toEqual({ docId: held, name });
    expect(store.get("vf-window-doc")).toBe(held); // it still asks for its own board next time
    await applyPending(b);
    await until(() => b.getState().phase === "ready");
  }, 30_000);

  it("a stale vf-last-doc falls back to the most recent doc, never a blind seed", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const docId = manager.getState().pending?.docId;
    const ce = await applyPending(manager);
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
    await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
  });
});

describe("DK-9 — the same board on a NEW generation (DocManager.remount)", () => {
  it("ends the typing, flushes, and opens the board AS IT STANDS on a new generation over the SAME lane — saving goes on", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const first = manager.getState().pending;
    if (first === null || first.lane === null) throw new Error("no board");
    const ce = await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    await putCurrent(manager, ce);
    const endInput = vi.fn();
    manager.registerReopen(first.generation, {
      endInput,
      export: () => ce.docs.current()?.exportEnvelope(Date.now()) ?? null,
    });
    // an edit since the open: on the board as it stands, never at fieldd yet
    const note = ce.ops.spawnWidget("desk.note", { x: 900, y: 900, undoable: false });
    ce.world.sync();
    expect(note).toBeDefined();
    const before = deskCensus(ce)["desk.note"] ?? 0;

    expect(await manager.remount("plugin-enabled")).toBe(true);
    const next = manager.getState().pending;
    expect(next?.generation).toBe(first.generation + 1);
    expect(next?.docId).toBe(first.docId);
    expect(next?.lane).toBe(first.lane); // no second writer, no round trip
    expect(next?.seed).toBe(false);
    expect(next?.initialUpdates).toEqual([]);
    expect(endInput).toHaveBeenCalledTimes(1);

    const reopened = createFieldEngine(buildRegistry());
    cleanup.push(() => reopened.dispose());
    const res = reopened.docs.open(next?.initialBytes ?? new Uint8Array());
    if (!res.ok) throw new Error(res.reason);
    reopened.world.sync();
    expect(deskCensus(reopened)["desk.note"]).toBe(before); // the edit came along
    manager.contentApplied(next?.generation ?? 0);
    await until(() => manager.getState().phase === "ready");
    // the lane the board kept takes the new generation's saves
    await putCurrent(manager, reopened);
    expect(await daemon.docs.readDoc(first.docId)).not.toBeNull();
  }, 30_000);

  it("asks fieldd who holds the board LIVE (`doc.holders`): none on a lone desktop — no other holder, the stamp lands", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const docId = manager.getState().pending?.docId ?? "";
    await applyPending(manager);
    const client = new FielddClient({
      url: `ws://127.0.0.1:${daemon.controlPort}`,
      token: daemon.shellToken,
      clientKind: "debug",
    });
    client.connect();
    cleanup.push(() => client.close());
    expect(await client.request("doc.holders", { docId })).toEqual({ docId, live: [] });
    expect(await manager.heldLiveElsewhere(docId)).toBe(false);
    expect(await manager.heldLiveElsewhere("")).toBe(false); // an in-memory board is nobody's
  }, 30_000);

  it("refuses with no applied board to carry — the state untouched", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    expect(await manager.remount("plugin-enabled")).toBe(false);
    await manager.boot();
    // booted, but nothing applied yet (no generation registered its reopen)
    const pending = manager.getState().pending;
    expect(await manager.remount("plugin-enabled")).toBe(false);
    expect(manager.getState().pending).toBe(pending);
  }, 30_000);
});

describe("boards from before the desk (DK-3, ruling 7)", () => {
  /** An `ice.default` board — what the pre-desk build saved — PUT under the last schema it knew. */
  async function putBeforeTheDesk(manager: DocManager): Promise<void> {
    const pending = manager.getState().pending;
    if (pending?.lane == null) throw new Error("no lane to put");
    const old = createCanvasEngine();
    const bytes = old.docs.create().exportEnvelope(Date.now());
    old.dispose();
    await pending.lane.put(bytes, { engineSchema: 2, savedAt: Date.now() });
  }

  it("never opens one: the launch passes it by, the explorer lists it, Delete tombstones it", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot(); // the first run's desk board
    const field = manager.getState().pending?.docId;
    await putCurrent(manager, await applyPending(manager));
    await until(() => manager.getState().phase === "ready");
    await manager.createDoc();
    const old = manager.getState().pending?.docId;
    await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    await putBeforeTheDesk(manager);
    await manager.getState().pending?.lane?.drain();

    // a relaunch whose last board is the old one
    localStorage.setItem("vf-last-doc", old ?? "");
    const relaunch = managerFor(daemon);
    await relaunch.boot();
    expect(relaunch.getState().pending?.docId).toBe(field); // passed by, never opened
    expect(relaunch.getState().beforeTheDesk).toEqual([old]);
    await applyPending(relaunch);
    await until(() => relaunch.getState().phase === "ready");

    // the explorer cannot open it either
    await relaunch.switchTo(old ?? "");
    expect(relaunch.getState().pending?.docId).toBe(field);

    // Delete: DS-5's tombstone — it leaves the list (the bytes stay on disk)
    await relaunch.deleteDoc(old ?? "");
    expect(relaunch.getState().docs.map((d) => d.docId)).not.toContain(old);
    expect(relaunch.getState().beforeTheDesk).toEqual([]);
  }, 30_000);

  it("keeps a board the open refused as from before the desk, and never relaunches into it", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const docId = manager.getState().pending?.docId ?? "";
    // the workspace session judged its bytes (its header) and refused it at open
    manager.refuseBeforeTheDesk(docId);
    expect(manager.getState().beforeTheDesk).toEqual([docId]);
    manager.contentApplied(manager.getState().pending?.generation ?? -1);
    expect(localStorage.getItem("vf-last-doc")).toBeNull();
  });
});

describe("the explorer's stills (DK-4, DK-D27)", () => {
  it("a switch takes the closing board's still BEFORE the next board opens, and the explorer shows it", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const first = manager.getState().pending;
    if (first === null) throw new Error("no pending session");
    await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:the-closing-still");
    const trace: string[] = [];
    // what the workspace session registers per generation (field/desk/desk-stills.ts)
    manager.registerStills(first.generation, first.docId, {
      owe: () => trace.push("owe"),
      close: async () => {
        const open = manager.getState().pending?.docId === first.docId;
        trace.push(open ? "close, the board still open" : "close, after the swap");
        await manager.keepStill(first.docId, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      },
    });
    manager.stillOwed(first.docId); // an acknowledged save of the open board
    manager.stillOwed("another-board"); // …never another's
    await manager.createDoc();
    expect(trace).toEqual(["owe", "close, the board still open"]);
    expect(manager.getState().pending?.docId).not.toBe(first.docId);
    expect(manager.getState().thumbnailUrls[first.docId]).toBe("blob:the-closing-still");
  });

  it("DK-5: Delete takes a board's still away — off the explorer and off the shelf — and (PT-5b) the last stills of its panes' pages with it", async () => {
    const { daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    const kept = manager.getState().pending?.docId ?? "";
    await manager.createDoc();
    await applyPending(manager);
    await until(() => manager.getState().phase === "ready");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:the-kept-still");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await manager.keepStill(kept, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(manager.getState().thumbnailUrls[kept]).toBe("blob:the-kept-still");
    expect(await deskBlobs().kept(stillKey(kept))).toBeDefined();

    // PT-5b: the last stills of its panes' pages are on the same shelf — and another board's beside them
    const page = {
      address: "https://example.org/",
      logical: [1280, 800] as const,
      size: [1600, 1000] as const,
      type: "image/webp",
      image: new Uint8Array([1, 2, 3]),
      takenAt: 1,
    };
    const other = manager.getState().pending?.docId ?? "";
    await pageStills().keep(kept, "13918995204487956201-1", page);
    await pageStills().keep(kept, "13918995204487956201-2", page);
    await pageStills().keep(other, "13918995204487956201-1", page);

    await manager.deleteDoc(kept);
    expect(manager.getState().docs.map((d) => d.docId)).not.toContain(kept);
    expect(manager.getState().thumbnailUrls[kept]).toBeUndefined();
    expect(revoked).toHaveBeenCalledWith("blob:the-kept-still");
    expect(await deskBlobs().kept(stillKey(kept))).toBeUndefined();
    // …and its panes' page stills went with it — not the other board's
    expect(await pageStills().kept(kept, "13918995204487956201-1")).toBeUndefined();
    expect(await pageStills().kept(kept, "13918995204487956201-2")).toBeUndefined();
    expect(await pageStills().kept(other, "13918995204487956201-1")).toBeDefined();
  }, 30_000);
});
