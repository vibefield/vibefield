// B3 DocumentService + the :9411 doc lane, against the mock mgmt server (no cargo):
// the create/list/open catalog over the product WS, the ticketed binary lane
// (garbage/replay/expiry rejection, PUT→GET round-trips, the single-writer lock,
// truncated/non-ICE1 rejection), and THE restart test — the P0 exit criterion.
import { randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  DOC_SYNC_RECORD,
  type DocOpenResult,
  DocRegistryEntry,
  decodeJsonPayload,
  decodeLaneFrame,
  encodeJsonFrame,
  encodeLaneFrame,
  encodeMeshDataFrame,
  LANE_FRAME,
  LaneErr,
  type LaneFrame,
  LaneHelloOk,
  LanePutOk,
  MESHDATA_FRAME,
  MeshDataFrameReader,
  type Scope,
  SOCKETS,
} from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, DocumentService, type FielddDaemon, verifyAuditSegment } from "../src/index";
import { systemAccount, systemDocId } from "../src/library-doc";
import { computeAckMac } from "../src/pairing";
import { SettingsDocService } from "../src/settings-doc";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup(): Promise<{ dataDir: string; daemon: FielddDaemon }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-doc-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return { dataDir, daemon };
}

async function productRpc(daemon: FielddDaemon, token = daemon.shellToken): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, token);
  return rpc;
}

/** Raw lane client: sends frames, logs every reply in order, exposes close. */
class LaneProbe {
  log: LaneFrame[] = [];
  closed = false;
  closeCode: number | null = null;
  private cursor = 0;
  private waiters: Array<(f: LaneFrame) => void> = [];

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      let frame: LaneFrame;
      try {
        frame = decodeLaneFrame(toU8(data));
      } catch {
        return; // structural garbage never reaches a waiter
      }
      this.log.push(frame);
      const w = this.waiters.shift();
      if (w) w(frame);
    });
    ws.on("close", (code: number) => {
      this.closed = true;
      this.closeCode = code;
    });
  }

  send(frame: Uint8Array): void {
    this.ws.send(frame);
  }

  /** Next unconsumed reply frame (FIFO), or rejects on timeout. */
  next(timeoutMs = 2000): Promise<LaneFrame> {
    if (this.cursor < this.log.length) return Promise.resolve(this.log[this.cursor++]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("lane frame timeout")), timeoutMs);
      this.waiters.push((f) => {
        clearTimeout(timer);
        this.cursor++;
        resolve(f);
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

function toU8(data: unknown): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data as Buffer[]));
  return new Uint8Array(data as ArrayBuffer);
}

async function dialLane(laneUrl: string): Promise<LaneProbe> {
  const ws = new WebSocket(laneUrl);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new LaneProbe(ws);
}

/** doc.open, retrying while a just-closed writer's lane is still detaching. */
async function openDoc(rpc: WsRpc, docId: string): Promise<DocOpenResult> {
  for (let i = 0; i < 40; i++) {
    try {
      return (await rpc.call("doc.open", { docId })) as DocOpenResult;
    } catch (e) {
      if ((e as { rpc?: { data?: { kind?: string } } }).rpc?.data?.kind === "PRECONDITION_FAILED") {
        await sleep(25);
        continue;
      }
      throw e;
    }
  }
  throw new Error("doc.open never cleared the single-writer lock");
}

/** Open + dial + HELLO; asserts HELLO_OK and returns the parsed ack. */
async function attach(rpc: WsRpc, docId: string): Promise<{ probe: LaneProbe; ok: LaneHelloOk }> {
  const open = await openDoc(rpc, docId);
  const probe = await dialLane(open.laneUrl);
  probe.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open.ticket }));
  const reply = await probe.next();
  expect(reply.kind).toBe(LANE_FRAME.HELLO_OK);
  return { probe, ok: LaneHelloOk.parse(decodeJsonPayload(reply.payload)) };
}

/** Synthetic ICE1 envelope: the "ICE1" magic + n random bytes fieldd never decodes. */
function ice1Envelope(n = 320): Uint8Array {
  const env = new Uint8Array(4 + n);
  env.set([0x49, 0x43, 0x45, 0x31], 0);
  env.set(randomBytes(n), 4);
  return env;
}

async function putEnvelope(
  probe: LaneProbe,
  env: Uint8Array,
  engineSchema = 7,
): Promise<LanePutOk> {
  probe.send(
    encodeJsonFrame(LANE_FRAME.PUT_META, 0, {
      engineSchema,
      revisionId: randomUUID(),
      savedAt: Date.now(),
      byteLength: env.byteLength,
    }),
  );
  probe.send(encodeLaneFrame(LANE_FRAME.PUT, 0, env));
  const reply = await probe.next();
  expect(reply.kind).toBe(LANE_FRAME.PUT_OK);
  return LanePutOk.parse(decodeJsonPayload(reply.payload));
}

