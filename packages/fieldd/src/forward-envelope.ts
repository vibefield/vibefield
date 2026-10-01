import { type CallerContext, type ForwardedFor, IdempotencyKey } from "@vibefield/contracts";
import { RpcCallError } from "./native-link";

// DS-L7 / DS-D15 (2026-09-30) — the forwarding envelope, both directions.
//
// A call a daemon FORWARDS to the device that owns the thing (design-04 §6's
// `device?` convention) carries ONE member beside the method's own params
// (`forwarding.ts` ForwardEnvelope): `forward`, holding `onBehalfOf` — who the
// call is for — and, on a mutation, an `idempotencyKey` bound to the owner's
// receipt journal (`forward-receipts.ts`). The owner AUTHORIZES the call as
// the peer daemon that carried it and RECORDS it as the window or phone
// behind it; the envelope never widens anything.
//
// Namespaced under `forward` (2026-09-30): the members first sat flat beside
// the params, and a flat `idempotencyKey` collided with the method-level retry
// keys three local doors own (surface.open, artifact.publish/update).
//
// This module is the envelope's only reader and writer: the door splits it off
// a peer's params and reads it tolerantly (`readPeerEnvelope`), the routing hop
// builds `onBehalfOf` from the CALLING context — never from the call's params —
// (`forwardProvenance`), and PeerLink puts it on the wire (`withEnvelope`).

/** The envelope's one member, by its wire name. */
export const FORWARD_MEMBER = "forward";

/** What a forwarding hop adds to a call before it leaves this daemon. */
export interface OutboundEnvelope {
  onBehalfOf?: ForwardedFor;
  idempotencyKey?: string;
}

/** Bounds a restated identity must fit so it always fits an audit record
 * (`AuditOnBehalfOfV1`: clientKind ≤ 64, the ids ≤ LogBoundedIdentityV1). */
const CLIENT_KIND_MAX = 64;
const IDENTITY_MAX = 256;

export interface SplitEnvelope {
  /** true when the params carry the `forward` member at all (the refusal's
   * trigger for a caller that is not a peer daemon) */
  carried: boolean;
  /** `forward` is present but not an object — nothing in it can be read */
  malformed: boolean;
  hasOnBehalfOf: boolean;
  hasIdempotencyKey: boolean;
  rawOnBehalfOf: unknown;
  rawIdempotencyKey: unknown;
  /** the params with `forward` removed (the method's own params) */
  rest: unknown;
}

const NOT_CARRIED = {
  carried: false,
  malformed: false,
  hasOnBehalfOf: false,
  hasIdempotencyKey: false,
  rawOnBehalfOf: undefined,
  rawIdempotencyKey: undefined,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Split the envelope off a call's params. Non-object params carry none (a
 * JSON-RPC params value that is not an object has no members), and a method's
 * own params — an `idempotencyKey` of its own included — are never touched. */
