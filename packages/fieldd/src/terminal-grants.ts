import { createHmac, randomBytes } from "node:crypto";
import {
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
  type TicketEndpointSet,
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
  /** T1 §1 / E-F2 — the SIDECAR's node id for this caller, transport-derived:
   * ProductApi fills it from the proxy's own header, never from a claim
   * (`product-api.ts`; the contract's `Principal` has carried it since T1).
   * Absent means a pre-v3 sidecar injected no node header — never that the
   * caller is anonymous. */
  tailscaleId?: string;
  /** the durable device id a `peer-fieldd` principal carries INSTEAD of a
   * login (`envelope.ts`) */
  deviceId?: string;
  /** UA-4/TM-D3 — set only on a `tailnet` principal whose WhoIs-verified login
   * MATCHED the login recorded in link.json at link time. Absent on a
   * pre-capture node, never `false` (product-api.ts) — so `=== true` is the
   * only safe reading, and it is the one every caller here uses. */
  self?: boolean;
  rendererParticipant?: { participantId: string; incarnation: string };
}

/** TM-D3 — is this the person who owns this desktop, reaching it from another
 * of their own devices? The whole remote posture turns on it: a self peer is
 * the user, a guest is not. */
export function isSelfTailnetPrincipal(principal: GrantPrincipal): boolean {
  return principal.kind === "tailnet" && principal.self === true;
}

/** spec §5.1 "Who mints clientId": never UI code. A renderer window's
 * principal carries the participant main minted per webContents generation
 * (`bootstrap.ts`), so the id is bound to the window token and NON-REUSED
 * after the document is destroyed — a new incarnation is a new client, which
 * is what keeps a reset generation counter from ever meeting an old
 * high-water (TP-R21). Other principals get their own stable identity.
 *
 * This is the principal's IDENTITY. The id a grant CARRIES is `mintedClientId`
 * — this, scoped to the minting fieldd's epoch — because a stable identity is
 * exactly what TP-R21 cannot survive across a fieldd restart. */
export function clientIdFor(principal: GrantPrincipal): string {
  const rp = principal.rendererParticipant;
  if (rp !== undefined) return `win:${rp.participantId}#${rp.incarnation}`;
  // TM-2: `tailnet` joins the login-keyed family. It was missing, and the
  // fall-through below gave EVERY tailnet caller the bare clientId "tailnet" —
  // one connection set and one attach-generation ledger shared by every remote
  // client, which §5.1's per-client counters assume never happens. A login is
  // the identity the door already verified (WhoIs), so it is the one to key on.
  //
  // E-F2 (2026-09-14) — …AND A LOGIN ALONE IS NOT ONE CLIENT. Two of this
  // person's own devices carry the same verified login, so a phone and an iPad
  // attaching to one cell landed on one clientId, therefore one connection set
  // (`connectionSetIdFor` is clientId@cellBootId) and one attach ledger. The
  // cell answers a second leg on one connection set with `replaces_current_leg`
  // and closes the other as `Superseded`, so the two devices took turns
  // evicting each other and each reconnected on backoff — a ping-pong neither
  // user asked for. The sidecar's NODE ID is what separates them: it is
  // transport-derived rather than claimed, and the principal has carried it
  // since T1 — this function simply dropped it.
  //
  // Login-only stays the fallback, not a widening: a pre-v3 sidecar injects no
  // node header, and one shared client per login is what that fleet already
  // had.
  if (principal.kind === "tailnet" || principal.kind === "tailnet-guest") {
    const login = principal.login ?? "unknown";
    return principal.tailscaleId === undefined
      ? `${principal.kind}:${login}`
      : `${principal.kind}:${login}#${principal.tailscaleId}`;
  }
  // E-F4 / F-L6a — the arm above used to name `tailnet-peer`, A KIND THAT HAS
  // NEVER EXISTED: the minted one is `peer-fieldd` (`product-api.ts`,
  // `envelope.ts`), which carries a `deviceId` and NO login, so it matched
  // nothing and fell through to the bare constant "peer-fieldd" — one identity
  // for every peer daemon, the exact shape TM-2 fixed for tailnet callers.
  // Unreachable today (locality refuses `peer-fieldd` before a mint is
  // possible), which is why it is corrected now rather than left as a trap for
  // the slice that opens that door.
  if (principal.kind === "peer-fieldd" && principal.deviceId !== undefined)
    return `peer-fieldd:${principal.deviceId}`;
  if (principal.tokenId !== undefined) return `${principal.kind}:${principal.tokenId}`;
  return principal.kind;
}