async function putUpdate(
  probe: LaneProbe,
  update: Uint8Array,
  baseRevisionId: string,
  engineSchema = 7,
): Promise<LanePutOk> {
  probe.send(
    encodeJsonFrame(LANE_FRAME.PUT_META, 0, {
      kind: "update",
      baseRevisionId,
      engineSchema,
      revisionId: randomUUID(),
      savedAt: Date.now(),
      byteLength: update.byteLength,
    }),
  );
  probe.send(encodeLaneFrame(LANE_FRAME.PUT, 0, update));
  const reply = await probe.next();
  expect(reply.kind).toBe(LANE_FRAME.PUT_OK);
  return LanePutOk.parse(decodeJsonPayload(reply.payload));
}

describe("doc.* catalog (product WS)", () => {
  it("create → list → open returns a valid entry, ticket, and the real bound laneUrl", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);

    const created = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    const parsed = DocRegistryEntry.safeParse(created);
    expect(parsed.success).toBe(true);
    expect(created.name).toBe("Board");
    expect(created.baseEpoch).toBe(0);
    expect(created.engineSchema).toBeNull();
    expect(created.sizeBytes).toBe(0);
    expect(Number.isInteger(created.updatedAt)).toBe(true);

    const listed = (await rpc.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    expect(listed.docs.map((d) => d.docId)).toContain(created.docId);

    const open = (await rpc.call("doc.open", { docId: created.docId })) as DocOpenResult;
    expect(open.docId).toBe(created.docId);
    expect(open.laneUrl).toBe(`ws://127.0.0.1:${daemon.dataPort}`);
    expect(typeof open.ticket).toBe("string");
    expect(open.ticket.length).toBeGreaterThan(20);
    expect(open.hasDoc).toBe(false);
  });

  it("health carries a docs row that tracks docCount", async () => {
    const { daemon } = await setup();
    expect(daemon.health().docs).toEqual({ state: "ready", docCount: 0 });
    const rpc = await productRpc(daemon);
    await rpc.call("doc.create", { name: "One" });
    await rpc.call("doc.create", { name: "Two" });
    expect(daemon.health().docs).toEqual({ state: "ready", docCount: 2 });
  });
});

describe("doc.* scope enforcement (EL7)", () => {
  it("doc.create needs doc.write and doc.list needs doc.read", async () => {
    const { daemon } = await setup();

    const reader = await productRpc(daemon, daemon.tokens.mint(["doc.read"], "reader").token);
    const createDenied = await reader.callErr("doc.create", { name: "nope" });
    expect(createDenied.data?.kind).toBe("FORBIDDEN_SCOPE");

    const writer = await productRpc(daemon, daemon.tokens.mint(["doc.write"], "writer").token);
    const listDenied = await writer.callErr("doc.list", {});
    expect(listDenied.data?.kind).toBe("FORBIDDEN_SCOPE");
    // …but the writer can create + open (positive control for the scope gate)
    const made = (await writer.call("doc.create", { name: "ok" })) as DocRegistryEntry;
    expect((await writer.call("doc.open", { docId: made.docId })) as DocOpenResult).toBeTruthy();
  });
});

