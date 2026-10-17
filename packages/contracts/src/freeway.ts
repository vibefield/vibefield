import { z } from "zod";
import { FREEWAY, FREEWAY_CODES } from "./registries";
import {
  CellTransportGrant,
  Counter,
  EpochMs,
  FreewayCellEndpointSet,
  GRANT_ALG,
  GRANT_ENVELOPE_VERSION,
  SessionAttachGrant,
  SessionAttachRight,
  sortedUniqueArray,
  TerminalOpenTicket,
  TransportChannel,
} from "./terminal-pipeline";

// THE FREEWAY (FW-D1…D7; `draft/thinking-freeway.md` v0.3 §3–§5) — one link per peer: the phone's
// to each desktop it shows, opened at connect, and one per desktop pair; every plane a stream on
// it. A link ends in `field-freeway-host`, the floor's supervised child (FW-D4), so terminal bytes
// pass through neither Node (EL2) nor the floor (TC-L1c, DS-L5).
//
// One binary WebSocket message is one FRAME: `u8 frameType` · LEB128 `streamId` · payload
// (`FREEWAY_FRAME`). Stream 0 is the LINK: its JSON payloads below are `type`-tagged. Other streams
// open with an OPEN whose JSON payload is `kind`-tagged — the dialer opens odd ids, the acceptor
// even ones — and TEXT/BINARY may follow an OPEN at once (optimistic open). A `terminal-leg` stream
// then carries the routed protocol (TPv3) end to end: TEXT and BINARY verbatim, the leg's close
// code in CLOSE, so the cell and the routed client see what they saw on a socket.
//
// This is the v1 wire, written once (v0.3 §5.1): the desktop pair (FD1) adds kinds and the
// desktop paths, never a frame. TS + the host's Rust + the kit's Swift, pinned by the `freeway-*`
// fixtures on every side (EL9). Tolerant reader: every object `.passthrough()`.

/** The frame types (`u8`), the payload each carries, and on which streams. */
export const FREEWAY_FRAME = {
  /** stream 0 only: a `FreewayLinkMessage` (JSON) */
  LINK: 0x00,
  /** either way, on a new stream id: a `FreewayOpen` (JSON) */
  OPEN: 0x01,
  /** the reply: a `FreewayOpened` (JSON) — the stream is up */
  OPENED: 0x02,
  /** either way: one UTF-8 message (or fragment) of the stream's protocol */
  TEXT: 0x03,
  /** either way: one binary message (or fragment) of the stream's protocol */
  BINARY: 0x04,
  /** either way: a `FreewayClose` (JSON) — the stream is over */
  CLOSE: 0x05,
  /** either way: a LEB128 count of bytes granted (every kind but a terminal leg) */
  WINDOW: 0x06,
  /** the reply: a `FreewayOpenRefused` (JSON) — the HOST refused the open */
  OPEN_REFUSED: 0x07,
} as const;

/** Set on a TEXT or BINARY frame type: more fragments of this message follow. The receiver
 * reassembles per stream, up to the kind's own message bound. */
export const FREEWAY_FRAGMENT_BIT = 0x80;

/** The traffic classes (FW-L7). `urgent` drains strictly first; the others by deficit round-robin,
 * 8:2:1 by bytes. A product stream's class is its METHOD's; a terminal leg's control is `urgent`,
 * its frames `live` when focused and `sync` otherwise. */
export const FreewayStreamClass = z.enum(["urgent", "live", "sync", "bulk"]);
export type FreewayStreamClass = z.infer<typeof FreewayStreamClass>;

export const FreewayProtocol = z
  .object({ major: z.literal(FREEWAY.PROTOCOL_MAJOR), minor: Counter })
  .passthrough();
export type FreewayProtocol = z.infer<typeof FreewayProtocol>;

/** A link or open refusal's code: one of `FREEWAY_CODES`. */
export const FreewayCode = z
  .number()
  .int()
  .refine((code) => (Object.values(FREEWAY_CODES) as number[]).includes(code), {
    message: "a FREEWAY_CODES value",
  });

