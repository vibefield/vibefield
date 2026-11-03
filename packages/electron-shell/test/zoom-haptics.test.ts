import { describe, expect, it, vi } from "vitest";
import { createDesktopHaptics, createZoomHapticDoor } from "../src/main/zoom-haptics";

describe("native zoom feedback door", () => {
  it("accepts only the focused owned main frame, no payload, at a bounded rate", () => {
    const perform = vi.fn();
    let time = 0;
    let focused = true;
    const door = createZoomHapticDoor<number>({
      owns: (sender) => sender === 7,
      focused: () => focused,
      perform,
      now: () => time,
    });
    door(99, true, 0);
    door(7, false, 0);
    door(7, true, 1);
    focused = false;
    door(7, true, 0);
    expect(perform).not.toHaveBeenCalled();
    focused = true;
    door(7, true, 0);
    door(7, true, 0);
    time = 79;
    door(7, true, 0);
    expect(perform).toHaveBeenCalledOnce();
    time = 80;
    door(7, true, 0);
    expect(perform).toHaveBeenCalledTimes(2);
  });

  it("loads the native adapter once and asks AppKit for each pulse", () => {
    const alignment = vi.fn(() => true);
    const load = vi.fn(() => ({ alignment }));
    const tick = createDesktopHaptics({
      platform: "darwin",
      path: "/app/bin/desktop-haptics.node",
      load,
    });
    tick();
    tick();
    expect(load).toHaveBeenCalledOnce();
    expect(alignment).toHaveBeenCalledTimes(2);
  });

  it("is a quiet no-op on unsupported hosts", () => {
    const load = vi.fn();
    createDesktopHaptics({ platform: "linux", path: "/unused", load })();
    createDesktopHaptics({ platform: "darwin", path: null, load })();
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    () => {
      throw new Error("missing binary");
    },
    () => ({}),
    () => ({
      alignment() {
        throw new Error("unavailable");
      },
    }),
  ])("contains an unavailable adapter and reports it once", (load) => {
    const onError = vi.fn();
    const tick = createDesktopHaptics({
      platform: "darwin",
      path: "/app/bin/desktop-haptics.node",
      load,
      onError,
    });
    expect(() => {
      tick();
      tick();
    }).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });
});
