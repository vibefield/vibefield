import { PAPER_TEX, paperTexture } from "@vibecook/ice/desk/kit";
import type { PressSurface } from "./back-print";
import type { Rgb } from "./press-colours";
import { CARD_DESIGN, LAMP_COLOUR, PRESS } from "./press-numbers";

/**
 * WHAT THE PRESS AND THE LAMP ASK OF WebGL2 (DESIGN.md §5 "the press", "The lamp, live"): a program linked from two
 * shaders, a texture laid in a unit, the desk's own paper, the one quad both draw, and the light both draw in (the
 * press's numbers, handed to `light-glsl.ts`'s uniforms). The press prints with them and lets its context go; a held
 * card's lamp draws with them while the card is up.
 */

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (s === null) throw new Error("WebGL2 made no shader for the hand's cards");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

/** A program of `vs` and `fs`, linked; it throws what the compiler said. */
export function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (p === null) throw new Error("WebGL2 made no program for the hand's cards");
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? "program");
  return p;
}

/** The one quad, over the whole surface, bound to `prog`'s `aPos`. */
export function bindQuad(gl: WebGL2RenderingContext, prog: WebGLProgram): void {
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
}

/** A square of bytes (the desk's paper), a painted surface (a back's print), or nothing (an empty slot). */
export type TextureSource =
  | { readonly bytes: Uint8Array; readonly size: number }
  | PressSurface
  | null;

/** `source` laid in texture unit `unit`: bytes are mipmapped, a surface is read as it is, nothing is one clear pixel. */
export function bindTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  source: TextureSource,
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

let PAPER: Uint8Array | null = null;

/** The desk's own page: ICE's paper at its own seed, the one its notebook and calendar bake. Made once. */
export function deskPaper(): { readonly bytes: Uint8Array; readonly size: number } {
  PAPER ??= paperTexture();
  return { bytes: PAPER, size: PAPER_TEX };
}

/** What a side is lit as: which side, in which light, on which paper, over how many device px. */
export interface LightSpec {
  readonly side: "front" | "back";
  readonly night: boolean;
  /** the front's paper, and the back's margin */
  readonly paper: Rgb;
  /** the surface, device px */
  readonly width: number;
  readonly height: number;
}

/**
 * The light, set on `prog`: where its four textures stand (the paper in unit 0; the back's colour, mask and height in
 * 1, 2 and 3), the side and the card's size, the paper's colour, and the press's numbers for the lamp, the room, the
 * weave, the varnish and the cut edge. It answers the program's uniform reader, for what a caller sets beside them.
 */
export function setLight(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  spec: LightSpec,
): (name: string) => WebGLUniformLocation | null {
  const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, name);
  gl.uniform1i(u("uPaper"), 0);
  gl.uniform1i(u("uBackC"), 1);
  gl.uniform1i(u("uBackM"), 2);
  gl.uniform1i(u("uBackH"), 3);
  gl.uniform1i(u("uSide"), spec.side === "back" ? 1 : 0);
  gl.uniform2f(u("uSize"), CARD_DESIGN.width, CARD_DESIGN.height);
  gl.uniform1f(u("uRadius"), PRESS.corner);
  gl.uniform3fv(
    u("uPaperC"),
    spec.paper.map((channel) => channel / 255),
  );
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
  gl.uniform2f(u("uHs"), 1.6 / Math.max(1, spec.width), 1.6 / Math.max(1, spec.height));
  return u;
}