// ---------------------------------------------------------------------------
// The approval (FW-D1: fieldd approves a PHONE's link once; revocable, audited)

/** Which floor key signed an approval: the freeway key is per FLOOR boot (the host may restart
 * under it and keep honouring its approvals). */
export const FreewayApprovalKeyId = z
  .object({ floorBootId: z.string().min(1), keyGeneration: Counter })
  .passthrough();
export type FreewayApprovalKeyId = z.infer<typeof FreewayApprovalKeyId>;

export const FreewayApprovalProtected = z
  .object({
    v: z.literal(GRANT_ENVELOPE_VERSION),
    typ: z.literal("FreewayApproval"),
    iss: z.literal("fieldd"),
    alg: z.literal(GRANT_ALG),
    kid: FreewayApprovalKeyId,
  })
  .passthrough();
export type FreewayApprovalProtected = z.infer<typeof FreewayApprovalProtected>;

/** Who fieldd approved, and for what. fieldd mints only for a node its roster correlates to a
 * PHONE row, and `principal.tailscaleId` comes from that roster, never from the request. It binds
 * the approval to the transport: the host refuses one whose node is not the node the sidecar
 * injected on THIS connection (a copied approval is useless from another node). */
export const FreewayApprovalClaims = z
  .object({
    audienceFloorBootId: z.string().min(1),
    clientId: z.string().min(1),
    principal: z
      .object({
        kind: z.literal("tailnet"),
        login: z.string().min(1),
        tailscaleId: z.string().min(1),
      })
      .passthrough(),
    rights: sortedUniqueArray(SessionAttachRight),
    issuedAt: EpochMs,
    expiresAt: EpochMs,
    nonce: z.string().min(1),
  })
  .passthrough();
export type FreewayApprovalClaims = z.infer<typeof FreewayApprovalClaims>;

/** The approval: TPv3's authenticated envelope, the floor's freeway key under the MAC
 * (`grantSigningInput`, the same JCS bytes). */
export const FreewayApproval = z
  .object({
    protected: FreewayApprovalProtected,
    claims: FreewayApprovalClaims,
    mac: z.string().min(1),
  })
  .passthrough();
export type FreewayApproval = z.infer<typeof FreewayApproval>;

/** `freeway.approve {}` → the approval and when it lapses. Forwarded for FW-D5 (a self peer
 * daemon carrying `onBehalfOf {clientKind: "phone"}`): `onBehalfOf` picks the audience only. */
export const FreewayApproveParams = z.object({}).passthrough();
export type FreewayApproveParams = z.infer<typeof FreewayApproveParams>;
export const FreewayApproveResult = z
  .object({ approval: FreewayApproval, expiresAt: EpochMs })
  .passthrough();
export type FreewayApproveResult = z.infer<typeof FreewayApproveResult>;

// ---------------------------------------------------------------------------
// Stream 0 — the link

/** How the floor sees the peer's node: `connectionType` is truffle's `Peer.connection_type`
 * ("direct" | "relay:<region>"; honest at ≥0.7.17, "unknown" for a peer idle about 2 min),
 * `endpoint` the direct address when there is one. FW-L8: the path is a fact the app shows. */
export const FreewayPath = z
  .object({
    connectionType: z.string().min(1).optional(),
    endpoint: z.string().min(1).optional(),
  })
  .passthrough();
export type FreewayPath = z.infer<typeof FreewayPath>;

/** The PHONE's hello: its approval is mandatory. Kept a `Value` until verified, as a grant is
 * everywhere else. */
export const FreewayHello = z
  .object({
    type: z.literal("FreewayHello"),
    protocol: FreewayProtocol,
    approval: z.unknown(),
    device: z
      .object({ name: z.string().min(1).optional() })
      .passthrough()
      .optional(),
    capabilities: z.array(z.string()),
  })
  .passthrough();
export type FreewayHello = z.infer<typeof FreewayHello>;

