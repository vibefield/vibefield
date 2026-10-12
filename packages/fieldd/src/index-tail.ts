// SP-6 (2026-10-04) — one session's LIVE TAIL over the door
// (`index.session.subscribe`, thinking-sync-planes.md §5.4 "until RO-1", SP-D5
// (a)): fieldd follows rosetta's own session socket — through rosetta's own
// client, which owns the state machine (the stamp, the resume, the `resync`
// barrier, the reconnect) — and republishes what it holds as a rows
// subscription (SP-L4, `projection.ts`): a snapshot of the newest rows, then
// deltas keyed by `timelineId` at the subscriber's floor, a `.snapshot` frame
// when rosetta replaced the table (a rewrite, its barrier, the daemon's
// restart). The bytes of a transcript ride this door until the ticket (SP-7)
// moves them to rosetta's socket; what rides is the PROJECTION
// (`index-timeline.ts`), never an asset.
//
// One socket per session, however many subscribers (a phone and a window on
// the same session share it; the last to leave closes it); each subscriber
// has its own revision chain (`RowsProjection`, one per reader) and its own
// floor. The bearer rides the subprotocol pair (AUTH.md §3) — rosetta's client
// carries it — and never leaves this process (EL7).
import { createHash } from "node:crypto";
import {
  type ApiError,
  RosettaClient,
  type SessionSubscription,
  type SubscriptionStatus,
  type TimelineEntry,
  type TimelinePage,
} from "@rosetta/protocol";
import {
  INDEX_MESH,
  IndexTimelineEntryRow,
  type IndexTimelineRow,
  type RowsCursor,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { newestRows, projectTimelineRow } from "./index-timeline";
import { RpcCallError } from "./native-link";
import {
  type DeltaFrame,
  type FrameKind,
  projectRows,
  RevisionedSubscription,
  type RevisionedView,
  type RowsProjection,
  type SnapshotFrame,
  snapshotDeltaView,
} from "./projection";
import type { RosettadState, RosettadSupervisor } from "./rosettad-supervisor";

/** How long an open waits for rosetta's first snapshot before it is the
 * honest UNAVAILABLE: rosetta's own client gives a socket 15 s to greet. */
const OPEN_TIMEOUT_MS = 15_000;

export interface IndexTailOptions {
  /** null = no daemon configured; every open is UNAVAILABLE unconfigured */
  supervisor: RosettadSupervisor | null;
  /** `@rosetta/protocol` PROTOCOL_VERSION — rosetta's client refuses another
   * at the hello, and the open names both numbers (H-D2) */
  expectedProtocolVersion: number;
  /** the socket rosetta's client dials with: Node's global `WebSocket` (22+)
   * unless a test hands another */
  WebSocketImpl?: typeof WebSocket;
  openTimeoutMs?: number;
  logger?: Logger;
}

export interface IndexTailSubscribeOptions {
  /** this subscriber's trailing-edge floor, already at the registry's */
  minIntervalMs: number;
  /** the most rows a snapshot frame carries — a tailnet caller's bound
   * (`INDEX_TAILNET_LIMITS.MAX_ROWS`); a window's is unbounded */
  rowBound: number;
  /** a kept cursor — never resumed (each subscription is its own chain), kept
   * for the record of what the reader held */
  since?: RowsCursor | undefined;
}

export interface IndexTailSubscription {
  /** the open answer: `{snapshot: {epoch, revision, rows}}` */
  open: unknown;
  start: () => void;
  dispose: () => void;
}

/** One subscriber's chain, for a reader asking why a frame did not come. */
export interface IndexTailSubscriberState {
  started: boolean;
  /** the next frame replaces the subscriber's copy */
  gapped: boolean;
  revision: number;
}

/** One session's tail as fieldd holds it (`IndexTailService.tailState`). */
export interface IndexTailState {
  /** rosetta's client: connecting · syncing · live · resyncing · closed */
  status: SubscriptionStatus | null;
  /** how many times rosetta replaced the table (a snapshot, a reset) */
  generation: number;
  rows: number;
  closed: boolean;
  subscribers: IndexTailSubscriberState[];
}

type Frame = SnapshotFrame<IndexTimelineRow> | DeltaFrame<IndexTimelineRow>;

/** The one socket of one session, shared by its subscribers. */
class SessionTail {
  readonly sessionId: string;
  /** rosetta's visible rows as its client last handed them */
  entries: readonly TimelineEntry[] = [];
  /** bumps every time rosetta REPLACED the table (a snapshot, a reset) */
  generation = 0;
  status: SubscriptionStatus | null = null;
  readonly subscribers = new Set<() => void>();
  readonly resets = new Set<() => void>();
  /** each subscriber's chain as it stands (`IndexTailService.tailState`) */
  readonly probes = new Set<() => IndexTailSubscriberState>();
  readonly #client: RosettaClient;
  readonly #subscription: SessionSubscription;
  readonly #logger: Logger;
  #ready: Promise<void>;
  #settle: { resolve: () => void; reject: (error: Error) => void } | null = null;
  #settled = false;
  #closed = false;
  /** the generation the client was built against */
  #origin: string;
  #token: string;

  constructor(
    sessionId: string,
    origin: string,
    token: string,
    WebSocketImpl: typeof WebSocket,
    logger: Logger,
  ) {
    this.sessionId = sessionId;
    this.#logger = logger;
    this.#origin = origin;
    this.#token = token;
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#settle = { resolve, reject };
    });
    this.#client = new RosettaClient({
      baseUrl: origin,
      credential: { kind: "bearer", token },
      WebSocketImpl,
      fetchFn: fetch.bind(globalThis),
    });
    this.#subscription = this.#client.subscribeSession(sessionId, {
      onSnapshot: (page: TimelinePage) => {
        this.entries = page.entries;
        this.generation += 1;
        this.#resolveReady();
        for (const reset of this.resets) reset();
      },
      onChange: (entries: TimelineEntry[]) => {
        this.entries = entries;
        for (const changed of this.subscribers) changed();
      },
      onReset: () => {
        // every held row is invalid; the replacement snapshot follows
        this.generation += 1;
      },
      onStatus: (status: SubscriptionStatus) => {
        this.status = status;
      },
      onError: (error: ApiError) => {
        this.#logger.warn("fieldd.index.tail_error", "The session socket reported an error", {
          sessionId,
          code: error.code,
          message: error.message,
        });
        if (this.#settled) return;
        this.#rejectReady(error);
      },
    });
  }

  /** Resolves at rosetta's first snapshot; rejects with the socket's own error
   * (an incompatible protocol, an unknown session) before one arrived. */
  ready(): Promise<void> {
    return this.#ready;
  }

  #resolveReady(): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#settle?.resolve();
    this.#settle = null;
  }

  #rejectReady(error: ApiError): void {
    if (this.#settled) return;
    this.#settled = true;
    const refusal =
      error.code === "incompatible_protocol"
        ? new RpcCallError("INCOMPATIBLE", error.message, false, {
            service: "index",
            state: "incompatible",
          })
        : error.code === "not_found"
          ? new RpcCallError("NOT_FOUND", "the agent index holds no such session", false)
          : new RpcCallError("UNAVAILABLE", `the session socket refused: ${error.message}`, true, {
              service: "index",
              state: "unreachable",
            });
    this.#settle?.reject(refusal);
    this.#settle = null;
    // a socket that refused the greeting has nothing to tail
    this.close();
  }

  /** The daemon answering now is another generation: re-aim the client, which
   * restarts the socket for a fresh snapshot (the subscribers reset). */
  repoint(origin: string, token: string): void {
    if (this.#closed || (origin === this.#origin && token === this.#token)) return;
    this.#origin = origin;
    this.#token = token;
    this.#client.setCredential({ kind: "bearer", token });
    if (this.#client.baseUrl === origin.replace(/\/$/, "")) this.#subscription.restart();
    else this.#client.setBaseUrl(origin);
  }

  get closed(): boolean {
    return this.#closed;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#subscription.close();
    if (!this.#settled) {
      this.#settled = true;
      this.#settle?.reject(
        new RpcCallError("UNAVAILABLE", "the session tail closed before its first snapshot", true, {
          service: "index",
          state: "unreachable",
        }),
      );
      this.#settle = null;
    }
  }
}

