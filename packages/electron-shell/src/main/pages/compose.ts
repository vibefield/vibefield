// EY-1 (7b, 2026-11-19) — THE PAGES PLANE, COMPOSED FOR MAIN. One instance of each part per attached pair, joined
// here so every part sees the same others:
//   windows   ONE `createWindows`, shared by the broker and the bridge's endpoint (the bridge never makes one); its
//             pins are the page owners' (each bound page's agent port), and its grace lines go to main's log at warn;
//   journal   ONE, the endpoint's;
//   bridge    8d's: the keyring, the endpoint and the socket, made from factories; the socket listens at the first
//             agent call, never at boot, on 127.0.0.1 alone;
//   broker    the engine's supervisor and the runs (`createPagesBroker`), on the control targets, the bridge and the
//             windows.
// The engine off the bridge (2026-11-24): the bridge's keyring is the one record of which connection spent which key,
// so the broker's link reads it (`liveAt`), and the socket is handed that keyring through `releasesTold`: a connection
// the socket lets go is told to the broker once the keyring has let it go.
// The control targets are main's ONE registry (authority-production's), read through three seams: a surface's live
// binding, its page state (the authority's `agentPageState`) and its page class (its profile's).
//
// A run's own panes (row 4, 2026-11-19) are made over main's custody (`custody`, the live-surface authority): the
// broker's maker asks it for a page in the run's own session, and the pane store over it closes, names and moves
// them. No page the person hands is the agent's before EY-5: the broker refuses a signed-in page first.

import {
  PAGES_STILL_MAX_BYTES,
  type ShellSurfacesControlParams,
  type ShellSurfacesControlResult,
  SURFACE_AUTHORITY_LIMITS,
} from "@vibefield/contracts";
import type { LiveSurfaceAuthority } from "../live-surfaces/authority";
import type {
  BrowserAgentPageState,
  BrowserControlTargetBinding,
  BrowserControlTargetWebContents,
} from "../live-surfaces/browser-control-target";
import type { BrowserAgentPort } from "../live-surfaces/browser-electron-native";
import type { BrowserSurfaceAgent } from "../live-surfaces/browser-producer";
import { isAllowedBrowserTopLevelUrl } from "../live-surfaces/browser-security";
import {
  type PagesBroker,
  PagesBrokerError,
  type PagesLinkPort,
  type PagesMadeGone,
  type PagesMakerPort,
  type PagesPanesPort,
  type PagesTargetsPort,
} from "./broker/broker";
import { type CreatePagesBrokerDeps, createPagesBroker } from "./broker/index";
import { cleanEvent } from "./core/events";
import { createJournal } from "./core/journal";
import { createKeyring } from "./core/keys";
import { classify } from "./core/policy";
import { pagesScriptMatcher } from "./core/script-match";
import {
  ACT_LEASE_MS_PROPOSED,
  type Journal,
  type Keyring,
  type PageClass,
  type PagePins,
  type PinHandle,
  type Windows,
} from "./core/types";
import { createWindows } from "./core/windows";
import { createPagesBridge } from "./endpoint/bridge";
import { createEndpoint, type EndpointDeps, type EndpointEngine } from "./endpoint/endpoint";
import { type BridgeServerDeps, createBridgeServer } from "./endpoint/server";

/** A line of the bridge, its endpoint or its socket: counts and words only (each module's own rule). */
export type PagesBridgeLine = { readonly event: string; readonly [k: string]: unknown };

/** Main's log, as the plane writes it: an event and its fields, never a URL, a key, a title or a path. */
export interface PagesLog {
  info(event: string, fields: Readonly<Record<string, unknown>>): void;
  warn(event: string, fields: Readonly<Record<string, unknown>>): void;
}

