// DS-5 — two complete fieldd doc stacks in Loro custody, joined by the shared
// in-process router (doc-mesh-harness). The witnesses DS §11 names for the
// intent plane's merge half:
//   · THE §1.2 DEFECT: a checkpoint written on A while B holds content
//     converges — the edits ICE folded into it reach B though no journal
//     record ever carried them;
//   · two DS-5 peers open with VERSION, answer once, and leave the HAVE behind
//     it unanswered;
//   · a record too large for a frame crosses as CHUNKs on a lane of its own.
// What it does not prove is the wire (field-native's quic_lane_transport.rs).
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOC_SYNC_RECORD } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentService, DocumentServiceOptions } from "../src/doc-service";
import { type DocSyncOptions, docHostPeers } from "../src/doc-sync";
import { LoroHost } from "../src/loro-host";
import { Device, Mesh } from "./doc-mesh-harness";
import { Renderer, replay } from "./loro-renderer";

let dirs: string[] = [];
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 60));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
vi.setConfig({ testTimeout: 15_000 });

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

/** Both devices know the docs exist (B's registry seeded, as the library will
 * seed it — doc-library tests prove that half) and only A holds content. */
async function pair(
  syncOptions: Partial<DocSyncOptions> = {},
  opts: {
    docs?: number;
    join?: "now" | "later";
    /** DS-5c — per-device DocumentService options. */
    docsOptions?: (name: string) => Partial<DocumentServiceOptions>;
  } = {},
): Promise<{ a: Device; b: Device; docId: string; docIds: string[]; mesh: Mesh }> {
  const mesh = new Mesh();
  const docIds = Array.from({ length: opts.docs ?? 1 }, () => randomUUID());
  const devices: Device[] = [];
  for (const name of ["A", "B"]) {
    const dataDir = mkdtempSync(join(tmpdir(), `vf-dshost-${name}-`));
    dirs.push(dataDir);
    mkdirSync(join(dataDir, "registries"), { recursive: true });
    for (const docId of docIds) mkdirSync(join(dataDir, "docs", docId), { recursive: true });
    writeFileSync(
      join(dataDir, "registries", "field.docs.v1.json"),
      JSON.stringify(
        docIds.map((docId) => ({
          docId,
          name: "board",
          updatedAt: 1,
          baseEpoch: 0,
          engineSchema: null,
          sizeBytes: 0,
        })),
      ),
    );
    devices.push(new Device(name, mesh, dataDir, syncOptions, opts.docsOptions?.(name) ?? {}));
  }
  const [a, b] = devices as [Device, Device];
  mesh.devices.set("A", a);
  await a.sync.start();
  // `later`: B joins the mesh only when the test says so (`enter`), so A can
  // hold content before anyone greets it.
  if (opts.join !== "later") await enter(mesh, b);
  return { a, b, docId: docIds[0] as string, docIds, mesh };
}

