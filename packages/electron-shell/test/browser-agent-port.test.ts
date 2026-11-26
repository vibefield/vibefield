/**
 * EY-1 (1d, 2026-11-19) — THE PORT OF A DESK PAGE (main/live-surfaces/browser-electron-native.ts): what the agent's
 * endpoint is given of a page. A client's own session is the page attached to itself on the owner's session (flat), so its
 * enables, disables and auto-attach act on its own session, never the owner's. Its events reach it alone, in order; it
 * ends once, with its reason; it never sends on the page's own session nor on a session that is not under it. Electron is a
 * fake here, as in browser-electron-native.test.ts: a window whose debugger records what it is sent and says what the row
 * emits — and, for the self-attach, says it as the engine does: a page announced on the root, before the answer.
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
    readonly debugger = Object.assign(new Emitter(), {
      isAttached: (): boolean => false,
      attach: () => undefined,
      detach: () => undefined,
      sendCommand: async (..._args: unknown[]): Promise<unknown> => ({}),
    });
    readonly navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      clear: () => undefined,
    };
    isDestroyed = (): boolean => false;
    getURL = (): string => "https://host.test/a";
    getTitle = (): string => "a title";
    getOrCreateDevToolsTargetId = (): string => "page-target";
    setFrameRate = (): void => undefined;
    isLoading = (): boolean => false;
  }
  const made: { webContents: Contents }[] = [];
  class BrowserWindow {
    readonly webContents = new Contents();
    constructor(readonly options: Record<string, unknown>) {
      made.push(this);
    }
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
    isDestroyed = (): boolean => false;
    destroy = (): void => undefined;
    setContentSize = (): void => undefined;
  }
  return { BrowserWindow, made, session: { fromPartition: () => ({}), fromPath: () => ({}) } };
});

vi.mock("electron", () => ({ BrowserWindow: electron.BrowserWindow, session: electron.session }));
// (the guards are the session's and the contents' — not this suite's)
vi.mock("../src/main/live-surfaces/browser-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/live-surfaces/browser-security")>()),
  installGuardedBrowserSurfaceContents: () => undefined,
  installGuardedBrowserSurfaceSession: () => undefined,
}));

import {
  AGENT_SESSION_GONE,
  AGENT_SESSION_REFUSED,
  type BrowserAgentEvent,
  browserAgentPortOf,
  ElectronBrowserSurfaceNative,
} from "../src/main/live-surfaces/browser-electron-native";

/** A desk page whose debugger records what it is sent; `answer` answers first, for the row's own methods. */
const page = (
  answer: (method: string, session?: string) => Promise<unknown> | undefined = () => undefined,
) => {
  const native = new ElectronBrowserSurfaceNative().createWindow({
    partition: "memory:test",
    persistent: false,
    logicalViewport: { width: 320, height: 180 },
    initialBackingRaster: { width: 640, height: 360 },
    deviceScaleFactor: 2,
    requestSharedTexture: true,
  });
  const contents = electron.made.at(-1)?.webContents;
  if (contents === undefined) throw new Error("no window was made");
  const sent: { method: string; params: unknown; session?: string }[] = [];
  let attached = false;
  contents.debugger.isAttached = () => attached;
  contents.debugger.attach = () => {
    attached = true;
  };
  const emit = (method: string, params: unknown, session?: string): void =>
    contents.debugger.emit("message", {}, method, params, session);
  contents.debugger.sendCommand = async (...args: unknown[]) => {
    const [method, params, session] = args as [string, unknown, string | undefined];
    sent.push({ method, params, ...(session === undefined ? {} : { session }) });
    const answered = answer(method, session);
    if (answered !== undefined) return answered;
    if (method === "Target.attachToTarget") {
      // as the engine says it: the page's new session announced first — a page, on the root — then the answer
      emit("Target.attachedToTarget", {
        sessionId: "C",
        targetInfo: { type: "page", targetId: "page-target", url: "https://host.test/a" },
        waitingForDebugger: false,
      });
      return { sessionId: "C" };
    }
    return {};
  };
  const port = browserAgentPortOf(contents);
  if (port === null) throw new Error("the page has no port");
  return { native, contents, sent, emit, port };
};

const turns = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};
/** what a send came to: "sent", or the code it was refused with */
const outcome = (sent: Promise<unknown>): Promise<unknown> =>
  sent.then(
    () => "sent",
    (error: { readonly code?: unknown }) => error.code,
  );
/** what a promise has come to within `ms`: its value, or "open" */
const within = <T>(promise: Promise<T>, ms = 50): Promise<T | "open"> =>
  Promise.race([promise, new Promise<"open">((resolve) => setTimeout(() => resolve("open"), ms))]);

