// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DoorClient } from "../src/godview/monitor/doors";
import {
  godviewReplayRequested,
  instrumentDevicesPort,
  instrumentModelClient,
  resetGodviewDoorInstrumentsForTest,
} from "../src/godview/monitor/perf/door-instruments";
import { activeProbe } from "../src/godview/monitor/perf/godview-perf-probe";
import {
  godviewPerfLab,
  godviewPerfLabRequested,
  installGodviewPerfLab,
  resetGodviewPerfLabForTest,
} from "../src/godview/monitor/perf/lab-bridge";
import type { DevicesPort } from "../src/godview/monitor/remote-door";

afterEach(() => {
  resetGodviewDoorInstrumentsForTest();
  resetGodviewPerfLabForTest();
});

describe("the dormant model lab", () => {
  it("leaves the shipping client and roster unchanged without an explicit replay", () => {
    const client: DoorClient = {
      request: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => ({ snapshot: undefined, unsubscribe: () => undefined })),
    };
    const roster: DevicesPort = { subscribe: vi.fn(() => () => undefined) };
    expect(instrumentModelClient(client, "?godviewMarkers=1")).toBe(client);
    expect(instrumentDevicesPort(roster, "?godviewMarkers=1")).toBe(roster);
    expect(godviewPerfLabRequested("?godviewMarkers=1")).toBe(false);
    expect(godviewReplayRequested("?godviewReplay=1")).toBe(true);
    expect(godviewPerfLab()).toBeNull();
    expect(activeProbe()).toBeNull();
    expect(window.__vfGodviewPerf).toBeUndefined();
    expect(window.__vfGodviewReplay).toBeUndefined();
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(roster.subscribe).not.toHaveBeenCalled();
  });

  it("installs once and supplies the corpus roster to early and late subscribers", () => {
    const lab = installGodviewPerfLab();
    expect(installGodviewPerfLab()).toBe(lab);
    expect(window.__vfGodviewPerf).toBe(lab.probe);
    expect(window.__vfGodviewReplay).toBe(lab.player);
    expect(activeProbe()).toBe(lab.probe);
    const real: DevicesPort = { subscribe: vi.fn(() => () => undefined) };
    const roster = instrumentDevicesPort(real, "?godviewReplay=1");
    const early = vi.fn();
    const off = roster.subscribe(early);
    expect(early).not.toHaveBeenCalled();
    lab.player.load("n=3,duration=600,seed=2,markerQuietMs=50");
    expect(early).toHaveBeenCalledExactlyOnceWith(lab.player.roster());
    const late = vi.fn();
    const offLate = roster.subscribe(late);
    expect(late).toHaveBeenCalledExactlyOnceWith(lab.player.roster());
    off();
    lab.player.clear();
    expect(early).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenLastCalledWith([]);
    offLate();
    expect(real.subscribe).not.toHaveBeenCalled();
  });
});
