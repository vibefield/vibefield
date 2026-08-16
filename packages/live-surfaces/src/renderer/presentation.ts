import type {
  LiveSurfaceDemandV1,
  LiveSurfaceFrameMetadataV1,
  LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import type { LiveSurfaceFrameQueueStats } from "../frame-queue";
import type { LiveSurfaceClosableFrame } from "./ports";
import {
  type LiveSurfaceGpuDevice,
  type LiveSurfacePresentResult,
  type LiveSurfaceTextureSnapshot,
  WebGpuLiveSurfaceTextureStore,
} from "./texture-store";
import type { LiveSurfaceRendererAttachment } from "./transport";

export type LiveSurfacePresentationTickResult =
  | { readonly kind: "idle" }
  | LiveSurfacePresentResult;

export interface LiveSurfacePresentationStats {
  readonly ticks: number;
  readonly idleTicks: number;
  readonly presented: number;
  readonly droppedDeviceUnavailable: number;
  readonly droppedAllocationFailed: number;
  readonly droppedCopyFailed: number;
}

export interface LiveSurfacePresentationTextureSupportSnapshot {
  readonly deviceGeneration: number;
  readonly contentRevision: number;
  readonly width: number;
  readonly height: number;
  readonly producerEpoch: number;
  readonly sequence: string;
  readonly geometryRevision: number;
  readonly transport: LiveSurfaceFrameMetadataV1["transport"];
  readonly pixelFormat: LiveSurfaceFrameMetadataV1["pixelFormat"];
}

/** Serializable, handle-free evidence suitable for diagnostics and support bundles. */
export interface LiveSurfacePresentationSupportSnapshot {
  readonly v: 1;
  readonly surfaceId: string;
  readonly attachmentId: string;
  readonly closed: boolean;
  readonly summary: LiveSurfaceRuntimeSummaryV1;
  readonly frameQueue: LiveSurfaceFrameQueueStats;
  readonly texture: LiveSurfacePresentationTextureSupportSnapshot | null;
  readonly stats: LiveSurfacePresentationStats;
}

function textureSupportSnapshot(
  snapshot: LiveSurfaceTextureSnapshot | null,
): LiveSurfacePresentationTextureSupportSnapshot | null {
  if (snapshot === null) return null;
  return {
    deviceGeneration: snapshot.deviceGeneration,
    contentRevision: snapshot.contentRevision,
    width: snapshot.width,
    height: snapshot.height,
    producerEpoch: snapshot.metadata.producerEpoch,
    sequence: snapshot.metadata.sequence,
    geometryRevision: snapshot.metadata.geometry.revision,
    transport: snapshot.metadata.transport,
    pixelFormat: snapshot.metadata.pixelFormat,
  };
}

/**
 * Narrow renderer consumer boundary. Future attachment-pool code supplies the
 * authorized attachment; future canvas/ICE code supplies demand, a WebGPU
 * device, and render ticks. Neither side receives source or control authority.
 */
export class LiveSurfacePresentation<
  TFrame extends LiveSurfaceClosableFrame = LiveSurfaceClosableFrame,
> {
  readonly #textures: WebGpuLiveSurfaceTextureStore<TFrame>;
  #closed = false;
  #ticks = 0;
  #idleTicks = 0;
  #presented = 0;
  #droppedDeviceUnavailable = 0;
  #droppedAllocationFailed = 0;
  #droppedCopyFailed = 0;

  constructor(
    private readonly attachment: LiveSurfaceRendererAttachment<TFrame>,
    textures?: WebGpuLiveSurfaceTextureStore<TFrame>,
  ) {
    this.#textures = textures ?? new WebGpuLiveSurfaceTextureStore<TFrame>();
  }

  get surfaceId(): string {
    return this.attachment.surfaceId;
  }

  get attachmentId(): string {
    return this.attachment.attachmentId;
  }

  get closed(): boolean {
    return this.#closed || this.attachment.closed;
  }

  get summary(): LiveSurfaceRuntimeSummaryV1 {
    return this.attachment.summary;
  }

  /** GPU-bearing snapshot for the renderer compositor only. */
  get snapshot(): LiveSurfaceTextureSnapshot | null {
    return this.#textures.snapshot;
  }

  get stats(): LiveSurfacePresentationStats {
    return {
      ticks: this.#ticks,
      idleTicks: this.#idleTicks,
      presented: this.#presented,
      droppedDeviceUnavailable: this.#droppedDeviceUnavailable,
      droppedAllocationFailed: this.#droppedAllocationFailed,
      droppedCopyFailed: this.#droppedCopyFailed,
    };
  }

  setDemand(demand: LiveSurfaceDemandV1): void {
    if (this.#closed) throw new Error("cannot set demand on a closed live surface presentation");
    this.attachment.setDemand(demand);
  }

  replaceDevice(device: LiveSurfaceGpuDevice<TFrame>): number {
    if (this.#closed) throw new Error("cannot replace the device of a closed presentation");
    return this.#textures.replaceDevice(device);
  }

  /** Consumes at most the one latest pending frame and always releases its lease. */
  presentLatest(): LiveSurfacePresentationTickResult {
    this.#ticks += 1;
    const lease = this.attachment.takeFrame();
    if (lease === null) {
      this.#idleTicks += 1;
      return { kind: "idle" };
    }
    const result = this.#textures.present(lease);
    if (result.kind === "presented") {
      this.#presented += 1;
      return result;
    }
    switch (result.reason) {
      case "device-unavailable":
        this.#droppedDeviceUnavailable += 1;
        break;
      case "allocation-failed":
        this.#droppedAllocationFailed += 1;
        break;
      case "copy-failed":
        this.#droppedCopyFailed += 1;
        break;
    }
    return result;
  }

  onSummary(listener: (summary: LiveSurfaceRuntimeSummaryV1) => void): () => void {
    return this.attachment.onSummary(listener);
  }

  supportSnapshot(): LiveSurfacePresentationSupportSnapshot {
    return {
      v: 1,
      surfaceId: this.surfaceId,
      attachmentId: this.attachmentId,
      closed: this.closed,
      summary: this.summary,
      frameQueue: this.attachment.frameStats,
      texture: textureSupportSnapshot(this.#textures.snapshot),
      stats: this.stats,
    };
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.attachment.dispose();
    this.#textures.close();
  }
}
