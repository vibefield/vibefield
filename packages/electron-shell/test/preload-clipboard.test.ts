import { IPC_CHANNELS, SHELL_CLIPBOARD } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Item 102 — the clipboard read door as the PAGE sees it, and main's wiring of it:
// one door that asks its own channel with nothing, a refusal that rejects in words
// (so the terminal pastes nothing rather than part), an answer outside the contract
// that never reaches the page, and a stranger that never reads. Captured from
// `exposeInMainWorld`, preload-browser-data's pattern. HN-5 — the picture write beside
// it: the bytes, the words and their bounds checked before anything crosses, a refusal
// rejected in words (so the copy deals no card), and main's half writing both in one
// write for a registered window, asking no focus (LC-18, LC-19).

const handlers = new Map<string, (event: unknown, raw?: unknown, text?: unknown) => unknown>();
const stub = vi.hoisted(() => ({
  exposed: undefined as Record<string, unknown> | undefined,
  invoke: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, raw?: unknown, text?: unknown) => unknown,
    ) => {
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

const { registerClipboardRead, registerClipboardWriteImage } = await import("../src/main/ipc");
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
  it("exposes two doors; the read asks its channel with nothing and answers the text", async () => {
    expect(Object.keys(clipboard())).toEqual(["readText", "writeImage"]);
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

/** A PNG's signature: what crosses is the page's own bytes, never JSON. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("the preload's clipboard picture door (HN-5)", () => {
  it("sends the PNG's bytes, and the words beside them only when there are any", async () => {
    stub.invoke.mockResolvedValueOnce({ status: "written" });
    await expect(clipboard().writeImage!(PNG)).resolves.toBeUndefined();
    stub.invoke.mockResolvedValueOnce({ status: "written" });
    await expect(clipboard().writeImage!(PNG, "Ship it.")).resolves.toBeUndefined();
    // the picture's bytes as they are, never JSON; no words, no second argument at all
    expect(stub.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.clipboardWriteImage, PNG],
      [IPC_CHANNELS.clipboardWriteImage, PNG, "Ship it."],
    ]);
    expect(stub.invoke.mock.calls[0]?.[1]).toBe(PNG);
  });

  it("checks the bytes, the words and both bounds before sending", async () => {
    const past = SHELL_CLIPBOARD.WRITE_IMAGE_MAX_BYTES + 1;
    await expect(clipboard().writeImage!(new Uint8Array(past))).rejects.toThrow(
      `the picture holds ${past} bytes; the clipboard takes at most`,
    );
    const over = SHELL_CLIPBOARD.WRITE_TEXT_MAX_BYTES + 1;
    await expect(clipboard().writeImage!(PNG, "x".repeat(over))).rejects.toThrow(
      `the words hold ${over} bytes; the clipboard takes at most`,
    );
    for (const raw of ["png", [0x89, 0x50], new Uint16Array(4), null])
      await expect(clipboard().writeImage!(raw)).rejects.toThrow(/PNG's bytes/);
    await expect(clipboard().writeImage!(PNG, 42)).rejects.toThrow(/are text/);
    expect(stub.invoke).not.toHaveBeenCalled();
  });

  it("a refusal rejects in words, and a malformed answer never reaches the page", async () => {
    stub.invoke.mockResolvedValueOnce({ status: "refused", reason: "not-an-image", bytes: 8 });
    await expect(clipboard().writeImage!(PNG)).rejects.toThrow("the picture could not be read");
    stub.invoke.mockResolvedValueOnce({ status: "refused", reason: "too-large", bytes: 9_000_000 });
    await expect(clipboard().writeImage!(PNG)).rejects.toThrow(/holds 9000000 bytes/);
    for (const answer of [
      undefined,
      "written",
      { status: "wrote" },
      { status: "refused" },
      // LC-18: no focus is asked of a write, so this is no answer of main's
      { status: "refused", reason: "unfocused" },
    ]) {
      stub.invoke.mockResolvedValueOnce(answer);
      await expect(clipboard().writeImage!(PNG), JSON.stringify(answer)).rejects.toThrow();
    }
  });
});

describe("the clipboard picture door, main's half (HN-5)", () => {
  it("writes the picture and the words for a registered window, asking no focus", async () => {
    const sender = { id: 5 };
    const write = vi.fn();
    registerClipboardWriteImage({ owns: (s: unknown) => s === sender } as never, {
      decode: (png) => ({ png }),
      write,
    });
    const handle = handlers.get(IPC_CHANNELS.clipboardWriteImage);
    expect(await handle?.({ sender }, PNG)).toEqual({ status: "written" });
    expect(await handle?.({ sender }, PNG, "two objects")).toEqual({ status: "written" });
    // one call each, one item: the picture, and the words beside it when there are any
    expect(write.mock.calls).toEqual([
      [{ image: { png: PNG } }],
      [{ image: { png: PNG }, text: "two objects" }],
    ]);
  });

  it("refuses a stranger without decoding, and logs it", async () => {
    const sender = { id: 6 };
    const decode = vi.fn((png: Uint8Array) => ({ png }));
    const write = vi.fn();
    const warn = vi.fn();
    registerClipboardWriteImage(
      { owns: (s: unknown) => s === sender } as never,
      { decode, write },
      { warn } as never,
    );
    const handle = handlers.get(IPC_CHANNELS.clipboardWriteImage);
    await expect(handle?.({ sender: { id: 9 } }, PNG)).rejects.toThrow(/unregistered sender/);
    expect(decode).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ["desktop.ipc.clipboard_write_refused", { webContentsId: 9, reason: "unregistered" }],
    ]);
  });
});
