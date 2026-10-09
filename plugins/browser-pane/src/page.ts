/// <reference types="@webgpu/types" />
// A pane's PAGE — the texture its page is drawn from (BROWSER.md §5; the prototype's src/browser/page.ts, moved; it stays
// the plugin's — the kit has no live texture, p1 §2). The phone's screen made for a page: frames arrive at a stream's rate,
// so the texture is built for that rate —
//
//   present(frame)   one `copyExternalImageToTexture` into level 0 — an ImageBitmap, a canvas, a VideoFrame (PT-2's live
//                    frames). A frame of a new size makes a new texture; the same size reuses it.
//   presentBytes()   one `writeTexture` of raw sRGB rgba8 bytes into level 0 — PT-1's still (sample-page.ts), a Node host's.
//   prepare(levels)  the mip chain, re-made only for a frame not yet mipped and only as deep as it will be read (the
//                    page's level on the slot's screen; the glow's coarse level by night), into the FRAME's encoder, every
//                    view and pipeline cached: a frame costs one copy and a few tiny passes, never an allocation.
//
// `rgba8unorm-srgb`: sampling decodes to linear light, so the mips are filtered in linear light (a page seen small keeps
// its brightness) and the shader adds the page's light to the glass's reflections in linear light.

import { levelsOf } from "./layout";

const FORMAT: GPUTextureFormat = "rgba8unorm-srgb";

const MIP_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[i];
  var o: VO; o.pos = vec4f(p, 0.0, 1.0); o.uv = vec2f(0.5 * p.x + 0.5, 0.5 - 0.5 * p.y); return o;
}
@fragment fn fs(v: VO) -> @location(0) vec4f { return textureSampleLevel(src, samp, v.uv, 0.0); }
`;

interface MipKit {
  readonly pipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
}
const kits = new WeakMap<GPUDevice, MipKit>();
function mipKit(device: GPUDevice): MipKit {
  let k = kits.get(device);
  if (!k) {
    const module = device.createShaderModule({ label: "browser-pane/mips", code: MIP_WGSL });
    k = {
      pipeline: device.createRenderPipeline({
        label: "browser-pane/mips",
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: FORMAT }] },
      }),
      sampler: device.createSampler({
        label: "browser-pane/mips",
        minFilter: "linear",
        magFilter: "linear",
      }),
    };
    kits.set(device, k);
  }
  return k;
}

/** Something a frame can be copied from (PT-2's live frames). */
export type FrameSource =
  | ImageBitmap
  | HTMLCanvasElement
  | OffscreenCanvas
  | HTMLImageElement
  | HTMLVideoElement
  | VideoFrame;

export class PageTexture {
  texture: GPUTexture;
  width = 1;
  height = 1;
  levels = 1;
  /** Levels made for the frame in hand (1 = only the frame itself). */
  made = 1;
  /** Frames presented — a host's clock for "is there a new one". */
  frames = 0;
  private views: GPUTextureView[] = [];
  private mipGroups: GPUBindGroup[] = [];
  private readonly device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
    this.texture = this.make(1, 1);
    this.device.queue.writeTexture(
      { texture: this.texture },
      new Uint8Array([0, 0, 0, 255]),
      { bytesPerRow: 4 },
      [1, 1, 1],
    );
    this.bind();
  }

  private make(w: number, h: number): GPUTexture {
    this.width = w;
    this.height = h;
    this.levels = levelsOf(w, h);
    this.made = 1;
    return this.device.createTexture({
      label: `browser-pane/page ${w}×${h}`,
      size: [w, h],
      format: FORMAT,
      mipLevelCount: this.levels,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private bind(): void {
    this.views = Array.from({ length: this.levels }, (_, i) =>
      this.texture.createView({ baseMipLevel: i, mipLevelCount: 1 }),
    );
    const kit = mipKit(this.device);
    this.mipGroups = this.views.slice(0, -1).map((view) =>
      this.device.createBindGroup({
        label: "browser-pane/mip",
        layout: kit.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: kit.sampler },
        ],
      }),
    );
  }

  private fit(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.texture.destroy();
    this.texture = this.make(width, height);
    this.bind();
  }

  /** A new frame: into level 0 (a new texture only when the size changes). */
  present(source: FrameSource, width: number, height: number): void {
    this.fit(width, height);
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture: this.texture, premultipliedAlpha: false },
      [width, height],
    );
    this.made = 1;
    this.frames += 1;
  }

  /** A frame from raw sRGB rgba8 bytes (row 0 = top) — PT-1's still, a Node host, a test. */
  presentBytes(bytes: Uint8Array<ArrayBuffer>, width: number, height: number): void {
    this.fit(width, height);
    this.device.queue.writeTexture({ texture: this.texture }, bytes, { bytesPerRow: width * 4 }, [
      width,
      height,
      1,
    ]);
    this.made = 1;
    this.frames += 1;
  }

  /** Make the mips the frame will be read at, down to `upTo` (a level index), into the caller's encoder. Nothing when they are made. */
  prepare(encoder: GPUCommandEncoder, upTo: number): number {
    const want = Math.min(Math.max(Math.ceil(upTo), 0) + 1, this.levels);
    if (want <= this.made) return 0;
    const kit = mipKit(this.device);
    let passes = 0;
    for (let level = this.made; level < want; level++) {
      const pass = encoder.beginRenderPass({
        label: "browser-pane/mip",
        colorAttachments: [
          {
            view: this.views[level] as GPUTextureView,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });
      pass.setPipeline(kit.pipeline);
      pass.setBindGroup(0, this.mipGroups[level - 1] as GPUBindGroup);
      pass.draw(3);
      pass.end();
      passes++;
    }
    this.made = want;
    return passes;
  }

  /** Bytes on the device: the chain's. */
  get bytes(): number {
    let b = 0;
    for (let i = 0; i < this.levels; i++)
      b += Math.max(this.width >> i, 1) * Math.max(this.height >> i, 1) * 4;
    return b;
  }

  dispose(): void {
    this.texture.destroy();
  }
}
