import { EventEmitter } from "node:events";
import { FORWARDING } from "@vibefield/contracts";
import { FielddClient, FielddRpcError, type WsCtor } from "@vibefield/fieldd-client";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { type EgressPath, egressWebSocket } from "./egress";
import { type OutboundEnvelope, withEnvelope } from "./forward-envelope";
import { CallerForwardJournal, forwardDigest } from "./forward-receipts";
import { RpcCallError } from "./native-link";

// PeerLink (design-04 §3.2, D32 — C5 P1 core): fieldd⇄fieldd connections, the
// substrate every federated call rides. The dial side IS FielddClient — a
// peer's product surface speaks our own hello protocol behind its tailnet
// door; the door grants the D32 preset from WhoIs, so the dial carries NO
// token, just the peer-fieldd deviceId claim (a label — see product-api's door
// comment). In production the dialer sets no identity headers (the PEER's
// sidecar injects them on arrival); tests inject a ws-ctor that plays the
// sidecar. Endpoint truth is the peer's `field.devices.v1` slice (the store,
// per D32's layering note — read through DeviceService's parsed roster to
// avoid a second store subscription).
//
// UA-P-0e (D2, 2026-09-15) — THE ENDPOINT IS DERIVED NOW, NOT PUBLISHED. With
// nothing content-bearing on the bus there is no peer slice to read a URL out
// of, so the roster's `productEndpoint.url` is a LOCATOR this device computed:
// the peer's authenticated MagicDNS name (from the tailnet's WhoIs, never from
// anything the peer said) plus the registry's product serve port. This file is
// unchanged by that — it still asks the roster for a peer's endpoint — but the
// change closes a redirect primitive that was real: a spoofed slice could name
// any `productEndpoint.url` and `endpointFor` would dial it. And the roster is
// the SELF-PEER SET, so `endpointFor` can only answer for a peer whose WhoIs
// login is this account's.
//
// One OUTBOUND connection per peer, dial-on-demand, idle-close (5min), per-call
// deadline (8s). Failure honesty: no endpoint → UNAVAILABLE {device,
// state:"offline"}; transport failure/timeout → the link drops (next call
// re-dials) and UNAVAILABLE {device, state:"unreachable"}; a hello
// INCOMPATIBLE pins the peer incompatible (refuse fast — D32; clears on
// restart, ledgered) — while the REMOTE's genuine replies (FORBIDDEN_SCOPE,
// NOT_FOUND, …) pass through untouched: a forwarded call's answer is the
// peer's answer. Deferred inside D32 (thinking-c5): inbound/outbound dedup by
// lower-deviceId-wins, the federated subscription manager, idempotencyKey (all
// P2 or first-mutation gated).
//
// DS-2 (2026-09-30): the idempotencyKey half is built. A forwarded call carries
// the forwarding envelope beside its params (`onBehalfOf`, and a mutation's
// key — forward-envelope.ts); a keyed forward is journaled in `receipts`
// (forward-receipts.ts), and one that left without an answer reads
// `outcome-unknown` rather than a plain failure. A reply the peer's door SENT
// is its answer whatever its kind — only the client's own transport failures
// drop the link.

export type PeerLinkState = "dialing" | "connected" | "incompatible";

/** DS-L8 — what a peer's DOOR last told this daemon (`PeerLink.doorState`). */
export type PeerDoorState = "answers" | "silent" | "incompatible";

/** A standing upstream subscription on a peer link (C6-5/D35). */
export interface PeerSubscription {
  snapshot: unknown;
  unsubscribe: () => void;
}

