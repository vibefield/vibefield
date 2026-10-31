import { beforeEach, describe, expect, it, vi } from "vitest";

// HN-6 — a file another app handed over (a paste's, a drop's), named by its path as the PAGE asks
// for it: the preload's own read through Electron's `webUtils` (Electron 43 gives a File no
// `path`), a contextBridge member and no IPC channel; "" (a File not on disk) and a throw (what is
// not a File) are null. Captured from `exposeInMainWorld`, preload-browser-data's pattern.

const stub = vi.hoisted(() => ({
  exposed: undefined as Record<string, unknown> | undefined,
  invoke: vi.fn(),
  send: vi.fn(),
  getPathForFile: vi.fn<(file: unknown) => string>(),
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
    send: stub.send,
    invoke: stub.invoke,
  },
  sharedTexture: {
    setSharedTextureReceiver: vi.fn(),
  },
  webUtils: {
    getPathForFile: stub.getPathForFile,
  },
}));

await import("../src/preload/index");

/** The page's door, as the bridge exposed it. */
const pathForFile = (file: unknown): unknown => {
  const exposed = stub.exposed;
  if (exposed === undefined) throw new Error("preload exposed nothing");
  return (exposed.pathForFile as (file: unknown) => unknown)(file);
};

beforeEach(() => {
  stub.getPathForFile.mockReset();
  stub.invoke.mockReset();
  stub.send.mockReset();
});

describe("the preload's file door (HN-6)", () => {
  it("names a file another app handed over by its path on disk, read in the preload: no channel is crossed", () => {
    const file = new File(["# Plan"], "plan.md", { type: "text/markdown" });
    stub.getPathForFile.mockReturnValueOnce("/Users/me/vibe-field/docs/plan.md");
    expect(pathForFile(file)).toBe("/Users/me/vibe-field/docs/plan.md");
    expect(stub.getPathForFile).toHaveBeenCalledWith(file);
    expect(stub.invoke).not.toHaveBeenCalled();
    expect(stub.send).not.toHaveBeenCalled();
  });

  it("answers null for a File not on disk (Electron's empty path) and for what is not a File (its throw)", () => {
    stub.getPathForFile.mockReturnValueOnce("");
    expect(pathForFile(new File(["made here"], "made.txt"))).toBeNull();
    stub.getPathForFile.mockImplementationOnce(() => {
      throw new TypeError("parameter 1 is not of type 'File'");
    });
    expect(pathForFile({ name: "forged.txt" })).toBeNull();
  });
});
