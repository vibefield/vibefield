#!/usr/bin/env node
// The living mark, drawn as SVG (DESIGN.md §8 "The living mark, drawn as SVG"): the field's own mark — the band
// that runs the ∞ with its one half-twist, and its three lights — animated, for a load the field doesn't draw.
// GENERATED from the vendored splash (packages/field-app/src/boot/splash/vibefield-splash.js): the mark's shader
// constants (BAKED.mark.wgsl), its moving uniforms (BAKED.mark.dyn) and the clock its runtime runs (`phases`), so a
// new bake reaches the kit only by running this, never by a hand edit.
//   node tooling/splash/living-mark.mjs           writes packages/design-kit/src/living-mark/
//   node tooling/splash/living-mark.mjs --check   fails if a committed file differs
//
// How the shader's mark becomes SVG:
// - THE BAND is the shader's own geometry (livCurve, livRoll, livProject, livNormal, livWidth, ported below), in CSS
//   px of the field's mark box (BAKED.logo), as uniform Hermite cubics on a 1/100 px grid. A Möbius band has ONE
//   edge, twice round: one path, filled even-odd (each lobe's inside winds twice and stays empty), with the near
//   strand's piece over the crossing filled again (even-odd leaves where the strands overlap empty). Its hairline
//   is the rim (livRimFragment), in CSS px. The twist moves by CSS `d` keyframes at even steps of the twist, eased
//   between them by the cubic that matches the runtime's linger at both ends.
// - THE LIGHTS are livRgbEdge's thirds (rose, mint, cobalt), each a dash on that same edge (pathLength 1000), carried
//   by two ADDED animations: the twist's (a light rides the twist: livEdgeCoord) and the travel's (livEdgeSpeed).
//   Each has livEdgeFragment's glow and line as two stroke widths, and its soft ends as dash layers in equal alpha
//   steps of the shader's own profile along the light (livPulse into livStrokes). Where a light passes under the
//   near strand, a clip hides it.
// - WHAT IT LEAVES OUT, said in DESIGN.md: the breath (±0.25% of scale) and the drift (no effect in this look); and
//   a light keeps its place by the edge's length where the shader keeps it by the curve's parameter, so at a given
//   moment one stands a few px (up to ~12 at the field's scale) from where the field draws it.
// - UNDER REDUCED MOTION it stands at rest (the runtime's pose "at rest"), the pose the app icon wears.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BAKED, phases } from "../../packages/field-app/src/boot/splash/vibefield-splash.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "packages/design-kit/src/living-mark");
const check = process.argv.includes("--check");

const TAU = 2 * Math.PI;
const STEPS = 3; // `d` keyframes per half-turn of the twist (a band twist of 30° each: ≤ 0.06 px off between them)
const SEGMENTS = 16; // Hermite cubics per pass of the edge (≤ 0.04 px off the shader's curve)
const GRID = 100; // path data on a 1/100 px grid, as integers
const P = 1000; // the edge's pathLength: a light's place and length in thousandths of the edge
const RIM = 0.5; // the hairline, CSS px (the shader's livHairPx: 0.6 device px)
const GAP = 0.25; // px: how far inside the near strand's edges a passing light is hidden
const SPAN = 0.16; // the near strand's piece over the crossing: t = 3π/2 ± SPAN
const MARGIN = 1.6; // px of room round the band for the lights' glow
const LAYERS = { glow: 3, line: 2 }; // dash layers for a light's soft ends
const GLOW = 0.8; // the glow's strength against the shader's model, matched to its measured profile
const GROUNDS = { dark: "#fff", light: "#000" }; // the ink on each ground: the app icon's two (DESIGN.md §12)

