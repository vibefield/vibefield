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
import { reconnectDelayMs } from "./native-link";
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
  /** Item 206 — dial again after an established link drops, or after a redial fails, on fieldd's one back-off
   * (`reconnectDelayMs`: 500 ms doubling to 10 s), one timer at a time, "reconnecting" emitted with each delay. A
   * success resets it; `dialNow()` is the floor's trigger; a link `close()` ended never dials again (CP-1b). Off by
   * default: the daemon turns it on. A failed FIRST `connect()` arms nothing, so the boot keeps CP-1b's rule.
   * *Corrected 2026-11-06 (item 206's boot half; James ruled `meshdata-boot-redial` (a) at 22:56Z): a failed first
   * dial is not terminal for the boot. `dialLater()` arms the same back-off for a link that has never connected, and
   * the daemon calls it when its boot dial fails. A failed first `connect()` on its own still arms nothing.* */
  redial?: boolean;
}

type LaneHandler = (payload: Uint8Array) => void;
interface BarrierWaiter {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_ORPHAN_TTL_MS = 30_000;
const DEFAULT_ORPHAN_MAX_BYTES = 4 * 1024 * 1024;
/** Matches the inbound orphan cap: the same amount of unmoved data is the same
 * amount of trouble whichever direction it is stuck in. Exported (DS-5c): doc
 * sync paces its sends under it and chunks any record that alone would cross it. */
export const DEFAULT_SEND_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export class MeshLaneLink extends EventEmitter {
  #sock: Socket | null = null;
  #reader = new MeshDataFrameReader();
  #handlers = new Map<number, LaneHandler>();
  #barriers = new Map<number, BarrierWaiter>();
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
  /** Item 206 — the redial: its one timer, the attempts since the last success, the dial in flight, and whether
   * this run of failures has been logged (a run warns once, at its first failure). */
  #redialTimer: NodeJS.Timeout | null = null;
  #redialAttempts = 0;
  #redialing: Promise<void> | null = null;
  #redialFailing = false;

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
    sock.on("close", () => this.#onClose(sock));
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
    // Every listener is registered, so every one must be removed — `once` only
    // removes the one that fires, and every reconnect would otherwise leave the
    // others behind (MaxListenersExceededWarning at 11, then a slow leak); the
    // timer removes them too, where before it left both.
    //
    // Item 206 — the socket's own close settles the hello too: a bridge that closes the connection first (macOS
    // drops one whose accept could not get a descriptor; item 198) fails it now, not at the timer. The timer stays,
    // for a bridge that holds the socket and says nothing.
    const helloOk = new Promise<void>((resolve, reject) => {
      const settle = (error?: Error) => {
        clearTimeout(timer);
        this.off("hello-ok", onOk);
        this.off("hello-refused", onRefused);
        sock.off("close", onClosed);
        if (error === undefined) resolve();
        else reject(error);
      };
      const timer = setTimeout(() => settle(new Error("meshdata hello timed out")), 5_000);
      const onOk = () => settle();
      const onRefused = (reason: string) => settle(new Error(`meshdata hello refused: ${reason}`));
      const onClosed = () =>
        settle(new Error("the MeshData bridge closed the connection before HELLO_OK"));
      this.once("hello-ok", onOk);
      this.once("hello-refused", onRefused);
      sock.once("close", onClosed);
    });
    sock.write(
      encodeMeshDataJsonFrame(MESHDATA_FRAME.HELLO, 0, {
        bootId: this.opts.bootId,
        ts,
        mac,
        nonce,
      }),
    );
    try {
      await helloOk;
    } catch (error) {
      // a failed hello's socket is never used again, so it goes now, as NativeLink's failed dial does: a redial
      // must not leave one open connection behind per attempt
      sock.destroy();
      throw error;
    }
    this.connected = true;
    // item 206's boot half — every HELLO_OK says so, the first and each redial's: the daemon starts what its boot
    // skipped on the first one
    this.emit("connected");
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

  /** Fence the independent byte/control planes before `lane.close`.
   *
   * BARRIER is ordered behind earlier DATA on this socket. The bridge answers
   * only after those sends have entered the lane transport, so a subsequent
   * management close can reliably replay the transport's retained latest
   * lossy snapshot instead of racing an older one. */
  flush(laneId: number, timeoutMs = 5_000): Promise<void> {
    if (!this.connected || this.#sock === null) {
      return Promise.reject(new Error("meshdata link is not connected"));
    }
    const existing = this.#barriers.get(laneId);
    if (existing !== undefined) return existing.promise;

    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const timer = setTimeout(() => {
      const current = this.#barriers.get(laneId);
      if (current?.promise !== promise) return;
      this.#barriers.delete(laneId);
      current.reject(new Error(`meshdata barrier timed out for lane ${laneId}`));
    }, timeoutMs);
    timer.unref?.();
    this.#barriers.set(laneId, {
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer,
    });
    this.#sock.write(encodeMeshDataFrame(MESHDATA_FRAME.BARRIER, laneId, new Uint8Array()));
    return promise;
  }

