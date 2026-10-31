// THE PHONE'S CATALOG (PHONE.md §2), made from Apple's own data: every iPhone the macOS Simulator knows, read from Xcode's
// CoreSimulator device types and DeviceKit chrome on this Mac — never a hand table —
//   profile.plist        the framebuffer (pixels, scale, dpi), the chrome it wears, the runtimes
//   <mask>.pdf           the display's shape: its continuous corners (fitted here as a superellipse)
//   sensor_bar_*.pdf     the notch's outline (empty for the Dynamic Island — iOS draws that itself)
//   chrome.json          the body's corner, the side buttons, the home button
// — merged with what the Simulator does not carry: the bodies' published dimensions, the launch year and finishes, the
// side's profile and the camera bump. Written as a typed module, so the kind, the units and the stills never need Xcode:
//   pnpm --filter @vibefield/plugin-simulator gen:catalog      → src/catalog.gen.ts (and a report on stdout)
//   then `pnpm exec biome check --write plugins/simulator/src/catalog.gen.ts` (the repo's one formatter).
// The Dynamic Island's size is not in any file: it was measured from real frames of booted Simulators (PHONE.md §2.3) and
// lives in ISLANDS below. A port of the prototype's draft/ground tools/make-iphone-catalog.mjs, number for number.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, inflateSync } from "node:zlib";
import type { BandMetal, Corner, Cutout, Edge, PhoneButton, PhoneModel } from "../src/model";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "src", "catalog.gen.ts");
const TYPES = "/Library/Developer/CoreSimulator/Profiles/DeviceTypes";
const CHROME = "/Library/Developer/DeviceKit/Chrome";
const XCODE_VERSION = "/Applications/Xcode.app/Contents/version.plist";

// ---------------------------------------------------------------- what the Simulator does not carry

/** A model's spec: launch year, body (w, h, d mm — Apple's published tech specs), side, band, camera bump (height, from top, mm — estimated from product imagery), launch finishes (theme.ts keys, the first the default), and whether the body is ours. */
type Spec = readonly [
  year: number,
  body: readonly [number, number, number],
  edge: Edge,
  band: BandMetal,
  bump: readonly [number, number],
  finishes: readonly string[],
  assumed?: true,
];

