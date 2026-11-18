import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnedSimulatorDevices } from "../src/main/live-surfaces/owned-simulator-devices";
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
