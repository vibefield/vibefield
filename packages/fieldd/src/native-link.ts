import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { performance } from "node:perf_hooks";
import {
  CONTRACTS_VERSION,
  isPipeEndpoint,
  MESH_CONTROL_LIMITS,
  MGMT_NOTIFICATIONS,
  NATIVE_SUPERVISION,
  NativeLastExit,
  NativeLastManager,
  NativeTickParams,
  NativeUnavailableDetails,
  PingAck,
  TerminalEndpoints,
  type TerminalRouteCell,
  TerminalRouteSnapshot,
  type TerminalWorkloadClass,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { ackMacMatches, computeAckMac, computePairingMac, newPairingNonce } from "./pairing";

// NativeLink (design-02 §3.3): the ONLY door to field-native. Owns the mgmt
// UDS connection: D8 pairing hello, request/response correlation, subscription
// replay on reconnect (P5 — reconnect = fresh snapshot), SUPERSEDED = fatal.
//
// Concurrency invariants (review-hardened):
// - subId routes are installed SYNCHRONOUSLY while processing the subscribe
//   response line, so a delta in the same socket chunk can never be dropped;
// - reconnect scheduling is idempotent (single timer), and close events from
//   stale sockets are ignored — there is never more than one live dial.
//
// Wedge evidence (WG-D0), emitted for the supervisor and settling nothing:
// - "deadline-miss" (NativeDeadlineMiss): a request settled TIMEOUT, with how
//   late its deadline timer itself fired — fieldd's own loop, not the floor;
// - "late-reply" (NativeLateReply): a reply came for a request that had
//   already settled TIMEOUT — the floor's reader and dispatch were moving,
//   only slowly. A late pong carries the floor's own clock.
//
// The wedge ladder's witnesses and lever (WG-D6, WG-E2, WG-E4;
// `draft/thinking-floor-wedge.md` §4, §5.3), for the supervisor:
// - "reply": a response to any request arrived — on time, late, or an error.
//   Only a reply proves the floor's reader and dispatch move, so it is the one
//   event that restarts the supervisor's kill clock;
// - "tick" (NativeTickParams): the floor's own liveness notification, pushed
//   from a task of its own. It proves the floor's runtime and writer alive and
//   says nothing of its reader;
// - every request but the heartbeat and the hello carries `deadlineAt` (unix
//   ms), so the floor answers TIMEOUT rather than run one fieldd gave up on;
// - `floorPid`: the pid the paired floor stated in its hello ack;
// - `redial()`: drop the paired connection and dial again at once. The
//   connection it replaces stays open, reading only, until a hello answers on
//   the new one — a hello the floor cannot answer supersedes nothing there, so
//   the old connection's ticks and late replies keep arriving.
//
// WG-D4 — the doors: while the supervisor holds the floor unresponsive, a
// request or subscription a product door makes (every method outside
// `native.lifecycle.*`, the supervision's own) is refused at once with
// UNAVAILABLE {service: "native", state: "unresponsive"} rather than waiting
// out its deadline on a floor that is not answering. The daemon sets the gate
// from the supervisor (`setDoorGate`); this link does not know the supervisor.

export class RpcCallError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
    public readonly retryable: boolean = false,
    public readonly details?: unknown,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "RpcCallError";
  }
}

export interface NativeLinkOptions {
  socketPath: string;
  pairingFile: string;
  /** fieldd's per-process boot id (stable across reconnects within one boot) */
  bootId: string;
  /** UA-2 — the user this pair serves; carried on the mgmt hello. */
  userId?: string;
  reconnect?: boolean;
  /** how long to wait for field-native to create socket/pairing on first boot */
  waitForDaemonMs?: number;
  /** Test seam; production uses NATIVE_MGMT_MAX_FRAME_BYTES. */
  maxFrameBytes?: number;
  /** TC-D2 — default deadline for ordinary requests. Test seam; production
   * uses NATIVE_SUPERVISION.REQUEST_DEADLINE_MS. Pre-TC-S1 this link waited
   * FOREVER, so a wedged floor froze every caller silently. */
  requestDeadlineMs?: number;
  /** Test seam; production uses HELLO_TIMEOUT_MS. How long an endpoint that has
   * ACCEPTED the connection may stay silent before the dial is abandoned. */
  helloTimeoutMs?: number;
  /** Test seam; production uses TIMED_OUT_RECORD_CAP. How many timed-out
   * requests are remembered so a late reply can still be attributed. */
  timedOutRecordCap?: number;
  logger?: Logger;
}

/** WG-D0 — the "deadline-miss" event: a request settled TIMEOUT. `firedLateMs`
 * is how far past its deadline the timer itself fired, read on a monotonic
 * clock. Node runs expired timers before it reads sockets, so a timer that
 * fired late is fieldd's own loop stalling — and a reply may have been sitting
 * unread in the socket the whole time. */
export interface NativeDeadlineMiss {
  method: string;
  deadlineMs: number;
  firedLateMs: number;
}

/** WG-D0 — the "late-reply" event: a reply to a request that had already
 * settled TIMEOUT. It settles nothing; its caller had its one answer. `lateByMs`
 * is how far past the deadline it arrived, `roundTripMs` how long after the
 * request was sent (both monotonic). `floorTs` is the `ts` of a late pong's
 * PingAck — the floor's own wall clock (unix ms) as it answered — and is
 * present for a pong only. */
export interface NativeLateReply {
  method: string;
  lateByMs: number;
  roundTripMs: number;
  floorTs?: number;
}

/** A request that settled TIMEOUT, remembered until its reply comes, its
 * connection goes, or newer ones push it past the cap. */
interface TimedOutRequest {
  method: string;
  /** `performance.now()` when its deadline timer was armed */
  sentAt: number;
  deadlineMs: number;
}

/** WG-D0 — the most timed-out requests remembered at once, oldest forgotten
 * first. A silent floor times out several heartbeat pings a second, so a long
 * silence outruns any cap: the record keeps the most recent, and a reply later
 * than the cap reaches back is dropped unattributed. The bound keeps a floor
 * that never answers from growing fieldd. */
const TIMED_OUT_RECORD_CAP = 256;

const PING_METHOD = "native.lifecycle.ping";
const HELLO_METHOD = "native.lifecycle.hello";

/** WG-D6 — the two requests that carry no `deadlineAt` (`RpcRequest`): the
 * heartbeat, whose late pong is evidence the ladder keeps (WG-E2), and the
 * hello, which keeps its own dial deadline. */
const DEADLINE_EXEMPT: ReadonlySet<string> = new Set([PING_METHOD, HELLO_METHOD]);

/** What a call in flight answers when the supervisor redials the link (WG-E4). */
const REDIALLED = "the management link was redialled";

/** The supervision's own verbs (the hello, the heartbeat, the update stop, the
 * floor's own streams): the door gate never holds these back (WG-D4). */
const LIFECYCLE_PREFIX = "native.lifecycle.";

/** WG-D4 — what the doors that ride the floor's mgmt path answer while the
 * floor is held unresponsive; undefined = the floor is answering. */
export type NativeDoorGate = () => NativeUnavailableDetails | undefined;

/** WG-D4 — is this the refusal a door answers while the floor is held
 * unresponsive (`NativeUnavailableDetails`)? It is the floor's state, and says
 * nothing of its units' — a reader of the mesh node's state must not take its
 * `state` for the node's. */
