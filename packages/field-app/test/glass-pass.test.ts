/**
 * Track FG, FG-3b — the Setup Assistant's glass drawn by the field (glass-pass.ts; FG-D24; DESIGN.md §8 "The Setup
 * Assistant's glass"): a pass over each frame the field draws, after its own. happy-dom has no WebGPU, so the pass
 * runs on a device and an encoder that record what it asks of them; the shader itself compiles only on a GPU.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlassLook, GlassPose } from "../src/boot/splash/glass-look";
import {
  blurPlan,
  createGlassPass,
  type GlassPassHooks,
  glassFrame,
  spent,
} from "../src/boot/splash/glass-pass";
import type { SplashFrame } from "../src/boot/splash/vibefield-splash.js";

/** §5's recipe by day, as glass-look.ts reads it. */
const LOOK: GlassLook = {
  tint: [1, 1, 1, 0.55],
  blur: 32,
  saturate: 1.12,
  grain: 0.03,
  radius: 32,
  shadows: [
    { color: [4 / 255, 5 / 255, 15 / 255, 0.55], x: 0, y: 40, blur: 120, spread: 0 },
    { color: [4 / 255, 5 / 255, 15 / 255, 0.28], x: 0, y: 12, blur: 32, spread: 0 },
  ],
};

/** Fitted at 0.75 in a 1200 × 800 window, formed. */
const POSE: GlassPose = { x: 600, y: 400, w: 880, h: 640, fit: 0.75, frost: 1, rise: 1 };

beforeEach(() => {
  vi.stubGlobal("GPUBufferUsage", { COPY_DST: 0x8, UNIFORM: 0x40 });
  vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 0x4, RENDER_ATTACHMENT: 0x10 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the glass's blur", () => {
  it("counts what the levels blur on their way down: each a 4 × 4 box, then the deepest's bilinear read", () => {
    expect(spent(1)).toBeCloseTo(1.25 + 4 / 6, 10);
    expect(spent(2)).toBeCloseTo(1.25 * 5 + 16 / 6, 10);
    expect(spent(3)).toBeCloseTo(1.25 * 21 + 64 / 6, 10);
  });

  it("goes down only as deep as the blur needs, and blurs there what the levels haven't", () => {
    expect([5.99, 6, 19.99, 20].map((sigma) => blurPlan(sigma).level)).toEqual([1, 2, 2, 3]);
    for (const sigma of [3, 12, 48, 64]) {
      const plan = blurPlan(sigma);
      const texel = 2 ** plan.level;
      // the levels' variance and the Gaussian's add up to the CSS blur's
      expect(spent(plan.level) + (plan.sigma * texel) ** 2).toBeCloseTo(sigma * sigma, 6);
      expect(plan.radius).toBe(Math.ceil(3 * plan.sigma));
    }
    // a 32px frost at 2 device px a CSS px: an eighth of the frame, 24 texels a side
    expect(blurPlan(64)).toEqual({ level: 3, sigma: expect.closeTo(7.9639, 4), radius: 24 });
    // a blur the first level already outdoes is left there
    expect(blurPlan(1)).toEqual({ level: 1, sigma: 0, radius: 0 });
  });
});

