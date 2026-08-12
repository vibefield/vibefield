import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import {
  encodeMeshDataFrame,
  encodeMeshDataJsonFrame,
  MESHDATA_FRAME,
  MeshDataFrameReader,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { ackMacMatches, computeAckMac, computePairingMac, newPairingNonce } from "./pairing";

// MeshLaneLink (design-02 §2.5, D5) — fieldd's end of the byte plane.
//
// The SECOND socket to field-native, and deliberately so: NativeLink owns
// mgmt.sock and carries decisions; this owns meshdata.sock and carries bytes.
// Control never queues behind a snapshot, and a document's bytes never touch
// JSON-RPC (EL2). Lane lifecycle is NativeLink's business — `native.mesh.lane.*`
// — so nothing here opens or closes a lane; it only moves payloads for lanes
// somebody else negotiated.
//
// THE ORDERING HAZARD, handled here because this is where it lands. An inbound
// lane is announced on the mgmt channel while its DATA arrives on this socket.
// They are different transports with no shared ordering, so bytes for a lane
// fieldd has not yet subscribed to are NORMAL — not corruption, not an error.
// They are held per lane until a consumer appears, and dropped with a count if
// one never does. The alternative — discarding them on arrival — loses the
// first update of every inbound lane, which would look exactly like a rare
// sync bug.

export interface MeshLaneLinkOptions {
  socketPath: string;
  pairingFile: string;
  /** fieldd's per-process boot id, as used for the mgmt hello (§4.1) */
  bootId: string;
  logger?: Logger;
  /** How long unclaimed inbound bytes wait for their announcement. */
  orphanTtlMs?: number;
  /** Cap on held bytes per unannounced lane — an announcement that never comes
   * must not become unbounded memory (PF4: every queue has a watermark). */
  orphanMaxBytes?: number;
  /** Cap on bytes queued in the SOCKET toward the bridge. Node buffers an
   * ignored `write()` without limit, and this is the plane whole document
   * snapshots cross — so the outbound queue needs the watermark the inbound one
   * already has (PF4). Shed strategy here is REFUSE, not drop: losing a doc
   * update silently is the failure this plane exists to prevent. */
  sendMaxBufferedBytes?: number;
}

type LaneHandler = (payload: Uint8Array) => void;

const DEFAULT_ORPHAN_TTL_MS = 30_000;
const DEFAULT_ORPHAN_MAX_BYTES = 4 * 1024 * 1024;
/** Matches the inbound orphan cap: the same amount of unmoved data is the same
 * amount of trouble whichever direction it is stuck in. */
const DEFAULT_SEND_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export class MeshLaneLink extends EventEmitter {
  #sock: Socket | null = null;
  #reader = new MeshDataFrameReader();
  #handlers = new Map<number, LaneHandler>();
  #orphans = new Map<number, { chunks: Uint8Array[]; bytes: number; timer: NodeJS.Timeout }>();
  #closed = false;
  /** Whether the handshake has resolved one way or the other. Distinct from
   * `connected`, which lands a microtask later — see the HELLO_OK branch. */
  #helloSettled = false;
  /** WIN-10 — the proof this connection's HELLO_OK must carry, set when the
   * challenge is sent. Null only for a connection that offered no nonce, which
   * fieldd never does; the null arm exists so a future embedder that opts out
   * degrades to the pre-WIN-10 behaviour rather than to a false refusal. */
  #expectedAckMac: string | null = null;
  readonly #logger: Logger;

  connected = false;

  constructor(private readonly opts: MeshLaneLinkOptions) {
    super();
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "mesh.lane" });
  }

  /** Dial and authenticate. Resolves once the bridge has answered HELLO_OK —
   * lanes may be written only after that, so callers cannot race the handshake. */
  async connect(): Promise<void> {
    if (this.connected) return;
    const sock = await this.#open();
    this.#sock = sock;
    sock.on("data", (chunk: Buffer) => this.#onData(chunk));
    sock.on("close", () => this.#onClose());
    sock.on("error", (error) => {
      this.#logger.warn("fieldd.mesh_lane.socket_error", "The MeshData socket errored", {
        error: String(error),
      });
    });

    const secretHex = readFileSync(this.opts.pairingFile, "utf8").trim();
    const ts = Math.floor(Date.now() / 1000);
    const mac = computePairingMac(secretHex, this.opts.bootId, ts);
    const nonce = newPairingNonce();
    this.#expectedAckMac = computeAckMac(secretHex, nonce, this.opts.bootId);
    // Both listeners are registered, so both must be removed — `once` only
    // removes the one that fires, and every reconnect would otherwise leave the
    // other behind (MaxListenersExceededWarning at 11, then a slow leak).
    const helloOk = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("meshdata hello timed out")), 5_000);
      const onOk = () => {
        clearTimeout(timer);
        cleanup();
        resolve();
      };
      const onRefused = (reason: string) => {
        clearTimeout(timer);
        cleanup();
        reject(new Error(`meshdata hello refused: ${reason}`));
      };
      const cleanup = () => {
        this.off("hello-ok", onOk);
        this.off("hello-refused", onRefused);
      };
      this.once("hello-ok", onOk);
      this.once("hello-refused", onRefused);
    });
    sock.write(
      encodeMeshDataJsonFrame(MESHDATA_FRAME.HELLO, 0, {
        bootId: this.opts.bootId,
        ts,
        mac,
        nonce,
      }),
    );
    await helloOk;
    this.connected = true;
  }

  /** Write opaque bytes to a lane. The lane must already be open (NativeLink's
   * `native.mesh.lane.open`); the bridge answers an unknown lane with an ERR
   * frame naming that lane, and the socket survives it.
   *
   * Returns FALSE when the socket has gone over its high-water mark — the
   * caller should await `drain` before sending more. Ignoring the return is
   * safe up to `sendMaxBufferedBytes`, past which this THROWS rather than
   * queueing: an unbounded write buffer on the plane whole snapshots cross is
   * how a stalled bridge becomes an out-of-memory crash, and a silently dropped
   * document update is worse than a loud refusal. */
  send(laneId: number, payload: Uint8Array): boolean {
    if (!this.connected || this.#sock === null) {
      throw new Error("meshdata link is not connected");
    }
    const cap = this.opts.sendMaxBufferedBytes ?? DEFAULT_SEND_MAX_BUFFERED_BYTES;
    if (this.#sock.writableLength > cap) {
      this.#logger.error(
        "fieldd.mesh_lane.send_buffer_full",
        "The MeshData socket is not draining; refusing to queue more",
        { laneId, bufferedBytes: this.#sock.writableLength, cap },
      );
      throw new Error(
        `meshdata send buffer is full (${this.#sock.writableLength} > ${cap} bytes); the bridge is not draining`,
      );
    }
    return this.#sock.write(encodeMeshDataFrame(MESHDATA_FRAME.DATA, laneId, payload));
  }

  /** Bytes queued in the socket toward the bridge — the outbound watermark's
   * live reading, for callers pacing a large transfer. */
  get bufferedBytes(): number {
    return this.#sock?.writableLength ?? 0;
  }

  /** Register the consumer for a lane. Any bytes that arrived before the
   * announcement are replayed IMMEDIATELY, in arrival order, so an inbound
   * lane's first update is never the one that goes missing. */
  onLane(laneId: number, handler: LaneHandler): void {
    this.#handlers.set(laneId, handler);
    const held = this.#orphans.get(laneId);
    if (held !== undefined) {
      clearTimeout(held.timer);
      this.#orphans.delete(laneId);
      for (const chunk of held.chunks) handler(chunk);
    }
  }

  offLane(laneId: number): void {
    this.#handlers.delete(laneId);
  }

  close(): void {
    this.#closed = true;
    this.connected = false;
    this.#helloSettled = false;
    for (const held of this.#orphans.values()) clearTimeout(held.timer);
    this.#orphans.clear();
    this.#handlers.clear();
    this.#sock?.destroy();
    this.#sock = null;
  }

  #open(): Promise<Socket> {
    return new Promise<Socket>((resolve, reject) => {
      const sock = createConnection(this.opts.socketPath);
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        sock.off("connect", onConnect);
        sock.off("error", onError);
        fn();
      };
      const onConnect = () => finish(() => resolve(sock));
      const onError = (error: Error) => finish(() => reject(error));
      sock.once("connect", onConnect);
      sock.once("error", onError);
      if (this.#closed) sock.destroy();
    });
  }

  #onData(chunk: Buffer): void {
    let frames: ReturnType<MeshDataFrameReader["push"]>;
    try {
      frames = this.#reader.push(new Uint8Array(chunk));
    } catch (error) {
      // Structural garbage on the stream: the socket is desynchronised and
      // cannot be resynchronised (there is no frame marker to re-find). Drop
      // it and let the caller redial — a torn frame tears the connection here,
      // never the daemon.
      this.#logger.error(
        "fieldd.mesh_lane.frame_error",
        "The MeshData stream could not be decoded; dropping the socket",
        error,
      );
      this.#reader.reset();
      this.#sock?.destroy();
      return;
    }
    for (const frame of frames) {
      switch (frame.kind) {
        case MESHDATA_FRAME.HELLO_OK:
          // Settled SYNCHRONOUSLY, here, rather than by `connected` — which is
          // assigned a microtask later, after `await helloOk` resumes. An ERR
          // riding the same socket read as HELLO_OK would otherwise still see
          // `connected === false` and be misrouted to `hello-refused`, where it
          // lands on a promise that has already resolved and is swallowed. The
          // frame that reported a real lane error would simply vanish.
          this.#helloSettled = true;
          // WIN-10 — the bridge must prove the pairing secret before this lane
          // is believed. A squatter on the flat Windows pipe namespace (WIN-D1)
          // feeds fieldd forged DOCUMENT bytes otherwise; no token rides here,
          // so integrity is the whole stake. Absence is refused, not tolerated:
          // an attacker would simply omit the proof.
          if (this.#expectedAckMac === null) {
            this.emit("hello-ok");
          } else if (safeServerMac(frame.payload, this.#expectedAckMac)) {
            this.emit("hello-ok");
          } else {
            this.emit("hello-refused", "the bridge did not prove the pairing secret");
          }
          break;
        case MESHDATA_FRAME.DATA:
          this.#deliver(frame.laneId, frame.payload);
          break;
        case MESHDATA_FRAME.ERR: {
          const reason = safeReason(frame.payload);
          if (!this.#helloSettled) this.emit("hello-refused", reason);
          else this.emit("lane-error", frame.laneId, reason);
          this.#logger.warn("fieldd.mesh_lane.error_frame", "The bridge reported a lane error", {
            laneId: frame.laneId,
            reason,
          });
          break;
        }
        default:
          // Tolerant reader: a newer daemon may frame something this fieldd has
          // no opinion about, and that is not a reason to drop the socket.
          break;
      }
    }
  }

  #deliver(laneId: number, payload: Uint8Array): void {
    const handler = this.#handlers.get(laneId);
    if (handler !== undefined) {
      handler(payload);
      return;
    }
    const ttl = this.opts.orphanTtlMs ?? DEFAULT_ORPHAN_TTL_MS;
    const cap = this.opts.orphanMaxBytes ?? DEFAULT_ORPHAN_MAX_BYTES;
    // COPY before parking. A decoded payload is a view over the reader's whole
    // buffer, so holding one retains the entire socket read (up to 64 KB) for a
    // handful of bytes — `held.bytes` would then undercount actual retention by
    // orders of magnitude, and a watermark that measures the wrong thing is not
    // a watermark. The copy is paid once, on the rare unclaimed path.
    const parked = payload.slice();
    const held = this.#orphans.get(laneId);
    if (held === undefined) {
      const timer = setTimeout(() => this.#expireOrphan(laneId), ttl);
      timer.unref?.();
      this.#orphans.set(laneId, { chunks: [parked], bytes: parked.byteLength, timer });
      return;
    }
    if (held.bytes + payload.byteLength > cap) {
      // Shed rather than grow without bound. Reported, because silently losing
      // a doc update is the failure mode this whole plane exists to avoid.
      this.#logger.warn("fieldd.mesh_lane.orphan_overflow", "Unclaimed lane bytes were dropped", {
        laneId,
        heldBytes: held.bytes,
        droppedBytes: payload.byteLength,
      });
      return;
    }
    held.chunks.push(parked);
    held.bytes += parked.byteLength;
  }

  #expireOrphan(laneId: number): void {
    const held = this.#orphans.get(laneId);
    if (held === undefined) return;
    this.#orphans.delete(laneId);
    this.#logger.warn(
      "fieldd.mesh_lane.orphan_expired",
      "Bytes arrived for a lane that was never announced",
      { laneId, bytes: held.bytes, frames: held.chunks.length },
    );
  }

  #onClose(): void {
    this.connected = false;
    this.#helloSettled = false; // a reconnect gets a fresh handshake
    this.#expectedAckMac = null; // ...and a fresh challenge; never reuse the old proof
    this.#reader.reset();
    if (!this.#closed) this.emit("disconnected");
  }
}

/** WIN-10 — does this HELLO_OK body carry the proof we asked for? Any shape
 * that is not a matching string is a refusal: an unparseable body, a missing
 * field, and a wrong MAC are the same answer to the only question being asked. */
function safeServerMac(payload: Uint8Array, expected: string): boolean {
  try {
    const v = JSON.parse(new TextDecoder().decode(payload)) as { serverMac?: unknown };
    return typeof v.serverMac === "string" && ackMacMatches(expected, v.serverMac);
  } catch {
    return false;
  }
}

function safeReason(payload: Uint8Array): string {
  try {
    const v = JSON.parse(new TextDecoder().decode(payload)) as { reason?: unknown };
    return typeof v.reason === "string" ? v.reason : "unknown";
  } catch {
    return "unparseable";
  }
}
