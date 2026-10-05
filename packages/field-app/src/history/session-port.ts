import {
  type CollaborationSubscriptionHandlers,
  RosettaClient,
  type RosettaCredential,
  type SessionSubscriptionHandlers,
  type SubscriptionStatus,
  UnauthorizedError,
} from "@rosetta/protocol";
import type { SessionClient, SessionPort } from "@rosetta/room";
import { INDEX_TICKET, IndexEndpointSet, IndexOpenTicket } from "@vibefield/contracts";

// THE ROOM'S SESSION PORT (AR-8c; thinking-ar-history-room.md §2, AR-D37 (a)).
// One session's BODY — its live transcript, its entries, plans and assets —
// rides the direct plane: `index.openTicket {sessionId}` hands this window
// rosettad's loopback origin and an RO-10 grant for exactly that session, and
// rosetta's own client dials rosettad with it. fieldd carries no transcript
// byte (EL2); the renderer never holds the bearer (EL7) — only per-session
// grants, each bound to its session and an establishment deadline.
//
// A grant is a LEASE. It is renewed by asking the ticket again before its
// `expiresAt` (an open socket outlives its grant; a reconnect needs a fresh
// one), after a dropped stream (a daemon restart revokes every grant: its key
// is per generation), and after a refused read. rosetta's client retries a
// refused upgrade silently — no `onError` — so the renewal is this port's,
// never a retry's: the retry only carries what this port set. When the ticket
// names another origin (a restarted daemon binds a new loopback port) the
// lease repoints its one client with rosetta's own `setBaseUrl`, which aborts
// the old origin's reads and restarts every subscription there; the room keeps
// the client object it was handed for the whole lease.
//
// RO-13 (2026-10-04): the desktop window's grant carries `files` beside `read`
// (fieldd's `indexTicketScopes`), so a recorded file — the file a transcript
// row names, read from this desktop's disk by rosettad — opens through the
// lease like every other read: renewed, repointed, in rosetta's own words when
// the file is gone. Only a refusal of the grant's REACH there is said in the
// room's words (`FILE_TARGET_REFUSAL`).

/** How long before a grant's `expiresAt` its lease asks for the next one
 * (`INDEX_TICKET.TTL_MS` is ten minutes); a shorter grant renews at half its
 * life. */
export const TICKET_RENEW_LEAD_MS = 60_000;
/** The waits between asks for a ticket fieldd could not mint YET (the index
 * starting or restarting, a door that answered retryable). */
export const TICKET_RETRY_MIN_MS = 500;
export const TICKET_RETRY_MAX_MS = 10_000;

/** What opening a recorded file answers when rosettad refuses this window's
 * grant the file read: `wrong-scope`, a grant minted without `files`, or
 * `wrong-route`, a daemon from before the scope existed — neither of which a
 * fresh grant changes. The room says so in its receipt pill. *Corrected
 * 2026-10-04 (RO-13): this said the read was bearer-only upstream and that
 * every file answered these words; since the scope, a window's file read goes
 * through, and a file that is gone is rosetta's own not_found.* */
export const FILE_TARGET_REFUSAL =
  "Recorded files can't open here yet — no file door on the desktop";

/** The refusals a fresh grant cannot change: the minter gives the same window
 * the same scopes, and the route is the room's — so a read refused for one of
 * them is not renewed. */
const REACH_REFUSALS: ReadonlySet<string> = new Set(["wrong-scope", "wrong-route"]);

function reachRefused(cause: unknown): boolean {
  return (
    cause instanceof UnauthorizedError && cause.reason !== null && REACH_REFUSALS.has(cause.reason)
  );
}

/** The one call the session port makes of fieldd. */
export interface TicketClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface SessionPortOptions {
  /** rosetta's client's transport, for a host without the browser's own
   * (the witness runs in Node with `ws` and Node's fetch). */
  readonly WebSocketImpl?: typeof WebSocket;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
}

/** The port, and the two things its host asks of it beyond the room. */
export interface HistorySessionPort extends SessionPort {
  /** The newest open session's client: every grant opens every asset, so the
   * asset source reads through whichever session is being read. */
  anyClient(): RosettaClient | null;
  /** Let go of every lease (the view unmounting). */
  dispose(): void;
}

interface Lease {
  readonly sessionId: string;
  client: RosettaClient | null;
  timer: ReturnType<typeof setTimeout> | null;
  renewing: Promise<void> | null;
  closed: boolean;
  /** The subscriptions opened through this lease's client that are still
   * open, with the handlers they were handed (a refusal is said to them). */
  readonly streams: Map<
    { close(): void },
    { onError?: (error: { code: string; message: string }) => void }
  >;
}

