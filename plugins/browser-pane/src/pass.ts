/// <reference types="@webgpu/types" />
// The reference above (design-kit's logo renderer is the precedent): this file names the WebGPU globals a kind's pass is
// written against, and a program that reaches it through the HOST — field-app's dev-bundled set, the playground's tests —
// does not list `@webgpu/types` in its own tsconfig. The pane's own dependency answers for its own names.
//
// The pane pass (the prototype's src/browser/pane-pass.ts, as a `KindPass`; p1 §5) — the panes, one draw each in paint
// order: their LIGHT on what lies below the run first (a lighting blend: what is there × (1 + light) — the arris's
// caustic by day, the page's pool and the edges' halo by night), then each PANE, premultiplied over. FOUR pipelines: the
// pane and the light, each again for a slot lit from ELSEWHERE (a mini mat's inside, a flight's departed desk —
// `LIT_ELSEWHERE`, a pipeline constant). The light lights nothing in the HAND's target (cleared to nothing: dst·(1+L) is
// nothing), so the hand draws the panes alone.
//
// It binds the slot's ONE view block (the kit's `MatPass.view` — never written, never copied), the slot's gobo
// silhouette and the blue noise, its knobs, and its records' persistent store (a pane keeps its slot and is written only
// when its record changed — a pan writes nothing). Each pane's SURFACE — its PAGE (page.ts: an srgb texture, its mips made
// only as deep as they are read, into the frame's encoder) and its head's raster — is its group 1, shared by every slot
// spawned from the root's (a pane drawn in the hand and on the desk behind it is one surface), and goes with the root.
//
// THE PAGE in PT-1 is a STILL (sample-page.ts), generated here when what it shows changes; a page changing again within
// `PAGE_REMAKE_MS` (a resize's every frame) is DEFERRED — the last one stretched into the new page — and the kind's local
// is told (`onPending`), so the desk wakes to make it once the hand has paused. THE HEAD's raster is the record's (the
// host's lent service drew it) or, where no service is lent, the committed one its key names (head-still.ts).
//
// PT-2 — A LIVE PAGE is its face's texture (the host's `LIVE` service fills it — the pass never sees a frame): bound as the
// surface's page (again when its EPOCH moves — a new texture), its mips made as deep as this slot reads them (`liveDepth`; by
// night the glow's coarse level too) into the frame's encoder — once per revision, whatever the slots — and the face's SIGHT
// told what this slot drew of the page (`Sight.saw`: the page's world size → device px through the slot's view). Before its
// first frame the page is the film.

import {
  bindGroup,
  bindLayout,
  type ComposeOptions,
  compile,
  compose,
  createRecordStore,
  type KindExtra,
  type KindPass,
  type LiveTexture,
  litByOwn,
  liveDepth,
  type MatPass,
  type RecordStore,
  renderPipeline,
  type SlotContext,
  uniformBuffer,
} from "@vibefield/plugin-sdk/desk";
import { stillHead } from "./head-still";
import { BROWSER, type BrowserLaw } from "./law";
import {
  glowLevel,
  type HeadBitmap,
  MAX_PANES,
  Pane,
  type PaneInstance,
  type PaneLookValues,
  PaneUniforms,
  paneUniformValues,
  paneValues,
} from "./layout";
import { PageTexture } from "./page";
import { samplePage } from "./sample-page";

