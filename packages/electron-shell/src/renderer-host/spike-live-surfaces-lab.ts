import type { LiveSurfaceFrameMetadataV1 } from "@vibefield/contracts";
import {
  type LiveSurfaceGpuDevice,
  type LiveSurfaceRendererAttachment,
  receiveLiveSurfaceRendererTransport,
  WebGpuLiveSurfaceTextureStore,
} from "@vibefield/live-surfaces/renderer";
import { LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS } from "@vibefield/live-surfaces/testing";
import {
  LIVE_SURFACE_LAB_CLOCK_OFFSET_DATASET,
  LIVE_SURFACE_LAB_CLOCK_UNCERTAINTY_DATASET,
  LIVE_SURFACE_LAB_CONTINUOUS_ACTIVE_DATASET,
  LIVE_SURFACE_LAB_RELOAD_READY_DATASET,
  LIVE_SURFACE_LAB_RELOAD_TICKET,
  LIVE_SURFACE_LAB_RESULT_DATASET,
  LIVE_SURFACE_LAB_SCK_TICKET,
  LIVE_SURFACE_LAB_TICKET_READY_DATASET,
  LIVE_SURFACE_LAB_TICKETS,
  type LiveSurfaceLabContinuousSoakResult,
  type LiveSurfaceLabRendererResult,
} from "../testing/live-surface-lab-contract";
import "./spike-live-surfaces-lab.css";

interface LabGpuDevice extends LiveSurfaceGpuDevice<VideoFrame> {
  readonly lost: Promise<unknown>;
  destroy(): void;
}

interface LabGpuAdapter {
  requestDevice(): Promise<LabGpuDevice>;
}

interface LabGpu {
  requestAdapter(): Promise<LabGpuAdapter | null>;
}

interface BrowserPresentation {
  readonly attachment: LiveSurfaceRendererAttachment<VideoFrame>;
  readonly store: WebGpuLiveSurfaceTextureStore<VideoFrame>;
  presented: number;
}

interface SckPixelProof {
  readonly exact: boolean;
  readonly pixelFormat: "bgra";
  readonly redPureRatio: number;
  readonly bluePureRatio: number;
}

interface SckPixelMetadata {
  readonly width: number;
  readonly height: number;
  readonly pixelFormat: string;
}

function required<T>(value: T | null, description: string): T {
  if (value === null) throw new Error(`${description} is unavailable`);
  return value;
}

const canvas = required(
  document.querySelector<HTMLCanvasElement>("#surface"),
  "Live Surfaces lab canvas",
);
const status = required(document.querySelector<HTMLElement>("#status"), "lab status element");
const recovery = required(document.querySelector<HTMLElement>("#recovery"), "lab recovery element");
const browserStatus = required(
  document.querySelector<HTMLElement>("#browser"),
  "browser status element",
);
const sckStatus = required(document.querySelector<HTMLElement>("#sck"), "SCK status element");
const context = required(canvas.getContext("2d"), "2D preview context");
const labParameters = new URLSearchParams(location.search);
const phase = labParameters.get("phase");
const rawSckMode = labParameters.get("sck");
const sckMode =
  rawSckMode === "simulator"
    ? "simulator"
    : rawSckMode === "1" || rawSckMode === "fixture"
      ? "fixture"
      : null;
const sckEnabled = sckMode !== null;
const sckRotate = sckMode === "simulator" && labParameters.get("rotate") === "1";
const rawContinuousSoakMs = labParameters.get("soakMs");
const continuousSoakMs = rawContinuousSoakMs === null ? 0 : Number(rawContinuousSoakMs);
const continuousSoakConfigured = rawContinuousSoakMs !== null;
const continuousSoakValid =
  !continuousSoakConfigured ||
  (Number.isSafeInteger(continuousSoakMs) &&
    continuousSoakMs >= 1_000 &&
    continuousSoakMs <= 30 * 60_000);
const MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS = 2_000;
const MINIMUM_CONTINUOUS_BUDGET_SAMPLE_MS = 60_000;

function browserReferenceRasterSize(index: number): { width: number; height: number } {
  if (index === 0) return { width: 1280, height: 800 };
  if (index <= 3) return { width: 640, height: 480 };
  return { width: 320, height: 240 };
}

