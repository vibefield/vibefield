// EY-1 (2026-11-24) — THE PINNED ENGINE'S ATTACH, MODELLED, on the pages plane as main composes it. For the rows that
// hold what happens to a page between its making and the engine's first word on it.
//
// The plane is the real one: the windows core, the journal, the method policy, the endpoint, the bridge with its real
// keyring, and the broker core. A page is a stand-in (a port whose client sessions answer every command), custody is a
// stand-in that makes one when asked, and the engine is this model, joined to the bridge through the keyring's own
// claim, as the socket joins a real one.
//
// The model is the pin's source (agent-browser v0.41.0, commit 1453dd3), read on 2026-11-24, cut to the part that
// decides whether the engine knows a page:
// - At its connect (browser.rs `discover_and_attach_targets`) it turns discovery on, lists the targets, attaches to
//   every page, and takes as its active page the first that answers a probe, where an error is an answer
//   (`find_live_page_index`, `renderer_responds`). On that page alone it enables its domains (`prepare_domains`):
//   Page, Runtime, Network, each of which must pass, then two it does not wait on. A refused Page.enable fails the
//   connect, so the launch.
// - It reads the bridge's target events only in its drain (actions.rs `drain_cdp_events`, `apply_drained_events`):
//   first thing in every command (`execute_command`), and on a 100 ms tick while no command runs (daemon.rs
//   `spawn_background_tick_if_idle`). A page it is told was attached has its domains enabled and is registered ONLY IF
//   they pass; a page it is told was created is attached, then the same. A page whose enable was refused is dropped
//   with a warning: the event is spent, and nothing tells the engine of that page again.
// - A page it registers by an event becomes its active page (`register_discovered_page`, a session that is not
//   pinned).
// - `tab_list` lists the pages it holds; `tab_switch` to a target it does not hold fails ("No tab with target id").
//
// What the model leaves out: everything the engine does on a page it already knows.

import type {
  BrowserAgentPage,
  BrowserAgentPopups,
  BrowserControlTargetBinding,
  BrowserControlTargetWebContents,
} from "../src/main/live-surfaces/browser-control-target";
import type { BrowserAgentPort } from "../src/main/live-surfaces/browser-electron-native";
import { PagesBrokerCore, type PagesEnginesPort } from "../src/main/pages/broker/broker";
import type {
  PagesDaemonCommand,
  PagesDaemonExchange,
} from "../src/main/pages/broker/daemon-client";
import { composePages, type PagesBridgeLine } from "../src/main/pages/compose";
import { agentInput } from "../src/main/pages/endpoint/input";
import type { BridgeServerDeps } from "../src/main/pages/endpoint/server";
import { client, type FakeSession, type Frame, fakePort } from "./pages-wall-kit";

const ok = (data: unknown): PagesDaemonExchange => ({ ok: true, reply: { success: true, data } });
const no = (error: string): PagesDaemonExchange => ({ ok: true, reply: { success: false, error } });

/** The domains the engine enables on a page, in its order; each must pass (browser.rs `prepare_domains`). */
const ENGINE_DOMAINS = ["Page.enable", "Runtime.enable", "Network.enable"] as const;

interface ModelPage {
  readonly targetId: string;
  readonly sessionId: string;
}

/** The pinned engine, as far as its knowledge of pages goes. */
export class EngineModel {
  /** the pages the engine holds, in its order */
  readonly pages: ModelPage[] = [];
  /** the index of its active page; -1 with none */
  active = -1;
  /** every command the broker sent it */
  readonly commands: PagesDaemonCommand[] = [];
  /** what it does while it holds a command that is not its own to answer, when a row says */
  during: ((command: PagesDaemonCommand) => Promise<unknown>) | undefined;
  #client: ReturnType<typeof client> | null = null;
  #cursor = 0;

  constructor(private readonly socket: () => BridgeServerDeps) {}

