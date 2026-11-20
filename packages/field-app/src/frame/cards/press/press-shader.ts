import { LIGHT_GLSL, LIGHT_UNIFORMS } from "./light-glsl";

/**
 * THE PRESS'S SHADER (DESIGN.md §5 "the press"): the round's card shader (Card Stock round 5's gl.js), held flat and
 * head on, since a print is the card at rest. It decodes the desk's paper for its mottle and tooth, weaves the linen, lights
 * it by the mat's lamp and the room's light under a satin varnish, darkens its cut edge, and for the back debosses the
 * pressed mark and prints its lights. One full quad; `vUV` runs from the print's top left. Its light is `light-glsl.ts`'s,
 * the one a held card's lamp draws with as the card turns (§5 "The lamp, live").
 */

export const PRESS_VS = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const PRESS_FS = `#version 300 es
precision highp float;
in vec2 vUV;
${LIGHT_UNIFORMS}
uniform sampler2D uBackC;
uniform sampler2D uBackM;
uniform sampler2D uBackH;
uniform int uSide;
uniform vec2 uSize;
uniform float uRadius;
uniform vec3 uPaperC;
uniform float uNight;
uniform float uEdgeShade;
uniform float uEdgeW;
uniform vec2 uHs;
out vec4 outColor;

${LIGHT_GLSL}

void main() {
  vec2 p = (vUV - 0.5) * uSize;
  float d = sdRound(p, uSize * 0.5, uRadius);
  float aa = max(fwidth(d), 1e-3);
  float alpha = clamp(0.5 - d / aa, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  bool back = uSide == 1;
  vec3 V = vec3(0.0, 0.0, 1.0);

  // the desk's paper (ICE): the pulp and fibres over 64 units, the tooth over 9.6
  float paperV = paperMottle(p);
  vec2 tooth = paperTooth(p);

  // both sides' prints are read every fragment (their derivatives must not sit in a branch), then one is kept
  vec3 bc = texture(uBackC, vUV).rgb;
  vec3 bm = texture(uBackM, vUV).rgb;
  float hx = texture(uBackH, vUV + vec2(uHs.x, 0.0)).r - texture(uBackH, vUV - vec2(uHs.x, 0.0)).r;
  float hy = texture(uBackH, vUV + vec2(0.0, uHs.y)).r - texture(uBackH, vUV - vec2(0.0, uHs.y)).r;
  vec3 albedo = back ? bc : uPaperC;
  float gloss = back ? bm.g : 0.0;
  float lit = back ? bm.b : 0.0;
  // the pressed mark, a deboss: its relief tips the normal
  vec2 relief = back ? -vec2(hx, hy) * 0.55 : vec2(0.0);
  albedo += vec3(1.05, 1.0, 0.8) * paperV * (back ? 0.4 : 1.0);

  vec2 g = linen(p) + tooth * 0.6 + relief;
  vec3 N = normalize(vec3(-g.x, -g.y, 1.0));

  // light: the mat's lamp, and the room's soft light above you
  vec3 col = albedo * lampDiffuse(N) * uLamp + lampSpecular(N, V, gloss, 0.0);

  // the cut edge: a hair darker
  float edge = 1.0 - smoothstep(0.0, uEdgeW, -d);
  col = mix(col, col * uEdgeShade, edge * 0.85);
  // the mark's three lights, printed in a bright ink that holds its colour in shadow and glows a little by night
  col += albedo * lit * (0.34 + 0.5 * uNight);
  outColor = vec4(col * alpha, alpha);
}`;
