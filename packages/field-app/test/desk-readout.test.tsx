/**
 * DK-3 — Settings → Advanced → Developer gains the DESK's numbers (the orchestrator's ruling 2): the
 * mounted desk's `status()` (and its missing kinds), `perf().boot` and `perf().frames`, `submits()`
 * and the GPU memory ledger — read off the desk the Canvas stage published, numbers only, no panel
 * of ICE's. Nothing mounted, it says so.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { type MountedDesk, publishDesk } from "../src/field/desk/desk-door";
import { DeskReadout, deskFacts, deskReadoutLines } from "../src/panels/DeskReadout";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeDesk(over: { faults?: number; memory?: number } = {}): MountedDesk {
  const handle = {
    status: () => ({
      state: "ready",
      ...(over.faults === undefined
        ? {}
        : {
            faults: Array.from({ length: over.faults }, (_, i) => ({ kind: `k${i}`, reason: "x" })),
          }),
    }),
    perf: () => ({ frames: 450, boot: { device: 11.6, compiled: 70.7, presented: 128.2 } }),
    submits: () => ({ total: () => 467 }),
    gpuMemory: () =>
      over.memory === undefined ? undefined : { read: () => ({ total: over.memory }) },
  };
  return { handle, engine: {}, generation: 1, mount: 0, theme: "light" } as unknown as MountedDesk;
}

describe("the desk's readout in Settings → Advanced → Developer", () => {
  it("reads status, boot, frames, submits and the GPU memory off the mounted desk", () => {
    const facts = deskFacts(fakeDesk({ memory: 40 * 1024 * 1024 }));
    expect(facts).toEqual({
      state: "ready",
      faults: 0,
      boot: { device: 11.6, compiled: 70.7, presented: 128.2 },
      frames: 450,
      submits: 467,
      memory: 40 * 1024 * 1024,
    });
    expect(deskReadoutLines(facts)).toEqual([
      "ready",
      "boot · device 12 ms · compiled 71 ms · presented 128 ms",
      "450 frames · 467 submits · 40.0 MB GPU",
    ]);
  });

  it("names the kinds gone missing, and says no desk when none is mounted", () => {
    expect(deskReadoutLines(deskFacts(fakeDesk({ faults: 2 })))[0]).toBe("ready · 2 kinds missing");
    expect(deskReadoutLines(null)).toEqual(["No desk is mounted"]);
  });

  it("follows the desk the stage publishes", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<DeskReadout />));
    expect(host.textContent).toContain("No desk is mounted");
    let unpublish: () => void = () => undefined;
    act(() => {
      unpublish = publishDesk(fakeDesk());
    });
    expect(host.textContent).toContain("450 frames · 467 submits");
    act(() => unpublish());
    expect(host.textContent).toContain("No desk is mounted");
    act(() => root.unmount());
  });
});
