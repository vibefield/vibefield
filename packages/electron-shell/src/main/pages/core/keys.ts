// EY-1 (2026-11-19): one-use keys for the bridge's run endpoint, `/browser/<routeId>/<key>`.
//
// Who connects: over TCP loopback the kernel names no peer, so the one-use key bound to the engine's
// FIRST connection carries the weight. A key is spent by the first upgrade that presents it; every
// later presentation (a second connection, a replay after close, a revoked key) is
// `unknown-connection`.
//
// No key rests. A key is minted only when the broker arms a launch, and never again at a spend, so
// no key waits anywhere for a same-uid reader to spend before the engine does (the lab minted the
// next key at each spend and had to supersede the connection that raced it). Arming again retires
// the key still resting, so a route holds at most one unspent key. A spent key presented again is
// refused and recorded (`replayedAt`): the broker revokes the route and restarts the engine.
// Nothing is superseded.
//
// The key travels only to `deliver`, in-process to the broker, which hands it to the engine's own
// launch: never a file, never argv. What is kept is a SHA-256 of each key; the ledger names epochs,
// times and connection ids, never a key nor its digest. Pure: nothing here reads or writes the disk.

import { createHash, randomBytes as cryptoRandomBytes } from "node:crypto";
import {
  type BridgeRefusal,
  KEY_BYTES,
  KEY_ROUTE_ID_BYTES,
  KEY_ROUTE_PREFIX,
  type KeyClaim,
  type KeyDelivery,
  type KeyLedgerRow,
  type KeyRoute,
  type Keyring,
} from "./types";

/** The run endpoint's key path: the route's id, then the key, in lowercase hex. */
export const KEY_PATH_SHAPE = /^\/browser\/([0-9a-f]{32})\/([0-9a-f]{64})$/u;

