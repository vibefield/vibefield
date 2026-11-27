import { EventEmitter } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  type LiveSurfaceBrowserSourceV1,
  PAGES_MADE_DEVICE_SCALE,
  PAGES_MADE_VIEWPORT,
  type ShellSurfacesControlParams,
  type ShellSurfacesControlResult,
  SURFACE_AUTHORITY_LIMITS,
} from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { LiveSurfaceAuthority } from "../src/main/live-surfaces/authority";
import {
  type BrowserAgentPageState,
  type BrowserControlTargetBinding,
  BrowserControlTargetRegistry,
  type BrowserControlTargetWebContents,
} from "../src/main/live-surfaces/browser-control-target";
import type { BrowserAgentPort } from "../src/main/live-surfaces/browser-electron-native";
import {
  BrowserLiveSurfaceRuntime,
  type BrowserSurfaceNative,
  type BrowserSurfaceNativeWindow,
  type BrowserSurfaceNativeWindowOptions,
  type BrowserSurfacePaint,
  engineAgentOf,
} from "../src/main/live-surfaces/browser-producer";
import { browserSurfacePartition } from "../src/main/live-surfaces/browser-security";
import {
  type PagesBroker,
  PagesBrokerCore,
  PagesBrokerError,
  type PagesEnginesPort,
  type PagesMakeAnswer,
} from "../src/main/pages/broker/broker";
import type {
  PagesDaemonCommand,
  PagesDaemonExchange,
} from "../src/main/pages/broker/daemon-client";
import { type CreatePagesBrokerDeps, productionStills } from "../src/main/pages/broker/index";
import {
  type ComposePagesDeps,
  composePages,
  PAGES_CDP_PROTOCOL_VERSION,
  PAGES_DESKTOP_EVENTS,
  type PagesBridgeLine,
  pagesEngineOf,
} from "../src/main/pages/compose";
import { BRIDGE_OK, type PageClass, type PageLease } from "../src/main/pages/core/types";
import type { Endpoint, EndpointDeps } from "../src/main/pages/endpoint/endpoint";
import type { BridgeServerDeps } from "../src/main/pages/endpoint/server";

// EY-1 (7b, 2026-11-19): the pages plane as main composes it, on fakes for the broker, the endpoint and the socket.
// The bridge between them is 8d's own (createPagesBridge), as main makes it.

const SURFACE = "surface_page_000000001";
const LEASE: PageLease = { runKey: "run-1", producerEpoch: 1, bindingRevision: 1 };
const ANSWER: ShellSurfacesControlResult = { status: "refused", fact: "gone" };

function harness(o: Partial<ComposePagesDeps> = {}) {
  const contents = { id: 7 } as unknown as BrowserControlTargetWebContents;
  const page = { held: false, onHeld: () => () => {} };
  const bindings = new Map<string, BrowserControlTargetBinding>([
    [
      SURFACE,
      {
        surfaceId: SURFACE,
        producerEpoch: 3,
        controlBindingRevision: 5,
        webContentsId: 7,
        targetId: "t".repeat(32),
        contents,
        page,
      },
    ],
  ]);
  const states = new Map<string, BrowserAgentPageState>();
  const classes = new Map<string, PageClass>([[SURFACE, "own"]]);
  const port = { targetId: "t".repeat(32) } as unknown as BrowserAgentPort;
  const ports = new Map<object, BrowserAgentPort>([[contents, port]]);
  const broker = {
    control: vi.fn(async (): Promise<ShellSurfacesControlResult> => ANSWER),
    giveBack: vi.fn(() => ({ ok: true }) as ReturnType<PagesBroker["giveBack"]>),
    make: vi.fn(async (): Promise<PagesMakeAnswer> => ({ ok: false, refused: "no-window" })),
    closeMade: vi.fn(async () => {}),
    madeGone: vi.fn(),
    bridgeClosed: vi.fn((_run: string) => {}),
    endEveryRun: vi.fn(async (_deadlineAt: number) => ({ runs: 0, unended: 0 })),
    stop: vi.fn(async () => {}),
    stats: () => ({ engines: 0, starts: 0, exits: 0, raced: 0, calls: 0 }),
  } satisfies PagesBroker;
  const endpoint: Endpoint = {
    grant: vi.fn(() => BRIDGE_OK),
    ungrant: vi.fn(),
    connect: () => ({ message: async () => {}, closed: () => {} }),
    hold: async () => {},
    putDown: async () => {},
    announce: () => 0,
  };
  // main's custody of a run's own pages (the live-surface authority)
  const custody = {
    makeForRun: vi.fn<ComposePagesDeps["custody"]["makeForRun"]>(() => ({
      surfaceId: "surface_made_000000001",
    })),
    madeBy: vi.fn((_surfaceId: string): string | null => null),
    closeMade: vi.fn((_run: string, _surfaceId: string) => true),
    rebindRun: vi.fn((_from: string, _to: string) => true),
    keepForRun: vi.fn((_run: string, _surfaceId: string) => true),
    endRun: vi.fn<ComposePagesDeps["custody"]["endRun"]>(async () => ({
      disposed: 0,
      clearing: "none",
    })),
  } satisfies ComposePagesDeps["custody"];
  let brokerDeps: CreatePagesBrokerDeps | undefined;
  let endpointDeps: EndpointDeps | undefined;
  const log = { info: vi.fn(), warn: vi.fn() };
  const lines: PagesBridgeLine[] = [];
  const plane = composePages({
    lookupBinding: (surfaceId) => bindings.get(surfaceId) ?? null,
    pageState: (surfaceId) => states.get(surfaceId) ?? null,
    pageClass: (surfaceId) => classes.get(surfaceId) ?? null,
    custody,
    portOf: (c) => ports.get(c) ?? null,
    engine: () => pagesEngineOf({ userAgent: "agent" }, { chrome: "150.0.0.0", v8: "15.0" }),
    input: ({ call }) => ({ verdict: BRIDGE_OK, call }),
    makeWss: () => ({ handleUpgrade: () => {}, close: () => {} }),
    broker: { enginePath: () => null, packaged: false, appBundlePath: null, env: {} },
    log,
    onBridgeLine: (line) => lines.push(line),
    makeBroker: (deps) => {
      brokerDeps = deps;
      return broker;
    },
    makeEndpoint: (deps) => {
      endpointDeps = deps;
      return endpoint;
    },
    ...o,
  });
  const made = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) throw new Error(`${name} was not made`);
    return value;
  };
  return {
    plane,
    broker,
    custody,
    endpoint,
    bindings,
    states,
    classes,
    ports,
    contents,
    port,
    log,
    lines,
    brokerDeps: () => made(brokerDeps, "the broker"),
    endpointDeps: () => made(endpointDeps, "the endpoint"),
  };
}