describe("lane ticket security", () => {
  it("a garbage ticket HELLO is dropped without a HELLO_OK", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    const open = (await rpc.call("doc.open", { docId: made.docId })) as DocOpenResult;

    const probe = await dialLane(open.laneUrl);
    probe.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: "not-a-real-ticket" }));
    await until(() => probe.closed);
    expect(probe.log.some((f) => f.kind === LANE_FRAME.HELLO_OK)).toBe(false);
  });

  it("a ticket is one-shot — a second socket with the same ticket is dropped", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    const open = (await rpc.call("doc.open", { docId: made.docId })) as DocOpenResult;

    const a = await dialLane(open.laneUrl);
    a.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open.ticket }));
    expect((await a.next()).kind).toBe(LANE_FRAME.HELLO_OK);

    const b = await dialLane(open.laneUrl);
    b.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open.ticket }));
    await until(() => b.closed);
    expect(b.log.some((f) => f.kind === LANE_FRAME.HELLO_OK)).toBe(false);
  });

  it("a busy writer's second ticket is refused with LaneErr PRECONDITION_FAILED", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    // two live tickets minted before either redeems (no writer yet)
    const open1 = (await rpc.call("doc.open", { docId: made.docId })) as DocOpenResult;
    const open2 = (await rpc.call("doc.open", { docId: made.docId })) as DocOpenResult;

    const a = await dialLane(open1.laneUrl);
    a.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open1.ticket }));
    expect((await a.next()).kind).toBe(LANE_FRAME.HELLO_OK);

    const b = await dialLane(open2.laneUrl);
    b.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open2.ticket }));
    const reply = await b.next();
    expect(reply.kind).toBe(LANE_FRAME.ERR);
    expect(LaneErr.parse(decodeJsonPayload(reply.payload)).kind).toBe("PRECONDITION_FAILED");
    await until(() => b.closed);
  });

  it("expired and replayed tickets fail at the service (injected clock)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-doc-unit-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    let clock = 1_000_000;
    const svc = new DocumentService({ dataDir: dir, now: () => clock, ticketTtlMs: 30_000 });
    cleanup.push(() => svc.dispose());
    const doc = await svc.create("Unit");

    const expiring = svc.open(doc.docId).ticket;
    clock += 30_001; // past TTL
    expect(svc.redeemTicket(expiring)).toEqual({ ok: false, reason: "invalid" });

    const fresh = svc.open(doc.docId).ticket;
    expect(svc.redeemTicket(fresh)).toEqual({ ok: true, docId: doc.docId });
    expect(svc.redeemTicket(fresh)).toEqual({ ok: false, reason: "invalid" }); // one-shot
    expect(svc.redeemTicket("garbage")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("lane PUT / GET", () => {
  it("PUT then GET on a fresh lane returns byte-identical bytes; registry updates", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const env = ice1Envelope();
    const w = await attach(rpc, made.docId);
    expect(w.ok.hasDoc).toBe(false);
    const putOk = await putEnvelope(w.probe, env, 11);
    expect(putOk.byteLength).toBe(env.byteLength);
    w.probe.close();

    // a genuinely fresh lane (writer detached) sees hasDoc + returns the bytes
    const r = await attach(rpc, made.docId);
    expect(r.ok.hasDoc).toBe(true);
    r.probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
    const doc = await r.probe.next();
    expect(doc.kind).toBe(LANE_FRAME.DOC);
    expect(Buffer.from(doc.payload).equals(Buffer.from(env))).toBe(true);

    const listed = (await rpc.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    const entry = listed.docs.find((d) => d.docId === made.docId)!;
    expect(entry.sizeBytes).toBe(env.byteLength);
    expect(entry.engineSchema).toBe(11);
    expect(entry.updatedAt).toBeGreaterThanOrEqual(made.updatedAt);

    const currentPath = join(dataDir, "docs", made.docId, "current.json");
    const current = JSON.parse(readFileSync(currentPath, "utf8")) as {
      revisionId: string;
      file: string;
      byteLength: number;
    };
    expect(current.file).toBe(`${current.revisionId}.ice1`);
    expect(current.revisionId).toBe(putOk.revisionId);
    expect(current.byteLength).toBe(env.byteLength);
    expect(existsSync(join(dataDir, "docs", made.docId, "revisions", current.file))).toBe(true);
  });

  it("replays ordered updates and a later checkpoint atomically compacts them", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Journal" })) as DocRegistryEntry;
    const base = ice1Envelope(128);
    const update = new Uint8Array(randomBytes(48));
    const writer = await attach(rpc, made.docId);
    const checkpoint = await putEnvelope(writer.probe, base, 11);
    const appended = await putUpdate(writer.probe, update, checkpoint.revisionId, 11);
    writer.probe.close();

    const reader = await attach(rpc, made.docId);
    expect(reader.ok.meta?.revisionId).toBe(appended.revisionId);
    expect(reader.ok.meta?.journalEntries).toBe(1);
    reader.probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
    const doc = await reader.probe.next();
    const journal = await reader.probe.next();
    expect(doc.kind).toBe(LANE_FRAME.DOC);
    expect(Buffer.from(doc.payload).equals(Buffer.from(base))).toBe(true);
    expect(journal.kind).toBe(LANE_FRAME.DOC_UPDATE);
    expect(Buffer.from(journal.payload).equals(Buffer.from(update))).toBe(true);

    const listed = (await rpc.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    expect(listed.docs.find((entry) => entry.docId === made.docId)?.sizeBytes).toBe(
      base.byteLength + update.byteLength,
    );

    const compacted = ice1Envelope(192);
    const compactedRevision = await putEnvelope(reader.probe, compacted, 11);
    const current = JSON.parse(
      readFileSync(join(dataDir, "docs", made.docId, "current.json"), "utf8"),
    ) as { revisionId: string; file: string; updates: unknown[] };
    expect(current.revisionId).toBe(compactedRevision.revisionId);
    expect(current.file).toBe(`${compactedRevision.revisionId}.ice1`);
    expect(current.updates).toEqual([]);
  });

  it("RESTART: put → stop → re-bootstrap same dataDir → list + GET survive", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    const env = ice1Envelope(512);
    const w = await attach(rpc, made.docId);
    await putEnvelope(w.probe, env);
    w.probe.close();

    await daemon.stop();

    const daemon2 = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon2.stop());
    const rpc2 = await productRpc(daemon2);

    const listed = (await rpc2.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    const survivor = listed.docs.find((d) => d.docId === made.docId);
    expect(survivor).toBeTruthy();
    expect(survivor!.sizeBytes).toBe(env.byteLength);

    const r = await attach(rpc2, made.docId);
    expect(r.ok.hasDoc).toBe(true);
    r.probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
    const doc = await r.probe.next();
    expect(doc.kind).toBe(LANE_FRAME.DOC);
    expect(Buffer.from(doc.payload).equals(Buffer.from(env))).toBe(true);
  });
});

describe("lane single-writer lock", () => {
  it("doc.open is refused while a writer holds the lane, then succeeds after it closes", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const held = await attach(rpc, made.docId);
    const denied = await rpc.callErr("doc.open", { docId: made.docId });
    expect(denied.data?.kind).toBe("PRECONDITION_FAILED");

    held.probe.close();
    // after the writer detaches, a fresh open is admitted again
    const reopened = await openDoc(rpc, made.docId);
    expect(reopened.docId).toBe(made.docId);
  });
});

