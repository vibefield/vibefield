import type { GlassLook, GlassPose } from "./glass-look";
import type { SplashFrame, SplashPost, SplashSize } from "./vibefield-splash.js";

// The Setup Assistant's glass drawn by the field (track FG, FG-3b; FG-D24; DESIGN.md §8 "The Setup Assistant's
// glass"; James, 2026-10-29: "can we just render the glass with webgpu too so we only do one field render"). Over
// the live field the glass is a pass of the field's own frame, so the window draws the field once and the
// compositor never blurs it again. It ports the draft page's glass.js (draft/first-run-glass, version 7), typed,
// without its brightness (the product's frost has none). Since FG-4b it draws the logo too: the field's own mark over
// the frost, where the field draws its mark, so the two are one mark in one frame (FG-D17 A).
//
// Each frame the glass stands, after the field's own passes (the vendored splash's `post` patch), on its device:
//   down   the frame to ½, ¼ and ⅛ (rgba16float), each texel a 4 × 4 box, only as deep as the blur needs
//   blur   a separable Gaussian at that depth: the CSS blur's σ (its radius × frost × fit × rise, in device px),
//          less what the levels have already blurred
//   glass  one pass over the frame in CSS's order (wizard-ui.css): the two shadows outside the glass (a rounded
//          box's Gaussian, after Evan Wallace's "Fast Rounded Rectangle Shadows"), then inside it the blurred frame,
//          saturated, then the tint and the grain, and over them the logo, inverted on milk
// The recipe and the pose come from the page (glass-look.ts). The edge's hairlines stay the browser's, at the
// screen's own pixels where the field may draw at fewer (its budget).

