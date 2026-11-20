import { type BackPrints, paintBack } from "./back-print";
import { bindQuad, bindTexture, deskPaper, linkProgram, setLight } from "./gl-kit";
import { type PressColours, pressColours, rootToken } from "./press-colours";
import { CARD_DESIGN } from "./press-numbers";
import { PRESS_FS, PRESS_VS } from "./press-shader";

export { PRESS, PRESS_TOKENS } from "./press-numbers";

/**
 * THE PRESS (CS-D5 A, CS-D6 C; DESIGN.md §5 "The stock is printed, once — the press"). Every card wears the same stock, so
 * it is printed once per side, size, density and light by one WebGL2 context on an OffscreenCanvas, read out as an
 * image, and the context is let go. The hand then asks nothing of the GPU: the browser moves the printed cards as layers.
 * Where WebGL2 is refused the answer is null, and a card keeps its flat stock. Its colours are the root's tokens, read
 * when it prints (§5 "Its colours are tokens"); where one cannot be read the answer is null too, and is not kept.
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
  /** the back's prints at this many px a design unit, in the press's colours */
  readonly paintBack: (scale: number, colours: PressColours) => BackPrints;
  /** an address for a printed image */
  readonly url: (blob: Blob) => string;
  /** a token's value as the root holds it now */
  readonly token: (name: string) => string;
}

const DEFAULT_DEPS: PressDeps = {
  canvas: (w, h) =>
    typeof OffscreenCanvas === "undefined"
      ? null
      : (new OffscreenCanvas(w, h) as unknown as PressCanvas),
  paintBack: (scale, colours) => paintBack(scale, colours),
  url: (blob) => URL.createObjectURL(blob),
  token: rootToken,
};

/** A print's key: its side, size, density and light. PURE. */
export const pressKey = (s: PrintSpec): string =>
  `${s.side}:${s.width}x${s.height}@${s.density}:${s.night ? "night" : "day"}`;

const printed = new Map<string, Promise<string | null>>();

/** The stock printed to `spec`, as an image's address: once per key, every later ask the same answer. Its colours are
 * read before anything is made, so a token it cannot read makes no context, and that answer is not kept: a later ask,
 * once the root holds its tokens, prints. */
export function printStock(
  spec: PrintSpec,
  deps: PressDeps = DEFAULT_DEPS,
): Promise<string | null> {
  const key = pressKey(spec);
  const had = printed.get(key);
  if (had !== undefined) return had;
  const colours = pressColours(deps.token);
  if (colours === null) return Promise.resolve(null);
  const job = press(spec, colours, deps).catch(() => null);
  printed.set(key, job);
  return job;
}

/** Test seam: forget every print. */
export function resetPressForTest(): void {
  printed.clear();
}

async function press(
  spec: PrintSpec,
  colours: PressColours,
  deps: PressDeps,
): Promise<string | null> {
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
    const prog = linkProgram(gl, PRESS_VS, PRESS_FS);
    // Item 620 (2026-11-20): WebGL's own `useProgram`, not a React hook
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's own call, not a hook
    gl.useProgram(prog);
    bindQuad(gl, prog);
    bindTexture(gl, 0, deskPaper(), true);
    const back =
      spec.side === "back"
        ? deps.paintBack(spec.density * (spec.width / CARD_DESIGN.width), colours)
        : null;
    bindTexture(gl, 1, back?.color ?? null, false);
    bindTexture(gl, 2, back?.mask ?? null, false);
    bindTexture(gl, 3, back?.height ?? null, false);
    setLight(gl, prog, {
      side: spec.side,
      night: spec.night,
      paper: colours.paper,
      width: w,
      height: h,
    });
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
