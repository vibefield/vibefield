import { z } from "zod";
import { ClientKind } from "./envelope";
import { ErrorKind } from "./errors";

// DS-L7 / DS-D15 — a forwarded call is AUTHORIZED as the peer daemon that
// carries it and RECORDED as the window or phone it is for (design-06 §5;
// `thinking-desktop-sync-plane.md` §6.1, ruled 2026-09-30). When a daemon
// forwards a product call to the device that owns the thing (design-04 §6's
// `device?` convention), it adds `onBehalfOf` — who asked — and, on a
// mutation, an `idempotencyKey` bound to a RECEIPT the owner journals. The
// owner still mints rights from ITS OWN rule (the principal is the peer
// daemon, transport-derived once E1 lands); `onBehalfOf` widens nothing — it
// is provenance for the audit row, which names the calling node and the
// window behind it, so the ledger stops reading two devices as one. (Its
// ABSENCE narrows, since 2026-10-01: a peer daemon that forwards for no one is
// minted `[read]` at a terminal door — `terminal-grants.ts` `rightsFor`.)

/** Who a forwarded call is for. Every field is what the FORWARDING daemon
 * knows about its own client, restated; the owner records it and never
 * trusts it for authority. */
export const OnBehalfOf = z
  .object({
    clientKind: ClientKind,
    /** The forwarding daemon's device (the caller's home). */
    deviceId: z.string().min(1),
    /** The window or phone connection behind the call, when the forwarding
     * daemon can name one. Opaque; the owner writes it into the audit row. */
    windowId: z.string().min(1).optional(),
    /** The forwarding daemon's user, for the ledger; the owner compares its
     * OWN login against the transport, never this. */
    userId: z.string().min(1).optional(),
  })
  .passthrough();
export type OnBehalfOf = z.infer<typeof OnBehalfOf>;

/** A caller-minted key for a forwarded MUTATION. The same key with the same
 * method on the same owner applies once; a retry with it reads the receipt. */
export const IdempotencyKey = z.string().min(8).max(128);
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

/** The three honest outcomes of a forwarded mutation. `outcome-unknown` is
 * the state a call lost IN FLIGHT leaves behind — the forward was cut before
 * an answer — and it is a state the UI shows, never a guess either way; the
 * retry with the same key resolves it to `applied` or `refused`. */
export const ForwardReceiptState = z.enum(["applied", "refused", "outcome-unknown"]);
export type ForwardReceiptState = z.infer<typeof ForwardReceiptState>;

/** What the owner journals per idempotency key, and what a retry reads. */
export const ForwardReceipt = z
  .object({
    idempotencyKey: IdempotencyKey,
    method: z.string().min(1),
    /** The owning device (where it applied). */
    device: z.string().min(1),
    state: ForwardReceiptState,
    /** epoch ms, the owner's clock */
    at: z.number().int().nonnegative(),
    /** Set when `state` is `refused`: the owner's own error kind. */
    error: ErrorKind.optional(),
    onBehalfOf: OnBehalfOf.optional(),
  })
  .passthrough();
export type ForwardReceipt = z.infer<typeof ForwardReceipt>;

/** The two members of the forwarding envelope (`ForwardEnvelope.forward`). */
export const Forwarding = z
  .object({
    onBehalfOf: OnBehalfOf.optional(),
    idempotencyKey: IdempotencyKey.optional(),
  })
  .passthrough();
export type Forwarding = z.infer<typeof Forwarding>;

/** The envelope a forwarded call's params carry beside the method's own:
 * ONE member, `forward`, holding `onBehalfOf` and a mutation's
 * `idempotencyKey`. Parsed with `.passthrough()` so a method's own params ride
 * along untouched. A caller that is not a peer daemon carrying `onBehalfOf` is
 * refused (provenance is the peer link's to add, never a window's — DS-L7).
 *
 * NAMESPACED 2026-09-30 (ds-b's finding, the lead's ruling): the members used
 * to sit flat beside the params, and the flat `idempotencyKey` collided with
 * the method-level retry keys three LOCAL doors own (`surface.open`,
 * `artifact.publish`, `artifact.update`) — a door that read the envelope off
 * every call would have eaten them. Under `forward` no method param can
 * collide. `OnBehalfOf`, `IdempotencyKey` and `ForwardReceipt` are unchanged. */
export const ForwardEnvelope = z
  .object({
    forward: Forwarding.optional(),
  })
  .passthrough();
export type ForwardEnvelope = z.infer<typeof ForwardEnvelope>;