/** Rights per principal (spec §5.1; the v1 posture). A window (local token,
 * shell-main) may read, type and hold geometry; anything else — a tailnet
 * guest, a plugin — reads only. `geometryAdmin` is never minted in v1
 * (TP-D25: admin displacement is TP-S4). Sorted, as JCS requires.
 *
 * TM-D3 — a WhoIs-verified SELF peer may read and TYPE, and holds no geometry.
 * Both halves are deliberate:
 *   · `input` granted nothing new when it landed: `terminal.mirrorWriteGrant`
 *     was already handing a self peer the floor's mirror-write capability
 *     automatically, once per connection (MF-2) — a durable bearer on disk, with
 *     no expiry and no per-client revocation. TM-3 deleted that door and the key
 *     behind it on 2026-09-14, so this line is no longer the second way a self
 *     peer comes by the right to type. It is the only one, which is TP-D21's
 *     whole point: per client, per session, expiring, revocable by generation.
 *   · `geometry` stays with WINDOWS. The lease decides the PTY's cols and rows,
 *     and a phone taking it would resize the desktop's own pane under the
 *     person sitting at it. A remote viewer renders what the holder sized. */
export function rightsFor(principal: GrantPrincipal): SessionAttachRight[] {
  if (principal.kind === "local-token" || principal.kind === "shell-main")
    return ["geometry", "input", "read"];
  if (isSelfTailnetPrincipal(principal)) return ["input", "read"];
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
   * the caller refuses UNAVAILABLE before minting.
   *
   * TM-2: LOOPBACK for a window, the TAILNET shape for a self peer. The CALLER
   * decides which (terminal-service.ts), because only it can see whether the
   * doors are published; the mint copies whatever it is handed. Nothing about
   * the grants changes with the shape — same `audienceCellBootId`, same MAC,
   * same key — so the cell cannot tell, and must not: a URL is a coordinate,
   * and coordinates are not authority. */
  doors: TicketEndpointSet;
}

export interface RenewAttachInput extends Omit<MintTicketInput, "doors"> {
  expectGeneration: number;
  requestId: string;
}

/** How many renewal answers are remembered per {client, session} for
 * idempotent retries. A retry arrives within seconds; eight is plenty and
 * bounds the map against a client that never stops asking. */
const RENEWAL_MEMORY = 8;

/** TP-R21 — the clientId a grant CARRIES: the principal's identity, scoped to
 * the minting fieldd's epoch. See `TerminalGrantMinter` for why. */
export function mintedClientId(principal: GrantPrincipal, epoch: string): string {
  return `${clientIdFor(principal)}~${epoch}`;
}

/** A fresh epoch: one per minter, which is one per fieldd boot. */
export function freshMinterEpoch(): string {
  return randomBytes(6).toString("base64url");
}

/**
 * The generation ledgers live HERE, in memory, and nowhere else — spec §5.1
 * "Generation ownership": `transportGrantGeneration` is monotonic per
 * {clientId, cellBootId}, `grantGeneration` per {clientId, sessionId}; neither
 * is persisted. TP-R21: that reset is safe only if a fieldd restart makes
 * every clientId NEW, because the cells outlive fieldd and hold each connection
 * set's high-water for at least `maxGrantLifetimeMs` + skew (field-native
 * `tp/ledger.rs`) — a stable identity meeting its own old high-water with a
 * restarted counter is refused `GRANT_GENERATION_ROLLBACK`, `retryable: false`.
 *
 * Windows got that from Electron main's boot fence (a fieldd restart replaces
 * every renderer document, so `win:<participant>#<incarnation>` is new). A
 * TAILNET caller never did: `tailnet:<login>#<node>` (E-F2) is the phone's
 * identity, the same before and after a restart — so after one, a phone could
 * be locked out of a cell for up to ten minutes (the 2026-09-24 terminal audit;
 * nothing measured it happening). The fix lives where the counters live: every
 * minted clientId carries this minter's EPOCH, so the invariant holds by
 * construction for every principal, whatever else fences it.
 */
export class TerminalGrantMinter {
  private readonly transportGenerations = new Map<string, number>();
  private readonly attachGenerations = new Map<string, number>();
  private readonly renewals = new Map<string, Map<string, SessionAttachGrant>>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    /** one per minter; a test passes a fixed one to pin exact claims */
    readonly epoch: string = freshMinterEpoch(),
  ) {}

  /** Every ticket carries a FRESH transport grant (spec §5.1 — fieldd cannot
   * know another process's socket state; an optional grant is a TOCTOU). */
  mintTransport(key: CellGrantKey, principal: GrantPrincipal): CellTransportGrant {
    const clientId = mintedClientId(principal, this.epoch);
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
    const clientId = mintedClientId(input.principal, this.epoch);
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
    const clientId = mintedClientId(input.principal, this.epoch);
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
    return this.attachGenerations.get(`${mintedClientId(principal, this.epoch)}|${sessionId}`) ?? 0;
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
