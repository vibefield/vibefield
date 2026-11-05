import { INDEX_TICKET, IndexEndpointSet, IndexOpenTicket } from "@vibefield/contracts";
import {
  type CollaborationSubscriptionHandlers,
  RosettaClient,
  type RosettaCredential,
  type SessionSubscriptionHandlers,
  type SubscriptionStatus,
  UnauthorizedError,
} from "@vibefield/rosetta-protocol";
import type { SessionClient, SessionPort } from "@vibefield/rosetta-room";

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
//
// DS-7 (2026-10-31): a session ANOTHER desktop holds (`SessionHome`, read off
// the catalog's listing when the lease opens) is asked for by its owner:
// `index.openTicket {sessionId, device}`. This window's fieldd forwards the ask
// and hands back the same loopback pair a local ticket carries — re-homed onto
// an egress route of this desktop's sidecar — so everything below reads it
// alike. A desktop the listing already calls asleep is said so at once and not
// asked (DS-L8 — the forward would dial it until the peer link gives up); a
// road refusal at the open (the owner not answering, no road to it, its serve
// not up) is said at once in that desktop's name, never retried behind a
// spinner; a renewal keeps its patient retry, since the open stream outlives
// its grant. A recorded file there is rosetta's `wrong-scope` (the
// owner mints a forwarded ticket `read` alone), said as FILE_TARGET_REFUSAL.
//
// MA-4b (2026-11-05): the room's LIBRARY reads one presentation's bytes —
// rosettad's `/api/sessions/{id}/artifacts/{pub}/content`, a grant route, so
// it needs THAT session's grant (`readArtifact`). It never opens a lease:
// `open()` releases any lease already held for the session, which would cut
// the room's own stream of the transcript it is reading. A lease open on the
// session lends its grant (renewed once, as every lease read is); otherwise
// the read mints a ticket of its own, outside `leases` — from the session's
// own desktop (DS-7, `homeOf`) — asked again at most once, when rosettad
// refuses its grant (never for its reach); no timer, nothing left behind. A
// page is bounded at `ARTIFACT_READ_MAX_BYTES`: a larger one is refused in the
// room's own words, its body not read past the bound.

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

/** MA-4b — the most a page read through this port may hold: rosetta's own
 * capture bound (a larger source is `too_large`) and the room's preview cap. */
export const ARTIFACT_READ_MAX_BYTES = 16 * 1024 * 1024;

/** What a page read past `ARTIFACT_READ_MAX_BYTES` answers: the room's own
 * words for that bound (its library's `too_large`), since inside History the
 * room's words stand as rosetta wrote them (DESIGN.md §9). */
export const ARTIFACT_TOO_LARGE = "Source exceeds the 16 MiB limit";

/** The refusals a fresh grant cannot change: the minter gives the same window
 * the same scopes, and the route is the room's — so a read refused for one of
 * them is not renewed. */
const REACH_REFUSALS: ReadonlySet<string> = new Set(["wrong-scope", "wrong-route"]);

function reachRefused(cause: unknown): boolean {
  return (
    cause instanceof UnauthorizedError && cause.reason !== null && REACH_REFUSALS.has(cause.reason)
  );
}

/** DS-7 — the desktop a session's transcript is read from, when it is not
 * this one: its device id and, when the listing names it, its name. */
export interface SessionHome {
  readonly device: string;
  readonly name: string | null;
  /** the listing's sources call it asleep (the roster's word, DS-L8) */
  readonly asleep: boolean;
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
  /** MA-4b — one presentation's bytes, for the room's library: through the
   * session's open lease when there is one, else a one-shot ticket outside
   * the leases; at most `ARTIFACT_READ_MAX_BYTES`. */
  readArtifact(sessionId: string, publicationId: string, signal?: AbortSignal): Promise<Uint8Array>;
  /** Let go of every lease (the view unmounting). */
  dispose(): void;
}