const SPECS: Readonly<Record<string, Spec>> = {
  "iPhone 6s": [
    2015,
    [67.1, 138.3, 7.1],
    "round",
    "aluminium",
    [0.9, 12],
    ["space-gray-6s", "silver-6s", "gold-6s", "rose-gold-6s"],
  ],
  "iPhone 6s Plus": [
    2015,
    [77.9, 158.2, 7.3],
    "round",
    "aluminium",
    [0.9, 12],
    ["space-gray-6s", "silver-6s", "gold-6s", "rose-gold-6s"],
  ],
  "iPhone SE (1st generation)": [
    2016,
    [58.6, 123.8, 7.6],
    "chamfer",
    "aluminium",
    [0, 0],
    ["space-gray-6s", "silver-6s", "gold-6s", "rose-gold-6s"],
  ],
  "iPhone 7": [
    2016,
    [67.1, 138.3, 7.1],
    "round",
    "aluminium",
    [0.7, 13],
    ["black-7", "jet-black", "silver-6s", "gold-6s", "rose-gold-6s", "red-7"],
  ],
  "iPhone 7 Plus": [
    2016,
    [77.9, 158.2, 7.3],
    "round",
    "aluminium",
    [0.8, 22],
    ["black-7", "jet-black", "silver-6s", "gold-6s", "rose-gold-6s", "red-7"],
  ],
  "iPhone 8": [
    2017,
    [67.3, 138.4, 7.3],
    "round",
    "aluminium",
    [0.8, 13],
    ["space-gray-8", "silver-8", "gold-8", "red-8"],
  ],
  "iPhone 8 Plus": [
    2017,
    [78.1, 158.4, 7.5],
    "round",
    "aluminium",
    [0.9, 23],
    ["space-gray-8", "silver-8", "gold-8", "red-8"],
  ],
  "iPhone X": [2017, [70.9, 143.6, 7.7], "round", "steel", [1.2, 24], ["space-gray-x", "silver-x"]],
  "iPhone Xs": [
    2018,
    [70.9, 143.6, 7.7],
    "round",
    "steel",
    [1.2, 24],
    ["space-gray-x", "silver-x", "gold-xs"],
  ],
  "iPhone Xs Max": [
    2018,
    [77.4, 157.5, 7.7],
    "round",
    "steel",
    [1.2, 24],
    ["space-gray-x", "silver-x", "gold-xs"],
  ],
  "iPhone Xʀ": [
    2018,
    [75.7, 150.9, 8.3],
    "round",
    "aluminium",
    [0.9, 14],
    ["black-xr", "white-xr", "blue-xr", "yellow-xr", "coral-xr", "red-xr"],
  ],
  "iPhone 11": [
    2019,
    [75.7, 150.9, 8.3],
    "round",
    "aluminium",
    [1.3, 28],
    ["black-11", "white-11", "green-11", "yellow-11", "purple-11", "red-xr"],
  ],
  "iPhone 11 Pro": [
    2019,
    [71.4, 144.0, 8.1],
    "round",
    "steel",
    [1.6, 33],
    ["midnight-green", "space-gray-11p", "silver-11p", "gold-11p"],
  ],
  "iPhone 11 Pro Max": [
    2019,
    [77.8, 158.0, 8.1],
    "round",
    "steel",
    [1.6, 33],
    ["midnight-green", "space-gray-11p", "silver-11p", "gold-11p"],
  ],
  "iPhone SE (2nd generation)": [
    2020,
    [67.3, 138.4, 7.3],
    "round",
    "aluminium",
    [0.8, 13],
    ["black-se", "white-se", "red-se"],
  ],
  "iPhone 12 mini": [
    2020,
    [64.2, 131.5, 7.4],
    "flat",
    "aluminium",
    [1.1, 25],
    ["black-12", "white-12", "blue-12", "green-12", "purple-12", "red-12"],
  ],
  "iPhone 12": [
    2020,
    [71.5, 146.7, 7.4],
    "flat",
    "aluminium",
    [1.2, 28],
    ["black-12", "white-12", "blue-12", "green-12", "purple-12", "red-12"],
  ],
  "iPhone 12 Pro": [
    2020,
    [71.5, 146.7, 7.4],
    "flat",
    "steel",
    [1.6, 32],
    ["pacific-blue", "graphite", "silver-steel", "gold-steel"],
  ],
  "iPhone 12 Pro Max": [
    2020,
    [78.1, 160.8, 7.4],
    "flat",
    "steel",
    [1.9, 35],
    ["pacific-blue", "graphite", "silver-steel", "gold-steel"],
  ],
  "iPhone 13 mini": [
    2021,
    [64.2, 131.5, 7.65],
    "flat",
    "aluminium",
    [1.8, 28],
    ["midnight", "starlight", "blue-13", "pink-13", "green-13", "red-12"],
  ],
  "iPhone 13": [
    2021,
    [71.5, 146.7, 7.65],
    "flat",
    "aluminium",
    [1.8, 30],
    ["midnight", "starlight", "blue-13", "pink-13", "green-13", "red-12"],
  ],
  "iPhone 13 Pro": [
    2021,
    [71.5, 146.7, 7.65],
    "flat",
    "steel",
    [3.6, 36],
    ["sierra-blue", "graphite", "silver-steel", "gold-steel", "alpine-green"],
  ],
  "iPhone 13 Pro Max": [
    2021,
    [78.1, 160.8, 7.65],
    "flat",
    "steel",
    [3.6, 37],
    ["sierra-blue", "graphite", "silver-steel", "gold-steel", "alpine-green"],
  ],
  "iPhone SE (3rd generation)": [
    2022,
    [67.3, 138.4, 7.3],
    "round",
    "aluminium",
    [0.8, 13],
    ["midnight", "starlight", "red-se"],
  ],
  "iPhone 14": [
    2022,
    [71.5, 146.7, 7.8],
    "flat",
    "aluminium",
    [2.3, 31],
    ["midnight", "starlight", "blue-14", "purple-14", "yellow-14", "red-12"],
  ],
  "iPhone 14 Plus": [
    2022,
    [78.1, 160.8, 7.8],
    "flat",
    "aluminium",
    [2.3, 31],
    ["midnight", "starlight", "blue-14", "purple-14", "yellow-14", "red-12"],
  ],
  "iPhone 14 Pro": [
    2022,
    [71.5, 147.5, 7.85],
    "flat",
    "steel",
    [4.2, 37],
    ["deep-purple", "space-black", "silver-steel", "gold-14p"],
  ],
  "iPhone 14 Pro Max": [
    2022,
    [77.6, 160.7, 7.85],
    "flat",
    "steel",
    [4.2, 38],
    ["deep-purple", "space-black", "silver-steel", "gold-14p"],
  ],
  "iPhone 15": [
    2023,
    [71.6, 147.6, 7.8],
    "contour",
    "aluminium",
    [2.3, 31],
    ["pink-15", "black-15", "blue-15", "green-15", "yellow-15"],
  ],
  "iPhone 15 Plus": [
    2023,
    [77.8, 160.9, 7.8],
    "contour",
    "aluminium",
    [2.3, 31],
    ["pink-15", "black-15", "blue-15", "green-15", "yellow-15"],
  ],
  "iPhone 15 Pro": [
    2023,
    [70.6, 146.6, 8.25],
    "contour",
    "titanium",
    [3.9, 37],
    ["natural-titanium", "blue-titanium", "white-titanium", "black-titanium"],
  ],
  "iPhone 15 Pro Max": [
    2023,
    [76.7, 159.9, 8.25],
    "contour",
    "titanium",
    [3.9, 38],
    ["natural-titanium", "blue-titanium", "white-titanium", "black-titanium"],
  ],
  "iPhone 16": [
    2024,
    [71.6, 147.6, 7.8],
    "contour",
    "aluminium",
    [2.4, 32],
    ["ultramarine", "teal-16", "pink-16", "white-16", "black-16"],
  ],
  "iPhone 16 Plus": [
    2024,
    [77.8, 160.9, 7.8],
    "contour",
    "aluminium",
    [2.4, 32],
    ["ultramarine", "teal-16", "pink-16", "white-16", "black-16"],
  ],
  "iPhone 16 Pro": [
    2024,
    [71.5, 149.6, 8.25],
    "contour",
    "titanium",
    [4.0, 38],
    ["desert-titanium", "natural-titanium", "white-titanium", "black-titanium"],
  ],
  "iPhone 16 Pro Max": [
    2024,
    [77.6, 163.0, 8.25],
    "contour",
    "titanium",
    [4.0, 38],
    ["desert-titanium", "natural-titanium", "white-titanium", "black-titanium"],
  ],
  "iPhone 16e": [
    2025,
    [71.5, 146.7, 7.8],
    "flat",
    "aluminium",
    [1.0, 20],
    ["black-16e", "white-16e"],
  ],
  "iPhone 17": [
    2025,
    [71.5, 149.6, 7.95],
    "contour",
    "aluminium",
    [2.4, 32],
    ["lavender", "mist-blue", "sage-17", "white-17", "black-17"],
  ],
  "iPhone 17 Pro": [
    2025,
    [71.9, 150.0, 8.75],
    "contour",
    "aluminium",
    [3.4, 42],
    ["cosmic-orange", "deep-blue", "silver-17p"],
  ],
  "iPhone 17 Pro Max": [
    2025,
    [78.0, 163.4, 8.75],
    "contour",
    "aluminium",
    [3.4, 42],
    ["cosmic-orange", "deep-blue", "silver-17p"],
  ],
  "iPhone Air": [
    2025,
    [74.7, 156.2, 5.64],
    "contour",
    "titanium",
    [3.0, 26],
    ["sky-blue", "light-gold", "cloud-white", "space-black-air"],
  ],
  // Newer than the dimensions this catalog holds: the Simulator gives it the 16e's screen, mask, notch and chrome, so it
  // is given the 16e's body — marked `assumed`.
  "iPhone 17e": [
    2026,
    [71.5, 146.7, 7.8],
    "flat",
    "aluminium",
    [1.0, 20],
    ["black-16e", "white-16e"],
    true,
  ],
};

