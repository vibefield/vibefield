/* Star Spark engine — WebGL2, attribute-less instanced quads.
   Every spark is one row in a float data texture; trail, body and particles are pure functions
   of (row, time), so any moment of the animation can be rendered or scrubbed deterministically. */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const ROW = 32; // texels per spark row

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

  // c: [edge, ramp1, ramp2, ramp3, deep, rim, halo, aura, trail, accent]
  const PALETTES = [
    { name: 'Periwinkle', src: 'Ref 1', dark: 0, c: ['#4092f9', '#6fb2fb', '#a4defd', '#d8fbff', '#ffffff', '#5a47f6', '#f1e4ff', '#a9a4ff', '#6c8cff', '#ffffff'] },
    { name: 'Eclipse', src: 'Ref 3', dark: 1, c: ['#f6f7f9', '#fc9fc5', '#fd307f', '#a00951', '#0c0928', '#16e9de', '#2a9ff6', '#5a2fc0', '#3c5ce8', '#89fae4'] },
    { name: 'Mint Kiss', src: 'Ref 2 · orb 1', dark: 0, c: ['#a9f5c8', '#d9d2e0', '#f3a6e2', '#f68ce1', '#ffe3f7', '#3fdc96', '#eafff2', '#7debb3', '#6fe6b0', '#fff0fb'] },
    { name: 'Lagoon', src: 'Ref 2 · orb 8', dark: 0, c: ['#2fd3fc', '#1ea4fd', '#3e7dfb', '#7660fc', '#c9bcff', '#c8fbff', '#4fd8ff', '#2a6bff', '#2fb8ff', '#e0fbff'] },
    { name: 'Ember', src: 'Ref 2 · orb 4', dark: 0, c: ['#8502bf', '#b302ad', '#e0157e', '#fc495c', '#ffc6a0', '#3d0b8f', '#ff7a9a', '#6a1bd6', '#ff4f7a', '#ffd2b0'] },
    { name: 'Sorbet', src: 'Ref 2 · orb 3', dark: 0, c: ['#ffa384', '#fe7590', '#f84a9e', '#f732a6', '#ffd1ee', '#ff6a3d', '#ffe0cc', '#ff9a7a', '#ff8fa3', '#fff1e6'] },
    { name: 'Lilac Cream', src: 'Ref 2 · orb 7', dark: 0, c: ['#c9a0f2', '#dcb8e2', '#ecd0cc', '#f9e2b9', '#fffbea', '#9a6de0', '#fff1d8', '#c7a2f7', '#b99cff', '#fffbea'] },
    { name: 'Citrine', src: 'Ref 2 · orb 6', dark: 0, c: ['#f7c36b', '#ef8a4c', '#e6503c', '#ef4f7f', '#ffe2ec', '#ffcf5a', '#fff2b8', '#ff8f4a', '#ffab4a', '#fff6d6'] },
    { name: 'Aurora', src: 'Ref 2 · Energize', dark: 0, c: ['#d4ff5e', '#9df5a0', '#4fe3cf', '#79e6ff', '#f0fffb', '#29c79a', '#f4ffc0', '#b4f26e', '#5ef0c0', '#f8ffd8'] },
    { name: 'Orchid', src: 'Ref 2 · orb 5', dark: 0, c: ['#9ae8a9', '#a9a98c', '#a8687a', '#b86bb3', '#ebb8ff', '#61d79a', '#f3dcff', '#c06cf5', '#c86ef9', '#f3dcff'] },
    { name: 'Nebula', src: 'Ref 2 · orb 2', dark: 0, c: ['#c483ea', '#9a80e6', '#7482ea', '#8ca0f6', '#edf0ff', '#f2a6ff', '#ffd9f6', '#7682ec', '#9b8cff', '#ffe6fb'] },
    { name: 'Rose Noir', src: 'Ref 2 · Rest', dark: 1, c: ['#ffd6e0', '#ff6f8e', '#e8174f', '#6d0a2e', '#140612', '#ff9ec0', '#ff4f7a', '#7a1f5c', '#ff5c8a', '#ffc2d4'] },
  ];
  const CONFETTI = ['#ffd84a', '#ff6f91', '#5fe08f', '#5cc8ff', '#8fb5ff', '#ffa25c', '#c9a2ff', '#ffffff'];

  // Layer mask bits (shader reads them from the row)
  const L = { FILL: 1, RIM: 2, CORE: 4, HALO: 8, ECHO: 16, AURA: 32, ORBS: 64, GLINT: 128, BURST: 256, FLAT: 512, SDF: 1024, HARD: 2048, NOWARP: 4096, OUTLINE: 8192 };
  L.ALL = L.FILL | L.RIM | L.CORE | L.HALO | L.ECHO | L.AURA | L.ORBS | L.GLINT | L.BURST;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const angDist = (a, b) => Math.abs(((((a - b) % TAU) + TAU + Math.PI) % TAU) - Math.PI);

  // Shape DNA: everything random about a spark is decided here, from the seed alone.
  function makeDNA(seed) {
    const r = mulberry32((seed * 2654435761) >>> 0);
    const n = [6, 7, 7, 8, 8, 8, 9][Math.floor(r() * 7)];
    const base = r() * TAU;
    const hero = Math.floor(r() * n);
    const stub = (hero + 1 + Math.floor(r() * (n - 1))) % n;
    const spikes = [];
    for (let i = 0; i < n; i++) {
      const ang = base + (i + (r() - 0.5) * 0.62) * (TAU / n);
      const fat = Math.sqrt(8 / n);
      let len = 0.68 + r() * 0.3, hw = (0.25 + r() * 0.08) * fat;
      const tip = 0.035 + r() * 0.035;
      if (i === hero) { len = 1.05 + r() * 0.2; hw = (0.33 + r() * 0.08) * fat; }
      else if (i === stub && r() < 0.75) { len = 0.5 + r() * 0.08; hw = (0.17 + r() * 0.05) * fat; }
      spikes.push({ ang, len, hw, tip, bend: (r() - 0.5) * 0.22 });
    }
    const orbCount = r() < 0.42 ? 0 : r() < 0.78 ? 1 : 2;
    const orbs = [0, 1].map(() => ({ ang: r() * TAU, dist: 1.3 + r() * 0.55, size: 0.075 + r() * 0.065, speed: (r() < 0.5 ? -1 : 1) * (0.05 + r() * 0.09) }));
    const ba = r() * TAU, bd = 0.05 + r() * 0.1;
    return {
      seed, n, spikes, orbCount, orbs,
      coreR: 0.36 + r() * 0.07, k: 0.08 + r() * 0.05, warp: 0.012 + r() * 0.014,
      blob: { x: Math.cos(ba) * bd, y: Math.sin(ba) * bd, r: 0.27 + r() * 0.1 },
      sheen: r() * TAU, hue: (r() - 0.5) * 0.22, palette: Math.floor(r() * PALETTES.length),
      seedF: 1 + ((seed * 0.6180339887) % 1) * 97,
    };
  }

  // ---------------------------------------------------------------- GLSL
  const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
