import { LiveSurfaceFrameEnvelopeV1, LiveSurfaceFrameMetadataV1 } from "@vibefield/contracts";

export type LiveSurfaceMainFrameDropReason =
  | "closed"
  | "transfer-cap"
  | "not-demanded"
  | "stale-epoch"
  | "stale-sequence"
  | "protocol-violation"
  | "import-failed"
  | "lease-timeout";

export interface LiveSurfaceProducerTextureFrame {
  readonly metadata: LiveSurfaceFrameMetadataV1;
  readonly textureInfo: Electron.SharedTextureImportTextureInfo;
  /** Releases the producer's import wrapper immediately after import or drop. */
  releaseSource(reason: "imported" | LiveSurfaceMainFrameDropReason): void;
  /**
   * Releases the producer/helper lease. `lease-timeout` is bounded teardown,
   * not proof that native references vanished; a reusable native slot must be
   * quarantined until its source session is destroyed.
   */
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
  readonly peakOutstanding: number;
  readonly completed: number;
  readonly timedOut: number;
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
  closeAndDrain(timeoutMs?: number): Promise<"drained" | "timed-out">;
}

export interface LiveSurfaceTextureTransferBudgetStats {
  readonly outstanding: number;
  readonly peakOutstanding: number;
  readonly maximum: number;
}

interface LiveSurfaceTextureTransferBudgetLease {
  release(): void;
}

/** Shared admission cap. One instance is retained per surface across renderer generations. */
export class LiveSurfaceTextureTransferBudget {
  #outstanding = 0;
  #peakOutstanding = 0;

  constructor(readonly maximum = 2) {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new RangeError("texture transfer budget must be a positive safe integer");
    }
  }

  get stats(): LiveSurfaceTextureTransferBudgetStats {
    return {
      outstanding: this.#outstanding,
      peakOutstanding: this.#peakOutstanding,
      maximum: this.maximum,
    };
  }

  tryAcquire(): LiveSurfaceTextureTransferBudgetLease | null {
    if (this.#outstanding >= this.maximum) return null;
    this.#outstanding += 1;
    this.#peakOutstanding = Math.max(this.#peakOutstanding, this.#outstanding);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.#outstanding -= 1;
      },
    };
  }
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
  #timedOut = 0;
  #sendFailures = 0;
  #releaseFaults = 0;
  readonly #drainWaiters = new Set<() => void>();
  readonly #outstandingTransfers = new Set<() => void>();
  readonly #budget: LiveSurfaceTextureTransferBudget;

  constructor(
    readonly surfaceId: string,
    readonly attachmentId: string,
    readonly api: LiveSurfaceTextureTransferApi,
    readonly maxOutstanding = 2,
    budget?: LiveSurfaceTextureTransferBudget,
  ) {
    if (!Number.isSafeInteger(maxOutstanding) || maxOutstanding <= 0) {
      throw new RangeError("texture transfer cap must be a positive safe integer");
    }
    this.#budget = budget ?? new LiveSurfaceTextureTransferBudget(maxOutstanding);
  }

  get stats(): LiveSurfaceTextureForwarderStats {
    return {
      offered: this.#offered,
      accepted: this.#accepted,
      dropped: this.#dropped,
      outstanding: this.#outstanding,
      peakOutstanding: this.#budget.stats.peakOutstanding,
      completed: this.#completed,
      timedOut: this.#timedOut,
      sendFailures: this.#sendFailures,
      releaseFaults: this.#releaseFaults,
    };
  }

  offer(frame: LiveSurfaceProducerTextureFrame): LiveSurfaceTextureOfferResult {
    this.#offered += 1;
    if (this.#closed) return this.drop(frame, "closed");
    if (this.#outstanding >= this.maxOutstanding) return this.drop(frame, "transfer-cap");
    const metadata = LiveSurfaceFrameMetadataV1.safeParse(frame.metadata);
    if (
      !metadata.success ||
      metadata.data.surfaceId !== this.surfaceId ||
      metadata.data.transport !== "shared-texture"
    ) {
      return this.drop(frame, "protocol-violation");
    }
    const envelope = LiveSurfaceFrameEnvelopeV1.safeParse({
      v: 1,
      attachmentId: this.attachmentId,
      metadata: metadata.data,
    });
    if (!envelope.success) return this.drop(frame, "protocol-violation");
    const budgetLease = this.#budget.tryAcquire();
    if (budgetLease === null) return this.drop(frame, "transfer-cap");

    let sourceReleased = false;
    let allReleased = false;
    let abortOutstanding = (): void => undefined;
    const releaseSource = (reason: "imported" | LiveSurfaceMainFrameDropReason): void => {
      if (sourceReleased) return;
      sourceReleased = true;
      try {
        frame.releaseSource(reason);
      } catch {
        this.#releaseFaults += 1;
      }
    };
    const releaseAll = (reason: "released" | "lease-timeout"): void => {
      if (allReleased) return;
      allReleased = true;
      this.#outstanding -= 1;
      if (reason === "released") this.#completed += 1;
      else this.#timedOut += 1;
      budgetLease.release();
      this.#outstandingTransfers.delete(abortOutstanding);
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
      if (!allReleased) {
        allReleased = true;
        this.#outstanding -= 1;
        budgetLease.release();
        try {
          frame.allReferencesReleased("import-failed");
        } catch {
          this.#releaseFaults += 1;
        }
      }
      releaseSource("import-failed");
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
    abortOutstanding = (): void => {
      releaseImported();
      releaseAll("lease-timeout");
    };
    if (!allReleased) this.#outstandingTransfers.add(abortOutstanding);
    const transfer = Promise.resolve()
      .then(() => this.api.sendTexture(imported, envelope.data))
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

  async closeAndDrain(timeoutMs = 2_000): Promise<"drained" | "timed-out"> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
      throw new RangeError("texture drain timeout must be a non-negative safe integer");
    }
    this.close();
    if (this.#outstanding === 0) return "drained";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const outcome = await Promise.race([
      this.whenDrained().then(() => "drained" as const),
      new Promise<"timed-out">((resolve) => {
        timer = setTimeout(() => resolve("timed-out"), timeoutMs);
      }),
    ]);
    if (timer !== null) clearTimeout(timer);
    if (outcome === "drained") return outcome;
    for (const abort of [...this.#outstandingTransfers]) abort();
    await this.whenDrained();
    return "timed-out";
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