export interface PeerLinkOptions {
  ownDeviceId: () => string;
  /** the peer's capability URL from its slice, or undefined = unpublished/offline */
  endpointFor: (deviceId: string) => string | undefined;
  /** C5 test seam: a ws-ctor that plays the sidecar. When set it IS the dial,
   * and `egress` is not consulted. */
  webSocket?: WsCtor;
  /** DS-1 — how a dial reaches the tailnet, asked ONCE PER DIAL
   * (`resolveEgressPath` over the floor's `native.mesh.egress.proxy`): the
   * node's own SOCKS5 when the floor has egress, which makes the peer's
   * sidecar see THIS desktop's node; else the OS network, today's dial,
   * said once per link (`fieldd.mesh.egress.fallback_os_network`). A dial
   * through the node that fails is never retried over the OS network.
   * Absent = today's dial, unannounced. */
  egress?: () => Promise<EgressPath>;
  logger?: Logger;
  idleCloseMs?: number;
  callTimeoutMs?: number;
  /** DS-2 — the deadline of a KEYED forwarded mutation, after which a sent
   * forward reads `outcome-unknown` (default FORWARDING.FORWARD_TIMEOUT_MS) */
  forwardTimeoutMs?: number;
  now?: () => number;
}

/** A reply the peer's DOOR sent: the client builds it from a JSON-RPC error
 * frame, which always carries a code. The client's own transport failures
 * ("connection closed", "not connected", a dead client) never do. */
function isRemoteAnswer(e: unknown): boolean {
  return e instanceof FielddRpcError && e.code !== undefined;
}

/** The one transport failure that PROVES a request never left: the client had
 * no socket to send it on. */
function isNeverSent(e: unknown): boolean {
  return (
    e instanceof FielddRpcError &&
    e.code === undefined &&
    e.kind === "UNAVAILABLE" &&
    e.message === "not connected"
  );
}

interface Link {
  client: FielddClient;
  state: PeerLinkState;
  lastUsed: number;
  /** live upstream subscriptions riding this link (C6-5): each holds the
   * client-side unsubscribe plus the owner's link-death callback. A link with
   * members is PINNED against the idle sweep — quiet is not the same as
   * unused when a subscription is standing on it. */
  subs: Set<{ unsubscribe: () => void; onDrop: () => void }>;
  /** DS-2 — requests and subscribes in flight on this link (absent = none).
   * A link with one in flight is IN USE: the idle sweep used to drop a link
   * whose dial or answer outlasted the idle window — a cut it then reported as
   * the peer's silence, and for a keyed mutation an outcome-unknown of our
   * own making. */
  inflight?: number;
}

/** http(s) capability URL → the ws(s) dial URL (already-ws passes through). */
function toWsUrl(url: string): string {
  if (url.startsWith("http://")) return `ws://${url.slice("http://".length)}`;
  if (url.startsWith("https://")) return `wss://${url.slice("https://".length)}`;
  return url;
}

export class PeerLink extends EventEmitter {
  private links = new Map<string, Link>();
  /** refuse-fast set (D32): a major-mismatch peer stays pinned until restart */
  private incompatible = new Set<string>();
  private readonly now: () => number;
  private readonly idleCloseMs: number;
  private readonly callTimeoutMs: number;
  private sweeper: ReturnType<typeof setInterval>;
  private disposed = false;
  /** DS-2 — this daemon's own keyed forwards: in flight, applied, refused, or
   * `outcome-unknown` (sent, answer lost). `forward.receipt` reads it. */
  readonly receipts = new CallerForwardJournal({ now: () => this.now() });
  /** DS-L8 — peers whose door the last attempt found silent (a dial or a
   * forward that failed at the transport), with when; cleared the moment the
   * door answers anything. The roster reads it through `doorState`. */
  private readonly silentSince = new Map<string, number>();
  private readonly logger: Logger;

  constructor(private readonly opts: PeerLinkOptions) {
    super();
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? Date.now;
    this.idleCloseMs = opts.idleCloseMs ?? 300_000;
    this.callTimeoutMs = opts.callTimeoutMs ?? 8_000;
    this.sweeper = setInterval(() => this.sweepIdle(), Math.min(this.idleCloseMs, 60_000));
    this.sweeper.unref?.();
  }

