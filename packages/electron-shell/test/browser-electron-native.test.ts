/**
 * PT-5b3 (ruling 4) — the Electron adapter COUNTS THE PAGE'S DOCUMENTS (main/live-surfaces/browser-electron-native.ts):
 * a commit of the page's own moves the serial; the bootstrap blank's does not; a move within one document
 * (`did-navigate-in-page`: a hash, `pushState`, `replaceState`) does not; a load that failed — the engine's error page
 * standing in the asked address's place, with no `did-navigate` (PT-5a's probe) — does; an aborted one does not. Electron
 * is a fake here: a window whose WebContents says the events the row emits.
 * PT-5c2 (F1): an error page is counted by its own word, `did-fail-provisional-load` (Electron says it only where the
 * engine's error page COMMITTED); a committed document's LATE failure — `did-fail-load` alone, its body cut — is the same
 * document, and no failure of the page: the producer over this adapter lets a key held across it up.
 */
import { describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  class Emitter {
    readonly #listeners = new Map<string, Listener[]>();
    on(event: string, listener: Listener): this {
      this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
      return this;
    }
    off(event: string, listener: Listener): this {
      this.#listeners.set(
        event,
        (this.#listeners.get(event) ?? []).filter((l) => l !== listener),
      );
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(this.#listeners.get(event) ?? [])]) listener(...args);
    }
  }
  class Contents extends Emitter {
    url = "";
    loading = false;
    readonly debugger = Object.assign(new Emitter(), {
      isAttached: (): boolean => false,
      attach: () => undefined,
      detach: () => undefined,
      sendCommand: async () => ({}),
    });
    readonly navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      clear: () => undefined,
    };
    isDestroyed = (): boolean => false;
    getURL = (): string => this.url;
    getTitle = (): string => "a title";
    isLoading = (): boolean => this.loading;
  }
  const made: { webContents: Contents; loads: string[] }[] = [];
  class BrowserWindow {
    readonly webContents = new Contents();
    readonly loads: string[] = [];
    constructor() {
      made.push(this);
    }
    loadURL(url: string): Promise<void> {
      this.loads.push(url);
      return Promise.resolve();
    }
    isDestroyed = (): boolean => false;
    setContentSize = (): void => undefined;
  }
  return { BrowserWindow, made, session: { fromPartition: () => ({}), fromPath: () => ({}) } };
});

vi.mock("electron", () => ({ BrowserWindow: electron.BrowserWindow, session: electron.session }));
// (the guards are the session's and the contents' — not this suite's; the policy is the real one: PT-5c2 runs the
// producer over this adapter)
vi.mock("../src/main/live-surfaces/browser-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/live-surfaces/browser-security")>()),
  installGuardedBrowserSurfaceContents: () => undefined,
  installGuardedBrowserSurfaceSession: () => undefined,
}));

import {
  ElectronBrowserSurfaceNative,
  FRAME_SIGHT,
  FRAME_WORDS_BINDING,
  FRAME_WORDS_SCRIPT,
  PAGE_SCALE_BINDING,
  PAGE_SCALE_SCRIPT,
  WORDS_WORLD,
} from "../src/main/live-surfaces/browser-electron-native";
import {
  BrowserLiveSurfaceRuntime,
  type BrowserSurfaceNavigationState,
} from "../src/main/live-surfaces/browser-producer";

const window = (options: { readonly hungInputMs?: number } = {}) => {
  const native = new ElectronBrowserSurfaceNative().createWindow({
    partition: "memory:test",
    persistent: false,
    logicalViewport: { width: 320, height: 180 },
    initialBackingRaster: { width: 640, height: 360 },
    deviceScaleFactor: 2,
    requestSharedTexture: true,
    ...options,
  });
  const contents = electron.made.at(-1)?.webContents;
  if (contents === undefined) throw new Error("no window was made");
  const said: BrowserSurfaceNavigationState[] = [];
  native.onNavigationState((state) => said.push(state));
  const at = (url: string): void => {
    contents.url = url;
  };
  return { native, contents, said, at };
};

describe("the Electron adapter counts the page's documents (PT-5b3, ruling 4)", () => {
  it("a commit of the page's own moves the serial — the blank's does not, a move WITHIN a document does not; a failed load's error page does, an aborted load does not; every state says the count", async () => {
    const w = window();
    // the bootstrap blank commits: plumbing — nothing is said, nothing counted
    w.at("about:blank");
    w.contents.emit("did-navigate", {}, "about:blank");
    expect(w.said).toEqual([]);
    await w.native.loadURL("https://example.test/a");
    w.contents.emit("did-start-loading");
    expect(w.said.at(-1)?.document).toBe(0);
    // the page's document commits
    w.at("https://example.test/a");
    w.contents.emit("did-navigate", {}, "https://example.test/a");
    expect(w.said.at(-1)).toMatchObject({ url: "https://example.test/a", document: 1 });
    w.contents.emit("did-stop-loading");
    expect(w.said.at(-1)?.document).toBe(1);
    // its address moves WITHIN the document: a hash, a router's pushState, a script's replaceState
    w.at("https://example.test/a#section");
    w.contents.emit("did-navigate-in-page", {}, "https://example.test/a#section", true);
    expect(w.said.at(-1)).toMatchObject({ url: "https://example.test/a#section", document: 1 });
    w.at("https://example.test/tidied");
    w.contents.emit("did-navigate-in-page", {}, "https://example.test/tidied", true);
    w.contents.emit("page-title-updated", {}, "another title");
    expect(w.said.at(-1)).toMatchObject({ url: "https://example.test/tidied", document: 1 });
    // another page commits
    w.contents.emit("did-start-loading");
    expect(w.said.at(-1)?.document).toBe(1);
    w.at("https://example.test/b");
    w.contents.emit("did-navigate", {}, "https://example.test/b");
    expect(w.said.at(-1)?.document).toBe(2);
    // a load that is ABORTED (a stop, a download, a navigation that replaced it) is no document
    w.contents.emit(
      "did-fail-provisional-load",
      {},
      -3,
      "ERR_ABORTED",
      "https://example.test/c",
      true,
    );
    w.contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "https://example.test/c", true);
    expect(w.said.at(-1)?.document).toBe(2);
    // a frame's failure is not the page's
    w.contents.emit(
      "did-fail-provisional-load",
      {},
      -102,
      "ERR_CONNECTION_REFUSED",
      "https://ad.test/",
      false,
    );
    w.contents.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "https://ad.test/", false);
    expect(w.said.at(-1)?.document).toBe(2);
    // a load that FAILED: the engine's error page stands in the asked address's place — with no `did-navigate`. PT-5c2
    // (F1): Electron's real order — `did-fail-provisional-load` (the error page COMMITTED), then `did-fail-load`, the same
    // millisecond (PT-5c2's probe `f1.cjs`: a refused connection) — counted, and the failure said, at the first
    w.at("https://dead.test/");
    w.contents.emit(
      "did-fail-provisional-load",
      {},
      -102,
      "ERR_CONNECTION_REFUSED",
      "https://dead.test/",
      true,
    );
    expect(w.said.at(-1)).toMatchObject({ url: "https://dead.test/", failure: -102, document: 3 });
    // …and its `did-fail-load` is the same error page: nothing more is counted
    w.contents.emit(
      "did-fail-load",
      {},
      -102,
      "ERR_CONNECTION_REFUSED",
      "https://dead.test/",
      true,
    );
    expect(w.said.at(-1)).toMatchObject({ url: "https://dead.test/", failure: -102, document: 3 });
    // …and the blank committing again under a remote load (the engine's reload with nothing answered: the probe) is none
    w.at("about:blank");
    w.contents.emit("did-navigate", {}, "about:blank");
    expect(w.said.at(-1)?.document).toBe(3);
  });

  it("PT-5b3 (ruling 7 c): a load that went nowhere — a page sent to an attachment, the download refused — is said STOPPED as the engine says it: the state that follows reads `loading: false`, at the page's own address and document", async () => {
    const w = window();
    await w.native.loadURL("https://example.test/a");
    w.at("https://example.test/a");
    w.contents.emit("did-navigate", {}, "https://example.test/a");
    w.contents.emit("did-stop-loading");
    // the page's link to a file: the engine begins a load, refuses the download (the session's guard), and stops
    w.contents.loading = true;
    w.contents.emit("did-start-loading");
    expect(w.said.at(-1)).toMatchObject({
      url: "https://example.test/a",
      loading: true,
      document: 1,
    });
    w.contents.loading = false;
    w.contents.emit("did-stop-loading");
    expect(w.said.at(-1)).toMatchObject({
      url: "https://example.test/a",
      loading: false,
      document: 1,
    });
  });

  it("PT-5c2 (F1): a document whose load FAILS AFTER IT COMMITTED — its body cut mid-stream: Electron's `did-fail-load` with no `did-fail-provisional-load` before it (−101, −355, −337) — is the SAME document, still standing: no other is counted, no failure said; the state that follows says its load ended", async () => {
    const w = window();
    await w.native.loadURL("https://example.test/a");
    w.contents.loading = true;
    w.contents.emit("did-start-loading");
    w.at("https://example.test/a");
    w.contents.emit("did-navigate", {}, "https://example.test/a");
    expect(w.said.at(-1)).toMatchObject({ url: "https://example.test/a", document: 1 });
    // its body is cut: the engine says the load failed — and nothing else (the probe: no did-fail-provisional-load, no
    // did-navigate; the page stands, showing what came)
    w.contents.emit(
      "did-fail-load",
      {},
      -101,
      "ERR_CONNECTION_RESET",
      "https://example.test/a",
      true,
    );
    expect(w.said.at(-1)?.document).toBe(1);
    expect(w.said.at(-1)?.failure).toBeUndefined();
    w.contents.loading = false;
    w.contents.emit("did-stop-loading");
    expect(w.said.at(-1)).toEqual({
      url: "https://example.test/a",
      title: "a title",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      document: 1,
    });
    // a chunked body cut short (the probe's: −355), an HTTP/2 stream reset (−337): the same
    for (const [code, name] of [
      [-355, "ERR_INCOMPLETE_CHUNKED_ENCODING"],
      [-337, "ERR_HTTP2_PROTOCOL_ERROR"],
    ] as const) {
      w.contents.emit("did-fail-load", {}, code, name, "https://example.test/a", true);
      expect(w.said.at(-1)?.document).toBe(1);
      expect(w.said.at(-1)?.failure).toBeUndefined();
    }
  });

  it("a window made anew counts its own from none", async () => {
    const first = window();
    await first.native.loadURL("https://example.test/a");
    first.at("https://example.test/a");
    first.contents.emit("did-navigate", {}, "https://example.test/a");
    expect(first.said.at(-1)?.document).toBe(1);
    const second = window();
    await second.native.loadURL("https://example.test/a");
    second.contents.emit("did-start-loading");
    expect(second.said.at(-1)?.document).toBe(0);
  });
});

