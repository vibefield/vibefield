import type {
  LiveSurfaceDemandV1,
  LiveSurfaceDeviceCommandV1,
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
  /**
   * PT-S2 — a bound simulator face's act (boot, create, show, retry, Open Settings), on its own `device` operation.
   * Same optionality and fire-and-forget contract: absent on every other runtime, and an act its device's condition does
   * not offer is the runtime's silent no-op (the face races the summary), never a fault.
   */
  device?(command: LiveSurfaceDeviceCommandV1): void;
  /**
   * EY-1 (1g, 2026-11-19; EY-L2, "your hand wins") — the person picked this page up (`true`) or put it down
   * (`false`), on the `pointer` grant of a browser page's attachment. Same optionality and fire-and-forget contract:
   * absent on every runtime that is not a browser page's. The producer folds every attachment's hold into one (any
   * held), and an agent's act window closes at once on the held edge.
   */
  hold?(held: boolean): void;
  dispose(): void;
}

/** Main-private source/runtime authority stored behind one attach ticket. */
export interface LiveSurfaceRuntimeAuthority {
  readonly surfaceId: string;
  attach(context: LiveSurfaceRuntimeAttachContext): LiveSurfaceRuntimeAttachment;
}