/** A DESKTOP's hello (FW-D6): no approval, `rights: []` — a desktop link opens only `product`,
 * judged per call by the far fieldd, and kinds whose far doors demand their own grant. */
export const FreewayPeerHello = z
  .object({
    type: z.literal("FreewayPeerHello"),
    protocol: FreewayProtocol,
    capabilities: z.array(z.string()),
  })
  .passthrough();
export type FreewayPeerHello = z.infer<typeof FreewayPeerHello>;

/** What the link holds to. No message bound: a stream's is its plane's. */
export const FreewayLimits = z
  .object({
    fragmentBytes: Counter,
    streamWindowBytes: Counter,
    maxStreams: Counter,
  })
  .passthrough();
export type FreewayLimits = z.infer<typeof FreewayLimits>;

/** `deviceId` is a consistency check, never authority (FW-L9): a mismatch with the peer the
 * dialer meant to reach closes the link `NOT_ADMITTED`. A phone's welcome carries its `clientId`
 * and `approvalExpiresAt`; a desktop's carries neither and `rights: []`. */
export const FreewayWelcome = z
  .object({
    type: z.literal("FreewayWelcome"),
    linkId: z.string().min(1),
    hostBootId: z.string().min(1),
    floorBootId: z.string().min(1),
    deviceId: z.string().min(1),
    clientId: z.string().min(1).optional(),
    rights: sortedUniqueArray(SessionAttachRight),
    limits: FreewayLimits,
    heartbeatMs: Counter,
    approvalExpiresAt: EpochMs.optional(),
    path: FreewayPath.optional(),
  })
  .passthrough();
export type FreewayWelcome = z.infer<typeof FreewayWelcome>;

/** Why a link was refused, before the host closes it with the matching `FREEWAY_CODES` value. */
export const FreewayRefusalCode = z.enum([
  "APPROVAL_INVALID",
  "APPROVAL_EXPIRED",
  "NOT_SELF",
  "NOT_ADMITTED",
  "IDENTITY_MISMATCH",
  "PROTOCOL",
  "PROTOCOL_VERSION",
]);
export type FreewayRefusalCode = z.infer<typeof FreewayRefusalCode>;

export const FreewayRefused = z
  .object({
    type: z.literal("FreewayRefused"),
    code: FreewayRefusalCode.or(z.string().min(1)),
    retryable: z.boolean(),
    message: z.string(),
  })
  .passthrough();
export type FreewayRefused = z.infer<typeof FreewayRefused>;

export const FreewayPing = z
  .object({ type: z.literal("Ping"), seq: Counter, sentAtMs: EpochMs })
  .passthrough();
export type FreewayPing = z.infer<typeof FreewayPing>;

/** A pong may carry the receiver's `Ack` (its cumulative delivered bytes). */
export const FreewayPong = z
  .object({
    type: z.literal("Pong"),
    seq: Counter,
    sentAtMs: EpochMs,
    ackBytes: Counter.optional(),
  })
  .passthrough();
export type FreewayPong = z.infer<typeof FreewayPong>;

/** The receiver's cumulative delivered bytes, sent every `FREEWAY.ACK_EVERY_BYTES`: the sender
 * keeps its unacknowledged non-urgent bytes under about one bandwidth-delay product (FW-L7). */
export const FreewayAck = z.object({ type: z.literal("Ack"), bytes: Counter }).passthrough();
export type FreewayAck = z.infer<typeof FreewayAck>;

/** The phone's focus: the focused cell's frames leg rides `live`, other cells' `sync`. */
export const FreewayPriority = z
  .object({ type: z.literal("Priority"), streamId: Counter, class: FreewayStreamClass })
  .passthrough();
export type FreewayPriority = z.infer<typeof FreewayPriority>;

export const FreewayRenew = z
  .object({ type: z.literal("Renew"), approval: z.unknown() })
  .passthrough();
export type FreewayRenew = z.infer<typeof FreewayRenew>;
export const FreewayRenewed = z
  .object({ type: z.literal("Renewed"), approvalExpiresAt: EpochMs })
  .passthrough();
