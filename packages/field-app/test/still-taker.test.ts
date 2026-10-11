// PT-5b (ruling 1) — THE STILL'S SIZE AND ITS ROWS (surfaces/live/still-taker.ts): the pure halves of the host's hand on a
// page's pixels — a still is at most 1600 px on its long side, its shape the texture's; a buffer's rows carry WebGPU's
// padding to 256 bytes, and the picture is its rows without it. PT-5b2 (ruling 9) — and the taker's WIRING, on a device that
// records what it is asked: the target's format and size, the copy's row, the rows un-padded onto the canvas, the encoding
// asked for, and that the target and the buffer are let go on every path. (What the PLATFORM makes of it — the pass's
// pixels, the encoder's bytes — is the product smoke's: its STILL row holds the still's ground to the live page's at the
// law's dim.)
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_STILL_MAX_PX } from "../src/surfaces/live/page-stills";
import {
  createStillTaker,
  paddedRow,
  stillSize,
  tightRows,
} from "../src/surfaces/live/still-taker";

describe("PT-5b — a still's size and rows", () => {
  it("at most 1600 px on its long side, its shape kept; a texture within the bound is taken at its own size", () => {
    expect(PAGE_STILL_MAX_PX).toBe(1600);
    // a laptop page at 2×: 2560 × 1600 → 1600 × 1000
    expect(stillSize(2560, 1600)).toEqual([1600, 1000]);
    // a phone's, tall: 1206 × 2622 → 736 × 1600
    expect(stillSize(1206, 2622)).toEqual([736, 1600]);
    // a rest rung's texture, small: its own size — never scaled up
    expect(stillSize(640, 400)).toEqual([640, 400]);
    expect(stillSize(1600, 1600)).toEqual([1600, 1600]);
    // never an empty picture
    expect(stillSize(5000, 1)).toEqual([1600, 1]);
    expect(stillSize(0, 0)).toEqual([1, 1]);
    expect(stillSize(800, 600, 400)).toEqual([400, 300]);
  });

  it("a buffer's row is padded to 256 bytes; the picture is its rows without the padding, in order", () => {
    expect(paddedRow(1)).toBe(256);
    expect(paddedRow(64)).toBe(256);
    expect(paddedRow(65)).toBe(512);
    expect(paddedRow(1600)).toBe(6400);
    expect(paddedRow(736)).toBe(3072);
    // 3 texels wide, 2 rows: each row 12 bytes of picture in 256 of buffer
    const padded = new Uint8Array(2 * 256).fill(255);
    for (let i = 0; i < 12; i += 1) {
      padded[i] = i;
      padded[256 + i] = 100 + i;
    }
    expect([...tightRows(padded, 3, 2)]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
      111,
    ]);
  });
});

