// DS-5d — COMPACTION ACROSS DESKTOPS (design-06 §4), on the doc-mesh harness:
// several DocumentServices on one in-process mesh, each with the library
// system document, and each with the real holders ledger over an in-memory
// `field.docs.v1` store (truffle's store drops a slice when its publisher
// leaves; the ledger is what remembers it).
//
// The rows are the slice's witness: A passes the threshold and compacts; the
// library carries the epoch; B — acknowledged above the watermark, with an
// edit of its own made at the old epoch — is answered S4 and re-bootstraps
// keeping it; C, offline through the compaction (remembered, within the
// horizon), comes back and does the same with its offline edit; D, unseen 31
// days, is not waited for, and its edits below the trim are the known loss —
// with nothing panicked into any host; a restarted A answers a new desktop
// from its compacted base.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc, type VersionVector } from "loro-crdt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liftIce1, wrapIce1 } from "../src/ice1-envelope";
import {
  DocHoldersService,
  LibraryDocService,
  systemAccount,
  systemDocId,
} from "../src/library-doc";
import { versionFromBase64 } from "../src/loro-host";
import { Device, Mesh } from "./doc-mesh-harness";
import { FakeHoldersStore } from "./holders-store";
import { HEADER, Renderer, replay } from "./loro-renderer";

vi.setConfig({ testTimeout: 60_000 });

let dirs: string[] = [];
const worlds: World[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) world.dispose();
  await new Promise((r) => setTimeout(r, 60));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const ACCOUNT = systemAccount("james@example.com", "fuid-a");
const LIBRARY = systemDocId("library", ACCOUNT);
const DAY = 86_400_000;

const json = (v: VersionVector): Record<string, number> =>
  Object.fromEntries([...v.toJSON()].map(([p, c]) => [String(p), c]));

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 2_000; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

interface Desk {
  name: string;
  dataDir: string;
  device: Device;
  library: LibraryDocService;
  holders: DocHoldersService;
}

/** Desktops on one mesh, one holders store, one clock (the ledger's and the
 * hosts' — the watermark compares the two). */
class World {
  readonly mesh = new Mesh();
  readonly store = new FakeHoldersStore();
  readonly clock = { now: 1_800_000_000_000 };
  readonly desks = new Map<string, Desk>();
  /** Desktops off the mesh: nothing to or from them crosses. */
  readonly away = new Set<string>();
  /** "from>to" — one direction cut. */
  readonly cuts = new Set<string>();

  constructor() {
    worlds.push(this);
    this.mesh.drop = (from, to) =>
      this.away.has(from) || this.away.has(to) || this.cuts.has(`${from}>${to}`);
  }

