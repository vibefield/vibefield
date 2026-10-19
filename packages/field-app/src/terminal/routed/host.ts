import type {
  CreateSessionOptions,
  RoutedCellTransportGrant,
  RoutedSessionAttachGrant,
  RoutedTerminalOpenTicket,
  SessionSummary,
} from "@vibecook/ghosttea-protocol";
import type {
  GhostteaRoutedHost,
  GhostteaTerminalRuntime,
  RoutedExtensionMessageContext,
} from "@vibecook/ghosttea-react";
import {
  decodeTpMessage,
  type GeometryState,
  type SessionEvent,
  TERMINAL_SESSION_CAP,
  TerminalOpenTicket,
  type TerminalOpenTicket as TerminalOpenTicketValue,
  TerminalRenewAttachResult,
  TerminalRuntimeSessionsResult,
  TerminalTerminateResult,
  type TpMessageType,
} from "@vibefield/contracts";
import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { requestResolvingOutcome } from "../../forwarded-call";
import { getRendererLogger } from "../../logging";
import { createRoutedInputEncoder } from "./encode-input";
import { type RemoteRefusal, remoteRefusalOf } from "./remote-refusal";
import type { SessionSeatAnnouncement } from "./session-seat";

/** The hello advertisement for the window runtime (TP-D25): ghosttea's own
 * default `resume` plus `session-events` (TP-S3f/G24) — the load-bearing gate
 * that lets the cell emit the `SessionEvent` verb at this leg without killing
 * a client that could not decode it — and `geometry-events` (item 42), the same
 * gate for the `GeometryState` verb: the seat's holder and committed size, which
 * the pane says when another device holds it. */
export const ROUTED_CLIENT_CAPABILITIES: readonly string[] = [
  "resume",
  "session-events",
  "geometry-events",
];

/** The host verbs a control leg carries to this adapter — the contract's own
 * names for the two capabilities above; every other tag is not this seam's. */
const HOST_VERBS: readonly TpMessageType[] = ["SessionEvent", "GeometryState"];

function log() {
  return getRendererLogger().child({ component: "terminal.routed" });
}

// The production G23 adapter. It is intentionally a product-control adapter,
// not a second transport implementation: Ghosttea owns both WebSocket pools,
// activations, demand, recovery, geometry and worker presentation. This object
// only mints/renews through fieldd and supplies the VibeField input extension.

const RUNTIME_SESSION_OBSERVATION_TIMEOUT_MS = 5_000;
const RUNTIME_SESSION_OBSERVATION_RETRY_MS = 20;

/** How long a wire `removed` with NO observed `exited` is held before it
 * applies alone. A verb-driven kill publishes `Removed` at the verb (the
 * registry row is yanked synchronously) while `Exited` follows only when the
 * child actually dies — so the bus legitimately inverts the pair for kills,
 * and applying `removed` first unregisters the session, turning the following
 * `exited` into a no-op and leaving the pane face blind to the death it is
 * about to wear. The hold restores the INTENDED application order (exit facts
 * onto the face, then the unregister) without inventing anything; a removal
 * that truly has no exit (an explicit close) applies unchanged when the hold
 * expires. Sized well above a shell's SIGTERM-to-reap time and well below
 * anything a human would read as a leak. */
const REMOVED_WITHOUT_EXIT_HOLD_MS = 10_000;

export interface RoutedTerminalHostOptions {
  readonly fieldd: FielddClient;
  /** Product-owned birth door used by Ghosttea's empty-workspace fallback. */
  readonly createSession?: (options: CreateSessionOptions) => Promise<SessionSummary>;
  readonly onTicket?: (sessionId: string, ticket: TerminalOpenTicketValue) => void;
  /** The product pool's inverse for birth-summary and placement ownership. */
  readonly onTerminated?: (sessionId: string) => void;
  /** DS-4e — why the latest ask for ANOTHER desktop's session was not a
   * ticket (`remote-refusal.ts`), for the pane to say; `undefined` when a
   * ticket landed, or the ask was withdrawn — the honest state clears. */
  readonly onRemoteRefusal?: (sessionId: string, refusal: RemoteRefusal | undefined) => void;
  /** item 42 — the cell's announcement of a session's geometry seat
   * (`GeometryState`), as it arrived, with whether its holder is THIS window
   * (`session-seat.ts`); the pool keeps the newest, so a stale one is its to
   * drop. */
  readonly onSessionSeat?: (sessionId: string, seat: SessionSeatAnnouncement) => void;
}

