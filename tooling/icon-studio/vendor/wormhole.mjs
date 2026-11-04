// Extracted from the user-supplied Wormhole Dust(1).html. See SOURCE.json.

// VibeField · Wormhole Dust — inlined by draft/wormhole/build.mjs. Source: draft/wormhole/src.
globalThis.__MARK_WGSL__ = "// VibeField mark — the loop over its field, in one fragment.\n//\n// Back to front: ground (the well · the flat field · dots · solid · none) → registration plates →\n// the loop (two strands, \"/\" and \"\\\", over/under at the crossing) → glint → post\n// (vignette, grain) → frame mask (squircle, macOS inset, circle).\n//\n// The JS side owns time: every animated quantity arrives here as a PHASE, never a clock,\n// so a paused frame, an exported frame and a seamless loop are the same code path.\n// `struct U` is generated from mark.js LAYOUT (its only source) and prepended at load.\n\n@group(0) @binding(0) var<uniform> u: U;\n\nconst PI: f32 = 3.14159265358979;\nconst TAU: f32 = 6.28318530717959;\nconst NCOARSE: i32 = 24; // coarse samples per strand; mark.js COARSE must match\n\n@vertex\nfn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {\n  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));\n  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);\n}\n\n// ---------------------------------------------------------------- hashing & noise\n\nfn pcg(v: u32) -> u32 {\n  let s = v * 747796405u + 2891336453u;\n  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;\n  return (w >> 22u) ^ w;\n}\n\nfn h1(n: u32) -> f32 {\n  return f32(pcg(n)) * (1.0 / 4294967296.0);\n}\n\nfn h2(i: vec2i, seed: u32) -> f32 {\n  return h1((bitcast<u32>(i.x) * 1597334677u) ^ pcg(bitcast<u32>(i.y) ^ seed));\n}\n\n// Value noise in [-1, 1].\nfn vnoise(p: vec2f, seed: u32) -> f32 {\n  let fl = floor(p);\n  let i = vec2i(fl);\n  let f = p - fl;\n  let w = f * f * (3.0 - 2.0 * f);\n  let a = h2(i, seed);\n  let b = h2(i + vec2i(1, 0), seed);\n  let c = h2(i + vec2i(0, 1), seed);\n  let d = h2(i + vec2i(1, 1), seed);\n  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 2.0 - 1.0;\n}\n\n// 1-D value noise periodic in x with an integer period, in [-1, 1].\nfn pnoise(x: f32, period: f32, seed: u32) -> f32 {\n  let fl = floor(x);\n  let f = x - fl;\n  let w = f * f * (3.0 - 2.0 * f);\n  let pr = max(period, 1.0);\n  let ia = fl - pr * floor(fl / pr);\n  let ib = (ia + 1.0) - pr * floor((ia + 1.0) / pr);\n  let k = seed * 2654435761u;\n  let a = h1(u32(ia) ^ k);\n  let b = h1(u32(ib) ^ k);\n  return mix(a, b, w) * 2.0 - 1.0;\n}\n\n// The same, with its slope: (value, d value / dx). The rings measure how fast their strips run\n// from it — smooth from pixel to pixel, where fwidth() changes per 2×2 quad.\nfn pnoiseD(x: f32, period: f32, seed: u32) -> vec2f {\n  let fl = floor(x);\n  let f = x - fl;\n  let w = f * f * (3.0 - 2.0 * f);\n  let pr = max(period, 1.0);\n  let ia = fl - pr * floor(fl / pr);\n  let ib = (ia + 1.0) - pr * floor((ia + 1.0) / pr);\n  let k = seed * 2654435761u;\n  let a = h1(u32(ia) ^ k);\n  let b = h1(u32(ib) ^ k);\n  return vec2f(mix(a, b, w) * 2.0 - 1.0, (b - a) * 12.0 * f * (1.0 - f));\n}\n\n// 2-D value noise periodic in both axes with integer periods, in [-1, 1].\nfn pnoise2(p: vec2f, period: vec2f, seed: u32) -> f32 {\n  let fl = floor(p);\n  let f = p - fl;\n  let w = f * f * (3.0 - 2.0 * f);\n  let pr = max(period, vec2f(1.0));\n  let i0 = fl - pr * floor(fl / pr);\n  let i1 = (i0 + 1.0) - pr * floor((i0 + 1.0) / pr);\n  let a = h2(vec2i(i32(i0.x), i32(i0.y)), seed);\n  let b = h2(vec2i(i32(i1.x), i32(i0.y)), seed);\n  let c = h2(vec2i(i32(i0.x), i32(i1.y)), seed);\n  let d = h2(vec2i(i32(i1.x), i32(i1.y)), seed);\n  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 2.0 - 1.0;\n}\n\n// Three octaves of it, in [-1, 1]; the periods double with the frequency, so it stays periodic.\nfn pfbm(p: vec2f, period: vec2f, seed: u32) -> f32 {\n  return (pnoise2(p, period, seed) + 0.5 * pnoise2(p * 2.0, period * 2.0, seed + 1u) + 0.25 * pnoise2(p * 4.0, period * 4.0, seed + 2u)) / 1.75;\n}\n\n// ---------------------------------------------------------------- colour\n\nfn linToSrgb(c: vec3f) -> vec3f {\n  let x = clamp(c, vec3f(0.0), vec3f(1.0));\n  let lo = x * 12.92;\n  let hi = 1.055 * pow(max(x, vec3f(1e-7)), vec3f(1.0 / 2.4)) - 0.055;\n  return select(hi, lo, x <= vec3f(0.0031308));\n}\n\nfn oklabToLinear(c: vec3f) -> vec3f {\n  let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;\n  let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;\n  let s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;\n  let l = l_ * l_ * l_;\n  let m = m_ * m_ * m_;\n  let s = s_ * s_ * s_;\n  return vec3f(\n    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,\n    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,\n    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,\n  );\n}\n\n// OKLab → gamma-encoded sRGB. Palette stops arrive already in OKLab (mark.js), so\n// wedges mix perceptually and only the final colour is converted.\nfn oklabToSrgb(c: vec3f) -> vec3f {\n  return linToSrgb(oklabToLinear(c));\n}\n\nfn palLab(x: f32) -> vec3f {\n  let n = max(i32(u.palC.x + 0.5), 1);\n  let y = fract(x) * f32(n);\n  let fy = floor(y);\n  let i = i32(fy) % n;\n  let sh = clamp(u.palB.z, 0.0, 0.98);\n  let f = smoothstep(0.5 * sh, 1.0 - 0.5 * sh, y - fy);\n  return mix(u.pal[i].xyz, u.pal[(i + 1) % n].xyz, f);\n}\n\n// How much of a seam x sits on: the seams are halfway between stops, where one colour field\n// gives way to the next. A Gaussian `u.seam.y` stops wide, widened (and dimmed, so its energy\n// stays) by the pixel footprint `fw` so seams that converge on the singularity melt into a\n// glow instead of aliasing. It lights only where the colour really changes, so a stop repeated\n// to widen its field has no seam inside it.\nfn palSeam(x: f32, fw: f32) -> f32 {\n  let n = max(i32(u.palC.x + 0.5), 1);\n  let y = fract(x) * f32(n);\n  let fy = floor(y);\n  let i = i32(fy) % n;\n  let d = y - fy - 0.5;\n  let w = max(u.seam.y, 1e-3);\n  let we = sqrt(w * w + 0.25 * fw * fw);\n  let dc = length(u.pal[i].xyz - u.pal[(i + 1) % n].xyz);\n  return (w / we) * exp(-(d * d) / (we * we)) * smoothstep(0.015, 0.08, dc);\n}\n\n// ---------------------------------------------------------------- filtered lines\n\n// Integral of a unit pulse train (1 on [0, d) of every period).\nfn stripeI(x: f32, d: f32) -> f32 {\n  return floor(x) * d + min(fract(x), d);\n}\n\n// Box-filtered pulse train: exact average over the pixel footprint `fw` (in periods).\n// Lines denser than pixels dissolve to their mean instead of aliasing.\nfn stripe(x: f32, fw: f32, d: f32) -> f32 {\n  return (stripeI(x + 0.5 * fw, d) - stripeI(x - 0.5 * fw, d)) / fw;\n}\n\n// One box pulse of width `w` centred at 0, box-filtered over `fw`.\nfn pulse1(x: f32, fw: f32, w: f32) -> f32 {\n  let a = clamp(x + 0.5 * fw, -0.5 * w, 0.5 * w);\n  let b = clamp(x - 0.5 * fw, -0.5 * w, 0.5 * w);\n  return (a - b) / max(fw, 1e-5);\n}\n\n// ---------------------------------------------------------------- the field\n\n// Both grounds reduce to the same numbers per pixel: the field ANGLE (lines and wedges ride\n// it; its branch cuts jump by whole turns, so everything drawn from it is seamless), a\n// POTENTIAL (→ −∞ at the singularity; inner colours and pulses ride it), the size of one\n// pixel in each (the line filter), and — for the well — how deep the pixel sees and how the\n// wall there is lit. The two gradients, per pixel, are what the dust needs to draw a particle\n// round on the screen whatever the field's shape there (the angle's steps over its cut).\nstruct Coords {\n  ang: f32,\n  pn: f32,\n  fa: f32,\n  fp: f32,\n  fog: f32,\n  lit: f32,\n  ga: vec2f,\n  gp: vec2f,\n};\n\n// The flat field: point charges at the crossing and the loop's two foci, plus `swirl` ×\n// the potential (log spirals). With like charges at the foci the loop is (nearly) their\n// critical equipotential.\nfn chargeCoords(p: vec2f, px: f32) -> Coords {\n  let f = u.law.w;\n  let q0 = u.law.x;\n  let qL = u.law.y;\n  let qR = u.law.z;\n  let d0 = p;\n  let dL = p + vec2f(f, 0.0);\n  let dR = p - vec2f(f, 0.0);\n  let r0 = dot(d0, d0) + 1e-9;\n  let rL = dot(dL, dL) + 1e-9;\n  let rR = dot(dR, dR) + 1e-9;\n  let th = q0 * atan2(d0.y, d0.x) + qL * atan2(dL.y, dL.x) + qR * atan2(dR.y, dR.x);\n  let pot = 0.5 * (q0 * log(r0) + qL * log(rL) + qR * log(rR));\n  let qs = max(abs(q0) + abs(qL) + abs(qR), 1.0);\n  let sw = u.flow.x;\n  let gth = q0 * vec2f(-d0.y, d0.x) / r0 + qL * vec2f(-dL.y, dL.x) / rL + qR * vec2f(-dR.y, dR.x) / rR;\n  let gpo = q0 * d0 / r0 + qL * dL / rL + qR * dR / rR;\n  return Coords(th + sw * pot + u.flow.y, pot / qs, length(gth + sw * gpo) * px, length(gpo) / qs * px, 0.0, 1.0, (gth + sw * gpo) * px, gpo / qs * px);\n}\n\n// The well's wall radius at depth D below the rim: throat + depth·D^−power.\nfn wellR(D: f32) -> f32 {\n  return u.well.y + u.well.x * pow(max(D, 1e-5), -u.well.z);\n}\n\n// How much the throat's cross-section is flattened at depth D (0 at the rim).\nfn wellSquash(D: f32) -> f32 {\n  return 1.0 + u.wellLook.w * (1.0 - exp(-D / 0.6));\n}\n\n// The well: a gravity well seen from above its rim. The camera is tilted and its lens is\n// shifted so the throat's vanishing point — the singularity — sits on the loop's crossing;\n// the wall's meridians are the lines, so they run in from the rim and curve as they sink.\n// Frame dragging (well.w) twists them with depth. Every loop here has a fixed count and no\n// break, so the derivatives below stay in uniform control flow.\nfn wellCoords(p: vec2f) -> Coords {\n  let w = p * u.camR.w + vec2f(u.camU.w, u.camF.w);\n  let d = normalize(u.camF.xyz + w.x * u.camR.xyz + w.y * u.camU.xyz);\n  let o = u.camPos.xyz;\n  let dz = min(d.z, -1e-5);\n  // first crossing of |xy| = R(D), marched geometrically in depth, then bisected\n  var lo = 0.0;\n  var hi = 0.0;\n  var found = 0.0;\n  var prev = 0.0;\n  var D = 2e-3;\n  for (var i = 0; i < 34; i++) {\n    let xy = o.xy + ((o.z + D) / -dz) * d.xy;\n    let g = length(vec2f(xy.x, xy.y * wellSquash(D))) - wellR(D);\n    let crossed = step(0.0, g) * (1.0 - found);\n    lo = mix(lo, prev, crossed);\n    hi = mix(hi, D, crossed);\n    found = max(found, crossed);\n    prev = D;\n    D = D * 1.55;\n  }\n  for (var i = 0; i < 12; i++) {\n    let mid = 0.5 * (lo + hi);\n    let xy = o.xy + ((o.z + mid) / -dz) * d.xy;\n    let above = length(vec2f(xy.x, xy.y * wellSquash(mid))) - wellR(mid) > 0.0;\n    hi = select(hi, mid, above);\n    lo = select(mid, lo, above);\n  }\n  let hit = found > 0.5;\n  let Dh = select(1e7, hi, hit); // no hit: the throat, seen to infinity\n  let pos = o + ((o.z + Dh) / -dz) * d;\n  let twist = u.well.w * log(1.0 + Dh);\n  let sy = pos.y * wellSquash(Dh); // meridians are spaced evenly round the flattened section\n  let ang = atan2(sy, pos.x) + twist + u.flow.y;\n  let ang2 = atan2(-sy, -pos.x) + PI + twist + u.flow.y; // same angle, cut on the other side\n  let pn = log(max(wellR(Dh), 1e-7));\n  // the inner face's normal: toward the axis and up the wall\n  let rho = max(length(pos.xy), 1e-6);\n  let slope = u.well.z * u.well.x * pow(max(Dh, 1e-5), -u.well.z - 1.0);\n  let n = normalize(vec3f(-pos.xy / rho, slope));\n  let la = u.wellLook.z;\n  let L = normalize(vec3f(cos(la) * 0.7, sin(la) * 0.7, 0.72));\n  let lit = mix(1.0, 0.5 + 0.75 * max(dot(n, L), 0.0), u.wellLook.y);\n  let fog = select(1.0, 1.0 - exp(-u.wellLook.x * log(1.0 + Dh)), hit);\n  let fa1 = fwidth(ang);\n  let fa2 = fwidth(ang2);\n  // The gradients (the dust draws its particles through them) come from the root refined once\n  // more, by one Newton step from the bracket's far end: 12 halvings leave the depth noisy by\n  // ~1e-4 from pixel to pixel — ~5 % of a pixel's step, invisible on a strip, but it speckled a\n  // large particle's edge — and the wall is smooth enough there for one step to make it exact.\n  let de = 1e-3 * hi;\n  let xh = o.xy + ((o.z + hi) / -dz) * d.xy;\n  let xm = o.xy + ((o.z + hi - de) / -dz) * d.xy;\n  let gh = length(vec2f(xh.x, xh.y * wellSquash(hi))) - wellR(hi);\n  let gm = length(vec2f(xm.x, xm.y * wellSquash(hi - de))) - wellR(hi - de);\n  let Df = select(1e7, hi - gh * de / max(gh - gm, 1e-20), hit);\n  let pf = o + ((o.z + Df) / -dz) * d;\n  let tf = u.well.w * log(1.0 + Df);\n  let sf = pf.y * wellSquash(Df);\n  let af = atan2(sf, pf.x) + tf;\n  let af2 = atan2(-sf, -pf.x) + PI + tf;\n  let ga = select(vec2f(dpdx(af2), dpdy(af2)), vec2f(dpdx(af), dpdy(af)), fwidth(af) <= fwidth(af2));\n  let pnf = log(max(wellR(Df), 1e-7));\n  return Coords(ang, pn, min(fa1, fa2), fwidth(pn), fog, lit, ga, vec2f(dpdx(pnf), dpdy(pnf)));\n}\n\n// Where a point sits in the palette (in cycles) for one ARRANGEMENT of it: the angle, the\n// irregularity, the lobes — turned by `rot` cycles, with the arrangement's own irregularity\n// seed. Without rising colour there is one arrangement, turned by nothing.\nfn fieldX(up: f32, inside: f32, rot: f32, seedAdd: u32) -> f32 {\n  let seed = u32(u.palB.w + 0.5) + seedAdd;\n  let nf = max(floor(u.palC.w + 0.5), 1.0);\n  let nz = pnoise(up * nf, nf, seed) + 0.5 * pnoise(up * nf * 2.0, nf * 2.0, seed + 11u);\n  return up * u.palA.x + u.palA.y * nz + inside * u.lobe.x + rot;\n}\n\n// The palette's colour at palette position x: the inner and outer colours, the luminous seams.\nfn fieldLab(x: f32, rp: f32, fws: f32, mk: f32) -> vec3f {\n  // inner colours may run lighter (the reference's bright core); palC.z = inner light\n  var inner = palLab(x + u.palA.w);\n  inner = vec3f(mix(inner.x, 1.0, u.palC.z), inner.yz * (1.0 - 0.7 * u.palC.z));\n  var lab = mix(inner, palLab(x), rp);\n  // luminous seams: where two colour fields meet, the edge breathes light — each seam's own\n  // colours lifted, or a seam ink (gold, say) laid into it\n  if (u.seam.x > 0.0) {\n    let sa = clamp(u.seam.x * mix(palSeam(x + u.palA.w, fws), palSeam(x, fws), rp), 0.0, 1.0);\n    let lifted = vec3f(min(lab.x + 0.28 * (1.0 - lab.x) + 0.06, 0.98), lab.yz * 1.3);\n    let metal = vec3f(clamp(u.seamC.x * mix(1.0, mk, 0.6), 0.0, 1.0), u.seamC.yz * mix(1.0, mk, 0.3));\n    lab = mix(lab, mix(lifted, metal, u.seam.w), sa);\n  }\n  return lab;\n}\n\n// ---------------------------------------------------------------- rings\n//\n// Dense strips of colour like Saturn's rings (round 10, James's references of 2026-10-08), laid\n// the way his interstellar-drive colour tuner lays them (voyagerstudios/new-mechanic,\n// src/math/pattern.ts): a strip row there is octaves of sin² whose phase wanders on value noise\n// — each octave ×2.31 the frequency and ×0.45 the weight — raised to a sharpness, coloured by a\n// gradient and lifted by a brightness. Here the strips lie on the black hole. s counts turns of\n// the palette: rings·(pn − flow) + arms·up, so arms 0 lays rings round the singularity, more\n// winds them into spirals, and rings 0 runs them along the rays; x = N·s counts the coarsest\n// strips. Every octave and every noise has whole cells per turn of the palette, and arms is\n// whole, so the angle's branch cut, the flow's wrap and a loop are all seamless. Where strips\n// crowd into the singularity they fade to their mean, octave by octave, as the lines do.\n\nstruct Rings {\n  lin: vec3f, // the strips' light, linear — before the hairlines and the shine\n  hair: f32, // the hairlines' cover\n  lab: vec3f, // the palette's colour under the strips (for tone-on-tone lines)\n  I: f32, // the strips' intensity (the tuner's, 0–1)\n  // where the pixel lies, for the dust: s in turns of the palette, one pixel of it, the depth\n  // flowing and standing, and how fast the depth runs against the well's own (d depth / d pn)\n  s: f32,\n  fs: f32,\n  depth: f32,\n  gabs: f32,\n  dg: f32,\n};\n\n// The tuner's light at s: octaves of sin², the phase wandering on value noise (≈ a cell every\n// three strips, ±10 rad at irregularity 1), each faded to its mean before it beats the\n// footprint `fs` (a pixel's, or a particle's) — measured where the wandering phase crowds the\n// strips, from the noise's own slope — then the divisions. xw is the coarsest octave's own\n// (wandering) coordinate, its troughs at whole numbers; fxw how many strips of it the\n// footprint spans. `quick` (the dust's particles) skips the noise of an octave the footprint\n// averages away for certain — it adds exactly the mean that octave would have faded to.\nstruct RingLight {\n  I: f32,\n  xw: f32,\n  fxw: f32,\n};\n\nfn ringLight(s: f32, fs: f32, N: f32, seed: u32, quick: bool) -> RingLight {\n  let x = N * s;\n  let fx = N * fs;\n  var acc = 0.0;\n  var tot = 0.0;\n  var amp = 1.0;\n  var f = 1.0;\n  var xw = x;\n  var fxw = fx;\n  for (var i = 0u; i < 7u; i++) {\n    // (octaves past the detail add nothing: stop there)\n    if (f32(i) + 0.5 >= u.stripB.x) {\n      break;\n    }\n    let ni = max(round(N * f), 1.0);\n    if (quick && i > 0u && fs * ni >= 0.5) {\n      acc += amp * 0.5;\n      tot += amp;\n      amp *= 0.45;\n      f *= 2.31;\n      continue;\n    }\n    let cells = max(round(0.314 * ni), 1.0);\n    let pn = pnoiseD(s * cells, cells, seed + 11u * i + 1u);\n    let ph = u.stripB.w * 10.0 * pn.x;\n    let v = sin(PI * s * ni + ph);\n    let lf = fs * (ni + abs(u.stripB.w * 10.0 * pn.y * cells) / PI);\n    acc += amp * mix(v * v, 0.5, smoothstep(0.2, 0.5, lf));\n    tot += amp;\n    xw = select(xw, x + ph / PI, i == 0u);\n    fxw = select(fxw, lf, i == 0u);\n    amp *= 0.45;\n    f *= 2.31;\n  }\n  var I = pow(clamp(acc / max(tot, 1e-4), 0.0, 1.0), u.stripB.y);\n\n  // divisions: cells of four strips, a seeded share of them holding a dark gap (Cassini's)\n  if (u.stripD.y > 0.0) {\n    let g = 0.25 * x;\n    let kg = floor(g);\n    let per = 0.25 * N;\n    let hk = u32(kg - per * floor(kg / per)) * 2654435761u + seed;\n    let on = step(h1(hk ^ 0x9E37u), u.stripD.y);\n    let og = 4.0 * (0.3 + 0.4 * h1(hk ^ 0x85EBu));\n    let wg = 0.4 + 1.2 * h1(hk ^ 0xC2B2u);\n    let cut = on * pulse1(4.0 * (g - kg) - og, fx, wg);\n    I = I * mix(1.0 - 0.94 * cut, 1.0 - 0.94 * 0.25 * u.stripD.y, smoothstep(1.0, 3.0, fx));\n  }\n  return RingLight(I, xw, fxw);\n}\n\n// The brightest strips burn toward white (`shine`) instead of clipping to a hue.\nfn luminous(lin: vec3f, shine: f32) -> vec3f {\n  let m = max(max(lin.r, lin.g), max(lin.b, 1e-6));\n  let hue = lin / max(m, 1.0);\n  return mix(hue, vec3f(1.0), shine * (1.0 - exp(-1.5 * max(m - 1.0, 0.0))));\n}\n\n// The colour run (round 11): a strip's place in the palette waves along its length and the\n// waves run along it — round the turn on rings (K whole waves, so the angle's branch cut is\n// seamless), out along the depth on rays (as long as round the turn), mixed by how the strips\n// lie (u.runA.w). Strip k has its own offset and its own pace: a whole number of waves per\n// period of the run's clock (u.runB.x = τ in [0, 1)), so a loop closes on every strip.\nfn runWave(k: f32, up: f32, g: f32, seed: u32) -> f32 {\n  let h = u32(k) * 2246822519u + seed;\n  let pace = 1.0 + u.runB.z * (2.0 * h1(h ^ 0x7F4Bu) - 1.0);\n  let ph = fract(round(u.runB.y * pace) * u.runB.x) - h1(h ^ 0xA341u);\n  let w0 = sin(TAU * (u.runA.y * up - ph));\n  let w1 = sin(TAU * (u.runA.z * g - ph));\n  return mix(w0, w1, u.runA.w);\n}\n\nfn rings(c: Coords, up: f32) -> Rings {\n  let N = max(u.stripA.x, 4.0); // coarsest strips per turn of the palette (a multiple of 4)\n  let arms = u.stripA.y;\n  let rad = u.stripA.z;\n  let seed = u32(u.stripC.w + 0.5) * 7919u;\n  // the spacing: γ = 0 lays the rings evenly in the well's own depth (ln r), so they crowd into\n  // the singularity; γ > 0 evens them toward the wall's radius, (e^γ·pn − 1)/γ, like a disc\n  let gam = u.stripF.x;\n  let even = gam > 1e-3;\n  let dg = select(1.0, exp(gam * c.pn), even);\n  let gabs = select(c.pn, (dg - 1.0) / max(gam, 1e-3), even);\n  let depth = gabs - u.stripA.w;\n  // the wobble: each ring wanders across its width along its length — K wanders round the\n  // turn, and along the depth a whole number per turn of the palette\n  let K = max(u.stripC.y, 1.0);\n  let Pc = select(4096.0, max(round(1.6 / max(rad, 1e-4)), 1.0), rad > 1e-4);\n  let Md = select(1.6, Pc * rad, rad > 1e-4);\n  let wq = vec2f(up * K, depth * Md);\n  let wob = u.stripC.z * pnoise2(wq, vec2f(K, Pc), seed + 3u);\n  let s = rad * depth + arms * up + wob / N;\n  let x = N * s;\n  // one pixel, in turns of the palette and in strips (c.fa and c.fp already step over the cut)\n  let fs = length(vec2f(rad * dg * c.fp, arms * c.fa / TAU)) * u.flow.z;\n  let fx = N * fs;\n\n  // the tuner's strips, and Cassini's divisions between them\n  let light = ringLight(s, fs, N, seed, false);\n  let I = light.I;\n  let xw = light.xw;\n  let fxw = light.fxw;\n\n  // hairlines: a seeded share of the strips carries a thin bright line, coming and going along\n  // its length\n  var hair = 0.0;\n  if (u.stripD.x > 0.0) {\n    let kh = floor(x);\n    let hk = u32(kh - N * floor(kh / N)) * 2246822519u + seed;\n    let on = step(h1(hk ^ 0x27D4u), u.stripD.x);\n    let oh = 0.2 + 0.6 * h1(hk ^ 0x1656u);\n    let wh = 0.05 + 0.1 * h1(hk ^ 0xB5E3u);\n    let along = smoothstep(-0.3, 0.3, pnoise2(2.0 * wq + vec2f(37.0 * h1(hk), 0.0), vec2f(2.0 * K, 2.0 * Pc), seed + 5u));\n    hair = on * along * pulse1(x - kh - oh, fx, wh);\n    hair = mix(hair, u.stripD.x * 0.05, smoothstep(0.5, 2.0, fx));\n  }\n\n  // each strip its own colour and light: cells between the coarsest octave's troughs, each with\n  // a seeded offset over neighbouring stops and a seeded brightness, changing in the dark\n  // between strips — antialiased over the pixel, and gone to their mean where the strips are\n  // finer than the pixels\n  let yc = xw - 0.5;\n  let kc = floor(yc);\n  let wc = smoothstep(0.5 - clamp(0.5 * fxw, 0.01, 0.5), 0.5 + clamp(0.5 * fxw, 0.01, 0.5), yc - kc);\n  let ka = kc - N * floor(kc / N);\n  let kb = (ka + 1.0) - N * floor((ka + 1.0) / N);\n  let ha = u32(ka) * 2654435761u + seed;\n  let hb = u32(kb) * 2654435761u + seed;\n  // (a strip gives its own colour back as it narrows to a pixel: the wandering phase squeezes\n  // some strips that far even away from the singularity, and random colours there are noise)\n  let own = 1.0 - smoothstep(0.3, 1.0, fxw);\n  let lite = own * (mix(h1(ha ^ 0x68E3u), h1(hb ^ 0x68E3u), wc) - 0.5);\n\n  // colour: the palette across the strips, each strip scattered over its neighbouring stops.\n  // Everything here blends COLOURS, never places in the palette — the two strips' colours at\n  // their boundary, and the scattered colour with the plain one as the strips narrow: a place\n  // that slides sweeps every stop in between through a pixel or two, and with a wide scatter\n  // over hard stops that showed as dashes and teeth. Where the stops shrink under a few pixels\n  // (at the singularity, or a whole icon at 32 px), their mean.\n  let npal = max(floor(u.palC.x + 0.5), 1.0);\n  let sc = u.stripC.x / npal;\n  // the colour run moves each strip's place along its length (it fades with the strip's own\n  // colour as the strips narrow, before its waves could crowd a pixel)\n  var ra = 0.0;\n  var rb = 0.0;\n  if (u.runA.x > 0.0) {\n    ra = u.runA.x * runWave(ka, up, gabs, seed) / npal;\n    rb = u.runA.x * runWave(kb, up, gabs, seed) / npal;\n  }\n  let mine = mix(palLab(s + sc * (h1(ha ^ 0x5BD1u) - 0.5) + ra), palLab(s + sc * (h1(hb ^ 0x5BD1u) - 0.5) + rb), wc);\n  var lab = mix(palLab(s), mine, own);\n  lab = mix(lab, u.stripM.xyz, smoothstep(0.35, 0.9, fs * npal));\n  lab = vec3f(lab.x, lab.yz * u.palC.y);\n  // the tuner's light: colour × (brightness × intensity), in gamma space — so ^2.2 in light —\n  // above a coloured floor, the intensity taken relative to its mean (0.5^sharpness, all a\n  // filtered strip leaves), so brightness 1 is the palette as designed on average: the tuner's\n  // road was lit, a field is not. The brightest strips burn to white.\n  let k = u.stripB.z * mix(u.stripE.w, 1.0, I / pow(0.5, u.stripB.y)) * (1.0 + 2.0 * u.stripM.w * lite);\n  let lin = max(oklabToLinear(lab), vec3f(0.0)) * pow(k, 2.2);\n  return Rings(lin, hair, lab, I, s, fs, depth, gabs, dg);\n}\n\n// ---------------------------------------------------------------- dust\n//\n// The strips made of particles (round 12, James's references of 2026-10-08: dotted arcs, glitter\n// and soft bokeh round a black hole). The particles live in a grid that rides the strips: ROWS\n// across them (x = rows·s, so a row follows its strip's curve, its wobble and its flow) and\n// CELLS along them — round the turn where the strips lie as rings or spirals, out along the\n// depth where they lie as rays. A cell holds at most one particle, seeded: whether it is there,\n// where in the cell, how big, how bright, what colour. A particle is round on the screen whatever\n// the grid's shape there (the grid's Jacobian, from the field's own gradients, maps it), never\n// smaller than a pixel (a tiny one dims instead, so motion cannot alias it), and lit by the\n// strips' own light at its centre — the same octaves, as sharp as a pixel shows them — in its\n// strip's colour, give or take its own glitter. The strips' continuous light stays under the dots as a\n// gas. Where the cells shrink under the pixels (into the singularity, or a whole icon at 32 px)\n// the particles melt into their mean. Rows come in whole numbers per turn of the palette and\n// cells in whole numbers per turn (or per wrap of the flow), each row moves along by whole\n// periods of its cells per period of the clock, so the cut, the flow's wrap and a loop close.\n\n// One particle near the pixel: its weight here (cover × energy), its seed, where its centre\n// lies across (in rows), and its radius on the screen (px).\nstruct Grain {\n  w: f32,\n  h: u32,\n  x: f32,\n  r: f32,\n};\n\n// A particle's light: the strips' light at its centre (as sharp as a pixel can show it, so a\n// particle on a bright strip burns and one in a gap stays dark),\n// coloured like its strip — the strip's own place in the palette and its colour run — moved by\n// its own glitter, lifted toward a light tint of its colour, with its own sparkle and twinkle.\nfn grainLight(g: Grain, rg: Rings, up: f32, fs: f32) -> vec3f {\n  let N = max(u.stripA.x, 4.0);\n  let seed = u32(u.stripC.w + 0.5) * 7919u;\n  let sp = g.x / u.dustA.x;\n  let L = ringLight(sp, fs, N, seed, true);\n  let kc = floor(L.xw - 0.5);\n  let ka = kc - N * floor(kc / N);\n  let ha = u32(ka) * 2654435761u + seed;\n  let npal = max(floor(u.palC.x + 0.5), 1.0);\n  var place = sp + (u.stripC.x / npal) * (h1(ha ^ 0x5BD1u) - 0.5) + u.dustE.x * (h1(g.h ^ 0x4E1Bu) - 0.5) / npal;\n  if (u.runA.x > 0.0) {\n    place += u.runA.x * runWave(ka, up, rg.gabs, seed) / npal;\n  }\n  let pl = palLab(place);\n  let lab = vec3f(mix(pl.x, max(pl.x, 0.8), u.dustE.y), pl.yz * u.palC.y);\n  // its light as the strip's (in the dark gaps too, by `lift`), each strip its own\n  let rel = mix(L.I / pow(0.5, u.stripB.y), 1.0, u.dustD.w);\n  let k = u.stripB.z * mix(u.stripE.w, 1.0, rel) * (1.0 + 2.0 * u.stripM.w * (h1(ha ^ 0x68E3u) - 0.5));\n  // sparkle: a heavy tail of bright ones, the mean kept at 1\n  let hs = h1(g.h ^ 0x7A3Du);\n  let spark = (1.0 + 12.0 * u.dustD.y * pow(hs, 12.0)) / (1.0 + 12.0 / 13.0 * u.dustD.y);\n  // twinkle: whole cycles per period of the clock (so loops close), the mean kept at 1\n  var tw = 1.0;\n  if (u.dustF.x > 0.0) {\n    let n = round(u.dustF.y * (0.5 + h1(g.h ^ 0x1F2Eu)));\n    let wv = 0.5 + 0.5 * sin(TAU * (fract(n * u.runB.x) + h1(g.h ^ 0x6B8Cu)));\n    tw = 1.0 + u.dustF.x * (wv * wv * wv / 0.3125 - 1.0);\n  }\n  return max(oklabToLinear(lab), vec3f(0.0)) * (u.dustD.x * pow(k, 2.2) * spark * tw);\n}\n\nfn dust(c: Coords, up: f32, rg: Rings, gas: f32) -> vec3f {\n  let Np = u.dustA.x; // rows per turn of the palette\n  let Ma = u.dustA.y; // cells per turn (rings) or per unit of depth (rays)\n  let Pa = u.dustA.z; // cells before the seeds repeat along a row\n  let ray = u.dustB.x > 0.5;\n  let rad = u.stripA.z;\n  let arms = u.stripA.y;\n  let seed = u32(u.dustC.w + 0.5) * 2654435761u + 0x2F1Du;\n\n  // the grid on the screen: how fast the rows and the cells go by, per pixel (the strips' wobble\n  // bends the rows but barely turns them, so it stays out of these)\n  let gx = Np * (rad * rg.dg * c.gp + (arms / TAU) * c.ga);\n  let ga = select((Ma / TAU) * c.ga, (Ma * rg.dg) * c.gp, ray);\n  let dt = gx.x * ga.y - gx.y * ga.x;\n  let det = select(dt, 1e-12, abs(dt) < 1e-12);\n  let ex = 1.0 / max(length(gx), 1e-6); // px from row to row\n  let ea = 1.0 / max(length(ga), 1e-6); // px from cell to cell along\n  let cell = inverseSqrt(abs(det)); // a cell's size, px\n  let nA = gx * ex; // across the strips, unit\n  let nT = vec2f(-nA.y, nA.x); // along them\n  // a particle stays inside its neighbouring cells: its kernel spans under 0.9 of a cell in\n  // both coordinates (a streak, drawn out along the strip, only as far as that allows)\n  let rLim = 0.9 / max(length(gx), length(ga));\n  // one pixel in turns of the palette, from those gradients too: the pixel's own footprint\n  // (fwidth of the depth) is noisy from pixel to pixel, and a particle lit through it flickers\n  // across its own disc\n  let fsp = length(gx) / Np * u.flow.z;\n  let gaA = dot(ga, nA);\n  let gaT = max(abs(dot(ga, nT)), 1e-6);\n  let reach = max(rLim, 0.9 / gaT); // no kernel reaches further, px\n  // the particles are drawn where a cell spans a few pixels; below that, their mean (a\n  // particle squeezed into a smaller cell is a pixel of speckle, and shimmers as it moves)\n  let res = smoothstep(1.6, 3.0, min(ex, ea));\n\n  var parts = vec3f(0.0);\n  if (res > 0.0) {\n    let xp = Np * rg.s;\n    let ap = Ma * select(up, rg.depth, ray);\n    let k0 = floor(xp);\n    var g1 = Grain(0.0, 0u, 0.0, 0.0);\n    var g2 = Grain(0.0, 0u, 0.0, 0.0);\n    for (var di = -1; di <= 1; di++) {\n      let kr = k0 + f32(di);\n      let km = kr - Np * floor(kr / Np);\n      let hr = u32(km) * 2246822519u + seed;\n      // each row starts its cells at its own offset (or the places line up across the rows) and\n      // travels along at its own pace: whole periods of its cells per period of the clock\n      // (u.runB.x = τ in [0, 1))\n      let pace = 1.0 + u.dustE.w * (2.0 * h1(hr ^ 0x51EDu) - 1.0);\n      let ar = ap - h1(hr ^ 0x0F3Cu) - Pa * fract(round(u.dustE.z * pace) * u.runB.x);\n      let j0 = floor(ar);\n      for (var dj = -1; dj <= 1; dj++) {\n        let jr = j0 + f32(dj);\n        let jm = jr - Pa * floor(jr / Pa);\n        let h = pcg(hr ^ (u32(jm) * 3266489917u + 0x165667B1u));\n        if (h1(h) >= u.dustB.w) {\n          continue;\n        }\n        let cx = kr + 0.5 + u.dustC.x * (h1(h ^ 0x1B56u) - 0.5);\n        let dx = cx - xp;\n        let da = jr + 0.5 + u.dustC.y * (h1(h ^ 0x2C9Au) - 0.5) - ar;\n        // the cell offset back on the screen: the grid's Jacobian, inverted\n        let d = vec2f(ga.y * dx - gx.y * da, gx.x * da - ga.x * dx) / det;\n        if (dot(d, d) >= reach * reach) {\n          continue;\n        }\n        let r = 0.5 * u.dustB.y * cell * exp(u.dustB.z * (2.0 * h1(h ^ 0x3D4Fu) - 1.0));\n        let RA = min(1.7320508 * max(r, 1.1), rLim);\n        let RT = min(RA * (1.0 + u.dustC.z), sqrt(max(0.81 - (RA * gaA) * (RA * gaA), 0.0)) / gaT);\n        let qa = dot(d, nA) / RA;\n        let qt = dot(d, nT) / RT;\n        let q2 = qa * qa + qt * qt;\n        if (q2 >= 1.0) {\n          continue;\n        }\n        // (1 − q²)³ ≈ exp(−3q²) with compact support; a particle under a pixel keeps its\n        // energy by dimming, (r / the drawn radius)²\n        let q = 1.0 - q2;\n        let re = RA / 1.7320508;\n        let w = q * q * q * min(r * r / (re * re), 1.0);\n        let gr = Grain(w, h, cx, r);\n        if (w > g1.w) {\n          g2 = g1;\n          g1 = gr;\n        } else if (w > g2.w) {\n          g2 = gr;\n        }\n      }\n    }\n    // the two that cover the pixel most (particles rarely overlap more)\n    if (g1.w > 0.0) {\n      parts += g1.w * grainLight(g1, rg, up, fsp);\n    }\n    if (g2.w > 0.0) {\n      parts += g2.w * grainLight(g2, rg, up, fsp);\n    }\n  }\n\n  // their mean: the strips' light here, as the particles take it, × the share of a cell that\n  // particles cover on average (u.dustF.z, from their fill and sizes) — counting only what a\n  // particle can show: its core burns to white, so a bright one shows less than its light (the\n  // kernel's light capped at 1 on its brightest channel: P/4 below 1, else 1 − ¾·P^−⅓, in\n  // kernel areas). Averaged over what spreads the particles' light: the sparkle, and the\n  // strips themselves — a particle samples the coarsest octave sharp, a sin² about the local\n  // mean (its share of the octaves' weight), where the pixel here has already averaged it.\n  var mean = vec3f(0.0);\n  if (res < 1.0) {\n    let tint = vec3f(mix(rg.lab.x, max(rg.lab.x, 0.8), u.dustE.y), rg.lab.yz);\n    let cl = max(oklabToLinear(tint), vec3f(0.0));\n    let cmax = max(max(cl.r, cl.g), max(cl.b, 1e-4));\n    let c0 = pow(clamp(rg.I, 0.0, 1.0), 1.0 / u.stripB.y);\n    let w0 = 0.55 / (1.0 - pow(0.45, max(u.stripB.x, 1.0)));\n    var lit = 0.0;\n    var shown = 0.0;\n    for (var j = 0; j < 4; j++) {\n      let sn = sin(PI * (f32(j) + 0.5) / 8.0);\n      let acc = clamp(c0 + w0 * (sn * sn - 0.5), 0.0, 1.0);\n      let rel = mix(pow(acc, u.stripB.y) / pow(0.5, u.stripB.y), 1.0, u.dustD.w);\n      let P = u.dustD.x * pow(u.stripB.z * mix(u.stripE.w, 1.0, rel), 2.2);\n      lit += P;\n      for (var i = 0; i < 8; i++) {\n        let hs = (f32(i) + 0.5) / 8.0;\n        let x = P * cmax * (1.0 + 12.0 * u.dustD.y * pow(hs, 12.0)) / (1.0 + 12.0 / 13.0 * u.dustD.y);\n        shown += select(0.25 * x, 1.0 - 0.75 * pow(x, -1.0 / 3.0), x > 1.0);\n      }\n    }\n    // shown is in kernel areas per particle (×¼ of the light at P/4): back to light, per cell\n    mean = cl * (u.dustF.z * (lit / 4.0) * (shown / 32.0) / max(0.25 * cmax * lit / 4.0, 1e-6));\n  }\n  return gas * rg.lin + mix(mean, parts, res);\n}\n\n// Paints either ground from its coordinates: OKLab wedges that ride the angle (or the rings),\n// inner and outer colours along each line, filtered fine lines, pulses along the potential,\n// accent hairlines, light at the singularity, the well's throat and photon ring, the lobes.\nfn paint(c: Coords, p: vec2f, inside: f32) -> vec3f {\n  // metal is a behaviour, not a colour: metal inks brighten on the side facing the light and\n  // go to bronze away from it (seam.z = metal sheen; the band's own light direction)\n  let mk = select(1.0, 1.0 + u.seam.z * 0.55 * cos(atan2(p.y, p.x + 1e-9) - u.light.y), u.seam.z > 0.0);\n  let up = (c.ang + u.palA.z) / TAU;\n  let rp = smoothstep(u.palB.x - u.palB.y, u.palB.x + u.palB.y, c.pn);\n  let fws = c.fa / TAU * u.palA.x * max(u.palC.x, 1.0) * u.flow.z;\n  var lab: vec3f;\n  var col: vec3f;\n  if (u.stripD.w > 0.5) {\n    let r = rings(c, up);\n    lab = r.lab;\n    var lin = r.lin;\n    var hair = r.hair;\n    if (u.dustA.w > 0.5) {\n      // the gas (and its hairlines) may thin out toward the rim, leaving the dust on black\n      let thin = mix(1.0, u.dustF.w, smoothstep(-1.0, 0.1, c.pn));\n      lin = dust(c, up, r, u.dustD.z * thin);\n      hair = hair * thin;\n    }\n    // the hairlines over the strips (or the dust); the brightest burn to white\n    lin = mix(lin, max(u.stripE.xyz, lin), hair);\n    col = linToSrgb(luminous(lin, u.stripD.z));\n  } else if (u.rise.x > 0.5) {\n    // Rising colour, as a FLOW along each ray. The rays keep their place and their crisp edges;\n    // what moves is their colour: s = pn·spacing − phase counts steps along the line, and each\n    // step hands every ray on to the palette's NEXT stop — a smooth blend between two copies of\n    // the wedges one stop apart. A shift by exactly one stop maps every wedge boundary onto\n    // another, so the seams stay put and only colour flows: out of the singularity as the phase\n    // grows, against the lines and rings that sink. (Rounds 5–6 gave each band of depth a whole\n    // new arrangement of the palette: every boundary was a front, and noise only frayed the\n    // fronts into patches.) A gentle wander, noise in the flow's own coordinates, puts\n    // neighbouring rays a little out of step; it repeats round the turn and every n steps (one\n    // turn of the palette), so the branch cut, the phase wrap and a loop stay exact.\n    let n = max(floor(u.palC.x + 0.5), 1.0);\n    let s0 = c.pn * u.rise.y - u.rise.z;\n    let cells = max(floor(u.rise3.y + 0.5), 1.0);\n    let q = vec2f(up * cells, s0);\n    let per = vec2f(cells, n);\n    // domain warping (the noise looked up through noise) turns the wander into slow swirls\n    var qw = q;\n    if (u.rise3.z > 0.0) {\n      qw = q + u.rise3.z * vec2f(pnoise2(q, per, 81u), pnoise2(q + vec2f(5.2, 1.3), per, 91u));\n    }\n    // where the steps crowd into a few pixels (at the singularity) the wander stands down\n    let crowd = smoothstep(0.15, 0.5, 2.0 * c.fp * u.rise.y);\n    let s = s0 + u.rise3.x * pfbm(qw, per, 71u) * (1.0 - crowd);\n    let k = floor(s);\n    let f = smoothstep(0.0, 1.0, s - k);\n    let x0 = fieldX(up, inside, k / n, 0u);\n    let la = fieldLab(x0, rp, fws, mk);\n    let lb = fieldLab(x0 + 1.0 / n, rp, fws, mk);\n    lab = mix(la, lb, f);\n    // hold the chroma the two stops have (capped: opposite hues cancel toward nothing)\n    let cm = length(lab.yz);\n    let ct = mix(length(la.yz), length(lb.yz), f);\n    lab = vec3f(lab.x, lab.yz * min(ct / max(cm, 1e-4), 1.8));\n    // before the steps come faster than the pixels can show (at the singularity), the colour\n    // settles into the still wedges\n    let still = smoothstep(0.3, 0.8, c.fp * u.rise.y);\n    if (still > 0.0) {\n      lab = mix(lab, fieldLab(fieldX(up, inside, 0.0, 0u), rp, fws, mk), still);\n    }\n  } else {\n    lab = fieldLab(fieldX(up, inside, 0.0, 0u), rp, fws, mk);\n  }\n  if (u.stripD.w < 0.5) {\n    lab = vec3f(lab.x, lab.yz * u.palC.y);\n    col = oklabToSrgb(lab);\n  }\n\n  // fine lines, with an optional pulse travelling along the potential\n  let N = u.ground.y;\n  let fw = max(c.fa * N / TAU * u.flow.z, 1e-4);\n  let duty = u.ground.z;\n  // lines fade to their mean before they reach a pixel apart: a box filter alone still\n  // beats against the pixel grid there (the moiré rings around every charge)\n  let lc = mix(stripe(c.ang * N / TAU + 0.5 * duty, fw, duty), duty, smoothstep(0.3, 0.8, fw));\n  var amt = u.ground.w;\n  if (u.pulse.x > 0.0) {\n    let ph = c.pn * u.pulse.y - u.pulse.z;\n    let cyc = c.fp * u.pulse.y;\n    let wv = pow(max(0.5 + 0.5 * cos(TAU * ph), 1e-6), u.pulse.w);\n    let fade = 1.0 - smoothstep(0.12, 0.45, cyc);\n    amt = amt * mix(1.0, mix(1.0 - u.pulse.x, 1.0 + 1.5 * u.pulse.x, wv), fade);\n  }\n  // the lines in their ink, or tone on tone: the field's own colour lifted or deepened, like\n  // engine-turned metal under translucent enamel\n  var lineCol = u.lineInk.rgb;\n  if (u.lineT.x > 0.0) {\n    let tl = vec3f(clamp(lab.x + u.lineT.y, 0.0, 1.0), lab.yz * (1.0 + 0.8 * abs(u.lineT.y)));\n    lineCol = mix(lineCol, oklabToSrgb(tl), u.lineT.x);\n  }\n  col = mix(col, lineCol, clamp(amt * lc, 0.0, 1.0));\n\n  // accent hairlines: a sparse, seeded subset in the accent inks\n  let A = u.flow.w;\n  if (A > 0.5) {\n    let sa = c.ang * A / TAU;\n    let j = round(sa);\n    let fwa = max(c.fa * A / TAU * u.flow.z, 1e-5);\n    let jm = j - A * floor(j / A);\n    let s0 = u32(u.accent.w + 0.5);\n    let wa = u.accent.y * A / max(N, 1.0) * (0.55 + 0.9 * h1(u32(jm) * 2246822519u + s0 * 3266489917u));\n    let cov = pulse1(sa - j, fwa, wa) * (1.0 - smoothstep(0.35, 1.0, fwa));\n    let on = step(h1(u32(jm) * 7919u + s0 * 104729u), u.accent.x);\n    let ci = min(i32(h1(u32(jm) * 15485863u + 17u + s0) * 4.0), 3);\n    col = mix(col, clamp(u.acc[ci].rgb * mk, vec3f(0.0), vec3f(1.0)), clamp(cov * on * u.accent.z * u.acc[ci].a, 0.0, 1.0));\n  }\n\n  // the well: wall light, the throat swallowing the colour, a photon ring at one depth\n  col = col * c.lit;\n  col = mix(col, u.throatC.rgb, c.fog * u.throatC.a);\n  // the event horizon: below one depth the well is the throat's colour, with a sharp edge\n  // (antialiased over the pixel's own depth); at the slider's floor it is off\n  if (u.wellRing.w > -7.99) {\n    col = mix(u.throatC.rgb, col, smoothstep(u.wellRing.w - c.fp, u.wellRing.w + c.fp, c.pn));\n  }\n  if (u.wellRing.x > 0.0) {\n    let rz = (c.pn - u.wellRing.y) / max(u.wellRing.z, 1e-3);\n    let ring = u.wellRing.x * exp(-rz * rz) * (1.0 - smoothstep(0.3, 1.2, c.fp / max(u.wellRing.z, 1e-3)));\n    col = 1.0 - (1.0 - col) * (1.0 - clamp(u.ringC.rgb * mk * ring, vec3f(0.0), vec3f(1.0)));\n  }\n\n  // light at the singularity (screen), offset from it by Glow x/y\n  let gp = p - u.glowAt.xy;\n  let rr = dot(gp, gp) / max(u.glow.y * u.glow.y, 1e-6);\n  let gl = u.glow.x * exp(-rr) + u.glow.z * exp(-rr * 25.0);\n  col = 1.0 - (1.0 - col) * (1.0 - clamp(u.glowC.rgb * gl, vec3f(0.0), vec3f(1.0)));\n\n  // inside the loops: darken (dim > 0) or lighten (dim < 0)\n  let dim = u.lobe.y;\n  col = mix(col, select(vec3f(1.0), vec3f(0.0), dim > 0.0), abs(dim) * inside);\n  return clamp(col, vec3f(0.0), vec3f(1.0));\n}\n\nfn dots(p: vec2f, px: f32) -> vec3f {\n  let P = max(u.dots.x, 1e-4);\n  let q = p - P * round(p / P);\n  let d = length(q) - u.dots.y;\n  let c = clamp(0.5 - d / px, 0.0, 1.0);\n  return mix(u.groundC.rgb, u.dotC.rgb, c * u.dotC.a);\n}\n\n// ---------------------------------------------------------------- the loop\n\n// Generalised lemniscate (pinch 1 = Bernoulli, 0 = Gerono), then balance (lobe scale),\n// lean (shear) and tilt. Returns the point (xy) and its derivative in t (zw).\n// Strand A = t ∈ [0, π]: right lobe top → the \"/\" pass → left lobe bottom.\n// Strand B = t ∈ [π, 2π]: left lobe top → the \"\\\" pass → right lobe bottom.\nfn curve(t: f32) -> vec4f {\n  let s = sin(t);\n  let c = cos(t);\n  let pin = u.shape.z;\n  let q = 1.0 + pin * s * s;\n  let iq = 1.0 / q;\n  let dq = 2.0 * pin * s * c;\n  let bx = c * iq;\n  let by = s * c * iq;\n  let dbx = (-s * q - c * dq) * iq * iq;\n  let dby = ((c * c - s * s) * q - s * c * dq) * iq * iq;\n  let A = u.shape.x;\n  let H = u.shape.y;\n  let k = 1.0 + u.shape.w * c;\n  let dk = -u.shape.w * s;\n  let v = vec2f(A * bx, A * H * by);\n  let dv = vec2f(A * dbx, A * H * dby);\n  var w = k * v;\n  var dw = dk * v + k * dv;\n  let lean = u.shape2.x;\n  w = vec2f(w.x + lean * w.y, w.y);\n  dw = vec2f(dw.x + lean * dw.y, dw.y);\n  let ct = u.shape2.y;\n  let st = u.shape2.z;\n  return vec4f(\n    ct * w.x - st * w.y, st * w.x + ct * w.y,\n    ct * dw.x - st * dw.y, st * dw.x + ct * dw.y,\n  );\n}\n\nfn sampleAt(k: i32) -> vec2f {\n  let v = u.coarse[k >> 1u];\n  return select(v.xy, v.zw, (k & 1) == 1);\n}\n\n// Nearest coarse sample of one strand: x = index, y = squared distance.\nfn coarse(p: vec2f, base: i32) -> vec2f {\n  var best = 1e20;\n  var bi = 0;\n  for (var i = 0; i < NCOARSE; i++) {\n    let d = sampleAt(base + i) - p;\n    let d2 = dot(d, d);\n    if (d2 < best) {\n      best = d2;\n      bi = i;\n    }\n  }\n  return vec2f(f32(bi), best);\n}\n\n// Gauss–Newton on |c(t) − p|², clamped to the strand.\nfn refine(p: vec2f, t0: f32, lo: f32, hi: f32, n: i32) -> f32 {\n  var t = t0;\n  for (var i = 0; i < n; i++) {\n    let c = curve(t);\n    let g = dot(c.xy - p, c.zw);\n    let h = max(dot(c.zw, c.zw), 1e-6);\n    t = clamp(t - clamp(g / h, -0.3, 0.3), lo, hi);\n  }\n  return t;\n}\n\nfn wrapPi(a: f32) -> f32 {\n  return a - TAU * floor((a + PI) / TAU);\n}\n\n// Half-width at t (logo units) and the ribbon's twist angle.\n// Calligraphy = one weight harmonic × a taper at each pass (the measured anatomy of the\n// shipping mark); ribbon = a band with `halfTwists` half-twists seen from above.\nfn widthAt(t: f32) -> vec2f {\n  let wave = (1.0 + u.stroke.z * cos(t - u.stroke.w)) / (1.0 + abs(u.stroke.z));\n  let tl = max(u.taper.z, 1e-3);\n  let da = wrapPi(t - (0.5 * PI + u.taper.w)) / tl;\n  let db = wrapPi(t - (1.5 * PI + u.taper.w)) / tl;\n  let cal = wave * (1.0 - u.taper.x * exp(-da * da)) * (1.0 - u.taper.y * exp(-db * db));\n  let al = 0.5 * u.model.y * t + u.model.z;\n  let ca = cos(al);\n  let e = u.model.w;\n  let rib = sqrt(ca * ca * (1.0 - e * e) + e * e);\n  let f = mix(cal, rib, u.model.x);\n  return vec2f(0.5 * u.stroke.x * max(f, u.back.w), al);\n}\n\nstruct Strand {\n  cov: f32,\n  rgb: vec3f,\n  d: f32,\n  hw: f32,\n  foot: vec2f,\n  glow: vec3f,\n};\n\nfn coverage(hwIn: f32, d: f32, px: f32) -> f32 {\n  let hw = max(hwIn, 0.5 * u.stroke.y * px);  // optical floor, in device px\n  let hair = min(1.0, hw / (0.5 * px));        // below half a pixel: thinner ink, not aliasing\n  return clamp((max(hw, 0.5 * px) - d) / px + 0.5, 0.0, 1.0) * hair;\n}\n\n// The edge inks as a cyclic gradient along the edge; `e` runs 0..1 once around the whole\n// edge (for a Möbius band that is twice around the loop).\nfn edgeInkAt(e: f32) -> vec3f {\n  let x = fract(e * u.edge3.w + u.edge2.x) * 3.0;\n  let fx = floor(x);\n  let i = i32(fx) % 3;\n  let f = smoothstep(0.0, 1.0, x - fx);\n  return mix(u.edgeInk[i].rgb, u.edgeInk[(i + 1) % 3].rgb, f);\n}\n\n// The same, with the comet that runs along the edge.\nfn edgeLight(e: f32) -> vec3f {\n  let dc = e - u.edge2.z;\n  let w = dc - round(dc);\n  let comet = u.edge2.y * exp(-(w * w) / max(u.edge2.w * u.edge2.w, 1e-6));\n  return edgeInkAt(e) * (1.0 + comet);\n}\n\nfn screen(col: vec3f, light: vec3f) -> vec3f {\n  return 1.0 - (1.0 - col) * (1.0 - clamp(light, vec3f(0.0), vec3f(1.0)));\n}\n\nfn evalStrand(p: vec2f, t: f32, px: f32) -> Strand {\n  let c = curve(t);\n  let tg = c.zw / max(length(c.zw), 1e-6);\n  let n2 = vec2f(-tg.y, tg.x);\n  let d = length(p - c.xy);\n  let wa = widthAt(t);\n  let cov = coverage(wa.x, d, px);\n  let rib = u.model.x;\n  let ca = cos(wa.y);\n\n  var rgb = u.ink.rgb;\n  if (rib > 0.0) {\n    // the band's surface normal, turned to face the viewer\n    let sa = sin(wa.y);\n    var n = vec3f(-sa * n2, ca);\n    n = n * select(1.0, -1.0, ca < 0.0);\n    let la = u.light.y;\n    let L = normalize(vec3f(cos(la) * 0.75, sin(la) * 0.75, 0.66));\n    let diff = max(dot(n, L), 0.0);\n    let H = normalize(L + vec3f(0.0, 0.0, 1.0));\n    let spec = pow(max(dot(n, H), 1e-6), 40.0);\n    let shade = mix(1.0, 0.28 + 0.9 * diff, u.light.x * rib);\n    // a back colour exists only when the band has two sides (an even number of half-twists)\n    let even = 1.0 - (u.model.y - 2.0 * floor(u.model.y * 0.5));\n    let backness = smoothstep(0.08, -0.08, ca) * even * u.light.w * rib;\n    rgb = mix(u.ink.rgb, u.back.rgb, backness) * shade + vec3f(u.light.z * rib * spec);\n    // iridescence: the band takes the edge inks as it turns edge-on\n    if (u.edge3.x > 0.0) {\n      let edgeOn = pow(1.0 - abs(ca), 1.5);\n      let e = fract(t / (2.0 * TAU)) + select(0.0, 0.5, ca < 0.0);\n      rgb = mix(rgb, edgeInkAt(e) * max(shade, 0.6), u.edge3.x * edgeOn * rib);\n    }\n  }\n\n  if (u.glint.x > 0.0) {\n    let dt = wrapPi(t - u.glint.y);\n    let len = max(u.glint.z, 1e-3);\n    let head = exp(-(dt * dt) / (len * len * 0.12));\n    let tail = select(0.0, exp(dt / (len * max(u.glint.w, 0.02))), dt < 0.0);\n    rgb = mix(rgb, u.glintC.rgb, clamp(u.glint.x * max(head, 0.65 * tail), 0.0, 1.0));\n  }\n\n  // Edge light. A Möbius band has ONE edge, running the loop twice: the \"+\" edge at t\n  // continues as the \"−\" edge at t + 2π. `e` is the position along that single edge, so\n  // its colour flows without a seam and the two lines swap sides — meeting in a flare —\n  // wherever the band turns edge-on. For calligraphy the edges are the stroke's outline.\n  var glow = vec3f(0.0);\n  if (u.edge.x > 0.0) {\n    let sg = dot(p - c.xy, n2);\n    let sp = mix(wa.x, 0.5 * u.stroke.x * ca, rib);\n    let dP = abs(sg - sp);\n    let dM = abs(sg + sp);\n    let cw = max(u.edge.y, 0.7 * px);\n    let hwid = max(u.edge.z, px);\n    let onBand = step(abs(sg), wa.x);\n    let tint = mix(1.0, u.edge.w, onBand); // on the band the halo only tints\n    let fP = exp(-(dP * dP) / (cw * cw)) + exp(-dP / hwid) * tint;\n    let fM = exp(-(dM * dM) / (cw * cw)) + exp(-dM / hwid) * tint;\n    let eP = fract(t / (2.0 * TAU));\n    // past a strand's end the foot clamps to the endpoint and `sg` would draw its edges on as\n    // straight lines forever; there the other strand carries on, so this one steps aside\n    let beside = 1.0 - smoothstep(0.5 * px, 2.0 * px, abs(dot(p - c.xy, tg)));\n    glow = u.edge.x * beside * (edgeLight(eP) * fP + edgeLight(fract(eP + 0.5)) * fM);\n  }\n  return Strand(cov, rgb, d, wa.x, c.xy, glow);\n}\n\n// One registration plate: the loop again, displaced (offset + slow warp), maybe spread.\n// x = coverage, y = the halo of the plate's own light around its outline, z = where along the\n// loop it is (the nearer strand's t), for inks that flow.\nfn plate(p: vec2f, tA: f32, tB: f32, px: f32, pp: vec4f, seed: u32) -> vec3f {\n  var off = pp.xy * u.plateG.w;\n  if (pp.w > 0.0) {\n    let sp = p * u.plateG.x + u.plateG.yz;\n    off += pp.w * vec2f(vnoise(sp, seed), vnoise(sp + vec2f(17.3, -9.1), seed + 101u));\n  }\n  let q = p - off;\n  let ta = refine(q, tA, 0.0, PI, 2);\n  let tb = refine(q, tB, PI, TAU, 2);\n  let ha = widthAt(ta).x + pp.z;\n  let hb = widthAt(tb).x + pp.z;\n  let da = length(q - curve(ta).xy);\n  let db = length(q - curve(tb).xy);\n  let k = max(coverage(ha, da, px), coverage(hb, db, px));\n  let beyond = max(min(da - ha, db - hb), 0.0);\n  let halo = select(0.0, exp(-beyond / max(u.edge3.z, px)), u.edge3.y > 0.0);\n  return vec3f(k, halo, select(tb, ta, da - ha <= db - hb));\n}\n\n// The plate inks as one cyclic gradient along the loop (x in cycles of the three inks): held on\n// each ink, then turned to the next in OKLCH — the short way round the hue circle, chroma\n// carried — so every in-between ink is a saturated one (a straight mix of red and green is grey).\nfn plateInkAt(x: f32) -> vec3f {\n  let y = fract(x) * 3.0;\n  let fy = floor(y);\n  let i = i32(fy) % 3;\n  let f = smoothstep(0.2, 0.8, y - fy);\n  let a = u.plateLab[i].xyz;\n  let b = u.plateLab[(i + 1) % 3].xyz;\n  let ha = atan2(a.z, a.y);\n  let hb = atan2(b.z, b.y);\n  let dh = (hb - ha) - TAU * round((hb - ha) / TAU);\n  let h = ha + dh * f;\n  let C = mix(length(a.yz), length(b.yz), f);\n  return oklabToSrgb(vec3f(mix(a.x, b.x, f), C * cos(h), C * sin(h)));\n}\n\n// Plate k's ink at loop parameter t: its own, or (plateF.x of) the flowing gradient — each plate\n// a third of a cycle on from the last, so the three fringes always show three different inks.\nfn plateInk(k: i32, t: f32) -> vec3f {\n  let own = select(select(u.inkC.rgb, u.inkB.rgb, k == 1), u.inkA.rgb, k == 0);\n  if (u.plateF.x <= 0.0) {\n    return own;\n  }\n  return mix(own, plateInkAt(t / TAU * u.plateF.z + u.plateF.y + f32(k) / 3.0), u.plateF.x);\n}\n\n// Even–odd test against the coarse polyline: 1 inside either lobe.\nfn insideLoop(p: vec2f) -> f32 {\n  var c = false;\n  let n = 2 * NCOARSE;\n  for (var i = 0; i < n; i++) {\n    let a = sampleAt(i);\n    let b = sampleAt((i + 1) % n);\n    if ((a.y > p.y) != (b.y > p.y)) {\n      let x = a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y);\n      if (p.x < x) {\n        c = !c;\n      }\n    }\n  }\n  return select(0.0, 1.0, c);\n}\n\nfn superellipse(p: vec2f, n: f32) -> f32 {\n  let a = max(abs(p), vec2f(1e-6));\n  return pow(pow(a.x, n) + pow(a.y, n), 1.0 / n);\n}\n\n// ---------------------------------------------------------------- compose\n\n@fragment\nfn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {\n  let res = u.view.xy;\n  let px = u.view.z;\n  var q = (fc.xy - 0.5 * res) * px;\n  q.y = -q.y;\n  let p = vec2f(u.cam.x * q.x - u.cam.y * q.y, u.cam.y * q.x + u.cam.x * q.y) + u.cam.zw;\n  let pm = p - u.place.xy;\n\n  // grain: one value per grain cell, applied to the ground (and the loop if asked)\n  var gn = 0.0;\n  if (u.post.z > 0.0) {\n    let gs = max(u.post.w, 1.0);\n    gn = (h2(vec2i(floor(fc.xy / gs)), u32(u.view.w + 0.5)) - 0.5) * u.post.z;\n  }\n\n  // ---- ground (premultiplied: col, alpha)\n  let mode = i32(u.ground.x + 0.5);\n  var col = vec3f(0.0);\n  var alpha = 1.0;\n  var inside = 0.0;\n  if (u.lobe.z > 0.5) {\n    inside = insideLoop(pm);\n  }\n  if (mode == 0) {\n    col = paint(chargeCoords(pm - u.place.zw, px), pm - u.place.zw, inside);\n  } else if (mode == 4) {\n    col = paint(wellCoords(pm - u.place.zw), pm - u.place.zw, inside);\n  } else if (mode == 1) {\n    col = dots(p, px);\n  } else if (mode == 2) {\n    col = u.groundC.rgb;\n  } else {\n    alpha = 0.0;\n  }\n  if (alpha > 0.0) {\n    let v = smoothstep(u.post.y, u.post.y + 0.9, length(p));\n    col = clamp(col * (1.0 - u.post.x * v) + vec3f(gn), vec3f(0.0), vec3f(1.0));\n    // the negative (draft/wormhole, 2026-10-09): every colour of the field turned over, light\n    // for dark — the mark's own passes come after, in their own ink\n    if (u.frame.w > 0.5) {\n      col = 1.0 - col;\n    }\n  }\n\n  // ---- the loop and its plates (skipped wholesale when the pixel is out of reach)\n  let ca = coarse(pm, 0);\n  let cb = coarse(pm, NCOARSE);\n  // (with the living mark on, its own passes draw the mark: the calligraphic loop stands aside)\n  if (u.livC.w < 0.5 && sqrt(min(ca.y, cb.y)) < u.bound.x + 3.0 * px) {\n    let span = PI / f32(NCOARSE - 1);\n    let tA = refine(pm, span * ca.x, 0.0, PI, 4);\n    let tB = refine(pm, PI + span * cb.x, PI, TAU, 4);\n    let A = evalStrand(pm, tA, px);\n    let B = evalStrand(pm, tB, px);\n    let op = u.ink.a;\n\n    // over/under matters only near the crossing; elsewhere the strands are one stroke\n    let cm = i32(u.bound.w + 0.5);\n    let nearX = 1.0 - smoothstep(0.6 * u.bound.y, u.bound.y, min(length(A.foot), length(B.foot)));\n    var top = A;\n    var bot = B;\n    if (cm == 1) {\n      top = B;\n      bot = A;\n    }\n    if (u.bound.z > 0.0 && cm != 2) {\n      let knock = clamp((top.d - (top.hw + u.bound.z)) / px + 0.5, 0.0, 1.0);\n      bot.cov = bot.cov * mix(1.0, knock, nearX);\n    }\n    let wX = select(nearX, 0.0, cm == 2);\n\n    let rgbT = mix(select(B.rgb, A.rgb, A.cov >= B.cov), top.rgb, wX);\n    let pmode = i32(u.plateM.y + 0.5);\n    let lightPlates = u.plateM.x > 0.5 && pmode == 1;\n    if (u.plateM.x > 0.5) {\n      let po = u.plateM.z;\n      let pg = u.edge3.y;\n      let r0 = plate(pm, tA, tB, px, u.pA, 11u);\n      let r1 = plate(pm, tA, tB, px, u.pB, 23u);\n      let r2 = plate(pm, tA, tB, px, u.pC, 37u);\n      let k0 = r0.xy * vec2f(po, pg);\n      let k1 = r1.xy * vec2f(po, pg);\n      let k2 = r2.xy * vec2f(po, pg);\n      if (pmode == 1) {\n        // light: each channel of the loop is its own displaced plate (chromatic aberration),\n        // and each glows in its own channel\n        let kc = vec3f(k0.x, k1.x, k2.x) * op;\n        col = rgbT * kc + col * (1.0 - kc);\n        alpha = max(max(kc.x, kc.y), kc.z) + alpha * (1.0 - max(max(kc.x, kc.y), kc.z));\n        col = screen(col, vec3f(k0.y, k1.y, k2.y));\n      } else {\n        // each plate's ink where it is along the loop (its own ink unless the inks flow)\n        let i0 = plateInk(0, r0.z);\n        let i1 = plateInk(1, r1.z);\n        let i2 = plateInk(2, r2.z);\n        if (pmode == 2) {\n          // overprint: inks multiply the ground\n          col = col * mix(vec3f(1.0), i0, k0.x);\n          col = col * mix(vec3f(1.0), i1, k1.x);\n          col = col * mix(vec3f(1.0), i2, k2.x);\n          alpha = max(max(max(k0.x, k1.x), k2.x), alpha);\n        } else {\n          // print order, like the shipping SVG: red, green, blue, then the loop on top\n          col = i0 * k0.x + col * (1.0 - k0.x);\n          alpha = k0.x + alpha * (1.0 - k0.x);\n          col = i1 * k1.x + col * (1.0 - k1.x);\n          alpha = k1.x + alpha * (1.0 - k1.x);\n          col = i2 * k2.x + col * (1.0 - k2.x);\n          alpha = k2.x + alpha * (1.0 - k2.x);\n        }\n        col = screen(col, i0 * k0.y + i1 * k1.y + i2 * k2.y);\n      }\n    }\n\n    // the loop: near the crossing the bottom strand (band, then its light) goes down first\n    // and the top strand covers it; elsewhere one stroke, lit by the nearer strand's edges\n    let covBot = bot.cov * wX * op;\n    let covTop = mix(max(A.cov, B.cov), top.cov, wX) * op;\n    if (!lightPlates) {\n      col = bot.rgb * covBot + col * (1.0 - covBot);\n      alpha = covBot + alpha * (1.0 - covBot);\n    }\n    col = screen(col, bot.glow * wX);\n    if (!lightPlates) {\n      col = rgbT * covTop + col * (1.0 - covTop);\n      alpha = covTop + alpha * (1.0 - covTop);\n    }\n    let gTop = mix(max(A.glow, B.glow), top.glow, wX);\n    col = screen(col, gTop);\n    alpha = alpha + clamp(max(max(gTop.x, gTop.y), gTop.z), 0.0, 1.0) * (1.0 - alpha);\n    let mcov = covTop;\n    if (u.dots.z > 0.5) {\n      col = clamp(col + vec3f(gn) * mcov, vec3f(0.0), vec3f(1.0));\n    }\n  }\n\n  // ---- frame: iOS squircle (full bleed), macOS (824/1024 inset + shadow), circle\n  let fmode = i32(u.frame.x + 0.5);\n  if (fmode != 0) {\n    let hf = 0.5 * min(res.x, res.y);\n    let fp = (fc.xy - 0.5 * res) / hf;\n    let pxf = 1.0 / hf;\n    let inset = select(1.0, 824.0 / 1024.0, fmode == 2);\n    var m: f32;\n    if (fmode == 3) {\n      m = length(fp / inset);\n    } else {\n      m = superellipse(fp / inset, u.frame.y);\n    }\n    let a = clamp((1.0 - m) * inset / pxf + 0.5, 0.0, 1.0);\n    col = col * a;\n    alpha = alpha * a;\n    if (fmode == 2 && u.frame.z > 0.0) {\n      let ms = superellipse((fp - vec2f(0.0, 0.028)) / inset, u.frame.y);\n      let sh = u.frame.z * (1.0 - smoothstep(0.93, 1.07, ms));\n      alpha = alpha + sh * (1.0 - alpha);\n    }\n  }\n  return vec4f(col, alpha);\n}\n\n// ---------------------------------------------------------------- the living mark\n//\n// James's ribbon from packages/design-kit/src/logo (shader.ts, 2026-10-08), ported: a real 3D\n// band — an elliptical cross-section swept along a lemniscate with depth — with one half-turn\n// per lap that circulates, drawn as a mesh over this file's field (depth-tested, 4× MSAA), then\n// its single edge as light: segments that chase each other along the Möbius boundary. Geometry,\n// shading and edge light are his, line for line. Two things change, both in the frame: his\n// canvas fit and y-flip become this lab's camera (zoom, pan, view rotation, macOS inset, the\n// mark's offset), and his clock arrives as phases from animate() — u.livF.x (the circulation),\n// u.livE.y (the edge travel), u.livG.x (colour drift), u.livG.y (the breath). His names carry a\n// `liv` prefix; `out`, `step` and `distance` became `o`, `dt` and `dist`.\n//\n// The VibeField Identity (proposal 01, 2026-10-09) drew this same band with Canvas 2D, and drew\n// it differently: FLAT, in ink — each piece filled and its outline stroked, so where the band\n// turns edge-on the outline is left, a hairline — and its three lights as LINES on the rim, a\n// constant width on screen (the loop's width × 0.0042) with a glow round each 4.2 times as wide\n// at 16%, every piece's light drawn over its own piece and under the pieces in\n// front. Ribbon \"flat\" and Edge light \"line\" are that drawing here: the cross-section's relief\n// goes to nothing (u.livG.z), its rims are stroked in ink (livRim*: the hairline), and the edge\n// strips draw lines of light lifted toward the camera by the band's own depth across, so a light\n// lies over its band and under the strand in front. Its least widths are in pixels of the icon\n// (u.livG.w: the target's pixels per pixel of the icon, so a small icon's large source holds a\n// one-pixel hairline at its own size). \"tube\" and \"rgb\" are his drawing, as until now.\n\nconst LIV_SEGMENTS: u32 = 512u; // mark.js LIV_SEGMENTS must match\nconst LIV_PROFILE: u32 = 16u; // mark.js LIV_PROFILE must match\nconst LIV_FIT: f32 = 0.78; // his canvas fit for a square view\nconst LIV_PIECES: f32 = 420.0; // the Identity draws its band in this many pieces round the loop\n\nfn livPalette(phase: f32) -> vec3f {\n  let p = fract(phase) * 4.0;\n  let f = smoothstep(0.0, 1.0, fract(p));\n  if (p < 1.0) { return mix(u.livCol[0].rgb, u.livCol[1].rgb, f); }\n  if (p < 2.0) { return mix(u.livCol[1].rgb, u.livCol[2].rgb, f); }\n  if (p < 3.0) { return mix(u.livCol[2].rgb, u.livCol[3].rgb, f); }\n  return mix(u.livCol[3].rgb, u.livCol[0].rgb, f);\n}\n\nfn livRotate(p: vec2f, a: f32) -> vec2f {\n  return vec2f(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y);\n}\n\nfn livCurve(t: f32) -> vec3f {\n  let s = sin(t);\n  let c = cos(t);\n  let p = vec2f(u.livA.y * c, u.livA.z * sin(2.0 * t)) / (1.0 + u.livB.y * s * s);\n  return vec3f(p * vec2f(1.0, 1.0 + u.livB.w * c), -u.livD.y * s) * u.livA.x * u.livG.y;\n}\n\nfn livRoll(p: vec3f) -> vec3f {\n  let a = u.livD.x;\n  let axial = vec3f(p.x, p.y * cos(a) - p.z * sin(a), p.y * sin(a) + p.z * cos(a));\n  return vec3f(livRotate(axial.xy, u.livB.z), axial.z);\n}\n\n// Logo space → this lab's clip space: the inverse of fs's camera.\nfn livNdc(s: vec2f) -> vec2f {\n  let d = s - u.cam.zw;\n  let q = vec2f(u.cam.x * d.x + u.cam.y * d.y, -u.cam.y * d.x + u.cam.x * d.y);\n  return q / (u.view.z * 0.5 * u.view.xy);\n}\n\n// His project(): perspective w, his fit and y-flip, then this lab's frame.\nfn livProject(p: vec3f) -> vec4f {\n  let w = 1.0 - p.z * u.livD.z * 0.2;\n  let s = vec2f(p.x, -p.y) * LIV_FIT / w + u.place.xy;\n  return vec4f(livNdc(s) * w, 0.5 * w - p.z * 0.1, w);\n}\n\nfn livWidth(t: f32) -> f32 {\n  // the flat band never narrower than its least width (u.livH.y, half of it, in pixels of the\n  // icon; 0 for the tube)\n  return max(u.livA.w * u.livA.x * (1.0 + u.livB.x * sin(t + 0.7)), u.livH.y * u.livG.w * u.view.z / LIV_FIT);\n}\n\n// The Identity's sizes, in this target's pixels. Its `size` is the loop's whole width (its\n// width × 2 × 1.04, at its scale); its line of light is that × 0.0042 (× edge width / 0.22) —\n// under a pixel it grows fainter, not wider, so a small icon keeps the light's true share (the\n// Identity widens it to a pixel, and drops its lights from icons under 64 px instead); its\n// outline is that ÷ 900, and at least the hairline.\nfn livLoopPx() -> f32 {\n  return 2.0 * 1.04 * u.livA.y * u.livA.x * u.livG.y * LIV_FIT / u.view.z;\n}\n\nfn livLinePx() -> f32 {\n  return max(0.0042 * livLoopPx() * u.livD.w / 0.22, 1e-4);\n}\n\nfn livHairPx() -> f32 {\n  return max(livLoopPx() / 900.0, u.livH.x * u.livG.w);\n}\n\n// how much of a pixel a line `w` px wide covers, `d` px from its middle (a box filter, so a line\n// thinner than a pixel is fainter, never wider)\nfn livCover(d: f32, w: f32) -> f32 {\n  return clamp(min(d + 0.5, 0.5 * w) - max(d - 0.5, -0.5 * w), 0.0, 1.0);\n}\n\n// The Identity strokes its lights piece by piece, each stroke round-capped, so neighbours\n// overlap: a point `d` px from the line, under a stroke `r` px in half-width, lies under\n// 1 + 2·√(r² − d²) / (the piece's length) of them — more over the line's middle, more where the\n// pieces are short — and its light sums to 1 − (1 − a)^n. `perPx`: pieces per pixel.\nfn livStrokes(a: f32, d: f32, r: f32, perPx: f32) -> f32 {\n  let n = 1.0 + 2.0 * perPx * sqrt(max(r * r - d * d, 0.0));\n  return 1.0 - pow(max(1.0 - a, 1e-7), n);\n}\n\nfn livNormal(t: f32) -> vec3f {\n  let tangent = normalize(livCurve(t + 0.001) - livCurve(t - 0.001));\n  let normal = normalize(vec3f(-tangent.y, tangent.x, 0.0));\n  let binormal = normalize(cross(tangent, normal));\n  let q = t - u.livF.x;\n  // One half-turn per lap. The cross-section closes with opposite sides joined.\n  // Focus concentrates the turning section while keeping a broad, open ribbon face.\n  let twist = q * 0.5 - u.livF.y * 0.45 * sin(q);\n  return normal * cos(twist) + binormal * sin(twist);\n}\n\nfn livEdgeCoord(t: f32, side: f32) -> f32 {\n  // A Möbius ribbon has a single boundary: lap two continues on the opposite rim.\n  // This double-cover coordinate keeps color and pulse phase continuous at both joins.\n  return (t - u.livF.x) / (2.0 * TAU) + select(0.0, 0.5, side < 0.0);\n}\n\nfn livPulse(t: f32, side: f32) -> f32 {\n  // Short light segments share the single Möbius boundary with the RGB colors.\n  // Compact support leaves the rest of the track completely unlit, at any count.\n  let travel = livEdgeCoord(t, side) + u.livE.y;\n  let phase = fract(travel * round(u.livE.w));\n  let dist = abs(fract(phase - 0.25 + 0.5) - 0.5);\n  let halfLength = mix(0.025, 0.14, u.livE.z);\n  return 1.0 - smoothstep(halfLength * 0.55, halfLength, dist);\n}\n\nfn livEnergy(value: f32) -> f32 {\n  // A soft shoulder preserves detail at high settings and with earlier, brighter presets.\n  return 1.0 - exp(-value * 0.72);\n}\n\nfn livRgbEdge(t: f32, side: f32) -> vec3f {\n  // Color moves with each segment along the same continuous boundary.\n  let phase = fract(livEdgeCoord(t, side) + 0.12 + u.livE.y) * 3.0;\n  let blend = smoothstep(0.96, 1.0, fract(phase));\n  if (phase < 1.0) { return mix(u.livCol[0].rgb, u.livCol[3].rgb, blend); }\n  if (phase < 2.0) { return mix(u.livCol[3].rgb, u.livCol[1].rgb, blend); }\n  return mix(u.livCol[1].rgb, u.livCol[0].rgb, blend);\n}\n\n// The icon's mask at a framebuffer position (fs's frame section, as coverage only).\nfn livMask(fc: vec2f) -> f32 {\n  let fmode = i32(u.frame.x + 0.5);\n  if (fmode == 0) {\n    return 1.0;\n  }\n  let res = u.view.xy;\n  let hf = 0.5 * min(res.x, res.y);\n  let fp = (fc - 0.5 * res) / hf;\n  let inset = select(1.0, 824.0 / 1024.0, fmode == 2);\n  var m: f32;\n  if (fmode == 3) {\n    m = length(fp / inset);\n  } else {\n    m = superellipse(fp / inset, u.frame.y);\n  }\n  return clamp((1.0 - m) * inset * hf + 0.5, 0.0, 1.0);\n}\n\nstruct LivVertex {\n  @builtin(position) position: vec4f,\n  @location(0) along: f32,\n  @location(1) ring: f32,\n  @location(2) normal: vec3f,\n};\n\n@vertex\nfn livRibbonVertex(@builtin(vertex_index) index: u32) -> LivVertex {\n  let corner = index % 6u;\n  var alongStep = array<u32, 6>(0u, 1u, 0u, 0u, 1u, 1u);\n  var ringStep = array<u32, 6>(0u, 0u, 1u, 1u, 0u, 1u);\n  let segment = index / (LIV_PROFILE * 6u) + alongStep[corner];\n  let ring = (index / 6u) % LIV_PROFILE + ringStep[corner];\n  let t = f32(segment) / f32(LIV_SEGMENTS) * TAU;\n  let theta = f32(ring) / f32(LIV_PROFILE) * TAU;\n  let tangent = normalize(livCurve(t + 0.001) - livCurve(t - 0.001));\n  let normal = livNormal(t);\n  let binormal = normalize(cross(tangent, normal));\n  let width = livWidth(t);\n  let relief = u.livG.z; // his tube's cross-section, 0.24 of its width deep; the flat band's, none\n  let p = livCurve(t) + width * (normal * cos(theta) + binormal * sin(theta) * relief);\n  var o: LivVertex;\n  o.position = livProject(livRoll(p));\n  o.along = t;\n  o.ring = theta;\n  o.normal = livRoll(normalize(normal * cos(theta) + binormal * sin(theta) / max(relief, 0.02)));\n  return o;\n}\n\n@fragment\nfn livRibbonFragment(v: LivVertex) -> @location(0) vec4f {\n  let n = normalize(v.normal);\n  let side = cos(v.ring);\n  let drift = u.livG.x;\n  let edgeColor = mix(livPalette(livEdgeCoord(v.along, -1.0) + drift),\n    livPalette(livEdgeCoord(v.along, 1.0) + drift), side * 0.5 + 0.5);\n  let edgeSide = select(-1.0, 1.0, side >= 0.0);\n  let segment = livPulse(v.along, edgeSide);\n  let strength = 1.0 - exp(-u.livE.x * 4.0);\n  let reflection = livEnergy(segment * u.livE.x);\n  let rimPosition = abs(side);\n  let rimWidth = 0.018 + u.livC.x * 0.12;\n  let aa = max(fwidth(rimPosition), 0.005);\n  let rim = smoothstep(1.0 - rimWidth - aa, 1.0 - rimWidth + aa, rimPosition);\n  let light = normalize(vec3f(-0.35, -0.55, 1.3));\n  let diffuse = max(dot(n, light), 0.0);\n  let specular = pow(max(dot(n, normalize(light + vec3f(0.0, 0.0, 1.0))), 0.0), 20.0);\n  let sheen = 0.5 + 0.5 * sin(v.along - u.livF.x + v.ring * 2.0);\n  let pearl = mix(u.ink.rgb, edgeColor, u.livC.y * sheen * 0.32);\n  var body = pearl * (0.78 + 0.2 * diffuse);\n  body = mix(body, vec3f(0.98, 0.975, 0.965), specular * 0.085);\n  // Surface shading and edge light are independent: the core can stay pure ink.\n  if (u.livF.z > 0.5) {\n    body = u.ink.rgb;\n  }\n  let m = livMask(v.position.xy);\n  // no light on the band itself: none, or the Identity's lines (drawn on the rims, after)\n  if (u.livF.w < 0.5 || u.livF.w > 2.5) {\n    return vec4f(body * m, m);\n  }\n  if (u.livF.w > 1.5) {\n    let band = smoothstep(1.0 - u.livD.w - aa, 1.0 - u.livD.w + aa, rimPosition);\n    let color = livRgbEdge(v.along, edgeSide);\n    return vec4f(mix(body, color, band * segment * strength) * m, m);\n  }\n  let rimColor = mix(edgeColor, pearl, 0.24) * (0.86 + diffuse * 0.12);\n  body = mix(body, rimColor, rim * min(0.9, u.livC.x * 1.2) * segment * strength);\n  let grazing = pow(1.0 - abs(n.z), 2.0);\n  let glintColor = mix(edgeColor, vec3f(0.98, 0.975, 0.965), 0.24);\n  let glintBand = smoothstep(0.7 - aa, 0.995 + aa, rimPosition);\n  body = mix(body, glintColor, glintBand * reflection * (0.22 + grazing * 0.38));\n  return vec4f(body * m, m);\n}\n\nstruct LivEdgeVertex {\n  @builtin(position) position: vec4f,\n  @location(0) across: f32,\n  @location(1) along: f32,\n  @location(2) side: f32,\n  @location(3) response: f32,\n  @location(4) halfPx: f32,\n};\n\nfn livEdgePoint(t: f32, side: f32) -> vec4f {\n  return livProject(livRoll(livCurve(t) + livNormal(t) * livWidth(t) * side));\n}\n\n@vertex\nfn livEdgeVertex(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> LivEdgeVertex {\n  return livStrip(index, f32(instance) * 2.0 - 1.0, u.livF.w);\n}\n\n// the flat band's outline, in ink: a strip on each rim\n@vertex\nfn livRimVertex(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> LivEdgeVertex {\n  return livStrip(index, f32(instance) * 2.0 - 1.0, -1.0);\n}\n\n// One vertex of a strip along one rim. Styles 1 and 2 are his lights: as wide as the ribbon, in\n// perspective, narrowed at tight bends. 3 is the Identity's line of light with its glow, and −1\n// its outline in ink: a constant width on screen, as a canvas line is (`halfPx` each side).\nfn livStrip(index: u32, side: f32, style: f32) -> LivEdgeVertex {\n  let t = f32(index / 2u) / f32(LIV_SEGMENTS) * TAU;\n  let across = f32(index % 2u) * 2.0 - 1.0;\n  let center = livEdgePoint(t, side);\n  let dt = TAU / f32(LIV_SEGMENTS);\n  let a = livEdgePoint(t - dt, side);\n  let b = livEdgePoint(t + dt, side);\n  let res = u.view.xy;\n  let aspect = res / min(res.x, res.y);\n  let previous = (center.xy / center.w - a.xy / a.w) * aspect;\n  let next = (b.xy / b.w - center.xy / center.w) * aspect;\n  let delta = previous + next;\n  let tangent = delta / max(length(delta), 0.00001);\n  let normal = vec2f(-tangent.y, tangent.x);\n  var o: LivEdgeVertex;\n  if (style > 2.5 || style < 0.0) {\n    let isoPerPx = 2.0 / min(res.x, res.y);\n    let area = abs(previous.x * next.y - previous.y * next.x);\n    let bendPx = length(previous) * length(next) * length(delta) / max(4.0 * area, 0.00000001) / isoPerPx;\n    var keep = 0.5 * livHairPx() + 1.0;\n    var want = keep;\n    var z = center.z - 0.00015 * center.w;\n    if (style > 2.5) {\n      let ew = livLinePx();\n      keep = 0.5 * ew + 1.0;\n      want = max(0.5 * u.livH.w * ew, 0.5 * ew) + 1.0;\n      // lifted toward the camera by the band's own depth across (0.1 of a logo unit per unit\n      // of depth): a light lies over its own band, as each canvas piece's light covers its own\n      // piece, and still under the strand in front at the crossing\n      z = z - 0.22 * livWidth(t);\n      // the Identity's pieces per pixel along this rim (`delta` spans two of these segments)\n      o.response = 2.0 * isoPerPx / max(length(delta), 1e-7) * (LIV_PIECES / f32(LIV_SEGMENTS));\n    }\n    // the glow stops short of a tight bend's centre (a canvas stroke's caps would heap up\n    // there); the line itself keeps its width\n    o.halfPx = max(min(want, bendPx), keep);\n    let offset = normal * across * o.halfPx * isoPerPx / aspect * center.w;\n    o.position = vec4f(center.xy + offset, z, center.w);\n    o.across = across;\n    o.along = t;\n    o.side = side;\n    return o;\n  }\n  // his canvas fit in this lab's frame: logo units → the isotropic units above\n  let fit = LIV_FIT * 2.0 / (u.view.z * min(res.x, res.y));\n  // Keep diffusion close to the material; strength never inflates the halo into a bead.\n  let width = select(1.0 + u.livC.z * 1.2, u.livD.w * 2.2 + u.livC.z * 0.3, u.livF.w > 1.5);\n  let requested = livWidth(t) * fit * width / center.w;\n  // Offset strips fold across themselves when the halo exceeds a bend's radius.\n  // A smooth curvature limit keeps the inner halo from forming bright triangular fans.\n  let area = abs(previous.x * next.y - previous.y * next.x);\n  let bendRadius = 0.45 * length(previous) * length(next) * length(delta) / max(2.0 * area, 0.00000001);\n  let radius = requested * bendRadius / max(requested + bendRadius, 0.00001);\n  let offset = normal * across * radius / aspect * center.w;\n  // No depth writes: the opaque surface occludes light on the farther strand.\n  o.position = vec4f(center.xy + offset, center.z - 0.00015 * center.w, center.w);\n  o.across = across;\n  o.along = t;\n  o.side = side;\n  o.halfPx = 0.0;\n  let surfaceNormal = livRoll(livNormal(t) * side);\n  let grazing = pow(1.0 - abs(surfaceNormal.z), 2.0);\n  let light = normalize(vec3f(-0.35, -0.55, 1.3));\n  let bendFade = select(1.0, smoothstep(0.0, 0.8, radius / max(requested, 0.00001)), u.livF.w > 1.5);\n  o.response = (0.4 + grazing * 0.6) * (0.55 + 0.45 * max(dot(surfaceNormal, light), 0.0)) * bendFade;\n  return o;\n}\n\n// the flat band's outline: ink, the Identity's line width (at least the hairline)\n@fragment\nfn livRimFragment(v: LivEdgeVertex) -> @location(0) vec4f {\n  let a = livCover(abs(v.across) * v.halfPx, livHairPx()) * livMask(v.position.xy);\n  return vec4f(u.ink.rgb * a, a);\n}\n\n@fragment\nfn livEdgeFragment(v: LivEdgeVertex) -> @location(0) vec4f {\n  let phase = livEdgeCoord(v.along, v.side) + u.livG.x;\n  let segment = livPulse(v.along, v.side);\n  let strength = 1.0 - exp(-u.livE.x * 4.0);\n  let reflection = livEnergy(segment * u.livE.x);\n  let m = livMask(v.position.xy);\n  if (u.livF.w > 2.5) {\n    // the Identity's line of light on the rim and its glow round it: strokes as bright as the\n    // segment passing (the pulse) and the light's strength (1.4 is full) say, the glow's 16% of\n    // that, heaped where its pieces overlap (livStrokes)\n    let d = abs(v.across) * v.halfPx;\n    let ew = livLinePx();\n    let r = 0.5 * u.livH.w * ew;\n    let pu = segment * min(1.0, u.livE.x / 1.4);\n    let line = livStrokes(pu * livCover(d, ew), d, 0.5 * ew, v.response);\n    let glow = livStrokes(u.livH.z * pu, d, r, v.response) * clamp(r - d + 0.5, 0.0, 1.0);\n    let lit = (line + (1.0 - line) * glow) * m;\n    return vec4f(livRgbEdge(v.along, v.side) * lit, lit);\n  }\n  if (u.livF.w > 1.5) {\n    // The opaque band lives on the surface. This strip adds only faint diffusion,\n    // avoiding overlapping opaque lips and depth fringes at the tightest bends.\n    let dist = abs(v.across);\n    let halo = exp(-dist * dist * 7.0) * (1.0 - smoothstep(0.7, 1.0, dist));\n    let alpha = halo * u.livC.z * (0.16 + reflection * 0.3) * v.response * segment * strength * m;\n    return vec4f(livRgbEdge(v.along, v.side) * alpha, alpha);\n  }\n  // Retain the palette's chroma instead of diluting the glow toward white.\n  let color = mix(livPalette(phase), vec3f(0.98, 0.975, 0.965), 0.18);\n  let radius2 = v.across * v.across;\n  let falloff = (exp(-radius2 * 12.0) * 0.75 + exp(-radius2 * 3.5) * 0.25)\n    * (1.0 - smoothstep(0.7, 1.0, abs(v.across)));\n  let alpha = (u.livC.z * 0.12 + reflection * 0.62) * falloff * v.response * segment * strength * m;\n  return vec4f(color * alpha, alpha);\n}\n";
globalThis.__SHRINK_WGSL__ = "// VibeField · Wormhole Dust — the small sizes (2026-10-09).\n//\n// James: \"the icon somehow looks very dark as it go small\". Drawn at its own size, the icon\n// takes its averages where its detail falls under a pixel in the wrong space (its colours in\n// OKLab, its light before the power that turns it into light, the mark's antialiasing in\n// sRGB): at 16 px it kept 63% of the key visual's light and its mark 25%. Here it is drawn\n// large and shrunk the way the eye shrinks it — every source pixel turned back into light,\n// averaged over the small pixel it falls in, and only then encoded — which keeps every size's\n// light, and then tuned for its size (small.js).\n//\n// The field and the mark arrive apart (the mark drawn over nothing), so the field can be\n// softened or sharpened, exposed and coloured without touching the mark, and the mark is laid\n// over it in light.\n//\n//   shrinkFs  the sources, k × k texels to a pixel (premultiplied sRGB) → the field and the\n//             mark at the small size, each premultiplied linear light (two rgba16float targets)\n//   finishFs  the field softened or sharpened, exposed, its contrast and colour; the mark over\n//             it; encoded → the canvas (premultiplied sRGB, as every pass in mark.wgsl writes)\n\nstruct S {\n  size: vec4f, // k (source texels to a pixel, each way), width, height, 0\n  tone: vec4f, // exposure (EV), contrast (−1 … 1), colour (chroma ×), 0\n  focus: vec4f, // soften (σ, px), sharpen (unsharp amount), 0, 0\n};\n\n@group(0) @binding(0) var<uniform> s: S;\n@group(0) @binding(1) var texA: texture_2d<f32>; // shrinkFs: the field's source · finishFs: the field, small\n@group(0) @binding(2) var texB: texture_2d<f32>; // shrinkFs: the mark's source · finishFs: the mark, small\n\n@vertex\nfn smallVs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {\n  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));\n  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);\n}\n\nfn decode(c: vec3f) -> vec3f {\n  let x = clamp(c, vec3f(0.0), vec3f(1.0));\n  return select(pow((x + 0.055) / 1.055, vec3f(2.4)), x / 12.92, x <= vec3f(0.04045));\n}\n\nfn encode(c: vec3f) -> vec3f {\n  let x = clamp(c, vec3f(0.0), vec3f(1.0));\n  return select(1.055 * pow(max(x, vec3f(1e-7)), vec3f(1.0 / 2.4)) - 0.055, 12.92 * x, x <= vec3f(0.0031308));\n}\n\n// OKLab (Björn Ottosson's), from and to linear sRGB\nfn toLab(c: vec3f) -> vec3f {\n  let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;\n  let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;\n  let q = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;\n  let r = pow(max(vec3f(l, m, q), vec3f(1e-12)), vec3f(1.0 / 3.0));\n  return vec3f(\n    0.2104542553 * r.x + 0.7936177850 * r.y - 0.0040720468 * r.z,\n    1.9779984951 * r.x - 2.4285922050 * r.y + 0.4505937099 * r.z,\n    0.0259040371 * r.x + 0.7827717662 * r.y - 0.8086757660 * r.z,\n  );\n}\n\nfn fromLab(c: vec3f) -> vec3f {\n  let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;\n  let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;\n  let q_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;\n  let l = l_ * l_ * l_;\n  let m = m_ * m_ * m_;\n  let q = q_ * q_ * q_;\n  return vec3f(\n    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q,\n    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q,\n    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * q,\n  );\n}\n\n// a source texel, premultiplied sRGB → premultiplied linear light\nfn light(t: vec4f) -> vec4f {\n  if (t.a <= 0.0) {\n    return vec4f(0.0);\n  }\n  return vec4f(decode(t.rgb / t.a) * t.a, t.a);\n}\n\nstruct Two {\n  @location(0) field: vec4f,\n  @location(1) mark: vec4f,\n};\n\n@fragment\nfn shrinkFs(@builtin(position) fc: vec4f) -> Two {\n  let k = max(i32(s.size.x + 0.5), 1);\n  let o = vec2i(floor(fc.xy)) * k;\n  var f = vec4f(0.0);\n  var m = vec4f(0.0);\n  for (var j = 0; j < k; j++) {\n    for (var i = 0; i < k; i++) {\n      let q = o + vec2i(i, j);\n      f += light(textureLoad(texA, q, 0));\n      m += light(textureLoad(texB, q, 0));\n    }\n  }\n  let n = f32(k * k);\n  return Two(f / n, m / n);\n}\n\nfn fieldAt(p: vec2i) -> vec4f {\n  let last = vec2i(i32(s.size.y + 0.5), i32(s.size.z + 0.5)) - 1;\n  return textureLoad(texA, clamp(p, vec2i(0), last), 0);\n}\n\n@fragment\nfn finishFs(@builtin(position) fc: vec4f) -> @location(0) vec4f {\n  let p = vec2i(floor(fc.xy));\n  let box = textureLoad(texA, p, 0);\n  var f = box;\n  let soften = s.focus.x;\n  let sharpen = s.focus.y;\n  if (soften > 0.0 || sharpen > 0.0) {\n    // two gaussians over one neighbourhood, premultiplied (so the mask's rim lends no dark):\n    // σ (soften; 0 is the pixel itself), and that once more through a 3 × 3 tent (σ² + ½) —\n    // the reference the unsharp mask pushes away from\n    let s2 = sqrt(soften * soften + 0.5);\n    let r = i32(ceil(2.5 * s2));\n    var a1 = vec4f(0.0);\n    var w1 = 0.0;\n    var a2 = vec4f(0.0);\n    var w2 = 0.0;\n    for (var j = -r; j <= r; j++) {\n      for (var i = -r; i <= r; i++) {\n        let d2 = f32(i * i + j * j);\n        let v = fieldAt(p + vec2i(i, j));\n        var g1 = select(0.0, 1.0, d2 == 0.0);\n        if (soften > 0.0) {\n          g1 = exp(-0.5 * d2 / (soften * soften));\n        }\n        let g2 = exp(-0.5 * d2 / (s2 * s2));\n        a1 += g1 * v;\n        w1 += g1;\n        a2 += g2 * v;\n        w2 += g2;\n      }\n    }\n    let b1 = a1 / w1;\n    f = max(b1 + sharpen * (b1 - a2 / w2), vec4f(0.0));\n  }\n  // the field's own colour here; its cover stays the shrunk one, so the mask's edge is\n  // neither softened nor sharpened\n  var rgb = select(vec3f(0.0), f.rgb / max(f.a, 1e-6), f.a > 1e-6);\n  rgb = rgb * exp2(s.tone.x);\n  var lab = toLab(max(rgb, vec3f(0.0)));\n  if (s.tone.y != 0.0) {\n    // contrast: toward smoothstep's S about the middle (or, below 0, away from it)\n    let L = clamp(lab.x, 0.0, 1.0);\n    lab.x = mix(L, L * L * (3.0 - 2.0 * L), s.tone.y);\n  }\n  lab = vec3f(lab.x, lab.yz * s.tone.z);\n  rgb = max(fromLab(lab), vec3f(0.0));\n  // the mark over it, in light\n  let m = textureLoad(texB, p, 0);\n  let a = box.a;\n  let outA = m.a + a * (1.0 - m.a);\n  if (outA <= 0.0) {\n    return vec4f(0.0);\n  }\n  let lit = m.rgb + min(rgb, vec3f(1.0)) * a * (1.0 - m.a);\n  return vec4f(encode(lit / outA) * outA, outA);\n}\n";
// ---- mark.js
const { COARSE, UNIFORM_BYTES, WGSL_STRUCT, hexToRgb, rgbToHex, srgbToOklab, SECTIONS, PARAMS, DEFAULTS, PRESETS, presetValues, normalize, animate, loopShape, curvePoint, halfWidth, livViewTilt, livExtent, frameScale, pack, MarkUnavailable, loadShaderSource, createEngine, markSVG } = (() => {
// VibeField · Wormhole Dust — the renderer core, forked from draft/mark (v14, 2026-10-08) to
// explore one direction: Wormhole's strips made of particles, as the icon and as the app's
// loading window. The uniform layout, the packing and mark.wgsl are the mark lab's own, so a
// look here renders exactly as it does there; what changed is around them — the looks, the
// sections the panel shows, and a render that leaves the mark out (the loading window draws
// the field at its own size and the mark in a small canvas of its own over it).
//
//   LAYOUT      the uniform block; the WGSL `struct U` is GENERATED from it (one source)
//   PARAMS      every tunable, with range, unit and section — the panel renders this
//   PRESETS     named looks as overrides of DEFAULTS
//   animate()   time → phases (the shader never sees a clock)
//   pack()      params + phases + target size → the uniform bytes
//   createEngine() WebGPU device, pipelines, canvas surfaces, pixel readback
//   markSVG()   the loop as vector outlines, from the same parameters
//   livExtent() how far the living mark reaches, for the loading window's logo canvas

// ------------------------------------------------------------------ uniform layout

const COARSE = 24; // samples per strand; mark.wgsl NCOARSE must match
const LIV_SEGMENTS = 512; // the living mark's mesh; mark.wgsl LIV_SEGMENTS must match
const LIV_PROFILE = 16; // mark.wgsl LIV_PROFILE must match
const LIV_BODY = LIV_SEGMENTS * LIV_PROFILE * 6;
const LIV_EDGE = (LIV_SEGMENTS + 1) * 2;

const LAYOUT = [
  ["view", 1], ["cam", 1], ["place", 1], ["shape", 1], ["shape2", 1], ["stroke", 1],
  ["taper", 1], ["model", 1], ["light", 1], ["ink", 1], ["back", 1], ["glint", 1],
  ["glintC", 1], ["bound", 1], ["plateM", 1], ["plateG", 1], ["pA", 1], ["pB", 1],
  ["pC", 1], ["inkA", 1], ["inkB", 1], ["inkC", 1], ["ground", 1], ["law", 1],
  ["flow", 1], ["accent", 1], ["pulse", 1], ["palA", 1], ["palB", 1], ["palC", 1],
  ["lobe", 1], ["pal", 12], ["acc", 4], ["lineInk", 1], ["lineT", 1], ["seam", 1], ["seamC", 1], ["rise", 1], ["rise3", 1],
  ["glow", 1], ["glowC", 1], ["glowAt", 1],
  ["post", 1], ["dots", 1], ["groundC", 1], ["dotC", 1], ["frame", 1],
  ["well", 1], ["wellLook", 1], ["wellRing", 1], ["throatC", 1], ["ringC", 1],
  ["camR", 1], ["camU", 1], ["camF", 1], ["camPos", 1],
  ["edge", 1], ["edge2", 1], ["edge3", 1], ["edgeInk", 3], ["plateF", 1], ["plateLab", 3],
  ["livA", 1], ["livB", 1], ["livC", 1], ["livD", 1], ["livE", 1], ["livF", 1], ["livG", 1], ["livH", 1], ["livCol", 4],
  ["stripA", 1], ["stripB", 1], ["stripC", 1], ["stripD", 1], ["stripE", 1], ["stripM", 1], ["stripF", 1], ["runA", 1], ["runB", 1],
  ["dustA", 1], ["dustB", 1], ["dustC", 1], ["dustD", 1], ["dustE", 1], ["dustF", 1],
  ["coarse", COARSE],
];

const OFFSET = {};
let VEC4S = 0;
for (const [name, n] of LAYOUT) {
  OFFSET[name] = VEC4S * 4;
  VEC4S += n;
}
const UNIFORM_BYTES = VEC4S * 16;

const WGSL_STRUCT = `struct U {\n${LAYOUT.map(([n, c]) => (c === 1 ? `  ${n}: vec4f,` : `  ${n}: array<vec4f, ${c}>,`)).join("\n")}\n};\n`;

// ------------------------------------------------------------------ colour

function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16) / 255);
}