interface Lease {
  readonly sessionId: string;
  /** DS-7 — the desktop that holds it, when it is not this one */
  readonly home: SessionHome | null;
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

/** DS-7 — a refusal about a road to ANOTHER desktop: the owner's peer link,
 * or the index ticket's two road states. Each names the desktop. */
function roadRefusal(cause: unknown): boolean {
  const refusal = refusalOf(cause);
  const service = refusal.details?.["service"];
  const state = refusal.details?.["state"];
  return (
    refusal.kind === "UNAVAILABLE" &&
    typeof refusal.details?.["device"] === "string" &&
    (service === "peer-link" ||
      (service === INDEX_TICKET.SERVICE &&
        (state === INDEX_TICKET.STATE_EGRESS_UNAVAILABLE ||
          state === INDEX_TICKET.STATE_DOORS_NOT_PUBLISHED)))
  );
}

/** DS-7 — a desktop that is asleep, in the room's words (DESIGN.md §8). */
function asleepWords(name: string | null | undefined): string {
  return `${name ?? "That desktop"} is asleep — its transcript opens when it wakes`;
}

/** fieldd's refusal of a ticket, in the room's words: the two capability
 * refusals named; since DS-7 the roads to another desktop, in that desktop's
 * name (`name`, when the listing knows it); anything else in fieldd's own
 * words. */
export function ticketRefusalWords(cause: unknown, name?: string | null): string {
  const refusal = refusalOf(cause);
  const state = refusal.details?.["state"];
  const desktop = name ?? "That desktop";
  if (refusal.kind === "UNAVAILABLE" && state === INDEX_TICKET.STATE_OFF) {
    return "This desktop has the direct plane switched off — its transcripts can't be read here";
  }
  if (refusal.kind === "UNAVAILABLE" && state === INDEX_TICKET.STATE_UNBUILT) {
    return "Transcripts on another desktop can't be read from here yet";
  }
  if (roadRefusal(cause)) {
    if (refusal.details?.["service"] === "peer-link")
      return state === "offline"
        ? asleepWords(name)
        : `${desktop} isn't answering — its transcript opens when it does`;
    return state === INDEX_TICKET.STATE_EGRESS_UNAVAILABLE
      ? `No road to ${name ?? "that desktop"} from this desktop yet`
      : `${desktop} isn't serving its history right now — open it again in a moment`;
  }
  if (cause instanceof Error && cause.message) return cause.message;
  return typeof refusal.message === "string" && refusal.message !== ""
    ? refusal.message
    : String(cause);
}

function grantOf(ticket: IndexOpenTicket): RosettaCredential {
  return { kind: "grant", grant: ticket.grant };
}

/** The ticket's origin. A window's ticket is the loopback set — another
 * desktop's too since DS-7, re-homed by this window's fieldd onto an egress
 * route — so a tailnet set here is a fieldd that cannot re-home it. */
function originOf(ticket: IndexOpenTicket): string {
  const parsed = IndexEndpointSet.safeParse(ticket.endpoints);
  if (!parsed.success)
    throw new Error("Transcripts on another desktop can't be read from here yet");
  return parsed.data.restUrl.replace(/\/$/, "");
}

/** The transport's fetch, as rosetta's client calls it. */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** MA-4b — rosettad's route for one presentation's captured bytes. */
const ARTIFACT_CONTENT_ROUTE = /^\/api\/sessions\/[^/]+\/artifacts\/[^/]+\/content$/;

function pathOf(input: RequestInfo | URL): string | null {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(href).pathname;
  } catch {
    return null;
  }
}

/** MA-4b — the transport's fetch with a page's bound. The content route
 * answers at most `ARTIFACT_READ_MAX_BYTES`, refused past it in the room's
 * words: before any body is read when its declared length says so, else as
 * soon as the body passes the bound, never read to its end. The answer keeps
 * its status and headers (rosetta's client reads its protocol version off
 * them); every other route, and every refusal, passes untouched. */
function boundedArtifactFetch(inner: FetchLike): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await inner(input, init);
    const path = pathOf(input);
    if (path === null || !ARTIFACT_CONTENT_ROUTE.test(path) || !response.ok) return response;
    const body = response.body;
    if (body === null) return response;
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) > ARTIFACT_READ_MAX_BYTES) {
      await body.cancel().catch(() => undefined);
      throw new Error(ARTIFACT_TOO_LARGE);
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ARTIFACT_READ_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(ARTIFACT_TOO_LARGE);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }) as typeof fetch;
}

