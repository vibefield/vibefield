import { TOOTH_SCALE } from "@vibecook/ice/desk/kit";
import { PRESS } from "./press-numbers";

/**
 * THE LAMP'S LIGHT, IN GLSL (DESIGN.md §5 "the press", "The lamp, live"; Card Stock round 5's gl.js): what the press's
 * shader and a held card's lamp share, so the light a card is printed in and the light that runs across it as it turns
 * are one piece of code. The desk's paper for its mottle and its tooth, the linen's weave, the lamp's diffuse and what
 * the satin varnish, a glossy ink and a glossy picture give back. The tooth's scale is ICE's own `TOOTH_SCALE`, so the
 * decode follows the encode. The diffuse's three numbers are `PRESS.diffuse`'s, which `lampOn` (lamp/turn.ts) reads
 * too: the card's brightness and the shader agree by construction.
 */

/** A number as GLSL spells a float. */
const glsl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** What the light reads: the desk's paper, the lamp and the room, the weave and the varnish. */
export const LIGHT_UNIFORMS = `uniform sampler2D uPaper;
uniform vec3 uLight;
uniform vec3 uRoom;
uniform vec3 uLamp;
uniform float uAmb;
uniform float uPitch;
uniform float uTip;
uniform float uShin;
uniform float uKs;`;

export const LIGHT_GLSL = `float sdRound(vec2 p, vec2 b, float r) {
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

// the desk's paper (ICE): its mottle and fibres over 64 units
float paperMottle(vec2 p) {
  vec4 pt = texture(uPaper, p / 64.0);
  return (pt.r - 0.5) * (5.0 / 255.0) * 2.0 + (pt.g - 0.5) * (4.0 / 255.0) * 3.0;
}

// and its tooth over 9.6
vec2 paperTooth(vec2 p) {
  vec4 tt = texture(uPaper, p / 9.6);
  return (tt.ba - 0.5) * (2.0 * ${TOOTH_SCALE.toFixed(1)} / 9.6) * 0.012 * clamp(1.6 - max(fwidth(p.x), fwidth(p.y)) * 2.0, 0.0, 1.0);
}

// the lamp's diffuse on a surface facing N: a flat card at rest reads 1.0; tipped toward the lamp it brightens,
// softly, never past 1 + ${glsl(PRESS.diffuse.over)}
float lampDiffuse(vec3 N) {
  vec3 L = normalize(uLight);
  float kd = (1.0 - uAmb) / max(L.z, ${glsl(PRESS.diffuse.low)});
  float diff = uAmb + kd * max(dot(N, L), 0.0);
  return diff <= 1.0 ? diff : 1.0 + (1.0 - exp(-(diff - 1.0) * ${glsl(PRESS.diffuse.knee)})) * ${glsl(PRESS.diffuse.over)};
}

// what comes back to the eye at V off a surface facing N: the satin varnish's sheen (the lamp, and the room's soft
// light above you), a glossy ink's where \`gloss\` says, a glossy picture's where \`photo\` says, and the grazing light
vec3 lampSpecular(vec3 N, vec3 V, float gloss, float photo) {
  vec3 L = normalize(uLight);
  vec3 Lr = normalize(uRoom);
  vec3 R = reflect(-V, N);
  float nh = max(dot(N, normalize(L + V)), 0.0);
  float ks = uKs * (1.0 - photo);
  float sheen = ks * (pow(nh, uShin) * 1.2 + smoothstep(0.86, 0.995, dot(R, Lr)) * 0.9);
  float inkGloss = gloss * (pow(nh, 110.0) * 0.9 + smoothstep(0.93, 0.998, dot(R, Lr)) * 0.55);
  float photoGloss = photo * (smoothstep(0.80, 0.99, dot(R, Lr)) * 0.5 + pow(nh, 90.0) * 0.6);
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  return uLamp * (sheen + inkGloss + photoGloss) + vec3(0.9, 0.92, 0.95) * fres * ks * 0.35;
}`;
