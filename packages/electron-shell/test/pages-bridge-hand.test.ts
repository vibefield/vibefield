// EY-1 (2026-11-24) — the person's hand, from the page's own edge to the client's session, on the plane as main
// composes it: the real windows, journal, policy, endpoint, bridge and broker core; a stand-in page, engine and
// engine socket. A pick-up on the page (the binding's `onHeld`) must reach the session a client left its route on,
// as Fetch.disable, and the put-down must set the route again. No engine starts; the bridge's socket listens on
// loopback for the row and is closed at its end.
import { describe, expect, it, vi } from "vitest";
import type {
  BrowserControlTargetBinding,
  BrowserControlTargetWebContents,
} from "../src/main/live-surfaces/browser-control-target";
import { PagesBrokerCore, type PagesEnginesPort } from "../src/main/pages/broker/broker";
import type { PagesDaemonExchange } from "../src/main/pages/broker/daemon-client";
import { composePages } from "../src/main/pages/compose";
import { createEndpoint, type Endpoint } from "../src/main/pages/endpoint/endpoint";
import { agentInput } from "../src/main/pages/endpoint/input";
import { client, fakePort } from "./pages-wall-kit";

const SURFACE = "surface_page_000000001";
const DEVTOOLS = "D".repeat(32);

/** A page whose hold the row makes, as the page's producer says each edge of it. */
class HandPage {
  held = false;
  readonly listeners = new Set<(held: boolean) => void>();
  onHeld(listener: (held: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  hand(held: boolean): void {
    this.held = held;
    for (const listener of this.listeners) listener(held);
  }
}

function plane() {
  const contents = { id: 7 } as unknown as BrowserControlTargetWebContents;
  const page = new HandPage();
  const a = fakePort(DEVTOOLS);
  const binding: BrowserControlTargetBinding = {
    surfaceId: SURFACE,
    producerEpoch: 1,
    controlBindingRevision: 1,
    webContentsId: 7,
    targetId: DEVTOOLS,
    contents,
    page,
  };
  const ok = (data: unknown): PagesDaemonExchange => ({ ok: true, reply: { success: true, data } });
  const root = "/r/pg-00000001";
  const socketPath = `${root}/sock/namespaces/pages/run/0123456789abcdef.sock`;
  const engines: PagesEnginesPort = {
    ensure: async (run) => ({
      ok: true,
      engine: {
        run,
        generation: 1,
        socketPath,
        surroundings: {
          root,
          socketDir: `${root}/sock`,
          home: `${root}/home`,
          tmp: `${root}/tmp`,
          cwd: `${root}/cwd`,
          session: "0123456789abcdef",
          socketPath,
        },
      },
    }),
    stop: async () => {},
    replace: async () => {},
    stopAll: async () => ({ ended: 0, unended: 0 }),
    stats: () => ({ engines: 0, starts: 0, exits: 0 }),
    onExit: () => () => {},
  };
  let endpoint: Endpoint | undefined;
  const composed = composePages({
    lookupBinding: (surfaceId) => (surfaceId === SURFACE ? binding : null),
    pageState: () => null,
    pageClass: (surfaceId) => (surfaceId === SURFACE ? "own" : null),
    custody: {
      makeForRun: () => {
        throw new Error("no page is made in this row");
      },
      madeBy: () => null,
      closeMade: () => true,
      rebindRun: () => true,
      keepForRun: () => true,
      endRun: async () => ({ disposed: 0, clearing: "none" }),
    },
    portOf: () => a.port,
    engine: () => ({
      product: "Chrome/150.0.0.0",
      userAgent: "agent",
      protocolVersion: "1.3",
      revision: "",
      jsVersion: "15.0",
    }),
    input: agentInput,
    makeWss: () => ({ handleUpgrade: () => {}, close: () => {} }),
    broker: { enginePath: () => null, packaged: false, appBundlePath: null, env: {} },
    log: { info: () => {}, warn: () => {} },
    // the real broker core on the plane's own bridge and windows; the engine and its socket are stand-ins
    makeBroker: (deps) =>
      new PagesBrokerCore({
        targets: deps.targets,
        bridge: deps.bridge,
        // the engine is a stand-in and joins no socket: its connection is said to stand, so the launch is taken
        // (the broker reads the link since it replaces an engine that left the bridge)
        link: { liveAt: () => true },
        windows: deps.windows,
        engines,
        exchange: async (_path, command) => {
          if (command.action === "tab_list") {
            return ok({ tabs: [{ tabId: "t1", targetId: DEVTOOLS, active: true }] });
          }
          return ok({});
        },
      }),
    makeEndpoint: (deps) => {
      endpoint = createEndpoint(deps);
      return endpoint;
    },
  });
  return {
    composed,
    page,
    a,
    endpoint: (): Endpoint => {
      if (endpoint === undefined) throw new Error("the endpoint was not made");
      return endpoint;
    },
  };
}

describe("the person's hand on the composed plane (EY-1, 2026-11-24)", () => {
  it("a pick-up on the page frees the route a client left on it, and the put-down sets it again", async () => {
    const p = plane();
    try {
      // the run's first call grants the page, so the broker hears the page's hold from then on
      const first = await p.composed.control(
        { run: "run-1", surfaceId: SURFACE, window: "read", command: { action: "snapshot" } },
        { signal: new AbortController().signal, deadlineAt: Date.now() + 5_000 },
      );
      expect(first).toMatchObject({ status: "done" });
      const c = client(p.endpoint());
      const s = await c.attach(DEVTOOLS);
      const route = { patterns: [{ urlPattern: "*" }] };
      // a call's act window, in which the run's client leaves a route
      expect(
        p.composed.windows.open(SURFACE, { kind: "act", callId: "call-route", action: "route" }),
      ).toEqual({ ok: true });
      expect((await c.call("Fetch.enable", route, s)).answer?.result).toEqual({});
      p.composed.windows.close(SURFACE, "call-route");
      const sent = p.a.sessions[0]?.sent ?? [];
      expect(sent).toEqual([{ method: "Fetch.enable", params: route }]);
      p.page.hand(true);
      expect(p.composed.windows.state(SURFACE).held).toBe(true);
      await vi.waitFor(() =>
        expect(sent).toEqual([
          { method: "Fetch.enable", params: route },
          { method: "Fetch.disable", params: {} },
        ]),
      );
      p.page.hand(false);
      expect(p.composed.windows.state(SURFACE).held).toBe(false);
      await vi.waitFor(() =>
        expect(sent).toEqual([
          { method: "Fetch.enable", params: route },
          { method: "Fetch.disable", params: {} },
          { method: "Fetch.enable", params: route },
        ]),
      );
    } finally {
      await p.composed.stop("quit");
    }
  });
});