export interface RoutedTerminalHostBinding {
  readonly host: GhostteaRoutedHost;
  /** Seed the first activation with the ticket returned atomically by create. */
  primeTicket(sessionId: string, ticket: TerminalOpenTicketValue): void;
  /** DS-4e — this session lives on ANOTHER desktop (`device`, the owner's
   * roster id): from here every ask for it — the ticket, its renewal, the kill,
   * the inventory its pane is refreshed and reconciled from — names the owner,
   * and this window's daemon forwards it (`thinking-desktop-sync-plane.md`
   * §6.3). A session never placed is this desktop's, asked as it always was. */
  placeRemote(sessionId: string, device: string): void;
  /** DS-4e — the owner's EXACT engine summary for one of its sessions
   * (`terminal.sessions {device}`, read fresh), which is what a pane mounts by:
   * the decimal `handle` exists in no other answer. Null when the owner does
   * not list the session. */
  readRemoteSession(device: string, sessionId: string): Promise<SessionSummary | null>;
  /** DS-4e — the roster's row for `device` flipped (its standing changed: the
   * device subscription the monitor holds says so). Every ask waiting on that
   * desktop is asked again, ONCE — the only re-ask there is: never a timer. */
  deviceFlipped(device: string): void;
  /** Install the activation-lifecycle inverse after the runtime exists. */
  bind(runtime: GhostteaTerminalRuntime): void;
  dispose(): void;
}

/** DS-4e — one ask parked until its owner's roster row next flips. */
interface FlipWait {
  readonly sessionId: string;
  wake(): void;
  withdraw(cause: Error): void;
}

interface RoutedActivationStateLike {
  readonly activationId: string;
  readonly phase: string;
}

interface RoutedActivationEventDetail {
  readonly sessionId: string;
  readonly previous: RoutedActivationStateLike;
  readonly current: RoutedActivationStateLike;
}

function asSessionSummaries(raw: unknown): SessionSummary[] {
  // This assignment is a compile-time cross-package drift guard: our Zod wire
  // shape must remain structurally usable by the pinned Ghosttea runtime.
  return TerminalRuntimeSessionsResult.parse(raw).sessions.map((session) => {
    const { scrollbackBytes, ...required } = session;
    return scrollbackBytes === undefined ? required : { ...required, scrollbackBytes };
  });
}

function asTransportGrant(
  grant: TerminalOpenTicketValue["transportGrant"],
): RoutedCellTransportGrant {
  return {
    ...grant,
    protected: { ...grant.protected, typ: "CellTransportGrant" },
  };
}

function asAttachGrant(grant: TerminalOpenTicketValue["attachGrant"]): RoutedSessionAttachGrant {
  const { leaseEpoch, ...requiredClaims } = grant.claims;
  return {
    ...grant,
    protected: { ...grant.protected, typ: "SessionAttachGrant" },
    claims: leaseEpoch === undefined ? requiredClaims : { ...requiredClaims, leaseEpoch },
  };
}

/** Remove Zod's explicit-undefined optional keys at the library boundary. */
function asRoutedTicket(ticket: TerminalOpenTicketValue): RoutedTerminalOpenTicket {
  const { route: rawRoute, endpoints, transportGrant, attachGrant } = ticket;
  const { leaseEpoch, ...requiredRoute } = rawRoute;
  const route = leaseEpoch === undefined ? requiredRoute : { ...requiredRoute, leaseEpoch };
  return {
    route,
    ...(endpoints === undefined ? {} : { endpoints }),
    transportGrant: asTransportGrant(transportGrant),
    attachGrant: asAttachGrant(attachGrant),
  };
}

