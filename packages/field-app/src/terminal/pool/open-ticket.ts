import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  TerminalCreateOpenResponse,
  type TerminalCreateOpenResult,
  type TerminalOpenTicket,
  TerminalOpenTicketResponse,
} from "@vibefield/contracts";
import type { CellBootId } from "./cell-transport";
import type { SessionPlacement } from "./session-grants";

// READING A TICKET — the routed reader (TP-S3e). The S1-era two-member union
// (v2-beside-legacy, keyless floors answering the bare trio) retired with the
// bridge: `terminal.openTicket` answers exactly `TerminalOpenTicket` with
// REQUIRED endpoints, `terminal.create` answers the id + the REQUIRED birth
// summary + the same ticket spread, and a floor that cannot serve the doors is
// an UNAVAILABLE refusal upstream of this reader — never a half ticket here.

/** What a ticket answered, read once. */
export interface ReadTicket {
  /** Placement and authorities, resolved from the routed ticket. */
  readonly placement: SessionPlacement;
  /** Exact routed ticket, retained so a create can feed its FIRST activation
   * without immediately re-entering the observation-gated openTicket seam. */
  readonly routedTicket: TerminalOpenTicket;
}

function asSessionSummary(session: TerminalCreateOpenResult["session"]): SessionSummary {
  const { scrollbackBytes, ...required } = session;
  return scrollbackBytes === undefined ? required : { ...required, scrollbackBytes };
}

function placementOf(sessionId: string, parsed: TerminalOpenTicket, now: number): SessionPlacement {
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

function routedTicketOf(parsed: TerminalOpenTicket): TerminalOpenTicket {
  return {
    route: parsed.route,
    endpoints: parsed.endpoints,
    transportGrant: parsed.transportGrant,
    attachGrant: parsed.attachGrant,
  };
}

/** Read `terminal.openTicket`'s answer for a KNOWN session. Parsed, not cast —
 * a mint without doors or grants fails loudly, which since TP-S3e can only
 * mean a contract break (the honest keyless answer is UNAVAILABLE upstream). */
export function readOpenTicket(sessionId: string, raw: unknown, now: number): ReadTicket {
  const answered = TerminalOpenTicketResponse.parse(raw);
  return {
    placement: placementOf(sessionId, answered, now),
    routedTicket: routedTicketOf(answered),
  };
}

/** What `terminal.create` answered: the session id, its exact birth summary,
 * and the routed ticket for its first activation. */
export interface ReadCreate extends ReadTicket {
  readonly sessionId: string;
  readonly session: SessionSummary;
}

/** Read `terminal.create`'s answer. */
export function readCreateTicket(raw: unknown, now: number): ReadCreate {
  const answered = TerminalCreateOpenResponse.parse(raw);
  return {
    sessionId: answered.sessionId,
    session: asSessionSummary(answered.session),
    placement: placementOf(answered.sessionId, answered, now),
    routedTicket: routedTicketOf(answered),
  };
}
