import { z } from "zod";
import { ErrorData } from "./errors";

// Envelope & transport conventions (design-01 §4).
// P3 — tolerant reader: every wire object is .passthrough(); receivers log unknown fields.

export const SemverString = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);

export const ClientKind = z.enum([
  "shell-main",
  "renderer",
  "plugin-worker",
  "ios",
  "peer-fieldd",
  "mcp-agent",
  "fieldd", // the mgmt channel's client (fieldd → field-native)
  "field-native",
  "debug",
]);
export type ClientKind = z.infer<typeof ClientKind>;

export const ServerKind = z.enum(["fieldd", "field-native"]);
export type ServerKind = z.infer<typeof ServerKind>;

/** D8 — per-boot pairing credential (mgmt-channel hello).
 * Canonical MAC message (pinned by fixtures/pairing.vector.json — NUL separators, ts as base-10 string):
 *   mac = hex(HMAC-SHA256(pairing_secret, "fn-boot" 0x00 bootId 0x00 String(ts)))
 * Verifier: |now − ts| ≤ 300s; a hello with a new bootId supersedes the paired client. */
export const PairingMac = z
  .object({
    bootId: z.string(),
    ts: z.number().int(),
    mac: z.string(),
    /** WIN-10 — the client's CHALLENGE, which the server answers with
     * `HelloAck.serverMac`. Hex, ≥16 bytes of randomness, fresh per connection.
     *
     * The MAC above proves the CLIENT holds the pairing secret. Nothing proved
     * the SERVER, and on unix nothing had to: the socket lived inside a 0700
     * run directory, so only the owner could have created the thing answering.
     * The Windows named-pipe namespace is FLAT and machine-wide (WIN-D1), so
     * that structural guarantee is gone — another local account can publish
     * `\\.\pipe\vibefield-<scope>-mgmt` before field-native does, and the scope
     * is a hash of a guessable data root, not a secret. A squatter that wins
     * that race is dialled by fieldd (the connect probe reads "alive", so no
     * real native is even spawned) and can answer with an ack of its choosing —
     * including `terminal` endpoints and an auth token fieldd would then use.
     * The nonce closes that: an answer is only trusted if it proves possession
     * of the same secret, over a value the client picked this connection. */
    nonce: z.string().optional(),
  })
  .passthrough();
export type PairingMac = z.infer<typeof PairingMac>;

/** Hello — first message on every duplex connection. Major mismatch → close INCOMPATIBLE; minor skew → P3. */
export const Hello = z
  .object({
    contractsVersion: SemverString,
    minCompatible: SemverString,
    clientKind: ClientKind,
    credential: z.union([z.string(), PairingMac]).optional(),
    /** C5/D32 — the peer-fieldd identity CLAIM: honored ONLY on the tailnet
     * door (provenance + WhoIs-verified same-user domain) and only as a LABEL —
     * the grant stays the D32 preset either way, so the claim cannot escalate.
     * Retires when the sidecar injects the node id (truffle petition). */
    deviceId: z.string().optional(),
    /** UA-2 — the client's EXPECTATION of which user this daemon serves.
     * Restrict-only, like clientKind: a configured daemon refuses a mismatch
     * the way it refuses a version mismatch (INCOMPATIBLE); the claim can
     * narrow a connection, never escalate one. */
    userId: z.string().optional(),
  })
  .passthrough();
export type Hello = z.infer<typeof Hello>;

/** NF-D8 — the terminal data-plane endpoints, carried ONLY on the mgmt-channel
 * hello ack (fieldd re-learns them at every re-pair). Socket paths are stable
 * across fieldd restarts (external-mode law); the token is minted per
 * field-native boot and lives nowhere but this ack and the tickets fieldd
 * mints from it — never env, config files, or logs. */
export const TerminalEndpoints = z
  .object({
    controlSocket: z.string(),
    frameSocket: z.string(),
    authToken: z.string(),
  })
  .passthrough();
export type TerminalEndpoints = z.infer<typeof TerminalEndpoints>;

