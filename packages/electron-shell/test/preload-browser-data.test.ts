import { IPC_CHANNELS } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// BP-D4 (thinking-browser-profile.md §3·3, 2026-10-26) — Settings' "Clear browsing data" as the PAGE sees it: one door,
// no argument, its answer parsed before it reaches the page (counts only: no path, no site, no size). Captured from
// `exposeInMainWorld`, preload-update's pattern.

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

const { registerBrowserDataClear } = await import("../src/main/ipc");
await import("../src/preload/index");

type Doors = Record<string, (...args: unknown[]) => Promise<unknown>>;
const browserData = (): Doors => {
  const exposed = stub.exposed;
  if (exposed === undefined) throw new Error("preload exposed nothing");
  return exposed.browserData as Doors;
};

beforeEach(() => {
  stub.invoke.mockReset();
});

describe("the preload's browsing-data door (BP-D4)", () => {
  it("exposes exactly one door, which asks its own channel with nothing", async () => {
    expect(Object.keys(browserData())).toEqual(["clear"]);
    stub.invoke.mockResolvedValueOnce({ profiles: 1, pages: 2 });
    await expect(browserData().clear!()).resolves.toEqual({ profiles: 1, pages: 2 });
    expect(stub.invoke.mock.calls).toEqual([[IPC_CHANNELS.browserDataClear]]);
  });

  it("a malformed answer from main never reaches the page", async () => {
    for (const answer of [
      undefined,
      { profiles: 1 },
      { profiles: -1, pages: 0 },
      { profiles: 1, pages: "2" },
    ]) {
      stub.invoke.mockResolvedValueOnce(answer);
      await expect(browserData().clear!(), JSON.stringify(answer)).rejects.toThrow();
    }
  });
});

describe("the browsing-data door, main's half (BP-D4)", () => {
  it("clears for a registered window and answers its counts, parsed", async () => {
    const sender = { id: 3 };
    const clear = vi.fn(async () => ({ profiles: 1, pages: 2 }));
    registerBrowserDataClear({ owns: (s: unknown) => s === sender } as never, clear);
    const handle = handlers.get(IPC_CHANNELS.browserDataClear);
    expect(await handle?.({ sender })).toEqual({ profiles: 1, pages: 2 });
    expect(clear).toHaveBeenCalledOnce();
  });

  it("refuses a stranger and clears nothing; an answer outside the contract never crosses", async () => {
    const sender = { id: 4 };
    const clear = vi.fn(async () => ({ profiles: 1, pages: 0 }));
    registerBrowserDataClear({ owns: (s: unknown) => s === sender } as never, clear);
    const handle = handlers.get(IPC_CHANNELS.browserDataClear);
    await expect(handle?.({ sender: { id: 9 } })).rejects.toThrow(/unregistered sender/);
    expect(clear).not.toHaveBeenCalled();
    registerBrowserDataClear({ owns: (s: unknown) => s === sender } as never, async () => ({
      profiles: -1,
      pages: 0,
    }));
    await expect(handlers.get(IPC_CHANNELS.browserDataClear)?.({ sender })).rejects.toThrow();
  });
});