/** A refusal fieldd expressed by throwing, read structurally (the deck's
 * client is a FielddClient; a test's is anything with a `kind`). */
function refusalOf(cause: unknown): {
  kind?: unknown;
  retryable?: unknown;
  message?: unknown;
  details?: Record<string, unknown> | undefined;
} {
  return typeof cause === "object" && cause !== null ? (cause as never) : {};
}

function retryable(cause: unknown): boolean {
  return refusalOf(cause).retryable === true;
}

/** fieldd's refusal of a ticket, in the room's words: the two capability
 * refusals named, anything else in fieldd's own words. */
export function ticketRefusalWords(cause: unknown): string {
  const refusal = refusalOf(cause);
  const state = refusal.details?.["state"];
  if (refusal.kind === "UNAVAILABLE" && state === INDEX_TICKET.STATE_OFF) {
    return "This desktop has the direct plane switched off — its transcripts can't be read here";
  }
  if (refusal.kind === "UNAVAILABLE" && state === INDEX_TICKET.STATE_UNBUILT) {
    return "Transcripts on another desktop can't be read from here yet";
  }
  if (cause instanceof Error && cause.message) return cause.message;
  return typeof refusal.message === "string" && refusal.message !== ""
    ? refusal.message
    : String(cause);
}

function grantOf(ticket: IndexOpenTicket): RosettaCredential {
  return { kind: "grant", grant: ticket.grant };
}

/** The ticket's origin. A window's ticket is the loopback set; the tailnet
 * set (another desktop's, DS-7) is not one this window can dial yet. */
function originOf(ticket: IndexOpenTicket): string {
  const parsed = IndexEndpointSet.safeParse(ticket.endpoints);
  if (!parsed.success)
    throw new Error("Transcripts on another desktop can't be read from here yet");
  return parsed.data.restUrl.replace(/\/$/, "");
}