/** B enters the mesh and starts; A replicates toward it at once (DS-D7). */
async function enter(mesh: Mesh, b: Device): Promise<void> {
  mesh.devices.set("B", b);
  await b.sync.start();
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

/** Loro promises no key order, so boards compare as sorted entries. */
const sameBoard = (x: Record<string, unknown>, y: Record<string, unknown>): boolean =>
  JSON.stringify(Object.entries(x).sort()) === JSON.stringify(Object.entries(y).sort());

const boardOf = async (d: Device, docId: string): Promise<Record<string, unknown>> => {
  try {
    return (await replay(d.docs, docId)).board();
  } catch {
    return {};
  }
};

describe("DS-5 — two desktops, one canvas, merged by version", () => {
  it("THE §1.2 DEFECT: a checkpoint written on A while B holds content converges", async () => {
    const { a, b, docId, mesh } = await pair();
    const wa = new Renderer(1n);
    wa.edit("base", "A");
    await put(a.docs, docId, "checkpoint", wa.checkpoint());
    await until(async () => (await boardOf(b, docId)).base === "A", "B to bootstrap from A");

    // B's window opens B's at-rest doc and edits: B now HOLDS content of its own.
    const wb = await replay(b.docs, docId, 2n);
    await put(b.docs, docId, "update", wb.edit("fromB", "journaled"));
    // Meanwhile A's window edits twice and FLUSHES before the debounce: ICE
    // folds both edits into a checkpoint and never appends either one.
    wa.editUnsent("fold1", "x");
    wa.editUnsent("fold2", "y");
    const snapshotsBefore = mesh.carried.filter(
      (r) => r.from === "A" && r.kind === DOC_SYNC_RECORD.SNAPSHOT,
    ).length;
    await put(a.docs, docId, "checkpoint", wa.checkpoint());

    const everything = { base: "A", fromB: "journaled", fold1: "x", fold2: "y" };
    await until(
      async () =>
        sameBoard(await boardOf(a, docId), everything) &&
        sameBoard(await boardOf(b, docId), everything),
      "both desktops to hold everything",
    );
    expect(await boardOf(a, docId)).toEqual(everything);
    expect(await boardOf(b, docId)).toEqual(everything);
    // The folded checkpoint crossed as its DELTA, not as a checkpoint B would
    // have had to decline: no new SNAPSHOT left A after the bootstrap.
    expect(
      mesh.carried.filter((r) => r.from === "A" && r.kind === DOC_SYNC_RECORD.SNAPSHOT).length,
    ).toBe(snapshotsBefore);
    for (const status of b.sync.statuses()) {
      expect(status.state).not.toBe("peer-declined");
      expect(status.state).not.toBe("epoch-stale");
    }
  });

  it("two DS-5 peers open with VERSION, answer once, and leave the HAVE behind it unanswered", async () => {
    const { a, b, docId, mesh } = await pair();
    const wa = new Renderer(1n);
    wa.edit("k", "v");
    await put(a.docs, docId, "checkpoint", wa.checkpoint());
    await until(async () => (await boardOf(b, docId)).k === "v", "B to bootstrap");
    await new Promise((r) => setTimeout(r, 50));
    const fromA = mesh.carried.filter((r) => r.from === "A");
    const fromB = mesh.carried.filter((r) => r.from === "B");
    // Each side's greeting is a VERSION, then the HAVE for pre-DS-5 peers.
    expect(fromA.some((r) => r.kind === DOC_SYNC_RECORD.VERSION)).toBe(true);
    expect(fromB.some((r) => r.kind === DOC_SYNC_RECORD.VERSION)).toBe(true);
    // B was bootstrapped exactly once: one checkpoint crossed, whatever the
    // number of greetings — the HAVE behind B's VERSION was not answered too.
    expect(fromA.filter((r) => r.kind === DOC_SYNC_RECORD.SNAPSHOT)).toHaveLength(1);
    // B holds what A holds and nothing is pending on either side.
    await until(
      () => b.sync.statuses().every((s) => s.state === "in-step"),
      "B's standing to settle in step",
    );
  });

  it("a record too large for a frame crosses as CHUNKs on a lane of its own", async () => {
    const { a, b, docId, mesh } = await pair({ maxRecordBytes: 400, chunkBytes: 128 });
    const wa = new Renderer(1n);
    for (let i = 0; i < 40; i++) wa.edit(`key-${i}`, `value-${i}-${"x".repeat(12)}`);
    const checkpoint = wa.checkpoint();
    expect(checkpoint.byteLength).toBeGreaterThan(400);
    const opened: number[] = [];
    const open = a.control.open.bind(a.control);
    a.control.open = async (req) => {
      opened.push(req.laneId);
      await open(req);
    };
    await put(a.docs, docId, "checkpoint", checkpoint);
    await until(async () => Object.keys(await boardOf(b, docId)).length === 40, "B to reassemble");
    expect(await boardOf(b, docId)).toEqual(wa.board());
    const chunks = mesh.carried.filter((r) => r.from === "A" && r.kind === DOC_SYNC_RECORD.CHUNK);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.bytes).toBeLessThanOrEqual(400);
    // The transfer rode a lane opened for it and closed behind it.
    await until(
      () => opened.some((laneId) => !a.control.routes.has(laneId)),
      "the transfer lane to close",
    );
  });
});

