import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  TerminalCreateOpenResponse,
  type TerminalCreateOpenResult,
  type TerminalOpenTicket,
  TerminalOpenTicketResponse,
  type TerminalOpenTicketResult,
  TerminalTicket,
} from "@vibefield/contracts";
import type { CellBootId } from "./cell-transport";
import type { SessionPlacement } from "./session-grants";

// READING A TICKET (TP-S1) — one tolerant reader over two floors.
//
// `TerminalOpenTicketResult` is the S1 shape: the end-state `TerminalOpenTicket`
// (route + optional endpoints + both grants) SPREAD beside the legacy trio the
// pre-T1 bridge still dials (`contracts/src/terminal-pipeline.ts:343-351`). A
// floor that predates the grant key answers the bare legacy `TerminalTicket`
// alone. Both are real answers and both must work — the older one is not an
// error, it is a floor that has not been upgraded yet, and the honest record of
// that is `grants: undefined`, never a fabricated route.
//
// The unions are the CONTRACTS' (`TerminalOpenTicketResponse`,
// `TerminalCreateOpenResponse`, `terminal-pipeline.ts:389-392`): a union parse
// tries the v2 member first and falls to the legacy member, which is exactly
// the reading this file needs and is not a shape the renderer gets to invent.

/** What a ticket answered, read once. */
export interface ReadTicket {
  /** The bridge coordinates main dials. Present on both shapes. */
  readonly ticket: TerminalTicket;
  /** Placement and authorities — absent when a keyless floor answered. */
  readonly placement: SessionPlacement | undefined;
  /** True when the floor minted the v2 half. The honest `grantsLanded` bit. */
  readonly routed: boolean;
  /** The complete direct path is present: grants AND both cell endpoints. */
  readonly direct: boolean;
  /** Exact routed ticket, retained so a create can feed its FIRST activation
   * without immediately re-entering the observation-gated openTicket seam. */
  readonly routedTicket?: TerminalOpenTicket;
}

/** The v2 half both mints answer, named once. `TerminalOpenTicketResult` spreads
 * the legacy trio beside it and `TerminalCreateOpenResult` nests the ticket, but
 * PLACEMENT is the same three fields on both — so the reader below takes those
 * three rather than either whole shape. */
type RoutedHalf = Pick<
  TerminalOpenTicketResult,
  "route" | "endpoints" | "transportGrant" | "attachGrant"
>;

function asSessionSummary(
  session: NonNullable<TerminalCreateOpenResult["session"]>,
): SessionSummary {
  const { scrollbackBytes, ...required } = session;
  return scrollbackBytes === undefined ? required : { ...required, scrollbackBytes };
}

/** `leaseEpoch` is OPTIONAL on the route until the floor exposes custody's
 * per-session epoch, and `endpoints` is present EXACTLY when the session's cell
 * serves its T1 doors (TP-S3a: the route row's `doors`, copied by fieldd). Both
 * are "not yet", never zero: a pool that defaulted a missing lease epoch to 0
 * would be asserting an authority fence the floor has not stated. Carried
 * through as the contract has them: G23 dials `endpoints` when the direct-door
 * rollback flag is on; the bridge consumes the legacy trio while it is off. */

function placementOf(sessionId: string, parsed: RoutedHalf, now: number): SessionPlacement {
  return {
    sessionId,
    route: parsed.route,
    cellBootId: parsed.route.cellBootId as CellBootId,
    grants: {
      transportGrant: parsed.transportGrant,
      attachGrant: parsed.attachGrant,
      attachExpiresAt: parsed.attachGrant.claims.expiresAt,
      grantGeneration: parsed.attachGrant.claims.grantGeneration,
    },
    resolvedAt: now,
  };
}

function routedTicketOf(parsed: RoutedHalf): TerminalOpenTicket {
  return {
    route: parsed.route,
    ...(parsed.endpoints === undefined ? {} : { endpoints: parsed.endpoints }),
    transportGrant: parsed.transportGrant,
    attachGrant: parsed.attachGrant,
  };
}

/**
 * Read `terminal.openTicket`'s answer for a KNOWN session.
 *
 * Parsed, not cast, and parsed TWICE deliberately: the v2 shape first because
 * it is the one we want, the legacy shape second because a floor that answers
 * it is not malformed. A raw answer that is neither fails loudly — a mint
 * without a ticket has to.
 */
export function readOpenTicket(sessionId: string, raw: unknown, now: number): ReadTicket {
  const answered = TerminalOpenTicketResponse.parse(raw);
  // The legacy member is the whole answer on a keyless floor; the v2 member
  // SPREADS the legacy trio, so the bridge coordinates read the same either way.
  const ticket = TerminalTicket.parse(answered);
  if (!isRouted(answered)) return { ticket, placement: undefined, routed: false, direct: false };
  return {
    ticket,
    placement: placementOf(sessionId, answered, now),
    routed: true,
    direct: answered.endpoints !== undefined,
    routedTicket: routedTicketOf(answered),
  };
}

/** Whether a union member carried the v2 half. A property test rather than a
 * re-parse: the union already decided, and `route` is the field only the v2
 * member has. */
function isRouted<T extends object>(answered: T): answered is T & RoutedHalf {
  return "route" in answered && "transportGrant" in answered && "attachGrant" in answered;
}

/** What `terminal.create` answered: a session, its ticket, and — on a floor
 * that mints them — its placement and grants. */
export interface ReadCreate extends ReadTicket {
  readonly sessionId: string;
  /** Exact birth summary; present on the G23-capable product seam. */
  readonly session?: SessionSummary;
}

/**
 * Read `terminal.create`'s answer.
 *
 * The legacy shape nests the ticket (`{sessionId, ticket}`) and the S1 shape
 * keeps that nesting and spreads the end-state fields beside it
 * (`contracts/src/terminal-pipeline.ts:353-360`), so the legacy reader is a
 * strict subset here and the fallback is the same two-step.
 */
export function readCreateTicket(raw: unknown, now: number): ReadCreate {
  const answered: TerminalCreateOpenResult | { sessionId: string; ticket: TerminalTicket } =
    TerminalCreateOpenResponse.parse(raw);
  const base = {
    sessionId: answered.sessionId,
    ticket: answered.ticket,
    ...(!("session" in answered) || answered.session === undefined
      ? {}
      : { session: asSessionSummary(answered.session) }),
  };
  if (!isRouted(answered)) return { ...base, placement: undefined, routed: false, direct: false };
  return {
    ...base,
    placement: placementOf(answered.sessionId, answered, now),
    routed: true,
    direct: answered.endpoints !== undefined,
    routedTicket: routedTicketOf(answered),
  };
}
