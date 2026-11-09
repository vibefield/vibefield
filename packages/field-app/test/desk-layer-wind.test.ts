/**
 * Q4 (James, 2026-10-28, the housekeeping page) — THE THUMBNAIL'S WAIT (field/desk/desk-layer.ts; DESIGN.md §6 M5): the explorer's
 * owed still waits for the desk's rest (desk-stills.ts), and the desk rests when ICE's ambient wind has blown out, so the field's
 * layer asks ICE for a shorter wind than its 20 s default. Its 8 s is the time the desk already takes a pointer to have stopped
 * (`PEERS.idleMs`, §8 "Peers on the mat"). ICE's `deskLayer` is watched: what the field asks of it is the row
 * (pegboard-layer.test.ts's pattern); that the desk then rests by it is smoke:canvas's REST row, on the real wind.
 */
import type { CanvasEngine } from "@vibecook/ice";
import { describe, expect, it, vi } from "vitest";

const asked: unknown[] = [];
vi.mock("@vibecook/ice/desk", async (original) => ({
  ...(await original<typeof import("@vibecook/ice/desk")>()),
  deskLayer: (opts: unknown) => {
    asked.push(opts);
    return () => ({});
  },
}));

const engine = { docs: {} } as unknown as CanvasEngine;

describe("Q4 — the wind the field's desk asks ICE for", () => {
  it("blows 8 s after the last touch: the idle the desk already rules for a pointer", async () => {
    const { fieldDeskLayer } = await import("../src/field/desk/desk-layer");
    const { PEERS } = await import("../src/field/desk/peers/peers-model");
    fieldDeskLayer({ engine, theme: "light" });
    const opts = asked.at(-1) as { ambientIdleMs?: number };
    expect(opts.ambientIdleMs).toBe(8_000);
    expect(opts.ambientIdleMs).toBe(PEERS.idleMs);
  });

  it("keeps ICE's `idle` policy: the window shortens, the mode is not asked for", async () => {
    const { fieldDeskLayer } = await import("../src/field/desk/desk-layer");
    fieldDeskLayer({ engine, theme: "light" });
    expect((asked.at(-1) as { ambient?: unknown }).ambient).toBeUndefined();
  });
});