function rgbToHex(rgb) {
  return `#${rgb.map((c) => Math.round(Math.min(Math.max(c, 0), 1) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function srgbToOklab(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// ------------------------------------------------------------------ parameters
//
// Lengths are in % of the frame's half-width (100 = edge to centre), angles in degrees,
// rates per second of animation time. `even` numbers stay even so the field's branch
// cuts land on whole lines.

const n = (section, label, d, min, max, step, unit = "", extra = {}) => ({ type: "number", section, label, d, min, max, step, unit, ...extra });
const c = (section, label, d, extra = {}) => ({ type: "color", section, label, d, ...extra });
const s = (section, label, d, options, extra = {}) => ({ type: "select", section, label, d, options, ...extra });
const b = (section, label, d, extra = {}) => ({ type: "bool", section, label, d, ...extra });

// The panel shows the sections this direction reads. The mark lab's others — the calligraphic
// loop, its plates and edge light, the wedges, the flat field, the accents — are left out, and
// their parameters keep the mark lab's values, so the shader sees exactly what it saw there.
const SECTIONS = [
  { id: "small", title: "Small sizes", blurb: "How the icon is drawn: the big icon, its sizes and the icon set. Shrunk, each size is the key visual made small in light, so it keeps the key visual's light. Tuned, the icon takes the tuned look at every size — light, contrast, colour, centre, vignette, dust, gas — and each size is also adjusted for its size, as type has optical sizes (the mark's weight and edge light, soften, sharpen): from nothing at Tuned below to each value here at 16 pt." },
  { id: "window", title: "Loading window", blurb: "The app's first face while it starts: the field fills the window, the living mark is the indicator, and the bar moves on the boot's real stages. The icon's Frame settings stay the icon's." },
  { id: "living", title: "Living mark", blurb: "James's ribbon from the design kit, drawn as the VibeField Identity draws it: a flat band of ink with one half-twist, three lines of light on its single edge. At rest the twist sits on the \\ crossing, a hairline, and the lights hold their places: that is the icon. In motion the twist lingers on each crossing and hurries through the lobes." },
  { id: "dust", title: "Particles", blurb: "The strips made of particles: rows of them along the strips' curves — along Wormhole's rays, so they stream into the singularity — each lit by its strip's light and colour, glittering, travelling along, the strips' own light left under them as a gas.", pattern: "dust" },
  { id: "rings", title: "Strips", blurb: "Dense strips of the palette, laid the way James's interstellar-drive colour tuner lays them: along the singularity's rays (Arms), or round it (Rings).", pattern: "rings dust" },
  { id: "run", title: "Colour run", blurb: "Each strip's colour changes along its length and runs along it, each strip at its own pace.", pattern: "rings dust" },
  { id: "palette", title: "Palette", blurb: "The strips' colours, mixed in OKLab — as strips of light, or as strips made of dust." },
  { id: "well", title: "Well", blurb: "A gravity well seen from above its rim: the strips sink along its wall into the singularity, and turn round it." },
  { id: "light", title: "Light", blurb: "The star at the singularity — its strength, size, core, colour, and where it sits — the vignette, the grain." },
  { id: "frame", title: "Frame", blurb: "The icon's mask and camera. The loading window frames the field by its own height." },
  { id: "motion", title: "Motion", blurb: "Tempo, and a loop length that makes every motion repeat seamlessly." },
];

const PARAMS = {
  // the small sizes (small.js reads these; they never reach the uniforms): each tuning is its
  // value at 16 pt, reached by log size from Tuned below, where the icon is the key visual shrunk
  smallMode: s("small", "Draw", "tuned", ["tuned", "shrunk", "at size"], { hint: "tuned: in the tuned look, each size tuned for its size · shrunk: the key visual made small in light · at size: drawn at its own size" }),
  smFrom: n("small", "Tuned below", 256, 32, 1024, 1, "pt", { hint: "the size tunings (weight, edge light, soften, sharpen) start here and reach their full value at 16 pt" }),
  smLook: b("small", "Look at every size", true, { hint: "the tuned look on the big icon and every size; off, the look grows toward 16 pt with the size tunings, and the big icon is the key visual" }),
  smExposure: n("small", "Exposure", 0.15, -1, 2, 0.01, "EV", { hint: "the field's light, in stops (the mark is white already)" }),
  smContrast: n("small", "Contrast", 0.4, -1, 1, 0.01, "", { hint: "the field's lights up and its darks down (OKLab lightness, about its middle); below 0, flatter" }),
  smColour: n("small", "Colour", 1.25, 0, 2, 0.01, "×", { hint: "the field's chroma" }),
  smGlow: n("small", "Centre light", 0.8, 0, 4, 0.01, "×", { hint: "the star at the singularity, as a share of the look's own" }),
  smGlowSize: n("small", "Centre size", 1, 0.5, 4, 0.01, "×", { hint: "the star's radius" }),
  smVignette: n("small", "Vignette", 1.2, 0, 2, 0.01, "×", { hint: "the dark at the rim, as a share of the look's own" }),
  smDust: n("small", "Dust scale", 1.3, 1, 4, 0.01, "×", { hint: "fewer rows of larger particles: dust finer than a pixel only greys the field" }),
  smGas: n("small", "Gas", 0.25, 0, 1, 0.01, "+", { hint: "more of the strips' smooth light under the particles" }),
  smWeight: n("small", "Mark weight", 1.5, 1, 4, 0.01, "×", { hint: "the ribbon's width: at 16 pt the key visual's ribbon is under a pixel wide (the flat ribbon's hairline and least width hold anyway)" }),
  smEdge: n("small", "Mark edge light", 1, 0, 1, 0.01, "×", { hint: "the three lights: kept at every size (1), or gone at 16 pt (0, the Identity drops them under 32 px)" }),
  smSoften: n("small", "Soften", 0.7, 0, 1.5, 0.01, "px", { hint: "blurs the field (never the mark) over this radius, against speckle" }),
  smSharpen: n("small", "Sharpen", 0, 0, 1, 0.01, "", { hint: "an unsharp mask on the field (never the mark)" }),
  // the loading window (lab.js reads these; they never reach the uniforms): sizes in the
  // window's own points, as a real window measures them
  winLogo: n("window", "Logo size", 96, 32, 240, 1, "px", { hint: "the living mark's width, at the window's real size" }),
  winZoom: n("window", "Field zoom", 1, 0.4, 3, 0.01, "×", { hint: "the field framed by the window's height (1 frames it as the icon does)" }),
  winGlow: n("window", "Centre light", 0.35, 0, 2, 0.01, "×", { hint: "the star at the singularity, as a share of the look's own: at full strength it washes out the logo's crossing" }),
  winBar: n("window", "Bar width", 220, 80, 480, 2, "px", { hint: "DESIGN.md's splash bar is 3 × 220" }),
  winGap: n("window", "Bar below", 40, 12, 160, 1, "px", { hint: "from the window's centre (the logo's crossing) down to the bar" }),
  winShade: n("window", "Shade", 0.55, 0, 1, 0.01, "", { hint: "a soft dark under the bar and its words, in the throat's colour, so they read over the field" }),
  winStage: b("window", "Stage line", true, { hint: "the boot's own words under the bar: waking the daemon … settling" }),
  winSeconds: n("window", "Load time", 6, 1, 30, 0.5, "s", { hint: "the boot's real stages, paced over this long; then the reveal" }),
  // the living mark — packages/design-kit/src/logo/parameters.ts, its Ink looks as defaults
  mark: s("living", "Mark", "living", ["living", "calligraphy"], { hidden: true }),
  // the VibeField Identity's mark (proposal 01, 2026-10-09): its pose, its flat band and its
  // lines of light — "line" and "flat" are its drawing; "rgb" and "tube" are his, as until now
  livPose: s("living", "Pose", "at rest", ["at rest", "in motion", "slow lap"], { hint: "what the icon shows. At rest the twist sits on the \\ crossing and the lights hold their places; the loading window's mark always moves" }),
  livProfile: s("living", "Ribbon", "flat", ["flat", "tube"], { hint: "flat ink, a hairline where it turns edge-on, as the Identity draws it; or his tube" }),
  livShading: s("living", "Shading", "flat", ["flat", "lit"]),
  livEdge: s("living", "Edge light", "line", ["line", "rgb", "soft", "none"], { hint: "line: a line of light on the edge with a glow round it, as the Identity draws it; rgb: bands of colour on the band itself" }),
  livScale: n("living", "Scale", 1, 0.45, 1.4, 0.01),
  livWidth: n("living", "Loop width", 1.08, 0.65, 1.35, 0.01),
  livHeight: n("living", "Loop height", 0.38, 0.18, 0.65, 0.01),
  livThickness: n("living", "Ribbon width", 0.033, 0.015, 0.11, 0.001),
  livTaper: n("living", "Ribbon taper", 0.28, 0, 0.65, 0.01),
  livPinch: n("living", "Pinch", 0.16, 0, 0.8, 0.01),
  livRotation: n("living", "Rotation", -5, -45, 45, 1, "°"),
  livAsymmetry: n("living", "Asymmetry", 0.06, -0.3, 0.3, 0.01),
  livTilt: n("living", "View tilt", 5, -30, 30, 1, "°", { hint: "bounded so both lobes stay in view" }),
  livDepth: n("living", "Loop depth", 0.27, 0, 0.6, 0.01),
  livPerspective: n("living", "Perspective", 0.63, 0, 1.2, 0.01),
  livFocus: n("living", "Twist focus", 0, 0, 1, 0.01, "", { hint: "concentrates the half-turn, keeping a broad open face" }),
  livSpeed: n("living", "Overall speed", 1, 0, 2, 0.01, "×", { hint: "1 is the Identity's pace: 2.4 s from crossing to crossing" }),
  livRoll: n("living", "Circulation speed", 1.32, -2, 2, 0.01, "", { hint: "how fast the half-turn travels round the loop" }),
  livLinger: n("living", "Twist linger", 0.82, 0, 1, 0.01, "", { hint: "the twist rests on each crossing and hurries through the lobes" }),
  livRestTwist: n("living", "Twist at rest", 0, -180, 180, 1, "°", { hint: "where the half-twist rests, round the loop from the \\ crossing: 180° is the / crossing" }),
  livRestLights: n("living", "Lights at rest", 0.9345, 0, 1, 0.0005, "", { hint: "where the three lights rest along the edge (1 is the whole edge, twice round the loop)" }),
  livBreathe: n("living", "Breathing", 0.07, 0, 1, 0.01),
  livEdgeWidth: n("living", "Edge width", 0.22, 0.02, 0.4, 0.01),
  livEdgeFlow: n("living", "Light strength", 1.4, 0, 2, 0.01),
  livEdgeSpeed: n("living", "Travel speed", -2.62, -3, 3, 0.01),
  livEdgeLength: n("living", "Segment length", 1, 0.05, 1, 0.01),
  livEdgePulses: n("living", "Segment count", 3, 1, 8, 1),
  livLineGlow: n("living", "Line glow", 0.16, 0, 0.6, 0.01, "", { hint: "the glow round each line of light (the Identity's 16%)" }),
  livLineGlowWidth: n("living", "Glow width", 4.2, 1, 10, 0.1, "×", { hint: "the glow's width, in line widths" }),
  livHairline: n("living", "Hairline", 0.6, 0, 3, 0.05, "px", { hint: "the flat ribbon's outline: where it turns edge-on, the line it leaves" }),
  livMinWidth: n("living", "Least width", 1, 0, 6, 0.1, "px", { hint: "the flat ribbon is never narrower than this face-on, in pixels of the icon" }),
  livGlow: n("living", "Ribbon glow", 0.1, 0, 1, 0.01),
  livSpectral: n("living", "Spectral edge", 0, 0, 1, 0.01, "", { hint: "the soft edge's rim width" }),
  livPearl: n("living", "Pearlescence", 0, 0, 1, 0.01, "", { hint: "lit shading takes the light's colours as it turns" }),
  livDrift: n("living", "Color drift", 0.2, 0, 1, 0.01, "", { hint: "the soft edge's colours drift along it" }),
  livColorA: c("living", "Rose", "#FF0054"),
  livColorB: c("living", "Cobalt", "#083CFF"),
  livColorC: c("living", "Amber", "#FFAB53"),
  livColorD: c("living", "Mint", "#00F59B"),
  // loop
  span: n("loop", "Span", 81.8, 30, 98, 0.1, "%"),
  height: n("loop", "Height", 0.93, 0.3, 1.6, 0.01, "×"),
  pinch: n("loop", "Pinch", 0.86, 0, 2, 0.01, "", { hint: "0 Gerono · 1 Bernoulli" }),
  balance: n("loop", "Lobe balance", 0.011, -0.3, 0.3, 0.001),
  lean: n("loop", "Lean", 0.018, -0.5, 0.5, 0.001),
  tilt: n("loop", "Tilt", 0, -45, 45, 0.1, "°"),
  markX: n("loop", "Offset x", 0, -50, 50, 0.1, "%"),
  markY: n("loop", "Offset y", 0, -50, 50, 0.1, "%"),
  breathe: n("loop", "Breathe", 0, 0, 6, 0.1, "%"),
  breatheHz: n("loop", "Breathe rate", 0.1, 0, 1, 0.01, "Hz"),
  // weight
  weight: n("weight", "Weight", 6.4, 0.3, 24, 0.05, "%", { hint: "full width at the heaviest point" }),
  contrast: n("weight", "Contrast", 0.29, 0, 1, 0.01),
  contrastAt: n("weight", "Heaviest at", 90, 0, 360, 1, "°", { hint: "90 = the / pass" }),
  contrastSpin: n("weight", "Weight travel", 0, -120, 120, 0.5, "°/s"),
  taperSlash: n("weight", "Taper at /", 0, 0, 1, 0.01),
  taperBack: n("weight", "Taper at \\", 1, 0, 1, 0.01),
  taperLength: n("weight", "Taper length", 30, 3, 120, 1, "°"),
  taperTravel: n("weight", "Taper offset", 0, -180, 180, 1, "°"),
  taperSpin: n("weight", "Taper travel", 0, -120, 120, 0.5, "°/s"),
  hairline: n("weight", "Hairline", 0.04, 0, 0.6, 0.005, "×"),
  optical: n("weight", "Optical minimum", 0, 0, 4, 0.1, "px", { hint: "keeps hairlines alive at small sizes" }),
  crossing: s("weight", "Crossing", "/ on top", ["/ on top", "\\ on top", "flat"]),
  gap: n("weight", "Crossing gap", 0, 0, 4, 0.05, "%"),
  crossRadius: n("weight", "Crossing reach", 14, 2, 40, 0.5, "%"),
  // ribbon
  ribbon: n("ribbon", "Ribbon", 0, 0, 1, 0.01, "", { hint: "0 calligraphy · 1 twisted band" }),
  halfTwists: n("ribbon", "Half-twists", 1, 0, 6, 1),
  twist: n("ribbon", "Twist phase", -45, -180, 180, 1, "°"),
  twistSpin: n("ribbon", "Twist travel", 0, -180, 180, 1, "°/s", { hint: "the thin point's speed round the loop; 360° is one circuit" }),
  twistEase: n("ribbon", "Linger", 0.3, 0, 0.45, 0.01, "", { hint: "holds the classic pose, hurries through the lobes" }),
  surge: n("ribbon", "Surge", 0.6, 0, 3, 0.01, "", { hint: "split and edge light swell while the twist travels" }),
  edge: n("ribbon", "Edge", 0.05, 0, 0.6, 0.01, "×"),
  shade: n("ribbon", "Shading", 0.65, 0, 1, 0.01),
  lightAt: n("ribbon", "Light from", 125, 0, 360, 1, "°"),
  sheen: n("ribbon", "Sheen", 0.35, 0, 1.5, 0.01),
  backInk: c("ribbon", "Back ink", "#9DB4FF"),
  backMix: n("ribbon", "Back ink mix", 0, 0, 1, 0.01, "", { hint: "needs an even number of half-twists" }),
  // ink
  ink: c("living", "Ink", "#FFFFFF", { hint: "the ribbon's colour" }),
  inkAlpha: n("ink", "Opacity", 1, 0, 1, 0.01),
  glint: n("ink", "Glint", 0, 0, 1, 0.01),
  glintInk: c("ink", "Glint ink", "#3CF08E"),
  glintLength: n("ink", "Glint length", 35, 5, 180, 1, "°"),
  glintTail: n("ink", "Glint tail", 2, 0, 8, 0.1, "×"),
  glintSpin: n("ink", "Glint speed", 60, -360, 360, 1, "°/s"),
  grainOnInk: b("ink", "Grain on the loop", false),
  // edge light
  edgeGlow: n("edge", "Edge light", 0, 0, 2, 0.01),
  edgeCore: n("edge", "Line width", 0.3, 0.05, 3, 0.01, "%"),
  edgeHalo: n("edge", "Halo", 1.1, 0.1, 8, 0.05, "%"),
  edgeTint: n("edge", "On the band", 0.3, 0, 1, 0.01, "", { hint: "how much the halo tints the band itself" }),
  edgeInk1: c("edge", "Edge ink 1", "#FF0044"),
  edgeInk2: c("edge", "Edge ink 2", "#00FF9D"),
  edgeInk3: c("edge", "Edge ink 3", "#0040FF"),
  edgeRepeat: n("edge", "Gradient repeats", 1, 1, 6, 1, "", { hint: "per full edge (twice round the loop)" }),
  edgeFlow: n("edge", "Colour flow", 60, -360, 360, 1, "°/s"),
  comet: n("edge", "Comet", 0.8, 0, 4, 0.01),
  cometLength: n("edge", "Comet length", 0.06, 0.01, 0.5, 0.005, "", { hint: "share of the whole edge" }),
  cometSpin: n("edge", "Comet speed", 150, -720, 720, 1, "°/s"),
  iridescence: n("edge", "Iridescence", 0, 0, 1, 0.01, "", { hint: "the band takes the edge inks as it turns edge-on" }),
  plateGlow: n("edge", "Plate glow", 0, 0, 2, 0.01, "", { hint: "each registration plate glows in its ink" }),
  plateGlowWidth: n("edge", "Plate glow width", 1, 0.1, 6, 0.05, "%"),
  // registration
  plates: b("plates", "Plates", true),
  plateMode: s("plates", "Mode", "print", ["print", "light", "overprint"]),
  plateAlpha: n("plates", "Opacity", 1, 0, 1, 0.01),
  inkA: c("plates", "Plate 1 ink", "#FF0044"),
  aX: n("plates", "Plate 1 x", -0.5, -6, 6, 0.05, "%"),
  aY: n("plates", "Plate 1 y", 0.2, -6, 6, 0.05, "%"),
  aSpread: n("plates", "Plate 1 spread", 0, -1, 2, 0.02, "%"),
  aWarp: n("plates", "Plate 1 warp", 0.25, 0, 4, 0.05, "%"),
  inkB: c("plates", "Plate 2 ink", "#00FF9D"),
  bX: n("plates", "Plate 2 x", 0.35, -6, 6, 0.05, "%"),
  bY: n("plates", "Plate 2 y", 0.55, -6, 6, 0.05, "%"),
  bSpread: n("plates", "Plate 2 spread", 0, -1, 2, 0.02, "%"),
  bWarp: n("plates", "Plate 2 warp", 0.25, 0, 4, 0.05, "%"),
  inkC: c("plates", "Plate 3 ink", "#0040FF"),
  cX: n("plates", "Plate 3 x", -0.35, -6, 6, 0.05, "%"),
  cY: n("plates", "Plate 3 y", -0.3, -6, 6, 0.05, "%"),
  cSpread: n("plates", "Plate 3 spread", 0, -1, 2, 0.02, "%"),
  cWarp: n("plates", "Plate 3 warp", 0.25, 0, 4, 0.05, "%"),
  warpScale: n("plates", "Warp scale", 2.5, 0.2, 12, 0.1, "×"),
  warpSpeed: n("plates", "Warp drift", 0.08, 0, 2, 0.01),
  plateSpin: n("plates", "Plate orbit", 0, -90, 90, 0.5, "°/s"),
  plateBreath: n("plates", "Plate breath", 0.25, 0, 1, 0.01),
  plateBreathHz: n("plates", "Breath rate", 0.12, 0, 2, 0.01, "Hz"),
  inkFlow: n("plates", "Ink flow", 0, 0, 1, 0.01, "", { hint: "the three inks travel round the loop's edges (print and overprint plates); 0 keeps each plate in its own ink" }),
  inkFlowSpeed: n("plates", "Ink flow speed", 30, -360, 360, 1, "°/s", { hint: "360° is one turn of all three inks round the loop" }),
  inkCycles: n("plates", "Ink cycles", 1, 1, 6, 1, "", { hint: "how many times the three inks go round the loop" }),
  // field
  ground: s("field", "Ground", "well", ["well", "flat", "dots", "solid", "none"]),
  lines: n("field", "Lines per turn", 720, 60, 2400, 2, "", { even: true }),
  lineWidth: n("field", "Line width", 0.3, 0.02, 0.98, 0.01, "×"),
  lineContrast: n("field", "Line contrast", 0.42, 0, 1, 0.01),
  lineInk: c("field", "Line ink", "#FFFFFF"),
  flowSpin: n("well", "Rotation", 1.5, -60, 60, 0.1, "°/s", { hint: "the lines turn round the singularity" }),
  lineTone: n("field", "Line tone", 0, 0, 1, 0.01, "", { hint: "0 draws the lines in their ink; 1 in the field's own colour, tone on tone" }),
  lineLift: n("field", "Line lift", 0.08, -0.4, 0.4, 0.01, "", { hint: "tone-on-tone lines: lighter (+) or darker (−) than the field" }),
  moire: n("well", "Filter", 1, 0.1, 2, 0.01, "×", { hint: "how early fine strips fade to their mean; below 1 lets moiré through" }),
  fieldX: n("well", "Singularity x", 0, -50, 50, 0.1, "%"),
  fieldY: n("well", "Singularity y", 0, -50, 50, 0.1, "%"),
  // the well
  wellDepth: n("well", "Depth", 0.35, 0.02, 2, 0.01, "", { hint: "how steeply the wall falls" }),
  wellPower: n("well", "Profile", 1, 0.3, 3, 0.01, "", { hint: "1 = the Newtonian −1/r well" }),
  wellThroat: n("well", "Throat", 0, 0, 0.5, 0.005, "", { hint: "0 sinks to a point" }),
  wellHeight: n("well", "Camera height", 1, 0.2, 4, 0.01),
  wellFov: n("well", "Field of view", 70, 10, 140, 1, "°"),
  wellTilt: n("well", "Tilt", 6, 0, 80, 0.5, "°", { hint: "0 looks straight down: straight lines" }),
  wellAzimuth: n("well", "Tilt toward", 90, -180, 180, 1, "°"),
  wellShift: n("well", "Aim", 1, 0, 2, 0.01, "×", { hint: "1 aims the camera at the rim's centre" }),
  wellSquash: n("well", "Throat squash", 1.8, -0.9, 3, 0.01, "", { hint: "the throat flattens with depth: side lines fan into arcs" }),
  wellSpin: n("well", "Frame dragging", 0, -3, 3, 0.01, "", { hint: "lines twist as they sink" }),
  wellFog: n("well", "Depth fog", 0.25, 0, 3, 0.01),
  throatInk: c("well", "Throat ink", "#FFF3EA"),
  throatMix: n("well", "Throat", 1, 0, 1, 0.01),
  wellShade: n("well", "Wall light", 0.25, 0, 1, 0.01),
  wellLightAt: n("well", "Light from", 120, 0, 360, 1, "°"),
  ringGain: n("well", "Photon ring", 0, 0, 2, 0.01),
  ringAt: n("well", "Ring depth", -1.6, -8, 2, 0.01, "ln r"),
  ringWidth: n("well", "Ring width", 0.25, 0.02, 2, 0.01),
  ringInk: c("well", "Ring ink", "#FFD9A0"),
  horizon: n("well", "Event horizon", -8, -8, 1, 0.01, "ln r", { hint: "below this depth the well goes the throat's colour, with a sharp edge; −8 is off" }),
  // the flat field
  qCenter: n("charges", "Crossing charge", 1, -2, 2, 1),
  qLeft: n("charges", "Left charge", 0, -2, 2, 1, "", { hint: "at the left focus" }),
  qRight: n("charges", "Right charge", 0, -2, 2, 1, "", { hint: "at the right focus" }),
  focus: n("charges", "Focus distance", 57.8, 5, 95, 0.1, "%", { hint: "Bernoulli foci sit at span ÷ √2" }),
  swirl: n("charges", "Swirl", 0.12, -1.5, 1.5, 0.01),
  // accents
  accents: n("accents", "Accent lines", 48, 0, 240, 2, "", { even: true }),
  accentChance: n("accents", "Share lit", 0.3, 0, 1, 0.01),
  accentWidth: n("accents", "Width", 0.9, 0.05, 6, 0.05, "lines"),
  accentGain: n("accents", "Strength", 0.9, 0, 1, 0.01),
  accentSeed: n("accents", "Seed", 7, 0, 999, 1),
  acc1: c("accents", "Accent 1", "#FFFFFF"),
  acc1w: n("accents", "Accent 1 weight", 1, 0, 1, 0.01),
  acc2: c("accents", "Accent 2", "#3CF08E"),
  acc2w: n("accents", "Accent 2 weight", 1, 0, 1, 0.01),
  acc3: c("accents", "Accent 3", "#FF2D55"),
  acc3w: n("accents", "Accent 3 weight", 1, 0, 1, 0.01),
  acc4: c("accents", "Accent 4", "#2A5BFF"),
  acc4w: n("accents", "Accent 4 weight", 1, 0, 1, 0.01),
  // palette
  pattern: s("palette", "Pattern", "dust", ["rings", "dust"], { hint: "rings lays the strips as light; dust makes them of particles" }),
  invert: b("palette", "Invert", false, { hint: "the field's negative: every colour turned over, light for dark, the mark left in its own ink (Obsidian Light)" }),
  pal1: c("palette", "Stop 1", "#7C86D6"),
  pal2: c("palette", "Stop 2", "#F2553F"),
  pal3: c("palette", "Stop 3", "#EF5D8D"),
  pal4: c("palette", "Stop 4", "#233E86"),
  pal5: c("palette", "Stop 5", "#FA5CAE"),
  pal6: c("palette", "Stop 6", "#FECFA0"),
  pal7: c("palette", "Stop 7", "#B3C3D6"),
  pal8: c("palette", "Stop 8", "#F0508F"),
  pal9: c("palette", "Stop 9", "#4A7FA6"),
  pal10: c("palette", "Stop 10", "#E785BE"),
  pal11: c("palette", "Stop 11", "#FF8A4C"),
  pal12: c("palette", "Stop 12", "#C93F7E"),
  palCount: n("palette", "Stops used", 12, 2, 12, 1),
  bands: n("palette", "Repeats per turn", 1, 1, 12, 1, "", { hidden: true }),
  palNoise: n("palette", "Irregularity", 0.3, 0, 3, 0.01, "", { hidden: true }),
  palNoiseFreq: n("palette", "Irregularity scale", 7, 1, 24, 1, "", { hidden: true }),
  palSeed: n("palette", "Seed", 3, 0, 999, 1, "", { hidden: true }),
  palSpin: n("palette", "Wedge rotation", 0.8, -30, 30, 0.1, "°/s", { hidden: true }),
  innerShift: n("palette", "Inner shift", 0.04, -1, 1, 0.01, "", { hidden: true }),
  innerLight: n("palette", "Inner light", 0.16, 0, 1, 0.01, "", { hidden: true }),
  radialMid: n("palette", "Inner reach", -1.1, -4, 1, 0.01, "ln r", { hidden: true }),
  radialSoft: n("palette", "Inner blend", 0.9, 0.05, 3, 0.01, "", { hidden: true }),
  sharpness: n("palette", "Stop edges", 0.3, 0, 0.98, 0.01, "", { hint: "0 blends each stop into the next; higher keeps each colour to itself" }),
  saturation: n("palette", "Saturation", 1.08, 0, 2, 0.01, "×"),
  lobeShift: n("palette", "Lobe hue shift", 0, -1, 1, 0.01, "", { hint: "moves the palette inside the loops", hidden: true }),
  lobeDim: n("palette", "Lobe dim", 0, -1, 1, 0.01, "", { hint: "darkens (+) or lightens (−) inside the loops", hidden: true }),
  seamGlow: n("palette", "Seam light", 0, 0, 1.5, 0.01, "", { hint: "where two colour fields meet, the edge breathes light", hidden: true }),
  seamWidth: n("palette", "Seam width", 0.05, 0.005, 0.3, 0.005, "stops", { hidden: true }),
  seamInk: c("palette", "Seam ink", "#E8C98B", { hidden: true }),
  seamMix: n("palette", "Seam ink mix", 0, 0, 1, 0.01, "", { hint: "0 lifts each seam's own colours; 1 lays the seam ink into it", hidden: true }),
  metalSheen: n("palette", "Metal sheen", 0, 0, 1, 0.01, "", { hint: "metal inks (seams, accents, the ring) brighten toward the light and go bronze away from it", hidden: true }),
  // rings (round 10): James's interstellar-drive colour tuner, laid on the black hole
  ringStrips: n("rings", "Strips", 96, 8, 400, 4, "", { hint: "the coarsest strips in one turn of the palette; each octave of detail adds strips ×2.31 finer" }),
  ringRadial: n("rings", "Rings", 0.65, 0, 3, 0.01, "/ln r", { hint: "turns of the palette per unit of depth; 0 runs the strips along the rays" }),
  ringArms: n("rings", "Arms", 0, 0, 12, 1, "", { hint: "turns of the palette round the singularity: 0 keeps the rings concentric, more winds them into spirals" }),
  ringSpacing: n("rings", "Spacing", 0, 0, 3, 0.01, "", { hint: "0 spaces the rings evenly in the well's depth, so they crowd into the singularity; higher evens them out, like a disc" }),
  ringDetail: n("rings", "Detail", 5, 1, 7, 1, "", { hint: "octaves of finer strips (the tuner's detail)" }),
  ringContrast: n("rings", "Sharpness", 1.8, 0.3, 4, 0.01, "", { hint: "bright strips against dark gaps (the tuner's sharpness)" }),
  ringBright: n("rings", "Brightness", 1, 0.3, 3, 0.01, "×", { hint: "1 is the palette as designed, on average; the tuner's brightness" }),
  ringIrregular: n("rings", "Irregularity", 1, 0, 3, 0.01, "", { hint: "the strips' widths wander; 1 is the tuner's" }),
  ringFloor: n("rings", "Dark floor", 0.3, 0, 1, 0.01, "", { hint: "how far the dark between strips falls: coloured, not black" }),
  ringScatter: n("rings", "Colour scatter", 1.5, 0, 6, 0.01, "stops", { hint: "each strip takes its own colour from the stops round its place in the palette" }),
  ringVary: n("rings", "Strip light", 0.35, 0, 0.5, 0.01, "", { hint: "each strip its own brightness" }),
  ringHair: n("rings", "Hairlines", 0.3, 0, 1, 0.01, "", { hint: "share of the strips with a thin bright line" }),
  ringHairInk: c("rings", "Hairline ink", "#FFFFFF"),
  ringGaps: n("rings", "Divisions", 0.2, 0, 1, 0.01, "", { hint: "dark gaps between the ringlets, like Cassini's" }),
  ringWobble: n("rings", "Wobble", 0.6, 0, 6, 0.01, "strips", { hint: "each ring wanders across its width along its length" }),
  ringWobbleScale: n("rings", "Wobble scale", 5, 1, 24, 1, "", { hint: "wanders round the turn" }),
  ringShine: n("rings", "Shine", 0.35, 0, 1, 0.01, "", { hint: "the brightest strips burn to white instead of clipping" }),
  ringSeed: n("rings", "Seed", 5, 0, 999, 1),
  ringFlow: n("rings", "Flow", 0.04, -0.5, 0.5, 0.005, "ln r/s", { hint: "the rings rise out of the singularity (+) or sink into it (−)" }),
  ringSync: n("rings", "Per crossing", 0, 0, 12, 1, "", { hint: "locks the flow to the twist: the rings move on this many palette stops at each crossing" }),
  // colour run (round 11): each strip's colour waves along its length, and the waves run
  runAmount: n("run", "Colour change", 1.5, 0, 4, 0.01, "stops", { hint: "how far each strip's colour wanders through the palette along its length; 0 holds each strip one colour" }),
  runWaves: n("run", "Waves", 5, 1, 24, 1, "", { hint: "colour waves round the turn — as long along the rays" }),
  runSpeed: n("run", "Run", 0.12, -1, 1, 0.01, "Hz", { hint: "waves a second passing any point: + runs round counter-clockwise and out along the rays" }),
  runPace: n("run", "Strip pace", 0.6, 0, 1, 0.01, "", { hint: "each strip runs at its own pace, so neighbours slide past each other; 0 runs them together" }),
  // dust (round 12): the strips made of particles — rows along the strips, places along the rows
  dustRows: n("dust", "Rows", 120, 8, 640, 4, "", { hint: "rows of particles in one turn of the palette; they follow the strips' curves (Strips counts the strips themselves)" }),
  dustSpacing: n("dust", "Spacing", 1, 0.25, 4, 0.01, "×", { hint: "how far apart the particles sit along a row: 1 is as far as the rows are apart" }),
  dustFill: n("dust", "Fill", 0.75, 0, 1, 0.01, "", { hint: "the share of places that hold a particle" }),
  dustSize: n("dust", "Size", 0.45, 0.05, 1.6, 0.01, "", { hint: "a particle's diameter, in rows; never drawn under a pixel — a smaller one dims instead" }),
  dustSizeVary: n("dust", "Size spread", 0.5, 0, 1.5, 0.01),
  dustScatter: n("dust", "Scatter", 0.6, 0, 1, 0.01, "", { hint: "how far a particle strays from its row: 0 strings them along the rows like beads" }),
  dustStreak: n("dust", "Streak", 0, 0, 16, 0.01, "", { hint: "draws each particle out along its strip — up to 17 times its width — as far as its place allows (Spacing gives it room)" }),
  dustGlow: n("dust", "Glow", 3, 0, 10, 0.01, "×", { hint: "how bright a particle burns against its strip; the brightest burn to white (Shine)" }),
  dustSparkle: n("dust", "Sparkle", 0.6, 0, 3, 0.01, "", { hint: "a few particles far brighter than the rest" }),
  dustGlitter: n("dust", "Glitter", 1.5, 0, 12, 0.01, "stops", { hint: "each particle takes its own colour round its strip's place in the palette" }),
  dustTint: n("dust", "Tint", 0.4, 0, 1, 0.01, "", { hint: "dark colours light up as particles: 1 gives every particle a light tint of its colour" }),
  dustLift: n("dust", "In the gaps", 0, 0, 1, 0.01, "", { hint: "particles shine in the dark between the strips too, like stars" }),
  dustGas: n("dust", "Gas", 0.3, 0, 1, 0.01, "", { hint: "the strips' continuous light left under the particles" }),
  dustGasOut: n("dust", "Gas outward", 1, 0, 1, 0.01, "", { hint: "how much of the gas (and its hairlines) is left at the rim: lower leaves the outer dust on black" }),
  dustOrbit: n("dust", "Orbit", 0.6, -6, 6, 0.01, "/s", { hint: "particles travel along their strips, places a second: + counter-clockwise and out along the rays" }),
  dustPace: n("dust", "Row pace", 0.6, 0, 1, 0.01, "", { hint: "each row travels at its own pace, so neighbours slide past each other; 0 moves them together" }),
  dustTwinkle: n("dust", "Twinkle", 0.3, 0, 1, 0.01),
  dustTwinkleRate: n("dust", "Twinkle rate", 0.5, 0.05, 3, 0.01, "Hz"),
  dustSeed: n("dust", "Seed", 3, 0, 999, 1),
  // rising colour
  riseRate: n("rise", "Rate", 0, -1, 1, 0.01, "Hz", { hint: "how fast the colour flows out: palette stops per second; negative flows it in" }),
  riseSync: n("rise", "Per crossing", 0, 0, 4, 1, "", { hint: "locks the flow to the twist: each ray moves on this many stops each time the twist passes a crossing" }),
  riseSpacing: n("rise", "Spacing", 0.8, 0.2, 6, 0.01, "/ln r", { hint: "palette stops per unit of depth along each ray" }),
  riseWarp: n("rise", "Wander", 0.3, 0, 1.5, 0.01, "", { hint: "noise puts neighbouring rays a little out of step, in stops" }),
  riseCells: n("rise", "Wander scale", 5, 1, 16, 1, "", { hint: "how many turns of the wander round the turn" }),
  riseSwirl: n("rise", "Swirl", 0.8, 0, 2, 0.01, "", { hint: "the wander folds into swirls, like ink in water" }),
  // light
  glow: n("light", "Glow", 0.62, 0, 2, 0.01),
  glowRadius: n("light", "Glow radius", 22, 1, 120, 0.5, "%"),
  glowCore: n("light", "Glow core", 0.8, 0, 2, 0.01),
  glowInk: c("light", "Glow ink", "#FFF1E6"),
  glowX: n("light", "Glow x", 0, -50, 50, 0.1, "%", { hint: "the centre light's offset from the singularity, right is +, in the same units as Singularity x" }),
  glowY: n("light", "Glow y", 0, -50, 50, 0.1, "%", { hint: "the centre light's offset from the singularity, up is +" }),
  pulse: n("light", "Pulses", 0, 0, 1, 0.01, "", { hidden: true }),
  pulseFreq: n("light", "Pulse spacing", 2.5, 0.2, 12, 0.05, "/ln r", { hidden: true }),
  pulseSpeed: n("light", "Pulse speed", 0.25, -3, 3, 0.01, "Hz", { hint: "negative sinks into the singularity", hidden: true }),
  pulseSync: n("light", "Rings per crossing", 0, 0, 4, 1, "", { hint: "locks the pulses to the twist: a ring sinks each time it passes a crossing", hidden: true }),
  pulseSharp: n("light", "Pulse sharpness", 3, 0.5, 24, 0.1, "", { hidden: true }),
  vignette: n("light", "Vignette", 0.16, 0, 1, 0.01),
  vignetteAt: n("light", "Vignette from", 95, 0, 160, 1, "%"),
  grain: n("light", "Grain", 0.06, 0, 0.4, 0.005),
  grainSize: n("light", "Grain size", 1, 1, 6, 0.5, "px"),
  grainFps: n("light", "Grain rate", 12, 0, 60, 1, "fps"),
  // frame
  mask: s("frame", "Mask", "iOS", ["square", "iOS", "macOS", "circle"], { hint: "iOS is full-bleed; macOS insets to 824 of 1024" }),
  squircle: n("frame", "Squircle exponent", 5, 2, 12, 0.1),
  shadow: n("frame", "macOS shadow", 0.35, 0, 1, 0.01),
  zoom: n("frame", "Zoom", 1, 0.3, 4, 0.01, "×"),
  spin: n("frame", "Rotate view", 0, -180, 180, 0.1, "°"),
  panX: n("frame", "Pan x", 0, -100, 100, 0.1, "%"),
  panY: n("frame", "Pan y", 0, -100, 100, 0.1, "%"),
  groundInk: c("frame", "Ground ink", "#FFFFFF", { hidden: true }),
  dotInk: c("frame", "Dot ink", "#C7C7C7", { hidden: true }),
  dotAlpha: n("frame", "Dot opacity", 1, 0, 1, 0.01, "", { hidden: true }),
  dotPitch: n("frame", "Dot pitch", 12.84, 2, 40, 0.01, "%", { hidden: true }),
  dotSize: n("frame", "Dot radius", 1.28, 0.1, 6, 0.01, "%", { hidden: true }),
  // motion
  tempo: n("motion", "Tempo", 1, 0, 4, 0.01, "×"),
  loopSeconds: n("motion", "Loop length", 0, 0, 60, 1, "s", { hint: "0 runs free; otherwise every motion repeats exactly" }),
};

const DEFAULTS = Object.fromEntries(Object.entries(PARAMS).map(([k, p]) => [k, p.d]));

// ------------------------------------------------------------------ presets

// The mark lab's Wormhole (draft/mark, round 10; v14), value for value: the anchor of this lab.
// Every look here starts from it with its strips made of dust — Wormhole switched to dust is
// what James chose to explore (2026-10-08).
const WORMHOLE = {
  pal1: "#070A1C", pal2: "#14205C", pal3: "#232379", pal4: "#1C389B", pal5: "#2A66A2", pal6: "#6268B4",
  pal7: "#8EC4EA", pal8: "#DFE3FF", pal9: "#9796D2", pal10: "#6552AE", pal11: "#303A77", pal12: "#10132C",
  palCount: 12, sharpness: 0.12, saturation: 1, palNoise: 0,
  ringArms: 4, ringRadial: 0.1, ringStrips: 72, ringHairInk: "#FF9EC8",
  lineContrast: 0, accents: 0, wellSpin: 0.5,
  throatInk: "#04050F", throatMix: 1, wellFog: 0.6, wellShade: 0.3,
  glow: 0.55, glowRadius: 9, glowCore: 1.4, glowInk: "#DCE6FF", vignette: 0.35, grain: 0.03,
};

// `tone` is how a palette renders on the look (palettes.js): every look here is laid in strips.
const PRESETS = [
  {
    id: "wormhole",
    name: "Wormhole",
    tone: "rings",
    blurb: "The mark lab's Wormhole with its strips made of dust: rows of particles along four sheets of blue, ice and lavender, streaming out along the rays from a white star.",
    values: { ...WORMHOLE, pattern: "dust" },
  },
  {
    id: "warp",
    name: "Warp",
    tone: "rings",
    blurb: "The dust drawn out into long streaks over the dark, travelling fast out along the rays, each row at its own pace: the starfield at warp speed.",
    values: {
      ...WORMHOLE, pattern: "dust",
      dustRows: 160, dustSpacing: 4, dustFill: 0.4, dustSize: 0.2, dustSizeVary: 0.5, dustScatter: 0.15, dustStreak: 14,
      dustGlow: 5, dustSparkle: 1, dustOrbit: 3, dustPace: 0.8, dustTwinkle: 0.1, dustGas: 0.12, dustGasOut: 0.3,
    },
  },
  {
    id: "deep",
    name: "Deep field",
    tone: "rings",
    blurb: "Fewer, finer points, and stars in the dark between the strips: the gas gone from the rim, so the outer dust hangs on black.",
    values: {
      ...WORMHOLE, pattern: "dust",
      dustRows: 96, dustFill: 0.5, dustSize: 0.3, dustSizeVary: 1, dustScatter: 1, dustGlow: 4, dustSparkle: 1.4,
      dustLift: 0.35, dustGas: 0.25, dustGasOut: 0.05, dustOrbit: 0.4, dustTwinkle: 0.5,
      vignette: 0.45,
    },
  },
  {
    id: "nebula",
    name: "Nebula",
    tone: "rings",
    blurb: "More of the strips' own light left as gas, softer and larger dust, the colours scattered wider and running along the strips.",
    values: {
      ...WORMHOLE, pattern: "dust",
      dustRows: 72, dustSize: 0.62, dustSizeVary: 0.9, dustScatter: 0.8, dustGlow: 2.2, dustSparkle: 0.5, dustGlitter: 3,
      dustGas: 0.6, dustOrbit: 0.3, ringScatter: 2.5, runAmount: 2.5, wellSpin: 0.9,
    },
  },
];

function presetValues(id) {
  const pr = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
  return { ...DEFAULTS, ...pr.values };
}

// Looks saved before the Identity's drawing came (2026-10-09) carry no `livPose`. Where they
// hold his old defaults — the rgb edge, speed 2 — they take the Identity's; a look tuned away
// from those keeps its own.
const BEFORE_IDENTITY = { livEdge: ["rgb", "line"], livSpeed: [2, 1] };

// Tolerant reader: known keys only, clamped, typed. Returns the params and what it dropped.
function normalize(input) {
  const out = { ...DEFAULTS };
  const dropped = [];
  const old = Boolean(input) && typeof input === "object" && !("livPose" in input) && ("livEdge" in input || "livSpeed" in input);
  for (const [k, v] of Object.entries(input ?? {})) {
    const p = PARAMS[k];
    if (!p) {
      dropped.push(k);
      continue;
    }
    if (p.type === "number") {
      let x = Number(v);
      if (!Number.isFinite(x)) continue;
      x = Math.min(Math.max(x, p.min), p.max);
      if (p.step >= 1) x = Math.round(x);
      if (p.even) x = Math.round(x / 2) * 2;
      out[k] = x;
    } else if (p.type === "color") {
      if (/^#?[0-9a-fA-F]{6}$/.test(String(v))) out[k] = `#${String(v).replace("#", "").toUpperCase()}`;
    } else if (p.type === "select") {
      const legacy = k === "ground" && v === "field" ? "flat" : v; // before 2026-09-22's well
      if (p.options.includes(legacy)) out[k] = legacy;
    } else if (p.type === "bool") {
      out[k] = Boolean(v);
    }
  }
  if (old) for (const [k, [was, now]] of Object.entries(BEFORE_IDENTITY)) if (out[k] === was) out[k] = now;
  return { params: out, dropped };
}

