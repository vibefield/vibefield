/// <reference types="@webgpu/types" />
// The reference above: this file names the WebGPU globals a kind's pass is written against, and a program that reaches it
// through the HOST (the playground's tests) does not list `@webgpu/types` in its own tsconfig — the browser pane's precedent.
//
// The phone pass (the prototype's src/phone/phone-pass.ts, as a `KindPass`) — the phones, one draw each in paint order: by
// night their screens' light on what lies below the run first (the SPILL — a lighting blend, what is there × (1 + light)),
// then each PHONE, premultiplied over. FOUR pipelines: the phone and its spill, each again for a slot lit from ELSEWHERE (a
// mini mat's inside, a flight's departed desk — `LIT_ELSEWHERE`, a pipeline constant). The spill lights nothing in the HAND's
// target (cleared to nothing: dst·(1+L) is nothing), so the hand draws the phones alone.
//
// It binds the slot's ONE view block (the kit's `MatPass.view` — never written, never copied), the slot's gobo silhouette and
// the blue noise, its knobs, and its records' persistent store (a phone keeps its slot and is written only when its record
// changed — a pan writes nothing). Each phone's SURFACE is its group 1, shared by every slot spawned from the root's (a phone
// drawn in the hand and on the desk behind it is one surface), and goes with the root:
//  - its SCREEN — its live face's texture (the host's `LIVE` service fills it — the pass never sees a frame), its mips made as
//    deep as this slot reads them (`liveDepth`; by night the glow's coarse level too) into the frame's encoder, the face's
//    SIGHT told what this slot drew of the display; a blank texel where it has none (unbound, a specimen, no `LIVE` lent);
//  - its face's WORDS — their own texture (the words' block alone, made the first time a face says something and let go when
//    it is silent again), its mips made with the kit's `mipsInto`. The kind's local is told its bytes (`onNotice`) — it charges
//    them to the desk's budget, and `unnotice` lets the texture go at an eviction.

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
  mipsInto,
  type RecordStore,
  renderPipeline,
  type SlotContext,
  uniformBuffer,
} from "@vibefield/plugin-sdk/desk";
import { displayRect, PHONE, type PhoneLaw } from "./law";
import {
  glowLevel,
  levelsOf,
  MAX_PHONES,
  type NoticePlan,
  Phone,
  type PhoneInstance,
  type PhoneLookValues,
  PhoneUniforms,
  phoneUniformValues,
  phoneValues,
} from "./layout";

