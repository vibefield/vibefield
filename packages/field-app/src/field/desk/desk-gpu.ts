import type { DeskLayerBoot, DeskLayerStatus } from "@vibecook/ice/desk";
import { unavailableWords } from "./desk-words";

// THE RELAUNCH HEAL (DK-5; the plan's T8) and ITS RULE (DK-9, the plan's Phase 3 input (7)): a desk
// whose DEVICE never arrived at boot is mounted again by the stage before any card — but only for the
// two failures a retry can cure, each as often as it can cure it:
//   `no-adapter` — Chromium's GPU process can be LATE, and an adapter request made before it is up
//     answers null: retried THREE times over about two seconds (`HEAL_DELAYS_MS`), then the card;
//   `refused` — a `requestDevice` rejected with no device in hand (an adapter lost mid-request):
//     retried ONCE, then the card — a refusal is deterministic for the same adapter and limits.
// A device that arrived and then lost or refused its pipelines is not late, a page with no WebGPU
// cannot grow one, and a Reload the person asked for is never retried (the stage's heal chain).

/** How long the stage waits before the retry of a REFUSED device (its one). */
export const DEVICE_RETRY_MS = 1_000;

/** The failures the heal retries. */
export type HealKind = "no-adapter" | "refused";

/** Each heal kind's retries, the wait before each: a missing adapter three times over ~2 s (500 +
 * 700 + 800 ms), a refused device once. The length of a row IS its budget. */
export const HEAL_DELAYS_MS: Readonly<Record<HealKind, readonly number[]>> = {
  "no-adapter": [500, 700, 800],
  refused: [DEVICE_RETRY_MS],
};

/** The URL door a smoke loads the renderer with to force the boot's FIRST adapter request to
 * answer null (`smoke:canvas`'s retry row) — the late-GPU heal, proven without a late GPU process. */
export const REFUSE_FIRST_DEVICE = "deskRefuseFirstDevice";

/** The URL door that makes the first N mounts' `requestDevice` REJECT (`smoke:canvas`'s refusal
 * row, DK-9): an adapter answers, its device is refused — the heal's once, proven in the product. */
export const REFUSE_DEVICE = "deskRefuseDevice";

/**
 * The heal kind of a status, or null: `failed` for want of an adapter (`no-adapter`) or of a
 * device (`refused`) with NO device acquired (`perf().boot.device` is set the moment one
 * arrives). `no-webgpu`, a lost device and a device whose pipelines were refused are not healed.
 */
export function healKind(status: DeskLayerStatus, boot: DeskLayerBoot): HealKind | null {
  const words = unavailableWords(status);
  if (words === null || boot.device !== undefined) return null;
  return words.kind === "no-adapter" || words.kind === "refused" ? words.kind : null;
}

/** The wait before retry number `tries + 1` of `kind`, or undefined once its budget is spent. */
export function healDelay(kind: HealKind, tries: number): number | undefined {
  return HEAL_DELAYS_MS[kind][tries];
}

/** Whether a status is a boot that never got its device — one the heal could retry. */
export function deviceNeverArrived(status: DeskLayerStatus, boot: DeskLayerBoot): boolean {
  return healKind(status, boot) !== null;
}

/** A GPU whose adapters refuse every device request (`REFUSE_DEVICE`'s injected fault). */
function refusingGpu(gpu: GPU): GPU {
  return {
    requestAdapter: async (options?: GPURequestAdapterOptions) => {
      const adapter = await gpu.requestAdapter(options);
      if (adapter === null) return null;
      return new Proxy(adapter, {
        get(target, key) {
          if (key === "requestDevice")
            return async () => {
              throw new Error(`the device was refused (${REFUSE_DEVICE} — an injected fault)`);
            };
          const value = Reflect.get(target, key, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    getPreferredCanvasFormat: () => gpu.getPreferredCanvasFormat(),
    wgslLanguageFeatures: gpu.wgslLanguageFeatures,
  } as GPU;
}

/**
 * The GPU a desk mount acquires its device through: `undefined` — the layer's own
 * `navigator.gpu` — except under a smoke's door: the boot's FIRST mount under
 * `REFUSE_FIRST_DEVICE=1` gets a GPU whose adapter request answers null, as a late GPU
 * process's does; the first N mounts under `REFUSE_DEVICE=N` an adapter that refuses its device.
 */
export function deskGpu(mount: number, search: string): GPU | undefined {
  const params = new URLSearchParams(search);
  const gpu = typeof navigator === "undefined" ? undefined : navigator.gpu;
  if (gpu === undefined) return undefined;
  if (mount === 0 && params.get(REFUSE_FIRST_DEVICE) === "1") {
    return {
      requestAdapter: async () => null,
      getPreferredCanvasFormat: () => gpu.getPreferredCanvasFormat(),
      wgslLanguageFeatures: gpu.wgslLanguageFeatures,
    } as GPU;
  }
  const refused = Number(params.get(REFUSE_DEVICE) ?? "0");
  if (Number.isInteger(refused) && mount < refused) return refusingGpu(gpu);
  return undefined;
}
