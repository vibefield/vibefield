import {
  bindGroup,
  bindLayout,
  type ComposeOptions,
  compile,
  compose,
  createRecordStore,
  type KindExtra,
  type KindPass,
  type MatPass,
  type RecordStore,
  renderPipeline,
  type SlotContext,
} from "@vibefield/plugin-sdk/desk";
import { Disc, type DiscRecord, discValues, MAX_DISCS } from "./record";

// The kind's PASS — its discs, instanced: one quad per disc, one fragment per covered pixel,
// premultiplied, through the slot's portal chain. It binds the slot's ONE view block (`mat.view`:
// the camera, the box, the device ratio — the desk writes it once a frame; a kind binds it and never
// writes it) and keeps its records in a persistent store, so a disc is written only when its record
// changed (a pan writes nothing). The desk calls `create` once, on the HOST's device; every other slot
// (a mini mat's inside) gets a `spawn` sharing the pipeline.

/** Premultiplied "source over" — every desk object's blend. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

interface DiscShared {
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
}

export class DiscPass implements KindPass<DiscRecord> {
  readonly name = "{{id}}/discs";
  private readonly store: RecordStore<DiscRecord>;
  private droppedNow = 0;
  private group!: GPUBindGroup;
  private boundAssets = -1;
  private boundStore = -1;
  private count = 0;
  private readonly device: GPUDevice;
  private readonly shared: DiscShared;
  private readonly mat: MatPass;

  private constructor(device: GPUDevice, shared: DiscShared, mat: MatPass) {
    this.device = device;
    this.shared = shared;
    this.mat = mat;
    this.store = createRecordStore<DiscRecord, keyof typeof Disc.slots>({
      device,
      def: Disc,
      capacity: 16,
      max: MAX_DISCS,
      label: "{{id}}/discs",
      pack: (d, _aux, into, slot) => {
        into.set(discValues(d), slot);
        return 0;
      },
    });
    this.rebind();
  }

  /** The root slot's pass, on the root's mat: the pipeline compiled once, from the kind's WGSL. */
  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    src: ComposeOptions,
    mat: MatPass,
  ): Promise<DiscPass> {
    const layout = bindLayout(
      device,
      [
        { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
        { binding: 1, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
        { binding: 2, stages: ["vertex"], buffer: "read-only-storage" },
      ],
      "{{id}}/discs",
    );
    const module = await compile(device, compose(src));
    const pipeline = await renderPipeline(device, {
      label: "{{id}}/discs",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      module,
      format,
      blend: BLEND_PREMUL,
    });
    return new DiscPass(device, { layout, pipeline }, mat);
  }

  /** Another slot's records on the shared pipeline, reading that slot's view. */
  spawn(mat: MatPass): DiscPass {
    return new DiscPass(this.device, this.shared, mat);
  }

  private rebind(): void {
    if (this.boundAssets === this.mat.assetVersion && this.boundStore === this.store.version) return;
    this.group = bindGroup(
      this.device,
      this.shared.layout,
      [this.mat.view, this.store.records, this.store.order],
      "{{id}}/discs",
    );
    this.boundAssets = this.mat.assetVersion;
    this.boundStore = this.store.version;
  }

  /** This frame's discs in paint order, through the persistent store (keyed by `extra.keys`). */
  prepare(
    _encoder: GPUCommandEncoder,
    _slot: SlotContext,
    records: readonly DiscRecord[],
    extra?: KindExtra,
  ): number {
    const list = records.length > MAX_DISCS ? records.slice(0, MAX_DISCS) : records;
    const keys = extra?.keys;
    this.droppedNow = records.length - list.length;
    this.count = this.store.prepare(
      list,
      keys !== undefined && keys.length > MAX_DISCS ? keys.slice(0, MAX_DISCS) : keys,
    );
    this.rebind(); // after: the store's buffers may have grown
    return this.count;
  }

  dropped(): number {
    return this.droppedNow;
  }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.count);
    if (first >= hi) return;
    pass.setPipeline(this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, hi - first, 0, first);
  }

  dispose(): void {
    this.store.dispose();
  }
}