#define TAU 6.28318530718
#define PI 3.14159265359
uniform sampler2D uData; uniform vec2 uRes; uniform float uDpr, uTime, uNight;
uniform vec3 uPal[120]; uniform vec3 uConf[8];
vec4 D(int k, int id){ return texelFetch(uData, ivec2(k, id), 0); }
float h11(float p){ p = fract(p*.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3. - 2.*f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 3; i++){ s += a*vnoise(p); p = p*2.07 + vec2(17.3, 9.1); a *= .5; } return s/.875; }
float easeOut(float x, float p){ return 1. - pow(1. - clamp(x, 0., 1.), p); }
float spring(float t, float w, float z){ if (t <= 0.) return 0.; float wd = w*sqrt(1. - z*z);
  return 1. - exp(-z*w*t)*(cos(wd*t) + z*w/wd*sin(wd*t)); }
float fallEase(float u){ u = clamp(u, 0., 1.); return u*(.62 + .38*u); }
vec4 over(vec4 a, vec4 b){ return a + b*(1. - a.a); }
vec3 hueRot(vec3 c, float a){
  vec3 yiq = mat3(.299, .596, .211, .587, -.274, -.523, .114, -.322, .312) * c;
  float cs = cos(a), sn = sin(a); yiq.yz = mat2(cs, sn, -sn, cs) * yiq.yz;
  return mat3(1., 1., 1., .956, -.272, -1.106, .621, -.647, 1.703) * yiq; }
vec4 toClip(vec2 pos){ vec2 c = pos / uRes * 2. - 1.; return vec4(c.x, -c.y, 0., 1.); }
`;

  const FS_OUT = `out vec4 frag;\n`;

  // -------- spark body (star + burst + aura), one quad per spark
  const BODY_VS = HEAD + `
out vec2 vP; out float vPx; flat out int vId;
void main(){
  int id = gl_InstanceID; vId = id;
  vec4 d0 = D(0, id), d1 = D(1, id);
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2. - 1.;
  bool live = d1.w > .5 && uTime >= d1.y && (d1.z <= 0. || uTime < d1.z + 1.);
  vP = c * 4.3; vPx = 1. / (d0.z * uDpr);
  gl_Position = live ? toClip(d0.xy + vP * d0.z) : vec4(2., 2., 2., 1.);
}`;

  const BODY_FS = HEAD + FS_OUT + `
in vec2 vP; in float vPx; flat in int vId;
float sdUC(vec2 p, float r1, float r2, float h){
  p.x = abs(p.x); float b = (r1 - r2)/h, a = sqrt(max(1. - b*b, 1e-4)); float k = dot(p, vec2(-b, a));
  if (k < 0.) return length(p) - r1; if (k > a*h) return length(p - vec2(0., h)) - r2; return dot(p, vec2(a, b)) - r1; }
float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.)/k; return min(a, b) - h*h*k*.25; }
vec3 ramp5(vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, float t){
  vec3 c = mix(c0, c1, smoothstep(0., .16, t)); c = mix(c, c2, smoothstep(.16, .36, t));
  c = mix(c, c3, smoothstep(.36, .6, t)); return mix(c, c4, smoothstep(.6, .9, t)); }