// ------------------------------------------------------------------ time → phases

const DEG = Math.PI / 180;
const wrapTau = (a) => a - 2 * Math.PI * Math.floor(a / (2 * Math.PI));

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

function animate(P, seconds) {
  const L = P.loopSeconds;
  const t = L > 0 ? seconds - L * Math.floor(seconds / L) : seconds;
  // In loop mode every rate is quantised so its motion completes whole periods in L —
  // each motion's OWN period, so a slow rotation still moves: the lines repeat every
  // 360°/gcd(lines, accents), the band's width every 180° of twist.
  const quant = (degPerSec, period) => (L > 0 ? (Math.round((degPerSec * L) / period) * period) / L : degPerSec);
  const rot = (degPerSec, period = 360) => wrapTau(quant(degPerSec, period) * t * DEG);
  const hz = (f) => (L > 0 ? Math.round(f * L) / L : f);
  const osc = (f) => Math.sin(2 * Math.PI * hz(f) * t);
  const cyc = (f) => {
    const x = hz(f) * t;
    return x - Math.floor(x);
  };
  const turns = (degPerSec, period = 720) => {
    const x = (quant(degPerSec, period) * t) / period;
    return x - Math.floor(x);
  };
  const linePeriod = 360 / gcd(P.lines, P.accents > 0 ? P.accents : P.lines);
  const flow = rot(P.flowSpin, linePeriod);
  // the wedges ride the field angle, so their own rotation is the net turn minus the flow
  const palRot = wrapTau(rot(P.flowSpin + P.palSpin) - flow);
  const R = 4; // radius of the warp field's circular drift, in noise cells
  let w = P.warpSpeed / R; // rad/s
  if (L > 0 && w > 0) w = (Math.max(1, Math.round((w * L) / (2 * Math.PI))) * 2 * Math.PI) / L;
  const fps = P.grainFps;
  let grainSeed = fps > 0 ? Math.floor(t * fps) : 0;
  if (L > 0 && fps > 0) grainSeed %= Math.max(1, Math.round(L * fps));

  // The twist: the band's thin point travels the loop. Eased, it lingers where the mark is
  // itself (thin at a crossing) and hurries through the lobes: position u − ease·sin 2u.
  // `energy` is that hurry (0 at rest, 1 mid-lobe) and drives the surge, so the colour split
  // and the edge light swell with the motion and settle with it. A Möbius edge only repeats
  // after two circuits (its colours swap sides each one), so loops quantise travel to 720°.
  const k = Math.max(P.halfTwists, 1);
  const travel = quant(P.twistSpin, 720 / k) * t * DEG;
  const eased = travel - P.twistEase * Math.sin(2 * travel);
  const moving = P.twistSpin !== 0 ? 1 : 0;
  const energy = moving * Math.sin(travel) ** 2;
  const surge = 1 + P.surge * energy;
  const twistTravel = P.twist * DEG - (k / 2) * eased;
  // rings: free-running, or one per crossing the twist passes (they sink: phase falls)
  const pulse = P.pulseSync > 0 && moving ? -((travel / Math.PI) * P.pulseSync) : cyc(P.pulseSpeed);
  // rising colour: a phase in palette stops that grows, so colour flows OUT of the singularity.
  // Locked to the twist it follows the EASED travel — colour hurries out while the band hurries
  // through the lobes and lingers with it at the crossings. The flow repeats after one turn of
  // the palette (its stops, m), so a loop quantises the rate to whole turns and wrapping the
  // phase by a multiple of m keeps it exact without a seam.
  const m = Math.max(1, Math.round(P.palCount));
  // crossings the twist passes in one loop (its travel is quantised to whole circuits)
  const crossings = L > 0 ? Math.round((quant(P.twistSpin, 720 / k) * L) / 180) : 0;
  // a per-crossing step, in a loop rounded so the loop moves on whole turns (of `turn`)
  const perCrossing = (step, turn) => (crossings > 0 ? (turn * Math.max(1, Math.round((crossings * step) / turn))) / crossings : step);
  let rise;
  if (P.riseSync > 0 && moving) {
    rise = (eased / Math.PI) * perCrossing(P.riseSync, m);
  } else {
    let r = P.riseRate;
    if (L > 0 && r !== 0) r = (Math.sign(r) * Math.max(1, Math.round((Math.abs(r) * L) / m)) * m) / L;
    rise = r * t;
  }
  rise -= m * 256 * Math.floor(rise / (m * 256));

  // rings: the strips flow along the depth, out of the singularity (+) or into it (−). They
  // repeat every turn of the palette (1/rings of depth), so the phase wraps there and a loop
  // quantises the flow to whole turns. Locked to the twist, each crossing moves them on
  // `ringSync` palette stops, eased like the rising colour.
  let ring = 0;
  if (P.ringRadial > 0) {
    const turn = 1 / P.ringRadial; // ln r per turn of the palette
    let turns;
    if (P.ringSync > 0 && moving) {
      turns = (eased / Math.PI) * perCrossing(P.ringSync / m, 1);
    } else {
      let r = P.ringFlow / turn; // turns per second
      if (L > 0 && r !== 0) r = (Math.sign(r) * Math.max(1, Math.round(Math.abs(r) * L))) / L;
      turns = r * t;
    }
    ring = (turns - Math.floor(turns)) * turn;
  }

  // the colour run's clock: τ = t/T in [0, 1); each strip runs a whole number of waves per T —
  // the loop, or an hour when free — so a loop closes on every strip
  const runPeriod = L > 0 ? L : 3600;
  const runClock = (t - runPeriod * Math.floor(t / runPeriod)) / runPeriod;

  // The living mark's clock is seconds × its own speed (his LivingLogo: elapsed += dt × speed).
  // Each motion arrives as a phase with its own period, so a loop length closes them all: the
  // circulation per lap (a lap shifts the edge coordinate by half, which IS the other rim), the
  // edge travel and the colour drift per cycle, the breath per breath.
  //
  // The twist, as the VibeField Identity moves it: it starts at rest, the half-twist on the \
  // crossing (−π/2, that pass edge-on), and each half-lap — crossing to crossing — is eased,
  // f − linger·sin 2πf / 2π, so the hairline rests on each crossing and hurries through the
  // lobes. A loop closes on whole laps (a lap brings the same band back, its rims swapped). At
  // rest nothing of the mark moves: the twist holds on its crossing (+ livRestTwist) and the
  // lights on their places (livRestLights, a phase along the edge); the slow lap turns the twist
  // evenly, as the Identity's does (0.175 rad/s, a lap in 36 s), the lights travelling as in motion.
  const ls = P.livSpeed;
  const REST_TWIST = 1.5 * Math.PI;
  let livTwist;
  let livTravel = turns(ls * P.livEdgeSpeed * 0.025 * 360, 360);
  let livDrift = turns(ls * P.livDrift * 0.09 * 360, 360);
  let livBreath = 1 + osc((0.72 * ls) / (2 * Math.PI)) * P.livBreathe * 0.035;
  if (P.livPose === "at rest") {
    livTwist = wrapTau(REST_TWIST + P.livRestTwist * DEG);
    livTravel = P.livRestLights - Math.floor(P.livRestLights);
    livDrift = 0;
    livBreath = 1;
  } else if (P.livPose === "slow lap") {
    livTwist = wrapTau(REST_TWIST + quant((ls * 0.175 * 180) / Math.PI, 360) * t * DEG);
  } else {
    const half = (quant((ls * P.livRoll * 180) / Math.PI, 360) * t) / 180;
    const k = Math.floor(half);
    const f = half - k;
    livTwist = wrapTau(REST_TWIST + Math.PI * (k + f - (P.livLinger * Math.sin(2 * Math.PI * f)) / (2 * Math.PI)));
  }
  return {
    t,
    flow,
    palRot,
    pulse: pulse - Math.floor(pulse),
    rise,
    ring,
    runClock,
    runPeriod,
    livTwist,
    livTravel,
    livDrift,
    livBreath,
    contrastAt: P.contrastAt * DEG + rot(P.contrastSpin),
    taperTravel: P.taperTravel * DEG + rot(P.taperSpin),
    twist: wrapTau(twistTravel),
    energy,
    glint: rot(P.glintSpin),
    plateAngle: rot(P.plateSpin),
    plateGain: (1 + P.plateBreath * osc(P.plateBreathHz)) * surge,
    edgeGain: surge,
    edgeFlow: turns(P.edgeFlow),
    inkFlow: turns(P.inkFlowSpeed, 360),
    comet: turns(P.cometSpin),
    warp: [R * Math.cos(w * t), R * Math.sin(w * t)],
    breathe: 1 + (P.breathe / 100) * osc(P.breatheHz),
    grainSeed: grainSeed + 1,
  };
}