const LOOPBACK_WS = /^wss?:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d{1,5})?(\/[^?#]*)?$/;

/** TPv3 (terminal-pipeline-v3 §8, T1) — the two loopback WebSocket doors of
 * ONE cell. Transport-private: the renderer's routed transport dials them, UI
 * never sees them. Tokens NEVER ride URLs (no query, no fragment) — authority
 * is the grant in the first frame. Lives here (not in terminal-pipeline.ts)
 * because the ROUTE ROW carries it from the floor to fieldd (TP-S3a). */
export const CellEndpointSet = z
  .object({
    controlUrl: z.string().regex(LOOPBACK_WS, "a loopback ws:// URL without query/fragment"),
    framesUrl: z.string().regex(LOOPBACK_WS, "a loopback ws:// URL without query/fragment"),
  })
  .passthrough();
export type CellEndpointSet = z.infer<typeof CellEndpointSet>;

/** TC-D4/TC-D6(c) — the two workload classes. Class is a PLACEMENT HINT and a
 * policy selector (scrollback caps), never a permanent failure domain. One
 * authority for both planes: the route snapshot, the observed inventory's
 * `cell` tag, and `terminal.create` all spell it from here. */
export const TerminalWorkloadClass = z.enum(["agent", "interactive"]);
export type TerminalWorkloadClass = z.infer<typeof TerminalWorkloadClass>;

/** TC-S3 — what a cell is FOR. `class` = the shared per-class host; `solo` = a
 * spawn-isolation host born under an intensity breach with an Exact offender
 * (TC-D4): it takes one session so a recurring poison workload can only crash
 * itself. Solo cells are the S3 interim; TC-S6's quarantine MIGRATION replaces
 * them. */
export const TerminalCellRole = z.enum(["class", "solo"]);
export type TerminalCellRole = z.infer<typeof TerminalCellRole>;

/** TC-D15 — one cell's row in the terminal route snapshot. TC-S2 had exactly
 * one; TC-S3 carries one per class (agents | interactive) plus any solo
 * isolation hosts. The row carries FULL dial coordinates including the token —
 * the snapshot rides only the paired mgmt channel, the same trust the hello
 * ack's `terminal` field has always carried (NF-D8). */
export const TerminalRouteCell = z
  .object({
    /** the floor supervisor's spawn ordinal — 1-based, monotonic within a
     * floor boot; also the suffix in the cell's per-instance socket names
     * (`termctl.<n>.sock`), which is what makes a restart NEVER a rebind:
     * fresh names sidestep both the stale-unlink hazard (ADOPT-1's law) and
     * win32's first-pipe-instance hold. */
    cellInstanceId: z.number().int(),
    /** the cell process's own boot identity, minted per start. THE identity —
     * pids recycle, ordinals repeat across floor boots; this never does. */
    cellBootId: z.string(),
    /** the cell's OS pid — diagnostics and kill-matrix targeting, never
     * authority. */
    pid: z.number().int(),
    endpoints: TerminalEndpoints,
    /** increments at every token mint (== every cell start today). Names the
     * ordering key `authToken` was accidentally serving as (GT-5b's rotation
     * checks keyed on the token value; a generation is comparable). */
    tokenGeneration: z.number().int(),
    /** TP-S1 (terminal-pipeline-v3 §5.1) — the per-cell-boot GRANT KEY: 32
     * random bytes, hex, minted by the floor at every cell start beside the
     * token; the HMAC-SHA256 key under every TPv3 grant fieldd issues for this
     * cell (`kid = {cellBootId, grantKeyGeneration}`). Same custody as
     * `authToken` (NF-D8/EL7: the paired mgmt channel only — never env, disk
     * or logs). ABSENT on a pre-TP floor and on the in-process serve; a reader
     * without it mints NO grants (the honest answer), never a half ticket. */
    grantKey: z.string().optional(),
    /** `kid.keyGeneration` — 1 per cell boot today; rotation = a new boot. */
    grantKeyGeneration: z.number().int().optional(),
    /** TP-S3a (terminal-pipeline-v3 §8, TP-D26) — the cell's two T1 loopback
     * WebSocket doors, reported in its hello once it serves them. ABSENT when
     * the cell has no grant key (a pre-TP floor, the in-process serve) or
     * predates the door layer; fieldd carries them into
     * `TerminalOpenTicket.endpoints` and nothing else reads them (transport-
     * private — never UI). */
    doors: CellEndpointSet.optional(),
    /** TC-S3 — which class this cell hosts. ABSENT = a pre-TC-S3 single-cell
     * floor (every class lands there); tolerant readers route accordingly. */
    workloadClass: TerminalWorkloadClass.optional(),
    /** TC-S3 — `class` (shared host, the default reading of absence) or
     * `solo` (a spawn-isolation host; takes exactly one session). */
    role: TerminalCellRole.optional(),
  })
  .passthrough();
export type TerminalRouteCell = z.infer<typeof TerminalRouteCell>;

/** TC-D15 — routes are revisioned STATE; notifications are hints. The floor
 * owns this snapshot; every reader re-reads on hint, on reconnect, and on
 * route errors — a missed edge is repaired by the next read. `revision` is
 * monotonic within a floor generation (pair with the hello's `bootId` to
 * order across floor restarts). Empty `cells` is an honest state (no cell
 * up), never an error.
 *
 * TC-S3 — the CREATE-TARGET discipline, derivable from any snapshot alone
 * (no extra verb): a class's create target is its `role:"class"` row when
 * one is present, else its HIGHEST-instance `role:"solo"` row (the floor
 * spawns a fresh empty solo the moment the previous one takes a session, so
 * the newest solo is the empty one; at the solo cap the newest stays target
 * as the honest overflow). Rows that are not the target still serve their
 * EXISTING sessions — ticket routing for a session goes through its
 * inventory `cell` tag to that cell's row, never through the target rule. */
export const TerminalRouteSnapshot = z
  .object({
    revision: z.number().int(),
    cells: z.array(TerminalRouteCell),
  })
  .passthrough();
export type TerminalRouteSnapshot = z.infer<typeof TerminalRouteSnapshot>;

export const HelloAck = z
  .object({
    contractsVersion: SemverString,
    serverKind: ServerKind,
    grantedScopes: z.array(z.string()),
    /** mgmt surface only (NF-D8); absent on every product-surface ack, and
     * absent until the terminal unit is up (tolerant readers treat absence as
     * "no terminal endpoints yet", never an error). Since TC-S2 this is the
     * LEGACY single-cell mirror of `terminalRoutes` — kept in lockstep by the
     * floor so pre-routes readers keep working; new readers prefer the
     * snapshot. */
    terminal: TerminalEndpoints.optional(),
    /** TC-D15 (TC-S2+): the revisioned route snapshot at pairing time. The
     * hello delivers the CURRENT state; subsequent changes ride
     * `native.lifecycle.terminal.routes.subscribe` deltas — each delta is the
     * FULL snapshot, so a missed edge is repaired by the next one. Absent
     * from a pre-TC-S2 floor (tolerant readers fall back to `terminal`). */
    terminalRoutes: TerminalRouteSnapshot.optional(),
    /** GT-2d — who actually answered. field-native outlives everything and is
     * adopted by design, so the floor a shell pairs with can be far older than
     * the tree that built it; this label is how that becomes visible instead of
     * being inferred from missing capabilities. Opaque provenance, never parsed
     * for behavior. Absence is itself the tell: a daemon predating GT-2d. */
    nativeBuild: z.string().optional(),
    /** UA-2 — the SERVER's assertion of which user this pair serves. null =
     * unconfigured (embedded/unit daemons); absent = a pre-UA-2 daemon.
     * Display + verification truth; never a grant. */
    userId: z.string().nullable().optional(),
    /** WIN-10 — the server's proof that it holds the pairing secret, answering
     * `PairingMac.nonce`:
     *   serverMac = hex(HMAC-SHA256(pairing_secret, "fn-ack" 0x00 nonce 0x00 bootId))
     * A different context string from the client's MAC ("fn-boot"), so neither
     * direction's transcript can ever be replayed as the other's.
     *
     * OPTIONAL on the wire and MANDATORY in the client, deliberately, and the
     * asymmetry is the whole design: a server that was sent no nonce cannot
     * compute one, so an OLD field-native answering a NEW fieldd omits it — and
     * a client that sent a nonce REFUSES an ack without a valid proof rather
     * than accepting the downgrade an attacker would otherwise just ask for.
     * The cost is honest and bounded: a field-native predating this field must
     * be restarted once before a newer fieldd will pair with it, which is a
     * pair bounce, and the refusal says so. */
    serverMac: z.string().optional(),
  })
  .passthrough();
export type HelloAck = z.infer<typeof HelloAck>;

// ---- JSON-RPC 2.0 ----
export const RpcId = z.union([z.string(), z.number().int()]);
export type RpcId = z.infer<typeof RpcId>;

export const RpcRequest = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: RpcId,
    method: z.string(),
    params: z.unknown().optional(),
  })
  .passthrough();