describe("lane write validation (leaves prior bytes untouched)", () => {
  it("a byteLength-mismatched PUT is rejected and the prior snapshot is intact", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const good = ice1Envelope(256);
    const w = await attach(rpc, made.docId);
    await putEnvelope(w.probe, good);

    // PUT_META claims one length; the PUT body is a different length → rejected
    w.probe.send(
      encodeJsonFrame(LANE_FRAME.PUT_META, 0, {
        engineSchema: 1,
        revisionId: randomUUID(),
        savedAt: Date.now(),
        byteLength: good.byteLength,
      }),
    );
    w.probe.send(encodeLaneFrame(LANE_FRAME.PUT, 0, ice1Envelope(64)));
    const err = await w.probe.next();
    expect(err.kind).toBe(LANE_FRAME.ERR);
    expect(LaneErr.parse(decodeJsonPayload(err.payload)).kind).toBe("PRECONDITION_FAILED");

    // GET still returns the earlier good bytes; no tmp debris was left behind
    w.probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
    const doc = await w.probe.next();
    expect(doc.kind).toBe(LANE_FRAME.DOC);
    expect(Buffer.from(doc.payload).equals(Buffer.from(good))).toBe(true);

    const debris = readdirSync(join(dataDir, "docs", made.docId)).filter((n) =>
      n.startsWith("snapshot.ice1.tmp"),
    );
    expect(debris).toEqual([]);
  });

  it("a payload without the ICE1 magic is rejected and nothing is persisted", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const notIce1 = new Uint8Array(128); // all zeros, byteLength matches the meta
    const w = await attach(rpc, made.docId);
    w.probe.send(
      encodeJsonFrame(LANE_FRAME.PUT_META, 0, {
        engineSchema: null,
        revisionId: randomUUID(),
        savedAt: Date.now(),
        byteLength: notIce1.byteLength,
      }),
    );
    w.probe.send(encodeLaneFrame(LANE_FRAME.PUT, 0, notIce1));
    const err = await w.probe.next();
    expect(err.kind).toBe(LANE_FRAME.ERR);
    expect(LaneErr.parse(decodeJsonPayload(err.payload)).kind).toBe("PRECONDITION_FAILED");

    w.probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
    const reply = await w.probe.next();
    expect(reply.kind).toBe(LANE_FRAME.ERR);
    expect(LaneErr.parse(decodeJsonPayload(reply.payload)).kind).toBe("NOT_FOUND");
    expect(existsSync(join(dataDir, "docs", made.docId, "snapshot.ice1"))).toBe(false);
    expect(await daemon.docs.readDoc(made.docId)).toBeNull();
  });
});