/** A view whose SNAPSHOT frames (the open, a reset) carry at most `bound`
 * rows — the newest — while its deltas carry every change: a tailnet
 * subscriber's window on a session, the rows before it being the page door's. */
function boundedView(
  inner: RevisionedView<SnapshotFrame<IndexTimelineRow>, DeltaFrame<IndexTimelineRow>>,
  bound: number,
): RevisionedView<SnapshotFrame<IndexTimelineRow>, DeltaFrame<IndexTimelineRow>> {
  const cut = (frame: SnapshotFrame<IndexTimelineRow>): SnapshotFrame<IndexTimelineRow> => ({
    ...frame,
    rows: newestRows(frame.rows, bound),
  });
  const view: RevisionedView<SnapshotFrame<IndexTimelineRow>, DeltaFrame<IndexTimelineRow>> = {
    open: () => cut(inner.open()),
    advance: () => inner.advance(),
    get revision() {
      return inner.revision;
    },
  };
  if (inner.heartbeat !== undefined) {
    const heartbeat = inner.heartbeat;
    view.heartbeat = () => heartbeat.call(inner);
  }
  if (inner.reset !== undefined) {
    const reset = inner.reset;
    view.reset = (): { frame: Frame; kind: FrameKind } => {
      const replacement = reset.call(inner);
      return replacement.kind === "snapshot"
        ? { frame: cut(replacement.frame as SnapshotFrame<IndexTimelineRow>), kind: "snapshot" }
        : replacement;
    };
  }
  return view;
}

