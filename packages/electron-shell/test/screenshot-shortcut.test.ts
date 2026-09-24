import { describe, expect, it, vi } from "vitest";
import { ScreenshotShortcutController } from "../src/main/screenshot-shortcut";

function fixture(helperAvailable = true, succeeds = true) {
  let press = () => {};
  const port = {
    register: vi.fn((_accelerator: string, callback: () => void) => {
      press = callback;
      return succeeds;
    }),
    unregister: vi.fn(),
  };
  const capture = vi.fn();
  const onChanged = vi.fn();
  const controller = new ScreenshotShortcutController({
    port,
    platform: "darwin",
    helperAvailable,
    capture,
    onChanged,
  });
  return { controller, port, capture, onChanged, press: () => press() };
}

describe("the app-lifetime screenshot shortcut", () => {
  it("delivers ⌃⌘A through the OS without a focused window or display dependency", () => {
    const f = fixture();
    f.controller.setEnabled(true);
    expect(f.port.register).toHaveBeenCalledWith("Control+Command+A", expect.any(Function));
    expect(f.controller.current().status).toBe("registered");
    f.press();
    expect(f.capture).toHaveBeenCalledTimes(1);
    f.controller.setEnabled(true);
    expect(f.port.register).toHaveBeenCalledTimes(1);
  });

  it("releases only its own chord on preference changes and teardown", () => {
    const f = fixture();
    f.controller.setEnabled(true);
    f.controller.setEnabled(false);
    expect(f.port.unregister).toHaveBeenCalledWith("Control+Command+A");
    f.press();
    expect(f.capture).not.toHaveBeenCalled();
    f.controller.setEnabled(true);
    f.press();
    expect(f.capture).toHaveBeenCalledTimes(1);
    f.controller.dispose();
    f.controller.dispose();
    f.controller.setEnabled(true);
    f.press();
    expect(f.capture).toHaveBeenCalledTimes(1);
    expect(f.port.unregister).toHaveBeenCalledTimes(2);
  });

  it("reports a conflict and permits an explicit off/on retry", () => {
    const f = fixture(true, false);
    f.controller.setEnabled(true);
    expect(f.controller.current()).toMatchObject({
      status: "conflict",
      message: expect.stringContaining("Another app"),
    });
    f.press();
    expect(f.capture).not.toHaveBeenCalled();
    f.controller.setEnabled(false);
    expect(f.port.unregister).not.toHaveBeenCalled();
    f.port.register.mockReturnValue(true);
    f.controller.setEnabled(true);
    expect(f.controller.current().status).toBe("registered");
  });

  it("does not reserve a global chord when the optional helper is missing", () => {
    const f = fixture(false);
    f.controller.setEnabled(true);
    expect(f.controller.current().status).toBe("unavailable");
    expect(f.port.register).not.toHaveBeenCalled();
    f.controller.dispose();
    expect(f.port.unregister).not.toHaveBeenCalled();
  });

  it("contains OS registration failures", () => {
    const f = fixture();
    f.port.register.mockImplementation(() => {
      throw new Error("OS refused");
    });
    f.controller.setEnabled(true);
    expect(f.controller.current().status).toBe("conflict");
  });
});
