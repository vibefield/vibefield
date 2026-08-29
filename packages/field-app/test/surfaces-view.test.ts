import type { LiveSurfaceFrameMetadataV1 } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import type { SurfaceDemandRequest } from "../src/surfaces/pool/demand";
import type {
  SurfaceHandle,
  SurfaceHandleState,
  SurfaceHandleStatus,
} from "../src/surfaces/pool/surface-pool";
import { demandFromElementFacts } from "../src/surfaces/view/element-demand";
import {
  createSurfaceViewController,
  type SurfaceFrameScheduler,
} from "../src/surfaces/view/view-controller";

type Frame = { close(): void };

function facts(overrides: Partial<Parameters<typeof demandFromElementFacts>[0]> = {}) {
  return {
    elementVisible: true,
    pageVisible: true,
    cssWidth: 640,
    cssHeight: 480,
    devicePixelRatio: 2,
    interactive: false,
    ...overrides,
  };
}

describe("demandFromElementFacts", () => {
  it("maps apparent device-pixel size onto the reference fps buckets", () => {
    expect(demandFromElementFacts(facts({ cssWidth: 1280, cssHeight: 800 })).targetFps).toBe(60);
    expect(demandFromElementFacts(facts({ cssWidth: 320, cssHeight: 240 })).targetFps).toBe(30);
    expect(
      demandFromElementFacts(facts({ cssWidth: 120, cssHeight: 90, devicePixelRatio: 2 }))
        .targetFps,
    ).toBe(15);
    expect(
      demandFromElementFacts(facts({ cssWidth: 60, cssHeight: 40, devicePixelRatio: 1 })).targetFps,
    ).toBe(5);
  });

  it("folds any invisibility to paused at zero fps (PF6 at the source)", () => {
    for (const dark of [
      facts({ elementVisible: false }),
      facts({ pageVisible: false }),
      facts({ cssWidth: 0 }),
    ]) {
      const intent = demandFromElementFacts(dark);
      expect(intent.mode).toBe("paused");
      expect(intent.targetFps).toBe(0);
    }
  });

  it("carries interactivity as fps 60 + raised priority and rounds the raster to device pixels", () => {
    const intent = demandFromElementFacts(
      facts({ cssWidth: 100.4, cssHeight: 50.6, interactive: true }),
    );
    expect(intent).toMatchObject({
      mode: "live",
      targetFps: 60,
      priority: 80,
      interactive: true,
      targetRasterSize: { width: 201, height: 101 },
    });
    const runaway = demandFromElementFacts(facts({ cssWidth: 100_000, devicePixelRatio: 10 }));
    expect(runaway.targetRasterSize?.width).toBe(4096);
  });
});

interface FakePresentation {
  presentLatestVia(consumer: (frame: Frame, metadata: LiveSurfaceFrameMetadataV1) => boolean): void;
  calls: number;
}

function fakeHandle(initial: SurfaceHandleStatus = "live") {
  const listeners = new Set<(state: SurfaceHandleState<Frame>) => void>();
  const demands: SurfaceDemandRequest[] = [];
  const presentation: FakePresentation = {
    calls: 0,
    presentLatestVia(consumer) {
      presentation.calls += 1;
      consumer({ close: () => undefined }, {
        geometry: { visibleRect: { x: 0, y: 0, width: 8, height: 8 } },
      } as never);
    },
  };
  let status: SurfaceHandleStatus = initial;
  const state = (): SurfaceHandleState<Frame> => ({
    status,
    presentation: (status === "live" ? (presentation as never) : null) as never,
    browser: null,
    error: null,
  });
  const handle: SurfaceHandle<Frame> = {
    key: "k",
    get state() {
      return state();
    },
    get status() {
      return status;
    },
    get presentation() {
      return state().presentation;
    },
    get browser() {
      return null;
    },
    get error() {
      return null;
    },
    onState(listener) {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
    setDemand(demand) {
      demands.push(demand);
    },
    sendInput: () => false,
    navigate: () => false,
    retry: vi.fn(),
    release: vi.fn(),
  };
  return {
    handle,
    demands,
    presentation,
    setStatus(next: SurfaceHandleStatus) {
      status = next;
      for (const listener of [...listeners]) listener(state());
    },
  };
}

function manualScheduler() {
  const pending: Array<() => void> = [];
  const scheduler: SurfaceFrameScheduler = {
    schedule(tick) {
      pending.push(tick);
      return () => {
        const index = pending.indexOf(tick);
        if (index >= 0) pending.splice(index, 1);
      };
    },
  };
  return {
    scheduler,
    tick() {
      const next = pending.shift();
      next?.();
    },
    get pendingCount() {
      return pending.length;
    },
  };
}

describe("createSurfaceViewController", () => {
  it("ticks the presentation only while live and visible, and stops at the source when hidden", () => {
    const { handle, demands, presentation } = fakeHandle();
    const clock = manualScheduler();
    const controller = createSurfaceViewController<Frame>({
      handle,
      sink: { draw: () => true },
      scheduler: clock.scheduler,
      initialFacts: facts(),
    });

    expect(clock.pendingCount).toBe(1);
    clock.tick();
    expect(presentation.calls).toBe(1);
    expect(clock.pendingCount).toBe(1);

    controller.updateFacts({ elementVisible: false });
    expect(clock.pendingCount).toBe(0);
    const paused = demands.at(-1);
    expect(paused).toMatchObject({ mode: "paused", targetFps: 0 });

    controller.updateFacts({ elementVisible: true });
    expect(clock.pendingCount).toBe(1);
    expect(demands.at(-1)).toMatchObject({ mode: "live" });
    controller.dispose();
    expect(clock.pendingCount).toBe(0);
    expect(handle.release).not.toHaveBeenCalled();
  });

  it("declares the measured demand once on mount and again only when the fold moves", () => {
    const { handle, demands } = fakeHandle();
    const clock = manualScheduler();
    const controller = createSurfaceViewController<Frame>({
      handle,
      sink: { draw: () => true },
      scheduler: clock.scheduler,
      initialFacts: facts({ cssWidth: 640, cssHeight: 480 }),
    });
    const initialCount = demands.length;
    expect(initialCount).toBe(1);
    controller.updateFacts({ cssWidth: 640, cssHeight: 480 });
    expect(demands.length).toBe(initialCount);
    controller.updateFacts({ cssWidth: 1400 });
    expect(demands.length).toBe(initialCount + 1);
    controller.dispose();
  });

  it("stops ticking when the handle is lost and resumes on live", () => {
    const fixture = fakeHandle();
    const clock = manualScheduler();
    createSurfaceViewController<Frame>({
      handle: fixture.handle,
      sink: { draw: () => true },
      scheduler: clock.scheduler,
      initialFacts: facts(),
    });
    expect(clock.pendingCount).toBe(1);
    fixture.setStatus("lost");
    expect(clock.pendingCount).toBe(0);
    fixture.setStatus("live");
    expect(clock.pendingCount).toBe(1);
  });
});
