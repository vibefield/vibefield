import type { DeskLayerBoot, DeskLayerStatus } from "@vibecook/ice/desk";
import { unavailableWords } from "./desk-words";

// THE RELAUNCH HEAL (DK-5; the plan's T8): a desk that fails to acquire its DEVICE at boot is
// retried once by the stage, after a second, before the card — Chromium's GPU process can be
// late, and an adapter request made before it is up answers null. Only the boot's own failure is
// retried, and only one with no device yet: a device that arrived and then lost or refused its
// pipelines is not "late", and a page with no WebGPU at all cannot grow one.

/** How long the stage waits before its one retry. */
export const DEVICE_RETRY_MS = 1_000;

/** The URL door a smoke loads the renderer with to force the boot's FIRST adapter request to
 * answer null (`smoke:canvas`'s retry row) — the retry path, proven without a late GPU process. */
export const REFUSE_FIRST_DEVICE = "deskRefuseFirstDevice";

/**
 * Whether a status is a boot that never got its device: `failed` for want of an adapter or a
 * device (`no-adapter`, `refused`), with no device acquired (`perf().boot.device` is set the
 * moment one arrives). `no-webgpu` and a lost device are not.
 */
export function deviceNeverArrived(status: DeskLayerStatus, boot: DeskLayerBoot): boolean {
  const words = unavailableWords(status);
  if (words === null) return false;
  return (words.kind === "no-adapter" || words.kind === "refused") && boot.device === undefined;
}

/**
 * The GPU a desk mount acquires its device through: `undefined` — the layer's own
 * `navigator.gpu` — except the boot's FIRST mount under `REFUSE_FIRST_DEVICE=1`, which gets a
 * GPU whose adapter request answers null, as a late GPU process's does.
 */
export function deskGpu(mount: number, search: string): GPU | undefined {
  if (mount !== 0 || new URLSearchParams(search).get(REFUSE_FIRST_DEVICE) !== "1") return undefined;
  const gpu = typeof navigator === "undefined" ? undefined : navigator.gpu;
  if (gpu === undefined) return undefined;
  return {
    requestAdapter: async () => null,
    getPreferredCanvasFormat: () => gpu.getPreferredCanvasFormat(),
    wgslLanguageFeatures: gpu.wgslLanguageFeatures,
  } as GPU;
}
