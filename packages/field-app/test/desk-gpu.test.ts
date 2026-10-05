/**
 * DK-5 — the relaunch heal's two rules (field/desk/desk-gpu.ts): which failure is a boot whose
 * device never arrived — the one a retry may heal — and the smoke's door that forces the boot's
 * first adapter request to answer null. DK-9 — its RULE (the plan's Phase 3 input (7)): which KIND
 * of failure it is and how often each is retried (a missing adapter three times over ~2 s, a refused
 * device once), and the door that refuses the first N mounts' devices.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  deskGpu,
  deviceNeverArrived,
  HEAL_DELAYS_MS,
  healDelay,
  healKind,
  REFUSE_DEVICE,
  REFUSE_FIRST_DEVICE,
} from "../src/field/desk/desk-gpu";

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

describe("DK-9 — the heal's rule: a missing adapter three times over ~2 s, a refused device once", () => {
  const failed = (message: string) => ({ state: "failed" as const, message });
  it("names the kind a retry may cure — and none for a failure no retry cures", () => {
    expect(healKind(failed(`${REFUSED}: WebGPU: requestAdapter() returned null`), {})).toBe(
      "no-adapter",
    );
    expect(healKind(failed(`${REFUSED}: OperationError: requestDevice failed`), {})).toBe(
      "refused",
    );
    // a device in hand is never "late"; no WebGPU cannot grow one; a lost device is not a boot
    expect(
      healKind(failed(`${REFUSED}: OperationError: requestDevice failed`), { device: 2 }),
    ).toBe(null);
    expect(healKind(failed(`${REFUSED}: WebGPU is unavailable here (no navigator.gpu)`), {})).toBe(
      null,
    );
    expect(healKind(failed("the device was lost: unknown: gone"), {})).toBe(null);
  });

  it("budgets the retries by kind — three for a missing adapter summing ~2 s, one for a refused device — then none", () => {
    expect(HEAL_DELAYS_MS["no-adapter"]).toHaveLength(3);
    expect(HEAL_DELAYS_MS["no-adapter"].reduce((a, b) => a + b, 0)).toBe(2_000);
    expect([0, 1, 2, 3].map((tries) => healDelay("no-adapter", tries))).toEqual([
      500,
      700,
      800,
      undefined,
    ]);
    expect([0, 1].map((tries) => healDelay("refused", tries))).toEqual([1_000, undefined]);
  });
});

describe("the smoke's injected refusal (DK-9)", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "gpu");
  });

  it("refuses the first N mounts' devices under the door — the adapter's other members its own — and none after", async () => {
    const adapter = { label: "real", requestDevice: async () => ({ device: true }) };
    const real = {
      requestAdapter: async () => adapter,
      getPreferredCanvasFormat: () => "bgra8unorm",
      wgslLanguageFeatures: new Set<string>(),
    };
    Object.defineProperty(navigator, "gpu", { value: real, configurable: true });
    for (const mount of [0, 1]) {
      const refusing = deskGpu(mount, `?${REFUSE_DEVICE}=2`);
      const lent = (await refusing?.requestAdapter()) as unknown as typeof adapter;
      expect(lent.label).toBe("real");
      await expect(lent.requestDevice()).rejects.toThrow(/the device was refused/);
    }
    expect(deskGpu(2, `?${REFUSE_DEVICE}=2`)).toBeUndefined();
    expect(deskGpu(0, "?godviewMarkers=1")).toBeUndefined();
    expect(deskGpu(0, `?${REFUSE_DEVICE}=0`)).toBeUndefined();
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