void main(){
  int id = vId;
  vec4 d0 = D(0, id), d1 = D(1, id), d2 = D(2, id), d3 = D(3, id), d4 = D(4, id), d5 = D(5, id), d6 = D(6, id), d7 = D(7, id);
  float seed = d0.w, tau = uTime - d1.y;
  int pb = int(d2.z + .5) * 10, mask = int(d7.x + .5);
  bool dark = d7.w > .5;
  float aa = vPx * 1.25;
  vec3 P0 = uPal[pb], P1 = uPal[pb + 1], P2 = uPal[pb + 2], P3 = uPal[pb + 3], P4 = uPal[pb + 4];
  vec3 RIM = uPal[pb + 5], HALO = uPal[pb + 6], AURA = uPal[pb + 7], TRAIL = uPal[pb + 8], ACC = uPal[pb + 9];
  float dk = d1.z > 0. ? clamp((uTime - d1.z)/.9, 0., 1.) : 0.;
  float r = length(vP);

  // landing squash & stretch along the travel direction, then idle breathing
  vec2 tdir = normalize(d0.xy - d2.xy + vec2(1e-4)), tn = vec2(-tdir.y, tdir.x);
  float imp = exp(-tau*6.5) * sin(tau*15. + .5);
  vec2 pl = vec2(dot(vP, tdir), dot(vP, tn)) / vec2(1. + .3*imp, 1. - .16*imp);
  float breathe = 1. + .022*sin(uTime*1.55 + seed*11.);
  vec2 p = (tdir*pl.x + tn*pl.y) / (breathe * (1. - .85*dk*dk));

  // ---- signed distance: core circle smooth-unioned with tapered capsules
  bool noWarp = (mask & 4096) != 0, hard = (mask & 2048) != 0;
  vec2 wq = p*1.6 + seed*7.31;
  vec2 warp = vec2(vnoise(wq + vec2(0., uTime*.13)), vnoise(wq + vec2(5.2, -uTime*.11))) - .5;
  vec2 q = noWarp ? p : p + warp*d3.w*2.;
  float coreNow = d3.y * spring(tau, 20., .45);
  float d = length(q) - coreNow;
  float echo = 0., outl = abs(d);
  int n = int(d3.x + .5);
  for (int i = 0; i < 9; i++){
    if (i >= n) break;
    vec4 s = D(8 + i*2, id), s2 = D(9 + i*2, id);
    float g = spring(tau - s2.y, 13., .34);
    float Ln = s.y * g, gw = clamp(g, 0., 1.25);
    float hw = s.z * (.4 + .6*gw), tip = min(s.w, hw*.9);
    vec2 dir = vec2(cos(s.x), sin(s.x));
    vec2 sp = vec2(dot(q, vec2(-dir.y, dir.x)), dot(q, dir));
    if (!noWarp) sp.x -= s2.x * sp.y * sp.y;
    float ds = sdUC(sp, hw, tip, max(Ln, (hw - tip)*1.05 + .002));
    outl = min(outl, abs(ds));
    d = hard ? min(d, ds) : smin(d, ds, d3.z);
    float bw = hw*.5 + max(sp.y, 0.)*.09;
    echo = max(echo, exp(-abs(sp.x)/bw*1.5) * smoothstep(Ln*.45, Ln*1.02, sp.y) * exp(-max(sp.y - Ln, 0.)/(.55*Ln + .08)));
  }
  float ext = max(d, 0.), inside = smoothstep(aa, -aa, d);
  float heat = exp(-max(tau - .05, 0.)/.26);
  vec4 acc = vec4(0.);
  float shadow = 0.;

  // ---- aura (soft disc, slow drifting density)
  if ((mask & 32) != 0){
    float ain = easeOut((tau - .08)/1.5, 3.);
    float ar = r / (.55 + .45*ain);
    float an = fbm(vP*.55 + vec2(seed*3., uTime*.04));
    float a = smoothstep(3.9, 1.3, ar) * (.75 + .5*an) * (uNight > .5 ? .2 : dark ? .36 : .52) * ain;
    vec3 ac = mix(AURA, HALO, smoothstep(2.2, .6, ar)*(uNight > .5 ? .15 : .35));
    if (uNight < .5 && dark) ac = mix(ac, HALO, .3);
    acc = over(vec4(ac, 1.) * a, acc);
  }
  // ---- halo hugging the silhouette
  if ((mask & 8) != 0){
    float a = (uNight > .5 ? exp(-ext/.22)*.42 : exp(-ext/.38)*.8) * smoothstep(0., .5, tau);
    vec3 hc = uNight > .5 ? mix(mix(RIM, HALO, .4), AURA, smoothstep(.05, .6, ext)*.7) : mix(HALO, AURA, smoothstep(.15, 1.1, ext)*.6);
    acc = over(vec4(hc, 1.) * a, acc);
  }
  // ---- echo beams continuing past each point
  if ((mask & 16) != 0){
    float a = echo * (uNight > .5 ? .32 : .75) * smoothstep(.2, .9, tau);
    acc = over(vec4(mix(vec3(1.), HALO, uNight > .5 ? .25 : .1), 1.) * a, acc);
  }
  // ---- impact: shadow pocket, shock ring, burst rays, needles
  if ((mask & 256) != 0 && tau < 1.3){
    shadow = smoothstep(3.4, .5, r) * .5 * smoothstep(0., .06, tau) * (1. - smoothstep(.2, 1.1, tau));
    float su = clamp(tau/.55, 0., 1.);
    float rr = .3 + 2.6*easeOut(su, 3.), rw = .16*(1. - su) + .04;
    float rn = vnoise(normalize(vP + 1e-4)*2.5 + seed) - .5;
    float ring = exp(-pow((r - rr + rn*.12)/rw, 2.)) * pow(1. - su, 2.) * .17;
    acc = over(vec4(mix(vec3(1.), HALO, su), 1.) * ring, acc);
    vec4 rays = vec4(0.);
    int bm = int(d7.y + .5);
    for (int j = 0; j < 26; j++){
      float fj = float(j); bool needle = j >= 18;
      float hA = h11(seed*13.7 + fj*1.37), hB = h11(seed*7.13 + fj*3.11), hC = h11(seed*3.37 + fj*5.71), hD = h11(seed*9.91 + fj*7.3), hE = h11(seed*1.93 + fj*2.9);
      bool lead = j < n;
      float ang = needle ? (fj - 18. + hA)/8.*TAU + seed*5. : lead ? D(8 + j*2, id).x + (hA - .5)*.12 : (fj + hA*.85)/18.*TAU + seed*2.;
      float del = needle ? hB*.03 : .015 + hB*.07;
      float dur = needle ? .26 + hC*.16 : .48 + hC*.38;
      float u = (tau - del)/dur;
      if (u <= 0. || u >= 1.) continue;
      float len = needle ? .9 + hD*.9 : lead ? 1.7 + hD*1.1 : 1.1 + hD*1.5;
      float r0 = needle ? .1 : lead ? .15 + hE*.15 : .2 + hE*.42;
      float head = r0 + len*easeOut(u, 4.), tail = r0 + len*pow(u, 1.6)*.93;
      vec2 dir = vec2(cos(ang), sin(ang));
      float al = dot(vP, dir), ac = abs(dot(vP, vec2(-dir.y, dir.x)));
      float s = (al - tail)/max(head - tail, 1e-3);
      float wmax = needle ? .014 : lead ? .085 + hA*.04 : .05 + hA*.05;
      float w = wmax * pow(clamp(4.*s*(1. - s), 0., 1.), .55) * (1. - u*.55);
      float cov = smoothstep(aa + .01, -aa, ac - w) * step(0., s) * step(s, 1.);
      float dseg = length(vec2(max(max(tail - al, al - head), 0.), ac));
      float glow = exp(-dseg/(needle ? .03 : .07)) * .35;
      vec3 rc;
      if (needle) rc = vec3(1.);
      else if (bm == 0 || (bm == 2 && hE > .45)) rc = uConf[int(hA*7.99)];
      else { int k = int(hB*4.99); rc = k == 0 ? RIM : k == 1 ? P1 : k == 2 ? HALO : k == 3 ? AURA : TRAIL; }
      rc = mix(vec3(1.), rc, smoothstep(.02, .16, u));
      float fade = pow(1. - u, 1.5);
      rays = over(vec4(rc, 1.) * clamp(cov + glow, 0., 1.) * fade, rays);
    }
    acc = over(rays, acc);
  }
  // ---- star body: flowing gradient ramp + off-centre core + rim line
  if ((mask & 512) != 0){
    acc = over(vec4(uNight > .5 ? vec3(.93, .94, 1.) : vec3(.16, .13, .3), 1.) * inside, acc);
  } else if ((mask & 7) != 0){
    float depth = clamp(-d/.34, 0., 1.);
    float fl = fbm(p*1.05 + vec2(seed*3.1, uTime*.07)) - .5;
    float t = clamp(depth + fl*.3 + dot(p, vec2(cos(d7.z), sin(d7.z)))*.1, 0., 1.);
    if (dark) t *= .8;
    vec3 fill = (mask & 1) != 0 ? ramp5(P0, P1, P2, P3, P4, t) : mix(P2, P3, .5);
    if ((mask & 4) != 0){
      vec2 co = p - d4.xy;
      float cb = length(co) - d4.z*(dark ? 1. : .72)*spring(tau - (dark ? .25 : .08), 9., .6) + (fbm(co*1.8 + seed*5.) - .5)*(dark ? .14 : .26);
      fill = mix(fill, P4, dark ? smoothstep(.1, -.14, cb) : smoothstep(.16, -.2, cb)*.85);
    }
    if ((mask & 2) != 0) fill = mix(fill, RIM, exp(min(d, 0.)/.035) * .9);
    fill = mix(fill, vec3(1.), heat);
    if (uNight > .5) fill *= .86;
    acc = over(vec4(fill, 1.) * inside, acc);
  }
  if ((mask & 2) != 0 && (mask & 512) == 0){
    float a = exp(-ext/.045) * (1. - inside) * (uNight > .5 ? .8 : .95);
    acc = over(vec4(mix(mix(RIM, HALO, smoothstep(0., .1, ext)*.7), vec3(1.), heat), 1.) * a, acc);
  }
  // ---- impact flash
  if ((mask & 256) != 0 && tau < .6){
    float fr = .52*easeOut(tau/.05, 2.);
    float disc = smoothstep(fr + .05, fr - .05, r) * exp(-tau/.14);
    float fg = exp(-r/(.45 + tau*3.5)) * exp(-tau/.09) * .9;
    acc = over(vec4(1.) * clamp(disc + fg, 0., 1.), acc);
  }
  // ---- satellite orbs
  if ((mask & 64) != 0){
    for (int k = 0; k < 2; k++){
      if (float(k) >= d4.w) break;
      vec4 o = k == 0 ? d5 : d6;
      float e = clamp((tau - .35 - .15*float(k))/.8, 0., 1.);
      float em = e - 1.; float eb = 1. + 2.2*em*em*em + 1.2*em*em;
      float ang = o.x + uTime*o.w;
      vec2 op = vec2(cos(ang), sin(ang)) * o.y * eb + vec2(0., sin(uTime*.9 + o.x*3.)*.04);
      float od = length(vP - op);
      float core = smoothstep(o.z + aa, o.z*.15, od), og = exp(-od/(o.z*1.5))*.4;
      float a = clamp(core + og, 0., 1.) * smoothstep(0., .25, e);
      acc = over(vec4(mix(mix(ACC, HALO, .5), vec3(1.), core*.8), 1.) * a, acc);
    }
  }
  // ---- idle glint on a random tip
  if ((mask & 128) != 0 && tau > 1.4){
    float per = 2.6 + h11(seed*3.3)*2.2, gt = uTime + seed*17.;
    float gi = floor(gt/per), gu = (gt - gi*per)/.7;
    if (gu < 1.){
      int si = int(h11(gi*1.37 + seed) * float(n));
      vec4 s = D(8 + si*2, id);
      vec2 g = vP - vec2(cos(s.x), sin(s.x)) * s.y * .92 * breathe;
      float env = sin(PI*gu); env *= env;
      float cr = exp(-abs(g.x)/.012)*exp(-abs(g.y)/.2) + exp(-abs(g.y)/.012)*exp(-abs(g.x)/.2);
      acc = over(vec4(1.) * clamp((cr*.8 + exp(-length(g)/.035))*env, 0., 1.), acc);
    }
  }
  // ---- debug views
  if ((mask & 1024) != 0){
    vec3 col = d > 0. ? vec3(.95, .55, .78) : vec3(.45, .62, 1.);
    col *= 1. - exp(-5.*abs(d));
    col *= .72 + .28*cos(70.*d);
    col = mix(col, vec3(1.), 1. - smoothstep(0., aa*2., abs(d)));
    acc = vec4(col, 1.) * smoothstep(2.45, 2.05, r);
  }
  if ((mask & 8192) != 0){
    float ol = 1. - smoothstep(0., aa*1.6, outl);
    acc = over(vec4(uNight > .5 ? vec3(.62, .74, 1.) : vec3(.35, .28, .85), 1.) * ol * .95, acc);
  }
  acc *= 1. - dk;
  acc.rgb = hueRot(acc.rgb, d2.w);
  frag = vec4(acc.rgb, uNight > .5 ? shadow*(1. - dk) : acc.a);
}`;

  // -------- trail (falling phase), one quad spanning the flight path
  const TRAIL_VS = HEAD + `