export function isNativeUnresponsive(error: unknown): boolean {
  return (
    error instanceof RpcCallError &&
    error.kind === "UNAVAILABLE" &&
    NativeUnavailableDetails.safeParse(error.details).success
  );
}

/** Large enough for the bounded 256-origin artifact snapshot, finite enough
 * that a compromised/native-buggy peer cannot grow fieldd without limit. */
export const NATIVE_MGMT_MAX_FRAME_BYTES = MESH_CONTROL_LIMITS.MGMT_FRAME_BYTES;
const NATIVE_MGMT_RETAINED_FRAME_BYTES = 1024 * 1024;
/** How long the handshake may take before the dial is abandoned. Generous
 * against a loaded box (field-native answers a hello in microseconds once it is
 * listening) and finite against something that accepts and never speaks.
 * *Corrected 2026-10-27 (AL-8a):* after a fieldd that went without a word, the
 * floor holds its ack until it has counted that fieldd's sessions afresh, at
 * most its `FRESH_COUNT_WAIT` (2 s, orphan.rs), a fifth of this. */
const HELLO_TIMEOUT_MS = 10_000;

/** Newline framing for one mgmt socket, bounded at `limit` bytes per frame.
 * The buffer grows to the largest frame seen and is dropped again after a
 * frame past NATIVE_MGMT_RETAINED_FRAME_BYTES has been read. */
class MgmtFramer {
  private buffer = Buffer.alloc(0);
  private bytes = 0;

  constructor(private readonly limit: number) {}

  /** Hands every complete, non-blank line in `chunk` to `onLine`, in order.
   * false = a frame outgrew the limit: the buffer is dropped, and the caller
   * closes the socket and reads nothing more from it. */
  feed(chunk: Buffer, onLine: (line: string) => void): boolean {
    let offset = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline === -1 ? chunk.length : newline;
      if (!this.append(chunk.subarray(offset, end))) return false;
      if (newline === -1) return true;

      const text = this.buffer.toString("utf8", 0, this.bytes);
      this.bytes = 0;
      if (this.buffer.length > NATIVE_MGMT_RETAINED_FRAME_BYTES) this.buffer = Buffer.alloc(0);
      if (text.trim()) onLine(text);
      offset = newline + 1;
      if (offset >= chunk.length) return true;
    }
  }

  private append(segment: Buffer): boolean {
    const required = this.bytes + segment.length;
    if (required > this.limit) {
      this.buffer = Buffer.alloc(0);
      this.bytes = 0;
      return false;
    }
    if (segment.length > 0) {
      if (required > this.buffer.length) {
        const capacity = Math.min(
          this.limit,
          Math.max(required, Math.max(4_096, this.buffer.length * 2)),
        );
        const next = Buffer.allocUnsafe(capacity);
        this.buffer.copy(next, 0, 0, this.bytes);
        this.buffer = next;
      }
      segment.copy(this.buffer, this.bytes);
      this.bytes = required;
    }
    return true;
  }
}

/** WG-E4 — the paired connection a redial replaced, kept open and read until a
 * hello answers on the new one. Nothing is sent on it. */
interface Witness {
  sock: Socket;
  /** the pid its floor stated in the hello that paired it */
  pid: number | undefined;
}

/** Reject with `message` if `work` has not settled within `ms`. The timer is
 * always cleared, and a late rejection from `work` is swallowed rather than
 * left to become an unhandled rejection after the race is decided. */
async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new RpcCallError("UNAVAILABLE", message, true)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void work.catch(() => undefined);
  }
}

type SubEventKind = "snapshot" | "delta";
interface QueuedSubEvent {
  payload: unknown;
  kind: SubEventKind;
}
interface SubEntry {
  method: string;
  params: unknown;
  onEvent: (payload: unknown, kind: SubEventKind) => void;
  subId?: string;
  /** Hold deltas while a subscribe response's snapshot is being applied. */
  buffering: boolean;
  queued: QueuedSubEvent[];
  activation?: NodeJS.Immediate;
}
interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  /** set for subscribe requests: the local sub key whose route must be
   * installed synchronously when the response line is processed */
  subKey?: number;
}

/** AL-8a — how long a stopping fieldd gives the floor to note its goodbye. */
const DETACH_DEADLINE_MS = 1_000;

