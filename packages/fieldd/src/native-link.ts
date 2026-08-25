import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import {
  CONTRACTS_VERSION,
  isPipeEndpoint,
  MESH_CONTROL_LIMITS,
  NATIVE_SUPERVISION,
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
  logger?: Logger;
}

/** Large enough for the bounded 256-origin artifact snapshot, finite enough
 * that a compromised/native-buggy peer cannot grow fieldd without limit. */
export const NATIVE_MGMT_MAX_FRAME_BYTES = MESH_CONTROL_LIMITS.MGMT_FRAME_BYTES;
const NATIVE_MGMT_RETAINED_FRAME_BYTES = 1024 * 1024;
/** How long the handshake may take before the dial is abandoned. Generous
 * against a loaded box (field-native answers a hello in microseconds once it is
 * listening) and finite against something that accepts and never speaks. */
const HELLO_TIMEOUT_MS = 10_000;

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

export class NativeLink extends EventEmitter {
  private sock: Socket | null = null;
  private connectingSock: Socket | null = null;
  private dialPromise: Promise<void> | null = null;
  private frameBuffer = Buffer.alloc(0);
  private frameBytes = 0;
  private nextId = 1;
  private pending = new Map<number, Pending>();
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

  constructor(private readonly opts: NativeLinkOptions) {
    super();
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
    this.frameBuffer = Buffer.alloc(0);
    this.frameBytes = 0;
    sock.on("data", (d) => {
      if (this.sock === sock) this.onData(d);
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
      this.request("native.lifecycle.hello", {
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
      terminal?: unknown;
      terminalRoutes?: unknown;
      nativeBuild?: unknown;
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
   * the endpoints in hand are still the ones the hello vouched for. */
  private applyTerminalRoutes(payload: unknown, kind: SubEventKind): void {
    const parsed = TerminalRouteSnapshot.safeParse(payload);
    if (!parsed.success) {
      this.logger.debug(
        "fieldd.native_link.terminal_routes_unparsed",
        "A terminal routes payload was not a TerminalRouteSnapshot; routes unchanged",
        { kind },
      );
      return;
    }
    if (this.terminalRoutes?.revision === parsed.data.revision) return;
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
   * exactly the stale shape this method exists to close. A snapshot whose
   * `cells` are EMPTY is still a live reading — it says the floor currently has
   * no engine — so losing it is a real transition and is announced too, which
   * is why the guard below reads both fields and not just the endpoints.
   *
   * Silent when there was nothing to clear: no change, no event. */
  private clearTerminalEndpoints(): void {
    if (this.terminalEndpoints === undefined && this.terminalRoutes === undefined) return;
    this.terminalEndpoints = undefined;
    this.terminalRoutes = undefined;
    this.emit("terminal-endpoints");
  }

  private onData(chunk: Buffer): void {
    let offset = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline === -1 ? chunk.length : newline;
      const segment = chunk.subarray(offset, end);
      if (!this.appendFrameSegment(segment)) return;
      if (newline === -1) return;

      const text = this.frameBuffer.toString("utf8", 0, this.frameBytes);
      this.frameBytes = 0;
      if (this.frameBuffer.length > NATIVE_MGMT_RETAINED_FRAME_BYTES)
        this.frameBuffer = Buffer.alloc(0);
      if (text.trim()) this.onLine(text);
      offset = newline + 1;
      if (offset >= chunk.length) return;
    }
  }

  private appendFrameSegment(segment: Buffer): boolean {
    const limit = this.opts.maxFrameBytes ?? NATIVE_MGMT_MAX_FRAME_BYTES;
    const required = this.frameBytes + segment.length;
    if (required > limit) {
      this.logger.error(
        "fieldd.native_link.frame_too_large",
        "The native management connection sent an oversized frame",
        { limit },
      );
      this.frameBuffer = Buffer.alloc(0);
      this.frameBytes = 0;
      this.sock?.destroy();
      return false;
    }
    if (segment.length > 0) {
      if (required > this.frameBuffer.length) {
        const capacity = Math.min(
          limit,
          Math.max(required, Math.max(4_096, this.frameBuffer.length * 2)),
        );
        const next = Buffer.allocUnsafe(capacity);
        this.frameBuffer.copy(next, 0, 0, this.frameBytes);
        this.frameBuffer = next;
      }
      segment.copy(this.frameBuffer, this.frameBytes);
      this.frameBytes = required;
    }
    return true;
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // tolerant: garbage lines never fatal
    }
    if (msg["id"] !== undefined && msg["id"] !== null) {
      const p = this.pending.get(msg["id"] as number);
      if (!p) return;
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

  private onSockClose(sock: Socket): void {
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

  private failPending(): void {
    for (const [, p] of this.pending) {
      p.reject(new RpcCallError("UNAVAILABLE", "mgmt connection closed", true));
    }
    this.pending.clear();
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
    return await this.rawRequest(method, params, undefined, opts?.deadlineMs);
  }

  /** TC-D2 — the heartbeat probe. Rides the SAME control path as every real
   * request end-to-end (socket → framing → dispatch → reply) with a tight
   * deadline, so a wedge anywhere on that path is exactly what it measures. */
  async ping(deadlineMs: number): Promise<PingAck> {
    const ack = await this.rawRequest("native.lifecycle.ping", {}, undefined, deadlineMs);
    const parsed = PingAck.safeParse(ack);
    if (!parsed.success)
      throw new RpcCallError("INTERNAL", "the ping ack was not a PingAck", false);
    return parsed.data;
  }

  private async rawRequest(
    method: string,
    params: unknown,
    subKey?: number,
    deadlineMs?: number,
  ): Promise<unknown> {
    const sock = this.sock;
    if (!sock) throw new RpcCallError("UNAVAILABLE", "not connected", true);
    const id = this.nextId++;
    const line = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    const limit =
      deadlineMs ?? this.opts.requestDeadlineMs ?? NATIVE_SUPERVISION.REQUEST_DEADLINE_MS;
    return await new Promise((resolve, reject) => {
      // TC-D2 — a request that outlives its deadline settles TIMEOUT; a late
      // reply, if one ever comes, misses the pending map and is dropped. A
      // deadline miss is wedge EVIDENCE, not a verdict — the supervisor's
      // heartbeat owns the verdict.
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
      timer = setTimeout(() => {
        if (this.pending.get(id) !== entry) return;
        this.pending.delete(id);
        this.emit("deadline-miss", { method, deadlineMs: limit });
        reject(
          new RpcCallError(
            "TIMEOUT",
            `mgmt request exceeded its ${limit}ms deadline: ${method}`,
            true,
            {
              method,
              deadlineMs: limit,
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