function requireDirectTicket(sessionId: string, raw: unknown): TerminalOpenTicketValue {
  // TP-S3e: endpoints are REQUIRED by the schema — a doorless or legacy-trio
  // answer refuses at the parse. A compliant fieldd never sends one (a keyless
  // floor is an UNAVAILABLE refusal upstream), so this firing means a contract
  // break, and it must be loud.
  const parsed = TerminalOpenTicket.safeParse(raw);
  if (!parsed.success) throw new Error("the terminal ticket does not carry the routed contract");
  if (parsed.data.attachGrant.claims.sessionId !== sessionId) {
    throw new Error("terminal ticket names a different session");
  }
  return parsed.data;
}

function isUnobservedInventory(cause: unknown): boolean {
  if (!(cause instanceof Error) || !("kind" in cause) || cause.kind !== "UNAVAILABLE") {
    return false;
  }
  const details = (cause as { details?: unknown }).details;
  return (
    details !== null &&
    typeof details === "object" &&
    "state" in details &&
    (details as { state: unknown }).state === "unobserved"
  );
}

/** Preserve fieldd's honest observation gate without turning its startup race
 * into a permanent failed Workspace initialization. Other failures propagate
 * immediately; only the explicitly retryable `unobserved` state is awaited.
 * DS-4e: with a `device`, the OWNER's inventory — the same read, forwarded.
 * The 5 s bound holds over every attempt, not only between them: one answer
 * that never came used to pin the read, and every pane joined to it. */
async function listRuntimeSessions(
  fieldd: FielddClient,
  device?: string,
): Promise<SessionSummary[]> {
  const deadline = Date.now() + RUNTIME_SESSION_OBSERVATION_TIMEOUT_MS;
  const params = device === undefined ? {} : { device };
  for (;;) {
    try {
      return asSessionSummaries(await sessionsBefore(fieldd, params, deadline));
    } catch (cause) {
      if (!isUnobservedInventory(cause) || Date.now() >= deadline) throw cause;
      await new Promise((resolve) => setTimeout(resolve, RUNTIME_SESSION_OBSERVATION_RETRY_MS));
    }
  }
}

/** One `terminal.sessions` attempt, raced against what is left of the read's
 * deadline. The client is handed the same bound, so a real one drops the call
 * it can no longer answer; whichever gives up first, the refusal is the READ's
 * — `UNAVAILABLE {state: "timeout", timeoutMs}` at its 5 s — which the pool
 * says in the owner's name (`floorReadWithin`). */
function sessionsBefore(
  fieldd: FielddClient,
  params: { device?: string },
  deadline: number,
): Promise<unknown> {
  const timeoutMs = Math.max(1, deadline - Date.now());
  const lapsed = () =>
    new FielddRpcError(
      "UNAVAILABLE",
      `terminal.sessions had no answer within ${RUNTIME_SESSION_OBSERVATION_TIMEOUT_MS} ms`,
      true,
      { service: "terminal", state: "timeout", timeoutMs: RUNTIME_SESSION_OBSERVATION_TIMEOUT_MS },
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(lapsed()), timeoutMs);
  });
  return Promise.race([fieldd.request("terminal.sessions", params, { timeoutMs }), expired])
    .catch((cause: unknown) => {
      // the client's own `timeout` is the same lapse, said once, as the read's
      throw isTimedOut(cause) ? lapsed() : cause;
    })
    .finally(() => clearTimeout(timer));
}

function isTimedOut(cause: unknown): boolean {
  if (!(cause instanceof Error) || !("kind" in cause) || cause.kind !== "UNAVAILABLE") {
    return false;
  }
  const details = (cause as { details?: unknown }).details;
  return (
    details !== null &&
    typeof details === "object" &&
    (details as { state?: unknown }).state === "timeout"
  );
}

