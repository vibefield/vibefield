/// <reference types="@webgpu/types" />
// The reference above (design-kit's logo renderer is the precedent): this file names the WebGPU
// globals a kind's pass is written against, and a program that reaches it through the HOST — field-app's
// dev-bundled set, the playground's tests — does not list `@webgpu/types` in its own tsconfig. The pad's
// own dependency answers for its own names.
// The pad pass — the comment pads, instanced: one quad per pad (grown by its lower sheets and its shadow's
// reach), one `shade_pad` per covered fragment, premultiplied, through the slot's presence and its portal chain.
// It binds the slot's ONE view block (the kit's `MatPass.view` — never written, never copied), the slot's gobo
// silhouette and the blue noise, its records' persistent store (a pad keeps its slot and is written only when
// its record changed — a pan writes nothing), and the INK LAYERS: one r8 layer per pad whose writing is laid
// (writing.ts lays the host's text raster there). Every slot spawned from the root's shares the pipelines and
// the ink layers; each reads its own mat.

import {
  bindGroup,
  bindLayout,
  type ComposeOptions,
  compile,
  compose,
  createRecordStore,
  type KindExtra,
  type KindPass,
  litByOwn,
  type MatPass,
  type RecordStore,
  renderPipeline,
  type SlotContext,
} from "@vibefield/plugin-sdk/desk";
import { MAX_PADS, Pad, type PadInstance, padValues } from "./layout";

/** Premultiplied "source over" — every desk object's blend. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** One ink layer's texels: the widest writing box at the densest rung (pad units × texels per unit) fits. */
export const INK_LAYER = { w: 1024, h: 1024 } as const;
/** The layers made at first, and the most the pass grows to. */
const INK_LAYERS_FIRST = 2;
const INK_LAYERS_MAX = 64;

/** A raster as the host's text raster draws it: r8 coverage rows, row 0 at the top. */
export interface InkBitmap {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly w: number;
  readonly h: number;
}

/**
 * THE INK LAYERS — one r8 texture array the root pass makes and every slot's pass shares: a pad's writing is
 * laid into a layer of its own (writing.ts allocates them) and sampled by its record's layer index. They GROW
 * by doubling (the layers already laid copied across) up to `INK_LAYERS_MAX`; a growth turns `version` over, so
 * every pass holding a bind group over the old array rebinds.
 */