out vec2 vQ; flat out int vId;
void main(){
  int id = gl_InstanceID; vId = id;
  vec4 d0 = D(0, id), d1 = D(1, id), d2 = D(2, id);
  bool live = d1.w > .5 && d1.y > d1.x && uTime > d1.x - .02 && uTime < d1.y + .8;
  vec2 S = d2.xy; float R = d0.z;
  vec2 dv = d0.xy - S; float Lt = length(dv); vec2 dir = dv/max(Lt, 1e-3), nr = vec2(-dir.y, dir.x);
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vQ = vec2(mix(-R*1.3, Lt + R*1.3, c.x), (c.y*2. - 1.) * R * 1.35);
  gl_Position = live ? toClip(S + dir*vQ.x + nr*vQ.y) : vec4(2., 2., 2., 1.);
}`;

  const TRAIL_FS = HEAD + FS_OUT + `
in vec2 vQ; flat in int vId;
void main(){
  int id = vId;
  vec4 d0 = D(0, id), d1 = D(1, id), d2 = D(2, id);
  float R = d0.z, seed = d0.w;
  int pb = int(d2.z + .5) * 10;
  vec3 TRAIL = uPal[pb + 8], HALO = uPal[pb + 6], RIM = uPal[pb + 5];
  float Lt = length(d0.xy - d2.xy), T = d1.y - d1.x;
  float u = clamp((uTime - d1.x)/T, 0., 1.);
  float sHead = Lt*fallEase(u), Lmax = min(R*10., Lt*.8);
  float sTail = max(sHead - Lmax, 0.), post = uTime - d1.y, fade = 1.;
  if (post > 0.){ sTail = mix(max(Lt - Lmax, 0.), Lt, easeOut(post/.42, 2.5)); fade = 1. - smoothstep(.05, .45, post); }
  float along = vQ.x, ac = abs(vQ.y);
  float v = (sHead - along)/max(sHead - sTail, 1.), vc = clamp(v, 0., 1.);
  float w = R*mix(.07, .8, pow(vc, .7));
  float ends = smoothstep(-.015, .03, v) * smoothstep(1., .7, v);
  float gn = vnoise(vec2(along/(R*2.2) + seed*9., ac/(R*.07)));
  float gn2 = vnoise(vec2(along/(R*.5), ac/(R*.03)) + 31.);
  float beam = exp(-pow(ac/w, 2.)*2.) * pow(1. - vc, .95) * ends * (.55 + .55*gn) * (.8 + .4*gn2);
  float atmo = exp(-ac/(w*1.6 + R*.1)) * pow(1. - vc, 1.4) * ends * .22;
  float core = exp(-pow(ac/(R*(.03 + .05*vc)), 2.)) * exp(-vc*4.) * ends;
  vec3 tc = uNight > .5 ? TRAIL : mix(TRAIL, RIM, .35);
  vec3 bcol = mix(mix(vec3(1.), HALO, .5), tc, smoothstep(0., .3, vc));
  vec4 acc = vec4(tc, 1.) * clamp(atmo, 0., 1.);
  acc = over(vec4(bcol, 1.) * clamp(beam*(uNight > .5 ? .95 : .8), 0., 1.), acc);
  acc = over(vec4(1.) * clamp(core*.95, 0., 1.), acc);
  if (post < .02){
    vec2 dh = (vQ - vec2(sHead, 0.))/R; float hd = length(dh);
    if (hd < 1.2){
      float hi = smoothstep(0., .06, u);
      float glow = exp(-hd/.16)*.9 + smoothstep(.085, .05, hd);
      float ca = uTime*3. + seed;
      vec2 rd = mat2(cos(ca), sin(ca), -sin(ca), cos(ca)) * dh;
      float fl = exp(-abs(rd.x)/.018)*exp(-abs(rd.y)/.42) + exp(-abs(rd.y)/.018)*exp(-abs(rd.x)/.42);
      vec4 mr = vec4(0.);
      for (int j = 0; j < 6; j++){
        float fj = float(j), a = fj/6.*TAU + uTime*1.3 + seed*3.;
        vec2 dir = vec2(cos(a), sin(a));
        float al = dot(dh, dir), acr = abs(dot(dh, vec2(-dir.y, dir.x)));
        float s = (al - .1)/.32;
        float wv = .03*pow(clamp(4.*s*(1. - s), 0., 1.), .6);
        float cov = smoothstep(.012, -.004, acr - wv) * step(0., s) * step(s, 1.);
        mr = over(vec4(uConf[j], 1.) * cov * (.6 + .4*sin(uTime*23. + fj*2.1)), mr);
      }
      acc = over(vec4(1.) * clamp(glow + fl*.7, 0., 1.) * hi, over(mr*hi, acc));
    }
  }
  acc *= fade;
  acc.rgb = hueRot(acc.rgb, d2.w);
  frag = vec4(acc.rgb, uNight > .5 ? 0. : acc.a);
}`;

  // -------- particles: impact debris, lingering glitter, trail dust
  const PART_VS = HEAD + `
