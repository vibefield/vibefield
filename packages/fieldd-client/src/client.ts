import {
  type ClientKind,
  CONTRACTS_VERSION,
  ForwardReceipt,
  KEYED_FORWARD_METHODS,
  PRODUCT_NOTIFICATIONS,
  SystemTick,
} from "@vibefield/contracts";

// @vibefield/fieldd-client — the isomorphic product-plane client (design-03
// A6): runs in the Electron renderer, plugin workers, AND the shell main
// process on the global WebSocket (browser / Node ≥22). No node: imports here.
//
// Carries the NativeLink lessons forward (review 2026-07-21):
// - subId routes install synchronously while the subscribe response is
//   processed, never after an await;
// - reconnect scheduling is idempotent (single timer), stale-socket events are
//   ignored, and every reconnect replays subscriptions with a FRESH snapshot
//   (P5 — reconnect = re-snapshot), carrying the params its owner supplies at
//   that moment (`SubscribeOptions.params` — a resumable subscription's
//   CURRENT cursor, never the one it first attached with);
// - INCOMPATIBLE / UNAUTHORIZED / PRECONDITION_FAILED at hello are terminal:
//   retrying with the same token/version can never succeed;
// - a REPLAY's refusal belongs to its subscription, never to the client (the
//   DS landing review's S3, 2026-10-01): replay runs after hello's verdict, one
//   subscription at a time, and a refused replay ends only that subscription —
//   its owner hears it (`onReplayFailed`) and re-attaches on its own terms —
//   while `ready`, the socket and every other subscription stand. Replay used
//   to run inside hello's try: one refused replay closed the socket, and one
//   refused with a terminal kind failed the whole client (through PeerLink, a
//   peer's restart dropped every subscription standing on the shared link).
// - DS-D15's client half (DS wave 2, 2026-10-01): a MUTATION routed by
//   `device` to another desktop (`KEYED_FORWARD_METHODS`) carries ONE
//   idempotency key per logical call, minted here and put under the envelope's
//   `forward` member — the one a window may carry. A call that may have
//   reached the owner without an answer reaching us (the owner's answer lost:
//   the daemon's `outcome-unknown`; or this socket cut after the request left)
//   fails `UNAVAILABLE {state: "outcome-unknown"}` and hands the caller its key
//   (`error.forward.idempotencyKey`): the retry carrying it back
//   (`request(..., {idempotencyKey})`) is the SAME call, which the owner
//   answers from its receipt — applied once ("a window echoes the key from an
//   outcome-unknown"). Before this, no client sent a key: a UI retry after a
//   cut applied twice.

export class FielddRpcError extends Error {
  // plain fields, no TS parameter properties: plugin workers import this file
  // under Node's strip-only type erasure, which cannot rewrite ctor sugar (P5)
  readonly kind: string;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly code?: number;
  /** DS-D15 — the key of the keyed forward this error ended (every error of
   * such a call carries it; an `outcome-unknown`'s is the one to retry with). */
  forward?: { idempotencyKey: string };

  constructor(kind: string, message: string, retryable = false, details?: unknown, code?: number) {
    super(message);
    this.name = "FielddRpcError";
    this.kind = kind;
    this.retryable = retryable;
    if (details !== undefined) this.details = details;
    if (code !== undefined) this.code = code;
  }
}

/** DS-D15 — this client's own transport failure after a keyed request LEFT
 * (no JSON-RPC code: the socket closed under it, or the client was closed):
 * nobody answered, and the owner may have applied it — so it is the same
 * honest state the daemon reports for a forward whose answer was lost. A
 * reply the daemon SENT passes through as the daemon's answer. */
function asOutcomeUnknown(e: unknown, key: string): unknown {
  if (!(e instanceof FielddRpcError) || e.code !== undefined || e.kind !== "UNAVAILABLE") return e;
  return new FielddRpcError(
    "UNAVAILABLE",
    "the call was cut before an answer; its outcome is unknown",
    true,
    { service: "fieldd", state: "outcome-unknown", idempotencyKey: key },
  );
}

/** DS-D15 — name the key a failed call should be retried with: the one an
 * `outcome-unknown` names (the key the owner journaled — a daemon that minted
 * its own for an unkeyed call says so there), else the call's own. A COPY is
 * stamped, never the error itself: a failed client hands every caller the
 * same `lastError`, and one call's key must not surface on another's. */
