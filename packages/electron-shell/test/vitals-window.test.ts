// VT-6 (track VT, 2026-11-24) — the Vitals window's host: how it is shown when a person asks for it, and when it
// opens by itself beside the desk under `pnpm dev`. Driven with a fake window: nothing here starts Electron.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeWindow {
  calls: string[];
  minimized: boolean;
  destroyed: boolean;
  loaded: { resolve(): void; reject(error: Error): void } | null;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  showInactive(): void;
  setIgnoreMouseEvents(ignore: boolean): void;
  destroy(): void;
  once(event: string, listener: () => void): void;
  loadURL(url: string): Promise<void>;
  webContents: {
    on(): void;
    postMessage(): void;
    isDestroyed(): boolean;
    isCrashed(): boolean;
    getOSProcessId(): number;
  };
}

const made: FakeWindow[] = [];
const makeWindow = (): FakeWindow => {
  const fake: FakeWindow = {
    calls: [],
    minimized: false,
    destroyed: false,
    loaded: null,
    isDestroyed: () => fake.destroyed,
    isMinimized: () => fake.minimized,
    restore: () => {
      fake.minimized = false;
      fake.calls.push("restore");
    },
    show: () => fake.calls.push("show"),
    focus: () => fake.calls.push("focus"),
    showInactive: () => fake.calls.push("showInactive"),
    setIgnoreMouseEvents: (ignore) => fake.calls.push(`ignoreMouse:${ignore}`),
    destroy: () => {
      fake.destroyed = true;
    },
    once: () => undefined,
    loadURL: () =>
      new Promise<void>((resolve, reject) => {
        fake.loaded = { resolve, reject };
      }),
    webContents: {
      on: () => undefined,
      postMessage: () => undefined,
      isDestroyed: () => false,
      isCrashed: () => false,
      getOSProcessId: () => 4242,
    },
  };
  made.push(fake);
  return fake;
};

vi.mock("electron", () => ({
  MessageChannelMain: class {
    port1 = {};
    port2 = {};
  },
}));
vi.mock("../src/main/windows", () => ({ createVitalsWindow: () => makeWindow() }));
vi.mock("../src/main/security", () => ({ installNavigationPolicy: () => undefined }));
vi.mock("../src/main/window-chords", () => ({ installWindowChords: () => undefined }));

const { afterDeskShown, createVitalsWindowHost } = await import("../src/main/vitals-window");

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string): string =>
  readFileSync(join(here, "..", "src", relative), "utf8");

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};

const said: Array<{ event: string; attrs: unknown }> = [];
const logger = {
  child: () => logger,
  trace: () => undefined,
  debug: () => undefined,
  info: (event: string, _message: string, attrs?: unknown) => {
    said.push({ event, attrs });
  },
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  isLevelEnabled: () => false,
};

const host = (quiet = false) =>
  createVitalsWindowHost({
    mode: "production",
    viteUrl: "http://localhost:5173",
    preloadPath: "/preload.cjs",
    adopt: () => ({ dispose: () => undefined }),
    feed: () => ({ start: () => undefined, close: () => undefined }),
    onChanged: () => undefined,
    quit: () => undefined,
    quiet,
    logger: logger as never,
  });

const theWindow = (): FakeWindow => {
  const fake = made[0];
  if (fake === undefined) throw new Error("no window was made");
  return fake;
};

beforeEach(() => {
  made.length = 0;
  said.length = 0;
});

describe("VT-6 — the Vitals window opened beside the desk, unasked", () => {
  it("is shown without taking the keys, and the pointer still reaches it", async () => {
    const vitals = host();
    const opened = vitals.openBeside();
    await settle();
    expect(theWindow().calls).toEqual([]); // nothing is shown before its document loaded
    theWindow().loaded?.resolve();
    await opened;
    expect(theWindow().calls).toEqual(["showInactive"]);
    expect(said).toEqual([{ event: "desktop.vitals.window_opened", attrs: { asked: false } }]);
  });

  it("leaves an open window as the person put it: not shown again, not restored", async () => {
    const vitals = host();
    const opened = vitals.openBeside();
    await settle();
    theWindow().loaded?.resolve();
    await opened;
    theWindow().minimized = true;
    theWindow().calls.length = 0;
    await vitals.openBeside();
    expect(made).toHaveLength(1);
    expect(theWindow().calls).toEqual([]);
    expect(theWindow().minimized).toBe(true);
  });

  it("makes one window when the desk's events ask twice while it loads", async () => {
    const vitals = host();
    const first = vitals.openBeside();
    const second = vitals.openBeside();
    await settle();
    theWindow().loaded?.resolve();
    await Promise.all([first, second]);
    expect(made).toHaveLength(1);
    expect(theWindow().calls).toEqual(["showInactive"]);
  });
});