/**
 * The side seen from above, mm: the rim where the band turns into the glass — how wide it shows and how far it falls (a
 * ROUND side falls to its equator, half the depth: the lower half tucks under) — and how much of the rim is metal before
 * the glass (a round phone's glass curves down into the band: the "2.5D" edge). Estimated from product imagery.
 */
const EDGES: Readonly<
  Record<
    Edge,
    (
      depth: number,
      band: BandMetal,
    ) => { readonly rim: readonly [number, number]; readonly metal: number }
  >
> = {
  round: (T, band) => ({ rim: [2.4, T * 0.46], metal: band === "steel" ? 0.9 : 1.05 }),
  flat: (_T, band) =>
    band === "steel" ? { rim: [0.4, 0.4], metal: 0.3 } : { rim: [0.45, 0.45], metal: 0.35 },
  contour: (_T, band) =>
    band === "aluminium" ? { rim: [0.95, 0.95], metal: 0.62 } : { rim: [1.0, 1.0], metal: 0.7 },
  chamfer: () => ({ rim: [0.55, 0.55], metal: 0.55 }),
};

/** An island in points: width, height, its top below the display's top edge; measured or borrowed. */
interface Island {
  readonly width: number;
  readonly height: number;
  readonly top: number;
}

/**
 * The Dynamic Island, collapsed, in points — drawn by iOS into the framebuffer, so not in any file: MEASURED from real
 * frames of booted Simulators (`simctl io screenshot --mask=ignored`, iOS 26.1, Settings open so the pill shows on a light
 * ground; its black pixels' bounds), or, for a model not yet booted, the value of the one it shares a screen with.
 */