// Installed synchronously: preload's one-time port handoff can never outrun
// the lab module while the rest of async setup waits for WebGPU and ticketing.
const portReceiver = receiveLiveSurfaceRendererTransport<VideoFrame>(
  window,
  window.vibefield.claimLiveSurfacePortBridge(),
);
let activeTransport: Awaited<typeof portReceiver.transport> | null = null;
let heldReloadLease: { release(): void } | null = null;
let pageHidden = false;
void portReceiver.transport.then((transport) => {
  if (pageHidden) transport.dispose();
  else activeTransport = transport;
});
window.addEventListener(
  "pagehide",
  () => {
    pageHidden = true;
    portReceiver.dispose();
    activeTransport?.dispose();
    activeTransport = null;
    heldReloadLease?.release();
    heldReloadLease = null;
  },
  { once: true },
);
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function report(result: LiveSurfaceLabRendererResult): void {
  document.documentElement.dataset[LIVE_SURFACE_LAB_RESULT_DATASET] = JSON.stringify(result);
  status.textContent = result.ok
    ? `PASS · CPU recovery + ${result.browserOnePresented} one-surface + 10-way Browser OSR${
        result.sckMode === "fixture"
          ? " + exact SCK"
          : result.sckMode === "simulator"
            ? " + Simulator SCK"
            : ""
      }`
    : `FAIL · ${result.error ?? "unknown error"}`;
}

function exactPixelRatio(
  rgba: Uint8Array,
  stride: number,
  offset: number,
  region: { x0: number; y0: number; x1: number; y1: number },
  expected: readonly [number, number, number, number],
): number {
  let exact = 0;
  let total = 0;
  for (let y = region.y0; y < region.y1; y += 1) {
    for (let x = region.x0; x < region.x1; x += 1) {
      const index = offset + y * stride + x * 4;
      if (
        rgba[index] === expected[0] &&
        rgba[index + 1] === expected[1] &&
        rgba[index + 2] === expected[2] &&
        rgba[index + 3] === expected[3]
      ) {
        exact += 1;
      }
      total += 1;
    }
  }
  return total === 0 ? 0 : exact / total;
}

async function inspectSckPixels(
  frame: VideoFrame,
  metadata: SckPixelMetadata,
): Promise<SckPixelProof> {
  if (metadata.pixelFormat !== "bgra") throw new Error("SCK frame did not declare BGRA pixels");
  const rgba = new Uint8Array(frame.allocationSize({ format: "RGBA" }));
  const layouts = await frame.copyTo(rgba, { format: "RGBA" });
  const layout = layouts[0];
  if (layout === undefined) throw new Error("SCK VideoFrame returned no RGBA plane layout");
  const xMargin = Math.max(8, Math.floor(metadata.width / 8));
  const yMargin = Math.max(8, Math.floor(metadata.height / 16));
  const midpoint = Math.floor(metadata.height / 2);
  const redPureRatio = exactPixelRatio(
    rgba,
    layout.stride,
    layout.offset,
    { x0: xMargin, y0: yMargin, x1: metadata.width - xMargin, y1: midpoint - yMargin },
    [255, 0, 0, 255],
  );
  const bluePureRatio = exactPixelRatio(
    rgba,
    layout.stride,
    layout.offset,
    {
      x0: xMargin,
      y0: midpoint + yMargin,
      x1: metadata.width - xMargin,
      y1: metadata.height - yMargin,
    },
    [0, 0, 255, 255],
  );
  return {
    exact: redPureRatio === 1 && bluePureRatio === 1,
    pixelFormat: "bgra",
    redPureRatio,
    bluePureRatio,
  };
}

async function collectSckFrames(
  presentation: BrowserPresentation,
  target: number,
  timeoutMs: number,
  requireExactPixels: boolean,
): Promise<SckPixelProof> {
  const deadline = performance.now() + timeoutMs;
  let proof: SckPixelProof | null = null;
  while (
    presentation.presented < target ||
    proof === null ||
    (requireExactPixels && !proof.exact)
  ) {
    const lease = presentation.attachment.takeFrame();
    if (lease !== null) {
      const sample =
        proof === null || (requireExactPixels && !proof.exact) ? lease.frame.value.clone() : null;
      const metadata = lease.frame.metadata;
      const result = presentation.store.present(lease);
      if (result.kind === "presented") {
        presentation.presented += 1;
        if (sample !== null) {
          try {
            proof = await inspectSckPixels(sample, {
              width: metadata.geometry.visibleRect.width,
              height: metadata.geometry.visibleRect.height,
              pixelFormat: metadata.pixelFormat,
            });
          } finally {
            sample.close();
          }
        }
      } else {
        sample?.close();
      }
    }
    if (performance.now() >= deadline) {
      throw new Error(
        `SCK frame deadline: presented=${presentation.presented}, proof=${proof !== null}, exact=${proof?.exact ?? false}`,
      );
    }
    if (presentation.presented < target || proof === null || (requireExactPixels && !proof.exact)) {
      await delay(8);
    }
  }
  return proof;
}

