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

export const HelloAck = z
  .object({
    contractsVersion: SemverString,
    serverKind: ServerKind,
    grantedScopes: z.array(z.string()),
    /** mgmt surface only (NF-D8); absent on every product-surface ack, and
     * absent until the terminal unit is up (tolerant readers treat absence as
     * "no terminal endpoints yet", never an error). */
    terminal: TerminalEndpoints.optional(),
    /** GT-2d — who actually answered. field-native outlives everything and is
     * adopted by design, so the floor a shell pairs with can be far older than
     * the tree that built it; this label is how that becomes visible instead of
     * being inferred from missing capabilities. Opaque provenance, never parsed
     * for behavior. Absence is itself the tell: a daemon predating GT-2d. */
    nativeBuild: z.string().optional(),
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
  | { kind: "local-token"; tokenId: string; scopes: string[] }
  | { kind: "shell-main"; tokenId: string; scopes: string[] }
  // deviceName/tailscaleId optional (C3): the sidecar proxy injects only
  // login/name/pic — absent transport facts stay absent, never empty-string
  // (node-id header injection is an upstream truffle petition).
  | { kind: "tailnet"; login: string; deviceName?: string; tailscaleId?: string }
  | { kind: "mcp-agent"; sessionId: string; scopes: string[] }
  | { kind: "peer-fieldd"; deviceId: string }
  | { kind: "plugin"; id: string; scopes: string[] }; // design-03 D20

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
