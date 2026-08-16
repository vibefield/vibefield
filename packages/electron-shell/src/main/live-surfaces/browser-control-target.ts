/**
 * Optional Browser control-plane identity. This registry is main-private: Live
 * Surfaces frame contracts deliberately never carry CDP target material.
 */

export interface BrowserControlTargetWebContents {
  readonly id: number;
  isDestroyed(): boolean;
  getOrCreateDevToolsTargetId(): string;
  once(event: "destroyed", listener: () => void): this;
  off(event: "destroyed", listener: () => void): this;
}

export interface BrowserControlTargetBinding {
  readonly surfaceId: string;
  readonly producerEpoch: number;
  readonly controlBindingRevision: number;
  readonly webContentsId: number;
  readonly targetId: string;
  readonly contents: BrowserControlTargetWebContents;
}

export interface BrowserControlTargetStatus {
  readonly surfaceId: string;
  readonly controlBindingRevision: number;
  readonly bound: boolean;
  readonly producerEpoch?: number;
  readonly webContentsId?: number;
}

interface BrowserControlTargetEntry {
  revision: number;
  binding: BrowserControlTargetBinding | null;
  destroyedListener: (() => void) | null;
}

export interface BrowserControlTargetRegistryOptions {
  /** Electron's `webContents.fromDevToolsTargetId`, injected for unit tests. */
  readonly resolveTarget: (targetId: string) => BrowserControlTargetWebContents | undefined;
}

function incrementRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("browser control binding revision exhausted its safe integer range");
  }
  return value + 1;
}

function validTargetId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

/** Main-process broker seam between a Browser pixel source and a future control broker. */
export class BrowserControlTargetRegistry {
  readonly #entries = new Map<string, BrowserControlTargetEntry>();

  constructor(readonly options: BrowserControlTargetRegistryOptions) {}

  associate(
    surfaceId: string,
    producerEpoch: number,
    contents: BrowserControlTargetWebContents,
  ): BrowserControlTargetBinding {
    if (!Number.isSafeInteger(producerEpoch) || producerEpoch <= 0) {
      throw new RangeError("browser control binding requires a positive producer epoch");
    }
    if (!Number.isSafeInteger(contents.id) || contents.id <= 0 || contents.isDestroyed()) {
      throw new Error("browser control binding requires live WebContents");
    }
    const targetId = contents.getOrCreateDevToolsTargetId();
    if (!validTargetId(targetId) || this.options.resolveTarget(targetId) !== contents) {
      throw new Error("Electron did not reverse-resolve the exact Browser control target");
    }

    const existing = this.#entries.get(surfaceId);
    if (
      existing?.binding !== null &&
      existing?.binding !== undefined &&
      existing.binding.producerEpoch === producerEpoch &&
      existing.binding.contents === contents &&
      existing.binding.targetId === targetId
    ) {
      return existing.binding;
    }
    if (existing?.binding !== null && existing?.binding !== undefined) {
      this.revokeBinding(existing, existing.binding.contents);
    }
    const entry = existing ?? { revision: 0, binding: null, destroyedListener: null };
    entry.revision = incrementRevision(entry.revision);
    const binding: BrowserControlTargetBinding = {
      surfaceId,
      producerEpoch,
      controlBindingRevision: entry.revision,
      webContentsId: contents.id,
      targetId,
      contents,
    };
    const destroyedListener = () => {
      const current = this.#entries.get(surfaceId);
      if (current?.binding === binding) this.revokeBinding(current, contents);
    };
    entry.binding = binding;
    entry.destroyedListener = destroyedListener;
    this.#entries.set(surfaceId, entry);
    contents.once("destroyed", destroyedListener);
    return binding;
  }

  /**
   * Returns control material only while Electron still resolves the exact same
   * target object. A failed reverse lookup revokes the stale association.
   */
  lookupPrivate(surfaceId: string): BrowserControlTargetBinding | null {
    const entry = this.#entries.get(surfaceId);
    const binding = entry?.binding;
    if (entry === undefined || binding === null || binding === undefined) return null;
    if (
      binding.contents.isDestroyed() ||
      this.options.resolveTarget(binding.targetId) !== binding.contents
    ) {
      this.revokeBinding(entry, binding.contents);
      return null;
    }
    return binding;
  }

  status(surfaceId: string): BrowserControlTargetStatus {
    const binding = this.lookupPrivate(surfaceId);
    const entry = this.#entries.get(surfaceId);
    if (binding === null) {
      return {
        surfaceId,
        controlBindingRevision: entry?.revision ?? 0,
        bound: false,
      };
    }
    return {
      surfaceId,
      controlBindingRevision: binding.controlBindingRevision,
      bound: true,
      producerEpoch: binding.producerEpoch,
      webContentsId: binding.webContentsId,
    };
  }

  revoke(surfaceId: string, expectedContents?: BrowserControlTargetWebContents): boolean {
    const entry = this.#entries.get(surfaceId);
    if (entry?.binding === null || entry?.binding === undefined) return false;
    if (expectedContents !== undefined && entry.binding.contents !== expectedContents) return false;
    this.revokeBinding(entry, entry.binding.contents);
    return true;
  }

  clear(): void {
    for (const entry of this.#entries.values()) {
      if (entry.binding !== null) this.revokeBinding(entry, entry.binding.contents);
    }
    this.#entries.clear();
  }

  private revokeBinding(
    entry: BrowserControlTargetEntry,
    expectedContents: BrowserControlTargetWebContents,
  ): void {
    if (entry.binding?.contents !== expectedContents) return;
    const listener = entry.destroyedListener;
    entry.binding = null;
    entry.destroyedListener = null;
    entry.revision = incrementRevision(entry.revision);
    if (listener !== null) expectedContents.off("destroyed", listener);
  }
}