async function waitForTickets(): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (document.documentElement.dataset[LIVE_SURFACE_LAB_TICKET_READY_DATASET] !== "1") {
    if (performance.now() >= deadline) throw new Error("main never armed the test-only tickets");
    await delay(10);
  }
}

function presentLatest(
  presentation: BrowserPresentation,
  drawPreview: boolean,
  onPresented?: (metadata: LiveSurfaceFrameMetadataV1) => void,
): boolean {
  const lease = presentation.attachment.takeFrame();
  if (lease === null) return false;
  const preview = drawPreview ? lease.frame.value.clone() : null;
  const metadata = lease.frame.metadata;
  const result = presentation.store.present(lease);
  try {
    if (result.kind !== "presented") return false;
    if (preview !== null) context.drawImage(preview, 0, 0, canvas.width, canvas.height);
    presentation.presented += 1;
    onPresented?.(metadata);
    return true;
  } finally {
    preview?.close();
  }
}

async function collectBrowserFrames(
  presentations: readonly BrowserPresentation[],
  targetPerSurface: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (presentations.some((presentation) => presentation.presented < targetPerSurface)) {
    for (const [index, presentation] of presentations.entries()) {
      if (presentation.presented < targetPerSurface) presentLatest(presentation, index === 0);
    }
    if (performance.now() >= deadline) {
      throw new Error(
        `Browser frame deadline: ${presentations.map((item) => item.presented).join(",")}`,
      );
    }
    await delay(8);
  }
}

function supersededFramesFor(presentations: readonly BrowserPresentation[]): number {
  return presentations.reduce(
    (total, presentation) => total + presentation.attachment.frameStats.releases.superseded,
    0,
  );
}

class FrameAgeHistogram {
  static readonly bucketWidthUs = 100;
  static readonly maximumBucket = 50_000;
  readonly #buckets = new Uint32Array(FrameAgeHistogram.maximumBucket + 2);
  #count = 0;

  observe(ageUs: bigint): void {
    const nonNegativeAgeUs = ageUs < 0n ? 0n : ageUs;
    const roundedBucket = Number(
      (nonNegativeAgeUs + BigInt(FrameAgeHistogram.bucketWidthUs - 1)) /
        BigInt(FrameAgeHistogram.bucketWidthUs),
    );
    const bucket = Math.min(FrameAgeHistogram.maximumBucket + 1, roundedBucket);
    this.#buckets[bucket] = (this.#buckets[bucket] ?? 0) + 1;
    this.#count += 1;
  }

