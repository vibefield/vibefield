import { PAPER_TEX, paperTexture } from "@vibecook/ice/desk/kit";
import { type BackPrints, type PressSurface, paintBack } from "./back-print";
import { CARD_DESIGN, LAMP_COLOUR, PRESS } from "./press-numbers";
import { PRESS_FS, PRESS_VS } from "./press-shader";

export { PRESS } from "./press-numbers";

/**
 * THE PRESS (CS-D5 A, CS-D6 C; DESIGN.md §5 "The stock is printed, once — the press"). Every card wears the same stock, so
 * it is printed once per side, size, density and light by one WebGL2 context on an OffscreenCanvas, read out as an
 * image, and the context is let go. The hand then asks nothing of the GPU: the browser moves the printed cards as layers.
 * Where WebGL2 is refused the answer is null, and a card keeps its flat stock.
 */

export interface PrintSpec {
  readonly side: "front" | "back";
  /** design units, a card's (120 × 168) */
  readonly width: number;
  readonly height: number;
  /** device px a design unit: the window's pixel density, times 2.4 for a card picked up */
  readonly density: number;
  readonly night: boolean;
}

/** The surface the press draws on, as the press uses it. */
export interface PressCanvas {
  readonly width: number;
  readonly height: number;
  getContext(kind: "webgl2", options?: WebGLContextAttributes): WebGL2RenderingContext | null;
  convertToBlob(options?: { type?: string }): Promise<Blob>;
}

export interface PressDeps {
  /** a surface of this many device px, or null where there is none */
  readonly canvas: (width: number, height: number) => PressCanvas | null;
  /** the back's prints at this many px a design unit */
  readonly paintBack: (scale: number) => BackPrints;
  /** an address for a printed image */
  readonly url: (blob: Blob) => string;
}

const DEFAULT_DEPS: PressDeps = {
  canvas: (w, h) =>
    typeof OffscreenCanvas === "undefined"
      ? null
      : (new OffscreenCanvas(w, h) as unknown as PressCanvas),
  paintBack: (scale) => paintBack(scale),
  url: (blob) => URL.createObjectURL(blob),
};

/** A print's key: its side, size, density and light. PURE. */
export const pressKey = (s: PrintSpec): string =>
  `${s.side}:${s.width}x${s.height}@${s.density}:${s.night ? "night" : "day"}`;

const printed = new Map<string, Promise<string | null>>();

/** The stock printed to `spec`, as an image's address: once per key, every later ask the same answer. */
export function printStock(
  spec: PrintSpec,
  deps: PressDeps = DEFAULT_DEPS,
): Promise<string | null> {
  const key = pressKey(spec);
  const had = printed.get(key);
  if (had !== undefined) return had;
  const job = press(spec, deps).catch(() => null);
  printed.set(key, job);
  return job;
}

/** Test seam: forget every print. */
export function resetPressForTest(): void {
  printed.clear();
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (s === null) throw new Error("the press could not make a shader");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

function program(gl: WebGL2RenderingContext): WebGLProgram {
  const p = gl.createProgram();
  if (p === null) throw new Error("the press could not make a program");
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, PRESS_VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, PRESS_FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? "program");
  return p;
}

function texture(
  gl: WebGL2RenderingContext,
  unit: number,
  source: { readonly bytes: Uint8Array; readonly size: number } | PressSurface | null,
  repeat: boolean,
): void {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (source === null) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  } else if ("bytes" in source) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      source.size,
      source.size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source.bytes,
    );
    gl.generateMipmap(gl.TEXTURE_2D);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
  }
}

const rgb = (hex: string): readonly [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

let PAPER: Uint8Array | null = null;

async function press(spec: PrintSpec, deps: PressDeps): Promise<string | null> {
  const w = Math.round(spec.width * spec.density);
  const h = Math.round(spec.height * spec.density);
  const canvas = deps.canvas(w, h);
  if (canvas === null) return null;
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (gl === null) return null;
  const lose = (): void => gl.getExtension("WEBGL_lose_context")?.loseContext();
  try {
    const prog = program(gl);
    gl.useProgram(prog);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    // the desk's own page: ICE's paper at its own seed, the one its notebook and calendar bake
    PAPER ??= paperTexture();
    texture(gl, 0, { bytes: PAPER, size: PAPER_TEX }, true);
    const back =
      spec.side === "back" ? deps.paintBack(spec.density * (spec.width / CARD_DESIGN.width)) : null;
    texture(gl, 1, back?.color ?? null, false);
    texture(gl, 2, back?.mask ?? null, false);
    texture(gl, 3, back?.height ?? null, false);
    const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, name);
    gl.uniform1i(u("uPaper"), 0);
    gl.uniform1i(u("uBackC"), 1);
    gl.uniform1i(u("uBackM"), 2);
    gl.uniform1i(u("uBackH"), 3);
    gl.uniform1i(u("uSide"), spec.side === "back" ? 1 : 0);
    gl.uniform2f(u("uSize"), CARD_DESIGN.width, CARD_DESIGN.height);
    gl.uniform1f(u("uRadius"), PRESS.corner);
    gl.uniform3fv(u("uPaperC"), [...rgb(PRESS.paper)]);
    gl.uniform3fv(u("uLight"), [...PRESS.lamp]);
    gl.uniform3fv(u("uRoom"), [...PRESS.room]);
    gl.uniform3fv(u("uLamp"), [...(spec.night ? LAMP_COLOUR.night : LAMP_COLOUR.day)]);
    gl.uniform1f(u("uNight"), spec.night ? 1 : 0);
    gl.uniform1f(u("uAmb"), spec.night ? PRESS.ambient.night : PRESS.ambient.day);
    gl.uniform1f(u("uPitch"), PRESS.linen.pitch);
    gl.uniform1f(u("uTip"), PRESS.linen.tip);
    gl.uniform1f(u("uShin"), PRESS.varnish.shininess);
    gl.uniform1f(u("uKs"), PRESS.varnish.strength);
    gl.uniform1f(u("uEdgeShade"), PRESS.edge.shade);
    gl.uniform1f(u("uEdgeW"), PRESS.edge.width);
    gl.uniform2f(u("uHs"), 1.6 / Math.max(1, w), 1.6 / Math.max(1, h));
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    lose();
    return deps.url(blob);
  } catch (error) {
    lose();
    throw error;
  }
}