  /** Bytes queued in the socket toward the bridge — the outbound watermark's
   * live reading, for callers pacing a large transfer. */
  get bufferedBytes(): number {
    return this.#sock?.writableLength ?? 0;
  }

  /** CP-1b — whether `close()` ended this link for good (a dropped socket is
   * not closed: `connect()` may dial it again, and the daemon's redial does). */
  get closed(): boolean {
    return this.#closed;
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

  /** Item 206 — NativeLink's `dialNow()`: the floor is back, so dial at once, and start the back-off over. */
  dialNow(): void {
    if (this.#closed || this.connected) return;
    if (this.#redialTimer !== null) clearTimeout(this.#redialTimer);
    this.#redialTimer = null;
    this.#redialAttempts = 0;
    this.#redial("floor");
  }

  /** Item 206's boot half — a first dial that failed is not terminal: arm the back-off for a link that has never
   * connected, as a drop arms it for one that had. Nothing for a link without `redial`, a closed one, a connected
   * one, or one already waiting or dialing. */
  dialLater(): void {
    this.#scheduleRedial();
  }

  close(): void {
    this.#closed = true;
    if (this.#redialTimer !== null) clearTimeout(this.#redialTimer);
    this.#redialTimer = null;
    this.connected = false;
    this.#helloSettled = false;
    for (const held of this.#orphans.values()) clearTimeout(held.timer);
    this.#orphans.clear();
    this.#handlers.clear();
    this.#rejectBarriers(new Error("meshdata link closed"));
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
        case MESHDATA_FRAME.BARRIER_OK:
          this.#settleBarrier(frame.laneId);
          break;
        case MESHDATA_FRAME.ERR: {
          const reason = safeReason(frame.payload);
          this.#settleBarrier(frame.laneId, new Error(`meshdata lane ${frame.laneId}: ${reason}`));
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

  #onClose(sock: Socket): void {
    // a stale socket (replaced by a later dial, or one close() ended) must not reset the current one's handshake
    if (sock !== this.#sock) return;
    const wasConnected = this.connected;
    this.connected = false;
    this.#helloSettled = false; // a reconnect gets a fresh handshake
    this.#expectedAckMac = null; // ...and a fresh challenge; never reuse the old proof
    this.#reader.reset();
    this.#rejectBarriers(new Error("meshdata link disconnected"));
    if (this.#closed) return;
    this.emit("disconnected");
    // an established link that drops is dialed again; a dial that fails is re-armed by #redial's own ending
    if (wasConnected) this.#scheduleRedial();
  }

  /** Item 206 — one timer at a time, on fieldd's one back-off; nothing for a closed, connected or dialing link. */
  #scheduleRedial(): void {
    if (this.opts.redial !== true || this.#closed || this.connected) return;
    if (this.#redialTimer !== null || this.#redialing !== null) return;
    const delay = reconnectDelayMs(this.#redialAttempts);
    this.#redialAttempts += 1;
    this.emit("reconnecting", delay);
    this.#redialTimer = setTimeout(() => {
      this.#redialTimer = null;
      this.#redial("dropped");
    }, delay);
    this.#redialTimer.unref?.();
  }

  /** Item 206 — one redial dial; its failure arms the next, and a run of failures warns once (item 198's policy). */
  #redial(why: "floor" | "dropped"): void {
    if (this.#closed || this.connected || this.#redialing !== null) return;
    this.#redialing = this.connect()
      .then(
        () => {
          this.#logger.info("fieldd.mesh_lane.redialed", "The MeshData link is back", {
            why,
            attempts: this.#redialAttempts,
          });
          this.#redialAttempts = 0;
          this.#redialFailing = false;
        },
        (error: unknown) => {
          if (this.#redialFailing) return;
          this.#redialFailing = true;
          this.#logger.warn(
            "fieldd.mesh_lane.redial_failed",
            "The MeshData link could not be dialed again; it is retried on the back-off",
            { why, error: String(error) },
          );
        },
      )
      .finally(() => {
        this.#redialing = null;
        this.#scheduleRedial();
      });
  }

  #settleBarrier(laneId: number, error?: Error): void {
    const waiter = this.#barriers.get(laneId);
    if (waiter === undefined) return;
    this.#barriers.delete(laneId);
    clearTimeout(waiter.timer);
    if (error === undefined) waiter.resolve();
    else waiter.reject(error);
  }

  #rejectBarriers(error: Error): void {
    for (const laneId of [...this.#barriers.keys()]) this.#settleBarrier(laneId, error);
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
