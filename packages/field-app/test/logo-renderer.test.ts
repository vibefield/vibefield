import { afterEach, describe, expect, it, vi } from "vitest";
import { LogoRenderer } from "../../design-kit/src/logo/renderer";

afterEach(() => vi.unstubAllGlobals());

describe("logo GPU initialization cancellation", () => {
  it("does not allocate a device when an unmounted view is still awaiting its adapter", async () => {
    let resolveAdapter!: (adapter: unknown) => void;
    const adapter = { requestDevice: vi.fn() };
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter: () =>
          new Promise((resolve) => {
            resolveAdapter = resolve;
          }),
      },
    });
    const startup = new AbortController();
    const pending = LogoRenderer.create(document.createElement("canvas"), vi.fn(), startup.signal);
    const rejection = expect(pending).rejects.toThrow();
    startup.abort();
    resolveAdapter(adapter);
    await rejection;
    expect(adapter.requestDevice).not.toHaveBeenCalled();
  });

  it("destroys a late device without taking over a replacement view's canvas", async () => {
    let resolveDevice!: (device: unknown) => void;
    const device = { destroy: vi.fn() };
    const requested = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDevice = resolve;
        }),
    );
    vi.stubGlobal("navigator", {
      gpu: { requestAdapter: async () => ({ requestDevice: requested }) },
    });
    const canvas = document.createElement("canvas");
    const context = vi.spyOn(canvas, "getContext");
    const startup = new AbortController();
    const pending = LogoRenderer.create(canvas, vi.fn(), startup.signal);
    const rejection = expect(pending).rejects.toThrow();
    await Promise.resolve();
    expect(requested).toHaveBeenCalledOnce();
    startup.abort();
    resolveDevice(device);
    await rejection;
    expect(device.destroy).toHaveBeenCalledOnce();
    expect(context).not.toHaveBeenCalled();
  });
});
