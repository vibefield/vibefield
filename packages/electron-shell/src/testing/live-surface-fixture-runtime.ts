import type {
  LiveSurfaceDemandV1,
  LiveSurfaceFrameMetadataV1,
  LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import type {
  LiveSurfaceRuntimeAttachContext,
  LiveSurfaceRuntimeAttachment,
  LiveSurfaceRuntimeAuthority,
} from "../main/live-surfaces/runtime";
import { LIVE_SURFACE_LAB_SURFACE_ID } from "./live-surface-lab-contract";

const WIDTH = 320;
const HEIGHT = 180;
const PRODUCER_EPOCH = 1;

const GEOMETRY = {
  revision: 1,
  codedSize: { width: WIDTH, height: HEIGHT },
  visibleRect: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  logicalSize: { width: WIDTH, height: HEIGHT },
  orientation: 0,
} as const;

const CAPABILITIES = {
  pointer: false,
  wheel: false,
  keyboard: false,
  textInput: false,
  touch: false,
  rotateDevice: false,
  resizeLogicalViewport: false,
  resizeBackingRaster: false,
  crop: false,
} as const;

export interface LiveSurfaceFixtureStats {
  readonly attachments: number;
  readonly disposedAttachments: number;
  readonly demandUpdates: number;
  readonly offered: number;
  readonly accepted: number;
}

/** Deterministic CPU producer used only by the standalone LSF-2 Electron lab. */
export class LiveSurfaceFixtureRuntime implements LiveSurfaceRuntimeAuthority {
  readonly surfaceId = LIVE_SURFACE_LAB_SURFACE_ID;
  #attachments = 0;
  #disposedAttachments = 0;
  #demandUpdates = 0;
  #offered = 0;
  #accepted = 0;
  #sequence = 0n;

  get stats(): LiveSurfaceFixtureStats {
    return {
      attachments: this.#attachments,
      disposedAttachments: this.#disposedAttachments,
      demandUpdates: this.#demandUpdates,
      offered: this.#offered,
      accepted: this.#accepted,
    };
  }

  attach(context: LiveSurfaceRuntimeAttachContext): LiveSurfaceRuntimeAttachment {
    this.#attachments += 1;
    return new LiveSurfaceFixtureAttachment(
      context,
      () => this.nextFrame(),
      () => {
        this.#demandUpdates += 1;
      },
      (accepted) => {
        this.#offered += 1;
        if (accepted) this.#accepted += 1;
      },
      () => {
        this.#disposedAttachments += 1;
      },
    );
  }

  private nextFrame(): { metadata: LiveSurfaceFrameMetadataV1; pixels: Uint8Array } {
    this.#sequence += 1n;
    const sequence = this.#sequence;
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    const phase = Number(sequence % 256n);
    const stripe = Number((sequence * 7n) % BigInt(WIDTH));
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const offset = (y * WIDTH + x) * 4;
        const inStripe = Math.abs(x - stripe) < 12;
        const onGrid = x % 40 === 0 || y % 30 === 0;
        pixels[offset] = inStripe ? 255 : (x + phase) & 0xff;
        pixels[offset + 1] = onGrid ? 235 : (y * 2 + phase) & 0xff;
        pixels[offset + 2] = inStripe ? 90 : (x + y + phase * 2) & 0xff;
        pixels[offset + 3] = 255;
      }
    }
    return {
      metadata: {
        v: 1,
        surfaceId: this.surfaceId,
        producerEpoch: PRODUCER_EPOCH,
        sequence: sequence.toString(),
        geometry: GEOMETRY,
        hostReceivedAtUs: (process.hrtime.bigint() / 1_000n).toString(),
        pixelFormat: "rgba",
        colorSpace: "srgb",
        alphaMode: "opaque",
        transport: "cpu-bgra",
        degradedMode: "cpu-bitmap",
      },
      pixels,
    };
  }
}

class LiveSurfaceFixtureAttachment implements LiveSurfaceRuntimeAttachment {
  #stateRevision = 1;
  #lastDemandRevision = -1;
  #timer: ReturnType<typeof setInterval> | null = null;
  #closed = false;
  #summary: LiveSurfaceRuntimeSummaryV1 = {
    v: 1,
    surfaceId: LIVE_SURFACE_LAB_SURFACE_ID,
    state: "paused",
    producerEpoch: PRODUCER_EPOCH,
    stateRevision: this.#stateRevision,
    capabilities: CAPABILITIES,
    transport: "cpu-bgra",
    geometry: GEOMETRY,
  };

  constructor(
    readonly context: LiveSurfaceRuntimeAttachContext,
    readonly makeFrame: () => { metadata: LiveSurfaceFrameMetadataV1; pixels: Uint8Array },
    readonly onDemand: () => void,
    readonly onFrame: (accepted: boolean) => void,
    readonly onDispose: () => void,
  ) {}

  get summary(): LiveSurfaceRuntimeSummaryV1 {
    return this.#summary;
  }

  setDemand(demand: LiveSurfaceDemandV1): void {
    if (this.#closed || demand.revision <= this.#lastDemandRevision) return;
    this.#lastDemandRevision = demand.revision;
    this.onDemand();
    this.stopFrames();
    this.#stateRevision += 1;
    this.#summary = {
      ...this.#summary,
      state: demand.mode,
      stateRevision: this.#stateRevision,
    };
    this.context.publishSummary(this.#summary);
    if (demand.mode !== "live") return;
    const emit = (): void => {
      if (this.#closed || this.#summary.state !== "live") return;
      this.onFrame(this.context.publishCpuFrame(this.makeFrame()));
    };
    emit();
    this.#timer = setInterval(emit, Math.max(1, Math.round(1_000 / demand.targetFps)));
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.stopFrames();
    this.onDispose();
  }

  private stopFrames(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }
}
