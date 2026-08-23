import { createHmac, randomBytes } from "node:crypto";
import {
  type CellEndpointSet,
  type CellTransportGrant,
  type CellTransportGrantClaims,
  DEFAULT_GRANT_VALIDITY_LIMITS,
  GRANT_ALG,
  GRANT_ENVELOPE_VERSION,
  type GrantProtectedHeader,
  type GrantType,
  grantSigningInput,
  type ProductSessionRosterItem,
  type RouteBinding,
  type SessionAttachGrant,
  type SessionAttachGrantClaims,
  type SessionAttachRight,
  TERMINAL_PIPELINE,
  type TerminalInfo,
  type TerminalOpenTicket,
} from "@vibefield/contracts";
import { RpcCallError } from "./native-link";

// TP-S1 — fieldd as the ISSUER of TPv3 grants (spec §5.1, TP-D21). The cell is
// the verifier (upstream, TP-S3a); the floor mints the per-cell-boot key and
// hands it to fieldd on the route row. Everything here is pure bookkeeping
// over that key: who the caller is (`clientId`), which generation a mint
// carries, and the MAC over the canonical signing input the contracts package
// defines. No I/O, no clocks beyond the injected `now`.

/** The product principal as the minter sees it — the shape `ProductApi` puts
 * on `ctx.principal` (product-api.ts), narrowed to what identity needs. */
export interface GrantPrincipal {
  kind: string;
  tokenId?: string;
  login?: string;
  rendererParticipant?: { participantId: string; incarnation: string };
}

/** spec §5.1 "Who mints clientId": never UI code. A renderer window's
 * principal carries the participant main minted per webContents generation
 * (`bootstrap.ts`), so the id is bound to the window token and NON-REUSED
 * after the document is destroyed — a new incarnation is a new client, which
 * is what keeps a reset generation counter from ever meeting an old
 * high-water (TP-R21). Other principals get their own stable identity. */
export function clientIdFor(principal: GrantPrincipal): string {
  const rp = principal.rendererParticipant;
  if (rp !== undefined) return `win:${rp.participantId}#${rp.incarnation}`;
  if (principal.kind === "tailnet-guest" || principal.kind === "tailnet-peer")
    return `${principal.kind}:${principal.login ?? "unknown"}`;
  if (principal.tokenId !== undefined) return `${principal.kind}:${principal.tokenId}`;
  return principal.kind;
}

/** Rights per principal (spec §5.1; the v1 posture). A window (local token,
 * shell-main) may read, type and hold geometry; anything else — a tailnet
 * guest, a plugin — reads only. `geometryAdmin` is never minted in v1
 * (TP-D25: admin displacement is TP-S4). Sorted, as JCS requires. */
export function rightsFor(principal: GrantPrincipal): SessionAttachRight[] {
  if (principal.kind === "local-token" || principal.kind === "shell-main")
    return ["geometry", "input", "read"];
  return ["read"];
}

/** Provisional until the post-S0 numeric checkpoint (spec §16). The transport
 * grant is an ESTABLISHMENT deadline (a minute is generous for a loopback
 * dial); the attach grant is renewable and bounded by the lifetime the cell
 * enforces. */
export const TP_TRANSPORT_GRANT_TTL_MS = TERMINAL_PIPELINE.TRANSPORT_GRANT_TTL_MS;
export const TP_ATTACH_GRANT_TTL_MS = DEFAULT_GRANT_VALIDITY_LIMITS.maxGrantLifetimeMs;

/** The per-cell-boot grant key as the route row delivers it. */
export interface CellGrantKey {
  cellBootId: string;
  /** hex, 32 bytes — the floor's mint; memory-only, mgmt-channel-only (EL7) */
  keyHex: string;
  keyGeneration: number;
}

export function signGrant(
  key: CellGrantKey,
  protectedHeader: GrantProtectedHeader,
  claims: unknown,
): string {
  return createHmac("sha256", Buffer.from(key.keyHex, "hex"))
    .update(grantSigningInput(protectedHeader, claims), "utf8")
    .digest("base64url");
}

