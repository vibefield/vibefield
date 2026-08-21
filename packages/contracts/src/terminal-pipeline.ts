import { z } from "zod";
import { TerminalWorkloadClass } from "./envelope";
import { TerminalTicket } from "./terminal";

// The terminal pipeline (TPv3) — custody through pixels. The wire truth for
// everything between fieldd's ticket mint and the renderer's cell sockets:
// grants, the per-cell handshake, session activation, the two-dimensional
// cell lease, demand, the geometry lease, the presentation envelope, transfers
// and credits. Spec: draft/specs/terminal-pipeline-v3.md (v0.7) §5–§8; this
// file is §20 item 1 — the machine-readable shapes the prose pointed at.
//
// TS-ONLY, like terminal.ts, and for the same structural reason: these shapes
// ride fieldd's product API (renderers, peers) and then the renderer ↔ cell
// WebSockets. The VERIFIER of a grant is the cell (the ghosttea harness —
// upstream Rust, which consumes the JSON Schema this package publishes); the
// floor (field-native) never reads a grant — it only MINTS the per-cell-boot
// grant key, which rides the route row in envelope.ts and is therefore already
// in the Rust bundle. gen-jsonschema.ts documents the exclusion.
//
// Three laws shape every object here (spec §3, §5.1):
// - TP-L-C: the session id is the only address. Placement (cell boot, route
//   revision, lease epoch) is carried by grants and the route binding, never
//   by UI shapes — ProductSessionRosterItem REFUSES placement keys.
// - Nothing a grant carries is repeated outside it: a receiver verifies the
//   grant first and DERIVES client/set/generation/session/lease/rights from
//   its claims. ConnectionHello and the attach messages therefore carry only
//   what no grant carries.
// - Tolerant reader: every object is `.passthrough()`; unknown capabilities,
//   reasons and codes are strings a reader logs and ignores.

// ---------------------------------------------------------------------------
// Scalars

/** A non-negative integer counter: generations, epochs, revisions, sequences. */
export const Counter = z.number().int().nonnegative();
/** Wall-clock milliseconds since the Unix epoch — used ONLY for grant
 * validity (issuedAt/expiresAt); nothing else on the wire compares clocks. */
export const EpochMs = z.number().int().nonnegative();
/** A byte count. */
export const ByteCount = z.number().int().nonnegative();
/** A 64-bit unsigned TRF1 handle as a DECIMAL STRING — JSON numbers cannot
 * carry a u64 and the installed reader yields `bigint`s. */
export const U64String = z.string().regex(/^(0|[1-9][0-9]*)$/);
export type U64String = z.infer<typeof U64String>;

// ---------------------------------------------------------------------------
// Identity & stamps (spec §5.4, §3 TP-L-B′)

/** Authoritative placement of ONE session, resolved by the route layer and
 * carried by grants. A changed binding is a NEW activation, never a resume. */
export const RouteBinding = z
  .object({
    cellBootId: z.string().min(1),
    routeRevision: Counter,
    leaseEpoch: Counter,
  })
  .passthrough();
export type RouteBinding = z.infer<typeof RouteBinding>;