describe("EY-1 (1d) — the port of a desk page: a client's own session", () => {
  it("1d PIN — a client's session is the page attached to itself on the owner's session, flat, after the owner's guards; the owner neither resumes nor detaches it", async () => {
    const r = page();
    const client = await r.port.openClientSession();
    expect(client.id).toBe("C");
    const methods = r.sent.map((c) => c.method);
    expect(methods.indexOf("Target.attachToTarget")).toBeGreaterThan(
      methods.lastIndexOf("Target.setAutoAttach"),
    );
    expect(r.sent.find((c) => c.method === "Target.attachToTarget")).toEqual({
      method: "Target.attachToTarget",
      params: { targetId: "page-target", flatten: true },
    });
    await turns();
    expect(
      r.sent.filter(
        (c) =>
          c.method === "Target.detachFromTarget" || c.method === "Runtime.runIfWaitingForDebugger",
      ),
    ).toEqual([]);
  });

  it("1d PIN — a client's file picker and dialog are not the page's: the owner says no refusal for them, and still says its own", async () => {
    const r = page();
    await r.port.openClientSession();
    const refused: string[] = [];
    r.native.onRefused((what) => refused.push(what));
    r.emit("Page.fileChooserOpened", { mode: "selectSingle" }, "C");
    r.emit("Page.javascriptDialogOpening", { type: "alert" }, "C");
    expect(refused).toEqual([]);
    r.emit("Page.fileChooserOpened", { mode: "selectSingle" });
    expect(refused).toEqual(["file-picker"]);
  });

  it("1d — what is said on a client's session reaches it in order, each event from a session under it with that session; the owner's own events never reach it", async () => {
    const r = page();
    const client = await r.port.openClientSession();
    const heard: BrowserAgentEvent[] = [];
    client.onEvent((event) => heard.push(event));
    const frame = { sessionId: "K", targetInfo: { type: "iframe", targetId: "t-K", url: "" } };
    r.emit("Runtime.consoleAPICalled", { type: "log", args: [] }, "C");
    r.emit("Target.attachedToTarget", frame, "C");
    r.emit("Page.frameNavigated", { frame: { id: "t-K", url: "" } }, "K");
    r.emit("Runtime.consoleAPICalled", { type: "log", args: [] });
    await turns();
    expect(heard).toEqual([
      { method: "Runtime.consoleAPICalled", params: { type: "log", args: [] } },
      { method: "Target.attachedToTarget", params: frame },
      { method: "Page.frameNavigated", params: { frame: { id: "t-K", url: "" } }, child: "K" },
    ]);
  });

  it("1d — a client ends once, with its reason, when its session is detached: what it had in flight, and what it sends after, are refused as gone", async () => {
    const r = page((method) =>
      method === "Runtime.evaluate" ? new Promise(() => undefined) : undefined,
    );
    const client = await r.port.openClientSession();
    const flight = client.send("Runtime.evaluate", { expression: "1" });
    r.emit("Target.detachedFromTarget", { sessionId: "C" });
    expect(await within(client.closed)).toEqual({ reason: "detached" });
    expect(await within(outcome(flight))).toBe(AGENT_SESSION_GONE);
    expect(await outcome(client.send("Runtime.evaluate", { expression: "2" }))).toBe(
      AGENT_SESSION_GONE,
    );
  });

  it("1d — the page's debugger going, or its window destroyed, ends every client and the port, once: the page then has no port", async () => {
    const r = page();
    const client = await r.port.openClientSession();
    const said: string[] = [];
    r.port.onDetach((reason) => said.push(reason));
    r.contents.debugger.emit("detach", {}, "target closed");
    expect(await within(client.closed)).toEqual({ reason: "target closed" });
    expect(said).toEqual(["target closed"]);
    expect(browserAgentPortOf(r.contents)).toBeNull();

    const q = page();
    const other = await q.port.openClientSession();
    const told: string[] = [];
    q.port.onDetach((reason) => told.push(reason));
    q.native.destroy();
    q.contents.debugger.emit("detach", {}, "again");
    expect(await within(other.closed)).toEqual({ reason: "destroyed" });
    expect(told).toEqual(["destroyed"]);
    expect(browserAgentPortOf(q.contents)).toBeNull();
  });

  it("1d — a client never sends on the page's own session, nor on a session that is not under its own: refused (-32000), nothing sent", async () => {
    const r = page();
    const client = await r.port.openClientSession();
    r.emit("Target.attachedToTarget", { sessionId: "K", targetInfo: { type: "iframe" } }, "C");
    r.sent.length = 0;
    await client.send("Runtime.evaluate", { expression: "1" });
    await client.send("Runtime.evaluate", { expression: "2" }, "K");
    expect(await outcome(client.send("Runtime.evaluate", { expression: "3" }, ""))).toBe(
      AGENT_SESSION_REFUSED,
    );
    expect(await outcome(client.send("Runtime.evaluate", { expression: "4" }, "F"))).toBe(
      AGENT_SESSION_REFUSED,
    );
    expect(r.sent.map((c) => c.session)).toEqual(["C", "K"]);
  });

  it("1d — a client's close detaches its session on the owner's, and ends it (closed)", async () => {
    const r = page();
    const client = await r.port.openClientSession();
    r.sent.length = 0;
    await client.close();
    expect(r.sent).toEqual([{ method: "Target.detachFromTarget", params: { sessionId: "C" } }]);
    expect(await within(client.closed)).toEqual({ reason: "closed" });
  });
});

