import {
  decodeJsonPayload,
  decodeLaneFrame,
  type ErrorKind,
  encodeJsonFrame,
  encodeLaneFrame,
  LANE_FRAME,
  LANE_MAX_FRAME_BYTES,
  type LaneErr,
  LaneHello,
  type LaneHelloOk,
  LanePutMeta,
  type LanePutOk,
} from "@vibefield/contracts";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { DocumentService } from "./doc-service";
import { RpcCallError } from "./native-link";

// The :9411 doc lane (design-01 §4 / D27, B3): a second loopback WS carrying raw
// ICE1 envelope bytes, never JSON-RPC (EL2). The ticket minted by doc.open is the
// ONLY gate — a socket that does not open with a redeemable HELLO is dropped, and
// an unauthenticated socket is not held past HELLO_TIMEOUT_MS. Frames are the
// shared D5 codec (contracts/doclane); the tolerant reader ignores unknown kinds.
//
// Per socket the protocol is strictly one doc: HELLO → HELLO_OK, then GET → DOC,
// and PUT_META+PUT → PUT_OK cycles (autosave). The single-writer lock lives in
// DocumentService — the lane only reports it (LaneErr PRECONDITION_FAILED).

const WS_OPEN = 1;
const HELLO_TIMEOUT_MS = 10_000;

export interface DocLaneOptions {
  /** 0 = ephemeral (tests); production passes PORTS.FIELDD_WS_DATA via bin.ts. */
  dataPort: number;
  docs: DocumentService;
}

interface LaneConn {
  /** set once HELLO_OK is sent; null means unauthenticated */
  docId: string | null;
  /** the PUT_META awaiting its PUT payload (one cycle at a time) */
  pendingMeta: LanePutMeta | null;
  helloTimer: NodeJS.Timeout | null;
  /** Serializes async storage operations and preserves frame order. */
  chain: Promise<void>;
}

export class DocLane {
  private wss: WebSocketServer | null = null;

  constructor(private readonly opts: DocLaneOptions) {}

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
      void conn.chain.finally(() => {
        if (conn.docId) this.opts.docs.writerDetached(conn.docId);
        conn.docId = null;
        conn.pendingMeta = null;
      });
    });
    ws.on("error", () => {
      /* close follows */
    });
  }

  private async onMessage(ws: WebSocket, conn: LaneConn, data: RawData, isBinary: boolean): Promise<void> {
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
    let frame: { kind: number; payload: Uint8Array };
    try {
      frame = decodeLaneFrame(buf);
    } catch {
      this.sendErr(ws, "INTERNAL", "undecodable lane frame");
      ws.close(1002, "bad frame");
      return;
    }
    if (frame.laneId !== 0) {
      this.sendErr(ws, "PRECONDITION_FAILED", "laneId must be zero until multiplexing is negotiated");
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
        await this.onGet(ws, conn.docId);
        return;
      case LANE_FRAME.PUT_META:
        this.onPutMeta(ws, conn, frame.payload);
        return;
      case LANE_FRAME.PUT:
        await this.onPut(ws, conn, frame.payload);
        return;
      default:
        // tolerant reader: unknown (or out-of-sequence) kinds are logged + ignored,
        // never fatal — a future frame kind must degrade, not drop the lane
        console.warn(`[doc-lane] ignoring unexpected frame kind ${frame.kind}`);
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

    const read = await this.opts.docs.readDoc(redeemed.docId);
    const helloOk: LaneHelloOk = {
      docId: redeemed.docId,
      hasDoc: read !== null,
      ...(read ? { meta: read.meta } : {}),
    };
    this.sendFrame(ws, encodeJsonFrame(LANE_FRAME.HELLO_OK, 0, helloOk));
  }

  private async onGet(ws: WebSocket, docId: string): Promise<void> {
    const read = await this.opts.docs.readDoc(docId);
    if (!read) {
      this.sendErr(ws, "NOT_FOUND", "no doc bytes yet");
      return;
    }
    this.sendFrame(ws, encodeLaneFrame(LANE_FRAME.DOC, 0, read.bytes));
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
      const written = await this.opts.docs.writeDoc(conn.docId as string, payload, meta);
      const ok: LanePutOk = { revisionId: meta.revisionId, byteLength: written.byteLength };
      this.sendFrame(ws, encodeJsonFrame(LANE_FRAME.PUT_OK, 0, ok));
    } catch (e) {
      if (e instanceof RpcCallError) this.sendErr(ws, e.kind as ErrorKind, e.message);
      else this.sendErr(ws, "INTERNAL", e instanceof Error ? e.message : "write failed");
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