describe("the glass's uniforms", () => {
  it("are what the shader reads, in device px: the box, its shape, the frost, the tint and the two shadows", () => {
    const { blur, uniforms } = glassFrame(LOOK, POSE, { k: 2 });
    // 1.5 device px a glass px: a 48 px blur, from an eighth of the frame
    expect(blur.level).toBe(3);
    const expected = [
      [1200, 800, 660, 480],
      [48, 1.5, 1, 8],
      [0.12, 1, 0.03, 0],
      [1, 1, 1, 0.55],
      [0, 40, 120, 0],
      [4 / 255, 5 / 255, 15 / 255, 0.55],
      [0, 12, 32, 0],
      [4 / 255, 5 / 255, 15 / 255, 0.28],
    ].flat();
    expect(uniforms).toHaveLength(expected.length);
    for (const [i, value] of expected.entries()) {
      expect(uniforms[i], `float ${i}`).toBeCloseTo(value, 5);
    }
  });

  it("form with the glass: the blur and the box follow the frost and the rise", () => {
    const rising = glassFrame(LOOK, { ...POSE, frost: 0.5, rise: 0.985 }, { k: 2 });
    const px = 0.75 * 0.985 * 2;
    expect(rising.uniforms[2]).toBeCloseTo(440 * px, 3);
    expect(rising.uniforms[3]).toBeCloseTo(320 * px, 3);
    expect(rising.uniforms[6]).toBe(0.5);
    expect(rising.blur).toEqual(blurPlan(32 * 0.5 * px));
    // just condensing, the blur is under 2 px, so the frame shows through what the levels would blur
    const condensing = glassFrame(LOOK, { ...POSE, frost: 0.02, rise: 0.985 }, { k: 2 });
    expect(condensing.blur.level).toBe(1);
    expect(condensing.uniforms[9]).toBeGreaterThan(0);
    expect(condensing.uniforms[9]).toBeLessThan(1);
  });

  it("cast no shadow they weren't given", () => {
    const { uniforms } = glassFrame({ ...LOOK, shadows: [] }, POSE, { k: 2 });
    expect(Array.from(uniforms.slice(16))).toEqual(new Array(16).fill(0));
  });
});

/** A device that records what the pass asks of it; `fail` rejects its pipelines. */
function fakeDevice(fail?: Error) {
  const made = {
    modules: [] as string[],
    pipelines: [] as GPURenderPipelineDescriptor[],
    textures: [] as { label: string; size: number[]; destroyed: boolean }[],
    buffers: [] as { label: string; destroyed: boolean }[],
    writes: [] as { buffer: string; data: number[] }[],
  };
  const device = {
    createShaderModule({ code }: GPUShaderModuleDescriptor) {
      made.modules.push(code);
      return { code };
    },
    async createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor) {
      made.pipelines.push(descriptor);
      if (fail !== undefined) throw fail;
      return { label: descriptor.label, getBindGroupLayout: () => ({}) };
    },
    createSampler: () => ({}),
    createBuffer({ label = "" }: GPUBufferDescriptor) {
      const buffer = {
        label,
        destroyed: false,
        destroy() {
          buffer.destroyed = true;
        },
      };
      made.buffers.push(buffer);
      return buffer;
    },
    createTexture({ label = "", size }: GPUTextureDescriptor) {
      const texture = {
        label,
        size: size as number[],
        destroyed: false,
        destroy() {
          texture.destroyed = true;
        },
        createView: () => ({ of: label }),
      };
      made.textures.push(texture);
      return texture;
    },
    createBindGroup: ({ entries }: GPUBindGroupDescriptor) => ({ entries }),
    queue: {
      writeBuffer(buffer: { label: string }, _offset: number, data: Float32Array) {
        made.writes.push({ buffer: buffer.label, data: Array.from(data) });
      },
    },
  } as unknown as GPUDevice;
  return { device, made };
}