export type FreewayRenewed = z.infer<typeof FreewayRenewed>;

/** A planned close says so first, so the peer says "restarting" and waits `ttlMs` instead of
 * reading a transport loss. A desktop's own state stays the roster's `DeviceState`. */
export const FreewayRestarting = z
  .object({
    type: z.literal("Restarting"),
    reason: z.string().min(1),
    planes: z.array(z.enum(["host", "floor", "app"])),
    at: EpochMs,
    ttlMs: Counter,
  })
  .passthrough();
export type FreewayRestarting = z.infer<typeof FreewayRestarting>;

export const FreewayPathChanged = z
  .object({ type: z.literal("Path") })
  .merge(FreewayPath)
  .passthrough();
export type FreewayPathChanged = z.infer<typeof FreewayPathChanged>;

export const FreewayLinkMessage = z.discriminatedUnion("type", [
  FreewayHello,
  FreewayPeerHello,
  FreewayWelcome,
  FreewayRefused,
  FreewayPing,
  FreewayPong,
  FreewayAck,
  FreewayPriority,
  FreewayRenew,
  FreewayRenewed,
  FreewayRestarting,
  FreewayPathChanged,
]);
export type FreewayLinkMessage = z.infer<typeof FreewayLinkMessage>;

// ---------------------------------------------------------------------------
// Streams ≥ 1

/** A terminal leg: the host dials the cell's loopback door and splices verbatim. */
export const FreewayOpenTerminalLeg = z
  .object({
    kind: z.literal("terminal-leg"),
    cellBootId: z.string().min(1),
    channel: TransportChannel,
  })
  .passthrough();
export type FreewayOpenTerminalLeg = z.infer<typeof FreewayOpenTerminalLeg>;

/** Tickets the host mints for an approved phone's sessions, from keys the floor handed it. */
export const FreewayOpenTerminalTickets = z
  .object({
    kind: z.literal("terminal-tickets"),
    sessionIds: z.array(z.string().min(1)).min(1).max(FREEWAY.MAX_TICKETS_PER_ASK),
  })
  .passthrough();
export type FreewayOpenTerminalTickets = z.infer<typeof FreewayOpenTerminalTickets>;

/** A renewal, idempotent by `requestId` (TPv3 §5.1's CAS on the generation). */
export const FreewayOpenTerminalRenew = z
  .object({
    kind: z.literal("terminal-renew"),
    sessionId: z.string().min(1),
    expectGeneration: Counter,
    requestId: z.string().min(1),
  })
  .passthrough();
export type FreewayOpenTerminalRenew = z.infer<typeof FreewayOpenTerminalRenew>;

export const FreewayOpen = z.discriminatedUnion("kind", [
  FreewayOpenTerminalLeg,
  FreewayOpenTerminalTickets,
  FreewayOpenTerminalRenew,
]);
export type FreewayOpen = z.infer<typeof FreewayOpen>;

export const FreewayTicketRefusal = z
  .object({ code: z.string().min(1), message: z.string(), retryable: z.boolean() })
  .passthrough();
export type FreewayTicketRefusal = z.infer<typeof FreewayTicketRefusal>;

/** One session's answer: a ticket, or why there is none. */
/** FW-D1 — a phone's cell grants are the freeway HOST's, minted from keys the floor generated, so
 * they name `field-native` as their issuer: honest provenance, never a host signing as fieldd.
 * TPv3's envelopes otherwise, verified by the cell with its own key. Scoped to the link's own
 * tickets: a desktop's renderer only ever holds fieldd's (`TerminalOpenTicket`). */
export const FreewayCellTransportGrant = CellTransportGrant.extend({
  protected: CellTransportGrant.shape.protected.extend({ iss: z.literal("field-native") }),
});
export type FreewayCellTransportGrant = z.infer<typeof FreewayCellTransportGrant>;
export const FreewaySessionAttachGrant = SessionAttachGrant.extend({
  protected: SessionAttachGrant.shape.protected.extend({ iss: z.literal("field-native") }),
});
export type FreewaySessionAttachGrant = z.infer<typeof FreewaySessionAttachGrant>;