export class NativeLink extends EventEmitter {
  private sock: Socket | null = null;
  private connectingSock: Socket | null = null;
  private dialPromise: Promise<void> | null = null;
  /** WG-E4 — the connection a redial replaced, while no hello has answered since */
  private witness: Witness | null = null;
  /** WG-D4 — set by the daemon from the floor's supervisor */
  private doorGate: NativeDoorGate | null = null;
  /** WG-D6 — the pid stated in the last hello ack (`HelloAck.pid`), which
   * belongs to `sock`; `floorPid` reads it while that socket is paired */
  private pairedPid: number | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** WG-D0 — requests that settled TIMEOUT on the live socket, by id, in the
   * order they timed out (bounded by TIMED_OUT_RECORD_CAP). */
  private timedOut = new Map<number, TimedOutRequest>();
  private subs = new Map<number, SubEntry>();
  private subRoutes = new Map<string, number>(); // subId -> local sub key
  private nextSubKey = 1;
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** True once the TC-D15 route stream has EVER been armed — from then on the
   * ordinary replay path re-subscribes it at every reconnect, so the arm itself
   * never runs twice. Staying false is what keeps a REFUSED arm re-armable on
   * the next dial (NF-6's re-arm law: never once-and-throw). */
  private terminalRoutesSubscribed = false;
  private readonly logger: Logger;

  connected = false;
  superseded = false;
  closed = false;
  /** NF-D8: the terminal floor's endpoints + per-boot token, re-learned at
   * every re-pair from the hello ack. Absent = the floor is unconfigured, the
   * daemon predates NF-2, or the link that vouched for it is DOWN (tolerated —
   * readers refuse honestly, never guess). The token lives here and in the
   * tickets minted from it — never logs, env, or disk.
   *
   * GT-5b: this is a LIVE credential, not a remembered fact, and it is worth
   * exactly as long as the mgmt link that carried it. It used to be assigned in
   * one place and cleared in none, so after a field-native SIGKILL every reader
   * still saw a floor: `terminal.ticket()` handed out socket paths that no
   * longer existed plus a dead boot's token, the audit recorded the grant as a
   * success, and `system.health` reported the device as a terminal host.
   *
   * TC-S3: with K=2 class cells this is one cell's coordinates, not "the
   * floor's" — the INTERACTIVE class's create target (see `cellEndpoints`).
   * Consumers that route by class or by session read `terminalRoutes`; this
   * stays the reading a pre-routes consumer means. */
  terminalEndpoints: TerminalEndpoints | undefined;
  /** TC-D15: the revisioned route snapshot `terminalEndpoints` is DERIVED from,
   * kept whole for the consumers that need the cell's identity rather than its
   * coordinates — `cellBootId` is the only thing that tells a replaced engine
   * apart from a re-pair to the same one (pids recycle; ordinals repeat across
   * floor boots; the token is a credential, not an identity). Undefined means
   * the floor never sent one: a pre-TC-S2 floor, whose legacy `terminal` mirror
   * is then the only reading, or a link that is down. */
  terminalRoutes: TerminalRouteSnapshot | undefined;
  /** GT-2d: the floor's own build label, re-learned at every re-pair. This
   * plane outlives us and is adopted by design, so "which field-native answered"
   * is a real question — undefined means the daemon predates GT-2d, which is
   * itself an answer (it is at least that old). */
  nativeBuild: string | undefined;
  /** WP12 L2b (`build-wp12-updater.md` §9 R3) — how the floor before this one ended (`HelloAck.lastExit`), taken
   * from its restart intent at its boot. undefined = the floor did not say (it predates the field, or runs
   * embedded) — never read as `unplanned`. Provenance for health and the logs, never parsed for behavior. */
  lastExit: NativeLastExit | undefined;
  /** AL-8a (`thinking-app-lifecycle.md` §8.3.1) — how the management client before this one left the floor
   * (`HelloAck.lastManager`), believed on THIS process's first hello alone: a re-pair's record is about this fieldd's
   * own dropped connection, never another fieldd's crash. The daemon takes it once (undefined after). */
  lastManager: NativeLastManager | undefined;
  private pairedOnce = false;
  /** TM-1/TM-2 (MF-1l) — "this floor's terminal doors are PUBLISHED on the
   * tailnet", the floor's own word (`HelloAck.terminalMesh`), re-learned at
   * every re-pair.
   *
   * The fact MF-1h said was owed and could not be read. It is deliberately
   * SECRET-FREE: the only mgmt verb that revealed the same truth handed over
   * the mirror-write capability itself, so the honest gate had to wait for a
   * boolean. (That verb is deleted as of TM-3, 2026-09-14 — this boolean is now
   * the only reading of the fact, not merely the safe one.) Everything that
   * used to guess from a NEIGHBOURING consent (the product serve being active)
   * now reads this.
   *
   * TRUE needs BOTH halves on the floor's side (TM-1, envelope.ts): it was
   * asked to publish AND its gateway node was up as the ack was written. So a
   * flag over a gateway that never came up reads FALSE here, which is the
   * false positive the field exists to close — and it means this reading can
   * legitimately differ between two hellos of one floor BOOT.
   *
   * `undefined` means the floor did not answer the question — a floor older
   * than TM-1, which this plane outliving fieldd makes an ordinary case, not a
   * hypothetical. Absence is read as FALSE by every consumer: publishing a
   * tappable card for a session nothing can attach to is the failure this
   * field exists to prevent, so "I don't know" and "no" get the same,
   * conservative answer. `terminalMeshPublished()` is that reading, and it is
   * the only one callers should use.
   *
   * E-F1 — the hello is no longer the only writer, and it could not be: the
   * ack is composed at a moment the answer is predictably FALSE (the floor's
   * mesh node is installed by a spawned bring-up task that returns before the
   * node exists, while the mgmt listener binds immediately after start_all and
   * this link hellos as soon as the socket answers), and nothing re-hellos. The
   * floor therefore PUSHES the correction on the routes stream, and
   * `applyTerminalRoutes` writes it here. A payload WITHOUT the field says
   * nothing about the mesh and leaves this alone — that is what a floor
   * predating E-F1 sends, and reading it as `false` would be inventing a
   * reading nobody made. */
  terminalMesh: boolean | undefined;

  /** The gate every TM-2 consumer reads: the doors are on the tailnet, and
   * the link that vouched for that is live. */
  terminalMeshPublished(): boolean {
    return this.connected && this.terminalMesh === true;
  }

  /** WG-D6 — the pid the floor at the other end of a paired connection stated
   * in its hello ack (`HelloAck.pid`): the paired link's, or, while a redial's
   * hello has not answered, the replaced connection's (it is still the floor's
   * paired client there). undefined when no paired connection is open, or the
   * floor predates WG-D6 and stated none.
   *
   * It is the paired floor's word: it arrives on the connection whose answerer
   * proved the pairing secret (WIN-10), and Node exposes no peer credential on
   * a local socket to check it against. A target for the supervisor's stops,
   * never an authority — what the stop may end is still the census's and the
   * person's (WG-E6). */
  get floorPid(): number | undefined {
    if (this.connected) return this.pairedPid;
    return this.witness?.pid;
  }

  constructor(private readonly opts: NativeLinkOptions) {
    super();
    // The daemon wires its consumers of this link once, for its own life, and
    // the fan-out is fixed: eleven `connected` listeners as of PG-1d (daemon.ts
    // seven and its gate watcher, the diagnostics service, the mesh client and
    // the native supervisor). Node's default of ten is a leak heuristic; a bound
    // with room keeps it for a real leak without warning on every boot.
    this.setMaxListeners(20);
    this.logger = opts.logger ?? createNoopLogger();
  }

  /** Waits for field-native's pairing file + socket (it creates both), dials, hellos. */
  async connect(): Promise<void> {
    this.assertOpen();
    if (this.connected) return;
    const deadline = Date.now() + (this.opts.waitForDaemonMs ?? 10_000);
    let lastTransportFailure: unknown;
    while (Date.now() <= deadline) {
      this.assertOpen();
      // WIN-D1: the pairing file is a real file on every platform, but the
      // endpoint is a filesystem node only on unix — a named pipe never
      // appears on disk, so there the dial attempt itself is the probe.
      if (
        existsSync(this.opts.pairingFile) &&
        (isPipeEndpoint(this.opts.socketPath) || existsSync(this.opts.socketPath))
      ) {
        try {
          await this.dial();
          return;
        } catch (error) {
          if (!isRetryableInitialTransportFailure(error)) throw error;
          lastTransportFailure = error;
        }
      }
      await sleep(100);
    }
    const detail = lastTransportFailure instanceof Error ? `: ${lastTransportFailure.message}` : "";
    throw new Error(`field-native did not come up before the readiness deadline${detail}`, {
      cause: lastTransportFailure,
    });
  }

  /** Coalesces callers so there is never more than one connection attempt. */
  private dial(): Promise<void> {
    if (this.dialPromise) return this.dialPromise;
    let tracked: Promise<void>;
    tracked = this.performDial().finally(() => {
      if (this.dialPromise === tracked) this.dialPromise = null;
    });
    this.dialPromise = tracked;
    return tracked;
  }

  private async performDial(): Promise<void> {
    this.assertOpen();
    const sock = await this.openSocket();
    if (this.closed || this.superseded) {
      sock.destroy();
      this.assertOpen();
    }
    this.sock = sock;
    const framer = new MgmtFramer(this.opts.maxFrameBytes ?? NATIVE_MGMT_MAX_FRAME_BYTES);
    sock.on("data", (d) => {
      // a stale socket's data is dropped; a redial's replaced one is still read
      if (sock !== this.sock && sock !== this.witness?.sock) return;
      if (!framer.feed(d, (line) => this.routeLine(sock, line))) this.frameTooLarge(sock);
    });
    sock.on("close", () => this.onSockClose(sock));
    sock.on("error", () => {
      /* close follows */
    });
    try {
      await this.hello();
      await this.replaySubscriptions();
      this.assertOpen();
      this.connected = true;
      this.attempts = 0;
      // WG-E4 — a hello answered here has superseded the replaced connection
      // at the floor; it has nothing left to witness
      this.dropWitness();
      this.emit("connected");
      // TC-D15 — armed AFTER the dial, at the same instant the daemon arms its
      // own observed subscription (`native.on("connected", …)`), and for the
      // same two reasons. It must not be able to fail a dial: the hello ack has
      // already delivered the CURRENT snapshot, so the stream only adds future
      // deltas and a floor too old to serve it must still boot. And it must not
      // change what a dial can fail WITH: put inside the dial, this extra
      // request became the first thing a mid-boot takeover could land on, and
      // "superseded" — fatal, specific, and the daemon's whole shutdown trigger
      // — surfaced as a generic closed-link error instead.
      void this.ensureTerminalRoutes();
    } catch (e) {
      // this socket is unusable: detach it FIRST so its close event is stale,
      // then fail anything in flight — exactly one reconnect gets scheduled
      // by whoever catches this rejection (or by connect()'s caller).
      if (this.sock === sock) {
        this.sock = null;
        this.connected = false;
      }
      sock.destroy();
      // Detaching first makes this socket's own close event stale, so
      // onSockClose returns early and never reaches the clear — do it here.
      // A dial that failed AFTER hello (a refused replay) has already assigned
      // fresh endpoints from that hello, and they must not outlive the link.
      this.clearTerminalEndpoints();
      this.failPending();
      throw e;
    }
  }

  private async openSocket(): Promise<Socket> {
    return await new Promise<Socket>((resolve, reject) => {
      const sock = createConnection(this.opts.socketPath);
      this.connectingSock = sock;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        sock.off("connect", onConnect);
        sock.off("error", onError);
        sock.off("close", onClose);
        if (this.connectingSock === sock) this.connectingSock = null;
        fn();
      };
      const onConnect = () => finish(() => resolve(sock));
      const onError = (error: Error) => finish(() => reject(error));
      const onClose = () =>
        finish(() =>
          reject(new RpcCallError("UNAVAILABLE", "mgmt connection closed while dialing", true)),
        );
      sock.once("connect", onConnect);
      sock.once("error", onError);
      sock.once("close", onClose);
      if (this.closed || this.superseded) sock.destroy();
    });
  }

