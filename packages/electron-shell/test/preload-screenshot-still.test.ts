import { IPC_CHANNELS } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StillOpened } from "../src/main/screenshot-still-bytes";

// HN-D7 — the still's bytes as the PAGE asks for them: one door in the screenshot group, by the
// still's basename alone, its answer checked before it reaches the page (bytes or null, nothing
// else). Its twin (HN-4) asks only whether the still is kept (a boolean, nothing else). Captured
// from `exposeInMainWorld`, preload-browser-data's pattern; main's half is wired through the same
// `ipcMain.handle` capture.

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

const { registerScreenshotStillBytes, registerScreenshotStillKept } = await import(
  "../src/main/ipc"
);
await import("../src/preload/index");

type Doors = Record<string, (...args: unknown[]) => Promise<unknown>>;
const screenshot = (): Doors => {
  const exposed = stub.exposed;
  if (exposed === undefined) throw new Error("preload exposed nothing");
  return exposed.screenshot as Doors;
};

beforeEach(() => {
  stub.invoke.mockReset();
});

describe("the preload's still door (HN-D7)", () => {
  it("asks main on its own channel by the still's basename, and hands back bytes or null", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    stub.invoke.mockResolvedValueOnce(bytes);
    await expect(screenshot().stillBytes!("capture.png")).resolves.toEqual(bytes);
    expect(stub.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.screenshotStillBytes, { name: "capture.png" }],
    ]);
    stub.invoke.mockResolvedValueOnce(null);
    await expect(screenshot().stillBytes!("capture.png")).resolves.toBeNull();
  });

  it("never sends a path, and an answer that is not bytes never reaches the page", async () => {
    await expect(screenshot().stillBytes!("/tmp/capture.png")).rejects.toThrow();
    expect(stub.invoke).not.toHaveBeenCalled();
    for (const answer of [undefined, "bytes", [1, 2], { 0: 1 }, new Uint16Array([1])]) {
      stub.invoke.mockResolvedValueOnce(answer);
      await expect(screenshot().stillBytes!("capture.png")).rejects.toThrow(/other than bytes/);
    }
  });

  it("asks main whether a still is kept on its own channel, by the basename, and hands back the boolean", async () => {
    stub.invoke.mockResolvedValueOnce(true);
    await expect(screenshot().stillKept!("capture.png")).resolves.toBe(true);
    stub.invoke.mockResolvedValueOnce(false);
    await expect(screenshot().stillKept!("capture.png")).resolves.toBe(false);
    expect(stub.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.screenshotStillKept, { name: "capture.png" }],
      [IPC_CHANNELS.screenshotStillKept, { name: "capture.png" }],
    ]);
  });

  it("never asks about a path, and an answer that is not a boolean never reaches the page", async () => {
    await expect(screenshot().stillKept!("/tmp/capture.png")).rejects.toThrow();
    expect(stub.invoke).not.toHaveBeenCalled();
    for (const answer of [undefined, null, "true", 1, { kept: true }]) {
      stub.invoke.mockResolvedValueOnce(answer);
      await expect(screenshot().stillKept!("capture.png")).rejects.toThrow(/kept or not/);
    }
  });
});

describe("the still door, main's half (HN-D7)", () => {
  it("answers a registered window with the retained still's bytes, null for one not kept, and refuses a stranger", async () => {
    const sender = { id: 3 };
    const bytes = new Uint8Array([9, 8, 7]);
    const opened: StillOpened<Uint8Array> = { ok: true, value: bytes };
    const read = vi.fn(async (_path: string) => opened);
    registerScreenshotStillBytes(
      { owns: (candidate: unknown) => candidate === sender } as never,
      (url) =>
        url.endsWith("/capture.png")
          ? { ok: true, path: "/stills/capture.png", name: "capture.png" }
          : { ok: false, reason: "not-retained" },
      read,
    );
    const handle = handlers.get(IPC_CHANNELS.screenshotStillBytes);
    expect(await handle?.({ sender }, { name: "capture.png" })).toEqual(bytes);
    expect(read).toHaveBeenCalledWith("/stills/capture.png");
    expect(await handle?.({ sender }, { name: "gone.png" })).toBeNull();
    await expect(handle?.({ sender: { id: 9 } }, { name: "capture.png" })).rejects.toThrow(
      /unregistered sender/,
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("answers a registered window whether a still is kept — reading nothing — and refuses a stranger", async () => {
    const sender = { id: 4 };
    const kept: StillOpened<true> = { ok: true, value: true };
    const check = vi.fn(async (_path: string) => kept);
    registerScreenshotStillKept(
      { owns: (candidate: unknown) => candidate === sender } as never,
      (url) =>
        url.endsWith("/capture.png")
          ? { ok: true, path: "/stills/capture.png", name: "capture.png" }
          : { ok: false, reason: "not-retained" },
      check,
    );
    const handle = handlers.get(IPC_CHANNELS.screenshotStillKept);
    expect(await handle?.({ sender }, { name: "capture.png" })).toBe(true);
    expect(check).toHaveBeenCalledWith("/stills/capture.png");
    expect(await handle?.({ sender }, { name: "gone.png" })).toBe(false);
    await expect(handle?.({ sender: { id: 9 } }, { name: "capture.png" })).rejects.toThrow(
      /unregistered sender/,
    );
    expect(check).toHaveBeenCalledTimes(1);
  });
});