export function splitForwardEnvelope(params: unknown): SplitEnvelope {
  if (!isRecord(params) || !Object.hasOwn(params, FORWARD_MEMBER))
    return { ...NOT_CARRIED, rest: params };
  const { [FORWARD_MEMBER]: forward, ...rest } = params;
  if (!isRecord(forward)) return { ...NOT_CARRIED, carried: true, malformed: true, rest };
  return {
    carried: true,
    malformed: false,
    hasOnBehalfOf: Object.hasOwn(forward, "onBehalfOf"),
    hasIdempotencyKey: Object.hasOwn(forward, "idempotencyKey"),
    rawOnBehalfOf: forward["onBehalfOf"],
    rawIdempotencyKey: forward["idempotencyKey"],
    rest,
  };
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

/** Read `onBehalfOf` TOLERANTLY: the four members, each a bounded string;
 * unknown members are ignored (a newer peer may add some), and a client kind
 * this build does not know is kept as the string it is. `deviceId` and
 * `clientKind` are required — a restatement without them names no one. */
export function readOnBehalfOf(raw: unknown): ForwardedFor | undefined {
  if (!isRecord(raw)) return undefined;
  const clientKind = boundedString(raw["clientKind"], CLIENT_KIND_MAX);
  const deviceId = boundedString(raw["deviceId"], IDENTITY_MAX);
  if (clientKind === undefined || deviceId === undefined) return undefined;
  const out: ForwardedFor = { clientKind, deviceId };
  if (raw["windowId"] !== undefined) {
    const windowId = boundedString(raw["windowId"], IDENTITY_MAX);
    if (windowId === undefined) return undefined;
    out.windowId = windowId;
  }
  if (raw["userId"] !== undefined) {
    const userId = boundedString(raw["userId"], IDENTITY_MAX);
    if (userId === undefined) return undefined;
    out.userId = userId;
  }
  return out;
}

export type PeerEnvelope =
  | { ok: true; onBehalfOf?: ForwardedFor; idempotencyKey?: string }
  | { ok: false; reason: string };

/** A PEER's envelope, as the door honours it. The key is read strictly — it is
 * safety-critical, and a key the owner cannot journal must not silently turn a
 * retry into a second application — and `onBehalfOf` tolerantly (above);
 * members `forward` does not know are ignored. A member present but unreadable
 * is refused: the peer is our own daemon, so a malformed envelope is a bug to
 * surface, not provenance to guess. */
export function readPeerEnvelope(split: SplitEnvelope): PeerEnvelope {
  if (split.malformed) return { ok: false, reason: "malformed forward" };
  let onBehalfOf: ForwardedFor | undefined;
  if (split.hasOnBehalfOf) {
    onBehalfOf = readOnBehalfOf(split.rawOnBehalfOf);
    if (onBehalfOf === undefined) return { ok: false, reason: "malformed onBehalfOf" };
  }
  let idempotencyKey: string | undefined;
  if (split.hasIdempotencyKey) {
    const parsed = IdempotencyKey.safeParse(split.rawIdempotencyKey);
    if (!parsed.success) return { ok: false, reason: "malformed idempotencyKey" };
    idempotencyKey = parsed.data;
  }
  return {
    ok: true,
    ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  };
}

/** The refusal a caller that is NOT a peer daemon gets for carrying the
 * envelope (DS-L7: provenance is the peer link's to add, never a window's). */
export function nonPeerEnvelopeRefusal(method: string): RpcCallError {
  return new RpcCallError("PRECONDITION_FAILED", "forwarding envelope from a non-peer", false, {
    method,
    reason: "forwarding envelope from a non-peer",
  });
}

function fallbackClientKind(ctx: CallerContext): string {
  switch (ctx.principal.kind) {
    case "shell-main":
      return "shell-main";
    case "plugin":
      return "plugin-worker";
    case "mcp-agent":
      return "mcp-agent";
    case "peer-fieldd":
      return "peer-fieldd";
    default:
      return "debug";
  }
}

/** Who a call is for, when THIS daemon forwards it — built from the calling
 * context, never from the call's params (DS-L7). A peer's own call being
 * forwarded again restates what that peer said (a relay adds no identity). The
 * window is the renderer participant when the grant names one (stable for one
 * BrowserWindow within a shell boot), else the product connection's own id. */
export function forwardProvenance(
  ctx: CallerContext,
  self: { deviceId: string; userId?: string | undefined },
): ForwardedFor {
  if (ctx.onBehalfOf !== undefined) return ctx.onBehalfOf;
  const clientKind = ctx.clientKind ?? ctx.connection?.helloClientKind ?? fallbackClientKind(ctx);
  const participant =
    ctx.principal.kind === "local-token" ? ctx.principal.rendererParticipant : undefined;
  const windowId = participant?.participantId ?? ctx.connection?.id;
  return {
    clientKind,
    deviceId: self.deviceId,
    ...(windowId !== undefined ? { windowId } : {}),
    ...(self.userId !== undefined ? { userId: self.userId } : {}),
  };
}

/** Put an envelope on a forwarded call's params (PeerLink's half): ONE
 * `forward` member beside the method's own. Params that are not an object
 * cannot carry it (every product method's params are an object — this refuses
 * a routing bug rather than dropping provenance silently). */
export function withEnvelope(params: unknown, envelope: OutboundEnvelope | undefined): unknown {
  if (envelope === undefined) return params;
  const forward: Record<string, unknown> = {};
  if (envelope.onBehalfOf !== undefined) forward["onBehalfOf"] = envelope.onBehalfOf;
  if (envelope.idempotencyKey !== undefined) forward["idempotencyKey"] = envelope.idempotencyKey;
  if (Object.keys(forward).length === 0) return params;
  if (params === undefined || params === null) return { [FORWARD_MEMBER]: forward };
  if (!isRecord(params))
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      "a forwarded call's params must be an object to carry the forwarding envelope",
      false,
    );
  return { ...params, [FORWARD_MEMBER]: forward };
}