/** A desk page as the producer drives it: at half its raster, live at 15 fps, its own document committed. The window's
 * frame rates, paintings and metrics overrides are logged in the order they reach it. */
const paced = async (o: { readonly mobile?: boolean; readonly committed?: boolean } = {}) => {
  const p = page();
  const log: string[] = [];
  Object.assign(p.contents, {
    setFrameRate: (fps: number) => log.push(`fps ${fps}`),
    startPainting: () => log.push("paint on"),
    stopPainting: () => log.push("paint off"),
  });
  const send = p.contents.debugger.sendCommand;
  p.contents.debugger.sendCommand = async (...args: unknown[]) => {
    if (args[0] === "Emulation.setDeviceMetricsOverride")
      log.push(`scale ${String((args[1] as { readonly scale?: unknown }).scale)}`);
    return send(...args);
  };
  await p.native.loadURL("https://host.test/a");
  if (o.committed !== false) p.contents.emit("did-navigate", {}, "https://host.test/a");
  p.native.setFrameRate(15);
  await p.native.setBackingRaster(
    { width: 320, height: 180 },
    { width: 320, height: 180 },
    2,
    o.mobile === true,
  );
  log.length = 0;
  const paint = (width: number, height: number): void =>
    p.contents.emit("paint", {}, {}, { getSize: () => ({ width, height }) });
  const ceiling = (maxFps: number): void =>
    (p.native as unknown as { setFrameRateCeiling(n: number): void }).setFrameRateCeiling(maxFps);
  return { ...p, log, paint, ceiling };
};

