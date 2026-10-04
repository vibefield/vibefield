// PORTED VERBATIM from ICE's worked third-party kind (`infinite-canvas-engine/examples/desk-clock/src/pass.ts`, design-016 K8b) — re-wrapped by this repo's formatter,
// its imports moved to the SDK's `/desk` door — a VibeField plugin imports nothing of ICE but what the SDK re-exports (K-L1).

// The clock pass — the desk clocks, instanced: one quad per clock (grown by its shadow's reach), one `shade_clock` per covered
// fragment, premultiplied, through the slot's presence and its portal chain. It binds the slot's ONE view block (K-L3: the kit's
// `MatPass.view` — never written, never copied), the slot's gobo silhouette and the blue noise; its records live in a persistent
// store (a clock keeps its slot and is written only when its record changed — a pan writes nothing). Every slot spawned from the
// root's shares the pipelines; each reads its own mat. A clock never turns, so no pass state but the records.

import type { ComposeOptions } from "@vibefield/plugin-sdk/desk";
import {
  bindGroup,
  bindLayout,
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
import { Clock, type ClockInstance, clockValues, MAX_CLOCKS } from "./layout";

/** Premultiplied "source over" — every desk object's blend. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

interface ClockShared {
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
  /** The same, for a slot lit from elsewhere (a mini mat's inside): `LIT_ELSEWHERE` is a pipeline constant. */
  readonly litPipeline: GPURenderPipeline;
  readonly goboSampler: GPUSampler;
  readonly noiseSampler: GPUSampler;
}

export class ClockPass implements KindPass<ClockInstance> {
  readonly name = "desk-clock/clocks";
  /** The clocks' persistent records (a slot per clock while it is drawn, written when it changed). */
  private readonly store: RecordStore<ClockInstance>;
  private droppedNow = 0;
  private group!: GPUBindGroup;
  private boundAssets = -1;
  private boundStore = -1;
  private count = 0;
  private litElsewhere = false;
  private readonly device: GPUDevice;
  private readonly shared: ClockShared;
  private readonly mat: MatPass;

  private constructor(device: GPUDevice, shared: ClockShared, mat: MatPass) {
    this.device = device;
    this.shared = shared;
    this.mat = mat;
    this.store = createRecordStore<ClockInstance, keyof typeof Clock.slots>({
      device,
      def: Clock,
      capacity: 16,
      max: MAX_CLOCKS,
      label: "desk-clock/clocks",
      pack: (c, _aux, into, slot) => {
        into.set(clockValues(c), slot);
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
  ): Promise<ClockPass> {
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
      ],
      "desk-clock/clocks",
    );
    const module = await compile(device, compose(src));
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const [pipeline, litPipeline] = await Promise.all([
      renderPipeline(device, {
        label: "desk-clock/clocks",
        layout: pl,
        module,
        format,
        blend: BLEND_PREMUL,
      }),
      renderPipeline(device, {
        label: "desk-clock/clocks, lit from elsewhere",
        layout: pl,
        module,
        format,
        blend: BLEND_PREMUL,
        constants: { LIT_ELSEWHERE: 1 },
      }),
    ]);
    const shared: ClockShared = {
      layout,
      pipeline,
      litPipeline,
      goboSampler: device.createSampler({
        label: "desk-clock/gobo",
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      }),
      noiseSampler: device.createSampler({
        label: "desk-clock/noise",
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "repeat",
      }),
    };
    return new ClockPass(device, shared, mat);
  }

  /** A slot's own records on the shared pipelines, reading `mat`'s silhouette — a live inside's, a flight's departed desk's. */
  spawn(mat: MatPass): ClockPass {
    return new ClockPass(this.device, this.shared, mat);
  }

  private rebind(): void {
    if (this.boundAssets === this.mat.assetVersion && this.boundStore === this.store.version)
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
      ],
      "desk-clock/clocks",
    );
    this.boundAssets = this.mat.assetVersion;
    this.boundStore = this.store.version;
  }

  /** This frame's clocks in paint order, through the persistent store (keyed by `extra.keys`; none = packed afresh — the oracle's form). */
  prepare(
    _encoder: GPUCommandEncoder,
    s: SlotContext,
    records: readonly ClockInstance[],
    extra?: KindExtra,
  ): number {
    const list = records.length > MAX_CLOCKS ? records.slice(0, MAX_CLOCKS) : records;
    const keys = extra?.keys;
    this.droppedNow = records.length - list.length;
    this.count = this.store.prepare(
      list,
      keys !== undefined && keys.length > MAX_CLOCKS ? keys.slice(0, MAX_CLOCKS) : keys,
    );
    this.rebind(); // after: the store's buffers may have grown
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
  }
}
