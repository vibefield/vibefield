import { describe, expect, it, vi } from "vitest";
import { PreloadDesktopStateBridge } from "../src/preload/desktop-state";

const available = {
  tray: {
    availability: "available",
    placement: "visible",
    backgroundShellEffective: true,
    issue: null,
  },
} as const;

describe("PreloadDesktopStateBridge", () => {
  it("retains validated latest state until the renderer subscribes", () => {
    const rejected = vi.fn();
    const bridge = new PreloadDesktopStateBridge(rejected);
    bridge.accept(available);
    const handler = vi.fn();
    bridge.subscribe(handler);
    expect(handler).toHaveBeenCalledWith(available);
    expect(rejected).not.toHaveBeenCalled();
  });

  it("rejects malformed state without replacing the last valid snapshot", () => {
    const rejected = vi.fn();
    const bridge = new PreloadDesktopStateBridge(rejected);
    bridge.accept(available);
    bridge.accept({
      tray: {
        availability: "imaginary",
        placement: "visible",
        backgroundShellEffective: true,
        issue: null,
      },
    });
    const handler = vi.fn();
    bridge.subscribe(handler);
    expect(rejected).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(available);
  });
});