uniform int uP;
out vec2 vL; out vec4 vCol; out vec3 vShape; flat out int vType; flat out float vHue;
void main(){
  int sid = gl_InstanceID / uP, j = gl_InstanceID - sid*uP;
  vec4 d0 = D(0, sid), d1 = D(1, sid), d2 = D(2, sid), d7 = D(7, sid);
  float R = d0.z, seed = d0.w, tau = uTime - d1.y, fj = float(j);
  float h1 = h11(seed*3.1 + fj*1.71), h2 = h11(seed*5.7 + fj*2.33), h3 = h11(seed*1.3 + fj*3.97),
        h4 = h11(seed*8.9 + fj*5.03), h5 = h11(seed*2.2 + fj*6.11), h6 = h11(seed*6.6 + fj*7.77);
  vec2 Dst = d0.xy, S = d2.xy, tdir = normalize(Dst - S + 1e-4);
  int pb = int(d2.z + .5) * 10;
  int mask = int(d7.x + .5);
  bool ok = d1.w > .5 && (d1.z <= 0. || uTime < d1.z + .3) && (mask & 256) != 0;
  vec2 pos = Dst, vdir = vec2(1., 0.); float hl = 0., hw = 1., alpha = 0.; vec3 col = vec3(1.); int type = 0;
  float sc = max(R/42., .6);
  if (j < 22){
    float a0 = h1 < .4 ? atan(-tdir.y, -tdir.x) + (h2 - .5)*1.7 : h2*TAU;
    float v0 = R*(3.5 + h3*7.), kd = 3.4, t = max(tau - h6*.04, 0.);
    float dist = v0/kd*(1. - exp(-kd*t)), spd = v0*exp(-kd*t);
    float a = a0 + (h4 - .5)*2.4*(1. - exp(-2.5*t));
    vdir = vec2(cos(a), sin(a));
    pos = Dst + vdir*(R*(.25 + h5*.2) + dist) + vec2(0., R*.35*t*t);
    float lifeT = .5 + h5*.65;
    alpha = 1. - smoothstep(lifeT*.4, lifeT, t);
    hl = clamp(spd*.045, 1., R*.38)*.5; hw = mix(.35, .95, h1)*sc;
    col = uNight > .5 ? (h2 < .7 ? vec3(1.) : mix(vec3(1.), uConf[int(h3*7.99)], .6)) : mix(uPal[pb + 8], uPal[pb + 5], h2);
    ok = ok && tau > h6*.04 && t < lifeT;
  } else if (j < 30){
    type = 1;
    float tb = .18 + h1*.7, lifeT = 1.1 + h2*1.5, t = tau - tb, a = h3*TAU;
    pos = Dst + vec2(cos(a), sin(a))*R*(1.15 + h4*1.7) + vec2(0., -R*.18*max(t, 0.));
    float env = sin(PI*clamp(t/lifeT, 0., 1.));
    alpha = env*env*(.55 + .45*sin(t*17. + h5*6.));
    hw = mix(.8, 1.6, h5)*sc;
    col = uNight > .5 ? mix(vec3(1.), uConf[int(h6*7.99)], .25) : uPal[pb + 5];
    ok = ok && t > 0. && t < lifeT;
  } else {
    type = 2;
    float T = d1.y - d1.x, tb = d1.x + T*(.1 + .9*h1), age = uTime - tb, lifeT = .35 + h2*.65;
    vec2 hp = S + tdir*length(Dst - S)*fallEase((tb - d1.x)/max(T, 1e-3));
    vec2 nr = vec2(-tdir.y, tdir.x);
    pos = hp + nr*(h3 - .5)*R*.5 + nr*sign(h3 - .5)*R*(.3 + h4*.9)*age - tdir*R*.6*age;
    vdir = tdir;
    alpha = (1. - age/lifeT)*(.6 + .4*sin(age*30. + h5*6.));
    hl = R*.03; hw = mix(.5, 1.2, h4)*sc;
    col = mix(vec3(1.), uPal[pb + 8], uNight > .5 ? h5*.7 : 1.);
    ok = ok && T > 0. && age > 0. && age < lifeT;
  }
  float g = type == 1 ? hw*9. : hw*3. + 1.;
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1))*2. - 1.;
  vL = vec2(c.x*(hl + g), c.y*(hw + g));
  vShape = vec3(hl, hw, g); vCol = vec4(col, 1.)*clamp(alpha, 0., 1.); vType = type; vHue = d2.w;
  vec2 nr = vec2(-vdir.y, vdir.x);
  gl_Position = ok && alpha > 0. ? toClip(pos + vdir*vL.x + nr*vL.y) : vec4(2., 2., 2., 1.);
}`;

  const PART_FS = HEAD + FS_OUT + `
