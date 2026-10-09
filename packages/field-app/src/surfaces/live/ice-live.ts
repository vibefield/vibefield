// ICE's LIVE FACE shapes (design-019 §3 — `@vibecook/ice/desk/kit`'s `live.ts` in `0.16.0-portals.1`), as the desk's LIVE
// service implements them. PT-2 is written against them before that release is on npm: this file states them structurally,
// exactly as ICE's kit declares them, and becomes a re-export of ICE's own at the pin — nothing else of the service moves then.

/** A rectangle of a source in its own pixels — a `VideoFrame`'s `visibleRect`. */
export interface LiveRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a host presents to a face; a `VideoFrame` is CLOSED by the writer once its copy is made. */
export type LiveImage = VideoFrame | ImageBitmap | OffscreenCanvas | HTMLCanvasElement | ImageData;

/** What a kind reads: a stable texture, its size, the counters that say when to rebind or make its mips again. */
export interface LiveTexture {
  readonly width: number;
  readonly height: number;
  readonly format: "rgba8unorm-srgb" | "rgba8unorm";
  readonly revision: number;
  readonly epoch: number;
  view(): GPUTextureView;
  prepare(encoder: GPUCommandEncoder, upTo: number): void;
  readonly bytes: number;
}

/** What a HOST holds: the face's texture and the doors that fill it (ICE's `createLiveTexture` makes one). */
export interface LiveWriter {
  readonly face: LiveTexture;
  present(source: LiveImage, rect?: LiveRect): void;
  presentBytes(bytes: Uint8Array, width: number, height: number): void;
  presentTexture(texture: GPUTexture, rect?: LiveRect): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

/** What a live texture is made with (`createLiveTexture`'s options). */
export interface LiveTextureOptions {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly format?: "rgba8unorm-srgb" | "rgba8unorm";
  readonly mips?: boolean;
}

/** The source's state. */
export type LiveState =
  | { readonly is: "starting" | "live" | "paused" | "closed" }
  | { readonly is: "failed"; readonly reason: string; readonly retry?: () => void };

/** The source's words for the face — all optional. */
export interface LiveInfo {
  readonly title?: string;
  readonly address?: string;
  /** 0 … 1 while loading; undefined when not. */
  readonly loading?: number;
  readonly back?: boolean;
  readonly forward?: boolean;
  readonly cursor?: string;
  readonly degraded?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** What the desk asks of a face, in the kind's law over what it is seen. */
export interface LiveDemand {
  readonly mode: "live" | "paused";
  readonly fps: number;
  readonly raster: readonly [number, number];
  readonly viewport?: readonly [number, number];
  readonly interactive: boolean;
}

/** ONE FACE a host opened for an object: a view and words, never a frame. */
export interface LiveFace {
  readonly key: string;
  texture(): LiveTexture | undefined;
  take(): boolean;
  state(): LiveState;
  info(): LiveInfo;
  demand(d: LiveDemand): void;
  readonly input?: ((e: unknown) => void) | undefined;
  close(): void;
}

/** What a HOST lends under `LIVE`: its sources, as faces by key. */
export interface LiveSources {
  open(key: string, spec: Readonly<Record<string, unknown>>, arrived: () => void): LiveFace;
}
