// C6-3g's demonstration: an edit on A appears on B.
//
// Two complete fieldd doc stacks — real DocumentService, real DocSyncService,
// real records, real journals on real temp dirs — joined by a router that plays
// the part the mesh plays: it mints an inbound lane id on the far side (the
// 2^32 split, as field-native does), announces it, and carries each `send` as
// one record.
//
// WHAT THIS PROVES: everything above the wire. Edits cross, both directions,
// concurrently; each side's stored journal replays to the SAME document; a
// device that starts empty is bootstrapped by its peer; nothing echoes.
//
// WHAT IT DOES NOT: the wire itself. That a lane carries these bytes between
// two machines over a real tailnet is proven by field-native's
// `quic_lane_transport.rs` — two bootstrapped daemons, records across QUIC with
// their boundaries intact. Stating the seam plainly beats a test that implies
// it covered both and covered neither well. The four-process version (two
// fieldds over two real nodes) is the remaining gap, and it is a gap in
// COVERAGE, not in the argument: both halves are proven, at their own seam.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MESHDATA_INBOUND_LANE_ID_BASE } from "@vibefield/contracts";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentService } from "../src/doc-service";
import { DocSyncService, type LaneBytes, type LaneControl, type LaneInfo } from "../src/doc-sync";

let dirs: string[] = [];
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 60));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** One device's end of the plane. */
class Device {
  readonly docs: DocumentService;
  readonly sync: DocSyncService;
  readonly bytes: RoutedBytes;
  readonly control: RoutedControl;

  constructor(
    readonly name: string,
    mesh: Mesh,
    dataDir: string,
  ) {
    this.bytes = new RoutedBytes(name, mesh);
    this.control = new RoutedControl(name, mesh);
    let sync: DocSyncService | undefined;
    this.docs = new DocumentService({ dataDir, onCommit: (c) => sync?.onCommit(c) });
    sync = new DocSyncService({
      docs: this.docs,
      control: this.control,
      bytes: this.bytes,
      peers: async () => mesh.peersOf(name),
    });
    this.sync = sync;
  }
}

/** The part field-native plays: lane ids minted on the receiving side out of
 * the reserved half, an announcement on the control plane, and a byte plane
 * that preserves record boundaries. */
class Mesh {
  readonly devices = new Map<string, Device>();
  /** sender's laneId → receiver's inbound laneId */
  readonly #routes = new Map<string, number>();
  #nextInbound = MESHDATA_INBOUND_LANE_ID_BASE;

  peersOf(name: string): string[] {
    return [...this.devices.keys()].filter((n) => n !== name);
  }

  open(from: string, to: string, laneId: number, docId: string | undefined): void {
    const target = this.devices.get(to);
    if (target === undefined) throw new Error(`no such peer: ${to}`);
    const inboundId = this.#nextInbound++;
    this.#routes.set(`${from}:${laneId}`, inboundId);
    target.control.announce({
      kind: "peerOpened",
      laneId: inboundId,
      peer: from,
      protocol: "doc-sync",
      ...(docId !== undefined ? { docId } : {}),
      inbound: true,
    });
  }

  carry(from: string, to: string, laneId: number, payload: Uint8Array): void {
    const inboundId = this.#routes.get(`${from}:${laneId}`);
    const target = this.devices.get(to);
    if (inboundId === undefined || target === undefined) return;
    // A copy, because the far side is a different device: sharing a buffer
    // across the seam would let one device's storage alias another's.
    target.bytes.deliver(inboundId, payload.slice());
  }
}

class RoutedControl implements LaneControl {
  #emit: ((payload: unknown, kind: "snapshot" | "delta") => void) | null = null;
  /** laneId → peer, so the byte plane knows where a send is bound. */
  readonly routes = new Map<number, string>();

  constructor(
    private readonly self: string,
    private readonly mesh: Mesh,
  ) {}