describe("doc.rename (product WS)", () => {
  it("renames a doc and doc.list reflects the new name", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const renamed = (await rpc.call("doc.rename", {
      docId: made.docId,
      name: "Field Notes",
    })) as DocRegistryEntry;
    expect(DocRegistryEntry.safeParse(renamed).success).toBe(true);
    expect(renamed.name).toBe("Field Notes");

    const listed = (await rpc.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    expect(listed.docs.find((d) => d.docId === made.docId)!.name).toBe("Field Notes");
  });

  it("does NOT bump updatedAt (recency is content, not the label)", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const renamed = (await rpc.call("doc.rename", {
      docId: made.docId,
      name: "Renamed",
    })) as DocRegistryEntry;
    expect(renamed.updatedAt).toBe(made.updatedAt);
  });

  it("an unknown docId is NOT_FOUND", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const err = await rpc.callErr("doc.rename", { docId: randomUUID(), name: "ghost" });
    expect(err.data?.kind).toBe("NOT_FOUND");
  });

  it("a token without doc.write is FORBIDDEN_SCOPE", async () => {
    const { daemon } = await setup();
    const owner = await productRpc(daemon);
    const made = (await owner.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const reader = await productRpc(daemon, daemon.tokens.mint(["doc.read"], "reader").token);
    const denied = await reader.callErr("doc.rename", { docId: made.docId, name: "nope" });
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("RESTART: a renamed name survives stop + re-bootstrap on the same dataDir", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    await rpc.call("doc.rename", { docId: made.docId, name: "Persisted" });

    await daemon.stop();

    const daemon2 = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon2.stop());
    const rpc2 = await productRpc(daemon2);
    const listed = (await rpc2.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    expect(listed.docs.find((d) => d.docId === made.docId)?.name).toBe("Persisted");
  });
});