export function sessionPortOver(
  client: TicketClient,
  options: SessionPortOptions = {},
  /** DS-7 — the desktop a session lives on, when it is not this one */
  homeOf: (sessionId: string) => SessionHome | null = () => null,
): HistorySessionPort {
  const now = options.now ?? (() => Date.now());
  const leases = new Map<string, Lease>();
  /** MA-4b — the one-shot page reads in flight (never leases): what
   * `dispose` stops asking. */
  const oneShots = new Set<Lease>();
  const transport = {
    ...(options.WebSocketImpl !== undefined ? { WebSocketImpl: options.WebSocketImpl } : {}),
    // MA-4b — a page read through ANY client of this port is bounded
    fetchFn: boundedArtifactFetch(
      options.fetchFn ?? ((input, init) => globalThis.fetch(input, init)),
    ),
  };

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /** One ticket for the lease's session — from its own desktop (DS-7) —
   * asked again while fieldd answers a retryable refusal and the lease is
   * open; a terminal refusal throws, and so, when `sayRoads`, does a road
   * refusal naming another desktop: the open says it rather than wait. */
  async function ticketFor(lease: Lease, sayRoads = false): Promise<IndexOpenTicket> {
    const ask = {
      sessionId: lease.sessionId,
      ...(lease.home !== null ? { device: lease.home.device } : {}),
    };
    let delay = TICKET_RETRY_MIN_MS;
    for (;;) {
      try {
        return IndexOpenTicket.parse(await client.request("index.openTicket", ask));
      } catch (cause) {
        if (lease.closed || !retryable(cause) || (sayRoads && roadRefusal(cause))) throw cause;
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
        const message = ticketRefusalWords(cause, lease.home?.name);
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

  /** MA-4b — one read of a session no lease holds: ONE ticket of its own,
   * outside `leases` (never `open()`, which releases a lease already held for
   * the session), from the session's own desktop (DS-7) — an asleep one said
   * at once and never asked, a road refusal said at once in its name. A grant
   * rosettad refused (expired, or a generation that is gone) is renewed once
   * by one more ticket, never for a refusal of its reach. It schedules no
   * renewal and leaves nothing behind: `anyClient()` never hands it out. */
  async function readOnce<T>(
    sessionId: string,
    run: (session: RosettaClient) => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const once: Lease = {
      sessionId,
      home: homeOf(sessionId),
      client: null,
      timer: null,
      renewing: null,
      closed: false,
      streams: new Map(),
    };
    if (once.home?.asleep === true) throw new Error(asleepWords(once.home.name));
    signal?.throwIfAborted();
    // a cancelled read stops asking (a ticket fieldd cannot mint YET is
    // asked again only while the read stands)
    const stop = (): void => {
      once.closed = true;
    };
    signal?.addEventListener("abort", stop, { once: true });
    oneShots.add(once);
    const ask = async (): Promise<IndexOpenTicket> => {
      try {
        return await ticketFor(once, true);
      } catch (cause) {
        signal?.throwIfAborted();
        throw new Error(ticketRefusalWords(cause, once.home?.name));
      }
    };
    try {
      const first = await ask();
      const session = new RosettaClient({
        baseUrl: originOf(first),
        credential: grantOf(first),
        ...transport,
      });
      try {
        return await run(session);
      } catch (cause) {
        if (!(cause instanceof UnauthorizedError) || once.closed || reachRefused(cause))
          throw cause;
        const next = await ask();
        session.setCredential(grantOf(next));
        const origin = originOf(next);
        if (origin !== session.baseUrl) session.setBaseUrl(origin);
        return await run(session);
      }
    } finally {
      once.closed = true;
      signal?.removeEventListener("abort", stop);
      oneShots.delete(once);
    }
  }

  return {
    async open(sessionId) {
      const previous = leases.get(sessionId);
      if (previous !== undefined) release(previous);
      const lease: Lease = {
        sessionId,
        home: homeOf(sessionId),
        client: null,
        timer: null,
        renewing: null,
        closed: false,
        streams: new Map(),
      };
      leases.set(sessionId, lease);
      if (lease.home?.asleep === true) {
        release(lease);
        throw new Error(asleepWords(lease.home.name));
      }
      let ticket: IndexOpenTicket;
      try {
        ticket = await ticketFor(lease, true);
      } catch (cause) {
        release(lease);
        throw new Error(ticketRefusalWords(cause, lease.home?.name));
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
    async readArtifact(sessionId, publicationId, signal) {
      const page = (session: RosettaClient) =>
        session.readArtifact(sessionId, publicationId, signal);
      // the room's own lease on the session lends its grant, renewed once
      const held = leases.get(sessionId);
      if (held !== undefined && !held.closed && held.client !== null) return read(held, page);
      return readOnce(sessionId, page, signal);
    },
    dispose() {
      for (const lease of [...leases.values()]) release(lease);
      for (const once of [...oneShots]) once.closed = true;
      oneShots.clear();
    },
  };
}
