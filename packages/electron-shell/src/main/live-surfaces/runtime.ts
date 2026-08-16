import type {
  LiveSurfaceDemandV1,
  LiveSurfaceFrameMetadataV1,
  LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import type {
  LiveSurfaceProducerTextureFrame,
  LiveSurfaceTextureOfferResult,
} from "./texture-forwarder";
import type { LiveSurfacePresentationOperation } from "./ticket-table";

export interface LiveSurfaceCpuFrame {
  readonly metadata: LiveSurfaceFrameMetadataV1;
  /** Tightly packed four-byte pixels in metadata.pixelFormat order. */
  readonly pixels: Uint8Array;
}

export interface LiveSurfaceRuntimeAttachContext {
  readonly attachmentId: string;
  readonly rendererGeneration: number;
  readonly operations: readonly LiveSurfacePresentationOperation[];
  publishSummary(summary: LiveSurfaceRuntimeSummaryV1): void;
  publishCpuFrame(frame: LiveSurfaceCpuFrame): boolean;
  /**
   * Transfers ownership of one producer texture frame to the presentation host.
   * Both producer callbacks are completed on every accepted or dropped path.
   */
  offerTextureFrame(frame: LiveSurfaceProducerTextureFrame): LiveSurfaceTextureOfferResult;
}

export interface LiveSurfaceRuntimeAttachment {
  readonly summary: LiveSurfaceRuntimeSummaryV1;
  setDemand(demand: LiveSurfaceDemandV1): void;
  dispose(): void;
}

/** Main-private source/runtime authority stored behind one attach ticket. */
export interface LiveSurfaceRuntimeAuthority {
  readonly surfaceId: string;
  attach(context: LiveSurfaceRuntimeAttachContext): LiveSurfaceRuntimeAttachment;
}