// ── the bake, and what this port assumes of it ────────────────────────────────────────────────
function constants() {
  const K = {};
  const wgsl = BAKED.mark.wgsl;
  for (const m of wgsl.matchAll(
    /const (K_\w+) = (?:vec4f\(([^)]*)\)|array<vec4f, \d+>\((.*?)\));\n/g,
  )) {
    K[m[1]] =
      m[2] !== undefined
        ? m[2].split(",").map(Number)
        : [...m[3].matchAll(/vec4f\(([^)]*)\)/g)].map((v) => v[1].split(",").map(Number));
  }
  const num = (name) => {
    const m = wgsl.match(new RegExp(`const ${name}: \\w+ = ([\\d.]+)u?;`));
    if (m === null) throw new Error(`the mark's shader lost ${name}`);
    return Number(m[1]);
  };
  return { K, FIT: num("LIV_FIT") };
}
const { K, FIT } = constants();
const dyn = Object.fromEntries(BAKED.mark.dyn);
const assume = (ok, what) => {
  if (!ok) throw new Error(`a new bake changed what the SVG assumes: ${what}`);
};
assume(
  K.K_cam?.join() === "1,0,0,0" && K.K_place?.join() === "0,0,0,0",
  "the mark's camera and place",
);
assume(dyn.livF?.[0] === "livTwist" && dyn.livF[1] === 0, "an even twist (livF.y = 0)");
assume(dyn.livF[2] === 1, "a body of plain ink (livF.z = 1)");
assume(dyn.livF[3] === 3, "lit lines on the edges (livF.w = 3)");
assume(dyn.livG?.[2] === 0, "a flat band (livG.z = 0)");
assume(dyn.livE?.[1] === "livTravel" && dyn.livE[3] === 3, "three lights");
assume(dyn.livE[0] / 1.4 > 0.999, "the lights at full strength (livE.x ≥ 1.4, as float32)");
assume(BAKED.mark.rim === true && BAKED.mark.edges === true, "the rim and the edges drawn");
assume(BAKED.logo.pose === "in motion", "the mark in motion");
assume(BAKED.phases.loopSeconds === 0, "an unlooped clock (loopSeconds = 0)");
assume(
  BAKED.phases.livEdgeSpeed < 0,
  "the lights travelling forward along the edge (livEdgeSpeed < 0)",
);

// ── the mark's geometry (BAKED.mark.wgsl, line for line) ──────────────────────────────────────
const [A, B, D] = [K.K_livA, K.K_livB, K.K_livD];
const UNIT = (Math.min(BAKED.logo.w, BAKED.logo.h) * BAKED.logo.zoom) / 2; // px per unit (geometry()'s lpx at k = 1)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const livCurve = (t) => {
  const s = Math.sin(t);
  const c = Math.cos(t);
  const den = 1 + B[1] * s * s;
  return [
    ((A[1] * c) / den) * A[0],
    ((A[2] * Math.sin(2 * t)) / den) * (1 + B[3] * c) * A[0],
    -D[1] * s * A[0],
  ];
};
const livRoll = (p) => {
  const a = D[0];
  const ax = [
    p[0],
    p[1] * Math.cos(a) - p[2] * Math.sin(a),
    p[1] * Math.sin(a) + p[2] * Math.cos(a),
  ];
  return [
    Math.cos(B[2]) * ax[0] - Math.sin(B[2]) * ax[1],
    Math.sin(B[2]) * ax[0] + Math.cos(B[2]) * ax[1],
    ax[2],
  ];
};
// → [x, y] in CSS px of the mark's box, y down
const livProject = (p) => {
  const w = 1 - p[2] * D[2] * 0.2;
  return [
    BAKED.logo.w / 2 + ((p[0] * FIT) / w) * UNIT,
    BAKED.logo.h / 2 + ((p[1] * FIT) / w) * UNIT,
  ];
};
const livNormal = (t, twist) => {
  const T = unit(sub(livCurve(t + 0.001), livCurve(t - 0.001)));
  const N = unit([-T[1], T[0], 0]);
  const half = (t - twist) * 0.5;
  return add(mul(N, Math.cos(half)), mul(unit(cross(T, N)), Math.sin(half)));
};
const livWidth = (t) => A[3] * A[0] * (1 + B[0] * Math.sin(t + 0.7));
const edge = (t, side, twist) =>
  livProject(livRoll(add(livCurve(t), mul(livNormal(t, twist), livWidth(t) * side))));