// ------------------------------------------------------------------ the loop on the CPU
// A mirror of mark.wgsl's curve() and widthAt(): coarse samples for the shader, the reach
// bound, and the SVG export all come from here.

function loopShape(P, ph) {
  return {
    A: (P.span / 100) * ph.breathe,
    H: P.height,
    pinch: P.pinch,
    balance: P.balance,
    lean: P.lean,
    ct: Math.cos(P.tilt * DEG),
    st: Math.sin(P.tilt * DEG),
  };
}

function curvePoint(S, t) {
  const sn = Math.sin(t);
  const cs = Math.cos(t);
  const q = 1 + S.pinch * sn * sn;
  const bx = cs / q;
  const by = (sn * cs) / q;
  const k = 1 + S.balance * cs;
  let x = k * S.A * bx;
  const y = k * S.A * S.H * by;
  x += S.lean * y;
  return [S.ct * x - S.st * y, S.st * x + S.ct * y];
}

const wrapPi = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

function halfWidth(P, ph, t) {
  const m1 = P.contrast;
  const wave = (1 + m1 * Math.cos(t - ph.contrastAt)) / (1 + Math.abs(m1));
  const tl = Math.max(P.taperLength * DEG, 1e-3);
  const da = wrapPi(t - (0.5 * Math.PI + ph.taperTravel)) / tl;
  const db = wrapPi(t - (1.5 * Math.PI + ph.taperTravel)) / tl;
  const cal = wave * (1 - P.taperSlash * Math.exp(-da * da)) * (1 - P.taperBack * Math.exp(-db * db));
  const ca = Math.cos(0.5 * P.halfTwists * t + ph.twist);
  const e = P.edge;
  const rib = Math.sqrt(ca * ca * (1 - e * e) + e * e);
  const f = cal + (rib - cal) * P.ribbon;
  return 0.5 * (P.weight / 100) * Math.max(f, P.hairline);
}