/** Premultiplied "source over" — every desk object's blend. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};
/** Light on what is there: dst · (1 + src) — the screen's colour cast on the mat; its alpha untouched. */
const BLEND_LIGHT: GPUBlendState = {
  color: { srcFactor: "dst", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
};

/** The format a face's words are laid in: sampled in linear light, as the screen is. */
const WORDS_FORMAT: GPUTextureFormat = "rgba8unorm-srgb";

/** A face's words on the device: their texture (with its mip chain), what it says, the levels made for it. */
interface Words {
  readonly texture: GPUTexture;
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly levels: number;
  made: number;
  readonly bytes: number;
}

/** The bytes a texture of `w × h` rgba8 with `levels` levels holds. */
const chainBytes = (w: number, h: number, levels: number): number => {
  let bytes = 0;
  for (let l = 0; l < levels; l++) bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * 4;
  return bytes;
};

/**
 * A phone's SURFACE: its screen (its live face's texture while it has one, else the blank texel) and its words (their texture
 * while its face says something, else the blank), bound together as the phone's group 1 — rebound only when either changes.
 */
export class PhoneSurface {
  /** The live face's texture shown as the screen while it has one (the host's: never destroyed here). */
  live: LiveTexture | undefined;
  words: Words | undefined;
  /** Words laid since the surface was made — what has LANDED on the phone. */
  made = 0;
  private group_: GPUBindGroup | null = null;
  private boundScreen: GPUTexture | LiveTexture | null = null;
  private boundEpoch = -1;
  private boundWords: GPUTexture | null = null;
  private readonly device: GPUDevice;
  private readonly layout: GPUBindGroupLayout;
  private readonly blank: GPUTexture;

  constructor(device: GPUDevice, layout: GPUBindGroupLayout, blank: GPUTexture) {
    this.device = device;
    this.layout = layout;
    this.blank = blank;
  }

  /** The face's words laid (a new texture when their size moves): raw sRGB rgba8 rows, their block alone. */
  setWords(n: NoticePlan): void {
    const had = this.words;
    const levels = levelsOf(n.width, n.height);
    const texture =
      had !== undefined && had.width === n.width && had.height === n.height
        ? had.texture
        : this.device.createTexture({
            label: `simulator/words ${n.width}×${n.height}`,
            size: [n.width, n.height],
            format: WORDS_FORMAT,
            mipLevelCount: levels,
            usage:
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_DST |
              GPUTextureUsage.RENDER_ATTACHMENT,
          });
    if (had !== undefined && had.texture !== texture) had.texture.destroy();
    this.device.queue.writeTexture({ texture }, n.bytes, { bytesPerRow: n.width * 4 }, [
      n.width,
      n.height,
      1,
    ]);
    this.words = {
      texture,
      key: n.key,
      width: n.width,
      height: n.height,
      levels,
      made: 1,
      bytes: chainBytes(n.width, n.height, levels),
    };
    this.made += 1;
  }

  /** The words let go (the face is silent; the budget's eviction): true when there were some. */
  dropWords(): boolean {
    const had = this.words;
    this.words = undefined;
    had?.texture.destroy();
    return had !== undefined;
  }

  /** The phone's group 1: its screen (the live face's texture while it has one) and its words (none: the blank texel). */
  get group(): GPUBindGroup {
    const live = this.live;
    const screen = live ?? this.blank;
    const epoch = live?.epoch ?? -1;
    const words = this.words?.texture ?? this.blank;
    if (
      !this.group_ ||
      this.boundScreen !== screen ||
      this.boundEpoch !== epoch ||
      this.boundWords !== words
    ) {
      this.group_ = this.device.createBindGroup({
        label: "simulator/surface",
        layout: this.layout,
        entries: [
          { binding: 0, resource: live === undefined ? this.blank.createView() : live.view() },
          { binding: 1, resource: words.createView() },
        ],
      });
      this.boundScreen = screen;
      this.boundEpoch = epoch;
      this.boundWords = words;
    }
    return this.group_;
  }

  dispose(): void {
    this.dropWords();
  }
}

/** What every slot's pass shares: the layouts, the four pipelines, the samplers, the blank texel and the phones' surfaces. */
interface PhoneShared {
  readonly layout0: GPUBindGroupLayout;
  readonly layout1: GPUBindGroupLayout;
  readonly phone: GPURenderPipeline;
  readonly phoneLit: GPURenderPipeline;
  readonly spill: GPURenderPipeline;
  readonly spillLit: GPURenderPipeline;
  readonly goboSampler: GPUSampler;
  readonly noiseSampler: GPUSampler;
  readonly screenSampler: GPUSampler;
  /** One black texel: the screen and the words of a phone that has none. */
  readonly blank: GPUTexture;
  /** The phones' surfaces by key (`k<entity>` for a keyed frame, `i<index>` for a transient one). */
  readonly surfaces: Map<string, PhoneSurface>;
  /** Who is told a phone's words' texture was made (its bytes on the device) or let go (0): the kind's local. */
  onNotice: ((entity: number, bytes: number) => void) | undefined;
}

/** The pass's counters (a test's and a rig's witness). */
export interface PhoneStats {
  /** Words laid, and mip passes run for them; surfaces held now. */
  readonly words: number;
  readonly mips: number;
  readonly surfaces: number;
}

export class PhonePass implements KindPass<PhoneInstance> {
  readonly name = "simulator/phones";
  /** The phones' persistent records (a slot per phone while it is drawn, written when it changed). */
  private readonly store: RecordStore<PhoneInstance>;
  private readonly knobBuf: GPUBuffer;
  private readonly knobs = PhoneUniforms.alloc(1);
  private knobLook: PhoneLookValues | undefined;
  private knobLaw: PhoneLaw | undefined;
  private droppedNow = 0;
  private group!: GPUBindGroup;
  private boundAssets = -1;
  private boundStore = -1;
  private count = 0;
  private litElsewhere = false;
  private target: NonNullable<SlotContext["target"]> = "frame";
  /** This frame's surfaces in paint order, and which of them light the mat (by night, a screen on). */
  private drawn: PhoneSurface[] = [];
  private glows: boolean[] = [];
  private counts = { words: 0, mips: 0 };
  /** The phone's numbers (law.ts `PHONE`) — a host tunes its own copy. */
  law: PhoneLaw = PHONE;
  private readonly device: GPUDevice;
  private readonly shared: PhoneShared;
  private readonly mat: MatPass;
  /** The root's pass owns the shared surfaces; a spawned slot's never disposes them. */
  private readonly root: boolean;

  private constructor(device: GPUDevice, shared: PhoneShared, mat: MatPass, root: boolean) {
    this.device = device;
    this.shared = shared;
    this.mat = mat;
    this.root = root;
    this.knobBuf = uniformBuffer(device, PhoneUniforms.size, "simulator/knobs");
    this.store = createRecordStore<PhoneInstance, keyof typeof Phone.slots>({
      device,
      def: Phone,
      capacity: 4,
      max: MAX_PHONES,
      label: "simulator/phones",
      pack: (r, _aux, into, slot) => {
        into.set(phoneValues(r), slot);
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
  ): Promise<PhonePass> {
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
        { binding: 8, stages: ["vertex"], buffer: "read-only-storage" },
      ],
      "simulator/phones",
    );
    const layout1 = bindLayout(
      device,
      [
        { binding: 0, stages: ["fragment"], texture: "float" },
        { binding: 1, stages: ["fragment"], texture: "float" },
      ],
      "simulator/surface",
    );
    const module = await compile(device, compose(src));
    const layout = device.createPipelineLayout({ bindGroupLayouts: [layout0, layout1] });
    const made = (label: string, fragment: "fs" | "fs_spill", blend: GPUBlendState, lit: boolean) =>
      renderPipeline(device, {
        label,
        layout,
        module,
        format,
        fragment,
        blend,
        ...(lit ? { constants: { LIT_ELSEWHERE: 1 } } : {}),
      });
    const [phone, phoneLit, spill, spillLit] = await Promise.all([
      made("simulator/phones", "fs", BLEND_PREMUL, false),
      made("simulator/phones, lit from elsewhere", "fs", BLEND_PREMUL, true),
      made("simulator/spill", "fs_spill", BLEND_LIGHT, false),
      made("simulator/spill, lit from elsewhere", "fs_spill", BLEND_LIGHT, true),
    ]);
    const clamp = { addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" } as const;
    const blank = device.createTexture({
      label: "simulator/blank",
      size: [1, 1],
      format: WORDS_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: blank },
      new Uint8Array([0, 0, 0, 255]),
      { bytesPerRow: 4 },
      [1, 1, 1],
    );
    const shared: PhoneShared = {
      layout0,
      layout1,
      phone,
      phoneLit,
      spill,
      spillLit,
      goboSampler: device.createSampler({
        label: "simulator/gobo",
        magFilter: "linear",
        minFilter: "linear",
        ...clamp,
      }),
      noiseSampler: device.createSampler({
        label: "simulator/noise",
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "repeat",
      }),
      screenSampler: device.createSampler({
        label: "simulator/screen",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear",
        ...clamp,
      }),
      blank,
      surfaces: new Map(),
      onNotice: undefined,
    };
    return new PhonePass(device, shared, mat, true);
  }

  /** A slot's own records on the shared pipelines and surfaces, reading `mat`'s silhouette — a live inside's, a flight's departed desk's. */
  spawn(mat: MatPass): PhonePass {
    const p = new PhonePass(this.device, this.shared, mat, false);
    p.law = this.law;
    return p;
  }

  /** A spawned slot takes the root's law every frame. */
  tune(root: KindPass<PhoneInstance>): void {
    if (root instanceof PhonePass) this.law = root.law;
  }

  /** The law a host tunes (the dev panel's door); its slots follow through `tune`. */
  setLaw(law: unknown): void {
    this.law = law as PhoneLaw;
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
        s.screenSampler,
        this.store.order,
      ],
      "simulator/phones",
    );
    this.boundAssets = this.mat.assetVersion;
    this.boundStore = this.store.version;
  }

  /** The surface a key names, made the first time it is asked. */
  private surfaceFor(key: string): PhoneSurface {
    let surface = this.shared.surfaces.get(key);
    if (surface === undefined) {
      surface = new PhoneSurface(this.device, this.shared.layout1, this.shared.blank);
      this.shared.surfaces.set(key, surface);
    }
    return surface;
  }

  /**
   * Bring a phone's surface to what its record shows: its words laid (or let go), its screen bound to its live face's
   * texture with the mips this slot reads (by night the glow's coarse level too), the face's sight told what this slot drew.
   */
  private show(
    key: string,
    surface: PhoneSurface,
    r: PhoneInstance,
    encoder: GPUCommandEncoder,
    s: SlotContext,
  ): void {
    const G = r.geometry;
    const S = G.shape;
    const k = s.view.zoom * s.view.dpr;
    // the display's device px through this slot's view
    const px: readonly [number, number] = [2 * S.display[0] * k, 2 * S.display[1] * k];
    this.say(key, surface, r, encoder, px);
    const live = r.live;
    if (live === undefined) {
      surface.live = undefined;
      return;
    }
    // the sight is told every phone this slot PREPARED — within its reach, it may lie past the box: the sight believes only
    // one that meets it (ICE I50)
    live.sight.saw(live.e, s, displayRect(G));
    const t = live.face.texture();
    surface.live = t;
    if (t === undefined) return;
    const depth = liveDepth(t, px);
    t.prepare(encoder, s.light.night > 0 ? Math.max(depth, Math.ceil(glowLevel(t.width))) : depth);
  }

  /** A face's WORDS: their texture laid when what they say moved (the local is told its bytes), its mips made as deep as this slot reads its block; let go when the record carries none. */
  private say(
    key: string,
    surface: PhoneSurface,
    r: PhoneInstance,
    encoder: GPUCommandEncoder,
    px: readonly [number, number],
  ): void {
    const n = r.notice;
    const entity = key.startsWith("k") ? Number(key.slice(1)) : undefined;
    if (n === undefined) {
      if (surface.dropWords() && entity !== undefined) this.shared.onNotice?.(entity, 0);
      return;
    }
    if (surface.words?.key !== n.key) {
      surface.setWords(n);
      this.counts = { ...this.counts, words: this.counts.words + 1 };
      if (entity !== undefined) this.shared.onNotice?.(entity, surface.words?.bytes ?? 0);
    }
    const w = surface.words;
    if (w === undefined) return;
    // the block's device px on this slot's screen: its share of the display's
    const bw = (px[0] * 2 * n.block[2]) / n.points[0];
    const bh = (px[1] * 2 * n.block[3]) / n.points[1];
    const lod = Math.max(
      Math.log2(Math.max(w.width / Math.max(bw, 1e-3), w.height / Math.max(bh, 1e-3))),
      0,
    );
    const upTo = Math.min(Math.ceil(lod) + 1, w.levels - 1);
    if (upTo >= w.made) {
      mipsInto(this.device, encoder, w.texture, w.made, upTo);
      this.counts = { ...this.counts, mips: this.counts.mips + (upTo - w.made + 1) };
      w.made = upTo + 1;
    }
  }

  /** This frame's phones in paint order, through the persistent store (keyed by `extra.keys`; none = packed afresh — the still's form). */
  prepare(
    encoder: GPUCommandEncoder,
    s: SlotContext,
    records: readonly PhoneInstance[],
    extra?: KindExtra,
  ): number {
    const list = records.length > MAX_PHONES ? records.slice(0, MAX_PHONES) : records;
    const keys = extra?.keys;
    this.droppedNow = records.length - list.length;
    this.count = this.store.prepare(
      list,
      keys !== undefined && keys.length > MAX_PHONES ? keys.slice(0, MAX_PHONES) : keys,
    );
    const first = list[0];
    if (first !== undefined && (first.look !== this.knobLook || this.law !== this.knobLaw)) {
      this.knobs.set(phoneUniformValues(first.look, this.law));
      this.device.queue.writeBuffer(this.knobBuf, 0, this.knobs.view());
      this.knobLook = first.look;
      this.knobLaw = this.law;
    }
    const night = s.light.night > 0;
    this.drawn = [];
    this.glows = [];
    for (const [i, r] of list.slice(0, this.count).entries()) {
      const k = keys?.[i];
      const key = k === undefined ? `i${i}` : `k${Math.abs(k)}`;
      const surface = this.surfaceFor(key);
      this.show(key, surface, r, encoder, s);
      this.drawn.push(surface);
      this.glows.push(night && r.screen.on > 0);
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
  stats(): PhoneStats {
    return { ...this.counts, surfaces: this.shared.surfaces.size };
  }

  /** Who is told a phone's words' texture was made (its bytes) or let go (0): the kind's local charges the budget. */
  onNotice(fn: ((entity: number, bytes: number) => void) | undefined): void {
    this.shared.onNotice = fn;
  }

  /** A phone's words' texture let go at the budget's word: laid again from its record when it is next drawn. */
  unnotice(entity: number): boolean {
    return this.shared.surfaces.get(`k${Math.abs(entity)}`)?.dropWords() === true;
  }

  /** Words laid for a phone since its surface was made — what has LANDED on it (the kind's local's `landed`). */
  made(entity: number): number {
    return this.shared.surfaces.get(`k${Math.abs(entity)}`)?.made ?? 0;
  }

  /** A phone left the desk for good: its surface goes (the kind's local's `forget`). */
  forget(entity: number): void {
    const key = `k${Math.abs(entity)}`;
    this.shared.surfaces.get(key)?.dispose();
    this.shared.surfaces.delete(key);
  }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.count);
    if (first >= hi) return;
    const s = this.shared;
    pass.setBindGroup(0, this.group);
    // the screens' light on what lies below the run, by night — none in the hand's target (cleared to nothing: nothing to light)
    if (this.target !== "hand" && this.glows.slice(first, hi).some((g) => g)) {
      pass.setPipeline(this.litElsewhere ? s.spillLit : s.spill);
      for (let i = first; i < hi; i++) {
        const surface = this.drawn[i];
        if (surface === undefined || this.glows[i] !== true) continue;
        pass.setBindGroup(1, surface.group);
        pass.draw(6, 1, 0, i);
      }
    }
    pass.setPipeline(this.litElsewhere ? s.phoneLit : s.phone);
    for (let i = first; i < hi; i++) {
      const surface = this.drawn[i];
      if (surface === undefined) continue;
      pass.setBindGroup(1, surface.group);
      pass.draw(6, 1, 0, i);
    }
  }

  dispose(): void {
    this.store.dispose();
    this.knobBuf.destroy();
    if (this.root) {
      for (const surface of this.shared.surfaces.values()) surface.dispose();
      this.shared.surfaces.clear();
      this.shared.onNotice = undefined;
      this.shared.blank.destroy();
    }
  }
}