  /** Forward one call to a peer. Throws RpcCallError shapes ProductApi maps
   * straight back to the original caller. DS-L7/DS-D15 — `envelope` rides
   * beside the method's params (`onBehalfOf`, and a mutation's
   * `idempotencyKey`); the peer's door strips and records it. */
  async request(
    deviceId: string,
    method: string,
    params: unknown,
    envelope?: OutboundEnvelope,
  ): Promise<unknown> {
    if (this.disposed) throw new RpcCallError("UNAVAILABLE", "peer link disposed", false);
    if (deviceId === this.opts.ownDeviceId())
      throw new RpcCallError("PRECONDITION_FAILED", "device is self — routing bug", false);
    if (this.incompatible.has(deviceId))
      throw new RpcCallError("INCOMPATIBLE", "peer contracts major mismatch", false, {
        device: deviceId,
      });
    const key = envelope?.idempotencyKey;
    if (envelope !== undefined && key !== undefined)
      return await this.requestKeyed(deviceId, method, params, envelope, key);
    const wire = withEnvelope(params, envelope);
    const link = this.ensureLink(deviceId);
    this.useLink(link);
    try {
      const result = await this.withDeadline(link.client.request(method, wire), deviceId);
      this.markAnswered(deviceId);
      return result;
    } catch (e) {
      throw this.mapPeerError(e, deviceId);
    } finally {
      this.releaseLink(link);
    }
  }

  /** DS-2 — a keyed forwarded MUTATION. The receipt journal hears how the
   * attempt ended: a result (`applied`), the owner's own refusal (`refused`),
   * or — when the request LEFT and no answer came back, the link cut or the
   * FORWARD_TIMEOUT_MS deadline passed — `outcome-unknown`, surfaced as
   * UNAVAILABLE {device, state: "outcome-unknown", idempotencyKey}: never
   * success, never a plain failure. An attempt that never left (no endpoint,
   * the dial failed before the link was ready) is forgotten — nothing reached
   * the owner. The retry is the same call with the same key; the owner answers
   * it from its own receipt, so it applies once. */
  private async requestKeyed(
    deviceId: string,
    method: string,
    params: unknown,
    envelope: OutboundEnvelope,
    key: string,
  ): Promise<unknown> {
    const wire = withEnvelope(params, envelope);
    const attempt = this.receipts.begin(key, {
      device: deviceId,
      method,
      digest: forwardDigest(params),
      ...(envelope.onBehalfOf !== undefined ? { onBehalfOf: envelope.onBehalfOf } : {}),
    });
    let sent = false;
    let link: Link | undefined;
    try {
      link = this.ensureLink(deviceId);
      this.useLink(link);
      const held = link;
      const result = await this.withDeadline(
        (async () => {
          await held.client.ready();
          // from here the request is on the wire within the same microtask
          // chain — the deadline (a timer) cannot fall between the two
          sent = true;
          attempt.sent();
          return await held.client.request(method, wire);
        })(),
        deviceId,
        this.opts.forwardTimeoutMs ?? FORWARDING.FORWARD_TIMEOUT_MS,
      );
      attempt.applied();
      this.markAnswered(deviceId);
      return result;
    } catch (e) {
      const mapped = this.mapPeerError(e, deviceId);
      if (!sent || isNeverSent(e)) {
        attempt.unsent();
        throw mapped;
      }
      if (isRemoteAnswer(e)) {
        attempt.refused(mapped.kind);
        throw mapped;
      }
      attempt.lost();
      throw new RpcCallError(
        "UNAVAILABLE",
        "the forward was cut before an answer; its outcome is unknown",
        true,
        { device: deviceId, state: "outcome-unknown", idempotencyKey: key },
      );
    } finally {
      if (link !== undefined) this.releaseLink(link);
    }
  }