const ISLANDS: Readonly<Record<string, Island>> = {
  "iPhone 15 Pro": { width: 125, height: 36.67, top: 11.33 },
  "iPhone 17 Pro": { width: 125.33, height: 36.67, top: 14 },
  "iPhone Air": { width: 125.33, height: 36.67, top: 20 },
};
/** A model without its own measurement takes the island of this one (same screen, same chrome family). */
const ISLAND_LIKE: Readonly<Record<string, string>> = {
  "iPhone 14 Pro": "iPhone 15 Pro",
  "iPhone 14 Pro Max": "iPhone 15 Pro",
  "iPhone 15": "iPhone 15 Pro",
  "iPhone 15 Plus": "iPhone 15 Pro",
  "iPhone 15 Pro Max": "iPhone 15 Pro",
  "iPhone 16": "iPhone 15 Pro",
  "iPhone 16 Plus": "iPhone 15 Pro",
  "iPhone 16 Pro": "iPhone 17 Pro",
  "iPhone 17": "iPhone 17 Pro",
  "iPhone 16 Pro Max": "iPhone 17 Pro",
  "iPhone 17 Pro Max": "iPhone 17 Pro",
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const islandOf = (name: string): Island => {
  const twin = ISLAND_LIKE[name];
  const isl = ISLANDS[name] ?? (twin === undefined ? undefined : ISLANDS[twin]);
  return (
    isl ??
    fail(`no island for ${name} — measure one (PHONE.md §2.3) or name its twin in ISLAND_LIKE`)
  );
};

// ---------------------------------------------------------------- PDF: just enough to read Apple's paths

type Point = readonly [number, number];
type Box = readonly [number, number, number, number];

function pdf(path: string): { readonly box: Box; readonly texts: readonly string[] } {
  const s = readFileSync(path).toString("latin1");
  const mb = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(s);
  if (mb === null) return fail(`${path}: no MediaBox`);
  const box: Box = [Number(mb[1]), Number(mb[2]), Number(mb[3]), Number(mb[4])];
  const texts: string[] = [];
  const re = /<<([\s\S]*?)>>\s*stream(\r\n|\n|\r)/g;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    const dict = m[1] ?? "";
    const start = m.index + m[0].length;
    if (/\/Subtype\s*\/XML|ICCBased|\/Alternate|\/N 3\b/.test(dict)) continue;
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let end = len ? start + Number(len[1]) : s.indexOf("endstream", start);
    if (!len) {
      while (end > start && (s[end - 1] === "\n" || s[end - 1] === "\r")) {
        end--;
        if (s[end - 1] !== "\r") break;
      }
    }
    let bytes = Buffer.from(s.slice(start, end), "latin1");
    if (/FlateDecode/.test(dict)) {
      try {
        bytes = inflateSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH });
      } catch {
        continue;
      }
    }
    texts.push(bytes.toString("latin1"));
  }
  return { box, texts };
}

