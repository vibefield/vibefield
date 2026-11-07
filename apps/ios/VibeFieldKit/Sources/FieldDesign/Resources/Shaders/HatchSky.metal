// IOS-12f's f5 (PC-D8 A; DESIGN.md §2.10, amended 2026-11-07) — NEW SPARK'S SKY IN METAL: the desktop's vendored star
// engine's programs (`packages/design-kit/src/spark-face/vendor/star-spark.js` :71–520, James's Star Spark, vendored
// byte for byte; sha256 e4c142f2b52e8b52f4cda371232bda9aaa211c7c9535e07f18a63a19b0d9ead6) transcribed from GLSL ES 3.0
// to MSL: the night ground, the trail, the body's burst, the particles, the bloom's two passes and the composite.
//
// It reads each star's 32 vec4 rows (StarSpark.rows, the engine's `_write`) from a 32×N RGBA32F texture, one row of
// texels per star, and HatchSkyRenderer draws a frame as `SparkEngine.render(t)` draws one (:634). Held to the
// engine's own pixels by the hatch's frames golden (`spark-hatch-frames/*.png`, SparkHatchFramesTests), within 12e's
// bound, which VF-PM rules for good on the first report.
//
// The transcription is the GLSL text, changed only where the languages differ, so a diff against the engine reads
// line for line, as SparkStar.metal's does:
// - the GLSL uniforms are each entry's buffers (`Sky` for the star programs, `Pass` for the full-screen ones), and the
//   HEAD's functions take what they read of them as arguments: MSL has no mutable globals;
// - `vecN` is `floatN`, `atan(y, x)` `atan2`, `texelFetch` a texture `read`, `texture` a `sample` with the engine's
//   LINEAR and CLAMP_TO_EDGE, and `gl_InstanceID` and `gl_VertexID` the entry's `instance_id` and `vertex_id`;
// - `min`, `max`, `clamp`, `mix`, `smoothstep` and `step` take GLSL's vector-and-scalar forms through the g-prefixed
//   helpers below, which broadcast and call Metal's own builtin (what ANGLE, the WebGL2 that drew the frames, emits on
//   the same Apple GPU). `pow` is Metal's: the shock ring raises a negative base to the second power, and the frames
//   show ANGLE's answer is finite there (no hole inside any ring);
// - `uPal` and `uConf` are `float4` (a float3 array's stride in a buffer is 16 bytes, said rather than implied);
// - `gl_FragCoord`'s origin is the bottom left and Metal's position the top left. Where a program reads the pixel's
//   place for its own sake (the ground's gradient and star grid, the grain, the dither), it reads `glFrag`, the GL
//   coordinate (x, height − y). The bloom's samples and the composite's are symmetric about the pixel and read their
//   source in Metal's own orientation, which is the same texel.
//
// Only what the hatch draws is transcribed (VF-PM's Q3 ruling, 2026-11-07 13:58:40Z). The hatch's sky is the night,
// and its star draws its burst alone (`mask: LAYERS.BURST`, :231). So these are not here, and nothing the hatch draws
// reads them:
// - the ground's day branch (`uNight < .5`). The other programs keep their few night-or-day choices as written;
// - the body's signed distance (the core spring, the spikes, `smin`, `sdUC`, the warp), its fill, rim, halo, aura,
//   echo, orbs and glint, and its debug and outline views. Each sits behind a layer bit the hatch never sets; under
//   BURST alone the body draws the shadow pocket, the shock ring, the rays and needles, and the flash;
// - `spring` and `ramp5`, which only those read.
// A newer engine is a design event (§2.10): both goldens move, and this file follows them.

#pragma clang diagnostic ignored "-Wunused-variable"
#pragma clang diagnostic ignored "-Wunknown-pragmas"
// WebGL's highp is IEEE single precision, and Metal's default is fast math. Safe math keeps the hash noise (h11, h12)
// and the exponentials the engine's (MSL 3.2, iOS 18), as SparkStar.metal keeps them.
#pragma METAL fp math_mode(safe)

#include <metal_stdlib>
using namespace metal;