export function sessionPortOver(
  client: TicketClient,
  options: SessionPortOptions = {},
): HistorySessionPort {
  const now = options.now ?? (() => Date.now());
  const leases = new Map<string, Lease>();
  const transport = {
    ...(options.WebSocketImpl !== undefined ? { WebSocketImpl: options.WebSocketImpl } : {}),
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
  };

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /** One ticket for the lease's session, asked again while fieldd answers a
   * retryable refusal and the lease is open; a terminal refusal throws. */
  async function ticketFor(lease: Lease): Promise<IndexOpenTicket> {
    let delay = TICKET_RETRY_MIN_MS;
    for (;;) {
      try {
        return IndexOpenTicket.parse(
          await client.request("index.openTicket", { sessionId: lease.sessionId }),
        );
      } catch (cause) {
        if (lease.closed || !retryable(cause)) throw cause;
        await wait(delay);
        if (lease.closed) throw cause;
        delay = Math.min(TICKET_RETRY_MAX_MS, delay * 2);
      }
    }
  }

  function schedule(lease: Lease, ticket: IndexOpenTicket): void {
    if (lease.timer !== null) clearTimeout(lease.timer);
    const remaining = ticket.expiresAt - now();
    const delay = Math.max(0, remaining - Math.min(TICKET_RENEW_LEAD_MS, remaining / 2));
    lease.timer = setTimeout(() => {
      lease.timer = null;
      void renew(lease);
    }, delay);
  }

  /** Apply a fresh ticket to the lease's one client: the grant first, so the
   * restart a moved origin causes presents it. */
  function apply(lease: Lease, ticket: IndexOpenTicket): void {
    const current = lease.client;
    if (current === null || lease.closed) return;
    const origin = originOf(ticket);
    current.setCredential(grantOf(ticket));
    if (origin !== current.baseUrl) current.setBaseUrl(origin);
    schedule(lease, ticket);
  }

  /** Renew the lease's grant — coalesced: every caller waits for the one ask
   * in flight. A terminal refusal is said to every open stream and ends it:
   * a silent retry with a dead grant would read as "connecting" forever. */
  function renew(lease: Lease): Promise<void> {
    if (lease.closed) return Promise.resolve();
    if (lease.renewing !== null) return lease.renewing;
    const renewing = (async () => {
      try {
        apply(lease, await ticketFor(lease));
      } catch (cause) {
        if (lease.closed) return;
        const message = ticketRefusalWords(cause);
        for (const [stream, handlers] of [...lease.streams]) {
          handlers.onError?.({ code: "internal", message });
          stream.close();
        }
      } finally {
        lease.renewing = null;
      }
    })();
    lease.renewing = renewing;
    return renewing;
  }

  /** A stream that dropped after it was live asks for a fresh grant: a daemon
   * restart revoked the old one, and the stream's own retry cannot know. */
  function watch<H extends { onStatus?: (status: SubscriptionStatus) => void }>(
    lease: Lease,
    handlers: H,
  ): { handlers: H; adopt(stream: { close(): void }): void } {
    let live = false;
    let stream: { close(): void } | null = null;
    return {
      handlers: {
        ...handlers,
        onStatus: (status: SubscriptionStatus) => {
          if (status === "live") live = true;
          else if (status === "connecting" && live) {
            live = false;
            void renew(lease);
          } else if (status === "closed" && stream !== null) lease.streams.delete(stream);
          handlers.onStatus?.(status);
        },
      },
      adopt(opened) {
        stream = opened;
        lease.streams.set(opened, handlers as never);
      },
    };
  }

  /** A read through the lease's client, renewed once when rosettad refused
   * its grant (expired, or signed by a generation that is gone) — never for
   * a refusal of its reach, which a fresh grant would only repeat. */
  async function read<T>(lease: Lease, run: (session: RosettaClient) => Promise<T>): Promise<T> {
    const session = lease.client;
    if (session === null) throw new Error("This session is not open");
    try {
      return await run(session);
    } catch (cause) {
      if (!(cause instanceof UnauthorizedError) || lease.closed || reachRefused(cause)) throw cause;
      await renew(lease);
      const renewed = lease.client;
      if (renewed === null) throw cause;
      return await run(renewed);
    }
  }

  function facade(lease: Lease): SessionClient {
    const current = (): RosettaClient => {
      if (lease.client === null) throw new Error("This session is not open");
      return lease.client;
    };
    return {
      subscribeSession(sessionId: string, handlers: SessionSubscriptionHandlers) {
        const watched = watch(lease, handlers);
        const stream = current().subscribeSession(sessionId, watched.handlers);
        watched.adopt(stream);
        return stream;
      },
      subscribeCollaboration(sessionId: string, handlers: CollaborationSubscriptionHandlers) {
        const watched = watch(lease, handlers);
        const stream = current().subscribeCollaboration(sessionId, watched.handlers);
        watched.adopt(stream);
        return stream;
      },
      timelineEntry: (sessionId, timelineId, signal) =>
        read(lease, (session) => session.timelineEntry(sessionId, timelineId, signal)),
      reportWork: (sessionId, timelineId, signal) =>
        read(lease, (session) => session.reportWork(sessionId, timelineId, signal)),
      command: (sessionId, timelineId, signal) =>
        read(lease, (session) => session.command(sessionId, timelineId, signal)),
      readPlan: (sessionId, source, signal) =>
        read(lease, (session) => session.readPlan(sessionId, source, signal)),
      readTextAsset: (asset, signal) =>
        read(lease, (session) => session.readTextAsset(asset, signal)),
      readAsset: (asset, signal) => read(lease, (session) => session.readAsset(asset, signal)),
      // RO-13: the window's grant carries `files`; a refusal of its reach is
      // the room's words, anything else (a file that is gone) rosetta's own.
      readFileTarget: (sessionId, timelineId, targetIndex, signal) =>
        read(lease, (session) =>
          session.readFileTarget(sessionId, timelineId, targetIndex, signal),
        ).catch((cause: unknown) => {
          throw reachRefused(cause) ? new Error(FILE_TARGET_REFUSAL) : cause;
        }),
    };
  }

  function release(lease: Lease): void {
    lease.closed = true;
    if (lease.timer !== null) clearTimeout(lease.timer);
    lease.timer = null;
    lease.streams.clear();
    if (leases.get(lease.sessionId) === lease) leases.delete(lease.sessionId);
  }

  return {
    async open(sessionId) {
      const previous = leases.get(sessionId);
      if (previous !== undefined) release(previous);
      const lease: Lease = {
        sessionId,
        client: null,
        timer: null,
        renewing: null,
        closed: false,
        streams: new Map(),
      };
      leases.set(sessionId, lease);
      let ticket: IndexOpenTicket;
      try {
        ticket = await ticketFor(lease);
      } catch (cause) {
        release(lease);
        throw new Error(ticketRefusalWords(cause));
      }
      if (lease.closed) throw new Error("This session was closed before it opened");
      lease.client = new RosettaClient({
        baseUrl: originOf(ticket),
        credential: grantOf(ticket),
        ...transport,
      });
      schedule(lease, ticket);
      return facade(lease);
    },
    close(sessionId) {
      const lease = leases.get(sessionId);
      if (lease !== undefined) release(lease);
    },
    anyClient() {
      const open = [...leases.values()].filter((lease) => !lease.closed && lease.client !== null);
      return open[open.length - 1]?.client ?? null;
    },
    dispose() {
      for (const lease of [...leases.values()]) release(lease);
    },
  };
}