/** A phone's ticket over the link: TPv3's, with the host's two grants and the cell's two legs as
 * streams on this link (`freeway://cell/<boot>/control|frames`). */
export const FreewayOpenTicket = TerminalOpenTicket.extend({
  endpoints: FreewayCellEndpointSet,
  transportGrant: FreewayCellTransportGrant,
  attachGrant: FreewaySessionAttachGrant,
});
export type FreewayOpenTicket = z.infer<typeof FreewayOpenTicket>;

export const FreewayTicketRow = z
  .object({
    sessionId: z.string().min(1),
    ticket: FreewayOpenTicket.optional(),
    refusal: FreewayTicketRefusal.optional(),
  })
  .passthrough()
  .refine((row) => (row.ticket === undefined) !== (row.refusal === undefined), {
    message: "exactly one of ticket or refusal",
  });
export type FreewayTicketRow = z.infer<typeof FreewayTicketRow>;

export const FreewayOpened = z.union([
  z.object({ tickets: z.array(FreewayTicketRow) }).passthrough(),
  z.object({ attachGrant: FreewaySessionAttachGrant }).passthrough(),
  z.object({}).passthrough(),
]);
export type FreewayOpened = z.infer<typeof FreewayOpened>;

/** The HOST's refusal of one open (`KIND_NOT_SERVED`, `APPROVAL` on a desktop link,
 * `DOOR_DOWN` for a held open that timed out, …): `state` says what the far side is doing. */
export const FreewayOpenRefused = z
  .object({ code: FreewayCode, state: z.string().min(1), retryable: z.boolean() })
  .passthrough();
export type FreewayOpenRefused = z.infer<typeof FreewayOpenRefused>;

/** A stream's end, its protocol's own WebSocket close code carried verbatim. */
export const FreewayClose = z
  .object({ code: z.number().int().min(1000).max(4999), reason: z.string().optional() })
  .passthrough();
export type FreewayClose = z.infer<typeof FreewayClose>;

// ---------------------------------------------------------------------------
// The floor's seam (mgmt; v0.3 §4.3, §5.2) — what field-native reads and writes, so these (and only
// these) ride the JSON Schema bundle into the Rust contracts. fieldd → the floor: ONE declaration,
// replace-whole and idempotent. The floor → fieldd: one revisioned snapshot stream, TC-D15's
// pattern (E-F1's lesson: a fact read only at a hello goes stale), and the joins fieldd audits.
// Every secret here is memory-only, never logged, never in an environment. Numbers are FRESH zod
// instances, never terminal-pipeline's shared counters: zod-to-json-schema dedupes a reused
// instance into a nested `$ref` that `cargo typify` cannot resolve.

const count = () => z.number().int().nonnegative();

/** Who the host admits, and with which hello: fieldd's policy, from the roster's self-peer rows
 * (desktops by the one desktop predicate, phones the rest). */
export const FreewayAdmitRow = z
  .object({ deviceId: z.string().min(1), role: z.enum(["desktop", "phone"]) })
  .passthrough();
export type FreewayAdmitRow = z.infer<typeof FreewayAdmitRow>;

/** The loopback doors the host splices streams to. `product` is fieldd's own freeway door
 * (`ws://127.0.0.1:<port>/fw/<secret>`), the desktop pair's (FD1); none is F1's. */
export const FreewayDoors = z
  .object({
    product: z.string().min(1).optional(),
    index: z.string().min(1).optional(),
    files: z.string().min(1).optional(),
    blob: z.string().min(1).optional(),
  })
  .passthrough();
export type FreewayDoors = z.infer<typeof FreewayDoors>;

/** The owner's word on off-device terminals (today's `FIELD_NATIVE_TERMINAL_MESH`, moved into
 * fieldd's policy). Off: the host refuses off-device terminal kinds `KIND_NOT_SERVED`. */
