import { createHash } from "node:crypto";
import {
  MESH_EGRESS,
  type MeshEgressRouteAddParams,
  type MeshEgressRouteBound,
  type MeshEgressRouteRef,
  type MeshEgressRouteTable,
  MeshEgressUnavailableDetails,
} from "@vibefield/contracts";
import type { WsCtor, WsLike } from "@vibefield/fieldd-client";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import WebSocket from "ws";
import { RpcCallError } from "./native-link";
import { Socks5Agent } from "./socks5";

// DS-1 — fieldd's face of EGRESS (design-02 §2.4's egress bullet; design-06
// §3; petition T7 = truffle RFC 026). The floor asks the node's sidecar for
// the paths; this file is what fieldd does with the answers:
//
//   · `resolveEgressPath` — "how does a dial reach the tailnet right now?":
//     the node's own SOCKS5 (E1) when the floor has it, else the OS network
//     with the floor's reason. PeerLink's dial reads it once per dial,
//     through `egressWebSocket` — the WebSocket constructor FielddClient
//     dials with.
//   · `EgressRoutes` — the PORT lane ds-e's terminal rewriter consumes (E2): a
//     loopback address that reaches a door on a peer, ref-counted per
//     {peer, port}, dropped (and said so) when the peer leaves the roster or
//     the floor's table resets. `FakeEgressRoutes` is its test double.
//
// Today the floor answers `egress-unsupported` for everything (truffle-core
// 0.7.14 has no egress), so every path here resolves to "the OS network" and
// every route to `undefined` — honestly, and with the floor's own reason.

/** How a dial reaches the tailnet. */
export type EgressPath =
  | { kind: "proxy"; address: string; username: string; credential: string }
  | {
      kind: "direct";
      /** the floor's word (`egress-unsupported`, `mesh-down`) or this side's
       * (`native-unavailable`, `native-timeout`, `egress-error`) */
      state: string;
      detail?: string;
    };

/** The verbs `resolveEgressPath` needs — `MeshClient` is the production one. */
export interface EgressProxySource {
  egressProxy(): Promise<{ address: string; username: string; credential: string }>;
}

/** Ask the floor for the node's SOCKS5 and say, in every other case, why the
 * dial goes over the OS network instead. Never throws: a dial must still
 * happen when the floor cannot answer, exactly as it did before DS-1. */
export async function resolveEgressPath(source: EgressProxySource): Promise<EgressPath> {
  try {
    const proxy = await source.egressProxy();
    return {
      kind: "proxy",
      address: proxy.address,
      username: proxy.username,
      credential: proxy.credential,
    };
  } catch (error) {
    return { kind: "direct", ...egressRefusal(error) };
  }
}

/** A refused egress ask → the honest reason. The floor's own two answers come
 * first; a floor older than DS-1 is the ordinary case this plane outliving
 * fieldd makes it (`method not found` with a node, its node gate without). */