// ------------------------------------------------------------------ packing

const GROUND = { flat: 0, dots: 1, solid: 2, none: 3, well: 4 };
const MASK = { square: 0, iOS: 1, macOS: 2, circle: 3 };
const CROSS = { "/ on top": 0, "\\ on top": 1, flat: 2 };
const PLATE = { print: 0, light: 1, overprint: 2 };
const LIV_EDGE_STYLE = { none: 0, soft: 1, rgb: 2, line: 3 };
const LIV_RELIEF = 0.24; // his tube: the cross-section's depth, as a share of its width

// His logoViewTilt: a fixed viewing angle that leaves both lobes visible while the ribbon
// twists — bounded by the depth's projected displacement against the smaller lobe's height.
function livViewTilt(P) {
  const limit = Math.min(40 * DEG, Math.atan((0.6 * P.livHeight * (1 - Math.abs(P.livAsymmetry))) / ((1 + P.livPinch) * Math.max(P.livDepth, 0.0001))));
  return limit * Math.tanh((P.livTilt * DEG) / limit);
}

// How far the living mark reaches from its crossing, in frame units: its centre line through
// mark.wgsl's livCurve, livRoll and livProject (at rest, unbreathed), plus the ribbon's widest
// half-width. The loading window fits its logo canvas to this.
function livExtent(P) {
  const tilt = livViewTilt(P);
  const rot = P.livRotation * DEG;
  let x = 0;
  let y = 0;
  for (let i = 0; i < 512; i++) {
    const t = (i / 512) * 2 * Math.PI;
    const sn = Math.sin(t);
    const cs = Math.cos(t);
    const q = 1 + P.livPinch * sn * sn;
    const cx = ((P.livWidth * cs) / q) * P.livScale;
    const cy = ((P.livHeight * Math.sin(2 * t)) / q) * (1 + P.livAsymmetry * cs) * P.livScale;
    const cz = -P.livDepth * sn * P.livScale;
    const ay = cy * Math.cos(tilt) - cz * Math.sin(tilt);
    const az = cy * Math.sin(tilt) + cz * Math.cos(tilt);
    const rx = Math.cos(rot) * cx - Math.sin(rot) * ay;
    const ry = Math.sin(rot) * cx + Math.cos(rot) * ay;
    const w = 1 - az * P.livPerspective * 0.2;
    x = Math.max(x, Math.abs((rx * 0.78) / w));
    y = Math.max(y, Math.abs((ry * 0.78) / w));
  }
  const hw = P.livThickness * P.livScale * (1 + P.livTaper) * 0.78;
  return { x: x + hw, y: y + hw };
}

