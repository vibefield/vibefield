/**
 * DK-5 — the relaunch heal's two rules (field/desk/desk-gpu.ts): which failure is a boot whose
 * device never arrived — the one a retry may heal — and the smoke's door that forces the boot's
 * first adapter request to answer null.
 */
import { afterEach, describe, expect, it } from "vitest";
import { deskGpu, deviceNeverArrived, REFUSE_FIRST_DEVICE } from "../src/field/desk/desk-gpu";

const REFUSED = "no desk — the adapter, the device or the pipelines were refused";

describe("a boot whose device never arrived", () => {
  it("is a failure for want of an adapter or a device, with no device in hand", () => {
    const failed = (message: string) => ({ state: "failed" as const, message });
    expect(
      deviceNeverArrived(failed(`${REFUSED}: WebGPU: requestAdapter() returned null`), {}),
    ).toBe(true);
    expect(deviceNeverArrived(failed(`${REFUSED}: OperationError: requestDevice failed`), {})).toBe(
      true,
    );
  });

  it("is never a device that arrived, a page with no WebGPU, a lost device, or a desk that draws", () => {
    expect(
      deviceNeverArrived(
        { state: "failed", message: `${REFUSED}: GPUPipelineError: invalid shader module` },
        { device: 4 },
      ),
    ).toBe(false);
    expect(
      deviceNeverArrived(
        { state: "failed", message: `${REFUSED}: WebGPU is unavailable here (no navigator.gpu)` },
        {},
      ),
    ).toBe(false);
    expect(
      deviceNeverArrived({ state: "failed", message: "the device was lost: unknown: gone" }, {}),
    ).toBe(false);
    for (const state of ["pending", "ready", "degraded"] as const) {
      expect(deviceNeverArrived({ state }, {})).toBe(false);
    }
  });
});

describe("the smoke's forced first failure", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "gpu");
  });

  it("answers no adapter on the boot's first mount, and only under the door", async () => {
    const real = {
      requestAdapter: async () => ({ real: true }),
      getPreferredCanvasFormat: () => "bgra8unorm",
      wgslLanguageFeatures: new Set<string>(),
    };
    Object.defineProperty(navigator, "gpu", { value: real, configurable: true });
    const forced = deskGpu(0, `?${REFUSE_FIRST_DEVICE}=1`);
    expect(await forced?.requestAdapter()).toBeNull();
    expect(forced?.getPreferredCanvasFormat()).toBe("bgra8unorm");
    expect(deskGpu(1, `?${REFUSE_FIRST_DEVICE}=1`)).toBeUndefined();
    expect(deskGpu(0, "?godviewMarkers=1")).toBeUndefined();
    expect(deskGpu(0, `?${REFUSE_FIRST_DEVICE}=0`)).toBeUndefined();
  });

  it("forces nothing where the page has no WebGPU to begin with", () => {
    expect(deskGpu(0, `?${REFUSE_FIRST_DEVICE}=1`)).toBeUndefined();
  });
});