  private assertOpen(): void {
    if (this.closed || this.superseded)
      throw new RpcCallError("UNAVAILABLE", "native link is closed", false);
  }

  private async hello(): Promise<void> {
    const secretHex = readFileSync(this.opts.pairingFile, "utf8").trim();
    const ts = Math.floor(Date.now() / 1000);
    const mac = computePairingMac(secretHex, this.opts.bootId, ts);
    const nonce = newPairingNonce();
    // The hello keeps its OWN deadline. TC-D2 has since given every request a
    // default deadline (so "nothing else bounds this one" stopped being true
    // when that landed), but the hello's bound predates it and stays: a silent
    // endpoint here is a DIAL that failed — UNAVAILABLE and retryable, with a
    // message that names the handshake — not wedge evidence on an established
    // link. That silence is not hypothetical on win32: the pipe namespace is
    // flat (WIN-D1), so a squatter that cannot pass the WIN-10 proof can still
    // simply stall, and silence would otherwise be a better attack than a
    // wrong answer.
    const ack = await withTimeout(
      this.request(HELLO_METHOD, {
        contractsVersion: CONTRACTS_VERSION,
        minCompatible: CONTRACTS_VERSION,
        clientKind: "fieldd",
        credential: { bootId: this.opts.bootId, ts, mac, nonce },
        // UA-2 — the pair asserts which user it serves, on the mgmt surface too;
        // field-native carries it tolerantly (no consumer until UA-5).
        ...(this.opts.userId !== undefined ? { userId: this.opts.userId } : {}),
      }),
      this.opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS,
      "the native plane accepted the connection but never answered the hello",
    );
    // WIN-10 — before ANY of this ack is believed, the answerer must prove it
    // holds the pairing secret. Our own MAC above only proved US. On unix the
    // 0700 run directory proved the server structurally; the flat Windows pipe
    // namespace (WIN-D1) does not, and a squatter that wins the bind race is
    // dialled by a fieldd whose connect-probe reads it as a live native. Such a
    // squatter's ack could name its OWN terminal control/frame endpoints and
    // auth token, which fieldd would then use — this refusal is what stops it.
    // Refusing an ABSENT proof is the point: an attacker downgrades otherwise.
    const record = (ack ?? {}) as {
      /** TM-1 (MF-1l) — the floor's word that its terminal doors are on the
       * tailnet (`HelloAck.terminalMesh`, landed on main 2026-09-14). Read as
       * `unknown` like every other field on this record, and narrowed below:
       * the ack is a tolerant reading of a plane that OUTLIVES fieldd, so the
       * shape a live floor actually sent is what decides, never the schema
       * this build happens to carry. */
      terminalMesh?: unknown;
      terminal?: unknown;
      terminalRoutes?: unknown;
      nativeBuild?: unknown;
      lastExit?: unknown;
      lastManager?: unknown;
      pid?: unknown;
      serverMac?: unknown;
    };
    const expected = computeAckMac(secretHex, nonce, this.opts.bootId);
    if (typeof record.serverMac !== "string" || !ackMacMatches(expected, record.serverMac)) {
      throw new RpcCallError(
        "UNAUTHORIZED",
        typeof record.serverMac === "string"
          ? "the native plane answered with an invalid pairing proof — refusing to pair"
          : "the native plane did not prove possession of the pairing secret — refusing to " +
              "pair (a field-native predating WIN-10 must be restarted once)",
        false,
      );
    }
    // NF-D8: a fresh native boot means fresh endpoints + token; a re-pair to
    // the same boot re-delivers the same ones. The tolerant gate keeps a
    // malformed/absent field as "no floor" rather than a poisoned value.
    //
    // TC-D15: the hello delivers the CURRENT route state, and it is the truth
    // whenever the floor speaks it — `terminal` is the LEGACY single-cell
    // mirror the floor keeps in lockstep, and the only reading a pre-TC-S2
    // floor offers at all. PREFERRED, never merged: two readings of one floor
    // that disagree would be a coin toss, and only the snapshot carries the
    // cell's identity and revision.
    const routes = TerminalRouteSnapshot.safeParse(record.terminalRoutes);
    this.terminalRoutes = routes.success ? routes.data : undefined;
    if (routes.success) {
      this.terminalEndpoints = cellEndpoints(routes.data);
    } else {
      const parsed = TerminalEndpoints.safeParse(record.terminal);
      this.terminalEndpoints = parsed.success ? parsed.data : undefined;
    }
    // GT-2d: read on its own terms, so a floor whose endpoints are malformed
    // still says who it is (and the reverse). Anything but a string is a floor
    // that did not answer the question — the same honest blank a pre-GT-2d
    // daemon leaves, never a guess.
    this.nativeBuild = typeof record.nativeBuild === "string" ? record.nativeBuild : undefined;
    // WP12 L2b — on its own terms like the label: anything outside the vocabulary is a floor that did not say.
    const lastExit = NativeLastExit.safeParse(record.lastExit);
    this.lastExit = lastExit.success ? lastExit.data : undefined;
    // AL-8a — on its own terms like `lastExit`, and on the first hello of this process only
    const lastManager = NativeLastManager.safeParse(record.lastManager);
    if (!this.pairedOnce) this.lastManager = lastManager.success ? lastManager.data : undefined;
    this.pairedOnce = true;
    // TM-1/TM-2 (MF-1l): read on its own terms like `nativeBuild`, and for the
    // same reason — a floor whose ROUTES are malformed still answers "are the
    // doors published", and the reverse. Anything but a boolean is a floor
    // that did not answer, which `terminalMeshPublished()` reads as no.
    this.terminalMesh = typeof record.terminalMesh === "boolean" ? record.terminalMesh : undefined;
    // WG-D6 — on its own terms like the label: anything but a pid (an integer
    // ≥ 1, `HelloAck.pid`) is a floor that did not state one.
    this.pairedPid =
      typeof record.pid === "number" && Number.isSafeInteger(record.pid) && record.pid >= 1
        ? record.pid
        : undefined;
    this.emit("terminal-endpoints");
  }

