import type {
  CreateSessionOptions,
  RoutedCellTransportGrant,
  RoutedSessionAttachGrant,
  RoutedTerminalOpenTicket,
  SessionSummary,
} from "@vibecook/ghosttea-protocol";
import type { GhostteaRoutedHost, GhostteaTerminalRuntime } from "@vibecook/ghosttea-react";
import {
  TERMINAL_SESSION_CAP,
  TerminalOpenTicket,
  type TerminalOpenTicket as TerminalOpenTicketValue,
  TerminalRenewAttachResult,
  TerminalRuntimeSessionsResult,
  TerminalTerminateResult,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { createRoutedInputEncoder } from "./encode-input";

// The production G23 adapter. It is intentionally a product-control adapter,
// not a second transport implementation: Ghosttea owns both WebSocket pools,
// activations, demand, recovery, geometry and worker presentation. This object
// only mints/renews through fieldd and supplies the VibeField input extension.

const RUNTIME_SESSION_OBSERVATION_TIMEOUT_MS = 5_000;
const RUNTIME_SESSION_OBSERVATION_RETRY_MS = 20;

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
  let boundRuntime: GhostteaTerminalRuntime | null = null;
  let disposed = false;

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
        options.onTicket?.(sessionId, primed);
        return asRoutedTicket(primed);
      }
      const raw = await options.fieldd.request("terminal.openTicket", { sessionId });
      const ticket = requireDirectTicket(sessionId, raw);
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
    ...(options.createSession === undefined ? {} : { createSession: options.createSession }),
    terminate: async (sessionId) => {
      try {
        TerminalTerminateResult.parse(
          await options.fieldd.request("terminal.terminate", { sessionId }),
        );
        options.onTerminated?.(sessionId);
      } finally {
        primedTickets.delete(sessionId);
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
      primedTickets.set(sessionId, requireDirectTicket(sessionId, ticket));
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
      input.dispose();
    },
  };
}
