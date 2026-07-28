import { EventEmitter } from "node:events";
import { FielddClient, FielddRpcError, type WsCtor } from "@vibefield/fieldd-client";
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

export type PeerLinkState = "dialing" | "connected" | "incompatible";

/** A standing upstream subscription on a peer link (C6-5/D35). */
export interface PeerSubscription {
  snapshot: unknown;
  unsubscribe: () => void;
}

export interface PeerLinkOptions {
  ownDeviceId: () => string;
  /** the peer's capability URL from its slice, or undefined = unpublished/offline */
  endpointFor: (deviceId: string) => string | undefined;
  webSocket?: WsCtor;
  idleCloseMs?: number;
  callTimeoutMs?: number;
  now?: () => number;
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

  constructor(private readonly opts: PeerLinkOptions) {
    super();
    this.now = opts.now ?? Date.now;
    this.idleCloseMs = opts.idleCloseMs ?? 300_000;
    this.callTimeoutMs = opts.callTimeoutMs ?? 8_000;
    this.sweeper = setInterval(() => this.sweepIdle(), Math.min(this.idleCloseMs, 60_000));
    this.sweeper.unref?.();
  }

  /** Forward one call to a peer. Throws RpcCallError shapes ProductApi maps
   * straight back to the original caller. */
  async request(deviceId: string, method: string, params: unknown): Promise<unknown> {
    if (this.disposed) throw new RpcCallError("UNAVAILABLE", "peer link disposed", false);
    if (deviceId === this.opts.ownDeviceId())
      throw new RpcCallError("PRECONDITION_FAILED", "device is self — routing bug", false);
    if (this.incompatible.has(deviceId))
      throw new RpcCallError("INCOMPATIBLE", "peer contracts major mismatch", false, {
        device: deviceId,
      });
    const link = this.ensureLink(deviceId);
    link.lastUsed = this.now();
    try {
      return await this.withDeadline(link.client.request(method, params), deviceId);
    } catch (e) {
      throw this.mapPeerError(e, deviceId);
    }
  }

  /** One failure law for request AND subscribe: an incompatible peer pins
   * (refuse fast, D32), a transport-class failure drops the link so the next
   * call re-dials, and the REMOTE's genuine replies (scope refusal, not-found,
   * …) pass through untouched — a forwarded call's answer is the peer's
   * answer. Already-mapped errors (the deadline path) pass straight through. */
  private mapPeerError(e: unknown, deviceId: string): RpcCallError {
    if (e instanceof RpcCallError) return e;
    if (e instanceof FielddRpcError) {
      if (e.kind === "INCOMPATIBLE") {
        this.pinIncompatible(deviceId);
        return new RpcCallError("INCOMPATIBLE", "peer contracts major mismatch", false, {
          device: deviceId,
        });
      }
      if (e.kind === "UNAVAILABLE" || e.kind === "TIMEOUT") {
        this.dropLink(deviceId);
        return new RpcCallError("UNAVAILABLE", `peer unreachable: ${e.message}`, true, {
          device: deviceId,
          state: "unreachable",
        });
      }
      return new RpcCallError(e.kind as never, e.message, e.retryable, e.details);
    }
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
  ): Promise<PeerSubscription> {
    if (this.disposed) throw new RpcCallError("UNAVAILABLE", "peer link disposed", false);
    if (deviceId === this.opts.ownDeviceId())
      throw new RpcCallError("PRECONDITION_FAILED", "device is self — routing bug", false);
    if (this.incompatible.has(deviceId))
      throw new RpcCallError("INCOMPATIBLE", "peer contracts major mismatch", false, {
        device: deviceId,
      });
    const link = this.ensureLink(deviceId);
    link.lastUsed = this.now();
    let upstream: { snapshot: unknown; unsubscribe: () => void };
    try {
      upstream = await this.withDeadline(link.client.subscribe(method, params, onEvent), deviceId);
    } catch (e) {
      throw this.mapPeerError(e, deviceId);
    }
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
    const client = new FielddClient({
      url: toWsUrl(endpoint),
      token: "", // the tailnet door grants from WhoIs — a token would be wrong here
      clientKind: "peer-fieldd",
      deviceId: this.opts.ownDeviceId(),
      ...(this.opts.webSocket !== undefined ? { webSocket: this.opts.webSocket } : {}),
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

  private withDeadline<T>(p: Promise<T>, deviceId: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        // a stale socket is the usual suspect — drop it so the next call re-dials
        this.dropLink(deviceId);
        reject(
          new RpcCallError("UNAVAILABLE", "peer call timed out", true, {
            device: deviceId,
            state: "unreachable",
          }),
        );
      }, this.callTimeoutMs);
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

  private sweepIdle(): void {
    const cutoff = this.now() - this.idleCloseMs;
    for (const [id, link] of this.links) {
      if (link.subs.size > 0) continue; // pinned: a standing subscription is use
      if (link.lastUsed < cutoff) this.dropLink(id); // dial-on-demand: quiet links close
    }
  }
}
