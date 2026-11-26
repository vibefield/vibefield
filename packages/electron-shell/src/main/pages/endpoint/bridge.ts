// EY-1 (2026-11-19) — THE BRIDGE AS THE BROKER DRIVES IT (track EY; the broker's PagesBridgePort). The endpoint is the
// CDP core; around it the bridge keeps the runs' routes and keys, the socket, and the call windows' refusals:
//   addRun      the run's route on the socket's port (again after a revoke);
//   arm         the run's ONE key for this launch: its keyed URL, taken as the keyring delivers it inside the call, goes
//               back to the launch and nowhere else; never logged, never kept;
//   raced       whether a spent key was presented again on the run's route;
//   revokeRun   the route revoked and the run's sockets closed; the grants stand, and the engine is the broker's to
//               restart;
//   grant       the surface's page handed to the run's client, answered with the page's own DevTools id; a refusal is
//               its word, never a throw;
//   endGrant    by the page the grant named, kept from the grant itself, so a surface already gone still ends;
//   hold        the person picked a granted surface up (2026-11-24): the endpoint undoes what the run's client left on
//               its page, as the bridge's own traffic; a surface no run holds takes nothing;
//   putDown     the person put it down: the endpoint sets again what the pick-up undid;
//   introduce   a granted surface's page said to the run's client again (2026-11-24): for a page the engine's own
//               list lacks, asked by the broker inside a call's window on it; how many clients were told;
//   refusals    the bridge's refusals inside one call's window, in order, read once. A call is kept until read, or until
//               REFUSAL_CALLS_KEPT newer calls push it out; each holds at most REFUSALS_PER_CALL.
// The keyring, the endpoint and the socket are made here from factories, since each takes a hook of the bridge's: the
// keyring its delivery, the endpoint its refusal sink.

import type { BrowserAgentPort } from "../../live-surfaces/browser-electron-native";
import type { PagesBridgePort, PagesGrantAnswer } from "../broker/broker";
import type { BridgeHand, BridgePage, CallRefusal, KeyDelivery, Keyring } from "../core/types";
import type { Endpoint } from "./endpoint";
import type { BridgeServer } from "./server";

/** A call's refusals kept for its end. */
export const REFUSALS_PER_CALL = 64;
/** Calls whose refusals are kept unread; the oldest goes first. */
export const REFUSAL_CALLS_KEPT = 64;

export interface PagesBridgeDeps {
  readonly makeKeyring: (deliver: KeyDelivery) => Keyring;
  readonly makeEndpoint: (refused: (r: CallRefusal) => void) => Endpoint;
  readonly makeServer: (keyring: Keyring, endpoint: Endpoint) => BridgeServer;
  /** a surface the broker names, as the run's client is handed it: the page's facts and its port; null: none */
  readonly surfaceOf: (
    run: string,
    surfaceId: string,
  ) => { readonly page: Omit<BridgePage, "runKey">; readonly port: BrowserAgentPort } | null;
  /** counts and words only: never a URL, a key or a path */
  readonly log: (line: { readonly event: string; readonly [k: string]: unknown }) => void;
}

export interface PagesBridge extends PagesBridgePort, BridgeHand {
  /** listens; each route names the port it answers */
  start(): Promise<{ readonly port: number }>;
  stop(): Promise<void>;
}

export function createPagesBridge(deps: PagesBridgeDeps): PagesBridge {
  /** the URL arm's own key delivered, taken by arm in the same call */
  const delivered = new Map<string, string | null>();
  const keyring = deps.makeKeyring((route, url) => {
    delivered.set(route, url);
  });
  const calls = new Map<string, CallRefusal[]>();
  const endpoint = deps.makeEndpoint((r) => {
    let list = calls.get(r.callId);
    if (list === undefined) {
      list = [];
      calls.set(r.callId, list);
      while (calls.size > REFUSAL_CALLS_KEPT) {
        const oldest = calls.keys().next().value;
        if (oldest === undefined) break;
        calls.delete(oldest);
      }
    }
    if (list.length < REFUSALS_PER_CALL) list.push(r);
  });
  const server = deps.makeServer(keyring, endpoint);
  let port: number | null = null;
  const routes = new Set<string>();
  /** run → surface → the page its grant named */
  const granted = new Map<string, Map<string, string>>();
  /** the page a live grant named for the surface (one page is one run's); undefined: no run holds it */
  const pageOf = (surfaceId: string): string | undefined => {
    for (const pages of granted.values()) {
      const pageId = pages.get(surfaceId);
      if (pageId !== undefined) return pageId;
    }
    return undefined;
  };

  return {
    async start() {
      const at = await server.listen();
      port = at.port;
      return { port };
    },
    stop: () => server.close(),
    addRun(run) {
      if (port === null) throw new Error("the bridge is not listening");
      if (routes.has(run)) return;
      keyring.addRoute({ routeKey: run, port });
      routes.add(run);
      deps.log({ event: "desktop.pages.bridge_route_added" });
    },
    arm(run) {
      delivered.delete(run);
      const { epoch } = keyring.arm(run);
      const url = delivered.get(run);
      delivered.delete(run);
      if (typeof url !== "string") throw new Error("the run's key was not delivered");
      return { url, epoch };
    },
    raced: (run) => keyring.ledger(run).some((row) => row.replayedAt !== undefined),
    async revokeRun(run) {
      keyring.revoke(run);
      delivered.delete(run);
      routes.delete(run);
      server.closeRun(run);
      deps.log({ event: "desktop.pages.bridge_route_revoked" });
    },
    async grant(run, surfaceId, lease): Promise<PagesGrantAnswer> {
      const surface = deps.surfaceOf(run, surfaceId);
      if (surface === null) return { ok: false, refused: "not-handed" };
      const verdict = endpoint.grant(run, { ...surface.page, runKey: run }, surface.port, lease);
      if (!verdict.ok) return { ok: false, refused: verdict.code };
      const pages = granted.get(run) ?? new Map<string, string>();
      pages.set(surfaceId, surface.page.pageId);
      granted.set(run, pages);
      return { ok: true, targetId: surface.port.targetId };
    },
    async endGrant(run, surfaceId) {
      const pages = granted.get(run);
      const pageId = pages?.get(surfaceId);
      if (pages === undefined || pageId === undefined) return;
      pages.delete(surfaceId);
      if (pages.size === 0) granted.delete(run);
      endpoint.ungrant(pageId, "grant-end");
    },
    // the endpoint's plans never reject, and the hand does not wait for the page's answers
    hold(surfaceId) {
      const pageId = pageOf(surfaceId);
      if (pageId !== undefined) void endpoint.hold(pageId);
    },
    putDown(surfaceId) {
      const pageId = pageOf(surfaceId);
      if (pageId !== undefined) void endpoint.putDown(pageId);
    },
    introduce(run, surfaceId) {
      const pageId = granted.get(run)?.get(surfaceId);
      return pageId === undefined ? 0 : endpoint.announce(pageId);
    },
    refusals(callId) {
      const list = calls.get(callId) ?? [];
      calls.delete(callId);
      return list;
    },
  };
}
