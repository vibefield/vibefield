import {
  type FrameView,
  type GodviewDeckState,
  IPC_CHANNELS,
  type WindowLightsState,
} from "@vibefield/contracts";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { AppMenuState } from "../src/main/app-menu-model";
import type { ShellMode } from "../src/main/modes";
import type { LightsWindow } from "../src/main/window-lights";

// THE WINDOW'S LIGHTS (Godview round 3, GV-D11). Maximized, the deck's 30 px bar
// is the window's title bar and macOS's lights sit on its axis. The page says
// its deck's state BY NAME through the deck door; main owns the two positions
// and composes that word with the view it already owns. These lock the
// consequences: 12 · 9 only while the view is Godview and the deck says
// maximized, 18 · 22 in the same step as a change of view, nothing for a
// stranger, nothing where a window has no inset lights, and the position put
// back after native full screen.

const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>();
const stub = vi.hoisted(() => ({
  exposed: undefined as Record<string, unknown> | undefined,
  invoke: vi.fn(),
  built: [] as Record<string, unknown>[],
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, raw: unknown) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  contextBridge: {
    exposeInMainWorld: (_key: string, value: Record<string, unknown>) => {
      stub.exposed = value;
    },
  },
  ipcRenderer: { on: vi.fn(), off: vi.fn(), send: vi.fn(), invoke: stub.invoke },
  sharedTexture: { setSharedTextureReceiver: vi.fn() },
  // `windows.ts`'s factory, as far as it is exercised here: what a window is BUILT with.
  BrowserWindow: class {
    readonly webContents = { openDevTools: vi.fn() };
    constructor(options: Record<string, unknown>) {
      stub.built.push(options);
    }
    setBounds(): void {}
  },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
}));

const { registerDeckSet } = await import("../src/main/ipc");
const { ViewRegistry } = await import("../src/main/view");
const { BAR_LIGHTS, HEAD_LIGHTS, hasInsetLights, LightsRegistry } = await import(
  "../src/main/window-lights"
);
const { createMainWindow } = await import("../src/main/windows");
await import("../src/preload/index");

const VIEWS: readonly FrameView[] = ["canvas", "godview", "history", "assistant"];
const DECKS: readonly (GodviewDeckState | null)[] = [null, "away", "up", "maximized"];

function fakeContents(id: number) {
  const on = new Map<string, ((...args: unknown[]) => void)[]>();
  const once = new Map<string, (() => void)[]>();
  const fake = {
    id,
    destroyed: false,
    /** A navigation starts in this page, as Electron reports one. */
    navigate(opts: { inPlace: boolean; mainFrame: boolean }): void {
      for (const fn of on.get("did-start-navigation") ?? []) {
        fn({}, "vibefield-app://shell/index.html", opts.inPlace, opts.mainFrame);
      }
    },
    /** The window is gone. */
    destroy(): void {
      fake.destroyed = true;
      for (const fn of once.get("destroyed") ?? []) fn();
    },
  };
  const contents = {
    id,
    isDestroyed: () => fake.destroyed,
    send: () => undefined,
    on: (event: string, fn: (...args: unknown[]) => void) => {
      on.set(event, [...(on.get(event) ?? []), fn]);
    },
    once: (event: string, fn: () => void) => {
      once.set(event, [...(once.get(event) ?? []), fn]);
    },
  } as unknown as WebContents;
  return { contents, fake };
}

