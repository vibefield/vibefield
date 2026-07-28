import { describe, expect, it, vi } from "vitest";
import { PreloadShellCommandBridge } from "../src/preload/shell-commands";

describe("PreloadShellCommandBridge", () => {
  it("retains only the latest validated command until the renderer subscribes", () => {
    const rejected = vi.fn();
    const bridge = new PreloadShellCommandBridge(rejected);
    bridge.accept({ command: "open-settings" });
    bridge.accept({ command: "open-diagnostics" });
    const handler = vi.fn();
    bridge.subscribe(handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("open-diagnostics");
    expect(rejected).not.toHaveBeenCalled();
  });

  it("delivers live commands and stops after the matching subscription is disposed", () => {
    const bridge = new PreloadShellCommandBridge(vi.fn());
    const handler = vi.fn();
    const dispose = bridge.subscribe(handler);
    bridge.accept({ command: "open-settings" });
    dispose();
    bridge.accept({ command: "open-diagnostics" });
    expect(handler).toHaveBeenCalledTimes(1);

    const next = vi.fn();
    bridge.subscribe(next);
    expect(next).toHaveBeenCalledWith("open-diagnostics");
  });

  it("rejects malformed commands without forwarding or buffering them", () => {
    const rejected = vi.fn();
    const bridge = new PreloadShellCommandBridge(rejected);
    bridge.accept({ command: "execute-arbitrary-code" });
    const handler = vi.fn();
    bridge.subscribe(handler);
    expect(rejected).toHaveBeenCalledWith(1);
    expect(handler).not.toHaveBeenCalled();
  });
});