describe("PT-5c (ruling 1) — the page SAYS its scale; the hand's commands never wait behind the device's", () => {
  const EMULATION = {
    userAgent: "probe/1",
    navigatorPlatform: "MacIntel",
    metadata: {
      brands: [],
      fullVersionList: [],
      platform: "macOS",
      platformVersion: "26.0",
      architecture: "arm",
      model: "",
      mobile: false,
    },
    touchPoints: 5,
  };
  /** A window whose debugger records what it is sent, and holds the methods the row names until it lets them go. */
  const recording = (hold: readonly string[] = []) => {
    const w = window();
    const sent: { method: string; params: unknown; session?: string }[] = [];
    const held = new Map<string, () => void>();
    let attached = false;
    w.contents.debugger.isAttached = () => attached;
    w.contents.debugger.attach = () => {
      attached = true;
    };
    w.contents.debugger.sendCommand = async (
      method?: string,
      params?: unknown,
      session?: string,
    ) => {
      sent.push({ method: method ?? "", params, ...(session === undefined ? {} : { session }) });
      if (method !== undefined && hold.includes(method))
        await new Promise<void>((resolve) => {
          held.set(method, resolve);
        });
      return {};
    };
    const methods = (): string[] => sent.map((c) => c.method);
    const release = (method: string): void => held.get(method)?.();
    return { ...w, sent, methods, release };
  };
  const turns = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  it("the page's session turns its Runtime on and takes a BINDING for the page's word — before the guard said to every new document, which carries the word's reporter; all of it before the device's first command; PT-5d (M7 H1): the bindings and the words in an ISOLATED world, the guard in the page's own", async () => {
    const r = recording();
    await r.native.setEmulation(EMULATION);
    const methods = r.methods();
    expect(methods).toContain("Runtime.enable");
    // H1: no page script sees, catches or calls a binding — each is the isolated world's alone
    expect(r.sent.filter((c) => c.method === "Runtime.addBinding").map((c) => c.params)).toEqual([
      { name: PAGE_SCALE_BINDING, executionContextName: WORDS_WORLD },
      { name: FRAME_WORDS_BINDING, executionContextName: WORDS_WORLD },
    ]);
    const scripts = r.sent
      .filter((c) => c.method === "Page.addScriptToEvaluateOnNewDocument")
      .map((c) => c.params as { source: string; worldName?: string });
    // the guard in the page's OWN world (it replaces the page's own `window.close` and `prompt`); the words in theirs
    expect(scripts.map((x) => x.worldName)).toEqual([undefined, WORDS_WORLD]);
    expect(scripts[0]?.source).not.toContain(PAGE_SCALE_BINDING);
    expect(scripts[0]?.source).not.toContain(FRAME_WORDS_BINDING);
    const guard = scripts[1];
    expect(guard?.source).toContain(PAGE_SCALE_BINDING);
    expect(guard?.source).toContain(FRAME_WORDS_BINDING);
    expect(guard?.source).toContain("visualViewport");
    expect(methods.indexOf("Runtime.enable")).toBeLessThan(methods.indexOf("Runtime.addBinding"));
    expect(methods.indexOf("Runtime.addBinding")).toBeLessThan(
      methods.indexOf("Page.addScriptToEvaluateOnNewDocument"),
    );
    expect(methods.indexOf("Page.addScriptToEvaluateOnNewDocument")).toBeLessThan(
      methods.indexOf("Emulation.setUserAgentOverride"),
    );
  });

  it("the page's WORD — its binding called on the page's own session — is heard with the document the window counts; a frame's session, another binding, a word that is no scale: nothing", async () => {
    const r = recording();
    const heard: [number, number][] = [];
    r.native.onScale((scale, document) => heard.push([scale, document]));
    await r.native.loadURL("https://example.test/a");
    r.at("https://example.test/a");
    r.contents.emit("did-navigate", {}, "https://example.test/a");
    const word = (payload: string, name: string = PAGE_SCALE_BINDING, session?: string): void =>
      r.contents.debugger.emit(
        "message",
        {},
        "Runtime.bindingCalled",
        { name, payload, executionContextId: 3 },
        session,
      );
    word("0.41");
    word("0.5", PAGE_SCALE_BINDING, "a-frame-of-another-process");
    word("1", "another");
    word("NaN");
    word("-1");
    word("0");
    expect(heard).toEqual([[0.41, 1]]);
    r.at("https://example.test/b");
    r.contents.emit("did-navigate", {}, "https://example.test/b");
    word("2");
    expect(heard).toEqual([
      [0.41, 1],
      [2, 2],
    ]);
  });

  it("the HAND's commands never wait behind a DEVICE command the renderer has not answered (a navigation pends): a press sent after a layout is on its way at once; the device's commands keep their own order", async () => {
    const r = recording(["Emulation.setDeviceMetricsOverride"]);
    const laid = r.native.setBackingRaster(
      { width: 640, height: 360 },
      { width: 320, height: 180 },
      2,
      false,
    );
    await turns();
    expect(r.methods()).toContain("Emulation.setDeviceMetricsOverride");
    const pressed = r.native.dispatchMouse({
      type: "mousePressed",
      x: 1,
      y: 1,
      button: "left",
      clickCount: 1,
    });
    await turns();
    expect(r.methods()).toContain("Input.dispatchMouseEvent");
    await pressed;
    // the device's next command waits for the one before it
    const told = r.native.setEmulation(EMULATION);
    await turns();
    expect(r.methods()).not.toContain("Emulation.setUserAgentOverride");
    r.release("Emulation.setDeviceMetricsOverride");
    await laid;
    await told;
    expect(r.methods().indexOf("Emulation.setDeviceMetricsOverride")).toBeLessThan(
      r.methods().indexOf("Emulation.setUserAgentOverride"),
    );
  });

  it("R2 — the page's guard, RUN: it takes the binding out of the page's reach and says its scale at its start, DOMContentLoaded, load and its first frame; a change of its visual viewport once; a page the back/forward cache RESTORES says it again (`pageshow`, persisted); a frame, the blank and a page with no binding say nothing", () => {
    const run = (options: { href?: string; frame?: boolean; binding?: boolean } = {}) => {
      const said: string[] = [];
      const on = new Map<string, (event?: { persisted?: boolean }) => void>();
      const resized: (() => void)[] = [];
      let frame: (() => void) | undefined;
      const viewport = {
        scale: 1,
        addEventListener: (type: string, listener: () => void) => {
          if (type === "resize") resized.push(listener);
        },
      };
      const g: Record<string, unknown> = { visualViewport: viewport };
      if (options.binding !== false) g[PAGE_SCALE_BINDING] = (word: string) => said.push(word);
      const self: { top?: unknown } = {};
      self.top = options.frame === true ? {} : self;
      new Function(
        "globalThis",
        "window",
        "location",
        "addEventListener",
        "requestAnimationFrame",
        PAGE_SCALE_SCRIPT,
      )(
        g,
        self,
        { href: options.href ?? "https://example.test/a" },
        (type: string, listener: (event?: { persisted?: boolean }) => void) =>
          on.set(type, listener),
        (callback: () => void) => {
          frame = callback;
        },
      );
      return {
        said,
        g,
        on,
        viewport,
        resize: () => {
          for (const listener of resized) listener();
        },
        frame: () => frame?.(),
      };
    };
    const page = run();
    // the binding is the guard's: the page's own scripts never see it
    expect(PAGE_SCALE_BINDING in page.g).toBe(false);
    expect(page.said).toEqual(["1"]);
    page.on.get("DOMContentLoaded")?.();
    page.on.get("load")?.();
    page.frame();
    expect(page.said).toEqual(["1", "1", "1", "1"]);
    // a resize that is no change of scale says nothing; a zoom says it once
    page.resize();
    page.viewport.scale = 2;
    page.resize();
    page.resize();
    expect(page.said).toEqual(["1", "1", "1", "1", "2"]);
    // its first show is no restore; a RESTORE from the back/forward cache says the scale again
    page.on.get("pageshow")?.({ persisted: false });
    expect(page.said).toHaveLength(5);
    page.on.get("pageshow")?.({ persisted: true });
    expect(page.said).toEqual(["1", "1", "1", "1", "2", "2"]);
    // a frame, the bootstrap blank, a page with no binding: nothing said (and the binding taken all the same)
    const frame = run({ frame: true });
    expect(frame.said).toEqual([]);
    expect(PAGE_SCALE_BINDING in frame.g).toBe(false);
    expect(run({ href: "about:blank" }).said).toEqual([]);
    expect(run({ binding: false }).said).toEqual([]);
  });

  it("R3 — the page's console entries are DISCARDED as they come, at most once a second (with the Runtime on, every object a page logs is held until then — PT-5c's probe): a call on the page's own session sends `Runtime.discardConsoleEntries` at once, the many after it one more when the second is up; an exception the same; never behind the hand's queue; a frame's console is discarded on the frame's own session (PT-5d: it runs its Runtime too, for its words), never the page's", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const r = recording(["Input.dispatchMouseEvent"]);
      await r.native.setEmulation(EMULATION);
      const discards = (): number =>
        r.methods().filter((m) => m === "Runtime.discardConsoleEntries").length;
      const heard = (method: string, session?: string): void =>
        r.contents.debugger.emit("message", {}, method, { type: "log", args: [] }, session);
      // a hand's command the page has not answered: the discard never waits behind it
      void r.native.dispatchMouse({
        type: "mousePressed",
        x: 1,
        y: 1,
        button: "left",
        clickCount: 1,
      });
      await vi.advanceTimersByTimeAsync(0);
      heard("Runtime.consoleAPICalled");
      await vi.advanceTimersByTimeAsync(0);
      expect(discards()).toBe(1);
      for (let i = 0; i < 20; i += 1) heard("Runtime.consoleAPICalled");
      await vi.advanceTimersByTimeAsync(999);
      expect(discards()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(discards()).toBe(2);
      await vi.advanceTimersByTimeAsync(2_000);
      heard("Runtime.exceptionThrown");
      await vi.advanceTimersByTimeAsync(0);
      expect(discards()).toBe(3);
      await vi.advanceTimersByTimeAsync(2_000);
      heard("Runtime.consoleAPICalled", "a-frame-of-another-process");
      await vi.advanceTimersByTimeAsync(0);
      expect(discards()).toBe(4);
      expect(
        r.sent.filter((c) => c.method === "Runtime.discardConsoleEntries").map((c) => c.session),
      ).toEqual([undefined, undefined, undefined, "a-frame-of-another-process"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ONE session for both queues: the hand's first command waits for the page's session and its guards, as the device's does — no input reaches a page before its guards are on, and the guards are put on once", async () => {
    const r = recording(["Page.enable"]);
    const laid = r.native.setBackingRaster(
      { width: 640, height: 360 },
      { width: 320, height: 180 },
      2,
      false,
    );
    await turns();
    // the device's command has attached the session; its guards are on their way
    expect(r.methods()).toEqual(["Page.enable"]);
    const pressed = r.native.dispatchMouse({
      type: "mousePressed",
      x: 1,
      y: 1,
      button: "left",
      clickCount: 1,
    });
    await turns();
    expect(r.methods()).toEqual(["Page.enable"]);
    r.release("Page.enable");
    await pressed;
    await laid;
    const methods = r.methods();
    expect(methods.filter((m) => m === "Page.enable")).toHaveLength(1);
    expect(methods.indexOf("Target.setAutoAttach")).toBeLessThan(
      methods.indexOf("Input.dispatchMouseEvent"),
    );
  });
});

describe("PT-5c2 (F1) — the producer over this adapter: a document's LATE failure is not another document", () => {
  it("a key held across its document's late failure (its body cut mid-stream) has its up SENT: the same document stands, saying its load ended and no failure — the page never keeps a key down for good", async () => {
    const adapter = new ElectronBrowserSurfaceNative();
    const sent: { method: string; params: unknown }[] = [];
    let made: (typeof electron.made)[number] | undefined;
    const runtime = new BrowserLiveSurfaceRuntime({
      surfaceId: "browser_surface_0123456789",
      source: {
        kind: "browser",
        initialUrl: "https://example.test/a",
        profile: { mode: "memory", ref: "pt-5c2" },
        logicalViewport: { width: 320, height: 180 },
        deviceScaleFactor: 1,
      },
      native: {
        createWindow: (options) => {
          const native = adapter.createWindow(options);
          made = electron.made.at(-1);
          if (made !== undefined) {
            // what the producer asks of Electron's window that this fake does not say: nothing here
            Object.assign(made, { destroy: () => undefined });
            Object.assign(made.webContents, {
              setFrameRate: () => undefined,
              startPainting: () => undefined,
              stopPainting: () => undefined,
              invalidate: () => undefined,
              setAudioMuted: () => undefined,
            });
            let attached = false;
            made.webContents.debugger.isAttached = () => attached;
            made.webContents.debugger.attach = () => {
              attached = true;
            };
            made.webContents.debugger.sendCommand = async (method?: string, params?: unknown) => {
              sent.push({ method: method ?? "", params });
              return {};
            };
          }
          return native;
        },
        monotonicNowUs: () => adapter.monotonicNowUs(),
        engineAgent: () => adapter.engineAgent(),
      },
    });
    const attachment = runtime.attach({
      attachmentId: "attachment_browser_00000001",
      rendererGeneration: 1,
      operations: ["view", "pointer", "keyboard"],
      publishSummary: () => undefined,
      publishCpuFrame: () => true,
      offerTextureFrame: (frame) => {
        frame.releaseSource("imported");
        frame.allReferencesReleased("released");
        return { kind: "accepted", transfer: Promise.resolve() };
      },
    });
    const turns = async (): Promise<void> => {
      for (let i = 0; i < 48; i += 1) await Promise.resolve();
    };
    attachment.setDemand({
      revision: 1,
      mode: "live",
      targetFps: 30,
      priority: 50,
      interactive: true,
    });
    await turns();
    const w = made;
    if (w === undefined) throw new Error("no window was made");
    // born: its blank, then its address asked for
    expect(w.loads).toEqual(["about:blank", "https://example.test/a"]);
    const contents = w.webContents;
    contents.loading = true;
    contents.emit("did-start-loading");
    contents.url = "https://example.test/a";
    contents.emit("did-navigate", {}, "https://example.test/a");
    // its first frame: the page is live
    contents.emit(
      "paint",
      {
        texture: {
          release: () => undefined,
          textureInfo: {
            widgetType: "frame",
            pixelFormat: "bgra",
            codedSize: { width: 320, height: 180 },
            colorSpace: { matrix: "rgb", primaries: "bt709", range: "full", transfer: "srgb" },
            visibleRect: { x: 0, y: 0, width: 320, height: 180 },
            contentRect: { x: 0, y: 0, width: 320, height: 180 },
            timestamp: 42,
            metadata: {},
            handle: {},
          },
        },
      },
      { x: 0, y: 0, width: 320, height: 180 },
      {
        getSize: () => ({ width: 320, height: 180 }),
        toBitmap: () => new Uint8Array(320 * 180 * 4),
      },
    );
    await turns();
    expect(runtime.summary.state).toBe("live");
    expect(runtime.summary.browser?.document).toBe(1);
    const revision = runtime.summary.geometry?.revision ?? 0;
    const space = (action: "down" | "up"): void =>
      attachment.dispatchInput?.(
        {
          kind: "key",
          action,
          key: " ",
          code: "Space",
          modifiers: { shift: false, alt: false, ctrl: false, meta: false },
        },
        revision,
      );
    // Space held — a design tool's page pans while it is down
    space("down");
    await turns();
    // (its page says the focus is its own, as a page's words do after a key — M7 H2: the key a hint)
    contents.debugger.emit(
      "message",
      {},
      "Runtime.bindingCalled",
      { name: FRAME_WORDS_BINDING, payload: "here", executionContextId: 1 },
      "",
    );
    await turns();
    // the page's body is cut mid-stream: Electron says the load failed, that alone (PT-5c2's probe), and that it stopped
    contents.emit(
      "did-fail-load",
      {},
      -355,
      "ERR_INCOMPLETE_CHUNKED_ENCODING",
      "https://example.test/a",
      true,
    );
    contents.loading = false;
    contents.emit("did-stop-loading");
    await turns();
    expect(runtime.summary.browser).toMatchObject({
      url: "https://example.test/a",
      loading: false,
      document: 1,
    });
    expect(runtime.summary.browser?.failure).toBeUndefined();
    space("up");
    await turns();
    const keys = sent
      .filter((c) => c.method === "Input.dispatchKeyEvent")
      .map((c) => {
        const k = c.params as { type: string; code: string };
        return `${k.type} ${k.code}`;
      });
    expect(keys).toEqual(["keyDown Space", "keyUp Space"]);
    runtime.dispose();
  });
});

describe("PT-6a (K2) — the producer over this adapter: a wheel's gesture is measured where the PRODUCER hears each wheel, never at the native's call (the producer reaches it once per answer)", () => {
  it("review 3's K2 — wheels 50 ms apart as the hand sends them, the page answering each in 300 ms, a frame the page scrolled under the pointer after the first: ONE gesture, latched to the page", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
    });
    try {
      const adapter = new ElectronBrowserSurfaceNative();
      const sent: { method: string; session?: string }[] = [];
      let made: (typeof electron.made)[number] | undefined;
      const runtime = new BrowserLiveSurfaceRuntime({
        surfaceId: "browser_surface_0123456789",
        source: {
          kind: "browser",
          initialUrl: "https://example.test/a",
          profile: { mode: "memory", ref: "pt-6a" },
          logicalViewport: { width: 320, height: 180 },
          deviceScaleFactor: 1,
        },
        native: {
          createWindow: (options) => {
            const native = adapter.createWindow(options);
            made = electron.made.at(-1);
            if (made !== undefined) {
              Object.assign(made, { destroy: () => undefined });
              Object.assign(made.webContents, {
                setFrameRate: () => undefined,
                startPainting: () => undefined,
                stopPainting: () => undefined,
                invalidate: () => undefined,
                setAudioMuted: () => undefined,
              });
              let attached = false;
              made.webContents.debugger.isAttached = () => attached;
              made.webContents.debugger.attach = () => {
                attached = true;
              };
              made.webContents.debugger.sendCommand = async (
                method?: string,
                _params?: unknown,
                session?: string,
              ) => {
                sent.push({ method: method ?? "", ...(session === undefined ? {} : { session }) });
                // (the page answers each wheel 300 ms after it is sent — a listener that is not passive, a busy thread)
                if (method === "Input.dispatchMouseEvent")
                  return new Promise((resolve) => setTimeout(() => resolve({}), 300));
                if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
                if (method === "DOM.getBoxModel")
                  return { model: { content: [100, 80, 300, 80, 300, 170, 100, 170] } };
                if (method === "DOM.resolveNode") return { object: { objectId: "owner" } };
                if (method === "Runtime.callFunctionOn")
                  return { result: { value: { visible: [0, 0, 1, 1], covers: [] } } };
                return {};
              };
            }
            return native;
          },
          monotonicNowUs: () => adapter.monotonicNowUs(),
          engineAgent: () => adapter.engineAgent(),
        },
      });
      const attachment = runtime.attach({
        attachmentId: "attachment_browser_00000001",
        rendererGeneration: 1,
        operations: ["view", "pointer", "keyboard"],
        publishSummary: () => undefined,
        publishCpuFrame: () => true,
        offerTextureFrame: (frame) => {
          frame.releaseSource("imported");
          frame.allReferencesReleased("released");
          return { kind: "accepted", transfer: Promise.resolve() };
        },
      });
      attachment.setDemand({
        revision: 1,
        mode: "live",
        targetFps: 30,
        priority: 50,
        interactive: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      const w = made;
      if (w === undefined) throw new Error("no window was made");
      const contents = w.webContents;
      const emit = (method: string, params: unknown, session = ""): void =>
        contents.debugger.emit("message", {}, method, params, session);
      contents.url = "https://example.test/a";
      contents.emit("did-navigate", {}, "https://example.test/a");
      contents.emit(
        "paint",
        {
          texture: {
            release: () => undefined,
            textureInfo: {
              widgetType: "frame",
              pixelFormat: "bgra",
              codedSize: { width: 320, height: 180 },
              colorSpace: { matrix: "rgb", primaries: "bt709", range: "full", transfer: "srgb" },
              visibleRect: { x: 0, y: 0, width: 320, height: 180 },
              contentRect: { x: 0, y: 0, width: 320, height: 180 },
              timestamp: 42,
              metadata: {},
              handle: {},
            },
          },
        },
        { x: 0, y: 0, width: 320, height: 180 },
        {
          getSize: () => ({ width: 320, height: 180 }),
          toBitmap: () => new Uint8Array(320 * 180 * 4),
        },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(runtime.summary.state).toBe("live");
      // the page's words' world (M8: where F's sight is read — without it F is UNSEEN, and the row passes for that alone),
      // and its main frame by its commit's word (K8: the root of the page's frames)
      emit("Page.frameNavigated", { frame: { id: "main", url: "https://example.test/a" } });
      emit("Runtime.executionContextCreated", {
        context: { id: 41, name: WORDS_WORLD, auxData: { frameId: "main" } },
      });
      const revision = runtime.summary.geometry?.revision ?? 0;
      const wheel = (): void =>
        attachment.dispatchInput?.(
          { kind: "wheel", x: 180, y: 120, deltaX: 0, deltaY: 10 },
          revision,
        );
      wheel();
      await vi.advanceTimersByTimeAsync(0);
      // the page scrolls F under the pointer
      emit("Page.frameAttached", { frameId: "t-F", parentFrameId: "main" });
      emit("Target.attachedToTarget", {
        sessionId: "F",
        targetInfo: { type: "iframe", targetId: "t-F", url: "" },
      });
      emit(
        "Runtime.executionContextCreated",
        { context: { id: 101, name: WORDS_WORLD, auxData: { frameId: "t-F" } } },
        "F",
      );
      await vi.advanceTimersByTimeAsync(50);
      wheel();
      await vi.advanceTimersByTimeAsync(50);
      wheel();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(
        sent.filter((c) => c.method === "Input.dispatchMouseEvent").map((c) => c.session ?? "page"),
      ).toEqual(["page", "page", "page"]);
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PT-5d — the frames of other sites: each guarded (M2), and the hand's events routed to the target that takes them (rulings 1, 3, 4)", () => {
  /**
   * A window whose debugger records what it is sent, by session, and answers what the row says (else `{}` — and, M8, a
   * frame's sight read as the engine draws it: its owner resolved, all of it in view, nothing over it). The page's
   * document has its words' isolated world (M8: where every sight is read); each frame attached is in the document
   * that holds it (`Page.frameAttached`), and has its own world. PT-6a (K8): the page's main frame said by its own
   * commit (`Page.frameNavigated` of a frame with no parent, on the page's session — the engine says it at every commit
   * of the page), unless the row says not (`main: false`).
   */
  const recording = (
    answer: (method: string, params: unknown, session?: string) => object = () => ({}),
    options: {
      readonly hungInputMs?: number;
      readonly worlds?: boolean;
      readonly main?: boolean;
    } = {},
  ) => {
    const w = window(options);
    const sent: { method: string; params: unknown; session?: string }[] = [];
    let attached = false;
    w.contents.debugger.isAttached = () => attached;
    w.contents.debugger.attach = () => {
      attached = true;
    };
    w.contents.debugger.sendCommand = async (
      method?: string,
      params?: unknown,
      session?: string,
    ) => {
      sent.push({ method: method ?? "", params, ...(session === undefined ? {} : { session }) });
      const answered = answer(method ?? "", params, session);
      if (!(answered instanceof Promise) && Object.keys(answered).length === 0) {
        if (method === "DOM.resolveNode") return { object: { objectId: "owner" } };
        if (method === "Runtime.callFunctionOn")
          return { result: { value: { visible: [0, 0, 1, 1], covers: [] } } };
      }
      return answered;
    };
    const emit = (method: string, params: unknown, session?: string): void =>
      w.contents.debugger.emit("message", {}, method, params, session);
    const world = (id: number, frameId: string, session?: string): void =>
      emit(
        "Runtime.executionContextCreated",
        {
          context: {
            id,
            name: WORDS_WORLD,
            auxData: { frameId, isDefault: false, type: "isolated" },
          },
        },
        session,
      );
    let worlds = 100;
    if (options.main !== false) emit("Page.frameNavigated", { frame: { id: "main", url: "" } });
    if (options.worlds !== false) world(41, "main");
    const attach = (session: string, parent?: string, type = "iframe"): void => {
      if (options.worlds !== false)
        emit(
          "Page.frameAttached",
          { frameId: `t-${session}`, parentFrameId: parent === undefined ? "main" : `t-${parent}` },
          parent,
        );
      emit(
        "Target.attachedToTarget",
        { sessionId: session, targetInfo: { type, targetId: `t-${session}`, url: "" } },
        parent,
      );
      if (options.worlds !== false && type === "iframe") {
        worlds += 1;
        world(worlds, `t-${session}`, session);
      }
    };
    const on = (session: string): string[] =>
      sent.filter((c) => c.session === session).map((c) => c.method);
    /** what the hand sent: `method@session x,y` (a key's type, text's, a composition's) */
    const hand = (): string[] =>
      sent
        .filter((c) => c.method.startsWith("Input."))
        .map((c) => {
          const q = c.params as {
            type?: string;
            x?: number;
            y?: number;
            text?: string;
            touchPoints?: { x: number; y: number }[];
          };
          const at =
            q.touchPoints?.[0] ?? (q.x === undefined ? undefined : { x: q.x, y: q.y ?? 0 });
          return `${q.type ?? c.method.slice(6)}@${c.session ?? "page"}${at === undefined ? "" : ` ${at.x},${at.y}`}${q.text === undefined ? "" : ` ${q.text}`}`;
        });
    return { ...w, sent, emit, attach, on, hand };
  };
  const turns = async (): Promise<void> => {
    for (let i = 0; i < 200; i += 1) await Promise.resolve();
  };
  /** A page at its first document, frame F (its owner element 7 of the page, drawn 400 × 300 at 100, 80) placed. PT-6a: born
   * with the host's bound when the row says so (`hungInputMs` — every desk page is), and answering first what the row's
   * page answers (`also`). */
  const framed = async (
    options: { readonly hungInputMs?: number } = {},
    also: (method: string, params: unknown, session?: string) => object | undefined = () =>
      undefined,
  ) => {
    const r = recording((method, params, session) => {
      const answered = also(method, params, session);
      if (answered !== undefined) return answered;
      if (method === "DOM.getFrameOwner")
        return { backendNodeId: (params as { frameId: string }).frameId === "t-F" ? 7 : 8 };
      if (method === "DOM.getBoxModel")
        return (params as { backendNodeId: number }).backendNodeId === 7
          ? { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } }
          : { model: { content: [250, 190, 370, 190, 370, 280, 250, 280] } };
      return {};
    }, options);
    await r.native.loadURL("https://host.test/a");
    r.at("https://host.test/a");
    r.contents.emit("did-navigate", {}, "https://host.test/a");
    r.attach("F");
    await turns();
    return r;
  };
  const NONE = 0;

  it("M2 — a child session's attach puts the guards on it AND its own auto-attach (flat, as the page's) — so a frame of another site inside it is attached, and guarded, before it runs", async () => {
    const r = recording();
    r.attach("frame-1");
    await turns();
    const guards = [
      "Page.enable",
      "Page.setInterceptFileChooserDialog",
      "Runtime.enable",
      "Runtime.addBinding",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.addScriptToEvaluateOnNewDocument",
      "Target.setAutoAttach",
      // M6.5b (i): it started PAUSED — resumed once its guards, its device and its own auto-attach are on
      "Runtime.runIfWaitingForDebugger",
    ];
    expect(r.on("frame-1")).toEqual(guards);
    // M7 H1: its binding and its words in the isolated world, its guard in its own
    expect(
      r.sent.find((c) => c.session === "frame-1" && c.method === "Runtime.addBinding")?.params,
    ).toEqual({ name: FRAME_WORDS_BINDING, executionContextName: WORDS_WORLD });
    expect(
      r.sent
        .filter(
          (c) => c.session === "frame-1" && c.method === "Page.addScriptToEvaluateOnNewDocument",
        )
        .map((c) => (c.params as { worldName?: string }).worldName),
    ).toEqual([undefined, WORDS_WORLD]);
    expect(
      r.sent.find((c) => c.session === "frame-1" && c.method === "Target.setAutoAttach")?.params,
    ).toEqual({
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "iframe" }],
    });
    // its guard and its words run in the document it already holds too
    for (const c of r.sent.filter(
      (x) => x.session === "frame-1" && x.method === "Page.addScriptToEvaluateOnNewDocument",
    ))
      expect(c.params).toMatchObject({ runImmediately: true });
    // the frame in it attaches on ITS session: guarded the same — and where it is drawn is asked of ITS parent's session
    r.attach("frame-2", "frame-1");
    await turns();
    expect(r.on("frame-2")).toEqual(guards);
    expect(
      r.sent.find((c) => c.method === "DOM.getFrameOwner" && c.session === "frame-1")?.params,
    ).toEqual({
      frameId: "t-frame-2",
    });
  });

  it("M2 — a guard step the engine refuses (its script, its Runtime) keeps no guard after it off: the frames inside are still attached and guarded", async () => {
    const r = recording((method, _params, session) => {
      if (
        session === "frame-1" &&
        (method === "Runtime.enable" || method === "Page.addScriptToEvaluateOnNewDocument")
      )
        throw new Error("refused");
      return {};
    });
    r.attach("frame-1");
    await turns();
    expect(r.on("frame-1")).toContain("Target.setAutoAttach");
    // M6.5b (i): and it is resumed — last
    expect(r.on("frame-1").at(-1)).toBe("Runtime.runIfWaitingForDebugger");
  });

  it("M6.5b (i) — a frame STARTS PAUSED: the page's auto-attach and each frame's wait for the debugger, FILTERED to frames (no worker is ever attached, paused or sent anything); each step before the resume sent INDEPENDENTLY and BOUNDED (2 s): one never answered keeps none of the others from going (M12 J4 — its guard script, its words, its device, its own auto-attach all sent), and the frame is resumed after them all; a frame whose session went meanwhile is not resumed", async () => {
    vi.useFakeTimers();
    try {
      const r = recording((method, _params, session) =>
        method === "Runtime.enable" && session !== undefined ? new Promise(() => {}) : {},
      );
      await r.native.setEmulation({
        userAgent: "probe/1",
        navigatorPlatform: "MacIntel",
        metadata: {
          brands: [],
          fullVersionList: [],
          platform: "macOS",
          platformVersion: "26.0",
          architecture: "arm",
          model: "",
          mobile: false,
        },
        touchPoints: 0,
      });
      expect(r.sent.find((c) => c.method === "Target.setAutoAttach")?.params).toEqual({
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [{ type: "iframe" }],
      });
      r.attach("F");
      await vi.advanceTimersByTimeAsync(1_999);
      const steps = r.on("F");
      expect(steps.slice(0, 6)).toEqual([
        "Page.enable",
        "Page.setInterceptFileChooserDialog",
        "Runtime.enable",
        "Runtime.addBinding",
        "Page.addScriptToEvaluateOnNewDocument",
        "Page.addScriptToEvaluateOnNewDocument",
      ]);
      expect(steps).toContain("Target.setAutoAttach");
      expect(steps).toContain("Emulation.setEmulatedMedia");
      expect(steps).not.toContain("Runtime.runIfWaitingForDebugger");
      await vi.advanceTimersByTimeAsync(1);
      expect(r.on("F").at(-1)).toBe("Runtime.runIfWaitingForDebugger");
      // gone while its step hung: nothing more, not even the resume
      r.attach("G");
      await vi.advanceTimersByTimeAsync(500);
      r.emit("Target.detachedFromTarget", { sessionId: "G", targetId: "t-G" });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(r.on("G")).not.toContain("Runtime.runIfWaitingForDebugger");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ruling 1 — a press over a frame of another site goes on the FRAME's session, at the point carried into its viewport (where its owner's quad, read off the hand's path, says it is drawn); its drag and its release outside it go there too; a press beside it is the page's, as before", async () => {
    const r = await framed();
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    await r.native.dispatchMouse({ type: "mouseMoved", x: 60, y: 120, button: "left", buttons: 1 });
    await r.native.dispatchMouse({
      type: "mouseReleased",
      x: 40,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 20,
      y: 20,
      button: "left",
      clickCount: 1,
    });
    expect(r.hand()).toEqual([
      "mousePressed@F 80,40",
      "mouseMoved@F -40,40",
      "mouseReleased@F -60,40",
      // the hover left F: the press beside it is the page's
      "mousePressed@page 20,20",
    ]);
    // the quad was read on the page's session, of F's owner element, once
    expect(r.sent.filter((c) => c.method === "DOM.getFrameOwner")).toEqual([
      { method: "DOM.getFrameOwner", params: { frameId: "t-F" } },
    ]);
  });

  it("M3 under M15 — while a frame of another site holds the focus (its word), a key's down and up, text, a composition and a command are REFUSED at once, sent to NO session — neither the frame's (typing there crashed main: `123521.ips`) nor the page's; the page's own `here` takes the keys back; pointer input to the frame unchanged", async () => {
    const r = await framed();
    const word = (payload: string, session?: string): void =>
      r.emit(
        "Runtime.bindingCalled",
        { name: FRAME_WORDS_BINDING, payload, executionContextId: 1 },
        session,
      );
    const said: string[] = [];
    const settled = (sent: Promise<void>): Promise<void> =>
      sent.then(
        () => {
          said.push("sent");
        },
        (error: unknown) => {
          said.push(`refused: ${error instanceof Error ? error.message : String(error)}`);
        },
      );
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    word("here", "F");
    await r.native.dispatchMouse({
      type: "mouseReleased",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    await settled(
      r.native.dispatchKey({ type: "keyDown", key: "h", code: "KeyH", modifiers: NONE }),
    );
    await settled(r.native.dispatchKey({ type: "keyUp", key: "h", code: "KeyH", modifiers: NONE }));
    await settled(r.native.dispatchText("é"));
    await settled(r.native.dispatchCompose("か", 1));
    await settled(
      r.native.dispatchKey({
        type: "keyDown",
        key: "a",
        code: "KeyA",
        modifiers: 4,
        commands: ["selectAll"],
      }),
    );
    await settled(r.native.dispatchKey({ type: "keyUp", key: "a", code: "KeyA", modifiers: 4 }));
    expect(said).toEqual(
      Array(6).fill(
        "refused: Browser input's focus is in a frame of another site — typing there is off",
      ),
    );
    // a press on the page, and the page says it holds the focus: the keys are the page's again
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 20,
      y: 20,
      button: "left",
      clickCount: 1,
    });
    word("here");
    word("away", "F");
    await r.native.dispatchMouse({
      type: "mouseReleased",
      x: 20,
      y: 20,
      button: "left",
      clickCount: 1,
    });
    await settled(r.native.dispatchText("x"));
    // F's document says the focus is in it (its script focused a field): refused again
    word("here", "F");
    await settled(r.native.dispatchText("y"));
    expect(said.slice(6)).toEqual([
      "sent",
      "refused: Browser input's focus is in a frame of another site — typing there is off",
    ]);
    expect(r.hand()).toEqual([
      "mousePressed@F 80,40",
      "mouseReleased@F 80,40",
      "mousePressed@page 20,20",
      "mouseReleased@page 20,20",
      "insertText@page x",
    ]);
  });

  it("M6.2 under M7 H2 and M15 — the focus going from F's own document to its own child of its site: both say `here` on F's session — a key between them is REFUSED (a frame of another site holds the focus), never the page's; the page's own `here` takes the keys back", async () => {
    const r = await framed();
    const word = (payload: string, session?: string): void =>
      r.emit(
        "Runtime.bindingCalled",
        { name: FRAME_WORDS_BINDING, payload, executionContextId: 1 },
        session,
      );
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    word("here", "F");
    await r.native.dispatchMouse({
      type: "mouseReleased",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    // F's own document's word, then its child's — both F's session
    word("here", "F");
    const said: string[] = [];
    const settled = (sent: Promise<void>): Promise<void> =>
      sent.then(
        () => {
          said.push("sent");
        },
        (error: unknown) => {
          said.push(`refused: ${error instanceof Error ? error.message : String(error)}`);
        },
      );
    await settled(
      r.native.dispatchKey({ type: "keyDown", key: "h", code: "KeyH", modifiers: NONE }),
    );
    word("here", "F");
    await settled(r.native.dispatchKey({ type: "keyUp", key: "h", code: "KeyH", modifiers: NONE }));
    await settled(r.native.dispatchText("é"));
    word("here");
    await settled(r.native.dispatchText("x"));
    expect(said).toEqual([
      "refused: Browser input's focus is in a frame of another site — typing there is off",
      "refused: Browser input's focus is in a frame of another site — typing there is off",
      "refused: Browser input's focus is in a frame of another site — typing there is off",
      "sent",
    ]);
    expect(r.hand()).toEqual([
      "mousePressed@F 80,40",
      "mouseReleased@F 80,40",
      "insertText@page x",
    ]);
  });

  it("ruling 3 — what a frame took ends where it began: its press released once its session has GONE is sent nowhere (never a command to a gone session); once it committed ANOTHER document (its own word, `Page.frameNavigated` of its frame), nowhere; M15: a key typed while F holds the focus is REFUSED — its down and its up sent nowhere", async () => {
    const r = await framed();
    const here = (): void =>
      r.emit(
        "Runtime.bindingCalled",
        { name: FRAME_WORDS_BINDING, payload: "here", executionContextId: 1 },
        "F",
      );
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    here();
    await expect(
      r.native.dispatchKey({ type: "keyDown", key: "q", code: "KeyQ", modifiers: NONE }),
    ).rejects.toThrow("a frame of another site");
    here();
    r.emit("Page.frameNavigated", { frame: { id: "t-F", url: "https://frame.test/next" } }, "F");
    await r.native.dispatchMouse({
      type: "mouseReleased",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    await expect(
      r.native.dispatchKey({ type: "keyUp", key: "q", code: "KeyQ", modifiers: NONE }),
    ).rejects.toThrow("a frame of another site");
    // its next press is its new document's
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    r.emit("Target.detachedFromTarget", { sessionId: "F", targetId: "t-F" });
    await r.native.dispatchMouse({
      type: "mouseReleased",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    expect(r.hand()).toEqual(["mousePressed@F 80,40", "mousePressed@F 80,40"]);
  });

  it("ruling 3 — the PAGE's commit takes every frame of the document before: a press there afterwards is the page's", async () => {
    const r = await framed();
    r.at("https://host.test/b");
    r.contents.emit("did-navigate", {}, "https://host.test/b");
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    expect(r.hand()).toEqual(["mousePressed@page 180,120"]);
  });

  it("ruling 4 — a WORKER, a service worker attached under the page's debugger is no frame: not guarded as one, never a target", async () => {
    const r = recording();
    r.attach("W", undefined, "worker");
    r.attach("S", undefined, "service_worker");
    await turns();
    expect(r.on("W")).toEqual([]);
    expect(r.on("S")).toEqual([]);
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 1,
      y: 1,
      button: "left",
      clickCount: 1,
    });
    expect(r.hand()).toEqual(["mousePressed@page 1,1"]);
  });

  it("PT-6a (M4, M5 — F1) — the words RE-ARM their window's listeners when its document is OPENED (the document-open steps erase them, the focus words' too): their MutationObserver sees the root replaced, and adds each again — never twice; and they name their own `where()` in their isolated world, for a PULLED word", () => {
    const said: string[] = [];
    type Heard = (event: { isTrusted: boolean; timeStamp: number }) => void;
    let on = new Map<string, Heard[]>();
    let observed: (() => void) | undefined;
    const later: (() => void)[] = [];
    const self: { top?: unknown } = {};
    self.top = self;
    const g: Record<string, unknown> = { [FRAME_WORDS_BINDING]: (word: string) => said.push(word) };
    const doc = {
      documentElement: { id: "first" } as unknown,
      hasFocus: () => true,
      activeElement: { localName: "input" },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    new Function(
      "globalThis",
      "window",
      "location",
      "addEventListener",
      "requestAnimationFrame",
      "setInterval",
      "document",
      "setTimeout",
      "performance",
      "MutationObserver",
      FRAME_WORDS_SCRIPT,
    )(
      g,
      self,
      { href: "https://example.test/a" },
      (type: string, listener: Heard) => {
        const list = on.get(type) ?? [];
        if (!list.includes(listener)) on.set(type, [...list, listener]);
      },
      () => undefined,
      () => undefined,
      doc,
      (callback: () => void) => later.push(callback),
      { now: () => 0 },
      class {
        constructor(callback: () => void) {
          observed = callback;
        }
        observe(): void {}
      },
    );
    const key = (): void => {
      for (const listener of on.get("keydown") ?? []) listener({ isTrusted: true, timeStamp: 0 });
      for (const callback of later.splice(0)) callback();
    };
    key();
    expect(said).toEqual(["here@0"]);
    // the words' own `where()`, named in their world — what a pulled word evaluates
    expect((g.__vibefield_where as () => string)()).toBe("here");
    // the document OPENED: every listener of its window erased — a key there says nothing
    on = new Map();
    key();
    expect(said).toEqual(["here@0"]);
    // its MutationObserver (it survives the open) sees the root replaced: each listener added again
    doc.documentElement = { id: "second" };
    observed?.();
    key();
    expect(said).toEqual(["here@0", "here@0"]);
    expect(on.get("scroll")).toHaveLength(1);
    // a mutation that replaces no root adds nothing twice
    observed?.();
    expect(on.get("keydown")).toHaveLength(1);
    // a root replaced WITHOUT an open (its window's listeners standing): each added again, and still each once — the same
    // listener, which the window keeps one of
    doc.documentElement = { id: "third" };
    observed?.();
    expect(on.get("keydown")).toHaveLength(1);
    expect(on.get("scroll")).toHaveLength(1);
  });

  it("rulings 1, M3, M7 H2 — a document's WORDS, run: it takes the binding out of the page's reach; says WHERE THE FOCUS IS (`here`, `inner`, `away`) after each trusted event — one word a task, once its default actions are done — and `moved` only when its frames' boxes or their VISIBLE parts changed (M6.3a), once an animation frame; never its size (M6.1); a document holding no frame never says moved; the page's blank and a document with no binding say nothing — a FRAME's blank speaks; M12 J10 — what no event says is LOOKED for: a cover between the quick look's points, or the frame's own `pointer-events`, seen within the deep look's bound", () => {
    const run = (options: { href?: string; binding?: boolean; top?: boolean } = {}) => {
      const said: string[] = [];
      const on = new Map<
        string,
        ((event?: { target?: unknown; isTrusted?: boolean; timeStamp?: number }) => void)[]
      >();
      let frame: (() => void) | undefined;
      let every: (() => void) | undefined;
      const later: (() => void)[] = [];
      const rects: { left: number; top: number; width: number; height: number }[] = [];
      const self: { innerWidth: number; innerHeight: number; top?: unknown } = {
        innerWidth: 400,
        innerHeight: 300,
      };
      if (options.top !== false) self.top = self;
      /** where the focus is, as the document would read it */
      const focus: { has: boolean; active: unknown } = { has: true, active: { localName: "body" } };
      const g: Record<string, unknown> = { visualViewport: { addEventListener: () => undefined } };
      if (options.binding !== false) g[FRAME_WORDS_BINDING] = (word: string) => said.push(word);
      // the frames' holder, a block that clips nothing until the row says
      const root = { parentElement: null, style: {} };
      const holder = {
        parentElement: root,
        style: { overflowX: "visible", overflowY: "visible" } as Record<string, string>,
        box: { left: 0, top: 0, width: 400, height: 300 },
        getBoundingClientRect() {
          const b = this.box;
          return { ...b, right: b.left + b.width, bottom: b.top + b.height };
        },
        get offsetWidth() {
          return this.box.width;
        },
        get offsetHeight() {
          return this.box.height;
        },
        clientLeft: 0,
        clientTop: 0,
        get clientWidth() {
          return this.box.width;
        },
        get clientHeight() {
          return this.box.height;
        },
      };
      /** each frame's element, made once by its place in the document (as a document's are), its box the row's as it is
       * now; its style the row's (M12 J10) */
      const frameStyle: Record<string, string> = {};
      const laid = new Map<number, unknown>();
      const laidOut = (_r: unknown, i: number): unknown => {
        const made = laid.get(i);
        if (made !== undefined) return made;
        const box = () => rects[i] ?? { left: 0, top: 0, width: 0, height: 0 };
        const e = {
          parentElement: holder,
          style: frameStyle,
          isConnected: true,
          getBoundingClientRect: () => {
            const r = box();
            return { ...r, right: r.left + r.width, bottom: r.top + r.height };
          },
          get offsetWidth() {
            return box().width;
          },
          get offsetHeight() {
            return box().height;
          },
          clientLeft: 0,
          clientTop: 0,
          get clientWidth() {
            return box().width;
          },
          get clientHeight() {
            return box().height;
          },
          contains: (other: unknown) => other === e,
        };
        laid.set(i, e);
        return e;
      };
      /** M7 H3: what the host draws over its frames (the hit test finds it first), and its box, by the row */
      const drawn: {
        cover: ((x: number, y: number) => boolean) | null;
        rect: { left: number; top: number; width: number; height: number };
      } = { cover: null, rect: { left: 300, top: 100, width: 200, height: 280 } };
      const cover = {
        parentElement: holder,
        style: {},
        isConnected: true,
        getBoundingClientRect: () => {
          const r = drawn.rect;
          return { ...r, right: r.left + r.width, bottom: r.top + r.height };
        },
        contains: (other: unknown) => other === cover,
      };
      /** M12 J10: the document's clock (`performance.now()`), by the row */
      const clock = { ms: 0 };
      const computed = (e: { style?: Record<string, string> }) => ({
        pointerEvents: "auto",
        visibility: "visible",
        position: "static",
        overflowX: "visible",
        overflowY: "visible",
        contain: "none",
        transform: "none",
        perspective: "none",
        filter: "none",
        borderLeftWidth: "0px",
        borderTopWidth: "0px",
        borderRightWidth: "0px",
        borderBottomWidth: "0px",
        paddingLeft: "0px",
        paddingTop: "0px",
        paddingRight: "0px",
        paddingBottom: "0px",
        ...(e.style ?? {}),
      });
      new Function(
        "globalThis",
        "window",
        "location",
        "addEventListener",
        "requestAnimationFrame",
        "setInterval",
        "document",
        "innerWidth",
        "innerHeight",
        "getComputedStyle",
        "setTimeout",
        "performance",
        FRAME_WORDS_SCRIPT,
      )(
        g,
        self,
        { href: options.href ?? "https://example.test/a" },
        (
          type: string,
          listener: (event?: { target?: unknown; isTrusted?: boolean; timeStamp?: number }) => void,
        ) => on.set(type, [...(on.get(type) ?? []), listener]),
        (callback: () => void) => {
          frame = callback;
        },
        (callback: () => void) => {
          every = callback;
        },
        {
          querySelector: () => (rects.length > 0 ? {} : null),
          querySelectorAll: () => rects.map(laidOut),
          documentElement: root,
          body: { parentElement: root, style: {} },
          elementFromPoint: (x: number, y: number) =>
            drawn.cover?.(x, y) === true ? cover : (laid.get(0) ?? null),
          hasFocus: () => focus.has,
          get activeElement() {
            return focus.active;
          },
        },
        self.innerWidth,
        self.innerHeight,
        computed,
        (callback: () => void) => {
          later.push(callback);
        },
        { now: () => clock.ms },
      );
      const fire = (
        type: string,
        event?: { target?: unknown; isTrusted?: boolean; timeStamp?: number },
      ): void => {
        for (const listener of on.get(type) ?? []) listener(event);
      };
      const tick = (): void => {
        const f = frame;
        frame = undefined;
        f?.();
      };
      /** the tasks after this one (`setTimeout(…, 0)`) */
      const after = (): void => {
        for (const callback of later.splice(0)) callback();
      };
      return {
        said,
        g,
        self,
        rects,
        holder,
        focus,
        drawn,
        frameStyle,
        clock,
        fire,
        tick,
        after,
        every: () => every?.(),
      };
    };
    const d = run();
    expect(FRAME_WORDS_BINDING in d.g).toBe(false);
    d.tick();
    // nothing at once, nor at a resize or its load — no size (M6.1); no frame in it: no `moved`
    d.fire("resize");
    d.fire("load");
    d.tick();
    expect(d.said).toEqual([]);
    // M7 H2: where the focus is, after a trusted press — once its default actions are done (the next task), one word
    d.fire("pointerdown", { isTrusted: true });
    d.fire("mousedown", { isTrusted: true });
    expect(d.said).toEqual([]);
    d.after();
    expect(d.said).toEqual(["here@0"]);
    // a key whose default moved the focus into a frame it cannot see into (another process, or origin): `inner`
    d.focus.active = { localName: "iframe", contentDocument: null };
    d.fire("keydown", { isTrusted: true });
    d.after();
    // a frame it CAN see into (its own site), the focus on a field inside it: `here`
    d.focus.active = {
      localName: "iframe",
      contentDocument: { activeElement: { localName: "input" } },
    };
    d.fire("focusin", { isTrusted: true });
    d.after();
    // the whole page lost the focus: `away`
    d.focus.has = false;
    d.fire("blur", { target: d.self, isTrusted: true });
    d.after();
    expect(d.said).toEqual(["here@0", "inner@0", "here@0", "away@0"]);
    // M7 H1: a SYNTHETIC event — `dispatchEvent`, the page's own script — says nothing
    d.fire("focus", { target: d.self, isTrusted: false });
    d.fire("keydown", { isTrusted: false });
    d.after();
    expect(d.said).toEqual(["here@0", "inner@0", "here@0", "away@0"]);
    // M12 J3: a word says HOW LONG AGO the newest trusted event it answers happened (its own clock: a duration) — a key
    // made at 100, dispatched to the document at 300 (it was busy), its word told at 350: 250, from the event's own stamp
    d.focus.has = true;
    d.clock.ms = 300;
    d.fire("keydown", { isTrusted: true, timeStamp: 100 });
    d.clock.ms = 350;
    d.after();
    expect(d.said.at(-1)).toBe("here@250");
    d.said.length = 0;
    d.focus.has = true;
    // a frame added: the half-second look says it moved — once; a scroll that moved nothing says nothing
    d.rects.push({ left: 100, top: 80, width: 400, height: 300 });
    d.every();
    d.tick();
    d.fire("scroll");
    d.fire("scroll");
    d.tick();
    expect(d.said.filter((w) => w === "moved")).toHaveLength(1);
    // a scroll that moved it: once an animation frame, however many scrolls
    d.rects[0] = { left: 100, top: 30, width: 400, height: 300 };
    d.fire("scroll");
    d.fire("scroll");
    d.tick();
    expect(d.said.filter((w) => w === "moved")).toHaveLength(2);
    // M6.3a: its frame not moving, its holder begins to CLIP it (a scroller shrunk): its visible part changed — moved
    d.holder.style = { overflowX: "hidden", overflowY: "hidden" };
    d.holder.box = { left: 0, top: 0, width: 400, height: 200 };
    d.every();
    d.tick();
    expect(d.said.filter((w) => w === "moved")).toHaveLength(3);
    // M7 H3: nothing moved, nothing clipped anew — the host drew a MENU over its frame: moved, at once — an event's look is
    // the QUICK one (its transition's end; the half-second's deep look, M12 J10, would find it too)
    d.drawn.cover = (x, y) => x > 300 && y > 100;
    d.fire("transitionend");
    d.tick();
    expect(d.said.filter((w) => w === "moved")).toHaveLength(4);
    // the page's blank, a document with no binding: nothing; a FRAME's blank (an editor's) speaks (M7 H2)
    const blank = run({ href: "about:blank" });
    blank.fire("keydown", { isTrusted: true });
    blank.tick();
    blank.after();
    expect(blank.said).toEqual([]);
    const bare = run({ binding: false });
    bare.tick();
    expect(bare.said).toEqual([]);
    const editor = run({ href: "about:blank", top: false });
    editor.fire("keydown", { isTrusted: true });
    editor.after();
    expect(editor.said).toEqual(["here@0"]);
    // M12 J10 — what no event says is LOOKED for. A badge 16 × 16 — smaller than the quick look's cell — appears BETWEEN
    // its points (x 130, 190; y 102, 146) with nothing else moving: the half-second's DEEP look (the frame's whole sight,
    // its whole grid at most a second old — the grid's point 160, 140 lands on it) says moved within a second and a half;
    // it goes: moved again. The frame's own `pointer-events` toggled by no mutation (a stylesheet's rule): the next look.
    const j = run();
    j.rects.push({ left: 100, top: 80, width: 400, height: 300 });
    j.every();
    j.tick();
    expect(j.said).toEqual(["moved"]);
    const halfSeconds = (n: number): void => {
      for (let i = 0; i < n; i += 1) {
        j.clock.ms += 500;
        j.every();
        j.tick();
      }
    };
    j.drawn.cover = (x, y) => x >= 160 && x < 176 && y >= 130 && y < 146;
    j.drawn.rect = { left: 160, top: 130, width: 16, height: 16 };
    halfSeconds(3);
    expect(j.said).toEqual(["moved", "moved"]);
    j.drawn.cover = null;
    halfSeconds(3);
    expect(j.said).toEqual(["moved", "moved", "moved"]);
    j.frameStyle.pointerEvents = "none";
    j.fire("transitionend");
    j.tick();
    expect(j.said).toEqual(["moved", "moved", "moved", "moved"]);
  });

  it("ruling 1 — where a frame is drawn is read again when its parent's document says its frames MOVED (its words, on its own session): one read in flight a frame; the quad read next is where the hand's next press lands", async () => {
    let at = [100, 80, 500, 80, 500, 380, 100, 380];
    const r = recording((method) => {
      if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
      if (method === "DOM.getBoxModel") return { model: { content: at } };
      return {};
    });
    await r.native.loadURL("https://host.test/a");
    r.at("https://host.test/a");
    r.contents.emit("did-navigate", {}, "https://host.test/a");
    r.attach("F");
    await turns();
    // the page scrolled by 50: its words say so — F is read again, once however many words come (one in flight, one after)
    const before = r.sent.filter((c) => c.method === "DOM.getBoxModel").length;
    at = [100, 30, 500, 30, 500, 330, 100, 330];
    for (let i = 0; i < 3; i += 1)
      r.emit("Runtime.bindingCalled", {
        name: FRAME_WORDS_BINDING,
        payload: "moved",
        executionContextId: 1,
      });
    await turns();
    expect(
      r.sent.filter((c) => c.method === "DOM.getBoxModel").length - before,
    ).toBeLessThanOrEqual(2);
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 180,
      y: 70,
      button: "left",
      clickCount: 1,
    });
    expect(r.hand()).toEqual(["mousePressed@F 80,40"]);
  });

  it("M6.1 — a frame's own viewport is READ beside its quad, of its session's LOCAL ROOT (`Runtime.evaluate` on its own session): under a transform a point is scaled by it; a word of its own child of its site never moves it", async () => {
    const r = recording((method, _params, session) => {
      if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
      if (method === "DOM.getBoxModel")
        return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
      // drawn at 400 × 300, its own viewport 200 × 150 (a `transform: scale(2)`)
      if (method === "Runtime.evaluate" && session === "F")
        return { result: { type: "string", value: "200,150" } };
      return {};
    });
    await r.native.loadURL("https://host.test/a");
    r.at("https://host.test/a");
    r.contents.emit("did-navigate", {}, "https://host.test/a");
    r.attach("F");
    await turns();
    expect(r.sent.find((c) => c.method === "Runtime.evaluate")).toMatchObject({
      session: "F",
      params: { returnByValue: true },
    });
    // a word of F's own child of its site (its viewport 640 × 480): under the guard before M6.1 every document said it
    r.emit(
      "Runtime.bindingCalled",
      { name: FRAME_WORDS_BINDING, payload: "size:640,480", executionContextId: 2 },
      "F",
    );
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 300,
      y: 230,
      button: "left",
      clickCount: 1,
    });
    expect(r.hand()).toEqual(["mousePressed@F 100,75"]);
  });

  it("M6.3a — the VISIBLE part of a frame's content box, as fractions of it: less each containing block's overflow clip up its chain (a positioned holder skips the static ones between; a fixed frame all but a transformed one), a `contain: paint`, and the view (the visual viewport's part of it); a frame drawn nowhere has none", () => {
    type Box = { left: number; top: number; width: number; height: number };
    type Fake = { style: Record<string, string>; parentElement: Fake | null } & Record<
      string,
      unknown
    >;
    const root: Fake = { style: {}, parentElement: null };
    const el = (
      box: Box,
      style: Record<string, string> = {},
      parent: Fake = root,
      client?: { left?: number; top?: number; width?: number; height?: number },
    ): Fake => ({
      style,
      parentElement: parent,
      getBoundingClientRect: () => ({
        ...box,
        right: box.left + box.width,
        bottom: box.top + box.height,
      }),
      offsetWidth: box.width,
      offsetHeight: box.height,
      clientLeft: client?.left ?? 0,
      clientTop: client?.top ?? 0,
      clientWidth: client?.width ?? box.width,
      clientHeight: client?.height ?? box.height,
    });
    const body = el({ left: 0, top: 0, width: 1280, height: 2400 });
    const computed = (e: Fake) => ({
      position: "static",
      overflowX: "visible",
      overflowY: "visible",
      contain: "none",
      transform: "none",
      perspective: "none",
      filter: "none",
      borderLeftWidth: "0px",
      borderTopWidth: "0px",
      borderRightWidth: "0px",
      borderBottomWidth: "0px",
      paddingLeft: "0px",
      paddingTop: "0px",
      paddingRight: "0px",
      paddingBottom: "0px",
      ...e.style,
    });
    // (M7 H3: the sight's visible part — nothing drawn over these frames: the engine's hit test finds each where it is)
    const part = (
      frame: Fake,
      view: { w: number; h: number; vv?: Record<string, number> } = { w: 1280, h: 800 },
    ): unknown =>
      (
        new Function(
          "getComputedStyle",
          "document",
          "globalThis",
          "innerWidth",
          "innerHeight",
          "performance",
          `return (${FRAME_SIGHT});`,
        )(
          computed,
          { documentElement: root, body, elementFromPoint: () => frame },
          { visualViewport: view.vv },
          view.w,
          view.h,
          { now: () => 0 },
        ) as (this: Fake, quick: boolean) => { visible: unknown }
      ).call(frame, false).visible;
    // FRAME-CLIPPED's: 640 × 420 at 160, 90 in a scroller at 160, 300 (680 × 420, its scrollbar 15) — its top half clipped
    const scroller = el(
      { left: 160, top: 300, width: 680, height: 420 },
      { overflowX: "auto", overflowY: "auto" },
      body,
      { width: 665, height: 420 },
    );
    expect(part(el({ left: 160, top: 90, width: 640, height: 420 }, {}, scroller))).toEqual([
      0, 0.5, 1, 1,
    ]);
    // a positioned holder: the static clipper between it and an ABSOLUTE frame clips nothing of it — a static frame it clips
    const holder = el(
      { left: 0, top: 0, width: 1280, height: 800 },
      { position: "relative" },
      body,
    );
    const clipper = el(
      { left: 0, top: 0, width: 50, height: 50 },
      { overflowX: "hidden", overflowY: "hidden" },
      holder,
    );
    expect(
      part(el({ left: 0, top: 0, width: 200, height: 100 }, { position: "absolute" }, clipper)),
    ).toEqual([0, 0, 1, 1]);
    expect(part(el({ left: 0, top: 0, width: 200, height: 100 }, {}, clipper))).toEqual([
      0, 0, 0.25, 0.5,
    ]);
    // a FIXED frame: no clipper but a transformed one
    expect(
      part(el({ left: 0, top: 0, width: 200, height: 100 }, { position: "fixed" }, clipper)),
    ).toEqual([0, 0, 1, 1]);
    const turned = el(
      { left: 0, top: 0, width: 50, height: 50 },
      { overflowX: "hidden", overflowY: "hidden", transform: "matrix(1, 0, 0, 1, 0, 0)" },
      body,
    );
    expect(
      part(el({ left: 0, top: 0, width: 200, height: 100 }, { position: "fixed" }, turned)),
    ).toEqual([0, 0, 0.25, 0.5]);
    // `contain: paint` clips as an overflow does
    const painted = el({ left: 0, top: 0, width: 100, height: 100 }, { contain: "paint" }, body);
    expect(part(el({ left: 0, top: 0, width: 200, height: 100 }, {}, painted))).toEqual([
      0, 0, 0.5, 1,
    ]);
    // its border and padding are not its content: 200 × 100 inside 10 px of border and 5 of padding; clipped above 65
    const above = el(
      { left: 0, top: 65, width: 400, height: 400 },
      { overflowX: "hidden", overflowY: "hidden" },
      body,
    );
    const padded = el(
      { left: 0, top: 0, width: 230, height: 130 },
      {
        borderLeftWidth: "10px",
        borderTopWidth: "10px",
        borderRightWidth: "10px",
        borderBottomWidth: "10px",
        paddingLeft: "5px",
        paddingTop: "5px",
        paddingRight: "5px",
        paddingBottom: "5px",
      },
      above,
    );
    expect(part(padded)).toEqual([0, 0.5, 1, 1]);
    // the view: half below its bottom; a pinch's visual viewport (100, 50, 640 × 400)
    expect(part(el({ left: 0, top: 700, width: 200, height: 200 }, {}, body))).toEqual([
      0, 0, 1, 0.5,
    ]);
    expect(
      part(el({ left: 0, top: 0, width: 400, height: 300 }, {}, body), {
        w: 1280,
        h: 800,
        vv: { offsetLeft: 100, offsetTop: 50, width: 640, height: 400 },
      }),
    ).toEqual([0.25, 0.1667, 1, 1]);
    // drawn nowhere, or wholly clipped: none
    expect(part(el({ left: 0, top: 0, width: 0, height: 100 }, {}, body))).toEqual([0, 0, 0, 0]);
    expect(part(el({ left: 0, top: 900, width: 200, height: 100 }, {}, body))).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it("M7 H3 — what COVERS a frame, by the engine's own hit test over its visible part: a fixed header's exact rect cut to it; an overlay passed through (`pointer-events: none` — the hit test finds the frame) is none; the frame's own ancestor (its rounded corner) is none; the frame itself `pointer-events: none` is covered whole; a cover known before is kept while its centre is still its own, dropped once it is not; the quick look's word changes when a cover appears", () => {
    type Fake = { style: Record<string, string>; parentElement: Fake | null } & Record<
      string,
      unknown
    >;
    const root: Fake = { style: {}, parentElement: null };
    const el = (
      box: { left: number; top: number; width: number; height: number },
      style: Record<string, string> = {},
      parent: Fake = root,
    ): Fake => {
      const e: Fake = {
        style,
        parentElement: parent,
        box,
        getBoundingClientRect: () => ({
          ...(e["box"] as typeof box),
          right: (e["box"] as typeof box).left + (e["box"] as typeof box).width,
          bottom: (e["box"] as typeof box).top + (e["box"] as typeof box).height,
        }),
        offsetWidth: box.width,
        offsetHeight: box.height,
        clientLeft: 0,
        clientTop: 0,
        clientWidth: box.width,
        clientHeight: box.height,
        isConnected: true,
        contains: (other: unknown) => {
          for (let x = other as Fake | null; x !== null; x = x.parentElement)
            if (x === e) return true;
          return false;
        },
      };
      return e;
    };
    const body = el({ left: 0, top: 0, width: 1280, height: 2400 });
    const computed = (e: Fake) => ({
      position: "static",
      overflowX: "visible",
      overflowY: "visible",
      contain: "none",
      transform: "none",
      perspective: "none",
      filter: "none",
      pointerEvents: "auto",
      visibility: "visible",
      borderLeftWidth: "0px",
      borderTopWidth: "0px",
      borderRightWidth: "0px",
      borderBottomWidth: "0px",
      paddingLeft: "0px",
      paddingTop: "0px",
      paddingRight: "0px",
      paddingBottom: "0px",
      ...e.style,
    });
    let now = 0;
    const g: Record<string | symbol, unknown> = {};
    const sight = (frame: Fake, hit: (x: number, y: number) => unknown, quick = false): unknown =>
      (
        new Function(
          "getComputedStyle",
          "document",
          "globalThis",
          "innerWidth",
          "innerHeight",
          "performance",
          `return (${FRAME_SIGHT});`,
        )(computed, { documentElement: root, body, elementFromPoint: hit }, g, 1280, 800, {
          now: () => now,
        }) as (this: Fake, quick: boolean) => unknown
      ).call(frame, quick);
    // the frame 640 × 420 at 160, 60; a fixed header 0 → 140 across the page: its top 80 px covered
    const frame = el({ left: 160, top: 60, width: 640, height: 420 }, {}, body);
    const header = el({ left: 0, top: 0, width: 1280, height: 140 }, { position: "fixed" }, body);
    const bare = (x: number, y: number): unknown => (x < 0 || y < 0 ? null : frame);
    const headed = (x: number, y: number): unknown => (y < 140 ? header : bare(x, y));
    expect(sight(frame, headed)).toEqual({ visible: [0, 0, 1, 1], covers: [[0, 0, 1, 0.1905]] });
    // an overlay with `pointer-events: none`: the hit test passes through it — nothing covers
    expect(sight(frame, bare)).toEqual({ visible: [0, 0, 1, 1], covers: [] });
    // its rounded corners (40 px): the hit test finds its ANCESTOR there — the whole look's points hit it — no cover
    const rounded = (x: number, y: number): unknown => (x < 200 && y < 100 ? body : bare(x, y));
    now = 5_000;
    expect(sight(frame, rounded)).toEqual({ visible: [0, 0, 1, 1], covers: [] });
    // the frame itself `pointer-events: none`: covered whole by what is under it
    const deaf = el(
      { left: 160, top: 60, width: 640, height: 420 },
      { pointerEvents: "none" },
      body,
    );
    expect(sight(deaf, () => body)).toEqual({ visible: [0, 0, 1, 1], covers: [[0, 0, 1, 1]] });
    // a small dropdown between the quick look's points, found by a whole look; kept by its centre within the second…
    const menu = el({ left: 620, top: 330, width: 30, height: 30 }, { position: "absolute" }, body);
    const opened = (x: number, y: number): unknown =>
      x >= 620 && x < 650 && y >= 330 && y < 360 ? menu : bare(x, y);
    now = 10_000;
    expect(sight(frame, opened)).toEqual({
      visible: [0, 0, 1, 1],
      covers: [[0.7188, 0.6429, 0.7656, 0.7143]],
    });
    now = 10_500;
    expect(sight(frame, opened)).toEqual({
      visible: [0, 0, 1, 1],
      covers: [[0.7188, 0.6429, 0.7656, 0.7143]],
    });
    // … dropped once its centre is not its own (closed)
    now = 10_600;
    expect(sight(frame, bare)).toEqual({ visible: [0, 0, 1, 1], covers: [] });
    // the quick look (the words' `moved`): its word changes when a cover appears over one of its points
    const plain = sight(frame, bare, true);
    expect(typeof plain).toBe("string");
    expect(sight(frame, headed, true)).not.toBe(plain);
    expect(sight(frame, bare, true)).toBe(plain);
    // a cover smaller than the whole look's spacing (4 × 4), between its points but on the quick look's first: a cover
    const dot = el({ left: 222, top: 100, width: 4, height: 4 }, { position: "absolute" }, body);
    const dotted = (x: number, y: number): unknown =>
      x >= 222 && x < 226 && y >= 100 && y < 104 ? dot : bare(x, y);
    now = 30_000;
    expect(sight(frame, dotted)).toEqual({
      visible: [0, 0, 1, 1],
      covers: [[0.0969, 0.0952, 0.1031, 0.1048]],
    });
  });

  it("M7 H3 — a frame's COVERS are read with its quad: a press on the part a fixed header covers is the page's, below it the frame's", async () => {
    const r = recording((method) => {
      if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
      if (method === "DOM.getBoxModel")
        return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
      if (method === "DOM.resolveNode") return { object: { objectId: "owner-7" } };
      if (method === "Runtime.callFunctionOn")
        return { result: { value: { visible: [0, 0, 1, 1], covers: [[0, 0, 1, 40 / 300]] } } };
      return {};
    });
    await r.native.loadURL("https://host.test/a");
    r.at("https://host.test/a");
    r.contents.emit("did-navigate", {}, "https://host.test/a");
    r.attach("F");
    await turns();
    for (const y of [100, 305]) {
      await r.native.dispatchMouse({
        type: "mousePressed",
        x: 180,
        y,
        button: "left",
        clickCount: 1,
      });
      await r.native.dispatchMouse({
        type: "mouseReleased",
        x: 180,
        y,
        button: "left",
        clickCount: 1,
      });
    }
    expect(r.hand()).toEqual([
      "mousePressed@page 180,100",
      "mouseReleased@page 180,100",
      "mousePressed@F 80,225",
      "mouseReleased@F 80,225",
    ]);
  });

  it("M8 — the frame's sight and its size are read in the WORDS' ISOLATED WORLD, never the page's main world (a page replacing the DOM's methods there could hide its overlay — a press on it sent into the embed under it): its owner resolved in the isolated context of the document that holds it, its own size evaluated in its own; that context unknown — the frame takes nothing", async () => {
    const r = recording(
      (method, params) => {
        if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
        if (method === "DOM.getBoxModel")
          return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
        if (method === "DOM.resolveNode")
          return (params as { executionContextId?: number }).executionContextId === 41
            ? { object: { objectId: "owner-7" } }
            : { object: { objectId: "owner-7-main" } };
        if (method === "Runtime.callFunctionOn")
          return { result: { value: { visible: [0, 0, 1, 1], covers: [] } } };
        if (method === "Runtime.evaluate") return { result: { type: "string", value: "400,300" } };
        return {};
      },
      { worlds: false },
    );
    await r.native.loadURL("https://host.test/a");
    r.at("https://host.test/a");
    r.contents.emit("did-navigate", {}, "https://host.test/a");
    // the page's document's isolated world (the words'), and its main world; F's owner in that document
    r.emit("Runtime.executionContextCreated", {
      context: { id: 40, name: "", auxData: { frameId: "main", isDefault: true, type: "default" } },
    });
    r.emit("Runtime.executionContextCreated", {
      context: {
        id: 41,
        name: WORDS_WORLD,
        auxData: { frameId: "main", isDefault: false, type: "isolated" },
      },
    });
    r.emit("Page.frameAttached", { frameId: "t-F", parentFrameId: "main" });
    r.attach("F");
    // F's own document's isolated world, on F's session (a re-read of its place follows: its size in it)
    r.emit(
      "Runtime.executionContextCreated",
      {
        context: {
          id: 7,
          name: WORDS_WORLD,
          auxData: { frameId: "t-F", isDefault: false, type: "isolated" },
        },
      },
      "F",
    );
    await turns();
    expect(
      r.sent.filter((c) => c.method === "DOM.resolveNode").map((c) => c.params),
    ).toContainEqual({
      backendNodeId: 7,
      executionContextId: 41,
    });
    expect(
      r.sent.filter((c) => c.method === "DOM.resolveNode").map((c) => c.params),
    ).not.toContainEqual({ backendNodeId: 7 });
    expect(
      r.sent
        .filter((c) => c.method === "Runtime.evaluate" && c.session === "F")
        .map((c) => c.params),
    ).toContainEqual({
      expression: 'innerWidth + "," + innerHeight',
      contextId: 7,
      returnByValue: true,
    });
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    expect(r.hand()).toEqual(["mousePressed@F 80,40"]);
    // a frame whose owner's document's isolated world is not known: its sight cannot be read as the engine's — it takes
    // nothing (the host's, as before PT-5d)
    const unknown = recording(
      (method) => {
        if (method === "DOM.getFrameOwner") return { backendNodeId: 9 };
        if (method === "DOM.getBoxModel")
          return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
        if (method === "DOM.resolveNode") return { object: { objectId: "owner-9-main" } };
        if (method === "Runtime.callFunctionOn")
          return { result: { value: { visible: [0, 0, 1, 1], covers: [] } } };
        return {};
      },
      { worlds: false },
    );
    await unknown.native.loadURL("https://host.test/a");
    unknown.at("https://host.test/a");
    unknown.contents.emit("did-navigate", {}, "https://host.test/a");
    unknown.attach("F");
    await turns();
    expect(unknown.sent.filter((c) => c.method === "DOM.resolveNode")).toEqual([]);
    await unknown.native.dispatchMouse({
      type: "mousePressed",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    expect(unknown.hand()).toEqual(["mousePressed@page 180,120"]);
  });

  /** M12 J5: owners by frame, quads by owner, and each sight by the WORLD it is read in and the owner it is read of
   * (`w<context>-<owner>`): only the reads named cover anything. */
  const slotAnswers =
    (
      owners: Record<string, number>,
      quads: Record<number, number[]>,
      covers: Record<string, number[][]>,
    ) =>
    (method: string, params: unknown): object => {
      if (method === "DOM.getFrameOwner")
        return { backendNodeId: owners[(params as { frameId: string }).frameId] ?? 0 };
      if (method === "DOM.getBoxModel")
        return { model: { content: quads[(params as { backendNodeId: number }).backendNodeId] } };
      if (method === "DOM.resolveNode") {
        const p = params as { backendNodeId: number; executionContextId?: number };
        return { object: { objectId: `w${p.executionContextId}-${p.backendNodeId}` } };
      }
      if (method === "Runtime.callFunctionOn")
        return {
          result: {
            value: {
              visible: [0, 0, 1, 1],
              covers: covers[(params as { objectId: string }).objectId] ?? [],
            },
          },
        };
      return {};
    };
  const pressAt = async (r: ReturnType<typeof recording>, x: number, y: number) => {
    await r.native.dispatchMouse({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await r.native.dispatchMouse({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };

  it("M12 J5 — a frame F of another site inside a SAME-PROCESS frame S of the page (an about:blank slot): what the PAGE draws over S is the page's — S's sight READ in the page's document's isolated world, F's in S's; a point is F's only if both admit it; the page's world unknown, F takes nothing", async () => {
    const slotted = async (pageWorld: boolean) => {
      const r = recording(
        slotAnswers(
          { S: 6, "t-F": 7 },
          { 6: [100, 80, 500, 80, 500, 380, 100, 380], 7: [100, 80, 500, 80, 500, 380, 100, 380] },
          // the page's fixed header over S's top quarter, read in the page's world (41); nothing over F in S's (42)
          { "w41-6": [[0, 0, 1, 0.25]] },
        ),
        { worlds: false },
      );
      await r.native.loadURL("https://host.test/a");
      r.at("https://host.test/a");
      r.contents.emit("did-navigate", {}, "https://host.test/a");
      if (pageWorld)
        r.emit("Runtime.executionContextCreated", {
          context: { id: 41, name: WORDS_WORLD, auxData: { frameId: "main" } },
        });
      // S: a frame of the page's own process — no session of its own; its document's isolated world
      r.emit("Page.frameAttached", { frameId: "S", parentFrameId: "main" });
      r.emit("Runtime.executionContextCreated", {
        context: { id: 42, name: WORDS_WORLD, auxData: { frameId: "S" } },
      });
      // F: of another site, its owner in S's document — attached on the page's session
      r.emit("Page.frameAttached", { frameId: "t-F", parentFrameId: "S" });
      r.emit("Target.attachedToTarget", {
        sessionId: "F",
        targetInfo: { type: "iframe", targetId: "t-F", url: "" },
      });
      await turns();
      await pressAt(r, 180, 100);
      await pressAt(r, 180, 200);
      return r;
    };
    const r = await slotted(true);
    const resolved = r.sent.filter((c) => c.method === "DOM.resolveNode").map((c) => c.params);
    expect(resolved).toContainEqual({ backendNodeId: 6, executionContextId: 41 });
    expect(resolved).toContainEqual({ backendNodeId: 7, executionContextId: 42 });
    expect(r.hand()).toEqual([
      "mousePressed@page 180,100",
      "mouseReleased@page 180,100",
      "mousePressed@F 80,120",
      "mouseReleased@F 80,120",
    ]);
    // the page's words say its frames moved: F is read again — S's sight with it; S's owner asked once
    r.emit("Runtime.bindingCalled", {
      name: FRAME_WORDS_BINDING,
      payload: "moved",
      executionContextId: 41,
    });
    await turns();
    const of = (method: string, key: string, value: unknown) =>
      r.sent.filter(
        (c) => c.method === method && (c.params as Record<string, unknown>)[key] === value,
      ).length;
    expect(of("DOM.resolveNode", "backendNodeId", 6)).toBe(2);
    expect(of("DOM.getFrameOwner", "frameId", "S")).toBe(1);
    // S's sight cannot be read as the engine's (its parent document's isolated world unknown): F takes nothing
    const unknown = await slotted(false);
    expect(unknown.hand()).toEqual([
      "mousePressed@page 180,100",
      "mouseReleased@page 180,100",
      "mousePressed@page 180,200",
      "mouseReleased@page 180,200",
    ]);
  });

  it("M12 J5 — a frame G inside a same-process frame S′ of ANOTHER frame E of another site (on E's session): S′'s sight is read on E's session, in E's document's isolated world — what E draws over S′ is E's, the point carried into E", async () => {
    const r = recording(
      slotAnswers(
        { "t-E": 5, S2: 6, "t-G": 7 },
        {
          5: [100, 80, 500, 80, 500, 380, 100, 380],
          6: [0, 0, 400, 0, 400, 300, 0, 300],
          7: [0, 0, 400, 0, 400, 300, 0, 300],
        },
        // E's banner over S′'s top quarter, read in E's document's world (101 — E's own, on E's session)
        { "w101-6": [[0, 0, 1, 0.25]] },
      ),
    );
    await r.native.loadURL("https://host.test/a");
    r.at("https://host.test/a");
    r.contents.emit("did-navigate", {}, "https://host.test/a");
    r.attach("E");
    r.emit("Page.frameAttached", { frameId: "S2", parentFrameId: "t-E" }, "E");
    r.emit(
      "Runtime.executionContextCreated",
      { context: { id: 102, name: WORDS_WORLD, auxData: { frameId: "S2" } } },
      "E",
    );
    r.emit("Page.frameAttached", { frameId: "t-G", parentFrameId: "S2" }, "E");
    r.emit(
      "Target.attachedToTarget",
      { sessionId: "G", targetInfo: { type: "iframe", targetId: "t-G", url: "" } },
      "E",
    );
    await turns();
    expect(
      r.sent
        .filter((c) => c.method === "DOM.resolveNode" && c.session === "E")
        .map((c) => c.params),
    ).toContainEqual({ backendNodeId: 6, executionContextId: 101 });
    await pressAt(r, 180, 100);
    await pressAt(r, 180, 200);
    expect(r.hand()).toEqual([
      "mousePressed@E 80,20",
      "mouseReleased@E 80,20",
      "mousePressed@G 80,120",
      "mouseReleased@G 80,120",
    ]);
  });

  it("PT-6a (K8) — J5's walk fails CLOSED: F's owner in a same-process frame S whose OWN parent link was never heard (a debugger re-attach mid-document — `Page.enable` replays no `frameAttached`) takes nothing; the walk's root is the page's main frame, said by its own commit — not said yet, the page's frames take nothing", async () => {
    const slot = async (
      linked: boolean,
      main: boolean,
      // (the page's cover over all of S, and S's own commit said — with its parent)
      slotCommits = false,
    ): Promise<string[]> => {
      const r = recording(
        slotAnswers(
          { S: 6, "t-F": 7 },
          { 6: [100, 80, 500, 80, 500, 380, 100, 380], 7: [100, 80, 500, 80, 500, 380, 100, 380] },
          slotCommits ? { "w41-6": [[0, 0, 1, 1]] } : {},
        ),
        { worlds: false, main },
      );
      await r.native.loadURL("https://host.test/a");
      r.at("https://host.test/a");
      r.contents.emit("did-navigate", {}, "https://host.test/a");
      r.emit("Runtime.executionContextCreated", {
        context: { id: 41, name: WORDS_WORLD, auxData: { frameId: "main" } },
      });
      if (linked) r.emit("Page.frameAttached", { frameId: "S", parentFrameId: "main" });
      if (slotCommits)
        r.emit("Page.frameNavigated", { frame: { id: "S", parentId: "main", url: "about:blank" } });
      r.emit("Runtime.executionContextCreated", {
        context: { id: 42, name: WORDS_WORLD, auxData: { frameId: "S" } },
      });
      r.emit("Page.frameAttached", { frameId: "t-F", parentFrameId: "S" });
      r.emit("Target.attachedToTarget", {
        sessionId: "F",
        targetInfo: { type: "iframe", targetId: "t-F", url: "" },
      });
      await turns();
      await pressAt(r, 180, 200);
      return r.hand();
    };
    // S linked to the page's main frame — the root: F admitted (J5)
    expect(await slot(true, true)).toEqual(["mousePressed@F 80,120", "mouseReleased@F 80,120"]);
    // S's own link never heard: F takes nothing — the host's (before: admitted, S's sight unread)
    expect(await slot(false, true)).toEqual([
      "mousePressed@page 180,200",
      "mouseReleased@page 180,200",
    ]);
    // the page's main frame not said yet: the page's frames take nothing
    expect(await slot(true, false)).toEqual([
      "mousePressed@page 180,200",
      "mouseReleased@page 180,200",
    ]);
    // S's own commit (said WITH its parent) is no main frame: the walk still reads S — the page's cover over S keeps the
    // press the page's
    expect(await slot(true, true, true)).toEqual([
      "mousePressed@page 180,200",
      "mouseReleased@page 180,200",
    ]);
  });

  it("M12 J9 — the wheel's gesture gap is measured at each wheel's ARRIVAL, never at its turn: wheels 50 ms apart, the page answering each in 300 ms — one gesture, latched to the page, though the page scrolled a frame under the pointer meanwhile", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
    });
    try {
      const r = recording((method, params) => {
        if (method === "Input.dispatchMouseEvent")
          return new Promise((resolve) => setTimeout(() => resolve({}), 300));
        if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
        if (method === "DOM.getBoxModel")
          return (params as { backendNodeId: number }).backendNodeId === 7
            ? { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } }
            : {};
        return {};
      });
      await r.native.loadURL("https://host.test/a");
      r.at("https://host.test/a");
      r.contents.emit("did-navigate", {}, "https://host.test/a");
      const wheel = () =>
        void r.native.dispatchMouse({
          type: "mouseWheel",
          x: 180,
          y: 120,
          deltaX: 0,
          deltaY: 10,
        });
      wheel();
      await vi.advanceTimersByTimeAsync(0);
      // the page scrolls F under the pointer
      r.attach("F");
      await vi.advanceTimersByTimeAsync(50);
      wheel();
      await vi.advanceTimersByTimeAsync(50);
      wheel();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(r.hand()).toEqual([
        "mouseWheel@page 180,120",
        "mouseWheel@page 180,120",
        "mouseWheel@page 180,120",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("PT-6a (M1) — a frame's wheel answered LATE (past `WHEEL_BUBBLED_MS` after its send: its scroller at its end, the engine bubbling it) — the rest of its gesture goes to the PAGE's session at once, at the page's point; answered on time, the frame keeps it; a pause, a new gesture by its point (F again)", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
    });
    try {
      // F answers its wheels at once — then, its scroller at its end, a second after each is sent (run 2's ~1017 ms)
      let answerMs = 5;
      const r = await framed({}, (method, _params, session) =>
        method === "Input.dispatchMouseEvent" && session === "F"
          ? new Promise((resolve) => setTimeout(() => resolve({}), answerMs))
          : undefined,
      );
      const wheel = () =>
        void r.native.dispatchMouse({
          type: "mouseWheel",
          x: 180,
          y: 120,
          deltaX: 0,
          deltaY: 10,
        });
      wheel();
      await vi.advanceTimersByTimeAsync(40);
      wheel();
      await vi.advanceTimersByTimeAsync(40);
      answerMs = 1_000;
      wheel();
      // (40 ms apart as the hand sends them — one gesture — while F holds the chain)
      for (let i = 0; i < 3; i += 1) {
        await vi.advanceTimersByTimeAsync(40);
        wheel();
      }
      await vi.advanceTimersByTimeAsync(2_000);
      answerMs = 5;
      wheel();
      await vi.advanceTimersByTimeAsync(100);
      expect(r.hand()).toEqual([
        "mouseWheel@F 80,40",
        "mouseWheel@F 80,40",
        "mouseWheel@F 80,40",
        "mouseWheel@page 180,120",
        "mouseWheel@page 180,120",
        "mouseWheel@page 180,120",
        "mouseWheel@F 80,40",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("PT-6a (M1) — late is measured from a wheel's SEND, never its arrival: F answering each in 150 ms while the hand's wheels, 40 ms apart, wait behind each other in the chain — every one F's", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
    });
    try {
      const r = await framed({}, (method, _params, session) =>
        method === "Input.dispatchMouseEvent" && session === "F"
          ? new Promise((resolve) => setTimeout(() => resolve({}), 150))
          : undefined,
      );
      for (let i = 0; i < 8; i += 1) {
        void r.native.dispatchMouse({
          type: "mouseWheel",
          x: 180,
          y: 120,
          deltaX: 0,
          deltaY: 10,
        });
        await vi.advanceTimersByTimeAsync(40);
      }
      await vi.advanceTimersByTimeAsync(2_000);
      expect(r.hand()).toEqual(Array.from({ length: 8 }, () => "mouseWheel@F 80,40"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("M6.3a — a frame's VISIBLE part is READ beside its quad, of its owner in its parent's document (`Runtime.callFunctionOn` on the parent's session, its object released): a press on the part its scroller clips is the page's, on the part in view the frame's", async () => {
    const r = recording((method) => {
      if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
      if (method === "DOM.getBoxModel")
        return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
      if (method === "DOM.resolveNode") return { object: { objectId: "owner-7" } };
      if (method === "Runtime.callFunctionOn")
        return { result: { value: { visible: [0, 0.5, 1, 1], covers: [] } } };
      return {};
    });
    await r.native.loadURL("https://host.test/a");
    r.at("https://host.test/a");
    r.contents.emit("did-navigate", {}, "https://host.test/a");
    r.attach("F");
    await turns();
    const call = r.sent.find((c) => c.method === "Runtime.callFunctionOn");
    expect(call).toEqual({
      method: "Runtime.callFunctionOn",
      params: {
        objectId: "owner-7",
        functionDeclaration: FRAME_SIGHT,
        arguments: [{ value: false }],
        returnByValue: true,
      },
    });
    expect(r.sent).toContainEqual({
      method: "Runtime.releaseObject",
      params: { objectId: "owner-7" },
    });
    for (const y of [120, 305]) {
      await r.native.dispatchMouse({
        type: "mousePressed",
        x: 180,
        y,
        button: "left",
        clickCount: 1,
      });
      await r.native.dispatchMouse({
        type: "mouseReleased",
        x: 180,
        y,
        button: "left",
        clickCount: 1,
      });
    }
    expect(r.hand()).toEqual([
      "mousePressed@page 180,120",
      "mouseReleased@page 180,120",
      "mousePressed@F 80,225",
      "mouseReleased@F 80,225",
    ]);
  });

  describe("M7 H2 — M3's ban made total: the page's session gets nothing key-like unless the page's own document holds the focus (the review's cells)", () => {
    const word = (r: Awaited<ReturnType<typeof framed>>, payload: string, session?: string): void =>
      r.emit(
        "Runtime.bindingCalled",
        { name: FRAME_WORDS_BINDING, payload, executionContextId: 1 },
        session,
      );
    /** what came of a key-like event: sent, or refused (its words) — the doubt's second run out */
    const settle = async (sent: Promise<void>): Promise<string> => {
      const out = sent.then(
        () => "sent",
        (error: unknown) => `refused: ${error instanceof Error ? error.message : String(error)}`,
      );
      await vi.advanceTimersByTimeAsync(5_000);
      return out;
    };
    const press = async (r: Awaited<ReturnType<typeof framed>>, x: number, y: number) => {
      await r.native.dispatchMouse({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await r.native.dispatchMouse({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    };

    it("a press is a HINT: a key sent right after a press into F WAITS for the word of where the focus went — F's `here`, and it is REFUSED (M15: a frame of another site holds the focus) — never the page's, where the focus was before", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed();
        await r.native.dispatchMouse({
          type: "mousePressed",
          x: 180,
          y: 120,
          button: "left",
          clickCount: 1,
        });
        const key = r.native.dispatchKey({
          type: "keyDown",
          key: "h",
          code: "KeyH",
          modifiers: NONE,
        });
        await vi.advanceTimersByTimeAsync(200);
        expect(r.hand()).toEqual(["mousePressed@F 80,40"]);
        word(r, "here", "F");
        expect(await settle(key)).toBe(
          "refused: Browser input's focus is in a frame of another site — typing there is off",
        );
        expect(r.hand()).toEqual(["mousePressed@F 80,40"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("(a) a Tab on the page whose default moves the focus into F: its up is REFUSED (M15, J13's stated limit: the page keeps it down until its next up) — never the page's session, nor F's", async () => {
      const r = await framed();
      await r.native.dispatchKey({ type: "keyDown", key: "Tab", code: "Tab", modifiers: NONE });
      word(r, "here", "F");
      word(r, "inner");
      await expect(
        r.native.dispatchKey({ type: "keyUp", key: "Tab", code: "Tab", modifiers: NONE }),
      ).rejects.toThrow("a frame of another site");
      expect(r.hand()).toEqual(["keyDown@page"]);
    });

    it("(b) a press on the page that keeps F's focus (its mousedown prevented): the page says `inner` — F still holds it: a key REFUSED (M15), never the page's", async () => {
      const r = await framed();
      await press(r, 180, 120);
      word(r, "here", "F");
      await press(r, 20, 20);
      word(r, "inner");
      await expect(r.native.dispatchText("x")).rejects.toThrow("a frame of another site");
      expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual([]);
    });

    it("(c) a page-session press over F whose quad is not read — the host focused F's element: the page says `inner`; until F's own word a key WAITS, then is refused — never on the page's session; F's word, and the next is REFUSED at once (M15)", async () => {
      vi.useFakeTimers();
      try {
        const r = recording((method) => {
          if (method === "DOM.getBoxModel") throw new Error("not laid out yet");
          return {};
        });
        await r.native.loadURL("https://host.test/a");
        r.at("https://host.test/a");
        r.contents.emit("did-navigate", {}, "https://host.test/a");
        r.attach("F");
        await vi.advanceTimersByTimeAsync(0);
        await press(r, 180, 120);
        word(r, "inner");
        const said = await settle(r.native.dispatchText("x"));
        expect(said).toBe("refused: Browser input's focus is in doubt");
        expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual([]);
        word(r, "here", "F");
        expect(await settle(r.native.dispatchText("y"))).toBe(
          "refused: Browser input's focus is in a frame of another site — typing there is off",
        );
        expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("(d) a script moves the focus into F (`iframe.focus()`): the page's `inner` puts it in doubt — a key WAITS for F's word, then is REFUSED (M15)", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed();
        word(r, "inner");
        const text = r.native.dispatchText("x");
        await vi.advanceTimersByTimeAsync(100);
        expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual([]);
        word(r, "here", "F");
        expect(await settle(text)).toBe(
          "refused: Browser input's focus is in a frame of another site — typing there is off",
        );
        expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("(e) F says `away` and no document says it took the focus (the whole page lost it): a key waits, then is refused — sent nowhere", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed();
        await press(r, 180, 120);
        word(r, "here", "F");
        word(r, "away", "F");
        const said = await settle(r.native.dispatchText("x"));
        expect(said).toBe("refused: Browser input's focus is in doubt");
        expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("(f) the focused frame's session SWAPPED (its own cross-site navigation) or gone: a key waits, then is refused — never on the page's session", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed();
        await press(r, 180, 120);
        word(r, "here", "F");
        r.emit("Target.detachedFromTarget", { sessionId: "F", targetId: "t-F" });
        const said = await settle(r.native.dispatchText("x"));
        expect(said).toBe("refused: Browser input's focus is in doubt");
        expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("(g) the page's own `away` (the page lost the focus): a key waits, then is refused — not sent on the page's session", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed();
        word(r, "away");
        const said = await settle(r.native.dispatchText("x"));
        expect(said).toBe("refused: Browser input's focus is in doubt");
        expect(r.hand()).not.toContain("insertText@page x");
      } finally {
        vi.useRealTimers();
      }
    });

    it("M12 J3 (unfrozen at M15) — a word said of an EARLIER hint never settles a later one: the page's late word, its event 600 ms old (before the press into F was sent), heard after the press — it moves nothing; F's own word of the press settles it: the text then REFUSED (M15), never sent on the page's session", async () => {
      vi.useFakeTimers({
        toFake: [
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "Date",
          "performance",
        ],
      });
      try {
        const r = await framed();
        await vi.advanceTimersByTimeAsync(1_000);
        await press(r, 180, 120);
        word(r, "here@600");
        const text = r.native.dispatchText("x");
        await vi.advanceTimersByTimeAsync(100);
        expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual([]);
        word(r, "here@0", "F");
        expect(await settle(text)).toBe(
          "refused: Browser input's focus is in a frame of another site — typing there is off",
        );
        expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("M12 J6 (unfrozen at M15) — a key WAITING for a word when the PAGE commits is refused (its document is gone), never sent into the new one", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed();
        word(r, "inner");
        const key = r.native.dispatchKey({
          type: "keyDown",
          key: "a",
          code: "KeyA",
          modifiers: NONE,
        });
        await vi.advanceTimersByTimeAsync(100);
        r.at("https://host.test/b");
        r.contents.emit("did-navigate", {}, "https://host.test/b");
        expect(await settle(key)).toBe("refused: Browser input's document is gone");
        expect(r.hand()).not.toContain("keyDown@page");
      } finally {
        vi.useRealTimers();
      }
    });

    it("M15 J13 — a key's UP whose down went to the page: to the page while the PAGE holds the focus (its word); in doubt it WAITS like the rest — the word comes, and it goes; a frame of another site holding the focus: REFUSED at once — a stated limit (the page keeps that key down until its next up)", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed();
        const shift = (type: "keyDown" | "keyUp") =>
          r.native.dispatchKey({ type, key: "Shift", code: "ShiftLeft", modifiers: NONE });
        // the page holds the focus: its down and its up, the page's
        await shift("keyDown");
        word(r, "here");
        expect(await settle(shift("keyUp"))).toBe("sent");
        // in doubt — a press into F: the up waits; F says the focus is not in it (its mousedown kept it out): it goes
        await shift("keyDown");
        word(r, "here");
        await press(r, 180, 120);
        const up = shift("keyUp");
        await vi.advanceTimersByTimeAsync(100);
        expect(r.hand().filter((h) => h.startsWith("keyUp"))).toHaveLength(1);
        word(r, "away", "F");
        expect(await settle(up)).toBe("sent");
        // F holds the focus (its word): the up refused, at once
        await shift("keyDown");
        word(r, "here");
        await press(r, 180, 120);
        word(r, "here", "F");
        expect(await settle(shift("keyUp"))).toBe(
          "refused: Browser input's focus is in a frame of another site — typing there is off",
        );
        expect(r.hand().filter((h) => h.startsWith("key"))).toEqual([
          "keyDown@page",
          "keyUp@page",
          "keyDown@page",
          "keyUp@page",
          "keyDown@page",
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("M12 J7 (unfrozen at M15) — ONE bound a doubt: five texts in a doubt no word ends — the first waits its second and is refused; the episode SPENT, the four after it are refused at once; a move behind them is sent within that second, never held five", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed();
        word(r, "here", "F");
        word(r, "away", "F");
        const said: string[] = [];
        const texts = Array.from({ length: 5 }, () =>
          r.native.dispatchText("x").then(
            () => said.push("sent"),
            (error: unknown) =>
              said.push(`refused: ${error instanceof Error ? error.message : String(error)}`),
          ),
        );
        void r.native.dispatchMouse({
          type: "mouseMoved",
          x: 1,
          y: 1,
          button: "none",
          buttons: 0,
        });
        await vi.advanceTimersByTimeAsync(900);
        expect(said).toEqual([]);
        await vi.advanceTimersByTimeAsync(200);
        expect(r.hand()).toContain("mouseMoved@page 1,1");
        expect(said).toEqual(Array(5).fill("refused: Browser input's focus is in doubt"));
        expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual([]);
        await Promise.all(texts);
      } finally {
        vi.useRealTimers();
      }
    });

    it("M12 J7 — a new EPISODE: a word (any focus word — one that leaves the focus unknown too) or a new hint renews the doubt's bound: the next key-like event waits its second again; spent again, the one after it is refused at once", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed();
        word(r, "here", "F");
        word(r, "away", "F");
        const said: string[] = [];
        const text = (t: string): void => {
          void r.native.dispatchText(t).then(
            () => said.push(`${t} sent`),
            () => said.push(`${t} refused`),
          );
        };
        // the episode: the first waits its second; spent — the next refused at once
        text("a");
        await vi.advanceTimersByTimeAsync(1_100);
        text("b");
        await vi.advanceTimersByTimeAsync(0);
        expect(said).toEqual(["a refused", "b refused"]);
        // a word that leaves the focus unknown (the page's `away`): a new episode — the next waits its second again
        word(r, "away");
        text("c");
        await vi.advanceTimersByTimeAsync(500);
        expect(said).toEqual(["a refused", "b refused"]);
        await vi.advanceTimersByTimeAsync(600);
        text("d");
        await vi.advanceTimersByTimeAsync(0);
        expect(said).toEqual(["a refused", "b refused", "c refused", "d refused"]);
        // a new hint (a press on the page): a new episode — the next waits for its word, and the page's own sends it
        await press(r, 1, 1);
        text("e");
        await vi.advanceTimersByTimeAsync(500);
        expect(said).toHaveLength(4);
        word(r, "here");
        await vi.advanceTimersByTimeAsync(0);
        expect(said).toEqual(["a refused", "b refused", "c refused", "d refused", "e sent"]);
        expect(r.hand().filter((h) => h.startsWith("insertText"))).toEqual(["insertText@page e"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("PT-6a (K3) — M15 × J13: a key held on the PAGE, its repeats refused while F holds the focus, let up once the page holds it again: its up goes to the page — a refused down is never recorded", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed();
        const key = (type: "keyDown" | "keyUp", autoRepeat?: boolean) =>
          r.native.dispatchKey({
            type,
            key: "ArrowDown",
            code: "ArrowDown",
            modifiers: NONE,
            ...(autoRepeat ? { autoRepeat } : {}),
          });
        await key("keyDown");
        word(r, "here");
        await press(r, 180, 120);
        word(r, "here", "F");
        expect(await settle(key("keyDown", true))).toMatch(/a frame of another site/);
        await press(r, 20, 20);
        word(r, "here");
        word(r, "away", "F");
        expect(await settle(key("keyUp"))).toBe("sent");
        expect(r.hand().filter((h) => h.startsWith("key"))).toEqual(["keyDown@page", "keyUp@page"]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("PT-6a (K1) — a doubt born of the PAGE's own press, the page holding the focus: its key-like events HELD until the page's word (the host's bound, never the second); the word itself timed", () => {
    const BOUND = 20_000;
    const word = (r: Awaited<ReturnType<typeof framed>>, payload: string, session?: string): void =>
      r.emit(
        "Runtime.bindingCalled",
        { name: FRAME_WORDS_BINDING, payload, executionContextId: 1 },
        session,
      );
    const key = (r: Awaited<ReturnType<typeof framed>>, k: string): Promise<void> =>
      r.native.dispatchKey({
        type: "keyDown",
        key: k,
        code: `Key${k.toUpperCase()}`,
        modifiers: NONE,
      });
    const pressAt = (r: Awaited<ReturnType<typeof framed>>, x: number, y: number): Promise<void> =>
      r.native.dispatchMouse({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
    const hungOf = (r: Awaited<ReturnType<typeof framed>>): (string | undefined)[] => {
      const hung: (string | undefined)[] = [];
      r.native.onInputHung((frame) => hung.push(frame));
      return hung;
    };

    it("review 3's K1 (a) — a page holding a frame of another site, busy after a press on its OWN field (its word late past the second): the keys typed meanwhile are HELD, then typed in order — never refused (as at 8dd23597); each key's own word said as a page says it", async () => {
      vi.useFakeTimers();
      try {
        let speak: (() => void) | undefined;
        const r = await framed({ hungInputMs: BOUND }, (method, _params, session) => {
          // (a page says where its focus is after each key it hears — its thread free again by then)
          if (method === "Input.dispatchKeyEvent" && session === undefined) speak?.();
          return undefined;
        });
        speak = () => word(r, "here");
        // the page's own field — answered at once; the page's word not yet said
        await pressAt(r, 20, 20);
        const said: string[] = [];
        for (const k of ["a", "b", "c"])
          void key(r, k).then(
            () => said.push(`${k} sent`),
            () => said.push(`${k} refused`),
          );
        await vi.advanceTimersByTimeAsync(1_500);
        expect(said).toEqual([]);
        // the thread frees: the page's word
        word(r, "here");
        await vi.advanceTimersByTimeAsync(0);
        expect(said).toEqual(["a sent", "b sent", "c sent"]);
        expect(r.hand().filter((h) => h.startsWith("keyDown"))).toEqual([
          "keyDown@page",
          "keyDown@page",
          "keyDown@page",
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("review 3's K1 (b) — ruling 6 × M12 J2: a page holding a frame of another site, hung after its press was ANSWERED (its word never comes) — the key typed is held, never sent, and the page is SAID hung at the host's bound", async () => {
      vi.useFakeTimers();
      try {
        const r = await framed({ hungInputMs: BOUND }, (method) =>
          method === "Input.dispatchKeyEvent" ? new Promise(() => {}) : undefined,
        );
        const hung = hungOf(r);
        await pressAt(r, 20, 20);
        void key(r, "q").catch(() => undefined);
        await vi.advanceTimersByTimeAsync(25_000);
        expect(hung).toEqual([undefined]);
        expect(r.hand().filter((h) => h.startsWith("keyDown"))).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("the hold's edges: the page's word that says the focus LEFT it (`inner`) ends the hold — the frame's word awaited J7's second from it; a press the engine REFUSED holds nothing (its second); a window born without the host's bound keeps the second", async () => {
      vi.useFakeTimers();
      try {
        const tell = (said: string[], k: string, sent: Promise<void>): void => {
          void sent.then(
            () => said.push(`${k} sent`),
            (error: unknown) =>
              said.push(`${k} refused: ${error instanceof Error ? error.message : String(error)}`),
          );
        };
        // the page's `inner`: held past the second until it, then the second from it
        const r = await framed({ hungInputMs: BOUND });
        await pressAt(r, 20, 20);
        const said: string[] = [];
        tell(said, "a", key(r, "a"));
        await vi.advanceTimersByTimeAsync(1_500);
        expect(said).toEqual([]);
        word(r, "inner");
        await vi.advanceTimersByTimeAsync(900);
        expect(said).toEqual([]);
        await vi.advanceTimersByTimeAsync(200);
        expect(said).toEqual(["a refused: Browser input's focus is in doubt"]);
        // a press the engine refused: nothing reached the page — no hold
        const q = await framed({ hungInputMs: BOUND }, (method) =>
          method === "Input.dispatchMouseEvent" ? Promise.reject(new Error("refused")) : undefined,
        );
        await pressAt(q, 20, 20).catch(() => undefined);
        const refusedPress: string[] = [];
        tell(refusedPress, "b", key(q, "b"));
        await vi.advanceTimersByTimeAsync(1_100);
        expect(refusedPress).toEqual(["b refused: Browser input's focus is in doubt"]);
        // born without the host's bound: the second
        const plain = await framed();
        await pressAt(plain, 20, 20);
        const unbound: string[] = [];
        tell(unbound, "c", key(plain, "c"));
        await vi.advanceTimersByTimeAsync(1_100);
        expect(unbound).toEqual(["c refused: Browser input's focus is in doubt"]);
        // a press on the page while F held the focus (its word): no doubt of the page's own — J7's second
        const s = await framed({ hungInputMs: BOUND });
        await pressAt(s, 180, 120);
        word(s, "here", "F");
        await pressAt(s, 20, 20);
        const fromFrame: string[] = [];
        tell(fromFrame, "d", key(s, "d"));
        await vi.advanceTimersByTimeAsync(1_100);
        expect(fromFrame).toEqual(["d refused: Browser input's focus is in doubt"]);
        // the page's `inner` heard, then another press on the page: the focus before it was not the page's — J7's second
        const t = await framed({ hungInputMs: BOUND });
        await pressAt(t, 20, 20);
        word(t, "inner");
        await pressAt(t, 30, 30);
        const afterInner: string[] = [];
        tell(afterInner, "e", key(t, "e"));
        await vi.advanceTimersByTimeAsync(1_100);
        expect(afterInner).toEqual(["e refused: Browser input's focus is in doubt"]);
        // a KEY's own down is a hint of the page's own too: its word late past the second, the next key held until it
        const u = await framed({ hungInputMs: BOUND });
        await pressAt(u, 20, 20);
        word(u, "here");
        const ordered: string[] = [];
        tell(ordered, "f", key(u, "f"));
        tell(ordered, "g", key(u, "g"));
        await vi.advanceTimersByTimeAsync(1_500);
        expect(ordered).toEqual(["f sent"]);
        word(u, "here");
        await vi.advanceTimersByTimeAsync(0);
        expect(ordered).toEqual(["f sent", "g sent"]);
        // a TAP's end on the page is one too (a finger on the page's ground, its word late)
        const v = await framed({ hungInputMs: BOUND });
        await v.native.dispatchTouch({
          type: "touchStart",
          touchPoints: [{ x: 20, y: 20, id: 0 }],
        });
        await v.native.dispatchTouch({ type: "touchEnd", touchPoints: [] });
        const tapped: string[] = [];
        tell(tapped, "h", key(v, "h"));
        await vi.advanceTimersByTimeAsync(1_500);
        expect(tapped).toEqual([]);
        word(v, "here");
        await vi.advanceTimersByTimeAsync(0);
        expect(tapped).toEqual(["h sent"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("(b)'s edges: a word within the bound, the page's commit, a press INTO the frame, a frameless page — nothing said; a second press before the bound times its OWN word from its answer; a frame attached after the answer — timed from the first key that waits for it", async () => {
      vi.useFakeTimers();
      try {
        // a word within the bound
        const a = await framed({ hungInputMs: BOUND });
        const saidA = hungOf(a);
        await pressAt(a, 20, 20);
        await vi.advanceTimersByTimeAsync(5_000);
        word(a, "here");
        await vi.advanceTimersByTimeAsync(BOUND * 2);
        expect(saidA).toEqual([]);
        // the page's commit
        const b = await framed({ hungInputMs: BOUND });
        const saidB = hungOf(b);
        await pressAt(b, 20, 20);
        await vi.advanceTimersByTimeAsync(5_000);
        b.at("https://host.test/b");
        b.contents.emit("did-navigate", {}, "https://host.test/b");
        await vi.advanceTimersByTimeAsync(BOUND * 2);
        expect(saidB).toEqual([]);
        // a press into the frame, whose word never comes
        const c = await framed({ hungInputMs: BOUND });
        const saidC = hungOf(c);
        await pressAt(c, 180, 120);
        await vi.advanceTimersByTimeAsync(BOUND * 2);
        expect(saidC).toEqual([]);
        expect(c.hand()).toEqual(["mousePressed@F 80,40"]);
        // a frameless page
        const d = recording(() => ({}), { hungInputMs: BOUND });
        const saidD: (string | undefined)[] = [];
        d.native.onInputHung((frame) => saidD.push(frame));
        await d.native.loadURL("https://host.test/a");
        d.at("https://host.test/a");
        d.contents.emit("did-navigate", {}, "https://host.test/a");
        await d.native.dispatchMouse({
          type: "mousePressed",
          x: 20,
          y: 20,
          button: "left",
          clickCount: 1,
        });
        await vi.advanceTimersByTimeAsync(BOUND * 2);
        expect(saidD).toEqual([]);
        // a second press 15 s in: the first's timing gone, the second's from its answer
        const e = await framed({ hungInputMs: BOUND });
        const saidE = hungOf(e);
        await pressAt(e, 20, 20);
        await vi.advanceTimersByTimeAsync(15_000);
        await pressAt(e, 30, 30);
        await vi.advanceTimersByTimeAsync(BOUND - 1);
        expect(saidE).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(saidE).toEqual([undefined]);
        // a frame attached after the press was answered: timed from the first key that waits for its word
        const f = recording(
          (method, params) => {
            if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
            if (method === "DOM.getBoxModel")
              return (params as { backendNodeId: number }).backendNodeId === 7
                ? { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } }
                : {};
            return {};
          },
          { hungInputMs: BOUND },
        );
        const saidF: (string | undefined)[] = [];
        f.native.onInputHung((frame) => saidF.push(frame));
        await f.native.loadURL("https://host.test/a");
        f.at("https://host.test/a");
        f.contents.emit("did-navigate", {}, "https://host.test/a");
        await f.native.dispatchMouse({
          type: "mousePressed",
          x: 20,
          y: 20,
          button: "left",
          clickCount: 1,
        });
        await vi.advanceTimersByTimeAsync(1_000);
        f.attach("F");
        await vi.advanceTimersByTimeAsync(0);
        void f.native
          .dispatchKey({ type: "keyDown", key: "q", code: "KeyQ", modifiers: NONE })
          .catch(() => undefined);
        await vi.advanceTimersByTimeAsync(BOUND - 1);
        expect(saidF).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(saidF).toEqual([undefined]);
        // ONE timing a window: ten presses whose words never come keep one timer, never ten
        const g = await framed({ hungInputMs: BOUND });
        await pressAt(g, 20, 20);
        const timers = vi.getTimerCount();
        for (let i = 0; i < 10; i += 1) await pressAt(g, 20 + i, 20);
        expect(vi.getTimerCount()).toBe(timers);
      } finally {
        vi.useRealTimers();
      }
    });

    describe("PT-6a (M4, M5 — F1) — a missing word is never by itself a hang, and a document that cannot speak is never waited on: its top at `about:blank` resets as a commit resets the frames; a page-born doubt without its word by the second ASKS the page where its focus is (a PULLED word)", () => {
      /** the words' own `where()`, PULLED: the page's session, its main frame's words world */
      const isPull = (method: string, params: unknown, session?: string): boolean =>
        method === "Runtime.evaluate" &&
        session === undefined &&
        String((params as { expression?: unknown }).expression).includes("__vibefield_where");
      /** a framed page whose pushed words never come (a MUTE document); its pulled word answered as the row says */
      const mute = (answer: () => Promise<unknown>) =>
        framed({ hungInputMs: BOUND }, (method, params, session) =>
          isPull(method, params, session) ? (answer() as Promise<object>) : undefined,
        );
      const asksOf = (r: Awaited<ReturnType<typeof framed>>) =>
        r.sent.filter((c) => isPull(c.method, c.params, c.session));
      const typed = (
        r: Awaited<ReturnType<typeof framed>>,
        keys: string[],
        said: string[],
      ): void => {
        for (const k of keys)
          void key(r, k).then(
            () => said.push(`${k} sent`),
            () => said.push(`${k} refused`),
          );
      };

      it("review F1 — a framed page whose TOP goes to `about:blank` after its remote load (no words run there): its frames reset as at a commit — the doubt, `#framed`, the hand — so a press there waits for no word: its key sent at once, the page never said hung", async () => {
        vi.useFakeTimers();
        try {
          const r = await framed({ hungInputMs: BOUND });
          const hung = hungOf(r);
          // (a key waiting for the word of a press on the page before: refused with its document, as at a commit — J6)
          await pressAt(r, 20, 20);
          const before: string[] = [];
          typed(r, ["z"], before);
          await vi.advanceTimersByTimeAsync(0);
          expect(before).toEqual([]);
          r.at("about:blank");
          r.contents.emit("did-navigate", {}, "about:blank");
          await vi.advanceTimersByTimeAsync(0);
          expect(before).toEqual(["z refused"]);
          r.emit("Target.detachedFromTarget", { sessionId: "F", targetId: "t-F" });
          await pressAt(r, 20, 20);
          const said: string[] = [];
          typed(r, ["a"], said);
          await vi.advanceTimersByTimeAsync(0);
          expect(said).toEqual(["a sent"]);
          await vi.advanceTimersByTimeAsync(BOUND * 2);
          expect(hung).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      });

      it("M5 — a MUTE document: at the second without a word the page is ASKED — the words' own `where()` in their isolated world of the MAIN frame, after a 0-ms timer, off the hand's chain; `here` sends the held keys in order; the page never said hung; the document then PULL-ONLY (main's census counts it): the next doubt asks at once", async () => {
        vi.useFakeTimers();
        try {
          const r = await mute(() => Promise.resolve({ result: { value: "here" } }));
          const hung = hungOf(r);
          await pressAt(r, 20, 20);
          const said: string[] = [];
          typed(r, ["a", "b", "c"], said);
          await vi.advanceTimersByTimeAsync(999);
          expect(said).toEqual([]);
          expect(asksOf(r)).toHaveLength(0);
          await vi.advanceTimersByTimeAsync(1);
          await vi.advanceTimersByTimeAsync(0);
          expect(said).toEqual(["a sent", "b sent", "c sent"]);
          const [first] = asksOf(r);
          expect(first?.params).toMatchObject({
            contextId: 41,
            awaitPromise: true,
            returnByValue: true,
          });
          expect(
            String((first?.params as { expression?: unknown } | undefined)?.expression),
          ).toContain("setTimeout");
          // (each key's down a hint of its own — the last key's too, which no key waits on: the document pull-only, each
          // asked at once; the press's at the second)
          expect(asksOf(r)).toHaveLength(4);
          expect(r.native.pullOnly?.()).toBe(1);
          await pressAt(r, 30, 20);
          typed(r, ["d"], said);
          await vi.advanceTimersByTimeAsync(0);
          expect(said).toEqual(["a sent", "b sent", "c sent", "d sent"]);
          await vi.advanceTimersByTimeAsync(BOUND * 2);
          expect(hung).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      });

      it("M5 — the PULL-ONLY mark lasts until the document's next COMMIT: the new document's doubts wait their second for a pushed word again before they ask (main's census back to none)", async () => {
        vi.useFakeTimers();
        try {
          const r = await mute(() => Promise.resolve({ result: { value: "here" } }));
          await pressAt(r, 20, 20);
          await vi.advanceTimersByTimeAsync(1_000);
          expect(r.native.pullOnly?.()).toBe(1);
          r.at("https://host.test/b");
          r.contents.emit("did-navigate", {}, "https://host.test/b");
          expect(r.native.pullOnly?.()).toBe(0);
          r.attach("G");
          await turns();
          const asked = asksOf(r).length;
          await pressAt(r, 20, 20);
          const said: string[] = [];
          typed(r, ["a"], said);
          await vi.advanceTimersByTimeAsync(999);
          expect(asksOf(r)).toHaveLength(asked);
          expect(said).toEqual([]);
          await vi.advanceTimersByTimeAsync(1);
          await vi.advanceTimersByTimeAsync(0);
          // (the press's at the second; the key's own down at once — the new document pull-only in its turn)
          expect(asksOf(r)).toHaveLength(asked + 2);
          expect(said).toEqual(["a sent"]);
          expect(r.native.pullOnly?.()).toBe(1);
        } finally {
          vi.useRealTimers();
        }
      });

      it("M5 — a pull answering `inner` or `away` settles nothing (the focus unknown): as J7 — the held key refused a second after the answer, never sent blind; the page never said hung", async () => {
        vi.useFakeTimers();
        try {
          for (const where of ["inner", "away"]) {
            const r = await mute(() => Promise.resolve({ result: { value: where } }));
            const hung = hungOf(r);
            await pressAt(r, 20, 20);
            const said: string[] = [];
            typed(r, ["a"], said);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(asksOf(r)).toHaveLength(1);
            expect(said).toEqual([]);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(said).toEqual(["a refused"]);
            expect(r.hand().filter((h) => h.startsWith("keyDown"))).toEqual([]);
            await vi.advanceTimersByTimeAsync(BOUND * 2);
            expect(hung).toEqual([]);
          }
        } finally {
          vi.useRealTimers();
        }
      });

      it("K1 (a) unchanged — a BUSY page: the pull waits on its event loop and answers nothing; its pushed word, late, ends the hold (and a word for each key once it is free) — the keys sent in order, nothing marked pull-only, never said hung", async () => {
        vi.useFakeTimers();
        try {
          let speak: (() => void) | undefined;
          const r = await framed({ hungInputMs: BOUND }, (method, params, session) => {
            // (once free, the page says where its focus is after each key it hears)
            if (method === "Input.dispatchKeyEvent" && session === undefined) speak?.();
            return isPull(method, params, session) ? new Promise(() => {}) : undefined;
          });
          const hung = hungOf(r);
          await pressAt(r, 20, 20);
          const said: string[] = [];
          typed(r, ["a", "b"], said);
          await vi.advanceTimersByTimeAsync(1_500);
          expect(asksOf(r)).toHaveLength(1);
          expect(said).toEqual([]);
          speak = () => word(r, "here");
          word(r, "here");
          await vi.advanceTimersByTimeAsync(0);
          expect(said).toEqual(["a sent", "b sent"]);
          expect(r.native.pullOnly?.()).toBe(0);
          await vi.advanceTimersByTimeAsync(BOUND * 2);
          expect(hung).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      });

      it("K1 (b) unchanged — a HUNG page (no word, the pull never answered) is said hung at the host's bound; so is one whose ask is REFUSED, and one whose main frame's words world is gone (no ask sent) — one ask a doubt, never a storm", async () => {
        vi.useFakeTimers();
        try {
          for (const answer of [
            () => new Promise(() => {}),
            () => Promise.reject(new Error("refused")),
          ]) {
            const r = await mute(answer);
            const hung = hungOf(r);
            await pressAt(r, 20, 20);
            const said: string[] = [];
            typed(r, ["a"], said);
            await vi.advanceTimersByTimeAsync(BOUND - 1);
            expect(said).toEqual([]);
            expect(asksOf(r)).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(hung).toEqual([undefined]);
          }
          const gone = await mute(() => Promise.resolve({ result: { value: "here" } }));
          const hung = hungOf(gone);
          gone.emit("Runtime.executionContextsCleared", {});
          await pressAt(gone, 20, 20);
          typed(gone, ["a"], []);
          await vi.advanceTimersByTimeAsync(BOUND);
          expect(asksOf(gone)).toHaveLength(0);
          expect(hung).toEqual([undefined]);
        } finally {
          vi.useRealTimers();
        }
      });

      it("M5 — a pushed word and a pulled answer race: whichever comes second is stale — the push first, the late answer (of the same truth) settles nothing new and marks nothing; an answer stamped before a LATER hint is ignored (J3)", async () => {
        vi.useFakeTimers();
        try {
          let release: ((value: object) => void) | undefined;
          const held = () =>
            new Promise<object>((resolve) => {
              release = resolve;
            });
          const r = await mute(held);
          await pressAt(r, 20, 20);
          const said: string[] = [];
          typed(r, ["a"], said);
          await vi.advanceTimersByTimeAsync(1_000);
          expect(asksOf(r)).toHaveLength(1);
          word(r, "here");
          await vi.advanceTimersByTimeAsync(0);
          expect(said).toEqual(["a sent"]);
          release?.({ result: { value: "here" } });
          await vi.advanceTimersByTimeAsync(0);
          expect(r.native.pullOnly?.()).toBe(0);
          // a press whose word never comes: asked at the second; another press meanwhile — the first ask's answer, stamped
          // before it, moves nothing and marks nothing; the second's own doubt still awaits its word
          const later = await mute(held);
          await pressAt(later, 20, 20);
          await vi.advanceTimersByTimeAsync(1_000);
          expect(asksOf(later)).toHaveLength(1);
          const first = release;
          await vi.advanceTimersByTimeAsync(100);
          await pressAt(later, 25, 20);
          first?.({ result: { value: "here" } });
          await vi.advanceTimersByTimeAsync(0);
          expect(later.native.pullOnly?.()).toBe(0);
          const said2: string[] = [];
          typed(later, ["b"], said2);
          await vi.advanceTimersByTimeAsync(0);
          expect(said2).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      });

      it("`destroy()` lets the pull's timer go, and refuses the focus waiters at once (the reviewer's note): no ask after it, nothing said hung", async () => {
        vi.useFakeTimers();
        try {
          const r = await mute(() => new Promise(() => {}));
          Object.assign(electron.made.at(-1) ?? {}, { destroy: () => undefined });
          const hung = hungOf(r);
          await pressAt(r, 20, 20);
          const said: string[] = [];
          typed(r, ["a"], said);
          await vi.advanceTimersByTimeAsync(10);
          r.native.destroy();
          await vi.advanceTimersByTimeAsync(0);
          expect(said).toEqual(["a refused"]);
          await vi.advanceTimersByTimeAsync(BOUND * 2);
          expect(asksOf(r)).toHaveLength(0);
          expect(hung).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  describe("M6.5b — a frame of another site is told the page's DEVICE: its agent with its hints, touch, the colour scheme", () => {
    const device = (userAgent: string, touchPoints: number, colorScheme: "light" | "dark") => ({
      userAgent,
      navigatorPlatform: touchPoints > 0 ? "iPhone" : "MacIntel",
      metadata: {
        brands: [],
        fullVersionList: [],
        platform: touchPoints > 0 ? "iOS" : "macOS",
        platformVersion: "26.0",
        architecture: "",
        model: "",
        mobile: touchPoints > 0,
      },
      touchPoints,
      colorScheme,
    });
    const PHONE_DEVICE = device("phone/1", 5, "dark");
    const LAPTOP_DEVICE = device("laptop/1", 0, "light");
    const agents = (r: ReturnType<typeof recording>, session: string): string[] =>
      r.sent
        .filter((c) => c.session === session && c.method === "Emulation.setUserAgentOverride")
        .map((c) => (c.params as { userAgent: string }).userAgent);

    it("(ii) at its attach — after its guards, before its own auto-attach — as the page was last told: its agent and hints, touch, the colour scheme; a frame attached before any device is told none", async () => {
      const r = recording();
      r.attach("E");
      await turns();
      expect(r.on("E").filter((m) => m.startsWith("Emulation."))).toEqual([]);
      await r.native.setEmulation(PHONE_DEVICE);
      r.attach("F");
      await turns();
      const steps = r.on("F");
      expect(steps.filter((m) => m.startsWith("Emulation."))).toEqual([
        "Emulation.setUserAgentOverride",
        "Emulation.setTouchEmulationEnabled",
        "Emulation.setEmulatedMedia",
      ]);
      expect(steps.indexOf("Emulation.setUserAgentOverride")).toBeGreaterThan(
        steps.lastIndexOf("Page.addScriptToEvaluateOnNewDocument"),
      );
      // (M12 J4: the steps go independently — the device and the frame's own auto-attach in either order, both before
      // the resume)
      expect(steps).toContain("Target.setAutoAttach");
      expect(steps.indexOf("Emulation.setEmulatedMedia")).toBeLessThan(
        steps.indexOf("Runtime.runIfWaitingForDebugger"),
      );
      const on = (method: string): unknown =>
        r.sent.find((c) => c.session === "F" && c.method === method)?.params;
      expect(on("Emulation.setUserAgentOverride")).toEqual({
        userAgent: "phone/1",
        platform: "iPhone",
        userAgentMetadata: PHONE_DEVICE.metadata,
      });
      expect(on("Emulation.setTouchEmulationEnabled")).toEqual({
        enabled: true,
        maxTouchPoints: 5,
      });
      expect(on("Emulation.setEmulatedMedia")).toEqual({
        features: [{ name: "prefers-color-scheme", value: "dark" }],
      });
    });

    it("(ii) at each switch of the page's device every attached frame is told again, once the page's own is answered; a frame attaching while a switch is in flight is told the device last answered, then the switch's — the last it is told is the latest", async () => {
      let release: () => void = () => undefined;
      const r = recording((method, params, session) =>
        method === "Emulation.setUserAgentOverride" &&
        session === undefined &&
        (params as { userAgent: string }).userAgent === "laptop/1"
          ? new Promise((resolve) => {
              release = () => resolve({});
            })
          : {},
      );
      await r.native.setEmulation(PHONE_DEVICE);
      r.attach("F");
      await turns();
      const switching = r.native.setEmulation(LAPTOP_DEVICE);
      await turns();
      // the page's switch unanswered: G attaches — told the phone, the device last answered
      r.attach("G");
      await turns();
      expect(agents(r, "G")).toEqual(["phone/1"]);
      release();
      await switching;
      await turns();
      expect(agents(r, "F")).toEqual(["phone/1", "laptop/1"]);
      expect(agents(r, "G")).toEqual(["phone/1", "laptop/1"]);
    });

    it("PT-6a (K4) — review 3's: an AGENT the frame never answers at its attach keeps none of the device's others unsent at its resume — touch and the colour scheme go with it, before the frame runs", async () => {
      vi.useFakeTimers();
      try {
        const r = recording((method, _p, session) =>
          method === "Emulation.setUserAgentOverride" && session === "F"
            ? new Promise(() => {})
            : {},
        );
        await r.native.setEmulation(PHONE_DEVICE);
        r.attach("F");
        await vi.advanceTimersByTimeAsync(2_000);
        const steps = r.on("F");
        const resume = steps.indexOf("Runtime.runIfWaitingForDebugger");
        expect(resume).toBeGreaterThan(-1);
        expect(steps.indexOf("Emulation.setTouchEmulationEnabled")).toBeGreaterThan(-1);
        expect(steps.indexOf("Emulation.setTouchEmulationEnabled")).toBeLessThan(resume);
        expect(steps.indexOf("Emulation.setEmulatedMedia")).toBeLessThan(resume);
        expect(steps.indexOf("Emulation.setEmulatedMedia")).toBeGreaterThan(-1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("PT-6a (K4) — each of a tell's commands BOUNDED: a switch whose agent the frame never answers keeps no LATER switch from being told (its tells chained) — told within the bound", async () => {
      vi.useFakeTimers();
      try {
        const r = recording((method, params, session) =>
          method === "Emulation.setUserAgentOverride" &&
          session === "F" &&
          (params as { userAgent: string }).userAgent === "laptop/1"
            ? new Promise(() => {})
            : {},
        );
        await r.native.setEmulation(PHONE_DEVICE);
        r.attach("F");
        await vi.advanceTimersByTimeAsync(0);
        await r.native.setEmulation(LAPTOP_DEVICE);
        await vi.advanceTimersByTimeAsync(0);
        await r.native.setEmulation(PHONE_DEVICE);
        await vi.advanceTimersByTimeAsync(2_100);
        expect(agents(r, "F")).toEqual(["phone/1", "laptop/1", "phone/1"]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("M7 H15 — a frame's session gone with its console's discard due: none is sent to it (its timer cleared); the page's own kept", async () => {
    vi.useFakeTimers();
    try {
      const r = await framed();
      // (its debugger on: a hand's first event attaches it)
      await r.native.dispatchMouse({ type: "mouseMoved", x: 1, y: 1, button: "none", buttons: 0 });
      const log = (session?: string): void =>
        r.emit("Runtime.consoleAPICalled", { type: "log", args: [] }, session);
      log("F");
      await vi.advanceTimersByTimeAsync(0);
      log("F");
      log();
      await vi.advanceTimersByTimeAsync(0);
      log();
      r.emit("Target.detachedFromTarget", { sessionId: "F", targetId: "t-F" });
      await vi.advanceTimersByTimeAsync(2_000);
      const discards = (session?: string): number =>
        r.sent.filter((c) => c.method === "Runtime.discardConsoleEntries" && c.session === session)
          .length;
      expect(discards("F")).toBe(1);
      expect(discards()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("M22 D — an input on a frame of another site's session at the page's scale s is its carried CSS point ÷ s (product run 3: F takes its input × s — at 0.41 a tap aimed at its button landed on its body; run 5: ÷ s, on its button)", () => {
    /** the page at `framed`, its own word of its scale said */
    const scaled = async (s: number) => {
      const r = await framed();
      r.emit("Runtime.bindingCalled", {
        name: PAGE_SCALE_BINDING,
        payload: String(s),
        executionContextId: 1,
      });
      return r;
    };
    /** each command of the hand: its type, its session, its point */
    const points = (r: Awaited<ReturnType<typeof framed>>) =>
      r.hand().map((h) => {
        const [what, at] = h.split(" ");
        const [x, y] = (at ?? "").split(",").map(Number);
        return { what, x, y };
      });

    it("a finger at s = 0.41: its start and its move on F's session at the carried point ÷ 0.41; its end as ever", async () => {
      const r = await scaled(0.41);
      await r.native.dispatchTouch({
        type: "touchStart",
        touchPoints: [{ x: 141, y: 100.5, id: 0 }],
      });
      await r.native.dispatchTouch({
        type: "touchMove",
        touchPoints: [{ x: 145.1, y: 104.6, id: 0 }],
      });
      await r.native.dispatchTouch({ type: "touchEnd", touchPoints: [] });
      const [start, move, end] = points(r);
      expect([start?.what, move?.what, end?.what]).toEqual([
        "touchStart@F",
        "touchMove@F",
        "touchEnd@F",
      ]);
      expect(start?.x).toBeCloseTo(100, 6);
      expect(start?.y).toBeCloseTo(50, 6);
      expect(move?.x).toBeCloseTo(110, 6);
      expect(move?.y).toBeCloseTo(60, 6);
    });

    it("a mouse at s = 2: its press and its release on F's session at the carried point ÷ 2; a move off F onto the page goes on the page's session as the producer sent it", async () => {
      const r = await scaled(2);
      await r.native.dispatchMouse({
        type: "mousePressed",
        x: 180,
        y: 120,
        button: "left",
        clickCount: 1,
      });
      await r.native.dispatchMouse({
        type: "mouseReleased",
        x: 180,
        y: 120,
        button: "left",
        clickCount: 1,
      });
      await r.native.dispatchMouse({
        type: "mouseMoved",
        x: 10,
        y: 10,
        button: "none",
        buttons: 0,
      });
      expect(r.hand()).toEqual([
        "mousePressed@F 40,20",
        "mouseReleased@F 40,20",
        "mouseMoved@F -45,-35",
        "mouseMoved@page 10,10",
      ]);
    });

    it("the wheel at s = 0.41 over F: its point ÷ 0.41, its travel as it came; at s = 1 every point as carried", async () => {
      const r = await scaled(0.41);
      await r.native.dispatchMouse({
        type: "mouseWheel",
        x: 141,
        y: 100.5,
        deltaX: 0,
        deltaY: 120,
      });
      const [wheel] = points(r);
      expect(wheel?.what).toBe("mouseWheel@F");
      expect(wheel?.x).toBeCloseTo(100, 6);
      expect(wheel?.y).toBeCloseTo(50, 6);
      expect(r.sent.find((c) => c.method === "Input.dispatchMouseEvent")?.params).toMatchObject({
        deltaX: 0,
        deltaY: 120,
      });
      const one = await scaled(1);
      await one.native.dispatchTouch({
        type: "touchStart",
        touchPoints: [{ x: 180, y: 120, id: 0 }],
      });
      expect(one.hand()).toEqual(["touchStart@F 80,40"]);
    });

    it("a scale said of the document BEFORE is not this one's: the page commits, a frame of the new document — its input as carried until the new document says its own", async () => {
      const r = await scaled(0.5);
      r.at("https://host.test/b");
      r.contents.emit("did-navigate", {}, "https://host.test/b");
      r.attach("F");
      await turns();
      await r.native.dispatchTouch({
        type: "touchStart",
        touchPoints: [{ x: 180, y: 120, id: 0 }],
      });
      await r.native.dispatchTouch({ type: "touchEnd", touchPoints: [] });
      r.emit("Runtime.bindingCalled", {
        name: PAGE_SCALE_BINDING,
        payload: "0.5",
        executionContextId: 1,
      });
      await r.native.dispatchTouch({
        type: "touchStart",
        touchPoints: [{ x: 180, y: 120, id: 0 }],
      });
      expect(r.hand()).toEqual(["touchStart@F 80,40", "touchEnd@F", "touchStart@F 160,80"]);
    });
  });

  describe("M7 H4, H9, H13 — a finger on the page and in a frame", () => {
    it("H13 — a finger down over F goes on F's session at the point carried into it; its moves and its end too", async () => {
      const r = await framed();
      await r.native.dispatchTouch({
        type: "touchStart",
        touchPoints: [{ x: 180, y: 120, id: 0 }],
      });
      await r.native.dispatchTouch({ type: "touchMove", touchPoints: [{ x: 190, y: 130, id: 0 }] });
      await r.native.dispatchTouch({ type: "touchEnd", touchPoints: [] });
      expect(r.hand()).toEqual(["touchStart@F 80,40", "touchMove@F 90,50", "touchEnd@F"]);
    });

    it("H13 — a frame's commit is counted by ITS OWN frame's word: a frame of its own site inside it committing (on its session, another frame's id) is no commit of its — its press's release still goes to it", async () => {
      const r = await framed();
      await r.native.dispatchMouse({
        type: "mousePressed",
        x: 180,
        y: 120,
        button: "left",
        clickCount: 1,
      });
      r.emit(
        "Page.frameNavigated",
        { frame: { id: "t-F-child", parentId: "t-F", url: "https://frame.test/inner" } },
        "F",
      );
      await r.native.dispatchMouse({
        type: "mouseReleased",
        x: 180,
        y: 120,
        button: "left",
        clickCount: 1,
      });
      expect(r.hand()).toEqual(["mousePressed@F 80,40", "mouseReleased@F 80,40"]);
    });

    it("H4 — PT-5c's finger held across the PAGE's commit: its cancel still reaches the page's session (the engine holds a touch open across a commit — `across.cjs`); a frame's finger across ITS commit: its end on its session", async () => {
      const r = recording();
      await r.native.loadURL("https://host.test/a");
      r.at("https://host.test/a");
      r.contents.emit("did-navigate", {}, "https://host.test/a");
      await r.native.dispatchTouch({ type: "touchStart", touchPoints: [{ x: 10, y: 10, id: 0 }] });
      r.at("https://host.test/b");
      r.contents.emit("did-navigate", {}, "https://host.test/b");
      await r.native.dispatchTouch({ type: "touchCancel", touchPoints: [] });
      expect(r.hand()).toEqual(["touchStart@page 10,10", "touchCancel@page"]);
      const f = await framed();
      await f.native.dispatchTouch({
        type: "touchStart",
        touchPoints: [{ x: 180, y: 120, id: 0 }],
      });
      f.emit("Page.frameNavigated", { frame: { id: "t-F", url: "https://frame.test/next" } }, "F");
      await f.native.dispatchTouch({ type: "touchEnd", touchPoints: [] });
      expect(f.hand()).toEqual(["touchStart@F 80,40", "touchEnd@F"]);
    });

    it("H9 — a touch waiting for its new document's FIRST PAINT (the engine answers a touch at a paint — F7) is not timed by the host's bound until that paint", async () => {
      vi.useFakeTimers();
      try {
        const r = recording(
          (method) => (method === "Input.dispatchTouchEvent" ? new Promise(() => {}) : {}),
          {
            hungInputMs: 20_000,
          },
        );
        const hung: (string | undefined)[] = [];
        r.native.onInputHung((frame) => hung.push(frame));
        await r.native.loadURL("https://host.test/a");
        r.at("https://host.test/a");
        r.contents.emit("did-navigate", {}, "https://host.test/a");
        void r.native.dispatchTouch({ type: "touchStart", touchPoints: [{ x: 10, y: 10, id: 0 }] });
        await vi.advanceTimersByTimeAsync(30_000);
        expect(hung).toEqual([]);
        // its first paint: from now the bound runs
        r.contents.emit(
          "paint",
          {},
          { x: 0, y: 0, width: 1, height: 1 },
          { getSize: () => ({ width: 1, height: 1 }) },
        );
        await vi.advanceTimersByTimeAsync(19_999);
        expect(hung).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(hung).toEqual([undefined]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("M12 J14 — H9's paint is the touch TARGET's own document's: a touch to a frame whose own document committed and has not painted since is not timed until the window's next paint (the page's own first paint long done); a frame not committed since is timed from its send", async () => {
      vi.useFakeTimers();
      try {
        const r = recording(
          (method, _params, session) => {
            if (method === "Input.dispatchTouchEvent" && session === "F")
              return new Promise(() => {});
            if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
            if (method === "DOM.getBoxModel")
              return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
            return {};
          },
          { hungInputMs: 20_000 },
        );
        const hung: (string | undefined)[] = [];
        r.native.onInputHung((frame) => hung.push(frame));
        const paint = (): void =>
          r.contents.emit(
            "paint",
            {},
            { x: 0, y: 0, width: 1, height: 1 },
            { getSize: () => ({ width: 1, height: 1 }) },
          );
        await r.native.loadURL("https://host.test/a");
        r.at("https://host.test/a");
        r.contents.emit("did-navigate", {}, "https://host.test/a");
        paint();
        r.attach("F");
        await vi.advanceTimersByTimeAsync(0);
        // F commits a document of its own (its own word): not painted yet
        r.emit("Page.frameNavigated", { frame: { id: "t-F", url: "https://frame.test/b" } }, "F");
        void r.native
          .dispatchTouch({ type: "touchStart", touchPoints: [{ x: 180, y: 120, id: 0 }] })
          .catch(() => undefined);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(hung).toEqual([]);
        // the window paints: from now its bound runs
        paint();
        await vi.advanceTimersByTimeAsync(19_999);
        expect(hung).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(hung).toEqual(["https://frame.test"]);
        // a frame NOT committed since the window last painted (its commit before that paint): its touch timed from its send
        const s = recording(
          (method, _params, session) => {
            if (method === "Input.dispatchTouchEvent" && session === "G")
              return new Promise(() => {});
            if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
            if (method === "DOM.getBoxModel")
              return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
            return {};
          },
          { hungInputMs: 20_000 },
        );
        const said: (string | undefined)[] = [];
        s.native.onInputHung((frame) => said.push(frame));
        await s.native.loadURL("https://host.test/a");
        s.at("https://host.test/a");
        s.contents.emit("did-navigate", {}, "https://host.test/a");
        s.contents.emit(
          "paint",
          {},
          { x: 0, y: 0, width: 1, height: 1 },
          { getSize: () => ({ width: 1, height: 1 }) },
        );
        s.attach("G");
        await vi.advanceTimersByTimeAsync(0);
        s.emit("Page.frameNavigated", { frame: { id: "t-G", url: "https://frame.test/c" } }, "G");
        s.contents.emit(
          "paint",
          {},
          { x: 0, y: 0, width: 1, height: 1 },
          { getSize: () => ({ width: 1, height: 1 }) },
        );
        void s.native
          .dispatchTouch({ type: "touchStart", touchPoints: [{ x: 180, y: 120, id: 0 }] })
          .catch(() => undefined);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(said).toEqual(["https://frame.test"]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("M6.4b — the host's bound on a page that hangs: a command of the hand timed from its SEND to its answer", () => {
    const BOUND = 20_000;
    it("200 moves queued at once, each answered 150 ms after it is sent (30 s for the last): never said hung — no command waited 20 s; every one sent", async () => {
      vi.useFakeTimers();
      try {
        const r = recording(
          (method) =>
            method === "Input.dispatchMouseEvent"
              ? new Promise((resolve) => setTimeout(() => resolve({}), 150))
              : {},
          { hungInputMs: BOUND },
        );
        const hung: (string | undefined)[] = [];
        r.native.onInputHung((frame) => hung.push(frame));
        const moves = Array.from({ length: 200 }, (_, i) =>
          r.native.dispatchMouse({ type: "mouseMoved", x: i, y: 1, button: "none", buttons: 0 }),
        );
        await vi.advanceTimersByTimeAsync(200 * 150 + 1_000);
        await Promise.all(moves);
        expect(r.hand()).toHaveLength(200);
        expect(hung).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("M7 H11 — a command the document before never answered is LET GO at the page's commit (an address typed while the chain stalled took it elsewhere): its turn refused at once, its bound never said; the next event goes to the new document", async () => {
      vi.useFakeTimers();
      try {
        const r = recording(
          (method) => (method === "Input.dispatchKeyEvent" ? new Promise(() => {}) : {}),
          { hungInputMs: BOUND },
        );
        const hung: (string | undefined)[] = [];
        r.native.onInputHung((frame) => hung.push(frame));
        await r.native.loadURL("https://host.test/a");
        r.at("https://host.test/a");
        r.contents.emit("did-navigate", {}, "https://host.test/a");
        const stalled = r.native
          .dispatchKey({ type: "keyDown", key: "q", code: "KeyQ", modifiers: 0 })
          .then(
            () => "sent",
            (error: unknown) =>
              `refused: ${error instanceof Error ? error.message : String(error)}`,
          );
        await vi.advanceTimersByTimeAsync(1_000);
        r.at("https://elsewhere.test/b");
        r.contents.emit("did-navigate", {}, "https://elsewhere.test/b");
        await vi.advanceTimersByTimeAsync(0);
        expect(await stalled).toBe("refused: Browser input's document is gone");
        await r.native.dispatchMouse({
          type: "mouseMoved",
          x: 5,
          y: 5,
          button: "none",
          buttons: 0,
        });
        expect(r.hand().at(-1)).toBe("mouseMoved@page 5,5");
        await vi.advanceTimersByTimeAsync(BOUND * 2);
        expect(hung).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("M12 J12 — a command in flight on a FRAME's session when that session DETACHES is let go, as at a commit: its turn refused, never said hung (the whole page stopped for a frame that merely went); the chain goes on; a press so refused holds no button — the next move is a hover, and reaches the page", async () => {
      vi.useFakeTimers();
      try {
        const r = recording(
          (method, _params, session) => {
            if (method === "Input.dispatchMouseEvent" && session === "F")
              return new Promise(() => {});
            if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
            if (method === "DOM.getBoxModel")
              return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
            return {};
          },
          { hungInputMs: BOUND },
        );
        const hung: (string | undefined)[] = [];
        r.native.onInputHung((frame) => hung.push(frame));
        await r.native.loadURL("https://host.test/a");
        r.at("https://host.test/a");
        r.contents.emit("did-navigate", {}, "https://host.test/a");
        r.attach("F");
        await vi.advanceTimersByTimeAsync(0);
        let press = "pending";
        void r.native
          .dispatchMouse({ type: "mousePressed", x: 180, y: 120, button: "left", clickCount: 1 })
          .then(
            () => {
              press = "sent";
            },
            (error: unknown) => {
              press = `refused: ${error instanceof Error ? error.message : String(error)}`;
            },
          );
        await vi.advanceTimersByTimeAsync(10);
        r.emit("Target.detachedFromTarget", { sessionId: "F", targetId: "t-F" });
        await vi.advanceTimersByTimeAsync(0);
        expect(press).toBe("refused: Browser input's frame is gone");
        void r.native.dispatchMouse({
          type: "mouseMoved",
          x: 20,
          y: 20,
          button: "none",
          buttons: 0,
        });
        await vi.advanceTimersByTimeAsync(BOUND * 2);
        expect(hung).toEqual([]);
        expect(r.hand()).toEqual(["mousePressed@F 80,40", "mouseMoved@page 20,20"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("M12 J12 — only what the detach took is let go: a command in flight on ANOTHER frame's session, or the page's own, is untouched by a frame's going — and still timed", async () => {
      vi.useFakeTimers();
      try {
        const r = recording(
          (method, params) => {
            if (method === "Input.dispatchMouseEvent") return new Promise(() => {});
            if (method === "DOM.getFrameOwner")
              return { backendNodeId: (params as { frameId: string }).frameId === "t-F" ? 7 : 8 };
            if (method === "DOM.getBoxModel")
              return (params as { backendNodeId: number }).backendNodeId === 7
                ? { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } }
                : { model: { content: [600, 80, 900, 80, 900, 380, 600, 380] } };
            return {};
          },
          { hungInputMs: BOUND },
        );
        const hung: (string | undefined)[] = [];
        r.native.onInputHung((frame) => hung.push(frame));
        await r.native.loadURL("https://host.test/a");
        r.at("https://host.test/a");
        r.contents.emit("did-navigate", {}, "https://host.test/a");
        r.attach("F");
        r.attach("G");
        await vi.advanceTimersByTimeAsync(0);
        const pressed = (x: number, y: number) => {
          const said = { now: "pending" };
          void r.native
            .dispatchMouse({ type: "mousePressed", x, y, button: "left", clickCount: 1 })
            .then(
              () => {
                said.now = "sent";
              },
              (error: unknown) => {
                said.now = `refused: ${error instanceof Error ? error.message : String(error)}`;
              },
            );
          return said;
        };
        // G's press in flight; F goes — G's is not F's
        const g = pressed(700, 120);
        await vi.advanceTimersByTimeAsync(10);
        r.emit("Target.detachedFromTarget", { sessionId: "F", targetId: "t-F" });
        await vi.advanceTimersByTimeAsync(0);
        expect(g.now).toBe("pending");
        r.emit("Target.detachedFromTarget", { sessionId: "G", targetId: "t-G" });
        await vi.advanceTimersByTimeAsync(0);
        expect(g.now).toBe("refused: Browser input's frame is gone");
        // the page's own press in flight; another frame goes — the page's is untouched, and its bound still says it
        const page = pressed(50, 50);
        await vi.advanceTimersByTimeAsync(10);
        r.attach("H");
        await vi.advanceTimersByTimeAsync(0);
        r.emit("Target.detachedFromTarget", { sessionId: "H", targetId: "t-H" });
        await vi.advanceTimersByTimeAsync(0);
        expect(page.now).toBe("pending");
        await vi.advanceTimersByTimeAsync(BOUND);
        expect(hung).toEqual([undefined]);
        expect(r.hand()).toEqual(["mousePressed@G 100,40", "mousePressed@page 50,50"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("M12 J2 — a page with NO frame of another site has no doubt: a press its renderer answers late (busy after the click), the keys behind it — every one sent, in order, on the page's session, none waiting, none refused (as at 8dd23597)", async () => {
      vi.useFakeTimers();
      try {
        const r = recording(
          (method) =>
            method === "Input.dispatchMouseEvent"
              ? new Promise((resolve) => setTimeout(() => resolve({}), 3_000))
              : {},
          { hungInputMs: BOUND },
        );
        await r.native.loadURL("https://host.test/a");
        r.at("https://host.test/a");
        r.contents.emit("did-navigate", {}, "https://host.test/a");
        void r.native.dispatchMouse({
          type: "mousePressed",
          x: 20,
          y: 20,
          button: "left",
          clickCount: 1,
        });
        const keys = ["a", "b", "c"].map((k) =>
          r.native
            .dispatchKey({ type: "keyDown", key: k, code: `Key${k.toUpperCase()}`, modifiers: 0 })
            .then(
              () => `${k} sent`,
              (error: unknown) =>
                `${k} refused: ${error instanceof Error ? error.message : String(error)}`,
            ),
        );
        // (past the press's answer and three of the doubt's waits: a refusal is said, never a hang)
        await vi.advanceTimersByTimeAsync(8_000);
        expect(await Promise.all(keys)).toEqual(["a sent", "b sent", "c sent"]);
        expect(r.hand().filter((h) => h.startsWith("keyDown"))).toHaveLength(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("M12 J1 (re-saying M9 × M6.4b) — the telling never holds the hand and is outside its bound: a page hung BY ITSELF, then taken — its telling unanswered on the DEVICE queue, its press sent at once and timed: said hung, the bound after the PRESS was sent; a page switched away from while its telling pends past the bound is NOT said stopped by it", async () => {
      vi.useFakeTimers();
      try {
        const r = recording(
          (method) =>
            method === "Emulation.setFocusEmulationEnabled" || method === "Input.dispatchMouseEvent"
              ? new Promise(() => {})
              : {},
          { hungInputMs: BOUND },
        );
        const hung: (string | undefined)[] = [];
        r.native.onInputHung((frame) => hung.push(frame));
        await r.native.loadURL("https://host.test/a");
        r.at("https://host.test/a");
        r.contents.emit("did-navigate", {}, "https://host.test/a");
        // told, and switched away from (untold) at once: neither answered — past the bound, nothing said
        void r.native.setFocused(true).catch(() => undefined);
        void r.native.setFocused(false).catch(() => undefined);
        await vi.advanceTimersByTimeAsync(BOUND * 2);
        expect(hung).toEqual([]);
        // taken again: the press behind the telling is sent at once — and it is the press's bound that says the page hung
        void r.native.setFocused(true).catch(() => undefined);
        void r.native
          .dispatchMouse({ type: "mousePressed", x: 5, y: 5, button: "left", clickCount: 1 })
          .catch(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(r.hand().some((h) => h.startsWith("mousePressed"))).toBe(true);
        await vi.advanceTimersByTimeAsync(BOUND + 1);
        expect(hung).toEqual([undefined]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("a command never answered is said hung ONCE, the bound after it was SENT — not after its wait in the queue; a frame's with its origin; a window born without the bound says nothing", async () => {
      vi.useFakeTimers();
      try {
        let answerKey = true;
        const r = recording(
          (method, params, session) => {
            if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
            if (method === "DOM.getBoxModel")
              return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
            if (method === "Input.dispatchMouseEvent")
              return new Promise((resolve) => setTimeout(() => resolve({}), 15_000));
            if (method === "Input.dispatchKeyEvent" && !answerKey) return new Promise(() => {});
            if (method === "Input.dispatchKeyEvent" && session === "F")
              return new Promise(() => {});
            void params;
            return {};
          },
          { hungInputMs: BOUND },
        );
        const hung: (string | undefined)[] = [];
        r.native.onInputHung((frame) => hung.push(frame));
        await r.native.loadURL("https://host.test/a");
        r.at("https://host.test/a");
        r.contents.emit("did-navigate", {}, "https://host.test/a");
        r.emit("Page.frameAttached", { frameId: "t-F", parentFrameId: "main" });
        r.emit(
          "Target.attachedToTarget",
          {
            sessionId: "F",
            targetInfo: { type: "iframe", targetId: "t-F", url: "https://ads.example.test/x?y=1" },
          },
          undefined,
        );
        await vi.advanceTimersByTimeAsync(0);
        // a move answered in 15 s, then a key on the page never answered: the key's 20 s run from ITS send (15 s in)
        void r.native.dispatchMouse({
          type: "mouseMoved",
          x: 20,
          y: 20,
          button: "none",
          buttons: 0,
        });
        answerKey = false;
        void r.native.dispatchKey({ type: "keyDown", key: "q", code: "KeyQ", modifiers: 0 });
        await vi.advanceTimersByTimeAsync(15_000 + BOUND - 1);
        expect(hung).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(hung).toEqual([undefined]);
        await vi.advanceTimersByTimeAsync(BOUND * 3);
        expect(hung).toEqual([undefined]);
        // a frame's command never answered: its origin
        const f = recording(
          (method, _params, session) => {
            if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
            if (method === "DOM.getBoxModel")
              return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
            if (method.startsWith("Input.") && session === "F") return new Promise(() => {});
            return {};
          },
          { hungInputMs: BOUND },
        );
        const frameHung: (string | undefined)[] = [];
        f.native.onInputHung((frame) => frameHung.push(frame));
        await f.native.loadURL("https://host.test/a");
        f.at("https://host.test/a");
        f.contents.emit("did-navigate", {}, "https://host.test/a");
        f.emit("Page.frameAttached", { frameId: "t-F", parentFrameId: "main" });
        f.emit(
          "Target.attachedToTarget",
          {
            sessionId: "F",
            targetInfo: { type: "iframe", targetId: "t-F", url: "https://ads.example.test/x?y=1" },
          },
          undefined,
        );
        await vi.advanceTimersByTimeAsync(0);
        void f.native.dispatchMouse({
          type: "mousePressed",
          x: 180,
          y: 120,
          button: "left",
          clickCount: 1,
        });
        await vi.advanceTimersByTimeAsync(BOUND);
        expect(frameHung).toEqual(["https://ads.example.test"]);
        // born without the bound: nothing is timed
        const plain = recording((method) =>
          method.startsWith("Input.") ? new Promise(() => {}) : {},
        );
        const plainHung: (string | undefined)[] = [];
        plain.native.onInputHung((frame) => plainHung.push(frame));
        void plain.native.dispatchKey({ type: "keyDown", key: "q", code: "KeyQ", modifiers: 0 });
        await vi.advanceTimersByTimeAsync(BOUND * 3);
        expect(plainHung).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("PT-6a (M8 — C5) — the sessions of the page's frames of other sites, counted (`childSessions` — main's census reads it): each attach one more, each detach one less", async () => {
      const r = recording();
      expect(r.native.childSessions?.()).toBe(0);
      r.attach("F");
      r.attach("E");
      r.attach("N", "F");
      await turns();
      expect(r.native.childSessions?.()).toBe(3);
      r.emit("Target.detachedFromTarget", { sessionId: "E", targetId: "t-E" });
      expect(r.native.childSessions?.()).toBe(2);
      // a nested frame's own detach before its parent's (as the engine says it when it does)
      r.emit("Target.detachedFromTarget", { sessionId: "N", targetId: "t-N" }, "F");
      r.emit("Target.detachedFromTarget", { sessionId: "F", targetId: "t-F" });
      expect(r.native.childSessions?.()).toBe(0);
    });

    it("PT-6a (M8 — C5) — a NESTED frame's session goes with its PARENT's: the engine says the parent's detach, never the nested one's (CNN's frame in a frame, r2kids) — every descendant is forgotten at its ancestor's detach, its words' world and its owner with it; a late detach of its own is nothing", async () => {
      const r = recording();
      r.attach("F");
      r.attach("N", "F");
      r.attach("M", "N");
      r.attach("E");
      await turns();
      expect(r.native.childSessions?.()).toBe(4);
      r.emit("Target.detachedFromTarget", { sessionId: "F", targetId: "t-F" });
      expect(r.native.childSessions?.()).toBe(1);
      // the nested one's own word, late: nothing more to forget
      r.emit("Target.detachedFromTarget", { sessionId: "N", targetId: "t-N" }, "F");
      expect(r.native.childSessions?.()).toBe(1);
      r.emit("Target.detachedFromTarget", { sessionId: "E", targetId: "t-E" });
      expect(r.native.childSessions?.()).toBe(0);
    });

    it("PT-6a (K5) — the hand's commands SENT and not yet answered, counted (`handInFlight` — main's census reads it): one while unanswered; none once answered, let go at its frame's detach, or let go at the page's commit", async () => {
      vi.useFakeTimers();
      try {
        let answer: () => void = () => undefined;
        const r = recording(
          (method, params, session) => {
            if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
            if (method === "DOM.getBoxModel")
              return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
            if (method !== "Input.dispatchMouseEvent") return {};
            const x = (params as { x: number }).x;
            if (session === "F" || x === 30) return new Promise(() => {});
            if (x === 20)
              return new Promise((resolve) => {
                answer = () => resolve({});
              });
            return {};
          },
          { hungInputMs: BOUND },
        );
        await r.native.loadURL("https://host.test/a");
        r.at("https://host.test/a");
        r.contents.emit("did-navigate", {}, "https://host.test/a");
        r.attach("F");
        await vi.advanceTimersByTimeAsync(0);
        const move = (x: number, y: number): void => {
          void r.native
            .dispatchMouse({ type: "mouseMoved", x, y, button: "none", buttons: 0 })
            .catch(() => undefined);
        };
        expect(r.native.handInFlight?.()).toBe(0);
        // the page's, unanswered — then answered
        move(20, 20);
        await vi.advanceTimersByTimeAsync(0);
        expect(r.native.handInFlight?.()).toBe(1);
        answer();
        await vi.advanceTimersByTimeAsync(0);
        expect(r.native.handInFlight?.()).toBe(0);
        // F's, never answered — let go at F's detach
        move(180, 120);
        await vi.advanceTimersByTimeAsync(0);
        expect(r.native.handInFlight?.()).toBe(1);
        r.emit("Target.detachedFromTarget", { sessionId: "F", targetId: "t-F" });
        await vi.advanceTimersByTimeAsync(0);
        expect(r.native.handInFlight?.()).toBe(0);
        // the page's, never answered — let go at the page's commit
        move(30, 30);
        await vi.advanceTimersByTimeAsync(0);
        expect(r.native.handInFlight?.()).toBe(1);
        r.at("https://host.test/b");
        r.contents.emit("did-navigate", {}, "https://host.test/b");
        await vi.advanceTimersByTimeAsync(0);
        expect(r.native.handInFlight?.()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("PT-5d (M9) — a page TOLD it is focused while its pane takes the hand: the native keeps ONE focused window, as a browser does", () => {
  /** Two windows of one native; what each is told of its focus, its keys and its presses, in order. */
  const two = () => {
    const adapter = new ElectronBrowserSurfaceNative();
    const sent: string[] = [];
    const pages: (typeof electron.made)[number]["webContents"][] = [];
    const make = (name: string) => {
      const native = adapter.createWindow({
        partition: "memory:test",
        persistent: false,
        logicalViewport: { width: 320, height: 180 },
        initialBackingRaster: { width: 640, height: 360 },
        deviceScaleFactor: 2,
        requestSharedTexture: true,
      });
      const made = electron.made.at(-1) as
        | ((typeof electron.made)[number] & { isDestroyed: () => boolean; destroy?: () => void })
        | undefined;
      const contents = made?.webContents;
      if (made === undefined || contents === undefined) throw new Error("no window was made");
      made.destroy = () => {
        made.isDestroyed = () => true;
      };
      pages.push(made.webContents);
      let attached = false;
      contents.debugger.isAttached = () => attached;
      contents.debugger.attach = () => {
        attached = true;
      };
      contents.debugger.sendCommand = async (
        method?: string,
        params?: unknown,
        session?: string,
      ) => {
        const at = session === undefined ? "" : `@${session}`;
        const p = params as { enabled?: boolean; type?: string };
        if (method === "Emulation.setFocusEmulationEnabled") sent.push(`${name} ${p.enabled}${at}`);
        if (method === "Input.dispatchMouseEvent" || method === "Input.dispatchKeyEvent")
          sent.push(`${name} ${p.type}${at}`);
        return {};
      };
      return native;
    };
    return { a: make("A"), b: make("B"), sent, pages };
  };

  it("told: `Emulation.setFocusEmulationEnabled` on the PAGE's session, in the hand's queue — the key queued after it sent at once, never waiting on a word; told again: nothing; ANOTHER window told: this one untold first; untold: `enabled: false`, once; a window destroyed is told nothing", async () => {
    const w = two();
    // (M12 J1: the telling on the device queue, the key on the hand's — neither waits on the other)
    void w.a.setFocused(true);
    await w.a.dispatchKey({ type: "keyDown", key: "a", code: "KeyA", modifiers: 0 });
    await w.a.setFocused(true);
    expect([...w.sent].sort()).toEqual(["A keyDown", "A true"]);
    await w.b.setFocused(true);
    expect(w.sent.slice(2)).toEqual(["A false", "B true"]);
    await w.b.setFocused(false);
    await w.b.setFocused(false);
    expect(w.sent.slice(4)).toEqual(["B false"]);
    await w.a.setFocused(true);
    w.a.destroy();
    await w.b.setFocused(true);
    expect(w.sent.slice(5)).toEqual(["A true", "B true"]);
  });

  // PT-5d (M11.2): for RUN 4's F-h2 — the page's focus emulation across its commits. If a commit drops it, `focusFor`
  // becomes the window's document (one line) and this row is unskipped.
  describe.skip("PT-5d (M11.2) — run 4's F-h2: a commit DROPS the page's focus emulation", () => {
    it("told, the page commits another document, the hand takes it again: told again — one telling a document; taken twice within one, nothing; its own retelling never untells it first", async () => {
      const w = two();
      const page = w.pages[0];
      if (page === undefined) throw new Error("no window");
      await w.a.loadURL("https://host.test/a");
      page.url = "https://host.test/a";
      page.emit("did-navigate", {}, "https://host.test/a");
      await w.a.setFocused(true);
      await w.a.setFocused(true);
      page.url = "https://elsewhere.test/b";
      page.emit("did-navigate", {}, "https://elsewhere.test/b");
      await w.a.setFocused(true);
      expect(w.sent).toEqual(["A true", "A true"]);
    });
  });
});