/** An encoder that records each render pass: its pipeline, what it draws into and whether it keeps it. */
function fakeEncoder() {
  const passes: { pipeline: string; into: unknown; load: GPULoadOp }[] = [];
  const encoder = {
    beginRenderPass({ colorAttachments }: GPURenderPassDescriptor) {
      const [attachment] = Array.from(colorAttachments);
      const pass = { pipeline: "", into: attachment?.view, load: attachment?.loadOp ?? "clear" };
      passes.push(pass);
      return {
        setPipeline(pipeline: { label: string }) {
          pass.pipeline = pipeline.label;
        },
        setBindGroup() {},
        draw() {},
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  return { encoder, passes };
}

/** The page's WebGPU, as the pass asks it for the canvas's format. */
const gpu = { getPreferredCanvasFormat: () => "bgra8unorm" as const };
const FRAME_VIEW = { of: "frame" } as unknown as GPUTextureView;

/** A frame the field has drawn at 2 device px a CSS px. */
function frame(W = 2400, H = 1600): SplashFrame {
  return {
    view: FRAME_VIEW,
    size: { k: 2, W, H, LW: 256, LH: 256, MX: 0, MY: 0 },
    mark: {} as GPUTexture,
    seconds: 0,
  };
}

function hooks() {
  return {
    drawn: vi.fn<GlassPassHooks["drawn"]>(),
    frame: vi.fn<GlassPassHooks["frame"]>(),
    failed: vi.fn<GlassPassHooks["failed"]>(),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const view = (label: string) => ({ of: label });

describe("the glass's pass", () => {
  it("makes nothing until the glass has a look, and draws nothing until it stands", async () => {
    const { device, made } = fakeDevice();
    const said = hooks();
    const pass = createGlassPass(device, gpu, said);
    const { encoder, passes } = fakeEncoder();
    pass.setPose(POSE);
    pass.encode(encoder, frame());
    await settle();
    expect(made.modules).toEqual([]);
    expect(passes).toEqual([]);
    expect(said.drawn).not.toHaveBeenCalled();
  });

  it("makes its pipelines on the first look — the shader without brightness or logo — then asks for a frame", async () => {
    const { device, made } = fakeDevice();
    const said = hooks();
    const pass = createGlassPass(device, gpu, said);
    pass.setLook(LOOK);
    pass.setLook({ ...LOOK, tint: [28 / 255, 28 / 255, 30 / 255, 0.55] });
    await settle();
    expect(made.modules).toHaveLength(1);
    const [code = ""] = made.modules;
    for (const entry of ["fn full(", "fn down(", "fn blur(", "fn glass("])
      expect(code).toContain(entry);
    // the product's frost has no brightness, and the logo comes with the holds (FG-4)
    expect(code).not.toMatch(/bright|logo|mark/iu);
    expect(
      made.pipelines.map((pipeline) => [
        pipeline.vertex.entryPoint,
        pipeline.fragment?.entryPoint,
        Array.from(pipeline.fragment?.targets ?? [])[0],
      ]),
    ).toEqual([
      ["full", "down", { format: "rgba16float" }],
      ["full", "blur", { format: "rgba16float" }],
      [
        "full",
        "glass",
        {
          format: "bgra8unorm",
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        },
      ],
    ]);
    expect(said.frame).toHaveBeenCalledTimes(1);
    expect(said.failed).not.toHaveBeenCalled();
  });

  it("draws after the field's own passes: down as deep as the blur, the blur both ways, then the glass over the frame", async () => {
    const { device, made } = fakeDevice();
    const said = hooks();
    const pass = createGlassPass(device, gpu, said);
    pass.setLook(LOOK);
    await settle();
    pass.setPose(POSE);
    const { encoder, passes } = fakeEncoder();
    pass.encode(encoder, frame());
    expect(passes).toEqual([
      { pipeline: "glass-down", into: view("glass-level-1"), load: "clear" },
      { pipeline: "glass-down", into: view("glass-level-2"), load: "clear" },
      { pipeline: "glass-down", into: view("glass-level-3"), load: "clear" },
      { pipeline: "glass-blur", into: view("glass-temp-3"), load: "clear" },
      { pipeline: "glass-blur", into: view("glass-level-3"), load: "clear" },
      { pipeline: "glass-glass", into: FRAME_VIEW, load: "load" },
    ]);
    // the levels halve the frame each time
    expect(
      made.textures
        .filter((texture) => texture.label.startsWith("glass-level"))
        .map(({ size }) => size),
    ).toEqual([
      [1200, 800],
      [600, 400],
      [300, 200],
    ]);
    const { blur } = glassFrame(LOOK, POSE, { k: 2 });
    expect(made.writes.slice(0, 2)).toEqual([
      { buffer: "glass-blur-h", data: [1, 0, expect.closeTo(blur.sigma, 5), blur.radius] },
      { buffer: "glass-blur-v", data: [0, 1, expect.closeTo(blur.sigma, 5), blur.radius] },
    ]);
    expect(made.writes[2]?.buffer).toBe("glass");
    expect(said.drawn.mock.calls).toEqual([[true]]);

    // said once, from the frame that first draws it
    pass.encode(fakeEncoder().encoder, frame());
    expect(said.drawn.mock.calls).toEqual([[true]]);
  });

  it("goes down no deeper than a shallow blur needs", async () => {
    const { device } = fakeDevice();
    const pass = createGlassPass(device, gpu, hooks());
    pass.setLook(LOOK);
    await settle();
    // a 4 px blur: the frost a twelfth formed, at 1.5 device px a glass px
    pass.setPose({ ...POSE, frost: 4 / 48 });
    const { encoder, passes } = fakeEncoder();
    pass.encode(encoder, frame());
    expect(passes.map(({ pipeline, into }) => [pipeline, into])).toEqual([
      ["glass-down", view("glass-level-1")],
      ["glass-blur", view("glass-temp-1")],
      ["glass-blur", view("glass-level-1")],
      ["glass-glass", FRAME_VIEW],
    ]);
  });

  it("stands for the glass before it has frosted, drawing nothing yet", async () => {
    const { device } = fakeDevice();
    const said = hooks();
    const pass = createGlassPass(device, gpu, said);
    pass.setLook(LOOK);
    await settle();
    pass.setPose({ ...POSE, frost: 0, rise: 0.985 });
    const { encoder, passes } = fakeEncoder();
    pass.encode(encoder, frame());
    expect(passes).toEqual([]);
    expect(said.drawn.mock.calls).toEqual([[true]]);
  });

  it("makes its levels again only when the frame's size changes", async () => {
    const { device, made } = fakeDevice();
    const pass = createGlassPass(device, gpu, hooks());
    pass.setLook(LOOK);
    await settle();
    pass.setPose(POSE);
    pass.encode(fakeEncoder().encoder, frame());
    pass.encode(fakeEncoder().encoder, frame());
    expect(made.textures).toHaveLength(6);
    pass.encode(fakeEncoder().encoder, frame(2401, 1600));
    expect(made.textures).toHaveLength(12);
    expect(made.textures.slice(0, 6).every((texture) => texture.destroyed)).toBe(true);
    expect(made.textures.slice(6).some((texture) => texture.destroyed)).toBe(false);
    // an odd size rounds up, so the levels cover the whole frame
    const remade = made.textures.slice(6);
    expect(remade.find((texture) => texture.label === "glass-level-1")?.size).toEqual([1201, 800]);
    expect(remade.find((texture) => texture.label === "glass-level-3")?.size).toEqual([301, 200]);
  });

  it("stops drawing when the glass goes, and says so", async () => {
    const { device } = fakeDevice();
    const said = hooks();
    const pass = createGlassPass(device, gpu, said);
    pass.setLook(LOOK);
    await settle();
    pass.setPose(POSE);
    pass.encode(fakeEncoder().encoder, frame());
    pass.setLook(null);
    const { encoder, passes } = fakeEncoder();
    pass.encode(encoder, frame());
    expect(passes).toEqual([]);
    expect(said.drawn.mock.calls).toEqual([[true], [false]]);
  });

  it("says when it can't be made, and never draws, so the browser keeps the glass", async () => {
    const { device } = fakeDevice(new Error("WGSL failed"));
    const said = hooks();
    const pass = createGlassPass(device, gpu, said);
    pass.setLook(LOOK);
    await settle();
    expect(said.failed.mock.calls).toEqual([["WGSL failed"]]);
    expect(said.frame).not.toHaveBeenCalled();
    pass.setPose(POSE);
    // a second look tries no second time
    pass.setLook(LOOK);
    const { encoder, passes } = fakeEncoder();
    pass.encode(encoder, frame());
    expect(passes).toEqual([]);
    expect(said.drawn).not.toHaveBeenCalled();
  });

  it("lets its textures and buffers go, and a pass gone while it is made never asks for a frame", async () => {
    const { device, made } = fakeDevice();
    const pass = createGlassPass(device, gpu, hooks());
    pass.setLook(LOOK);
    await settle();
    pass.setPose(POSE);
    pass.encode(fakeEncoder().encoder, frame());
    pass.destroy();
    expect(made.textures.every((texture) => texture.destroyed)).toBe(true);
    expect(made.buffers.map(({ label, destroyed }) => [label, destroyed])).toEqual([
      ["glass", true],
      ["glass-blur-h", true],
      ["glass-blur-v", true],
    ]);

    const late = hooks();
    const later = fakeDevice();
    const gone = createGlassPass(later.device, gpu, late);
    gone.setLook(LOOK);
    gone.destroy();
    await settle();
    expect(late.frame).not.toHaveBeenCalled();
    expect(later.made.buffers).toHaveLength(3);
    expect(later.made.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });
});
