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

/** TC-D15 — one cell's row in the terminal route snapshot. TC-S2 has exactly
 * one; the vector IS the shape's future (K=2 class cells at TC-S3). The row
 * carries FULL dial coordinates including the token — the snapshot rides only
 * the paired mgmt channel, the same trust the hello ack's `terminal` field has
 * always carried (NF-D8). */
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
  })
  .passthrough();
export type TerminalRouteCell = z.infer<typeof TerminalRouteCell>;

/** TC-D15 — routes are revisioned STATE; notifications are hints. The floor
 * owns this snapshot; every reader re-reads on hint, on reconnect, and on
 * route errors — a missed edge is repaired by the next read. `revision` is
 * monotonic within a floor generation (pair with the hello's `bootId` to
 * order across floor restarts). Empty `cells` is an honest state (no cell
 * up), never an error. */
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