function withForwardKey(e: unknown, key: string | undefined): unknown {
  if (!(e instanceof FielddRpcError)) return e;
  const details = e.details as { state?: unknown; idempotencyKey?: unknown } | undefined;
  const named =
    details?.state === "outcome-unknown" && typeof details.idempotencyKey === "string"
      ? details.idempotencyKey
      : undefined;
  const idempotencyKey = named ?? key;
  if (idempotencyKey === undefined) return e;
  const keyed = new FielddRpcError(e.kind, e.message, e.retryable, e.details, e.code);
  keyed.forward = { idempotencyKey };
  return keyed;
}

/** DS-1b — a dial's VERDICT, when a socket's error carries one: a structured
 * `{kind, message, retryable?, details?}` (fieldd's RpcCallError shape, duck-
 * typed — this file stays browser-safe and imports nothing of fieldd). A bare
 * transport error carries none and stays the transient it always was. */
function dialVerdictOf(error: unknown): FielddRpcError | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const { kind, message, retryable, details } = error as {
    kind?: unknown;
    message?: unknown;
    retryable?: unknown;
    details?: unknown;
  };
  if (typeof kind !== "string" || kind === "" || typeof message !== "string") return undefined;
  return new FielddRpcError(kind, message, retryable === true, details);
}

/** Structural WebSocket shape (browser + Node undici both satisfy it). */
export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: unknown) => void): void;
  readyState: number;
}
export type WsCtor = new (url: string) => WsLike;

export type FielddClientStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "closed"
  | "failed";

export interface FielddClientOptions {
  url: string; // e.g. ws://127.0.0.1:9410
  /** empty string = no credential in hello (C5: peer dials ride the tailnet
   * door's WhoIs grant — a token would be wrong there, not just absent) */
  token: string;
  clientKind?: ClientKind;
  /** C5/D32 — the peer-fieldd identity claim, sent in hello (label only;
   * honored solely on a tailnet door — see contracts Hello.deviceId) */
  deviceId?: string;
  /** UA-2 — the EXPECTED user of the daemon being dialed; a configured daemon
   * refuses a mismatch INCOMPATIBLE (restrict-only — see contracts Hello.userId) */
  userId?: string;
  webSocket?: WsCtor; // override for tests / exotic hosts
  maxBackoffMs?: number;
  /** SP-1 / SP-L7 — the door's keepalive: every hello'd connection hears
   * `system.tick {at, intervalMs}` (`PRODUCT_API_LIMITS.TICK_INTERVAL_MS`). A
   * reader that keeps a dead-door deadline resets it here (any inbound frame is
   * liveness; a door silent for 2.5 × intervalMs is dead). A tick whose params
   * do not read is not a tick; without `onTick` the frame is taken quietly. */
  onTick?: (tick: { at: number; intervalMs: number }) => void;
  /** DS-D15 — the device the dialed daemon runs on, for a host that knows it:
   * a call routed to it is served there, not forwarded, so it carries no key
   * (the door refuses a window's key on a call it serves itself). A daemon
   * whose hello says its `deviceId` is believed first. Neither known, every
   * routed mutation is keyed: route by `device` only to another desktop. */
  selfDeviceId?: () => string | undefined;
}

/** DS-D15 — per-call choices for `FielddClient.request`. */
export interface RequestOptions {
  /** The key of a keyed forward (a method in `KEYED_FORWARD_METHODS`, routed
   * by `device` to another desktop). Omitted, the client mints one for the
   * call; given, the call is the SAME logical call — the retry of an
   * `outcome-unknown` echoes `error.forward.idempotencyKey`, and the owner
   * answers it from its receipt. Ignored on any call that is not keyed; an
   * undefined one is omitted (a caller may pass `error.forward?.idempotencyKey`). */
  idempotencyKey?: string | undefined;
  /** The call's bound, from when it is made: the wait for `ready` and for
   * the answer together. Past it the call is refused `UNAVAILABLE {state:
   * "timeout"}` (retryable) and its pending entry is dropped, so a late answer
   * resolves nothing; a keyed forward that already LEFT is `outcome-unknown`
   * instead, with its key, like any cut. Omitted: no bound (as before). */
  timeoutMs?: number | undefined;
}

