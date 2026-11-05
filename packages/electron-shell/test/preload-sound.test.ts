import { IPC_CHANNELS } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// SD-2 — the window's sound doors as the PAGE sees them (DESIGN.md §14, §8 "Settings → Sound"): attention is sent
// only when it parses, a Play asks its own channel with the cue alone, and main's answers are parsed before they reach
// the page. Captured from `exposeInMainWorld`, preload-browser-data's pattern.

const stub = vi.hoisted(() => ({
  exposed: undefined as Record<string, unknown> | undefined,
  invoke: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  contextBridge: {
    exposeInMainWorld: (_key: string, value: Record<string, unknown>) => {
      stub.exposed = value;
    },
  },
  ipcRenderer: { on: vi.fn(), off: vi.fn(), send: stub.send, invoke: stub.invoke },
  sharedTexture: { setSharedTextureReceiver: vi.fn() },
}));
vi.mock("@vibecook/ghosttea-electron/preload", () => ({
  forwardGhostteaRendererPorts: vi.fn(),
}));

await import("../src/preload/index");

type Doors = Record<string, (...args: unknown[]) => unknown>;
const sound = (): Doors => {
  const exposed = stub.exposed;
  if (exposed === undefined) throw new Error("preload exposed nothing");
  return exposed.sound as Doors;
};

beforeEach(() => {
  stub.invoke.mockReset();
  stub.send.mockReset();
});

describe("the preload's sound doors (SD-2)", () => {
  it("exposes exactly three", () => {
    expect(Object.keys(sound())).toEqual(["attention", "preview", "state"]);
  });
  it("sends attention that parses, and nothing else", () => {
    sound().attention!({ focused: "pty-a", places: { "pty-a": 0.3 } });
    sound().attention!({ focused: null, places: { a: 4 } });
    sound().attention!("pty-a");
    expect(stub.send.mock.calls).toEqual([
      [IPC_CHANNELS.soundAttention, { focused: "pty-a", places: { "pty-a": 0.3 } }],
    ]);
  });
  it("asks a Play with the cue alone, and refuses the mark before it crosses", async () => {
    stub.invoke.mockResolvedValueOnce({ played: true });
    await expect(sound().preview!("done")).resolves.toEqual({ played: true });
    expect(stub.invoke.mock.calls).toEqual([[IPC_CHANNELS.soundPreview, { cue: "done" }]]);
    await expect(Promise.resolve().then(() => sound().preview!("mark"))).rejects.toThrow();
    expect(stub.invoke).toHaveBeenCalledTimes(1);
  });
  it("never hands the page a malformed answer from main", async () => {
    for (const answer of [undefined, { played: "yes" }, { played: false, reason: "quiet" }]) {
      stub.invoke.mockResolvedValueOnce(answer);
      await expect(sound().preview!("done"), JSON.stringify(answer)).rejects.toThrow();
    }
    stub.invoke.mockResolvedValueOnce("ready");
    await expect(sound().state!()).resolves.toBe("ready");
    stub.invoke.mockResolvedValueOnce("loud");
    await expect(sound().state!()).rejects.toThrow();
  });
});