function frameScale(P, width, height) {
  const inset = P.mask === "macOS" ? 1024 / 824 : 1;
  return ((2 / Math.min(width, height)) * inset) / P.zoom;
}

// `pxScale`: the target's pixels per pixel of the icon it becomes — a small icon's source is
// drawn k times its size, so the mark's least widths (in pixels of the icon) are k of its own
function pack(P, ph, width, height, out = new Float32Array(UNIFORM_BYTES / 4), { pxScale = 1 } = {}) {
  const set = (name, x = 0, y = 0, z = 0, w = 0, i = 0) => {
    const o = OFFSET[name] + i * 4;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
    out[o + 3] = w;
  };
  const rgb = (hex) => hexToRgb(hex);
  const S = loopShape(P, ph);
  const px = frameScale(P, width, height);

  set("view", width, height, px, ph.grainSeed);
  set("cam", Math.cos(P.spin * DEG), Math.sin(P.spin * DEG), P.panX / 100, P.panY / 100);
  set("place", P.markX / 100, P.markY / 100, P.fieldX / 100, P.fieldY / 100);
  set("shape", S.A, S.H, S.pinch, S.balance);
  set("shape2", S.lean, S.ct, S.st, 0);
  set("stroke", P.weight / 100, P.optical, P.contrast, ph.contrastAt);
  set("taper", P.taperSlash, P.taperBack, P.taperLength * DEG, ph.taperTravel);
  set("model", P.ribbon, P.halfTwists, ph.twist, P.edge);
  set("light", P.shade, P.lightAt * DEG, P.sheen, P.backMix);
  set("ink", ...rgb(P.ink), P.inkAlpha);
  set("back", ...rgb(P.backInk), P.hairline);
  set("glint", P.glint, ph.glint, P.glintLength * DEG, P.glintTail);
  set("glintC", ...rgb(P.glintInk), 0);

  // plates: offsets orbit together; gain breathes
  const ca = Math.cos(ph.plateAngle);
  const sa = Math.sin(ph.plateAngle);
  const orbit = (x, y) => [(ca * x - sa * y) / 100, (sa * x + ca * y) / 100];
  const plates = [
    [P.aX, P.aY, P.aSpread, P.aWarp],
    [P.bX, P.bY, P.bSpread, P.bWarp],
    [P.cX, P.cY, P.cSpread, P.cWarp],
  ];
  let plateReach = 0;
  plates.forEach(([x, y, sp, wp], i) => {
    const [ox, oy] = orbit(x, y);
    set(["pA", "pB", "pC"][i], ox, oy, sp / 100, wp / 100);
    plateReach = Math.max(plateReach, Math.hypot(ox, oy) * Math.abs(ph.plateGain) + (Math.max(sp, 0) + wp) / 100);
  });
  set("plateM", P.plates ? 1 : 0, PLATE[P.plateMode] ?? 0, P.plateAlpha, 0);
  set("plateG", P.warpScale, ph.warp[0], ph.warp[1], ph.plateGain);
  set("inkA", ...rgb(P.inkA), 1);
  set("inkB", ...rgb(P.inkB), 1);
  set("inkC", ...rgb(P.inkC), 1);

  // coarse samples: strand A t ∈ [0, π], strand B t ∈ [π, 2π], endpoints included
  let chord = 0;
  let prev = null;
  for (let i = 0; i < 2 * COARSE; i++) {
    const strand = i < COARSE ? 0 : 1;
    const j = i - strand * COARSE;
    const t = Math.PI * strand + (Math.PI * j) / (COARSE - 1);
    const pt = curvePoint(S, t);
    if (prev && j > 0) chord = Math.max(chord, Math.hypot(pt[0] - prev[0], pt[1] - prev[1]));
    prev = pt;
    const o = OFFSET.coarse + i * 2;
    out[o] = pt[0];
    out[o + 1] = pt[1];
  }

  // reach: any pixel of the loop or a plate lies within this distance of a coarse SAMPLE
  // (half a chord along the curve, then the half-width, the plate offset and the gap across)
  const glowReach = Math.max(
    P.edgeGlow > 0 ? (6 * P.edgeHalo + 3 * P.edgeCore) / 100 : 0,
    P.plates && P.plateGlow > 0 ? plateReach + (6 * P.plateGlowWidth) / 100 : 0,
  );
  const reach = 0.5 * chord + 0.5 * (P.weight / 100) + Math.max(P.plates ? plateReach : 0, glowReach) + Math.max(P.gap / 100, 0) + 0.5 * P.optical * px;
  set("bound", reach, P.crossRadius / 100, P.gap / 100, CROSS[P.crossing] ?? 0);

  set("ground", GROUND[P.ground] ?? 0, P.lines, P.lineWidth, P.lineContrast);
  set("law", P.qCenter, P.qLeft, P.qRight, P.focus / 100);
  set("flow", P.swirl, ph.flow, P.moire, P.accents);
  set("accent", P.accentChance, P.accentWidth, P.accentGain, P.accentSeed);
  set("pulse", P.pulse, P.pulseFreq, ph.pulse, P.pulseSharp);
  set("palA", P.bands, P.palNoise, ph.palRot, P.innerShift);
  set("palB", P.radialMid, P.radialSoft, P.sharpness, P.palSeed);
  set("palC", P.palCount, P.saturation, P.innerLight, P.palNoiseFreq);
  set("lobe", P.lobeShift, P.lobeDim, P.lobeShift !== 0 || P.lobeDim !== 0 ? 1 : 0, 0);
  for (let i = 0; i < 12; i++) set("pal", ...srgbToOklab(rgb(P[`pal${i + 1}`])), 0, i);
  for (let i = 0; i < 4; i++) set("acc", ...rgb(P[`acc${i + 1}`]), P[`acc${i + 1}w`], i);
  set("lineInk", ...rgb(P.lineInk), 1);
  set("lineT", P.lineTone, P.lineLift, 0, 0);
  set("seam", P.seamGlow, P.seamWidth, P.metalSheen, P.seamMix);
  set("seamC", ...srgbToOklab(rgb(P.seamInk)), 0);
  set("rise", P.riseRate !== 0 || P.riseSync > 0 ? 1 : 0, P.riseSpacing, ph.rise, 0);
  set("rise3", P.riseWarp, P.riseCells, P.riseSwirl, 0);
  set("glow", P.glow, P.glowRadius / 100, P.glowCore, 0);
  set("glowC", ...rgb(P.glowInk), 1);
  set("glowAt", P.glowX / 100, P.glowY / 100, 0, 0);
  set("post", P.vignette, P.vignetteAt / 100, P.grain, P.grainSize);
  set("dots", P.dotPitch / 100, P.dotSize / 100, P.grainOnInk ? 1 : 0, 0);
  set("groundC", ...rgb(P.groundInk), 1);
  set("dotC", ...rgb(P.dotInk), P.dotAlpha);
  set("frame", MASK[P.mask] ?? 0, P.squircle, P.shadow, P.invert ? 1 : 0);

  // the well's camera: tilted toward `wellAzimuth`, its lens shifted so the throat's
  // vanishing point (the singularity) lands on the crossing whatever the tilt
  const th = P.wellTilt * DEG;
  const be = P.wellAzimuth * DEG;
  const F = [Math.sin(th) * Math.cos(be), Math.sin(th) * Math.sin(be), -Math.cos(th)];
  let Uv = [-F[1] * F[0], 1 - F[1] * F[1], -F[1] * F[2]]; // world +y, made perpendicular to F
  if (Math.hypot(...Uv) < 1e-4) Uv = [1 - F[0] * F[0], -F[0] * F[1], -F[0] * F[2]];
  const ul = Math.hypot(...Uv);
  Uv = Uv.map((v) => v / ul);
  const Rv = [F[1] * Uv[2] - F[2] * Uv[1], F[2] * Uv[0] - F[0] * Uv[2], F[0] * Uv[1] - F[1] * Uv[0]];
  const aim = P.wellHeight * Math.tan(th) * P.wellShift;
  const vF = Math.cos(th); // the throat's direction (0, 0, −1) against F
  set("camR", ...Rv, Math.tan((P.wellFov * DEG) / 2));
  set("camU", ...Uv, -Rv[2] / vF);
  set("camF", ...F, -Uv[2] / vF);
  set("camPos", -aim * Math.cos(be), -aim * Math.sin(be), P.wellHeight, 0);
  set("well", P.wellDepth, P.wellThroat, P.wellPower, P.wellSpin);
  set("wellLook", P.wellFog, P.wellShade, P.wellLightAt * DEG, P.wellSquash);
  set("wellRing", P.ringGain, P.ringAt, P.ringWidth, P.horizon);
  set("throatC", ...rgb(P.throatInk), P.throatMix);
  set("ringC", ...rgb(P.ringInk), 1);

  // the edge light
  set("edge", P.edgeGlow * ph.edgeGain, P.edgeCore / 100, P.edgeHalo / 100, P.edgeTint);
  set("edge2", ph.edgeFlow, P.comet, ph.comet, P.cometLength);
  set("edge3", P.iridescence, P.plateGlow, P.plateGlowWidth / 100, P.edgeRepeat);
  for (let i = 0; i < 3; i++) set("edgeInk", ...rgb(P[`edgeInk${i + 1}`]), 1, i);
  // the plates' inks flowing round the loop: the inks go across in OKLab, for the hue turn
  set("plateF", P.inkFlow, ph.inkFlow, P.inkCycles, 0);

  // the living mark (his uniforms: shape, form, material, spin, flow, weave — regrouped)
  set("livA", P.livScale, P.livWidth, P.livHeight, P.livThickness);
  set("livB", P.livTaper, P.livPinch, P.livRotation * DEG, P.livAsymmetry);
  set("livC", P.livSpectral, P.livPearl, P.livGlow, P.mark === "living" ? 1 : 0);
  set("livD", livViewTilt(P), P.livDepth, P.livPerspective, P.livEdgeWidth);
  set("livE", P.livEdgeFlow, ph.livTravel, P.livEdgeLength, Math.round(P.livEdgePulses));
  set("livF", ph.livTwist, P.livFocus, P.livShading === "flat" ? 1 : 0, LIV_EDGE_STYLE[P.livEdge] ?? 3);
  const flat = P.livProfile === "flat";
  set("livG", ph.livDrift, ph.livBreath, flat ? 0 : LIV_RELIEF, pxScale);
  set("livH", flat ? P.livHairline : 0, flat ? P.livMinWidth / 2 : 0, P.livLineGlow, P.livLineGlowWidth);
  ["livColorA", "livColorB", "livColorC", "livColorD"].forEach((k, i) => set("livCol", ...rgb(P[k]), 1, i));
  ["inkA", "inkB", "inkC"].forEach((k, i) => set("plateLab", ...srgbToOklab(rgb(P[k])), 0, i));

  // the rings: whole strips in fours (the divisions' cells), whole arms; the hairline ink in
  // light; the palette's mean, which the rings melt into where they crowd under the pixels
  set("stripA", Math.max(4, Math.round(P.ringStrips / 4) * 4), Math.round(P.ringArms), P.ringRadial, ph.ring);
  set("stripB", P.ringDetail, P.ringContrast, P.ringBright, P.ringIrregular);
  set("stripC", P.ringScatter, P.ringWobbleScale, P.ringWobble, P.ringSeed);
  set("stripD", P.ringHair, P.ringGaps, P.ringShine, P.pattern === "wedges" ? 0 : 1);
  set("stripE", ...rgb(P.ringHairInk).map(toLinear), P.ringFloor);
  const used = Math.max(1, Math.min(12, Math.round(P.palCount)));
  const mean = [0, 0, 0];
  for (let i = 0; i < used; i++) srgbToOklab(rgb(P[`pal${i + 1}`])).forEach((v, j) => (mean[j] += v / used));
  set("stripM", ...mean, P.ringVary);
  set("stripF", P.ringSpacing, 0, 0, 0);
  // the colour run: K waves round the turn and as long along the rays (the well's depth is
  // κ = 1 + 1/profile times ln r on screen, the flat field's is ln r), mixed by how the strips
  // lie: their direction in (angle, ln r) is (rings/κ, arms/2π) turned a quarter
  const kap = P.ground === "well" ? 1 + 1 / P.wellPower : 1;
  const ra = Math.round(P.ringArms) / (2 * Math.PI);
  const rr = P.ringRadial / kap;
  set("runA", P.runAmount, Math.round(P.runWaves), (Math.round(P.runWaves) * kap) / (2 * Math.PI), ra + rr > 0 ? (ra * ra) / (ra * ra + rr * rr) : 0);
  set("runB", ph.runClock, ph.runPeriod * P.runSpeed, P.runPace, 0);
  // the dust: rows in fours per turn of the palette; places along them square to the rows at
  // spacing 1 (where the depth runs as the well's own) — a whole number per turn where the
  // strips lie round the singularity, per wrap of the flow where they lie along the rays (their
  // seeds repeat on that period, so the cut and the wrap stay seamless). Each row travels along
  // by whole periods per period of the run's clock; the particles' mean cover is their fill ×
  // the kernel's area (3π/4 r², r = size × cell / 2) over the spread of sizes.
  const Nd = Math.max(4, Math.round(P.dustRows / 4) * 4);
  const across = Math.hypot(ra, rr);
  const rayLike = ra > rr;
  let Ma;
  let Pa;
  if (!rayLike) {
    Ma = Math.max(1, Math.round((Nd * 2 * Math.PI * across) / P.dustSpacing));
    Pa = Ma;
  } else {
    Ma = (Nd * kap * across) / P.dustSpacing;
    if (P.ringRadial > 1e-4) {
      Pa = Math.max(1, Math.round(Ma / P.ringRadial));
      Ma = Pa * P.ringRadial;
    } else {
      Pa = Math.max(1, Math.round(Ma * 16));
    }
  }
  const spread = 1.2 * P.dustSizeVary;
  const sizes = spread > 1e-4 ? Math.sinh(2 * spread) / (2 * spread) : 1;
  const cover = P.dustFill * ((3 * Math.PI) / 16) * P.dustSize * P.dustSize * sizes * (1 + P.dustStreak);
  set("dustA", Nd, Ma, Pa, P.pattern === "dust" ? 1 : 0);
  set("dustB", rayLike ? 1 : 0, P.dustSize, spread, P.dustFill);
  set("dustC", P.dustScatter, Math.min(1, 0.3 + P.dustScatter), P.dustStreak, P.dustSeed);
  set("dustD", P.dustGlow, P.dustSparkle, P.dustGas, P.dustLift);
  set("dustE", P.dustGlitter, P.dustTint, (ph.runPeriod * P.dustOrbit) / Pa, P.dustPace);
  set("dustF", P.dustTwinkle, ph.runPeriod * P.dustTwinkleRate, cover, P.dustGasOut);

  return out;
}

// ------------------------------------------------------------------ WebGPU

class MarkUnavailable extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// the shader beside this file, or the copy build.mjs inlined (`__MARK_WGSL__`, `__SHRINK_WGSL__`)
async function loadShaderSource(url = new URL("./mark.wgsl", import.meta.url), inline = "__MARK_WGSL__") {
  if (typeof globalThis[inline] === "string") return globalThis[inline];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load the shader (${res.status})`);
  return res.text();
}

async function createEngine({ source, smallSource, onError } = {}) {
  if (!("gpu" in navigator)) {
    throw new MarkUnavailable("no-webgpu", "This browser has no WebGPU (navigator.gpu is missing).");
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new MarkUnavailable("no-adapter", "WebGPU is present but no GPU adapter was granted.");
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener("uncapturederror", (e) => {
    errors.push(e.error.message);
    onError?.(e.error.message);
  });
  const code = WGSL_STRUCT + (source ?? (await loadShaderSource()));
  const module = device.createShaderModule({ code, label: "vibefield-mark" });
  const info = await module.getCompilationInfo();
  const bad = info.messages.filter((m) => m.type === "error");
  if (bad.length) {
    throw new Error(`WGSL did not compile:\n${bad.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("\n")}`);
  }
  // the small sizes' shrink and finish (shrink.wgsl): without it they draw at their size
  const smallModule = smallSource ? device.createShaderModule({ code: smallSource, label: "vibefield-small" }) : null;
  if (smallModule) {
    const sbad = (await smallModule.getCompilationInfo()).messages.filter((m) => m.type === "error");
    if (sbad.length) throw new Error(`shrink.wgsl did not compile:\n${sbad.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("\n")}`);
  }
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipelines = new Map();
  const pipelineFor = (format) => {
    if (!pipelines.has(format)) {
      pipelines.set(
        format,
        device.createRenderPipeline({
          label: `mark-${format}`,
          layout: pipelineLayout,
          vertex: { module, entryPoint: "vs" },
          fragment: { module, entryPoint: "fs", targets: [{ format }] },
          primitive: { topology: "triangle-list" },
        }),
      );
    }
    return pipelines.get(format);
  };
  // The living mark's passes, as his LogoRenderer draws them: the field (here, this lab's
  // ground), the opaque ribbon with depth, then the edge strips — 4× MSAA, depth-tested. Both
  // mark passes blend premultiplied so the icon mask can cut them at the frame.
  const MSAA = 4;
  const DEPTH = "depth24plus";
  const premultiplied = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  };
  const living = new Map();
  const livingFor = (format) => {
    if (!living.has(format)) {
      const multisample = { count: MSAA };
      living.set(format, {
        ground: device.createRenderPipeline({
          label: `mark-ground-msaa-${format}`,
          layout: pipelineLayout,
          multisample,
          vertex: { module, entryPoint: "vs" },
          fragment: { module, entryPoint: "fs", targets: [{ format }] },
          primitive: { topology: "triangle-list" },
          depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: "always" },
        }),
        ribbon: device.createRenderPipeline({
          label: `mark-living-ribbon-${format}`,
          layout: pipelineLayout,
          multisample,
          vertex: { module, entryPoint: "livRibbonVertex" },
          fragment: { module, entryPoint: "livRibbonFragment", targets: [{ format, blend: premultiplied }] },
          primitive: { topology: "triangle-list", cullMode: "none" },
          depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: "less" },
        }),
        edge: device.createRenderPipeline({
          label: `mark-living-edge-${format}`,
          layout: pipelineLayout,
          multisample,
          vertex: { module, entryPoint: "livEdgeVertex" },
          fragment: { module, entryPoint: "livEdgeFragment", targets: [{ format, blend: premultiplied }] },
          primitive: { topology: "triangle-strip" },
          depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: "less-equal" },
        }),
        // the flat band's outline in ink (the Identity strokes each piece of it): its rims,
        // which meet in a hairline where the band turns edge-on
        rim: device.createRenderPipeline({
          label: `mark-living-rim-${format}`,
          layout: pipelineLayout,
          multisample,
          vertex: { module, entryPoint: "livRimVertex" },
          fragment: { module, entryPoint: "livRimFragment", targets: [{ format, blend: premultiplied }] },
          primitive: { topology: "triangle-strip" },
          depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: "less-equal" },
        }),
      });
    }
    return living.get(format);
  };
  // multisampled colour + depth for one target size (kept per surface, remade on resize)
  const msaaTargets = (format, w, h, prev) => {
    if (prev && prev.w === w && prev.h === h && prev.format === format) return prev;
    prev?.color.destroy();
    prev?.depth.destroy();
    return {
      w,
      h,
      format,
      color: device.createTexture({ size: [w, h], format, sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT }),
      depth: device.createTexture({ size: [w, h], format: DEPTH, sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT }),
    };
  };

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  pipelineFor(canvasFormat);
  livingFor(canvasFormat);
  const scratch = new Float32Array(UNIFORM_BYTES / 4);

  const makeBinding = () => {
    const ubo = device.createBuffer({ size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: ubo } }] });
    return { ubo, group };
  };

  const encodeDraw = (encoder, view, format, binding) => {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
    });
    pass.setPipeline(pipelineFor(format));
    pass.setBindGroup(0, binding.group);
    pass.draw(3);
    pass.end();
  };

  const encodeLiving = (encoder, resolveView, format, binding, targets, P) => {
    const lp = livingFor(format);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: targets.color.createView(), resolveTarget: resolveView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      depthStencilAttachment: { view: targets.depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    pass.setBindGroup(0, binding.group);
    pass.setPipeline(lp.ground);
    pass.draw(3);
    pass.setPipeline(lp.ribbon);
    pass.draw(LIV_BODY);
    if (P.livProfile === "flat") {
      pass.setPipeline(lp.rim);
      pass.draw(LIV_EDGE, 2);
    }
    if (P.livEdge !== "none") {
      pass.setPipeline(lp.edge);
      pass.draw(LIV_EDGE, 2);
    }
    pass.end();
  };

  // ---- the small sizes (shrink.wgsl). A small icon is drawn k times its size each way — the
  // field single-sampled, the mark over nothing with its own passes — into SOURCE textures the
  // whole engine shares (one set per source size, the three last used kept), then shrunk in
  // light into a SLOT's own small textures, then finished into any canvas of that size. A slot
  // asked for what the sources already hold (the same parameters, phases and size) shrinks
  // them again without drawing them: the key visual shrunk to four sizes is one source.
  const SRC = "rgba8unorm";
  const MID = "rgba16float";
  const smallLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
    ],
  });
  const smallPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [smallLayout] });
  const shrinkPipeline = smallModule
    ? device.createRenderPipeline({
        label: "small-shrink",
        layout: smallPipelineLayout,
        vertex: { module: smallModule, entryPoint: "smallVs" },
        fragment: { module: smallModule, entryPoint: "shrinkFs", targets: [{ format: MID }, { format: MID }] },
        primitive: { topology: "triangle-list" },
      })
    : null;
  const finishes = new Map();
  const finishFor = (format) => {
    if (!finishes.has(format)) {
      finishes.set(
        format,
        device.createRenderPipeline({
          label: `small-finish-${format}`,
          layout: smallPipelineLayout,
          vertex: { module: smallModule, entryPoint: "smallVs" },
          fragment: { module: smallModule, entryPoint: "finishFs", targets: [{ format }] },
          primitive: { topology: "triangle-list" },
        }),
      );
    }
    return finishes.get(format);
  };
  const sources = new Map();
  const makeSource = (w, h) => {
    const tex = (label) => device.createTexture({ label, size: [w, h], format: SRC, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const src = { w, h, field: tex("small-field"), mark: tex("small-mark"), targets: msaaTargets(SRC, w, h, null), key: "" };
    src.fieldView = src.field.createView();
    src.markView = src.mark.createView();
    return src;
  };
  const dropSource = (src) => {
    if (src) for (const t of [src.field, src.mark, src.targets.color, src.targets.depth]) t.destroy();
  };
  const sourceFor = (w, h) => {
    const id = `${w}x${h}`;
    let src = sources.get(id);
    if (src) {
      sources.delete(id); // most recent last
    } else {
      src = makeSource(w, h);
      while (sources.size >= 3) {
        const [oldId, old] = sources.entries().next().value;
        sources.delete(oldId);
        dropSource(old);
      }
    }
    sources.set(id, src);
    return src;
  };
  const fieldBinding = makeBinding();
  const markBinding = makeBinding();
  const readBack = async (texture, w, h, bytesPerPixel) => {
    const bytesPerRow = Math.ceil((w * bytesPerPixel) / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [w, h]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const out = new Uint8Array(w * h * bytesPerPixel);
    const src = new Uint8Array(buffer.getMappedRange());
    for (let y = 0; y < h; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * bytesPerPixel), y * w * bytesPerPixel);
    buffer.unmap();
    buffer.destroy();
    return out;
  };
  const straight = (src, w, h) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const a = src[i * 4 + 3];
      const k = a > 0 ? 255 / a : 0;
      out[i * 4] = src[i * 4] * k;
      out[i * 4 + 1] = src[i * 4 + 1] * k;
      out[i * 4 + 2] = src[i * 4 + 2] * k;
      out[i * 4 + 3] = a;
    }
    return out;
  };
  const half = (h) => {
    const e = (h >> 10) & 31;
    const f = h & 1023;
    const v = e === 0 ? 2 ** -14 * (f / 1024) : e === 31 ? Number.POSITIVE_INFINITY : 2 ** (e - 15) * (1 + f / 1024);
    return h & 0x8000 ? -v : v;
  };
  // `own`: the slot keeps a source of its own instead of the three the small sizes share — for
  // a big icon drawn at its size (k = 1), which would push the small sizes' sources out
  const smallSlot = ({ own = false } = {}) => {
    const ubo = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    let mid = null;
    let shrinkGroup = null;
    let shrinkSrc = null;
    let mine = null;
    const ownSource = (w, h) => {
      if (!mine || mine.w !== w || mine.h !== h) {
        dropSource(mine);
        mine = makeSource(w, h);
      }
      return mine;
    };
    return {
      get size() {
        return mid ? [mid.w, mid.h] : [0, 0];
      },
      // draws the sources (unless they already hold these), shrinks them into this slot.
      // post: { exposure (EV), contrast, colour, soften (px), sharpen }; pxScale: pack()'s (k
      // to hold the mark's least widths in the small icon's pixels). True when it drew them.
      prepare(P, ph, width, height, { k = 1, post = {}, pxScale = 1, mark = true } = {}) {
        const sw = width * k;
        const sh = height * k;
        const src = own ? ownSource(sw, sh) : sourceFor(sw, sh);
        const encoder = device.createCommandEncoder();
        const key = JSON.stringify([P, ph, pxScale, mark]);
        const drew = src.key !== key;
        if (drew) {
          device.queue.writeBuffer(fieldBinding.ubo, 0, pack(P, ph, sw, sh, scratch, { pxScale }));
          encodeDraw(encoder, src.fieldView, SRC, fieldBinding);
          if (P.mark === "living" && mark) {
            const Pm = { ...P, ground: "none" };
            device.queue.writeBuffer(markBinding.ubo, 0, pack(Pm, ph, sw, sh, scratch, { pxScale }));
            encodeLiving(encoder, src.markView, SRC, markBinding, src.targets, Pm);
          } else {
            // the calligraphic loop is drawn with the field: the mark's source stays empty
            encoder.beginRenderPass({ colorAttachments: [{ view: src.markView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] }).end();
          }
          src.key = key;
        }
        if (!mid || mid.w !== width || mid.h !== height) {
          mid?.F.destroy();
          mid?.M.destroy();
          const tex = (label) => device.createTexture({ label, size: [width, height], format: MID, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
          mid = { w: width, h: height, F: tex("small-F"), M: tex("small-M") };
          mid.FView = mid.F.createView();
          mid.MView = mid.M.createView();
          mid.group = device.createBindGroup({ layout: smallLayout, entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: mid.FView }, { binding: 2, resource: mid.MView }] });
        }
        if (shrinkSrc !== src) {
          shrinkGroup = device.createBindGroup({ layout: smallLayout, entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: src.fieldView }, { binding: 2, resource: src.markView }] });
          shrinkSrc = src;
        }
        const u = new Float32Array([k, width, height, 0, post.exposure ?? 0, post.contrast ?? 0, post.colour ?? 1, 0, post.soften ?? 0, post.sharpen ?? 0, 0, 0]);
        device.queue.writeBuffer(ubo, 0, u);
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            { view: mid.FView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
            { view: mid.MView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
          ],
        });
        pass.setPipeline(shrinkPipeline);
        pass.setBindGroup(0, shrinkGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
        return drew;
      },
      // finishes what prepare() shrank into a texture (a canvas's, or one to read back)
      finishInto(textureView, format) {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: textureView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
        pass.setPipeline(finishFor(format));
        pass.setBindGroup(0, mid.group);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      },
      present(view) {
        if (!mid || view.canvas.width !== mid.w || view.canvas.height !== mid.h) return false;
        this.finishInto(view.target().createView(), canvasFormat);
        return true;
      },
      // straight RGBA as finished, and the mark's own cover per pixel (0–1)
      async read() {
        const { w, h } = mid;
        const texture = device.createTexture({ size: [w, h], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        this.finishInto(texture.createView(), "rgba8unorm");
        const [rgba, m] = await Promise.all([readBack(texture, w, h, 4), readBack(mid.M, w, h, 8)]);
        texture.destroy();
        const halves = new Uint16Array(m.buffer);
        const cover = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) cover[i] = half(halves[i * 4 + 3]);
        return { px: straight(rgba, w, h), cover };
      },
      destroy() {
        mid?.F.destroy();
        mid?.M.destroy();
        mid = null;
        dropSource(mine);
        mine = null;
        ubo.destroy();
      },
    };
  };

  return {
    device,
    errors,
    adapterInfo: adapter.info ?? null,
    small: Boolean(smallModule),
    smallSlot,
    // one small icon, shrunk and finished off-screen: { px (straight RGBA), cover (the mark's) };
    // drawn at its size (k = 1, a big one) from a source of its own, freed after
    async pixelsSmall(P, ph, width, height = width, opts = {}) {
      const slot = smallSlot({ own: (opts.k ?? 1) === 1 });
      slot.prepare(P, ph, width, height, opts);
      const out = await slot.read();
      slot.destroy();
      return out;
    },
    attach(canvas) {
      const ctx = canvas.getContext("webgpu");
      ctx.configure({ device, format: canvasFormat, alphaMode: "premultiplied" });
      const binding = makeBinding();
      let targets = null;
      return {
        canvas,
        target: () => ctx.getCurrentTexture(),
        // `mark: false` draws the field alone: the living mark's own passes stay out, and the
        // fragment, seeing the living mark on, leaves the calligraphic loop out too — one
        // single-sampled pass, which is what a window-sized field wants
        render(P, ph, { mark = true } = {}) {
          const w = canvas.width;
          const h = canvas.height;
          if (w < 1 || h < 1) return;
          device.queue.writeBuffer(binding.ubo, 0, pack(P, ph, w, h, scratch));
          const encoder = device.createCommandEncoder();
          const view = ctx.getCurrentTexture().createView();
          if (P.mark === "living" && mark) {
            targets = msaaTargets(canvasFormat, w, h, targets);
            encodeLiving(encoder, view, canvasFormat, binding, targets, P);
          } else {
            encodeDraw(encoder, view, canvasFormat, binding);
          }
          device.queue.submit([encoder.finish()]);
        },
        destroy() {
          binding.ubo.destroy();
          targets?.color.destroy();
          targets?.depth.destroy();
          ctx.unconfigure();
        },
      };
    },
    // Renders one frame off-screen and returns straight-alpha RGBA bytes (for PNG export).
    async pixels(P, ph, width, height = width, { mark = true } = {}) {
      const format = "rgba8unorm";
      const texture = device.createTexture({
        size: [width, height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      const binding = makeBinding();
      device.queue.writeBuffer(binding.ubo, 0, pack(P, ph, width, height, new Float32Array(UNIFORM_BYTES / 4)));
      const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
      const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder();
      const targets = P.mark === "living" && mark ? msaaTargets(format, width, height, null) : null;
      if (targets) encodeLiving(encoder, texture.createView(), format, binding, targets, P);
      else encodeDraw(encoder, texture.createView(), format, binding);
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(buffer.getMappedRange());
      const out = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * bytesPerRow + x * 4;
          const o = (y * width + x) * 4;
          const a = src[i + 3];
          const k = a > 0 ? 255 / a : 0;
          out[o] = src[i] * k;
          out[o + 1] = src[i + 1] * k;
          out[o + 2] = src[i + 2] * k;
          out[o + 3] = a;
        }
      }
      buffer.unmap();
      buffer.destroy();
      texture.destroy();
      targets?.color.destroy();
      targets?.depth.destroy();
      binding.ubo.destroy();
      return out;
    },
  };
}

// ------------------------------------------------------------------ vector export

// mark.wgsl's hash and value noise, bit for bit, so the SVG plates warp like the render.
function pcg(v) {
  const st = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((st >>> (((st >>> 28) + 4) & 31)) ^ st) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
const h1 = (nn) => pcg(nn >>> 0) / 4294967296;
const h2 = (ix, iy, seed) => h1((Math.imul(ix | 0, 1597334677) ^ pcg(((iy | 0) ^ seed) >>> 0)) >>> 0);
function vnoise(x, y, seed) {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const u = x - fx;
  const v = y - fy;
  const wx = u * u * (3 - 2 * u);
  const wy = v * v * (3 - 2 * v);
  const a = h2(fx, fy, seed);
  const bb = h2(fx + 1, fy, seed);
  const cc = h2(fx, fy + 1, seed);
  const d = h2(fx + 1, fy + 1, seed);
  const top = a + (bb - a) * wx;
  const bot = cc + (d - cc) * wx;
  return (top + (bot - top) * wy) * 2 - 1;
}

// The loop's outline (and each plate's) as closed paths in a `size`-unit square.
// The living mark as the VibeField Identity draws it, in vectors, at the phases given (the icon
// exports it at rest): mark.wgsl's band on the CPU — its curve, twist, least width, tilt,
// rotation and perspective — in two halves, the far one first (the \\ pass lies under the / at
// the crossing); each half a path filled and stroked in ink, the stroke its outline (where the
// band turns edge-on, the hairline), then that half's lights as the Identity strokes them: piece
// by piece, 420 pieces round the loop, each a round-capped line of light (its glow under it) as
// bright as the pulse passing, so the pieces overlap and the glow heaps as it does on its canvas.
function identitySVG(P, ph, toSvg, k) {
  const PIECES = 420;
  const FIT = 0.78;
  const tilt = livViewTilt(P);
  const rot = P.livRotation * DEG;
  const grow = P.livScale * ph.livBreath;
  const curve = (t) => {
    const s = Math.sin(t);
    const c = Math.cos(t);
    const q = 1 + P.livPinch * s * s;
    return [((P.livWidth * c) / q) * grow, ((P.livHeight * Math.sin(2 * t)) / q) * (1 + P.livAsymmetry * c) * grow, -P.livDepth * s * grow];
  };
  const roll = ([x, y, z]) => {
    const ay = y * Math.cos(tilt) - z * Math.sin(tilt);
    return [Math.cos(rot) * x - Math.sin(rot) * ay, Math.sin(rot) * x + Math.cos(rot) * ay, y * Math.sin(tilt) + z * Math.cos(tilt)];
  };
  const place = ([x, y, z]) => {
    const w = 1 - z * P.livPerspective * 0.2;
    return toSvg([(x * FIT) / w + P.markX / 100, (-y * FIT) / w + P.markY / 100]);
  };
  const unit = FIT * k; // SVG px per logo unit
  const least = P.livMinWidth / 2 / unit;
  const rims = [];
  for (let i = 0; i <= PIECES; i++) {
    const t = (2 * Math.PI * i) / PIECES;
    const c = curve(t);
    const a = curve(t - 0.001);
    const b = curve(t + 0.001);
    const T = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const tl = Math.hypot(...T);
    T.forEach((v, j) => (T[j] = v / tl));
    const nl = Math.hypot(T[0], T[1]) || 1;
    const N = [-T[1] / nl, T[0] / nl, 0];
    const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
    const bl = Math.hypot(...B) || 1;
    const q = t - ph.livTwist;
    const tw = q * 0.5 - P.livFocus * 0.45 * Math.sin(q);
    const n = [0, 1, 2].map((j) => N[j] * Math.cos(tw) + (B[j] / bl) * Math.sin(tw));
    const w = Math.max(P.livThickness * P.livScale * (1 + P.livTaper * Math.sin(t + 0.7)), least);
    rims.push({ t, L: place(roll(c.map((v, j) => v + n[j] * w))), R: place(roll(c.map((v, j) => v - n[j] * w))) });
  }
  const loopPx = 2 * 1.04 * P.livWidth * P.livScale * ph.livBreath * unit;
  const ew = (0.0042 * loopPx * P.livEdgeWidth) / 0.22;
  const hair = Math.max(loopPx / 900, P.livHairline);
  const f = (v) => v.toFixed(2);
  const smooth = (a, b, x) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const frac = (x) => x - Math.floor(x);
  const coord = (t, side) => (t - ph.livTwist) / (4 * Math.PI) + (side < 0 ? 0.5 : 0);
  const pulse = (t, side) => {
    const phase = frac((coord(t, side) + ph.livTravel) * Math.round(P.livEdgePulses));
    const dist = Math.abs(frac(phase - 0.25 + 0.5) - 0.5);
    const half = 0.025 + (0.14 - 0.025) * P.livEdgeLength;
    return 1 - smooth(half * 0.55, half, dist);
  };
  const inks = [P.livColorA, P.livColorD, P.livColorB].map(hexToRgb);
  const colour = (t, side) => {
    const x = frac(coord(t, side) + 0.12 + ph.livTravel) * 3;
    const i = Math.min(2, Math.floor(x));
    const m = smooth(0.96, 1, x - i);
    const [a, b] = [inks[i], inks[(i + 1) % 3]];
    return `#${a.map((v, j) => Math.round((v + (b[j] - v) * m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  };
  const strength = Math.min(1, P.livEdgeFlow / 1.4);
  const halves = [[0, PIECES / 2, "far"], [PIECES / 2, PIECES, "near"]];
  const out = [];
  for (const [i0, i1, name] of halves) {
    const span = rims.slice(i0, i1 + 1);
    const band = [...span.map((r) => r.L), ...span.map((r) => r.R).reverse()];
    out.push(`<g id="${name}">`);
    out.push(`  <path d="M${band.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}Z" fill="${P.ink}" stroke="${P.ink}" stroke-width="${f(hair)}" stroke-linejoin="round"/>`);
    if (P.livEdge === "line" && strength > 0) {
      const lights = [];
      for (const side of [1, -1]) {
        for (let i = i0; i < i1; i++) {
          const tm = (rims[i].t + rims[i + 1].t) / 2;
          const pu = pulse(tm, side) * strength;
          if (pu < 0.02) continue;
          const [a, b] = side > 0 ? [rims[i].L, rims[i + 1].L] : [rims[i].R, rims[i + 1].R];
          const d = `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`;
          const ink = colour(tm, side);
          if (P.livLineGlow > 0) lights.push(`    <path d="${d}" stroke="${ink}" stroke-opacity="${(P.livLineGlow * pu).toFixed(3)}" stroke-width="${f(ew * P.livLineGlowWidth)}"/>`);
          lights.push(`    <path d="${d}" stroke="${ink}" stroke-opacity="${pu.toFixed(3)}" stroke-width="${f(ew)}"/>`);
        }
      }
      if (lights.length) out.push(`  <g fill="none" stroke-linecap="round">`, ...lights, "  </g>");
    }
    out.push("</g>");
  }
  return `<g id="living-mark">\n${out.join("\n")}\n</g>`;
}