export function egressRefusal(error: unknown): { state: string; detail?: string } {
  if (!(error instanceof RpcCallError)) {
    return {
      state: "egress-error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (error.kind === "UNAVAILABLE") {
    const egress = MeshEgressUnavailableDetails.safeParse(error.details);
    if (egress.success) {
      return {
        state: egress.data.state,
        ...(egress.data.gatewayState !== undefined ? { detail: egress.data.gatewayState } : {}),
      };
    }
    const service = (error.details as { service?: unknown } | undefined)?.service;
    // a pre-DS-1 floor's node gate answers before it ever reads the method
    if (service === "mesh-gateway") return { state: MESH_EGRESS.STATE_MESH_DOWN };
    return { state: "native-unavailable", detail: error.message };
  }
  if (error.kind === "NOT_FOUND" && error.code === -32601) {
    return { state: MESH_EGRESS.STATE_UNSUPPORTED, detail: "the floor predates DS-1" };
  }
  if (error.kind === "TIMEOUT") return { state: "native-timeout", detail: error.message };
  return { state: "egress-error", detail: `${error.kind}: ${error.message}` };
}

// ---- the dial (E1): a WebSocket constructor that asks first ----

export interface EgressDialOptions {
  /** Asked ONCE PER DIAL, reconnects included: a node rebuild rotates the
   * proxy's credential, and a floor upgrade can turn the OS network into the
   * node's own path between two dials of one link. */
  path: () => Promise<EgressPath>;
  /** The path a dial took (PeerLink says it once per link). */
  onPath?: (path: EgressPath) => void;
  /** A dial THROUGH THE NODE failed — the proxy refused the credential, the
   * peer, or is gone. It fails CLOSED: never retried over the OS network,
   * which would be a silent downgrade of the substrate (DS-L5). */
  onDialError?: (error: unknown) => void;
  /** Today's dial, for a floor with no egress (default: the host's global
   * WebSocket — exactly what FielddClient used before DS-1). */
  direct?: WsCtor;
  /** the SOCKS5 handshake's budget (default 10 s) */
  socksTimeoutMs?: number;
}

/** A WebSocket constructor for FielddClient that decides its substrate per
 * dial: the node's SOCKS5 when `path()` names one (a `ws` client over a
 * `Socks5Agent`, the door's MagicDNS name resolved BY THE PROXY, never the OS),
 * else the direct dial. FielddClient constructs sockets synchronously, so the
 * socket it holds is a stand-in that is CONNECTING until the path is known and
 * then forwards every event of the real one. */
export function egressWebSocket(opts: EgressDialOptions): WsCtor {
  const open = async (url: string, caller: { closedByCaller: boolean }): Promise<WsLike> => {
    const path = await opts.path();
    opts.onPath?.(path);
    if (path.kind === "direct") {
      const Direct = opts.direct ?? (globalThis as { WebSocket?: WsCtor }).WebSocket;
      if (Direct === undefined) throw new Error("no WebSocket implementation in this host");
      return new Direct(url);
    }
    // The product door is plain HTTP inside WireGuard (`tls: false`); a TLS
    // hop through the proxy would need an https agent nothing asks for yet.
    if (!url.startsWith("ws://")) {
      throw new Error(`egress: only a ws:// door rides the node's proxy (asked: ${url})`);
    }
    const agent = new Socks5Agent({
      proxy: path.address,
      username: path.username,
      password: path.credential,
      ...(opts.socksTimeoutMs !== undefined ? { timeoutMs: opts.socksTimeoutMs } : {}),
    });
    const socket = new WebSocket(url, { agent, perMessageDeflate: false });
    // A DIAL failure only: an error after the socket opened is a dropped
    // session (FielddClient's reconnect law owns it), and the error `ws`
    // raises when its caller closes a socket still connecting is the
    // caller's own act, not a refusal.
    let opened = false;
    socket.once("open", () => {
      opened = true;
    });
    socket.on("error", (error) => {
      if (!opened && !caller.closedByCaller) opts.onDialError?.(error);
    });
    return socket as unknown as WsLike;
  };
  return class EgressDialedSocket extends DeferredSocket {
    constructor(url: string) {
      super(url, open);
    }
  };
}

type WsEvent = "open" | "message" | "close" | "error";

/** A socket that exists before the real one does: CONNECTING while the
 * substrate is chosen, then a transparent forwarder. A `close()` before the
 * real socket exists closes it the moment it arrives; a failure to open is the
 * ordinary `error` then `close` a refused dial produces, so FielddClient's own
 * reconnect law applies unchanged. */
class DeferredSocket implements WsLike {
  private inner: WsLike | null = null;
  private closedEarly = false;
  /** the caller (FielddClient) closed this socket — read by the dial so the
   * close it caused is not reported as a refusal */
  closedByCaller = false;
  private readonly listeners: Record<WsEvent, Array<(ev: unknown) => void>> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  constructor(
    url: string,
    open: (url: string, caller: { closedByCaller: boolean }) => Promise<WsLike>,
  ) {
    open(url, this).then(
      (inner) => {
        if (this.closedEarly) {
          inner.close();
          return;
        }
        this.inner = inner;
        for (const type of ["open", "message", "close", "error"] as const) {
          inner.addEventListener(type, (ev) => this.dispatch(type, ev));
        }
      },
      (error: unknown) => {
        if (this.closedEarly) return;
        this.closedEarly = true;
        this.dispatch("error", { error });
        this.dispatch("close", { code: 1006, reason: String(error) });
      },
    );
  }

  get readyState(): number {
    if (this.inner !== null) return this.inner.readyState;
    return this.closedEarly ? 3 : 0;
  }

  send(data: string): void {
    if (this.inner === null) throw new Error("egress dial: the socket is not open");
    this.inner.send(data);
  }

  close(code?: number, reason?: string): void {
    this.closedByCaller = true;
    if (this.inner !== null) {
      this.inner.close(code, reason);
      return;
    }
    if (this.closedEarly) return;
    this.closedEarly = true;
    queueMicrotask(() => this.dispatch("close", { code: code ?? 1000, reason: reason ?? "" }));
  }

  addEventListener(type: WsEvent, fn: (ev: unknown) => void): void {
    this.listeners[type].push(fn);
  }

  private dispatch(type: WsEvent, ev: unknown): void {
    for (const fn of [...this.listeners[type]]) fn(ev);
  }
}

// ---- the EgressRoutes port (E2) ----

/** Why a handed-out route stopped reaching its peer. */
export type EgressRouteDropReason =
  /** the roster no longer names the peer, or its tailnet name moved */
  | "peer-left"
  /** the floor's table lost the route: a node rebuild, a floor restart */
  | "reset";

export interface EgressRouteDrop {
  peerDeviceId: string;
  port: number;
  /** the loopback address that no longer reaches the peer */
  listen: string;
  reason: EgressRouteDropReason;
}

/** THE PORT. A loopback address that reaches `port` on the peer device
 * `peerDeviceId` through this desktop's own node — so a renderer dials a
 * remote cell exactly as it dials a local one (`CellEndpointSet` stays
 * loopback-only, no CSP change; design-06 §3 E2).
 *
 * The rules a consumer relies on:
 *  - `ensureRoute` resolves `{listen}` and takes ONE reference, or resolves
 *    `undefined` and takes none: egress unsupported, the mesh down, the peer
 *    not in the roster, or the floor refused (the reason is logged). It throws
 *    only for a caller's mistake — a port DS-L6 does not route (only doors
 *    that demand their own grant, `MESH_EGRESS.ROUTABLE_PORTS`; the product
 *    door is reached through the proxy, never a route).
 *  - Every resolved `ensureRoute` is balanced by exactly ONE `release`; the
 *    last release removes the route from the floor. A release with no
 *    reference held is ignored.
 *  - A route can DIE while referenced (`onDropped`): its address stops
 *    reaching the peer, but the references stand — the holder still releases
 *    each one, and the next `ensureRoute` binds a fresh address. */
export interface EgressRoutesPort {
  ensureRoute(peerDeviceId: string, port: number): Promise<{ listen: string } | undefined>;
  release(peerDeviceId: string, port: number): void;
  /** Hear every drop of a handed-out address; returns the unsubscribe. */
  onDropped(listener: (drop: EgressRouteDrop) => void): () => void;
}

/** The roster as EgressRoutes reads it (DeviceService in production). */
export interface EgressRoster {
  /** the peer's AUTHENTICATED MagicDNS name (from WhoIs, never from anything
   * the peer said) — the only host a route may target — or `undefined` when
   * the roster does not name this peer */
  hostFor(deviceId: string): string | undefined;
  /** wake on every roster change; returns the unsubscribe */
  onChange(listener: () => void): () => void;
}

/** The facade verbs EgressRoutes calls (`MeshClient`'s). */
export interface EgressRouteFacade {
  egressRouteAdd(params: MeshEgressRouteAddParams): Promise<MeshEgressRouteBound>;
  egressRouteRemove(id: string): Promise<MeshEgressRouteRef>;
  subscribeEgressRoutes(
    onTable: (table: MeshEgressRouteTable) => void,
  ): Promise<{ snapshot: MeshEgressRouteTable; dispose: () => void }>;
}

export interface EgressRoutesOptions {
  facade: EgressRouteFacade;
  roster: EgressRoster;
  logger?: Logger;
}

interface RouteEntry {
  peer: string;
  port: number;
  id: string;
  /** resolved-and-unreleased ensures PLUS ensures in flight; the entry lives
   * exactly as long as this is above zero */
  refs: number;
  /** the binding, with the floor boot and table revision it was made at */
  bound?: { target: string; listen: string; revision: number; bootId: string };
  pending?: Promise<RouteEntry["bound"]>;
}

const ROUTE_ID_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The route id for {peer, port}: stable, so an add replayed after a fieldd
 * restart re-answers the floor's existing listener instead of binding a second
 * one. A device id outside the contract's charset is hashed, never mangled
 * (two ids must never collide onto one route). */
export function egressRouteId(peerDeviceId: string, port: number): string {
  const key = ROUTE_ID_SAFE.test(peerDeviceId)
    ? peerDeviceId
    : `h${createHash("sha256").update(peerDeviceId).digest("hex").slice(0, 32)}`;
  return `egress-${key}-${port}`;
}

export class EgressRoutes implements EgressRoutesPort {
  private readonly entries = new Map<string, RouteEntry>();
  private readonly listeners = new Set<(drop: EgressRouteDrop) => void>();
  private readonly logger: Logger;
  private readonly stopRoster: () => void;
  private stopTable: (() => void) | undefined;
  private subscribing: Promise<void> | undefined;
  /** the newest table the floor has shown us — the other half of the order:
   * a reset's push can overtake the answer of an add it already undid */
  private latestTable: MeshEgressRouteTable | undefined;
  private disposed = false;

  constructor(private readonly opts: EgressRoutesOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.stopRoster = opts.roster.onChange(() => this.syncRoster());
  }

  async ensureRoute(peerDeviceId: string, port: number): Promise<{ listen: string } | undefined> {
    if (
      !Number.isInteger(port) ||
      !(MESH_EGRESS.ROUTABLE_PORTS as readonly number[]).includes(port)
    ) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `port ${port} is not routable: an unauthenticated egress route may target only a door that demands its own grant (DS-L6)`,
        false,
        { routablePorts: [...MESH_EGRESS.ROUTABLE_PORTS] },
      );
    }
    if (this.disposed) return undefined;
    const host = this.opts.roster.hostFor(peerDeviceId);
    if (host === undefined) {
      this.logger.debug(
        "fieldd.mesh.egress.route_unavailable",
        "The roster does not name this peer",
        {
          peer: peerDeviceId,
          port,
          state: "not-in-roster",
        },
      );
      return undefined;
    }
    const target = `${host.includes(":") ? `[${host}]` : host}:${port}`;
    const key = `${peerDeviceId}\u0000${port}`;
    let entry = this.entries.get(key);
    if (entry === undefined) {
      entry = { peer: peerDeviceId, port, id: egressRouteId(peerDeviceId, port), refs: 0 };
      this.entries.set(key, entry);
    }
    entry.refs += 1; // reserved for the whole ensure; undone below if it fails
    try {
      const bound = await this.bindTo(entry, target);
      if (bound === undefined) {
        this.unref(key, entry);
        return undefined;
      }
      return { listen: bound.listen };
    } catch (error) {
      this.unref(key, entry);
      throw error;
    }
  }

  release(peerDeviceId: string, port: number): void {
    const key = `${peerDeviceId}\u0000${port}`;
    const entry = this.entries.get(key);
    if (entry === undefined || entry.refs === 0) return;
    this.unref(key, entry);
  }

  onDropped(listener: (drop: EgressRouteDrop) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Every bound route whose peer the roster no longer names — or names under
   * another tailnet host — is dropped and removed from the floor: a loopback
   * listener must not outlive the peer it was aimed at. */
  syncRoster(): void {
    for (const entry of this.entries.values()) {
      if (entry.bound === undefined) continue;
      const host = this.opts.roster.hostFor(entry.peer);
      const target =
        host === undefined ? undefined : `${host.includes(":") ? `[${host}]` : host}:${entry.port}`;
      if (target !== entry.bound.target) this.drop(entry, "peer-left");
    }
  }

  /** Stop listening and take every route this daemon placed off the floor. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopRoster();
    this.stopTable?.();
    for (const entry of this.entries.values()) {
      if (entry.bound !== undefined) void this.removeOnFloor(entry.id);
    }
    this.entries.clear();
    this.listeners.clear();
  }

  // ---- internals ----

  private async bindTo(entry: RouteEntry, target: string): Promise<RouteEntry["bound"]> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (entry.pending !== undefined) {
        await entry.pending.catch(() => undefined);
        continue;
      }
      if (entry.bound !== undefined) {
        if (entry.bound.target === target) return entry.bound;
        this.drop(entry, "peer-left"); // the peer's tailnet name moved under us
      }
      const pending = this.bind(entry, target);
      entry.pending = pending;
      try {
        return await pending;
      } finally {
        if (entry.pending === pending) delete entry.pending;
      }
    }
    return undefined;
  }

  private async bind(entry: RouteEntry, target: string): Promise<RouteEntry["bound"]> {
    await this.ensureTableStream();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const bound = await this.opts.facade.egressRouteAdd({ id: entry.id, target });
        if (this.tableOutlived(entry.id, bound)) {
          // a table AT OR AFTER this binding already lacks it: a reset landed
          // between the floor's bind and its answer reaching us. Bind again.
          continue;
        }
        entry.bound = {
          target,
          listen: bound.listen,
          revision: bound.revision,
          bootId: bound.bootId,
        };
        return entry.bound;
      } catch (error) {
        // The floor still holds this id aimed elsewhere — a fieldd before this
        // one bound it, and the peer's name has moved since. A route never
        // re-aims, so take it down and bind again, once.
        if (attempt === 0 && error instanceof RpcCallError && error.kind === "CONFLICT") {
          await this.removeOnFloor(entry.id);
          continue;
        }
        const refusal = egressRefusal(error);
        this.logger.info(
          "fieldd.mesh.egress.route_unavailable",
          "No egress route to this peer door",
          {
            peer: entry.peer,
            port: entry.port,
            state: refusal.state,
            ...(refusal.detail !== undefined ? { detail: refusal.detail } : {}),
          },
        );
        return undefined;
      }
    }
    return undefined;
  }

  /** The table stream is how a reset reaches us. Best-effort: a floor that
   * cannot serve it (egress unsupported) cannot bind routes either, and the
   * next bind asks again. */
  private ensureTableStream(): Promise<void> {
    if (this.stopTable !== undefined || this.disposed) return Promise.resolve();
    this.subscribing ??= this.opts.facade
      .subscribeEgressRoutes((table) => this.onTable(table))
      .then(
        ({ snapshot, dispose }) => {
          if (this.disposed) {
            dispose();
            return;
          }
          this.stopTable = dispose;
          this.onTable(snapshot);
        },
        () => undefined,
      )
      .finally(() => {
        this.subscribing = undefined;
      });
    return this.subscribing;
  }

  /** A table from the floor (the snapshot, a push, a reconnect's replay). A
   * route this daemon holds that is missing from a table AT OR AFTER the
   * revision it was bound at is gone; an older table of the SAME floor boot
   * says nothing about it (the stream runs beside the add that bound it). A
   * table from ANOTHER boot is authoritative: a respawned floor counts from
   * zero again, and the routes of the boot that bound them died with it. */
  private onTable(table: MeshEgressRouteTable): void {
    const latest = this.latestTable;
    if (
      latest === undefined ||
      latest.bootId !== table.bootId ||
      table.revision >= latest.revision
    ) {
      this.latestTable = table;
    }
    for (const entry of this.entries.values()) {
      const bound = entry.bound;
      if (bound === undefined) continue;
      if (bound.bootId === table.bootId && table.revision < bound.revision) continue;
      const present = table.routes.some(
        (route) => route.id === entry.id && route.listen === bound.listen,
      );
      if (!present) this.drop(entry, "reset");
    }
  }

  /** Has a table at or after this binding's revision already gone by without it? */
  private tableOutlived(id: string, bound: MeshEgressRouteBound): boolean {
    const latest = this.latestTable;
    return (
      latest !== undefined &&
      latest.bootId === bound.bootId &&
      latest.revision >= bound.revision &&
      !latest.routes.some((route) => route.id === id && route.listen === bound.listen)
    );
  }

  private drop(entry: RouteEntry, reason: EgressRouteDropReason): void {
    const was = entry.bound;
    if (was === undefined) return;
    delete entry.bound;
    // A reset's floor already lost the listener; a departed peer's is ours to
    // take down — it must not stay aimed at a device that left the account.
    if (reason === "peer-left") void this.removeOnFloor(entry.id);
    this.logger.info(
      "fieldd.mesh.egress.route_dropped",
      "An egress route stopped reaching its peer",
      {
        peer: entry.peer,
        port: entry.port,
        reason,
      },
    );
    const drop: EgressRouteDrop = {
      peerDeviceId: entry.peer,
      port: entry.port,
      listen: was.listen,
      reason,
    };
    for (const listener of [...this.listeners]) {
      try {
        listener(drop);
      } catch {
        // one holder's recovery failure is its own; the drop still fans out
      }
    }
  }

  private unref(key: string, entry: RouteEntry): void {
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this.entries.delete(key);
    if (entry.bound !== undefined) void this.removeOnFloor(entry.id);
  }

  private async removeOnFloor(id: string): Promise<void> {
    try {
      await this.opts.facade.egressRouteRemove(id);
    } catch (error) {
      if (error instanceof RpcCallError && error.kind === "NOT_FOUND") return; // already gone
      this.logger.warn(
        "fieldd.mesh.egress.route_remove_failed",
        "An egress route could not be removed",
        {
          route: id,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

/** THE TEST DOUBLE for the port: routes are whatever a test declares, the
 * reference counts are inspectable, and a drop is one call. Holds no floor. */
export class FakeEgressRoutes implements EgressRoutesPort {
  /** every ensure asked, in order (resolved or not) */
  readonly asked: Array<{ peerDeviceId: string; port: number }> = [];
  private readonly routes = new Map<string, string>();
  private readonly counts = new Map<string, number>();
  private readonly listeners = new Set<(drop: EgressRouteDrop) => void>();

  /** Make {peer, port} routable at `listen` (e.g. a test door's loopback address). */
  route(peerDeviceId: string, port: number, listen: string): void {
    this.routes.set(`${peerDeviceId}\u0000${port}`, listen);
  }

  /** References held on {peer, port} right now. */
  refs(peerDeviceId: string, port: number): number {
    return this.counts.get(`${peerDeviceId}\u0000${port}`) ?? 0;
  }

  /** The route stops reaching its peer, as a reset or a departed peer would
   * make it. References stand, exactly as the real port's do. */
  drop(peerDeviceId: string, port: number, reason: EgressRouteDropReason = "reset"): void {
    const key = `${peerDeviceId}\u0000${port}`;
    const listen = this.routes.get(key);
    if (listen === undefined) return;
    this.routes.delete(key);
    for (const listener of [...this.listeners]) listener({ peerDeviceId, port, listen, reason });
  }

  async ensureRoute(peerDeviceId: string, port: number): Promise<{ listen: string } | undefined> {
    this.asked.push({ peerDeviceId, port });
    const key = `${peerDeviceId}\u0000${port}`;
    const listen = this.routes.get(key);
    if (listen === undefined) return undefined;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    return { listen };
  }

  release(peerDeviceId: string, port: number): void {
    const key = `${peerDeviceId}\u0000${port}`;
    const held = this.counts.get(key) ?? 0;
    if (held <= 1) this.counts.delete(key);
    else this.counts.set(key, held - 1);
  }

  onDropped(listener: (drop: EgressRouteDrop) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