export class IndexTailService {
  readonly #opts: IndexTailOptions;
  readonly #logger: Logger;
  readonly #WebSocketImpl: typeof WebSocket;
  readonly #openTimeoutMs: number;
  readonly #tails = new Map<string, SessionTail>();
  readonly #onTransition: ((state: RosettadState) => void) | null;
  #chains = 0;
  #disposed = false;

  constructor(opts: IndexTailOptions) {
    this.#opts = opts;
    this.#logger = opts.logger ?? createNoopLogger();
    this.#WebSocketImpl = opts.WebSocketImpl ?? WebSocket;
    this.#openTimeoutMs = opts.openTimeoutMs ?? OPEN_TIMEOUT_MS;
    // the daemon's generations: a new ready origin (a restart) re-aims every
    // open tail for a fresh snapshot — the old bearer is refused by the new
    // generation, and rosetta's client retries a refused upgrade silently
    if (opts.supervisor !== null && typeof opts.supervisor.on === "function") {
      this.#onTransition = (state) => {
        if (state.phase !== "ready" || state.origin === null) return;
        const credentials = opts.supervisor?.credentials() ?? null;
        if (credentials === null) return;
        for (const tail of this.#tails.values()) tail.repoint(state.origin, credentials.token);
      };
      opts.supervisor.on("transition", this.#onTransition);
    } else {
      this.#onTransition = null;
    }
  }

  /** how many sessions have an open socket right now (tests, diagnostics) */
  get openSockets(): number {
    return this.#tails.size;
  }

  /** One session's tail as it stands, or null with no socket open for it
   * (tests, diagnostics): what a reader waiting on a frame dumps when it does
   * not come — whether rosetta's client replaced the table, and whether each
   * subscriber's chain is still owed a replacement. */
  tailState(sessionId: string): IndexTailState | null {
    const tail = this.#tails.get(sessionId);
    if (tail === undefined) return null;
    return {
      status: tail.status,
      generation: tail.generation,
      rows: tail.entries.length,
      closed: tail.closed,
      subscribers: [...tail.probes].map((probe) => probe()),
    };
  }

  /** The subscriber's open answer now (rosetta's newest rows, bounded), then
   * frames at its floor. Refuses UNAVAILABLE with the index's phase while the
   * daemon is not ready, INCOMPATIBLE naming both protocol numbers when the
   * daemon speaks another, and never answers an empty page for a session the
   * socket has not yet sent (the open waits for the first snapshot). */
  async subscribe(
    sessionId: string,
    opts: IndexTailSubscribeOptions,
    emit: (payload: unknown, kind?: FrameKind) => void,
  ): Promise<IndexTailSubscription> {
    if (this.#disposed)
      throw new RpcCallError("UNAVAILABLE", "fieldd is stopping", false, {
        service: "index",
        state: "stopped",
      });
    const tail = this.#tailFor(sessionId);
    try {
      await Promise.race([
        tail.ready(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new RpcCallError(
                  "UNAVAILABLE",
                  "the agent index did not open the session's socket in time",
                  true,
                  { service: "index", state: "unreachable" },
                ),
              ),
            this.#openTimeoutMs,
          ).unref(),
        ),
      ]);
    } catch (error) {
      this.#releaseIfIdle(tail);
      throw error;
    }
    const logger = this.#logger;
    const refused = new Set<string>();
    // the subscriber's own chain over the shared rows: a row rosetta's reader
    // refuses is dropped and named once, never a dead stream
    const projection: RowsProjection<IndexTimelineRow, IndexTimelineRow, IndexTimelineRow> =
      projectRows({
        project: (row) => row,
        keyOf: (row) => row.timelineId,
        stamp: (row) => row,
      });
    const rowsNow = (): IndexTimelineRow[] => {
      const out: IndexTimelineRow[] = [];
      for (const entry of tail.entries) {
        const parsed = IndexTimelineEntryRow.safeParse(entry);
        if (!parsed.success) {
          const id = typeof entry?.timeline_id === "string" ? entry.timeline_id : "?";
          if (!refused.has(id)) {
            refused.add(id);
            logger.warn(
              "fieldd.index.tail_row_malformed",
              "A tail row fieldd cannot read was dropped",
              {
                sessionId,
                timelineId: id,
                issue: parsed.error.issues[0]?.message ?? "?",
              },
            );
          }
          continue;
        }
        out.push(projectTimelineRow(parsed.data));
      }
      return out;
    };
    projection.apply(rowsNow());
    const openedAt = tail.generation;
    this.#chains += 1;
    const epoch = `tail-${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}.${this.#chains}`;
    const view = boundedView(
      snapshotDeltaView<IndexTimelineRow>({
        table: () => projection.snapshot(),
        apply: () => projection.apply(rowsNow()),
        revision: () => projection.revision,
        epoch,
        resets: true,
      }),
      opts.rowBound,
    );
    // ProductAPI sends the open answer after this returns and calls `start`
    // after that; a frame that fires before `start` (a reset in the same
    // breath) is refused here, which the subscription reads as a GAP it
    // repairs with a snapshot once started — never a delta before its subId.
    let started = false;
    let subscription: RevisionedSubscription<
      SnapshotFrame<IndexTimelineRow>,
      DeltaFrame<IndexTimelineRow>
    > | null = null;
    const onReset = () => subscription?.resnapshot();
    const probe = (): IndexTailSubscriberState => ({
      started,
      gapped: subscription?.gapped ?? false,
      revision: subscription?.revision ?? -1,
    });
    subscription = new RevisionedSubscription({
      view,
      subscribe: (signal) => {
        tail.subscribers.add(signal);
        tail.resets.add(onReset);
        tail.probes.add(probe);
        return () => {
          tail.subscribers.delete(signal);
          tail.resets.delete(onReset);
          tail.probes.delete(probe);
        };
      },
      emit: (frame, kind) => {
        if (!started) throw new Error("the subscription has not started");
        emit(frame, kind);
      },
      minIntervalMs: Math.max(opts.minIntervalMs, INDEX_MESH.SESSION_TAIL_MIN_INTERVAL_MS),
      onError: (error) =>
        logger.warn("fieldd.index.tail_frame_failed", "A tail subscriber's frame failed", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        }),
    });
    const open = { snapshot: subscription.snapshot };
    return {
      open,
      start: () => {
        started = true;
        // the table may have moved under the open answer (rosetta reset it,
        // or a frame was refused above): the next frame replaces the copy
        if (subscription?.gapped || tail.generation !== openedAt) subscription?.resnapshot();
      },
      dispose: () => {
        subscription?.dispose();
        subscription = null;
        this.#releaseIfIdle(tail);
      },
    };
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#onTransition !== null) this.#opts.supervisor?.off("transition", this.#onTransition);
    for (const tail of this.#tails.values()) tail.close();
    this.#tails.clear();
  }

  #tailFor(sessionId: string): SessionTail {
    const existing = this.#tails.get(sessionId);
    if (existing !== undefined && !existing.closed) return existing;
    const supervisor = this.#opts.supervisor;
    const state = supervisor?.state();
    const origin = state?.origin ?? null;
    const credentials = supervisor?.credentials() ?? null;
    if (origin === null || credentials === null) {
      const phase = state?.phase ?? "unconfigured";
      throw new RpcCallError(
        "UNAVAILABLE",
        `the agent index is ${phase}${state?.detail ? `: ${state.detail}` : ""}`,
        phase !== "unconfigured",
        { service: "index", state: phase },
      );
    }
    const tail = new SessionTail(
      sessionId,
      origin,
      credentials.token,
      this.#WebSocketImpl,
      this.#logger,
    );
    this.#tails.set(sessionId, tail);
    return tail;
  }

  #releaseIfIdle(tail: SessionTail): void {
    if (tail.subscribers.size > 0) return;
    tail.close();
    if (this.#tails.get(tail.sessionId) === tail) this.#tails.delete(tail.sessionId);
  }
}