describe("doc.delete (DS-5, product WS)", () => {
  it("tombstones the canvas: gone from doc.list, refused by doc.open, NOT_FOUND twice", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const kept = (await rpc.call("doc.create", { name: "Kept" })) as DocRegistryEntry;
    const made = (await rpc.call("doc.create", { name: "Doomed" })) as DocRegistryEntry;
    const gone = (await rpc.call("doc.delete", { docId: made.docId })) as DocRegistryEntry;
    expect(DocRegistryEntry.safeParse(gone).success).toBe(true);
    expect(gone.deletedAt).toBeGreaterThan(0);
    const listed = (await rpc.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    expect(listed.docs.map((d) => d.docId)).toContain(kept.docId);
    expect(listed.docs.map((d) => d.docId)).not.toContain(made.docId);
    expect((await rpc.callErr("doc.open", { docId: made.docId })).data?.kind).toBe("NOT_FOUND");
    expect((await rpc.callErr("doc.delete", { docId: made.docId })).data?.kind).toBe("NOT_FOUND");
  });

  it("a token without doc.write is FORBIDDEN_SCOPE", async () => {
    const { daemon } = await setup();
    const owner = await productRpc(daemon);
    const made = (await owner.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    const reader = await productRpc(daemon, daemon.tokens.mint(["doc.read"], "reader").token);
    expect((await reader.callErr("doc.delete", { docId: made.docId })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
  });
});

describe("doc.setSyncIntent (UA-D7)", () => {
  it("records the intent on the entry and hands it back through doc.list", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Journal" })) as DocRegistryEntry;
    // Absent, not "sync": silence is what defers to the posture, and a doc that
    // was never asked must stay distinguishable from one that answered.
    expect(made.syncIntent).toBeUndefined();

    const gated = (await rpc.call("doc.setSyncIntent", {
      docId: made.docId,
      intent: "local",
    })) as DocRegistryEntry;
    expect(DocRegistryEntry.safeParse(gated).success).toBe(true);
    expect(gated.syncIntent).toBe("local");
    // A posture edit, exactly like rename: the explorer sorts on updatedAt and
    // must not reorder because someone chose where a doc lives.
    expect(gated.updatedAt).toBe(made.updatedAt);

    const listed = (await rpc.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    expect(listed.docs.find((d) => d.docId === made.docId)?.syncIntent).toBe("local");
  });

  it("refuses an unknown doc, and a word that is not an intent", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Journal" })) as DocRegistryEntry;
    const ghost = await rpc.callErr("doc.setSyncIntent", {
      docId: randomUUID(),
      intent: "local",
    });
    expect(ghost.data?.kind).toBe("NOT_FOUND");
    const nonsense = await rpc.callErr("doc.setSyncIntent", {
      docId: made.docId,
      intent: "maybe",
    });
    expect(nonsense.data?.kind).toBe("PRECONDITION_FAILED");
  });

  it("a token without doc.write is FORBIDDEN_SCOPE", async () => {
    const { daemon } = await setup();
    const owner = await productRpc(daemon);
    const made = (await owner.call("doc.create", { name: "Journal" })) as DocRegistryEntry;

    const reader = await productRpc(daemon, daemon.tokens.mint(["doc.read"], "reader").token);
    const denied = await reader.callErr("doc.setSyncIntent", {
      docId: made.docId,
      intent: "local",
    });
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("RESTART: the intent survives stop + re-bootstrap on the same dataDir", async () => {
    // The gates consult this on every decision, so the registry FILE is the
    // answer that matters: a doc told to stay home must not rejoin the mesh
    // because the daemon was restarted underneath it.
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Journal" })) as DocRegistryEntry;
    await rpc.call("doc.setSyncIntent", { docId: made.docId, intent: "local" });

    await daemon.stop();

    const daemon2 = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon2.stop());
    const rpc2 = await productRpc(daemon2);
    const listed = (await rpc2.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    expect(listed.docs.find((d) => d.docId === made.docId)?.syncIntent).toBe("local");
  });

  it("is not undone by a save that was already in flight", async () => {
    // Found landing UA-6. A commit captured the registry entry, did its I/O,
    // then spread the CAPTURED copy back on completion — so choosing "keep this
    // local" mid-save was silently reverted and the doc went on syncing. Rename
    // had the same hole; nothing had ever raced it.
    const dataDir = mkdtempSync(join(tmpdir(), "vf-doc-intent-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const docs = new DocumentService({ dataDir });
    const entry = await docs.create("Journal");
    const bytes = new Uint8Array([0x49, 0x43, 0x45, 0x31, 7, 7, 7]);

    const saving = docs.writeDoc(entry.docId, bytes, {
      revisionId: randomUUID(),
      kind: "checkpoint",
      engineSchema: 11,
      savedAt: 1,
      byteLength: bytes.byteLength,
    });
    // Inside the write's I/O window on purpose — past the point where it reads
    // the entry, before the point where it writes one back. Setting the intent
    // before that capture proves nothing; this is the ordering that bit.
    await sleep(2);
    await docs.setSyncIntent(entry.docId, "local");
    await saving;

    expect(docs.syncIntentOf(entry.docId)).toBe("local");
    // …and durably, not merely in memory: a restart reads the file.
    const reloaded = new DocumentService({ dataDir });
    expect(reloaded.syncIntentOf(entry.docId)).toBe("local");
  });
});

// DS landing review B1 (2026-10-01) held the settings document OFF the Loro
// host until PA-32's revocation bias was the merge rule inside the install
// reconciler (design-06 §4). DS-5b 2026-10-01: the bias is built; settings
// cross. A linked daemon with a docHost peer replicates its system documents
// the moment the roster names that peer; the witness is the floor's own record
// of the lanes it was asked for (`meshLaneOpens`) — a lane IS the
// announcement: the library's and the settings document's both open toward
// the peer.
describe("the system documents a linked desktop hosts (DS-5, DS-5b)", () => {
  /** The meshdata bridge field-native would be: it accepts fieldd's HELLO and
   * proves the pairing secret (WIN-10), so the daemon's doc sync starts. */
  async function meshDataBridge(dataDir: string): Promise<void> {
    const secretHex = "ab".repeat(32);
    const sockets: Socket[] = [];
    const server = createServer((sock) => {
      sockets.push(sock);
      const reader = new MeshDataFrameReader();
      sock.on("data", (chunk: Buffer) => {
        for (const frame of reader.push(new Uint8Array(chunk))) {
          if (frame.kind !== MESHDATA_FRAME.HELLO) continue;
          const hello = JSON.parse(new TextDecoder().decode(frame.payload)) as {
            bootId: string;
            nonce: string;
          };
          const proof = { serverMac: computeAckMac(secretHex, hello.nonce, hello.bootId) };
          sock.write(
            encodeMeshDataFrame(
              MESHDATA_FRAME.HELLO_OK,
              0,
              new TextEncoder().encode(JSON.stringify(proof)),
            ),
          );
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(nativeEndpoint(dataDir, SOCKETS.MESHDATA), resolve),
    );
    cleanup.push(() => {
      for (const sock of sockets) sock.destroy();
      server.close();
    });
  }

  it("hosts the library AND the settings document — both announced to a docHost peer", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-doc-sys-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    writeLinkFixture(dataDir); // a linked account: its system documents sync
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    mock.meshDeviceId = "dev-a";
    // one self desktop beside this one: the tailnet names it this account's…
    mock.meshPeers = [
      {
        id: "node-b",
        deviceId: "dev-b",
        name: "desk-b",
        online: true,
        whois: { login: TEST_LOGIN, deviceName: "desk-b.tailnet.ts.net" },
      },
    ];
    // …and its slice says docHost, DS-D7's desktop test
    mock.storeSlices.set("dev-b", {
      deviceId: "dev-b",
      name: "desk-b",
      platform: "darwin",
      headless: false,
      fielddVersion: "0.1.0",
      contractsVersion: CONTRACTS_VERSION,
      capabilities: { terminalHost: true, docHost: true, push: false },
      bootId: "boot-b",
      publishedAt: Date.now(),
    });
    await mock.start();
    cleanup.push(() => mock.stop());
    await meshDataBridge(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const account = systemAccount(TEST_LOGIN, undefined);
    const libraryId = systemDocId("library", account);
    const settingsId = systemDocId("settings", account);
    await until(() => daemon.docs.systemDocIds().includes(libraryId), 8000);
    expect([...daemon.docs.systemDocIds()].sort()).toEqual([libraryId, settingsId].sort());
    expect(daemon.docs.isSystemDoc(settingsId)).toBe(true);

    // The replication pass ran toward the peer: a lane was asked for for each.
    const announced = (docId: string) =>
      mock.meshLaneOpens.some(
        (lane) => lane.protocol === "doc-sync" && lane.peer === "node-b" && lane.docId === docId,
      );
    await until(() => announced(libraryId) && announced(settingsId), 8000);
  }, 30_000);
});

// DS-5b (PA-32) — a peer desktop's settings on THIS daemon's host. The peer is
// a SettingsDocService on its own disk, registered with its own
// DocumentService under the account's settings id (what another desktop's
// mountSystemDocs registers). A reconnect is the doc-sync VERSION exchange
// against the daemon's own host: the receiver states its version
// (`hostVersion`), the sender answers what it lacks (`hostAnswer`), and the
// receiver's host merges it (`applyRemoteRecord`) — the entry points the
// doc-sync lane drives, here without the lane.
describe("a peer desktop's settings on the daemon's host (DS-5b, PA-32)", () => {
  const FIXTURE_ID = "vibefield.fixture.pa32";
  // Unlinked: the account is this user root's own (`local:default`).
  const SETTINGS_ID = systemDocId("settings", systemAccount(null, undefined));

  /** A daemon with one bundled renderer plugin requesting two capabilities
   * (renderer-eligible, so both are granted by default). */
  async function bootWithFixture(): Promise<{ dataDir: string; daemon: FielddDaemon }> {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-doc-pa32-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const root = join(dataDir, "bundled");
    mkdirSync(join(root, "pa32"), { recursive: true });
    writeFileSync(join(root, "pa32", "renderer.js"), "export default {};\n");
    writeFileSync(
      join(root, "pa32", "vibefield.plugin.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: FIXTURE_ID,
        version: "1.0.0",
        title: "PA-32 fixture",
        engines: { app: "*", contracts: "*" },
        entries: { renderer: "./renderer.js" },
        activation: [],
        capabilities: ["storage.self", "canvas.read"],
      }),
    );
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const daemon = await bootstrap({
      dataDir,
      controlPort: 0,
      dataPort: 0,
      pluginRoots: { bundled: [root] },
    });
    cleanup.push(() => daemon.stop());
    return { dataDir, daemon };
  }

  /** Another desktop of this account: its settings, on its own host. */
  async function peerDesktop(): Promise<{ settings: SettingsDocService; docs: DocumentService }> {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-doc-pa32-peer-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const settings = new SettingsDocService({ dataDir });
    await settings.ready();
    cleanup.push(() => settings.dispose());
    const docs = new DocumentService({ dataDir });
    cleanup.push(() => docs.dispose());
    docs.registerSystemDoc(SETTINGS_ID, "Settings", settings.hostDoc(), settings.hostOwner());
    return { settings, docs };
  }

  /** `to` reconnects to `from`; true when something crossed and merged. */
  async function exchange(from: DocumentService, to: DocumentService): Promise<boolean> {
    const theirs = await to.hostVersion(SETTINGS_ID);
    const answer = theirs === null ? null : await from.hostAnswer(SETTINGS_ID, theirs);
    if (answer === null || answer.update === null) return false;
    const outcome = await to.applyRemoteRecord(SETTINGS_ID, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: answer.meta,
      payload: answer.update,
    });
    return outcome.applied;
  }

  async function eventually(
    fn: () => boolean | Promise<boolean>,
    label: string,
    ms = 8000,
  ): Promise<void> {
    const deadline = Date.now() + ms;
    while (!(await fn())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
      await sleep(25);
    }
  }

  async function connect(daemon: FielddDaemon, token: string, clientKind: string): Promise<WsRpc> {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const rpc = new WsRpc(ws);
    await helloAs(rpc, token, clientKind);
    return rpc;
  }

  async function auditRecords(dataDir: string): Promise<AuditRecordV1[]> {
    const root = join(dataDir, "audit");
    const records: AuditRecordV1[] = [];
    for (const name of readdirSync(root).filter((entry) => entry.endsWith(".jsonl"))) {
      const verified = await verifyAuditSegment(join(root, name));
      expect(verified.valid, `${name}: ${verified.reason}`).toBe(true);
      records.push(...verified.records);
    }
    return records;
  }

  const revoked = (daemon: FielddDaemon, capability: string): boolean =>
    daemon.plugins
      .get(FIXTURE_ID)
      ?.deniedCapabilities.some((d) => d.capability === capability && d.reason === "revoked") ===
      true && !daemon.plugins.get(FIXTURE_ID)?.grantedCapabilities.includes(capability);

  it("(d) a peer desktop's merged settings never re-grant a capability this desktop revoked", async () => {
    const { dataDir, daemon } = await bootWithFixture();
    expect(daemon.plugins.get(FIXTURE_ID)?.grantedCapabilities).toEqual(
      expect.arrayContaining(["storage.self", "canvas.read"]),
    );
    const peer = await peerDesktop();

    // The shared past: the peer's entry, both capabilities granted, crosses.
    await peer.settings.setInstallSetEntry(
      {
        pluginId: FIXTURE_ID,
        source: "bundled",
        enabled: true,
        grants: [
          { capability: "storage.self", decision: "granted", at: 1 },
          { capability: "canvas.read", decision: "granted", at: 1 },
        ],
      },
      "seed",
    );
    expect(await exchange(peer.docs, daemon.docs), "the peer's settings crossed").toBe(true);

    // The peer goes offline. Here, the user revokes storage.self.
    const before = await daemon.docs.hostVersion(SETTINGS_ID);
    const grantor = daemon.tokens.mint(["plugins.read", "plugins.manage"] as Scope[], "pa32");
    const rpc = await connect(daemon, grantor.token, "renderer");
    await rpc.call("plugins.grants.set", {
      id: FIXTURE_ID,
      capability: "storage.self",
      granted: false,
    });
    expect(revoked(daemon, "storage.self")).toBe(true);
    await eventually(async () => {
      const now = await daemon.docs.hostVersion(SETTINGS_ID);
      return (
        Buffer.compare(Buffer.from(now?.version ?? []), Buffer.from(before?.version ?? [])) !== 0
      );
    }, "the revocation to be published");

    // Offline, the peer never hears of it: it changes a preference twice and
    // REWRITES its whole entry with storage.self granted (B1's write) while
    // revoking canvas.read — its later writes carry the higher clock.
    await peer.settings.setAppValue("mesh.syncPosture", "opt-in", "pane");
    await peer.settings.setAppValue("desktop.showTray", false, "pane");
    await peer.settings.setInstallSetEntry(
      {
        pluginId: FIXTURE_ID,
        source: "bundled",
        enabled: true,
        grants: [
          { capability: "storage.self", decision: "granted", at: 2 },
          { capability: "canvas.read", decision: "revoked", at: 2 },
        ],
      },
      "pane",
    );

    // Reconnected: this desktop merges the peer's offline writes.
    expect(await exchange(peer.docs, daemon.docs), "the peer's writes crossed").toBe(true);
    // The merged entry was applied — the peer's revocation of canvas.read
    // landed here — and storage.self stayed revoked.
    await eventually(() => revoked(daemon, "canvas.read"), "the peer's revocation to apply");
    expect(revoked(daemon, "storage.self"), "storage.self re-granted").toBe(true);
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    expect(await shell.call("storage.appPreferences.get", {})).toMatchObject({
      syncPosture: "opt-in",
      showTray: false,
    });
    const regrants = (await auditRecords(dataDir)).filter(
      (record) =>
        record.action === "capability.grant" &&
        record.target.id === "storage.self" &&
        record.phase === "outcome",
    );
    expect(regrants, "a settings-doc re-grant of storage.self").toEqual([]);
  }, 40_000);

  it("(e) a spine preference set on this desktop reads on a peer's appValues() through the host", async () => {
    const { daemon } = await bootWithFixture();
    const peer = await peerDesktop();
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    await shell.call("storage.appPreferences.set", { key: "desktop.showTray", value: false });
    await shell.call("storage.appPreferences.set", { key: "mesh.syncPosture", value: "opt-in" });

    expect(await exchange(daemon.docs, peer.docs), "this desktop's settings crossed").toBe(true);
    expect(await peer.settings.appValues()).toMatchObject({
      "desktop.showTray": false,
      "mesh.syncPosture": "opt-in",
    });
  }, 30_000);
});
