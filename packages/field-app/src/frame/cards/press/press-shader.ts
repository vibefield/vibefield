import { TOOTH_SCALE } from "@vibecook/ice/desk/kit";

/**
 * THE PRESS'S SHADER (DESIGN.md §5 "the press"): the round's card shader (Card Stock round 5's gl.js), held flat and
 * head on, since a print is the card at rest. It decodes the desk's paper for its mottle and tooth, weaves the linen, lights
 * it by the mat's lamp and the room's light under a satin varnish, darkens its cut edge, and for the back debosses the
 * pressed mark and prints its lights. One full quad; `vUV` runs from the print's top left. The tooth's scale is ICE's own
 * `TOOTH_SCALE`, so the decode follows the encode.
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
uniform sampler2D uPaper;
uniform sampler2D uBackC;
uniform sampler2D uBackM;
uniform sampler2D uBackH;
uniform int uSide;
uniform vec2 uSize;
uniform float uRadius;
uniform vec3 uPaperC;
uniform vec3 uLight;
uniform vec3 uRoom;
uniform vec3 uLamp;
uniform float uNight;
uniform float uAmb;
uniform float uPitch;
uniform float uTip;
uniform float uShin;
uniform float uKs;
uniform float uEdgeShade;
uniform float uEdgeW;
uniform vec2 uHs;
out vec4 outColor;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// linen: a fine embossed weave, fading where it would be finer than the print's pixels
vec2 linen(vec2 p) {
  float px = max(fwidth(p.x), fwidth(p.y));
  float fade = clamp(1.8 - px / uPitch * 2.4, 0.0, 1.0);
  float k = 6.2831853 / uPitch;
  float wx = cos(k * p.x) * (0.55 + 0.45 * sin(k * 0.5 * p.y));
  float wy = cos(k * p.y) * (0.55 + 0.45 * sin(k * 0.5 * p.x + 1.7));
  return vec2(wx, wy) * uTip * fade;
}

void main() {
  vec2 p = (vUV - 0.5) * uSize;
  float d = sdRound(p, uSize * 0.5, uRadius);
  float aa = max(fwidth(d), 1e-3);
  float alpha = clamp(0.5 - d / aa, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  bool back = uSide == 1;
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 N = vec3(0.0, 0.0, 1.0);

  // the desk's paper (ICE): the pulp and fibres over 64 units, the tooth over 9.6
  vec4 pt = texture(uPaper, p / 64.0);
  vec4 tt = texture(uPaper, p / 9.6);
  float paperV = (pt.r - 0.5) * (5.0 / 255.0) * 2.0 + (pt.g - 0.5) * (4.0 / 255.0) * 3.0;
  vec2 tooth = (tt.ba - 0.5) * (2.0 * ${TOOTH_SCALE.toFixed(1)} / 9.6) * 0.012 * clamp(1.6 - max(fwidth(p.x), fwidth(p.y)) * 2.0, 0.0, 1.0);

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
  N = normalize(N - vec3(1.0, 0.0, 0.0) * g.x - vec3(0.0, 1.0, 0.0) * g.y);

  // light: the mat's lamp, and the room's soft light above you
  vec3 L = normalize(uLight);
  vec3 Lr = normalize(uRoom);
  float flatL = max(L.z, 0.2);
  float kd = (1.0 - uAmb) / flatL;
  float diff = uAmb + kd * max(dot(N, L), 0.0);
  // a flat card reads 1.0; tipped toward the lamp it brightens, softly, never past 1.35
  diff = diff <= 1.0 ? diff : 1.0 + (1.0 - exp(-(diff - 1.0) * 1.6)) * 0.35;
  vec3 R = reflect(-V, N);
  float specL = pow(max(dot(N, normalize(L + V)), 0.0), uShin);
  float room = smoothstep(0.86, 0.995, dot(R, Lr));
  float sheen = uKs * (specL * 1.2 + room * 0.9);
  float inkGloss = gloss * (pow(max(dot(N, normalize(L + V)), 0.0), 110.0) * 0.9 + smoothstep(0.93, 0.998, dot(R, Lr)) * 0.55);
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  vec3 col = albedo * diff * uLamp;
  col += uLamp * (sheen + inkGloss) + vec3(0.9, 0.92, 0.95) * fres * uKs * 0.35;

  // the cut edge: a hair darker
  float edge = 1.0 - smoothstep(0.0, uEdgeW, -d);
  col = mix(col, col * uEdgeShade, edge * 0.85);
  // the mark's three lights, printed in a bright ink that holds its colour in shadow and glows a little by night
  col += albedo * lit * (0.34 + 0.5 * uNight);
  outColor = vec4(col * alpha, alpha);
}`;