  async add(
    name: string,
    opts: { compaction?: { records: number } | false; dataDir?: string } = {},
  ): Promise<Desk> {
    const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), `vf-cmesh-${name}-`));
    if (opts.dataDir === undefined) dirs.push(dataDir);
    const device = new Device(
      name,
      this.mesh,
      dataDir,
      { beatMs: 40, answerTimeoutMs: 150, regreetMaxMs: 600 },
      { residency: false, compaction: opts.compaction ?? false, now: () => this.clock.now },
    );
    const library = new LibraryDocService({ dataDir, docId: LIBRARY });
    await library.ready();
    device.docs.registerSystemDoc(LIBRARY, "Library", library.doc, library.hostOwner());
    // As the daemon wires it: an adopted canvas is fetched on adoption.
    device.docs.onCatalogChanged((change) => {
      if (change.adopted.length > 0) device.sync.replicate(change.adopted, { regreet: true });
    });
    await device.docs.attachLibrary(library);
    const desk: Desk = { name, dataDir, device, library, holders: this.#holders(name, device) };
    this.mesh.devices.set(name, device);
    this.desks.set(name, desk);
    await device.sync.start();
    await desk.holders.start();
    return desk;
  }

  /** As the daemon wires the holders slice (`daemon.ts`). */
  #holders(name: string, device: Device): DocHoldersService {
    const holders = new DocHoldersService({
      mesh: this.store.member(name),
      deviceId: () => name,
      holdings: () => device.docs.holdings(() => true),
      now: () => this.clock.now,
      debounceMs: 1,
    });
    device.docs.setAcknowledgements((docId) => holders.acknowledgements(docId));
    device.docs.onHoldingsChanged(() => holders.schedule());
    return holders;
  }

  /** Every present desktop publishes what it holds and acknowledges now (the
   * daemon does it on every commit; the rows do it where they mean it). */
  async publish(): Promise<void> {
    for (const desk of this.desks.values()) {
      if (!this.away.has(desk.name)) await desk.holders.publish();
    }
  }

  /** The desktop drops off the mesh: its slice leaves the store with it. */
  leave(name: string): void {
    const desk = this.desks.get(name) as Desk;
    this.away.add(name);
    desk.holders.stop();
    this.store.leave(name);
  }

  /** It comes back: a slice again, and it greets every canvas it holds (the
   * liveness fold's re-greet). */
  async back(name: string): Promise<void> {
    const desk = this.desks.get(name) as Desk;
    this.away.delete(name);
    desk.holders = this.#holders(name, desk.device);
    await desk.holders.start();
    desk.device.sync.replicate(undefined, { regreet: true });
  }

  /** The cuts heal, and both ends greet again (the liveness fold's re-greet
   * when a peer returns: a silently lost record leaves no fact to retry on). */
  heal(): void {
    const ends = new Set([...this.cuts].flatMap((cut) => cut.split(">")));
    this.cuts.clear();
    for (const name of ends)
      this.desks.get(name)?.device.sync.replicate(undefined, { regreet: true });
  }

  /** fieldd restarts on the same data: a new Device on the desk's dataDir. */
  async restart(
    name: string,
    opts: { compaction?: { records: number } | false } = {},
  ): Promise<Desk> {
    const old = this.desks.get(name) as Desk;
    old.device.sync.stop();
    old.device.docs.dispose();
    old.holders.stop();
    await old.library.dispose();
    return this.add(name, { ...opts, dataDir: old.dataDir });
  }

  dispose(): void {
    for (const desk of this.desks.values()) {
      desk.device.sync.stop();
      desk.device.docs.dispose();
      desk.holders.stop();
    }
  }
}

/** A window on `desk` edits the canvas: it reads what is stored, makes one
 * edit, and saves it as an update (declaring the epoch it read). */
async function windowEdit(
  desk: Desk,
  docId: string,
  peer: bigint,
  key: string,
  value: string,
): Promise<void> {
  const docs = desk.device.docs;
  const window = await replay(docs, docId, peer);
  const before = window.doc.oplogVersion();
  window.doc.getMap("board").set(key, value);
  window.doc.commit();
  const bytes = window.doc.export({ mode: "update", from: before });
  await docs.writeDoc(docId, bytes, {
    revisionId: randomUUID(),
    kind: "update",
    baseRevisionId: (await docs.readDocMeta(docId))?.revisionId as string,
    baseEpoch: docs.baseEpochOf(docId) as number,
    engineSchema: 2,
    savedAt: Date.now(),
    byteLength: bytes.byteLength,
  });
}

async function board(desk: Desk, docId: string): Promise<Record<string, unknown> | null> {
  try {
    return (await replay(desk.device.docs, docId)).board();
  } catch {
    return null;
  }
}

/** The root a desk's stored base trims to; {} for a base with whole history. */
async function rootOf(desk: Desk, docId: string): Promise<Record<string, number>> {
  const stored = await desk.device.docs.readDoc(docId);
  const lifted = liftIce1(stored?.bytes as Uint8Array);
  if (!lifted.ok) throw new Error("not liftable");
  const doc = new LoroDoc();
  doc.import(lifted.payload);
  return doc.isShallow() ? json(doc.frontiersToVV(doc.shallowSinceFrontiers())) : {};
}

/** A canvas made on A, with a checkpoint and two edits, held by everyone. */
async function shared(world: World, a: Desk): Promise<string> {
  const { docId } = await a.device.docs.create("board");
  const w = new Renderer(11n);
  w.edit("seed", "A");
  const checkpoint = w.checkpoint();
  await a.device.docs.writeDoc(docId, checkpoint, {
    revisionId: randomUUID(),
    kind: "checkpoint",
    engineSchema: 2,
    savedAt: Date.now(),
    byteLength: checkpoint.byteLength,
  });
  await windowEdit(a, docId, 11n, "one", "1");
  await windowEdit(a, docId, 11n, "two", "2");
  const want = await board(a, docId);
  for (const desk of world.desks.values()) {
    if (world.away.has(desk.name)) continue;
    await until(
      async () => JSON.stringify(await board(desk, docId)) === JSON.stringify(want),
      `${desk.name} to hold the canvas`,
    );
  }
  return docId;
}