export interface ComposePagesDeps {
  /** the ONE registry's live binding of a surface (`lookupPrivate`): null with no window, or once Electron no longer
   * resolves its target */
  readonly lookupBinding: (surfaceId: string) => BrowserControlTargetBinding | null;
  /** a browser page's state by its surface, bound or not (the authority's `agentPageState`) */
  readonly pageState: (surfaceId: string) => BrowserAgentPageState | null;
  /** a page's class by its profile (authority-production's `pageClass`); null: no browser page */
  readonly pageClass: (surfaceId: string) => PageClass | null;
  /** EY-1 (7b, 2026-11-19): main's custody of a run's own pages (the live-surface authority) */
  readonly custody: Pick<
    LiveSurfaceAuthority,
    "makeForRun" | "madeBy" | "closeMade" | "rebindRun" | "endRun" | "keepForRun"
  >;
  /** a bound page's agent port (`browserAgentPortOf`): null once its debugger is gone */
  readonly portOf: (contents: BrowserControlTargetWebContents) => BrowserAgentPort | null;
  /** what Browser.getVersion answers */
  readonly engine: () => EndpointEngine;
  /** points and key-like input (the endpoint's `input.ts`) */
  readonly input: EndpointDeps["input"];
  /** `ws`'s server in noServer mode (`endpoint/wss.ts`) */
  readonly makeWss: BridgeServerDeps["makeWss"];
  /** the engine's own: its pinned path, the package's identity, main's environment, the testing kill's hook */
  readonly broker: Pick<
    CreatePagesBrokerDeps,
    "enginePath" | "packaged" | "appBundlePath" | "env" | "onSpawned"
  >;
  readonly log: PagesLog;
  /** each bridge line, as it is logged (a smoke's record); absent: none kept */
  readonly onBridgeLine?: (line: PagesBridgeLine) => void;
  /** a row's own makers; absent: the product's */
  readonly makeBroker?: (deps: CreatePagesBrokerDeps) => PagesBroker;
  readonly makeEndpoint?: typeof createEndpoint;
  readonly makeServer?: typeof createBridgeServer;
}

export interface PagesComposition {
  /** an agent's call (the shell provider's `controlSurface`): the bridge listens at the first */
  control(
    p: ShellSurfacesControlParams,
    ctx: { readonly signal: AbortSignal; readonly deadlineAt: number },
  ): Promise<ShellSurfacesControlResult>;
  /** every run's engine ended and the socket closed; no call is answered after */
  stop(reason: "quit" | "shell-exit"): Promise<void>;
  /** EY-1 (7b, 2026-11-19): custody let a run's made page go before any window adopted it (the
   * authority's `onMadeDisposed`) */
  madeGone(run: string, surfaceId: string, why: PagesMadeGone): void;
  /** EY-1 (2026-11-24, a fieldd that was replaced): every run the broker holds is ended, the ones custody never held
   * among them (a run that made no page). Main asks it beside custody's own end of its runs, when a fieldd with
   * another boot identity attaches. Bounded by the control call's own deadline; never rejects. Its answer: how many
   * runs the broker held, and how many did not end in time because a call still held their turn. */
  endEveryRun(): Promise<{ readonly runs: number; readonly unended: number }>;
  readonly broker: PagesBroker;
  readonly windows: Windows;
  readonly journal: Journal;
}

/** CDP's protocol version, as Chrome's Browser.getVersion says it. */
export const PAGES_CDP_PROTOCOL_VERSION = "1.3";

/** Browser.getVersion's answer from the engine's own agent (`engineAgentOf`) and the process's versions. Electron
 * names no Chromium revision, so none is said. */
export function pagesEngineOf(
  agent: Pick<BrowserSurfaceAgent, "userAgent">,
  versions: { readonly chrome?: string; readonly v8?: string },
): EndpointEngine {
  return {
    product: `Chrome/${versions.chrome ?? ""}`,
    userAgent: agent.userAgent,
    protocolVersion: PAGES_CDP_PROTOCOL_VERSION,
    revision: "",
    jsVersion: versions.v8 ?? "",
  };
}