export type RpcRequest = z.infer<typeof RpcRequest>;

export const RpcNotification = z
  .object({
    jsonrpc: z.literal("2.0"),
    method: z.string(),
    params: z.unknown().optional(),
  })
  .passthrough();
export type RpcNotification = z.infer<typeof RpcNotification>;

export const RpcError = z
  .object({
    code: z.number().int(),
    message: z.string(),
    data: ErrorData.optional(),
  })
  .passthrough();
export type RpcError = z.infer<typeof RpcError>;

/** A response carries exactly one of result | error (JSON-RPC 2.0). Failure listed first so
 * a malformed both-present object resolves to the error reading. */
export const RpcFailure = z
  .object({ jsonrpc: z.literal("2.0"), id: RpcId, error: RpcError })
  .passthrough();
export const RpcSuccess = z
  .object({ jsonrpc: z.literal("2.0"), id: RpcId, result: z.unknown() })
  .passthrough();
export const RpcResponse = z.union([RpcFailure, RpcSuccess]);
export type RpcResponse = z.infer<typeof RpcResponse>;

// ---- Subscriptions (P5 — snapshot-then-delta; server may re-snapshot at will) ----
export const SubscribeResult = z.object({ subId: z.string(), snapshot: z.unknown() }).passthrough();
export type SubscribeResult = z.infer<typeof SubscribeResult>;