  /** Whether the engine holds a page by this target. */
  knows(targetId: string): boolean {
    return this.pages.some((page) => page.targetId === targetId);
  }

  /** The broker's exchange with the engine's socket. */
  async exchange(command: PagesDaemonCommand): Promise<PagesDaemonExchange> {
    this.commands.push(command);
    if (command.action === "launch") {
      return (await this.#connect(String(command.cdpUrl))) ? ok({ launched: true }) : no("connect");
    }
    // every command begins with the drain
    await this.drain();
    if (command.action === "tab_list") {
      return ok({
        tabs: this.pages.map((page, index) => ({
          tabId: `t${index + 1}`,
          targetId: page.targetId,
          active: index === this.active,
        })),
      });
    }
    if (command.action === "tab_switch") {
      const at = this.pages.findIndex((page) => page.targetId === String(command.tabId));
      const page = this.pages[at];
      if (page === undefined) return no(`No tab with target id \`${String(command.tabId)}\``);
      await this.#probe(page.sessionId);
      if (!(await this.#enable(page.sessionId))) return no("Page.enable");
      this.active = at;
      return ok({});
    }
    return ok((await this.during?.(command)) ?? {});
  }

  /** The idle tick: the drain with no command, as the engine runs it every 100 ms while it is idle. */
  tick(): Promise<void> {
    return this.drain();
  }

  /** The engine's drain of the bridge's target events. */
  async drain(): Promise<void> {
    const c = this.#client;
    if (c === null) return;
    const events = c.frames.slice(this.#cursor).filter((frame) => frame.id === undefined);
    this.#cursor = c.frames.length;
    let created: string[] = [];
    let attached: ModelPage[] = [];
    for (const event of events) {
      const info = event.params?.targetInfo as { targetId?: unknown; type?: unknown } | undefined;
      const targetId = typeof info?.targetId === "string" ? info.targetId : null;
      if (event.method === "Target.targetDestroyed") {
        const gone = event.params?.targetId;
        const at = this.pages.findIndex((page) => page.targetId === gone);
        if (at >= 0) {
          this.pages.splice(at, 1);
          this.active = Math.min(this.active, this.pages.length - 1);
        }
        created = created.filter((id) => id !== gone);
        attached = attached.filter((page) => page.targetId !== gone);
      } else if (targetId === null || info?.type !== "page") {
        // a tab, a frame, a worker: nothing the model holds
      } else if (event.method === "Target.targetCreated") {
        if (!this.knows(targetId) && !created.includes(targetId)) created.push(targetId);
      } else if (event.method === "Target.attachedToTarget" && event.sessionId === undefined) {
        const sessionId = event.params?.sessionId;
        if (typeof sessionId === "string") attached.push({ targetId, sessionId });
      }
    }
    // a page it was told was attached: its domains, and registered only if they pass
    for (const page of attached) {
      if (await this.#enable(page.sessionId)) this.#register(page);
    }
    // a page it was told was created: attached, then the same
    for (const targetId of created) {
      const answer = (await c.call("Target.attachToTarget", { targetId, flatten: true })).answer;
      const sessionId = answer?.result?.sessionId;
      if (typeof sessionId !== "string") continue;
      if (await this.#enable(sessionId)) this.#register({ targetId, sessionId });
    }
  }

  async #connect(cdpUrl: string): Promise<boolean> {
    const { keyring, endpoint } = this.socket();
    const claim = keyring.claim(new URL(cdpUrl).pathname, `engine-${this.commands.length}`);
    if (!claim.ok) return false;
    const c = client(endpoint, claim.routeKey);
    this.#client = c;
    this.#cursor = 0;
    this.pages.length = 0;
    this.active = -1;
    await c.call("Target.setDiscoverTargets", { discover: true });
    const listed = (await c.call("Target.getTargets")).answer?.result?.targetInfos;
    for (const info of Array.isArray(listed) ? (listed as Frame["params"][]) : []) {
      if (info?.type !== "page" || typeof info.targetId !== "string") continue;
      this.pages.push({ targetId: info.targetId, sessionId: await c.attach(info.targetId) });
    }
    const first = this.pages[0];
    // the model makes no tab of its own: main grants a page before any engine starts
    if (first === undefined) return false;
    await this.#probe(first.sessionId);
    this.active = 0;
    return this.#enable(first.sessionId);
  }

  /** The liveness probe: an error is an answer, so its result is not read. */
  async #probe(sessionId: string): Promise<void> {
    await this.#client?.call(
      "Runtime.evaluate",
      { expression: "1", returnByValue: true },
      sessionId,
    );
  }

  async #enable(sessionId: string): Promise<boolean> {
    const c = this.#client;
    if (c === null) return false;
    for (const method of ENGINE_DOMAINS) {
      if ((await c.call(method, {}, sessionId)).answer?.error !== undefined) return false;
    }
    // the two it does not wait on: one the bridge refuses for good, one it narrows
    await c.call("WebMCP.enable", {}, sessionId);
    await c.call(
      "Target.setAutoAttach",
      { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
      sessionId,
    );
    return true;
  }

  #register(page: ModelPage): void {
    if (this.knows(page.targetId)) return;
    this.pages.push(page);
    this.active = this.pages.length - 1;
  }
}

/** A page custody makes for a run: bound at once unless the row binds it itself. */
interface MadePage {
  readonly surfaceId: string;
  readonly targetId: string;
  /** the run it was made for; empty for a person's page */
  readonly run: string;
  readonly url: string;
  readonly port: BrowserAgentPort;
  readonly sessions: FakeSession[];
  readonly contents: BrowserControlTargetWebContents;
  /** the page as its binding hands it: never held here, and its pop-up policy kept for the row to ask */
  readonly page: BrowserAgentPage;
  /** the pop-up policy the broker set on the page while an act window stood on it; null: none */
  policy: BrowserAgentPopups | null;
  bound: boolean;
  closed: boolean;
}

/** The pages plane as main composes it, over a stand-in custody and the engine's model. */
export function enginePlane() {
  const made: MadePage[] = [];
  /** custody's stand-in, as a row sets it: whether a page it makes is bound at once, or when the row says */
  const custody = { bindAtOnce: true };
  const lines: PagesBridgeLine[] = [];
  const logged: { readonly event: string; readonly fields: Readonly<Record<string, unknown>> }[] =
    [];
  let socket: BridgeServerDeps | undefined;
  const engine = new EngineModel(() => {
    if (socket === undefined) throw new Error("the bridge's socket was not made");
    return socket;
  });
  const bySurface = (surfaceId: string): MadePage | undefined =>
    made.find((page) => page.surfaceId === surfaceId && !page.closed);
  const binding = (m: MadePage): BrowserControlTargetBinding => ({
    surfaceId: m.surfaceId,
    producerEpoch: 1,
    controlBindingRevision: 1,
    webContentsId: 100 + made.indexOf(m),
    targetId: m.targetId,
    contents: m.contents,
    page: m.page,
  });
  const root = "/r/pg-00000001";
  const socketPath = `${root}/sock/namespaces/pages/run/0123456789abcdef.sock`;
  // who the supervisor tells of an engine's exit
  const exits = new Set<(run: string, generation: number) => void>();
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
    onExit: (listener) => {
      exits.add(listener);
      return () => exits.delete(listener);
    },
  };
  /** A page custody makes: for a run, or with no run (a person's page, handed to an agent). */
  const newPage = (run: string, url: string): MadePage => {
    const n = made.length + 1;
    const targetId = n.toString(16).toUpperCase().padStart(32, "0");
    const { port, sessions } = fakePort(targetId);
    const m: MadePage = {
      surfaceId: `surface_made_${String(n).padStart(9, "0")}`,
      targetId,
      run,
      url,
      port,
      sessions,
      contents: { id: 100 + n } as unknown as BrowserControlTargetWebContents,
      page: {
        held: false,
        onHeld: () => () => {},
        popups: (policy) => {
          m.policy = policy;
        },
      },
      policy: null,
      bound: custody.bindAtOnce,
      closed: false,
    };
    made.push(m);
    return m;
  };
  const plane = composePages({
    lookupBinding: (surfaceId) => {
      const m = bySurface(surfaceId);
      return m === undefined || !m.bound ? null : binding(m);
    },
    pageState: (surfaceId) => {
      const m = bySurface(surfaceId);
      return m === undefined
        ? null
        : {
            parked: false,
            url: m.url,
            title: "",
            logicalViewport: { width: 1280, height: 800 },
            deviceScaleFactor: 2,
          };
    },
    pageClass: (surfaceId) => (bySurface(surfaceId) === undefined ? null : "own"),
    custody: {
      makeForRun: (order) => ({ surfaceId: newPage(order.run, order.url).surfaceId }),
      // a person's page was made for no run
      madeBy: (surfaceId) => bySurface(surfaceId)?.run || null,
      // as custody's own: a page that is not the run's is never closed for it
      closeMade: (run, surfaceId) => {
        const m = bySurface(surfaceId);
        if (m === undefined || m.run !== run) return false;
        m.closed = true;
        return true;
      },
      rebindRun: () => true,
      keepForRun: () => true,
      endRun: async () => ({ disposed: 0, clearing: "none" }),
    },
    portOf: (contents) => made.find((m) => m.contents === contents)?.port ?? null,
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
    log: {
      info: (event, fields) => logged.push({ event, fields }),
      warn: (event, fields) => logged.push({ event, fields }),
    },
    onBridgeLine: (line) => lines.push(line),
    // the real broker core on the plane's own bridge, link and windows; the engine's socket is the model
    makeBroker: (deps) =>
      new PagesBrokerCore({
        targets: deps.targets,
        bridge: deps.bridge,
        link: deps.link,
        windows: deps.windows,
        engines,
        ...(deps.maker === undefined ? {} : { maker: deps.maker }),
        ...(deps.panes === undefined ? {} : { panes: deps.panes }),
        ...(deps.log === undefined ? {} : { log: deps.log }),
        ...(deps.warn === undefined ? {} : { warn: deps.warn }),
        madePollMs: 1,
        exchange: async (_path, command) => engine.exchange(command),
      }),
    // the bridge's socket is the row's own: nothing listens, and the model joins by the keyring's own claim
    makeServer: (deps) => {
      socket = deps;
      return {
        listen: async () => ({ host: "127.0.0.1", port: 4321 }),
        close: async () => {},
        closeRun: () => {},
      };
    },
  });
  const within = (): { readonly signal: AbortSignal; readonly deadlineAt: number } => ({
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 2_000,
  });
  return {
    plane,
    engine,
    custody,
    made,
    lines,
    logged,
    within,
    /** the supervisor's word that the run's engine exited (its idle end, say): the run's next call launches another */
    engineExited: (run: string): void => {
      for (const listener of [...exits]) listener(run, 1);
    },
    /** what the bridge refused a client, by its method and word */
    refusals: (): { readonly method: unknown; readonly code: unknown }[] =>
      lines
        .filter((line) => line.event === "desktop.pages.bridge_refused")
        .map((line) => ({ method: line.method, code: line.code })),
    /** A person's page on the desk, which an agent may be handed: custody holds no run of it. */
    handed: (url: string): string => newPage("", url).surfaceId,
    /** the page custody made under a surface */
    pageOf: (surfaceId: string): MadePage => {
      const m = made.find((candidate) => candidate.surfaceId === surfaceId);
      if (m === undefined) throw new Error(`custody made no page ${surfaceId}`);
      return m;
    },
  };
}

export type EnginePlane = ReturnType<typeof enginePlane>;