const centre = (t) => livProject(livRoll(livCurve(t)));
// the edge's own coordinate (livEdgeCoord without the twist): v ∈ [0, 1), side +1 for t = 4πv, then side −1
const along = (v) => {
  const f = v - Math.floor(v);
  return f < 0.5 ? { t: 4 * Math.PI * f, side: 1 } : { t: 4 * Math.PI * (f - 0.5), side: -1 };
};

// ── the clock (the runtime's `phases`, pose "in motion"), checked against it ──────────────────
const PH = BAKED.phases;
const REST = 1.5 * Math.PI + PH.livRestTwist * (Math.PI / 180); // REST_TWIST
const HALF = Math.PI / (PH.livSpeed * PH.livRoll); // s per half-turn of the twist
const PERIOD = 4 * HALF; // the edge's path repeats after two whole turns (a Möbius edge is two laps)
const TRAVEL = 1 / Math.abs(PH.livSpeed * PH.livEdgeSpeed * 0.025); // s per lap of the lights
const X = (f) => f - (PH.livLinger * Math.sin(TAU * f)) / TAU; // the twist's progress through a half-turn
const dX = (f) => 1 - PH.livLinger * Math.cos(TAU * f);
const twistAt = (tau) => REST + Math.PI * (Math.floor(tau / HALF) + X((tau / HALF) % 1));
for (let i = 0; i < 400; i++) {
  const tau = i * 0.137;
  const ph = phases(PH, tau, "in motion");
  const dTwist = Math.abs(((twistAt(tau) - ph.livTwist + 3 * Math.PI) % TAU) - Math.PI);
  const travel = -tau / TRAVEL - Math.floor(-tau / TRAVEL);
  const dTravel = Math.abs(((travel - ph.livTravel + 1.5) % 1) - 0.5);
  if (dTwist > 1e-6 || dTravel > 1e-6)
    throw new Error(`the runtime's clock moved at ${tau.toFixed(3)} s: ${dTwist}, ${dTravel}`);
}
// the `d` keyframes: STEPS a half-turn, at even steps of the twist, each interval eased by a Hermite cubic
const solveF = (x) => {
  let f = x;
  for (let i = 0; i < 60; i++) f -= (X(f) - x) / dX(f);
  return f;
};
const frames = [];
for (let h = 0; h < 4; h++)
  for (let j = 0; j < STEPS; j++) {
    const f = solveF(j / STEPS);
    frames.push({ x: h + j / STEPS, f, tau: (h + f) * HALF });
  }
frames.push({ x: 4, f: 1, tau: PERIOD });
for (let i = 0; i < frames.length - 1; i++) {
  const [a, b] = [frames[i], frames[i + 1]];
  const span = (b.tau - a.tau) / HALF / (b.x - a.x);
  a.ease = [1 / 3, (dX(a.f) * span) / 3, 2 / 3, 1 - (dX(b.f === 0 ? 1 : b.f) * span) / 3];
}

