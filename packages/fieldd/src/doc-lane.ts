import {
  DOC_LANE_ACCEPTS,
  decodeJsonPayload,
  decodeLaneFrame,
  type ErrorKind,
  encodeJsonFrame,
  encodeLaneFrame,
  LANE_FRAME,
  LANE_HEADER_BYTES,
  LANE_MAX_FRAME_BYTES,
  type LaneErr,
  LaneHello,
  type LaneHelloOk,
  LanePutMeta,
  type LanePutOk,
  MESHDATA_LOSSY_MAX_LOGICAL_BYTES,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { VersionVector } from "loro-crdt";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { DocumentService } from "./doc-service";
import { liftIce1 } from "./ice1-envelope";
import { decodeVersion, mergeVersions, provenVersion, updateCarriesChanges } from "./loro-host";
import { RpcCallError } from "./native-link";

// The :9411 doc lane (design-01 §4 / D27, B3): a second loopback WS carrying raw
// ICE1 envelope bytes, never JSON-RPC (EL2). The ticket minted by doc.open is the
// ONLY gate — a socket that does not open with a redeemable HELLO is dropped, and
// an unauthenticated socket is not held past HELLO_TIMEOUT_MS. Frames are the
// shared D5 codec (contracts/doclane); the tolerant reader ignores unknown kinds.
//
// Per socket the protocol is strictly one doc: HELLO → HELLO_OK, then GET → DOC
// plus the advertised number of DOC_UPDATE frames, and PUT_META+PUT → PUT_OK
// cycles (autosave). The single-writer lock lives in
// DocumentService — the lane only reports it (LaneErr PRECONDITION_FAILED).
//
// DS-5 (§1.2 defect 2 closed) — a window that declares `accepts: ["push"]` is
// PUSHED what a peer merged (LANE_FRAME.DOC_PUSH), exported from the version
// this device can PROVE the window holds: what GET served it, raised by every
// update and checkpoint it PUT (ICE re-journals applied remote updates, so a
// push it applied comes back as proof). Never from what was merely sent — a
// push lost on a dropped socket must cost size, never completeness, because a
// window that imports a record whose base it lacks is quarantined for good.
//
// DS-5c (2026-10-01, the DS wave 1 review's HELLO/GET race) — HELLO_OK and GET
// describe ONE read. The client reads GET's journal by HELLO_OK's count
// (fieldd-client's `initialUpdateCount`), so the proof used to overstate it
// whenever a peer merge landed between the two frames: GET served (and proved)
// a record the client dropped as a frame with no waiter, the next push omitted
// it, and strata quarantined the board until reopen. Now the window's read is
// taken ONCE, at HELLO, on the per-doc chain; HELLO_OK counts it, GET serves
// it, and its version is the proof. What merged after HELLO is pushed right
// after GET, exported from that proof.

const WS_OPEN = 1;
const HELLO_TIMEOUT_MS = 10_000;

export interface DocLaneOptions {
  /** 0 = ephemeral (tests); production passes PORTS.FIELDD_WS_DATA via bin.ts. */
  dataPort: number;
  docs: DocumentService;
  /** Optional document-room owner. Persistence remains fully available when
   * the mesh/presence plane is absent. */
  rooms?: DocumentPresenceRooms;
  logger?: Logger;
}

export interface DocumentPresenceRoomHandle {
  publish(payload: Uint8Array): void;
  close(): void | Promise<void>;
}

export interface DocumentPresenceRooms {
  attach(docId: string, sink: (payload: Uint8Array) => void): DocumentPresenceRoomHandle;
}

interface LaneConn {
  /** set once HELLO_OK is sent; null means unauthenticated */
  docId: string | null;
  /** the PUT_META awaiting its PUT payload (one cycle at a time) */
  pendingMeta: LanePutMeta | null;
  helloTimer: NodeJS.Timeout | null;
  /** Serializes async storage operations and preserves frame order. */
  chain: Promise<void>;
  /** identity-bound membership derived from the redeemed HELLO docId */
  room: DocumentPresenceRoomHandle | null;
  /** DS-5 — the client declared it takes DOC_PUSH frames. */
  pushes: boolean;
  /** DS-5c — the read HELLO_OK described (a new window's), kept until the GET
   * it is for or the first save, whichever comes first. */
  frozen: WindowRead | null;
  /** DS-5c — the journal count HELLO_OK announced: how many DOC_UPDATE frames
   * the client reads behind GET's DOC frame. */
  announced: number;
}

/** A window's read, as `DocumentService.readDocForWindow` takes it. */
type WindowRead = NonNullable<Awaited<ReturnType<DocumentService["readDocForWindow"]>>>;

export class DocLane {
  private wss: WebSocketServer | null = null;
  private readonly logger: Logger;
  /** DS-5 — per doc, what this device can PROVE the open window holds. Kept
   * across a reconnect of the SAME window (HELLO `resume`), dropped for a new
   * one; a lower bound, so a push exported from it is always complete. */
  private readonly proven = new Map<string, VersionVector>();
  /** DS-5 — the authenticated sockets per doc (the writer lock keeps it one). */
  private readonly open = new Map<string, Set<{ ws: WebSocket; conn: LaneConn }>>();
  private readonly offMerged: () => void;

  constructor(private readonly opts: DocLaneOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.offMerged = opts.docs.onPeerMerged((docId) => this.onPeerMerged(docId));
  }

  async listen(): Promise<number> {
    const wss = new WebSocketServer({ port: this.opts.dataPort, host: "127.0.0.1" });
    this.wss = wss;
    wss.on("connection", (ws) => this.onConnection(ws));
    await new Promise<void>((resolve, reject) => {
      wss.once("listening", resolve);
      wss.once("error", reject);
    });
    const addr = wss.address();
    return typeof addr === "object" && addr ? addr.port : this.opts.dataPort;
  }

  private onConnection(ws: WebSocket): void {
    const conn: LaneConn = {
      docId: null,
      pendingMeta: null,
      chain: Promise.resolve(),
      room: null,
      pushes: false,
      frozen: null,
      announced: 0,
      helloTimer: setTimeout(() => {
        if (!conn.docId) ws.close(1008, "no hello");
      }, HELLO_TIMEOUT_MS),
    };
    ws.on("message", (data: RawData, isBinary: boolean) => {
      conn.chain = conn.chain
        .then(() => this.onMessage(ws, conn, data, isBinary))
        .catch((err: unknown) => {
          this.sendErr(ws, "INTERNAL", err instanceof Error ? err.message : "document lane failed");
          ws.close(1011, "document storage failed");
        });
    });
    ws.on("close", () => {
      if (conn.helloTimer) clearTimeout(conn.helloTimer);
      void conn.chain.then(async () => {
        const docId = conn.docId;
        const room = conn.room;
        conn.room = null;
        if (docId) {
          for (const held of this.open.get(docId) ?? []) {
            if (held.conn === conn) this.open.get(docId)?.delete(held);
          }
        }
        try {
          await room?.close();
        } catch (error) {
          this.logger.warn(
            "fieldd.doclane.presence_close_failed",
            "A document room did not close cleanly",
            { docId, error: String(error) },
          );
        } finally {
          if (docId) this.opts.docs.writerDetached(docId);
          conn.docId = null;
          conn.pendingMeta = null;
          conn.frozen = null;
        }
      });
    });
    ws.on("error", () => {
      /* close follows */
    });
  }

  private async onMessage(
    ws: WebSocket,
    conn: LaneConn,
    data: RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (ws.readyState !== WS_OPEN) return;
    if (!isBinary) {
      // the lane is binary-only; a text frame is protocol garbage
      this.sendErr(ws, "PRECONDITION_FAILED", "lane frames must be binary");
      ws.close(1003, "text frame");
      return;
    }
    const buf = toUint8(data);
    if (buf.byteLength > LANE_MAX_FRAME_BYTES) {
      this.sendErr(ws, "PRECONDITION_FAILED", "frame exceeds lane ceiling");
      ws.close(1009, "oversize frame");
      return;
    }
    let frame: { kind: number; laneId: number; payload: Uint8Array };
    try {
      frame = decodeLaneFrame(buf);
    } catch {
      this.sendErr(ws, "INTERNAL", "undecodable lane frame");
      ws.close(1002, "bad frame");
      return;
    }
    if (frame.laneId !== 0) {
      this.sendErr(
        ws,
        "PRECONDITION_FAILED",
        "laneId must be zero until multiplexing is negotiated",
      );
      ws.close(1002, "unexpected lane id");
      return;
    }

    if (!conn.docId) {
      // pre-auth: the first frame MUST be a redeemable HELLO, nothing else
      if (frame.kind === LANE_FRAME.HELLO) await this.onHello(ws, conn, frame.payload);
      else ws.close(1008, "hello required first");
      return;
    }

    switch (frame.kind) {
      case LANE_FRAME.GET:
        await this.onGet(ws, conn, conn.docId);
        return;
      case LANE_FRAME.PUT_META:
        // The window is saving: it holds what it read, and the read HELLO_OK
        // described is no longer anything a later GET could be about.
        conn.frozen = null;
        this.onPutMeta(ws, conn, frame.payload);
        return;
      case LANE_FRAME.PUT:
        await this.onPut(ws, conn, frame.payload);
        return;
      case LANE_FRAME.PRESENCE_PUBLISH:
        this.onPresencePublish(conn, frame.payload);
        return;
      default:
        // tolerant reader: unknown (or out-of-sequence) kinds are logged + ignored,
        // never fatal — a future frame kind must degrade, not drop the lane
        this.logger.warn(
          "fieldd.doclane.frame_rejected",
          "An unexpected document-lane frame was ignored",
          { frameKind: frame.kind },
        );
        return;
    }
  }

  private async onHello(ws: WebSocket, conn: LaneConn, payload: Uint8Array): Promise<void> {
    let hello: LaneHello;
    try {
      const parsed = LaneHello.safeParse(decodeJsonPayload(payload));
      if (!parsed.success) {
        ws.close(1008, "malformed hello");
        return;
      }
      hello = parsed.data;
    } catch {
      ws.close(1008, "malformed hello");
      return;
    }

    const redeemed = this.opts.docs.redeemTicket(hello.ticket);
    if (!redeemed.ok) {
      // busy writer is an honest refusal (a valid ticket, a held lane); a bad
      // ticket gets no frame — just the drop.
      if (redeemed.reason === "writer-busy")
        this.sendErr(ws, "PRECONDITION_FAILED", "another writer holds the doc lane");
      ws.close(1008, "ticket rejected");
      return;
    }

    if (conn.helloTimer) {
      clearTimeout(conn.helloTimer);
      conn.helloTimer = null;
    }
    conn.docId = redeemed.docId;
    this.opts.docs.writerAttached(redeemed.docId);
    // DS-5 — a NEW window holds nothing this device served; a resuming one
    // keeps its proof. Either way it is pushed only once something is proven.
    if (hello.resume !== true) this.proven.delete(redeemed.docId);
    conn.pushes = hello.accepts?.includes(DOC_LANE_ACCEPTS.PUSH) === true;
    let held = this.open.get(redeemed.docId);
    if (held === undefined) {
      held = new Set();
      this.open.set(redeemed.docId, held);
    }
    held.add({ ws, conn });
    try {
      conn.room =
        this.opts.rooms?.attach(redeemed.docId, (payload) => {
          this.sendFrame(ws, encodeLaneFrame(LANE_FRAME.PRESENCE_PUSH, 0, payload));
        }) ?? null;
    } catch (error) {
      // Presence is an optional coeffect. A room failure must never turn a
      // valid persistence ticket into a failed document attach.
      this.logger.warn(
        "fieldd.doclane.presence_attach_failed",
        "The document opened without its presence room",
        { docId: redeemed.docId, error: String(error) },
      );
      conn.room = null;
    }

    // DS-5c — a NEW window reads what GET will serve NOW, on the per-doc chain,
    // and HELLO_OK counts that read — the one the client will act on. A
    // resuming window never GETs (re-attach is PUT-only), so it is told the
    // meta alone, as before.
    let meta: Awaited<ReturnType<DocumentService["readDocMeta"]>>;
    if (hello.resume === true) {
      meta = await this.opts.docs.readDocMeta(redeemed.docId);
    } else {
      conn.frozen = await this.opts.docs.readDocForWindow(redeemed.docId);
      meta = conn.frozen?.meta ?? null;
    }
    conn.announced = meta?.journalEntries ?? 0;
    const helloOk: LaneHelloOk = {
      docId: redeemed.docId,
      hasDoc: meta !== null,
      ...(meta ? { meta } : {}),
      ...(conn.pushes ? { pushes: true } : {}),
    };
    this.sendFrame(ws, encodeJsonFrame(LANE_FRAME.HELLO_OK, 0, helloOk));
  }

  private async onGet(ws: WebSocket, conn: LaneConn, docId: string): Promise<void> {
    // DS-5c — the read HELLO_OK counted, when there is one; otherwise (a
    // resumed window that GETs, a second GET) a fresh read, served only when
    // its journal is still the length HELLO_OK announced — a GET answer the
    // client would read short is refused, never served.
    const read = conn.frozen ?? (await this.opts.docs.readDocForWindow(docId));
    conn.frozen = null;
    if (!read) {
      this.sendErr(ws, "NOT_FOUND", "no doc bytes yet");
      return;
    }
    if (read.updates.length !== conn.announced) {
      this.sendErr(
        ws,
        "PRECONDITION_FAILED",
        "the document moved since HELLO; re-attach to read it whole",
      );
      return;
    }
    this.sendFrame(ws, encodeLaneFrame(LANE_FRAME.DOC, 0, read.bytes));
    for (const update of read.updates) {
      this.sendFrame(ws, encodeLaneFrame(LANE_FRAME.DOC_UPDATE, 0, update));
    }
    // DS-5 — what was just served is the window's first proven version. DS-5c:
    // exactly what was served, never the host's version at GET.
    const served = read.version === null ? null : decodeVersion(read.version);
    if (served !== null) this.proven.set(docId, served);
    // DS-5c — whatever a peer merged after the read (between HELLO and GET, or
    // while the window opened) is pushed now, exported from that proof.
    if (served !== null && conn.pushes) this.queuePush(ws, conn, docId);
  }

  /** DS-5 — a window's own PUT proves what it holds: a checkpoint its whole
   * version, an update the end of what it exported (ICE exports everything
   * since its last send, remote ops included). */
  private prove(docId: string, payload: Uint8Array, kind: "checkpoint" | "update"): void {
    let bytes: Uint8Array | null = payload;
    if (kind === "checkpoint") {
      const lifted = liftIce1(payload);
      bytes = lifted.ok ? lifted.payload : null;
    }
    const version = bytes === null ? null : provenVersion(bytes);
    if (version === null) return;
    const known = this.proven.get(docId);
    this.proven.set(docId, known === undefined ? version : mergeVersions(known, version));
  }

  /** DS-5 — a peer's bytes changed a doc: push every push-capable window on it
   * what it lacks, in order behind whatever its socket is already doing. */
  private onPeerMerged(docId: string): void {
    for (const { ws, conn } of this.open.get(docId) ?? []) {
      if (conn.pushes) this.queuePush(ws, conn, docId);
    }
  }

  /** A push, in order behind whatever the socket is already doing. */
  private queuePush(ws: WebSocket, conn: LaneConn, docId: string): void {
    conn.chain = conn.chain
      .then(() => this.push(ws, conn, docId))
      .catch((error: unknown) => {
        this.logger.warn("fieldd.doclane.push_failed", "A live update could not be pushed", {
          docId,
          error: String(error),
        });
      });
  }

  private async push(ws: WebSocket, conn: LaneConn, docId: string): Promise<void> {
    if (ws.readyState !== WS_OPEN || conn.docId !== docId) return;
    const known = this.proven.get(docId);
    if (known === undefined) return; // nothing proven yet: pushes start at the window's first GET or PUT
    const update = await this.opts.docs.windowUpdateSince(docId, known.encode());
    if (update === null || !updateCarriesChanges(update)) return;
    if (LANE_HEADER_BYTES + update.byteLength > LANE_MAX_FRAME_BYTES) {
      // The window catches up on its next open; a frame past the ceiling is
      // refused loudly everywhere else on this lane, and here too.
      this.logger.warn("fieldd.doclane.push_oversize", "A live update exceeds the lane ceiling", {
        docId,
        bytes: update.byteLength,
      });
      return;
    }
    this.sendFrame(ws, encodeLaneFrame(LANE_FRAME.DOC_PUSH, 0, update));
  }

  private onPutMeta(ws: WebSocket, conn: LaneConn, payload: Uint8Array): void {
    let meta: LanePutMeta;
    try {
      const parsed = LanePutMeta.safeParse(decodeJsonPayload(payload));
      if (!parsed.success) {
        this.sendErr(ws, "PRECONDITION_FAILED", "malformed put_meta");
        return;
      }
      meta = parsed.data;
    } catch {
      this.sendErr(ws, "PRECONDITION_FAILED", "put_meta is not JSON");
      return;
    }
    conn.pendingMeta = meta;
  }

  private async onPut(ws: WebSocket, conn: LaneConn, payload: Uint8Array): Promise<void> {
    const meta = conn.pendingMeta;
    conn.pendingMeta = null; // consumed regardless of the outcome
    if (!meta) {
      this.sendErr(ws, "PRECONDITION_FAILED", "put with no preceding put_meta");
      return;
    }
    try {
      // conn.docId is non-null here: dispatch only reaches PUT once authenticated
      await this.opts.docs.writeDoc(conn.docId as string, payload, meta);
      this.prove(conn.docId as string, payload, meta.kind ?? "checkpoint");
      const ok: LanePutOk = { revisionId: meta.revisionId, byteLength: meta.byteLength };
      this.sendFrame(ws, encodeJsonFrame(LANE_FRAME.PUT_OK, 0, ok));
    } catch (e) {
      if (e instanceof RpcCallError) this.sendErr(ws, e.kind as ErrorKind, e.message);
      else this.sendErr(ws, "INTERNAL", e instanceof Error ? e.message : "write failed");
    }
  }

  private onPresencePublish(conn: LaneConn, payload: Uint8Array): void {
    if (payload.byteLength > MESHDATA_LOSSY_MAX_LOGICAL_BYTES) {
      this.logger.warn(
        "fieldd.doclane.presence_oversize",
        "An oversized presence snapshot was dropped",
        { docId: conn.docId, bytes: payload.byteLength },
      );
      return;
    }
    try {
      conn.room?.publish(payload);
    } catch (error) {
      // No acknowledgement exists for lossy presence. Log and wait for ICE's
      // next keepalive snapshot; never poison the ordered persistence chain.
      this.logger.warn(
        "fieldd.doclane.presence_publish_failed",
        "A presence snapshot could not enter its document room",
        { docId: conn.docId, error: String(error) },
      );
    }
  }

  private sendErr(ws: WebSocket, kind: ErrorKind, message: string): void {
    const err: LaneErr = { kind, message };
    this.sendFrame(ws, encodeJsonFrame(LANE_FRAME.ERR, 0, err));
  }

  private sendFrame(ws: WebSocket, frame: Uint8Array): void {
    if (ws.readyState === WS_OPEN) ws.send(frame);
  }

  close(): void {
    this.offMerged();
    for (const client of this.wss?.clients ?? []) client.terminate();
    this.wss?.close();
  }
}

/** ws hands binary as Buffer (or a Buffer[] on fragmentation); normalize to a view
 * the shared codec can decode without copying. */
function toUint8(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}
