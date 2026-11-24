import { createSwarmRenderer, type RenderBody, type SwarmFrame } from "@vibefield/puppeteer-views";
import { afterEach, expect, it, vi } from "vitest";

const ink = [1, 1, 1, 1] as const;
const colours = { orange: ink, blue: ink, green: ink };
const scene: Omit<SwarmFrame, "bodies"> = {
  time: 0,
  motion: true,
  fillOpacity: 1,
  gridPitch: 24,
  glow: { reach: 12, strength: 0.4, breath: 0.3 },
  stateGlow: { inner: 0.1, full: 0.9, strength: 0.2, count: 2, speed: 1, depth: 0.7 },
  theme: {
    ...colours,
    surface: ink,
    ink,
    grid: ink,
    shadow: ink,
    shadowPeak: ink,
    stateInk: colours,
    stateGlow: colours,
    stateGround: colours,
  },
};

function body(id: string, text: string): RenderBody {
  return {
    x: 100,
    y: 100,
    radius: 60,
    scale: 1,
    opacity: 1,
    focus: false,
    seed: 2,
    accent: ink,
    model: {
      id,
      rowId: id,
      state: "idle",
      appearance: "idle",
      radius: 60,
      accent: "white",
      copy: [{ key: "name", text, style: { size: 10, weight: 600 }, opacity: 1, tone: "ink" }],
      copyMaxWidthRatio: 1,
      hollow: false,
      running: false,
      unread: false,
      stale: false,
      active: false,
      ariaLabel: text,
      title: text,
    },
  };
}

// Exercise the shipping packer, atlas and draw order. Record the WebGPU
// boundary so this also runs on CI machines without a display or adapter.
async function rendererProbe() {
  const noop = () => {};
  const bufferWrites: { label: string; offset: number; floats: Float32Array }[] = [];
  type Rect = { x: number; y: number };
  const atlasCopies: {
    source: Rect | undefined;
    destination: Rect | undefined;
    width: number;
    height: number;
  }[] = [];
  const pendingImages: (() => void)[] = [];
  const queue = {
    submit: noop,
    writeBuffer(
      buffer: { label: string },
      offset: number,
      data: Float32Array,
      first = 0,
      size = data.length,
    ) {
      bufferWrites.push({ label: buffer.label, offset, floats: data.slice(first, first + size) });
    },
    copyExternalImageToTexture(
      source: { origin?: Rect },
      destination: { texture: { label: string }; origin?: Rect },
      size: { width: number; height: number },
    ) {
      if (destination.texture.label === "swarm glyph atlas")
        atlasCopies.push({ source: source.origin, destination: destination.origin, ...size });
    },
  };
  const pass = { setPipeline: noop, setBindGroup: noop, draw: noop, end: noop };
  const texture = { createView: () => ({}), destroy: noop };
  const device = {
    queue,
    destroy: noop,
    addEventListener: noop,
    lost: new Promise(() => {}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBuffer: ({ label }: { label: string }) => ({ label, destroy: noop }),
    createTexture: ({ label }: { label: string }) => ({ ...texture, label }),
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: noop }),
    createBindGroup: noop,
    createBindGroupLayout: noop,
    createPipelineLayout: noop,
    createRenderPipelineAsync: noop,
    createSampler: noop,
  };
  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 });
  vi.stubGlobal("navigator", {
    gpu: {
      requestAdapter: async () => ({
        limits: { maxTextureDimension2D: 8192 },
        requestDevice: async () => device,
      }),
      getPreferredCanvasFormat: () => "bgra8unorm",
    },
  });
  vi.stubGlobal(
    "Image",
    class {
      complete = false;
      naturalWidth = 0;
      onload?: () => void;
      set src(_value: string) {
        if (this.onload)
          pendingImages.push(() => {
            this.complete = true;
            this.naturalWidth = 24;
            this.onload?.();
          });
      }
      async decode() {}
    },
  );
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close: noop }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return {
          clearRect: noop,
          drawImage: noop,
          fillText: noop,
          measureText: () => ({
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: 5,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
            width: 6,
          }),
        };
      }
    },
  );
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue({
    configure: noop,
    getCurrentTexture: () => texture,
  } as unknown as GPUCanvasContext);
  const result = await createSwarmRenderer(canvas);
  if (!result.ok) throw Error(result.reason);
  result.renderer.resize(640, 480, 1);
  const render = (bodies: RenderBody[], overrides: Partial<SwarmFrame> = {}) => {
    bufferWrites.length = 0;
    atlasCopies.length = 0;
    result.renderer.render({ ...scene, bodies, ...overrides });
    return bufferWrites.filter((write) => write.label === "swarm glyphs");
  };
  return { ...result.renderer, render, atlasCopies, pendingImages };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("moves and fades retained labels without uploading them and keeps distant edits local", async () => {
  const probe = await rendererProbe();
  const bodies = Array.from({ length: 40 }, (_, index) => body(String(index), "AAA"));
  const initial = probe.render(bodies);
  expect(initial).toHaveLength(1);
  const stride = 16;
  expect(initial[0]!.floats).toHaveLength(40 * 3 * stride);
  expect(probe.atlasCopies).toHaveLength(1);
  const moved = bodies.map((b) => ({ ...b, x: 123.5, y: 87, opacity: 0.35 }));
  expect(probe.render(moved, { time: 3 })).toHaveLength(0);
  expect(probe.atlasCopies).toHaveLength(0);
  moved[0] = body("0", "BAA");
  moved[39] = body("39", "AAC");
  const edits = probe.render(moved);
  expect(edits.map((w) => [w.offset, w.floats.length])).toEqual([
    [0, stride],
    [119 * stride * 4, stride],
  ]);
  expect(probe.atlasCopies).toHaveLength(1);
  const copy = probe.atlasCopies[0]!;
  expect(copy.source).toEqual(copy.destination);
  expect(copy.source?.x).toBeGreaterThan(1);
  expect(copy.width * copy.height).toBeLessThan(1024);
  // A fresh board model can give the packer the same words.
  expect(probe.render(moved.map((b) => ({ ...b, model: { ...b.model } })))).toHaveLength(0);
  probe.destroy();
});

