// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — THE STAR IN METAL: the desktop's vendored spark engine's
// vertex and fragment shaders (`packages/design-kit/src/spark-face/vendor/sparks.js` :187–840, James's Agent Sparks,
// vendored byte for byte; sha256 baa846eecc702dc4f7bcf3d1f7da20d1eb01051c87ce20685a29de1de6e67716) transcribed from GLSL ES 3.0 to MSL.
//
// It reads each face's 32 vec4 rows (SparkBuddy.write) from a 32×N RGBA32F texture, one row of texels per face, and
// draws every face with one instanced quad, as `Engine.render` draws them. Held to the engine's own pixels by the
// stills golden (`spark-stills/*.png`, SparkStarStillTests), within the bound VF-PM rules on the first report.
//
// The transcription is the GLSL text, changed only where the languages differ, so a diff against the engine reads
// line for line:
// - the GLSL program scope (its uniforms, `px`, `pb` and `D(i)`) is the struct `SparkShade`, one per fragment, and
//   every GLSL function is its member: MSL has no mutable globals;
// - `vecN` is `floatN`, `ivec2` `int2`, `atan(y, x)` `atan2`, `dFdx` `dfdx`, and an `out` parameter `thread &`;
// - GLSL's `mod` is its own definition (x − y·floor(x/y)), never C's `fmod`; `min`, `max`, `clamp`, `mix`,
//   `smoothstep` and `step` take GLSL's vector-and-scalar forms through the g-prefixed helpers below, which broadcast
//   and call Metal's own builtin (what ANGLE, the WebGL2 that drew the stills, emits on the same Apple GPU);
// - `uPal` and `uDeep` are `float4` (a float3 array's stride in a buffer is 16 bytes, said rather than implied);
// - the row-29 clip moves to the fragment entry, which alone may `discard_fragment()`;
// - `gl_FragCoord`'s origin is the bottom left and Metal's position the top left, so `uView.y − y/dpr` is `y/dpr`.
// A newer engine is a design event (§2.10): both goldens move, and this file follows them.

#pragma clang diagnostic ignored "-Wunused-variable"
#pragma clang diagnostic ignored "-Wunknown-pragmas"
// WebGL's highp is IEEE single precision, and Metal's default is fast math. Safe math keeps the hash noise (h11) and
// the glow's exponentials the engine's (MSL 3.2, iOS 18).
#pragma METAL fp math_mode(safe)

#include <metal_stdlib>
using namespace metal;

namespace spark_star {

constant float PI = 3.14159265, TAU = 6.2831853;

// GLSL's forms, on Metal's builtins
inline float gmod(float x, float y) { return x - y * floor(x / y); }
#define SPARK_SAME_FORMS(T) \
  inline T gmin(T a, T b) { return metal::min(a, b); } \
  inline T gmax(T a, T b) { return metal::max(a, b); } \
  inline T gclamp(T x, T lo, T hi) { return metal::clamp(x, lo, hi); } \
  inline T gmix(T x, T y, T a) { return metal::mix(x, y, a); } \
  inline T gsmooth(T e0, T e1, T x) { return metal::smoothstep(e0, e1, x); } \
  inline T gstep(T edge, T x) { return metal::step(edge, x); }
SPARK_SAME_FORMS(float)
SPARK_SAME_FORMS(float2)
SPARK_SAME_FORMS(float3)
SPARK_SAME_FORMS(float4)
#define SPARK_SCALAR_FORMS(T) \
  inline T gmin(T a, float b) { return metal::min(a, T(b)); } \
  inline T gmax(T a, float b) { return metal::max(a, T(b)); } \
  inline T gclamp(T x, float lo, float hi) { return metal::clamp(x, T(lo), T(hi)); } \
  inline T gmix(T x, T y, float a) { return metal::mix(x, y, T(a)); } \
  inline T gsmooth(float e0, float e1, T x) { return metal::smoothstep(T(e0), T(e1), x); } \
  inline T gstep(float edge, T x) { return metal::step(T(edge), x); }
SPARK_SCALAR_FORMS(float2)
SPARK_SCALAR_FORMS(float3)
SPARK_SCALAR_FORMS(float4)
inline int gmin(int a, int b) { return metal::min(a, b); }
inline int gmax(int a, int b) { return metal::max(a, b); }

/// The engine's uniforms: `a` = (uView.x, uView.y, uTime, uDpr), `b` = (uCut.rgb, uShadow).
struct Uniforms {
  float4 a;
  float4 b;
};

/// One fragment of one face: the GLSL program's scope. `rows` is the face's 32 texels (`D(i)` read them), fetched once
/// by the entry.
struct SparkShade {
  float4 rows[32];
  float2 vP;
  float2 uView;
  float uTime = 0, uDpr = 1, uShadow = 0;
  float3 uCut;
  constant float4 *uPal;
  constant float4 *uDeep;
  float px = 0;
  int pb = 0;

  float4 D(int i) { return rows[i]; }

