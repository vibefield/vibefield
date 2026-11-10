import { IPC_CHANNELS } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Item 280 — the window's bootstrap as the PAGE sees it. Electron rethrows a handler's refusal under its own
// wrapping and the class's name ("Error invoking remote method '<channel>': SupervisorError: <message>", Electron
// #24427), and the boot logs what it is handed. So the bootstrap goes through the stripper the users' doors use,
// and the renderer's log line is main's own words. A person reads none of it: a start that failed says one
// sentence (DESIGN.md §9, VibeField's insides). `electron` is mocked as preload-users.test.ts mocks it.

const stub = vi.hoisted(() => ({
  exposed: undefined as Record<string, unknown> | undefined,
  invoke: vi.fn(),
}));

vi.mock("electron", () => ({
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

await import("../src/preload/index");

const getConnection = (): (() => Promise<unknown>) => {
  if (stub.exposed === undefined) throw new Error("preload exposed nothing");
  return stub.exposed.getConnection as () => Promise<unknown>;
};

const CONNECTION = {
  port: 4242,
  token: "abc",
  rendererParticipant: {
    participantId: "renderer:window-1",
    incarnation: "renderer:window-1:document-1",
  },
};

const refused = (thrown: string): Error =>
  new Error(`Error invoking remote method '${IPC_CHANNELS.windowBootstrap}': ${thrown}`);

beforeEach(() => {
  stub.invoke.mockReset();
});

describe("the window's bootstrap (item 280)", () => {
  it("asks main on its channel alone and hands back the connection it parsed", async () => {
    stub.invoke.mockResolvedValueOnce(CONNECTION);
    await expect(getConnection()()).resolves.toMatchObject({ port: 4242, token: "abc" });
    expect(stub.invoke).toHaveBeenCalledTimes(1);
    expect(stub.invoke.mock.calls[0]).toEqual([IPC_CHANNELS.windowBootstrap]);
  });

  it("hands a refusal back in main's own words for the renderer's log, whatever class threw (no view draws it)", async () => {
    stub.invoke.mockRejectedValueOnce(
      refused("SupervisorError: fieldd exited before readiness (code 1, signal null)"),
    );
    await expect(getConnection()()).rejects.toMatchObject({
      message: "fieldd exited before readiness (code 1, signal null)",
    });

    stub.invoke.mockRejectedValueOnce(refused("Error: fieldd was not started"));
    await expect(getConnection()()).rejects.toMatchObject({ message: "fieldd was not started" });
  });
});