/** Premultiplied "source over" — every desk object's blend. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};
/** Light on what is there: dst · (1 + src) — the caustic, the page's colour cast on the mat; its alpha untouched. */
const BLEND_LIGHT: GPUBlendState = {
  color: { srcFactor: "dst", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
};

/** A page whose content changes again within this many ms of its last making waits (a resize remakes it as the hand pauses). */
export const PAGE_REMAKE_MS = 90;

/**
 * A pane's SURFACE: its PAGE (`PageTexture` — the still drawn into level 0, the mips made as deep as they are read) and
 * its head's RASTER (rgba8, premultiplied — the engraving's alpha and the print's colour), bound together as the pane's
 * group 1, re-bound only when either texture is replaced.
 */
export class PaneSurface {
  readonly page: PageTexture;
  /** PT-2 — the live face's texture shown as the page while it has one (the host's: never destroyed here). */
  live: LiveTexture | undefined;
  ink: GPUTexture;
  inkWidth = 1;
  inkHeight = 1;
  /** What the page and the head show (the record's keys), when the page was last made (ms), and how many it has made. */
  pageKey: string | null = null;
  inkKey: string | null = null;
  madeAt = Number.NEGATIVE_INFINITY;
  made = 0;
  private group_: GPUBindGroup | null = null;
  private boundPage: GPUTexture | LiveTexture | null = null;
  private boundEpoch = -1;
  private boundInk: GPUTexture | null = null;
  private readonly device: GPUDevice;
  private readonly layout: GPUBindGroupLayout;

  constructor(device: GPUDevice, layout: GPUBindGroupLayout) {
    this.device = device;
    this.layout = layout;
    this.page = new PageTexture(device);
    this.ink = this.makeInk(1, 1);
    device.queue.writeTexture(
      { texture: this.ink },
      new Uint8Array([0, 0, 0, 0]),
      { bytesPerRow: 4 },
      [1, 1, 1],
    );
  }

  private makeInk(w: number, h: number): GPUTexture {
    this.inkWidth = w;
    this.inkHeight = h;
    return this.device.createTexture({
      label: `browser-pane/head ${w}×${h}`,
      size: [w, h],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }

  /** The head's raster: premultiplied rgba8 bytes laid over the head's box. */
  setInk(bitmap: HeadBitmap): void {
    if (bitmap.width !== this.inkWidth || bitmap.height !== this.inkHeight) {
      this.ink.destroy();
      this.ink = this.makeInk(bitmap.width, bitmap.height);
    }
    this.device.queue.writeTexture(
      { texture: this.ink },
      bitmap.bytes,
      { bytesPerRow: bitmap.width * 4 },
      [bitmap.width, bitmap.height, 1],
    );
  }

  /** The pane's group 1: its page (the live face's texture while it has one) and its head. */
  get group(): GPUBindGroup {
    const live = this.live;
    const page = live ?? this.page.texture;
    const epoch = live?.epoch ?? -1;
    if (
      !this.group_ ||
      this.boundPage !== page ||
      this.boundEpoch !== epoch ||
      this.boundInk !== this.ink
    ) {
      this.group_ = this.device.createBindGroup({
        label: "browser-pane/surface",
        layout: this.layout,
        entries: [
          {
            binding: 0,
            resource: live === undefined ? this.page.texture.createView() : live.view(),
          },
          { binding: 1, resource: this.ink.createView() },
        ],
      });
      this.boundPage = page;
      this.boundEpoch = epoch;
      this.boundInk = this.ink;
    }
    return this.group_;
  }

  get bytes(): number {
    return this.page.bytes + this.inkWidth * this.inkHeight * 4;
  }

  dispose(): void {
    this.page.dispose();
    this.ink.destroy();
  }
}

/** What every slot's pass shares: the layouts, the four pipelines, the samplers and the panes' surfaces. */
interface PaneShared {
  readonly layout0: GPUBindGroupLayout;
  readonly layout1: GPUBindGroupLayout;
  readonly pane: GPURenderPipeline;
  readonly paneLit: GPURenderPipeline;
  readonly light: GPURenderPipeline;
  readonly lightLit: GPURenderPipeline;
  readonly goboSampler: GPUSampler;
  readonly noiseSampler: GPUSampler;
  readonly pageSampler: GPUSampler;
  readonly inkSampler: GPUSampler;
  /** The panes' surfaces by key (`k<entity>` for a keyed frame, `i<index>` for a transient one). */
  readonly surfaces: Map<string, PaneSurface>;
  /** Pages deferred (a page whose content moved again too soon) — the local makes the desk come back for them. */
  readonly pending: Set<string>;
  onPending: (() => void) | undefined;
}

/** The pass's counters (a test's and a rig's witness). */
export interface PaneStats {
  /** Pages made, and the texels they took; heads laid; pages deferred; mip passes run, all since the pass was made. */
  readonly pages: number;
  readonly texels: number;
  readonly heads: number;
  readonly deferred: number;
  readonly mips: number;
  /** Surfaces held now. */
  readonly surfaces: number;
}

export class PanePass implements KindPass<PaneInstance> {
  readonly name = "browser-pane/panes";
  /** The panes' persistent records (a slot per pane while it is drawn, written when it changed). */
  private readonly store: RecordStore<PaneInstance>;
  private readonly knobBuf: GPUBuffer;
  private readonly knobs = PaneUniforms.alloc(1);
  private knobLook: PaneLookValues | undefined;
  private knobLaw: BrowserLaw | undefined;
  private droppedNow = 0;
  private group!: GPUBindGroup;
  private boundAssets = -1;
  private boundStore = -1;
  private count = 0;
  private litElsewhere = false;
  private target: NonNullable<SlotContext["target"]> = "frame";
  /** This frame's surfaces in paint order. */
  private drawn: PaneSurface[] = [];
  private counts = { pages: 0, texels: 0, heads: 0, deferred: 0, mips: 0 };
  /** The pane's numbers (law.ts `BROWSER`) — a host tunes its own copy. */
  law: BrowserLaw = BROWSER;
  private readonly device: GPUDevice;
  private readonly shared: PaneShared;
  private readonly mat: MatPass;
  /** The root's pass owns the shared surfaces; a spawned slot's never disposes them. */
  private readonly root: boolean;

  private constructor(device: GPUDevice, shared: PaneShared, mat: MatPass, root: boolean) {
    this.device = device;
    this.shared = shared;
    this.mat = mat;
    this.root = root;
    this.knobBuf = uniformBuffer(device, PaneUniforms.size, "browser-pane/knobs");
    this.store = createRecordStore<PaneInstance, keyof typeof Pane.slots>({
      device,
      def: Pane,
      capacity: 4,
      max: MAX_PANES,
      label: "browser-pane/panes",
      pack: (r, _aux, into, slot) => {
        into.set(paneValues(r), slot);
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
  ): Promise<PanePass> {
    const layout0 = bindLayout(
      device,
      [
        { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
        { binding: 1, stages: ["fragment"], buffer: "uniform" },
        { binding: 2, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
        { binding: 3, stages: ["fragment"], texture: "float" },
        { binding: 4, stages: ["fragment"], sampler: "filtering" },
        { binding: 5, stages: ["fragment"], texture: "float" },
        { binding: 6, stages: ["fragment"], sampler: "filtering" },
        { binding: 7, stages: ["fragment"], sampler: "filtering" },
        { binding: 8, stages: ["fragment"], sampler: "filtering" },
        { binding: 9, stages: ["vertex"], buffer: "read-only-storage" },
      ],
      "browser-pane/panes",
    );
    const layout1 = bindLayout(
      device,
      [
        { binding: 0, stages: ["fragment"], texture: "float" },
        { binding: 1, stages: ["fragment"], texture: "float" },
      ],
      "browser-pane/surface",
    );
    const module = await compile(device, compose(src));
    const layout = device.createPipelineLayout({ bindGroupLayouts: [layout0, layout1] });
    const made = (label: string, fragment: "fs" | "fs_light", blend: GPUBlendState, lit: boolean) =>
      renderPipeline(device, {
        label,
        layout,
        module,
        format,
        fragment,
        blend,
        ...(lit ? { constants: { LIT_ELSEWHERE: 1 } } : {}),
      });
    const [pane, paneLit, light, lightLit] = await Promise.all([
      made("browser-pane/panes", "fs", BLEND_PREMUL, false),
      made("browser-pane/panes, lit from elsewhere", "fs", BLEND_PREMUL, true),
      made("browser-pane/light", "fs_light", BLEND_LIGHT, false),
      made("browser-pane/light, lit from elsewhere", "fs_light", BLEND_LIGHT, true),
    ]);
    const sampler = (label: string, opts: GPUSamplerDescriptor): GPUSampler =>
      device.createSampler({ label, ...opts });
    const clamp = { addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" } as const;
    const shared: PaneShared = {
      layout0,
      layout1,
      pane,
      paneLit,
      light,
      lightLit,
      goboSampler: sampler("browser-pane/gobo", {
        magFilter: "linear",
        minFilter: "linear",
        ...clamp,
      }),
      noiseSampler: sampler("browser-pane/noise", {
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "repeat",
      }),
      pageSampler: sampler("browser-pane/page", {
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear",
        ...clamp,
      }),
      inkSampler: sampler("browser-pane/head", {
        magFilter: "linear",
        minFilter: "linear",
        ...clamp,
      }),
      surfaces: new Map(),
      pending: new Set(),
      onPending: undefined,
    };
    return new PanePass(device, shared, mat, true);
  }

  /** A slot's own records on the shared pipelines and surfaces, reading `mat`'s silhouette — a live inside's, a flight's departed desk's. */
  spawn(mat: MatPass): PanePass {
    const p = new PanePass(this.device, this.shared, mat, false);
    p.law = this.law;
    return p;
  }

  /** A spawned slot takes the root's law every frame. */
  tune(root: KindPass<PaneInstance>): void {
    if (root instanceof PanePass) this.law = root.law;
  }

  /** The law a host tunes (the dev panel's door); its slots follow through `tune`. */
  setLaw(law: unknown): void {
    this.law = law as BrowserLaw;
  }

  private rebind(): void {
    if (this.boundAssets === this.mat.assetVersion && this.boundStore === this.store.version)
      return;
    const s = this.shared;
    this.group = bindGroup(
      this.device,
      s.layout0,
      [
        this.mat.view,
        this.knobBuf,
        this.store.records,
        this.mat.silhouette,
        s.goboSampler,
        this.mat.noiseTexture.createView(),
        s.noiseSampler,
        s.pageSampler,
        s.inkSampler,
        this.store.order,
      ],
      "browser-pane/panes",
    );
    this.boundAssets = this.mat.assetVersion;
    this.boundStore = this.store.version;
  }

  /** The surface a key names, made the first time it is asked. */
  private surfaceFor(key: string): PaneSurface {
    let surface = this.shared.surfaces.get(key);
    if (surface === undefined) {
      surface = new PaneSurface(this.device, this.shared.layout1);
      this.shared.surfaces.set(key, surface);
    }
    return surface;
  }

  /**
   * Bring a pane's surface to what its record shows: its page made (or deferred, when it moved again too soon), its head
   * laid, its page's mips made as deep as this slot reads them (by night the glow's coarse level too) into `encoder`.
   */
  private show(
    key: string,
    surface: PaneSurface,
    r: PaneInstance,
    encoder: GPUCommandEncoder,
    s: SlotContext,
    now: number,
  ): void {
    const live = r.live;
    const S = r.geometry.shape;
    // the page's device px through this slot's view
    const px: [number, number] = [
      2 * S.page[2] * s.view.zoom * s.view.dpr,
      2 * S.page[3] * s.view.zoom * s.view.dpr,
    ];
    if (live !== undefined) {
      live.sight.saw(live.e, s, {
        cx: r.geometry.centre[0],
        cy: r.geometry.centre[1],
        w: 2 * S.page[2],
        h: 2 * S.page[3],
      });
      const t = live.face.texture();
      surface.live = t;
      this.lay(surface, r);
      if (t === undefined) return;
      const depth = liveDepth(t, px);
      t.prepare(
        encoder,
        s.light.night > 0 ? Math.max(depth, Math.ceil(glowLevel(t.width))) : depth,
      );
      return;
    }
    surface.live = undefined;
    const plan = r.page;
    if (plan !== null && plan.key !== surface.pageKey) {
      if (surface.pageKey === null || now - surface.madeAt >= PAGE_REMAKE_MS) {
        surface.page.presentBytes(
          samplePage(plan.viewport, plan.scheme, [plan.width, plan.height]),
          plan.width,
          plan.height,
        );
        surface.pageKey = plan.key;
        surface.madeAt = now;
        surface.made += 1;
        this.shared.pending.delete(key);
        this.counts = {
          ...this.counts,
          pages: this.counts.pages + 1,
          texels: this.counts.texels + plan.width * plan.height,
        };
      } else if (!this.shared.pending.has(key)) {
        this.shared.pending.add(key);
        this.counts = { ...this.counts, deferred: this.counts.deferred + 1 };
        this.shared.onPending?.();
      }
    }
    this.lay(surface, r);
    if (plan === null) return;
    const page = surface.page;
    const [device, deviceY] = px;
    const lod = Math.max(
      Math.log2(
        Math.max(page.width / Math.max(device, 1e-3), page.height / Math.max(deviceY, 1e-3)),
      ),
      0,
    );
    const upTo = s.light.night > 0 ? Math.max(lod + 1, glowLevel(page.width)) : lod + 1;
    this.counts = { ...this.counts, mips: this.counts.mips + page.prepare(encoder, upTo) };
  }

  /** The head's raster laid when what it says moved: the record's (the service drew it), or the committed one its key names. */
  private lay(surface: PaneSurface, r: PaneInstance): void {
    if (r.head.key === surface.inkKey) return;
    const bitmap =
      r.head.bitmap ?? (r.head.still !== undefined ? stillHead(r.head.still) : undefined);
    if (bitmap !== undefined) {
      surface.setInk(bitmap);
      this.counts = { ...this.counts, heads: this.counts.heads + 1 };
    }
    surface.inkKey = r.head.key;
  }

  /** This frame's panes in paint order, through the persistent store (keyed by `extra.keys`; none = packed afresh — the still's form). */
  prepare(
    encoder: GPUCommandEncoder,
    s: SlotContext,
    records: readonly PaneInstance[],
    extra?: KindExtra,
  ): number {
    const list = records.length > MAX_PANES ? records.slice(0, MAX_PANES) : records;
    const keys = extra?.keys;
    this.droppedNow = records.length - list.length;
    this.count = this.store.prepare(
      list,
      keys !== undefined && keys.length > MAX_PANES ? keys.slice(0, MAX_PANES) : keys,
    );
    const first = list[0];
    if (first !== undefined && (first.look !== this.knobLook || this.law !== this.knobLaw)) {
      this.knobs.set(paneUniformValues(first.look, this.law));
      this.device.queue.writeBuffer(this.knobBuf, 0, this.knobs.view());
      this.knobLook = first.look;
      this.knobLaw = this.law;
    }
    const now = performance.now();
    this.drawn = [];
    for (let i = 0; i < this.count; i++) {
      const r = list[i] as PaneInstance;
      const k = keys?.[i];
      const key = k === undefined ? `i${i}` : `k${Math.abs(k)}`;
      const surface = this.surfaceFor(key);
      this.show(key, surface, r, encoder, s, now);
      this.drawn.push(surface);
    }
    this.rebind(); // after: the store's buffers may have grown
    this.litElsewhere = !litByOwn(s.view, s.lit);
    this.target = s.target ?? "frame";
    return this.count;
  }

  dropped(): number {
    return this.droppedNow;
  }

  /** The store's counters (a rig's witness): records written, bytes, draw-list writes, slots in use. */
  records() {
    return this.store.stats();
  }

  /** The surfaces' counters (a test's witness). */
  stats(): PaneStats {
    return { ...this.counts, surfaces: this.shared.surfaces.size };
  }

  /** Pages deferred and not yet made. */
  pending(): number {
    return this.shared.pending.size;
  }

  /** Who is told when a page is deferred (the kind's local: it brings the desk back to make it). */
  onPending(fn: (() => void) | undefined): void {
    this.shared.onPending = fn;
  }

  /** Pages made for a pane since its surface was made — what has LANDED on it (the kind's local's `landed`). */
  made(entity: number): number {
    return this.shared.surfaces.get(`k${Math.abs(entity)}`)?.made ?? 0;
  }

  /** A pane left the desk for good: its surface goes (the kind's local's `forget`). */
  forget(entity: number): void {
    const key = `k${Math.abs(entity)}`;
    this.shared.surfaces.get(key)?.dispose();
    this.shared.surfaces.delete(key);
    this.shared.pending.delete(key);
  }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.count);
    if (first >= hi) return;
    const s = this.shared;
    pass.setBindGroup(0, this.group);
    // their light on what lies below the run — none in the hand's target (it is cleared to nothing: there is nothing to light)
    if (this.target !== "hand") {
      pass.setPipeline(this.litElsewhere ? s.lightLit : s.light);
      for (let i = first; i < hi; i++) {
        pass.setBindGroup(1, (this.drawn[i] as PaneSurface).group);
        pass.draw(6, 1, 0, i);
      }
    }
    pass.setPipeline(this.litElsewhere ? s.paneLit : s.pane);
    for (let i = first; i < hi; i++) {
      pass.setBindGroup(1, (this.drawn[i] as PaneSurface).group);
      pass.draw(6, 1, 0, i);
    }
  }

  dispose(): void {
    this.store.dispose();
    this.knobBuf.destroy();
    if (this.root) {
      for (const surface of this.shared.surfaces.values()) surface.dispose();
      this.shared.surfaces.clear();
      this.shared.pending.clear();
      this.shared.onPending = undefined;
    }
  }
}