namespace hatch_sky {

constant float PI = 3.14159265359, TAU = 6.28318530718;

// GLSL's forms, on Metal's builtins
#define HATCH_SAME_FORMS(T) \
  inline T gmin(T a, T b) { return metal::min(a, b); } \
  inline T gmax(T a, T b) { return metal::max(a, b); } \
  inline T gclamp(T x, T lo, T hi) { return metal::clamp(x, lo, hi); } \
  inline T gmix(T x, T y, T a) { return metal::mix(x, y, a); } \
  inline T gsmooth(T e0, T e1, T x) { return metal::smoothstep(e0, e1, x); } \
  inline T gstep(T edge, T x) { return metal::step(edge, x); }
HATCH_SAME_FORMS(float)
HATCH_SAME_FORMS(float2)
HATCH_SAME_FORMS(float3)
HATCH_SAME_FORMS(float4)
#define HATCH_SCALAR_FORMS(T) \
  inline T gmin(T a, float b) { return metal::min(a, T(b)); } \
  inline T gmax(T a, float b) { return metal::max(a, T(b)); } \
  inline T gclamp(T x, float lo, float hi) { return metal::clamp(x, T(lo), T(hi)); } \
  inline T gmix(T x, T y, float a) { return metal::mix(x, y, T(a)); } \
  inline T gsmooth(float e0, float e1, T x) { return metal::smoothstep(T(e0), T(e1), x); } \
  inline T gstep(float edge, T x) { return metal::step(T(edge), x); }
HATCH_SCALAR_FORMS(float2)
HATCH_SCALAR_FORMS(float3)
HATCH_SCALAR_FORMS(float4)

/// The star programs' uniforms: `a` = (uRes.x, uRes.y, uTime, uDpr), `b` = (uNight, uP, uResPx.x, uResPx.y).
struct Sky {
  float4 a;
  float4 b;
};

/// The full-screen passes' uniforms: `a` = (uTexel.x, uTexel.y, uThresh or uOff, uBloomStr), `b` = (uNight, uTime,
/// uGrain, the target's height in pixels, for `glFrag`).
struct Pass {
  float4 a;
  float4 b;
};

// ---- HEAD (:72–93)
inline float4 D(texture2d<float, access::read> uData, int k, int id) { return uData.read(uint2(uint(k), uint(id))); }
inline float h11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
inline float h12(float2 p) { float3 p3 = fract(float3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
inline float vnoise(float2 p) { float2 i = floor(p), f = fract(p); float2 u = f * f * (3. - 2. * f);
  return gmix(gmix(h12(i), h12(i + float2(1, 0)), u.x), gmix(h12(i + float2(0, 1)), h12(i + float2(1, 1)), u.x), u.y); }
inline float fbm(float2 p) { float s = 0., a = .5; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.07 + float2(17.3, 9.1); a *= .5; } return s / .875; }
inline float easeOut(float x, float p) { return 1. - pow(1. - gclamp(x, 0., 1.), p); }
inline float fallEase(float u) { u = gclamp(u, 0., 1.); return u * (.62 + .38 * u); }
inline float4 over(float4 a, float4 b) { return a + b * (1. - a.a); }
inline float3 hueRot(float3 c, float a) {
  float3 yiq = float3x3(float3(.299, .596, .211), float3(.587, -.274, -.523), float3(.114, -.322, .312)) * c;
  float cs = cos(a), sn = sin(a); yiq.yz = float2x2(float2(cs, sn), float2(-sn, cs)) * yiq.yz;
  return float3x3(float3(1., 1., 1.), float3(.956, -.272, -1.106), float3(.621, -.647, 1.703)) * yiq; }
inline float4 toClip(float2 pos, float2 uRes) { float2 c = pos / uRes * 2. - 1.; return float4(c.x, -c.y, 0., 1.); }
inline float3 PAL(constant float4 *uPal, int k) { return uPal[k].xyz; }
/// The pixel's place as GL's `gl_FragCoord` gives it: origin the bottom left.
inline float2 glFrag(float4 position, float height) { return float2(position.x, height - position.y); }

/// The quad's corner for a strip vertex, as the engine's VSs compute it.
inline float2 corner(uint vertexID) { return float2(float(vertexID & 1), float((vertexID >> 1) & 1)); }

struct FullOut {
  float4 position [[position]];
};

struct TrailOut {
  float4 position [[position]];
  float2 vQ;
  int vId [[flat]];
};

struct BodyOut {
  float4 position [[position]];
  float2 vP;
  float vPx;
  int vId [[flat]];
};

struct PartOut {
  float4 position [[position]];
  float2 vL;
  float4 vCol;
  float3 vShape;
  int vType [[flat]];
  float vHue [[flat]];
};

}  // namespace hatch_sky

using namespace hatch_sky;

// ---------------------------------------------------------------- full-screen passes (FULL_VS, :442)

vertex FullOut hatch_sky_full_vertex(uint vertexID [[vertex_id]]) {
  float2 p = float2(float((vertexID << 1) & 2), float(vertexID & 2));
  FullOut out;
  out.position = float4(p * 2. - 1., 0., 1.);
  return out;
}

/// BG_FS (:445), its night branch: the gradient, the drifting nebula and two layers of twinkling stars.
fragment float4 hatch_sky_ground_fragment(FullOut in [[stage_in]], constant Sky &sky [[buffer(0)]]) {
  float uTime = sky.a.z, uDpr = sky.a.w;
  float2 uResPx = sky.b.zw;
  float2 fc = glFrag(in.position, uResPx.y);
  float2 uv = fc / uResPx, px = fc / uDpr;
  float3 col;
  float3 top = float3(.010, .026, .080), mid = float3(.020, .068, .150), bot = float3(.034, .160, .215);
  col = gmix(bot, mid, gsmooth(0., .55, uv.y));
  col = gmix(col, top, gsmooth(.45, 1., uv.y));
  float nb = fbm(uv * float2(2.2, 1.4) + float2(3.1, uTime * .004));
  col += float3(.06, .025, .1) * gsmooth(.45, .85, nb) * .9;
  for (int l = 0; l < 2; l++) {
    float cs = l == 0 ? 54. : 23.;
    float2 g = px / cs, gi = floor(g), gf = fract(g);
    float hh = h12(gi + float(l) * 17.);
    if (hh > (l == 0 ? .55 : .8)) {
      float2 sp = float2(h12(gi + 3.1), h12(gi + 7.7)) * .8 + .1;
      float dd = length((gf - sp) * cs);
      float tw = .65 + .35 * sin(uTime * (1. + hh * 3.) + hh * 40.);
      float sz = l == 0 ? .9 + hh * .7 : .6;
      col += float3(.75, .85, 1.) * (l == 0 ? .8 : .35) * tw * (gsmooth(sz, 0., dd) + exp(-dd / (sz * 1.6)) * .25);
    }
  }
  return float4(col, 1.);
}

/// DOWN_FS (:477): a 2×2 box down, kept above `uThresh` when it has one.
fragment float4 hatch_sky_down_fragment(
  FullOut in [[stage_in]], texture2d<float> uSrc [[texture(0)]], sampler smp [[sampler(0)]],
  constant Pass &pass [[buffer(0)]]
) {
  float2 uTexel = pass.a.xy;
  float uThresh = pass.a.z;
  float2 uv = in.position.xy * uTexel * 2.;
  float2 o = uTexel;
  float3 c = (uSrc.sample(smp, uv + float2(-o.x, -o.y)).rgb + uSrc.sample(smp, uv + float2(o.x, -o.y)).rgb +
              uSrc.sample(smp, uv + float2(-o.x, o.y)).rgb + uSrc.sample(smp, uv + float2(o.x, o.y)).rgb) * .25;
  if (uThresh > 0.) { float l = gmax(c.r, gmax(c.g, c.b)); c *= gsmooth(uThresh, uThresh + .5, l); }
  return float4(c, 1.);
}

/// BLUR_FS (:490): four taps `uOff + .5` texels out on the diagonals.
fragment float4 hatch_sky_blur_fragment(
  FullOut in [[stage_in]], texture2d<float> uSrc [[texture(0)]], sampler smp [[sampler(0)]],
  constant Pass &pass [[buffer(0)]]
) {
  float2 uTexel = pass.a.xy;
  float uOff = pass.a.z;
  float2 uv = in.position.xy * uTexel; float2 o = uTexel * (uOff + .5);
  return float4((uSrc.sample(smp, uv + float2(-o.x, -o.y)).rgb + uSrc.sample(smp, uv + float2(o.x, -o.y)).rgb +
                 uSrc.sample(smp, uv + float2(-o.x, o.y)).rgb + uSrc.sample(smp, uv + float2(o.x, o.y)).rgb) * .25, 1.);
}

/// COMP_FS (:500): the scene, the bloom over it with a tanh shoulder at .72, the grain and the dither.
fragment float4 hatch_sky_comp_fragment(
  FullOut in [[stage_in]], texture2d<float> uScene [[texture(0)]], texture2d<float> uBloom [[texture(1)]],
  sampler smp [[sampler(0)]], constant Pass &pass [[buffer(0)]]
) {
  float2 uTexel = pass.a.xy;
  float uBloomStr = pass.a.w, uNight = pass.b.x, uTime = pass.b.y, uGrain = pass.b.z;
  float2 fc = glFrag(in.position, pass.b.w);
  float2 uv = in.position.xy * uTexel;
  float3 c = uScene.sample(smp, uv).rgb;
  if (uNight > .5) {
    c += uBloom.sample(smp, uv).rgb * uBloomStr;
    float k = .72; float3 x = gmax(c - k, 0.);
    c = gmin(c, float3(k)) + (1. - k) * tanh(x / (1. - k));
  }
  float fr = floor(uTime * 24.);
  float g = h12(fc + fr * float2(37.1, 91.7)) - .5;
  c += g * uGrain * (uNight > .5 ? 1. : .7);
  c += (h12(fc.yx * 1.3 + fr) - .5) / 255.;
  return float4(gclamp(c, 0., 1.), 1.);
}

// ---------------------------------------------------------------- the trail (TRAIL_VS :304, TRAIL_FS :317)

vertex TrailOut hatch_sky_trail_vertex(
  uint vertexID [[vertex_id]], uint instanceID [[instance_id]], texture2d<float, access::read> uData [[texture(0)]],
  constant Sky &sky [[buffer(0)]]
) {
  float2 uRes = sky.a.xy;
  float uTime = sky.a.z;
  int id = int(instanceID);
  TrailOut out;
  out.vId = id;
  float4 d0 = D(uData, 0, id), d1 = D(uData, 1, id), d2 = D(uData, 2, id);
  bool live = d1.w > .5 && d1.y > d1.x && uTime > d1.x - .02 && uTime < d1.y + .8;
  float2 S = d2.xy; float R = d0.z;
  float2 dv = d0.xy - S; float Lt = length(dv); float2 dir = dv / gmax(Lt, 1e-3), nr = float2(-dir.y, dir.x);
  float2 c = corner(vertexID);
  out.vQ = float2(gmix(-R * 1.3, Lt + R * 1.3, c.x), (c.y * 2. - 1.) * R * 1.35);
  out.position = live ? toClip(S + dir * out.vQ.x + nr * out.vQ.y, uRes) : float4(2., 2., 2., 1.);
  return out;
}

fragment float4 hatch_sky_trail_fragment(
  TrailOut in [[stage_in]], texture2d<float, access::read> uData [[texture(0)]], constant Sky &sky [[buffer(0)]],
  constant float4 *uPal [[buffer(1)]], constant float4 *uConf [[buffer(2)]]
) {
  float uTime = sky.a.z, uNight = sky.b.x;
  float2 vQ = in.vQ;
  int id = in.vId;
  float4 d0 = D(uData, 0, id), d1 = D(uData, 1, id), d2 = D(uData, 2, id);
  float R = d0.z, seed = d0.w;
  int pb = int(d2.z + .5) * 10;
  float3 TRAIL = PAL(uPal, pb + 8), HALO = PAL(uPal, pb + 6), RIM = PAL(uPal, pb + 5);
  float Lt = length(d0.xy - d2.xy), T = d1.y - d1.x;
  float u = gclamp((uTime - d1.x) / T, 0., 1.);
  float sHead = Lt * fallEase(u), Lmax = gmin(R * 10., Lt * .8);
  float sTail = gmax(sHead - Lmax, 0.), post = uTime - d1.y, fade = 1.;
  if (post > 0.) { sTail = gmix(gmax(Lt - Lmax, 0.), Lt, easeOut(post / .42, 2.5)); fade = 1. - gsmooth(.05, .45, post); }
  float along = vQ.x, ac = abs(vQ.y);
  float v = (sHead - along) / gmax(sHead - sTail, 1.), vc = gclamp(v, 0., 1.);
  float w = R * gmix(.07, .8, pow(vc, .7));
  float ends = gsmooth(-.015, .03, v) * gsmooth(1., .7, v);
  float gn = vnoise(float2(along / (R * 2.2) + seed * 9., ac / (R * .07)));
  float gn2 = vnoise(float2(along / (R * .5), ac / (R * .03)) + 31.);
  float beam = exp(-pow(ac / w, 2.) * 2.) * pow(1. - vc, .95) * ends * (.55 + .55 * gn) * (.8 + .4 * gn2);
  float atmo = exp(-ac / (w * 1.6 + R * .1)) * pow(1. - vc, 1.4) * ends * .22;
  float core = exp(-pow(ac / (R * (.03 + .05 * vc)), 2.)) * exp(-vc * 4.) * ends;
  float3 tc = uNight > .5 ? TRAIL : gmix(TRAIL, RIM, .35);
  float3 bcol = gmix(gmix(float3(1.), HALO, .5), tc, gsmooth(0., .3, vc));
  float4 acc = float4(tc, 1.) * gclamp(atmo, 0., 1.);
  acc = over(float4(bcol, 1.) * gclamp(beam * (uNight > .5 ? .95 : .8), 0., 1.), acc);
  acc = over(float4(1.) * gclamp(core * .95, 0., 1.), acc);
  if (post < .02) {
    float2 dh = (vQ - float2(sHead, 0.)) / R; float hd = length(dh);
    if (hd < 1.2) {
      float hi = gsmooth(0., .06, u);
      float glow = exp(-hd / .16) * .9 + gsmooth(.085, .05, hd);
      float ca = uTime * 3. + seed;
      float2 rd = float2x2(float2(cos(ca), sin(ca)), float2(-sin(ca), cos(ca))) * dh;
      float fl = exp(-abs(rd.x) / .018) * exp(-abs(rd.y) / .42) + exp(-abs(rd.y) / .018) * exp(-abs(rd.x) / .42);
      float4 mr = float4(0.);
      for (int j = 0; j < 6; j++) {
        float fj = float(j), a = fj / 6. * TAU + uTime * 1.3 + seed * 3.;
        float2 dir = float2(cos(a), sin(a));
        float al = dot(dh, dir), acr = abs(dot(dh, float2(-dir.y, dir.x)));
        float s = (al - .1) / .32;
        float wv = .03 * pow(gclamp(4. * s * (1. - s), 0., 1.), .6);
        float cov = gsmooth(.012, -.004, acr - wv) * gstep(0., s) * gstep(s, 1.);
        mr = over(float4(uConf[j].xyz, 1.) * cov * (.6 + .4 * sin(uTime * 23. + fj * 2.1)), mr);
      }
      acc = over(float4(1.) * gclamp(glow + fl * .7, 0., 1.) * hi, over(mr * hi, acc));
    }
  }
  acc *= fade;
  acc.rgb = hueRot(acc.rgb, d2.w);
  return float4(acc.rgb, uNight > .5 ? 0. : acc.a);
}

// ---------------------------------------------------------------- the body (BODY_VS :99, BODY_FS :110), its burst

vertex BodyOut hatch_sky_body_vertex(
  uint vertexID [[vertex_id]], uint instanceID [[instance_id]], texture2d<float, access::read> uData [[texture(0)]],
  constant Sky &sky [[buffer(0)]]
) {
  float2 uRes = sky.a.xy;
  float uTime = sky.a.z, uDpr = sky.a.w;
  int id = int(instanceID);
  BodyOut out;
  out.vId = id;
  float4 d0 = D(uData, 0, id), d1 = D(uData, 1, id);
  float2 c = corner(vertexID) * 2. - 1.;
  bool live = d1.w > .5 && uTime >= d1.y && (d1.z <= 0. || uTime < d1.z + 1.);
  out.vP = c * 4.3; out.vPx = 1. / (d0.z * uDpr);
  out.position = live ? toClip(d0.xy + out.vP * d0.z, uRes) : float4(2., 2., 2., 1.);
  return out;
}

fragment float4 hatch_sky_body_fragment(
  BodyOut in [[stage_in]], texture2d<float, access::read> uData [[texture(0)]], constant Sky &sky [[buffer(0)]],
  constant float4 *uPal [[buffer(1)]], constant float4 *uConf [[buffer(2)]]
) {
  float uTime = sky.a.z, uNight = sky.b.x;
  float2 vP = in.vP;
  int id = in.vId;
  float4 d0 = D(uData, 0, id), d1 = D(uData, 1, id), d2 = D(uData, 2, id), d3 = D(uData, 3, id), d7 = D(uData, 7, id);
  float seed = d0.w, tau = uTime - d1.y;
  int pb = int(d2.z + .5) * 10, mask = int(d7.x + .5);
  float aa = in.vPx * 1.25;
  float3 P1 = PAL(uPal, pb + 1);
  float3 RIM = PAL(uPal, pb + 5), HALO = PAL(uPal, pb + 6), AURA = PAL(uPal, pb + 7), TRAIL = PAL(uPal, pb + 8);
  float dk = d1.z > 0. ? gclamp((uTime - d1.z) / .9, 0., 1.) : 0.;
  float r = length(vP);
  int n = int(d3.x + .5);
  float4 acc = float4(0.);
  float shadow = 0.;

  // ---- impact: shadow pocket, shock ring, burst rays, needles
  if ((mask & 256) != 0 && tau < 1.3) {
    shadow = gsmooth(3.4, .5, r) * .5 * gsmooth(0., .06, tau) * (1. - gsmooth(.2, 1.1, tau));
    float su = gclamp(tau / .55, 0., 1.);
    float rr = .3 + 2.6 * easeOut(su, 3.), rw = .16 * (1. - su) + .04;
    float rn = vnoise(normalize(vP + 1e-4) * 2.5 + seed) - .5;
    float ring = exp(-pow((r - rr + rn * .12) / rw, 2.)) * pow(1. - su, 2.) * .17;
    acc = over(float4(gmix(float3(1.), HALO, su), 1.) * ring, acc);
    float4 rays = float4(0.);
    int bm = int(d7.y + .5);
    for (int j = 0; j < 26; j++) {
      float fj = float(j); bool needle = j >= 18;
      float hA = h11(seed * 13.7 + fj * 1.37), hB = h11(seed * 7.13 + fj * 3.11), hC = h11(seed * 3.37 + fj * 5.71), hD = h11(seed * 9.91 + fj * 7.3), hE = h11(seed * 1.93 + fj * 2.9);
      bool lead = j < n;
      float ang = needle ? (fj - 18. + hA) / 8. * TAU + seed * 5. : lead ? D(uData, 8 + j * 2, id).x + (hA - .5) * .12 : (fj + hA * .85) / 18. * TAU + seed * 2.;
      float del = needle ? hB * .03 : .015 + hB * .07;
      float dur = needle ? .26 + hC * .16 : .48 + hC * .38;
      float u = (tau - del) / dur;
      if (u <= 0. || u >= 1.) continue;
      float len = needle ? .9 + hD * .9 : lead ? 1.7 + hD * 1.1 : 1.1 + hD * 1.5;
      float r0 = needle ? .1 : lead ? .15 + hE * .15 : .2 + hE * .42;
      float head = r0 + len * easeOut(u, 4.), tail = r0 + len * pow(u, 1.6) * .93;
      float2 dir = float2(cos(ang), sin(ang));
      float al = dot(vP, dir), ac = abs(dot(vP, float2(-dir.y, dir.x)));
      float s = (al - tail) / gmax(head - tail, 1e-3);
      float wmax = needle ? .014 : lead ? .085 + hA * .04 : .05 + hA * .05;
      float w = wmax * pow(gclamp(4. * s * (1. - s), 0., 1.), .55) * (1. - u * .55);
      float cov = gsmooth(aa + .01, -aa, ac - w) * gstep(0., s) * gstep(s, 1.);
      float dseg = length(float2(gmax(gmax(tail - al, al - head), 0.), ac));
      float glow = exp(-dseg / (needle ? .03 : .07)) * .35;
      float3 rc;
      if (needle) rc = float3(1.);
      else if (bm == 0 || (bm == 2 && hE > .45)) rc = uConf[int(hA * 7.99)].xyz;
      else { int k = int(hB * 4.99); rc = k == 0 ? RIM : k == 1 ? P1 : k == 2 ? HALO : k == 3 ? AURA : TRAIL; }
      rc = gmix(float3(1.), rc, gsmooth(.02, .16, u));
      float fade = pow(1. - u, 1.5);
      rays = over(float4(rc, 1.) * gclamp(cov + glow, 0., 1.) * fade, rays);
    }
    acc = over(rays, acc);
  }
  // ---- impact flash
  if ((mask & 256) != 0 && tau < .6) {
    float fr = .52 * easeOut(tau / .05, 2.);
    float disc = gsmooth(fr + .05, fr - .05, r) * exp(-tau / .14);
    float fg = exp(-r / (.45 + tau * 3.5)) * exp(-tau / .09) * .9;
    acc = over(float4(1.) * gclamp(disc + fg, 0., 1.), acc);
  }
  acc *= 1. - dk;
  acc.rgb = hueRot(acc.rgb, d2.w);
  return float4(acc.rgb, uNight > .5 ? shadow * (1. - dk) : acc.a);
}

// ---------------------------------------------------------------- the particles (PART_VS :371, PART_FS :427)

vertex PartOut hatch_sky_part_vertex(
  uint vertexID [[vertex_id]], uint instanceID [[instance_id]], texture2d<float, access::read> uData [[texture(0)]],
  constant Sky &sky [[buffer(0)]], constant float4 *uPal [[buffer(1)]], constant float4 *uConf [[buffer(2)]]
) {
  float2 uRes = sky.a.xy;
  float uTime = sky.a.z, uNight = sky.b.x;
  int uP = int(sky.b.y + .5);
  int sid = int(instanceID) / uP, j = int(instanceID) - sid * uP;
  float4 d0 = D(uData, 0, sid), d1 = D(uData, 1, sid), d2 = D(uData, 2, sid), d7 = D(uData, 7, sid);
  float R = d0.z, seed = d0.w, tau = uTime - d1.y, fj = float(j);
  float h1 = h11(seed * 3.1 + fj * 1.71), h2 = h11(seed * 5.7 + fj * 2.33), h3 = h11(seed * 1.3 + fj * 3.97),
        h4 = h11(seed * 8.9 + fj * 5.03), h5 = h11(seed * 2.2 + fj * 6.11), h6 = h11(seed * 6.6 + fj * 7.77);
  float2 Dst = d0.xy, S = d2.xy, tdir = normalize(Dst - S + 1e-4);
  int pb = int(d2.z + .5) * 10;
  int mask = int(d7.x + .5);
  bool ok = d1.w > .5 && (d1.z <= 0. || uTime < d1.z + .3) && (mask & 256) != 0;
  float2 pos = Dst, vdir = float2(1., 0.); float hl = 0., hw = 1., alpha = 0.; float3 col = float3(1.); int type = 0;
  float sc = gmax(R / 42., .6);
  if (j < 22) {
    float a0 = h1 < .4 ? atan2(-tdir.y, -tdir.x) + (h2 - .5) * 1.7 : h2 * TAU;
    float v0 = R * (3.5 + h3 * 7.), kd = 3.4, t = gmax(tau - h6 * .04, 0.);
    float dist = v0 / kd * (1. - exp(-kd * t)), spd = v0 * exp(-kd * t);
    float a = a0 + (h4 - .5) * 2.4 * (1. - exp(-2.5 * t));
    vdir = float2(cos(a), sin(a));
    pos = Dst + vdir * (R * (.25 + h5 * .2) + dist) + float2(0., R * .35 * t * t);
    float lifeT = .5 + h5 * .65;
    alpha = 1. - gsmooth(lifeT * .4, lifeT, t);
    hl = gclamp(spd * .045, 1., R * .38) * .5; hw = gmix(.35, .95, h1) * sc;
    col = uNight > .5 ? (h2 < .7 ? float3(1.) : gmix(float3(1.), uConf[int(h3 * 7.99)].xyz, .6)) : gmix(PAL(uPal, pb + 8), PAL(uPal, pb + 5), h2);
    ok = ok && tau > h6 * .04 && t < lifeT;
  } else if (j < 30) {
    type = 1;
    float tb = .18 + h1 * .7, lifeT = 1.1 + h2 * 1.5, t = tau - tb, a = h3 * TAU;
    pos = Dst + float2(cos(a), sin(a)) * R * (1.15 + h4 * 1.7) + float2(0., -R * .18 * gmax(t, 0.));
    float env = sin(PI * gclamp(t / lifeT, 0., 1.));
    alpha = env * env * (.55 + .45 * sin(t * 17. + h5 * 6.));
    hw = gmix(.8, 1.6, h5) * sc;
    col = uNight > .5 ? gmix(float3(1.), uConf[int(h6 * 7.99)].xyz, .25) : PAL(uPal, pb + 5);
    ok = ok && t > 0. && t < lifeT;
  } else {
    type = 2;
    float T = d1.y - d1.x, tb = d1.x + T * (.1 + .9 * h1), age = uTime - tb, lifeT = .35 + h2 * .65;
    float2 hp = S + tdir * length(Dst - S) * fallEase((tb - d1.x) / gmax(T, 1e-3));
    float2 nr = float2(-tdir.y, tdir.x);
    pos = hp + nr * (h3 - .5) * R * .5 + nr * sign(h3 - .5) * R * (.3 + h4 * .9) * age - tdir * R * .6 * age;
    vdir = tdir;
    alpha = (1. - age / lifeT) * (.6 + .4 * sin(age * 30. + h5 * 6.));
    hl = R * .03; hw = gmix(.5, 1.2, h4) * sc;
    col = gmix(float3(1.), PAL(uPal, pb + 8), uNight > .5 ? h5 * .7 : 1.);
    ok = ok && T > 0. && age > 0. && age < lifeT;
  }
  float g = type == 1 ? hw * 9. : hw * 3. + 1.;
  float2 c = corner(vertexID) * 2. - 1.;
  PartOut out;
  out.vL = float2(c.x * (hl + g), c.y * (hw + g));
  out.vShape = float3(hl, hw, g); out.vCol = float4(col, 1.) * gclamp(alpha, 0., 1.); out.vType = type; out.vHue = d2.w;
  float2 nr = float2(-vdir.y, vdir.x);
  out.position = ok && alpha > 0. ? toClip(pos + vdir * out.vL.x + nr * out.vL.y, uRes) : float4(2., 2., 2., 1.);
  return out;
}

fragment float4 hatch_sky_part_fragment(PartOut in [[stage_in]], constant Sky &sky [[buffer(0)]]) {
  float uNight = sky.b.x;
  float2 vL = in.vL;
  float3 vShape = in.vShape;
  float d = length(float2(gmax(abs(vL.x) - vShape.x, 0.), vL.y)) - vShape.y;
  float a = gsmooth(.8, -.8, d) + exp(-gmax(d, 0.) / (vShape.y * 1.5 + .8)) * .45;
  if (in.vType == 1) {
    float w = vShape.y * .5, l = vShape.z * .45;
    a = gmax(a, exp(-abs(vL.x) / w) * exp(-abs(vL.y) / l) + exp(-abs(vL.y) / w) * exp(-abs(vL.x) / l));
  }
  float4 c = in.vCol * gclamp(a, 0., 1.);
  c.rgb = hueRot(c.rgb, in.vHue);
  return float4(c.rgb, uNight > .5 ? 0. : c.a);
}