type Mat = readonly [number, number, number, number, number, number];

/** Every subpath a content stream draws, as points (the CTM applied, each Bézier sampled at 16 steps). */
function subpaths(text: string): Point[][] {
  const toks = text.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?|[A-Za-z*'"]+/g) ?? [];
  let st: number[] = [];
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  let last: Point = [0, 0];
  const gs: Mat[] = [];
  const subs: Point[][] = [];
  let pts: Point[] = [];
  const T = (x: number, y: number): Point => [
    ctm[0] * x + ctm[2] * y + ctm[4],
    ctm[1] * x + ctm[3] * y + ctm[5],
  ];
  const mul = (a: Mat, b: Mat): Mat => [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
  const at = (i: number): number => st[i] ?? 0;
  for (const tk of toks) {
    const v = Number(tk);
    if (!Number.isNaN(v) && /^[-+.\d]/.test(tk)) {
      st.push(v);
      continue;
    }
    const n = st.length;
    if (tk === "q") gs.push(ctm);
    else if (tk === "Q") ctm = gs.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (tk === "cm" && n >= 6)
      ctm = mul([at(n - 6), at(n - 5), at(n - 4), at(n - 3), at(n - 2), at(n - 1)], ctm);
    else if (tk === "m" && n >= 2) {
      if (pts.length) subs.push(pts);
      pts = [];
      last = [at(n - 2), at(n - 1)];
      pts.push(T(...last));
    } else if (tk === "l" && n >= 2) {
      last = [at(n - 2), at(n - 1)];
      pts.push(T(...last));
    } else if ((tk === "c" && n >= 6) || ((tk === "v" || tk === "y") && n >= 4)) {
      const a = st.slice(tk === "c" ? n - 6 : n - 4);
      const g = (i: number): number => a[i] ?? 0;
      const p0 = last;
      const p1: Point = tk === "c" ? [g(0), g(1)] : tk === "v" ? last : [g(0), g(1)];
      const p2: Point = tk === "c" ? [g(2), g(3)] : tk === "v" ? [g(0), g(1)] : [g(2), g(3)];
      const p3: Point = tk === "c" ? [g(4), g(5)] : [g(2), g(3)];
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const u = 1 - t;
        pts.push(
          T(
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
          ),
        );
      }
      last = p3;
    } else if (tk === "re" && n >= 4) {
      const [x, y, w, h] = [at(n - 4), at(n - 3), at(n - 2), at(n - 1)];
      if (pts.length) subs.push(pts);
      subs.push([T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h)]);
      pts = [];
    }
    st = [];
  }
  if (pts.length) subs.push(pts);
  return subs;
}

/** The outline a mask or a sensor bar is: its longest subpath — the clip rects and fill rects round it are four points each. */
const outline = (texts: readonly string[]): Point[] =>
  texts.flatMap(subpaths).reduce<Point[]>((a, b) => (b.length > a.length ? b : a), []);

/**
 * A superellipse through corner points given as (u, v) = the distances from the corner's two edges' straight ends:
 * ((a − u)/a)ⁿ + ((a − v)/a)ⁿ = 1, a the curve's extent along each edge. A grid search minimising the worst radial
 * error; returns the extent, the exponent and that error (input units).
 */
function fitCorner(
  pts: readonly Point[],
  guess: number,
): { readonly extent: number; readonly n: number; readonly err: number } {
  let best = { extent: guess, n: 2, err: Number.POSITIVE_INFINITY };
  for (let a = guess * 0.6; a <= guess * 1.7; a += guess / 200) {
    for (let n = 1.5; n <= 8; n += 0.01) {
      let err = 0;
      for (const [u, v] of pts) {
        const X = (a - u) / a;
        const Y = (a - v) / a;
        if (X < 0 || Y < 0) {
          err = Number.POSITIVE_INFINITY;
          break;
        }
        err = Math.max(err, Math.abs((X ** n + Y ** n) ** (1 / n) - 1) * a);
      }
      if (err < best.err) best = { extent: a, n, err };
    }
  }
  return best;
}

