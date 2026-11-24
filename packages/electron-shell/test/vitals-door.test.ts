import { IPC_CHANNELS } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// VT-2c (track VT, 2026-11-24; DESIGN.md §8 "Vitals", the recorder's switch) — Settings → Diagnostics' Open Vitals:
// the preload's one door as the page sees it, and main's half, which opens the window only for the focused product
// window's own page. Captured from `exposeInMainWorld`, preload-browser-data's pattern.

const handlers = new Map<string, (event: unknown, raw?: unknown) => unknown>();
const stub = vi.hoisted(() => ({
  exposed: undefined as Record<string, unknown> | undefined,
  invoke: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, raw?: unknown) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  contextBridge: {
    exposeInMainWorld: (_key: string, value: Record<string, unknown>) => {
      stub.exposed = value;
    },
  },
  ipcRenderer: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    invoke: stub.invoke,
  },
  sharedTexture: {
    setSharedTextureReceiver: vi.fn(),
  },
}));
vi.mock("@vibecook/ghosttea-electron/preload", () => ({
  forwardGhostteaRendererPorts: vi.fn(),
}));

const { registerVitalsOpen, VITALS_DOOR_UNAVAILABLE } = await import("../src/main/vitals-door");
await import("../src/preload/index");

type Doors = Record<string, (...args: unknown[]) => Promise<unknown>>;
const vitals = (): Doors => {
  const exposed = stub.exposed;
  if (exposed === undefined) throw new Error("preload exposed nothing");
  return exposed.vitals as Doors;
};

beforeEach(() => {
  stub.invoke.mockReset();
  handlers.clear();
});

describe("the preload's Vitals door (VT-2c)", () => {
  it("exposes exactly one door, which asks its own channel with nothing and hands back nothing", async () => {
    expect(Object.keys(vitals())).toEqual(["open"]);
    stub.invoke.mockResolvedValueOnce({ anything: "main might say" });
    await expect(vitals().open!()).resolves.toBeUndefined();
    expect(stub.invoke.mock.calls).toEqual([[IPC_CHANNELS.vitalsOpen]]);
  });

  it("a refusal from main reaches the page as a rejection", async () => {
    stub.invoke.mockRejectedValueOnce(new Error(VITALS_DOOR_UNAVAILABLE));
    await expect(vitals().open!()).rejects.toThrow(VITALS_DOOR_UNAVAILABLE);
  });
});

describe("the Vitals door, main's half (VT-2c)", () => {
  const mainFrame = { frame: "main" };
  const page = (focused = true) => ({
    id: 3,
    mainFrame,
    isFocused: () => focused,
  });

  const install = (owned: unknown, open: (() => void) | null) => {
    registerVitalsOpen({
      registry: { owns: (sender) => sender === owned },
      open: () => open,
    });
    const handle = handlers.get(IPC_CHANNELS.vitalsOpen);
    if (handle === undefined) throw new Error("no handler on the vitals channel");
    return handle;
  };

  it("opens (or brings forward) the window for the focused product window's own page, once a press", async () => {
    const sender = page();
    const open = vi.fn();
    const handle = install(sender, open);
    expect(await handle({ sender, senderFrame: mainFrame })).toBeUndefined();
    expect(await handle({ sender, senderFrame: mainFrame })).toBeUndefined();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("refuses a stranger, a frame inside the page, and a page in the background, and opens nothing", async () => {
    const sender = page();
    const open = vi.fn();
    const handle = install(sender, open);
    const stranger = page();
    expect(() => handle({ sender: stranger, senderFrame: mainFrame })).toThrow(
      /focused product window/,
    );
    expect(() => handle({ sender, senderFrame: { frame: "inner" } })).toThrow(
      /focused product window/,
    );
    const background = page(false);
    const handleBackground = install(background, open);
    expect(() => handleBackground({ sender: background, senderFrame: mainFrame })).toThrow(
      /focused product window/,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("says so where this mode installs no Vitals", async () => {
    const sender = page();
    const handle = install(sender, null);
    expect(() => handle({ sender, senderFrame: mainFrame })).toThrow(VITALS_DOOR_UNAVAILABLE);
  });
});