const WGSL = /* wgsl */ `
struct Glass {
  box: vec4f,     // the glass's centre and half size, device px
  shape: vec4f,   // its corner (device px), device px a glass px, the frost, device px a texel of the blurred level
  frost: vec4f,   // saturation less 1, the blurred frame's weight, the grain's opacity, 0
  tint: vec4f,
  s0: vec4f,      // the shadows: offset x, y, blur, spread (glass px), each with its colour
  s0c: vec4f,
  s1: vec4f,
  s1c: vec4f,
  mark: vec4f,    // the field's mark: x, y, w, h (device px)
  logo: vec4f,    // the logo's opacity; 1 to wear invert(1) hue-rotate(180deg); 0, 0
}
struct Blur { dir: vec2f, sigma: f32, radius: f32 }

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var<uniform> G: Glass;
@group(0) @binding(3) var<uniform> B: Blur;
@group(0) @binding(4) var markTex: texture_2d<f32>;

@vertex
fn full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

// a level from the one above it: four bilinear taps a texel off the centre of this texel's 2 x 2 block
@fragment
fn down(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let s = vec2f(textureDimensions(src));
  let uv = 2.0 * fc.xy / s;
  let o = 1.0 / s;
  return 0.25 * (textureSampleLevel(src, lin, uv - o, 0.0) + textureSampleLevel(src, lin, uv + o, 0.0)
    + textureSampleLevel(src, lin, uv + vec2f(o.x, -o.y), 0.0) + textureSampleLevel(src, lin, uv + vec2f(-o.x, o.y), 0.0));
}

// one direction of the Gaussian, two texels a tap at their weighted centre
@fragment
fn blur(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let s = vec2f(textureDimensions(src));
  let uv = fc.xy / s;
  let stride = B.dir / s;
  let k = -0.5 / max(B.sigma * B.sigma, 1e-4);
  var acc = textureSampleLevel(src, lin, uv, 0.0);
  var sum = 1.0;
  for (var i = 1.0; i <= B.radius; i += 2.0) {
    let w1 = exp(k * i * i);
    let w2 = exp(k * (i + 1.0) * (i + 1.0));
    let w = w1 + w2;
    if (w < 1e-5) {
      break;
    }
    let o = stride * ((i * w1 + (i + 1.0) * w2) / w);
    acc += (textureSampleLevel(src, lin, uv + o, 0.0) + textureSampleLevel(src, lin, uv - o, 0.0)) * w;
    sum += 2.0 * w;
  }
  return acc / sum;
}

fn sdBox(p: vec2f, ext: vec2f, r: f32) -> f32 {
  let q = abs(p) - ext + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
// the glass's own pixels: a one-pixel ramp just inside its border, which the browser's hairline covers, so nothing
// of the frost spills past the edge when the screen scales the field's pixels up to its own
fn cover(d: f32) -> f32 {
  return clamp(-d, 0.0, 1.0);
}
fn erf2(x: vec2f) -> vec2f {
  let s = sign(x);
  let a = abs(x);
  var y = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  y = y * y;
  return s - s / (y * y);
}
// the shadow of a rounded box blurred by sigma, exact across x (erf) and sampled four times down y
fn shadowRow(x: f32, y: f32, sigma: f32, r: f32, ext: vec2f) -> f32 {
  let delta = min(ext.y - r - abs(y), 0.0);
  let curved = ext.x - r + sqrt(max(0.0, r * r - delta * delta));
  let span = 0.5 + 0.5 * erf2((x + vec2f(-curved, curved)) * (0.70710678 / sigma));
  return span.y - span.x;
}
fn boxShadow(p: vec2f, ext: vec2f, sigma: f32, r: f32) -> f32 {
  let start = clamp(-3.0 * sigma, p.y - ext.y, p.y + ext.y);
  let end = clamp(3.0 * sigma, p.y - ext.y, p.y + ext.y);
  let dy = (end - start) / 4.0;
  var y = start + dy * 0.5;
  var v = 0.0;
  for (var i = 0; i < 4; i++) {
    v += shadowRow(p.x, p.y - y, sigma, r, ext) * exp(-(y * y) / (2.0 * sigma * sigma)) / (2.5066283 * sigma) * dy;
    y += dy;
  }
  return v;
}
// a CSS box-shadow (offset, blur and spread in glass px): sigma is half the blur
fn castShadow(p: vec2f, s: vec4f, ext: vec2f, r: f32, px: f32) -> f32 {
  let grow = s.w * px;
  return boxShadow(p - s.xy * px, ext + vec2f(grow), max(0.5 * s.z * px, 0.5), max(r + grow, 0.0));
}
// one layer over those below it, premultiplied
fn over(acc: vec4f, rgb: vec3f, a: f32) -> vec4f {
  return vec4f(rgb * a + acc.rgb * (1.0 - a), a + acc.a * (1.0 - a));
}
// CSS saturate(s), Filter Effects' matrix (columns)
fn saturated(c: vec3f, s: f32) -> vec3f {
  let m = mat3x3f(
    0.213 + 0.787 * s, 0.213 - 0.213 * s, 0.213 - 0.213 * s,
    0.715 - 0.715 * s, 0.715 + 0.285 * s, 0.715 - 0.715 * s,
    0.072 - 0.072 * s, 0.072 - 0.072 * s, 0.072 + 0.928 * s);
  return m * c;
}
// hue-rotate(180deg), Filter Effects' matrix (columns); the logo wears it after invert(1)
const HUE180 = mat3x3f(-0.574, 0.426, 0.426, 1.430, 0.430, 1.430, 0.144, 0.144, -0.856);
fn grain(c: vec2i) -> f32 {
  var h = (bitcast<u32>(c.x) * 0x8da6b343u) ^ (bitcast<u32>(c.y) * 0xd8163841u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  h = h ^ (h >> 15u);
  return f32(h) / 4294967295.0;
}

@fragment
fn glass(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = fc.xy - G.box.xy;
  let ext = G.box.zw;
  let r = G.shape.x;
  let px = G.shape.y;
  let fr = G.shape.z;
  let d = sdBox(p, ext, r);
  let inside = cover(d);
  var acc = vec4f(0.0);
  // the shadow layer: an outer box-shadow at the frost's opacity, so only outside the glass; the second listed lies
  // under the first
  if (inside < 1.0) {
    let outside = fr * (1.0 - inside);
    acc = over(acc, G.s1c.rgb, G.s1c.a * outside * castShadow(p, G.s1, ext, r, px));
    acc = over(acc, G.s0c.rgb, G.s0c.a * outside * castShadow(p, G.s0, ext, r, px));
  }
  if (inside > 0.0) {
    // the frost: the frame blurred and saturated (its backdrop-filter), then the tint (its ::after)
    let b = textureSampleLevel(src, lin, fc.xy / (G.shape.w * vec2f(textureDimensions(src))), 0.0);
    let seen = clamp(saturated(b.rgb / max(b.a, 1e-4), 1.0 + G.frost.x * fr), vec3f(0.0), vec3f(1.0));
    acc = over(acc, seen, inside * G.frost.y * b.a);
    acc = over(acc, G.tint.rgb, inside * G.tint.a * fr);
    // the grain: mid grey at the noise's alpha, a glass px a grain, fixed to the glass
    acc = over(acc, vec3f(0.5), inside * G.frost.z * fr * grain(vec2i(floor(p / px))));
  }
  // the logo: the field's own mark over the glass, where the field draws it, wearing the look's filter
  if (G.logo.x > 0.0) {
    let at = vec2i(floor(fc.xy - G.mark.xy));
    if (all(at >= vec2i(0)) && all(at < vec2i(G.mark.zw))) {
      let m = textureLoad(markTex, at, 0);
      if (m.a > 0.0) {
        var ink = m.rgb / m.a;
        if (G.logo.y > 0.5) {
          ink = clamp(HUE180 * (1.0 - ink), vec3f(0.0), vec3f(1.0));
        }
        acc = over(acc, ink, m.a * G.logo.x);
      }
    }
  }
  return acc;
}
`;

