// THE STILL, TAKEN AND SHOWN (PT-5b ruling 1) — the host's hands on a page's pixels (PA-22: never a plugin's):
//  - TAKEN from what the face's writer holds: the face's texture read back on the desk's device — one small pass that draws
//    it into a target of the still's size (at most `PAGE_STILL_MAX_PX` on its long side, four filtered taps a pixel), one
//    copy to a buffer, one map — then encoded by the platform. No frame is asked of the producer and nothing crosses to main: the still is exactly
//    what the pane was showing. (`capturePage` in main was the other way: a second picture, of another moment, over IPC.)
//  - ENCODED as WebP at quality 0.82: a page is text and flat colour, which PNG keeps whole at 0.5–2 MB a still and WebP
//    keeps legible at a tenth of that — the bound (64 MB a device) is then a few hundred stills, not a few dozen. Where the
//    platform cannot encode WebP it answers PNG, and the still says the type it really is.
//  - SHOWN by decoding it with the platform (`createImageBitmap`) and handing the bitmap to the face's own writer — the one
//    path a live frame takes.
// Only this module touches the pixels, and it says them to nobody: no log, no diagnostic.

import type { LiveTexture } from "@vibecook/ice/desk/kit";
import { PAGE_STILL_MAX_PX, type PageStill } from "./page-stills";

/** A still as taken: the encoded picture and its size. */
export interface TakenStill {
  readonly type: string;
  readonly image: Uint8Array<ArrayBuffer>;
  readonly size: readonly [number, number];
}

/** Reads a face's texture back and encodes it — undefined where it cannot (no content, a device lost under it). */
export type StillTaker = (device: GPUDevice, face: LiveTexture) => Promise<TakenStill | undefined>;
/** A kept still as a picture the face's writer copies from — undefined where it cannot be read. */
export type StillDecoder = (
  still: Pick<PageStill, "type" | "image">,
) => Promise<ImageBitmap | undefined>;

/** The quality a still is encoded at. */
export const PAGE_STILL_QUALITY = 0.82;
export const PAGE_STILL_ENCODING = "image/webp";

/** A still's size for a texture `w` × `h`: its own, or scaled down so its long side is `max`. */
export function stillSize(w: number, h: number, max: number = PAGE_STILL_MAX_PX): [number, number] {
  const s = Math.min(1, max / Math.max(w, h, 1));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

/** A buffer's rows are padded to 256 bytes (WebGPU's copy law): the bytes a row takes, and the rows without their padding. */
export const paddedRow = (width: number): number => Math.ceil((width * 4) / 256) * 256;
export function tightRows(
  padded: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const stride = paddedRow(width);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    out.set(padded.subarray(y * stride, y * stride + width * 4), y * width * 4);
  return out;
}

const BLIT = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[i];
  var o: VO; o.pos = vec4f(p, 0.0, 1.0); o.uv = vec2f(0.5 * p.x + 0.5, 0.5 - 0.5 * p.y); return o;
}
// four taps a target pixel, spread as far as the picture is scaled down (none at its own size): a 2.5× reduction — a
// 4096-texel face into 1600 — is filtered, not point-sampled; text stays legible
@fragment fn fs(v: VO) -> @location(0) vec4f {
  let px = vec2f(dpdx(v.uv).x, dpdy(v.uv).y);
  let dim = vec2f(textureDimensions(src, 0));
  let ratio = max(abs(px.x) * dim.x, abs(px.y) * dim.y);
  let o = 0.25 * px * clamp(ratio - 1.0, 0.0, 1.0);
  let c = textureSampleLevel(src, samp, v.uv + vec2f(-o.x, -o.y), 0.0).rgb
        + textureSampleLevel(src, samp, v.uv + vec2f(o.x, -o.y), 0.0).rgb
        + textureSampleLevel(src, samp, v.uv + vec2f(-o.x, o.y), 0.0).rgb
        + textureSampleLevel(src, samp, v.uv + vec2f(o.x, o.y), 0.0).rgb;
  return vec4f(0.25 * c, 1.0);
}
`;

interface BlitKit {
  readonly pipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
}
const kits = new WeakMap<GPUDevice, BlitKit>();
function kitOf(device: GPUDevice): BlitKit {
  let k = kits.get(device);
  if (k === undefined) {
    const module = device.createShaderModule({ label: "desk-live/still", code: BLIT });
    k = {
      pipeline: device.createRenderPipeline({
        label: "desk-live/still",
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm-srgb" }] },
      }),
      sampler: device.createSampler({
        label: "desk-live/still",
        minFilter: "linear",
        magFilter: "linear",
      }),
    };
    kits.set(device, k);
  }
  return k;
}

/** The product's taker: the face's texture read back on the desk's device and encoded by the platform. */
export function createStillTaker(): StillTaker {
  return async (device, face) => {
    if (face.revision === 0 || typeof OffscreenCanvas === "undefined") return undefined;
    const [w, h] = stillSize(face.width, face.height);
    const kit = kitOf(device);
    const target = device.createTexture({
      label: "desk-live/still target",
      size: [w, h],
      format: "rgba8unorm-srgb",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const stride = paddedRow(w);
    const buffer = device.createBuffer({
      label: "desk-live/still readback",
      size: stride * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = device.createCommandEncoder({ label: "desk-live/still" });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: [0, 0, 0, 1],
          },
        ],
      });
      pass.setPipeline(kit.pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: kit.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: face.view() },
            { binding: 1, resource: kit.sampler },
          ],
        }),
      );
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: stride }, [w, h]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const rows = tightRows(new Uint8Array(buffer.getMappedRange()), w, h);
      buffer.unmap();
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (ctx === null) return undefined;
      ctx.putImageData(new ImageData(rows, w, h), 0, 0);
      const blob = await canvas.convertToBlob({
        type: PAGE_STILL_ENCODING,
        quality: PAGE_STILL_QUALITY,
      });
      return {
        type: blob.type || "image/png",
        image: new Uint8Array(await blob.arrayBuffer()),
        size: [w, h],
      };
    } catch {
      // a device lost under the take, a texture gone meanwhile: no still this time (the next take is another)
      return undefined;
    } finally {
      target.destroy();
      buffer.destroy();
    }
  };
}

/** The product's decoder: the platform's own (`createImageBitmap` over the still's bytes). */
export function createStillDecoder(): StillDecoder {
  return async (still) => {
    if (typeof createImageBitmap !== "function") return undefined;
    try {
      return await createImageBitmap(new Blob([still.image as BlobPart], { type: still.type }));
    } catch {
      return undefined;
    }
  };
}