export const SubEvent = z.object({ subId: z.string(), payload: z.unknown() }).passthrough();
export type SubEvent = z.infer<typeof SubEvent>;

export const Unsubscribe = z.object({ subId: z.string() }).passthrough();
export type Unsubscribe = z.infer<typeof Unsubscribe>;

// ---- CallerContext (P6 — server-side ONLY; identity is transport-derived, never on the wire) ----
export type Principal =
  | {
      kind: "local-token";
      tokenId: string;
      scopes: string[];
      /** PRC-D14 — present only on a shell-minted renderer window grant.
       * Server-derived from the bearer record, never from request params. */
      rendererParticipant?: import("./shell").RendererParticipantIdentity;
    }
  | { kind: "shell-main"; tokenId: string; scopes: string[] }
  // deviceName/tailscaleId optional (C3): the sidecar proxy injects only
  // login/name/pic — absent transport facts stay absent, never empty-string
  // (node-id header injection is an upstream truffle petition). `self` is the
  // UA-4 door verdict (spec §7.3): true = the peer's login matched this
  // user's stored link at hello; ABSENT = pre-capture era (no stored login to
  // compare against) — never false, a mismatch mints tailnet-guest instead.
  | { kind: "tailnet"; login: string; deviceName?: string; tailscaleId?: string; self?: boolean }
  // UA-4 (spec §7.3, UA-D5): a WhoIs-verified tailnet peer whose login does
  // NOT match the stored link — empty scope grant, only guestOk methods
  // answer. The polite door: an honest "no access", never a socket slam.
  | { kind: "tailnet-guest"; login: string }
  | { kind: "mcp-agent"; sessionId: string; scopes: string[] }
  | { kind: "peer-fieldd"; deviceId: string }
  | { kind: "plugin"; id: string; scopes: string[]; tokenId?: string }; // design-03 D20

export type Transport =
  | "uds"
  | "ws-loopback" // D27
  | "ws-tailnet"
  | "inproc-port" // plugin workers
  | "mcp"
  | "http";

export interface CallerContext {
  principal: Principal;
  transport: Transport;
  receivedAt: number;
  /** the hello's self-declared client kind (P3b — the §11.2 principal-kind
   * gate reads it; a CLAIM, so it may only ever RESTRICT, never grant). Absent
   * on tailnet/peer principals — those doors never carry local client kinds. */
  clientKind?: ClientKind;
  /** Server-side call lifetime. ProductAPI aborts it when the owning transport
   * closes; providers use it only for best-effort cancellation. */
  signal?: AbortSignal;
}