function refuse(reason: string): KeyClaim {
  const verdict: BridgeRefusal = { ok: false, code: "unknown-connection", reason };
  return { ok: false, verdict };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface Entry {
  readonly epoch: number;
  state: "unspent" | "spent" | "revoked";
  readonly mintedAt: number;
  readonly keyDigest: string;
  spentAt?: number;
  spentBy?: string;
  releasedAt?: number;
  revokedAt?: number;
  replayedAt?: number;
  deliveryError?: string;
}

interface Route {
  readonly routeKey: string;
  readonly routeId: string;
  readonly port: number;
  epoch: number;
  readonly entries: Entry[];
  unspent: Entry | null;
  revoked: boolean;
  /** connId → epoch */
  readonly live: Map<string, number>;
}

export function createKeyring(o: {
  readonly deliver: KeyDelivery;
  readonly randomBytes?: (n: number) => Uint8Array;
  readonly now?: () => number;
}): Keyring {
  const { deliver } = o;
  if (typeof deliver !== "function") throw new TypeError("createKeyring: deliver is required");
  const random = o.randomBytes ?? ((n: number) => cryptoRandomBytes(n));
  const now = o.now ?? (() => Date.now());
  const routes = new Map<string, Route>();
  const byRouteId = new Map<string, Route>();
  const connections = new Map<string, { readonly route: Route; readonly epoch: number }>();

  const hex = (size: number): string => {
    const bytes = random(size);
    if (!(bytes instanceof Uint8Array) || bytes.length !== size) {
      throw new Error("randomBytes returned the wrong length");
    }
    return Buffer.from(bytes).toString("hex");
  };

  function deliverSafely(route: Route, url: string | null, entry: Entry | null): void {
    try {
      deliver(route.routeKey, url);
    } catch (error) {
      // The key is minted either way; the ledger says it was not delivered, so a launch that fails
      // is explained.
      const code = (error as { code?: unknown } | null)?.code;
      if (entry !== null) entry.deliveryError = typeof code === "string" ? code : "delivery failed";
    }
  }

  function addRoute(r: { readonly routeKey: string; readonly port: number }): KeyRoute {
    const { routeKey, port } = r;
    if (typeof routeKey !== "string" || routeKey === "") {
      throw new TypeError("addRoute: routeKey is required");
    }
    if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
      throw new TypeError("addRoute: a loopback port");
    }
    const existing = routes.get(routeKey);
    if (existing !== undefined && !existing.revoked)
      throw new Error("addRoute: the route already exists");
    // A revoked route's id stays indexed, so its old keys answer "revoked", not "unknown route".
    let routeId = hex(KEY_ROUTE_ID_BYTES);
    while (byRouteId.has(routeId)) routeId = hex(KEY_ROUTE_ID_BYTES);
    const route: Route = {
      routeKey,
      routeId,
      port,
      epoch: 0,
      entries: [],
      unspent: null,
      revoked: false,
      live: new Map(),
    };
    routes.set(routeKey, route);
    byRouteId.set(routeId, route);
    return { routeKey, routeId };
  }

  function arm(routeKey: string): { readonly epoch: number } {
    const route = routes.get(routeKey);
    if (route === undefined) throw new Error("arm: no such route");
    if (route.revoked) throw new Error("arm: the route was revoked");
    // At most one unspent key: the one resting is retired before the next is minted.
    if (route.unspent !== null) {
      route.unspent.state = "revoked";
      route.unspent.revokedAt = now();
    }
    const key = hex(KEY_BYTES);
    route.epoch += 1;
    const entry: Entry = {
      epoch: route.epoch,
      state: "unspent",
      mintedAt: now(),
      keyDigest: digest(key),
    };
    route.entries.push(entry);
    route.unspent = entry;
    deliverSafely(
      route,
      `ws://127.0.0.1:${route.port}/${KEY_ROUTE_PREFIX}/${route.routeId}/${key}`,
      entry,
    );
    return { epoch: entry.epoch };
  }

  function claim(requestPath: string, connId: string): KeyClaim {
    if (typeof connId !== "string" || connId === "")
      throw new TypeError("claim: connId is required");
    if (connections.has(connId)) return refuse("a connection presents a key once");
    if (typeof requestPath !== "string") return refuse("no key");
    const pathOnly = requestPath.split("?")[0]?.split("#")[0] ?? "";
    const shape = KEY_PATH_SHAPE.exec(pathOnly);
    if (shape === null) return refuse("not a key path");
    const [, routeId = "", key = ""] = shape;
    const route = byRouteId.get(routeId);
    if (route === undefined) return refuse("unknown route");
    if (route.revoked) return refuse("the route was revoked");
    const keyDigest = digest(key);
    const entry = route.entries.find((candidate) => candidate.keyDigest === keyDigest);
    if (entry === undefined) return refuse("unknown key");
    if (entry.state === "spent") {
      if (entry.replayedAt === undefined) entry.replayedAt = now();
      return refuse("the key was spent (a replay or a second connection)");
    }
    if (entry.state !== "unspent" || route.unspent !== entry) return refuse("the key is not live");
    entry.state = "spent";
    entry.spentAt = now();
    entry.spentBy = connId;
    route.unspent = null;
    route.live.set(connId, entry.epoch);
    connections.set(connId, { route, epoch: entry.epoch });
    return { ok: true, routeKey: route.routeKey, epoch: entry.epoch };
  }

  function released(connId: string): void {
    const conn = connections.get(connId);
    if (conn === undefined) return;
    conn.route.live.delete(connId);
    const entry = conn.route.entries.find((candidate) => candidate.epoch === conn.epoch);
    if (entry !== undefined && entry.releasedAt === undefined) entry.releasedAt = now();
  }

  function revoke(routeKey: string): void {
    const route = routes.get(routeKey);
    if (route === undefined || route.revoked) return;
    route.revoked = true;
    const at = now();
    for (const entry of route.entries) {
      if (entry.state === "unspent") entry.state = "revoked";
      if (entry.revokedAt === undefined) entry.revokedAt = at;
    }
    route.unspent = null;
    deliverSafely(route, null, null);
  }

  function ledger(routeKey: string): readonly KeyLedgerRow[] {
    const route = routes.get(routeKey);
    if (route === undefined) return [];
    return route.entries.map(({ keyDigest: _never, ...row }) => ({ ...row }));
  }

  function liveConnections(
    routeKey: string,
  ): readonly { readonly connId: string; readonly epoch: number }[] {
    const route = routes.get(routeKey);
    if (route === undefined) return [];
    return [...route.live].map(([connId, epoch]) => ({ connId, epoch }));
  }

  return { addRoute, arm, claim, released, revoke, ledger, liveConnections };
}