  /** TC-D15 — arm the route stream once. From then on NativeLink's ordinary
   * replay re-subscribes it at every reconnect (P5 — reconnect = fresh
   * snapshot), which IS the law's "re-read on reconnect" half; the hello ack
   * has already re-read it once by the time the replay lands, and the second
   * reading is idempotent because both carry the same revision.
   *
   * NEVER throws, by the same law `TerminalService.ensureStarted` states: a
   * refusal is neither fatal nor permanent. A pre-TC-S2 floor has no such
   * method and must keep working from the hello ack's legacy mirror alone, and
   * a link that died between the dial and this call has a reconnect coming — so
   * both are logged and re-armed on the next connect, never once-and-thrown
   * (this runs detached, where a rejection would have nowhere to go anyway). */
  private async ensureTerminalRoutes(): Promise<void> {
    if (this.terminalRoutesSubscribed) return;
    try {
      const { snapshot } = await this.subscribe(
        "native.lifecycle.terminal.routes.subscribe",
        {},
        (payload, kind) => this.applyTerminalRoutes(payload, kind),
      );
      this.terminalRoutesSubscribed = true;
      this.applyTerminalRoutes(snapshot, "snapshot");
    } catch (error) {
      this.logger.debug(
        "fieldd.native_link.terminal_routes_subscribe_refused",
        "The terminal route subscription was refused; it re-arms on the next connect",
        { error },
      );
    }
  }

  /** TC-D15 — routes are revisioned STATE and every delta is a FULL snapshot,
   * so snapshots and deltas apply through one path: state transfer, never
   * edges. That is what makes a MISSED delta self-repairing (the next one
   * carries the whole truth) and a REPEATED one free.
   *
   * `revision` is the change key, not a deep-equal: the floor's own ordering
   * key is right here, and re-sending identical state — which the reconnect
   * path does on purpose — must not read as a change to consumers that drop
   * live connections on the event.
   *
   * A payload that is not a snapshot keeps the last good one (tolerant reader,
   * with its logging half). Debug, not warn: a floor that answers a generic
   * subscription payload here is a capability gap rather than an anomaly, and
   * the endpoints in hand are still the ones the hello vouched for.
   *
   * E-F1 — this stream also carries the floor's LIVE `terminalMesh`, and it is
   * read BEFORE the revision short-circuit below on purpose. The node flip that
   * the field exists to catch moves no route state, so the floor re-sends the
   * unchanged snapshot under the new boolean; keying only on `revision` would
   * discard exactly the message this was built to deliver. */
  private applyTerminalRoutes(payload: unknown, kind: SubEventKind): void {
    // The mesh reading first, and on its OWN terms — a floor whose routes are
    // malformed still answers "are the doors published", the same split the
    // hello ack already makes for `nativeBuild`. ABSENT is not `false`: it is a
    // payload that says nothing about the mesh (every floor predating E-F1
    // sends exactly that), so the hello's answer stands.
    const streamed = (payload as { terminalMesh?: unknown } | null | undefined)?.terminalMesh;
    let meshMoved = false;
    if (typeof streamed === "boolean" && streamed !== this.terminalMesh) {
      this.terminalMesh = streamed;
      meshMoved = true;
    }
    const parsed = TerminalRouteSnapshot.safeParse(payload);
    if (!parsed.success) {
      this.logger.debug(
        "fieldd.native_link.terminal_routes_unparsed",
        "A terminal routes payload was not a TerminalRouteSnapshot; routes unchanged",
        { kind },
      );
      // E-F1 — the two readings are independent: a payload whose ROUTE half is
      // unreadable can still have carried a readable mesh boolean, and a
      // consumer that gated on the doors being published must hear it.
      if (meshMoved) this.emit("terminal-endpoints");
      return;
    }
    // MF-2i — the floor's ROUTE-SNAPSHOT DISCLOSURE rule, read from this side
    // (`packages/field-native/src/mgmt/mod.rs`, `disclosed_routes`, which states
    // it in full). An UNREVISED empty snapshot is the floor's watch-channel
    // initial, not a reading: the mesh-flagged in-process serve holds it forever
    // while the hello's LEGACY mirror carries that floor's real endpoints, so
    // resolving it to "no endpoints" would throw away the very coordinates the
    // ack just vouched for — QA 2026-09-13 finding 2, where `device.list`
    // answered `terminalHost: false` and `terminal.create` refused on a floor
    // that was serving PTYs throughout.
    //
    // A fixed floor never sends this (it withholds the snapshot, and the
    // tolerant branch above is what receives that absence). The guard is for the
    // floor that PREDATES the rule: this plane outlives fieldd and is adopted by
    // design (GT-2d), so a running daemon older than this build is the ordinary
    // case, not a hypothetical.
    //
    // NARROW ON PURPOSE: the guard fires only when there is a hello-vouched
    // mirror to protect (`terminalEndpoints` present) and no snapshot has ever
    // been accepted (`terminalRoutes` absent). A cell floor ANNOUNCES itself
    // with an empty snapshot at revision 1 (TC-D15 — see `disclosed_routes` in
    // packages/field-native/src/mgmt/mod.rs), so nothing this guard withholds
    // was ever a cell floor's reading, and the birth wait in
    // terminal-service.ts (`awaitEndpoints`) still gets the announcement it
    // keys on. Once a real revision has landed, every later snapshot rules,
    // empty `cells` included. Debug, not warn: an old floor is a capability
    // gap, not an anomaly.
    if (
      parsed.data.revision === 0 &&
      parsed.data.cells.length === 0 &&
      this.terminalRoutes === undefined &&
      this.terminalEndpoints !== undefined
    ) {
      this.logger.debug(
        "fieldd.native_link.terminal_routes_unrevised",
        "An unrevised empty route snapshot never replaces the hello's legacy endpoints; routes unchanged",
        { kind },
      );
      return;
    }
    if (this.terminalRoutes?.revision === parsed.data.revision) {
      // E-F1 — the revision is the ROUTE change key and nothing else. A node
      // arriving after the hello re-sends the unchanged snapshot under a new
      // boolean, which is the whole delivery mechanism; returning silently here
      // would drop it.
      if (meshMoved) this.emit("terminal-endpoints");
      return;
    }
    this.terminalRoutes = parsed.data;
    this.terminalEndpoints = cellEndpoints(parsed.data);
    this.emit("terminal-endpoints");
  }

