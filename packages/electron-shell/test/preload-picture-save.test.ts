import { IPC_CHANNELS, SHELL_PICTURE_SAVE } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Item 578 — the picture save door as the PAGE sees it, and main's wiring of it (DESIGN.md §8 "The bar grown":
// Download…). One door that asks its own channel with the picture's bytes and nothing else, so no name and no path
// can come from the page; a picture past the bound never crosses; an answer outside the contract never reaches the
// page; and a stranger opens no panel. Captured from `exposeInMainWorld`, preload-clipboard's pattern.

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

const { registerPictureSave } = await import("../src/main/ipc");
await import("../src/preload/index");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Doors = Record<string, (...args: unknown[]) => Promise<unknown>>;
const pictures = (): Doors => {
  const exposed = stub.exposed;
  if (exposed === undefined) throw new Error("preload exposed nothing");
  return exposed.pictures as Doors;
};

beforeEach(() => {
  stub.invoke.mockReset();
});

describe("the preload's picture save door (item 578)", () => {
  it("exposes one door; it asks its channel with the bytes alone and answers main's answer", async () => {
    expect(Object.keys(pictures())).toEqual(["save"]);
    stub.invoke.mockResolvedValueOnce({ status: "saved", folder: "Downloads" });
    await expect(pictures().save!(PNG)).resolves.toEqual({ status: "saved", folder: "Downloads" });
    stub.invoke.mockResolvedValueOnce({ status: "cancelled" });
    await expect(pictures().save!(PNG)).resolves.toEqual({ status: "cancelled" });
    stub.invoke.mockResolvedValueOnce({ status: "refused", reason: "failed" });
    await expect(pictures().save!(PNG)).resolves.toEqual({ status: "refused", reason: "failed" });
    expect(stub.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.pictureSave, PNG],
      [IPC_CHANNELS.pictureSave, PNG],
      [IPC_CHANNELS.pictureSave, PNG],
    ]);
  });

  it("sends nothing that is not a picture's bytes, and nothing past the bound", async () => {
    for (const raw of [undefined, "picture", { bytes: PNG }, Array.from(PNG)]) {
      await expect(pictures().save!(raw)).rejects.toThrow(/picture's bytes/);
    }
    const past = SHELL_PICTURE_SAVE.MAX_BYTES + 1;
    await expect(pictures().save!(new Uint8Array(past))).resolves.toEqual({
      status: "refused",
      reason: "too-large",
      bytes: past,
    });
    expect(stub.invoke).not.toHaveBeenCalled();
  });

  it("an answer outside the contract never reaches the page", async () => {
    for (const answer of [
      undefined,
      "/home/person/Pictures/x.png",
      { status: "saved" },
      { status: "saved", folder: "Pictures/Trip" },
      { status: "refused", reason: "because" },
    ]) {
      stub.invoke.mockResolvedValueOnce(answer);
      await expect(pictures().save!(PNG), JSON.stringify(answer)).rejects.toThrow();
    }
  });
});

describe("the picture save door, main's half (item 578)", () => {
  const audit = async () => undefined;
  const operationId = () => "op";
  const today = () => "2026-11-19";

  it("saves for a registered window, through the panel it is given", async () => {
    const sender = { id: 5 };
    const write = vi.fn(async () => undefined);
    const choose = vi.fn(async () => "/home/person/Downloads/Picture 2026-11-19.png");
    registerPictureSave({ owns: (s: unknown) => s === sender } as never, {
      choose,
      write,
      today,
      audit,
      operationId,
    });
    const handle = handlers.get(IPC_CHANNELS.pictureSave);
    expect(await handle?.({ sender }, PNG)).toEqual({ status: "saved", folder: "Downloads" });
    expect(choose.mock.calls).toEqual([
      [sender, { name: "Picture 2026-11-19.png", folder: null, extensions: ["png"] }],
    ]);
    expect(write.mock.calls).toEqual([
      ["/home/person/Downloads/Picture 2026-11-19.png", PNG, "replace"],
    ]);
  });

  it("refuses a stranger without a panel, and logs each refusal with no path", async () => {
    const sender = { id: 6 };
    const choose = vi.fn(async () => "/home/person/Downloads/x.png");
    // a file error's message carries the path it failed at: the log is told its code
    const denied = new Error("EACCES: permission denied, open '/home/person/Downloads/x.png'");
    const write = vi.fn(async () => {
      throw Object.assign(denied, { code: "EACCES" });
    });
    const warn = vi.fn();
    registerPictureSave(
      { owns: (s: unknown) => s === sender } as never,
      { choose, write, today, audit, operationId },
      { warn } as never,
    );
    const handle = handlers.get(IPC_CHANNELS.pictureSave);
    await expect(handle?.({ sender: { id: 9 } }, PNG)).rejects.toThrow(/unregistered sender/);
    expect(choose).not.toHaveBeenCalled();
    expect(await handle?.({ sender }, PNG)).toEqual({ status: "refused", reason: "failed" });
    expect(warn.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ["desktop.ipc.picture_save_refused", { webContentsId: 9, reason: "unregistered" }],
      [
        "desktop.ipc.picture_save_refused",
        {
          webContentsId: 6,
          reason: "failed",
          bytes: PNG.byteLength,
          error: "EACCES",
        },
      ],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("/home");
  });
});