/** Build one host/encoder scope for one window runtime. */
export function createRoutedTerminalHost(
  options: RoutedTerminalHostOptions,
): RoutedTerminalHostBinding {
  const input = createRoutedInputEncoder({ maxTrackedSessions: TERMINAL_SESSION_CAP });
  const activations = new Map<string, string>();
  const primedTickets = new Map<string, TerminalOpenTicketValue>();
  /** sessionId → the cellBootId its ticket named (TP-S3f): the custody fact a
   * `SessionEvent`'s authenticated context is checked against. */
  const custodians = new Map<string, string>();
  /** item 42 — sessionId → every clientId this window's tickets for it named
   * (the attach grant's, which is the client ghosttea claims the seat as): a
   * seat whose holder is one of them is THIS window's. Every one, not the
   * latest: a fieldd restart mints this window a new client while the cell may
   * still hold the seat for the one before, within its grace. */
  const ownClients = new Map<string, Set<string>>();
  const ownClient = (sessionId: string, clientId: string): void => {
    const clients = ownClients.get(sessionId) ?? new Set<string>();
    clients.add(clientId);
    ownClients.set(sessionId, clients);
  };
  /** Sessions whose `exited` event this host has already applied. */
  const exitApplied = new Set<string>();
  /** `removed` events held awaiting their kill's `exited` (see the hold const). */
  const heldRemovals = new Map<string, ReturnType<typeof setTimeout>>();
  /** DS-4e — sessionId → the desktop that OWNS it, for a session this window
   * shows from another desktop (`placeRemote`). Absent: this desktop's own. */
  const remotes = new Map<string, string>();
  /** The params of a session-scoped ask: the owner named when it is another
   * desktop's, exactly `{sessionId}` when it is this one's. */
  const routed = <T extends { sessionId: string }>(params: T): T | (T & { device: string }) => {
    const device = remotes.get(params.sessionId);
    return device === undefined ? params : { ...params, device };
  };
  /** DS-4e — asks parked until their owner's roster row next flips, by owner. */
  const flipWaits = new Map<string, Set<FlipWait>>();
  /** DS-4e — how many flips each owner has had in this host's life: an ask
   * refused after a flip landed WHILE it was out re-asks at once — the flip
   * earned it — instead of waiting for one more. */
  const flipCounts = new Map<string, number>();
  /** DS-4e — bumped per session by a withdrawal, so an ask still OUT when its
   * session was let go neither says its refusal nor parks itself afterwards. */
  const askEpochs = new Map<string, number>();
  const askEpoch = (sessionId: string): number => askEpochs.get(sessionId) ?? 0;
  const nextFlip = (sessionId: string, device: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const waits = flipWaits.get(device) ?? new Set<FlipWait>();
      waits.add({ sessionId, wake: resolve, withdraw: reject });
      flipWaits.set(device, waits);
    });
  /** Withdraw the parked asks for one session (every one, without an id): the
   * session left, its activation ended, or the host is going. Each rejects —
   * the runtime has nothing left to dial it for — and its honest state clears. */
  const withdrawAsks = (sessionId?: string): void => {
    if (sessionId !== undefined) askEpochs.set(sessionId, askEpoch(sessionId) + 1);
    for (const [device, waits] of [...flipWaits]) {
      for (const wait of [...waits]) {
        if (sessionId !== undefined && wait.sessionId !== sessionId) continue;
        waits.delete(wait);
        wait.withdraw(new Error(`the ask for ${wait.sessionId} on ${device} was withdrawn`));
        options.onRemoteRefusal?.(wait.sessionId, undefined);
      }
      if (waits.size === 0) flipWaits.delete(device);
    }
  };
  /**
   * DS-4e — one ticket from the OWNER (§6.3 steps 1–5). A refusal is said
   * (`onRemoteRefusal`); one that may heal waits for the owner's next roster
   * flip and is asked again then, once per flip; one that cannot is thrown,
   * and the runtime ends the activation unavailable. Never a timer.
   */
  const askOwner = async (sessionId: string, device: string): Promise<TerminalOpenTicketValue> => {
    const epoch = askEpoch(sessionId);
    for (;;) {
      const flipsBefore = flipCounts.get(device) ?? 0;
      try {
        // DS-D15 — one logical mint, its outcome resolved as for a local one
        const raw = await requestResolvingOutcome(
          options.fieldd,
          "terminal.openTicket",
          { device, sessionId },
          "ask-anew",
        );
        const ticket = requireDirectTicket(sessionId, raw);
        options.onRemoteRefusal?.(sessionId, undefined);
        return ticket;
      } catch (cause) {
        // withdrawn or re-placed while the ask was out: not this ask's to say
        if (disposed || askEpoch(sessionId) !== epoch || remotes.get(sessionId) !== device) {
          throw cause;
        }
        const refusal = remoteRefusalOf(cause, device);
        options.onRemoteRefusal?.(sessionId, refusal);
        if (!refusal.waits) throw cause;
        if ((flipCounts.get(device) ?? 0) === flipsBefore) await nextFlip(sessionId, device);
      }
    }
  };
  let boundRuntime: GhostteaTerminalRuntime | null = null;
  let disposed = false;

  const applyRemoved = (sessionId: string): void => {
    const held = heldRemovals.get(sessionId);
    if (held !== undefined) {
      clearTimeout(held);
      heldRemovals.delete(sessionId);
    }
    invalidateInventory();
    primedTickets.delete(sessionId);
    activations.delete(sessionId);
    input.releaseSession(sessionId);
    boundRuntime?.applySessionEvent({ type: "removed", sessionId });
    custodians.delete(sessionId);
    ownClients.delete(sessionId);
    exitApplied.delete(sessionId);
    remotes.delete(sessionId);
    withdrawAsks(sessionId);
    options.onTerminated?.(sessionId);
  };

  // All panes share one short-lived inventory PER DESKTOP, including staggered
  // refreshes: this desktop's own (the key "") and, for a pane showing another
  // desktop's session, its OWNER's (DS-4e — the same read, forwarded by
  // `device`). Lifecycle resync bypasses it: authoritative absence must never
  // be cached.
  interface InventoryReader {
    read: Promise<Map<string, SessionSummary>> | null;
    inventory: Map<string, SessionSummary> | null;
    at: number;
  }
  const readers = new Map<string, InventoryReader>();
  let inventoryGeneration = 0;
  const invalidateInventory = (): void => {
    readers.clear();
    inventoryGeneration += 1;
  };
  const readInventory = (
    fresh = false,
    device?: string,
    reread = false,
  ): Promise<Map<string, SessionSummary>> => {
    const key = device ?? "";
    let reader = readers.get(key);
    if (reader === undefined) {
      reader = { read: null, inventory: null, at: 0 };
      readers.set(key, reader);
    }
    if (!fresh && reader.inventory !== null && Date.now() - reader.at < 200) {
      return Promise.resolve(reader.inventory);
    }
    if (reader.read !== null) return reader.read;
    const generation = inventoryGeneration;
    const current = reader;
    // A read that fails — its 5 s bound among the ways — lets go of
    // `current.read` (the `finally`), so the next pane's turn reads fresh
    // instead of joining a read that will never answer.
    const read = listRuntimeSessions(options.fieldd, device)
      .then((sessions) => {
        const inventory = new Map(sessions.map((session) => [session.id, session]));
        // invalidated while it was read: ONE re-read sees what moved; a floor
        // that moves under the re-read too is answered with it, uncached,
        // rather than chased without end
        if (generation !== inventoryGeneration)
          return reread ? inventory : readInventory(false, device, true);
        current.inventory = inventory;
        current.at = Date.now();
        return inventory;
      })
      .finally(() => {
        if (current.read === read) current.read = null;
      });
    current.read = read;
    return read;
  };

  /** The G24 lag answer: the cell's bounded lifecycle bus dropped events, so
   * deltas can no longer be trusted — reconcile THIS cell's tracked sessions
   * against the authoritative inventory: present ids get their full summary
   * re-applied, absent ids are removals the bus lost. DS-4e: the inventory is
   * the OWNER's for a session another desktop holds — its absence from THIS
   * desktop's floor says nothing, and reading it there would unregister every
   * remote pane on the first resync its cell sent. */
  const resyncCustody = async (cellBootId: string): Promise<void> => {
    invalidateInventory();
    const owners = new Set<string | undefined>();
    for (const [sessionId, custodian] of custodians) {
      if (custodian === cellBootId) owners.add(remotes.get(sessionId));
    }
    // nothing tracked in this cell: this desktop's own read, as it always was
    if (owners.size === 0) owners.add(undefined);
    const inventories = new Map<string | undefined, Map<string, SessionSummary>>();
    for (const owner of owners) inventories.set(owner, await readInventory(true, owner));
    if (disposed) return;
    for (const [sessionId, custodian] of [...custodians]) {
      if (custodian !== cellBootId) continue;
      // a session placed on another desktop meanwhile has no read here: left standing
      const inventory = inventories.get(remotes.get(sessionId));
      if (inventory === undefined) continue;
      const summary = inventory.get(sessionId);
      if (summary === undefined) {
        // Authoritative absence outranks any held ordering repair.
        applyRemoved(sessionId);
      } else {
        boundRuntime?.applySessionEvent({ type: "updated", session: summary });
      }
    }
  };

  /** item 42 — a session's geometry seat, as its cell announced it: handed to
   * the pool with whether the holder is this window. Custody is checked as for a
   * `SessionEvent`, and a session no ticket of this window's names is dropped
   * outright: the cell announces a seat only to a leg with an activation of the
   * session, so this window has no seat of it to say. */
  const applyGeometryState = (
    state: GeometryState,
    context: RoutedExtensionMessageContext,
  ): void => {
    if (custodians.get(state.sessionId) !== context.cellBootId) return;
    const holder = state.holder;
    options.onSessionSeat?.(state.sessionId, {
      holder,
      mine: holder !== null && ownClients.get(state.sessionId)?.has(holder.clientId) === true,
      revision: state.geometryRevision,
      cols: state.cols,
      rows: state.rows,
    });
  };

  const applyWireSessionEvent = (
    event: SessionEvent["event"],
    context: RoutedExtensionMessageContext,
  ): void => {
    if (event.kind === "resync") {
      void resyncCustody(context.cellBootId).catch(() => {
        // A failed authoritative read leaves current state standing; the next
        // metadata refresh (or resync) retries against the same coalescer.
      });
      return;
    }
    // A cell may only speak for sessions whose ticket named it. A session this
    // window never ticketed passes: the deck tracks roster sessions it never
    // attached, and the runtime ignores ids it does not know.
    const custodian = custodians.get(event.sessionId);
    if (custodian !== undefined && custodian !== context.cellBootId) {
      // A foreign cell claiming a session another cell's ticket named: dropped.
      return;
    }
    if (event.kind === "exited") {
      invalidateInventory();
      boundRuntime?.applySessionEvent({
        type: "exited",
        sessionId: event.sessionId,
        exitCode: event.exitCode,
        exitSignal: event.exitSignal,
        requestedTermination: event.requestedTermination,
        exitOutcome: event.exitOutcome,
      });
      exitApplied.add(event.sessionId);
      // The kill ordering repair: a verb-driven kill's `removed` reached us
      // first and is being held — its exit facts are now on the face, so the
      // unregister can follow in the INTENDED order.
      if (heldRemovals.has(event.sessionId)) applyRemoved(event.sessionId);
      return;
    }
    if (exitApplied.has(event.sessionId) || heldRemovals.has(event.sessionId)) {
      // Exit already applied (or a duplicate removal): no reason to hold.
      applyRemoved(event.sessionId);
      return;
    }
    // No exit observed yet: hold (see REMOVED_WITHOUT_EXIT_HOLD_MS) so a
    // kill's late `Exited` can land on a still-registered session.
    heldRemovals.set(
      event.sessionId,
      setTimeout(() => {
        heldRemovals.delete(event.sessionId);
        if (!disposed) applyRemoved(event.sessionId);
      }, REMOVED_WITHOUT_EXIT_HOLD_MS),
    );
  };

  /** The host's door for the negotiated verbs ghosttea hands over from an
   * authenticated control leg (`onExtensionMessage`). */
  const applyWireMessage = (
    message: Readonly<Record<string, unknown>>,
    context: RoutedExtensionMessageContext,
  ): void => {
    // Only the control leg carries host verbs today; the tag list is the
    // contract's own outbound set for this seam.
    const decoded = decodeTpMessage(message, HOST_VERBS);
    if (!decoded.ok) {
      // Tolerant reader: dropped, never a transport failure — `invalid`
      // includes a future `kind` this build predates (the wire comment in
      // terminal-pipeline.ts is the law). Silence over console noise is this
      // layer's house style; the drop matrix is pinned by the host tests.
      // item 42 — the one exception: a GeometryState this build cannot read is
      // the cell and this build disagreeing about a shape both name, so it is
      // said (by its field paths, never its values), and dropped all the same.
      if (message["type"] === "GeometryState") {
        log().warn(
          "renderer.terminal.geometry_state_dropped",
          "A GeometryState this window cannot read was dropped; the control leg stays open",
          {
            reason: decoded.error,
            fields: (decoded.issues ?? []).map((issue) => issue.path.join(".")),
          },
        );
      }
      return;
    }
    if (decoded.type === "GeometryState") {
      applyGeometryState(decoded.body as GeometryState, context);
      return;
    }
    applyWireSessionEvent((decoded.body as SessionEvent).event, context);
  };

  const onActivationState: EventListener = (event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail as RoutedActivationEventDetail;
    if (
      detail === null ||
      typeof detail !== "object" ||
      typeof detail.sessionId !== "string" ||
      typeof detail.current?.activationId !== "string"
    )
      return;

    const previous = activations.get(detail.sessionId);
    if (previous !== undefined && previous !== detail.current.activationId) {
      input.releaseActivation(detail.sessionId, previous);
    }
    activations.set(detail.sessionId, detail.current.activationId);

    if (detail.current.phase === "ended") {
      input.releaseSession(detail.sessionId);
      activations.delete(detail.sessionId);
      // DS-4e — the pane let it go (a detach ends any activation): an ask
      // still parked for its owner's flip has nobody left to dial for
      withdrawAsks(detail.sessionId);
    }
  };

  const host: GhostteaRoutedHost = {
    openTicket: async (sessionId) => {
      const primed = primedTickets.get(sessionId);
      if (primed !== undefined) {
        primedTickets.delete(sessionId);
        custodians.set(sessionId, primed.route.cellBootId);
        ownClient(sessionId, primed.attachGrant.claims.clientId);
        options.onTicket?.(sessionId, primed);
        return asRoutedTicket(primed);
      }
      // DS-D15 — one logical mint: an outcome-unknown (a ticket forwarded to
      // its owner, its answer lost) is asked once more with its key, and a
      // receipt in place of the ticket is asked ANEW — a second ticket is
      // harmless, the lost one expires. A local mint never fails that way.
      //
      // DS-4e — a session another desktop owns is asked of its OWNER
      // (`askOwner`): this window's daemon forwards the mint, and its answer's
      // doors are already a loopback pair here (the rewriter's egress route),
      // dialled exactly as a local cell's.
      const device = remotes.get(sessionId);
      const ticket =
        device === undefined
          ? requireDirectTicket(
              sessionId,
              await requestResolvingOutcome(
                options.fieldd,
                "terminal.openTicket",
                { sessionId },
                "ask-anew",
              ),
            )
          : await askOwner(sessionId, device);
      custodians.set(sessionId, ticket.route.cellBootId);
      ownClient(sessionId, ticket.attachGrant.claims.clientId);
      options.onTicket?.(sessionId, ticket);
      return asRoutedTicket(ticket);
    },
    renewAttach: async (params) => {
      // DS-4e §6.3 step 6 — a forwarded ticket is renewed by the same road
      const renewed = TerminalRenewAttachResult.parse(
        await options.fieldd.request("terminal.renewAttach", routed(params)),
      );
      ownClient(params.sessionId, renewed.attachGrant.claims.clientId);
      return { attachGrant: asAttachGrant(renewed.attachGrant) };
    },
    listSessions: async () => await listRuntimeSessions(options.fieldd),
    // TP-S3f/G24: the routed metadata refresh — ghosttea arms its existing
    // 200ms cadence from routed frame commits and asks HERE; the coalescer
    // makes N concurrent asks one wire read. `null` = no update, never an
    // invented removal (absence from a snapshot is the RESYNC path's fact to
    // assert, not a refresh's). DS-4e: a remote pane refreshes from its OWNER.
    getSession: async (sessionId) =>
      (await readInventory(false, remotes.get(sessionId))).get(sessionId) ?? null,
    onExtensionMessage: applyWireMessage,
    ...(options.createSession === undefined ? {} : { createSession: options.createSession }),
    terminate: async (sessionId) => {
      try {
        TerminalTerminateResult.parse(
          await options.fieldd.request("terminal.terminate", routed({ sessionId })),
        );
        options.onTerminated?.(sessionId);
      } finally {
        invalidateInventory();
        primedTickets.delete(sessionId);
        custodians.delete(sessionId);
        ownClients.delete(sessionId);
        input.releaseSession(sessionId);
        activations.delete(sessionId);
        remotes.delete(sessionId);
        withdrawAsks(sessionId);
      }
    },
    encodeInput: input.encodeInput,
  };

  return {
    host,
    placeRemote: (sessionId, device) => {
      if (disposed) throw new Error("the routed terminal host is disposed");
      remotes.set(sessionId, device);
    },
    readRemoteSession: async (device, sessionId) =>
      (await readInventory(true, device)).get(sessionId) ?? null,
    deviceFlipped: (device) => {
      if (disposed) return;
      flipCounts.set(device, (flipCounts.get(device) ?? 0) + 1);
      const waits = flipWaits.get(device);
      if (waits === undefined) return;
      flipWaits.delete(device);
      for (const wait of waits) wait.wake();
    },
    primeTicket: (sessionId, ticket) => {
      if (disposed) throw new Error("the routed terminal host is disposed");
      const parsed = requireDirectTicket(sessionId, ticket);
      invalidateInventory();
      primedTickets.set(sessionId, parsed);
      custodians.set(sessionId, parsed.route.cellBootId);
      ownClient(sessionId, parsed.attachGrant.claims.clientId);
    },
    bind: (runtime) => {
      if (disposed) throw new Error("the routed terminal host is disposed");
      if (boundRuntime === runtime) return;
      if (boundRuntime !== null) {
        throw new Error("a routed terminal host cannot bind two runtimes");
      }
      boundRuntime = runtime;
      runtime.addEventListener("routed-activation-state", onActivationState);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      boundRuntime?.removeEventListener("routed-activation-state", onActivationState);
      boundRuntime = null;
      activations.clear();
      primedTickets.clear();
      custodians.clear();
      ownClients.clear();
      exitApplied.clear();
      withdrawAsks();
      remotes.clear();
      for (const held of heldRemovals.values()) clearTimeout(held);
      heldRemovals.clear();
      input.dispose();
    },
  };
}