describe("DS-5c — a lost answer is asked for again; a record past the send watermark is chunked", () => {
  it("a bootstrap answer lost on the wire: B re-greets on the doc-sync beat and converges", async () => {
    // The review's lost eager-replication answer: nothing re-asked for it, so
    // B stood `pending` until a liveness flip that might never come.
    // A holds the canvas before B is on the mesh; B arrives (eager replication
    // greets at once) and A's ANSWER — the checkpoint — is lost on the wire.
    // Nothing else is ever sent: no commit follows, and no liveness flips.
    const { a, b, docId, mesh } = await pair(
      { beatMs: 20, answerTimeoutMs: 80 },
      { join: "later" },
    );
    const wa = new Renderer(1n);
    wa.edit("base", "A");
    await put(a.docs, docId, "checkpoint", wa.checkpoint());
    let lost = 0;
    mesh.drop = (from, to, kind) =>
      from === "A" && to === "B" && kind === DOC_SYNC_RECORD.SNAPSHOT && lost++ === 0;
    await enter(mesh, b);
    await until(() => mesh.dropped.length === 1, "the bootstrap answer to be lost");
    await until(async () => (await boardOf(b, docId)).base === "A", "B to converge on the beat");
    expect(mesh.dropped).toHaveLength(1);
    await until(
      () => b.sync.statuses().every((s) => s.state === "in-step"),
      "B's standing to settle in step",
    );
  });

  it("a ~5 MiB checkpoint crosses as CHUNKs and the update behind it is not refused by a full socket", async () => {
    // The review: records to 8 MiB went whole and unpaced, so the record behind
    // one past MeshLaneLink's 4 MiB watermark THREW, the lane was forgotten, and
    // the canvas stayed pending. The harness now refuses exactly as it does.
    const { a, b, docId, mesh } = await pair({}, { join: "later" });
    mesh.sendCap = 4 * 1024 * 1024;
    const wa = new Renderer(1n);
    // ~2.6 MB of incompressible text: a Loro snapshot carries it twice (the op
    // and the state), so the checkpoint lands between the 4 MiB watermark and
    // the 8 MiB MeshData frame — the band that went whole and unpaced.
    wa.edit("big", randomBytes(1_950_000).toString("base64"));
    const checkpoint = wa.checkpoint();
    expect(checkpoint.byteLength).toBeGreaterThan(4 * 1024 * 1024);
    expect(checkpoint.byteLength).toBeLessThan(8 * 1024 * 1024 - 64);
    await put(a.docs, docId, "checkpoint", checkpoint);
    await put(a.docs, docId, "update", wa.edit("after", "the checkpoint"));
    await enter(mesh, b); // B greets with nothing: A answers checkpoint, then the update
    await until(
      async () => (await boardOf(b, docId)).after === "the checkpoint",
      "B to hold the checkpoint AND the update behind it",
    );
    expect((await boardOf(b, docId)).big).toBe(wa.board()["big"]);
    const fromA = mesh.carried.filter((r) => r.from === "A");
    expect(fromA.filter((r) => r.kind === DOC_SYNC_RECORD.CHUNK).length).toBeGreaterThan(3);
    for (const r of fromA) expect(r.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  }, 30_000);
});

describe("DS-5c — residency across desktops", () => {
  it("idle → evicted → a late peer's VERSION reloads the canvas from disk and is answered", async () => {
    const clock = { now: 1_800_000_000_000 };
    const hostA = new LoroHost();
    const { a, b, docId, mesh } = await pair(
      {},
      {
        join: "later",
        docsOptions: (name) =>
          name === "A"
            ? { host: hostA, now: () => clock.now, residency: { idleMs: 1_000, sweepMs: 10 } }
            : {},
      },
    );
    const wa = new Renderer(1n);
    wa.edit("base", "A");
    await put(a.docs, docId, "checkpoint", wa.checkpoint());
    await put(a.docs, docId, "update", wa.edit("more", "A"));
    expect(hostA.ids()).toContain(docId);
    clock.now += 2_000;
    await until(() => !hostA.ids().includes(docId), "A to evict the idle canvas");

    await enter(mesh, b); // a desktop wakes and greets: A must answer from disk
    await until(
      async () => sameBoard(await boardOf(b, docId), wa.board()),
      "B to converge on what A evicted",
    );
    expect(hostA.ids()).toContain(docId); // reloaded to answer
    a.docs.dispose();
  });
});

describe("DS-5 — the doc peer set is desktops only (DS-D7, UA-P-D5)", () => {
  const roster = [
    { self: true, tailscaleId: undefined, capabilities: { docHost: true } },
    { self: false, tailscaleId: "B", capabilities: { docHost: true } },
    // A desktop that says it hosts no documents is not dialed either.
    { self: false, tailscaleId: "HEADLESS", capabilities: { docHost: false } },
  ];
  // The phone is a self peer (same login) with NO roster row: it publishes no
  // device slice, because it runs no fieldd.
  const selfPeers = [
    { id: "B", online: true },
    { id: "PHONE", online: true },
    { id: "HEADLESS", online: true },
  ];

  it("keeps self peers whose roster row says docHost, and only those", () => {
    expect(docHostPeers(roster, selfPeers)).toEqual([{ id: "B", online: true }]);
    expect(docHostPeers([], selfPeers)).toEqual([]);
  });

  it("a commit is never dialed toward a phone — no failed dial, no peer-offline", async () => {
    const { a, docId } = await pair({ peers: async () => docHostPeers(roster, selfPeers) });
    const wa = new Renderer(1n);
    wa.edit("k", "v");
    await put(a.docs, docId, "checkpoint", wa.checkpoint());
    await put(a.docs, docId, "update", wa.edit("k2", "v2"));
    await until(
      () => a.sync.statuses().some((s) => s.peers.some((p) => p.peer === "B")),
      "A to reach B",
    );
    await new Promise((r) => setTimeout(r, 30));
    const peersSeen = a.sync.statuses().flatMap((s) => s.peers.map((p) => p.peer));
    expect(peersSeen).not.toContain("PHONE");
    expect(peersSeen).not.toContain("HEADLESS");
    expect([...a.control.routes.values()]).not.toContain("PHONE");
    for (const status of a.sync.statuses()) expect(status.state).not.toBe("peer-offline");
  });
});
