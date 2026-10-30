import { IPC_CHANNELS } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// WP12d (L3c-i; §13 C1) — the updater's doors as the PAGE sees them: the narrow preload set, exactly these eight (AU-1
// adds the download), each payload parsed both ways — a malformed renderer→main payload throws at its call site instead
// of crossing, and a malformed main→renderer answer never reaches the page. Captured from `exposeInMainWorld`,
// preload-users' pattern.

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

type Doors = Record<string, (...args: unknown[]) => Promise<unknown>>;
const update = (): Doors => {
  const exposed = stub.exposed;
  if (exposed === undefined) throw new Error("preload exposed nothing");
  return exposed.update as Doors;
};

beforeEach(() => {
  stub.invoke.mockReset();
});

describe("the preload's update doors (C1)", () => {
  it("exposes exactly the eight doors — no path, no URL, no raw IPC", () => {
    expect(Object.keys(update()).sort()).toEqual(
      [
        "check",
        "confirmRestart",
        "decline",
        "doctor",
        "download",
        "prepareRestart",
        "setChannel",
        "setEnabled",
      ].sort(),
    );
  });

  it("sends each well-formed payload on its own channel", async () => {
    // AU-1 — the check and the download answer; the switch, the channel and the decline do not
    const answers: Record<string, unknown> = {
      [IPC_CHANNELS.updateCheck]: { outcome: "found", version: "1.2.0" },
      [IPC_CHANNELS.updateDownload]: { ok: true },
    };
    stub.invoke.mockImplementation(async (channel: string) => answers[channel]);
    expect(await update().check!()).toEqual({ outcome: "found", version: "1.2.0" });
    await update().setEnabled!(false);
    await update().setChannel!("stable");
    await update().decline!("1.2.0");
    expect(await update().download!("1.2.0")).toEqual({ ok: true });
    expect(stub.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.updateCheck],
      [IPC_CHANNELS.updateSetEnabled, { enabled: false }],
      [IPC_CHANNELS.updateSetChannel, { channel: "stable" }],
      [IPC_CHANNELS.updateDecline, { version: "1.2.0" }],
      [IPC_CHANNELS.updateDownload, { version: "1.2.0" }],
    ]);
  });

  it("a malformed renderer payload throws at its call site and never crosses", async () => {
    await expect(update().setChannel!("weekly")).rejects.toThrow();
    await expect(update().setEnabled!("yes")).rejects.toThrow();
    await expect(update().confirmRestart!("short")).rejects.toThrow();
    await expect(update().download!("")).rejects.toThrow();
    expect(stub.invoke).not.toHaveBeenCalled();
  });

  it("a malformed answer from main never reaches the page", async () => {
    // AU-1 — a check outcome the contract does not name, and a download refusal with no reason
    stub.invoke.mockResolvedValueOnce({ outcome: "maybe" });
    await expect(update().check!()).rejects.toThrow();
    stub.invoke.mockResolvedValueOnce({ ok: false });
    await expect(update().download!("1.2.0")).rejects.toThrow();
    stub.invoke.mockResolvedValueOnce({ ok: true, token: "t".repeat(32) }); // no version, no sessions
    await expect(update().prepareRestart!()).rejects.toThrow();
    stub.invoke.mockResolvedValueOnce({ lines: "not a list" });
    await expect(update().doctor!()).rejects.toThrow();
    stub.invoke.mockResolvedValueOnce({
      ok: false,
      reason: "policy-unreachable",
      words: { message: "VibeField didn't install the update", detail: "offline" },
    });
    expect(await update().prepareRestart!()).toMatchObject({
      ok: false,
      reason: "policy-unreachable",
    });
  });
});