/** The radius of the circle through a corner's 45° point: that point sits r(1 − 1/√2) in from both edges. */
const r45Of = (pts: readonly Point[]): number => {
  const first = pts[0] ?? fail("a corner with no points");
  const m = pts.reduce((b, p) => (Math.abs(p[0] - p[1]) < Math.abs(b[0] - b[1]) ? p : b), first);
  return (m[0] + m[1]) / 2 / (1 - Math.SQRT1_2);
};

/** The display's corner from its framebuffer mask, in mask units: the bottom-right corner's curve (the top-right if a notch's ear cuts the bottom — it never does). */
function maskCorner(path: string) {
  const { box, texts } = pdf(path);
  const W = box[2] - box[0];
  const H = box[3] - box[1];
  const pts = outline(texts).map(([x, y]): Point => [x - box[0], y - box[1]]);
  const lim = W * 0.16;
  // PDF y is up: the bottom-right corner is at (W, 0) — never cut by a notch
  let q = pts
    .map(([x, y]): Point => [W - x, y])
    .filter(([u, v]) => u > 0.5 && v > 0.5 && u < lim && v < lim);
  if (q.length < 8)
    q = pts
      .map(([x, y]): Point => [W - x, H - y])
      .filter(([u, v]) => u > 0.5 && v > 0.5 && u < lim && v < lim);
  if (q.length < 8) fail(`${path}: no corner curve`);
  const extent0 = Math.max(...q.map(([u, v]) => Math.max(u, v)));
  return { W, H, r45: r45Of(q), ...fitCorner(q, extent0), points: q.length };
}

/** The notch from a sensor bar (points, y up, the display's top edge at the box's top); null for an empty bar (the island phones). */
function notchOf(path: string) {
  const { box, texts } = pdf(path);
  const W = box[2] - box[0];
  const H = box[3] - box[1];
  const pts = outline(texts).map(([x, y]): Point => [x - box[0], y - box[1]]);
  if (pts.length < 10) return null;
  const minY = Math.min(...pts.map(([, y]) => y));
  const depth = H - minY;
  const right = pts.filter(([x]) => x > W / 2);
  const bottomEnd = Math.max(...right.filter(([, y]) => Math.abs(y - minY) < 0.08).map(([x]) => x));
  const wallX = Math.min(...right.filter(([, y]) => y > H - 0.4 * depth).map(([x]) => x));
  const a = wallX - bottomEnd;
  const q = right
    .filter(([x, y]) => x > bottomEnd + 0.05 && x < wallX - 0.05 && y > minY + 0.05 && y < minY + a)
    .map(([x, y]): Point => [wallX - x, y - minY]);
  const fit = fitCorner(q, a);
  return {
    half: wallX - W / 2,
    depth,
    corner: { r45: r45Of(q), extent: fit.extent, n: fit.n, err: fit.err },
    ear: W - wallX,
  };
}

/** A property list read as JSON (`plutil`, macOS's own reader). */
const plist = (path: string): Record<string, unknown> =>
  JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path]).toString()) as Record<
    string,
    unknown
  >;

const num = (rec: Record<string, unknown>, key: string, where: string): number => {
  const v = rec[key];
  return typeof v === "number" ? v : fail(`${where}: ${key} is not a number`);
};
const str = (rec: Record<string, unknown>, key: string, where: string): string => {
  const v = rec[key];
  return typeof v === "string" ? v : fail(`${where}: ${key} is not a string`);
};

/** DeviceKit's chrome.json, as far as the catalog reads it. */
interface Chrome {
  readonly paths?: { readonly simpleOutsideBorder?: { readonly cornerRadiusX?: number } };
  readonly inputs?: readonly {
    readonly name: string;
    readonly image?: string;
    readonly anchor?: string;
    readonly offsets: { readonly normal: { readonly y: number } };
  }[];
  readonly images: { readonly sizing: { readonly leftWidth: number; readonly topHeight: number } };
}

// ---------------------------------------------------------------- the catalog

if (!existsSync(TYPES)) fail(`no CoreSimulator device types at ${TYPES} — this tool needs Xcode`);
const xcode = existsSync(XCODE_VERSION) ? plist(XCODE_VERSION) : undefined;
const xcodeName =
  xcode === undefined
    ? "an unknown Xcode"
    : `Xcode ${String(xcode.CFBundleShortVersionString)} (${String(xcode.ProductBuildVersion)})`;