const ctx = () => ({ signal: new AbortController().signal, deadlineAt: Date.now() + 5_000 });
const params = (): ShellSurfacesControlParams => ({
  run: "run-1",
  surfaceId: SURFACE,
  window: "read",
  command: { action: "snapshot" },
});

describe("the pages plane, composed (EY-1 7b)", () => {
  it("one windows instance reaches the broker and the endpoint, one journal the endpoint, and its give-back is the broker's", async () => {
    const h = harness();
    expect(h.brokerDeps().windows).toBe(h.plane.windows);
    expect(h.endpointDeps().windows).toBe(h.plane.windows);
    expect(h.endpointDeps().journal).toBe(h.plane.journal);
    h.broker.giveBack.mockReturnValueOnce({ ok: false, refused: "held" });
    expect(await h.endpointDeps().giveBack({ runKey: "run-1", pageId: SURFACE })).toEqual({
      ok: false,
      refused: "held",
    });
    expect(h.broker.giveBack).toHaveBeenCalledWith("run-1", SURFACE);
  });

  it("a run's new pane and its close are the broker's, and custody's word that a made page went reaches it", async () => {
    const h = harness();
    const made: PagesMakeAnswer = {
      ok: true,
      pageId: "surface_made_000000001",
      targetId: "t".repeat(32),
    };
    h.broker.make.mockResolvedValueOnce(made);
    const order = { runKey: "run-1", callId: "call-1", url: "https://a.test/" };
    expect(await h.endpointDeps().make(order)).toEqual(made);
    expect(h.broker.make).toHaveBeenCalledWith(order);
    await h.endpointDeps().closeMade({ runKey: "run-1", pageId: SURFACE });
    expect(h.broker.closeMade).toHaveBeenCalledWith("run-1", SURFACE);
    h.plane.madeGone("run-1", SURFACE, "grace");
    expect(h.broker.madeGone).toHaveBeenCalledWith("run-1", SURFACE, "grace");
    // the endpoint's close asks custody's record whether the run made the page
    h.custody.madeBy.mockReturnValue("run-1");
    expect(h.endpointDeps().made("run-1", SURFACE)).toBe(true);
    expect(h.endpointDeps().made("run-2", SURFACE)).toBe(false);
  });

  it("the broker's maker and pane store are custody's: its kind errors become three words, its reads and closes pass", async () => {
    const h = harness();
    const { maker, panes } = h.brokerDeps();
    if (maker === undefined || panes === undefined) throw new Error("no maker or pane store");
    const order = {
      run: "run-1",
      url: "https://a.test/",
      by: "tab" as const,
      logicalViewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
    };
    expect(maker.make(order)).toEqual({ ok: true, surfaceId: "surface_made_000000001" });
    expect(h.custody.makeForRun).toHaveBeenCalledWith(order);
    const words = [
      [{ kind: "UNAVAILABLE", state: "no-window" }, "no-window"],
      // custody's own refusal of a run it has ended (2026-11-24): its own word, never the window's
      [{ kind: "PRECONDITION_FAILED" }, "run-ended"],
      [{ kind: "RESOURCE_EXHAUSTED", state: "desk-full" }, "desk-full"],
    ] as const;
    for (const [error, refused] of words) {
      h.custody.makeForRun.mockImplementationOnce(() => {
        throw error;
      });
      expect(maker.make(order)).toEqual({ ok: false, refused });
    }
    h.custody.makeForRun.mockImplementationOnce(() => {
      throw new Error("a fault");
    });
    expect(() => maker.make(order)).toThrow("a fault");
    // the desk's room is not the maker's to say (2026-11-24): custody's make refuses a full desk by itself
    expect(maker).not.toHaveProperty("deskHasRoom");
    expect(maker.addressAllowed("https://a.test/")).toBe(true);
    expect(maker.addressAllowed("javascript:alert(1)")).toBe(false);
    maker.runEnded("run-1");
    expect(h.custody.endRun).toHaveBeenCalledWith("run-1");
    h.custody.madeBy.mockReturnValue("run-1");
    expect(panes.made("run-1", SURFACE)).toBe(true);
    expect(panes.made("run-2", SURFACE)).toBe(false);
    await panes.pageClosed("run-1", SURFACE);
    expect(h.custody.closeMade).toHaveBeenCalledWith("run-1", SURFACE);
    expect(panes.runRebound("run-1", "run-2")).toBe(true);
    expect(h.custody.rebindRun).toHaveBeenCalledWith("run-1", "run-2");
    h.custody.rebindRun.mockReturnValueOnce(false);
    expect(panes.runRebound("run-1", "run-3")).toBe(false);
    // a run's end custody could not finish: said, with its kind alone
    h.custody.endRun.mockRejectedValueOnce({ kind: "INTERNAL", detail: "a path" });
    maker.runEnded("run-2");
    await vi.waitFor(() =>
      expect(h.log.warn).toHaveBeenCalledWith("desktop.pages.run_end_failed", { kind: "INTERNAL" }),
    );
  });

  it("the maker's word that a run was told of a page is custody's keep", () => {
    const h = harness();
    const { maker } = h.brokerDeps();
    if (maker?.named === undefined) throw new Error("the maker does not say a named page");
    maker.named("run-1", SURFACE);
    expect(h.custody.keepForRun).toHaveBeenCalledWith("run-1", SURFACE);
  });

  it("the broker's targets read the registry's binding, the page's state, its size and its class", () => {
    const h = harness();
    const targets = h.brokerDeps().targets;
    expect(targets.lookup(SURFACE)).toEqual({
      producerEpoch: 3,
      controlBindingRevision: 5,
      page: h.bindings.get(SURFACE)?.page,
    });
    expect(targets.lookup("surface_none_000000002")).toBeNull();
    const view = { logicalViewport: { width: 390, height: 844 }, deviceScaleFactor: 3 };
    h.states.set(SURFACE, { parked: true, url: "https://a.test/kept", title: "Kept", ...view });
    expect(targets.parked(SURFACE)).toBe(true);
    expect(targets.describe(SURFACE)).toEqual({ url: "https://a.test/kept", title: "Kept" });
    expect(targets.view?.(SURFACE)).toEqual(view);
    expect(targets.view?.("surface_none_000000002")).toBeNull();
    expect(targets.parked("surface_none_000000002")).toBe(false);
    expect(targets.describe("surface_none_000000002")).toBeNull();
    h.classes.set(SURFACE, "signed-in");
    expect(targets.pageClass(SURFACE)).toBe("signed-in");
    expect(targets.pageClass("surface_none_000000002")).toBeNull();
  });

  it("the bridge hands a bound page with its port and class, no site and no run folder; no binding, class or port hands nothing", async () => {
    const h = harness();
    const bridge = h.brokerDeps().bridge;
    expect(await bridge.grant("run-1", SURFACE, LEASE)).toEqual({
      ok: true,
      targetId: "t".repeat(32),
    });
    expect(h.endpoint.grant).toHaveBeenCalledWith(
      "run-1",
      { pageId: SURFACE, pageClass: "own", site: null, runFolder: null, runKey: "run-1" },
      h.port,
      LEASE,
    );
    h.ports.delete(h.contents);
    expect(await bridge.grant("run-2", SURFACE, LEASE)).toEqual({
      ok: false,
      refused: "not-handed",
    });
    h.classes.delete(SURFACE);
    expect(await bridge.grant("run-3", SURFACE, LEASE)).toEqual({
      ok: false,
      refused: "not-handed",
    });
    h.bindings.delete(SURFACE);
    expect(await bridge.grant("run-4", SURFACE, LEASE)).toEqual({
      ok: false,
      refused: "not-handed",
    });
    expect(h.endpoint.grant).toHaveBeenCalledTimes(1);
  });

  it("the broker's link is the keyring's own live connections, and a connection the socket lets go is told to the broker once it is gone", async () => {
    // EY-1 (2026-11-24, the engine off the bridge): the socket here is a row's own, so no port is listened on
    let socket: BridgeServerDeps | undefined;
    const h = harness({
      makeServer: (deps) => {
        socket = deps;
        return {
          listen: async () => ({ host: "127.0.0.1", port: 4321 }),
          close: async () => {},
          closeRun: () => {},
        };
      },
    });
    try {
      await h.plane.control(params(), ctx());
      const { bridge, link } = h.brokerDeps();
      const keyring = socket?.keyring;
      if (keyring === undefined) throw new Error("the socket was not made");
      bridge.addRun("run-1");
      const armed = bridge.arm("run-1");
      // armed and not yet connected: the engine is not on the bridge
      expect(link.liveAt("run-1", armed.epoch)).toBe(false);
      expect(keyring.claim(new URL(armed.url).pathname, "conn-1")).toMatchObject({ ok: true });
      expect(link.liveAt("run-1", armed.epoch)).toBe(true);
      expect(link.liveAt("run-1", armed.epoch + 1)).toBe(false);
      expect(link.liveAt("run-2", armed.epoch)).toBe(false);
      expect(h.broker.bridgeClosed).not.toHaveBeenCalled();
      const seen: boolean[] = [];
      h.broker.bridgeClosed.mockImplementation((run) => {
        seen.push(link.liveAt(run, armed.epoch));
      });
      keyring.released("conn-1");
      expect(h.broker.bridgeClosed).toHaveBeenCalledWith("run-1");
      // told after the keyring let it go: the broker's own read finds it gone
      expect(seen).toEqual([false]);
      // a connection that claimed no key is no run's
      keyring.released("conn-9");
      keyring.released("conn-1");
      expect(h.broker.bridgeClosed).toHaveBeenCalledTimes(1);
    } finally {
      await h.plane.stop("quit");
    }
  });

  it("logs: the endpoint's lines at warn and the socket's at info, each to the smoke's record; the broker's main's own, prefixed", () => {
    const h = harness();
    h.endpointDeps().log({ event: "desktop.pages.endpoint_line", count: 1 });
    expect(h.log.warn).toHaveBeenCalledWith("desktop.pages.endpoint_line", { count: 1 });
    expect(h.lines).toEqual([{ event: "desktop.pages.endpoint_line", count: 1 }]);
    h.brokerDeps().log?.("pages.broker.stop", { runs: 0 });
    expect(h.log.info).toHaveBeenCalledWith("desktop.pages.broker.stop", { runs: 0 });
    h.brokerDeps().warn?.("pages.broker.signed_in_refused", { run: "run-1", surfaceId: SURFACE });
    expect(h.log.warn).toHaveBeenCalledWith("desktop.pages.broker.signed_in_refused", {
      run: "run-1",
      surfaceId: SURFACE,
    });
    // a line no table row names yet is still said, under one name, with its own
    h.brokerDeps().log?.("pages.not_yet_named", { count: 2 });
    expect(h.log.info).toHaveBeenCalledWith("desktop.pages.unnamed", {
      event: "pages.not_yet_named",
      count: 2,
    });
  });

  it("the table names every event the broker, its supervisor and the windows log, each under desktop.", () => {
    const pages = join(import.meta.dirname, "../src/main/pages");
    const sources = [
      "broker/broker.ts",
      "broker/engine-supervisor.ts",
      "broker/index.ts",
      "core/windows.ts",
    ];
    const logged = new Set<string>();
    for (const file of sources) {
      const text = readFileSync(join(pages, file), "utf8");
      for (const m of text.matchAll(/\b(?:log|warn)\?\.\(\s*"(pages\.[a-z_.]+)"/g)) {
        logged.add(m[1] ?? "");
      }
    }
    // the scan read the sources: the windows' own line is among them
    expect([...logged]).toContain("pages.fetch_grace");
    // inclusion: every literal the four log is a row, under desktop. (no count: the parts may log fewer)
    for (const event of logged) expect(PAGES_DESKTOP_EVENTS[event]).toBe(`desktop.${event}`);
  });

  it("the table names the two lines item 658 gave the supervisor: an engine not usable after its ready wait, and a testing hook that threw (2026-11-26)", () => {
    expect(PAGES_DESKTOP_EVENTS["pages.engine.unready"]).toBe("desktop.pages.engine.unready");
    expect(PAGES_DESKTOP_EVENTS["pages.engine.hook"]).toBe("desktop.pages.engine.hook");
    // and the supervisor says both, so the scan above holds them too
    const supervisor = readFileSync(
      join(import.meta.dirname, "../src/main/pages/broker/engine-supervisor.ts"),
      "utf8",
    );
    expect(supervisor).toContain('log?.("pages.engine.unready"');
    expect(supervisor).toContain('log?.("pages.engine.hook"');
  });

  it("the plane ends every run the broker holds, with the control call's own bound, and never rejects", async () => {
    // EY-1 (2026-11-24, a fieldd that was replaced): main asks this beside custody's own end of its runs
    const h = harness();
    const ended = h.broker.endEveryRun;
    ended.mockResolvedValueOnce({ runs: 2, unended: 0 });
    const plane = h.plane;
    const before = Date.now();
    expect(await plane.endEveryRun()).toEqual({ runs: 2, unended: 0 });
    const deadlineAt = ended.mock.calls[0]?.[0] ?? 0;
    expect(deadlineAt).toBeGreaterThanOrEqual(
      before + SURFACE_AUTHORITY_LIMITS.CONTROL_DEADLINE_MS,
    );
    // a broker that throws is said, and stops nothing
    ended.mockRejectedValueOnce(new Error("no"));
    expect(await plane.endEveryRun()).toEqual({ runs: 0, unended: 0 });
    expect(h.log.warn).toHaveBeenCalledWith("desktop.pages.runs_end_failed", { kind: "INTERNAL" });
    await h.plane.stop("quit");
    expect(await plane.endEveryRun()).toEqual({ runs: 0, unended: 0 });
    expect(ended).toHaveBeenCalledTimes(2);
  });

  it("an agent's call is the broker's once the socket listens, and after stop nothing is answered", async () => {
    const h = harness();
    try {
      expect(await h.plane.control(params(), ctx())).toEqual(ANSWER);
      expect(h.broker.control).toHaveBeenCalledTimes(1);
      await h.plane.stop("quit");
      expect(h.broker.stop).toHaveBeenCalledWith("quit");
      const after = await h.plane.control(params(), ctx()).catch((error: unknown) => error);
      expect(after).toBeInstanceOf(PagesBrokerError);
      expect(after).toMatchObject({ kind: "UNAVAILABLE", state: "engine-stopped" });
      expect(h.broker.control).toHaveBeenCalledTimes(1);
    } finally {
      // whatever a row found, its socket is closed
      await h.plane.stop("quit");
    }
  });

  it("Browser.getVersion's answer is the engine's own agent and the process's versions, no revision said", () => {
    expect(
      pagesEngineOf({ userAgent: "Mozilla/5.0 agent" }, { chrome: "150.0.1.2", v8: "15.0" }),
    ).toEqual({
      product: "Chrome/150.0.1.2",
      userAgent: "Mozilla/5.0 agent",
      protocolVersion: PAGES_CDP_PROTOCOL_VERSION,
      revision: "",
      jsVersion: "15.0",
    });
  });
});

// EY-1 (S1, 2026-11-24): the seam every other row here fakes one side of. Custody's make, the producer's start and
// the registry's binding are each the REAL one, and so are the broker and the bridge between them; only the native
// window, the engine and its socket are fakes. Nothing attaches a window to the page at any point.

/** A native window that does what it is told and says nothing, with its paints the row's to send. */
class QuietWindow implements BrowserSurfaceNativeWindow {
  destroyed = false;
  muted = false;
  readonly loadedUrls: string[] = [];
  readonly #paint = new Set<(paint: BrowserSurfacePaint) => void>();
  constructor(
    readonly options: BrowserSurfaceNativeWindowOptions,
    readonly controlContents: BrowserControlTargetWebContents & { destroyed: boolean },
  ) {}
  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  destroy(): void {
    this.destroyed = true;
    this.controlContents.destroyed = true;
  }
  setFrameRate(): void {}
  startPainting(): void {}
  stopPainting(): void {}
  setAudioMuted(muted: boolean): void {
    this.muted = muted;
  }
  invalidate(): void {}
  async setBackingRaster(requested: { width: number; height: number }) {
    return requested;
  }
  async setEmulation(): Promise<void> {}
  async dispatchMouse(): Promise<void> {}
  async dispatchTouch(): Promise<void> {}
  async dispatchKey(): Promise<void> {}
  async dispatchText(): Promise<void> {}
  async dispatchCompose(): Promise<void> {}
  async setFocused(): Promise<void> {}
  navigate(): void {}
  async fetchIcon(): Promise<null> {
    return null;
  }
  onPaint(listener: (paint: BrowserSurfacePaint) => void): () => void {
    this.#paint.add(listener);
    return () => this.#paint.delete(listener);
  }
  /** A frame of the page's own document, on a shared texture. */
  paint(): void {
    const size = { width: 640, height: 360 };
    const frame: BrowserSurfacePaint = {
      texture: {
        release: () => {},
        textureInfo: {
          widgetType: "frame",
          pixelFormat: "bgra",
          codedSize: size,
          colorSpace: { matrix: "rgb", primaries: "bt709", range: "full", transfer: "srgb" },
          visibleRect: { x: 0, y: 0, ...size },
          contentRect: { x: 0, y: 0, ...size },
          timestamp: 42,
          metadata: {},
          handle: {},
        },
      },
      image: { getSize: () => size, toBitmap: () => new Uint8Array(0) },
    };
    for (const listener of [...this.#paint]) listener(frame);
  }
  onNavigationState = (): (() => void) => () => {};
  onCursor = (): (() => void) => () => {};
  onFavicon = (): (() => void) => () => {};
  onScale = (): (() => void) => () => {};
  onUnresponsive = (): (() => void) => () => {};
  onInputHung = (): (() => void) => () => {};
  onRefused = (): (() => void) => () => {};
  onRenderProcessGone = (): (() => void) => () => {};
  onDestroyed = (): (() => void) => () => {};
}

/** The real custody, producer and registry under a composed plane whose broker is the real core. `stills`: the
 * disk a row's stills are read from (the product's own, on a real folder); with none, the broker takes no still. */
function seam(
  o: {
    readonly stills?: typeof productionStills;
    /** the product windows custody sees; none given, one */
    readonly productWindows?: () => readonly number[];
  } = {},
) {
  const windows: QuietWindow[] = [];
  const targets = new Map<string, BrowserControlTargetWebContents>();
  const native: BrowserSurfaceNative = {
    createWindow: (options) => {
      const index = windows.length + 1;
      const targetId = `target-${index}`;
      const contents = Object.assign(new EventEmitter(), {
        id: 100 + index,
        destroyed: false,
        isDestroyed: () => contents.destroyed,
        getOrCreateDevToolsTargetId: () => targetId,
      });
      targets.set(targetId, contents);
      const window = new QuietWindow(options, contents);
      windows.push(window);
      return window;
    },
    monotonicNowUs: () => 1n,
    engineAgent: () =>
      engineAgentOf({
        chrome: "150.0.0.0",
        platform: "darwin",
        arch: "arm64",
        systemVersion: "26",
      }),
  };
  const registry = new BrowserControlTargetRegistry({
    resolveTarget: (targetId) => targets.get(targetId),
  });
  const runtimes = new Map<string, BrowserLiveSurfaceRuntime>();
  const timers: { readonly run: () => void; readonly ms: number; cleared: boolean }[] = [];
  const notHere = (): never => {
    throw new Error("only browser pages here");
  };
  let plane: ReturnType<typeof composePages> | undefined;
  const authority = new LiveSurfaceAuthority({
    // no window ever mints, attaches or owns anything in these rows
    resolveWindow: () => null,
    hostFor: () => null,
    factories: {
      browser: (surfaceId, source) => {
        const runtime = new BrowserLiveSurfaceRuntime({
          surfaceId,
          source,
          native,
          controlTargets: registry,
        });
        runtimes.set(surfaceId, runtime);
        return runtime;
      },
      sckWindow: notHere,
      iosSimulator: notHere,
      iosSimulatorDevice: notHere,
    },
    enumeration: null,
    productWindows: o.productWindows ?? (() => [7]),
    timers: {
      setTimeout: (run, ms) => {
        const timer = { run, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (handle) => {
        (handle as { cleared: boolean }).cleared = true;
      },
    },
    // EY-1 (C8, 2026-11-24): as main wires it: custody's four words, `failed` among them
    onMadeDisposed: (run, surfaceId, why) => plane?.madeGone(run, surfaceId, why),
  });
  const sent: PagesDaemonCommand[] = [];
  let active = "none";
  const ok = (data: unknown): PagesDaemonExchange => ({ ok: true, reply: { success: true, data } });
  // what the engine does while it holds a call's command, and what it answers, when a row says
  const engine: { during?: (command: PagesDaemonCommand) => Promise<unknown> } = {};
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
  const endpoint: Endpoint = {
    grant: () => BRIDGE_OK,
    ungrant: () => {},
    connect: () => ({ message: async () => {}, closed: () => {} }),
    hold: async () => {},
    putDown: async () => {},
    announce: () => 0,
  };
  // the bridge's socket is the row's own: nothing listens, and the engine's connect is the keyring's own claim
  let socket: BridgeServerDeps | undefined;
  let connections = 0;
  plane = composePages({
    lookupBinding: (surfaceId) => registry.lookupPrivate(surfaceId),
    pageState: (surfaceId) => authority.agentPageState(surfaceId),
    pageClass: (surfaceId) => (runtimes.has(surfaceId) ? "own" : null),
    custody: authority,
    // every bound page has a port: its target's id, and a pin that holds nothing
    portOf: (contents) =>
      ({
        targetId: contents.getOrCreateDevToolsTargetId(),
        pin: () => ({ applied: Promise.resolve("gone" as const), release: () => {} }),
      }) as unknown as BrowserAgentPort,
    engine: () => pagesEngineOf({ userAgent: "agent" }, { chrome: "150.0.0.0", v8: "15.0" }),
    input: ({ call }) => ({ verdict: BRIDGE_OK, call }),
    makeWss: () => ({ handleUpgrade: () => {}, close: () => {} }),
    broker: { enginePath: () => null, packaged: false, appBundlePath: null, env: {} },
    log: { info: () => {}, warn: () => {} },
    makeBroker: (deps) =>
      new PagesBrokerCore({
        targets: deps.targets,
        bridge: deps.bridge,
        link: deps.link,
        windows: deps.windows,
        engines,
        ...(deps.maker === undefined ? {} : { maker: deps.maker }),
        ...(deps.panes === undefined ? {} : { panes: deps.panes }),
        madePollMs: 1,
        exchange: async (_path, command) => {
          sent.push(command);
          if (command.action === "launch") {
            // the engine joins the bridge by the launch's keyed address, once, as the real one does
            connections += 1;
            const joined = socket?.keyring.claim(
              new URL(String(command.cdpUrl)).pathname,
              `engine-${connections}`,
            );
            return joined?.ok === true
              ? ok({ launched: true })
              : { ok: false, failure: "not-sent" };
          }
          if (command.action === "tab_list") {
            return ok({ tabs: [{ tabId: "t1", targetId: active, active: true }] });
          }
          if (command.action === "tab_switch") active = String(command.tabId);
          else return ok((await engine.during?.(command)) ?? {});
          return ok({});
        },
        ...(o.stills === undefined ? {} : { stills: o.stills() }),
      }),
    makeEndpoint: () => endpoint,
    makeServer: (deps) => {
      socket = deps;
      return {
        listen: async () => ({ host: "127.0.0.1", port: 4321 }),
        close: async () => {},
        closeRun: () => {},
      };
    },
  });
  return { plane, authority, registry, runtimes, windows, timers, sent, engine, native };
}

describe("a run's page with no window attached, on the real custody, producer and registry (EY-1 S1)", () => {
  // EY-1 (C8, 2026-11-24): a page that failed to start is custody's `failed`, and the desk is open. The run was told
  // "no window is open" for it, which sends an agent to ask the person for a window they already have.
  it("the run form's open of a page that fails before any window has it says the browser is still starting, never that no window is open", async () => {
    const s = seam();
    try {
      s.native.createWindow = () => {
        throw new Error("no window can be made here");
      };
      const startedAt = Date.now();
      const answer = await s.plane
        .control(
          { run: "run-1", window: "act", command: { action: "navigate", url: "https://a.test/" } },
          { signal: new AbortController().signal, deadlineAt: Date.now() + 5_000 },
        )
        .catch((error: unknown) => error);
      expect(answer).toMatchObject({ kind: "UNAVAILABLE", state: "engine-starting" });
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(s.authority.state()).toMatchObject({ runtimes: 0, owners: 0 });
      expect(s.sent).toEqual([]);
    } finally {
      await s.plane.stop("quit");
      s.authority.dispose();
    }
  });

  it("the run form's open is answered with its pane made, bound and granted though no window ever attached; told of it, custody keeps it", async () => {
    const s = seam();
    try {
      // before the start, this wait ran to the call's deadline and answered no-window: the deadline is short
      const answer = await s.plane
        .control(
          { run: "run-1", window: "act", command: { action: "navigate", url: "https://a.test/" } },
          { signal: new AbortController().signal, deadlineAt: Date.now() + 1_500 },
        )
        .catch((error: unknown) => error);
      // named at the address it was opened at (2026-11-24: this said about:blank, where the pane is made)
      expect(answer).toMatchObject({
        status: "done",
        made: [{ url: "https://a.test/", by: "open" }],
      });
      const surfaceId = (answer as ShellSurfacesControlResult).made?.[0]?.surfaceId ?? "";
      // custody made it for the run and no window owns or attached to it
      expect(s.authority.madeBy(surfaceId)).toBe("run-1");
      expect(s.authority.state()).toMatchObject({ runtimes: 1, owners: 0 });
      expect(s.runtimes.get(surfaceId)?.stats.activeAttachments).toBe(0);
      // its one window is in the run's own memory session, never a persistent profile, and silent
      const session: LiveSurfaceBrowserSourceV1 = {
        kind: "browser",
        initialUrl: "about:blank",
        profile: { mode: "memory", ref: "run:run-1" },
        logicalViewport: PAGES_MADE_VIEWPORT,
        deviceScaleFactor: PAGES_MADE_DEVICE_SCALE,
      };
      expect(s.windows).toHaveLength(1);
      expect(s.windows[0]?.options).toMatchObject({
        persistent: false,
        partition: browserSurfacePartition(session),
      });
      expect(s.windows[0]?.muted).toBe(true);
      // the binding the broker's wait read is the registry's own, and the engine was sent on to the page
      expect(s.registry.status(surfaceId)).toMatchObject({ bound: true, producerEpoch: 1 });
      expect(s.sent.at(-1)).toMatchObject({ action: "navigate", url: "https://a.test/" });
      // the run was told of it: the adopt grace's clock is cleared, and the page is still custody's. EY-1 (C6,
      // 2026-11-24): kept, it has the kept page's own clock, which the run's use of the page carries on
      expect(s.timers.map((timer) => [timer.ms, timer.cleared])).toEqual([
        [30_000, true],
        [30 * 60_000, false],
      ]);
      // its first frame puts it to rest with its binding kept: the run's next call on it is answered, not parked
      s.windows[0]?.paint();
      expect(s.authority.agentPageState(surfaceId)).toMatchObject({ parked: false });
      const next = await s.plane.control(
        { run: "run-1", surfaceId, window: "read", command: { action: "snapshot" } },
        { signal: new AbortController().signal, deadlineAt: Date.now() + 1_500 },
      );
      expect(next).toMatchObject({ status: "done" });
      // (C6) the call began by asking the registry for the page's binding: what custody reads as the run's use of it
      const asked = s.registry.askedAt(surfaceId);
      expect(asked).not.toBeNull();
      expect(Date.now() - (asked ?? 0)).toBeLessThan(5_000);
      // a status read is no use of the page
      s.registry.status(surfaceId);
      expect(s.registry.askedAt(surfaceId)).toBe(asked);
      expect(s.windows).toHaveLength(1);
      expect(s.windows[0]?.destroyed).toBe(false);
    } finally {
      await s.plane.stop("quit");
      s.authority.dispose();
    }
  });

  // EY-1 (2026-11-24, a run that closes its pages and opens again): what ends a run in custody is the run form's
  // close alone, sent at the run's true end. A page closed by the page form leaves the run able to open another.
  const within = () => ({ signal: new AbortController().signal, deadlineAt: Date.now() + 1_500 });
  const open = (s: ReturnType<typeof seam>, run: string, url: string) =>
    s.plane
      .control({ run, window: "act", command: { action: "navigate", url } }, within())
      .catch((error: unknown) => error);

  it("open, close that page by the page form, open again: a new pane of the same run, in the same session", async () => {
    const s = seam();
    try {
      const first = (await open(s, "run-1", "https://a.test/")) as ShellSurfacesControlResult;
      const a = first.made?.[0]?.surfaceId ?? "";
      expect(a).not.toBe("");
      const closed = await s.plane.control(
        { run: "run-1", surfaceId: a, window: "act", command: { action: "close" } },
        within(),
      );
      expect(closed).toEqual({ status: "done", output: { success: true }, closed: [a] });
      expect(s.windows[0]?.destroyed).toBe(true);
      expect(s.authority.madeBy(a)).toBeNull();
      const second = (await open(s, "run-1", "https://b.test/")) as ShellSurfacesControlResult;
      expect(second).toMatchObject({ status: "done", made: [{ by: "open" }] });
      const b = second.made?.[0]?.surfaceId ?? "";
      expect(b).not.toBe("");
      expect(b).not.toBe(a);
      expect(s.authority.madeBy(b)).toBe("run-1");
      expect(s.windows).toHaveLength(2);
      expect(s.windows[1]?.destroyed).toBe(false);
      // the run's own memory session again, and the engine it already had
      expect(s.windows[1]?.options.partition).toBe(s.windows[0]?.options.partition);
      expect(s.sent.filter((c) => c.action === "launch")).toHaveLength(1);
      expect(s.sent.at(-1)).toMatchObject({ action: "navigate", url: "https://b.test/" });
    } finally {
      await s.plane.stop("quit");
      s.authority.dispose();
    }
  });

  it("a tab the engine makes inside a call's act window has that call's window on the REAL windows, and loses it with the call", async () => {
    // EY-1 (2026-11-24, a tab's window): BU-19 on the real windows, custody and broker. Without the adopt, the new
    // page is leased with no window, and everything the engine sends it while its tab is made is refused.
    const s = seam();
    try {
      const first = (await open(s, "run-1", "https://a.test/")) as ShellSurfacesControlResult;
      const a = first.made?.[0]?.surfaceId ?? "";
      const act = { mutation: true, capture: false, script: null };
      const seen: unknown[] = [];
      let b = "";
      s.engine.during = async (command) => {
        if (command.action !== "click") return;
        const callId = s.plane.windows.state(a).window?.callId ?? "";
        const made = await s.plane.broker.make({ runKey: "run-1", callId, url: "https://b.test/" });
        if (!made.ok) throw new Error(`no tab: ${made.refused}`);
        b = made.pageId;
        // what the engine sends its new tab next is admitted, in the window of the call that made it
        seen.push(s.plane.windows.state(b).window, s.plane.windows.admit(b, act));
      };
      const clicked = await s.plane.control(
        {
          run: "run-1",
          surfaceId: a,
          window: "act",
          command: { action: "click", selector: "@e1" },
        },
        within(),
      );
      expect(clicked).toMatchObject({ status: "done", made: [{ surfaceId: b, by: "tab" }] });
      expect(b).not.toBe("");
      const calls = s.plane.windows.history(a).map((w) => w.callId);
      expect(seen).toEqual([
        expect.objectContaining({ pageId: b, kind: "act", callId: calls.at(-1), madeBy: a }),
        { ok: true },
      ]);
      // the call ended: the tab's window closed with it, and nothing passes outside a window
      expect(s.plane.windows.state(b).window).toBeNull();
      expect(s.plane.windows.history(b).at(-1)).toMatchObject({ closedBy: "call-end" });
      expect(s.plane.windows.admit(b, act)).toMatchObject({ ok: false, code: "outside-window" });
    } finally {
      await s.plane.stop("quit");
      s.authority.dispose();
    }
  });

  it("a screenshot's still is a file in the folder the call names, judged on the REAL disk: the answer names it, and no bytes cross", async () => {
    // EY-1 (2026-11-24, a still's file): the folder is the test's own, made 0700 as fieldd makes a run's, and named
    // by its real path (macOS reaches its temp folder through a link, and a folder reached through one is refused)
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0,
      0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0,
    ]);
    const s = seam({ stills: productionStills });
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "vf-pages-still-")));
    try {
      chmodSync(folder, 0o700);
      const first = (await open(s, "run-1", "https://a.test/")) as ShellSurfacesControlResult;
      const a = first.made?.[0]?.surfaceId ?? "";
      // the engine writes where it is told, as the pinned one does, and answers that path
      s.engine.during = async (command) => {
        // only ever inside the row's own folder: an engine sent no path writes nothing
        const at = command.action === "screenshot" ? command.path : undefined;
        if (typeof at !== "string" || dirname(at) !== folder) return undefined;
        writeFileSync(at, png);
        return { path: at };
      };
      const shot = { action: "screenshot", fullPage: false, annotate: false };
      const answer = await s.plane.control(
        { run: "run-1", surfaceId: a, folder, window: "read", command: shot },
        within(),
      );
      const path = answer.still?.path ?? "";
      expect(answer).toMatchObject({
        status: "done",
        still: { mime: "image/png", width: 3, height: 2, bytes: png.length },
      });
      expect(dirname(path)).toBe(folder);
      expect(basename(path)).toMatch(/^still-[0-9a-f]{32}\.png$/u);
      expect(readdirSync(folder)).toEqual([basename(path)]);
      expect(JSON.stringify(answer)).not.toContain(png.toString("base64"));
      // a folder others could read is refused before the engine is asked, and nothing is written
      chmodSync(folder, 0o755);
      const sent = s.sent.length;
      const refused = await s.plane
        .control({ run: "run-1", surfaceId: a, folder, window: "read", command: shot }, within())
        .catch((error: unknown) => error);
      expect(refused).toMatchObject({ kind: "PRECONDITION_FAILED", state: "still-folder" });
      expect(s.sent).toHaveLength(sent);
      expect(readdirSync(folder)).toHaveLength(1);
    } finally {
      await s.plane.stop("quit");
      s.authority.dispose();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("with no product window, an open hears custody's own no-window, never that the desk is full", async () => {
    // EY-1 (2026-11-24): custody's desk has no room when no window stands, and the broker asked the desk first
    const windows: number[] = [];
    const s = seam({ productWindows: () => windows });
    try {
      expect(s.authority.deskHasRoom()).toBe(false);
      expect(await open(s, "run-1", "https://a.test/")).toMatchObject({
        kind: "UNAVAILABLE",
        state: "no-window",
      });
      expect(s.authority.state()).toMatchObject({ runtimes: 0 });
      // a window opens: the same run's open is answered
      windows.push(7);
      expect(await open(s, "run-1", "https://a.test/")).toMatchObject({ status: "done" });
    } finally {
      await s.plane.stop("quit");
      s.authority.dispose();
    }
  });

  it("the run's true end, then an open under the same run: its browser has stopped, never that no window is open; another run opens", async () => {
    const s = seam();
    try {
      const first = (await open(s, "run-1", "https://a.test/")) as ShellSurfacesControlResult;
      const a = first.made?.[0]?.surfaceId ?? "";
      const ended = await s.plane.control(
        { run: "run-1", window: "act", command: { action: "close" } },
        within(),
      );
      expect(ended).toEqual({ status: "done", output: { success: true }, closed: [a] });
      expect(s.windows[0]?.destroyed).toBe(true);
      const again = await open(s, "run-1", "https://b.test/");
      expect(again).toBeInstanceOf(PagesBrokerError);
      expect(again).toMatchObject({ kind: "UNAVAILABLE", state: "engine-stopped" });
      expect(s.windows).toHaveLength(1);
      // a product window stands the whole time: another run is answered a pane
      expect(await open(s, "run-2", "https://c.test/")).toMatchObject({
        status: "done",
        made: [{ by: "open" }],
      });
    } finally {
      await s.plane.stop("quit");
      s.authority.dispose();
    }
  });
});