it("restores the whole run on buffer growth, preserves both paint layers and invalidates at a new DPR", async () => {
  const probe = await rendererProbe();
  const above = { ...body("above", "BB"), aboveClearings: true };
  const below = body("below", "AA");
  const marks = [{ x: 8, y: 10, size: 6, tile: { x: 0, y: 0 }, colour: ink, alpha: 0.7 }];
  const [initial] = probe.render([above, below], { marks });
  // Owner 0 is field space. Body slots follow paint order around the clearing.
  expect([0, 1, 2, 3, 4].map((i) => initial!.floats[i * 16 + 14])).toEqual([1, 1, 0, 2, 2]);
  const many = Array.from({ length: 750 }, (_, i) => body(String(i), "AAA"));
  const [growth] = probe.render(many);
  expect(growth!.offset).toBe(0);
  expect(growth!.floats).toHaveLength(750 * 3 * 16);
  expect(growth!.floats.at(-2)).toBe(750);
  expect(probe.render(many)).toHaveLength(0);
  probe.resize(640, 480, 2);
  expect(probe.render(many).length).toBeGreaterThan(0);
  expect(probe.atlasCopies).toEqual([
    { source: { x: 0, y: 0 }, destination: { x: 0, y: 0 }, width: 2048, height: 2048 },
  ]);
  expect(probe.render([below])).toHaveLength(1);
  expect(probe.render([below])).toHaveLength(0);
  probe.destroy();
});

it("redraws a still label after its icon decodes and applies a theme change", async () => {
  const probe = await rendererProbe();
  const item = body("a", "AB");
  item.model.copy[0]!.lead = { kind: "icon", icon: "folder", size: 12, gap: 3 };
  const still = { motion: false };
  expect(probe.render([item], still)[0]!.floats.length).toBe(2 * 16);
  expect(probe.render([item], still)).toHaveLength(0);
  expect(probe.pendingImages).toHaveLength(1);
  probe.pendingImages[0]!();
  expect(probe.render([item], still)[0]!.floats.length).toBe(3 * 16);
  expect(probe.atlasCopies).toHaveLength(1);
  expect(probe.render([item], still)).toHaveLength(0);
  const recoloured = probe.render([item], {
    ...still,
    theme: { ...scene.theme, ink: [0.5, 0, 0, 1] },
  });
  expect(recoloured[0]!.floats[8]).toBe(0.5);
  expect(probe.atlasCopies).toHaveLength(0);
  probe.destroy();
});