export const FreewayExposure = z.object({ terminals: z.boolean() }).passthrough();
export type FreewayExposure = z.infer<typeof FreewayExposure>;

/** `native.freeway.declare` — the floor keeps the last one in memory and replays it to every host
 * generation, so revocation is state and a host restart while fieldd is down forgets nothing. */
export const FreewayDeclareParams = z
  .object({ admit: z.array(FreewayAdmitRow), doors: FreewayDoors, exposure: FreewayExposure })
  .passthrough();
export type FreewayDeclareParams = z.infer<typeof FreewayDeclareParams>;
export const FreewayDeclareResult = z.object({}).passthrough();
export type FreewayDeclareResult = z.infer<typeof FreewayDeclareResult>;

/** One link as the host reports it; `path` is the floor's peer row (FW-L8). */
export const FreewayLinkState = z.enum(["dialing", "up", "restarting", "down"]);
export type FreewayLinkState = z.infer<typeof FreewayLinkState>;
export const FreewayLinkRow = z
  .object({
    deviceId: z.string().min(1),
    state: FreewayLinkState,
    connectionType: z.string().min(1).optional(),
    rttMs: z.number().nonnegative().optional(),
  })
  .passthrough();
export type FreewayLinkRow = z.infer<typeof FreewayLinkRow>;

/** `native.freeway.state.subscribe` — the subscribe answers the current state, and each frame
 * after is the FULL state at a higher `revision`. The listener, its port and both secrets are per
 * FLOOR boot, so a host restart moves only `up` and `hostBootId`. `up: false` (no host): fieldd
 * declares no serve, and `freeway.approve` is `UNAVAILABLE {service: "freeway", state}`. */
export const FreewayState = z
  .object({
    revision: count(),
    up: z.boolean(),
    floorBootId: z.string().min(1),
    hostBootId: z.string().min(1).optional(),
    /** the floor-held loopback listener's port: the serve's static route target */
    port: z.number().int().min(1).max(65535).optional(),
    /** the route target's path secret (`/f/<pathSecret>`) */
    pathSecret: z.string().min(1).optional(),
    /** what fieldd presents on the host's `/l/` door (FD1) */
    localSecret: z.string().min(1).optional(),
    /** the freeway key fieldd MACs a phone's approval with (hex, 32 bytes) */
    freewayKeyHex: z.string().min(1).optional(),
    keyGeneration: count().optional(),
    links: z.array(FreewayLinkRow),
  })
  .passthrough();
export type FreewayState = z.infer<typeof FreewayState>;

/** `native.freeway.revoke {clientId?}` — closes the matching phone links (all without one); the
 * host stops re-minting their keyrings and tells each cell `RevokeClient`. */
export const FreewayRevokeParams = z
  .object({ clientId: z.string().min(1).optional() })
  .passthrough();
export type FreewayRevokeParams = z.infer<typeof FreewayRevokeParams>;
export const FreewayRevokeResult = z.object({ closed: count() }).passthrough();
export type FreewayRevokeResult = z.infer<typeof FreewayRevokeResult>;

/** A join or leave the host reports (FW-L3: fieldd is the only audit writer). */
export const FreewayJoinRow = z
  .object({
    kind: z.enum(["joined", "left"]),
    clientId: z.string().min(1),
    sessionId: z.string().min(1),
    rights: sortedUniqueArray(SessionAttachRight),
    at: count(),
  })
  .passthrough();
export type FreewayJoinRow = z.infer<typeof FreewayJoinRow>;

/** `native.freeway.joins.subscribe` frames. While fieldd is away the floor holds up to
 * `FREEWAY.JOIN_BACKLOG_ROWS` and counts the rest in `dropped`, so the audit says how many it
 * lost and never pretends. */
export const FreewayJoinsFrame = z
  .object({ rows: z.array(FreewayJoinRow), dropped: count() })
  .passthrough();
export type FreewayJoinsFrame = z.infer<typeof FreewayJoinsFrame>;