function protectedHeader(key: CellGrantKey, typ: GrantType): GrantProtectedHeader {
  return {
    v: GRANT_ENVELOPE_VERSION,
    typ,
    iss: "fieldd",
    alg: GRANT_ALG,
    kid: { cellBootId: key.cellBootId, keyGeneration: key.keyGeneration },
  };
}

export interface MintTicketInput {
  key: CellGrantKey;
  principal: GrantPrincipal;
  sessionId: string;
  route: RouteBinding;
  /** The cell's T1 doors, copied verbatim into `TerminalOpenTicket.endpoints`.
   * REQUIRED since TP-S3e: a ticket without dialable doors is not a ticket —
   * the caller refuses UNAVAILABLE before minting. */
  doors: CellEndpointSet;
}

export interface RenewAttachInput extends Omit<MintTicketInput, "doors"> {
  expectGeneration: number;
  requestId: string;
}

/** How many renewal answers are remembered per {client, session} for
 * idempotent retries. A retry arrives within seconds; eight is plenty and
 * bounds the map against a client that never stops asking. */
const RENEWAL_MEMORY = 8;

/**
 * The generation ledgers live HERE, in memory, and nowhere else — spec §5.1
 * "Generation ownership": `transportGrantGeneration` is monotonic per
 * {clientId, cellBootId}, `grantGeneration` per {clientId, sessionId}; neither
 * is persisted, and that is safe only because a fieldd restart replaces every
 * renderer document (the boot fence) and so every clientId.
 */
