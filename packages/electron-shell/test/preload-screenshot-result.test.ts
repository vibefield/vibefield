import { describe, expect, it, vi } from "vitest";
import { PreloadScreenshotResultBridge } from "../src/preload/screenshot-result";

const ok = {
  status: "ok",
  path: "/var/folders/ab/T/vibefield-still-0001.png",
  width: 1200,
  height: 800,
  scale: 2,
  displayId: 1,
  bounds: { x: 100, y: 80, width: 600, height: 400 },
} as const;

describe("PreloadScreenshotResultBridge (SNAP-3)", () => {
  it("retains only the latest validated result until the renderer subscribes", () => {
    const rejected = vi.fn();
    const bridge = new PreloadScreenshotResultBridge(rejected);
    bridge.accept({ status: "cancel" });
    bridge.accept(ok);
    const handler = vi.fn();
    bridge.subscribe(handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(ok);
    expect(rejected).not.toHaveBeenCalled();
  });

  it("delivers live results and stops after the matching subscription is disposed", () => {
    const bridge = new PreloadScreenshotResultBridge(vi.fn());
    const handler = vi.fn();
    const dispose = bridge.subscribe(handler);
    bridge.accept(ok);
    dispose();
    bridge.accept({ status: "error", code: "busy", message: "one at a time" });
    expect(handler).toHaveBeenCalledTimes(1);

    const next = vi.fn();
    bridge.subscribe(next);
    expect(next).toHaveBeenCalledWith({ status: "error", code: "busy", message: "one at a time" });
  });

  it("rejects a malformed result at the boundary and delivers nothing for it", () => {
    const rejected = vi.fn();
    const bridge = new PreloadScreenshotResultBridge(rejected);
    const handler = vi.fn();
    bridge.subscribe(handler);
    bridge.accept({ status: "ok", path: "" });
    bridge.accept({ status: "error", code: "imaginary", message: "" });
    expect(rejected).toHaveBeenCalledTimes(2);
    expect(handler).not.toHaveBeenCalled();
  });
});
