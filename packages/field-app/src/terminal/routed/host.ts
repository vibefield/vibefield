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
  type SessionEvent,
  TERMINAL_SESSION_CAP,
  TerminalOpenTicket,
  type TerminalOpenTicket as TerminalOpenTicketValue,
  TerminalRenewAttachResult,
  TerminalRuntimeSessionsResult,
  TerminalTerminateResult,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { createRoutedInputEncoder } from "./encode-input";

/** The hello advertisement for the window runtime (TP-D25): ghosttea's own
 * default `resume` plus `session-events` (TP-S3f/G24) — the load-bearing gate
 * that lets the cell emit the `SessionEvent` verb at this leg without killing
 * a client that could not decode it. */
export const ROUTED_CLIENT_CAPABILITIES: readonly string[] = ["resume", "session-events"];

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
}

export interface RoutedTerminalHostBinding {
  readonly host: GhostteaRoutedHost;
  /** Seed the first activation with the ticket returned atomically by create. */
  primeTicket(sessionId: string, ticket: TerminalOpenTicketValue): void;
  /** Install the activation-lifecycle inverse after the runtime exists. */
  bind(runtime: GhostteaTerminalRuntime): void;
  dispose(): void;
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
 * immediately; only the explicitly retryable `unobserved` state is awaited. */
async function listRuntimeSessions(fieldd: FielddClient): Promise<SessionSummary[]> {
  const deadline = Date.now() + RUNTIME_SESSION_OBSERVATION_TIMEOUT_MS;
  for (;;) {
    try {
      return asSessionSummaries(await fieldd.request("terminal.sessions", {}));
    } catch (cause) {
      if (!isUnobservedInventory(cause) || Date.now() >= deadline) throw cause;
      await new Promise((resolve) => setTimeout(resolve, RUNTIME_SESSION_OBSERVATION_RETRY_MS));
    }
  }
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
  /** Sessions whose `exited` event this host has already applied. */
  const exitApplied = new Set<string>();
  /** `removed` events held awaiting their kill's `exited` (see the hold const). */
  const heldRemovals = new Map<string, ReturnType<typeof setTimeout>>();
  let boundRuntime: GhostteaTerminalRuntime | null = null;
  let disposed = false;

  const applyRemoved = (sessionId: string): void => {
    const held = heldRemovals.get(sessionId);
    if (held !== undefined) {
      clearTimeout(held);
      heldRemovals.delete(sessionId);
    }
    boundRuntime?.applySessionEvent({ type: "removed", sessionId });
    custodians.delete(sessionId);
    exitApplied.delete(sessionId);
  };

  /** The coalesced authoritative read (petition G24 §sizing): ONE in-flight
   * `terminal.sessions` snapshot serves every per-session lookup in the same
   * refresh turn — N panes refreshing after a frame commit cost one wire read,
   * not N. A read that starts after settle is a fresh snapshot; the runtime's
   * own 200ms cadence is the debounce. */
  let inventoryRead: Promise<Map<string, SessionSummary>> | null = null;
  const readInventory = (): Promise<Map<string, SessionSummary>> => {
    if (inventoryRead === null) {
      inventoryRead = listRuntimeSessions(options.fieldd)
        .then((sessions) => new Map(sessions.map((session) => [session.id, session])))
        .finally(() => {
          inventoryRead = null;
        });
    }
    return inventoryRead;
  };

  /** The G24 lag answer: the cell's bounded lifecycle bus dropped events, so
   * deltas can no longer be trusted — reconcile THIS cell's tracked sessions
   * against the authoritative inventory: present ids get their full summary
   * re-applied, absent ids are removals the bus lost. */
  const resyncCustody = async (cellBootId: string): Promise<void> => {
    const inventory = await readInventory();
    if (disposed) return;
    for (const [sessionId, custodian] of [...custodians]) {
      if (custodian !== cellBootId) continue;
      const summary = inventory.get(sessionId);
      if (summary === undefined) {
        // Authoritative absence outranks any held ordering repair.
        applyRemoved(sessionId);
      } else {
        boundRuntime?.applySessionEvent({ type: "updated", session: summary });
      }
    }
  };

  const applyWireSessionEvent = (
    message: Readonly<Record<string, unknown>>,
    context: RoutedExtensionMessageContext,
  ): void => {
    // Only the control leg carries host verbs today; the tag list is the
    // contract's own outbound set for this seam.
    const decoded = decodeTpMessage(message, ["SessionEvent"]);
    if (!decoded.ok) {
      // Tolerant reader: dropped, never a transport failure — `invalid`
      // includes a future `kind` this build predates (the wire comment in
      // terminal-pipeline.ts is the law). Silence over console noise is this
      // layer's house style; the drop matrix is pinned by the host tests.
      return;
    }
    const { event } = decoded.body as SessionEvent;
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
    }
  };

  const host: GhostteaRoutedHost = {
    openTicket: async (sessionId) => {
      const primed = primedTickets.get(sessionId);
      if (primed !== undefined) {
        primedTickets.delete(sessionId);
        custodians.set(sessionId, primed.route.cellBootId);
        options.onTicket?.(sessionId, primed);
        return asRoutedTicket(primed);
      }
      const raw = await options.fieldd.request("terminal.openTicket", { sessionId });
      const ticket = requireDirectTicket(sessionId, raw);
      custodians.set(sessionId, ticket.route.cellBootId);
      options.onTicket?.(sessionId, ticket);
      return asRoutedTicket(ticket);
    },
    renewAttach: async (params) => {
      const renewed = TerminalRenewAttachResult.parse(
        await options.fieldd.request("terminal.renewAttach", params),
      );
      return { attachGrant: asAttachGrant(renewed.attachGrant) };
    },
    listSessions: async () => await listRuntimeSessions(options.fieldd),
    // TP-S3f/G24: the routed metadata refresh — ghosttea arms its existing
    // 200ms cadence from routed frame commits and asks HERE; the coalescer
    // makes N concurrent asks one wire read. `null` = no update, never an
    // invented removal (absence from a snapshot is the RESYNC path's fact to
    // assert, not a refresh's).
    getSession: async (sessionId) => (await readInventory()).get(sessionId) ?? null,
    onExtensionMessage: applyWireSessionEvent,
    ...(options.createSession === undefined ? {} : { createSession: options.createSession }),
    terminate: async (sessionId) => {
      try {
        TerminalTerminateResult.parse(
          await options.fieldd.request("terminal.terminate", { sessionId }),
        );
        options.onTerminated?.(sessionId);
      } finally {
        primedTickets.delete(sessionId);
        custodians.delete(sessionId);
        input.releaseSession(sessionId);
        activations.delete(sessionId);
      }
    },
    encodeInput: input.encodeInput,
  };

  return {
    host,
    primeTicket: (sessionId, ticket) => {
      if (disposed) throw new Error("the routed terminal host is disposed");
      const parsed = requireDirectTicket(sessionId, ticket);
      primedTickets.set(sessionId, parsed);
      custodians.set(sessionId, parsed.route.cellBootId);
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
      exitApplied.clear();
      for (const held of heldRemovals.values()) clearTimeout(held);
      heldRemovals.clear();
      input.dispose();
    },
  };
}