  float h11(float n){ return fract(sin(n * 91.345 + 47.853) * 43758.5453); }
  float vn(float2 p){ float2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return gmix(gmix(h11(i.x + i.y * 57.), h11(i.x + 1. + i.y * 57.), f.x), gmix(h11(i.x + (i.y + 1.) * 57.), h11(i.x + 1. + (i.y + 1.) * 57.), f.x), f.y); }
  float fbm(float2 p){ return .55 * vn(p) + .3 * vn(p * 2.03 + 3.7) + .15 * vn(p * 4.1 + 9.2); }
  float2 rot(float2 p, float a){ float c = cos(a), s = sin(a); return float2(c * p.x - s * p.y, s * p.x + c * p.y); }
  float smin(float a, float b, float k){ float h = gmax(k - abs(a - b), 0.) / k; return gmin(a, b) - h * h * k * .25; }
  float cov(float d){ return gclamp(.5 - d / px, 0., 1.); }
  float4 over(float4 a, float4 b){ return a + b * (1. - a.a); }
  float3 PAL(int k){ return uPal[pb + k].xyz; }
  float dot2(float2 v){ return dot(v, v); }
  float sdUC(float2 p, float r1, float r2, float h){
    p.x = abs(p.x); float b = (r1 - r2) / h, a = sqrt(gmax(1. - b * b, 0.)), k = dot(p, float2(-b, a));
    if (k < 0.) return length(p) - r1;
    if (k > a * h) return length(p - float2(0., h)) - r2;
    return dot(p, float2(a, b)) - r1; }
  float sdSeg(float2 p, float2 a, float2 b){ float2 pa = p - a, ba = b - a; return length(pa - ba * gclamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
  float sdRBox(float2 p, float2 b, float r){ float2 q = abs(p) - b + r; return length(gmax(q, 0.)) + gmin(gmax(q.x, q.y), 0.) - r; }
  float sdEll(float2 p, float2 ab){ return (length(p / ab) - 1.) * gmin(ab.x, ab.y); }
  float sdStar(float2 p, float r, float n, float m){
    float an = PI / n, en = PI / m; float2 acs = float2(cos(an), sin(an)), ecs = float2(cos(en), sin(en));
    float bn = gmod(atan2(p.x, p.y), 2. * an) - an; p = length(p) * float2(cos(bn), abs(sin(bn)));
    p -= r * acs; p += ecs * gclamp(-dot(p, ecs), 0., r * acs.y / ecs.y); return length(p) * sign(p.x); }
  float sdHeart(float2 p){ p.x = abs(p.x);
    if (p.y + p.x > 1.) return sqrt(dot2(p - float2(.25, .75))) - sqrt(2.) / 4.;
    return sqrt(gmin(dot2(p - float2(0., 1.)), dot2(p - .5 * gmax(p.x + p.y, 0.)))) * sign(p.x - p.y); }
  float sdArc(float2 p, float ap, float ra, float rb){ float2 sc = float2(sin(ap), cos(ap)); p.x = abs(p.x);
    return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb; }
  float sdDrop(float2 p, float r){ return sdUC(p, r, r * .1, r * 1.65); }
  float sdSquircle(float2 p, float r){ float2 q = abs(p) / r; return (pow(pow(q.x, 4.) + pow(q.y, 4.), .25) - 1.) * r * .92; }
  float lum(float3 c){ return dot(c, float3(.3, .59, .11)); }
  float sdTri(float2 p, float2 p0, float2 p1, float2 p2){
    float2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2, v0 = p - p0, v1 = p - p1, v2 = p - p2;
    float2 pq0 = v0 - e0 * gclamp(dot(v0, e0) / dot(e0, e0), 0., 1.), pq1 = v1 - e1 * gclamp(dot(v1, e1) / dot(e1, e1), 0., 1.), pq2 = v2 - e2 * gclamp(dot(v2, e2) / dot(e2, e2), 0., 1.);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    float2 d = gmin(gmin(float2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), float2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), float2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
  }
  float sdTC(float2 p, float2 a, float2 b, float ra, float rb){
    float2 ba = b - a; float l = gmax(length(ba), 1e-4); float2 d = ba / l, q = p - a;
    return sdUC(float2(dot(q, float2(d.y, -d.x)), dot(q, d)), ra, rb, gmax(l, ra - rb + .002));
  }
  // icon marks in unit space, about [-.6, .6]
  float qMark(float2 a){ return gmin(gmin(sdArc(rot(a - float2(0., .42), .55), 2.05, .4, .13), sdSeg(a, float2(.02, .04), float2(0., -.26)) - .13), length(a - float2(0., -.66)) - .15); }
  float xMark(float2 a){ return gmin(sdSeg(a, float2(-.42), float2(.42)), sdSeg(a, float2(-.42, .42), float2(.42, -.42))) - .14; }
  float vMark(float2 a){ return gmin(sdSeg(a, float2(-.46, .02), float2(-.14, -.32)), sdSeg(a, float2(-.14, -.32), float2(.48, .34))) - .14; }
  float exMark(float2 a){ return gmin(sdSeg(a, float2(0., -.08), float2(0., .55)) - .15, length(a - float2(0., -.5)) - .16); }
  float upMark(float2 a){ return gmin(sdSeg(a, float2(0., -.48), float2(0., .44)), gmin(sdSeg(a, float2(-.34, .12), float2(0., .46)), sdSeg(a, float2(.34, .12), float2(0., .46)))) - .14; }
  float moonMark(float2 a){ return gmax(length(a) - .55, -(length(a - float2(.26, .2)) - .44)); }
  float hgMark(float2 a){ return gmin(sdTri(a, float2(-.4, .5), float2(.4, .5), float2(0., .02)), sdTri(a, float2(-.4, -.5), float2(.4, -.5), float2(0., -.02))) - .03; }
  float lockMark(float2 a){
    float body = gmax(sdRBox(a - float2(0., -.2), float2(.44, .34), .1), -(length(a - float2(0., -.17)) - .09));
    float sh = gmax(abs(length(a - float2(0., .14)) - .26) - .08, -(a.y - .14));
    sh = gmin(sh, gmin(sdSeg(a, float2(-.26, .14), float2(-.26, -.05)), sdSeg(a, float2(.26, .14), float2(.26, -.05))) - .08);
    return gmin(body, sh);
  }

  // Body: core circle smooth-unioned with one tapered capsule per point; feelings bend, stretch and wave the points.
  float bodyD(float2 p, float4 t5, float4 t6, float4 t7, float4 t28, float grow, float seed, int tipIdx, thread float2 &tipPos){
    int n = int(t5.x + .5), wi = int(t28.y + .5);
    float d = length(p) - t5.y * gmix(.5, 1., grow);
    float k = t5.z * (1. - .55 * t6.z) * (1. + .5 * t7.w);
    tipPos = float2(0.);
    for (int i = 0; i < 8; i++){
      if (i >= n) break;
      float4 pt = D(20 + i);
      float ph = h11(float(i) * 7.31 + seed) * TAU;
      float a = pt.x + t7.x * sin(t7.y + ph);
      a += (t6.x - t7.z * .5) * .3 * sin(1.5708 - a);
      float wb = 0.;
      if (i == wi){ a += t28.z * (.1 + .26 * sin(uTime * 9.)); wb = t28.z * .55 * cos(uTime * 9.); }
      float2 dir = float2(cos(a), sin(a));
      float2 sp = float2(dot(p, float2(-dir.y, dir.x)), dot(p, dir));
      float L = pt.y * t6.y * grow;
      float hw = pt.z * gmix(1., .74, t6.z) * gmix(1., 1.1, t7.w) * gmix(.55, 1., grow);
      float tip = hw * gmix(t5.w, .22, t6.z);
      sp.x -= (pt.w + wb - t7.z * dir.x * .45 + t6.w * .7) * sp.y * sp.y;
      d = smin(d, sdUC(sp, hw, tip, gmax(L, hw - tip + .002)), k);
      if (i == tipIdx) tipPos = dir * (L + tip * .6);
    }
    return d;
  }

  // One eye. Coordinates are mirrored so +x points toward the nose on both sides.
  float eyeD(float2 q, float side, float4 t8, float4 t9, float4 t10, float4 t11, float4 t12, float spin){
    bool L = side < 0.;
    float w = t8.z, h = t8.w, sc = L ? t11.x : t11.y, gap = gmax(t8.x, w * 2.35);
    float2 e = (q - float2(side * gap * .5, L ? t11.z : t11.w)) / sc;
    e = rot(e, -t9.x); e.x *= -side;
    float g = t12.z, d, ext = h * 1.08;
    if (g < .5){
      float sh = t12.w;
      d = sh < .5 ? sdRBox(e, float2(w, h), gmin(w, h)) : sh < 1.5 ? sdEll(e, float2(w, h)) : sdRBox(e, float2(w, h), gmin(w, h) * .55);
    } else {
      float gh = gmin(h, gap * .44);
      ext = gh * 1.45;
      float st = gclamp(w * .45, .024, gh * .2);
      if (g < 1.5) d = sdStar(e, gh * 1.05, 5., 2.4) - gh * .1;
      else if (g < 2.5){ float s = gh * 1.55; d = sdHeart(e / s + float2(0., .55)) * s; }
      else if (g < 3.5){ float s = gh * .6; d = gmin(sdSeg(e, float2(-s), float2(s)), sdSeg(e, float2(-s, s), float2(s, -s))) - st; }
      else if (g < 4.5){
        float r = length(e), th = gmod(atan2(e.y, e.x) + spin, TAU), b = gh * .13;
        float kk = gmax(floor((r / b - th) / TAU + .5), 0.);
        d = gmax(abs(r - b * (th + TAU * kk)) - gclamp(w * .3, .016, gh * .16), r - gh * 1.02);
      }
      else if (g < 5.5){ float s = gh * .62; d = gmin(sdSeg(e, float2(-s * .6, s), float2(s * .5, 0.)), sdSeg(e, float2(-s * .6, -s), float2(s * .5, 0.))) - st; }
      else d = abs(length(e) - gh * .68) - st * .9;
    }
    float la = t9.y, lid = gmix(L ? t10.x : t10.y, -1.1, t9.z);
    d = gmax(d, (e.y - (lid * ext - e.x * tan(la))) * cos(la));
    float low = L ? t10.z : t10.w;
    if (low > .002){ float rr = w * 2.4 + h * .5; d = gmax(d, -(length(e - float2(0., -h - rr + low * h * 1.6)) - rr)); }
    return d * sc;
  }
  float mouthD(float2 m, float type, float sz, float open){
    m /= sz; float d = 1e3;
    if (type < .5) d = 1e3;
    else if (type < 1.5) d = sdArc(float2(m.x, .055 - m.y), .95, .075, .017);
    else if (type < 2.5){ float2 mm = m - float2(0., .015); d = gmax(length(mm * float2(1., 1. / (.5 + .5 * open))) - .082, mm.y); }
    else if (type < 3.5) d = sdEll(m, float2(.04 + .012 * open, .042 + .036 * open));
    else if (type < 4.5) d = sdSeg(m, float2(-.055, 0.), float2(.055, 0.)) - .017;
    else if (type < 5.5) d = sdArc(m + float2(0., .07), .85, .075, .017);
    else if (type < 6.5){ float x = gclamp(m.x, -.075, .075); d = length(float2(m.x - x, m.y - .013 * sin(x * 60.))) - .016; }
    else if (type < 7.5) d = sdArc(float2(abs(m.x) - .034, .028 - m.y), 1.2, .034, .015);
    else if (type < 8.5){ float2 mm = rot(m - float2(.015, 0.), .3); d = sdArc(float2(mm.x, .05 - mm.y), .75, .065, .016); }
    else d = sdSeg(rot(m, .1), float2(-.05, 0.), float2(.045, 0.)) - .016;
    return d * sz;
  }
  float tongueD(float2 m, float sz, float open){ m /= sz; return (length(m - float2(0., -.07 * (.5 + .5 * open))) - .045) * sz; }
  float tongue9D(float2 m, float sz){ m /= sz; return sdEll(rot(m - float2(.026, -.028), .25), float2(.026, .033)) * sz; }

  float4 sparkles(float2 pp, float seed, float amt, bool glowy){
    float4 c = float4(0.);
    for (int i = 0; i < 5; i++){
      float fi = float(i);
      if (fi > 1.5 + 3. * amt) break;
      float ang = h11(fi * 3.1 + seed * 7.) * TAU, rad = 1.02 + .38 * h11(fi * 5.3 + seed * 3.);
      float2 ctr = float2(cos(ang) * rad, sin(ang) * rad * .85 + .15);
      float tw = pow(gmax(0., sin(uTime * (2.2 + 1.6 * h11(fi + seed)) + fi * 2.3)), 3.), s = .14 * tw * gmix(.7, 1., amt);
      if (s < .006) continue;
      float ds = sdStar(pp - ctr, s, 4., 2.3);
      c = over(float4(gmix(float3(1., .72, .18), float3(1., .97, .85), gsmooth(s * .55, 0., length(pp - ctr))), 1.) * cov(ds), c);
      if (glowy) c = over(float4(float3(1., .85, .5), 1.) * exp(-length(pp - ctr) / (s * .5)) * .5 * tw, c);
    }
    return c;
  }

  float4 props(int type, float2 pp, float seed, float age, float3 INK, bool glowy, float amt){
    float4 c = float4(0.);
    if (type == 1){
      for (int i = 0; i < 3; i++){
        float fi = float(i), ph = fract(uTime / 2.3 + fi / 3. + seed);
        float2 ctr = float2((fi - 1.) * .5 + .08 * sin(uTime * 2.3 + fi * 2.), .62 + ph * 1.05);
        float s = .13 + .06 * ph, dh = sdHeart((pp - ctr) / s + float2(0., .55)) * s;
        float a = gsmooth(0., .14, ph) * (1. - gsmooth(.6, 1., ph));
        c = over(float4(float3(1., .34, .52), 1.) * a * cov(dh), c);
        if (glowy) c = over(float4(float3(1., .5, .65), 1.) * a * exp(-gmax(dh, 0.) / .04) * .35, c);
      }
    } else if (type == 2){
      for (int i = 0; i < 3; i++){
        float fi = float(i), ph = fract(uTime / 3.2 + fi / 3.);
        float2 ctr = float2(.52 + ph * .55, .6 + ph * .8);
        float s = .055 + .07 * ph; float2 z = (pp - ctr) / s;
        float dz = gmin(gmin(sdSeg(z, float2(-1., 1.), float2(1., 1.)), sdSeg(z, float2(1., 1.), float2(-1., -1.))), sdSeg(z, float2(-1., -1.), float2(1., -1.))) * s - .024;
        c = over(float4(INK, 1.) * cov(dz) * gsmooth(0., .15, ph) * (1. - gsmooth(.65, 1., ph)), c);
      }
    } else if (type == 3){
      for (int i = 0; i < 5; i++){
        float fi = float(i);
        if (fi > 1.5 + 3. * amt) break;
        float ang = h11(fi * 3.1 + seed * 7.) * TAU, rad = 1.02 + .38 * h11(fi * 5.3 + seed * 3.);
        float2 ctr = float2(cos(ang) * rad, sin(ang) * rad * .85 + .15);
        float tw = pow(gmax(0., sin(uTime * (2.2 + 1.6 * h11(fi + seed)) + fi * 2.3)), 3.), s = .14 * tw * gmix(.7, 1., amt);
        if (s < .006) continue;
        float ds = sdStar(pp - ctr, s, 4., 2.3);
        c = over(float4(gmix(float3(1., .72, .18), float3(1., .97, .85), gsmooth(s * .55, 0., length(pp - ctr))), 1.) * cov(ds), c);
        if (glowy) c = over(float4(float3(1., .85, .5), 1.) * exp(-length(pp - ctr) / (s * .5)) * .5 * tw, c);
      }
    } else if (type == 4){
      float s = .17 * (1. + .12 * sin(uTime * 9.));
      float2 a = abs((pp - float2(.66, .76)) / s);
      c = float4(float3(1., .24, .32), 1.) * cov(sdArc(rot(a - float2(.95), 3.927), .55, .72, .13) * s);
    } else if (type == 5){
      float s = .23; float2 a = rot((pp - float2(.78, .92 + .04 * sin(uTime * 2.))) / s, .15 * sin(uTime * 1.3));
      float hook = sdArc(rot(a - float2(0., .42), .55), 2.05, .4, .13);
      float stem = sdSeg(a, float2(.02, .04), float2(0., -.26)) - .13;
      float dt = length(a - float2(0., -.66)) - .15;
      c = float4(INK, 1.) * cov(gmin(gmin(hook, stem), dt) * s);
    } else if (type == 6){
      float pop = 1. + .35 * exp(-age * 6.) * sin(age * 18.), s = gmax(.17 * pop * gsmooth(0., .08, age), .001);
      float2 a = (pp - float2(.74, .9)) / s;
      float bar = sdSeg(a, float2(0., .15), float2(0., .95)) - gmix(.11, .17, gsmooth(.15, .95, a.y));
      c = float4(float3(1., .7, .14), 1.) * cov(gmin(bar, length(a - float2(0., -.22)) - .15) * s);
    } else if (type == 7){
      for (int i = 0; i < 3; i++){
        float fi = float(i), ang = uTime * 2.6 + fi * 2.094, dep = sin(ang);
        float2 ctr = float2(cos(ang) * .6, 1.1 + dep * .14);
        float s = .085 * (1. - .22 * dep);
        float ds = sdStar(rot(pp - ctr, uTime * 3.), s, 5., 2.5) - s * .1;
        c = over(float4(float3(1., .76, .2), 1.) * cov(ds) * (1. - .4 * gmax(dep, 0.)), c);
      }
    }
    else if (type == 8){
      for (int i = 0; i < 3; i++){
        float fi = float(i), ph = sin(uTime * 4. - fi * 1.1) * .5 + .5;
        float2 cn = float2(-.62 - fi * .17, .9 + fi * .21);
        float r = (.045 + fi * .019) * (.82 + .3 * ph), dd = length(pp - cn) - r;
        c = over(float4(INK, 1.) * cov(dd) * (.55 + .45 * ph), c);
        if (glowy) c = over(float4(INK, 1.) * exp(-gmax(dd, 0.) / .045) * .3 * ph, c);
      }
    }
    else if (type == 9 || type == 10){
      float pop = 1. + .45 * exp(-age * 7.) * sin(age * 17.), s = gmax(.2 * pop * gsmooth(0., .1, age), .001);
      float shake = type == 10 ? .035 * exp(-age * 2.5) * sin(age * 34.) : 0.;
      float2 a = (pp - float2(.8 + shake, .9)) / s;
      float3 fill = type == 9 ? float3(.2, .8, .48) : float3(.95, .28, .34);
      float ic = type == 9 ? vMark(a * 1.75) / 1.75 : xMark(a * 1.9) / 1.9;
      if (type == 9) c = sparkles(pp, seed, .5, glowy);
      if (glowy) c = over(float4(fill, 1.) * exp(-gmax(length(a) - 1., 0.) * s / .06) * .45, c);
      c = over(float4(fill, 1.) * cov((length(a) - 1.) * s), c);
      c = over(float4(1.) * cov(ic * s), c);
    }
    else if (type == 11){
      for (int i = 0; i < 2; i++){
        float fi = float(i), cyc = uTime / 1.9 + fi * .5 + seed * .13, k = floor(cyc), ph = fract(cyc);
        float side = gmod(k + fi, 2.) < 1. ? -1. : 1.;
        float2 cn = float2(side * (.8 + .12 * h11(k + seed)), -.12 + ph * 1.05);
        float s = .16; float2 a = (pp - cn) / s;
        float lt = gmin(sdSeg(a, float2(-.85, 0.), float2(-.52, .32)), sdSeg(a, float2(-.85, 0.), float2(-.52, -.32)));
        float sl = sdSeg(a, float2(-.14, -.36), float2(.14, .36));
        float gt = gmin(sdSeg(a, float2(.85, 0.), float2(.52, .32)), sdSeg(a, float2(.85, 0.), float2(.52, -.32)));
        float al = gsmooth(0., .15, ph) * (1. - gsmooth(.6, 1., ph));
        float3 cc = glowy ? float3(.72, 1., .86) : INK;
        c = over(float4(cc, 1.) * cov((gmin(gmin(lt, sl), gt) - .11) * s) * al, c);
      }
    }
    else if (type == 12){
      float ra = 1.32, head = uTime * 2.4 + seed, an = atan2(pp.y, pp.x);
      float da = gmod(head - an, TAU), tail = 1. - gsmooth(0., 2.4, da);
      c = over(float4(INK, 1.) * cov(abs(length(pp) - ra) - .012) * .22, c);
      c = over(float4(INK, 1.) * cov(abs(length(pp) - ra) - .036 * (.35 + .65 * tail)) * tail, c);
      float2 hp = float2(cos(head), sin(head)) * ra;
      if (glowy) c = over(float4(INK, 1.) * exp(-length(pp - hp) / .09) * .55, c);
      c = over(float4(1.) * cov(length(pp - hp) - .062), c);
    }
    else if (type == 13){
      float ang = -uTime * .8 + seed * .7;
      float2 bp = float2(cos(ang) * 1.22, sin(ang) * 1.08 + .05);
      float2 tg = normalize(float2(sin(ang) * 1.22, -cos(ang) * 1.08));
      float2 b = pp - bp; b = float2(dot(b, float2(tg.y, -tg.x)), dot(b, tg)) / 1.7;
      float2 m = float2(abs(b.x), b.y);
      float legs = 1e3;
      for (int k = 0; k < 3; k++){
        float fk = float(k) - 1., w = sin(uTime * 22. + fk * 2.1) * .016;
        legs = gmin(legs, sdSeg(m, float2(.04, fk * .035), float2(.098, fk * .06 + w)));
      }
      float ant = sdSeg(m, float2(.01, .1), float2(.04, .15));
      float body = sdEll(b, float2(.058, .072)), head = length(b - float2(0., .082)) - .034;
      float marks = gmax(gmin(abs(b.x) - .005, gmin(length(m - float2(.028, .012)) - .015, length(m - float2(.026, -.034)) - .012)), body);
      float3 dark = float3(.14, .11, .2);
      c = over(float4(dark, 1.) * cov((gmin(legs - .009, ant - .007)) * 1.7), c);
      c = over(float4(float3(.96, .27, .33), 1.) * cov(body * 1.7), c);
      c = over(float4(dark, 1.) * cov(gmin(marks, head) * 1.7), c);
    }
    else if (type == 14){
      float2 lc = float2(.8, .9 + .03 * sin(uTime * 3.));
      float s = .2; float2 a = (pp - lc) / s;
      float rp = fract(uTime * .9);
      c = over(float4(float3(1., .74, .24), 1.) * cov(abs(length(pp - lc) - (.2 + rp * .24)) - .012) * (1. - rp) * .75, c);
      float sh = gmax(abs(length(a - float2(0., .14)) - .26) - .08, -(a.y - .14));
      sh = gmin(sh, gmin(sdSeg(a, float2(-.26, .14), float2(-.26, -.05)), sdSeg(a, float2(.26, .14), float2(.26, -.05))) - .08);
      float body = sdRBox(a - float2(0., -.2), float2(.44, .34), .1);
      float kh = gmin(length(a - float2(0., -.15)) - .085, sdSeg(a, float2(0., -.18), float2(0., -.36)) - .04);
      c = over(float4(float3(.84, .86, .92), 1.) * cov(sh * s), c);
      c = over(float4(float3(1., .76, .26), 1.) * cov(body * s), c);
      c = over(float4(float3(.5, .32, .08), 1.) * cov(gmax(kh, body) * s), c);
    }
    else if (type == 15){
      float ph = fract(uTime / 3.), flip = gsmooth(.86, 1., ph) * PI, k = gclamp(ph / .86, 0., 1.), s = .2;
      float2 a = rot(pp - float2(.8, .9), flip) / s;
      float top = sdTri(a, float2(-.42, .55), float2(.42, .55), float2(0., 0.)), bot = sdTri(a, float2(-.42, -.55), float2(.42, -.55), float2(0., 0.));
      float glass = gmin(top, bot);
      float sand = gmin(gmax(top + .06, a.y - (.04 + .42 * (1. - k))), gmax(bot + .06, a.y - (-.55 + .46 * k)));
      sand = gmin(sand, gmax(sdSeg(a, float2(0.), float2(0., -.5)) - .025, -(k - .98)));
      float bars = gmin(sdRBox(a - float2(0., .62), float2(.56, .07), .04), sdRBox(a - float2(0., -.62), float2(.56, .07), .04));
      c = over(float4(float3(.9, .95, 1.), 1.) * cov(glass * s) * .3, c);
      c = over(float4(float3(1., .78, .35), 1.) * cov(sand * s), c);
      c = over(float4(float3(.92, .96, 1.), 1.) * cov((abs(glass) - .035) * s) * .9, c);
      c = over(float4(float3(.66, .46, .3), 1.) * cov(bars * s), c);
    }
    else if (type == 16){
      for (int i = 0; i < 2; i++){
        float fi = float(i), ph = fract(uTime / 2.4 + fi * .5), side = fi < .5 ? -1. : 1.;
        float2 cn = float2(side * (.8 + ph * .22) + .05 * sin(ph * 8. + fi), .05 + ph * 1.05);
        float2 a = rot(pp - cn, -.2 * side) / .2;
        float head = sdEll(rot(a - float2(-.12, -.32), .45), float2(.3, .21));
        float stem = sdSeg(a, float2(.14, -.28), float2(.14, .56)) - .06;
        float flag = sdSeg(a, float2(.14, .56), float2(.44, .3)) - .07;
        float al = gsmooth(0., .15, ph) * (1. - gsmooth(.65, 1., ph));
        c = over(float4(INK, 1.) * cov(gmin(gmin(head, stem), flag) * .2) * al, c);
      }
    }
    else if (type == 17){
      for (int i = 0; i < 14; i++){
        float fi = float(i), h1 = h11(fi * 1.31 + 3.), h2 = h11(fi * 2.17 + 5.), h3 = h11(fi * 3.7 + 1.);
        float ph = fract(uTime * (.16 + .1 * h2) + h1);
        float2 cn = float2((h1 - .5) * 2.7 + .12 * sin(uTime * 2. + fi), 1.6 - ph * 3.);
        float2 a = rot(pp - cn, uTime * (2. + 2. * h3) + fi);
        a.x /= gmax(abs(cos(uTime * 4. + fi * 1.7)), .2);
        float m = gmod(fi, 5.);
        float3 cc = m < 1. ? float3(1., .42, .62) : m < 2. ? float3(1., .82, .3) : m < 3. ? float3(.45, .92, .66) : m < 4. ? float3(.45, .76, 1.) : float3(.76, .6, 1.);
        float al = gsmooth(0., .08, ph) * (1. - gsmooth(.8, 1., ph)) * gsmooth(.5, .9, length(pp - float2(0., .05)));
        c = over(float4(cc, 1.) * cov(sdRBox(a, float2(.05, .024), .006)) * al, c);
      }
      c = over(sparkles(pp, seed, .6, glowy), c);
    }
    return c;
  }

  // Accessories sit in front of the face. Face-anchored ones use q, body-anchored ones p, table-anchored ones P (no body motion).
  float4 accessory(int acc, float a, float2 p, float2 q, float2 P, float2 look, float2 lensC, float lensR, float4 t5, float4 t8, float4 t30, float seed, float3 GC, float3 GM, float3 GR, float3 INK, bool gl, float dsc){
    float4 c = float4(0.);
    float al = gsmooth(0., .3, a);
    if (acc == 1){
      float2 s = q - look * float2(.04, .03) - float2(0., .02 + (1. - a) * .55);
      float gap = gmax(t8.x, .3), lw = .155, lh = .112, dl = 1e3; float2 el = float2(0.);
      for (int i = 0; i < 2; i++){
        float side = i == 0 ? -1. : 1.;
        float2 e = s - float2(side * gap * .5, 0.);
        e.x *= side;
        e.x /= 1. + .28 * gclamp(e.y / lh, -1., 1.);
        float dd = sdRBox(e - float2(-.012, 0.), float2(lw, lh), .07);
        if (dd < dl){ dl = dd; el = e; }
      }
      float bridge = sdSeg(s, float2(-gap * .5 + lw * .75, .075), float2(gap * .5 - lw * .75, .075)) - .02;
      float3 lens = gmix(float3(.05, .04, .1), gmix(float3(.1, .07, .18), GC, .45), gsmooth(lh, -lh, el.y));
      float sweep = fract(uTime / 3.4 + seed * .1) * 3.2 - 1.;
      lens += float3(1.) * (gsmooth(.04, 0., abs(el.x * .9 + el.y - sweep * .4)) * .5 + gsmooth(.055, 0., length(el - float2(-.06, .055))) * .45);
      c = over(float4(lens, 1.) * cov(dl * dsc), c);
      float3 fcol = gl ? gmix(float3(.1, .08, .16), GR, .35) : float3(.08, .07, .12);
      c = over(float4(fcol, 1.) * cov(gmin(abs(dl) - .016, bridge) * dsc), c);
    } else if (acc == 2){
      float2 l = P + float2(0., (1. - a) * .9);
      float lid = sdRBox(l - float2(0., -.6), float2(.68, .36), .07), base = sdRBox(l - float2(0., -1.0), float2(.8, .045), .045);
      float3 alu = gmix(float3(.64, .67, .76), float3(.9, .92, .96), gsmooth(-.96, -.26, l.y));
      if (gl) alu = gmix(alu, GM, .12);
      alu += float3(1.) * gsmooth(.03, 0., abs(lid + .018)) * .3;
      c = over(float4(float3(.7, .73, .8), 1.) * cov(base), c);
      c = over(float4(float3(.74, .86, 1.), 1.) * exp(-gmax(l.y + .24, 0.) / .05) * gstep(abs(l.x), .64) * gstep(-.26, l.y) * .3, c);
      c = over(float4(alu, 1.) * cov(lid), c);
      float lg = sdStar(l - float2(0., -.6), .1, 4., 2.3);
      if (gl) c = over(float4(GR, 1.) * exp(-gmax(lg, 0.) / .05) * .4 * (1. - cov(lg)) * cov(lid), c);
      c = over(float4(gl ? gmix(GR, float3(1.), .5) : float3(1.), 1.) * cov(lg) * .95, c);
    } else if (acc == 3){
      float rr = length(p - lensC);
      float2 hd = normalize(float2(.7, -.72));
      float handle = sdSeg(p, lensC + hd * (lensR + .02), lensC + hd * (lensR + .3)) - .045;
      float rim = abs(rr - lensR) - .03;
      float hl = gmax(abs(rr - lensR * .72) - .018, .55 - dot(normalize(p - lensC + 1e-5), float2(-.7, .7)));
      c = over(float4(float3(.78, .92, 1.), 1.) * (1. - gsmooth(lensR - .01, lensR, rr)) * .12, c);
      c = over(float4(1.) * cov(hl * dsc) * .6, c);
      c = over(float4(float3(.48, .31, .2), 1.) * cov(handle * dsc), c);
      c = over(float4(gl ? gmix(float3(.24, .2, .34), GR, .35) : float3(.22, .2, .3), 1.) * cov(rim * dsc), c);
    } else if (acc == 4){
      float2 s = q - look * float2(.04, .03) - float2(0., (1. - a) * .4);
      float gap = gmax(t8.x, .3), h = t8.w, bw = gmin(gap * .5 - .025, .17), bh = .085, y0 = -h * .42, dl = 1e3; float2 el = float2(0.);
      for (int i = 0; i < 2; i++){
        float side = i == 0 ? -1. : 1.;
        float2 e = s - float2(side * gap * .5, y0);
        float dd = sdRBox(e, float2(bw, bh), .06);
        if (dd < dl){ dl = dd; el = e; }
      }
      float bridge = sdArc(float2(s.x, y0 + bh * .55 - s.y), .9, gmax(gap * .5 - bw, .02), .016);
      c = over(float4(float3(.85, .95, 1.), 1.) * cov(dl * dsc) * .2, c);
      c = over(float4(1.) * cov((abs(el.x + el.y * .9 + .04) - .012) * dsc) * cov(dl * dsc) * .55, c);
      float3 fcol = gl ? gmix(float3(.3, .18, .12), GR, .2) : float3(.3, .18, .12);
      c = over(float4(fcol, 1.) * cov(gmin(abs(dl) - .016, bridge) * dsc), c);
    } else if (acc == 5){
      float2 s = p - float2(0., (1. - a) * .5);
      float cr = t5.y;
      float band = gmax(abs(length(s - float2(0., -.02)) - (cr + .03)) - .05, -(s.y - .06));
      float2 sc = float2(abs(s.x), s.y);
      float cup = sdRBox(sc - float2(cr + .04, -.08), float2(.1, .17), .08), cush = sdRBox(sc - float2(cr - .03, -.08), float2(.05, .14), .05);
      float3 shell = gl ? gmix(float3(.97), GR, .25) : float3(.97);
      float3 accent = gl ? gmix(GM, GC, .5) : INK;
      c = over(float4(shell * .92, 1.) * cov(band * dsc), c);
      c = over(float4(float3(.3, .28, .4), 1.) * cov(cush * dsc), c);
      c = over(float4(shell, 1.) * cov(cup * dsc), c);
      c = over(float4(accent, 1.) * cov((length(sc - float2(cr + .06, -.08)) - .045) * dsc), c);
    } else if (acc == 6){
      float cyc = fract(uTime / 5. + seed * .37), sip = gsmooth(0., .14, cyc) * (1. - gsmooth(.34, .48, cyc));
      float2 mc = gmix(float2(.68, -.58), float2(.32, -.32), sip * .8) - float2(0., (1. - a) * .8);
      float2 m = rot(P - mc, -sip * .55);
      float body = sdRBox(m, float2(.13 + m.y * .05, .15), .045);
      float handle = gmax(abs(length(m - float2(.15, .01)) - .065) - .024, -(m.x - .13));
      float band = gmax(sdRBox(m - float2(0., .02), float2(.2, .035), .01), body);
      float3 mug = float3(.97, .96, .98) * gmix(.82, 1., gsmooth(-.15, .15, m.x + m.y * .3));
      c = over(float4(mug * .9, 1.) * cov(handle), c);
      c = over(float4(mug, 1.) * cov(body), c);
      c = over(float4(gl ? gmix(GM, GC, .4) : INK, 1.) * cov(band), c);
      for (int i = 0; i < 2; i++){
        float fi = float(i);
        float2 sp = P - (mc + float2(-.04 + fi * .08, .19));
        float wx = sp.x - .025 * sin(sp.y * 18. - uTime * 3. + fi * 2.);
        float dS = gmax(abs(wx) - .012, gmax(-sp.y, sp.y - .26));
        c = over(float4(1.) * cov(dS) * .45 * (1. - sip) * (1. - gsmooth(.08, .26, sp.y)), c);
      }
    } else if (acc == 7){
      float2 m = rot(P - float2(.6, -.5) + float2(0., (1. - a) * .8), .14);
      float board = sdRBox(m, float2(.24, .31), .04), paper = sdRBox(m - float2(0., -.02), float2(.2, .26), .015), clip = sdRBox(m - float2(0., .3), float2(.08, .045), .02);
      c = over(float4(gl ? gmix(float3(.55, .36, .22), GC, .25) : float3(.6, .4, .24), 1.) * cov(board), c);
      c = over(float4(float3(.98), 1.) * cov(paper), c);
      float cyc = fract(uTime / 4.8 + seed * .2);
      for (int i = 0; i < 3; i++){
        float fi = float(i), y = .12 - fi * .13;
        float box = abs(sdRBox(m - float2(-.12, y), float2(.035), .008)) - .009, line = sdSeg(m, float2(-.05, y), float2(.14 - fi * .03, y)) - .012;
        c = over(float4(float3(.62, .64, .72), 1.) * cov(gmin(box, line)), c);
        float tick = gmin(sdSeg(m, float2(-.145, y + .005), float2(-.125, y - .02)), sdSeg(m, float2(-.125, y - .02), float2(-.09, y + .03))) - .012;
        c = over(float4(float3(.15, .75, .45), 1.) * cov(tick) * gstep((fi + 1.) * .24, cyc), c);
      }
      c = over(float4(float3(.78, .8, .86), 1.) * cov(clip), c);
    } else if (acc == 8){
      float2 dir = float2(cos(t30.z), sin(t30.z)), perp = float2(-dir.y, dir.x);
      float2 s = p - (t30.xy + dir * ((1. - a) * .55 - .04));
      float2 u = float2(dot(s, perp), dot(s, dir));
      float r0 = gmax(t30.w * 1.08, .15), sw = .04 * sin(uTime * 1.3 + seed);
      float2 c1 = float2(.04, .24), c2 = float2(.2 + sw * .5, .42), c3 = float2(.44 + sw, .36 - sw * .5);
      float cone = smin(smin(sdTC(u, float2(0.), c1, r0, r0 * .7), sdTC(u, c1, c2, r0 * .7, r0 * .38), .06), sdTC(u, c2, c3, r0 * .38, .03), .05);
      float pom = length(u - c3 - float2(.05, -.06)) - .075;
      float band = sdRBox(u - float2(0., .01), float2(r0 * 1.16, .05), .05);
      band += .006 * sin(atan2(u.y - .01, u.x) * 9.);
      float3 capc = gmix(float3(.2, .2, .48), GR, .22);
      float3 strp = gmix(float3(.5, .52, .95), GC, .3);
      capc = gmix(capc, strp, gstep(.55, fract((u.y - u.x * .35) * 6.5)) * .8);
      capc *= .9 + .1 * gsmooth(-.1, .2, u.x);
      c = over(float4(capc, 1.) * cov(cone * dsc), c);
      c = over(float4(float3(.98, .97, 1.), 1.) * cov(band * dsc), c);
      c = over(float4(float3(.98, .97, 1.), 1.) * cov(pom * dsc), c);
      c = over(float4(float3(.8, .82, .92), 1.) * cov((length(u - c3 - float2(.07, -.09)) - .035) * dsc) * cov(pom * dsc) * .35, c);
    }
    return c * al;
  }

  float4 shade(){
    float4 d0 = D(0), d1 = D(1), d2 = D(2), d3 = D(3), d4 = D(4), t29 = D(29), t31 = D(31);
    px = 1. / (d0.z * uDpr);
    float seed = d0.w;
    int style = int(d1.x + .5), frameT = int(d1.z + .5);
    pb = int(d1.y + .5) * 8;
    float2 P = vP, off = d3.xy, sxy = d4.xy * d3.w;
    float2 p = rot(P - off, -d3.z) / sxy;
    float dsc = gmin(sxy.x, sxy.y), grow = d4.w;
    float4 t5 = D(5), t6 = D(6), t7 = D(7), t8 = D(8), t9 = D(9), t10 = D(10), t11 = D(11), t12 = D(12);
    float4 t13 = D(13), t14 = D(14), t15 = D(15), t16 = D(16), t17 = D(17), t18 = D(18), t19 = D(19), t28 = D(28), t30 = D(30);
    float2 look = t12.xy;
    int acc = int(t18.z + .5); float accA = t18.y, faceY = t18.w;
    // the magnifier enlarges whatever sits under the glass, so remap before the body is evaluated
    float2 p0 = p, lensC = float2(t8.x * .5 + .01, t8.y + faceY) + look * float2(.14, .1);
    float lensR = .27 * gsmooth(0., .6, accA);
    if (acc == 3 && lensR > .005){ float lr = length(p - lensC); if (lr < lensR) p = lensC + (p - lensC) / gmix(1., 1.5, accA); }
    float gcyc = uTime / 3.7 + seed * 1.37, gp = fract(gcyc);
    int tipIdx = int(h11(floor(gcyc) * 1.7 + seed) * t5.x);
    float2 tipPos;
    float d = bodyD(p, t5, t6, t7, t28, grow, seed, tipIdx, tipPos) * dsc;

    float3 FLAT = PAL(0), GC = PAL(1), GM = PAL(2), GR = PAL(3), AU = PAL(4), FT = PAL(5), INK = PAL(6), BL = PAL(7);
    GR = gmix(GR, t16.rgb, t16.a * .55); AU = gmix(AU, t16.rgb, t16.a); GM = gmix(GM, t16.rgb, t16.a * .25); FLAT = gmix(FLAT, t16.rgb, t16.a * .2);
    float desat = t28.x;
    if (desat > .002){
      FLAT = gmix(FLAT, float3(lum(FLAT)), desat); GC = gmix(GC, float3(lum(GC)), desat); GM = gmix(GM, float3(lum(GM)), desat); GR = gmix(GR, float3(lum(GR)), desat);
      AU = gmix(AU, float3(lum(AU)), desat); FT = gmix(FT, float3(lum(FT)), desat); INK = gmix(INK, float3(lum(INK)), desat); BL = gmix(BL, float3(lum(BL)), desat);
    }
    float glow = t17.x;

    float2 q = p - float2(look.x * .1, t8.y + faceY + look.y * .07);
    float eD = 1e3, mA = 1e3, mB = 1e3, tD = 1e3, bD = 1e3, tw = 0., t9D = 1e3, tw9 = 0.;
    if (d < .04){
      float2 qe = q - look * float2(.04, .03);
      eD = gmin(eyeD(qe, -1., t8, t9, t10, t11, t12, t17.z), eyeD(qe, 1., t8, t9, t10, t11, t12, t17.z)) * dsc;
      float2 mq = q - float2(look.x * .03, t14.y);
      mA = mouthD(mq, t13.x, t13.w, t14.x) * dsc; mB = mouthD(mq, t13.y, t13.w, t14.x) * dsc;
      tw = (abs(t13.x - 2.) < .1 ? 1. - t13.z : 0.) + (abs(t13.y - 2.) < .1 ? t13.z : 0.);
      tD = gmax(tongueD(mq, t13.w, t14.x) * dsc, gmin(mA, mB));
      tw9 = (abs(t13.x - 9.) < .1 ? 1. - t13.z : 0.) + (abs(t13.y - 9.) < .1 ? t13.z : 0.);
      t9D = tongue9D(mq, t13.w) * dsc;
      float2 bq = float2(abs(q.x) - (gmax(t8.x, t8.z * 2.35) * .5 + t8.z * 1.05 + .07), q.y + t8.w * .8 + .03);
      bD = sdEll(bq, float2(.115, .062)) * dsc;
    }

    float inside = cov(d);
    float4 col = float4(0.);
    if (uShadow > .5 && frameT == 0 && style == 0){
      float2 sq = (P - float2(off.x * .6, -1.16)) / float2(.72 * (1. - .28 * d4.z), .1 * (1. - .2 * d4.z));
      col = float4(0., 0., 0., 1.) * exp(-dot(sq, sq)) * .15 * (1. - .55 * d4.z) * grow;
    }
    float ext = gmax(d, 0.), win = 1. - gsmooth(.6, .97, length(P) / d1.w);
    if (style == 2){
      col = over(float4(AU, 1.) * exp(-ext / .34) * .3 * glow * (1. - inside) * win, col);
      col = over(float4(GR, 1.) * exp(-ext / .075) * .55 * gmin(glow, 1.4) * (1. - inside), col);
    } else if (style == 1){
      col = over(float4(1.) * exp(-ext / .055) * .42 * (1. - inside), col);
    }

    bool solidGlyph = t12.z > .5 && t12.z < 2.5;
    float3 GLY = t12.z < 1.5 ? float3(1., .86, .36) : float3(1., .33, .52);
    float3 bc; float ba = inside;
    float eCov, mCov;
    if (style == 0){
      bc = FLAT;
      eCov = cov(eD); mCov = gmix(cov(mA), cov(mB), t13.z);
    } else if (style == 1){
      float h = gsmooth(0., .3, -d);
      float2 g = float2(dfdx(h), dfdy(h)) / px;
      float3 nrm = normalize(float3(-g * .14, 1.));
      float diff = gclamp(dot(nrm, normalize(float3(-.5, .6, .62))), 0., 1.);
      float fres = 1. - gsmooth(0., .2, -d);
      bc = gmix(FT * gmix(.8, 1.07, diff), float3(1.), fres * .82);
      bc = gmix(bc, float3(1.), gsmooth(.36, 0., length((p - float2(-.26, .34)) * float2(1., 1.45))) * .4);
      ba = inside * gmix(.97, .88, h);
      eCov = gsmooth(.012, -.012, eD); mCov = gmix(gsmooth(.01, -.01, mA), gsmooth(.01, -.01, mB), t13.z);
    } else {
      float tt = gclamp(-d / .42 + (fbm(p * 1.5 + float2(seed * 3.1, uTime * .07)) - .5) * .2, 0., 1.);
      bc = gmix(GR, GM, gsmooth(0., .24, tt));
      bc = gmix(bc, GC, gsmooth(.2, .72, tt));
      bc = gmix(bc, float3(1.), exp(gmin(d, 0.) / .022) * .5);
      bc = gmix(bc, float3(1.), gsmooth(.34, 0., length((p - float2(-.28, .36)) * float2(1., 1.5))) * .2);
      eCov = gsmooth(px + .007, -.005, eD); mCov = gmix(gsmooth(px + .006, -.004, mA), gsmooth(px + .006, -.004, mB), t13.z);
    }
    if (acc == 2) bc += float3(.6, .8, 1.) * .22 * accA * gsmooth(.15, -.3, p.y);
    float face = t9.w; eCov *= face; mCov *= face;
    if (acc == 1) eCov *= 1. - gsmooth(.15, .55, accA);
    bc = gmix(bc, BL, (style == 0 ? cov(bD) : gsmooth(.035, -.035, bD)) * t14.z * .62 * face);
    float tCov = cov(tD) * tw * face;
    if (style == 1){
      float hole = (solidGlyph ? 0. : eCov) + mCov * (1. - tCov);
      float rim = (1. - gsmooth(0., .03, -gmin(eD, gmin(mA, mB)))) * gstep(gmin(eD, gmin(mA, mB)), 0.);
      bc = gmix(bc, FT * .72, rim * .5);
      if (solidGlyph) bc = gmix(bc, GLY, eCov);
      bc = gmix(bc, float3(1., .5, .6), tCov);
      ba *= 1. - gclamp(hole, 0., 1.) * .9;
    } else {
      float3 EYE = style == 2 ? gmix(float3(1.), GR, .3) : float3(1.);
      bc = gmix(bc, solidGlyph ? GLY : EYE, eCov);
      bc = gmix(bc, EYE, mCov);
      bc = gmix(bc, float3(1., .45, .55), tCov);
      if (style == 2) bc = gmix(bc, float3(1.), exp(-gmax(eD, 0.) / .03) * .22 * (1. - eCov));
    }
    bc = gmix(bc, float3(1., .45, .55), cov(t9D) * tw9 * face);
    col = over(float4(bc, 1.) * ba, col);

    float tears = t14.w;
    if (tears > .01){
      for (int i = 0; i < 2; i++){
        float side = i == 0 ? -1. : 1., sc = i == 0 ? t11.x : t11.y;
        float2 eb = float2(side * (t8.x * .5 + t8.z * .25), (i == 0 ? t11.z : t11.w) - t8.w * sc * .8);
        if (tears > .5){
          float wob = .01 * sin(q.y * 26. + uTime * 7. + side * 2.);
          float sd = sdSeg(q - float2(wob, 0.), eb, float2(eb.x + side * .05, -.92)) - (.03 + .008 * sin(q.y * 18. - uTime * 11.));
          col = over(float4(float3(.66, .88, 1.), 1.) * cov(sd * dsc) * gsmooth(.5, .8, tears) * .85, col);
        }
        float ph = fract(uTime / (tears > .5 ? 1.1 : 2.4) + (i == 0 ? 0. : .5) + seed);
        float2 dp = eb + float2(side * .02 * ph, -ph * ph * (tears > .5 ? 1.3 : .75));
        float dd = sdDrop(q - dp, .038 * gsmooth(0., .12, ph) + .001) * dsc;
        col = over(float4(float3(.72, .9, 1.), 1.) * cov(dd) * (1. - gsmooth(.75, 1., ph)) * gmin(tears * 2., 1.), col);
      }
    }
    if (t15.x > .01){
      float ph = fract(uTime / 1.9);
      float sd = sdDrop(rot(p - float2(.62, .56 - .12 * ph), -.3), .075) * dsc;
      float sa = t15.x * gsmooth(0., .1, ph) * (1. - gsmooth(.7, 1., ph));
      col = over(float4(float3(.38, .72, 1.), 1.) * cov(sd) * sa, col);
      col = over(float4(1.) * cov((length(p - float2(.6, .53 - .12 * ph)) - .022) * dsc) * sa * .9, col);
    }
    if (acc > 0 && accA > .005) col = over(accessory(acc, accA, p0, q, P, look, lensC, lensR, t5, t8, t30, seed, GC, GM, GR, INK, style == 2, dsc), col);
    float2 pp = P - off;
    float age = uTime - t18.x;
    if (style != 0) INK = gmix(GR, float3(1.), .5);
    if (t28.w > .5){
      float pa = gsmooth(0., .25, t17.w);
      if (t15.w < .999) col = over(props(int(t15.y + .5), pp, seed, age, INK, style == 2, t17.w) * (1. - t15.w) * pa, col);
      if (t15.w > .001) col = over(props(int(t15.z + .5), pp, seed, age, INK, style == 2, t17.w) * t15.w * pa, col);
    }
    if (style == 2){
      float gam = gsmooth(0., .1, gp) * (1. - gsmooth(.1, .38, gp)) * grow;
      float2 gq = p - tipPos;
      float cr = exp(-abs(gq.x) / .012) * exp(-abs(gq.y) / .15) + exp(-abs(gq.y) / .012) * exp(-abs(gq.x) / .15);
      col = over(float4(1.) * gclamp((cr * .75 + exp(-length(gq) / .035)) * gam * glow * (1. - desat), 0., 1.), col);
    }

    if (frameT > 0){
      float2 F = P - d2.xy; float fh = d2.z;
      float fd = frameT == 1 ? length(F) - fh : sdSquircle(F, fh);
      float fm = cov(fd);
      float3 top = style == 0 ? gmix(FT, float3(1.), .5) : GC * .78;
      float3 bot = style == 0 ? gmix(FT, float3(1.), .15) : gmix(GC, GM, .6);
      if (style == 2){
        // glow avatars sit on a night-sky disc in the palette's hue so the light reads at any size
        int di = int(d1.y + .5) * 2; float3 k0 = uDeep[di].xyz, k1 = uDeep[di + 1].xyz;
        if (desat > .002){ k0 = gmix(k0, float3(lum(k0)), desat); k1 = gmix(k1, float3(lum(k1)), desat); }
        top = gmix(k0, float3(.035, .03, .09), .62); bot = gmix(k0, k1, .4) * .82;
      }
      float3 bgc = gmix(bot, top, gsmooth(-fh, fh, F.y));
      bgc += (style == 2 ? AU : float3(1.)) * exp(-dot2(F - float2(0., style == 2 ? 0. : fh * .55)) / (fh * fh * .45)) * (style == 2 ? .12 : .07);
      float4 content = over(col, float4(bgc, 1.)) * fm;
      float sd = frameT == 1 ? length(F + float2(0., .07 * fh)) - fh : sdSquircle(F + float2(0., .07 * fh), fh);
      col = over(content, float4(0., 0., 0., 1.) * exp(-gmax(sd, 0.) / (.07 * fh)) * .16 * (1. - fm));
      int ring = int(t19.z + .5); float ringA = t19.w;
      if (ring > 0 && ringA > .01){
        float rd = abs(length(F) - fh * 1.15) - fh * .05;
        if (ring == 1){
          float an = atan2(F.y, F.x), head = -uTime * 4. + seed, da = gmod(an - head, TAU), tail = 1. - gsmooth(0., 3.8, da);
          float3 rc = gmix(GC, GM, .55);
          col = over(float4(rc, 1.) * cov(rd) * (.2 + .8 * tail) * ringA, col);
          col = over(float4(1.) * cov(rd + fh * .02) * gsmooth(.5, 0., da) * ringA * .8, col);
        } else {
          float pu = .5 + .5 * sin(uTime * 4.2);
          col = over(float4(float3(1., .7, .2), 1.) * cov(rd - pu * fh * .016) * (.55 + .45 * pu) * ringA, col);
        }
      }
      int bdg = int(t19.x + .5); float bA = t19.y;
      if (bdg > 0 && bA > .01){
        float br = fh * .36 * bA;
        float2 a = (P - d2.xy - float2(.7, -.7) * fh) / br;
        float3 bf = bdg == 1 ? float3(.18, .78, .45) : bdg == 2 ? float3(.95, .27, .33) : bdg <= 4 ? float3(1., .66, .14) : bdg == 5 ? float3(.42, .45, 1.) : bdg == 6 ? float3(1., .36, .56) : bdg == 7 ? float3(.36, .4, .8) : bdg == 8 ? float3(.5, .55, .68) : float3(1., .48, .16);
        float ic = bdg == 1 ? vMark(a * 1.6) / 1.6 : bdg == 2 ? xMark(a * 1.75) / 1.75 : bdg == 3 ? qMark(a * 1.9) / 1.9 : bdg == 4 ? lockMark(a * 1.45) / 1.45
          : bdg == 5 ? upMark(a * 1.6) / 1.6 : bdg == 6 ? sdHeart(a * 1.35 + float2(0., .55)) / 1.35 : bdg == 7 ? moonMark(a * 1.4) / 1.4 : bdg == 8 ? hgMark(a * 1.45) / 1.45 : exMark(a * 1.7) / 1.7;
        col = over(float4(t31.a > .5 ? t31.rgb : uCut, 1.) * cov((length(a) - 1.26) * br), col);
        col = over(float4(bf, 1.) * cov((length(a) - 1.) * br), col);
        col = over(float4(1.) * cov(ic * br), col);
      }
    }
    return col * d2.w;
  }
};

struct VOut {
  float4 position [[position]];
  float2 vP;
  int vId [[flat]];
};

}  // namespace spark_star

/// The engine's VS: one quad per face, S (`d1.w`) star radii from its centre each way, at the face's (x, y) in points.
vertex spark_star::VOut spark_star_vertex(
  uint vertexID [[vertex_id]], uint instanceID [[instance_id]],
  texture2d<float, access::read> uData [[texture(0)]], constant spark_star::Uniforms &u [[buffer(0)]]
) {
  int id = int(instanceID);
  float4 d0 = uData.read(uint2(0, uint(id))), d1 = uData.read(uint2(1, uint(id)));
  float2 c = float2(float(vertexID & 1), float((vertexID >> 1) & 1)) * 2. - 1.;
  spark_star::VOut out;
  out.vP = c * d1.w;
  out.vId = id;
  float2 pos = d0.xy + float2(c.x, -c.y) * d1.w * d0.z;
  float2 view = u.a.xy;
  out.position = d0.z > 0. ? float4(pos.x / view.x * 2. - 1., 1. - pos.y / view.y * 2., 0., 1.) : float4(2., 2., 2., 1.);
  return out;
}

/// The engine's FS: the clip (row 29), then the face, premultiplied.
fragment float4 spark_star_fragment(
  spark_star::VOut in [[stage_in]], texture2d<float, access::read> uData [[texture(0)]],
  constant spark_star::Uniforms &u [[buffer(0)]], constant float4 *uPal [[buffer(1)]],
  constant float4 *uDeep [[buffer(2)]]
) {
  float4 t29 = uData.read(uint2(29, uint(in.vId)));
  float2 fc = in.position.xy / u.a.w;
  if (fc.x < t29.x || fc.y < t29.y || fc.x > t29.z || fc.y > t29.w) discard_fragment();
  spark_star::SparkShade face;
  for (int i = 0; i < 32; i++) face.rows[i] = uData.read(uint2(uint(i), uint(in.vId)));
  face.vP = in.vP;
  face.uView = u.a.xy;
  face.uTime = u.a.z;
  face.uDpr = u.a.w;
  face.uShadow = u.b.w;
  face.uCut = u.b.xyz;
  face.uPal = uPal;
  face.uDeep = uDeep;
  return face.shade();
}