in vec2 vL; in vec4 vCol; in vec3 vShape; flat in int vType; flat in float vHue;
void main(){
  float d = length(vec2(max(abs(vL.x) - vShape.x, 0.), vL.y)) - vShape.y;
  float a = smoothstep(.8, -.8, d) + exp(-max(d, 0.)/(vShape.y*1.5 + .8))*.45;
  if (vType == 1){
    float w = vShape.y*.5, l = vShape.z*.45;
    a = max(a, exp(-abs(vL.x)/w)*exp(-abs(vL.y)/l) + exp(-abs(vL.y)/w)*exp(-abs(vL.x)/l));
  }
  vec4 c = vCol*clamp(a, 0., 1.);
  c.rgb = hueRot(c.rgb, vHue);
  frag = vec4(c.rgb, uNight > .5 ? 0. : c.a);
}`;

  // -------- full-screen passes
  const FULL_VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p*2. - 1., 0., 1.); }`;

  const BG_FS = HEAD + FS_OUT + `
uniform vec2 uResPx;
void main(){
  vec2 uv = gl_FragCoord.xy/uResPx, px = gl_FragCoord.xy/uDpr;
  vec3 col;
  if (uNight > .5){
    vec3 top = vec3(.010, .026, .080), mid = vec3(.020, .068, .150), bot = vec3(.034, .160, .215);
    col = mix(bot, mid, smoothstep(0., .55, uv.y));
    col = mix(col, top, smoothstep(.45, 1., uv.y));
    float nb = fbm(uv*vec2(2.2, 1.4) + vec2(3.1, uTime*.004));
    col += vec3(.06, .025, .1) * smoothstep(.45, .85, nb) * .9;
    for (int l = 0; l < 2; l++){
      float cs = l == 0 ? 54. : 23.;
      vec2 g = px/cs, gi = floor(g), gf = fract(g);
      float hh = h12(gi + float(l)*17.);
      if (hh > (l == 0 ? .55 : .8)){
        vec2 sp = vec2(h12(gi + 3.1), h12(gi + 7.7))*.8 + .1;
        float dd = length((gf - sp)*cs);
        float tw = .65 + .35*sin(uTime*(1. + hh*3.) + hh*40.);
        float sz = l == 0 ? .9 + hh*.7 : .6;
        col += vec3(.75, .85, 1.) * (l == 0 ? .8 : .35) * tw * (smoothstep(sz, 0., dd) + exp(-dd/(sz*1.6))*.25);
      }
    }
  } else {
    col = vec3(.958, .953, .985);
    float vg = length((uv - .5)*vec2(uResPx.x/uResPx.y, 1.));
    col -= vec3(.03, .035, .01) * smoothstep(.3, 1.2, vg);
    col += (vnoise(px*.9) - .5)*.012 + (vnoise(px*.08 + 4.) - .5)*.02;
  }
  frag = vec4(col, 1.);
}`;

  const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uThresh;