// ── path data: integers on the grid, relative to the rounded point before (no drift) ──────────
const q = (v) => Math.round(v * GRID);
const nums = (list) => list.map((v, i) => (i > 0 && v >= 0 ? " " : "") + v).join("");
const hermite = (E, t0, t1, n) => {
  const out = [];
  const d = (t) => {
    const [a, b] = [E(t - 1e-4), E(t + 1e-4)];
    return [(b[0] - a[0]) / 2e-4, (b[1] - a[1]) / 2e-4];
  };
  for (let i = 0; i < n; i++) {
    const [a, b] = [t0 + ((t1 - t0) * i) / n, t0 + ((t1 - t0) * (i + 1)) / n];
    const k = (b - a) / 3;
    const [pa, pb, da, db] = [E(a), E(b), d(a), d(b)];
    out.push([
      pa,
      [pa[0] + da[0] * k, pa[1] + da[1] * k],
      [pb[0] - db[0] * k, pb[1] - db[1] * k],
      pb,
    ]);
  }
  return out;
};
// a C1 run: its start (M, or L to join a run before), one c, then s (the reader reflects the control point)
const run = (pieces, start) => {
  let [x, y] = [q(pieces[0][0][0]), q(pieces[0][0][1])];
  let s = `${start}${nums([x, y])}`;
  pieces.forEach(([, c1, c2, p], i) => {
    const [a, b, c] = [c1, c2, p].map(([u, w]) => [q(u), q(w)]);
    s +=
      i === 0
        ? `c${nums([a[0] - x, a[1] - y, b[0] - x, b[1] - y, c[0] - x, c[1] - y])}`
        : `s${nums([b[0] - x, b[1] - y, c[0] - x, c[1] - y])}`;
    [x, y] = c;
  });
  return s;
};
const NEAR = 1.5 * Math.PI; // the near strand crosses the centre at t = 3π/2 (z > 0)
const loopD = (tw) =>
  `${run(
    [
      ...hermite((t) => edge(t, 1, tw), 0, TAU, SEGMENTS),
      ...hermite((t) => edge(t, -1, tw), 0, TAU, SEGMENTS),
    ],
    "M",
  )}z`;
const pieceD = (E1, E2, n) =>
  `${run(hermite(E1, NEAR - SPAN, NEAR + SPAN, n), "M")}${run(hermite(E2, NEAR + SPAN, NEAR - SPAN, n), "L")}z`;
const coverD = (tw) =>
  pieceD(
    (t) => edge(t, 1, tw),
    (t) => edge(t, -1, tw),
    2,
  );
const inside = (tw, side) => (t) => {
  const [c, e] = [centre(t), edge(t, side, tw)];
  const len = Math.hypot(e[0] - c[0], e[1] - c[1]);
  const k = len > GAP ? (len - GAP) / len : 0;
  return [c[0] + (e[0] - c[0]) * k, c[1] + (e[1] - c[1]) * k];
};
const holeD = (tw) => pieceD(inside(tw, 1), inside(tw, -1), 3);

// the box: the band's reach over the whole motion, with room round it for the lights' glow
let bb = [Infinity, Infinity, -Infinity, -Infinity];
for (let j = 0; j <= 64; j++)
  for (let i = 0; i < 1024; i++) {
    const { t, side } = along(i / 1024);
    const [x, y] = edge(t, side, REST + (4 * Math.PI * j) / 64);
    bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)];
  }
const BOX = [Math.floor(bb[0] - MARGIN), Math.floor(bb[1] - MARGIN)];
BOX.push(Math.ceil(bb[2] + MARGIN) - BOX[0], Math.ceil(bb[3] + MARGIN) - BOX[1]);

