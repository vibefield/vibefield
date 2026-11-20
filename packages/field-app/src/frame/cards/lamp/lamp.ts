import { WINDOW } from "../card-fit";
import { type BackPrints, paintBack } from "../press/back-print";
import { bindQuad, bindTexture, deskPaper, linkProgram, setLight } from "../press/gl-kit";
import { type PressColours, pressColours, rootToken } from "../press/press-colours";
import { CARD_DESIGN } from "../press/press-numbers";
import { LAMP_FS, LAMP_VS } from "./lamp-shader";
import { TURN } from "./turn";

/**
 * THE LAMP (DESIGN.md §5 "The lamp, live"; item 596, 2026-11-19): the light on a card picked up, live as it turns. The
 * hand's cards are printed once and moved as layers, and at rest and in motion the hand asks nothing of the GPU; a
 * card picked up is the one card the lamp is lit over: one small WebGL2 surface over the side that is up, lit when the
 * card comes up, drawn only when its turn moves, and let go when the card goes home. It draws no card (`lamp-shader`
 * says what it draws); where WebGL2 is refused, or a token cannot be read, it answers null and the card keeps its
 * print, turning in the print's own light.
 */

export interface LampSpec {
  readonly side: "front" | "back";
  /** device px a design unit: the window's pixel density times the held card's scale, the held print's own */
  readonly density: number;
  readonly night: boolean;
  /** the front's window holds a picture: smooth and glossy, with none of the stock under it */
  readonly photo: boolean;
}

export interface Lamp {
  /** The light on the side now: `frame` is where its right, its down and its normal point (`frameOf`). */
  draw(frame: readonly number[]): void;
  /** Nothing over the side: head on and flat, the print under it is that light already. */
  clear(): void;
  /** Let the context go. */
  release(): void;
}

/** The surface a lamp draws on, as the lamp uses it. */
export interface LampCanvas {
  width: number;
  height: number;
  getContext(kind: "webgl2", options?: WebGLContextAttributes): WebGL2RenderingContext | null;
}

export interface LampDeps {
  /** the back's prints at this many px a design unit, in the press's colours */
  readonly paintBack: (scale: number, colours: PressColours) => BackPrints;
  /** a token's value as the root holds it now */
  readonly token: (name: string) => string;
}

const DEFAULT_DEPS: LampDeps = {
  paintBack: (scale, colours) => paintBack(scale, colours),
  token: rootToken,
};

/** The size a lamp's surface is drawn at: the held print's. PURE. */
export function lampSize(density: number): { readonly width: number; readonly height: number } {
  return {
    width: Math.round(CARD_DESIGN.width * density),
    height: Math.round(CARD_DESIGN.height * density),
  };
}

/** A lamp lit on `canvas` for `spec`, or null where there is none: WebGL2 refused, or a colour not read. */
export function lightLamp(
  canvas: LampCanvas,
  spec: LampSpec,
  deps: LampDeps = DEFAULT_DEPS,
): Lamp | null {
  const colours = pressColours(deps.token);
  if (colours === null) return null;
  const { width, height } = lampSize(spec.density);
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (gl === null) return null;
  const release = (): void => gl.getExtension("WEBGL_lose_context")?.loseContext();
  try {
    const prog = linkProgram(gl, LAMP_VS, LAMP_FS);
    // Item 596 (2026-11-20): WebGL's own `useProgram`, not a React hook (the hook rule is item 620's)
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's own call, not a hook
    gl.useProgram(prog);
    bindQuad(gl, prog);
    bindTexture(gl, 0, deskPaper(), true);
    const back = spec.side === "back" ? deps.paintBack(spec.density, colours) : null;
    bindTexture(gl, 1, back?.color ?? null, false);
    bindTexture(gl, 2, back?.mask ?? null, false);
    bindTexture(gl, 3, back?.height ?? null, false);
    const u = setLight(gl, prog, {
      side: spec.side,
      night: spec.night,
      paper: colours.paper,
      width,
      height,
    });
    gl.uniform1f(u("uEye"), TURN.eye);
    gl.uniform4f(u("uWindow"), WINDOW.left, WINDOW.top, WINDOW.width, WINDOW.height);
    gl.uniform1f(u("uWindowR"), WINDOW.corner);
    gl.uniform1f(u("uPhoto"), spec.photo ? 1 : 0);
    const frameAt = u("uFrame");
    const turned = new Float32Array(9);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    return {
      // one quad over the whole surface, nothing blended: every draw is the whole picture
      draw(frame) {
        turned.set(frame);
        gl.uniformMatrix3fv(frameAt, false, turned);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      clear() {
        gl.clear(gl.COLOR_BUFFER_BIT);
      },
      release,
    };
  } catch {
    release();
    return null;
  }
}