const LEVEL: GPUTextureFormat = "rgba16float";
const DEEPEST = 3;
/** The glass's uniforms: ten vec4s (the shader's `Glass`). */
const GLASS_FLOATS = 10 * 4;

/** What the levels have blurred by the time the glass reads one, as a variance in device px²: each level's 4 × 4
 * box (1.25 of its own texels² a level) and the bilinear read of the deepest (a tent, a sixth of its texel²). */
export function spent(level: number): number {
  return (1.25 * (4 ** level - 1)) / 3 + 4 ** level / 6;
}

/** How deep the frame goes down for a blur of `sigma` device px, and the Gaussian left to do there, its σ and radius
 * in that level's texels. */
export interface BlurPlan {
  readonly level: number;
  readonly sigma: number;
  readonly radius: number;
}

export function blurPlan(sigma: number): BlurPlan {
  const level = sigma < 6 ? 1 : sigma < 20 ? 2 : DEEPEST;
  const left = Math.sqrt(Math.max(0, sigma * sigma - spent(level))) / 2 ** level;
  return { level, sigma: left, radius: left < 0.25 ? 0 : Math.ceil(3 * left) };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One frame of the glass: how its blur runs, and the glass pass's uniforms, for a field drawn at `k` device px a
 * CSS px with the glass at `pose` in `look`, its mark LW × LH at MX, MY. */
export function glassFrame(
  look: GlassLook,
  pose: GlassPose,
  { k, MX, MY, LW, LH }: Pick<SplashSize, "k" | "MX" | "MY" | "LW" | "LH">,
): { blur: BlurPlan; uniforms: Float32Array<ArrayBuffer> } {
  const px = pose.fit * pose.rise * k;
  const sigma = look.blur * pose.frost * px;
  const blur = blurPlan(sigma);
  const shadow = (i: number): readonly number[] => {
    const s = look.shadows[i];
    return s === undefined ? [0, 0, 0, 0, 0, 0, 0, 0] : [s.x, s.y, s.blur, s.spread, ...s.color];
  };
  const uniforms = new Float32Array(GLASS_FLOATS);
  uniforms.set([
    pose.x * k,
    pose.y * k,
    (pose.w / 2) * px,
    (pose.h / 2) * px,
    look.radius * px,
    px,
    pose.frost,
    2 ** blur.level,
    look.saturate - 1,
    // below a 2 px blur the levels can only blur more than the frost asks, so the frame shows through instead
    smooth(0, 2, sigma),
    look.grain,
    0,
    ...look.tint,
    ...shadow(0),
    ...shadow(1),
    MX,
    MY,
    LW,
    LH,
    pose.logo,
    look.logoInvert ? 1 : 0,
    0,
    0,
  ]);
  return { blur, uniforms };
}

/** What the pass tells the field's side of the door. */
export interface GlassPassHooks {
  /** Whether the field draws the glass: said from the frame that first does, and again when it stops. */
  drawn(drawn: boolean): void;
  /** A frame now: the pass is ready, and no loop may be running (reduced motion). */
  frame(): void;
  /** The pass can't be made, so the browser keeps drawing the glass. */
  failed(message: string): void;
}

/** The glass as a pass over the field's frames. */
export interface GlassPass extends SplashPost {
  /** The recipe (glass-look.ts); null draws no glass. */
  setLook(look: GlassLook | null): void;
  /** Where the glass stands and how far it has formed; null draws no glass. */
  setPose(pose: GlassPose | null): void;
  destroy(): void;
}

interface Pipes {
  readonly down: GPURenderPipeline;
  readonly blur: GPURenderPipeline;
  readonly glass: GPURenderPipeline;
  readonly sampler: GPUSampler;
  readonly glassUbo: GPUBuffer;
  readonly blurUbo: readonly [GPUBuffer, GPUBuffer];
}

interface Level {
  readonly tex: GPUTexture;
  readonly view: GPUTextureView;
}

/** The pass, on the field's device, its canvas in `gpu`'s preferred format. Its pipelines are made on the first look,
 * so a boot with no Setup Assistant never makes them, and until they are ready it draws nothing. */
export function createGlassPass(
  device: GPUDevice,
  gpu: Pick<GPU, "getPreferredCanvasFormat">,
  hooks: GlassPassHooks,
): GlassPass {
  let look: GlassLook | null = null;
  let pose: GlassPose | null = null;
  let pipes: Pipes | null = null;
  let making = false;
  let gone = false;
  let drew = false;

  // the levels, sized to the frame and made again with it (or with the field's mark, which the glass reads)
  let made: { W: number; H: number; mark: GPUTexture } | null = null;
  const levels: Level[] = [];
  const temps: Level[] = [];
  const downGroups: GPUBindGroup[] = [];
  const blurGroups: (readonly [GPUBindGroup, GPUBindGroup])[] = [];
  const glassGroups: GPUBindGroup[] = [];

  const make = async (): Promise<Pipes> => {
    const format = gpu.getPreferredCanvasFormat();
    const module = device.createShaderModule({ label: "glass", code: WGSL });
    const pipe = (entryPoint: string, target: GPUColorTargetState) =>
      device.createRenderPipelineAsync({
        label: `glass-${entryPoint}`,
        layout: "auto",
        vertex: { module, entryPoint: "full" },
        fragment: { module, entryPoint, targets: [target] },
      });
    const premultiplied: GPUBlendComponent = {
      srcFactor: "one",
      dstFactor: "one-minus-src-alpha",
      operation: "add",
    };
    const [down, blur, glass] = await Promise.all([
      pipe("down", { format: LEVEL }),
      pipe("blur", { format: LEVEL }),
      pipe("glass", { format, blend: { color: premultiplied, alpha: premultiplied } }),
    ]);
    const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    const blurUbo = (dir: string) =>
      device.createBuffer({ label: `glass-blur-${dir}`, size: 16, usage: uniform });
    return {
      down,
      blur,
      glass,
      sampler: device.createSampler({ magFilter: "linear", minFilter: "linear" }),
      glassUbo: device.createBuffer({ label: "glass", size: GLASS_FLOATS * 4, usage: uniform }),
      blurUbo: [blurUbo("h"), blurUbo("v")],
    };
  };

  const release = (p: Pipes): void => {
    p.glassUbo.destroy();
    for (const ubo of p.blurUbo) ubo.destroy();
  };

  const destroySized = (): void => {
    for (const level of [...levels, ...temps]) level?.tex.destroy();
    levels.length = 0;
    temps.length = 0;
    made = null;
  };

  const level = (label: string, w: number, h: number): Level => {
    const tex = device.createTexture({
      label,
      size: [w, h],
      format: LEVEL,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    return { tex, view: tex.createView() };
  };

  const group = (pipeline: GPURenderPipeline, entries: GPUBindGroupEntry[]): GPUBindGroup =>
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });

  const resize = (p: Pipes, size: SplashSize, mark: GPUTexture): void => {
    if (made !== null && made.W === size.W && made.H === size.H && made.mark === mark) return;
    destroySized();
    made = { W: size.W, H: size.H, mark };
    const markView = mark.createView();
    for (let j = 1; j <= DEEPEST; j++) {
      const w = Math.max(1, Math.ceil(size.W / 2 ** j));
      const h = Math.max(1, Math.ceil(size.H / 2 ** j));
      const l = level(`glass-level-${j}`, w, h);
      const t = level(`glass-temp-${j}`, w, h);
      levels[j] = l;
      temps[j] = t;
      const above = levels[j - 1];
      if (above !== undefined) {
        downGroups[j] = group(p.down, [
          { binding: 0, resource: above.view },
          { binding: 1, resource: p.sampler },
        ]);
      }
      const blurOf = (from: Level, ubo: GPUBuffer): GPUBindGroup =>
        group(p.blur, [
          { binding: 0, resource: from.view },
          { binding: 1, resource: p.sampler },
          { binding: 3, resource: { buffer: ubo } },
        ]);
      blurGroups[j] = [blurOf(l, p.blurUbo[0]), blurOf(t, p.blurUbo[1])];
      glassGroups[j] = group(p.glass, [
        { binding: 0, resource: l.view },
        { binding: 1, resource: p.sampler },
        { binding: 2, resource: { buffer: p.glassUbo } },
        { binding: 4, resource: markView },
      ]);
    }
  };

  const run = (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bound: GPUBindGroup,
    view: GPUTextureView,
    load = false,
  ): void => {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          loadOp: load ? "load" : "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bound);
    pass.draw(3);
    pass.end();
  };

  const draw = (
    p: Pipes,
    encoder: GPUCommandEncoder,
    frame: SplashFrame,
    recipe: GlassLook,
    at: GlassPose,
  ): void => {
    resize(p, frame.size, frame.mark);
    const { blur, uniforms } = glassFrame(recipe, at, frame.size);
    const first = levels[1];
    const deepest = levels[blur.level];
    const temp = temps[blur.level];
    const blurs = blurGroups[blur.level];
    const glass = glassGroups[blur.level];
    if (
      first === undefined ||
      deepest === undefined ||
      temp === undefined ||
      blurs === undefined ||
      glass === undefined
    )
      return;
    // the frame itself is a new texture every frame, so its group is too
    const fromFrame = group(p.down, [
      { binding: 0, resource: frame.view },
      { binding: 1, resource: p.sampler },
    ]);
    run(encoder, p.down, fromFrame, first.view);
    for (let j = 2; j <= blur.level; j++) {
      const down = downGroups[j];
      const into = levels[j];
      if (down !== undefined && into !== undefined) run(encoder, p.down, down, into.view);
    }
    device.queue.writeBuffer(p.blurUbo[0], 0, new Float32Array([1, 0, blur.sigma, blur.radius]));
    device.queue.writeBuffer(p.blurUbo[1], 0, new Float32Array([0, 1, blur.sigma, blur.radius]));
    run(encoder, p.blur, blurs[0], temp.view);
    run(encoder, p.blur, blurs[1], deepest.view);
    device.queue.writeBuffer(p.glassUbo, 0, uniforms);
    run(encoder, p.glass, glass, frame.view, true);
  };

  return {
    setLook(next) {
      look = next;
      if (next === null || pipes !== null || making || gone) return;
      making = true;
      make().then(
        (ready) => {
          if (gone) {
            release(ready);
            return;
          }
          pipes = ready;
          hooks.frame();
        },
        (error: unknown) => {
          if (!gone) hooks.failed(error instanceof Error ? error.message : String(error));
        },
      );
    },
    setPose(next) {
      pose = next;
    },
    encode(encoder, frame) {
      const p = pipes;
      const recipe = look;
      const at = pose;
      const draws = p !== null && recipe !== null && at !== null;
      // a glass not yet frosted, with no logo on it, draws nothing, though the field already stands for it
      if (draws && (at.frost > 0.001 || at.logo > 0.001)) draw(p, encoder, frame, recipe, at);
      if (draws !== drew) {
        drew = draws;
        hooks.drawn(draws);
      }
    },
    destroy() {
      gone = true;
      destroySized();
      if (pipes !== null) release(pipes);
      pipes = null;
    },
  };
}