/** A call past its `RequestOptions.timeoutMs`: nobody answered in time. No
 * JSON-RPC code — this client's own verdict, which `asOutcomeUnknown` reads as
 * a cut for a keyed forward that left. */
function timedOut(method: string, timeoutMs: number): FielddRpcError {
  return new FielddRpcError("UNAVAILABLE", `${method} had no answer within ${timeoutMs} ms`, true, {
    service: "fieldd",
    state: "timeout",
    timeoutMs,
  });
}

/** DS-D15 — a fresh key for one logical call (contracts' `IdempotencyKey`,
 * 8..128 chars): 128 random bits. `getRandomValues` exists in every host
 * this file runs in, secure context or not. */
export function mintIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `wk_${hex}`;
}

/** DS-D15 — the owner's RECEIPT standing in for a keyed call's result. A retry
 * whose original applied with an answer too large to journal is answered with
 * the receipt itself (`resultOmitted: true`): the call applied, and its answer
 * is gone — a caller that needs it reads the state some other way. Undefined
 * when `result` is the call's own answer (or another key's receipt). */
export function forwardReceiptOf(
  result: unknown,
  idempotencyKey?: string,
): (ForwardReceipt & { resultOmitted: true }) | undefined {
  if (result === null || typeof result !== "object") return undefined;
  if ((result as { resultOmitted?: unknown }).resultOmitted !== true) return undefined;
  const parsed = ForwardReceipt.safeParse(result);
  if (!parsed.success) return undefined;
  if (idempotencyKey !== undefined && parsed.data.idempotencyKey !== idempotencyKey)
    return undefined;
  return { ...parsed.data, resultOmitted: true };
}

export interface Subscription {
  subId: string;
  snapshot: unknown;
  unsubscribe: () => void;
}

/** Per-subscription choices for a replay (S3, 2026-10-01). */
export interface SubscribeOptions {
  /** The params a REPLAY carries, read when it is sent: a reconnect re-sends
   * every standing subscribe, and a resumable subscription asks from where its
   * owner IS — its current cursor — not from where it first attached. The
   * initial subscribe sends the `params` argument. */
  params?: () => unknown;
  /** The daemon REFUSED this subscription's replay: the subscription is over
   * on this client (no route, never replayed again) and its owner decides what
   * follows — its own cursor, its own backoff. Nothing else on the client
   * moves. With no owner, a RETRYABLE refusal is re-asked by the client alone,
   * on the reconnect backoff, and any other refusal ends the subscription. */
  onReplayFailed?: (error: FielddRpcError) => void;
}

type SubEventKind = "snapshot" | "delta";

interface SubEntry {
  method: string;
  params: unknown;
  onEvent: (payload: unknown, kind: SubEventKind) => void;
  subId?: string;
  /** true once a subscribe request for this entry has reached a live socket —
   * only such entries are replayed on reconnect (unsent ones are still owned
   * by their pending subscribe() call). */
  sentOnce?: boolean;
  /** SubscribeOptions.params — read when a replay is sent */
  replayParams?: () => unknown;
  /** SubscribeOptions.onReplayFailed */
  onReplayFailed?: (error: FielddRpcError) => void;
  /** a retryable replay refusal nobody owns: the client's own re-ask of this
   * one subscription, and how many came before it (the backoff) */
  replayRetry?: ReturnType<typeof setTimeout> | undefined;
  replayRetries?: number;
}

/** A call's `RequestOptions.timeoutMs`, fixed when the call was made. */
interface CallBound {
  method: string;
  timeoutMs: number;
  deadline: number;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: FielddRpcError) => void;
  subKey?: number;
  /** Initial subscribe has a waiting caller that cannot receive a replacement handle after a
   * disconnect. Replay already has an established owner and must preserve its entry. */
  dropSubOnFailure?: boolean;
}

export class FielddClient {
  status: FielddClientStatus = "idle";
  grantedScopes: string[] = [];
  lastError: FielddRpcError | null = null;

