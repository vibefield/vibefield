import { LiveSurfaceFrameEnvelopeV1, LiveSurfaceFrameMetadataV1 } from "@vibefield/contracts";

export type LiveSurfaceMainFrameDropReason =
  | "closed"
  | "transfer-cap"
  | "protocol-violation"
  | "import-failed";

export interface LiveSurfaceProducerTextureFrame {
  readonly metadata: LiveSurfaceFrameMetadataV1;
  readonly textureInfo: Electron.SharedTextureImportTextureInfo;
  /** Releases the producer's import wrapper immediately after import or drop. */
  releaseSource(reason: "imported" | LiveSurfaceMainFrameDropReason): void;
  /** Releases the producer/helper lease once every imported reference is gone. */
  allReferencesReleased(reason: "released" | LiveSurfaceMainFrameDropReason): void;
}

export interface LiveSurfaceImportedTexture {
  release(): void;
}

export interface LiveSurfaceTextureTransferApi {
  importTexture(
    textureInfo: Electron.SharedTextureImportTextureInfo,
    allReferencesReleased: () => void,
  ): LiveSurfaceImportedTexture;
  sendTexture(imported: LiveSurfaceImportedTexture, envelope: unknown): Promise<void>;
}

export interface LiveSurfaceTextureForwarderStats {
  readonly offered: number;
  readonly accepted: number;
  readonly dropped: number;
  readonly outstanding: number;
  readonly completed: number;
  readonly sendFailures: number;
  readonly releaseFaults: number;
}

export type LiveSurfaceTextureOfferResult =
  | { readonly kind: "accepted"; readonly transfer: Promise<void> }
  | { readonly kind: "dropped"; readonly reason: LiveSurfaceMainFrameDropReason };

export interface LiveSurfaceTextureFrameSink {
  readonly stats: LiveSurfaceTextureForwarderStats;
  offer(frame: LiveSurfaceProducerTextureFrame): LiveSurfaceTextureOfferResult;
  close(): void;
  whenDrained(): Promise<void>;
}

/** Drops a frame before it reaches a concrete forwarder while preserving ownership. */
export function dropLiveSurfaceTextureFrame(
  frame: LiveSurfaceProducerTextureFrame,
  reason: LiveSurfaceMainFrameDropReason,
): LiveSurfaceTextureOfferResult {
  try {
    frame.releaseSource(reason);
  } catch {
    // There is no forwarder stats owner on this pre-commit/unsupported path.
  }
  try {
    frame.allReferencesReleased(reason);
  } catch {
    // Both producer leases are best-effort and independently released.
  }
  return { kind: "dropped", reason };
}

/** Main-process import/send cap for one surface. Outstanding means all refs, not send calls. */
export class LiveSurfaceTextureForwarder implements LiveSurfaceTextureFrameSink {
  #closed = false;
  #offered = 0;
  #accepted = 0;
  #dropped = 0;
  #outstanding = 0;
  #completed = 0;
  #sendFailures = 0;
  #releaseFaults = 0;
  readonly #drainWaiters = new Set<() => void>();

  constructor(
    readonly surfaceId: string,
    readonly attachmentId: string,
    readonly api: LiveSurfaceTextureTransferApi,
    readonly maxOutstanding = 2,
  ) {
    if (!Number.isSafeInteger(maxOutstanding) || maxOutstanding <= 0) {
      throw new RangeError("texture transfer cap must be a positive safe integer");
    }
  }

  get stats(): LiveSurfaceTextureForwarderStats {
    return {
      offered: this.#offered,
      accepted: this.#accepted,
      dropped: this.#dropped,
      outstanding: this.#outstanding,
      completed: this.#completed,
      sendFailures: this.#sendFailures,
      releaseFaults: this.#releaseFaults,
    };
  }

  offer(frame: LiveSurfaceProducerTextureFrame): LiveSurfaceTextureOfferResult {
    this.#offered += 1;
    if (this.#closed) return this.drop(frame, "closed");
    if (this.#outstanding >= this.maxOutstanding) return this.drop(frame, "transfer-cap");
    const metadata = LiveSurfaceFrameMetadataV1.safeParse(frame.metadata);
    if (!metadata.success || metadata.data.surfaceId !== this.surfaceId) {
      return this.drop(frame, "protocol-violation");
    }
    const envelope = LiveSurfaceFrameEnvelopeV1.parse({
      v: 1,
      attachmentId: this.attachmentId,
      metadata: metadata.data,
    });

    let sourceReleased = false;
    let allReleased = false;
    const releaseSource = (reason: "imported" | LiveSurfaceMainFrameDropReason): void => {
      if (sourceReleased) return;
      sourceReleased = true;
      try {
        frame.releaseSource(reason);
      } catch {
        this.#releaseFaults += 1;
      }
    };
    const releaseAll = (reason: "released" | LiveSurfaceMainFrameDropReason): void => {
      if (allReleased) return;
      allReleased = true;
      if (reason === "released") {
        this.#outstanding -= 1;
        this.#completed += 1;
      }
      try {
        frame.allReferencesReleased(reason);
      } catch {
        this.#releaseFaults += 1;
      }
      this.resolveDrain();
    };

    this.#outstanding += 1;
    let imported: LiveSurfaceImportedTexture;
    try {
      imported = this.api.importTexture(frame.textureInfo, () => releaseAll("released"));
    } catch {
      this.#outstanding -= 1;
      releaseSource("import-failed");
      releaseAll("import-failed");
      this.#dropped += 1;
      this.resolveDrain();
      return { kind: "dropped", reason: "import-failed" };
    }
    releaseSource("imported");
    this.#accepted += 1;
    let importedReleased = false;
    const releaseImported = (): void => {
      if (importedReleased) return;
      importedReleased = true;
      try {
        imported.release();
      } catch {
        this.#releaseFaults += 1;
      }
    };
    const transfer = Promise.resolve()
      .then(() => this.api.sendTexture(imported, envelope))
      .catch((error: unknown) => {
        this.#sendFailures += 1;
        throw error;
      })
      .finally(releaseImported);
    // The forwarder owns bookkeeping even when the caller ignores a failed send.
    void transfer.catch(() => undefined);
    return { kind: "accepted", transfer };
  }

  close(): void {
    this.#closed = true;
    this.resolveDrain();
  }

  whenDrained(): Promise<void> {
    if (this.#outstanding === 0) return Promise.resolve();
    return new Promise((resolve) => this.#drainWaiters.add(resolve));
  }

  private drop(
    frame: LiveSurfaceProducerTextureFrame,
    reason: LiveSurfaceMainFrameDropReason,
  ): LiveSurfaceTextureOfferResult {
    this.#dropped += 1;
    try {
      frame.releaseSource(reason);
    } catch {
      this.#releaseFaults += 1;
    }
    try {
      frame.allReferencesReleased(reason);
    } catch {
      this.#releaseFaults += 1;
    }
    return { kind: "dropped", reason };
  }

  private resolveDrain(): void {
    if (this.#outstanding !== 0) return;
    for (const resolve of this.#drainWaiters) resolve();
    this.#drainWaiters.clear();
  }
}
