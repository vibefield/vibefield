import { Camera, createCanvasEngine, Viewport } from "@vibecook/ice";
import { describe, expect, it, vi } from "vitest";
import { bindDeskZoomFeedback, createZoomFeedback } from "../src/field/desk/zoom-feedback";

describe("zoom feedback", () => {
  it("ticks on landmarks in either direction without snapping the camera", () => {
    const pulse = vi.fn();
    const step = createZoomFeedback(pulse);
    step(0.9, 1.1, 0);
    step(1.1, 0.9, 120);
    step(0.9, 0.4, 240);
    expect(pulse).toHaveBeenCalledTimes(3);
  });

  it("does not buzz on jitter; rearms only after leaving the landmark", () => {
    const pulse = vi.fn();
    const step = createZoomFeedback(pulse);
    step(0.99, 1.01, 0);
    for (let n = 1; n < 20; n++) step(n % 2 ? 1.01 : 0.99, n % 2 ? 0.99 : 1.01, n * 120);
    expect(pulse).toHaveBeenCalledOnce();
    step(1.05, 0.99, 3000);
    expect(pulse).toHaveBeenCalledTimes(2);
  });

  it("coalesces large jumps, rate limits pulses, and never queues a late pulse", () => {
    const pulse = vi.fn();
    const step = createZoomFeedback(pulse);
    step(0.1, 5, 0);
    step(5, 0.1, 20);
    step(0.1, 0.11, 500);
    expect(pulse).toHaveBeenCalledOnce();
    step(0.11, 0.3, 600);
    expect(pulse).toHaveBeenCalledTimes(2);
  });

  it("ignores invalid input and changes that do not cross a scale landmark", () => {
    const pulse = vi.fn();
    const step = createZoomFeedback(pulse);
    step(0.6, 0.8, 0);
    step(1, 1, 200);
    step(0, 2, 400);
    step(Number.NaN, 2, 600);
    step(0.5, Number.POSITIVE_INFINITY, 800);
    expect(pulse).not.toHaveBeenCalled();
  });

  it("wires actual camera gestures, stays silent on camera restoration, and detaches on unmount", () => {
    const ce = createCanvasEngine({
      settings: { gestures: { wheel: "pan", wheelZoomCurve: "exponential" } },
    });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
    const pulse = vi.fn();
    const off = bindDeskZoomFeedback(ce, pulse);
    let time = 0;
    const frame = () => {
      time += 16;
      ce.step(time);
    };
    const restore = () => ce.world.setResource(Camera, { x: 0, y: 0, zoom: 0.9, gesturing: false });
    const zoom = () => {
      ce.stack.queue.enqueue({
        kind: "wheel",
        pointerId: "mouse",
        device: "mouse",
        screenX: 400,
        screenY: 300,
        buttons: 0,
        mods: { shift: false, ctrl: true, alt: false, meta: false, space: false },
        wheel: { dx: 0, dy: 0, pinch: -100 },
      });
      frame();
    };
    try {
      restore();
      frame();
      expect(pulse).not.toHaveBeenCalled();
      zoom();
      expect(pulse).toHaveBeenCalledOnce();
      for (let n = 0; n < 20; n++) frame();
      expect(pulse).toHaveBeenCalledOnce();
      off();
      restore();
      zoom();
      expect(pulse).toHaveBeenCalledOnce();
    } finally {
      off();
      ce.dispose();
    }
  });
});