/** Main's name for each line a part of the pages plane logs (the broker, its engine's supervisor, the windows): the
 * part's own event under main's `desktop.`, each written here as its own literal. A line a part adds that is not
 * named here is logged as `desktop.pages.unnamed`, its own name a field, until it is; a row holds the table to the
 * parts' sources. */
export const PAGES_DESKTOP_EVENTS: Readonly<Record<string, string>> = {
  "pages.broker.command_refused": "desktop.pages.broker.command_refused",
  "pages.broker.popup_failed": "desktop.pages.broker.popup_failed",
  "pages.broker.rebind_refused": "desktop.pages.broker.rebind_refused",
  "pages.broker.run_ended_refused": "desktop.pages.broker.run_ended_refused",
  "pages.broker.runs_ended": "desktop.pages.broker.runs_ended",
  "pages.broker.signed_in_refused": "desktop.pages.broker.signed_in_refused",
  "pages.broker.still_refused": "desktop.pages.broker.still_refused",
  "pages.broker.stop": "desktop.pages.broker.stop",
  "pages.call": "desktop.pages.call",
  "pages.engine.close": "desktop.pages.engine.close",
  "pages.engine.gone": "desktop.pages.engine.gone",
  "pages.engine.hook": "desktop.pages.engine.hook",
  "pages.engine.introduced": "desktop.pages.engine.introduced",
  "pages.engine.reaped": "desktop.pages.engine.reaped",
  "pages.engine.ready": "desktop.pages.engine.ready",
  "pages.engine.refused": "desktop.pages.engine.refused",
  "pages.engine.root": "desktop.pages.engine.root",
  "pages.engine.unended": "desktop.pages.engine.unended",
  "pages.engine.unready": "desktop.pages.engine.unready",
  "pages.fetch_grace": "desktop.pages.fetch_grace",
  "pages.made": "desktop.pages.made",
  "pages.made_refused": "desktop.pages.made_refused",
  "pages.output": "desktop.pages.output",
  "pages.race": "desktop.pages.race",
  "pages.roots.swept": "desktop.pages.roots.swept",
};

/** An error's kind for a warn line, never its message. */
function errorKind(error: unknown): string {
  if (typeof error === "object" && error !== null && "kind" in error) return String(error.kind);
  return "INTERNAL";
}

/** The keyring as the bridge's socket is handed it (2026-11-24, the engine off the bridge). A connection the socket
 * lets go (its close, or a handshake that never finished) is told by the route whose key it spent, AFTER the keyring
 * has let it go, so whoever is told reads the keyring as it now stands. A connection that claimed no key is no
 * route's and is told to nobody. Everything else is the keyring's own. */
export function releasesTold(keyring: Keyring, told: (routeKey: string) => void): Keyring {
  const routeOf = new Map<string, string>();
  return {
    addRoute: (r) => keyring.addRoute(r),
    arm: (routeKey) => keyring.arm(routeKey),
    claim: (requestPath, connId) => {
      const claim = keyring.claim(requestPath, connId);
      if (claim.ok) routeOf.set(connId, claim.routeKey);
      return claim;
    },
    released: (connId) => {
      keyring.released(connId);
      const routeKey = routeOf.get(connId);
      if (routeKey === undefined) return;
      routeOf.delete(connId);
      told(routeKey);
    },
    revoke: (routeKey) => keyring.revoke(routeKey),
    ledger: (routeKey) => keyring.ledger(routeKey),
    liveConnections: (routeKey) => keyring.liveConnections(routeKey),
  };
}

/** A page with no port: its window's pin answers gone and holds nothing. */
const GONE_PIN: PinHandle = Object.freeze({
  applied: Promise.resolve("gone" as const),
  release: () => {},
});