function markSVG(P, ph, { size = 1024, background = true, samples = 480 } = {}) {
  const S = loopShape(P, ph);
  const inset = P.mask === "macOS" ? 824 / 1024 : 1;
  const k = (size / 2) * inset * P.zoom;
  const cs = Math.cos(-P.spin * DEG);
  const sn = Math.sin(-P.spin * DEG);
  // logo space → SVG space (the inverse of the shader's camera)
  const toSvg = ([x, y]) => {
    const dx = x - P.panX / 100;
    const dy = y - P.panY / 100;
    const rx = cs * dx - sn * dy;
    const ry = sn * dx + cs * dy;
    return [size / 2 + rx * k, size / 2 - ry * k];
  };
  const outline = (strand, offsetFn, spread) => {
    const left = [];
    const right = [];
    for (let i = 0; i <= samples; i++) {
      const t = Math.PI * strand + (Math.PI * i) / samples;
      const [x, y] = curvePoint(S, t);
      const [x2, y2] = curvePoint(S, t + 1e-4);
      let tx = x2 - x;
      let ty = y2 - y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const hw = halfWidth(P, ph, t) + spread;
      for (const [arr, sgn] of [[left, 1], [right, -1]]) {
        let px = x + P.markX / 100 - sgn * ty * hw;
        let py = y + P.markY / 100 + sgn * tx * hw;
        const [ox, oy] = offsetFn(px, py);
        px += ox;
        py += oy;
        arr.push(toSvg([px, py]));
      }
    }
    const pts = [...left, ...right.reverse()];
    return `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;
  };
  const none = () => [0, 0];
  const ca = Math.cos(ph.plateAngle);
  const sa = Math.sin(ph.plateAngle);
  const plateOffset = (x0, y0, warp, seed) => (x, y) => {
    let ox = ((ca * x0 - sa * y0) / 100) * ph.plateGain;
    let oy = ((sa * x0 + ca * y0) / 100) * ph.plateGain;
    if (warp > 0) {
      const sx = (x - P.markX / 100) * P.warpScale + ph.warp[0];
      const sy = (y - P.markY / 100) * P.warpScale + ph.warp[1];
      ox += (warp / 100) * vnoise(sx, sy, seed);
      oy += (warp / 100) * vnoise(sx + 17.3, sy - 9.1, seed + 101);
    }
    return [ox, oy];
  };
  const layer = (fill, fn, spread, id) =>
    `<g id="${id}" fill="${fill}">\n  <path d="${outline(0, fn, spread)}"/>\n  <path d="${outline(1, fn, spread)}"/>\n</g>`;
  const parts = [];
  if (background && (P.ground === "solid" || P.ground === "dots")) {
    parts.push(`<rect id="ground" width="${size}" height="${size}" fill="${P.groundInk}"/>`);
  }
  if (background && P.ground === "dots") {
    // the shader's dot lattice: multiples of the pitch in frame space, kept inside the square
    const pitch = P.dotPitch / 100;
    const r = (P.dotSize / 100) * k;
    const ext = 1.5 / P.zoom; // covers the square at any view rotation
    const span = (c) => [Math.floor((c - ext) / pitch), Math.ceil((c + ext) / pitch)];
    const [i0, i1] = span(P.panX / 100);
    const [j0, j1] = span(P.panY / 100);
    const dots = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const [x, y] = toSvg([i * pitch, j * pitch]);
        if (x < -r || y < -r || x > size + r || y > size + r) continue;
        dots.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}"/>`);
      }
    }
    parts.push(`<g id="dots" fill="${P.dotInk}"${P.dotAlpha < 1 ? ` fill-opacity="${P.dotAlpha}"` : ""}>\n  ${dots.join("\n  ")}\n</g>`);
  }
  if (P.mark === "living" && P.livProfile === "flat") {
    parts.push(identitySVG(P, ph, toSvg, k));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n<!-- VibeField living mark, as the VibeField Identity draws it · generated by draft/wormhole from the lab's parameters -->\n${parts.join("\n")}\n</svg>\n`;
  }
  if (P.mark === "living") {
    // his logoSvg: a flat, editable outline of the ribbon at rest (taper and painter order at
    // the crossing, no twist, depth or tilt), in two half strips, ×0.78 (his fit), y-down
    const a = P.livRotation * DEG;
    const LIV_FIT = 0.78;
    const at = (t) => {
      const c = Math.cos(t);
      const s = Math.sin(t);
      const x = (P.livWidth * c) / (1 + P.livPinch * s * s);
      const y = (P.livHeight * Math.sin(2 * t) * (1 + P.livAsymmetry * c)) / (1 + P.livPinch * s * s);
      return [(x * Math.cos(a) - y * Math.sin(a)) * P.livScale, (x * Math.sin(a) + y * Math.cos(a)) * P.livScale];
    };
    const logo = ([x, y]) => toSvg([x * LIV_FIT + P.markX / 100, -y * LIV_FIT + P.markY / 100]);
    const contour = (start, end) => {
      const sides = [[], []];
      for (let i = 0; i <= 256; i++) {
        const t = start + ((end - start) * i) / 256;
        const [x, y] = at(t);
        const p0 = at(t - 0.001);
        const p1 = at(t + 0.001);
        const dx = p1[0] - p0[0];
        const dy = p1[1] - p0[1];
        const len = Math.hypot(dx, dy) || 1;
        const w = P.livThickness * P.livScale * (1 + P.livTaper * Math.sin(t + 0.7));
        for (let side = 0; side < 2; side++) {
          const dir = side * 2 - 1;
          sides[side].push(logo([x - (dy / len) * w * dir, y + (dx / len) * w * dir]));
        }
      }
      const pts = [...sides[0], ...sides[1].reverse()];
      return `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;
    };
    parts.push(`<g id="living-mark" fill="${P.ink}">\n  <path d="${contour(0, Math.PI)}"/>\n  <path d="${contour(Math.PI, 2 * Math.PI)}"/>\n</g>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n<!-- VibeField living mark · generated by draft/mark from the lab's parameters -->\n${parts.join("\n")}\n</svg>\n`;
  }
  if (P.plates && P.plateMode !== "light") {
    parts.push(layer(P.inkA, plateOffset(P.aX, P.aY, P.aWarp, 11), P.aSpread / 100, "plate-1"));
    parts.push(layer(P.inkB, plateOffset(P.bX, P.bY, P.bWarp, 23), P.bSpread / 100, "plate-2"));
    parts.push(layer(P.inkC, plateOffset(P.cX, P.cY, P.cWarp, 37), P.cSpread / 100, "plate-3"));
  }
  parts.push(layer(P.ink, none, 0, "loop"));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n<!-- VibeField mark · generated by draft/mark from the lab's parameters -->\n${parts.join("\n")}\n</svg>\n`;
}

return { COARSE, UNIFORM_BYTES, WGSL_STRUCT, hexToRgb, rgbToHex, srgbToOklab, SECTIONS, PARAMS, DEFAULTS, PRESETS, presetValues, normalize, animate, loopShape, curvePoint, halfWidth, livViewTilt, livExtent, frameScale, pack, MarkUnavailable, loadShaderSource, createEngine, markSVG };
})();

// ---- small.js
const { smallT, smallLookT, smallParams, smallPost, smallPxScale, smallK, lightness, measure } = (() => {
// VibeField · Wormhole Dust — the small sizes (2026-10-09): how each size is drawn, and how
// its light is measured. No GPU here: mark.js draws and shrinks (shrink.wgsl), lab.js shows.
//
// James: "the icon somehow looks very dark as it go small, can you measure the luminosity of
// it?" Measured on Wormhole at 2 s, against the key visual (1024 px, light L* 41.8): drawn at
// its own size the icon kept 91% of that light at 256 px, 81% at 64 px, 66% at 32 px and 63% at
// 16 px; its mark alone kept 47% at 32 px and 25% at 16 px, a line under a pixel wide
// antialiased in sRGB; and its contrast (spread, below) fell from 63 to 18 at 32 px — a flat
// grey-blue the mark faded into.
//
// So a small size is now the key visual drawn large and shrunk in light (every size keeps its
// light), then TUNED for its size, as type has optical sizes: each tuning parameter is its value
// at 16 pt, reached by log size from `smFrom` (nothing there, the key visual shrunk) down.

// how far into the tuning a size is: 0 at smFrom and above, 1 at 16 pt and below
function smallT(P, pt) {
  const from = Math.max(P.smFrom, 17);
  return Math.min(1, Math.max(0, Math.log2(from / pt) / Math.log2(from / 16)));
}

// The tuning is of two kinds. Its LOOK — light, contrast, colour, the centre's light and size,
// the vignette, the dust's size and its gas — is the tuned icon's at every size while `smLook`
// is on, the big icon and the icon set's largest included (James, 2026-10-09: "make the big
// icon preview be the tuned one ... the icon set download, should be tuned as well"); off, it
// grows toward 16 pt like the rest. Its OPTICAL part — the mark's weight and edge light, soften,
// sharpen, the mark's least widths — always grows from Tuned below to 16 pt, as type's optical
// sizes do, so the big icon keeps the mark as drawn.
const smallLookT = (P, pt) => (P.smLook ? 1 : smallT(P, pt));

// the look as a size draws it: the key visual's parameters with this size's tuning laid over
const grow = (v, t) => v ** t; // a multiplier ×v at 16 pt, reached geometrically
const lerp = (a, b, t) => a + (b - a) * t;
function smallParams(P, pt) {
  const t = smallT(P, pt);
  const l = smallLookT(P, pt);
  if (t <= 0 && l <= 0) return P;
  return {
    ...P,
    glow: P.glow * lerp(1, P.smGlow, l),
    glowRadius: P.glowRadius * grow(P.smGlowSize, l),
    vignette: P.vignette * lerp(1, P.smVignette, l),
    dustRows: Math.max(8, Math.round(P.dustRows / grow(P.smDust, l) / 4) * 4),
    dustGas: Math.min(1, P.dustGas + P.smGas * l),
    livThickness: P.livThickness * grow(P.smWeight, t),
    livEdgeFlow: P.livEdgeFlow * lerp(1, P.smEdge, t),
  };
}

// the finish shrink.wgsl gives the field at this size
function smallPost(P, pt) {
  const t = smallT(P, pt);
  const l = smallLookT(P, pt);
  return { exposure: P.smExposure * l, contrast: P.smContrast * l, colour: 1 + (P.smColour - 1) * l, soften: P.smSoften * t, sharpen: P.smSharpen * t };
}

// pack()'s pxScale for a tuned size: the mark's least widths (the flat ribbon's hairline and
// least width) are in pixels of the icon at 16 pt, and the key visual's own at Tuned below —
// reached by log size, like every tuning (k is the source's texels to the icon's pixel)
const smallPxScale = (P, pt, k) => k ** smallT(P, pt);

// source texels to a small pixel, each way. The source is drawn at least 768 px across for a
// size of 200 px and over, where the dust is still dust when shrunk; under that, 512 is as good
// (measured, the key visual shrunk to 128, 64 and 32 px from 512 and from 1536: light within
// 0.8%, its lightest tenth within 2 L*) at half the cost; a whole number of texels to a pixel.
const smallK = (px) => Math.max(1, Math.ceil((px < 200 ? 512 : 768) / px));

// ------------------------------------------------------------------ measuring

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const LIN = Float64Array.from({ length: 256 }, (_, i) => toLin(i / 255));
// CIE lightness from relative luminance
const lightness = (Y) => (Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y);

// One icon's light, from straight RGBA (each pixel weighted by its cover in the mask):
//   light     the lightness (L*) of its mean luminance — how light it reads from far off
//   Y         that mean luminance
//   spread    p90 − p10 of its pixels' lightness — its contrast
//   p10, p50, p90, hi (share at L* 80 and over)
//   mark      the mark's lightness over the field's right next to it (ΔL*), given the mark's
//             own cover per pixel: pixels it covers at least half against pixels it leaves
//             uncovered within 2 px of them
//   hist      40 bins of lightness, shares
function measure(px, w, h, cover = null) {
  const n = w * h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const fine = new Float64Array(1001); // lightness in tenths, for the percentiles
  const hist = new Float32Array(40);
  let sa = 0;
  let sY = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3] / 255;
    A[i] = a;
    if (a <= 0) continue;
    const Y = 0.2126 * LIN[px[i * 4]] + 0.7152 * LIN[px[i * 4 + 1]] + 0.0722 * LIN[px[i * 4 + 2]];
    const l = lightness(Y);
    L[i] = l;
    sa += a;
    sY += a * Y;
    fine[Math.min(1000, Math.round(l * 10))] += a;
    hist[Math.min(39, Math.floor(l / 2.5))] += a;
    if (l >= 80) hi += a;
  }
  const at = (q) => {
    let acc = 0;
    for (let b = 0; b <= 1000; b++) {
      acc += fine[b];
      if (acc >= q * sa) return b / 10;
    }
    return 100;
  };
  for (let b = 0; b < 40; b++) hist[b] /= sa || 1;
  const Y = sa > 0 ? sY / sa : 0;
  const p10 = at(0.1);
  const p50 = at(0.5);
  const p90 = at(0.9);
  let mark = null;
  if (cover) {
    let mL = 0;
    let mN = 0;
    let fL = 0;
    let fN = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (A[i] < 0.99) continue;
        if (cover[i] >= 0.5) {
          mL += L[i];
          mN++;
        } else if (cover[i] < 0.02) {
          let near = false;
          for (let dy = -2; dy <= 2 && !near; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const X = x + dx;
              const Yy = y + dy;
              if (X >= 0 && Yy >= 0 && X < w && Yy < h && cover[Yy * w + X] >= 0.5) {
                near = true;
                break;
              }
            }
          }
          if (near) {
            fL += L[i];
            fN++;
          }
        }
      }
    }
    if (mN && fN) mark = mL / mN - fL / fN;
  }
  return { light: lightness(Y), Y, spread: p90 - p10, p10, p50, p90, hi: sa > 0 ? hi / sa : 0, mark, hist };
}

return { smallT, smallLookT, smallParams, smallPost, smallPxScale, smallK, lightness, measure };
})();