  private ws: WsLike | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private subs = new Map<number, SubEntry>();
  private subRoutes = new Map<string, number>(); // subId -> local sub key
  private nextSubKey = 1;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners = new Set<() => void>();
  private notificationListeners = new Map<string, Set<(params: unknown) => void>>();
  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  /** DS-1b (DS wave 2 landing) — the verdict of a dial that FAILED CLOSED
   * before it opened: the egress stand-in socket reports the floor's
   * `UNAVAILABLE {service: "mesh", state}` as its error, then closes 1006.
   * Held until that close, when it answers every caller waiting on the dial
   * (the request and the `ready()` behind it) instead of leaving them to
   * PeerLink's deadline — and the client still redials on its backoff. */
  private dialVerdict: FielddRpcError | null = null;
  private closedByUser = false;
  private credential: string;
  /** DS-D15 — the device the dialed daemon's hello says it runs on, if it
   * says (read tolerantly: a field the ack does not carry today) */
  private helloDeviceId: string | undefined = undefined;

  // no TS parameter property: the worker harness imports this file under
  // Node's strip-only type erasure, which cannot rewrite ctor sugar (P5)
  private readonly opts: FielddClientOptions;

  constructor(opts: FielddClientOptions) {
    this.opts = opts;
    this.credential = opts.token;
  }

  /** The dial target — P3b: plugin-bound sibling clients connect to the same
   * daemon this client reached (never a credential, just the address). */
  get url(): string {
    return this.opts.url;
  }

  /** Idempotent: starts (or resumes) connecting. */
  connect(): void {
    if (this.closedByUser || this.status === "failed") return;
    if (this.ws || this.reconnectTimer) return;
    this.dial(false);
  }

  /**
   * Rebinds this exact client to a fresh bearer credential.
   *
   * The authority edge is synchronous: old granted scopes disappear and the old socket detaches
   * before this returns. Established subscriptions remain owned and replay with fresh snapshots
   * after the new hello. Pending unary calls and not-yet-established subscriptions reject against
   * the retired connection. A user-closed client is terminal and cannot be reopened by rotation.
   */
  rotateCredential(credential: string): void {
    if (this.closedByUser || credential === this.credential) return;
    this.credential = credential;
    this.grantedScopes = [];
    this.lastError = null;

    const reconnecting =
      this.ws !== null ||
      this.reconnectTimer !== null ||
      this.status === "connecting" ||
      this.status === "ready" ||
      this.status === "reconnecting" ||
      this.status === "failed";
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "credential rotated");
    this.failPending();
    this.clearReplayRetries();
    this.subRoutes.clear();
    this.attempts = 0;