  /** One failure law for request AND subscribe: an incompatible peer pins
   * (refuse fast, D32), a transport-class failure drops the link so the next
   * call re-dials, and the REMOTE's genuine replies (scope refusal, not-found,
   * …) pass through untouched — a forwarded call's answer is the peer's
   * answer. Already-mapped errors (the deadline path) pass straight through. */
  private mapPeerError(e: unknown, deviceId: string): RpcCallError {
    if (e instanceof RpcCallError) return e;
    // DS-L8 — a pin that landed WHILE this call waited is its answer. The
    // client's status listener pins the peer and closes the client before the
    // call's own ready-waiter hears the hello's INCOMPATIBLE, so that waiter
    // sees "client closed" — which used to read the first call to a skewed
    // peer as "unreachable" (and now would mark its door silent).
    if (this.incompatible.has(deviceId))
      return new RpcCallError("INCOMPATIBLE", "peer contracts major mismatch", false, {
        device: deviceId,
      });
    if (e instanceof FielddRpcError) {
      if (e.kind === "INCOMPATIBLE") {
        this.pinIncompatible(deviceId);
        return new RpcCallError("INCOMPATIBLE", "peer contracts major mismatch", false, {
          device: deviceId,
        });
      }
      // DS-2 — a reply the peer's DOOR sent is the peer's answer, whatever its
      // kind: an owner saying UNAVAILABLE {service, state} about its OWN
      // dependency answered, and the link is fine. Only the client's own
      // transport failures (no JSON-RPC code) mean the peer did not answer.
      // (This used to drop the link and rewrite the owner's honest state as
      // "unreachable".)
      if (isRemoteAnswer(e)) {
        this.markAnswered(deviceId);
        return new RpcCallError(e.kind as never, e.message, e.retryable, e.details);
      }
      if (e.kind === "UNAVAILABLE" || e.kind === "TIMEOUT") {
        this.markSilent(deviceId);
        this.dropLink(deviceId);
        return new RpcCallError("UNAVAILABLE", `peer unreachable: ${e.message}`, true, {
          device: deviceId,
          state: "unreachable",
        });
      }
      return new RpcCallError(e.kind as never, e.message, e.retryable, e.details);
    }
    this.markSilent(deviceId);
    this.dropLink(deviceId);
    return new RpcCallError(
      "UNAVAILABLE",
      `peer unreachable: ${e instanceof Error ? e.message : String(e)}`,
      true,
      { device: deviceId, state: "unreachable" },
    );
  }

  /** Open a standing subscription on a peer (C6-5/D35). The initial subscribe
   * runs under the per-call deadline; once standing, the CLIENT owns transport
   * recovery — a socket blip re-dials and replays with a fresh snapshot (the
   * P5 law), delivered through `onEvent` as kind "snapshot", and the link is
   * pinned against the idle sweep. `onDrop` fires only when the LINK itself is
   * torn down (a unary timeout's dropLink, an incompatible pin, dispose) — the
   * owner re-subscribes; it never fires for blips the client heals itself. */
  async subscribe(
    deviceId: string,
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
    onDrop: () => void,
    /** DS-L7 — provenance for an upstream opened FOR one client. The shared
     * federated upstreams (ref-counted per {device, method, params}) pass
     * none: they are the daemon's own reads. */
    envelope?: OutboundEnvelope,
  ): Promise<PeerSubscription> {
    if (this.disposed) throw new RpcCallError("UNAVAILABLE", "peer link disposed", false);
    if (deviceId === this.opts.ownDeviceId())
      throw new RpcCallError("PRECONDITION_FAILED", "device is self — routing bug", false);
    if (this.incompatible.has(deviceId))
      throw new RpcCallError("INCOMPATIBLE", "peer contracts major mismatch", false, {
        device: deviceId,
      });
    const wire = withEnvelope(params, envelope);
    const link = this.ensureLink(deviceId);
    this.useLink(link);
    let upstream: { snapshot: unknown; unsubscribe: () => void };
    try {
      upstream = await this.withDeadline(link.client.subscribe(method, wire, onEvent), deviceId);
    } catch (e) {
      throw this.mapPeerError(e, deviceId);
    } finally {
      this.releaseLink(link);
    }
    this.markAnswered(deviceId);
    const member = {
      unsubscribe: upstream.unsubscribe,
      onDrop,
    };
    // The link may have been dropped while the subscribe was in flight (the
    // deadline path, a concurrent unary timeout). Registering on a corpse
    // would pin nothing — report the drop instead of pretending.
    if (this.links.get(deviceId) !== link) {
      upstream.unsubscribe();
      throw new RpcCallError("UNAVAILABLE", "peer link dropped during subscribe", true, {
        device: deviceId,
        state: "unreachable",
      });
    }
    link.subs.add(member);
    return {
      snapshot: upstream.snapshot,
      unsubscribe: () => {
        link.subs.delete(member);
        upstream.unsubscribe();
      },
    };
  }