describe("PT-5b2 — the taker's wiring, on a device that records what it is asked (ruling 9)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A device that records, a canvas that records, and the platform's constants the taker reads. `mapped`: the bytes the
   * buffer answers when it is mapped; `lost`: the map rejects (the device went under the read). */
  function rig(opts: { mapped?: (size: number) => Uint8Array; lost?: boolean } = {}) {
    const said: Record<string, unknown[]> = {};
    const note = (what: string, arg?: unknown): void => {
      said[what] = [...(said[what] ?? []), arg];
    };
    const drawn: { data: Uint8ClampedArray; width: number; height: number }[] = [];
    const encodings: unknown[] = [];
    vi.stubGlobal("GPUTextureUsage", { RENDER_ATTACHMENT: 16, COPY_SRC: 1 });
    vi.stubGlobal("GPUBufferUsage", { COPY_DST: 8, MAP_READ: 1 });
    vi.stubGlobal("GPUMapMode", { READ: 1 });
    vi.stubGlobal(
      "ImageData",
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          readonly width: number,
          readonly height: number,
        ) {
          note("canvas", [width, height]);
        }
        getContext() {
          return {
            putImageData: (image: { data: Uint8ClampedArray; width: number; height: number }) =>
              drawn.push(image),
          };
        }
        async convertToBlob(asked: unknown) {
          encodings.push(asked);
          return { type: "image/webp", arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer };
        }
      },
    );
    let bufferSize = 0;
    const target = { createView: () => "target-view", destroy: vi.fn() };
    const buffer = {
      mapAsync: vi.fn(async () => {
        if (opts.lost === true) throw new Error("the device was lost");
      }),
      getMappedRange: () => (opts.mapped?.(bufferSize) ?? new Uint8Array(bufferSize)).buffer,
      unmap: vi.fn(),
      destroy: vi.fn(),
    };
    const device = {
      createShaderModule: () => "module",
      createRenderPipeline: (d: unknown) => {
        note("pipeline", d);
        return { getBindGroupLayout: () => "layout" };
      },
      createSampler: () => "sampler",
      createTexture: (d: unknown) => {
        note("texture", d);
        return target;
      },
      createBuffer: (d: { size: number }) => {
        note("buffer", d);
        bufferSize = d.size;
        return buffer;
      },
      createBindGroup: (d: unknown) => {
        note("bind", d);
        return "group";
      },
      createCommandEncoder: () => ({
        beginRenderPass: (d: unknown) => {
          note("pass", d);
          return { setPipeline: () => {}, setBindGroup: () => {}, draw: () => {}, end: () => {} };
        },
        copyTextureToBuffer: (...args: unknown[]) => note("copy", args),
        finish: () => "commands",
      }),
      queue: { submit: (c: unknown) => note("submit", c) },
    };
    return { device: device as unknown as GPUDevice, said, drawn, encodings, target, buffer };
  }
  const faceOf = (width: number, height: number, revision = 3) =>
    ({ width, height, revision, view: () => "face-view" }) as never;

  it("a laptop's 2560 × 1600 face: drawn into an sRGB target of 1600 × 1000, copied at 6400 bytes a row, its rows UN-PADDED onto a canvas of the still's size, encoded as WebP at 0.82 — and the target and the buffer let go", async () => {
    // every row of the mapped buffer begins with its own number, and its padding is 255s
    const stride = paddedRow(1600);
    const r = rig({
      mapped: (size) => {
        const bytes = new Uint8Array(size).fill(255);
        for (let y = 0; y < 1000; y += 1) bytes.fill(y % 251, y * stride, y * stride + 1600 * 4);
        return bytes;
      },
    });
    const taken = await createStillTaker()(r.device, faceOf(2560, 1600));
    expect(taken).toEqual({
      type: "image/webp",
      image: new Uint8Array([9, 8, 7]),
      size: [1600, 1000],
    });
    expect(r.said["texture"]).toEqual([
      { label: "desk-live/still target", size: [1600, 1000], format: "rgba8unorm-srgb", usage: 17 },
    ]);
    expect(r.said["pipeline"]?.[0]).toMatchObject({
      fragment: { targets: [{ format: "rgba8unorm-srgb" }] },
    });
    expect(r.said["buffer"]).toEqual([
      { label: "desk-live/still readback", size: 6400 * 1000, usage: 9 },
    ]);
    // the face's own view is what is drawn, and the copy names the padded row
    expect(r.said["bind"]?.[0]).toMatchObject({ entries: [{ resource: "face-view" }, {}] });
    expect(r.said["copy"]).toEqual([
      [{ texture: r.target }, { buffer: r.buffer, bytesPerRow: 6400 }, [1600, 1000]],
    ]);
    expect(r.said["submit"]).toEqual([["commands"]]);
    // the picture: 1600 × 1000, every row its own bytes and none of the padding
    expect(r.said["canvas"]).toEqual([[1600, 1000]]);
    const picture = r.drawn[0];
    expect([picture?.width, picture?.height, picture?.data.length]).toEqual([
      1600,
      1000,
      1600 * 1000 * 4,
    ]);
    expect(picture?.data[0]).toBe(0);
    expect(picture?.data[1600 * 4 - 1]).toBe(0);
    expect(picture?.data[1600 * 4]).toBe(1);
    expect(picture?.data[999 * 1600 * 4]).toBe(999 % 251);
    expect(picture?.data.includes(255)).toBe(false);
    expect(r.encodings).toEqual([{ type: "image/webp", quality: 0.82 }]);
    expect(r.buffer.unmap).toHaveBeenCalledTimes(1);
    expect(r.target.destroy).toHaveBeenCalledTimes(1);
    expect(r.buffer.destroy).toHaveBeenCalledTimes(1);
  });

  it("a face within the bound is taken at its own size; a face with no content is not read at all", async () => {
    const r = rig();
    expect((await createStillTaker()(r.device, faceOf(640, 400)))?.size).toEqual([640, 400]);
    expect(r.said["buffer"]).toEqual([
      { label: "desk-live/still readback", size: paddedRow(640) * 400, usage: 9 },
    ]);
    const empty = rig();
    expect(await createStillTaker()(empty.device, faceOf(2560, 1600, 0))).toBeUndefined();
    expect(empty.said["texture"]).toBeUndefined();
  });

  it("a read that FAILS (the device lost under it) answers no still — and still lets its target and its buffer go", async () => {
    const r = rig({ lost: true });
    expect(await createStillTaker()(r.device, faceOf(2560, 1600))).toBeUndefined();
    expect(r.encodings).toEqual([]);
    expect(r.target.destroy).toHaveBeenCalledTimes(1);
    expect(r.buffer.destroy).toHaveBeenCalledTimes(1);
  });
});
