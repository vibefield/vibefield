import { describe, expect, it, vi } from "vitest";
import { PreloadZoomActBridge } from "../src/preload/view";

// One Frame FR-4 (3b): the View menu's Actual Size, Zoom In and Zoom Out reach
// the page as ACTS through this bridge, for the head to answer on Canvas. They
// are presses, not state: validated at the boundary like every main→renderer
// payload, delivered to whoever listens, and never held for a late listener.

describe("PreloadZoomActBridge (One Frame FR-4, 3b)", () => {
  it("delivers each validated act to the head that listens", () => {
    const rejected = vi.fn();
    const bridge = new PreloadZoomActBridge(rejected);
    const heard: string[] = [];
    bridge.subscribe((act) => heard.push(act));
    bridge.accept({ act: "in" });
    bridge.accept({ act: "out" });
    bridge.accept({ act: "actual" });
    expect(heard).toEqual(["in", "out", "actual"]);
    expect(rejected).not.toHaveBeenCalled();
  });

  it("drops an act nobody listens for: a press is never replayed later", () => {
    const bridge = new PreloadZoomActBridge(vi.fn());
    bridge.accept({ act: "in" });
    const late = vi.fn();
    bridge.subscribe(late);
    expect(late).not.toHaveBeenCalled();
  });

  it("stops delivering once its subscription is disposed", () => {
    const bridge = new PreloadZoomActBridge(vi.fn());
    const handler = vi.fn();
    const dispose = bridge.subscribe(handler);
    bridge.accept({ act: "in" });
    dispose();
    bridge.accept({ act: "out" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("in");
  });

  it("rejects a malformed act at the boundary and delivers nothing for it", () => {
    const rejected = vi.fn();
    const bridge = new PreloadZoomActBridge(rejected);
    const handler = vi.fn();
    bridge.subscribe(handler);
    // A level is the page's to know, never main's; ⇧1's fit has no menu item.
    bridge.accept({ zoom: 1.25 });
    bridge.accept({ act: "fit" });
    bridge.accept(null);
    expect(rejected).toHaveBeenCalledTimes(3);
    expect(handler).not.toHaveBeenCalled();
  });
});