// ── the lights (livEdgeFragment, style 3; livPulse; livRgbEdge) ───────────────────────────────
const hex = (c) =>
  `#${c
    .slice(0, 3)
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
const COLOURS = [hex(K.K_livCol[0]), hex(K.K_livCol[3]), hex(K.K_livCol[1])]; // the thirds: rose, mint, cobalt
const HALFLEN = (0.025 + (0.14 - 0.025) * dyn.livE[2]) / 3; // a light's half-length, in laps of the edge
const FLAT = 0.55 * HALFLEN;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const pulse = (d) => 1 - smooth(FLAT, HALFLEN, Math.abs(d));
// at a line's centre, at the scale the field draws (livStrokes: n = 1 + 2·response·√(r² − d²), response·EW and
// response·R the same at every scale): the glow, the line, and the line over the glow
const loopPx = 2 * 1.04 * A[1] * A[0] * FIT * UNIT; // livLoopPx at k = 1
const EW = 0.0042 * loopPx * (D[3] / 0.22); // livLinePx: the line's width
const R = 0.5 * K.K_livH[3] * EW; // the glow's reach
const segPx = (() => {
  let s = 0;
  let p = edge(0, 1, REST);
  for (let i = 1; i <= 1024; i++) {
    const e = edge((TAU * i) / 1024, 1, REST);
    s += Math.hypot(e[0] - p[0], e[1] - p[1]);
    p = e;
  }
  return s / 512; // px per segment of the shader's strip (LIV_SEGMENTS)
})();
const response = 420 / 512 / segPx; // LIV_PIECES / LIV_SEGMENTS per px
const glow = (p) => GLOW * (1 - (1 - K.K_livH[2] * p) ** (1 + 2 * response * R));
const line = (p) => 1 - (1 - p) ** (1 + response * EW);
const lineOverGlow = (p) =>
  Math.min(1, (line(p) + (1 - line(p)) * glow(p) - glow(p)) / (1 - glow(p)));
// LAYERS dashes, nested, each a step of alpha up the profile along the light
const ladder = (fn, n) => {
  const top = fn(1);
  let below = 0;
  return Array.from({ length: n }, (_, i) => {
    const want = ((i + 0.5) / n) * top;
    let [lo, hi] = [0, HALFLEN];
    for (let k = 0; k < 60; k++) {
      const m = (lo + hi) / 2;
      if (fn(pulse(m)) > want) lo = m;
      else hi = m;
    }
    const level = ((i + 1) / n) * top;
    const o = 1 - (1 - level) / (1 - below);
    below = level;
    return { half: (lo + hi) / 2, o };
  });
};
const KINDS = [
  ["g", 2 * R, ladder(glow, LAYERS.glow)],
  ["k", EW, ladder(lineOverGlow, LAYERS.line)],
];
// where each light stands at rest (livRestLights), in thousandths of the edge's length at rest
const N = 4096;
const restS = [0];
let prev = edge(0, 1, REST);
for (let i = 1; i <= N; i++) {
  const { t, side } = along(i / N);
  const e = edge(t, side, REST);
  restS.push(restS[i - 1] + Math.hypot(e[0] - prev[0], e[1] - prev[1]));
  prev = e;
}
const LOOP = restS[N];
const restAt = (k) => {
  const v = (k + 0.25) / 3 + REST / (4 * Math.PI) - PH.livRestLights; // livPulse's centre, livEdgeCoord's frame
  const f = (v - Math.floor(v)) * N;
  const i = Math.floor(f);
  return ((restS[i] + (restS[Math.min(i + 1, N)] - restS[i]) * (f - i)) / LOOP) * P;
};

// ── the SVG ───────────────────────────────────────────────────────────────────────────────────
const r2 = (v) => +v.toFixed(2);
const r4 = (v) => +v.toFixed(4);
const pct = (tau) => `${r4((tau / PERIOD) * 100)}%`;
const keyframes = (name, prop, value) =>
  `@keyframes vf-lm-${name}{${frames
    .map(
      (f, i) =>
        `${pct(f.tau)}{${prop}:${value(i)}${f.ease ? `;animation-timing-function:cubic-bezier(${f.ease.map(r4).join(",")})` : ""}}`,
    )
    .join("")}}`;
const LOOPS = frames.map((f) => loopD(REST + Math.PI * f.x));
const COVERS = frames.map((f) => coverD(REST + Math.PI * f.x));
const OUTER = `M${nums([q(BOX[0] - 1), q(BOX[1] - 1)])}h${q(BOX[2] + 2)}v${q(BOX[3] + 2)}h${-q(BOX[2] + 2)}z`;
const HOLES = frames.map((f) => OUTER + holeD(REST + Math.PI * f.x));
const s = (v) => `${r4(v)}s`;

function svgFor(ground) {
  const ink = `var(--vf-mark-ink,${GROUNDS[ground]})`;
  const css = [
    `.vf-lm-i{fill:${ink};stroke:${ink};stroke-width:${RIM}px;vector-effect:non-scaling-stroke;stroke-linejoin:round}`,
    `.vf-lm-e{d:path("${LOOPS[0]}")}`,
    ".vf-lm-l{fill:none;stroke-linecap:round}",
    keyframes("loop", "d", (i) => `path("${LOOPS[i]}")`),
    keyframes("cover", "d", (i) => `path("${COVERS[i]}")`),
    keyframes("hole", "d", (i) => `path("${HOLES[i]}")`),
    keyframes("twist", "stroke-dashoffset", (i) => `${r2((-P * frames[i].x) / 4)}`),
    `@keyframes vf-lm-travel{from{stroke-dashoffset:0}to{stroke-dashoffset:-${P}}}`,
    `.vf-lm-e{animation:vf-lm-loop ${s(PERIOD)} infinite}`,
    `.vf-lm-c{animation:vf-lm-cover ${s(PERIOD)} infinite}`,
    `.vf-lm-h{animation:vf-lm-hole ${s(PERIOD)} infinite}`,
    // the travel starts where the runtime's does (livTravel = 0 at 0 s), from the lights' place at rest
    `.vf-lm-l{animation:vf-lm-loop ${s(PERIOD)} infinite,vf-lm-twist ${s(PERIOD)} infinite,vf-lm-travel ${s(TRAVEL)} linear ${s(-PH.livRestLights * TRAVEL)} infinite;animation-composition:replace,add,add}`,
    "@media (prefers-reduced-motion:reduce){.vf-lm-e,.vf-lm-c,.vf-lm-h,.vf-lm-l{animation:none}}",
  ];
  for (const [kind, width, layers] of KINDS)
    layers.forEach((layer, j) => {
      const len = Math.max(2 * layer.half * P - (width / LOOP) * P, 0.5); // a round cap reaches width/2 each end
      css.push(
        `.vf-lm-${kind}${j}{stroke-width:${r2(width * GRID)};stroke-opacity:${r4(layer.o)};stroke-dasharray:${r2(len)} ${r2(P - len)};stroke-dashoffset:calc(var(--o) + ${r2(len / 2)})}`,
      );
    });
  const lights = COLOURS.map((colour, k) => {
    const strokes = KINDS.flatMap(([kind, , layers]) =>
      layers.map((_, j) => `<path class="vf-lm-e vf-lm-l vf-lm-${kind}${j}" pathLength="${P}"/>`),
    );
    return `<g stroke="${colour}" style="--o:${r2(P - restAt(k))}">${strokes.join("")}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BOX.map(q).join(" ")}" width="${BOX[2]}" height="${BOX[3]}">
