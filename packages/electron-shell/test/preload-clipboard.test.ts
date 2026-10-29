import { IPC_CHANNELS } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Item 102 — the clipboard read door as the PAGE sees it, and main's wiring of it:
// one door that asks its own channel with nothing, a refusal that rejects in words
// (so the terminal pastes nothing rather than part), an answer outside the contract
// that never reaches the page, and a stranger that never reads. Captured from
// `exposeInMainWorld`, preload-browser-data's pattern.

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

const { registerClipboardRead } = await import("../src/main/ipc");
await import("../src/preload/index");

type Doors = Record<string, (...args: unknown[]) => Promise<unknown>>;
const clipboard = (): Doors => {
  const exposed = stub.exposed;
  if (exposed === undefined) throw new Error("preload exposed nothing");
  return exposed.clipboard as Doors;
};

beforeEach(() => {
  stub.invoke.mockReset();
});

describe("the preload's clipboard read door (item 102)", () => {
  it("exposes exactly one door, which asks its own channel with nothing and answers the text", async () => {
    expect(Object.keys(clipboard())).toEqual(["readText"]);
    stub.invoke.mockResolvedValueOnce({ status: "read", text: "ls -la\n" });
    await expect(clipboard().readText!()).resolves.toBe("ls -la\n");
    expect(stub.invoke.mock.calls).toEqual([[IPC_CHANNELS.clipboardRead, {}]]);
  });

  it("a refusal rejects in words, and a malformed answer never reaches the page", async () => {
    stub.invoke.mockResolvedValueOnce({ status: "refused", reason: "unfocused" });
    await expect(clipboard().readText!()).rejects.toThrow(/focused window/);
    stub.invoke.mockResolvedValueOnce({ status: "refused", reason: "too-large", bytes: 5_000_000 });
    await expect(clipboard().readText!()).rejects.toThrow(/5000000 bytes/);
    for (const answer of [
      undefined,
      "ls",
      { status: "read" },
      { status: "read", text: 7 },
      { status: "refused", reason: "because" },
    ]) {
      stub.invoke.mockResolvedValueOnce(answer);
      await expect(clipboard().readText!(), JSON.stringify(answer)).rejects.toThrow();
    }
  });
});

describe("the clipboard read door, main's half (item 102)", () => {
  const audit = async () => undefined;
  const operationId = () => "op";

  it("reads for a registered, focused window", async () => {
    const sender = { id: 3 };
    const read = vi.fn(() => "pwd\n");
    registerClipboardRead({ owns: (s: unknown) => s === sender } as never, {
      focused: () => true,
      read,
      audit,
      operationId,
    });
    const handle = handlers.get(IPC_CHANNELS.clipboardRead);
    expect(await handle?.({ sender }, {})).toEqual({ status: "read", text: "pwd\n" });
    expect(read).toHaveBeenCalledOnce();
  });

  it("refuses a stranger and an unfocused window without reading; the refusal is logged", async () => {
    const sender = { id: 4 };
    const read = vi.fn(() => "secret\n");
    const warn = vi.fn();
    let focused = true;
    registerClipboardRead(
      { owns: (s: unknown) => s === sender } as never,
      { focused: () => focused, read, audit, operationId },
      { warn } as never,
    );
    const handle = handlers.get(IPC_CHANNELS.clipboardRead);
    await expect(handle?.({ sender: { id: 9 } }, {})).rejects.toThrow(/unregistered sender/);
    focused = false;
    await expect(handle?.({ sender }, {})).resolves.toEqual({
      status: "refused",
      reason: "unfocused",
    });
    expect(read).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((call) => call[2])).toEqual([
      { webContentsId: 9, reason: "unregistered" },
      { webContentsId: 4, reason: "unfocused" },
    ]);
  });
});
