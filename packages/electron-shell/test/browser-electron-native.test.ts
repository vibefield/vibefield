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
  FRAME_VISIBLE_PART,
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

describe("PT-5d — the frames of other sites: each guarded (M2), and the hand's events routed to the target that takes them (rulings 1, 3, 4)", () => {
  /** A window whose debugger records what it is sent, by session, and answers what the row says (else `{}`). */
  const recording = (
    answer: (method: string, params: unknown, session?: string) => object = () => ({}),
    options: { readonly hungInputMs?: number } = {},
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
      return answer(method ?? "", params, session);
    };
    const emit = (method: string, params: unknown, session?: string): void =>
      w.contents.debugger.emit("message", {}, method, params, session);
    const attach = (session: string, parent?: string, type = "iframe"): void =>
      emit(
        "Target.attachedToTarget",
        { sessionId: session, targetInfo: { type, targetId: `t-${session}`, url: "" } },
        parent,
      );
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
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  };
  /** A page at its first document, frame F (its owner element 7 of the page, drawn 400 × 300 at 100, 80) placed. */
  const framed = async () => {
    const r = recording((method, params) => {
      if (method === "DOM.getFrameOwner")
        return { backendNodeId: (params as { frameId: string }).frameId === "t-F" ? 7 : 8 };
      if (method === "DOM.getBoxModel")
        return (params as { backendNodeId: number }).backendNodeId === 7
          ? { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } }
          : { model: { content: [250, 190, 370, 190, 370, 280, 250, 280] } };
      return {};
    });
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
      waitForDebuggerOnStart: false,
      flatten: true,
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

  it("M3 — keys, text, a composition and a command go to the FOCUSED frame's session — nothing key-like on the page's while a frame of another site is focused: the focus follows the hand's press, and what each document says of its window (`focus`)", async () => {
    const r = await framed();
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
    await r.native.dispatchKey({ type: "keyDown", key: "h", code: "KeyH", modifiers: NONE });
    await r.native.dispatchKey({ type: "keyUp", key: "h", code: "KeyH", modifiers: NONE });
    await r.native.dispatchText("é");
    await r.native.dispatchCompose("か", 1);
    await r.native.dispatchKey({
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 4,
      commands: ["selectAll"],
    });
    await r.native.dispatchKey({ type: "keyUp", key: "a", code: "KeyA", modifiers: 4 });
    // a press on the page: the keys are the page's again
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 20,
      y: 20,
      button: "left",
      clickCount: 1,
    });
    await r.native.dispatchMouse({
      type: "mouseReleased",
      x: 20,
      y: 20,
      button: "left",
      clickCount: 1,
    });
    await r.native.dispatchText("x");
    // F's document says its window took the focus (its script focused a field): F's
    r.emit(
      "Runtime.bindingCalled",
      { name: FRAME_WORDS_BINDING, payload: "focus", executionContextId: 1 },
      "F",
    );
    await r.native.dispatchText("y");
    expect(r.hand()).toEqual([
      "mousePressed@F 80,40",
      "mouseReleased@F 80,40",
      "keyDown@F",
      "keyUp@F",
      "insertText@F é",
      "imeSetComposition@F か",
      "keyDown@F",
      "keyUp@F",
      "mousePressed@page 20,20",
      "mouseReleased@page 20,20",
      "insertText@page x",
      "insertText@F y",
    ]);
  });

  it("M6.2 — a `blur` moves nothing: F's own window's blur and its own child's `focus` come on F's session — a key between the two words goes on F's, never the page's (M3); the page's own `focus` takes the keys back", async () => {
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
    await r.native.dispatchMouse({
      type: "mouseReleased",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    word("blur", "F");
    await r.native.dispatchKey({ type: "keyDown", key: "h", code: "KeyH", modifiers: NONE });
    await r.native.dispatchKey({ type: "keyUp", key: "h", code: "KeyH", modifiers: NONE });
    word("focus", "F");
    await r.native.dispatchText("é");
    word("focus");
    await r.native.dispatchText("x");
    expect(r.hand()).toEqual([
      "mousePressed@F 80,40",
      "mouseReleased@F 80,40",
      "keyDown@F",
      "keyUp@F",
      "insertText@F é",
      "insertText@page x",
    ]);
  });

  it("ruling 3 — what a frame took ends where it began: its press released once its session has GONE is sent nowhere (never a command to a gone session); once it committed ANOTHER document (its own word, `Page.frameNavigated` of its frame), nowhere; a key held in it the same", async () => {
    const r = await framed();
    await r.native.dispatchMouse({
      type: "mousePressed",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    await r.native.dispatchKey({ type: "keyDown", key: "q", code: "KeyQ", modifiers: NONE });
    r.emit("Page.frameNavigated", { frame: { id: "t-F", url: "https://frame.test/next" } }, "F");
    await r.native.dispatchMouse({
      type: "mouseReleased",
      x: 180,
      y: 120,
      button: "left",
      clickCount: 1,
    });
    await r.native.dispatchKey({ type: "keyUp", key: "q", code: "KeyQ", modifiers: NONE });
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
    // a frame's frame of its own committing is no commit of F's
    expect(r.hand()).toEqual(["mousePressed@F 80,40", "keyDown@F", "mousePressed@F 80,40"]);
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

  it("rulings 1, M3 — a document's WORDS, run: it takes the binding out of the page's reach; says `focus` and `blur` of its OWN window (never an element's), and `moved` — only when its frames' boxes or their VISIBLE parts changed (M6.3a: a clip that changes with the frame not moving), once an animation frame; never its size (M6.1: a frame's own viewport is READ with its quad); a document holding no frame never says moved; the blank and a document with no binding say nothing", () => {
    const run = (options: { href?: string; binding?: boolean } = {}) => {
      const said: string[] = [];
      const on = new Map<string, ((event?: { target?: unknown; isTrusted?: boolean }) => void)[]>();
      let frame: (() => void) | undefined;
      let every: (() => void) | undefined;
      const rects: { left: number; top: number; width: number; height: number }[] = [];
      const self = { innerWidth: 400, innerHeight: 300 };
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
      const laidOut = (r: { left: number; top: number; width: number; height: number }) => ({
        parentElement: holder,
        style: {},
        getBoundingClientRect: () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height }),
        offsetWidth: r.width,
        offsetHeight: r.height,
        clientLeft: 0,
        clientTop: 0,
        clientWidth: r.width,
        clientHeight: r.height,
      });
      const computed = (e: { style?: Record<string, string> }) => ({
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
        FRAME_WORDS_SCRIPT,
      )(
        g,
        self,
        { href: options.href ?? "https://example.test/a" },
        (type: string, listener: (event?: { target?: unknown; isTrusted?: boolean }) => void) =>
          on.set(type, [...(on.get(type) ?? []), listener]),
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
        },
        self.innerWidth,
        self.innerHeight,
        computed,
      );
      const fire = (type: string, event?: { target?: unknown; isTrusted?: boolean }): void => {
        for (const listener of on.get(type) ?? []) listener(event);
      };
      const tick = (): void => {
        const f = frame;
        frame = undefined;
        f?.();
      };
      return { said, g, self, rects, holder, fire, tick, every: () => every?.() };
    };
    const d = run();
    expect(FRAME_WORDS_BINDING in d.g).toBe(false);
    d.tick();
    // nothing at once, nor at a resize or its load — no size (M6.1); no frame in it: no `moved`
    d.fire("resize");
    d.fire("load");
    d.tick();
    expect(d.said).toEqual([]);
    // its window's focus and blur — an element's focus (its target not the window) is not the window's
    d.fire("focus", { target: d.self, isTrusted: true });
    d.fire("focus", { target: {}, isTrusted: true });
    d.fire("blur", { target: d.self, isTrusted: true });
    expect(d.said).toEqual(["focus", "blur"]);
    // M7 H1: a SYNTHETIC focus or blur — `window.dispatchEvent(new Event("focus"))`, the page's own script — says nothing
    d.fire("focus", { target: d.self, isTrusted: false });
    d.fire("blur", { target: d.self, isTrusted: false });
    expect(d.said).toEqual(["focus", "blur"]);
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
    // the blank, a document with no binding: nothing
    const blank = run({ href: "about:blank" });
    blank.tick();
    expect(blank.said).toEqual([]);
    const bare = run({ binding: false });
    bare.tick();
    expect(bare.said).toEqual([]);
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
    // the page scrolled by 50: its words say so — F is read again, once however many words come
    at = [100, 30, 500, 30, 500, 330, 100, 330];
    for (let i = 0; i < 3; i += 1)
      r.emit("Runtime.bindingCalled", {
        name: FRAME_WORDS_BINDING,
        payload: "moved",
        executionContextId: 1,
      });
    await turns();
    expect(r.sent.filter((c) => c.method === "DOM.getBoxModel").length).toBeLessThanOrEqual(3);
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
          `return (${FRAME_VISIBLE_PART});`,
        )(
          computed,
          { documentElement: root, body },
          { visualViewport: view.vv },
          view.w,
          view.h,
        ) as (this: Fake) => unknown
      ).call(frame);
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

  it("M6.3a — a frame's VISIBLE part is READ beside its quad, of its owner in its parent's document (`Runtime.callFunctionOn` on the parent's session, its object released): a press on the part its scroller clips is the page's, on the part in view the frame's", async () => {
    const r = recording((method) => {
      if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
      if (method === "DOM.getBoxModel")
        return { model: { content: [100, 80, 500, 80, 500, 380, 100, 380] } };
      if (method === "DOM.resolveNode") return { object: { objectId: "owner-7" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: [0, 0.5, 1, 1] } };
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
      params: { objectId: "owner-7", functionDeclaration: FRAME_VISIBLE_PART, returnByValue: true },
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
  });
});