    if (!reconnecting) return;
    this.setStatus("reconnecting");
    this.dial(true);
  }

  /** Resolves when hello has succeeded; rejects if the client is dead. */
  ready(): Promise<void> {
    if (this.status === "ready") return Promise.resolve();
    if (this.status === "failed" || this.status === "closed")
      return Promise.reject(
        this.lastError ?? new FielddRpcError("UNAVAILABLE", `client ${this.status}`),
      );
    this.connect();
    return new Promise((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject });
    });
  }

  onStatusChange(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Server-originated control notifications that are not subscriptions.
   * Used by Electron main's static shell provider; listeners survive automatic
   * reconnects on this client and are removed explicitly or on close(). */
  onNotification(method: string, fn: (params: unknown) => void): () => void {
    let listeners = this.notificationListeners.get(method);
    if (listeners === undefined) {
      listeners = new Set();
      this.notificationListeners.set(method, listeners);
    }
    listeners.add(fn);
    return () => {
      listeners?.delete(fn);
      if (listeners?.size === 0) this.notificationListeners.delete(method);
    };
  }

  /** One call. DS-D15: a keyed forward (a mutation routed by `device` to
   * another desktop) carries ONE idempotency key — `opts.idempotencyKey`, or
   * a fresh one — and every error of it says which (`error.forward`); one that
   * may have reached the owner unanswered reads `outcome-unknown`, and its
   * retry with that key applies once. The result is the owner's answer as it
   * came (a receipt in its place reads through `forwardReceiptOf`). */
  async request(method: string, params?: unknown, opts?: RequestOptions): Promise<unknown> {
    let key: string | undefined;
    let sent = false;
    const bound =
      opts?.timeoutMs === undefined
        ? undefined
        : { timeoutMs: opts.timeoutMs, deadline: Date.now() + opts.timeoutMs, method };
    try {
      await (bound === undefined ? this.ready() : this.readyWithin(bound));
      // decided AFTER the hello: it may name the daemon's own device
      key = this.forwardKeyFor(method, params, opts);
      const wire =
        key === undefined
          ? params
          : { ...(params as Record<string, unknown>), forward: { idempotencyKey: key } };
      // sendRequest puts it on this socket in this same tick, or refuses
      // "not connected" — so this is whether the request LEFT
      sent = this.ws !== null;
      return await this.sendRequest(method, wire, undefined, false, bound);
    } catch (e) {
      if (key === undefined) {
        // never keyed, or never sent: a key the caller brought stays its own
        throw withForwardKey(
          e,
          this.isKeyedCandidate(method, params) ? opts?.idempotencyKey : undefined,
        );
      }
      throw withForwardKey(sent ? asOutcomeUnknown(e, key) : e, key);
    }
  }

  /** DS-D15 — what this client's daemon knows about one of its keyed forwards
   * (`forward.receipt`: applied, refused, or outcome-unknown, `inFlight` while
   * an attempt is out). Read, never acted on: the retry is the same call with
   * the same key. Undefined when nothing is journaled under the key. */
  async forwardReceipt(
    idempotencyKey: string,
  ): Promise<(ForwardReceipt & { inFlight?: true }) | undefined> {
    try {
      return (await this.request("forward.receipt", { idempotencyKey })) as ForwardReceipt & {
        inFlight?: true;
      };
    } catch (e) {
      if (e instanceof FielddRpcError && e.kind === "NOT_FOUND") return undefined;
      throw e;
    }
  }

  /** DS-D15 — the key this call carries, or undefined when it is not a keyed
   * forward from this client: a method the keyed-forward rule names, routed by
   * a `device` that is not the dialed daemon's own, in params that carry no
   * `forward` member of their own (PeerLink's client builds the whole
   * envelope — onBehalfOf and the key — itself). */
  private forwardKeyFor(
    method: string,
    params: unknown,
    opts: RequestOptions | undefined,
  ): string | undefined {
    if (!this.isKeyedCandidate(method, params)) return undefined;
    const device = (params as Record<string, unknown>)["device"];
    const self = this.helloDeviceId ?? this.opts.selfDeviceId?.();
    if (self !== undefined && device === self) return undefined;
    return opts?.idempotencyKey ?? mintIdempotencyKey();
  }

  /** A keyed method routed by a `device`, in params with no envelope of their
   * own — before the question of whose device it is. */
  private isKeyedCandidate(method: string, params: unknown): boolean {
    if (!KEYED_FORWARD_METHODS.has(method)) return false;
    if (params === null || typeof params !== "object" || Array.isArray(params)) return false;
    const record = params as Record<string, unknown>;
    if (Object.hasOwn(record, "forward")) return false;
    const device = record["device"];
    return typeof device === "string" && device !== "";
  }

  /** Snapshot-then-delta subscription; survives reconnects (fresh snapshot each time) —
   * unless the daemon refuses its replay (`SubscribeOptions`). */
  async subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: SubEventKind) => void,
    opts?: SubscribeOptions,
  ): Promise<Subscription> {
    const key = this.nextSubKey++;
    const entry: SubEntry = {
      method,
      params,
      onEvent,
      ...(opts?.params !== undefined ? { replayParams: opts.params } : {}),
      ...(opts?.onReplayFailed !== undefined ? { onReplayFailed: opts.onReplayFailed } : {}),
    };
    this.subs.set(key, entry);
    try {
      await this.ready();
      const res = (await this.sendRequest(method, params, key, true)) as {
        subId: string;
        snapshot: unknown;
      };
      return {
        subId: res.subId,
        snapshot: res.snapshot,
        unsubscribe: () => this.unsubscribeKey(key),
      };
    } catch (e) {
      this.subs.delete(key); // never leave an orphan the caller can't cancel
      throw e;
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.failPending();
    this.clearReplayRetries();
    this.subs.clear();
    this.subRoutes.clear();
    this.notificationListeners.clear();
    this.setStatus("closed");
    this.flushReadyWaiters(new FielddRpcError("UNAVAILABLE", "client closed"));
  }

  // ---- internals ----

  private dial(reconnecting: boolean): void {
    const WS = this.opts.webSocket ?? (globalThis as { WebSocket?: WsCtor }).WebSocket;
    if (!WS) {
      this.fail(new FielddRpcError("UNAVAILABLE", "no WebSocket implementation in this host"));
      return;
    }
    this.setStatus(reconnecting ? "reconnecting" : "connecting");
    const ws = new WS(this.opts.url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws === ws) void this.hello(ws);
    });
    ws.addEventListener("message", (ev) => {
      if (this.ws === ws) this.onMessage(String((ev as { data: unknown }).data));
    });
    ws.addEventListener("close", () => this.onClose(ws));
    ws.addEventListener("error", (ev) => {
      // close follows; a structured verdict on the error is the dial's answer
      const verdict = dialVerdictOf((ev as { error?: unknown } | null | undefined)?.error);
      if (verdict !== undefined && this.ws === ws) this.dialVerdict = verdict;
    });
  }

  private async hello(ws: WsLike): Promise<void> {
    try {
      const ack = (await this.sendRequest("system.hello", {
        contractsVersion: CONTRACTS_VERSION,
        minCompatible: CONTRACTS_VERSION,
        clientKind: this.opts.clientKind ?? "renderer",
        ...(this.credential !== "" ? { credential: this.credential } : {}),
        ...(this.opts.deviceId !== undefined ? { deviceId: this.opts.deviceId } : {}),
        ...(this.opts.userId !== undefined ? { userId: this.opts.userId } : {}),
      })) as { grantedScopes?: string[]; deviceId?: unknown };
      if (this.ws !== ws) return; // superseded by a newer dial while awaiting
      this.grantedScopes = ack.grantedScopes ?? [];
      this.helloDeviceId =
        typeof ack.deviceId === "string" && ack.deviceId !== "" ? ack.deviceId : undefined;
      this.attempts = 0;
      this.setStatus("ready");
      this.flushReadyWaiters(null);
    } catch (e) {
      if (this.ws !== ws) return;
      const kind = e instanceof FielddRpcError ? e.kind : "INTERNAL";
      if (kind === "INCOMPATIBLE" || kind === "UNAUTHORIZED" || kind === "PRECONDITION_FAILED") {
        // terminal: the same token/version can never succeed — do not retry
        this.fail(e instanceof FielddRpcError ? e : new FielddRpcError(kind, String(e)));
        return;
      }
      ws.close(); // transient — the close event schedules the reconnect
      return;
    }
    // S3 — the hello's verdict stands from here: what a replay meets is its
    // subscription's own (replaySubscriptions never throws)
    await this.replaySubscriptions(ws);
  }

  private onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // tolerant reader: garbage frames never fatal
    }
    const id = msg["id"];
    if (typeof id === "number") {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      const err = msg["error"] as
        | {
            code?: number;
            message?: string;
            data?: { kind?: string; retryable?: boolean; details?: unknown };
          }
        | undefined;
      if (err) {
        p.reject(
          new FielddRpcError(
            err.data?.kind ?? "INTERNAL",
            err.message ?? "rpc error",
            err.data?.retryable ?? false,
            err.data?.details,
            err.code,
          ),
        );
        return;
      }
      // install the subscription route BEFORE resolving (same-frame safety +
      // replay bookkeeping — the NativeLink lesson, kept on principle)
      if (p.subKey !== undefined) {
        const subId = (msg["result"] as { subId?: unknown } | undefined)?.subId;
        if (typeof subId === "string") {
          this.subRoutes.set(subId, p.subKey);
          const sub = this.subs.get(p.subKey);
          if (sub) sub.subId = subId;
        }
      }
      p.resolve(msg["result"]);
      return;
    }
    const method = msg["method"] as string | undefined;
    const params = msg["params"] as { subId?: string; payload?: unknown } | undefined;
    if (params?.subId && (method?.endsWith(".delta") || method?.endsWith(".snapshot"))) {
      const key = this.subRoutes.get(params.subId);
      const sub = key === undefined ? undefined : this.subs.get(key);
      sub?.onEvent(params.payload, method.endsWith(".snapshot") ? "snapshot" : "delta");
      return;
    }
    if (method === PRODUCT_NOTIFICATIONS.TICK && this.opts.onTick !== undefined) {
      const tick = SystemTick.safeParse(msg["params"]);
      if (tick.success) {
        try {
          this.opts.onTick({ at: tick.data.at, intervalMs: tick.data.intervalMs });
        } catch {
          // a consumer's bug never breaks response/subscription routing
        }
      }
    }
    if (method !== undefined) {
      for (const listener of [...(this.notificationListeners.get(method) ?? [])]) {
        try {
          listener(msg["params"]);
        } catch {
          // One consumer cannot break response/subscription routing for peers.
        }
      }
    }
  }

  private onClose(ws: WsLike): void {
    if (ws !== this.ws) return; // stale socket
    this.ws = null;
    const verdict = this.dialVerdict;
    this.dialVerdict = null;
    if (verdict !== null) {
      // DS-1b — the floor refused the road: every caller waiting on this dial
      // hears the honest state now; the reconnect below still happens
      this.failPending(verdict);
      this.flushReadyWaiters(verdict);
    } else {
      this.failPending();
    }
    this.clearReplayRetries(); // the next hello replays every standing subscription
    this.subRoutes.clear();
    if (this.closedByUser || this.status === "failed" || this.status === "closed") return;
    this.scheduleReconnect();
  }

  /** Idempotent: at most one reconnect timer exists at any moment. */
  private scheduleReconnect(): void {
    if (this.closedByUser || this.status === "failed") return;
    if (this.reconnectTimer || this.ws) return;
    const delay = Math.min(500 * 2 ** this.attempts, this.opts.maxBackoffMs ?? 10_000);
    this.attempts += 1;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.dial(true);
    }, delay);
  }

  /** P5: reconnect = fresh snapshot, one subscription at a time. Each replay
   * is its own (S3): one the daemon refuses ends alone and its owner hears
   * why, or — retryable, with no owner — the client re-asks it alone; the rest
   * still replay and `ready` stands. A socket lost mid-replay stops the pass:
   * the next hello replays whatever is still standing. Never throws. */
  private async replaySubscriptions(ws: WsLike): Promise<void> {
    for (const [key, sub] of [...this.subs]) {
      if (this.ws !== ws) return;
      // unsent: still owned by its pending subscribe() call; gone: unsubscribed meanwhile
      if (!sub.sentOnce || this.subs.get(key) !== sub) continue;
      await this.replayOne(ws, key, sub);
    }
  }

  private async replayOne(ws: WsLike, key: number, sub: SubEntry): Promise<void> {
    let res: { subId?: unknown; snapshot?: unknown };
    try {
      res = (await this.sendRequest(sub.method, this.replayParams(sub), key)) as typeof res;
    } catch (e) {
      // the socket went under the replay, or its owner left: nothing to judge
      if (this.ws !== ws || this.subs.get(key) !== sub) return;
      const error = e instanceof FielddRpcError ? e : new FielddRpcError("INTERNAL", String(e));
      if (sub.onReplayFailed === undefined && error.retryable) {
        this.retryReplay(ws, key, sub);
        return;
      }
      this.subs.delete(key);
      try {
        sub.onReplayFailed?.(error);
      } catch {
        // the owner's recovery is its own — the other subscriptions still replay
      }
      return;
    }
    if (this.subs.get(key) !== sub) {
      // unsubscribed while the replay was in flight: release what it stood up
      if (typeof res.subId === "string") {
        this.subRoutes.delete(res.subId);
        if (this.ws === ws && this.status === "ready")
          void this.sendRequest("system.unsubscribe", { subId: res.subId }).catch(() => {});
      }
      return;
    }
    sub.replayRetries = 0;
    try {
      sub.onEvent(res.snapshot, "snapshot"); // P5: reconnect = fresh snapshot
    } catch {
      // a consumer's failure is its own — it must not stop the replay pass
    }
  }

  /** A RETRYABLE replay refusal no owner decides: the client asks again for
   * this one subscription, on the reconnect backoff, while the socket that
   * refused it stands (a new socket replays it anyway). */
  private retryReplay(ws: WsLike, key: number, sub: SubEntry): void {
    if (sub.replayRetry !== undefined) clearTimeout(sub.replayRetry);
    const attempt = sub.replayRetries ?? 0;
    sub.replayRetries = attempt + 1;
    const delay = Math.min(500 * 2 ** attempt, this.opts.maxBackoffMs ?? 10_000);
    sub.replayRetry = setTimeout(() => {
      sub.replayRetry = undefined;
      if (this.ws !== ws || this.status !== "ready" || this.subs.get(key) !== sub) return;
      void this.replayOne(ws, key, sub);
    }, delay);
  }

  private clearReplayRetries(): void {
    for (const sub of this.subs.values()) {
      if (sub.replayRetry === undefined) continue;
      clearTimeout(sub.replayRetry);
      sub.replayRetry = undefined;
    }
  }

  /** What a replay asks with: its owner's params NOW, else the first ones. */
  private replayParams(sub: SubEntry): unknown {
    if (sub.replayParams === undefined) return sub.params;
    try {
      return sub.replayParams();
    } catch {
      return sub.params; // the supplier's failure is its owner's; the replay still goes
    }
  }

  private unsubscribeKey(key: number): void {
    const entry = this.subs.get(key);
    this.subs.delete(key);
    if (entry?.replayRetry !== undefined) clearTimeout(entry.replayRetry);
    if (entry?.subId) {
      this.subRoutes.delete(entry.subId);
      if (this.status === "ready")
        void this.sendRequest("system.unsubscribe", { subId: entry.subId }).catch(() => {});
    }
  }

  /** `ready()` inside a call's bound: past its deadline the wait is withdrawn
   * and refused `timeout`, so the call is never sent after its caller was told
   * it failed. */
  private readyWithin(bound: CallBound): Promise<void> {
    if (this.status === "ready" || this.status === "failed" || this.status === "closed")
      return this.ready();
    this.connect();
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(
        () => {
          this.readyWaiters = this.readyWaiters.filter((w) => w !== waiter);
          reject(timedOut(bound.method, bound.timeoutMs));
        },
        Math.max(0, bound.deadline - Date.now()),
      );
      this.readyWaiters.push(waiter);
    });
  }

  private sendRequest(
    method: string,
    params: unknown,
    subKey?: number,
    dropSubOnFailure = false,
    bound?: CallBound,
  ): Promise<unknown> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new FielddRpcError("UNAVAILABLE", "not connected", true));
    if (subKey !== undefined) {
      const sub = this.subs.get(subKey);
      if (sub) sub.sentOnce = true;
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject, ...(dropSubOnFailure ? { dropSubOnFailure } : {}) };
      if (subKey !== undefined) entry.subKey = subKey;
      if (bound !== undefined) {
        // past the bound the entry goes, so the answer that comes late
        // resolves nothing and the map does not hold the call for ever
        const timer = setTimeout(
          () => {
            if (this.pending.get(id) !== entry) return;
            this.pending.delete(id);
            reject(timedOut(bound.method, bound.timeoutMs));
          },
          Math.max(0, bound.deadline - Date.now()),
        );
        entry.resolve = (v) => {
          clearTimeout(timer);
          resolve(v);
        };
        entry.reject = (e) => {
          clearTimeout(timer);
          reject(e);
        };
      }
      this.pending.set(id, entry);
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  private failPending(error?: FielddRpcError): void {
    for (const [, p] of this.pending) {
      if (p.subKey !== undefined && p.dropSubOnFailure === true) this.subs.delete(p.subKey);
      p.reject(error ?? new FielddRpcError("UNAVAILABLE", "connection closed", true));
    }
    this.pending.clear();
  }

  private fail(e: FielddRpcError): void {
    this.lastError = e;
    const ws = this.ws;
    this.ws = null; // detach first — the socket's close event is now stale
    this.setStatus("failed");
    ws?.close();
    this.failPending();
    this.clearReplayRetries();
    this.flushReadyWaiters(e);
  }

  private flushReadyWaiters(err: Error | null): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) err ? w.reject(err) : w.resolve();
  }

  private setStatus(s: FielddClientStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusListeners) fn();
  }
}