  /** GT-5b: forget the floor's coordinates when the link that vouched for them
   * stops being live. The mgmt socket closing is the ONLY signal fieldd gets
   * that the floor may be gone — field-native mints a new token per boot, so a
   * remembered one either belongs to a corpse or is about to be re-delivered
   * by the next hello, and there is no third case worth guessing at.
   *
   * The cost is honest and deliberate: a transient link blip makes the ticket
   * doors answer UNAVAILABLE for the length of one reconnect (500ms first
   * backoff) rather than hand out a credential fieldd cannot currently vouch
   * for. `nativeBuild` is left alone — it is a label, not a credential, and
   * clearing it would make "this floor predates GT-2d" and "the link is down"
   * the same blank.
   *
   * TC-D15: the route snapshot goes with them. It carries the same per-boot
   * token and the same live-credential bargain, and a remembered route is
   * exactly the stale shape this method exists to close. A REVISED snapshot
   * whose `cells` are EMPTY is still a live reading — it says the floor's cell
   * system currently has no engine — so losing it is a real transition and is
   * announced too, which is why the guard below reads both fields and not just
   * the endpoints. (MF-2i draws the line that sentence assumed: it is the
   * revision that makes a snapshot a reading. An UNREVISED empty one is the
   * floor's initial, never accepted here, so it is never one of the readings
   * this method clears — see `applyTerminalRoutes`.)
   *
   * Silent when there was nothing to clear: no change, no event. */
  private clearTerminalEndpoints(): void {
    if (this.terminalEndpoints === undefined && this.terminalRoutes === undefined) return;
    this.terminalEndpoints = undefined;
    this.terminalRoutes = undefined;
    this.emit("terminal-endpoints");
  }

  /** One line from one of the link's sockets, read as that socket's role is
   * NOW: the paired (or pairing) connection's, or the replaced one's. */
  private routeLine(sock: Socket, line: string): void {
    if (sock === this.sock) this.onLine(line);
    else if (sock === this.witness?.sock) this.onWitnessLine(line);
  }