// ---- palettes.js
const { oklchHex, PALETTES, TONES, PALETTE_KEYS, findPalette, paletteValues, swatchOf } = (() => {
// VibeField mark — palettes for the field.
//
// A palette is a small set of colours with ROLES — a quiet ground, a dominant jewel colour
// with its coloured darks, one metal, a luminous seam — rendered in the TONE of the look it is
// applied to: light (Radiant, Möbius, Equipotential), dark (Event Horizon, Night) or paper
// (Print). What they share is the HOUSE style below, which is where the design rules live;
// applying a palette writes ordinary parameters, so a saved look keeps its colours without
// knowing palettes exist.
//
// The rules, measured from the references James gave (2026-09-22: Cecilia Erlich's "Soft
// Color Harmonies" and two gradient-disc prints): 40–48% of the picture is a quiet neutral
// ground (L ≈ 0.92, C < 0.03); 22–29% is vivid colour at FULL chroma (0.19–0.29), never
// diluted; 3–26% is coloured darks (bottle-green, aubergine, oxblood — not grey); three to
// five hue families, with gaps in value between ground, colour and dark. Round 3's palettes
// had 5% neutral, no darks and seven hue families: busy, not rich.
//
// Colours are [L, C, h] (OKLCH: lightness 0–1, chroma, hue in degrees) or "#RRGGBB". A colour
// outside sRGB keeps its lightness and hue and gives up chroma until it fits.

// ------------------------------------------------------------------ OKLCH → sRGB

const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function linearFrom(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const fits = (rgb) => rgb.every((v) => v >= -1e-5 && v <= 1 + 1e-5);

function oklchHex(L, C, h) {
  const ca = Math.cos((h * Math.PI) / 180);
  const sa = Math.sin((h * Math.PI) / 180);
  let rgb = linearFrom(L, C * ca, C * sa);
  if (!fits(rgb)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 28; i++) {
      const mid = 0.5 * (lo + hi);
      if (fits(linearFrom(L, mid * ca, mid * sa))) lo = mid;
      else hi = mid;
    }
    rgb = linearFrom(L, lo * ca, lo * sa);
  }
  const hex = rgb.map((v) => Math.round(Math.min(Math.max(encode(Math.min(Math.max(v, 0), 1)), 0), 1) * 255).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`.toUpperCase();
}

const col = (x) => (typeof x === "string" ? x.toUpperCase() : oklchHex(x[0], x[1], x[2]));

const hexRgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function tint(stockHex, inkHex, k) {
  // ink over paper multiplies: the stock filtered by a thin film of the ink, in linear light
  const s = hexRgb(stockHex).map(toLin);
  const i = hexRgb(inkHex).map(toLin);
  const out = s.map((c, j) => c * (1 - k + k * i[j]));
  return `#${out.map((c) => Math.round(Math.min(Math.max(encode(c), 0), 1) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
const labL = (hex) => {
  const [r, g, b] = hexRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s_;
};
const labOf = (hex) => {
  const [r, g, b] = hexRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s_,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s_,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s_,
  ];
};

// ------------------------------------------------------------------ the house style
//
// Per tone, the settings every palette shares:
//   seam*        the edges between colour fields breathe light (Rothko's edges; kintsugi gold)
//   lineTone     the fine lines take the field's own colour, lifted or deepened — engine-turned
//                metal under enamel, not white hatching
//   accents      few, and in the palette's metal
//   saturation 1 the colours as designed: premium is exact colour, not boosted colour

//   light        the jewel fields full-bleed, with a dark throat
//   dark         rays of colour out of a coloured black
//   rings        dense strips of the palette round a black singularity (round 10): the stops
//                melt into each other, and the palette carries the strips' light
//
// (A "calm ground" that pooled the colour in a disc framed by the palette's ground was tried
// in round 4 and removed in round 7 at James's word: the field runs edge to edge.)

const HOUSE = {
  light: {
    innerShift: 0, innerLight: 0, saturation: 1,
    palNoise: 0.1, sharpness: 0.6, seamGlow: 0.55, seamWidth: 0.03, seamMix: 0.35,
    lineTone: 0.9, lineLift: -0.05, accentChance: 0.12, acc1w: 1, acc2w: 0.4, acc3w: 0, acc4w: 0,
    glow: 0.1, glowCore: 0.15, metalSheen: 0.7,
  },
  dark: {
    innerShift: 0, innerLight: 0, saturation: 1,
    palNoise: 0.1, sharpness: 0.6, seamGlow: 0.85, seamWidth: 0.03, seamMix: 0.35,
    lineTone: 0.9, lineLift: 0.1, accentChance: 0.12, acc1w: 1, acc2w: 0.4, acc3w: 0, acc4w: 0,
    metalSheen: 0.8,
  },
  paper: {
    innerShift: 0, seamGlow: 0, lineTone: 0, saturation: 1, innerLight: 0,
    palNoise: 0.1, sharpness: 0.6, accentChance: 0.22, acc1w: 1, acc2w: 1, acc3w: 1, acc4w: 1,
    metalSheen: 0.4,
  },
  rings: {
    innerShift: 0, innerLight: 0, saturation: 1, palNoise: 0, sharpness: 0.12, seamGlow: 0,
    lineTone: 0.9, lineLift: 0.12, accentChance: 0.12, acc1w: 1, acc2w: 0.4, acc3w: 0, acc4w: 0,
    metalSheen: 0,
  },
};


// ------------------------------------------------------------------ the palettes
//
// ground    paper's stock (bone, ivory, gallery grey)
// deep      the coloured black at the throat of the light tone
// light     the colour fields in the light tone; a repeated stop is a wider field, so
//           the list IS the proportion (dominant, darks, one accent)
// dark      the same in the dark tone
// seam      the seam ink (kintsugi gold, a periwinkle glow…) and how much of it is laid in
// metal     the accent hairlines and the photon ring
// light     the throat and the glow at the centre of the light looks ("luminous")
// print     paper: the ink the lines and the loop are printed in, three spot inks in plate
//           order (warm, light, cool) — the accents and the mark's plates
// style     per-tone departures from the house style

// ------------------------------------------------------------------ ring palettes (round 10)
//
// For the rings, gradients kept the way James's interstellar-drive colour tuner keeps them
// (voyagerstudios/new-mechanic, src/io/presets.ts): stops at positions 0–1, mixed in sRGB as
// the tuner mixes them, sampled to twelve even stops round the turn of the palette. Four are
// measured from his references of 2026-10-08 — Accretion from the arcs round a black core,
// Neptune from the blue sheets into a white star, Comet and Redshift from the strips made of
// particles; the rest are the tuner's presets, with his names and, on the rings, his strips
// (detail, sharpness, brightness). A gradient's roles in the other tones come from the
// gradient itself (fromGradient).

const RING_GRADIENTS = [
  {
    id: "accretion",
    name: "Accretion",
    blurb: "Measured from the arcs round a black core: oxblood, crimson and vermilion, rose to blush, amber and orange, a magenta turn into violet-black, ultramarine, periwinkle, ice.",
    stops: [[0, "#2A0410"], [1 / 12, "#B0000A"], [2 / 12, "#EB3A12"], [3 / 12, "#F27AA0"], [4 / 12, "#FCD3E0"], [5 / 12, "#FFAE1A"], [6 / 12, "#FF6C1A"], [7 / 12, "#D31C92"], [8 / 12, "#3A0058"], [9 / 12, "#3410B8"], [10 / 12, "#7B80EA"], [11 / 12, "#C8DAFC"]],
    hair: "#FFFFFF",
  },
  {
    id: "neptune",
    name: "Neptune",
    blurb: "Measured from the sheets of blue into a white star: navy, cobalt and steel, sky to ice white, lavender and violet back into the dark — pink hairlines at the edges.",
    stops: [[0, "#070A1C"], [1 / 12, "#14205C"], [2 / 12, "#232379"], [3 / 12, "#1C389B"], [4 / 12, "#2A66A2"], [5 / 12, "#6268B4"], [6 / 12, "#8EC4EA"], [7 / 12, "#DFE3FF"], [8 / 12, "#9796D2"], [9 / 12, "#6552AE"], [10 / 12, "#303A77"], [11 / 12, "#10132C"]],
    hair: "#FF9EC8",
  },
  // round 12: James's references of the strips made of particles (images 9 and 10), measured
  // along lines across their strips, in the order the strips run outward
  {
    id: "comet",
    name: "Comet",
    blurb: "Measured from the dotted arcs over a white horizon: white and ice, salmon, vermilion, crimson and carmine, tan and blush, a dusty rose, then steel and navy into the black where the dust lies sparse.",
    stops: [[0, "#FCFDFE"], [1 / 12, "#C9DEF3"], [2 / 12, "#F4A59D"], [3 / 12, "#D6503A"], [4 / 12, "#C53035"], [5 / 12, "#9C1A1F"], [6 / 12, "#876248"], [7 / 12, "#D8A797"], [8 / 12, "#763837"], [9 / 12, "#1F394A"], [10 / 12, "#0A306F"], [11 / 12, "#0F182B"]],
    hair: "#FFFFFF",
  },
  {
    id: "redshift",
    name: "Redshift",
    blurb: "Measured from the glittering disc round a black hole: navy into steel, sky and ice, a white rim, peach, vermilion, crimson, brick and maroon, a deep blue back into the dark.",
    stops: [[0, "#0F1521"], [1 / 12, "#153363"], [2 / 12, "#5C72A3"], [3 / 12, "#9EBAE9"], [4 / 12, "#CBD3E8"], [5 / 12, "#F6F4F7"], [6 / 12, "#E59879"], [7 / 12, "#D14220"], [8 / 12, "#AB1617"], [9 / 12, "#802321"], [10 / 12, "#461010"], [11 / 12, "#264879"]],
    hair: "#FFFFFF",
  },
  {
    id: "saturn-blue", name: "Saturn Blue", tuner: { detail: 5, sharpness: 1.8, brightness: 1.2 },
    blurb: "The tuner’s Saturn Blue: black-navy into cobalt and cyan, a white core.",
    stops: [[0, "#00000A"], [0.15, "#001450"], [0.35, "#0064DC"], [0.45, "#32C8FF"], [0.5, "#FFFFFF"], [0.55, "#C8F0FF"], [0.65, "#0096FF"], [0.85, "#001E78"], [1, "#00000F"]],
  },
  {
    id: "fiery-warm", name: "Fiery Warm", tuner: { detail: 6, sharpness: 1.6, brightness: 1.4 },
    blurb: "The tuner’s Fiery Warm: ember to orange and gold, a white core, a breath of rose.",
    stops: [[0, "#0F0500"], [0.15, "#821400"], [0.35, "#FF5A00"], [0.45, "#FFC814"], [0.5, "#FFFAF0"], [0.55, "#FFB432"], [0.7, "#E68CA0"], [0.85, "#B42800"], [1, "#0F0500"]],
  },
  {
    id: "ocean-teal", name: "Ocean Teal", tuner: { detail: 4, sharpness: 1.4, brightness: 1.1 },
    blurb: "The tuner’s Ocean Teal: ice into aqua, teal and blue, violet, one gold strip.",
    stops: [[0, "#EBF5FF"], [0.15, "#8CDCEB"], [0.3, "#14BEAA"], [0.45, "#008CDC"], [0.6, "#785ABE"], [0.75, "#3C32A0"], [0.82, "#3C32A0"], [0.85, "#FFB400"], [1, "#005AB4"]],
  },
  {
    id: "neon-tunnel", name: "Neon Tunnel", tuner: { detail: 5, sharpness: 1.8, brightness: 1.5 },
    blurb: "The tuner’s Neon Tunnel: eight inks strip by strip — red, blue, orange, yellow, mint, white, violet, black.",
    stops: [[0, "#FF1E1E"], [1 / 8, "#1482FF"], [2 / 8, "#FF8C00"], [3 / 8, "#FFE614"], [4 / 8, "#00FFB4"], [5 / 8, "#FFFFFF"], [6 / 8, "#C814DC"], [7 / 8, "#0F0A14"]],
    even: 8,
    rings: { sharpness: 0.9, ringScatter: 4 },
  },
  {
    id: "cosmic-vortex", name: "Cosmic Vortex", tuner: { detail: 7, sharpness: 2.2, brightness: 1.3 },
    blurb: "The tuner’s Cosmic Vortex: violet-black, indigo, periwinkle, pink to blush, orange, crimson.",
    stops: [[0, "#0F001E"], [0.2, "#4614B4"], [0.4, "#96B4FF"], [0.5, "#FF96E6"], [0.6, "#FFF0F5"], [0.7, "#FF7800"], [0.85, "#C80028"], [1, "#0A0014"]],
  },
  {
    id: "nebula-flow", name: "Nebula Flow", tuner: { detail: 6, sharpness: 1.5, brightness: 1.3 },
    blurb: "The tuner’s Nebula Flow: navy, orchid and lilac, ice, sky blue, back to navy.",
    stops: [[0, "#0A0F3C"], [0.15, "#283C8C"], [0.3, "#B478DC"], [0.45, "#FABEFF"], [0.55, "#E6FAFF"], [0.7, "#5ABEFF"], [0.85, "#1E3296"], [1, "#050A1E"]],
  },
  {
    id: "crimson-supernova", name: "Crimson Supernova", tuner: { detail: 6, sharpness: 1.7, brightness: 1.3 },
    blurb: "The tuner’s Crimson Supernova: crimson and hot pink, a violet strip, coral to blush, magenta.",
    stops: [[0, "#0A0005"], [0.15, "#DC1432"], [0.3, "#FF2878"], [0.45, "#5A0096"], [0.6, "#FF6E50"], [0.75, "#FFDCE6"], [0.9, "#C80096"], [1, "#000000"]],
  },
  {
    id: "golden-rings", name: "Golden Rings", tuner: { detail: 7, sharpness: 2, brightness: 1.3 },
    blurb: "The tuner’s Golden Rings: navy and pewter, ivory, gold to bronze, one verdigris strip.",
    stops: [[0, "#051446"], [0.2, "#6E6E8C"], [0.35, "#F0EBE6"], [0.5, "#FFD750"], [0.65, "#DC8C1E"], [0.8, "#784614"], [0.9, "#50A0A0"], [1, "#0F0A05"]],
  },
  {
    id: "solar-flare", name: "Solar Flare", tuner: { detail: 6, sharpness: 1.8, brightness: 1.2 },
    blurb: "The tuner’s Solar Flare: slate and ash, amber and orange, a white-hot strip, rust.",
    stops: [[0, "#0A0A0F"], [0.2, "#282D41"], [0.35, "#96786E"], [0.5, "#FFB400"], [0.65, "#FF5000"], [0.75, "#FFFFF0"], [0.85, "#781405"], [1, "#280A00"]],
  },
  {
    id: "emerald-ripple", name: "Emerald Ripple", tuner: { detail: 7, sharpness: 2.1, brightness: 1.3 },
    blurb: "The tuner’s Emerald Ripple: forest into jade and lime, a white core, mint, back into the forest.",
    stops: [[0, "#050A05"], [0.15, "#0F4628"], [0.3, "#14A078"], [0.45, "#8CE664"], [0.55, "#FFFFFF"], [0.7, "#BEF08C"], [0.85, "#1E8C5A"], [1, "#000F0A"]],
  },
  {
    id: "plasma-arc", name: "Plasma Arc", tuner: { detail: 6, sharpness: 1.6, brightness: 1.4 },
    blurb: "The tuner’s Plasma Arc: violet-black, plum and amethyst, lilac to white, back to indigo.",
    stops: [[0, "#0A0014"], [0.15, "#501464"], [0.3, "#9650DC"], [0.45, "#E6C8FF"], [0.55, "#FFFFFF"], [0.7, "#C8B4FF"], [0.85, "#3C1496"], [1, "#0F0019"]],
  },
];

// The tuner's lerpColor, sampled at n even positions round the turn (position 1 is position 0
// again, so a gradient that ends where it starts closes without a doubled stop).
function sampleGradient(stops, n) {
  const rgbOf = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let j = 0; j < stops.length - 1; j++) {
      if (t >= stops[j][0] && t <= stops[j + 1][0]) {
        a = stops[j];
        b = stops[j + 1];
        break;
      }
    }
    const span = b[0] - a[0];
    const k = span === 0 ? 0 : (t - a[0]) / span;
    const [ra, ga, ba] = rgbOf(a[1]);
    const [rb, gb, bb] = rgbOf(b[1]);
    out.push(`#${[ra + (rb - ra) * k, ga + (gb - ga) * k, ba + (bb - ba) * k].map((v) => Math.round(Math.min(Math.max(v, 0), 255)).toString(16).padStart(2, "0")).join("")}`.toUpperCase());
  }
  return out;
}

// A gradient's roles in every tone: the rings and the dark tone take its twelve stops; the
// light tone its colours without the darks (a light look keeps its dark for the throat); deep
// is its darkest, luminous its lightest, metal its most saturated; on paper, its most
// saturated colour is the flood and three of its hues, far enough apart, the spot inks.
function fromGradient(g) {
  const stops = sampleGradient(g.stops, g.even ?? 12);
  const labs = stops.map(labOf);
  const chroma = (l) => Math.hypot(l[1], l[2]);
  const hue = (l) => (Math.atan2(l[2], l[1]) * 180) / Math.PI;
  const apart = (a, b) => Math.abs(((hue(a) - hue(b) + 540) % 360) - 180) >= 60;
  const order = (f) => stops.map((_, i) => i).sort(f);
  const byL = order((a, b) => labs[a][0] - labs[b][0]);
  const vivid = order((a, b) => chroma(labs[b]) - chroma(labs[a]));
  const darkest = stops[byL[0]];
  const lightest = stops[byL[byL.length - 1]];
  let light = stops.filter((_, i) => labs[i][0] >= 0.45);
  if (light.length < 4) light = byL.slice(-6).sort((a, b) => a - b).map((i) => stops[i]);
  const spots = [];
  for (const i of vivid) if (spots.length < 3 && spots.every((j) => apart(labs[i], labs[j]))) spots.push(i);
  for (const i of vivid) if (spots.length < 3 && !spots.includes(i)) spots.push(i);
  const ink = labs[byL[0]][0] < 0.3 ? darkest : "#1C1C24";
  // the tuner's brightness lit a road under scene lights; here 1 is the palette as designed, and
  // the tuner's own middle (1.3) maps to it
  const tuner = g.tuner ? { ringDetail: g.tuner.detail, ringContrast: g.tuner.sharpness, ringBright: Math.round((g.tuner.brightness / 1.3) * 100) / 100 } : {};
  return {
    id: g.id,
    name: g.name,
    blurb: g.blurb,
    family: "rings",
    ground: "#ECE9E4",
    deep: labs[byL[0]][0] < 0.3 ? darkest : "#0B0B12",
    light,
    dark: stops,
    rings: stops,
    seam: { ink: lightest, mix: 0.3 },
    metal: stops[vivid[0]],
    luminous: lightest,
    hair: g.hair ?? lightest,
    print: { flood: stops[spots[0]], ink, spots: spots.map((i) => stops[i]) },
    style: { rings: { ...tuner, ...(g.rings ?? {}) } },
  };
}

// Named so its negative (Obsidian Light, below) can copy it value for value.
const OBSIDIAN = {
  id: "obsidian",
  name: "Obsidian",
  blurb: "Black on black, told apart only by the engraving, and mended in gold — a black dial on a white case in the light.",
  ground: "#ECECEA",
  deep: "#070708",
  light: ["#0B0B0C", "#1A1A1D", "#0F0F11", "#26262B", "#0B0B0C", "#1E1E22", "#131315", "#2E2E33"],
  dark: ["#0B0B0C", "#161618", "#0F0F11", "#1F1F23", "#0B0B0C", "#2A2A2F", "#121214", "#1A1A1D"],
  seam: { ink: "#D4B16A", mix: 1 },
  metal: "#D4B16A",
  luminous: "#F7F7F5",
  print: { flood: "#8E8E94", ink: "#111113", spots: ["#C9A24A", "#8E8E94", "#2E2E33"] },
  style: { light: { seamGlow: 0.9, seamWidth: 0.015, lineLift: 0.14 }, dark: { seamGlow: 0.9, seamWidth: 0.015, lineLift: 0.16 } },
};

const PALETTES = [
  {
    // The design kit's Prism (packages/design-kit/src/logo, DEFAULT_LOGO): its four lights over
    // its ground. His field mixes each colour toward the ground by a cloud factor k (0.18–0.84,
    // mean ~0.5) after a 1.1 saturation, then ×1.08 exposure; the light stops are k = 0.62.
    id: "prism",
    name: "Prism",
    blurb: "The living mark's own light, from the design kit: rose, cobalt, amber and mint twice round the turn over lavender-grey, white filaments, a cream glow at the centre.",
    ground: "#EDE8ED",
    deep: "#100E1B",
    light: ["#FF82BC", "#7F9BFF", "#FFD192", "#86F7E0"],
    dark: ["#FF3985", "#100E1B", "#3159E8", "#0B0A14", "#FFAB53", "#100E1B", "#43DFBD", "#0B0A14"],
    seam: { ink: "#FFF0D9", mix: 0 },
    metal: "#FFD192",
    luminous: "#FFF0D9",
    print: { flood: "#FF3985", ink: "#24242C", spots: ["#FF3985", "#FFAB53", "#3159E8"] },
    style: {
      light: {
        bands: 2, sharpness: 0, palNoise: 0.08, seamGlow: 0, lineTone: 0, lineInk: "#FFFFFF",
        throatInk: "#FFF0D9", glow: 0.62, glowCore: 0.8, accentChance: 0.08,
      },
      dark: { bands: 2, sharpness: 0.3, seamGlow: 0.5 },
    },
  },
  {
    id: "velvet",
    name: "Velvet",
    blurb: "Fuchsia and oxblood against bottle-green and aubergine, a periwinkle light at every seam — after Cecilia Erlich’s soft colour harmonies.",
    ground: "#EBE3D2",
    deep: "#110310",
    light: ["#FE01C1", "#FE01C1", "#72010D", "#01260D", "#01260D", "#0B689C", "#998BFB", "#F9026A", "#390327", "#073A4B", "#FE01C1", "#F9026A"],
    dark: ["#FE01C1", "#72010D", "#01260D", "#01260D", "#0B689C", "#998BFB", "#390327", "#F9026A", "#390327", "#073A4B"],
    seam: { ink: "#B9ADFF", mix: 0.45 },
    metal: "#CBA67E",
    luminous: "#F8F1E7",
    print: { flood: "#FF48B0", ink: "#2A0620", spots: ["#E4007F", "#CBA67E", "#0B5A82"] },
  },
  {
    id: "orphic",
    name: "Orphic",
    blurb: "The colour wheel split warm and cool — vermilion, rose and gold against cobalt, each with its own shadow. After the Delaunays’ simultaneous discs.",
    ground: "#E4E3E1",
    deep: "#070B18",
    light: [[0.72, 0.14, 354], "#FE68AF", "#ED460C", "#924A0F", "#4B2C06", [0.72, 0.12, 88], [0.72, 0.07, 55], [0.7, 0.07, 250], "#226ECD", "#0E4696", "#4B77B4", "#FE68AF"],
    dark: ["#FE68AF", "#ED460C", "#4B2C06", "#D2B553", "#1A1204", "#226ECD", "#0E4696", "#06122E"],
    seam: { ink: "#FFF1DE", mix: 0 },
    metal: "#D2B553",
    luminous: "#FFF6E8",
    print: { flood: "#E8431A", ink: "#10284F", spots: ["#E8431A", "#E3B94A", "#1F63C6"] },
    style: { light: { bands: 1, sharpness: 0.4 }, dark: { bands: 1, sharpness: 0.4 } },
  },
  {
    id: "rouge",
    name: "Rouge",
    blurb: "Red and rose over lacquer black, one cornflower and one violet for the eye to rest on.",
    ground: "#E5E4E2",
    deep: "#0E0204",
    light: ["#FC0209", "#FC0209", "#ED5FAF", "#1A0308", "#EC2A5C", [0.72, 0.12, 352], "#1A0308", "#A41C12", "#ED5FAF", "#4C87C5", [0.7, 0.05, 355], "#4F1186"],
    dark: ["#FC0209", "#1A0308", "#ED5FAF", "#A41C12", "#1A0308", "#EC2A5C", "#4F1186", "#0E0204"],
    seam: { ink: "#FFC6DC", mix: 0.4 },
    metal: "#F49EC4",
    luminous: "#FFF1F2",
    print: { flood: "#F15060", ink: "#1A0308", spots: ["#E0101A", "#F29BC0", "#3F6FB8"] },
  },
  {
    id: "oxblood",
    name: "Oxblood",
    blurb: "Maroon, wine and mauve over a blue-black, the edges smouldering cadmium — after Rothko’s Seagram murals.",
    ground: "#E7DED2",
    deep: "#0D0B14",
    light: ["#4A1420", "#4A1420", "#6B1F2A", "#1A0A0D", "#7A4A5C", "#4A1420", "#2A0D14", "#6B1F2A", "#1A0A0D", "#4A1420"],
    dark: ["#2A0D14", "#4A1420", "#1A0A0D", "#6B1F2A", "#0D0B14", "#7A4A5C", "#1A0A0D", "#4A1420"],
    seam: { ink: "#D9642B", mix: 0.75 },
    metal: "#D9642B",
    luminous: "#F2A15E",
    print: { flood: "#914E72", ink: "#2A0A10", spots: ["#9E2416", "#D98A3A", "#4A1420"] },
    style: { light: { seamGlow: 0.85, seamWidth: 0.05 }, dark: { seamGlow: 1.1, seamWidth: 0.05 } },
  },
  {
    id: "lacquer",
    name: "Lacquer",
    blurb: "Urushi black and vermilion over bengara red, mended in gold: every seam is a kintsugi line.",
    ground: "#EFE8D9",
    deep: "#0B0908",
    light: ["#D8401E", "#171412", "#171412", "#9D2933", "#913225", "#27221F", "#D8401E", "#171412"],
    dark: ["#171412", "#D8401E", "#27221F", "#171412", "#9D2933", "#913225", "#171412", "#27221F"],
    seam: { ink: "#D4AF37", mix: 1 },
    metal: "#D4AF37",
    luminous: "#FFF4E2",
    print: { flood: "#D8401E", ink: "#171412", spots: ["#C8321E", "#C9A24A", "#913225"] },
    style: { light: { seamGlow: 0.9, seamWidth: 0.02 }, dark: { seamGlow: 1, seamWidth: 0.02 } },
  },
  {
    id: "enamel",
    name: "Enamel",
    blurb: "Sapphire enamel over engine-turned lines, set in white gold — a guilloché dial.",
    ground: "#EBECEE",
    deep: "#020714",
    light: ["#1E44B8", "#0F2A7A", "#2F63E0", "#081A4E", "#1E44B8", [0.72, 0.09, 262], "#0F2A7A", "#2F63E0"],
    dark: ["#081A4E", "#1E44B8", "#050F30", "#0F2A7A", "#2F63E0", "#050F30", "#1E44B8", "#081A4E"],
    seam: { ink: "#EDE6D6", mix: 0.6 },
    metal: "#D6B26A",
    luminous: "#F4F1EA",
    print: { flood: "#3D5588", ink: "#0A1A4E", spots: ["#C9A24A", "#A9C1EE", "#1E44B8"] },
    style: { light: { lineTone: 1, lineLift: 0.12 }, dark: { lineTone: 1, lineLift: 0.14 } },
  },
  {
    id: "ultramarine",
    name: "Ultramarine",
    blurb: "One blue, as deep as it goes, with a breath of rose — and gold only as line. After Yves Klein.",
    ground: "#ECE7DC",
    deep: "#000614",
    light: ["#002FA7", "#002FA7", "#001A6E", "#2A55D0", "#002FA7", "#0A1440", [0.7, 0.1, 5], "#002FA7", "#001A6E", "#002FA7"],
    dark: ["#001A6E", "#002FA7", "#000A33", "#002FA7", "#0A1440", "#001A6E", "#000A33", [0.7, 0.1, 5]],
    seam: { ink: "#D4AF37", mix: 0.85 },
    metal: "#D4AF37",
    luminous: "#F5F1E6",
    print: { flood: "#002FA7", ink: "#001A6E", spots: ["#E9A1B0", "#D4AF37", "#002FA7"] },
    style: { light: { seamGlow: 0.8, seamWidth: 0.018 }, dark: { seamGlow: 0.9, seamWidth: 0.018 } },
  },
  {
    id: "afterglow",
    name: "Afterglow",
    blurb: "Dusk through an open ceiling: indigo and violet round a luminous aperture — after Turrell’s skyspaces.",
    ground: "#ECE4E8",
    deep: "#07051A",
    light: ["#231A52", "#4A2C82", "#8E4F95", "#D2708E", [0.72, 0.13, 40], [0.72, 0.1, 62], [0.72, 0.13, 40], "#D2708E", "#8E4F95", "#4A2C82"],
    dark: ["#0E0A26", "#2A1A5A", "#5E3478", "#A4507A", "#E07A6E", "#FFB27E", "#E07A6E", "#A4507A", "#5E3478", "#2A1A5A"],
    seam: { ink: "#FFE3B8", mix: 0 },
    metal: "#FFC79A",
    luminous: "#FFF1E0",
    print: { flood: "#E0707A", ink: "#231A52", spots: ["#E0707A", "#F6B07C", "#4A2C82"] },
    style: {
      light: { bands: 1, sharpness: 0, palNoise: 0.04, seamGlow: 0, throatInk: "#FFE3C4" },
      dark: { bands: 1, sharpness: 0, palNoise: 0.04, seamGlow: 0, throatInk: "#F2A48A" },
    },
  },
  {
    id: "champagne",
    name: "Champagne",
    blurb: "Gold leaf, champagne and bronze over espresso, laid on ivory — after Klimt’s gold.",
    ground: "#F2EDE3",
    deep: "#0E0B09",
    light: ["#C9A45C", [0.74, 0.07, 80], "#8A6A3C", "#2E241D", [0.72, 0.1, 82], "#B08A4E", [0.74, 0.07, 80], "#5A4630"],
    dark: ["#3A2E26", "#1E1814", "#8C7A68", "#2A221C", "#E6D3B3", "#1E1814", "#B8A48C", "#120E0B"],
    seam: { ink: "#FFF1D2", mix: 0.5 },
    metal: "#C8A15A",
    luminous: "#FFF8EC",
    print: { flood: "#AC936E", ink: "#3A2E26", spots: ["#B8865A", "#D9B574", "#8C7A68"] },
    style: { light: { seamGlow: 0.7 } },
  },
  {
    id: "malachite",
    name: "Malachite",
    blurb: "The stone’s own banding — black-green, emerald and jade — veined in gold, one wine note against it.",
    ground: "#E8E6DC",
    deep: "#010D0A",
    light: ["#03201A", "#0B6E4F", [0.7, 0.09, 165], "#0F8A5F", "#03201A", "#0B6E4F", "#5A1A22", "#03201A", "#0F8A5F", "#4FA886"],
    dark: ["#021510", "#0B6E4F", "#03201A", "#0F8A5F", "#021510", "#4FA886", "#5A1A22", "#0B6E4F"],
    seam: { ink: "#B8913F", mix: 0.8 },
    metal: "#B8913F",
    luminous: "#F2F6EE",
    print: { flood: "#00838A", ink: "#03201A", spots: ["#B8862E", "#7FC8A9", "#0B6E4F"] },
    style: { light: { sharpness: 0.75, palNoise: 0.22 }, dark: { sharpness: 0.75, palNoise: 0.22 } },
  },
  {
    id: "pearl",
    name: "Pearl",
    blurb: "Ultramarine and umber lit by lead-tin yellow, the blue fields drawn over in yellow lines — after Vermeer.",
    ground: "#E9E6DF",
    deep: "#0C0906",
    light: ["#1F3A93", "#E8C547", "#122462", [0.7, 0.03, 90], "#6F7F9E", "#1F3A93", "#B8862E", "#2E2216"],
    dark: ["#2E2216", "#1F3A93", "#120C08", "#E8C547", "#122462", "#2E2216", "#B8862E", "#120C08"],
    seam: { ink: "#F4F0E6", mix: 0.6 },
    metal: "#C9A24A",
    luminous: "#FBF7EC",
    print: { flood: "#E8C547", ink: "#1F2A55", spots: ["#B8862E", "#E8C547", "#1F3A93"] },
    style: { light: { lineInk: "#FFE64A", lineTone: 0.45 }, dark: { lineInk: "#FFE64A", lineTone: 0.4 } },
  },
  OBSIDIAN,
  // its negative (draft/wormhole, 2026-10-09): the same values with the field inverted and the
  // mark in black — the light half of a monotone pair, the dark half being Obsidian itself
  {
    ...OBSIDIAN,
    id: "obsidian-light",
    name: "Obsidian Light",
    blurb: "Obsidian's negative: the same field with every colour inverted, light for dark, and the mark in black. With Obsidian, a dark and a light monotone icon.",
    invert: true,
    markInk: "#000000",
  },
  ...RING_GRADIENTS.map(fromGradient),
];

const TONES = ["light", "dark", "paper", "rings"];

// Every key a palette (or the house style) may write. "Own" restores these from the look, and
// every palette starts from them — so nothing one palette sets leaks into the next.
const PALETTE_KEYS = [
  ...Array.from({ length: 12 }, (_, i) => `pal${i + 1}`),
  "palCount", "bands", "palNoise", "sharpness", "saturation", "innerShift", "innerLight",
  "seamGlow", "seamWidth", "seamInk", "seamMix", "metalSheen",
  "lineInk", "lineTone", "lineLift", "accentChance",
  "acc1", "acc2", "acc3", "acc4", "acc1w", "acc2w", "acc3w", "acc4w",
  "throatInk", "ringInk", "glowInk", "glow", "glowCore", "ink", "inkA", "inkB", "inkC",
  "ringHairInk", "ringScatter", "ringDetail", "ringContrast", "ringBright", "invert",
];

// Paper: ONE spot ink flooded over the stock, as a screen print lays a colour (a mixture of
// thin tints only went grey), in two densities so the rays still read; the engraving and the
// loop are printed over it in the palette's ink.
function paperStops(p) {
  const stock = col(p.ground);
  const flood = col(p.print.flood ?? p.print.spots[0]);
  // the densest the flood may go and still carry the loop's dark ink (OKLab L ≥ 0.6)
  let lo = 0;
  let hi = 0.9;
  for (let i = 0; i < 20; i++) {
    const mid = 0.5 * (lo + hi);
    if (labL(tint(stock, flood, mid)) >= 0.6) lo = mid;
    else hi = mid;
  }
  return [1, 1, 0.86, 1, 1, 0.9, 1, 0.82].map((k) => tint(stock, flood, k * lo));
}

function findPalette(id) {
  return PALETTES.find((p) => p.id === id) ?? null;
}

// The parameters palette `id` writes in `tone` (an empty object for an unknown id or tone).
function paletteValues(id, tone) {
  const p = findPalette(id);
  if (!p || !TONES.includes(tone)) return {};
  const v = { ...HOUSE[tone] };
  const stops = tone === "paper" ? paperStops(p) : (tone === "rings" ? (p.rings ?? p.dark) : p[tone]).map(col);
  for (let i = 0; i < 12; i++) v[`pal${i + 1}`] = stops[i % stops.length];
  v.palCount = stops.length;
  const metal = col(p.metal);
  const seamInk = col(p.seam.ink);
  if (tone === "light") {
    const lum = col(p.luminous);
    Object.assign(v, {
      seamInk, seamMix: p.seam.mix,
      lineInk: lum, acc1: metal, acc2: seamInk, acc3: stops[0], acc4: stops[1],
      throatInk: col(p.deep), glowInk: lum, ringInk: metal,
    });
  } else if (tone === "dark") {
    Object.assign(v, {
      seamInk, seamMix: p.seam.mix,
      lineInk: col(p.luminous), acc1: metal, acc2: seamInk, acc3: stops[0], acc4: stops[1],
      throatInk: "#000000", glowInk: metal, ringInk: metal,
    });
  } else if (tone === "rings") {
    // a black singularity; the light at it and the hairlines in the palette's luminous colour
    Object.assign(v, {
      seamInk, seamMix: p.seam.mix,
      lineInk: col(p.luminous), acc1: metal, acc2: seamInk, acc3: stops[0], acc4: stops[1],
      throatInk: "#000000", glowInk: col(p.luminous), ringInk: metal,
    });
  } else {
    const ink = col(p.print.ink);
    const [sA, sB, sC] = p.print.spots.map(col);
    const stock = col(p.ground);
    Object.assign(v, {
      seamInk, lineInk: ink, acc1: ink, acc2: sC, acc3: sA, acc4: sB,
      throatInk: stock, glowInk: stock, ringInk: ink, ink, inkA: sA, inkB: sB, inkC: sC,
    });
  }
  v.ringHairInk = col(p.hair ?? p.luminous);
  // a negative: the field inverted (mark.wgsl turns its colours over) and the mark in its ink
  if (p.invert) Object.assign(v, { invert: true, ink: p.markInk ?? "#000000" });
  return { ...v, ...(p.style?.[tone] ?? {}) };
}

// What a swatch shows: the stops, the colour at its centre, and on paper the inks.
function swatchOf(values, tone) {
  const n = Math.max(2, Math.min(12, Math.round(values.palCount ?? 12)));
  const stops = Array.from({ length: n }, (_, i) => values[`pal${i + 1}`]);
  if (tone === "paper") return { stops, centre: values.lineInk, inks: [values.acc3, values.acc4, values.acc2], paper: true };
  if (tone === "rings") return { stops, centre: values.throatInk, paper: false, rings: true };
  return { stops, centre: tone === "dark" ? values.throatInk : values.glowInk, paper: false };
}

return { oklchHex, PALETTES, TONES, PALETTE_KEYS, findPalette, paletteValues, swatchOf };
})();


export { COARSE, UNIFORM_BYTES, WGSL_STRUCT, hexToRgb, rgbToHex, srgbToOklab, SECTIONS, PARAMS, DEFAULTS, PRESETS, presetValues, normalize, animate, loopShape, curvePoint, halfWidth, livViewTilt, livExtent, frameScale, pack, MarkUnavailable, loadShaderSource, createEngine, markSVG, smallT, smallLookT, smallParams, smallPost, smallPxScale, smallK, lightness, measure, oklchHex, PALETTES, TONES, PALETTE_KEYS, findPalette, paletteValues, swatchOf };