export class TerminalGrantMinter {
  private readonly transportGenerations = new Map<string, number>();
  private readonly attachGenerations = new Map<string, number>();
  private readonly renewals = new Map<string, Map<string, SessionAttachGrant>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Every ticket carries a FRESH transport grant (spec §5.1 — fieldd cannot
   * know another process's socket state; an optional grant is a TOCTOU). */
  mintTransport(key: CellGrantKey, principal: GrantPrincipal): CellTransportGrant {
    const clientId = clientIdFor(principal);
    const ledgerKey = `${clientId}|${key.cellBootId}`;
    const generation = (this.transportGenerations.get(ledgerKey) ?? 0) + 1;
    this.transportGenerations.set(ledgerKey, generation);
    const issuedAt = this.now();
    const claims: CellTransportGrantClaims = {
      audienceCellBootId: key.cellBootId,
      clientId,
      connectionSetId: connectionSetIdFor(clientId, key.cellBootId),
      allowedChannels: ["control", "frames"],
      transportGrantGeneration: generation,
      issuedAt,
      expiresAt: issuedAt + TP_TRANSPORT_GRANT_TTL_MS,
      nonce: randomBytes(16).toString("base64url"),
    };
    const header = protectedHeader(key, "CellTransportGrant");
    return { protected: header, claims, mac: signGrant(key, header, claims) };
  }

  /** A fresh attach grant at the NEXT generation for {client, session}. Every
   * mint is a fresh audited grant; the cell's attach high-water rises with the
   * newest it accepts, so an older in-flight grant becomes a rollback — the
   * newest wins, which is the semantics a re-open wants. */
  mintAttach(input: MintTicketInput): SessionAttachGrant {
    const clientId = clientIdFor(input.principal);
    const generation = this.bumpAttachGeneration(clientId, input.sessionId);
    return this.attachGrantAt(input, clientId, generation);
  }

  /** The ticket: route + both grants, and `endpoints` exactly when the cell
   * serves its T1 doors (TP-S3a — the route row's `doors`); a keyed cell that
   * predates the door layer mints grants without endpoints, and the renderer
   * shows the honest `transport-not-landed` face. */
  mintTicket(input: MintTicketInput): TerminalOpenTicket {
    return {
      route: input.route,
      endpoints: input.doors,
      transportGrant: this.mintTransport(input.key, input.principal),
      attachGrant: this.mintAttach(input),
    };
  }

  /** spec §5.1 `renewAttach(sessionId, expectGeneration, requestId) →
   * SessionAttachGrant(expectGeneration+1)` — CAS on the generation the
   * caller holds, idempotent by `requestId`. A stale `expectGeneration` is
   * CONFLICT (the caller re-reads what it holds); a repeated requestId returns
   * the grant it already got, generation untouched. */
  renewAttach(input: RenewAttachInput): SessionAttachGrant {
    const clientId = clientIdFor(input.principal);
    const ledgerKey = `${clientId}|${input.sessionId}`;
    const remembered = this.renewals.get(ledgerKey)?.get(input.requestId);
    if (remembered !== undefined) return remembered;
    const current = this.attachGenerations.get(ledgerKey) ?? 0;
    if (current !== input.expectGeneration)
      throw new RpcCallError(
        "CONFLICT",
        `renewAttach: expected grant generation ${input.expectGeneration} but the current one is ${current}`,
        false,
      );
    const generation = this.bumpAttachGeneration(clientId, input.sessionId);
    const grant = this.attachGrantAt(input, clientId, generation);
    let memory = this.renewals.get(ledgerKey);
    if (memory === undefined) {
      memory = new Map();
      this.renewals.set(ledgerKey, memory);
    }
    memory.set(input.requestId, grant);
    while (memory.size > RENEWAL_MEMORY) {
      const oldest = memory.keys().next().value;
      if (oldest === undefined) break;
      memory.delete(oldest);
    }
    return grant;
  }

  /** The generation a {client, session} pair currently holds (0 = never minted). */
  attachGeneration(principal: GrantPrincipal, sessionId: string): number {
    return this.attachGenerations.get(`${clientIdFor(principal)}|${sessionId}`) ?? 0;
  }

  private bumpAttachGeneration(clientId: string, sessionId: string): number {
    const ledgerKey = `${clientId}|${sessionId}`;
    const generation = (this.attachGenerations.get(ledgerKey) ?? 0) + 1;
    this.attachGenerations.set(ledgerKey, generation);
    return generation;
  }

  private attachGrantAt(
    input: Omit<MintTicketInput, "doors">,
    clientId: string,
    generation: number,
  ): SessionAttachGrant {
    const issuedAt = this.now();
    const claims: SessionAttachGrantClaims = {
      audienceCellBootId: input.key.cellBootId,
      clientId,
      sessionId: input.sessionId,
      routeRevision: input.route.routeRevision,
      ...(input.route.leaseEpoch === undefined ? {} : { leaseEpoch: input.route.leaseEpoch }),
      grantGeneration: generation,
      rights: rightsFor(input.principal),
      issuedAt,
      expiresAt: issuedAt + TP_ATTACH_GRANT_TTL_MS,
    };
    const header = protectedHeader(input.key, "SessionAttachGrant");
    return { protected: header, claims, mac: signGrant(input.key, header, claims) };
  }
}

/** STABLE for {clientId, cellBootId} across physical-leg reconnects (spec
 * §5.1) — an identifier, not a secret, so it is simply the pair. */
export function connectionSetIdFor(clientId: string, cellBootId: string): string {
  return `${clientId}@${cellBootId}`;
}

/** TP-D4 — the UI's roster projection: ids, class, health, provenance and NO
 * placement (the contract refuses a cell tag at parse). Health is what the
 * inventory can honestly say today: a row in the observed inventory is a live
 * session; `recovering`/`exited` arrive with custody's per-session state in a
 * later slice. Provenance is unknown to fieldd until the AR track joins agent
 * sessions to their hosts, so it is omitted rather than guessed. */
export function projectRoster(terminals: readonly TerminalInfo[]): ProductSessionRosterItem[] {
  return terminals.map((row) => ({
    sessionId: row.sessionId,
    workloadClass: row.cell?.workloadClass ?? "interactive",
    health: "live" as const,
    ...(row.title === undefined ? {} : { title: row.title }),
  }));
}
