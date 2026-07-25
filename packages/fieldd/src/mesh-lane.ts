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
import { computePairingMac } from "./pairing";

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
}

type LaneHandler = (payload: Uint8Array) => void;

const DEFAULT_ORPHAN_TTL_MS = 30_000;
const DEFAULT_ORPHAN_MAX_BYTES = 4 * 1024 * 1024;

export class MeshLaneLink extends EventEmitter {
  #sock: Socket | null = null;
  #reader = new MeshDataFrameReader();
  #handlers = new Map<number, LaneHandler>();
  #orphans = new Map<number, { chunks: Uint8Array[]; bytes: number; timer: NodeJS.Timeout }>();
  #closed = false;
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
    const helloOk = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("meshdata hello timed out")), 5_000);
      this.once("hello-ok", () => {
        clearTimeout(timer);
        resolve();
      });
      this.once("hello-refused", (reason: string) => {
        clearTimeout(timer);
        reject(new Error(`meshdata hello refused: ${reason}`));
      });
    });
    sock.write(
      encodeMeshDataJsonFrame(MESHDATA_FRAME.HELLO, 0, {
        bootId: this.opts.bootId,
        ts,
        mac,
      }),
    );
    await helloOk;
    this.connected = true;
  }

  /** Write opaque bytes to a lane. The lane must already be open (NativeLink's
   * `native.mesh.lane.open`); the bridge answers an unknown lane with an ERR
   * frame naming that lane, and the socket survives it. */
  send(laneId: number, payload: Uint8Array): void {
    if (!this.connected || this.#sock === null) {
      throw new Error("meshdata link is not connected");
    }
    this.#sock.write(encodeMeshDataFrame(MESHDATA_FRAME.DATA, laneId, payload));
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
          this.emit("hello-ok");
          break;
        case MESHDATA_FRAME.DATA:
          this.#deliver(frame.laneId, frame.payload);
          break;
        case MESHDATA_FRAME.ERR: {
          const reason = safeReason(frame.payload);
          if (!this.connected) this.emit("hello-refused", reason);
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
    const held = this.#orphans.get(laneId);
    if (held === undefined) {
      const timer = setTimeout(() => this.#expireOrphan(laneId), ttl);
      timer.unref?.();
      this.#orphans.set(laneId, { chunks: [payload], bytes: payload.byteLength, timer });
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
    held.chunks.push(payload);
    held.bytes += payload.byteLength;
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
    this.#reader.reset();
    if (!this.#closed) this.emit("disconnected");
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
