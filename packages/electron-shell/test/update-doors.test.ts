import { IPC_CHANNELS, type UpdateCheckResult, type UpdateMoveResult } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";

// WP12d (L3c-i; build-wp12-updater.md §13 C1, the PM's ruling 2026-10-15 18:17Z) — the updater's host doors, main side.
// The Settings card reaches main's ONE updater here (an updater must work with fieldd broken, EDP §11.3): the same
// registered-sender gate as every door, every payload parsed by its contract, and no door carrying a path or a URL.
// AU-7 — the ninth: Move to Applications, which takes nothing (main knows where the app runs) and answers the quit
// gate's decision or a refusal.

const handlers = new Map<string, (event: unknown, raw?: unknown) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, raw?: unknown) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));
const { registerUpdateDoors } = await import("../src/main/ipc");

const DOORS = [
  IPC_CHANNELS.updateCheck,
  IPC_CHANNELS.updateSetEnabled,
  IPC_CHANNELS.updateSetChannel,
  IPC_CHANNELS.updateDecline,
  IPC_CHANNELS.updatePrepareRestart,
  IPC_CHANNELS.updateConfirmRestart,
  IPC_CHANNELS.updateDoctor,
  IPC_CHANNELS.updateDownload,
  IPC_CHANNELS.updateMoveToApplications,
];

function wire(answers: { check?: unknown; move?: unknown } = {}) {
  handlers.clear();
  const calls: unknown[][] = [];
  const window = { id: 7 };
  const stranger = { id: 99 };
  registerUpdateDoors({ owns: (sender: unknown) => sender === window } as never, {
    check: async () => {
      calls.push(["check"]);
      return (answers.check ?? { outcome: "up-to-date" }) as UpdateCheckResult;
    },
    setEnabled: (enabled) => calls.push(["setEnabled", enabled]),
    setChannel: (channel) => calls.push(["setChannel", channel]),
    decline: (version) => calls.push(["decline", version]),
    download: async (version) => {
      calls.push(["download", version]);
      return version === "1.2.0"
        ? { ok: true }
        : {
            ok: false,
            reason: "not-available",
            words: { message: "VibeField didn't download the update", detail: "Nothing changed." },
          };
    },
    prepareRestart: async () => ({
      ok: true,
      token: "t".repeat(32),
      version: "1.2.0",
      keepsSessions: false,
      sessions: [{ sessionId: "s1", title: "zsh", cwd: "/Users/me" }],
      expiresAt: 1,
    }),
    confirmRestart: async (token) => {
      calls.push(["confirm", token]);
      return { ok: false, reason: "expired" };
    },
    doctor: () => ["updates: idle · channel stable"],
    moveToApplications: async () => {
      calls.push(["move"]);
      return (answers.move ?? { ok: true, outcome: "proceed" }) as UpdateMoveResult;
    },
  });
  const call = (channel: string, sender: unknown, raw?: unknown) =>
    Promise.resolve(handlers.get(channel)!({ sender }, raw));
  return { calls, window, stranger, call };
}

describe("the updater's host doors (C1)", () => {
  it("registers exactly the nine doors", () => {
    wire();
    expect([...handlers.keys()].sort()).toEqual([...DOORS].sort());
  });

  it("refuses every door to a sender this shell did not register", async () => {
    const { stranger, call, calls } = wire();
    for (const door of DOORS)
      await expect(call(door, stranger, {}), door).rejects.toThrow(/unregistered sender/);
    expect(calls).toEqual([]);
  });

  it("parses each payload by its contract: a malformed one never reaches the updater", async () => {
    const { window, call, calls } = wire();
    await expect(
      call(IPC_CHANNELS.updateSetChannel, window, { channel: "weekly" }),
    ).rejects.toThrow();
    await expect(call(IPC_CHANNELS.updateSetEnabled, window, { enabled: "yes" })).rejects.toThrow();
    await expect(call(IPC_CHANNELS.updateDecline, window, { version: "" })).rejects.toThrow();
    // AU-1 — the download door takes one version, and nothing else
    await expect(call(IPC_CHANNELS.updateDownload, window, { version: "" })).rejects.toThrow();
    await expect(
      call(IPC_CHANNELS.updateDownload, window, { version: "1.2.0", path: "/tmp/x.zip" }),
    ).rejects.toThrow();
    await expect(
      call(IPC_CHANNELS.updateConfirmRestart, window, { token: "short" }),
    ).rejects.toThrow();
    // a door's extra key is refused too (the requests are strict: nothing rides along, no path, no URL)
    await expect(
      call(IPC_CHANNELS.updateSetChannel, window, { channel: "beta", url: "https://x" }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("well-formed calls reach the updater, and its answers cross parsed", async () => {
    const { window, call, calls } = wire();
    // AU-1 (LC-5) — the check answers when it settles
    expect(await call(IPC_CHANNELS.updateCheck, window)).toEqual({ outcome: "up-to-date" });
    await call(IPC_CHANNELS.updateSetEnabled, window, { enabled: false });
    await call(IPC_CHANNELS.updateSetChannel, window, { channel: "beta" });
    await call(IPC_CHANNELS.updateDecline, window, { version: "1.2.0" });
    expect(await call(IPC_CHANNELS.updateDownload, window, { version: "1.2.0" })).toEqual({
      ok: true,
    });
    expect(await call(IPC_CHANNELS.updateDownload, window, { version: "1.2.1" })).toEqual({
      ok: false,
      reason: "not-available",
      words: { message: "VibeField didn't download the update", detail: "Nothing changed." },
    });
    expect(await call(IPC_CHANNELS.updatePrepareRestart, window)).toMatchObject({
      ok: true,
      version: "1.2.0",
      sessions: [{ sessionId: "s1" }],
    });
    expect(
      await call(IPC_CHANNELS.updateConfirmRestart, window, { token: "t".repeat(32) }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(await call(IPC_CHANNELS.updateDoctor, window)).toEqual({
      lines: ["updates: idle · channel stable"],
    });
    expect(calls).toEqual([
      ["check"],
      ["setEnabled", false],
      ["setChannel", "beta"],
      ["decline", "1.2.0"],
      ["download", "1.2.0"],
      ["download", "1.2.1"],
      ["confirm", "t".repeat(32)],
    ]);
  });

  it("AU-1 — a check answer main's contract does not take never crosses", async () => {
    const { window, call } = wire({ check: { outcome: "maybe" } });
    await expect(call(IPC_CHANNELS.updateCheck, window)).rejects.toThrow();
  });

  it("AU-7 — the move answers the quit gate's decision, or a refusal, parsed", async () => {
    const proceed = wire();
    expect(await proceed.call(IPC_CHANNELS.updateMoveToApplications, proceed.window)).toEqual({
      ok: true,
      outcome: "proceed",
    });
    expect(proceed.calls).toEqual([["move"]]);
    const busy = wire({ move: { ok: false, reason: "busy" } });
    expect(await busy.call(IPC_CHANNELS.updateMoveToApplications, busy.window)).toEqual({
      ok: false,
      reason: "busy",
    });
    // an outcome the contract does not name never crosses
    const moved = wire({ move: { ok: true, outcome: "moved" } });
    await expect(moved.call(IPC_CHANNELS.updateMoveToApplications, moved.window)).rejects.toThrow();
  });
});
