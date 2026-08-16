import type { LiveSurfaceFrameMetadataV1 } from "@vibefield/contracts";
import type { LiveSurfaceFrameLease } from "../frame-queue";
import type { LiveSurfaceClosableFrame } from "./ports";

export interface LiveSurfaceGpuTexture {
  createView(): unknown;
  destroy(): void;
}

export interface LiveSurfaceGpuQueue<TFrame extends LiveSurfaceClosableFrame> {
  copyExternalImageToTexture(
    source: { source: TFrame; origin: { x: number; y: number } },
    destination: { texture: LiveSurfaceGpuTexture },
    copySize: { width: number; height: number },
  ): void;
}

export interface LiveSurfaceGpuDevice<TFrame extends LiveSurfaceClosableFrame> {
  readonly queue: LiveSurfaceGpuQueue<TFrame>;
  readonly lost?: Promise<unknown>;
  createTexture(descriptor: {
    label: string;
    size: { width: number; height: number };
    format: "rgba8unorm";
    usage: number;
  }): LiveSurfaceGpuTexture;
}

export interface LiveSurfaceTextureSnapshot {
  readonly deviceGeneration: number;
  readonly contentRevision: number;
  readonly width: number;
  readonly height: number;
  readonly texture: LiveSurfaceGpuTexture;
  readonly view: unknown;
  readonly metadata: LiveSurfaceFrameMetadataV1;
}

export type LiveSurfacePresentResult =
  | { readonly kind: "presented"; readonly snapshot: LiveSurfaceTextureSnapshot }
  | {
      readonly kind: "dropped";
      readonly reason: "device-unavailable" | "allocation-failed" | "copy-failed";
    };

interface TextureRecord {
  readonly width: number;
  readonly height: number;
  readonly texture: LiveSurfaceGpuTexture;
  readonly view: unknown;
}

// COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT from the WebGPU bit layout.
const DEFAULT_PRESENTATION_USAGE = 0x02 | 0x04 | 0x10;

/** One stable renderer-owned presentation texture for one active surface. */
export class WebGpuLiveSurfaceTextureStore<
  TFrame extends LiveSurfaceClosableFrame = LiveSurfaceClosableFrame,
> {
  #device: LiveSurfaceGpuDevice<TFrame> | null = null;
  #texture: TextureRecord | null = null;
  #metadata: LiveSurfaceFrameMetadataV1 | null = null;
  #deviceGeneration = 0;
  #contentRevision = 0;
  #closed = false;

  constructor(private readonly usage = DEFAULT_PRESENTATION_USAGE) {}

  get snapshot(): LiveSurfaceTextureSnapshot | null {
    const texture = this.#texture;
    const metadata = this.#metadata;
    if (texture === null || metadata === null) return null;
    return {
      deviceGeneration: this.#deviceGeneration,
      contentRevision: this.#contentRevision,
      width: texture.width,
      height: texture.height,
      texture: texture.texture,
      view: texture.view,
      metadata,
    };
  }

  replaceDevice(device: LiveSurfaceGpuDevice<TFrame>): number {
    if (this.#closed) throw new Error("cannot replace the device of a closed texture store");
    this.destroyTexture();
    this.#device = device;
    this.#deviceGeneration += 1;
    const generation = this.#deviceGeneration;
    void device.lost?.then(
      () => this.markDeviceLost(device, generation),
      () => this.markDeviceLost(device, generation),
    );
    return generation;
  }

  markDeviceLost(
    expectedDevice: LiveSurfaceGpuDevice<TFrame> | null = this.#device,
    expectedGeneration = this.#deviceGeneration,
  ): boolean {
    if (
      this.#closed ||
      expectedDevice === null ||
      this.#device !== expectedDevice ||
      this.#deviceGeneration !== expectedGeneration
    ) {
      return false;
    }
    this.#device = null;
    this.destroyTexture();
    return true;
  }

  present(lease: LiveSurfaceFrameLease<TFrame>): LiveSurfacePresentResult {
    try {
      if (this.#closed || this.#device === null) {
        return { kind: "dropped", reason: "device-unavailable" };
      }
      const queued = lease.frame;
      const metadata = queued.metadata;
      const rect = metadata.geometry.visibleRect;
      const existing = this.#texture;
      const replacementNeeded =
        existing === null || existing.width !== rect.width || existing.height !== rect.height;
      let candidate = existing;
      if (replacementNeeded) {
        let texture: LiveSurfaceGpuTexture | null = null;
        try {
          texture = this.#device.createTexture({
            label: `vibefield-live-surface-${metadata.surfaceId}`,
            size: { width: rect.width, height: rect.height },
            format: "rgba8unorm",
            usage: this.usage,
          });
          candidate = {
            width: rect.width,
            height: rect.height,
            texture,
            view: texture.createView(),
          };
        } catch {
          try {
            texture?.destroy();
          } catch {
            // A device-lost allocation may already be invalid.
          }
          return { kind: "dropped", reason: "allocation-failed" };
        }
      }
      if (candidate === null) throw new Error("live surface texture candidate is unavailable");
      try {
        this.#device.queue.copyExternalImageToTexture(
          { source: queued.value, origin: { x: rect.x, y: rect.y } },
          { texture: candidate.texture },
          { width: rect.width, height: rect.height },
        );
      } catch {
        if (candidate !== existing) {
          try {
            candidate.texture.destroy();
          } catch {
            // The copy failure may have invalidated the device too.
          }
        }
        return { kind: "dropped", reason: "copy-failed" };
      }
      if (candidate !== existing) {
        this.#texture = candidate;
        existing?.texture.destroy();
      }
      this.#metadata = metadata;
      this.#contentRevision += 1;
      const snapshot = this.snapshot;
      if (snapshot === null) throw new Error("presented texture snapshot was not committed");
      return { kind: "presented", snapshot };
    } finally {
      lease.release();
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#device = null;
    this.destroyTexture();
  }

  private destroyTexture(): void {
    const texture = this.#texture;
    this.#texture = null;
    this.#metadata = null;
    try {
      texture?.texture.destroy();
    } catch {
      // Device teardown may already have invalidated the texture.
    }
  }
}