  private frameTooLarge(sock: Socket): void {
    this.logger.error(
      "fieldd.native_link.frame_too_large",
      "The native management connection sent an oversized frame",
      { limit: this.opts.maxFrameBytes ?? NATIVE_MGMT_MAX_FRAME_BYTES },
    );
    sock.destroy();
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // tolerant: garbage lines never fatal
    }
    if (msg["id"] !== undefined && msg["id"] !== null) {
      // WG-E2 — any response, on time or late, a result or an error, proves
      // the floor's reader and dispatch moved: the supervisor's clock reads it
      this.emit("reply");
      const p = this.pending.get(msg["id"] as number);
      if (!p) {
        this.noteLateReply(msg["id"] as number, msg["result"]);
        return;
      }
      this.pending.delete(msg["id"] as number);
      const err = msg["error"] as
        | {
            code?: number;
            message?: string;
            data?: { kind?: string; retryable?: boolean; details?: unknown };
          }
        | undefined;
      if (err) {
        p.reject(
          new RpcCallError(
            err.data?.kind ?? "INTERNAL",
            err.message ?? "rpc error",
            err.data?.retryable ?? false,
            err.data?.details,
            err.code,
          ),
        );
        return;
      }
      // install the subscription route BEFORE resolving — a delta in the same
      // chunk is processed synchronously right after this line and must route
      if (p.subKey !== undefined) {
        const subId = (msg["result"] as { subId?: unknown } | undefined)?.subId;
        if (typeof subId !== "string") {
          p.reject(
            new RpcCallError(
              "INTERNAL",
              "subscription response did not include a string subId",
              false,
            ),
          );
          return;
        }
        this.subRoutes.set(subId, p.subKey);
        const sub = this.subs.get(p.subKey);
        if (sub) sub.subId = subId;
      }
      p.resolve(msg["result"]);
      return;
    }
    // notification
    const method = msg["method"] as string | undefined;
    const params = msg["params"] as { subId?: string; payload?: unknown } | undefined;
    if (method === "native.lifecycle.superseded") {
      this.superseded = true;
      this.emit("superseded");
      this.sock?.destroy();
      return;
    }
    if (method === MGMT_NOTIFICATIONS.TICK) {
      this.noteTick(msg["params"]);
      return;
    }
    if (params?.subId && (method?.endsWith(".delta") || method?.endsWith(".snapshot"))) {
      const key = this.subRoutes.get(params.subId);
      const sub = key === undefined ? undefined : this.subs.get(key);
      if (sub) {
        const event: QueuedSubEvent = {
          payload: params.payload,
          kind: method.endsWith(".snapshot") ? "snapshot" : "delta",
        };
        if (sub.buffering) sub.queued.push(event);
        else sub.onEvent(event.payload, event.kind);
      }
    }
  }

  /** WG-E4 — a line on the connection a redial replaced. A response there is a
   * reply like any other (the old reader moved, late), and a tick is the
   * floor's tick; nothing settles. Everything else is ignored: its deltas
   * belong to subscriptions replayed on the new connection, and its
   * `superseded` is the floor answering this link's own new hello — never a
   * takeover. */
  private onWitnessLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg["id"] !== undefined && msg["id"] !== null) {
      this.emit("reply");
      return;
    }
    if (msg["method"] === MGMT_NOTIFICATIONS.TICK) this.noteTick(msg["params"]);
  }

  /** WG-D6 — the floor's own tick, re-emitted as "tick". It settles nothing
   * and is never a reply. A malformed one is a floor that did not say
   * (tolerant reader, logged at debug). */
  private noteTick(params: unknown): void {
    const tick = NativeTickParams.safeParse(params);
    if (!tick.success) {
      this.logger.debug(
        "fieldd.native_link.tick_unparsed",
        "A floor tick was not a NativeTickParams; ignored",
      );
      return;
    }
    this.emit("tick", tick.data);
  }

  private dropWitness(): void {
    const witness = this.witness;
    if (witness === null) return;
    this.witness = null;
    witness.sock.destroy();
  }

  private onSockClose(sock: Socket): void {
    if (sock === this.witness?.sock) {
      // the replaced connection ended: superseded by a later hello, or its floor is gone
      this.witness = null;
      return;
    }
    if (sock !== this.sock) return; // stale socket — already replaced or detached
    this.sock = null;
    this.connected = false;
    this.clearTerminalEndpoints();
    this.failPending();
    this.subRoutes.clear();
    this.prepareSubscriptionsForReconnect();
    if (this.closed || this.superseded || this.opts.reconnect === false) {
      this.emit("closed");
      return;
    }
    this.scheduleReconnect();
  }

  /** Idempotent: at most one reconnect timer exists at any moment. */
  private scheduleReconnect(): void {
    if (this.closed || this.superseded || this.opts.reconnect === false) return;
    if (this.reconnectTimer || this.sock) return;
    const delay = Math.min(500 * 2 ** this.attempts, 10_000);
    this.attempts += 1;
    this.emit("reconnecting", delay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.dial().catch(() => this.scheduleReconnect());
    }, delay);
  }

  /** TC-D1 — the supervisor just (re)spawned the floor: dial NOW instead of
   * waiting out the exponential backoff (worst 10s) earned dialing a corpse.
   * A too-early dial just fails into a fresh 500ms schedule. */
  dialNow(): void {
    if (this.closed || this.superseded || this.sock) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.attempts = 0;
    this.dial().catch(() => this.scheduleReconnect());
  }

  /** WG-E4 — the supervisor's reversible step: drop the paired connection and
   * dial again now. It costs no session (a dead mgmt connection kills no PTY);
   * the calls in flight fail UNAVAILABLE ("the management link was
   * redialled"), as they would have at their own deadline. A fresh hello gets
   * a fresh reader at the floor, so a wedge in one connection's reader is
   * recovered outright.
   *
   * The replaced connection, when it was paired, is kept open and read until a
   * hello answers on the new one (see `Witness`): a floor that cannot answer
   * the new hello has not superseded it, so its ticks and late replies still
   * arrive. If the new hello never answers, the link goes on redialling on its
   * ordinary backoff and emits "reconnecting" for each failed dial, as for any
   * dial that fails. A no-op once the link is closed or superseded. */
  redial(): void {
    if (this.closed || this.superseded) return;
    const sock = this.sock;
    if (sock !== null) {
      const paired = this.connected;
      // detached first, so its close event is not read as the link going down
      this.sock = null;
      this.connected = false;
      this.clearTerminalEndpoints();
      this.failPending(REDIALLED);
      this.subRoutes.clear();
      this.prepareSubscriptionsForReconnect();
      if (paired && this.witness === null) this.witness = { sock, pid: this.pairedPid };
      else sock.destroy();
    }
    this.connectingSock?.destroy();
    const inFlight = this.dialPromise;
    if (inFlight === null) {
      this.dialNow();
      return;
    }
    // a dial already under way fails with the socket it was using; the fresh
    // one follows it
    void inFlight.then(
      () => this.dialNow(),
      () => this.dialNow(),
    );
  }

  private failPending(message = "mgmt connection closed"): void {
    for (const [, p] of this.pending) {
      p.reject(new RpcCallError("UNAVAILABLE", message, true));
    }
    this.pending.clear();
    // A reply to a request sent on a dead socket can never arrive, so the
    // timed-out records go with the connection they were sent on.
    this.timedOut.clear();
  }

  /** WG-D0 — remember a request that just settled TIMEOUT, forgetting the
   * oldest past the cap (a Map iterates in insertion order). */
  private rememberTimedOut(id: number, record: TimedOutRequest): void {
    this.timedOut.set(id, record);
    const cap = this.opts.timedOutRecordCap ?? TIMED_OUT_RECORD_CAP;
    while (this.timedOut.size > cap) {
      const oldest = this.timedOut.keys().next();
      if (oldest.done) return;
      this.timedOut.delete(oldest.value);
    }
  }

  /** WG-D0 — a reply whose id is not pending. If its request settled TIMEOUT,
   * the reply is attributed ("late-reply") and its record dropped, so a repeat
   * says nothing; it never resolves or rejects anything. Any other unmatched id
   * (never sent, already attributed, or forgotten past the cap) is dropped
   * unremarked. */
  private noteLateReply(id: number, result: unknown): void {
    const sent = this.timedOut.get(id);
    if (sent === undefined) return;
    this.timedOut.delete(id);
    const roundTripMs = performance.now() - sent.sentAt;
    let floorTs: number | undefined;
    if (sent.method === PING_METHOD) {
      const ack = PingAck.safeParse(result);
      if (ack.success) floorTs = ack.data.ts;
    }
    const late: NativeLateReply = {
      method: sent.method,
      lateByMs: Math.max(0, roundTripMs - sent.deadlineMs),
      roundTripMs,
      ...(floorTs !== undefined ? { floorTs } : {}),
    };
    this.emit("late-reply", late);
  }

  private async replaySubscriptions(): Promise<void> {
    for (const [key, sub] of this.subs) {
      this.prepareSubscription(sub);
      try {
        const res = (await this.rawRequest(sub.method, sub.params, key)) as { snapshot: unknown };
        sub.onEvent(res.snapshot, "snapshot"); // P5: reconnect = fresh snapshot
        this.activateSubscription(sub);
      } catch (e) {
        // C3 review finding: one refused replay must never fail the whole dial
        // (a serve.subscribe replayed while the mesh node is down answers
        // UNAVAILABLE — pre-fix that cycled the ENTIRE link forever, health
        // stream included). The sub entry STAYS in the map: the next reconnect
        // retries it; until then its stream is honestly silent (its backend is
        // down anyway). Transport-dead errors still abort: with no socket the
        // remaining replays can't succeed either.
        if (this.closed || this.superseded || this.sock === null) throw e;
        this.logger.warn(
          "fieldd.native_link.subscription_replay_refused",
          "A native subscription replay was refused and retained for the next reconnect",
          { method: sub.method, error: e },
        );
      }
    }
  }

  private prepareSubscription(sub: SubEntry): void {
    if (sub.activation) {
      clearImmediate(sub.activation);
      delete sub.activation;
    }
    sub.buffering = true;
    sub.queued = [];
  }

  private prepareSubscriptionsForReconnect(): void {
    for (const sub of this.subs.values()) this.prepareSubscription(sub);
  }

  private activateSubscription(sub: SubEntry): void {
    delete sub.activation;
    sub.buffering = false;
    const queued = sub.queued;
    sub.queued = [];
    for (const event of queued) sub.onEvent(event.payload, event.kind);
  }

  private removeSubscription(key: number, sub: SubEntry): void {
    if (sub.activation) clearImmediate(sub.activation);
    this.subs.delete(key);
    for (const [subId, routeKey] of this.subRoutes) {
      if (routeKey === key) this.subRoutes.delete(subId);
    }
  }

  async request(method: string, params: unknown, opts?: { deadlineMs?: number }): Promise<unknown> {
    this.refuseAtTheDoor(method);
    return await this.rawRequest(method, params, undefined, opts?.deadlineMs);
  }

  /** WG-D4 — the doors' gate: what a product door's request or subscription
   * answers while the floor's supervisor holds it unresponsive. null = no gate
   * (every door waits out its own deadline, as an embedded link does). */
  setDoorGate(gate: NativeDoorGate | null): void {
    this.doorGate = gate;
  }

  /** WG-D4 — a door's call while the floor is held unresponsive is refused at
   * once, retryable, and never sent; the supervision's own verbs pass. */
  private refuseAtTheDoor(method: string): void {
    if (method.startsWith(LIFECYCLE_PREFIX)) return;
    const refusal = this.doorGate?.();
    if (refusal === undefined) return;
    throw new RpcCallError(
      "UNAVAILABLE",
      `the native floor is not answering its control path; ${method} was not sent`,
      true,
      refusal,
    );
  }

  /** TC-D2 — the heartbeat probe. Rides the SAME control path as every real
   * request end-to-end (socket → framing → dispatch → reply) with a tight
   * deadline, so a wedge anywhere on that path is exactly what it measures. */
  async ping(deadlineMs: number): Promise<PingAck> {
    const ack = await this.rawRequest(PING_METHOD, {}, undefined, deadlineMs);
    const parsed = PingAck.safeParse(ack);
    if (!parsed.success)
      throw new RpcCallError("INTERNAL", "the ping ack was not a PingAck", false);
    return parsed.data;
  }

  // RETIRED 2026-09-14 (TM-3, TM-D3): `mirrorWriteCapability()`, the only
  // caller of `native.terminal.mirrorWriteCapability` and the only place a
  // secret ever came UP this channel. The verb is deleted on the floor too. No
  // method on this link carries a durable credential now — the grant fieldd
  // signs for a ticket is minted from the cell's per-boot key on the route row,
  // which is memory-only and rotates with the cell.

  private async rawRequest(
    method: string,
    params: unknown,
    subKey?: number,
    deadlineMs?: number,
  ): Promise<unknown> {
    const sock = this.sock;
    if (!sock) throw new RpcCallError("UNAVAILABLE", "not connected", true);
    const id = this.nextId++;
    const limit =
      deadlineMs ?? this.opts.requestDeadlineMs ?? NATIVE_SUPERVISION.REQUEST_DEADLINE_MS;
    // WG-D6 — the instant fieldd gives up on this request, on the wall clock
    // the floor reads too (same host): past it the floor answers TIMEOUT and
    // does not run it. The heartbeat and the hello carry none.
    const deadlineAt = DEADLINE_EXEMPT.has(method) ? undefined : Date.now() + limit;
    const line = `${JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
      ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    })}\n`;
    return await new Promise((resolve, reject) => {
      // TC-D2 — a request that outlives its deadline settles TIMEOUT. A
      // deadline miss is wedge EVIDENCE, not a verdict — the supervisor's
      // ladder owns the verdict. WG-D0 — the miss is remembered, so a reply
      // that comes after it settles nothing and is still attributed
      // ("late-reply"), and the event says how late this timer itself fired.
      // WG-E1 — so does the TIMEOUT's own `firedLateMs`: a timer that fired
      // past its whole deadline was fieldd's loop stalling, and the supervisor
      // does not count that miss against the floor.
      let timer: NodeJS.Timeout | null = null;
      const entry: Pending = {
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      };
      if (subKey !== undefined) entry.subKey = subKey;
      const sentAt = performance.now();
      timer = setTimeout(() => {
        if (this.pending.get(id) !== entry) return;
        this.pending.delete(id);
        const firedLateMs = Math.max(0, performance.now() - sentAt - limit);
        this.rememberTimedOut(id, { method, sentAt, deadlineMs: limit });
        const miss: NativeDeadlineMiss = { method, deadlineMs: limit, firedLateMs };
        this.emit("deadline-miss", miss);
        reject(
          new RpcCallError(
            "TIMEOUT",
            `mgmt request exceeded its ${limit}ms deadline: ${method}`,
            true,
            {
              method,
              deadlineMs: limit,
              firedLateMs,
            },
          ),
        );
      }, limit);
      timer.unref?.();
      this.pending.set(id, entry);
      sock.write(line);
    });
  }

  /** Snapshot-then-delta subscription; survives reconnects (fresh snapshot each time). */
  async subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: SubEventKind) => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }> {
    this.refuseAtTheDoor(method);
    const key = this.nextSubKey++;
    const entry: SubEntry = { method, params, onEvent, buffering: true, queued: [] };
    this.subs.set(key, entry);
    try {
      const res = (await this.rawRequest(method, params, key)) as { snapshot: unknown };
      // Promise continuations run before setImmediate, so callers can apply the
      // returned snapshot before any same-chunk deltas are released.
      entry.activation = setImmediate(() => {
        if (this.subs.get(key) === entry && !this.closed && !this.superseded)
          this.activateSubscription(entry);
      });
      let disposed = false;
      return {
        snapshot: res.snapshot,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          this.removeSubscription(key, entry);
        },
      };
    } catch (e) {
      this.removeSubscription(key, entry);
      throw e;
    }
  }

  /** AL-8a (`thinking-app-lifecycle.md` §8.3.1) — fieldd's goodbye before a planned stop, so the floor records the
   * departure planned (`native.lifecycle.detach`). Said only on a paired link and bounded: a floor already stopped
   * (a quit's consented stop) has no connection to say it on, and a stop never waits out a reconnect. */
  async detach(): Promise<void> {
    if (!this.connected || this.closed) return;
    await this.rawRequest("native.lifecycle.detach", {}, undefined, DETACH_DEADLINE_MS).catch(
      () => undefined,
    );
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connectingSock?.destroy();
    this.connectingSock = null;
    this.prepareSubscriptionsForReconnect();
    // Synchronously, not via the socket's close event: a caller that closes the
    // link and then reads the endpoints must not see the floor still there for
    // the length of one turn of the event loop.
    this.clearTerminalEndpoints();
    this.dropWitness();
    this.sock?.destroy();
  }
}

