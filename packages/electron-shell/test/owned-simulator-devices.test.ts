import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileOwnedDeviceLedger,
  OwnedSimulatorDevices,
} from "../src/main/live-surfaces/owned-simulator-devices";
import type { SimctlDevice, SimctlSnapshot } from "../src/main/live-surfaces/simctl";

const deviceType = "com.apple.CoreSimulator.SimDeviceType.iPhone-11";
const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
const older = "com.apple.CoreSimulator.SimRuntime.iOS-18-6";
const pane = { instance: "phone-a", deviceType, runtime };

function host() {
  const guests = new Map<string, SimctlDevice>();
  const control = {
    invalidate: () => {},
    list: async (): Promise<SimctlSnapshot> => ({
      deviceTypeNames: new Map([[deviceType, "iPhone 11"]]),
      runtimes: [runtime, older].map((identifier) => ({
        identifier,
        name: identifier,
        version: identifier,
        supportedDeviceTypes: new Set([deviceType]),
      })),
      devices: [...guests.values()],
    }),
    create: vi.fn(async (name: string, type: string, os: string) => {
      const udid = `test-guest-${guests.size}`;
      guests.set(udid, { udid, name, deviceType: type, runtime: os, state: "Shutdown" });
      return udid;
    }),
    boot: vi.fn(async (id: string) => {
      guests.set(id, { ...guests.get(id)!, state: "Booted" });
    }),
    shutdown: vi.fn(async (id: string) => {
      guests.set(id, { ...guests.get(id)!, state: "Shutdown" });
    }),
  };
  return { control, guests, owned: new OwnedSimulatorDevices(control, 1000) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("the lifetime of a pane-owned iOS configuration", () => {
  it("coalesces simultaneous creation, reserves separate versions, and reuses their saved devices", async () => {
    const { owned, control } = host();
    const a = owned.acquire(pane),
      b = owned.acquire(pane);
    const [first, same] = await Promise.all([a.start(), b.start()]);
    expect(first).toBe(same);
    const old = owned.acquire({ ...pane, runtime: older });
    const oldId = await old.start();
    expect(first).not.toBe(oldId);
    expect(control.create).toHaveBeenCalledTimes(2);
    a.release();
    await vi.advanceTimersByTimeAsync(1200);
    expect(control.shutdown).not.toHaveBeenCalled();
    b.release();
    await vi.advanceTimersByTimeAsync(500);
    const again = owned.acquire(pane);
    await vi.advanceTimersByTimeAsync(600);
    expect(control.shutdown).not.toHaveBeenCalled();
    expect(await again.start()).toBe(first);
    again.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.shutdown.mock.calls).toEqual([[first]]);
    const cold = owned.acquire(pane);
    expect(await cold.start()).toBe(first);
    expect(control.create).toHaveBeenCalledTimes(2);
    await owned.dispose();
    expect(control.shutdown.mock.calls.map(([id]) => id).sort()).toEqual(
      [first, first, oldId].sort(),
    );
  });

  it("leaves an already running device alone, even when its name matches the requested configuration", async () => {
    const { owned, control } = host();
    const external = new OwnedSimulatorDevices(control);
    const udid = await external.acquire(pane).start();
    const current = owned.acquire(pane);
    expect(await current.start()).toBe(udid);
    current.release();
    await owned.dispose();
    expect(control.shutdown).not.toHaveBeenCalled();
    await external.dispose();
    expect(control.shutdown.mock.calls).toEqual([[udid]]);
  });

  it("finishes shutdown on quit even if a boot is still returning", async () => {
    const { owned, control } = host();
    let booted!: () => void;
    control.boot.mockImplementation(
      async () =>
        new Promise<void>((resolve) => {
          booted = resolve;
        }),
    );
    const lease = owned.acquire(pane);
    const start = lease.start();
    await vi.advanceTimersByTimeAsync(0);
    lease.release();
    const closed = owned.dispose();
    booted();
    const id = await start;
    await closed;
    expect(control.shutdown.mock.calls).toEqual([[id]]);
  });
});

// Item 568 (2026-11-19): a device this shell booted and left running when it ended without its quit (a crash, a Force
// Quit) is found Booted at its next start. The shell's own record of what it booted tells that device from one another
// VibeField is running, which stays that one's (the row above).
describe("a device this shell booted before it ended without its quit", () => {
  function ledger() {
    const booted = new Set<string>();
    return {
      booted,
      has: (udid: string) => booted.has(udid),
      add: (udid: string) => {
        booted.add(udid);
      },
      remove: (udid: string) => {
        booted.delete(udid);
      },
    };
  }

  it("is its own again: shut down once its last pane lets it go, and gone from the record", async () => {
    const { control, guests } = host();
    const record = ledger();
    const ended = new OwnedSimulatorDevices(control, 1000, undefined, record);
    const udid = await ended.acquire(pane).start();
    expect(record.booted.has(udid)).toBe(true);
    // the shell ends without its quit: nothing is released or disposed, and the device runs on
    expect(guests.get(udid)?.state).toBe("Booted");

    const next = new OwnedSimulatorDevices(control, 1000, undefined, record);
    const lease = next.acquire(pane);
    expect(await lease.start()).toBe(udid);
    expect(control.boot).toHaveBeenCalledTimes(1);
    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(control.shutdown.mock.calls).toEqual([[udid]]);
    expect(record.booted.has(udid)).toBe(false);
  });

  it("is shut down at quit too", async () => {
    const { control } = host();
    const record = ledger();
    const ended = new OwnedSimulatorDevices(control, 1000, undefined, record);
    const udid = await ended.acquire(pane).start();
    const next = new OwnedSimulatorDevices(control, 1000, undefined, record);
    expect(await next.acquire(pane).start()).toBe(udid);
    await next.dispose();
    expect(control.shutdown.mock.calls).toEqual([[udid]]);
    expect(record.booted.size).toBe(0);
  });

  it("is never another VibeField's: a running device its record does not hold runs on", async () => {
    const { control } = host();
    const other = new OwnedSimulatorDevices(control, 1000, undefined, ledger());
    const udid = await other.acquire(pane).start();
    const record = ledger();
    const mine = new OwnedSimulatorDevices(control, 1000, undefined, record);
    const lease = mine.acquire(pane);
    expect(await lease.start()).toBe(udid);
    lease.release();
    await mine.dispose();
    expect(control.shutdown).not.toHaveBeenCalled();
    expect(record.booted.size).toBe(0);
  });
});

describe("the record of the simulators this shell booted, on disk", () => {
  it("keeps what it is told across a start, writes whole files, and reads a broken one as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-owned-devices-"));
    try {
      const file = join(dir, "simulator", "booted.json");
      const said: string[] = [];
      const first = fileOwnedDeviceLedger(file, (message) => said.push(message));
      expect(first.has("A1B2C3D4-0000")).toBe(false);
      first.add("A1B2C3D4-0000");
      first.add("E5F6A7B8-1111");
      first.remove("E5F6A7B8-1111");
      const again = fileOwnedDeviceLedger(file, (message) => said.push(message));
      expect(again.has("A1B2C3D4-0000")).toBe(true);
      expect(again.has("E5F6A7B8-1111")).toBe(false);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ v: 1, booted: ["A1B2C3D4-0000"] });
      expect(readdirSync(dirname(file))).toEqual(["booted.json"]);
      expect(said).toEqual([]);

      writeFileSync(file, "{ not a record");
      const broken = fileOwnedDeviceLedger(file, (message) => said.push(message));
      expect(broken.has("A1B2C3D4-0000")).toBe(false);
      expect(said).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