describe("VT-6 — a person's ask still brings it forward", () => {
  it("opens it shown and holding the keys", async () => {
    const vitals = host();
    const opened = vitals.open();
    await settle();
    theWindow().loaded?.resolve();
    await opened;
    expect(theWindow().calls).toEqual(["show", "focus"]);
    expect(said).toEqual([{ event: "desktop.vitals.window_opened", attrs: { asked: true } }]);
  });

  it("restores and focuses the one that opened by itself", async () => {
    const vitals = host();
    const opened = vitals.openBeside();
    await settle();
    theWindow().loaded?.resolve();
    await opened;
    theWindow().minimized = true;
    theWindow().calls.length = 0;
    await vitals.open();
    expect(made).toHaveLength(1);
    expect(theWindow().calls).toEqual(["restore", "show", "focus"]);
  });

  it("ends in front with the keys when it meets an unasked opening still loading", async () => {
    const vitals = host();
    const unasked = vitals.openBeside();
    const asked = vitals.open();
    await settle();
    expect(theWindow().calls).toEqual([]);
    theWindow().loaded?.resolve();
    await Promise.all([unasked, asked]);
    expect(made).toHaveLength(1);
    expect(theWindow().calls).toEqual(["showInactive", "show", "focus"]);
  });

  it("says a failed load to both askers, and the next ask makes a new window", async () => {
    const vitals = host();
    const unasked = vitals.openBeside();
    const asked = vitals.open();
    await settle();
    theWindow().loaded?.reject(new Error("no document"));
    await expect(unasked).rejects.toThrow("no document");
    await expect(asked).rejects.toThrow("no document");
    expect(theWindow().destroyed).toBe(true);
    const again = vitals.open();
    await settle();
    expect(made).toHaveLength(2);
    made[1]?.loaded?.resolve();
    await again;
    expect(made[1]?.calls).toEqual(["show", "focus"]);
  });
});

describe("VT-6 — a harness's Vitals window stays out of the person's way, asked for or not", () => {
  it.each([
    ["asked", true],
    ["unasked", false],
  ] as const)("%s: shown inactive and passed through by the pointer", async (_name, asked) => {
    const vitals = host(true);
    const opened = asked ? vitals.open() : vitals.openBeside();
    await settle();
    theWindow().loaded?.resolve();
    await opened;
    expect(theWindow().calls).toEqual(["ignoreMouse:true", "showInactive"]);
  });
});

describe("VT-6 — after the desk's window is shown", () => {
  const desk = (visible: boolean) => {
    const state = { destroyed: false, shows: [] as Array<() => void> };
    return {
      state,
      isDestroyed: () => state.destroyed,
      isVisible: () => visible,
      once: ((event: string, listener: () => void) => {
        if (event === "show") state.shows.push(listener);
      }) as never,
    };
  };

  it("runs at once for a desk already shown", () => {
    const run = vi.fn();
    afterDeskShown(desk(true), run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits for a hidden desk's show, and runs once", () => {
    const run = vi.fn();
    const hidden = desk(false);
    afterDeskShown(hidden, run);
    expect(run).not.toHaveBeenCalled();
    expect(hidden.state.shows).toHaveLength(1);
    hidden.state.shows[0]?.();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never runs for a desk that went first", () => {
    const run = vi.fn();
    const gone = desk(true);
    gone.state.destroyed = true;
    afterDeskShown(gone, run);
    const late = desk(false);
    afterDeskShown(late, run);
    late.state.destroyed = true;
    late.state.shows[0]?.();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("VT-6 — main's wiring", () => {
  it("opens it with each desk under dev alone, by the mode's own answer, and still closes it with the desk", () => {
    const index = source("main/index.ts");
    const wiring = index.slice(
      index.indexOf("const vitalsWithDesk = opensVitalsWithDesk(MODE, process.env);"),
    );
    const block = wiring.slice(0, wiring.indexOf("shellDisposers.add("));
    expect(block).toContain("if (!open) vitalsHost.closeWindow();");
    expect(block).toContain("else if (vitalsWithDesk) vitalsHost.openWithDesk();");
    // and a desk that was open before the listener stood
    expect(block).toContain("\n    if (vitalsWithDesk) vitalsHost.openWithDesk();");
  });

  it("opens it unasked only after the desk is shown, and never from a host that was let go", () => {
    const vitals = source("main/vitals.ts");
    const door = vitals.slice(vitals.indexOf("openWithDesk: () => {"));
    const body = door.slice(0, door.indexOf("closeWindow:"));
    expect(body).toContain("afterDeskShown(desk, () => {");
    expect(body).toContain("if (disposed) return;");
    expect(body).toContain("windowHost.openBeside()");
    expect(body).not.toContain("windowHost.open()");
  });
});