async function converged(
  world: World,
  docId: string,
  names: string[],
  label: string,
): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> | null = null;
  await until(async () => {
    const boards = await Promise.all(names.map((n) => board(world.desks.get(n) as Desk, docId)));
    last = boards[0] ?? null;
    return boards.every((b) => b !== null && JSON.stringify(b) === JSON.stringify(boards[0]));
  }, label);
  return last as unknown as Record<string, unknown>;
}

const sorted = (o: Record<string, unknown> | null): string =>
  JSON.stringify(
    Object.fromEntries(Object.entries(o ?? {}).sort(([x], [y]) => x.localeCompare(y))),
  );

describe("DS-5d — compaction across desktops", () => {
  it("A compacts past the threshold; the epoch converges through the library; B, acknowledged above the watermark with an edit of its own at the old epoch, is answered S4 and keeps it", async () => {
    const world = new World();
    const A = await world.add("A", { compaction: { records: 5 } });
    const B = await world.add("B");
    const C = await world.add("C");
    const docId = await shared(world, A);
    await world.publish();
    const acked = versionFromBase64(
      (await B.device.docs.holdings(() => true)).find((h) => h.docId === docId)?.ackVersion ?? "",
    );
    // B makes an edit while A's news cannot reach it — at the OLD epoch.
    world.cuts.add("A>B");
    world.cuts.add("B>A");
    await windowEdit(B, docId, 22n, "b-own", "made at epoch 0");
    // A's window edits on; its fifth record crosses the threshold.
    for (let i = 0; i < 3; i++) await windowEdit(A, docId, 11n, `a${i}`, String(i));
    await until(() => A.device.docs.baseEpochOf(docId) === 1, "A to compact");
    // The trim waited for every known holder: the root is what they acknowledged.
    expect(await rootOf(A, docId)).toEqual(json(acked as VersionVector));
    expect((await A.device.docs.readDoc(docId))?.updates).toEqual([]);
    // The library carries the epoch to C at once…
    await until(() => C.library.get(docId)?.baseEpoch === 1, "the epoch to reach C's library");
    await until(() => C.device.docs.baseEpochOf(docId) === 1, "C to re-bootstrap (S4)");
    // …and to B once the cut heals; B is behind A AND holds an edit A lacks.
    world.heal();
    await until(() => B.device.docs.baseEpochOf(docId) === 1, "B to re-bootstrap (S4)");
    const final = await converged(world, docId, ["A", "B", "C"], "A, B and C to converge");
    expect(final).toMatchObject({
      seed: "A",
      one: "1",
      two: "2",
      a0: "0",
      a2: "2",
      "b-own": "made at epoch 0",
    });
    for (const desk of [A, B, C]) {
      expect(desk.library.get(docId)?.baseEpoch).toBe(1);
      expect(await desk.device.docs.hostVersion(docId)).toMatchObject({ baseEpoch: 1 });
    }
    // After the epoch, edits keep crossing both ways.
    await windowEdit(B, docId, 22n, "after", "the epoch");
    await windowEdit(A, docId, 11n, "and", "back");
    const later = await converged(world, docId, ["A", "B", "C"], "post-epoch edits");
    expect(later).toMatchObject({ after: "the epoch", and: "back" });

    // A restarts: it loads its base and answers a desktop that never held the
    // canvas — A alone, so the answer is the restarted host's.
    await world.restart("A");
    world.cuts.add("B>E");
    world.cuts.add("C>E");
    const E = await world.add("E");
    await until(async () => sorted(await board(E, docId)) === sorted(later), "E to bootstrap");
    expect(E.device.docs.baseEpochOf(docId)).toBe(1);
  });

  it("C, offline through the compaction and remembered, comes back at the older epoch: answered S4, its offline edit survives", async () => {
    const world = new World();
    const A = await world.add("A", { compaction: false });
    const B = await world.add("B");
    const C = await world.add("C");
    const docId = await shared(world, A);
    await world.publish();
    world.leave("C");
    await windowEdit(C, docId, 33n, "c-offline", "made away");
    world.clock.now += 10 * DAY; // away ten days: still waited for
    await windowEdit(A, docId, 11n, "while", "C was away");
    await windowEdit(B, docId, 22n, "b", "too");
    await converged(world, docId, ["A", "B"], "A and B to agree");
    await world.publish();
    const outcome = await A.device.docs.compact(docId);
    expect(outcome).toMatchObject({
      compacted: true,
      baseEpoch: 1,
      counted: ["B", "C"],
      retired: [],
    });
    await until(() => B.device.docs.baseEpochOf(docId) === 1, "B to follow");
    await world.back("C");
    await until(() => C.device.docs.baseEpochOf(docId) === 1, "C to re-bootstrap (S4)");
    const final = await converged(world, docId, ["A", "B", "C"], "all three to converge");
    expect(final).toMatchObject({ "c-offline": "made away", while: "C was away", b: "too" });
  });

  it("D, unseen 31 days, is not waited for: the trim passes it, and when it returns its edit below the trim is the known loss — nothing panics into any host", async () => {
    const world = new World();
    const A = await world.add("A", { compaction: false });
    const B = await world.add("B");
    const D = await world.add("D");
    const docId = await shared(world, A);
    await world.publish();
    world.leave("D");
    await windowEdit(D, docId, 44n, "d-offline", "made a month away");
    world.clock.now += 31 * DAY;
    // What A and B do after D left is history D never saw — made in ONE line
    // (B edits on top of A's edit). Measured: Loro roots a shallow snapshot at
    // the common ancestor of the trim point's heads, so two CONCURRENT heads
    // would pull the root back to the very op D built on, and D's edit would
    // land; one line puts the root above it.
    await windowEdit(A, docId, 11n, "month", "later");
    await until(async () => (await board(B, docId))?.month === "later", "B to hear A");
    await windowEdit(B, docId, 22n, "b", "later too");
    await converged(world, docId, ["A", "B"], "A and B to agree");
    await world.publish();
    const outcome = await A.device.docs.compact(docId);
    expect(outcome).toMatchObject({ compacted: true, counted: ["B"], retired: ["D"] });
    await until(() => B.device.docs.baseEpochOf(docId) === 1, "B to follow");

    await world.back("D");
    await until(() => D.device.docs.baseEpochOf(docId) === 1, "D to re-bootstrap (S4)");
    const final = await converged(
      world,
      docId,
      ["A", "B", "D"],
      "D to converge on the compacted canvas",
    );
    expect(final).toMatchObject({ month: "later", b: "later too" });
    expect(final).not.toHaveProperty("d-offline"); // the known loss (design-06 §4)
    // Every host still answers: the loss panicked nothing into one.
    for (const desk of [A, B, D]) {
      expect(await desk.device.docs.hostVersion(docId)).toMatchObject({ baseEpoch: 1 });
    }
  });

  it("an unmarked cross-epoch checkpoint is still never merged into content (the DS-5c fence)", async () => {
    // S4's answer says it is one; nothing else crosses the boundary.
    const world = new World();
    const A = await world.add("A", { compaction: false });
    const { docId } = await A.device.docs.create("board");
    const here = new Renderer(1n);
    here.edit("mine", "kept");
    const cp = here.checkpoint();
    await A.device.docs.writeDoc(docId, cp, {
      revisionId: randomUUID(),
      kind: "checkpoint",
      engineSchema: 2,
      savedAt: Date.now(),
      byteLength: cp.byteLength,
    });
    const other = new Renderer(2n);
    other.edit("theirs", "elsewhere");
    const outcome = await A.device.docs.applyRemoteRecord(docId, {
      kind: 1,
      meta: { baseEpoch: 1, engineSchema: 2, savedAt: 1 },
      payload: wrapIce1(HEADER, other.doc.export({ mode: "snapshot" })),
    });
    expect(outcome).toEqual({ applied: false, reason: "epoch-mismatch" });
    expect(await board(world.desks.get("A") as Desk, docId)).toEqual({ mine: "kept" });
  });
});
