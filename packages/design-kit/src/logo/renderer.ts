/// <reference types="@webgpu/types" />
import { logoMobiusPhase, logoViewTilt } from "./motion";
import { type LogoParameters, normalizeLogo } from "./parameters";
import { LOGO_BODY_VERTICES, LOGO_EDGE_VERTICES, LOGO_SHADER } from "./shader";

const BUFFER_BYTES = 16 * 16;
const DEPTH_FORMAT: GPUTextureFormat = "depth24plus";
export type LogoPointer = readonly [number, number];
type LogoPipelines = {
  field: GPURenderPipeline;
  ribbon: GPURenderPipeline;
  edge: GPURenderPipeline;
};

/** Procedural field, opaque 3D ribbon, and depth-tested emissive edges. */
export class LogoRenderer {
  private buffer: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private data = new Float32Array(BUFFER_BYTES / 4);
  private disposed = false;
  private depth: GPUTexture | null = null;
  private color: GPUTexture | null = null;

  private constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    private canvas: HTMLCanvasElement,
    private pipelines: { smooth: LogoPipelines; single: LogoPipelines },
    private format: GPUTextureFormat,
  ) {
    this.buffer = device.createBuffer({
      label: "Living mark uniforms",
      size: BUFFER_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = device.createBindGroup({
      layout: pipelines.smooth.field.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.buffer } }],
    });
  }

  static async create(
    canvas: HTMLCanvasElement,
    onLost: (message: string) => void,
    signal?: AbortSignal,
  ): Promise<LogoRenderer> {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable. Showing the static mark.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
    signal?.throwIfAborted();
    if (!adapter) throw new Error("No WebGPU adapter is available. Showing the static mark.");
    const device = await adapter.requestDevice();
    try {
      signal?.throwIfAborted();
      const context = canvas.getContext("webgpu");
      if (!context) throw new Error("The WebGPU canvas could not start.");
      const format = navigator.gpu.getPreferredCanvasFormat();
      const module = device.createShaderModule({
        label: "VibeField spectral ribbon",
        code: LOGO_SHADER,
      });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((message) => message.type === "error");
      if (errors.length)
        throw new Error(errors.map((m) => `WGSL ${m.lineNum}: ${m.message}`).join("\n"));
      const layout = device.createPipelineLayout({
        bindGroupLayouts: [
          device.createBindGroupLayout({
            entries: [
              {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: "uniform", minBindingSize: BUFFER_BYTES },
              },
            ],
          }),
        ],
      });
      const createPipelines = async (sampleCount: number): Promise<LogoPipelines> => {
        const multisample = { count: sampleCount };
        const [field, ribbon, edge] = await Promise.all([
          device.createRenderPipelineAsync({
            label: "Light field",
            multisample,
            layout,
            vertex: { module, entryPoint: "fieldVertex" },
            fragment: { module, entryPoint: "fieldFragment", targets: [{ format }] },
            primitive: { topology: "triangle-list" },
            depthStencil: {
              format: DEPTH_FORMAT,
              depthWriteEnabled: false,
              depthCompare: "always",
            },
          }),
          device.createRenderPipelineAsync({
            label: "Spectral ribbon",
            multisample,
            layout,
            vertex: { module, entryPoint: "ribbonVertex" },
            fragment: {
              module,
              entryPoint: "ribbonFragment",
              targets: [{ format }],
            },
            primitive: { topology: "triangle-list", cullMode: "none" },
            depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "less" },
          }),
          device.createRenderPipelineAsync({
            label: "Flowing edge light",
            multisample,
            layout,
            vertex: { module, entryPoint: "edgeVertex" },
            fragment: {
              module,
              entryPoint: "edgeFragment",
              targets: [
                {
                  format,
                  blend: {
                    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                  },
                },
              ],
            },
            primitive: { topology: "triangle-strip" },
            depthStencil: {
              format: DEPTH_FORMAT,
              depthWriteEnabled: false,
              depthCompare: "less-equal",
            },
          }),
        ]);
        return { field, ribbon, edge };
      };
      const [smooth, single] = await Promise.all([createPipelines(4), createPipelines(1)]);
      signal?.throwIfAborted();
      context.configure({ device, format, alphaMode: "premultiplied" });
      const renderer = new LogoRenderer(device, context, canvas, { smooth, single }, format);
      void device.lost.then((info) => {
        if (!renderer.disposed)
          onLost(`GPU connection lost: ${info.message || info.reason}. Reload to reconnect.`);
      });
      device.addEventListener("uncapturederror", (event) => {
        if (!renderer.disposed) onLost(event.error.message);
      });
      return renderer;
    } catch (error) {
      device.destroy();
      throw error;
    }
  }

  resize(width: number, height: number): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.75, 1800 / Math.max(width, height, 1));
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
  }

  private createDepth(width: number, height: number, sampleCount = 4): GPUTexture {
    return this.device.createTexture({
      label: "Living mark depth",
      size: [width, height],
      format: DEPTH_FORMAT,
      sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private createColor(width: number, height: number): GPUTexture {
    return this.device.createTexture({
      label: "Living mark antialiasing",
      size: [width, height],
      format: this.format,
      sampleCount: 4,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  draw(parameters: LogoParameters, time: number, pointer: LogoPointer, transparent = false): void {
    if (this.disposed) return;
    const { width, height } = this.canvas;
    if (!this.depth || this.depth.width !== width || this.depth.height !== height) {
      this.depth?.destroy();
      this.color?.destroy();
      this.depth = this.createDepth(width, height);
      this.color = this.createColor(width, height);
    }
    this.render(
      parameters,
      time,
      pointer,
      transparent,
      this.depth.createView(),
      this.color!.createView(),
    );
  }

  private render(
    parameters: LogoParameters,
    time: number,
    pointer: LogoPointer,
    transparent: boolean,
    depth: GPUTextureView,
    color: GPUTextureView | undefined,
    context = this.context,
    width = this.canvas.width,
    height = this.canvas.height,
  ): void {
    if (this.disposed) return;
    const p = parameters;
    this.data.set([
      width,
      height,
      time,
      Number(transparent),
      p.scale,
      p.width,
      p.height,
      p.thickness,
      p.taper,
      p.roundness,
      (p.rotation * Math.PI) / 180,
      p.asymmetry,
      p.chromatic,
      p.iridescence,
      p.glow,
      p.field,
      p.saturation,
      p.exposure,
      p.rays,
      p.density,
      p.spread,
      p.twist,
      p.grain,
      p.vignette,
      p.breathe,
      p.drift,
      pointer[0] * p.parallax,
      pointer[1] * p.parallax,
    ]);
    [p.colorA, p.colorB, p.colorC, p.colorD, p.background, p.ink].forEach((hex, index) => {
      const rgb = Number.parseInt(hex.slice(1), 16);
      this.data.set(
        [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, 1],
        28 + index * 4,
      );
    });
    this.data.set(
      [
        logoViewTilt(p),
        p.depth,
        p.perspective,
        0,
        p.edgeFlow,
        p.edgeSpeed,
        p.edgeLength,
        p.edgePulses,
        logoMobiusPhase(p, time),
        p.twistFocus,
        0,
        0,
      ],
      52,
    );
    this.device.queue.writeBuffer(this.buffer, 0, this.data);
    const encoder = this.device.createCommandEncoder();
    const output = context.getCurrentTexture().createView();
    const pipelines = color ? this.pipelines.smooth : this.pipelines.single;
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: color ?? output,
          ...(color ? { resolveTarget: output } : {}),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
      depthStencilAttachment: {
        view: depth,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    });
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(pipelines.field);
    pass.draw(3);
    pass.setPipeline(pipelines.ribbon);
    pass.draw(LOGO_BODY_VERTICES);
    pass.setPipeline(pipelines.edge);
    pass.draw(LOGO_EDGE_VERTICES, 2);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  async snapshot(
    parameters: LogoParameters,
    time: number,
    size = 2048,
    transparent = false,
  ): Promise<Blob> {
    if (this.disposed) throw new Error("The renderer is no longer available.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(4096, Math.max(128, Math.round(size)));
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Could not create the export canvas.");
    context.configure({ device: this.device, format: this.format, alphaMode: "premultiplied" });
    // At 4K, native pixel density replaces MSAA to bound export GPU memory.
    const color = canvas.width <= 2048 ? this.createColor(canvas.width, canvas.height) : undefined;
    const depth = this.createDepth(canvas.width, canvas.height, color ? 4 : 1);
    try {
      this.render(
        normalizeLogo(parameters),
        time,
        [0, 0],
        transparent,
        depth.createView(),
        color?.createView(),
        context,
        canvas.width,
        canvas.height,
      );
      // Request the snapshot in the same task as submit, before the canvas texture expires.
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("The PNG could not be encoded."))),
          "image/png",
        ),
      );
    } finally {
      context.unconfigure();
      depth.destroy();
      color?.destroy();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.context.unconfigure();
    this.depth?.destroy();
    this.color?.destroy();
    this.buffer.destroy();
    this.device.destroy();
  }
}