  linkState(deviceId: string): PeerLinkState | undefined {
    if (this.incompatible.has(deviceId)) return "incompatible";
    return this.links.get(deviceId)?.state;
  }

  linkStates(): Map<string, PeerLinkState> {
    const out = new Map<string, PeerLinkState>();
    for (const [id, link] of this.links) out.set(id, link.state);
    for (const id of this.incompatible) out.set(id, "incompatible");
    return out;
  }

  /** DS-L8 — the peer's DOOR as this daemon last heard it: `answers` while a
   * link is ready (or since its door last answered anything, the owner's own
   * refusals included); `silent` when the last attempt found no door — a dial
   * or a forward that failed at the transport — or a standing link that
   * answered and whose socket has gone; `incompatible` once its contracts
   * major was refused. `undefined` = no evidence either way: never dialled, or
   * an idle link swept after answering. The roster's `restarting` is `silent`
   * on a node the tailnet lists online. */
  doorState(deviceId: string): PeerDoorState | undefined {
    if (this.incompatible.has(deviceId)) return "incompatible";
    const link = this.links.get(deviceId);
    if (link !== undefined) {
      if (link.client.status === "ready") return "answers";
      if (link.state === "connected") return "silent";
    }
    return this.silentSince.has(deviceId) ? "silent" : undefined;
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.sweeper);
    for (const [id] of this.links) this.dropLink(id);
  }

  // ---- internals ----

  private ensureLink(deviceId: string): Link {
    const existing = this.links.get(deviceId);
    if (existing) return existing;
    const endpoint = this.opts.endpointFor(deviceId);
    if (endpoint === undefined)
      throw new RpcCallError("UNAVAILABLE", "peer has no published endpoint", true, {
        device: deviceId,
        state: "offline",
      });
    const webSocket = this.opts.webSocket ?? this.egressDial(deviceId);
    const client = new FielddClient({
      url: toWsUrl(endpoint),
      token: "", // the tailnet door grants from WhoIs — a token would be wrong here
      clientKind: "peer-fieldd",
      deviceId: this.opts.ownDeviceId(),
      ...(webSocket !== undefined ? { webSocket } : {}),
      maxBackoffMs: 5_000,
    });
    const link: Link = { client, state: "dialing", lastUsed: this.now(), subs: new Set() };
    client.onStatusChange(() => {
      if (this.links.get(deviceId) !== link) return; // superseded/dropped
      if (client.status === "ready" && link.state !== "connected") {
        link.state = "connected";
        this.emit("link-changed", { deviceId, state: "connected" });
      } else if (client.status === "failed") {
        if (client.lastError?.kind === "INCOMPATIBLE") this.pinIncompatible(deviceId);
        else this.dropLink(deviceId); // terminal auth/config failure — re-dial later
      }
    });
    client.connect();
    this.links.set(deviceId, link);
    this.emit("link-changed", { deviceId, state: "dialing" });
    return link;
  }

  /** DS-1 — this link's dial: the substrate is chosen per dial (see
   * `PeerLinkOptions.egress`), and the record hears it once per link — again
   * only if a later dial of the same link takes the other path. */
  private egressDial(deviceId: string): WsCtor | undefined {
    const egress = this.opts.egress;
    if (egress === undefined) return undefined;
    let said: EgressPath["kind"] | undefined;
    let complained = false;
    return egressWebSocket({
      path: egress,
      onPath: (path) => {
        if (said === path.kind) return;
        said = path.kind;
        if (path.kind === "direct") {
          this.logger.info(
            "fieldd.mesh.egress.fallback_os_network",
            "This peer link dials over the OS network; the node has no egress for it",
            {
              peer: deviceId,
              state: path.state,
              ...(path.detail !== undefined ? { detail: path.detail } : {}),
            },
          );
        } else {
          this.logger.info(
            "fieldd.mesh.egress.dial_through_node",
            "This peer link dials through the node's own proxy",
            { peer: deviceId },
          );
        }
      },
      onDialError: (error) => {
        if (complained) return;
        complained = true;
        this.logger.warn(
          "fieldd.mesh.egress.dial_refused",
          "A dial through the node's proxy failed; it is not retried over the OS network",
          { peer: deviceId, reason: error instanceof Error ? error.message : String(error) },
        );
      },
    });
  }

  private withDeadline<T>(p: Promise<T>, deviceId: string, ms = this.callTimeoutMs): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        // a stale socket is the usual suspect — drop it so the next call re-dials
        this.markSilent(deviceId);
        this.dropLink(deviceId);
        reject(
          new RpcCallError("UNAVAILABLE", "peer call timed out", true, {
            device: deviceId,
            state: "unreachable",
          }),
        );
      }, ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }

  /** DS-L8 — the door did not answer; "door-changed" wakes the roster (set
   * BEFORE any dropLink, so the roster that link-changed re-emits sees it). */
  private markSilent(deviceId: string): void {
    const was = this.silentSince.has(deviceId);
    this.silentSince.set(deviceId, this.now());
    if (!was) this.emit("door-changed", { deviceId, door: "silent" });
  }

  /** DS-L8 — the door answered (a result, or the owner's own error). */
  private markAnswered(deviceId: string): void {
    if (this.silentSince.delete(deviceId)) this.emit("door-changed", { deviceId, door: "answers" });
  }

  /** S6 (the landing review, 2026-10-01) — forget that the door went silent.
   * The roster calls it when the tailnet flips the node's `online`
   * (`device-service.ts`): silence heard before a node slept says nothing
   * about the daemon it woke with, and the mark used to survive the cycle, so
   * a desktop that slept and woke read `restarting` until some call to it
   * happened to succeed. Nothing is known afterwards (`doorState` reads
   * `undefined` unless a live link says otherwise) — not "answers". */
  clearSilent(deviceId: string): void {
    if (this.silentSince.delete(deviceId)) this.emit("door-changed", { deviceId, door: undefined });
  }

  private pinIncompatible(deviceId: string): void {
    this.incompatible.add(deviceId);
    this.dropLink(deviceId, "incompatible");
  }

  private dropLink(deviceId: string, nextState?: PeerLinkState): void {
    const link = this.links.get(deviceId);
    if (!link) {
      if (nextState) this.emit("link-changed", { deviceId, state: nextState });
      return;
    }
    this.links.delete(deviceId);
    link.client.close();
    // Standing subscriptions died with the client — tell each owner ONCE, so
    // it can re-subscribe (which re-dials). Cleared first: an onDrop that
    // immediately re-subscribes must not see itself in the corpse's set.
    const orphans = [...link.subs];
    link.subs.clear();
    for (const member of orphans) {
      try {
        member.onDrop();
      } catch {
        // an owner's recovery failure is its own — the drop must still fan out
      }
    }
    this.emit("link-changed", { deviceId, ...(nextState ? { state: nextState } : {}) });
  }

  /** DS-2 — a request or subscribe is in flight on `link` (the sweep skips it). */
  private useLink(link: Link): void {
    link.inflight = (link.inflight ?? 0) + 1;
    link.lastUsed = this.now();
  }

  /** …and is over: the idle clock starts at the ANSWER, not at the ask. */
  private releaseLink(link: Link): void {
    link.inflight = Math.max(0, (link.inflight ?? 1) - 1);
    link.lastUsed = this.now();
  }

  private sweepIdle(): void {
    const cutoff = this.now() - this.idleCloseMs;
    for (const [id, link] of this.links) {
      if (link.subs.size > 0) continue; // pinned: a standing subscription is use
      if ((link.inflight ?? 0) > 0) continue; // DS-2 — and so is a request in flight
      if (link.lastUsed < cutoff) this.dropLink(id); // dial-on-demand: quiet links close
    }
  }
}