  snapshot(): { readonly samples: number; readonly p95Ms: number } {
    if (this.#count === 0) return { samples: 0, p95Ms: 0 };
    const rank = Math.ceil(this.#count * 0.95);
    let seen = 0;
    for (const [bucket, count] of this.#buckets.entries()) {
      seen += count;
      if (seen >= rank) {
        return {
          samples: this.#count,
          p95Ms: (bucket * FrameAgeHistogram.bucketWidthUs) / 1_000,
        };
      }
    }
    throw new Error("frame-age histogram did not contain its sample count");
  }
}

function readHostClockOffsetUs(): bigint {
  const rawOffset = document.documentElement.dataset[LIVE_SURFACE_LAB_CLOCK_OFFSET_DATASET];
  const rawUncertainty =
    document.documentElement.dataset[LIVE_SURFACE_LAB_CLOCK_UNCERTAINTY_DATASET];
  if (
    rawOffset === undefined ||
    !/^-?(0|[1-9][0-9]*)$/u.test(rawOffset) ||
    rawUncertainty === undefined ||
    !/^(0|[1-9][0-9]*)$/u.test(rawUncertainty)
  ) {
    throw new Error("main did not provide a valid monotonic clock calibration");
  }
  const uncertaintyUs = Number(rawUncertainty);
  if (!Number.isSafeInteger(uncertaintyUs) || uncertaintyUs > 5_000) {
    throw new Error(`monotonic clock calibration uncertainty was ${rawUncertainty}us`);
  }
  return BigInt(rawOffset);
}

async function runContinuousSoak(
  browserPresentations: readonly BrowserPresentation[],
  sckPresentation: BrowserPresentation | null,
  durationMs: number,
  hostClockOffsetUs: bigint,
): Promise<LiveSurfaceLabContinuousSoakResult> {
  const allPresentations =
    sckPresentation === null ? browserPresentations : [...browserPresentations, sckPresentation];
  const browserBaselines = browserPresentations.map((presentation) => presentation.presented);
  const sckBaseline = sckPresentation?.presented ?? 0;
  const supersededBaseline = supersededFramesFor(allPresentations);
  let rendererPendingPerSurfaceMax = 0;
  let rendererInFlightPerSurfaceMax = 0;
  let ticks = 0;
  const browserLastPresentedAt = browserPresentations.map(() => performance.now());
  const browserMaximumPresentationGapMs = browserPresentations.map(() => 0);
  let sckLastPresentedAt = sckPresentation === null ? null : performance.now();
  let sckMaximumPresentationGapMs = sckPresentation === null ? null : 0;
  const frameAgeHistograms = allPresentations.map(() => new FrameAgeHistogram());
  const activeRasterSizes: Array<{ width: number; height: number } | null> = allPresentations.map(
    () => null,
  );
  const observeFrame = (index: number, metadata: LiveSurfaceFrameMetadataV1): void => {
    const rendererHostNowUs = hostClockOffsetUs + BigInt(Math.round(performance.now() * 1_000));
    frameAgeHistograms[index]?.observe(rendererHostNowUs - BigInt(metadata.hostReceivedAtUs));
    activeRasterSizes[index] = {
      width: metadata.geometry.visibleRect.width,
      height: metadata.geometry.visibleRect.height,
    };
  };
  const observeQueues = (): void => {
    for (const presentation of allPresentations) {
      const stats = presentation.attachment.frameStats;
      rendererPendingPerSurfaceMax = Math.max(rendererPendingPerSurfaceMax, stats.pending);
      rendererInFlightPerSurfaceMax = Math.max(rendererInFlightPerSurfaceMax, stats.inFlight);
    }
  };
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;
  while (performance.now() < deadline) {
    observeQueues();
    for (const [index, presentation] of browserPresentations.entries()) {
      if (presentLatest(presentation, false, (metadata) => observeFrame(index, metadata))) {
        const presentedAt = performance.now();
        browserMaximumPresentationGapMs[index] = Math.max(
          browserMaximumPresentationGapMs[index] ?? 0,
          presentedAt - (browserLastPresentedAt[index] ?? startedAt),
        );
        browserLastPresentedAt[index] = presentedAt;
      }
    }
    if (
      sckPresentation !== null &&
      presentLatest(sckPresentation, false, (metadata) =>
        observeFrame(browserPresentations.length, metadata),
      )
    ) {
      const presentedAt = performance.now();
      sckMaximumPresentationGapMs = Math.max(
        sckMaximumPresentationGapMs ?? 0,
        presentedAt - (sckLastPresentedAt ?? startedAt),
      );
      sckLastPresentedAt = presentedAt;
    }
    observeQueues();
    ticks += 1;
    const remainingMs = deadline - performance.now();
    if (remainingMs > 0) await delay(Math.min(8, remainingMs));
  }
  observeQueues();
  const finishedAt = performance.now();
  for (const index of browserPresentations.keys()) {
    browserMaximumPresentationGapMs[index] = Math.max(
      browserMaximumPresentationGapMs[index] ?? 0,
      finishedAt - (browserLastPresentedAt[index] ?? startedAt),
    );
  }
  if (sckMaximumPresentationGapMs !== null) {
    sckMaximumPresentationGapMs = Math.max(
      sckMaximumPresentationGapMs,
      finishedAt - (sckLastPresentedAt ?? startedAt),
    );
  }
  const frameAge = frameAgeHistograms.map((histogram) => histogram.snapshot());
  return {
    requestedDurationMs: durationMs,
    elapsedMs: finishedAt - startedAt,
    ticks,
    browserPresented: browserPresentations.map(
      (presentation, index) => presentation.presented - (browserBaselines[index] ?? 0),
    ),
    browserMaximumPresentationGapMs,
    sckPresented: (sckPresentation?.presented ?? 0) - sckBaseline,
    sckMaximumPresentationGapMs,
    activeFrameAgeSamples: frameAge.map((sample) => sample.samples),
    activeFrameAgeP95Ms: frameAge.map((sample) => sample.p95Ms),
    worstActiveFrameAgeP95Ms: frameAge.reduce((worst, sample) => Math.max(worst, sample.p95Ms), 0),
    activeRasterSizes,
    rendererPendingPerSurfaceMax,
    rendererInFlightPerSurfaceMax,
    rendererSupersededFrames: supersededFramesFor(allPresentations) - supersededBaseline,
  };
}

async function runReloadProbe(): Promise<void> {
  try {
    await waitForTickets();
    const transport = await portReceiver.transport;
    await transport.ready;
    const attachment = await transport.attach(LIVE_SURFACE_LAB_RELOAD_TICKET);
    attachment.setDemand({
      revision: 1,
      mode: "live",
      targetFps: 30,
      targetRasterSize: { width: 320, height: 180 },
      priority: 100,
      interactive: false,
    });
    status.textContent = "LSF-2 reload: holding one shared frame across document teardown…";
    const deadline = performance.now() + 15_000;
    while (heldReloadLease === null) {
      heldReloadLease = attachment.takeFrame();
      if (performance.now() >= deadline) throw new Error("reload probe frame deadline");
      if (heldReloadLease === null) await delay(8);
    }
    const nextParameters = new URLSearchParams({ phase: "main" });
    if (sckMode !== null) nextParameters.set("sck", sckMode);
    if (sckRotate) nextParameters.set("rotate", "1");
    if (continuousSoakConfigured) nextParameters.set("soakMs", String(continuousSoakMs));
    history.replaceState(null, "", `${location.pathname}?${nextParameters.toString()}`);
    document.documentElement.dataset[LIVE_SURFACE_LAB_RELOAD_READY_DATASET] = "1";
    status.textContent = "LSF-2 reload: shared frame held; waiting for main-authorized reload…";
  } catch (error) {
    report({
      ok: false,
      presented: 0,
      presentedAfterRecovery: 0,
      deviceGenerations: 0,
      deviceLossObserved: false,
      rendererReloadObserved: false,
      transportProtocolFaults: 0,
      supersededFrames: 0,
      browserOnePresented: 0,
      browserFallbackPresented: 0,
      browserFallbackObserved: false,
      tenSurfacePresented: [],
      tenSurfaceShared: 0,
      continuousSoak: null,
      sckEnabled,
      ...(sckMode === null ? {} : { sckMode }),
      sckPresented: 0,
      sckExact: false,
      sckRebound: false,
      sckRedPureRatio: 0,
      sckBluePureRatio: 0,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

async function run(rendererReloadObserved: boolean): Promise<void> {
  let presented = 0;
  let presentedAfterRecovery = 0;
  let deviceLossObserved = false;
  let deviceGenerations = 0;
  let transportProtocolFaults = 0;
  let supersededFrames = 0;
  let browserOnePresented = 0;
  let browserOneTransport: "shared-texture" | "cpu-bgra" | undefined;
  let browserFallbackPresented = 0;
  let browserFallbackObserved = false;
  let tenSurfacePresented: number[] = [];
  let tenSurfaceShared = 0;
  let continuousSoak: LiveSurfaceLabContinuousSoakResult | null = null;
  let sckPresented = 0;
  let sckExact = false;
  let sckRebound = false;
  let sckTransport: "shared-texture" | undefined;
  let sckPixelFormat: "bgra" | undefined;
  let sckRedPureRatio = 0;
  let sckBluePureRatio = 0;
  let sckPresentation: BrowserPresentation | null = null;
  try {
    if (!continuousSoakValid) {
      throw new Error("continuous soak duration must be an integer from 1000ms through 1800000ms");
    }
    const gpu = (navigator as Navigator & { readonly gpu?: LabGpu }).gpu;
    if (gpu === undefined) throw new Error("navigator.gpu is unavailable");
    const adapter = await gpu.requestAdapter();
    if (adapter === null) throw new Error("WebGPU adapter is unavailable");
    let device = await adapter.requestDevice();

    await waitForTickets();
    const transport = await portReceiver.transport;
    await transport.ready;

    // LSF-2 regression phase: CPU fixture and renderer-device recovery.
    const fixture = await transport.attach(LIVE_SURFACE_LAB_TICKETS[0]!);
    const fixtureStore = new WebGpuLiveSurfaceTextureStore<VideoFrame>();
    deviceGenerations = fixtureStore.replaceDevice(device);
    fixture.setDemand({
      revision: 1,
      mode: "live",
      targetFps: 30,
      priority: 50,
      interactive: false,
    });
    status.textContent = "LSF-2 regression: presenting fixture frames and losing the GPU device…";
    let recovered = false;
    let recoveryStarted = false;
    let finishing = false;
    const recoverDevice = async (): Promise<void> => {
      recoveryStarted = true;
      recovery.textContent = "device destroyed; frames release while unavailable";
      device.destroy();
      await device.lost;
      await Promise.resolve();
      deviceLossObserved = fixtureStore.snapshot === null;
      const replacementAdapter = await gpu.requestAdapter();
      if (replacementAdapter === null) throw new Error("replacement WebGPU adapter is unavailable");
      device = await replacementAdapter.requestDevice();
      deviceGenerations = fixtureStore.replaceDevice(device);
      recovered = true;
      recovery.textContent = `recovered on GPU generation ${deviceGenerations}`;
    };
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        try {
          const lease = fixture.takeFrame();
          if (lease !== null) {
            const preview = lease.frame.value.clone();
            const result = fixtureStore.present(lease);
            try {
              if (result.kind === "presented") {
                context.drawImage(preview, 0, 0, canvas.width, canvas.height);
                presented += 1;
                if (recovered) presentedAfterRecovery += 1;
              }
            } finally {
              preview.close();
            }
          }
          if (presented >= 6 && !recoveryStarted) {
            void recoverDevice().catch((error: unknown) => {
              clearInterval(timer);
              reject(error);
            });
          }
          if (recovered && presentedAfterRecovery >= 6 && !finishing) {
            finishing = true;
            clearInterval(timer);
            resolve();
          }
        } catch (error) {
          clearInterval(timer);
          reject(error);
        }
      }, 16);
    });
    fixture.setDemand({
      revision: 2,
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
    });

    // LSF-3 one-surface shared-texture proof.
    browserStatus.textContent = "one Browser surface: probing shared texture…";
    const firstBrowser = await transport.attach(LIVE_SURFACE_LAB_TICKETS[1]!);
    const firstBrowserStore = new WebGpuLiveSurfaceTextureStore<VideoFrame>();
    firstBrowserStore.replaceDevice(device);
    const firstPresentation: BrowserPresentation = {
      attachment: firstBrowser,
      store: firstBrowserStore,
      presented: 0,
    };
    firstBrowser.setDemand({
      revision: 1,
      mode: "live",
      targetFps: 30,
      targetRasterSize: { width: 640, height: 360 },
      priority: 80,
      interactive: true,
    });
    await collectBrowserFrames([firstPresentation], 6, 15_000);
    browserOnePresented = firstPresentation.presented;
    browserOneTransport = firstBrowser.summary.transport;
    firstBrowser.setDemand({
      revision: 2,
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
    });
    await delay(200);

    // Explicit observed fallback: a real OSR source created with shared textures
    // disabled must become visibly degraded only after repeated CPU paints.
    browserStatus.textContent = "Browser fallback: waiting for observed CPU degradation…";
    const fallback = await transport.attach(LIVE_SURFACE_LAB_TICKETS[11]!);
    const fallbackStore = new WebGpuLiveSurfaceTextureStore<VideoFrame>();
    fallbackStore.replaceDevice(device);
    const fallbackPresentation: BrowserPresentation = {
      attachment: fallback,
      store: fallbackStore,
      presented: 0,
    };
    fallback.setDemand({
      revision: 1,
      mode: "live",
      targetFps: 10,
      targetRasterSize: { width: 320, height: 180 },
      priority: 20,
      interactive: false,
    });
    await collectBrowserFrames([fallbackPresentation], 3, 15_000);
    browserFallbackPresented = fallbackPresentation.presented;
    browserFallbackObserved =
      fallback.summary.transport === "cpu-bgra" &&
      fallback.summary.error?.code === "transport-degraded";
    fallback.setDemand({
      revision: 2,
      mode: "hibernated",
      targetFps: 0,
      priority: 0,
      interactive: false,
    });

    // Ten concurrent shared Browser surfaces. A continuous run uses the
    // ratified 60/30/5 reference tiers; the quick regression keeps its smaller
    // workload so it remains useful during ordinary development.
    browserStatus.textContent = "ten Browser surfaces: concurrent OSR/shared-texture run…";
    const remaining = await Promise.all(
      LIVE_SURFACE_LAB_TICKETS.slice(2, 11).map((ticket) => transport.attach(ticket)),
    );
    const tenAttachments = [firstBrowser, ...remaining];
    const tenPresentations: BrowserPresentation[] = tenAttachments.map((attachment, index) => {
      if (index === 0) {
        firstPresentation.presented = 0;
        return firstPresentation;
      }
      const store = new WebGpuLiveSurfaceTextureStore<VideoFrame>();
      store.replaceDevice(device);
      return { attachment, store, presented: 0 };
    });
    for (const [index, attachment] of tenAttachments.entries()) {
      const tier = index === 0 ? 0 : index <= 3 ? 1 : 2;
      const targetFps = continuousSoakConfigured
        ? tier === 0
          ? 60
          : tier === 1
            ? 30
            : 5
        : tier === 0
          ? 30
          : tier === 1
            ? 15
            : 5;
      const targetRasterSize = continuousSoakConfigured
        ? browserReferenceRasterSize(index)
        : tier === 0
          ? { width: 640, height: 360 }
          : tier === 1
            ? { width: 320, height: 180 }
            : { width: 160, height: 90 };
      attachment.setDemand({
        revision: index === 0 ? 3 : 1,
        mode: "live",
        targetFps,
        targetRasterSize,
        priority: 70 - index,
        interactive: index === 0,
      });
    }
    await collectBrowserFrames(tenPresentations, 3, 20_000);
    tenSurfacePresented = tenPresentations.map((presentation) => presentation.presented);
    tenSurfaceShared = tenAttachments.filter(
      (attachment) => attachment.summary.transport === "shared-texture",
    ).length;

    if (sckEnabled) {
      sckStatus.textContent =
        sckMode === "simulator"
          ? "capturing the resolved Simulator viewport through the helper…"
          : "capturing deterministic BGRA stripes through the helper…";
      const sck = await transport.attach(LIVE_SURFACE_LAB_SCK_TICKET);
      const store = new WebGpuLiveSurfaceTextureStore<VideoFrame>();
      store.replaceDevice(device);
      sckPresentation = { attachment: sck, store, presented: 0 };
      sck.setDemand({
        revision: 1,
        mode: "live",
        targetFps: 30,
        targetRasterSize: { width: 390, height: 844 },
        priority: 90,
        interactive: false,
      });
      const proof = await collectSckFrames(sckPresentation, 3, 20_000, sckMode === "fixture");
      sckPresented = sckPresentation.presented;
      sckExact = proof.exact;
      sckPixelFormat = proof.pixelFormat;
      sckRedPureRatio = proof.redPureRatio;
      sckBluePureRatio = proof.bluePureRatio;
      if (sck.summary.transport === "shared-texture") sckTransport = "shared-texture";
      if (sckRotate) {
        const firstEpoch = sck.summary.producerEpoch;
        const firstGeometry = JSON.stringify(sck.summary.geometry?.logicalSize ?? null);
        let reboundFrames = 0;
        const deadline = performance.now() + 20_000;
        while (!sckRebound || reboundFrames < 3) {
          const lease = sck.takeFrame();
          if (lease !== null) {
            const metadata = lease.frame.metadata;
            const result = store.present(lease);
            if (result.kind === "presented") {
              sckPresentation.presented += 1;
              const geometry = JSON.stringify(metadata.geometry.logicalSize);
              if (metadata.producerEpoch > firstEpoch && geometry !== firstGeometry) {
                sckRebound = true;
                reboundFrames += 1;
              }
            }
          }
          if (performance.now() >= deadline) {
            throw new Error(
              `Simulator orientation rebound deadline: rebound=${sckRebound}, frames=${reboundFrames}`,
            );
          }
          if (!sckRebound || reboundFrames < 3) await delay(8);
        }
        sckPresented = sckPresentation.presented;
      }
      sckStatus.textContent =
        sckMode === "simulator"
          ? `Simulator viewport · ${sckPresented} frames${sckRebound ? " · rebound" : ""}`
          : proof.exact
            ? `exact BGRA · ${sckPresented} frames`
            : `pixel mismatch · red ${proof.redPureRatio}, blue ${proof.bluePureRatio}`;
    }

    if (continuousSoakConfigured) {
      browserStatus.textContent = `continuous reference workload · ${Math.round(
        continuousSoakMs / 1_000,
      )}s…`;
      document.documentElement.dataset[LIVE_SURFACE_LAB_CONTINUOUS_ACTIVE_DATASET] = "1";
      try {
        // Give the external main-process meter one bounded polling interval to
        // arm before the timed reference window begins.
        await delay(50);
        continuousSoak = await runContinuousSoak(
          tenPresentations,
          sckPresentation,
          continuousSoakMs,
          readHostClockOffsetUs(),
        );
      } finally {
        document.documentElement.dataset[LIVE_SURFACE_LAB_CONTINUOUS_ACTIVE_DATASET] = "0";
      }
      tenSurfacePresented = tenPresentations.map((presentation) => presentation.presented);
      sckPresented = sckPresentation?.presented ?? sckPresented;
      browserStatus.textContent = `continuous workload complete · ${continuousSoak.browserPresented.join(
        ",",
      )}`;
    }

    for (const [index, attachment] of tenAttachments.entries()) {
      attachment.setDemand({
        revision: index === 0 ? 4 : 2,
        mode: "hibernated",
        targetFps: 0,
        priority: 0,
        interactive: false,
      });
    }
    if (sckPresentation !== null) {
      sckPresentation.attachment.setDemand({
        revision: 2,
        mode: "hibernated",
        targetFps: 0,
        priority: 0,
        interactive: false,
      });
    }
    await delay(300);

    transportProtocolFaults = transport.protocolFaults;
    supersededFrames = fixture.frameStats.releases.superseded;
    const ok =
      presented >= 12 &&
      presentedAfterRecovery >= 6 &&
      deviceGenerations >= 2 &&
      deviceLossObserved &&
      rendererReloadObserved &&
      browserOnePresented >= 6 &&
      browserOneTransport === "shared-texture" &&
      browserFallbackPresented >= 3 &&
      browserFallbackObserved &&
      tenSurfacePresented.length === 10 &&
      tenSurfacePresented.every((count) => count >= 3) &&
      tenSurfaceShared === 10 &&
      (!continuousSoakConfigured ||
        (continuousSoak !== null &&
          continuousSoak.elapsedMs >= continuousSoak.requestedDurationMs &&
          continuousSoak.ticks > 0 &&
          continuousSoak.browserPresented.length === 10 &&
          continuousSoak.browserPresented.every((count) => count > 0) &&
          continuousSoak.browserMaximumPresentationGapMs.length === 10 &&
          continuousSoak.browserMaximumPresentationGapMs.every(
            (gapMs) => gapMs <= MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS,
          ) &&
          (!sckEnabled || continuousSoak.sckPresented > 0) &&
          (!sckEnabled ||
            (continuousSoak.sckMaximumPresentationGapMs !== null &&
              continuousSoak.sckMaximumPresentationGapMs <=
                MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS)) &&
          continuousSoak.activeFrameAgeSamples.length === (sckEnabled ? 11 : 10) &&
          continuousSoak.activeFrameAgeSamples.every((count) => count > 0) &&
          continuousSoak.activeRasterSizes.length === (sckEnabled ? 11 : 10) &&
          continuousSoak.activeRasterSizes.slice(0, 10).every((size, index) => {
            const expected = browserReferenceRasterSize(index);
            return size?.width === expected.width && size.height === expected.height;
          }) &&
          (continuousSoak.requestedDurationMs < MINIMUM_CONTINUOUS_BUDGET_SAMPLE_MS ||
            continuousSoak.worstActiveFrameAgeP95Ms <=
              LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.worstActiveFrameAgeP95Ms) &&
          continuousSoak.rendererPendingPerSurfaceMax <= 1 &&
          continuousSoak.rendererInFlightPerSurfaceMax <= 1)) &&
      (!sckEnabled ||
        (sckPresented >= (sckRotate ? 6 : 3) &&
          (sckMode !== "fixture" || sckExact) &&
          (!sckRotate || sckRebound) &&
          sckTransport === "shared-texture" &&
          sckPixelFormat === "bgra")) &&
      transportProtocolFaults === 0;
    report({
      ok,
      presented,
      presentedAfterRecovery,
      deviceGenerations,
      deviceLossObserved,
      rendererReloadObserved,
      transportProtocolFaults,
      supersededFrames,
      browserOnePresented,
      ...(browserOneTransport === undefined ? {} : { browserOneTransport }),
      browserFallbackPresented,
      browserFallbackObserved,
      tenSurfacePresented,
      tenSurfaceShared,
      continuousSoak,
      sckEnabled,
      ...(sckMode === null ? {} : { sckMode }),
      sckPresented,
      sckExact,
      sckRebound,
      ...(sckTransport === undefined ? {} : { sckTransport }),
      ...(sckPixelFormat === undefined ? {} : { sckPixelFormat }),
      sckRedPureRatio,
      sckBluePureRatio,
      ...(ok ? {} : { error: "one or more renderer invariants did not hold" }),
    });

    fixture.dispose();
    fixtureStore.close();
    fallback.dispose();
    fallbackStore.close();
    for (const presentation of tenPresentations) {
      presentation.attachment.dispose();
      presentation.store.close();
    }
    sckPresentation?.attachment.dispose();
    sckPresentation?.store.close();
    transport.dispose();
  } catch (error) {
    report({
      ok: false,
      presented,
      presentedAfterRecovery,
      deviceGenerations,
      deviceLossObserved,
      rendererReloadObserved,
      transportProtocolFaults,
      supersededFrames,
      browserOnePresented,
      ...(browserOneTransport === undefined ? {} : { browserOneTransport }),
      browserFallbackPresented,
      browserFallbackObserved,
      tenSurfacePresented,
      tenSurfaceShared,
      continuousSoak,
      sckEnabled,
      ...(sckMode === null ? {} : { sckMode }),
      sckPresented,
      sckExact,
      sckRebound,
      ...(sckTransport === undefined ? {} : { sckTransport }),
      ...(sckPixelFormat === undefined ? {} : { sckPixelFormat }),
      sckRedPureRatio,
      sckBluePureRatio,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

if (phase === "reload") {
  void runReloadProbe();
} else {
  void run(phase === "main");
}