export function composePages(deps: ComposePagesDeps): PagesComposition {
  const portOfSurface = (surfaceId: string): BrowserAgentPort | null => {
    const binding = deps.lookupBinding(surfaceId);
    return binding === null ? null : deps.portOf(binding.contents);
  };
  const pins: PagePins = { pin: (pageId) => portOfSurface(pageId)?.pin() ?? GONE_PIN };
  const partLine =
    (level: keyof PagesLog) =>
    (event: string, fields: Readonly<Record<string, unknown>>): void => {
      const named = PAGES_DESKTOP_EVENTS[event];
      if (named !== undefined) deps.log[level](named, fields);
      else deps.log[level]("desktop.pages.unnamed", { event, ...fields });
    };
  const windows = createWindows({
    actLeaseMs: ACT_LEASE_MS_PROPOSED,
    pins,
    log: partLine("warn"),
  });
  const journal = createJournal();
  // the bridge's, the endpoint's and the socket's lines name their own events, each under `desktop.`
  const bridgeLine =
    (level: keyof PagesLog) =>
    (line: PagesBridgeLine): void => {
      const { event, ...fields } = line;
      deps.log[level](event, fields);
      deps.onBridgeLine?.(line);
    };
  const targets: PagesTargetsPort = {
    lookup: (surfaceId) => {
      const binding = deps.lookupBinding(surfaceId);
      if (binding === null) return null;
      const { producerEpoch, controlBindingRevision, page } = binding;
      return { producerEpoch, controlBindingRevision, page };
    },
    parked: (surfaceId) => deps.pageState(surfaceId)?.parked === true,
    describe: (surfaceId) => {
      const state = deps.pageState(surfaceId);
      return state === null ? null : { url: state.url, title: state.title };
    },
    pageClass: (surfaceId) => deps.pageClass(surfaceId),
    view: (surfaceId) => {
      const state = deps.pageState(surfaceId);
      return state === null
        ? null
        : { logicalViewport: state.logicalViewport, deviceScaleFactor: state.deviceScaleFactor };
    },
  };
  // a run's own panes over main's custody: its kind errors become the maker's three words
  const maker: PagesMakerPort = {
    make: (o) => {
      try {
        return { ok: true, surfaceId: deps.custody.makeForRun(o).surfaceId };
      } catch (error) {
        const kind =
          typeof error === "object" && error !== null && "kind" in error ? error.kind : null;
        if (kind === "RESOURCE_EXHAUSTED") return { ok: false, refused: "desk-full" };
        if (kind === "UNAVAILABLE") return { ok: false, refused: "no-window" };
        // custody's one PRECONDITION_FAILED of a make is a run it has ended (2026-11-24): its own word, never the
        // window's, which sent the person after a window that was open
        if (kind === "PRECONDITION_FAILED") return { ok: false, refused: "run-ended" };
        throw error;
      }
    },
    addressAllowed: isAllowedBrowserTopLevelUrl,
    runEnded: (run) => {
      void deps.custody.endRun(run).catch((error: unknown) => {
        // the run's session was not cleared: said, with the error's kind alone
        deps.log.warn("desktop.pages.run_end_failed", { kind: errorKind(error) });
      });
    },
    // EY-1 (S1, 2026-11-24): the run was told of the page: custody holds it for its run
    named: (run, surfaceId) => {
      deps.custody.keepForRun(run, surfaceId);
    },
  };
  const panes: PagesPanesPort = {
    made: (run, surfaceId) => deps.custody.madeBy(surfaceId) === run,
    pageClosed: async (run, surfaceId) => {
      deps.custody.closeMade(run, surfaceId);
    },
    runRebound: (from, to) => deps.custody.rebindRun(from, to),
  };
  // the broker is made after the bridge it drives; an endpoint's give-back before it exists has nothing to give
  let broker: PagesBroker | undefined;
  const makeEndpoint = deps.makeEndpoint ?? createEndpoint;
  const makeServer = deps.makeServer ?? createBridgeServer;
  // the bridge's ONE keyring, kept here for the broker's link: with none made, no engine is on the bridge
  let keyring: Keyring | undefined;
  const link: PagesLinkPort = {
    liveAt: (run, epoch) =>
      keyring?.liveConnections(run).some((connection) => connection.epoch === epoch) === true,
  };
  const bridge = createPagesBridge({
    makeKeyring: (deliver) => {
      keyring = createKeyring({ deliver });
      return keyring;
    },
    makeEndpoint: (refused) =>
      makeEndpoint({
        engine: deps.engine,
        windows,
        classify: (q) => classify(q, { matchScript: pagesScriptMatcher() }),
        journal,
        clean: cleanEvent,
        // a run's own panes, by the broker's one path
        make: async (o) => {
          if (broker === undefined) return { ok: false, refused: "no-window" };
          return broker.make(o);
        },
        closeMade: async ({ runKey, pageId }) => {
          await broker?.closeMade(runKey, pageId);
        },
        // whether the run made the page, by custody's record, held from the make: the endpoint's close
        // asks it
        made: (runKey, pageId) => panes.made(runKey, pageId),
        giveBack: async ({ runKey, pageId }) =>
          broker === undefined
            ? { ok: false, refused: "not-granted" }
            : broker.giveBack(runKey, pageId),
        input: deps.input,
        stillMaxBytes: PAGES_STILL_MAX_BYTES,
        log: bridgeLine("warn"),
        refused,
      }),
    // the socket's keyring tells the broker of each connection it lets go
    makeServer: (ring, endpoint) =>
      makeServer({
        keyring: releasesTold(ring, (run) => broker?.bridgeClosed(run)),
        endpoint,
        makeWss: deps.makeWss,
        log: bridgeLine("info"),
      }),
    // a page's facts as the run's client is handed it. Before EY-5 every page an agent works is its own: no
    // signed-in page reaches here, so no site is said and no Public Suffix List is asked. No path argument is the
    // run's: a still is written at a path the broker mints in the folder fieldd names on its call (2026-11-24: the
    // broker now does; until then nothing read that folder).
    surfaceOf: (_run, surfaceId) => {
      const binding = deps.lookupBinding(surfaceId);
      const pageClass = deps.pageClass(surfaceId);
      if (binding === null || pageClass === null) return null;
      const port = deps.portOf(binding.contents);
      if (port === null) return null;
      return { page: { pageId: surfaceId, pageClass, site: null, runFolder: null }, port };
    },
    log: bridgeLine("info"),
  });
  const made = (deps.makeBroker ?? createPagesBroker)({
    ...deps.broker,
    targets,
    bridge,
    link,
    windows,
    maker,
    panes,
    log: partLine("info"),
    warn: partLine("warn"),
  });
  broker = made;
  let listening: Promise<unknown> | null = null;
  let stopped = false;
  return {
    async control(p, ctx) {
      if (stopped) throw new PagesBrokerError("UNAVAILABLE", "engine-stopped");
      listening ??= bridge.start();
      try {
        await listening;
      } catch {
        // the next call listens again, so the engine is starting as far as a caller can tell: the
        // room's words say to try again in a moment. Nothing of the failure is said but its word.
        listening = null;
        deps.log.warn("desktop.pages.bridge_listen_failed", {});
        throw new PagesBrokerError("UNAVAILABLE", "engine-starting");
      }
      return made.control(p, ctx);
    },
    async stop(reason) {
      stopped = true;
      await made.stop(reason);
      const opened = listening;
      listening = null;
      if (opened !== null)
        await opened.then(
          () => bridge.stop(),
          () => undefined,
        );
    },
    madeGone(run, surfaceId, why) {
      made.madeGone(run, surfaceId, why);
    },
    async endEveryRun() {
      if (stopped) return { runs: 0, unended: 0 };
      try {
        return await made.endEveryRun(Date.now() + SURFACE_AUTHORITY_LIMITS.CONTROL_DEADLINE_MS);
      } catch (error) {
        // said with the error's kind alone, and nothing stops for it
        deps.log.warn("desktop.pages.runs_end_failed", { kind: errorKind(error) });
        return { runs: 0, unended: 0 };
      }
    },
    broker: made,
    windows,
    journal,
  };
}
