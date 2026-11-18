import { IPC_CHANNELS, type SimulatorSetupTarget } from "@vibefield/contracts";
import { beforeEach, expect, it, vi } from "vitest";

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

const { registerSimulatorSetup } = await import("../src/main/ipc");
await import("../src/preload/index");
beforeEach(() => stub.invoke.mockReset());

it("validates setup responses and exposes two fixed destinations", async () => {
  const bridge = stub.exposed!.simulatorSetup as {
    check(): Promise<unknown>;
    open(target: SimulatorSetupTarget): Promise<void>;
  };
  stub.invoke.mockResolvedValueOnce({ stage: "ready", configurations: [] });
  await expect(bridge.check()).rejects.toThrow();
  stub.invoke.mockResolvedValueOnce({ stage: "install-runtime", xcodeVersion: "26.6" });
  expect(await bridge.check()).toEqual({ stage: "install-runtime", xcodeVersion: "26.6" });
  await expect(bridge.open("other" as SimulatorSetupTarget)).rejects.toThrow();
  await bridge.open("xcode");
  expect(stub.invoke.mock.calls).toEqual([
    [IPC_CHANNELS.simulatorSetupCheck],
    [IPC_CHANNELS.simulatorSetupCheck],
    [IPC_CHANNELS.simulatorSetupOpen, "xcode"],
  ]);
});

it("accepts only the product main frame and opens an app only while focused", async () => {
  const sender = { mainFrame: {}, isFocused: vi.fn(() => true) };
  const api = { check: vi.fn(async () => ({ stage: "install-xcode" as const })), open: vi.fn() };
  registerSimulatorSetup({ owns: (s: unknown) => s === sender } as never, api);
  const read = handlers.get(IPC_CHANNELS.simulatorSetupCheck)!;
  const open = handlers.get(IPC_CHANNELS.simulatorSetupOpen)!;
  const event = { sender, senderFrame: sender.mainFrame };
  expect(await read(event)).toEqual({ stage: "install-xcode" });
  expect(() => read({ ...event, sender: {} })).toThrow();
  expect(() => open({ ...event, senderFrame: {} }, "xcode")).toThrow();
  expect(() => open(event, "/Applications/Other.app")).toThrow();
  sender.isFocused.mockReturnValue(false);
  expect(() => open(event, "app-store")).toThrow();
  expect(api.open).not.toHaveBeenCalled();
  sender.isFocused.mockReturnValue(true);
  await open(event, "app-store");
  expect(api.open).toHaveBeenCalledWith("app-store");
});
