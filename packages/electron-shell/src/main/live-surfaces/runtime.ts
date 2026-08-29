import type {
  LiveSurfaceDemandV1,
  LiveSurfaceFrameMetadataV1,
  LiveSurfaceInputEventV1,
  LiveSurfaceNavigationCommandV1,
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
  /**
   * The DT-D6 human input lane. Absent on view-only runtimes (capture,
   * Simulator) — the control session forwards only after the ticket's
   * operation gate, and a runtime without the member is a silent drop, never
   * a fault. Fire-and-forget: the runtime owns staleness (an event whose
   * `geometryRevision` is not the CURRENT geometry is dropped, never
   * re-mapped) and swallows its own dispatch failures.
   */
  dispatchInput?(input: LiveSurfaceInputEventV1, geometryRevision: number): void;
  /** Chrome navigation (browser runtimes). Same optionality and fire-and-forget contract. */
  navigate?(command: LiveSurfaceNavigationCommandV1): void;
  dispose(): void;
}

/** Main-private source/runtime authority stored behind one attach ticket. */
export interface LiveSurfaceRuntimeAuthority {
  readonly surfaceId: string;
  attach(context: LiveSurfaceRuntimeAttachContext): LiveSurfaceRuntimeAttachment;
}
