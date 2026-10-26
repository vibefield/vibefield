import { AgentModelMeshFrame, AgentModelMeshOpen } from "@vibefield/contracts";
import { spendWorld } from "@vibefield/puppeteer-views";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THIS_MAC } from "../src/design-system/godview-profiles-fixtures";
import { spendDoor } from "../src/design-system/godview-spend-fixtures";

// MV-7 — the catalog's spend afternoon is said as the model board says rows:
// the views package's own world, parsed as the window's replica parses an open
// and a frame, this desktop first, nothing the window joins on the wire, and
// the board saying it again each second until the window lets go.
describe("MV-7 — the catalog's spend afternoon, as the model board says it", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens with the views package's world: this desktop first, its priced runs with their series, nothing the window joins", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(Date.parse("2026-10-08T16:00:00.000Z"));
    const door = spendDoor();
    const frames: unknown[] = [];
    const opened = await door.model?.subscribe((frame) => frames.push(frame));
    expect(opened).toBeDefined();
    const open = AgentModelMeshOpen.parse(opened?.snapshot);
    expect(open.devices[0]?.device).toBe(THIS_MAC.id);

    // the same rows the views package hands its own lab at this moment
    const world = spendWorld(Date.now());
    const said = open.devices.flatMap((device) => device.snapshot?.rows ?? []);
    expect(new Set(said.map((row) => row.runtimeRunId))).toEqual(
      new Set(world.map((row) => row.id)),
    );
    for (const device of open.devices) {
      expect(device.state).toBe("live");
      for (const row of device.snapshot?.rows ?? []) {
        const wire = row.monitorRow as Record<string, unknown> & {
          device: Record<string, unknown>;
          project: Record<string, unknown>;
        };
        for (const joined of ["colour", "active", "receded", "attachment"]) {
          expect(wire, `${row.runtimeRunId} carries ${joined}`).not.toHaveProperty(joined);
        }
        expect(wire.device).not.toHaveProperty("self");
        expect(wire.device["id"]).toBe(device.device);
        // a peer's row carries no colour sequence (M16)
        if (device.device !== THIS_MAC.id) expect(wire.project).not.toHaveProperty("seq");
      }
    }
    // the lines: this desktop's priced runs carry the ten-minute series
    const here = open.devices[0]?.snapshot?.rows ?? [];
    const lines = here.filter((row) => row.monitorRow?.cost?.series !== undefined);
    expect(lines.length).toBeGreaterThan(0);
    for (const row of lines) expect(row.monitorRow?.cost?.series?.steps).toHaveLength(20);

    // a second on, the board says each desktop again, as a frame the replica reads
    vi.advanceTimersByTime(1_000);
    expect(frames).toHaveLength(open.devices.length);
    for (const frame of frames) expect(AgentModelMeshFrame.safeParse(frame).success).toBe(true);
    // and once the window lets go, it stops
    opened?.unsubscribe();
    vi.advanceTimersByTime(5_000);
    expect(frames).toHaveLength(open.devices.length);
  });
});