out vec4 frag;
void main(){
  vec2 uv = gl_FragCoord.xy * uTexel * 2.;
  vec2 o = uTexel;
  vec3 c = (texture(uSrc, uv + vec2(-o.x, -o.y)).rgb + texture(uSrc, uv + vec2(o.x, -o.y)).rgb +
            texture(uSrc, uv + vec2(-o.x, o.y)).rgb + texture(uSrc, uv + vec2(o.x, o.y)).rgb) * .25;
  if (uThresh > 0.){ float l = max(c.r, max(c.g, c.b)); c *= smoothstep(uThresh, uThresh + .5, l); }
  frag = vec4(c, 1.);
}`;

  const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uOff;
out vec4 frag;
void main(){
  vec2 uv = gl_FragCoord.xy * uTexel; vec2 o = uTexel*(uOff + .5);
  frag = vec4((texture(uSrc, uv + vec2(-o.x, -o.y)).rgb + texture(uSrc, uv + vec2(o.x, -o.y)).rgb +
               texture(uSrc, uv + vec2(-o.x, o.y)).rgb + texture(uSrc, uv + vec2(o.x, o.y)).rgb) * .25, 1.);
}`;

  const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene, uBloom; uniform vec2 uTexel; uniform float uBloomStr, uNight, uTime, uGrain;
