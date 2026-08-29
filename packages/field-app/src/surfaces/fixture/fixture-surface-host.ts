// DT-2b-2 — the catalog's live-surface FIXTURE HOST.
//
// The catalog has no Electron main, so it has no producer: nothing captures a
// browser view or a simulator here. What it DOES have is everything between the
// producer and the pixel — the transport, the pool, the demand fold, the
// presentation's lease discipline and the shipping view — and this module makes
// that half real so the catalog can mount `LiveSurfaceView` itself rather than
// draw a picture of it (docs/UI_SYSTEM.md: the catalog mounts the shipping view
// with a fixture adapter, never a replica).
//
// So: the REAL `LiveSurfaceRendererTransport` over a pair of in-memory ports,
// with a scripted host on the far side — the same harness idiom as
// `test/surfaces-pool.test.ts` and `live-surfaces/test/renderer-transport.test`.
// Frames are real `VideoFrame`s, painted on an OffscreenCanvas and handed over
// exactly as the preload's frame port hands them over. Only the SOURCE is
// invented, and the catalog says so on the card.
//
// WHY THIS FILE IS NOT IN `design-system/`. `ui-system-boundaries.test.ts`
// holds the catalog to composing other workspace packages through stated doors
// only (`@vibefield/contracts`, the design kit, a package's own
// `/design-system` entry). A fixture host needs `LiveSurfaceRendererTransport`
// itself — the attachment class carries private fields, so a structural fake
// cannot be handed to `LiveSurfacePresentation` — and `@vibefield/live-surfaces`
// publishes no `/design-system` entry to route that through. Keeping the fixture
// in field-app's own `surfaces/` tree means the catalog imports a RELATIVE
// module and the cross-package rule keeps its teeth.