const LOOPBACK_WS = /^wss?:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d{1,5})?(\/[^?#]*)?$/;

/** The two loopback WebSocket doors of one cell (T1 — spec §8). Transport-
 * private: the renderer's routed transport dials them, UI never sees them.
 * Tokens NEVER ride URLs (no query, no fragment) — authority is the grant in
 * the first frame. */
export const CellEndpointSet = z
  .object({
    controlUrl: z.string().regex(LOOPBACK_WS, "a loopback ws:// URL without query/fragment"),
    framesUrl: z.string().regex(LOOPBACK_WS, "a loopback ws:// URL without query/fragment"),
  })
  .passthrough();
export type CellEndpointSet = z.infer<typeof CellEndpointSet>;

/** Source-content LINEAGE: changes ONLY when delta continuity breaks (a new
 * cell boot, a model reset/new incarnation, migration to a different model
 * lineage, a custody reset receipt) — never because a worker installs a seed
 * or a route revision moves within one lineage. Non-reusable. */
export const SceneEpoch = z
  .object({
    cellBootId: z.string().min(1),
    modelGeneration: Counter,
  })
  .passthrough();
export type SceneEpoch = z.infer<typeof SceneEpoch>;

/** The ONLY content stamp on the wire. Two stamps are comparable iff their
 * `sceneEpoch` is equal (then by `sceneRevision`); within one `cellBootId` a
 * higher `modelGeneration` is newer and REQUIRES a seed; across cell boots
 * there is no order — a new lineage always seeds. */
export const SceneContentStamp = z
  .object({
    sceneEpoch: SceneEpoch,
    sceneRevision: Counter,
  })
  .passthrough();
export type SceneContentStamp = z.infer<typeof SceneContentStamp>;

/** The stamp ordering rule as a function (spec §8 "stamp ordering rules").
 * `null` = not comparable (different lineage → seed). */
export function compareSceneContent(a: SceneContentStamp, b: SceneContentStamp): -1 | 0 | 1 | null {
  if (
    a.sceneEpoch.cellBootId !== b.sceneEpoch.cellBootId ||
    a.sceneEpoch.modelGeneration !== b.sceneEpoch.modelGeneration
  )
    return null;
  if (a.sceneRevision === b.sceneRevision) return 0;
  return a.sceneRevision < b.sceneRevision ? -1 : 1;
}

// ---------------------------------------------------------------------------
// RFC 8785 — JSON Canonicalization Scheme (the grant MAC input; spec §5.1)

/**
 * RFC 8785 (JCS) canonical serialization: object members sorted by the UTF-16
 * code units of their names, ES number-to-string for numbers, ES
 * JSON.stringify escaping for strings, no whitespace. Properties whose value
 * is `undefined` are OMITTED (as JSON.stringify does); non-finite numbers,
 * bigints, functions and symbols are REFUSED — a grant is JSON data, and a
 * value JSON cannot carry has no canonical form.
 *
 * Pinned by fixtures/tp-jcs.vector.json (the RFC's own example). The contracts
 * corpus is zod/JSON, so this is the one serializer — no second canonical
 * form ever appears beside it.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (item === undefined) throw new TypeError("canonicalJson: undefined array element");
      parts.push(canonicalJson(item));
    }
    return `[${parts.join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    const parts: string[] = [];
    for (const key of keys) parts.push(`${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Grants (spec §5.1, TP-D21)

/** The MAC algorithm name carried in the protected header. HMAC-SHA256 — the
 * cell holds its own key, so issuer separation between fieldd and a cell is
 * not a security boundary (a cell already owns everything a grant to it can
 * authorize); the header sits under the MAC precisely so that a future
 * Ed25519 swap is an `alg` change and not a protocol change. */
export const GRANT_ALG = "HS256" as const;
/** Schema version of the authenticated-grant envelope. */
export const GRANT_ENVELOPE_VERSION = 1 as const;
/** The MAC is base64url (RFC 4648 §5, no padding) of HMAC-SHA256(key,
 * canonicalJson({ protected, claims })) — see `grantSigningInput`. */
export const GRANT_MAC_ENCODING = "base64url" as const;

export const GrantType = z.enum(["CellTransportGrant", "SessionAttachGrant"]);
export type GrantType = z.infer<typeof GrantType>;

/** Which per-cell-boot key signed this grant. The floor mints one key per
 * cell boot through the custody capability handshake; fieldd learns it with
 * the route row (envelope.ts `TerminalRouteCell.grantKey*`). Rotation = a new
 * cell boot = a new kid; a stale kid is refused. */
export const GrantKeyId = z
  .object({
    cellBootId: z.string().min(1),
    keyGeneration: Counter,
  })
  .passthrough();
export type GrantKeyId = z.infer<typeof GrantKeyId>;

/** Everything under the MAC besides the claims: schema version, grant TYPE
 * (domain separation — a transport grant can never be presented as an attach
 * grant), issuer, algorithm, key id. */
export const GrantProtectedHeader = z
  .object({
    v: z.literal(GRANT_ENVELOPE_VERSION),
    typ: GrantType,
    iss: z.literal("fieldd"),
    alg: z.literal(GRANT_ALG),
    kid: GrantKeyId,
  })
  .passthrough();
export type GrantProtectedHeader = z.infer<typeof GrantProtectedHeader>;

/** JCS has no sets: every set-valued claim is a SORTED (codepoint order),
 * UNIQUE array. The refinement is the contract, not a convention. */
export function sortedUniqueArray<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(item)
    .refine(
      (xs) => xs.every((x, i) => i === 0 || String(xs[i - 1]) < String(x)),
      "must be sorted by codepoint and unique",
    );
}

export const TransportChannel = z.enum(["control", "frames"]);
export type TransportChannel = z.infer<typeof TransportChannel>;

/** Claims of a CellTransportGrant — authority to ESTABLISH a connection set's
 * legs at one cell boot. `expiresAt` is an ESTABLISHMENT deadline only: it
 * never tears down an authenticated connection. */
export const CellTransportGrantClaims = z
  .object({
    audienceCellBootId: z.string().min(1),
    clientId: z.string().min(1),
    connectionSetId: z.string().min(1),
    allowedChannels: sortedUniqueArray(TransportChannel).refine(
      (xs) => xs.length > 0,
      "at least one channel",
    ),
    transportGrantGeneration: Counter,
    issuedAt: EpochMs,
    expiresAt: EpochMs,
    nonce: z.string().min(1),
  })
  .passthrough();
export type CellTransportGrantClaims = z.infer<typeof CellTransportGrantClaims>;

export const SessionAttachRight = z.enum(["geometry", "geometryAdmin", "input", "read"]);
export type SessionAttachRight = z.infer<typeof SessionAttachRight>;

/** Claims of a SessionAttachGrant — authority over ONE session for ONE client
 * at one placement. `rights` is sorted+unique; `read` is the floor of every
 * grant that can present at all. */
export const SessionAttachGrantClaims = z
  .object({
    audienceCellBootId: z.string().min(1),
    clientId: z.string().min(1),
    sessionId: z.string().min(1),
    leaseEpoch: Counter,
    routeRevision: Counter,
    grantGeneration: Counter,
    rights: sortedUniqueArray(SessionAttachRight),
    issuedAt: EpochMs,
    expiresAt: EpochMs,
  })
  .passthrough();
export type SessionAttachGrantClaims = z.infer<typeof SessionAttachGrantClaims>;

/** The authenticated envelope. `mac` = base64url(HMAC-SHA256(key,
 * grantSigningInput(protected, claims))). */
export function authenticatedGrant<T extends z.ZodTypeAny>(typ: GrantType, claims: T) {
  return z
    .object({
      protected: GrantProtectedHeader.extend({ typ: z.literal(typ) }).passthrough(),
      claims,
      mac: z.string().min(1),
    })
    .passthrough();
}

export const CellTransportGrant = authenticatedGrant(
  "CellTransportGrant",
  CellTransportGrantClaims,
);
export type CellTransportGrant = z.infer<typeof CellTransportGrant>;

export const SessionAttachGrant = authenticatedGrant(
  "SessionAttachGrant",
  SessionAttachGrantClaims,
);
export type SessionAttachGrant = z.infer<typeof SessionAttachGrant>;

/** The exact bytes under the MAC, as a UTF-8 string: the RFC 8785 canonical
 * form of `{ protected, claims }`. Pinned by fixtures/tp-grant-mac.vector.json. */
export function grantSigningInput(protectedHeader: GrantProtectedHeader, claims: unknown): string {
  return canonicalJson({ protected: protectedHeader, claims });
}

/** The two validity limits the verifier applies (spec §5.1 "Validity"). The
 * defaults are the v0.7 placeholders until the post-S0 numeric checkpoint
 * ratifies them; the cell's accepted values travel in `ProtocolLimits`-adjacent
 * config, not on the wire per grant. */
export const GrantValidityLimits = z
  .object({
    maxClockSkewMs: Counter,
    maxGrantLifetimeMs: Counter,
  })
  .passthrough();
export type GrantValidityLimits = z.infer<typeof GrantValidityLimits>;
export const DEFAULT_GRANT_VALIDITY_LIMITS: GrantValidityLimits = {
  maxClockSkewMs: 5_000,
  maxGrantLifetimeMs: 10 * 60_000,
};

export type GrantValidity = "valid" | "not-yet-valid" | "expired" | "lifetime-exceeded";

/** spec §5.1, normative: NOT_YET_VALID ⇔ now < issuedAt − skew; EXPIRED ⇔
 * now ≥ expiresAt + skew; LIFETIME_EXCEEDED ⇔ expiresAt − issuedAt >
 * maxGrantLifetimeMs (a malformed grant — the bound is what keeps the
 * high-water tombstones finite). Lifetime is checked FIRST: a grant that
 * violates the bound is malformed whatever the clock says. */
export function grantValidityAt(
  claims: { issuedAt: number; expiresAt: number },
  nowMs: number,
  limits: GrantValidityLimits = DEFAULT_GRANT_VALIDITY_LIMITS,
): GrantValidity {
  if (claims.expiresAt - claims.issuedAt > limits.maxGrantLifetimeMs) return "lifetime-exceeded";
  if (nowMs < claims.issuedAt - limits.maxClockSkewMs) return "not-yet-valid";
  if (nowMs >= claims.expiresAt + limits.maxClockSkewMs) return "expired";
  return "valid";
}

/** How long a high-water record (transport per connection set, attach per
 * {clientId, sessionId}) must survive after it was first accepted: until every
 * grant minted below it has expired. fieldd raises a generation BEFORE minting
 * it, so every lower-generation grant was issued before the first acceptance.
 * Client or connection-set death never shortens a tombstone. */
export function highWaterTombstoneTtlMs(
  limits: GrantValidityLimits = DEFAULT_GRANT_VALIDITY_LIMITS,
): number {
  return limits.maxGrantLifetimeMs + limits.maxClockSkewMs;
}

/** The product-API ticket (spec §5.1): route + endpoints + both grants. Pure
 * end-state shape; the S1 result adds today's bridge fields beside it. */
export const TerminalOpenTicket = z
  .object({
    route: RouteBinding,
    /** ABSENT until the cell serves its T1 doors (TP-S3a): today's cells
     * expose UDS sockets a renderer cannot dial, and a `unix:` URL here would
     * be a detour. A v2 reader with no endpoints shows
     * `UNAVAILABLE {reason: transport-not-landed}` and never dials the legacy
     * trio itself (TP-L-F). Required from S3a. */
    endpoints: CellEndpointSet.optional(),
    transportGrant: CellTransportGrant,
    attachGrant: SessionAttachGrant,
  })
  .passthrough();
export type TerminalOpenTicket = z.infer<typeof TerminalOpenTicket>;

/** terminal.openTicket result from TP-S1: the end-state `TerminalOpenTicket`
 * fields SPREAD beside the legacy bridge coordinates (`controlSocket`,
 * `frameSocket`, `token`) that the pre-T1 bridge still dials — a reader of
 * the old `TerminalTicket` keeps parsing this, a reader of the new shape
 * ignores the legacy three. TP-S3e removes the legacy fields and this result
 * becomes exactly `TerminalOpenTicket` (TP-L-F: every slice a subset of the
 * end state). */
export const TerminalOpenTicketResult = TerminalTicket.merge(TerminalOpenTicket).passthrough();
export type TerminalOpenTicketResult = z.infer<typeof TerminalOpenTicketResult>;

/** terminal.create result from TP-S1 (spec §5.1 `create(class) →
 * TerminalOpenTicket`): the session id, the legacy nested `ticket` (until
 * S3e) and the end-state fields spread. */
export const TerminalCreateOpenResult = z
  .object({ sessionId: z.string().min(1), ticket: TerminalTicket })
  .merge(TerminalOpenTicket)
  .passthrough();
export type TerminalCreateOpenResult = z.infer<typeof TerminalCreateOpenResult>;

/** terminal.renewAttach — CAS + idempotent: `expectGeneration` is the grant
 * generation the caller holds; `requestId` makes a retried renewal return the
 * same answer. */
export const TerminalRenewAttachParams = z
  .object({
    sessionId: z.string().min(1),
    expectGeneration: Counter,
    requestId: z.string().min(1),
  })
  .passthrough();
export type TerminalRenewAttachParams = z.infer<typeof TerminalRenewAttachParams>;

export const TerminalRenewAttachResult = z
  .object({ attachGrant: SessionAttachGrant })
  .passthrough();
export type TerminalRenewAttachResult = z.infer<typeof TerminalRenewAttachResult>;

// ---------------------------------------------------------------------------
// The roster's UI projection (spec §5.3, TP-D4)

export const SessionHealth = z.enum(["live", "recovering", "exited", "unknown"]);
export type SessionHealth = z.infer<typeof SessionHealth>;

const PLACEMENT_KEYS = new Set([
  "cell",
  "cellBootId",
  "cellInstanceId",
  "route",
  "endpoints",
  "placement",
]);

/** What the UI may know about a session: id, class, health, provenance — and
 * NO placement. The refinement makes TP-L-C a parse failure rather than a
 * review finding: a roster item carrying a cell tag is refused. */
export const ProductSessionRosterItem = z
  .object({
    sessionId: z.string().min(1),
    workloadClass: TerminalWorkloadClass,
    health: SessionHealth,
    title: z.string().optional(),
    provenance: z
      .object({
        kind: z.enum(["user", "agent", "system", "unknown"]),
        agentId: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .refine(
    (item) => Object.keys(item).every((k) => !PLACEMENT_KEYS.has(k)),
    "a roster item never carries placement (TP-L-C)",
  );
export type ProductSessionRosterItem = z.infer<typeof ProductSessionRosterItem>;

// ---------------------------------------------------------------------------
// The per-cell handshake (spec §5.1)

export const ProtocolVersion = z.object({ major: Counter, minor: Counter }).passthrough();
export type ProtocolVersion = z.infer<typeof ProtocolVersion>;

/** Wire capabilities outside the v1 core profile (TP-D25). Unknown strings
 * are tolerated and ignored; the intersection is what `ConnectionAccepted`
 * echoes. Renderer-internal features are never capabilities. */
export const KNOWN_CAPABILITIES = ["resume", "snapshot-demand", "profiling-envelope"] as const;
export type KnownCapability = (typeof KNOWN_CAPABILITIES)[number];

/** Receive capacity belongs to the WORKER: it advertises what it can hold on
 * the frames leg and the cell accepts the MIN of that and its own caps. */
export const ReceiverCapacities = z
  .object({
    connectionCreditBytes: ByteCount,
    perActivationCreditBytes: ByteCount,
    stagingBytesPerSession: ByteCount,
    stagingBytesTotal: ByteCount,
    maxConcurrentActivations: Counter,
    maxConcurrentSeeds: Counter,
  })
  .passthrough();
export type ReceiverCapacities = z.infer<typeof ReceiverCapacities>;

/** Cell-owned limits announced on accept. Names carry their unit (§20 item
 * 5); defaults are ratified at the post-S0 numeric checkpoint. */
export const ProtocolLimits = z
  .object({
    maxControlMessageBytes: ByteCount,
    maxPresentationChunkBytes: ByteCount,
    maxBatchLatencyMs: Counter,
    maxCreditReturnDelayMs: Counter,
    maxSceneAppliedDelayMs: Counter,
    sceneAppliedRefreshMs: Counter,
    presentationStatusRefreshMs: Counter,
    activationAttachDeadlineMs: Counter,
    maxActivationCatchupMs: Counter,
    maxCatchupBytes: ByteCount,
    creditAccountDrainTtlMs: Counter,
  })
  .passthrough();
export type ProtocolLimits = z.infer<typeof ProtocolLimits>;

/** First frame on either socket. clientId · connectionSetId ·
 * transportGrantGeneration are DERIVED from the verified grant, never
 * repeated here; `channel` must be ∈ the grant's `allowedChannels`. */
export const ConnectionHello = z
  .object({
    protocolMajor: Counter,
    protocolMinor: Counter,
    channel: TransportChannel,
    transportGrant: CellTransportGrant,
    /** frames leg only */
    receiverCapacities: ReceiverCapacities.optional(),
    capabilities: z.array(z.string()),
  })
  .passthrough();
export type ConnectionHello = z.infer<typeof ConnectionHello>;

export const ConnectionAccepted = z
  .object({
    selectedProtocolVersion: ProtocolVersion,
    connectionSetId: z.string().min(1),
    channel: TransportChannel,
    legGeneration: Counter,
    heartbeatTtlMs: Counter,
    /** frames leg: the credit epoch this leg opens */
    creditEpoch: Counter.optional(),
    /** frames leg: MIN(advertised, cell-owned) */
    initialWindows: ReceiverCapacities.optional(),
    protocolLimits: ProtocolLimits,
    /** the intersection of client and cell capabilities */
    capabilities: z.array(z.string()),
  })
  .passthrough();
export type ConnectionAccepted = z.infer<typeof ConnectionAccepted>;

/** Structured refusal codes — POST-verification only. Every pre-auth failure
 * is a silent `1008` (see `PreAuthFailureCode`, audit-only). */
export const ConnectionRefusalCode = z.enum([
  "GRANT_GENERATION_ROLLBACK",
  "GRANT_NONCE_REPLAYED",
  "CHANNEL_NOT_ALLOWED",
  "VERSION_UNSUPPORTED",
  "SET_CHANNEL_BUSY",
  "CAPACITY",
]);
export type ConnectionRefusalCode = z.infer<typeof ConnectionRefusalCode>;

export const ConnectionRefused = z
  .object({
    code: z.union([ConnectionRefusalCode, z.string()]),
    retryable: z.boolean(),
  })
  .passthrough();
export type ConnectionRefused = z.infer<typeof ConnectionRefused>;

/** The SILENT class: the grant is not a currently valid grant for this cell
 * (or the door was abused before a grant was seen). These codes exist for the
 * cell's audit line ONLY — the socket closes `1008` with no body and no code
 * on the wire, and the client's rule is "re-mint once, then UNAVAILABLE". */
export const PreAuthFailureCode = z.enum([
  "GRANT_BAD_MAC",
  "GRANT_KEY_UNKNOWN",
  "GRANT_TYPE_MISMATCH",
  "GRANT_AUDIENCE_MISMATCH",
  "GRANT_EXPIRED",
  "GRANT_NOT_YET_VALID",
  "GRANT_LIFETIME_EXCEEDED",
  "ORIGIN_REJECTED",
  "HELLO_MALFORMED",
  "PRE_AUTH_LIMIT",
]);
export type PreAuthFailureCode = z.infer<typeof PreAuthFailureCode>;

/** WebSocket close codes (spec §5.1). `1008` = every pre-authentication
 * failure, silent by policy; `1011` server error; 4000+ protocol-specific and
 * always named. */
export const TP_CLOSE_CODES = {
  POLICY_PRE_AUTH: 1008,
  SERVER_ERROR: 1011,
  STALE_ROUTE: 4000,
  FENCED: 4001,
  SUPERSEDED: 4002,
  PROTOCOL: 4003,
} as const;

export const LegHeartbeat = z
  .object({
    connectionSetId: z.string().min(1),
    channel: TransportChannel,
    legGeneration: Counter,
    sequence: Counter,
  })
  .passthrough();
export type LegHeartbeat = z.infer<typeof LegHeartbeat>;

export const LegHeartbeatAck = z.object({ sequence: Counter }).passthrough();
export type LegHeartbeatAck = z.infer<typeof LegHeartbeatAck>;

// ---------------------------------------------------------------------------
// Demand (spec §7, TP-L-E′)

export const SourceDemandMode = z.enum(["none", "snapshot", "live"]);
export type SourceDemandMode = z.infer<typeof SourceDemandMode>;

/** Semantic demand of one viewer: `mode` ordered none < snapshot < live
 * (`snapshot` is the `snapshot-demand` capability; the core is none|live),
 * `cadenceClass` the requested cadence, `urgency` the priority class
 * (`urgent` = the window-local latency-critical sessions — zero or more). */
export const SourceDemand = z
  .object({
    mode: SourceDemandMode,
    cadenceClass: z.enum(["low", "normal", "high"]).optional(),
    urgency: z.enum(["background", "normal", "urgent"]).optional(),
  })
  .passthrough();
export type SourceDemand = z.infer<typeof SourceDemand>;

/** Per-activation monotonic sequence, idempotent re-sends; release =
 * `{mode: "none"}`; a stale activation's demand is dropped by the cell. */
export const DeclareDemand = z
  .object({
    sessionId: z.string().min(1),
    activationId: z.string().min(1),
    leaseEpoch: Counter,
    demandSequence: Counter,
    demand: SourceDemand,
  })
  .passthrough();
export type DeclareDemand = z.infer<typeof DeclareDemand>;

export const DemandAccepted = z.object({ demandSequence: Counter }).passthrough();
export type DemandAccepted = z.infer<typeof DemandAccepted>;

// ---------------------------------------------------------------------------
// Session activation (spec §5.4, TP-D22)

/** Control leg: attach ONE session under an activation id minted by the
 * main-thread runtime (the activation authority). sessionId · leaseEpoch ·
 * routeRevision · rights are DERIVED from the verified attach grant. */
export const AttachControlLeg = z
  .object({
    activationId: z.string().min(1),
    attachGrant: SessionAttachGrant,
    replacesActivationId: z.string().min(1).optional(),
    initialDemand: SourceDemand,
  })
  .passthrough();
export type AttachControlLeg = z.infer<typeof AttachControlLeg>;

export const ControlLegAttached = z
  .object({
    sessionId: z.string().min(1),
    activationId: z.string().min(1),
    grantGenerationAccepted: Counter,
    rights: sortedUniqueArray(SessionAttachRight),
  })
  .passthrough();
export type ControlLegAttached = z.infer<typeof ControlLegAttached>;

export const AttachRefusalCode = z.enum([
  "ACTIVATION_CONFLICT",
  "GRANT_GENERATION_ROLLBACK",
  "GRANT_NONCE_REPLAYED",
  "STALE_ROUTE",
  "FENCED",
  "SESSION_UNKNOWN",
  "CAPACITY",
]);
export type AttachRefusalCode = z.infer<typeof AttachRefusalCode>;

export const AttachRefused = z
  .object({
    activationId: z.string().min(1).optional(),
    code: z.union([AttachRefusalCode, z.string()]),
    retryable: z.boolean(),
  })
  .passthrough();
export type AttachRefused = z.infer<typeof AttachRefused>;

/** `[cap: resume]` — the token minted at the FIRST frames attach and the
 * client's ACTUAL applied stamp (it may be AHEAD of the cell's last
 * SceneApplied — acks in flight when the leg died). */
export const ResumeRequest = z
  .object({
    resumeToken: z.string().min(1),
    from: SceneContentStamp,
  })
  .passthrough();
export type ResumeRequest = z.infer<typeof ResumeRequest>;

/** Frames leg: attach the same activation on the frames socket. */
export const AttachFramesLeg = z
  .object({
    activationId: z.string().min(1),
    attachGrant: SessionAttachGrant,
    resume: ResumeRequest.optional(),
  })
  .passthrough();
export type AttachFramesLeg = z.infer<typeof AttachFramesLeg>;

/** The TRF1 handles the cell stamps inside EVERY frame of this activation —
 * declared at attach, unique among the connection set's live activations.
 * The worker binds activationId → scene key = sessionHandle and REJECTS (as
 * `PROTOCOL`) any decoded frame whose inner handles differ, BEFORE apply —
 * the installed worker indexes its replica by the decoded handle, so two
 * identities must never route to two replicas (spec §8). */
export const TrfIdentity = z
  .object({
    sessionHandle: U64String,
    viewHandle: U64String,
  })
  .passthrough();
export type TrfIdentity = z.infer<typeof TrfIdentity>;

export const SeedRequiredReason = z.enum([
  "no-resume-capability",
  "no-cursor",
  "epoch-changed",
  "revision-gap",
  "cursor-expired",
  "budget-evicted",
]);
export type SeedRequiredReason = z.infer<typeof SeedRequiredReason>;

export const FramesAttachOutcome = z
  .object({
    kind: z.enum(["resume-accepted", "seed-required"]),
    /** resume-accepted */
    from: SceneContentStamp.optional(),
    newestAvailable: SceneContentStamp.optional(),
    /** seed-required */
    reason: z.union([SeedRequiredReason, z.string()]).optional(),
  })
  .passthrough()
  .refine(
    (o) =>
      o.kind === "resume-accepted" ? o.from !== undefined && o.newestAvailable !== undefined : true,
    "resume-accepted carries from + newestAvailable",
  );
export type FramesAttachOutcome = z.infer<typeof FramesAttachOutcome>;

export const FramesLegAttached = z
  .object({
    sessionId: z.string().min(1),
    activationId: z.string().min(1),
    resumeToken: z.string().min(1),
    trfIdentity: TrfIdentity,
    outcome: FramesAttachOutcome,
  })
  .passthrough();
export type FramesLegAttached = z.infer<typeof FramesLegAttached>;

/** Worker → cell (frames leg, JSON text): progress. Sent on change AND
 * repeated at least every `sceneAppliedRefreshMs` while idle — a quiet
 * terminal must not lose readiness for want of a new revision. */
export const SceneApplied = z
  .object({
    sessionId: z.string().min(1),
    activationId: z.string().min(1),
    leaseEpoch: Counter,
    appliedContent: SceneContentStamp,
  })
  .passthrough();
export type SceneApplied = z.infer<typeof SceneApplied>;

export const PresentationDimension = z
  .object({
    state: z.enum(["presenting", "stopped", "revoked"]),
    reason: z.string().optional(),
  })
  .passthrough();
export type PresentationDimension = z.infer<typeof PresentationDimension>;

export const InputDimension = z
  .object({
    state: z.enum(["allowed", "suspended", "revoked"]),
    reason: z.string().optional(),
  })
  .passthrough();
export type InputDimension = z.infer<typeof InputDimension>;

/** Known reasons per dimension (spec §5.4); unknown strings are tolerated. */
export const PRESENTATION_STOPPED_REASONS = ["overload", "stale-route"] as const;
export const INPUT_SUSPENDED_REASONS = ["lagging", "overload", "right-expired"] as const;
export const ACTIVATION_REVOKED_REASONS = [
  "leg-dead",
  "replaced",
  "right-revoked",
  "stale-route",
  "detached",
] as const;

/** Cell → main (control leg): the revocable LEASE with TWO independent
 * dimensions. `presentation` answers "is this viewer's scene being advanced";
 * `input` answers "may this viewer write". Invariant (the cell never says
 * otherwise): `input.state = allowed ⇒ presentation.state = presenting`. A
 * rights downgrade is `input: revoked{right-revoked}` with presentation
 * continuing; `presentation: revoked` ends the activation. The lag decision
 * is the cell's alone and arrives as `input: suspended{lagging}`. */
export const CellActivationStatus = z
  .object({
    sessionId: z.string().min(1),
    activationId: z.string().min(1),
    cellStatusSequence: Counter,
    leaseTtlMs: Counter,
    acceptedContent: SceneContentStamp.optional(),
    presentation: PresentationDimension,
    input: InputDimension,
  })
  .passthrough()
  .refine(
    (s) => s.input.state !== "allowed" || s.presentation.state === "presenting",
    "input=allowed implies presentation=presenting",
  );
export type CellActivationStatus = z.infer<typeof CellActivationStatus>;

/** Worker → main (in-process, the renderer's own seam): the worker's
 * presentation liveness lease — on change AND repeated every
 * `presentationStatusRefreshMs` while idle. */
export const PresentationStatus = z
  .object({
    activationId: z.string().min(1),
    workerStatusSequence: Counter,
    state: z.enum(["connecting", "seeding", "active", "recovering"]),
    sceneContent: SceneContentStamp.optional(),
    leaseTtlMs: Counter,
  })
  .passthrough();
export type PresentationStatus = z.infer<typeof PresentationStatus>;

/** Worker → main: the bounded report of the frames leg's view of an
 * activation. The worker owns NO activation state — main decides. */
export const FramesLegState = z
  .object({
    activationId: z.string().min(1),
    state: z.enum(["attaching", "resuming", "seeding", "applying", "active", "failed"]),
    resumeToken: z.string().optional(),
    appliedContent: SceneContentStamp.optional(),
  })
  .passthrough();
export type FramesLegState = z.infer<typeof FramesLegState>;

// ---------------------------------------------------------------------------
// The geometry lease (spec §6, TP-D2) — every verb carries the activation triple

const ActivationTriple = {
  sessionId: z.string().min(1),
  activationId: z.string().min(1),
  leaseEpoch: Counter,
};

/** The CALLER names a claimant (it cannot possess a cell-minted generation
 * before the claim). `viewId` is a non-reused mount-instance id. */
export const GeometryClaimant = z
  .object({ clientId: z.string().min(1), viewId: z.string().min(1) })
  .passthrough();
export type GeometryClaimant = z.infer<typeof GeometryClaimant>;

/** The CELL mints `holderGeneration` on a successful claim/transfer. */
export const GeometryHolder = GeometryClaimant.extend({ holderGeneration: Counter }).passthrough();
export type GeometryHolder = z.infer<typeof GeometryHolder>;

export const ClaimGeometry = z
  .object({
    ...ActivationTriple,
    claimant: GeometryClaimant,
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    expectRevision: Counter,
  })
  .passthrough();
export type ClaimGeometry = z.infer<typeof ClaimGeometry>;

export const ReleaseGeometry = z
  .object({ ...ActivationTriple, holder: GeometryHolder })
  .passthrough();
export type ReleaseGeometry = z.infer<typeof ReleaseGeometry>;

/** ONE cell-side transition that revokes, grants and commits the resize. */
export const TransferGeometry = z
  .object({
    ...ActivationTriple,
    from: GeometryHolder,
    to: GeometryClaimant,
    expectRevision: Counter,
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  })
  .passthrough();
export type TransferGeometry = z.infer<typeof TransferGeometry>;

export const GeometryCommitted = z
  .object({
    holder: GeometryHolder,
    geometryRevision: Counter,
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  })
  .passthrough();
export type GeometryCommitted = z.infer<typeof GeometryCommitted>;

export const GeometryRefusalCode = z.enum([
  "SEAT_HELD",
  "STALE_REVISION",
  "NOT_HOLDER",
  "RIGHT_MISSING",
  "DESTINATION_INELIGIBLE",
]);
export type GeometryRefusalCode = z.infer<typeof GeometryRefusalCode>;

export const GeometryRefused = z
  .object({
    code: z.union([GeometryRefusalCode, z.string()]),
    currentHolder: GeometryHolder.optional(),
    geometryRevision: Counter.optional(),
  })
  .passthrough();
export type GeometryRefused = z.infer<typeof GeometryRefused>;

// ---------------------------------------------------------------------------
// The frames plane (spec §8): credits, transfers, the presentation envelope

/** Worker → cell (frames leg, JSON text). Every total is CUMULATIVE BYTES
 * within the credit epoch, monotonic, order-independent; the cell applies
 * max() per field and ignores a creditSequence it has already seen. Credit is
 * bytes, never sequence: the worker consumes units OUT of connection order
 * (urgent first, round-robin), so a connection-level "consumed through N"
 * cannot be stated. The charge of a unit is the RECEIVED MESSAGE LENGTH. */
export const TransportCredit = z
  .object({
    creditEpoch: Counter,
    creditSequence: Counter,
    connectionBytesReturned: ByteCount,
    accounts: z.array(
      z.object({ activationId: z.string().min(1), bytesReturned: ByteCount }).passthrough(),
    ),
  })
  .passthrough();
export type TransportCredit = z.infer<typeof TransportCredit>;

/** Worker → cell (frames leg, JSON text): one half of the clock calibration
 * exchange that doubles as the frames heartbeat. `t0` = worker send time. */
export const CalibrationPing = z.object({ sequence: Counter, t0: z.number() }).passthrough();
export type CalibrationPing = z.infer<typeof CalibrationPing>;

export const PresentationEnvelopeKind = z.enum([
  "trf1-frame",
  "transfer-begin",
  "transfer-chunk",
  "transfer-end",
  "calibration",
]);
export type PresentationEnvelopeKind = z.infer<typeof PresentationEnvelopeKind>;

export const TransferKind = z.enum(["seed", "catchup"]);
export type TransferKind = z.infer<typeof TransferKind>;

export const TransferLayout = z
  .object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    scrollbackRows: Counter,
  })
  .passthrough();
export type TransferLayout = z.infer<typeof TransferLayout>;

/** Per-kind transfer fields of the envelope header. begin: the whole
 * contract of the transfer; chunk: placement of this chunk's payload; end:
 * the id only. `checksum` (crc32c over the concatenated chunk bytes) is
 * integrity only — the channel is already authenticated. */
export const TransferHeader = z
  .object({
    transferId: z.string().min(1),
    /** transfer-begin */
    kind: TransferKind.optional(),
    totalBytes: ByteCount.optional(),
    chunkCount: Counter.optional(),
    targetLayout: TransferLayout.optional(),
    checksum: z
      .object({ alg: z.literal("crc32c"), value: Counter })
      .passthrough()
      .optional(),
    /** transfer-chunk */
    chunkIndex: Counter.optional(),
    byteOffset: ByteCount.optional(),
  })
  .passthrough();
export type TransferHeader = z.infer<typeof TransferHeader>;

/** Cell → worker envelope, embedded in a cell→worker calibration unit:
 * the worker's ping echoed with the cell's receive/send times. */
export const CalibrationEcho = z
  .object({ sequence: Counter, t0: z.number(), t1: z.number(), t2: z.number() })
  .passthrough();
export type CalibrationEcho = z.infer<typeof CalibrationEcho>;

/** `[cap: profiling-envelope]` — absent when profiling is off. Cell-clock ms. */
export const ProfilingEnvelope = z
  .object({
    damageFirstTs: z.number(),
    damageLastTs: z.number(),
    encodeTs: z.number(),
    probeId: z.string().optional(),
  })
  .passthrough();
export type ProfilingEnvelope = z.infer<typeof ProfilingEnvelope>;

/** The JSON header of every cell → worker presentation unit. The payload is
 * an UNCHANGED TRF1 frame (kind trf1-frame) or a transfer chunk; the TRF1
 * reader is exact-version and this spec defines no TRF1 change.
 * `creditEpoch` must equal the leg's epoch (else PROTOCOL); `activationSequence`
 * is per-activation monotonic — a correctness check on an ordered socket.
 * A seed's `baseContent` is `null` (the worker may hold no compatible base);
 * a catch-up carries the base it requires; a DeltaFrame applies iff its
 * `baseContent` equals the worker's current stamp. */
export const PresentationEnvelopeHeader = z
  .object({
    creditEpoch: Counter,
    activationSequence: Counter,
    sessionId: z.string().min(1),
    activationId: z.string().min(1),
    leaseEpoch: Counter,
    kind: PresentationEnvelopeKind,
    baseContent: SceneContentStamp.nullable().optional(),
    resultContent: SceneContentStamp.optional(),
    transfer: TransferHeader.optional(),
    calibration: CalibrationEcho.optional(),
    profiling: ProfilingEnvelope.optional(),
  })
  .passthrough()
  .superRefine((h, ctx) => {
    const need = (cond: boolean, message: string) => {
      if (!cond) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    };
    switch (h.kind) {
      case "trf1-frame":
        need(h.resultContent !== undefined, "trf1-frame carries resultContent");
        need(
          h.baseContent !== undefined,
          "trf1-frame carries baseContent (a stamp, or null for a self-contained full frame)",
        );
        break;
      case "transfer-begin":
        need(h.transfer?.kind !== undefined, "transfer-begin carries transfer.kind");
        need(
          h.transfer?.totalBytes !== undefined && h.transfer?.chunkCount !== undefined,
          "transfer-begin carries totalBytes + chunkCount",
        );
        need(h.transfer?.targetLayout !== undefined, "transfer-begin carries targetLayout");
        need(h.transfer?.checksum !== undefined, "transfer-begin carries checksum");
        need(h.resultContent !== undefined, "transfer-begin carries resultContent");
        if (h.transfer?.kind === "seed")
          need(h.baseContent === null, "a seed carries baseContent = null");
        if (h.transfer?.kind === "catchup")
          need(
            h.baseContent !== undefined && h.baseContent !== null,
            "a catch-up carries the base it requires",
          );
        break;
      case "transfer-chunk":
        need(
          h.transfer?.chunkIndex !== undefined && h.transfer?.byteOffset !== undefined,
          "transfer-chunk carries chunkIndex + byteOffset",
        );
        break;
      case "transfer-end":
        need(h.transfer !== undefined, "transfer-end carries transfer.transferId");
        break;
      case "calibration":
        need(h.calibration !== undefined, "calibration carries the echo");
        break;
    }
    // Epoch equality across the stamps of one unit (spec §8).
    const epochs = [h.baseContent ?? undefined, h.resultContent]
      .filter((s): s is SceneContentStamp => s !== undefined)
      .map((s) => `${s.sceneEpoch.cellBootId}/${s.sceneEpoch.modelGeneration}`);
    need(new Set(epochs).size <= 1, "base and result stamps share one sceneEpoch");
  });
export type PresentationEnvelopeHeader = z.infer<typeof PresentationEnvelopeHeader>;

/** Binary framing of a presentation unit on the frames WebSocket (binary
 * message): an 8-byte prefix, the UTF-8 JSON header, the payload.
 *
 *   0  'T' (0x54)
 *   1  'P' (0x50)
 *   2  version (1)
 *   3  reserved (0)
 *   4  u32 BE header length (bytes)
 *   8  header JSON (PresentationEnvelopeHeader), then the payload to the end
 *
 * The unit's credit CHARGE is the whole message length (prefix + header +
 * payload) as received — never a field. */
export const PRESENTATION_ENVELOPE_MAGIC = [0x54, 0x50] as const;
export const PRESENTATION_ENVELOPE_VERSION = 1 as const;
export const PRESENTATION_ENVELOPE_PREFIX_BYTES = 8 as const;
/** Header cap: a header is a few hundred bytes; anything larger is PROTOCOL. */
export const PRESENTATION_ENVELOPE_MAX_HEADER_BYTES = 4096 as const;

export interface PresentationEnvelope {
  header: PresentationEnvelopeHeader;
  payload: Uint8Array;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function encodePresentationEnvelope(
  header: PresentationEnvelopeHeader,
  payload: Uint8Array,
): Uint8Array {
  const headerBytes = utf8Encoder.encode(JSON.stringify(header));
  if (headerBytes.byteLength > PRESENTATION_ENVELOPE_MAX_HEADER_BYTES)
    throw new RangeError(`presentation envelope header too large: ${headerBytes.byteLength}`);
  const out = new Uint8Array(
    PRESENTATION_ENVELOPE_PREFIX_BYTES + headerBytes.byteLength + payload.byteLength,
  );
  out[0] = PRESENTATION_ENVELOPE_MAGIC[0];
  out[1] = PRESENTATION_ENVELOPE_MAGIC[1];
  out[2] = PRESENTATION_ENVELOPE_VERSION;
  out[3] = 0;
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(
    4,
    headerBytes.byteLength,
    false,
  );
  out.set(headerBytes, PRESENTATION_ENVELOPE_PREFIX_BYTES);
  out.set(payload, PRESENTATION_ENVELOPE_PREFIX_BYTES + headerBytes.byteLength);
  return out;
}

export type PresentationEnvelopeDecodeError =
  | "short"
  | "bad-magic"
  | "bad-version"
  | "header-too-large"
  | "header-truncated"
  | "header-not-utf8"
  | "header-not-json"
  | "header-invalid";

export type PresentationEnvelopeDecodeResult =
  | { ok: true; envelope: PresentationEnvelope; chargedBytes: number }
  | { ok: false; error: PresentationEnvelopeDecodeError; issues?: z.ZodIssue[] };

/** Decodes one binary message. `chargedBytes` is the whole message length —
 * the credit charge the receiver returns. The payload is a VIEW into `bytes`
 * (no copy); callers that retain it past the message must copy. */
export function decodePresentationEnvelope(bytes: Uint8Array): PresentationEnvelopeDecodeResult {
  if (bytes.byteLength < PRESENTATION_ENVELOPE_PREFIX_BYTES) return { ok: false, error: "short" };
  if (bytes[0] !== PRESENTATION_ENVELOPE_MAGIC[0] || bytes[1] !== PRESENTATION_ENVELOPE_MAGIC[1])
    return { ok: false, error: "bad-magic" };
  if (bytes[2] !== PRESENTATION_ENVELOPE_VERSION) return { ok: false, error: "bad-version" };
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    4,
    false,
  );
  if (headerLength > PRESENTATION_ENVELOPE_MAX_HEADER_BYTES)
    return { ok: false, error: "header-too-large" };
  const headerEnd = PRESENTATION_ENVELOPE_PREFIX_BYTES + headerLength;
  if (headerEnd > bytes.byteLength) return { ok: false, error: "header-truncated" };
  let headerText: string;
  try {
    headerText = utf8Decoder.decode(bytes.subarray(PRESENTATION_ENVELOPE_PREFIX_BYTES, headerEnd));
  } catch {
    return { ok: false, error: "header-not-utf8" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(headerText);
  } catch {
    return { ok: false, error: "header-not-json" };
  }
  const parsed = PresentationEnvelopeHeader.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "header-invalid", issues: parsed.error.issues };
  return {
    ok: true,
    envelope: { header: parsed.data, payload: bytes.subarray(headerEnd) },
    chargedBytes: bytes.byteLength,
  };
}