out vec4 frag;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
void main(){
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 c = texture(uScene, uv).rgb;
  if (uNight > .5){
    c += texture(uBloom, uv).rgb * uBloomStr;
    float k = .72; vec3 x = max(c - k, 0.);
    c = min(c, vec3(k)) + (1. - k)*tanh(x/(1. - k));
  }
  float fr = floor(uTime*24.);
  float g = h12(gl_FragCoord.xy + fr*vec2(37.1, 91.7)) - .5;
  c += g*uGrain*(uNight > .5 ? 1. : .7);
  c += (h12(gl_FragCoord.yx*1.3 + fr) - .5)/255.;
  frag = vec4(clamp(c, 0., 1.), 1.);
}`;

  // ---------------------------------------------------------------- engine
  function compile(gl, vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error(log);
        throw new Error('Shader compile failed: ' + log);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link failed: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  const PAL_FLAT = new Float32Array(PALETTES.flatMap((pl) => pl.c.flatMap(hex)));
  const CONF_FLAT = new Float32Array(CONFETTI.flatMap(hex));
  const PARTS = 56;

  class SparkEngine {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.o = Object.assign({ bloom: true, night: true, max: 64, dprCap: 2, bloomStr: 0.5, grain: 0.035 }, opts);
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.gl = gl;
      this.hdr = !!gl.getExtension('EXT_color_buffer_float');
      this.progs = {
        bg: compile(gl, FULL_VS, BG_FS), body: compile(gl, BODY_VS, BODY_FS), trail: compile(gl, TRAIL_VS, TRAIL_FS),
        part: compile(gl, PART_VS, PART_FS), down: compile(gl, FULL_VS, DOWN_FS), blur: compile(gl, FULL_VS, BLUR_FS), comp: compile(gl, FULL_VS, COMP_FS),
      };
      this.vao = gl.createVertexArray();
      this.data = new Float32Array(ROW * 4 * this.o.max);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROW, this.o.max, 0, gl.RGBA, gl.FLOAT, this.data);
      this.slots = new Array(this.o.max).fill(null);
      this.dirty = true; this.time = 0; this.w = 0; this.h = 0; this.targets = null;
    }
    get night() { return this.o.night; }
    set night(v) { this.o.night = v; }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, this.o.dprCap);
      const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
      const W = Math.max(1, Math.round(cw * dpr)), H = Math.max(1, Math.round(ch * dpr));
      this.cssW = cw; this.cssH = ch; this.dpr = dpr;
      if (W === this.w && H === this.h && this.targets) return;
      this.canvas.width = W; this.canvas.height = H; this.w = W; this.h = H;
      const gl = this.gl;
      if (this.targets) for (const t of Object.values(this.targets)) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      const mk = (w, h) => {
        const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, this.hdr ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return { tex, fb, w, h };
      };
      const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1), qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2);
      this.targets = { scene: mk(W, H), half: mk(hw, hh), qa: mk(qw, qh), qb: mk(qw, qh) };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ---- spark management
    _write(i, s) {
      const b = i * ROW * 4, d = this.data;
      d.fill(0, b, b + ROW * 4);
      const set = (k, a, bb, c, e) => { d[b + k * 4] = a; d[b + k * 4 + 1] = bb; d[b + k * 4 + 2] = c; d[b + k * 4 + 3] = e; };
      const dna = s.dna;
      set(0, s.x, s.y, s.R, dna.seedF);
      set(1, s.tStart, s.tImpact, s.tDeath || 0, 1);
      set(2, s.from.x, s.from.y, s.palette, s.hue);
      set(3, dna.n, dna.coreR, dna.k, dna.warp);
      set(4, dna.blob.x, dna.blob.y, dna.blob.r, s.orbs ?? dna.orbCount);
      dna.orbs.forEach((o, k) => set(5 + k, o.ang, o.dist, o.size, o.speed));
      set(7, s.mask, s.burstMode, dna.sheen, PALETTES[s.palette].dark);
      const travel = Math.atan2(s.y - s.from.y, s.x - s.from.x);
      dna.spikes.forEach((sp, k) => {
        set(8 + k * 2, sp.ang, sp.len, sp.hw, sp.tip);
        set(9 + k * 2, sp.bend, 0.03 + 0.11 * (angDist(sp.ang, travel) / Math.PI) + ((k * 0.37) % 1) * 0.02, 0, 0);
      });
      this.dirty = true;
    }
    add(opts) {
      const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
      const dna = makeDNA(seed);
      const s = Object.assign({ R: 40, mask: L.ALL, burstMode: 2, tStart: -100, tImpact: -99 }, opts, { dna, seed });
      s.palette = opts.palette ?? dna.palette;
      s.hue = opts.hue ?? dna.hue;
      if (!s.from) s.from = { x: s.x - 0.5 * s.R, y: s.y - 6 * s.R };
      let i = this.slots.indexOf(null);
      if (i < 0) { i = this._oldest(); }
      this.slots[i] = s; s.slot = i;
      this._write(i, s);
      return s;
    }
    _oldest() { let best = 0, bt = Infinity; this.slots.forEach((s, i) => { if (s && s.tImpact < bt) { bt = s.tImpact; best = i; } }); return best; }
    update(s, patch) { Object.assign(s, patch); if (patch.seed !== undefined) s.dna = makeDNA(patch.seed); this._write(s.slot, s); }
    kill(s, at = this.time) { if (!s || this.slots[s.slot] !== s) return; s.tDeath = at; this._write(s.slot, s); }
    remove(s) { if (!s || this.slots[s.slot] !== s) return; this.slots[s.slot] = null; const b = s.slot * ROW * 4; this.data.fill(0, b, b + ROW * 4); this.dirty = true; }
    clear() { this.slots.fill(null); this.data.fill(0); this.dirty = true; }
    live() { return this.slots.filter(Boolean); }
    gc() { for (const s of this.slots) if (s && s.tDeath && this.time > s.tDeath + 1.2) this.remove(s); }

    // ---- frame
    render(time) {
      if (time !== undefined) this.time = time;
      this.resize();
      this.gc();
      const gl = this.gl, P = this.progs, T = this.targets;
      if (this.dirty) {
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, this.o.max, gl.RGBA, gl.FLOAT, this.data);
        this.dirty = false;
      }
      let used = 0; this.slots.forEach((s, i) => { if (s) used = i + 1; });
      const night = this.o.night ? 1 : 0;
      gl.bindVertexArray(this.vao);
      const common = (pr) => {
        gl.useProgram(pr.p);
        if (pr.u.uData) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(pr.u.uData, 0); }
        if (pr.u.uRes) gl.uniform2f(pr.u.uRes, this.cssW, this.cssH);
        if (pr.u.uDpr) gl.uniform1f(pr.u.uDpr, this.dpr);
        if (pr.u.uTime) gl.uniform1f(pr.u.uTime, this.time);
        if (pr.u.uNight) gl.uniform1f(pr.u.uNight, night);
        if (pr.u.uPal) gl.uniform3fv(pr.u.uPal, PAL_FLAT);
        if (pr.u.uConf) gl.uniform3fv(pr.u.uConf, CONF_FLAT);
      };
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fb);
      gl.viewport(0, 0, this.w, this.h);
      gl.disable(gl.BLEND);
      common(P.bg); gl.uniform2f(P.bg.u.uResPx, this.w, this.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (used) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        common(P.trail); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, used);
        common(P.body); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, used);
        common(P.part); gl.uniform1i(P.part.u.uP, PARTS); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, used * PARTS);
        gl.disable(gl.BLEND);
      }
      const bloom = this.o.bloom && night;
      if (bloom) {
        const pass = (pr, dst, src, setup) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h); gl.useProgram(pr.p);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(pr.u.uSrc, 0);
          setup(pr); gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        pass(P.down, T.half, T.scene, (pr) => { gl.uniform2f(pr.u.uTexel, 1 / T.half.w / 2, 1 / T.half.h / 2); gl.uniform1f(pr.u.uThresh, 0.6); });
        pass(P.down, T.qa, T.half, (pr) => { gl.uniform2f(pr.u.uTexel, 1 / T.qa.w / 2, 1 / T.qa.h / 2); gl.uniform1f(pr.u.uThresh, 0); });
        let a = T.qa, b = T.qb;
        for (const off of [0, 1, 2, 3]) { pass(P.blur, b, a, (pr) => { gl.uniform2f(pr.u.uTexel, 1 / a.w, 1 / a.h); gl.uniform1f(pr.u.uOff, off); }); [a, b] = [b, a]; }
        this._bloomTex = a;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.w, this.h);
      const C = P.comp; gl.useProgram(C.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.scene.tex); gl.uniform1i(C.u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloom ? this._bloomTex.tex : T.scene.tex); gl.uniform1i(C.u.uBloom, 1);
      gl.uniform2f(C.u.uTexel, 1 / this.w, 1 / this.h);
      gl.uniform1f(C.u.uBloomStr, bloom ? this.o.bloomStr : 0);
      gl.uniform1f(C.u.uNight, night); gl.uniform1f(C.u.uTime, this.time); gl.uniform1f(C.u.uGrain, this.o.grain);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  SparkEngine.PALETTES = PALETTES;
  SparkEngine.CONFETTI = CONFETTI;
  SparkEngine.LAYERS = L;
  SparkEngine.makeDNA = makeDNA;
  window.SparkEngine = SparkEngine;
})();