  async open(req: {
    laneId: number;
    class: "reliable";
    peer: string;
    protocol: "doc-sync";
    docId?: string;
  }): Promise<void> {
    this.routes.set(req.laneId, req.peer);
    this.mesh.open(this.self, req.peer, req.laneId, req.docId);
  }
  async close(laneId: number): Promise<void> {
    this.routes.delete(laneId);
  }
  async subscribe(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ lanes: LaneInfo[] }> {
    this.#emit = onEvent;
    return { lanes: [] };
  }
  announce(payload: unknown): void {
    this.#emit?.(payload, "delta");
  }
}

class RoutedBytes implements LaneBytes {
  readonly #handlers = new Map<number, (payload: Uint8Array) => void>();

  constructor(
    private readonly self: string,
    private readonly mesh: Mesh,
  ) {}

  send(laneId: number, payload: Uint8Array): boolean {
    const device = this.mesh.devices.get(this.self);
    const peer = device?.control.routes.get(laneId);
    if (peer !== undefined) this.mesh.carry(this.self, peer, laneId, payload);
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
}

const EMPTY_VERSION = new LoroDoc().version();

function ice1(): Uint8Array {
  return new Uint8Array([0x49, 0x43, 0x45, 0x31, ...new TextEncoder().encode("board")]);
}

function edit(peerId: bigint, key: string, value: string): Uint8Array {
  const doc = new LoroDoc();
  doc.setPeerId(peerId);
  doc.getMap("board").set(key, value);
  doc.commit();
  return doc.export({ mode: "update", from: EMPTY_VERSION });
}

/** Replay a device's stored doc the way its renderer would. */
async function board(device: Device, docId: string): Promise<Record<string, unknown>> {
  const stored = await device.docs.readDoc(docId);
  const doc = new LoroDoc();
  doc.setPeerId(99n);
  for (const update of stored?.updates ?? []) doc.import(update);
  return (doc.toJSON().board ?? {}) as Record<string, unknown>;
}

async function saveEdit(
  device: Device,
  docId: string,
  peerId: bigint,
  key: string,
  value: string,
): Promise<void> {
  const payload = edit(peerId, key, value);
  await device.docs.writeDoc(docId, payload, {
    revisionId: randomUUID(),
    kind: "update",
    baseRevisionId: (await device.docs.readDocMeta(docId))?.revisionId,
    engineSchema: 11,
    savedAt: Date.now(),
    byteLength: payload.byteLength,
  });
}

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

/** Both devices already know the doc EXISTS, with the same id and no content.
 *
 * That is not a convenience — it is the real starting state. `field.docs.v1` is
 * a SyncedStore slice, so doc existence already replicates across devices;
 * C6-3 is what adds content. Seeding the catalog on disk is how a peer looks
 * the moment the registry has reached it and no bytes have. */
async function twoDevices(): Promise<{ a: Device; b: Device; docId: string }> {
  const mesh = new Mesh();
  const docId = randomUUID();
  const devices: Device[] = [];
  for (const name of ["A", "B"]) {
    const dataDir = mkdtempSync(join(tmpdir(), `vf-conv-${name}-`));
    dirs.push(dataDir);
    mkdirSync(join(dataDir, "registries"), { recursive: true });
    mkdirSync(join(dataDir, "docs", docId), { recursive: true });
    writeFileSync(
      join(dataDir, "registries", "field.docs.v1.json"),
      JSON.stringify([
        { docId, name: "board", updatedAt: 1, baseEpoch: 0, engineSchema: null, sizeBytes: 0 },
      ]),
    );
    devices.push(new Device(name, mesh, dataDir));
  }
  const [a, b] = devices as [Device, Device];
  mesh.devices.set("A", a);
  mesh.devices.set("B", b);
  await a.sync.start();
  await b.sync.start();
  return { a, b, docId };
}

describe("two devices, one document", () => {
  it("an edit on A appears on B", async () => {
    // THE DEMONSTRATION §4 asked for.
    const { a, b, docId } = await twoDevices();
    await a.docs.writeDoc(docId, ice1(), {
      revisionId: randomUUID(),
      kind: "checkpoint",
      engineSchema: 11,
      savedAt: 1,
      byteLength: ice1().byteLength,
    });
    await saveEdit(a, docId, 1n, "fromA", "alpha");

    await until(async () => "fromA" in (await board(b, docId)), "A's edit to reach B");
    expect(await board(b, docId)).toEqual({ fromA: "alpha" });
  });

  it("converges when both devices edit", async () => {
    const { a, b, docId } = await twoDevices();
    await a.docs.writeDoc(docId, ice1(), {
      revisionId: randomUUID(),
      kind: "checkpoint",
      engineSchema: 11,
      savedAt: 1,
      byteLength: ice1().byteLength,
    });
    await until(async () => (await b.docs.readDoc(docId)) !== null, "B to be bootstrapped");

    await saveEdit(a, docId, 1n, "fromA", "alpha");
    await saveEdit(b, docId, 2n, "fromB", "beta");

    const both = { fromA: "alpha", fromB: "beta" };
    await until(async () => "fromB" in (await board(a, docId)), "B's edit to reach A");
    await until(async () => "fromA" in (await board(b, docId)), "A's edit to reach B");
    expect(await board(a, docId)).toEqual(both);
    expect(await board(b, docId)).toEqual(both);
  });

  it("converges on concurrent edits to the same key", async () => {
    // Loro's LWW by peer id decides, and both devices must decide the SAME way
    // — the property that makes an opaque byte ferry correct at all.
    const { a, b, docId } = await twoDevices();
    await a.docs.writeDoc(docId, ice1(), {
      revisionId: randomUUID(),
      kind: "checkpoint",
      engineSchema: 11,
      savedAt: 1,
      byteLength: ice1().byteLength,
    });
    await until(async () => (await b.docs.readDoc(docId)) !== null, "B to be bootstrapped");

    await Promise.all([
      saveEdit(a, docId, 1n, "contested", "from-A"),
      saveEdit(b, docId, 2n, "contested", "from-B"),
    ]);
    await until(
      async () => (await board(a, docId)).contested === (await board(b, docId)).contested,
      "the two devices to agree",
    );
    const settled = (await board(a, docId)).contested;
    expect(settled).toBeDefined();
    expect((await board(b, docId)).contested).toBe(settled);
  });

  it("bootstraps a device that has no content at all", async () => {
    const { a, b, docId } = await twoDevices();
    expect(await b.docs.readDoc(docId)).toBeNull();
    await a.docs.writeDoc(docId, ice1(), {
      revisionId: randomUUID(),
      kind: "checkpoint",
      engineSchema: 11,
      savedAt: 1,
      byteLength: ice1().byteLength,
    });
    await until(async () => (await b.docs.readDoc(docId)) !== null, "the bootstrap to land");
    const stored = await b.docs.readDoc(docId);
    expect([...(stored?.bytes ?? [])]).toEqual([...ice1()]);
  });

  it("settles instead of echoing forever", async () => {
    // Two devices that re-broadcast what they receive converge immediately and
    // then never stop. The observable difference is that traffic STOPS.
    const { a, b, docId } = await twoDevices();
    await a.docs.writeDoc(docId, ice1(), {
      revisionId: randomUUID(),
      kind: "checkpoint",
      engineSchema: 11,
      savedAt: 1,
      byteLength: ice1().byteLength,
    });
    await saveEdit(a, docId, 1n, "fromA", "alpha");
    await until(async () => "fromA" in (await board(b, docId)), "the edit to arrive");

    const journalAfterArrival = (await b.docs.readDoc(docId))?.updates.length ?? 0;
    await new Promise((r) => setTimeout(r, 200));
    expect((await b.docs.readDoc(docId))?.updates.length).toBe(journalAfterArrival);
    expect((await a.docs.readDoc(docId))?.updates.length).toBe(1);
  });
});
