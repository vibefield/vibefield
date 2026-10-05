import { IPC_CHANNELS } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";

// DK-9 — THE WINDOW'S RENDERER REPLACED AT ITS OWN ASKING (main/ipc.ts `registerRendererReplace`, the preload's
// `replaceRenderer`): a plugin update whose kinds the page's realm cannot take is carried by a NEW DOCUMENT. The
// page's own `location.reload()` is a navigation the contents policy refuses outside dev — the restart smoke
// caught it: the window drained its board and sat on a closed lane — so main reloads the page. Pinned here:
// the registered-sender gate, the payload both ways, and that MAIN reloads the sender — after it answers.

const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>();
const stub = vi.hoisted(() => ({
  exposed: undefined as Record<string, unknown> | undefined,
  invoke: vi.fn(),
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
}));
vi.mock("@vibecook/ghosttea-electron/preload", () => ({
  forwardGhostteaRendererPorts: vi.fn(),
}));

const { registerRendererReplace } = await import("../src/main/ipc");
await import("../src/preload/index");

function fakeSender(id: number) {
  return { id, isDestroyed: vi.fn(() => false), reload: vi.fn() };
}

describe("the renderer replacement door, main's half (DK-9)", () => {
  it("answers a registered window, then MAIN reloads that window", async () => {
    const sender = fakeSender(3);
    const reload = vi.fn();
    registerRendererReplace({ owns: (s: unknown) => s === sender } as never, undefined, reload);
    const handle = handlers.get(IPC_CHANNELS.rendererReplace);
    expect(await handle?.({ sender }, { reason: "plugin-kinds" })).toEqual({ replacing: true });
    expect(reload).toHaveBeenCalledWith(sender);
  });

  it("refuses a stranger and a reason it does not know — and reloads nothing", async () => {
    const sender = fakeSender(4);
    const reload = vi.fn();
    registerRendererReplace({ owns: (s: unknown) => s === sender } as never, undefined, reload);
    const handle = handlers.get(IPC_CHANNELS.rendererReplace);
    await expect(handle?.({ sender: fakeSender(9) }, { reason: "plugin-kinds" })).rejects.toThrow(
      /unregistered sender/,
    );
    await expect(handle?.({ sender }, { reason: "because" })).rejects.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });

  it("by default reloads the sender on the next turn — the answer goes first — and never a destroyed one", async () => {
    const live = fakeSender(5);
    const gone = fakeSender(6);
    gone.isDestroyed.mockReturnValue(true);
    registerRendererReplace({ owns: () => true } as never);
    const handle = handlers.get(IPC_CHANNELS.rendererReplace);
    await handle?.({ sender: live }, { reason: "plugin-kinds" });
    await handle?.({ sender: gone }, { reason: "plugin-kinds" });
    expect(live.reload).not.toHaveBeenCalled(); // not yet: the answer is sent first
    await new Promise((resolve) => setImmediate(resolve));
    expect(live.reload).toHaveBeenCalledTimes(1);
    expect(gone.reload).not.toHaveBeenCalled();
  });
});

describe("the renderer replacement door, the page's half (DK-9)", () => {
  const replaceRenderer = (): ((reason: unknown) => Promise<unknown>) => {
    if (stub.exposed === undefined) throw new Error("preload exposed nothing");
    return stub.exposed["replaceRenderer"] as (reason: unknown) => Promise<unknown>;
  };

  it("crosses with its reason, by the channel, and hands back main's answer", async () => {
    stub.invoke.mockResolvedValueOnce({ replacing: true });
    await expect(replaceRenderer()("plugin-kinds")).resolves.toEqual({ replacing: true });
    expect(stub.invoke).toHaveBeenCalledWith(IPC_CHANNELS.rendererReplace, {
      reason: "plugin-kinds",
    });
  });

  it("a reason it does not know throws at the call site, never crossing; a malformed answer never reaches the page", async () => {
    stub.invoke.mockClear();
    await expect(replaceRenderer()("because")).rejects.toThrow();
    expect(stub.invoke).not.toHaveBeenCalled();
    stub.invoke.mockResolvedValueOnce({ replacing: false });
    await expect(replaceRenderer()("plugin-kinds")).rejects.toThrow();
  });
});