import type {
  LiveSurfaceDemandV1,
  LiveSurfaceFrameMetadataV1,
  LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import {
  type LiveSurfaceMessagePort,
  LiveSurfaceRendererTransport,
} from "@vibefield/live-surfaces/renderer";
import type { SurfaceTicketGrant, SurfaceTicketSource } from "../pool";
import { createSurfacePool, type ProductSurfaceFrame, type SurfacePool } from "../pool";

/** Frames are produced at this cadence and this size regardless of demand: the
 * fixture is a stand-in for a producer, not an implementation of one, and
 * honouring the fps bucket or the target raster would be inventing behaviour
 * the real producer owns. The DEMAND is still real — folded by the pool, put on
 * the wire, recorded here, and shown on the card. */
const FIXTURE_FRAME_INTERVAL_MS = 100;

const FIXTURE_SURFACE_ID = "surface_catalog_fixture_0001";
const FIXTURE_RENDERER_GENERATION = 1;
/** Shaped like a real ticket (32..256 of `[A-Za-z0-9_-]`) and worth exactly
 * nothing: no fieldd minted it and no custody row backs it. */
const FIXTURE_TICKET_TOKEN = "catalog_fixture_ticket_not_a_real_grant_0000";

/** Whether this browser can run the fixture at all. WebCodecs is the gate: the
 * product's frame type IS `VideoFrame`, so a browser without it cannot carry
 * one, and the catalog says that instead of rendering an empty box. */
export function fixtureSurfacesSupported(): boolean {
  return typeof OffscreenCanvas !== "undefined" && typeof VideoFrame !== "undefined";
}

/** One in-memory half of a `MessageChannel`, minus the structured-clone step —
 * frames are handed over by reference here because both ends are this window. */
class MemoryPort implements LiveSurfaceMessagePort {
  onmessage: LiveSurfaceMessagePort["onmessage"] = null;
  onmessageerror: (() => void) | null = null;
  peer: MemoryPort | null = null;
  #queued: unknown[] = [];
  #started = false;
  #closed = false;

  postMessage(message: unknown): void {
    if (this.#closed) throw new Error("fixture port is closed");
    this.peer?.deliver(message);
  }

  start(): void {
    if (this.#closed) return;
    this.#started = true;
    for (const message of this.#queued.splice(0)) this.onmessage?.({ data: message });
  }

  close(): void {
    this.#closed = true;
    this.#queued.length = 0;
  }

  deliver(message: unknown): void {
    if (this.#closed) return;
    if (!this.#started) this.#queued.push(message);
    else this.onmessage?.({ data: message });
  }
}

function channel(): [MemoryPort, MemoryPort] {
  const left = new MemoryPort();
  const right = new MemoryPort();
  left.peer = right;
  right.peer = left;
  return [left, right];
}

function liveSummary(): LiveSurfaceRuntimeSummaryV1 {
  return {
    v: 1,
    surfaceId: FIXTURE_SURFACE_ID,
    state: "live",
    producerEpoch: 1,
    stateRevision: 1,
    capabilities: {
      pointer: true,
      wheel: true,
      keyboard: true,
      textInput: true,
      touch: false,
      rotateDevice: false,
      resizeLogicalViewport: true,
      resizeBackingRaster: true,
      crop: false,
    },
    transport: "shared-texture",
  };
}

function frameMetadata(
  sequence: number,
  width: number,
  height: number,
): LiveSurfaceFrameMetadataV1 {
  return {
    v: 1,
    surfaceId: FIXTURE_SURFACE_ID,
    producerEpoch: 1,
    sequence: String(sequence),
    geometry: {
      revision: 1,
      codedSize: { width, height },
      visibleRect: { x: 0, y: 0, width, height },
      logicalSize: { width, height },
      orientation: 0,
    },
    hostReceivedAtUs: String(Math.max(0, Math.round(performance.now() * 1000))),
    pixelFormat: "bgra",
    colorSpace: "srgb",
    alphaMode: "opaque",
    transport: "shared-texture",
  };
}

/**
 * The moving test pattern.
 *
 * A human eyeball has to be able to tell a LIVE surface from a stalled one at a
 * glance, so this is deliberately unmistakable: a hue that sweeps, a hand that
 * sweeps with it, and a frame counter that only a running producer increments.
 * Colours are HSL rather than hex because these are synthetic capture pixels
 * standing in for someone else's window — they are not VibeField's palette and
 * must not be drawn from its tokens (DESIGN.md).
 */
function paintTestPattern(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  frame: number,
): void {
  const phase = (frame % 120) / 120;
  const hue = Math.round(phase * 360);

  const backdrop = context.createLinearGradient(0, 0, width, height);
  backdrop.addColorStop(0, `hsl(${hue} 62% 22%)`);
  backdrop.addColorStop(1, `hsl(${(hue + 120) % 360} 58% 42%)`);
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.32;
  const angle = phase * Math.PI * 2;

  context.strokeStyle = "hsl(0 0% 100% / 0.35)";
  context.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 90));
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = "hsl(0 0% 100% / 0.9)";
  context.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 45));
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(centerX, centerY);
  context.lineTo(centerX + Math.sin(angle) * radius, centerY - Math.cos(angle) * radius);
  context.stroke();

  context.fillStyle = "hsl(0 0% 100% / 0.85)";
  context.font = `${Math.max(11, Math.round(Math.min(width, height) / 12))}px ui-monospace, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(`frame ${frame}`, centerX, centerY + radius + 18);
}

export interface FixtureSurfaceHostOptions {
  /** Answer the attach, or refuse it. `false` is how the catalog reaches the
   * `lost` face and its retry route without waiting for something to break. */
  readonly grant?: boolean;
  readonly width?: number;
  readonly height?: number;
}

export interface FixtureSurfaceHost {
  /** A REAL pool over a real transport — the object the catalog acquires from. */
  readonly pool: SurfacePool<ProductSurfaceFrame>;
  /** The fixture's authority: a synthetic ticket, never a fieldd mint. */
  readonly tickets: SurfaceTicketSource;
  /** The demand this host has actually been told, newest last. The fold is the
   * pool's; this is the wire. */
  readonly demands: readonly LiveSurfaceDemandV1[];
  /** Fires whenever `demands` grows, so a fixture UI can show the control plane
   * moving as well as the pixels. */
  onDemand(listener: (demand: LiveSurfaceDemandV1) => void): () => void;
  /** Stop the producer, drop the pool, close the ports. Idempotent. */
  dispose(): void;
}

/**
 * Build a fixture host and the pool in front of it.
 *
 * Everything is torn down by `dispose()`, which the catalog calls on unmount:
 * the frame timer stops, the pool disposes (releasing handles and detaching
 * attachments), and the transport closes both ports. Any frame still in flight
 * is closed by the transport or the queue on its way past — a `VideoFrame` that
 * outlived its window would hold a GPU allocation for the life of the tab.
 */
export function createFixtureSurfaceHost(opts: FixtureSurfaceHostOptions = {}): FixtureSurfaceHost {
  const width = opts.width ?? 480;
  const height = opts.height ?? 300;
  const grant = opts.grant ?? true;

  const [rendererControl, hostControl] = channel();
  const [rendererFrames, hostFrames] = channel();
  hostControl.start();
  hostFrames.start();

  const transport = new LiveSurfaceRendererTransport<ProductSurfaceFrame>(
    { v: 1, rendererGeneration: FIXTURE_RENDERER_GENERATION },
    rendererControl,
    rendererFrames,
  );

  const demands: LiveSurfaceDemandV1[] = [];
  const demandListeners = new Set<(demand: LiveSurfaceDemandV1) => void>();
  let attachmentId: string | null = null;
  let attachmentSequence = 0;
  let frameNumber = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let canvas: OffscreenCanvas | null = null;
  let context: OffscreenCanvasRenderingContext2D | null = null;
  let disposed = false;

  const stopProducing = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const produceFrame = (): void => {
    if (disposed || attachmentId === null || canvas === null || context === null) return;
    frameNumber += 1;
    paintTestPattern(context, width, height, frameNumber);
    let frame: ProductSurfaceFrame;
    try {
      frame = new VideoFrame(canvas, { timestamp: frameNumber * FIXTURE_FRAME_INTERVAL_MS * 1000 });
    } catch {
      // A browser that has the constructor but refuses this source. Stop rather
      // than spin: the surface holds its last frame and the caption still says
      // what this is.
      stopProducing();
      return;
    }
    try {
      hostFrames.postMessage({
        type: "frame",
        envelope: { v: 1, attachmentId, metadata: frameMetadata(frameNumber, width, height) },
        frame,
      });
    } catch {
      // The port went away between the paint and the post; the frame never
      // reached a queue that would close it, so close it here.
      frame.close();
      stopProducing();
    }
  };

  const startProducing = (): void => {
    if (timer !== null || disposed || !fixtureSurfacesSupported()) return;
    canvas ??= new OffscreenCanvas(width, height);
    context ??= canvas.getContext("2d");
    if (context === null) return;
    timer = setInterval(produceFrame, FIXTURE_FRAME_INTERVAL_MS);
  };

  hostControl.onmessage = (event): void => {
    const message = event.data as {
      type?: string;
      requestId?: string;
      attachmentId?: string;
      demand?: LiveSurfaceDemandV1;
    };
    if (message.type === "attach" && message.requestId !== undefined) {
      if (!grant) {
        hostControl.postMessage({
          v: 1,
          type: "rejected",
          requestId: message.requestId,
          error: {
            v: 1,
            code: "permission-denied",
            message: "the fixture host refuses this source",
            recovery: "user-action",
          },
        });
        return;
      }
      attachmentSequence += 1;
      attachmentId = `attachment_catalog_fixture_${attachmentSequence}`;
      hostControl.postMessage({
        v: 1,
        type: "attached",
        requestId: message.requestId,
        attachment: { v: 1, attachmentId, summary: liveSummary() },
      });
      startProducing();
      return;
    }
    if (message.type === "demand" && message.demand !== undefined) {
      demands.push(message.demand);
      for (const listener of [...demandListeners]) listener(message.demand);
      return;
    }
    if (message.type === "detach") {
      attachmentId = null;
      stopProducing();
    }
  };

  hostControl.postMessage({
    v: 1,
    type: "ready",
    bootstrap: { v: 1, rendererGeneration: FIXTURE_RENDERER_GENERATION },
  });

  const pool = createSurfacePool<ProductSurfaceFrame>({ transport });

  return {
    pool,
    tickets: {
      // No `surfaceId` on the grant and no `close`: the fixture has no custody
      // plane, and the pool's contract makes that a source that owes nothing.
      mint(): Promise<SurfaceTicketGrant> {
        return Promise.resolve({ ticket: { v: 1, token: FIXTURE_TICKET_TOKEN } });
      },
    },
    demands,
    onDemand(listener): () => void {
      demandListeners.add(listener);
      return () => demandListeners.delete(listener);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopProducing();
      demandListeners.clear();
      pool.dispose();
      transport.dispose();
      hostControl.close();
      hostFrames.close();
      canvas = null;
      context = null;
    },
  };
}