export class PadInk {
  private texture: GPUTexture;
  private viewNow: GPUTextureView;
  private layersNow: number;
  private versionNow = 0;
  private readonly device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
    this.layersNow = INK_LAYERS_FIRST;
    this.texture = this.make(this.layersNow);
    this.viewNow = this.texture.createView({ dimension: "2d-array" });
  }

  private make(layers: number): GPUTexture {
    return this.device.createTexture({
      label: "comment-pad/ink",
      size: [INK_LAYER.w, INK_LAYER.h, layers],
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
  }

  /** The array as a pass binds it. */
  view(): GPUTextureView {
    return this.viewNow;
  }
  /** Turns over whenever the array is remade (a growth). */
  version(): number {
    return this.versionNow;
  }
  /** The layers there are. */
  layers(): number {
    return this.layersNow;
  }
  /** A layer's texels. */
  readonly size = INK_LAYER;

  /** Make room for layer `index` (the array doubles, what it held copied across); false when the most is reached. */
  ensure(index: number): boolean {
    if (index < this.layersNow) return true;
    if (index >= INK_LAYERS_MAX) return false;
    let layers = this.layersNow;
    while (layers <= index) layers *= 2;
    layers = Math.min(layers, INK_LAYERS_MAX);
    const next = this.make(layers);
    const encoder = this.device.createCommandEncoder({ label: "comment-pad/ink grow" });
    encoder.copyTextureToTexture({ texture: this.texture }, { texture: next }, [
      INK_LAYER.w,
      INK_LAYER.h,
      this.layersNow,
    ]);
    this.device.queue.submit([encoder.finish({ label: "comment-pad/ink grow" })]);
    this.texture.destroy();
    this.texture = next;
    this.viewNow = next.createView({ dimension: "2d-array" });
    this.layersNow = layers;
    this.versionNow += 1;
    return true;
  }

  /** Lay a raster at layer `index`'s top-left (its rows past the raster's keep what they held — the record says how far to read). */
  write(index: number, bitmap: InkBitmap): void {
    const w = Math.min(bitmap.w, INK_LAYER.w);
    const h = Math.min(bitmap.h, INK_LAYER.h);
    if (w <= 0 || h <= 0 || !this.ensure(index)) return;
    this.device.queue.writeTexture(
      { texture: this.texture, origin: [0, 0, index] },
      bitmap.bytes,
      { offset: 0, bytesPerRow: bitmap.w, rowsPerImage: bitmap.h },
      [w, h, 1],
    );
  }

  dispose(): void {
    this.texture.destroy();
  }
}

interface PadShared {
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
  /** The same, for a slot lit from elsewhere (a mini mat's inside): `LIT_ELSEWHERE` is a pipeline constant. */
  readonly litPipeline: GPURenderPipeline;
  readonly goboSampler: GPUSampler;
  readonly noiseSampler: GPUSampler;
  readonly inkSampler: GPUSampler;
  readonly ink: PadInk;
}

export class PadPass implements KindPass<PadInstance> {
  readonly name = "comment-pad/pads";
  /** The pads' persistent records (a slot per pad while it is drawn, written when it changed). */
  private readonly store: RecordStore<PadInstance>;
  private droppedNow = 0;
  private group!: GPUBindGroup;
  private boundAssets = -1;
  private boundStore = -1;
  private boundInk = -1;
  private count = 0;
  private litElsewhere = false;
  private readonly device: GPUDevice;
  private readonly shared: PadShared;
  private readonly mat: MatPass;
  /** The root's pass owns the shared resources; a spawned slot's never disposes them. */
  private readonly root: boolean;

  private constructor(device: GPUDevice, shared: PadShared, mat: MatPass, root: boolean) {
    this.device = device;
    this.shared = shared;
    this.mat = mat;
    this.root = root;
    this.store = createRecordStore<PadInstance, keyof typeof Pad.slots>({
      device,
      def: Pad,
      capacity: 8,
      max: MAX_PADS,
      label: "comment-pad/pads",
      pack: (r, _aux, into, slot) => {
        into.set(padValues(r), slot);
        return 0;
      },
    });
    this.rebind();
  }

  /** The root's pass, on the root's mat. */
  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    src: ComposeOptions,
    mat: MatPass,
  ): Promise<PadPass> {
    const layout = bindLayout(
      device,
      [
        { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
        { binding: 1, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
        { binding: 2, stages: ["fragment"], texture: "float" },
        { binding: 3, stages: ["fragment"], sampler: "filtering" },
        { binding: 4, stages: ["fragment"], texture: "float" },
        { binding: 5, stages: ["fragment"], sampler: "filtering" },
        { binding: 6, stages: ["vertex"], buffer: "read-only-storage" },
        { binding: 7, stages: ["fragment"], texture: "float", dimension: "2d-array" },
        { binding: 8, stages: ["fragment"], sampler: "filtering" },
      ],
      "comment-pad/pads",
    );
    const module = await compile(device, compose(src));
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const [pipeline, litPipeline] = await Promise.all([
      renderPipeline(device, {
        label: "comment-pad/pads",
        layout: pl,
        module,
        format,
        blend: BLEND_PREMUL,
      }),
      renderPipeline(device, {
        label: "comment-pad/pads, lit from elsewhere",
        layout: pl,
        module,
        format,
        blend: BLEND_PREMUL,
        constants: { LIT_ELSEWHERE: 1 },
      }),
    ]);
    const linear = (label: string, repeat: boolean): GPUSampler =>
      device.createSampler({
        label,
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: repeat ? "repeat" : "clamp-to-edge",
        addressModeV: repeat ? "repeat" : "clamp-to-edge",
      });
    const shared: PadShared = {
      layout,
      pipeline,
      litPipeline,
      goboSampler: linear("comment-pad/gobo", false),
      noiseSampler: linear("comment-pad/noise", true),
      inkSampler: linear("comment-pad/ink", false),
      ink: new PadInk(device),
    };
    return new PadPass(device, shared, mat, true);
  }

  /** A slot's own records on the shared pipelines and ink, reading `mat`'s silhouette — a live inside's, a flight's departed desk's. */
  spawn(mat: MatPass): PadPass {
    return new PadPass(this.device, this.shared, mat, false);
  }

  /** The ink layers every slot's pass binds — where the writing lays its rasters (writing.ts, through `KindHost.pass()`). */
  ink(): PadInk {
    return this.shared.ink;
  }

  private rebind(): void {
    const ink = this.shared.ink;
    if (
      this.boundAssets === this.mat.assetVersion &&
      this.boundStore === this.store.version &&
      this.boundInk === ink.version()
    )
      return;
    const s = this.shared;
    this.group = bindGroup(
      this.device,
      s.layout,
      [
        this.mat.view,
        this.store.records,
        this.mat.silhouette,
        s.goboSampler,
        this.mat.noiseTexture.createView(),
        s.noiseSampler,
        this.store.order,
        ink.view(),
        s.inkSampler,
      ],
      "comment-pad/pads",
    );
    this.boundAssets = this.mat.assetVersion;
    this.boundStore = this.store.version;
    this.boundInk = ink.version();
  }

  /** This frame's pads in paint order, through the persistent store (keyed by `extra.keys`; none = packed afresh — the oracle's form). */
  prepare(
    _encoder: GPUCommandEncoder,
    s: SlotContext,
    records: readonly PadInstance[],
    extra?: KindExtra,
  ): number {
    const list = records.length > MAX_PADS ? records.slice(0, MAX_PADS) : records;
    const keys = extra?.keys;
    this.droppedNow = records.length - list.length;
    this.count = this.store.prepare(
      list,
      keys !== undefined && keys.length > MAX_PADS ? keys.slice(0, MAX_PADS) : keys,
    );
    this.rebind(); // after: the store's buffers may have grown, the ink may have
    this.litElsewhere = !litByOwn(s.view, s.lit);
    return this.count;
  }

  dropped(): number {
    return this.droppedNow;
  }

  /** The store's counters (a rig's witness): records written, bytes, draw-list writes, slots in use. */
  records() {
    return this.store.stats();
  }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.count);
    if (first >= hi) return;
    pass.setPipeline(this.litElsewhere ? this.shared.litPipeline : this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, hi - first, 0, first);
  }

  dispose(): void {
    this.store.dispose();
    if (this.root) this.shared.ink.dispose();
  }
}