function fakeWindow() {
  const listeners = new Map<string, (() => void)[]>();
  const fake = {
    destroyed: false,
    fullScreen: false,
    /** Every position the lights were moved to, in order. A window is BUILT
     * with the head's, so an empty list is "still where it was built". */
    moved: [] as { x: number; y: number }[],
    emit(event: "enter-full-screen" | "leave-full-screen"): void {
      fake.fullScreen = event === "enter-full-screen";
      for (const fn of listeners.get(event) ?? []) fn();
    },
    listening: (event: string): number => (listeners.get(event) ?? []).length,
  };
  const window: LightsWindow = {
    isDestroyed: () => fake.destroyed,
    isFullScreen: () => fake.fullScreen,
    setWindowButtonPosition: (position) => {
      if (position !== null) fake.moved.push({ ...position });
    },
    on: (event: string, fn: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
  };
  return { window, fake };
}

/** Main's two owners wired as `index.ts` wires them: the lights follow a view
 * inside the view owner's own step, and the menu is redrawn from both facts. */
function shell(opts: { inset?: boolean } = {}) {
  const windows = new Map<WebContents, LightsWindow>();
  const menu: AppMenuState[] = [];
  const views = new ViewRegistry({
    onChanged: (state, target) => {
      lights.viewChanged(target);
      menu.push({ view: state.view, deck: lights.peek(target).deck });
    },
  });
  const lights = new LightsRegistry({
    inset: opts.inset ?? true,
    view: (target) => views.peek(target).view,
    windowOf: (target) => windows.get(target) ?? null,
    onChanged: (state, target) => {
      menu.push({ view: views.peek(target).view, deck: state.deck });
    },
  });
  const open = (id = 1) => {
    const page = fakeContents(id);
    const native = fakeWindow();
    windows.set(page.contents, native.window);
    return {
      contents: page.contents,
      page: page.fake,
      native: native.fake,
      /** ⌘1–⌘4, a cell of the views track, a View menu item: all ask this owner. */
      view: (view: FrameView) => views.ensure(page.contents).set(view),
      /** The page's word, as the deck door hands it over. */
      say: (deck: GodviewDeckState | null): WindowLightsState =>
        lights.ensure(page.contents).say(deck),
      /** The native window is gone while its page still answers. */
      lose: () => windows.delete(page.contents),
    };
  };
  return { views, lights, menu, open };
}

describe("the two positions", () => {
  it("are main's: the head's axis and the deck's bar", () => {
    // 18 · 22 puts the 12 px lights on the head's axis (y 28); 12 · 9 puts
    // them on the 30 px bar's (y 15) — DESIGN.md §8, "Maximized".
    expect(HEAD_LIGHTS).toEqual({ x: 18, y: 22 });
    expect(BAR_LIGHTS).toEqual({ x: 12, y: 9 });
  });

  it("exist only on a Mac, outside the harness modes", () => {
    expect(hasInsetLights("darwin", "production")).toBe(true);
    expect(hasInsetLights("darwin", "dev")).toBe(true);
    // a smoke's window keeps the default title bar: its lights are the system's
    for (const mode of ["smoke", "smoke-canvas", "smoke-godview", "godview-perf-lab"] as const) {
      expect(hasInsetLights("darwin", mode), mode).toBe(false);
    }
    expect(hasInsetLights("win32", "production")).toBe(false);
    expect(hasInsetLights("linux", "production")).toBe(false);
  });

  it("are what a window is built with — one spelling of the head's position", () => {
    for (const mode of ["production", "smoke-godview"] as const satisfies readonly ShellMode[]) {
      stub.built.length = 0;
      createMainWindow({ mode, preloadPath: "/preload.cjs", show: false });
      const [options] = stub.built;
      if (hasInsetLights(process.platform, mode)) {
        expect(options?.["titleBarStyle"], mode).toBe("hiddenInset");
        expect(options?.["trafficLightPosition"], mode).toEqual(HEAD_LIGHTS);
      } else {
        expect(options?.["titleBarStyle"], mode).toBe("default");
        expect(options, mode).not.toHaveProperty("trafficLightPosition");
      }
    }
  });
});

describe("a window's lights, composed with the view main owns", () => {
  it("stand at 12 · 9 only while the view is Godview AND the deck says maximized", () => {
    for (const view of VIEWS) {
      for (const deck of DECKS) {
        const win = shell().open();
        // every view is held as asked, Chat's too (SP-1b); only Godview's lights can go to the bar
        const held = win.view(view).view;
        const answer = win.say(deck);
        const onBar = held === "godview" && deck === "maximized";
        expect(answer, `${view} · ${String(deck)}`).toEqual({
          deck,
          lights: onBar ? "bar" : "head",
        });
        // …and the native window was moved exactly when the answer says so.
        expect(win.native.moved, `${view} · ${String(deck)}`).toEqual(onBar ? [BAR_LIGHTS] : []);
      }
    }
  });

  it("go back to 18 · 22 in the same step as a change of view — no word from the page", () => {
    const { lights, open } = shell();
    const win = open();
    win.view("godview");
    win.say("maximized");
    expect(win.native.moved).toEqual([BAR_LIGHTS]);
    // ⌘1 from a maximized deck. The page has said nothing since: by the time
    // the view owner has answered, the lights are already back.
    win.view("canvas");
    expect(win.native.moved).toEqual([BAR_LIGHTS, HEAD_LIGHTS]);
    // Main still holds what the page last said — the page did not take it back —
    expect(lights.peek(win.contents)).toEqual({ deck: "maximized", lights: "head" });
    // so ⌘2 back onto a deck that is still maximized needs no word either.
    win.view("godview");
    expect(win.native.moved).toEqual([BAR_LIGHTS, HEAD_LIGHTS, BAR_LIGHTS]);
    expect(lights.peek(win.contents)).toEqual({ deck: "maximized", lights: "bar" });
  });

  it("go back when the deck says it left maximized, and never move without cause", () => {
    const win = shell().open();
    win.view("godview");
    expect(win.say("up")).toEqual({ deck: "up", lights: "head" });
    expect(win.native.moved).toEqual([]);
    win.say("maximized");
    win.say("maximized"); // said again: answered, not moved again
    win.view("godview"); // asked again for the view it is in
    expect(win.native.moved).toEqual([BAR_LIGHTS]);
    // "up" from the START of a drag out of maximized (the lead's L2)
    expect(win.say("up")).toEqual({ deck: "up", lights: "head" });
    win.say("away");
    expect(win.say(null)).toEqual({ deck: null, lights: "head" });
    expect(win.native.moved).toEqual([BAR_LIGHTS, HEAD_LIGHTS]);
  });

  it("are each window's own", () => {
    const { lights, open } = shell();
    const a = open(1);
    const b = open(2);
    a.view("godview");
    b.view("godview");
    a.say("maximized");
    b.say("up");
    expect(a.native.moved).toEqual([BAR_LIGHTS]);
    expect(b.native.moved).toEqual([]);
    // a change of view in one window moves only that window's lights
    b.view("history");
    expect(a.native.moved).toEqual([BAR_LIGHTS]);
    a.view("history");
    expect(a.native.moved).toEqual([BAR_LIGHTS, HEAD_LIGHTS]);
    expect(b.native.moved).toEqual([]);
    expect(lights.peek(a.contents).deck).toBe("maximized");
    expect(lights.peek(b.contents).deck).toBe("up");
  });

  it("are left alone where a window has none — a no-op, said in the answer", () => {
    // Not a Mac, or a harness window with the default title bar.
    const { lights, menu, open } = shell({ inset: false });
    const win = open();
    win.view("godview");
    expect(win.say("maximized")).toEqual({ deck: "maximized", lights: "none" });
    win.view("canvas");
    win.view("godview");
    win.native.emit("enter-full-screen");
    win.native.emit("leave-full-screen");
    expect(win.native.moved).toEqual([]);
    expect(win.native.listening("leave-full-screen")).toBe(0);
    expect(lights.peek(win.contents)).toEqual({ deck: "maximized", lights: "none" });
    // The deck's word is still held: ⌘W's lend reads it on every platform.
    expect(menu.at(-1)).toEqual({ view: "godview", deck: "maximized" });
    expect(win.say("away")).toEqual({ deck: "away", lights: "none" });
    expect(menu.at(-1)).toEqual({ view: "godview", deck: "away" });
  });

  it("are put back after the window leaves native full screen, and never moved inside it", () => {
    const win = shell().open();
    win.view("godview");
    win.say("maximized");
    expect(win.native.moved).toEqual([BAR_LIGHTS]);
    // The system owns the title bar in full screen. Leaving it, the position is
    // set again even though nothing changed.
    win.native.emit("enter-full-screen");
    win.native.emit("leave-full-screen");
    expect(win.native.moved).toEqual([BAR_LIGHTS, BAR_LIGHTS]);
    // A word said INSIDE full screen is held, not applied, until the window is out.
    win.native.emit("enter-full-screen");
    expect(win.say("up")).toEqual({ deck: "up", lights: "head" });
    win.view("canvas");
    expect(win.native.moved).toEqual([BAR_LIGHTS, BAR_LIGHTS]);
    win.native.emit("leave-full-screen");
    expect(win.native.moved).toEqual([BAR_LIGHTS, BAR_LIGHTS, HEAD_LIGHTS]);
  });

  it("are put back after full screen for a window that was already in it when its page first spoke", () => {
    const win = shell().open();
    win.native.fullScreen = true;
    win.view("godview");
    expect(win.say("maximized")).toEqual({ deck: "maximized", lights: "bar" });
    expect(win.native.moved).toEqual([]);
    win.native.emit("leave-full-screen");
    expect(win.native.moved).toEqual([BAR_LIGHTS]);
  });

  it("forget what a document said when the document is replaced", () => {
    // The page owns the word. A reload (DK-9, a users switch) starts a document
    // that has said nothing yet — and may never mount a deck.
    const { lights, menu, open } = shell();
    const win = open();
    win.view("godview");
    win.say("maximized");
    win.page.navigate({ inPlace: true, mainFrame: true }); // a hash change
    win.page.navigate({ inPlace: false, mainFrame: false }); // a frame inside it
    expect(lights.peek(win.contents)).toEqual({ deck: "maximized", lights: "bar" });
    win.page.navigate({ inPlace: false, mainFrame: true });
    expect(lights.peek(win.contents)).toEqual({ deck: null, lights: "head" });
    expect(win.native.moved).toEqual([BAR_LIGHTS, HEAD_LIGHTS]);
    // With no word, ⌘W's lend is what it was before any page spoke.
    expect(menu.at(-1)).toEqual({ view: "godview", deck: null });
  });

  it("tell the menu after every word, so ⌘W follows the deck", () => {
    const { menu, open } = shell();
    const win = open();
    win.view("godview");
    win.say("up");
    win.say("away");
    win.view("history");
    expect(menu).toEqual([
      { view: "godview", deck: null },
      { view: "godview", deck: "up" },
      { view: "godview", deck: "away" },
      { view: "history", deck: "away" },
    ]);
  });

  it("peek without creating, and are buried with their window", () => {
    const { lights, open } = shell();
    const win = open(7);
    // A view change in a window whose page never spoke brings nothing into being.
    win.view("godview");
    expect(lights.peek(win.contents)).toEqual({ deck: null, lights: "head" });
    expect(win.native.listening("leave-full-screen")).toBe(0);
    expect(lights.ensure(win.contents)).toBe(lights.ensure(win.contents));
    expect(win.native.listening("leave-full-screen")).toBe(1);
    win.say("maximized");
    win.page.destroy();
    expect(lights.peek(win.contents)).toEqual({ deck: null, lights: "head" });
  });

  it("answer a page whose window is gone, and touch nothing", () => {
    const { open } = shell();
    const gone = open(3);
    gone.view("godview");
    gone.native.destroyed = true;
    expect(gone.say("maximized")).toEqual({ deck: "maximized", lights: "bar" });
    expect(gone.native.moved).toEqual([]);
    const lost = open(4);
    lost.view("godview");
    lost.lose();
    expect(lost.say("maximized")).toEqual({ deck: "maximized", lights: "bar" });
    expect(lost.native.moved).toEqual([]);
  });
});

describe("the deck door, main's half (ipc)", () => {
  it("answers a registered window by name and refuses a stranger, who moves nothing", async () => {
    const { lights, open } = shell();
    const win = open(5);
    const stranger = open(9);
    win.view("godview");
    stranger.view("godview");
    registerDeckSet({ owns: (sender: unknown) => sender === win.contents } as never, lights);
    const handle = handlers.get(IPC_CHANNELS.deckSet);
    expect(await handle?.({ sender: win.contents }, { deck: "maximized" })).toEqual({
      deck: "maximized",
      lights: "bar",
    });
    expect(win.native.moved).toEqual([BAR_LIGHTS]);
    await expect(handle?.({ sender: stranger.contents }, { deck: "maximized" })).rejects.toThrow(
      /unregistered sender/,
    );
    expect(stranger.native.moved).toEqual([]);
    expect(lights.peek(stranger.contents)).toEqual({ deck: null, lights: "head" });
    expect(stranger.native.listening("leave-full-screen")).toBe(0);
  });

  it("takes a name or null — never a position, never silence — and a refused word changes nothing", async () => {
    const { lights, menu, open } = shell();
    const win = open(6);
    win.view("godview");
    registerDeckSet({ owns: () => true } as never, lights);
    const handle = handlers.get(IPC_CHANNELS.deckSet);
    await handle?.({ sender: win.contents }, { deck: "maximized" });
    const told = menu.length;
    for (const raw of [{ x: 12, y: 9 }, { deck: { x: 12, y: 9 } }, {}, { deck: "full" }]) {
      await expect(handle?.({ sender: win.contents }, raw), JSON.stringify(raw)).rejects.toThrow();
    }
    // What main holds is what was last SAID: a refused word moved no lights
    // and reached no menu.
    expect(lights.peek(win.contents)).toEqual({ deck: "maximized", lights: "bar" });
    expect(win.native.moved).toEqual([BAR_LIGHTS]);
    expect(menu).toHaveLength(told);
    expect(await handle?.({ sender: win.contents }, { deck: null })).toEqual({
      deck: null,
      lights: "head",
    });
  });
});

describe("the deck door, the page's half (preload)", () => {
  const set = (): ((deck: unknown) => Promise<unknown>) => {
    if (stub.exposed === undefined) throw new Error("preload exposed nothing");
    return (stub.exposed["deck"] as { set: (deck: unknown) => Promise<unknown> }).set;
  };

  it("crosses with the deck's name, by the channel, and hands back main's answer", async () => {
    stub.invoke.mockResolvedValueOnce({ deck: "maximized", lights: "bar" });
    await expect(set()("maximized")).resolves.toEqual({ deck: "maximized", lights: "bar" });
    expect(stub.invoke).toHaveBeenCalledWith(IPC_CHANNELS.deckSet, { deck: "maximized" });
    stub.invoke.mockResolvedValueOnce({ deck: null, lights: "none" });
    await expect(set()(null)).resolves.toEqual({ deck: null, lights: "none" });
    expect(stub.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.deckSet, { deck: null });
  });

  it("a name it does not know throws at the call site, never crossing; a malformed answer never reaches the page", async () => {
    stub.invoke.mockClear();
    await expect(set()("full")).rejects.toThrow();
    await expect(set()({ x: 12, y: 9 })).rejects.toThrow();
    await expect(set()(undefined)).rejects.toThrow();
    expect(stub.invoke).not.toHaveBeenCalled();
    stub.invoke.mockResolvedValueOnce({ deck: "maximized", lights: { x: 12, y: 9 } });
    await expect(set()("maximized")).rejects.toThrow();
  });
});