const models: PhoneModel[] = [];
const report: string[] = [];
const r = (v: number, k = 1000): number => Math.round(v * k) / k;
for (const dir of readdirSync(TYPES)
  .filter((d) => d.startsWith("iPhone") && d.endsWith(".simdevicetype"))
  .sort()) {
  const name = dir.replace(/\.simdevicetype$/, "");
  const spec = SPECS[name] ?? fail(`no spec for ${name} — add it to SPECS`);
  const [year, body, edge, band, bump, finishes, assumed] = spec;
  const res = resolve(TYPES, dir, "Contents/Resources");
  const info = plist(resolve(TYPES, dir, "Contents/Info.plist"));
  const p = plist(resolve(res, "profile.plist"));
  const where = `${name} profile.plist`;
  const W = num(p, "mainScreenWidth", where);
  const H = num(p, "mainScreenHeight", where);
  const scale = num(p, "mainScreenScale", where);
  const dpi = num(p, "mainScreenWidthDPI", where);
  const chromeId = str(p, "chromeIdentifier", where).split(".").pop() ?? "";
  const pxMm = 25.4 / dpi;
  const ptMm = pxMm * scale;
  report.push(
    `${name} (${String(p.modelIdentifier)}, ${year}) — ${W}×${H} @${scale}x, ${dpi} dpi, chrome ${chromeId}`,
  );
  // the display's corner: the mask is in its own units (the minis' at the 1125-wide UI scale, the Air's at 2×)
  let corner: Corner | null = null;
  if (typeof p.framebufferMask === "string") {
    const c = maskCorner(resolve(res, `${p.framebufferMask}.pdf`));
    const k = W / c.W;
    corner = { r45: r(c.r45 * k * pxMm), extent: r(c.extent * k * pxMm), n: r(c.n, 100) };
    report.push(
      `${"".padEnd(27)} display corner r45 ${((c.r45 * k) / scale).toFixed(2)} pt · extent ${((c.extent * k) / scale).toFixed(2)} pt · n ${c.n.toFixed(2)} · worst ${(c.err * k).toFixed(2)} px over ${c.points} points`,
    );
  }
  // the cutout
  let cutout: Cutout = { kind: "none" };
  if (typeof p.sensorBarImage === "string") {
    const nb = notchOf(resolve(res, `${p.sensorBarImage}.pdf`));
    if (nb !== null) {
      cutout = {
        kind: "notch",
        half: r(nb.half * ptMm),
        depth: r(nb.depth * ptMm),
        corner: {
          r45: r(nb.corner.r45 * ptMm),
          extent: r(nb.corner.extent * ptMm),
          n: r(nb.corner.n, 100),
        },
        ear: r(nb.ear * ptMm),
      };
      report.push(
        `${"".padEnd(27)} notch ${(2 * nb.half).toFixed(2)} × ${nb.depth.toFixed(2)} pt · corner ${nb.corner.extent.toFixed(2)} pt n ${nb.corner.n.toFixed(2)} (worst ${nb.corner.err.toFixed(2)} pt) · ears ${nb.ear.toFixed(2)} pt`,
      );
    } else {
      const isl = islandOf(name);
      cutout = {
        kind: "island",
        width: r(isl.width * ptMm),
        height: r(isl.height * ptMm),
        top: r(isl.top * ptMm),
      };
      report.push(
        `${"".padEnd(27)} island ${isl.width} × ${isl.height} pt at ${isl.top} pt — ${ISLANDS[name] ? "measured" : `as the ${ISLAND_LIKE[name]}`}`,
      );
    }
  }
  // the chrome: the body's corner (points), the buttons
  const chromeDir = resolve(CHROME, `${chromeId}.devicechrome`, "Contents/Resources");
  const ch = JSON.parse(readFileSync(resolve(chromeDir, "chrome.json"), "utf8")) as Chrome;
  const sz = ch.images.sizing;
  const T = body[2];
  const e = EDGES[edge](T, band);
  const screenMm: readonly [number, number] = [W * pxMm, H * pxMm];
  // the black border round the display, from the body: what the published body leaves round the panel (centred)
  const bezel: readonly [number, number] = [
    r((body[0] - screenMm[0]) / 2),
    r((body[1] - screenMm[1]) / 2),
  ];
  // the body's corner: concentric with the display's where the display is rounded (the chrome's outer radius is exactly
  // that — 80 pt = 62.1 + 17.9 on a 17 Pro); the chrome's own radius, as a circle-like curve, on the home-button phones
  const outer = ch.paths?.simpleOutsideBorder?.cornerRadiusX ?? 60;
  const bodyCorner: Corner =
    corner !== null
      ? {
          r45: r(corner.r45 + Math.min(bezel[0], bezel[1])),
          extent: r(corner.extent + Math.min(bezel[0], bezel[1])),
          n: corner.n,
        }
      : {
          r45: r(outer * ptMm),
          extent: r((outer * ptMm * (1 - Math.SQRT1_2)) / (1 - 2 ** (-1 / 2.4))),
          n: 2.4,
        };
  // buttons: the chrome places them in points from the device's top; the length is the image's
  const buttons: PhoneButton[] = [];
  let home: PhoneModel["home"] = null;
  for (const input of ch.inputs ?? []) {
    const img = input.image ? pdf(resolve(chromeDir, `${input.image}.pdf`)).box : null;
    const size = img ? [img[2] - img[0], img[3] - img[1]] : [16, 40];
    const [w0, h0] = [size[0] ?? 16, size[1] ?? 40];
    if (input.name === "home") {
      home = { diameter: r(w0 * ptMm), fromBottom: r((-input.offsets.normal.y - h0 / 2) * ptMm) };
      continue;
    }
    if (input.anchor !== "left" && input.anchor !== "right") continue;
    buttons.push({
      name: input.name,
      side: input.anchor,
      top: r(input.offsets.normal.y * ptMm),
      length: r(h0 * ptMm),
    });
  }
  // a cross-check the report shows: the body the chrome would draw (screen + its bezel) against the published one
  const chromeBody = [
    (W / scale + 2 * (sz.leftWidth - 1)) * ptMm,
    (H / scale + 2 * (sz.topHeight - 1)) * ptMm,
  ];
  report.push(
    `${"".padEnd(27)} body ${body[0]} × ${body[1]} × ${T} mm · the chrome's ${(chromeBody[0] ?? 0).toFixed(1)} × ${(chromeBody[1] ?? 0).toFixed(1)} · bezel ${bezel[0].toFixed(2)} / ${bezel[1].toFixed(2)} mm · corner r45 ${bodyCorner.r45.toFixed(2)} mm${home ? ` · home ⌀${home.diameter} mm` : ""}`,
  );
  const min = typeof p.minRuntimeVersion === "string" ? p.minRuntimeVersion : "";
  const max = typeof p.maxRuntimeVersion === "string" ? p.maxRuntimeVersion : null;
  models.push({
    id: str(info, "CFBundleIdentifier", `${name} Info.plist`),
    name,
    product: String(p.modelIdentifier),
    year,
    chrome: chromeId,
    runtimes: [min, max],
    screen: { px: [W, H], scale, dpi, mm: [r(screenMm[0]), r(screenMm[1])], corner },
    cutout,
    body: {
      mm: body,
      corner: bodyCorner,
      bezel,
      edge,
      band,
      rim: [r(e.rim[0]), r(e.rim[1])],
      metal: e.metal,
      bump,
    },
    home,
    buttons,
    finishes,
    ...(assumed ? { assumed: true as const } : {}),
  });
}
models.sort(
  (a, b) => a.year - b.year || a.body.mm[1] - b.body.mm[1] || a.name.localeCompare(b.name),
);

const out = `// GENERATED — do not edit. Made by plugins/simulator/scripts/make-catalog.ts (\`pnpm --filter @vibefield/plugin-simulator
// gen:catalog\`, then biome) from ${xcodeName}'s Simulator data on the Mac it ran on: the CoreSimulator device types
// (${TYPES}: profile.plist, the framebuffer masks, the sensor bars) and the DeviceKit chrome (${CHROME}:
// chrome.json), merged with Apple's published bodies (PHONE.md §2). ${models.length} iPhones, oldest first. Every length is mm.

import type { PhoneModel } from "./model";

export const PHONES: readonly PhoneModel[] = ${JSON.stringify(models, null, 2)};
`;
writeFileSync(OUT, out);
console.log(report.join("\n"));
console.log(`\n${models.length} iPhones from ${xcodeName} → ${OUT}`);