/** TC-S3 — the CREATE-TARGET discipline, in the ONE place every reader on this
 * plane shares it (the normative statement lives on `TerminalRouteSnapshot`):
 * a class's create target is its `role:"class"` row when one is present, else
 * its HIGHEST-instance `role:"solo"` row — the floor spawns a fresh empty solo
 * the moment the previous one takes a session, so the newest solo is the empty
 * one, and at the solo cap the newest stays target as the honest overflow.
 *
 * Two absences are read the tolerant way, and both are load-bearing. A row with
 * NO `workloadClass` is a pre-TC-S3 floor's single cell, which serves EVERY
 * class — that is what keeps the legacy derivation below unchanged. An absent
 * `role` reads as `class`, the contract's own default reading of absence.
 *
 * Rows that are not the target still serve their EXISTING sessions: per-session
 * routing goes through the inventory's `cell` tag (TerminalService), never
 * through this rule. */
export function terminalCreateTarget(
  snapshot: TerminalRouteSnapshot,
  workloadClass: TerminalWorkloadClass,
): TerminalRouteCell | undefined {
  const candidates = snapshot.cells.filter(
    (cell) => cell.workloadClass === undefined || cell.workloadClass === workloadClass,
  );
  const classCell = candidates.find((cell) => cell.role !== "solo");
  if (classCell !== undefined) return classCell;
  let newest: TerminalRouteCell | undefined;
  for (const cell of candidates) {
    if (newest === undefined || cell.cellInstanceId > newest.cellInstanceId) newest = cell;
  }
  return newest;
}

/** TC-D15/TC-S3 — the one place the LEGACY single-endpoint derivation lives.
 * The mirror is the INTERACTIVE class's create target: it is the pane deck's
 * door and the reading every pre-routes consumer means. A pre-TC-S3 floor whose
 * rows declare no class needs no special case — a class-less row is a candidate
 * for every class, so the rule above picks that floor's single cell exactly as
 * `cells[0]` did. Empty `cells` is an HONEST state — a floor with no engine up
 * right now — and reads as "no endpoints", never as an error; so does a floor
 * with agent cells and no interactive one (it hosts no deck). */
function cellEndpoints(snapshot: TerminalRouteSnapshot): TerminalEndpoints | undefined {
  return terminalCreateTarget(snapshot, "interactive")?.endpoints;
}

function isRetryableInitialTransportFailure(error: unknown): boolean {
  if (error instanceof RpcCallError) {
    return error.kind === "UNAVAILABLE" && error.retryable;
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOENT" ||
    code === "ENOTSOCK" ||
    code === "EPIPE" ||
    // win32 named pipe between listener instances — the documented retry code
    // (ghosttea-client's openEndpoint carries the same contract)
    code === "EBUSY"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
