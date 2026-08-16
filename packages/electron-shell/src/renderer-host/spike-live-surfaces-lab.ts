import {
  type LiveSurfaceGpuDevice,
  type LiveSurfaceRendererAttachment,
  receiveLiveSurfaceRendererTransport,
  WebGpuLiveSurfaceTextureStore,
} from "@vibefield/live-surfaces/renderer";
import {
  LIVE_SURFACE_LAB_RELOAD_READY_DATASET,
  LIVE_SURFACE_LAB_RELOAD_TICKET,
  LIVE_SURFACE_LAB_RESULT_DATASET,
  LIVE_SURFACE_LAB_TICKET_READY_DATASET,
  LIVE_SURFACE_LAB_TICKETS,
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
const context = required(canvas.getContext("2d"), "2D preview context");

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
    ? `PASS · CPU recovery + ${result.browserOnePresented} one-surface + 10-way Browser OSR`
    : `FAIL · ${result.error ?? "unknown error"}`;
}

async function waitForTickets(): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (document.documentElement.dataset[LIVE_SURFACE_LAB_TICKET_READY_DATASET] !== "1") {
    if (performance.now() >= deadline) throw new Error("main never armed the test-only tickets");
    await delay(10);
  }
}

function presentLatest(presentation: BrowserPresentation, drawPreview: boolean): boolean {
  const lease = presentation.attachment.takeFrame();
  if (lease === null) return false;
  const preview = drawPreview ? lease.frame.value.clone() : null;
  const result = presentation.store.present(lease);
  try {
    if (result.kind !== "presented") return false;
    if (preview !== null) context.drawImage(preview, 0, 0, canvas.width, canvas.height);
    presentation.presented += 1;
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
    history.replaceState(null, "", `${location.pathname}?phase=main`);
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
  try {
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

    // Ten concurrent shared Browser surfaces. Surface zero resumes; nine new
    // attachments use tiered FPS/raster demand.
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
      const targetFps = tier === 0 ? 30 : tier === 1 ? 15 : 5;
      const targetRasterSize =
        tier === 0
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
    for (const [index, attachment] of tenAttachments.entries()) {
      attachment.setDemand({
        revision: index === 0 ? 4 : 2,
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
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

const phase = new URLSearchParams(location.search).get("phase");
if (phase === "reload") {
  void runReloadProbe();
} else {
  void run(phase === "main");
}