describe("1d — a call window's pins, applied by the page's owner (pages/core/pins.ts)", () => {
  it("a pin lifts the frame rate to its floor and lays scale 1; applied at the first paint of the pinned size", async () => {
    const p = await paced();
    const pin = p.port.pin();
    await turns();
    expect(p.log).toEqual(["fps 30", "scale 1", "fps 30"]);
    expect(p.port.captureScale()).toBe(1);
    p.paint(320, 180);
    expect(await within(pin.applied)).toBe("open");
    p.paint(640, 360);
    expect(await within(pin.applied)).toBe("applied");
    pin.release();
  });

  it("a raster asked under a pin is kept, never laid; the release lays the latest and rests the frame rate", async () => {
    const p = await paced();
    const pin = p.port.pin();
    await turns();
    expect(
      await p.native.setBackingRaster(
        { width: 160, height: 90 },
        { width: 320, height: 180 },
        2,
        false,
      ),
    ).toEqual({ width: 640, height: 360 });
    pin.release();
    await turns();
    expect(p.log.filter((l) => l.startsWith("scale"))).toEqual([
      "scale 1",
      "scale 1",
      "scale 0.25",
    ]);
    expect(p.log.at(-1)).toBe("fps 15");
    expect(p.port.captureScale()).toBe(0.25);
  });

  it("the producer's rest inside a window is demand: the page stays awake until the release, then rests", async () => {
    const p = await paced();
    const pin = p.port.pin();
    await turns();
    p.log.length = 0;
    p.native.setFrameRate(1);
    p.native.stopPainting();
    expect(p.log).toEqual(["fps 30"]);
    pin.release();
    await turns();
    expect(p.log).toEqual(["fps 30", "scale 0.5", "fps 1", "fps 1", "paint off"]);
    // and a pin on the page at rest wakes it in pins.ts's order: the frame rate, the metrics, then painting
    p.log.length = 0;
    const again = p.port.pin();
    await turns();
    expect(p.log).toEqual(["fps 30", "scale 1", "fps 30", "paint on"]);
    again.release();
  });

  it("the floor never passes the transport's ceiling, said before or during a window", async () => {
    const p = await paced();
    p.ceiling(10);
    expect(p.log).toEqual([]);
    const pin = p.port.pin();
    await turns();
    // (the rate in force is already the ceiling's: the pin sends no rate of its own, and never its floor of 30)
    expect(p.log.filter((l) => l.startsWith("fps"))).toEqual(["fps 10"]);
    p.ceiling(Number.POSITIVE_INFINITY);
    expect(p.log.at(-1)).toBe("fps 30");
    pin.release();
  });

  it("two pins: one release leaves the page pinned, a second release of the same is nothing, the last returns it", async () => {
    const p = await paced();
    const a = p.port.pin();
    const b = p.port.pin();
    await turns();
    a.release();
    a.release();
    await turns();
    expect(p.port.captureScale()).toBe(1);
    p.native.stopPainting();
    expect(p.log).not.toContain("paint off");
    b.release();
    await turns();
    expect(p.port.captureScale()).toBe(0.5);
    expect(p.log.at(-1)).toBe("paint off");
  });

  it("a mobile page keeps its own scale under a pin; its frame rate is still lifted", async () => {
    const p = await paced({ mobile: true });
    const pin = p.port.pin();
    await turns();
    expect(p.log).toEqual(["fps 30"]);
    p.paint(10, 10);
    expect(await within(pin.applied)).toBe("applied");
    pin.release();
  });

  it("open, applied, close: the window's one pin and one release leave the page unpinned", async () => {
    const p = await paced();
    const pin = p.port.pin();
    await turns();
    p.paint(640, 360);
    expect(await within(pin.applied)).toBe("applied");
    p.native.stopPainting();
    expect(p.log).not.toContain("paint off");
    pin.release();
    await turns();
    p.log.length = 0;
    p.native.stopPainting();
    p.native.setFrameRate(1);
    expect(p.log).toEqual(["paint off", "fps 1"]);
  });

  it("a bootstrap paint never answers a pin: only the page's own document's", async () => {
    const p = await paced({ committed: false });
    const pin = p.port.pin();
    await turns();
    p.paint(640, 360);
    expect(await within(pin.applied)).toBe("open");
    p.contents.emit("did-navigate", {}, "https://host.test/a");
    p.paint(640, 360);
    expect(await within(pin.applied)).toBe("applied");
    pin.release();
  });

  it("a pace that fails while the page lives answers failed, never gone", async () => {
    const p = await paced();
    const send = p.contents.debugger.sendCommand;
    p.contents.debugger.sendCommand = async (...args: unknown[]) => {
      if (args[0] === "Emulation.setDeviceMetricsOverride")
        throw new Error("the override was refused");
      return send(...args);
    };
    const pin = p.port.pin();
    expect(await within(pin.applied)).toBe("failed");
    pin.release();
  });

  it("a release settles a pin still waiting: cancelled, never its deadline's timeout", async () => {
    const p = await paced();
    const pin = p.port.pin({ answerBy: Date.now() + 30 });
    await turns();
    pin.release();
    expect(await within(pin.applied, 100)).toBe("cancelled");
  });

  it("a pin's deadline never holds the event loop", () => {
    const p = page();
    const made: NodeJS.Timeout[] = [];
    const real = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      const timer = real(fn, ms);
      made.push(timer);
      return timer;
    }) as unknown as typeof setTimeout);
    const pin = p.port.pin({ answerBy: Date.now() + 60_000 });
    spy.mockRestore();
    expect(made.map((t) => t.hasRef())).toEqual([false]);
    pin.release();
  });

  it("applied answers timeout at its deadline, cancelled on its signal, gone with the page", async () => {
    const p = await paced();
    const late = p.port.pin({ answerBy: Date.now() + 10 });
    expect(await within(late.applied, 200)).toBe("timeout");
    late.release();
    const stop = new AbortController();
    const cancelled = p.port.pin({ signal: stop.signal });
    stop.abort();
    expect(await within(cancelled.applied)).toBe("cancelled");
    cancelled.release();
    const waiting = p.port.pin();
    await turns();
    p.native.destroy();
    expect(await within(waiting.applied)).toBe("gone");
    waiting.release();
    expect(await within(p.port.pin().applied)).toBe("gone");
  });
});

describe("1d — the point the page's view takes: the port's viewImagePoint, the hand's too", () => {
  it("at the resting scale a point is multiplied; under a window's pin (scale 1) it is the point itself", async () => {
    const p = await paced();
    expect(p.port.viewImagePoint({ x: 200, y: 100 })).toEqual({ x: 100, y: 50 });
    const pin = p.port.pin();
    await turns();
    expect(p.port.viewImagePoint({ x: 200, y: 100 })).toEqual({ x: 200, y: 100 });
    pin.release();
  });

  it("the hand and the port give the same point for the same input", async () => {
    const p = await paced();
    await p.native.dispatchMouse({ type: "mouseMoved", x: 200, y: 100, button: "none" });
    const sent = (p.sent.filter((c) => c.method === "Input.dispatchMouseEvent").at(-1)?.params ?? {
      x: Number.NaN,
      y: Number.NaN,
    }) as { readonly x: number; readonly y: number };
    expect({ x: sent.x, y: sent.y }).toEqual({ x: 100, y: 50 });
    expect(p.port.viewImagePoint({ x: 200, y: 100 })).toEqual({ x: sent.x, y: sent.y });
  });
});
