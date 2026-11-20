import { LIGHT_GLSL, LIGHT_UNIFORMS } from "../press/light-glsl";

/**
 * THE LAMP'S SHADER (DESIGN.md §5 "The lamp, live"; item 596, 2026-11-19): what the lamp's light does to a card picked
 * up as it turns, drawn over the side that is up. It draws no card: the side under it is the press's print and the face
 * over it, and the card's own brightness already carries how brightly the lamp lights it flat (`lampOn`). What is left
 * is here, in the press's own light (`light-glsl.ts`):
 *
 * - **the shade**, its alpha: where the weave, the paper's tooth and the back's pressed mark now face further from the
 *   lamp than they did at rest, the print under them darkens by how much;
 * - **the light**, its colour, added: where they face nearer, the paper's own lift; the varnish's sheen as the lamp and
 *   the room's soft light cross the card; a picture's gloss in the window; and the back's three lights, which hold
 *   their colour in shadow.
 *
 * Head on and at rest it draws nothing: the print is that light already. One full quad over the side, premultiplied;
 * `vUV` runs from the side's top left; `uFrame` is where the side's right, its down and its normal point once the
 * card is turned (`frameOf`), and the eye stands `uEye` out from the card's middle, as the turn's perspective does.
 */

export const LAMP_VS = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const LAMP_FS = `#version 300 es
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
uniform mat3 uFrame;
uniform float uEye;
uniform vec4 uWindow;
uniform float uWindowR;
uniform float uPhoto;
out vec4 outColor;

${LIGHT_GLSL}

void main() {
  vec2 p = (vUV - 0.5) * uSize;
  float d = sdRound(p, uSize * 0.5, uRadius);
  float aa = max(fwidth(d), 1e-3);
  float cover = clamp(0.5 - d / aa, 0.0, 1.0);
  bool back = uSide == 1;

  // the face's window: a picture in it is smooth and glossy, and none of the stock shows under it
  vec2 mid = uWindow.xy + uWindow.zw * 0.5 - uSize * 0.5;
  float dw = sdRound(p - mid, uWindow.zw * 0.5, uWindowR);
  float photo = back ? 0.0 : clamp(0.5 - dw / aa, 0.0, 1.0) * uPhoto;

  // what tips the surface: the linen and the paper's tooth, and on the back the pressed mark (its prints are read
  // every fragment, their derivatives out of any branch)
  vec2 tooth = paperTooth(p);
  vec3 bc = texture(uBackC, vUV).rgb;
  vec3 bm = texture(uBackM, vUV).rgb;
  float hx = texture(uBackH, vUV + vec2(uHs.x, 0.0)).r - texture(uBackH, vUV - vec2(uHs.x, 0.0)).r;
  float hy = texture(uBackH, vUV + vec2(0.0, uHs.y)).r - texture(uBackH, vUV - vec2(0.0, uHs.y)).r;
  float gloss = back ? bm.g : 0.0;
  float lit = back ? bm.b : 0.0;
  vec2 relief = back ? -vec2(hx, hy) * 0.55 : vec2(0.0);
  vec2 g = (linen(p) + tooth * 0.6) * (1.0 - photo) + relief;

  // at rest, as the press printed it: flat and head on
  vec3 restN = normalize(vec3(-g.x, -g.y, 1.0));
  float restDiff = lampDiffuse(restN);
  vec3 restSpec = lampSpecular(restN, vec3(0.0, 0.0, 1.0), gloss, 0.0);

  // now, turned: the side's own frame, seen from the turn's eye
  vec3 T = uFrame[0];
  vec3 B = uFrame[1];
  vec3 flatN = uFrame[2];
  vec3 V = normalize(vec3(0.0, 0.0, uEye) - (T * p.x + B * p.y));
  vec3 N = normalize(flatN - T * g.x - B * g.y);
  // the card's brightness carries the flat light; a side seen from behind draws nothing
  float flatDiff = lampDiffuse(flatN);
  float facing = step(0.0, dot(flatN, V));
  float nowDiff = lampDiffuse(N);
  vec3 nowSpec = lampSpecular(N, V, gloss, photo);

  // the shade and the lift: the light now, over the light the print holds (the side at rest) and the brightness
  // carries (the side flat). Head on and flat the two are the light now, so nothing is drawn; a picture is smooth, so
  // on it they always are
  float ratio = nowDiff / (flatDiff * restDiff);
  float shade = clamp(1.0 - ratio, 0.0, 1.0);
  vec3 lift = uPaperC * uLamp * restDiff * max(ratio - 1.0, 0.0) * (1.0 - photo);

  // the light that comes back, less what the print already holds of it; the cut edge takes its share, as printed
  float edge = 1.0 - smoothstep(0.0, uEdgeW, -d);
  float edgeK = mix(1.0, uEdgeShade, edge * 0.85);
  vec3 spec = max(edgeK * (nowSpec / flatDiff - restSpec * (1.0 - photo) * min(ratio, 1.0)), 0.0);

  // the back's three lights hold their colour in shadow: what the shade and the brightness took from them, given back
  vec3 glow = bc * lit * (0.34 + 0.5 * uNight) * max(1.0 / flatDiff - min(ratio, 1.0), 0.0);

  float k = cover * facing;
  outColor = vec4((spec + lift + glow) * k, shade * k);
}`;