<!-- GENERATED by tooling/splash/living-mark.mjs from the vendored splash's look "${BAKED.look.name}" (${BAKED.look.hash}) — do not edit (DESIGN.md §8 "The living mark, drawn as SVG"). For a ${ground} ground. -->
<style>
${css.join("\n")}
</style>
<defs><clipPath id="vf-lm-x"><path class="vf-lm-h" clip-rule="evenodd" d="${HOLES[0]}"/></clipPath></defs>
<path class="vf-lm-i vf-lm-e" fill-rule="evenodd" d="${LOOPS[0]}"/>
<path class="vf-lm-i vf-lm-c" d="${COVERS[0]}"/>
<g clip-path="url(#vf-lm-x)">${lights.join("")}</g>
</svg>
`;
}

// ── write, or check ───────────────────────────────────────────────────────────────────────────
let stale = 0;
for (const ground of Object.keys(GROUNDS)) {
  const path = join(OUT, `living-mark-${ground}.svg`);
  const svg = svgFor(ground);
  if (existsSync(path) && readFileSync(path, "utf8") === svg) continue;
  stale++;
  if (check) console.error(`stale: ${path}`);
  else {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path, svg);
    console.log(`wrote ${path} (${Buffer.byteLength(svg)} bytes)`);
  }
}
if (check) {
  if (stale > 0) {
    console.error(
      `${stale} living mark file(s) out of date — run node tooling/splash/living-mark.mjs`,
    );
    process.exit(1);
  }
  console.log(`living mark fresh: ${BOX[2]} × ${BOX[3]} px, look ${BAKED.look.hash}`);
} else if (stale === 0) console.log("living mark already fresh");
