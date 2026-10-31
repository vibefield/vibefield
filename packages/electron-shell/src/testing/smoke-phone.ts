// PT-S3 — THE PHONE'S LIVE ROWS (the brief `PT-S3-the-gates.md` §3 Part B and §4): `--phone` beside `--smoke-canvas`, run
// ALONE after the boot's, under `scripts/stage-simulator-fixture.mjs` — the STAGE: it fences CoreSimulator, makes the run's
// own devices `pts3-<runId>-1..3`, serves the host door and restores the host. This file never runs simctl, `open` or
// osascript, and never holds a UDID: it asks the door (`VF_PHONE_HOST`, its token) by a device's NUMBER, and reads the
// desk's door (`window.__vfDesk`: each face's row, the phone's kind through `local(name)`) and main's census (D1, D2).
// Every row opens and closes with the door's `/row` (the HID record), re-stages the device states it needs through the
// door's `state`, and prints one `PHONE_WORDS` line of everything the renderer saw (the stage sweeps it for any UDID).
//   L1 `none`    — SIM-NONE (no simctl: the face says so, offers no act, runs nothing), SIM-NO-UDID;
//   L2 `devices` — SIM-STAGED, SIM-NO-DEVICE, SIM-SHOW-FRESH, SIM-OFF-BOOT, SIM-P1, SIM-LIVE, SIM-USE, SIM-UNSEEN,
//                  SIM-STILL, SIM-IDLE, SIM-CAP, SIM-RELOAD, SIM-SHOW-RUNNING (RECORDED), SIM-STOPPED (its word
//                  RECORDED), SIM-ATTACH, SIM-GONE — then SIM-RATE (an OBSERVATION), SIM-SHARE and SIM-REBIND (NICE) —
//                  and SIM-NO-UDID last;
//   L3 `cost`    — SIM-COST (an OBSERVATION).
// LIVE-PROVEN is every "live" read: the condition `streaming`, presented +3 and main's helper frames +3 within the row's
// bound, still `streaming` 2 s on — `streaming` alone is not proof (a retry or a fresh boot answers it before any window).
// A face's act is a part ONLY in hand: the phone is picked up (⏎), the pointer moved by `sendInputEvent` over the held
// frame until the window's cursor is `pointer`, and pressed there — after THE PRESS GATE: its device's name `pts3-<runId>-n`,
// its type the row's, and the door's go. `create` is never pressed. Input goes by `sendInputEvent` only, never CDP's
// `Input.synthesize*`. A `no-permission` read anywhere presses Open Settings once (main records it, nothing opens), then the
// console acts STOP ("TCC dialog suspected"). Prints `PHONE_ROWS_BEGIN mode=<m>` first and `PHONE_ROWS_END n=<k>` last.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LiveFixture } from "./live-fixture";
import {
  FACE,
  layObject,
  PANE,
  type PaneHands,
  type PaneRowsDriver,
  paneHands,
} from "./smoke-browser-pane";
import { dimmed } from "./smoke-last-still";
import { judgeOpens, opensMark, SCREEN_RECORDING_SETTINGS, type ShellOpens } from "./smoke-opens";

/** The flag beside `--smoke-canvas` that runs these rows alone after the boot's (the stage script's command). */
export const PHONE_FLAG = "--phone";

/** The phone's facts as the product holds them — the plugin's manifest and law, said again here (testing never imports the
 * plugin: `plugins/simulator/vibefield.plugin.json`, `src/law.ts`, `src/face.ts`). */
export const PHONE = {
  type: "vibefield.simulator",
  category: "devices",
  label: "Phone",
  /** its size on the desk, world units */
  size: { w: 188.71, h: 393.7 },
  /** a bound phone's face row's source */
  source: "ios-simulator",
  /** the law's display: a still's light */
  still: 0.7,
  /** the wire's asks: in hand (focused), seen near and far (the law's 12 is the wire's bucket 10); and priorities */
  fps: { focused: 60, near: 30, far: 10 },
  priority: { interactive: 80, seen: 50 },
  /** the law's `nearPx`: at or over it a phone seen is near (device px) */
  nearPx: 240,
  /** the face's lines the rows read (face.ts `FACE_LINES`) */
  lines: {
    none: "The iOS Simulator isn't on this Mac",
    noDevice: (device: string): string => `There's no ${device} on this Mac`,
  },
  /** the held bar's one tool's words (face.ts `VIEW_ONLY`) */
  viewOnly: "View only",
} as const;

/** The modes the stage runs, and each one's rows in order (`/row` names: ≤ 80 characters, no control characters). */
export type PhoneMode = "none" | "devices" | "cost";
export type RowClass = "MUST" | "NICE" | "OBSERVATION";
export const PHONE_ROWS: Readonly<
  Record<PhoneMode, readonly { readonly name: string; readonly klass: RowClass }[]>
> = {
  none: [
    { name: "SIM-NONE", klass: "MUST" },
    { name: "SIM-NO-UDID", klass: "MUST" },
  ],
  devices: [
    { name: "SIM-STAGED", klass: "MUST" },
    { name: "SIM-NO-DEVICE", klass: "MUST" },
    { name: "SIM-SHOW-FRESH", klass: "MUST" },
    { name: "SIM-OFF-BOOT", klass: "MUST" },
    { name: "SIM-P1", klass: "MUST" },
    { name: "SIM-LIVE", klass: "MUST" },
    { name: "SIM-USE", klass: "MUST" },
    { name: "SIM-UNSEEN", klass: "MUST" },
    { name: "SIM-STILL", klass: "MUST" },
    { name: "SIM-IDLE", klass: "MUST" },
    { name: "SIM-CAP", klass: "MUST" },
    { name: "SIM-RELOAD", klass: "MUST" },
    { name: "SIM-SHOW-RUNNING", klass: "MUST" },
    { name: "SIM-STOPPED", klass: "MUST" },
    { name: "SIM-ATTACH", klass: "MUST" },
    { name: "SIM-GONE", klass: "MUST" },
    { name: "SIM-RATE", klass: "OBSERVATION" },
    { name: "SIM-SHARE", klass: "NICE" },
    { name: "SIM-REBIND", klass: "NICE" },
    { name: "SIM-NO-UDID", klass: "MUST" },
  ],
  cost: [{ name: "SIM-COST", klass: "OBSERVATION" }],
};

/** The acts a press may run (the stage's `PRESS_ACTS`): never `create` — a product-named device P5 cannot delete. */
export const PRESS_ACTS = ["boot", "show", "retry", "open-settings"] as const;
export type PressAct = (typeof PRESS_ACTS)[number];

/** The bounds the rows wait (ms): show's grace, boot's simctl timeout plus the boot grace, a quit's word. */
export const PHONE_BOUNDS = {
  live: 20_000,
  boot: 120_000 + 30_000,
  face: 15_000,
  word: 10_000,
} as const;

// ─── the stage's word: the env ────────────────────────────────────────────────────────────────────────────────────────

/** What the stage hands the smoke (`commandEnv`): never a UDID — device NUMBERS and their types. */
export interface PhoneEnv {
  readonly mode: PhoneMode;
  /** `http://127.0.0.1:<port>` */
  readonly host: string;
  readonly token: string;
  /** the ONE iOS runtime the stage picked (RM4.1: never a literal) */
  readonly runtime: string;
  /** n → its CoreSimulator device type: 1..3 the run's devices, 4 the type that never gets one */
  readonly devices: ReadonlyMap<number, string>;
  /** the run's id (`VF_PHONE_RUN`, inherited): its devices are `pts3-<runId>-n` — null: unsaid, so nothing is pressed */
  readonly runId: string | null;
  /** the DRIVER's `xcode-select -p` reading (`VF_PHONE_DEVDIR_BY`, a label): `xcode-select` names a dir holding simctl
   * (an Xcode-selected host), `fallback` the CLT — SIM-P1 VOIDs on this, never on main's word; null: unsaid */
  readonly selected: "xcode-select" | "fallback" | null;
}

const RUN_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
const RUNTIME = /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-\d+(-\d+)*$/u;
const DEVICE_TYPE = /^com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9.-]+$/u;

/** The env as the stage set it, or the words for what is wrong (the rows then run none). */
export function phoneEnv(env: Readonly<Record<string, string | undefined>>): PhoneEnv | string {
  const mode = env["VF_PHONE_MODE"];
  if (mode !== "none" && mode !== "devices" && mode !== "cost")
    return `VF_PHONE_MODE is ${JSON.stringify(mode ?? null)}, not none, devices or cost — run under the stage script`;
  const host = env["VF_PHONE_HOST"] ?? "";
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/u.test(host))
    return "VF_PHONE_HOST is not the stage's loopback door";
  const token = env["VF_PHONE_TOKEN"] ?? "";
  if (token.length < 16) return "VF_PHONE_TOKEN is missing";
  const runtime = env["VF_PHONE_RUNTIME"] ?? "";
  if (!RUNTIME.test(runtime)) return "VF_PHONE_RUNTIME is not an iOS runtime id";
  const devices = new Map<number, string>();
  for (const part of (env["VF_PHONE_DEVICES"] ?? "").split(",")) {
    const m = /^(\d):(.+)$/u.exec(part.trim());
    if (m === null || m[1] === undefined || m[2] === undefined || !DEVICE_TYPE.test(m[2]))
      return `VF_PHONE_DEVICES holds ${JSON.stringify(part)}, not <n>:<device type>`;
    devices.set(Number(m[1]), m[2]);
  }
  const want = mode === "none" ? [1] : [1, 2, 3, 4];
  for (const n of want) if (!devices.has(n)) return `VF_PHONE_DEVICES names no device ${n}`;
  const run = env["VF_PHONE_RUN"];
  const by = env["VF_PHONE_DEVDIR_BY"];
  return {
    mode,
    host,
    token,
    runtime,
    devices,
    runId: run !== undefined && RUN_ID.test(run) ? run : null,
    selected: by === "xcode-select" || by === "fallback" ? by : null,
  };
}

/** A run's own device's name (the stage's `ownName`). */
export const ownName = (runId: string, n: number): string => `pts3-${runId}-${n}`;

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** P5: exactly `pts3-<runId>-<n>` for that phone's n — the run id taken literally (`pts3-<id>-1x` is not `-1`). */
export function isOwnDevice(name: string | null, runId: string | null, n: number): boolean {
  return (
    runId !== null &&
    RUN_ID.test(runId) &&
    name !== null &&
    new RegExp(`^pts3-${escapeRe(runId)}-${n}$`, "u").test(name)
  );
}

// ─── THE PRESS GATE ───────────────────────────────────────────────────────────────────────────────────────────────────

/** What a press is judged by, right before it: the act asked, the act the face offers, main's facts of the device (D4). */
export interface PressAsk {
  readonly act: string;
  readonly offered: string | null;
  readonly name: string | null;
  readonly deviceType: string | null;
  /** the phone's device number and the type the row bound it to */
  readonly n: number;
  readonly type: string;
  readonly runId: string | null;
}

/** THE PRESS GATE's own half (the door's `/row` press is its other): null — press; else why NOT, and the rows STOP. */
export function judgePress(ask: PressAsk): string | null {
  if (ask.act === "create")
    return "the presser refuses create (a product-named device the run cannot delete)";
  if (!(PRESS_ACTS as readonly string[]).includes(ask.act))
    return `the presser refuses act ${ask.act}`;
  if (ask.offered !== ask.act) return `the face offers ${ask.offered ?? "no act"}, not ${ask.act}`;
  if (ask.runId === null) return "no VF_PHONE_RUN: the run's devices cannot be named";
  if (!isOwnDevice(ask.name, ask.runId, ask.n))
    return `the phone's device is ${JSON.stringify(ask.name)}, not ${ownName(ask.runId, ask.n)}`;
  if (ask.deviceType !== ask.type)
    return `the phone's device is a ${ask.deviceType ?? "device unsaid"}, not ${ask.type}`;
  return null;
}

// ─── what the rows read ───────────────────────────────────────────────────────────────────────────────────────────────

/** A bound simulator's facts on its face row (D4 included). */
export interface PhoneSimRow {
  readonly is: string | null;
  readonly act: string | null;
  readonly condition: string | null;
  readonly acting: string | null;
  readonly degraded: boolean;
  readonly name: string | null;
  readonly deviceType: string | null;
  readonly runtime: string | null;
}

/** A face's row as these rows read it: the door's own, its `state` PROJECTED to `{is, reason}` (it may carry a `retry`
 * function, which no structured clone carries). */
export interface PhoneFace {
  readonly key: string;
  readonly source: string;
  readonly demand?: { readonly mode: string };
  readonly wire: {
    readonly mode: string;
    readonly targetFps: number;
    readonly priority: number;
    readonly interactive: boolean;
    readonly targetRasterSize?: { readonly width: number; readonly height: number };
  } | null;
  readonly surface: string | null;
  readonly state: { readonly is: string | null; readonly reason: string | null };
  readonly label: string;
  readonly arrivals: number;
  readonly presented: number;
  readonly inputs: number;
  readonly texture?: { readonly width: number; readonly height: number; readonly bytes: number };
  readonly current: boolean;
  readonly alive: boolean;
  readonly rested: boolean;
  readonly still: number | null;
  readonly simulator: PhoneSimRow | null;
  readonly acts: number;
}

/** The face row's projection (run in the page): JSON-safe, its state `{is, reason}` — a `retry` function never crosses. */
export const PHONE_ROW_PROJECT = `((f) => f === undefined || f === null ? null : JSON.parse(JSON.stringify({
  ...f, state: { is: f.state?.is ?? null, reason: f.state?.reason ?? null },
})))`;

/** Main's simulator census (D1, D2), restated: counts, never a UDID. */
export interface PhoneCensus {
  readonly sessions: number;
  readonly sessionsMade: number;
  readonly captureReady: boolean;
  readonly helperPresent: boolean;
  readonly helper: {
    readonly helperStarts: number;
    readonly helperExits: number;
    readonly activeSessions: number;
    readonly framesReceived: number;
  } | null;
  readonly vetted: string | null;
  readonly simctl?: Readonly<Record<string, number>>;
}

/** Main's live-surface custody as the rows read it: its runtimes and its simulator census. */
export interface PhoneCustody {
  readonly runtimes: number;
  readonly simulator?: PhoneCensus;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;

/** How many UUID-shaped strings `text` holds (SIM-NO-UDID's sweep: a `PHONE_WORDS` line must hold none). */
export const uuidHits = (text: string): number => (text.match(UUID) ?? []).length;

// ─── the stimulus: the band's colour ──────────────────────────────────────────────────────────────────────────────────

/**
 * The bands the door's pages draw (`#<nonce>`): dark and saturated — every channel ≤ 160, spread ≥ 90 — so no colour of the
 * motion page's sweep (`hsl(h, 90%, 55%)`: a channel at 243, one at 37), no grey (the still page's #808080, Safari's
 * chrome) and no dimmed sweep is within the tolerance of one.
 */
export const BAND_PALETTE: readonly (readonly [number, number, number])[] = [
  [150, 30, 90],
  [30, 130, 60],
  [40, 60, 150],
  [140, 110, 20],
  [20, 120, 130],
  [120, 30, 140],
];
/** A pixel matches a band within this, a channel each. */
export const BAND_TOL = 28;
/** The fraction of a read's pixels the band must hold (it is a fifth of the page's height). */
export const BAND_FLOOR = 0.02;

const hex2 = (v: number): string => v.toString(16).padStart(2, "0");

/** The k-th nonce: a palette colour, nudged by k's round (under the tolerance) so each row's pages are their own. */
export function bandNonce(k: number): string {
  const c = BAND_PALETTE[k % BAND_PALETTE.length] ?? [150, 30, 90];
  const t = Math.floor(k / BAND_PALETTE.length) % 8;
  return `${hex2(c[0] + t)}${hex2(c[1])}${hex2(c[2])}`;
}

/** A nonce's colour. */
export function bandColour(nonce: string): [number, number, number] {
  return [
    Number.parseInt(nonce.slice(0, 2), 16),
    Number.parseInt(nonce.slice(2, 4), 16),
    Number.parseInt(nonce.slice(4, 6), 16),
  ];
}

// ─── the measure: FACE's numbers, the band and a coarse grid ──────────────────────────────────────────────────────────

/** A read of pixels: FACE's measures (distinct colours at 5 bits a channel, luma range and mean), the band's pixels and
 * their mean colour, and the luma means of a 4 × 4 grid (two reads that differ: a moving picture, never a hash). */
export interface Measure {
  readonly px: number;
  readonly colors: number;
  readonly lumaRange: number;
  readonly lumaMean: number;
  readonly band: number;
  readonly bandMean: readonly [number, number, number] | null;
  readonly grid: readonly number[];
}

/** The measure, over RGBA bytes — the PNG's in main. Its twin `PHONE_MEASURE` runs in the page (a unit holds them equal). */
export function measurePixels(
  b: ArrayLike<number>,
  w: number,
  h: number,
  band: readonly [number, number, number] | null,
  tol: number,
): Measure {
  const colors = new Set<number>();
  let lo = 255;
  let hi = 0;
  let sum = 0;
  let hits = 0;
  const hit = [0, 0, 0];
  const grid = new Array<number>(16).fill(0);
  const cells = new Array<number>(16).fill(0);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = b[i] ?? 0;
      const g = b[i + 1] ?? 0;
      const bl = b[i + 2] ?? 0;
      colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (bl >> 3));
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      if (l < lo) lo = l;
      if (l > hi) hi = l;
      sum += l;
      const c = Math.min(3, Math.floor((y * 4) / h)) * 4 + Math.min(3, Math.floor((x * 4) / w));
      grid[c] = (grid[c] ?? 0) + l;
      cells[c] = (cells[c] ?? 0) + 1;
      if (
        band !== null &&
        Math.abs(r - band[0]) <= tol &&
        Math.abs(g - band[1]) <= tol &&
        Math.abs(bl - band[2]) <= tol
      ) {
        hits += 1;
        hit[0] = (hit[0] ?? 0) + r;
        hit[1] = (hit[1] ?? 0) + g;
        hit[2] = (hit[2] ?? 0) + bl;
      }
    }
  const px = w * h;
  return {
    px,
    colors: colors.size,
    lumaRange: px === 0 ? 0 : Math.round(hi - lo),
    lumaMean: Math.round(sum / Math.max(1, px)),
    band: hits,
    bandMean:
      hits === 0
        ? null
        : [
            Math.round((hit[0] ?? 0) / hits),
            Math.round((hit[1] ?? 0) / hits),
            Math.round((hit[2] ?? 0) / hits),
          ],
    grid: grid.map((g, k) => Math.round(g / Math.max(1, cells[k] ?? 0))),
  };
}

/** `measurePixels`, said again for the page (a bitmap never crosses to main). */
export const PHONE_MEASURE = `((b, w, h, band, tol) => {
  const colors = new Set(); let lo = 255, hi = 0, sum = 0, hits = 0; const hit = [0, 0, 0];
  const grid = new Array(16).fill(0), cells = new Array(16).fill(0);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4; const r = b[i], g = b[i + 1], bl = b[i + 2];
    colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (bl >> 3));
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    if (l < lo) lo = l; if (l > hi) hi = l; sum += l;
    const c = Math.min(3, Math.floor((y * 4) / h)) * 4 + Math.min(3, Math.floor((x * 4) / w));
    grid[c] += l; cells[c] += 1;
    if (band !== null && Math.abs(r - band[0]) <= tol && Math.abs(g - band[1]) <= tol && Math.abs(bl - band[2]) <= tol) {
      hits += 1; hit[0] += r; hit[1] += g; hit[2] += bl;
    }
  }
  const px = w * h;
  return { px, colors: colors.size, lumaRange: px === 0 ? 0 : Math.round(hi - lo), lumaMean: Math.round(sum / Math.max(1, px)),
    band: hits, bandMean: hits === 0 ? null : [Math.round(hit[0] / hits), Math.round(hit[1] / hits), Math.round(hit[2] / hits)],
    grid: grid.map((g, k) => Math.round(g / Math.max(1, cells[k]))) };
})`;

/** A region of the desk captured without the marks, measured in the page (desk CSS px). */
const GLASS = (
  rect: { x: number; y: number; width: number; height: number },
  band: readonly [number, number, number] | null,
): string => `(async () => {
  const measure = ${PHONE_MEASURE};
  const shot = await globalThis.__vfDesk.capture({ rect: ${JSON.stringify(rect)}, marks: false });
  if (shot === undefined) return null;
  const w = shot.width, h = shot.height;
  const c = new OffscreenCanvas(w, h); const x = c.getContext("2d"); x.drawImage(shot, 0, 0, w, h); shot.close();
  return measure(x.getImageData(0, 0, w, h).data, w, h, ${JSON.stringify(band)}, ${BAND_TOL});
})()`;

/** Two grids differ: some cell's light moved by 2 or more. */
export const gridsDiffer = (a: readonly number[], b: readonly number[]): boolean =>
  a.length !== b.length || a.some((v, i) => Math.abs(v - (b[i] ?? v)) >= 2);

/** Where a phone stands on screen (desk CSS px): its centre and half extents. */
export interface PhoneFrame {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
}

/** The phone's GLASS inside its frame: in hand the open extent is its body; at rest its rect, drawn at a slight pitch — so
 * a smaller part of it (desk CSS px, whole). */
export function glassRect(
  f: PhoneFrame,
  inHand: boolean,
): { x: number; y: number; width: number; height: number } {
  const kx = inHand ? 0.78 : 0.66;
  const ky = inHand ? 0.82 : 0.72;
  return {
    x: Math.round(f.cx - kx * f.hx),
    y: Math.round(f.cy - ky * f.hy),
    width: Math.round(2 * kx * f.hx),
    height: Math.round(2 * ky * f.hy),
  };
}

/** The points the presser tries for the act's capsule in hand, in order: the middle column top to bottom over the face's
 * words region, then a column each side (desk CSS px). */
export function actScan(f: PhoneFrame): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const dx of [0, -0.15, 0.15])
    for (let k = -12; k <= 12; k += 1)
      out.push({ x: Math.round(f.cx + dx * f.hx), y: Math.round(f.cy + k * 0.025 * f.hy) });
  return out;
}

/** SIM-IDLE's window (K7, the status bar's clock): how long to wait so a window of `windowMs` opens ≥ `marginMs` after a
 * wall-clock minute and closes ≥ `marginMs` before the next — 0: it may open now. */
export function idleWait(nowMs: number, windowMs = 3_000, marginMs = 5_000): number {
  const into = ((nowMs % 60_000) + 60_000) % 60_000;
  if (into >= marginMs && into + windowMs <= 60_000 - marginMs) return 0;
  return into < marginMs ? marginMs - into : 60_000 - into + marginMs;
}

/** A phone's binding as its props hold it (a json prop: the product hands its cell's JSON), or null: none, or empty. */
export function bindingRead(
  value: unknown,
): { readonly deviceType: string; readonly runtime: string } | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (typeof v !== "object" || v === null) return null;
  const { deviceType, runtime } = v as Record<string, unknown>;
  if (typeof deviceType !== "string" || typeof runtime !== "string" || deviceType === "")
    return null;
  return { deviceType, runtime };
}

/** R15: what a phone's still is filed under — its binding, whole (`simulatorAddress`); the runtime the stage's (RM4.1). */
export const stillAddress = (deviceType: string, runtime: string): string =>
  `ios-simulator:${deviceType}/${runtime}`;

// ─── LIVE-PROVEN ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a proof read: when the face first met it (null: never within the bound), at what condition, the presents and the
 * helper's frames since its start, and the conditions every 200 ms for 2 s after. */
export interface LiveProof {
  readonly bound: number;
  readonly ms: number | null;
  readonly condition: string | null;
  readonly presented: number;
  readonly frames: number;
  readonly after: readonly (string | null)[];
}

/** LIVE-PROVEN: `streaming`, presented +3 and the helper's frames +3 within the bound, still `streaming` 2 s on. */
export function judgeLiveProven(row: string, p: LiveProof | null): string[] {
  if (p === null) return [`${row}: never read for LIVE-PROVEN`];
  const out: string[] = [];
  const said = `(${p.condition ?? "no condition"}, presented +${p.presented}, helper frames +${p.frames})`;
  if (p.ms === null || p.ms > p.bound)
    out.push(`${row}: not LIVE-PROVEN within ${p.bound} ms ${said}`);
  if (p.condition !== "streaming")
    out.push(`${row}: the face reads ${p.condition ?? "nothing"}, not streaming`);
  if (p.presented < 3)
    out.push(`${row}: ${p.presented} frames presented, not 3 — streaming is not proof ${said}`);
  if (p.frames < 3) out.push(`${row}: main's helper received ${p.frames} frames, not 3 ${said}`);
  const fell = p.after.filter((c) => c !== "streaming");
  if (p.ms !== null && (p.after.length < 10 || fell.length > 0))
    out.push(`${row}: it did not stay streaming 2 s on (${JSON.stringify(p.after)})`);
  return out;
}

// ─── the judges ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** D2's call counts, a name each. */
type Counts = Readonly<Record<string, number>>;
const count = (c: Counts | null | undefined, name: string): number => c?.[name] ?? 0;

/** SIM-NONE: with no simctl, no act and nothing run — and the capture stack and helper there, so the face is not no-simulator
 * for a missing adapter (finding 4). */
export interface NoneSeen {
  readonly is: string | null;
  readonly act: string | null;
  readonly name: string | null;
  /** the lines the face's words took (null: no words drawn) — `PHONE.lines.none`, one line */
  readonly lines: number | null;
  readonly census: PhoneCensus | null;
  readonly opens: readonly string[];
}

export function judgeNone(s: NoneSeen): string[] {
  const out: string[] = [];
  if (s.is !== "no-simulator")
    out.push(`SIM-NONE: the phone says ${s.is ?? "nothing"}, not no-simulator`);
  if (s.act !== null)
    out.push(`SIM-NONE: the face offers ${s.act} — no act may stand without a Simulator`);
  if (s.name !== null) out.push(`SIM-NONE: main names a device (${s.name}) with no Simulator`);
  if (s.lines === null || s.lines < 1)
    out.push(`SIM-NONE: the face carries no words — "${PHONE.lines.none}" is not drawn`);
  const c = s.census;
  if (c === null) out.push("SIM-NONE: main gave no simulator census");
  else {
    if (c.vetted !== null) out.push(`SIM-NONE: main vetted ${c.vetted}, not none`);
    if (!c.captureReady)
      out.push("SIM-NONE: the capture stack was never built — no-simulator may be the adapter's");
    if (!c.helperPresent)
      out.push(
        "SIM-NONE: the SCK helper is not on disk — the row would be green for the wrong reason",
      );
    if (c.simctl === undefined)
      out.push("SIM-NONE: main kept no simctl record (D2) — a smoke's census carries one");
    else {
      if (count(c.simctl, "probe") < 1) out.push("SIM-NONE: main never probed for simctl");
      for (const call of ["xcode-select", "list", "boot", "create", "show"])
        if (count(c.simctl, call) !== 0)
          out.push(`SIM-NONE: main ran ${call} ${count(c.simctl, call)} time(s) with no Simulator`);
    }
  }
  out.push(...s.opens);
  return out;
}

/** SIM-STAGED: the plugin enabled with `surface.capture`, the phone on its chip, laid, and bound to a face. */
export interface StagedSeen {
  readonly plugin: { readonly enabled: boolean; readonly granted: readonly string[] } | null;
  readonly hung: readonly string[];
  readonly before: number;
  readonly after: number;
  readonly faulted: boolean;
  readonly source: string | null;
}

export function judgeStaged(s: StagedSeen): string[] {
  const out: string[] = [];
  if (s.plugin === null) out.push("SIM-STAGED: fieldd has no vibefield.simulator plugin");
  else {
    if (!s.plugin.enabled) out.push("SIM-STAGED: the simulator plugin is not enabled");
    if (!s.plugin.granted.includes("surface.capture"))
      out.push(`SIM-STAGED: surface.capture is not granted (${JSON.stringify(s.plugin.granted)})`);
  }
  if (!s.hung.includes(PHONE.type))
    out.push(`SIM-STAGED: the devices chip hangs no phone (${JSON.stringify(s.hung)})`);
  if (s.after !== s.before + 1)
    out.push(`SIM-STAGED: the take laid ${s.after - s.before} phones, not one`);
  if (s.faulted) out.push("SIM-STAGED: the phone's kind is refused or struck");
  if (s.source !== PHONE.source)
    out.push(`SIM-STAGED: the bound phone has no ${PHONE.source} face`);
  return out;
}

/** SIM-NO-DEVICE: the model named, Create it offered — and never pressed. */
export interface NoDeviceSeen {
  readonly is: string | null;
  readonly act: string | null;
  /** main's name (D4: with no device, its type's) and the device the face's words name (`extra.simulator.device`) */
  readonly name: string | null;
  readonly device: string | null;
  readonly lines: number | null;
  readonly create: { readonly before: number; readonly after: number };
}

export function judgeNoDevice(s: NoDeviceSeen): string[] {
  const out: string[] = [];
  if (s.is !== "no-device")
    out.push(`SIM-NO-DEVICE: the phone says ${s.is ?? "nothing"}, not no-device`);
  if (s.act !== "create")
    out.push(`SIM-NO-DEVICE: the face offers ${s.act ?? "no act"}, not create`);
  if (s.name === null || s.name === "") out.push("SIM-NO-DEVICE: main names no model");
  else if (s.device !== s.name)
    out.push(
      `SIM-NO-DEVICE: the words name ${JSON.stringify(s.device)}, not the model ${JSON.stringify(s.name)}`,
    );
  if (s.lines === null || s.lines < 1) out.push("SIM-NO-DEVICE: the face carries no words");
  if (s.create.after !== s.create.before)
    out.push("SIM-NO-DEVICE: main ran create — nothing pressed it");
  return out;
}

/** A face's sequence of words while an act ran (the page's 25-ms watch): `is|acting|act|condition` each change. */
export interface Watched {
  readonly is: string;
  readonly acting: string;
  readonly act: string;
  readonly condition: string;
}

export const watched = (seq: readonly string[]): Watched[] =>
  seq.map((w) => {
    const [is = "", acting = "", act = "", condition = ""] = w.split("|");
    return { is, acting, act, condition };
  });

/** An act pressed in hand: the face's acts +1, main acting it, then (where `through` says) a state on the way. */
export interface PressedSeen {
  readonly act: PressAct;
  readonly acts: { readonly before: number; readonly after: number };
  readonly seq: readonly Watched[];
  readonly proof: LiveProof | null;
  /** D2's counts of the verbs, before and after */
  readonly calls: { readonly before: Counts | null; readonly after: Counts | null };
}

export function judgePressed(
  row: string,
  s: PressedSeen,
  o: { readonly through?: string; readonly calls: Readonly<Record<string, number>> },
): string[] {
  const out: string[] = [];
  if (s.acts.after !== s.acts.before + 1)
    out.push(`${row}: the face ran ${s.acts.after - s.acts.before} acts, not the one pressed`);
  if (!s.seq.some((w) => w.acting === s.act))
    out.push(
      `${row}: main was never seen acting ${s.act} (${JSON.stringify(s.seq.map((w) => w.is))})`,
    );
  if (o.through !== undefined && !s.seq.some((w) => w.is === o.through && w.act === ""))
    out.push(`${row}: the face never read ${o.through} with no act on its way`);
  for (const [call, by] of Object.entries(o.calls)) {
    const moved = count(s.calls.after, call) - count(s.calls.before, call);
    if (moved !== by) out.push(`${row}: main ran ${call} ${moved} time(s), not ${by}`);
  }
  out.push(...judgeLiveProven(row, s.proof));
  return out;
}

/** SIM-P1: with xcode-select naming the CLT, the product found Xcode itself. Any `DEVELOPER_DIR` in Electron's env is red
 * first — it is what makes xcode-select answer Xcode, so main's own `vetted` cannot say whether the row applies. VOID
 * only on the DRIVER's reading (`selected`, RM4.2) that xcode-select names Xcode; unsaid is red. */
export function judgeP1(s: {
  readonly selected: "xcode-select" | "fallback" | null;
  readonly vetted: string | null;
  readonly offBoot: boolean;
  readonly developerDir: string | undefined;
}): { readonly problems: string[]; readonly void: string | null } {
  const out: string[] = [];
  if (s.developerDir !== undefined)
    out.push("SIM-P1: Electron's env carried DEVELOPER_DIR — P1 was not the finder");
  if (s.selected === null)
    out.push("SIM-P1: the stage never said its xcode-select reading (VF_PHONE_DEVDIR_BY)");
  if (s.selected === "xcode-select")
    return out.length > 0
      ? { problems: out, void: null }
      : { problems: [], void: "not a CLT-selected host" };
  if (s.vetted !== "fallback")
    out.push(`SIM-P1: main vetted ${s.vetted ?? "nothing"}, not the fallback`);
  if (!s.offBoot) out.push("SIM-P1: SIM-OFF-BOOT was not green");
  return { problems: out, void: null };
}

/** SIM-LIVE: THIS device's picture on the glass — against the words face read in the same run and the door's screenshot. */
export interface LiveSeen {
  readonly proof: LiveProof | null;
  readonly off: { readonly colors: number } | null;
  readonly glass: { readonly colors: number; readonly lumaRange: number } | null;
  readonly band: Measure | null;
  readonly shot: Measure | null;
  readonly again: {
    readonly differ: boolean;
    readonly presented: number;
    readonly frames: number;
  } | null;
}

export function judgeLive(s: LiveSeen): string[] {
  const out = judgeLiveProven("SIM-LIVE", s.proof);
  if (s.off === null) out.push("SIM-LIVE: no words face read in this run — the floor is missing");
  if (s.glass === null || s.band === null)
    return [...out, "SIM-LIVE: the glass was never captured"];
  if (s.shot === null) return [...out, "SIM-LIVE: no device screenshot to judge the glass by"];
  if (s.off !== null && s.glass.colors < 3 * s.off.colors)
    out.push(
      `SIM-LIVE: ${s.glass.colors} colours on the glass, under 3 × the words face's ${s.off.colors}`,
    );
  if (s.glass.colors < 0.3 * s.shot.colors)
    out.push(
      `SIM-LIVE: ${s.glass.colors} colours on the glass, under 0.3 × the screenshot's ${s.shot.colors}`,
    );
  if (s.glass.lumaRange < 0.5 * s.shot.lumaRange)
    out.push(
      `SIM-LIVE: luma range ${s.glass.lumaRange}, under half the screenshot's ${s.shot.lumaRange}`,
    );
  if (s.band.band < BAND_FLOOR * s.band.px)
    out.push(
      `SIM-LIVE: the band's colour holds ${s.band.band} of ${s.band.px} glass pixels — not this device's page`,
    );
  if (s.again === null) out.push("SIM-LIVE: the glass was not read twice");
  else {
    if (!s.again.differ)
      out.push("SIM-LIVE: two reads 500 ms apart are the same picture — a still");
    if (s.again.presented < 1 || s.again.frames < 1)
      out.push(
        `SIM-LIVE: between the two reads presented +${s.again.presented}, helper frames +${s.again.frames}`,
      );
  }
  return out;
}

/** SIM-USE: in hand at native 60, View only and the device's name in the bar, nothing reaching iOS. */
export interface UseSeen {
  readonly held: boolean;
  readonly wire: PhoneFace["wire"];
  readonly native: readonly [number, number] | null;
  readonly bar: { readonly text: string; readonly readout: string | null } | null;
  readonly name: string;
  readonly loaded: number;
  readonly inputs: { readonly before: number | null; readonly after: number | null };
  readonly acts: { readonly before: number; readonly after: number };
  readonly calls: { readonly before: Counts | null; readonly after: Counts | null };
  readonly rowInputs: number;
  readonly down: boolean;
}

export function judgeUse(s: UseSeen): {
  readonly problems: string[];
  readonly void: string | null;
} {
  if (s.loaded < 1) return { problems: [], void: "the /still page never beaconed /loaded" };
  const out: string[] = [];
  if (!s.held) out.push("SIM-USE: ⏎ never put the phone in hand");
  const w = s.wire;
  if (w === null) out.push("SIM-USE: no demand on the wire in hand");
  else {
    if (w.mode !== "live" || w.targetFps !== PHONE.fps.focused)
      out.push(
        `SIM-USE: the wire asks ${w.mode} at ${w.targetFps}, not live at ${PHONE.fps.focused}`,
      );
    if (!w.interactive || w.priority !== PHONE.priority.interactive)
      out.push(`SIM-USE: the wire's interactive ${w.interactive}, priority ${w.priority} — not 80`);
    if (s.native === null) out.push("SIM-USE: no screenshot gave the device's native size");
    else if (
      w.targetRasterSize?.width !== s.native[0] ||
      w.targetRasterSize?.height !== s.native[1]
    )
      out.push(
        `SIM-USE: the raster asked is ${JSON.stringify(w.targetRasterSize ?? null)}, not the device's ${s.native[0]} × ${s.native[1]}`,
      );
  }
  if (s.bar === null) out.push("SIM-USE: no held bar");
  else {
    if (!s.bar.text.includes(PHONE.viewOnly))
      out.push("SIM-USE: the held bar does not say View only");
    if (s.bar.readout !== s.name)
      out.push(`SIM-USE: the bar reads ${JSON.stringify(s.bar.readout)}, not ${s.name}`);
  }
  if (s.inputs.before === null || s.inputs.after === null)
    out.push("SIM-USE: the door's /input count was not read");
  else if (s.inputs.after !== s.inputs.before)
    out.push(
      `SIM-USE: iOS was told ${s.inputs.after - s.inputs.before} input(s) — the phone is view-only`,
    );
  if (s.acts.after !== s.acts.before) out.push("SIM-USE: a tap off the capsule ran an act");
  for (const call of ["boot", "shutdown", "create", "show"])
    if (count(s.calls.after, call) !== count(s.calls.before, call))
      out.push(`SIM-USE: main ran ${call} under a tap`);
  if (s.rowInputs !== 0)
    out.push(`SIM-USE: the row says ${s.rowInputs} inputs — a simulator's is 0`);
  if (!s.down) out.push("SIM-USE: Esc did not put the phone down");
  return { problems: out, void: null };
}

/** SIM-STILL: ONE still filed under the binding, laid at rest after a reload at the law's dim, and handed over to live. */
export interface StillSeen {
  readonly taken: { readonly before: number; readonly after: number };
  readonly address: string | null;
  readonly want: string;
  readonly extraStill: boolean;
  readonly live: Measure | null;
  readonly reloaded: boolean;
  readonly rested: { readonly still: number | null; readonly rested: boolean } | null;
  readonly seen: Measure | null;
  /** the band's live colour at the law's dim */
  readonly predicted: readonly [number, number, number] | null;
  readonly handover: LiveProof | null;
}

/** Two colours' distance: their farthest channel. */
const apart = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? v))));

export function judgeStill(s: StillSeen): string[] {
  const out: string[] = [];
  if (s.taken.after !== s.taken.before + 1)
    out.push(`SIM-STILL: the put-down took ${s.taken.after - s.taken.before} stills, not one`);
  if (s.address !== s.want)
    out.push(`SIM-STILL: the still is filed under ${JSON.stringify(s.address)}, not ${s.want}`);
  if (s.extraStill) out.push("SIM-STILL: the face's words carry a still (R14)");
  if (!s.reloaded) out.push("SIM-STILL: the desk did not come back after the reload");
  if (s.rested === null || s.rested.still === null || !s.rested.rested)
    out.push(
      `SIM-STILL: after the reload off view the phone has no still at rest (${JSON.stringify(s.rested)})`,
    );
  if (s.live === null || s.seen === null)
    out.push("SIM-STILL: the glass was not read live and at rest");
  else {
    if (s.seen.colors < 0.5 * s.live.colors)
      out.push(
        `SIM-STILL: the still holds ${s.seen.colors} colours, under half the live face's ${s.live.colors}`,
      );
    if (s.predicted === null) out.push("SIM-STILL: the live glass held no band to dim");
    else if (s.seen.band < BAND_FLOOR * s.seen.px)
      out.push(
        `SIM-STILL: the band at the law's dim (${JSON.stringify(s.predicted)}) holds ${s.seen.band} of ${s.seen.px} pixels`,
      );
    else if (
      s.seen.bandMean !== null &&
      s.live.bandMean !== null &&
      apart(s.seen.bandMean, s.predicted) >= apart(s.seen.bandMean, s.live.bandMean)
    )
      // the law's dim moves a band less than BAND_TOL: an undimmed live band counts as band pixels too (R2)
      out.push(
        `SIM-STILL: the band reads ${JSON.stringify(s.seen.bandMean)}, nearer the live band ${JSON.stringify(s.live.bandMean)} than the law's dim ${JSON.stringify(s.predicted)} — a live face, not its still`,
      );
  }
  out.push(...judgeLiveProven("SIM-STILL (the hand-over)", s.handover));
  return out;
}

/** SIM-IDLE: over a static iOS screen the desk sleeps, and motion wakes it. */
export interface IdleSeen {
  readonly proof: LiveProof | null;
  readonly asleep: readonly boolean[];
  readonly steps: number;
  readonly presented: number;
  readonly wake: { readonly presented: number; readonly arrivals: number };
}

export function judgeIdle(s: IdleSeen): string[] {
  const out = judgeLiveProven("SIM-IDLE", s.proof);
  if (s.asleep.length === 0 || s.asleep.some((a) => !a))
    out.push(`SIM-IDLE: the desk was not asleep through the window (${JSON.stringify(s.asleep)})`);
  if (s.steps !== 0) out.push(`SIM-IDLE: the loop stepped ${s.steps} times over a static screen`);
  if (s.presented !== 0) out.push(`SIM-IDLE: ${s.presented} frames presented over a static screen`);
  if (s.wake.presented < 1 || s.wake.arrivals < 1)
    out.push(
      `SIM-IDLE: motion did not wake it within 2 s (presented +${s.wake.presented}, arrivals +${s.wake.arrivals})`,
    );
  return out;
}

/** SIM-RELOAD: the same main runtime re-bound — no inner, no session, no device verb. */
export interface ReloadSeen {
  readonly before: { readonly runtimes: number; readonly census: PhoneCensus | null };
  readonly after: { readonly runtimes: number; readonly census: PhoneCensus | null };
  readonly origins: readonly [number, number];
  readonly proof: LiveProof | null;
}

export function judgeReload(s: ReloadSeen): string[] {
  const out: string[] = [];
  if (s.origins[0] === s.origins[1])
    out.push("SIM-RELOAD: performance.timeOrigin is unchanged — no reload happened");
  const a = s.before.census;
  const b = s.after.census;
  if (a === null || b === null) out.push("SIM-RELOAD: main gave no simulator census");
  else {
    if (s.after.runtimes !== s.before.runtimes)
      out.push(`SIM-RELOAD: main's runtimes ${s.before.runtimes} → ${s.after.runtimes}`);
    if (b.sessions !== a.sessions) out.push(`SIM-RELOAD: sessions ${a.sessions} → ${b.sessions}`);
    if (b.sessionsMade !== a.sessionsMade)
      out.push(
        `SIM-RELOAD: a session was MADE (${a.sessionsMade} → ${b.sessionsMade}) — a new inner (R7)`,
      );
    if ((b.helper?.activeSessions ?? -1) !== (a.helper?.activeSessions ?? -1))
      out.push("SIM-RELOAD: the helper's SCK sessions moved — a second session");
    for (const call of ["boot", "create", "show"])
      if (count(b.simctl, call) !== count(a.simctl, call))
        out.push(`SIM-RELOAD: main ran ${call} again`);
  }
  out.push(...judgeLiveProven("SIM-RELOAD", s.proof));
  return out;
}

/** SIM-STOPPED (P8 amended): the cap's give-back — the quit, the pane's wake — judged in every branch; the word `stopped`
 * expected, with Try again's leg judged; any other word (`off` with P Shutdown: the quit shut P down) is RECORDED as a
 * finding, never green — its stopped face unwitnessed. A red give-back stays red over the word's record. */
export interface StoppedSeen {
  readonly quit: string;
  readonly word: string | null;
  readonly stateP: string;
  readonly wakes: readonly [number, number];
  readonly paneAlive: boolean;
  readonly retry: LiveProof | null;
}
export function judgeStopped(s: StoppedSeen): {
  readonly problems: string[];
  readonly recorded: boolean;
  readonly staging: string | null;
} {
  const out: string[] = [];
  if (s.quit !== "quit") out.push(`SIM-STOPPED: the quit read ${s.quit}`);
  if (s.wakes[1] < s.wakes[0] + 1 || !s.paneAlive)
    out.push(
      `SIM-STOPPED: the pane did not wake into the slot given back (wakes ${s.wakes[0]} → ${s.wakes[1]})`,
    );
  if (s.word === "stopped") {
    out.push(...judgeLiveProven("SIM-STOPPED (Try again)", s.retry));
    return { problems: out, recorded: false, staging: null };
  }
  const finding = `the quit reads ${s.word ?? "nothing"} (device ${s.stateP}) — the stopped face unwitnessed`;
  return out.length > 0
    ? { problems: out, recorded: false, staging: null }
    : { problems: [], recorded: true, staging: finding };
}

/** SIM-ATTACH: ONE undo step binds; ONE undoes; Finish cycles and reverts. */
export interface AttachSeen {
  readonly bound: { readonly deviceType: string; readonly runtime: string } | null;
  readonly undone: { readonly deviceType: string; readonly runtime: string } | null;
  readonly finish: { readonly before: unknown; readonly after: unknown; readonly undone: unknown };
  readonly want: { readonly deviceType: string; readonly runtime: string };
}

export function judgeAttach(s: AttachSeen): string[] {
  const out: string[] = [];
  if (s.bound?.deviceType !== s.want.deviceType || s.bound.runtime !== s.want.runtime)
    out.push(`SIM-ATTACH: Attach bound ${JSON.stringify(s.bound)}, not ${JSON.stringify(s.want)}`);
  if (s.undone !== null)
    out.push(`SIM-ATTACH: one ⌘Z left the binding ${JSON.stringify(s.undone)}`);
  if (s.finish.after === s.finish.before)
    out.push("SIM-ATTACH: Finish did not move the phone's finish");
  if (s.finish.undone !== s.finish.before)
    out.push("SIM-ATTACH: one ⌘Z did not take the finish back");
  return out;
}

/** SIM-GONE: the face closes at once; main's runtime and session end after the grace; the device stays booted. */
export interface GoneSeen {
  readonly proof: LiveProof | null;
  readonly closedMs: number | null;
  readonly before: {
    readonly runtimes: number;
    readonly sessions: number;
    readonly active: number;
  };
  readonly after: { readonly runtimes: number; readonly sessions: number; readonly active: number };
  readonly state: string | null;
}

export function judgeGone(s: GoneSeen): string[] {
  const out = judgeLiveProven("SIM-GONE (before)", s.proof);
  if (s.closedMs === null || s.closedMs > 1_000)
    out.push(`SIM-GONE: the face did not close at once (${s.closedMs ?? "never"} ms)`);
  for (const k of ["runtimes", "sessions", "active"] as const)
    if (s.after[k] !== s.before[k] - 1)
      out.push(
        `SIM-GONE: main's ${k} ${s.before[k]} → ${s.after[k]} after the grace, not one fewer`,
      );
  if (s.state !== "Booted")
    out.push(`SIM-GONE: the device reads ${s.state ?? "nothing"} — a device is the person's`);
  return out;
}

/** SIM-NO-UDID: no UUID shape in any `PHONE_WORDS` line; in L2 VOID unless a bound own row was in them. */
export function judgeNoUdid(s: {
  readonly mode: PhoneMode;
  readonly lines: readonly string[];
  readonly ownRow: boolean;
}): { readonly problems: string[]; readonly void: string | null; readonly hits: number } {
  const hits = s.lines.reduce((n, line) => n + uuidHits(line), 0);
  const problems =
    hits === 0 ? [] : [`SIM-NO-UDID: ${hits} UUID-shaped string(s) in what the renderer saw`];
  if (s.mode === "devices" && !s.ownRow)
    return { problems, void: "no PHONE_WORDS line held a bound own device's row", hits };
  return { problems, void: null, hits };
}

// ─── a row's verdict ──────────────────────────────────────────────────────────────────────────────────────────────────

export type RowMark = "green" | "red" | "VOID" | "STAGING NOT MET" | "RECORDED";

/** One row as the rows print it (`SMOKE_PHONE_ROW`). */
export interface PhoneRowResult {
  readonly name: string;
  readonly klass: RowClass;
  readonly mark: RowMark;
  readonly problems: readonly string[];
  readonly why: string | null;
}

/** A row's mark: STAGING NOT MET and VOID say why (never green); RECORDED a row the brief records whatever it read — its
 * problems or an unmet staging are findings (SIM-SHOW-RUNNING: "Simulator.app showed every booted device" is one). A VOID
 * wins over RECORDED: a voided row's reads are not judged, so none prints as if it stood (SIM-RATE's numbers are VOID
 * unless its shots differ, §4; R8). */
export function rowMark(
  problems: readonly string[],
  o: {
    readonly void?: string | null;
    readonly staging?: string | null;
    readonly recorded?: boolean;
  },
): { readonly mark: RowMark; readonly why: string | null } {
  const staging = o.staging ?? null;
  const voided = o.void ?? null;
  const recorded = o.recorded === true;
  if (recorded && voided === null)
    return { mark: "RECORDED", why: staging ?? (problems.length === 0 ? null : "a finding") };
  if (!recorded && staging !== null) return { mark: "STAGING NOT MET", why: staging };
  if (voided !== null) return { mark: "VOID", why: voided };
  return { mark: problems.length === 0 ? "green" : "red", why: null };
}

/** A row's void: its body's own, else the door END's — an HID void, or a stop answered at END (RM4.5's own input, a
 * run stopped mid-row), so a row the door closed on a stop never reads green (R9). */
export function endVoid(bodyVoid: string | null | undefined, end: DoorRow): string | null {
  if (bodyVoid !== undefined && bodyVoid !== null) return bodyVoid;
  if (end.void !== null) return `HID: ${end.void}`;
  return end.stop === null ? null : `STOPPED at END: ${end.stop}`;
}

/** What the rows hand smoke:canvas as problems: a MUST row red, VOID or not staged — but SIM-P1's VOID on an Xcode-selected
 * host, and the RECORDED rows' findings; NICE and OBSERVATION rows are printed, never problems. */
export function phoneProblems(rows: readonly PhoneRowResult[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.klass !== "MUST" || r.mark === "green" || r.mark === "RECORDED") continue;
    if (r.name === "SIM-P1" && r.mark === "VOID" && r.why === "not a CLT-selected host") continue;
    if (r.mark === "red") out.push(...r.problems);
    else out.push(`${r.name}: ${r.mark} — ${r.why ?? "unsaid"}`);
  }
  return out;
}

// ─── the host door ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A door answer: `/act`'s `{n, state, why?}`; `/row`'s go, a VOID end, or a stop. */
export interface DoorAct {
  readonly state: string;
  readonly why: string | null;
}
export interface DoorRow {
  readonly go: boolean;
  readonly void: string | null;
  readonly stop: string | null;
}

export interface PhoneDoor {
  act(verb: string, device?: number, extra?: { url?: string; file?: string }): Promise<DoorAct>;
  row(
    name: string,
    phase: "begin" | "end" | "press" | "input",
    press?: { act: string; device: string },
  ): Promise<DoorRow>;
  /** `/loaded` or `/input`'s count for a nonce; null: unread */
  count(path: "/loaded" | "/input", nonce: string): Promise<number | null>;
  /** a page of the door's for `openurl` (the door adds its token) */
  page(path: "/motion" | "/still", nonce: string): string;
}

/** The stage's door, its token in a header — never printed. */
export function phoneDoor(env: PhoneEnv, fetcher: typeof fetch = fetch): PhoneDoor {
  const ask = async (
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs = 60_000,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    try {
      const r = await fetcher(`${env.host}${path}`, {
        method,
        headers: { "x-phone-token": env.token, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const parsed: unknown = await r.json().catch(() => ({}));
      return {
        status: r.status,
        body:
          typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {},
      };
    } catch (error) {
      return {
        status: 0,
        body: { why: `the door did not answer (${error instanceof Error ? error.name : "error"})` },
      };
    }
  };
  const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    act: async (verb, device, extra) => {
      const r = await ask(
        "POST",
        "/act",
        { verb, ...(device === undefined ? {} : { device }), ...extra },
        verb === "boot" ? 150_000 : 60_000,
      );
      return {
        state: text(r.body["state"]) ?? (r.status === 0 ? "unanswered" : "failed"),
        why: text(r.body["why"]),
      };
    },
    row: async (name, phase, press) => {
      const r = await ask("POST", "/row", { name, phase, ...press });
      if (r.body["stop"] === true || r.status !== 200)
        return {
          go: false,
          void: null,
          stop: text(r.body["why"]) ?? `the door answered ${r.status}`,
        };
      return { go: r.body["go"] === true, void: text(r.body["void"]), stop: null };
    },
    count: async (path, nonce) => {
      const r = await ask("GET", `${path}?n=${nonce}`);
      return typeof r.body["state"] === "number" ? r.body["state"] : null;
    },
    page: (path, nonce) => `${env.host}${path}?n=${nonce}`,
  };
}

// ─── the rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the rows need of main beyond the window: the stage's env, the smoke's fixture (a playing pane for the cap), main's
 * custody, the opener's record (D3), a reload, the plugin's row, the focus told, a PNG's pixels and the app's memory. */
export interface PhoneRowsDriver extends PaneRowsDriver {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fixture: LiveFixture;
  readonly custody: () => PhoneCustody | null;
  readonly shellOpens: ShellOpens | undefined;
  /** The window's renderer replaced, resolved once the desk says DESK_READY again. */
  readonly reload: () => Promise<boolean>;
  /** fieldd's `plugins.get {id}` */
  readonly plugin: (id: string) => Promise<unknown>;
  /** The shell's page told it is focused (CDP's `Emulation.setFocusEmulationEnabled`): `open -a` takes the app's focus. */
  readonly focused: () => Promise<void>;
  /** A PNG's pixels as RGBA, or null: unreadable. */
  readonly pngPixels: (
    file: string,
  ) => { readonly width: number; readonly height: number; readonly rgba: Uint8Array } | null;
  /** The app's processes: working sets summed (MB), CPU summed (%), how many. */
  readonly metrics: () => { readonly mb: number; readonly cpu: number; readonly processes: number };
  /** The door's fetch (a test's). */
  readonly fetch?: typeof fetch;
}

/** The rows stop: the door said stop, or the press gate refused. */
class PhoneStop extends Error {}
/** A face read `no-permission` (TCC): the rule below runs, then the rows stop. */
class NoPermission extends Error {
  readonly key: string;
  constructor(key: string) {
    super("no-permission");
    this.key = key;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface RowBody {
  readonly problems: readonly string[];
  readonly seen?: unknown;
  readonly void?: string | null;
  readonly staging?: string | null;
  readonly recorded?: boolean;
}

/** The phone's rows for the stage's mode (above). Returns the problems, each in words. */
export async function phoneRows(d: PhoneRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const parsed = phoneEnv(d.env);
  if (typeof parsed === "string") {
    say("PHONE_ROWS_BEGIN mode=unstaged");
    say("PHONE_ROWS_END n=0");
    return [`PT-S3 PHONE: ${parsed}`];
  }
  const env = parsed;
  const door = phoneDoor(env, d.fetch ?? fetch);
  const h: PaneHands = paneHands(d);
  const { js, until, move, press, key: keyPress, undoKey, deskAt } = h;
  const T = JSON.stringify(PHONE.type);
  const results: PhoneRowResult[] = [];
  const words: string[] = [];
  let ownRow = false;
  let served = 0;
  let stopped: string | null = null;
  let nonceK = 0;
  const nonce = (): string => bandNonce(nonceK++);
  const laid = new Set<string>();
  const typeOf = (n: number): string => env.devices.get(n) ?? "";
  /** The row open at the door (its `/row` begun and not ended), and whether the run's first input was said. */
  let openRow: string | null = null;
  let inputSaid = false;
  /** Said to the door ONCE, right before the run's first `sendInputEvent` (a drag, a press, a key): RM4.5 reads an HID
   * reset at THAT row's END as the run's own input, never a hand — in L2 it is SIM-STAGED's lay, not a press-gate row. */
  const ownInput = async (): Promise<void> => {
    if (inputSaid || openRow === null) return;
    inputSaid = true;
    const r = await door.row(openRow, "input");
    if (r.stop !== null) throw new PhoneStop(`${openRow}: ${r.stop}`);
  };
  say(`PHONE_ROWS_BEGIN mode=${env.mode}`);

  // ── the reads ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const census = (): PhoneCensus | null => d.custody()?.simulator ?? null;
  const calls = (): Counts | null => census()?.simctl ?? null;
  const frames = (): number => census()?.helper?.framesReceived ?? 0;
  const objectsOf = (
    type: string,
  ): Promise<
    {
      entity: number;
      key: string | null;
      props: Record<string, unknown>;
      rect: { x: number; y: number; w: number; h: number };
    }[]
  > => js(`globalThis.__vfDesk.objects(${JSON.stringify(type)})`);
  const entityOf = async (k: string): Promise<number | null> =>
    (await objectsOf(PHONE.type)).find((r) => r.key === k)?.entity ??
    (await objectsOf(PANE.type)).find((r) => r.key === k)?.entity ??
    null;
  let permissionMet = false;
  const faceOf = async (k: string): Promise<PhoneFace | null> => {
    const f = await js<PhoneFace | null>(
      `(() => { const project = ${PHONE_ROW_PROJECT}; return project((globalThis.__vfDesk.live()?.faces ?? []).find((x) => x.key === ${JSON.stringify(k)})); })()`,
    );
    if (f?.simulator?.is === "no-permission" && !permissionMet) throw new NoPermission(k);
    return f;
  };
  /** The face's words as its kind lays them: `extra.simulator` off the kind's screen (`{is, device, act}`), the lines its
   * words last took (none: no words drawn), and a still in its words (R14: never). */
  const screenOf = async (
    k: string,
  ): Promise<{
    is: string | null;
    device: string | null;
    act: string | null;
    lines: number | null;
    still: boolean;
  } | null> => {
    const e = await entityOf(k);
    if (e === null) return null;
    return js(`(() => {
      const local = globalThis.__vfDesk.local(${T}); const s = local?.screen?.(${e});
      const said = s?.info?.extra?.simulator;
      return s === undefined ? null : { is: said?.is ?? null, device: said?.device ?? null, act: said?.act ?? null,
        lines: local?.lines?.(${e}) ?? null, still: s.info?.extra?.still !== undefined };
    })()`);
  };
  const stats = (): Promise<{
    acts: number;
    stillsTaken: number;
    wakes: number;
    rests: number;
    cap: number;
    alive: number;
    presented: number;
  } | null> => js("globalThis.__vfDesk.live()?.stats ?? null");
  const settledCamera = async (): Promise<void> => {
    let last = "";
    for (let i = 0; i < 40; i += 1) {
      const c = JSON.stringify(await js("globalThis.__vfDesk.camera()"));
      if (c === last) return;
      last = c;
      await sleep(100);
    }
  };
  /** The view framed on these objects (the head's Zoom to fit), settled. */
  const view = async (keys: readonly string[]): Promise<void> => {
    const ids: string[] = [];
    for (const k of keys) {
      const e = await entityOf(k);
      if (e !== null) ids.push(String(e));
    }
    await js(`globalThis.__vfFieldSmoke.frame(${JSON.stringify(ids)})`);
    await settledCamera();
    await sleep(500);
  };
  /** The view panned far off every object (PT-5b's): what was seen is unseen. */
  const away = async (): Promise<void> => {
    const c = await js<{ x: number; y: number }>("globalThis.__vfDesk.camera()");
    await js(`globalThis.__vfFieldSmoke.panTo(${c.x + 30_000}, ${c.y})`);
    await settledCamera();
    await sleep(500);
  };
  /** Where an object stands at rest on screen (desk CSS px), from its rect and the camera. */
  const placeOf = async (k: string): Promise<PhoneFrame | null> => {
    const e = await entityOf(k);
    if (e === null) return null;
    return js(`(() => {
      const d = globalThis.__vfDesk; const c = d.camera();
      const o = [...d.objects(${T}), ...d.objects(${JSON.stringify(PANE.type)})].find((r) => r.entity === ${e});
      return o === undefined ? null : { cx: (o.rect.x + o.rect.w / 2 - c.x) * c.zoom, cy: (o.rect.y + o.rect.h / 2 - c.y) * c.zoom,
        hx: (o.rect.w / 2) * c.zoom, hy: (o.rect.h / 2) * c.zoom };
    })()`);
  };
  const heldFrame = (): Promise<PhoneFrame | null> =>
    js("globalThis.__vfDesk.held()?.frame ?? null");
  const glassOf = async (
    k: string,
    inHand: boolean,
    band: readonly [number, number, number] | null,
  ): Promise<Measure | null> => {
    const f = inHand ? await heldFrame() : await placeOf(k);
    return f === null ? null : js<Measure | null>(GLASS(glassRect(f, inHand), band));
  };
  const faceRead = async (
    k: string,
    inHand: boolean,
  ): Promise<{ colors: number; lumaRange: number; lumaMean: number } | null> => {
    const f = inHand ? await heldFrame() : await placeOf(k);
    return f === null ? null : js(FACE(glassRect(f, inHand)));
  };

  // ── the hands ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Where the rows lay their phones: right of every object on the board (world units), each `slot` 3000 apart. */
  let base: { x: number; y: number } | null = null;
  const groundAt = async (): Promise<{ x: number; y: number }> => {
    if (base === null)
      base = await js<{ x: number; y: number }>(`(() => {
        const d = globalThis.__vfDesk; let right = -Infinity, top = Infinity, foot = -Infinity;
        for (const type of Object.keys(d.census())) for (const o of d.objects(type)) {
          right = Math.max(right, o.rect.x + o.rect.w); top = Math.min(top, o.rect.y); foot = Math.max(foot, o.rect.y + o.rect.h);
        }
        const c = d.camera();
        return Number.isFinite(right) ? { x: right + 1200, y: (top + foot) / 2 } : { x: c.x + 600, y: c.y + 300 };
      })()`);
    return base;
  };
  const waitKey = async (label: string, e: number): Promise<string> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const k = [...(await objectsOf(PHONE.type)), ...(await objectsOf(PANE.type))].find(
        (r) => r.entity === e,
      )?.key;
      if (k !== undefined && k !== null) return k;
      await sleep(100);
    }
    throw new Error(`the door gives ${label} no durable key`);
  };
  /** A phone laid by the field's smoke door at slot `i`, bound to `type` (or only of its model) in ONE `writeProps`. */
  const placePhone = async (
    label: string,
    slot: number,
    type: string,
    bound = true,
  ): Promise<string> => {
    const at = await groundAt();
    const e = Number(
      await js<string>(
        `globalThis.__vfFieldSmoke.spawnWidget(${T}, { x: ${at.x + slot * 3_000}, y: ${at.y}, w: ${PHONE.size.w}, h: ${PHONE.size.h} })`,
      ),
    );
    const k = await waitKey(label, e);
    laid.add(k);
    const patch = bound
      ? { model: type, binding: { deviceType: type, runtime: env.runtime } }
      : { model: type };
    if (!(await js<boolean>(`globalThis.__vfDesk.writeProps(${e}, ${JSON.stringify(patch)})`)))
      throw new Error(`the door refused ${label}'s props`);
    return k;
  };
  /** A browser pane on the smoke's fixture, playing, beside slot `i`'s phone (the cap's other page): one view frames both. */
  const placePane = async (slot: number): Promise<string> => {
    const at = await groundAt();
    d.fixture.setPlaying(true);
    const e = Number(
      await js<string>(
        `globalThis.__vfFieldSmoke.spawnWidget(${JSON.stringify(PANE.type)}, { x: ${at.x + slot * 3_000 + PHONE.size.w + 600}, y: ${at.y}, w: 698.16, h: 461.94, props: { url: ${JSON.stringify(d.fixture.url)} } })`,
      ),
    );
    const k = await waitKey("the fixture's pane", e);
    laid.add(k);
    return k;
  };
  const remove = async (k: string): Promise<void> => {
    const e = await entityOf(k);
    if (e !== null)
      await js(`globalThis.__vfFieldSmoke.removeWidget(${JSON.stringify(String(e))})`);
    laid.delete(k);
    await sleep(300);
  };
  /** Picked up: pressed at its centre at rest (selected), then ⏎; held once `held()` names it, settled. */
  const pickUp = async (k: string): Promise<PhoneFrame> => {
    const e = await entityOf(k);
    const at = await placeOf(k);
    if (e === null || at === null) throw new Error("the phone left the board");
    const off = await deskAt();
    await ownInput();
    await press({ x: off.left + at.cx, y: off.top + at.cy });
    await sleep(300);
    await keyPress("Enter");
    await until(
      "the phone in hand",
      10_000,
      `(() => { const h = globalThis.__vfDesk.held(); return h !== null && h.entity === ${e} && h.frame?.settled === true; })()`,
    );
    const f = await heldFrame();
    if (f === null) throw new Error("the phone in hand has no frame");
    return f;
  };
  const putDown = async (): Promise<boolean> => {
    await ownInput();
    await keyPress("Escape");
    try {
      await until("the phone put down", 10_000, "globalThis.__vfDesk.held() === null");
      await sleep(400);
      return true;
    } catch {
      return false;
    }
  };
  /** The face's words while an act runs, every 25 ms in the page (a short `acting` is caught). */
  const watchStart = (k: string): Promise<unknown> =>
    js(`(() => {
      const w = globalThis.__vfPhoneWatch; if (w) clearInterval(w.timer);
      const seen = []; let last = "";
      const timer = setInterval(() => {
        const f = (globalThis.__vfDesk.live()?.faces ?? []).find((x) => x.key === ${JSON.stringify(k)}); const s = f?.simulator;
        const word = s == null ? "|||" : [s.is ?? "", s.acting ?? "", s.act ?? "", s.condition ?? ""].join("|");
        if (word !== last) { seen.push(word); last = word; }
      }, 25);
      globalThis.__vfPhoneWatch = { timer, seen }; return true;
    })()`);
  const watchStop = async (): Promise<Watched[]> =>
    watched(
      await js<string[]>(
        "(() => { const w = globalThis.__vfPhoneWatch; if (!w) return []; clearInterval(w.timer); delete globalThis.__vfPhoneWatch; return w.seen; })()",
      ),
    );
  /** The window's cursor at a point, the pointer moved there (honest-pane's `cursorAt`). */
  const cursorAt = async (at: { x: number; y: number }): Promise<string | null> => {
    move(at.x - 6, at.y);
    await sleep(30);
    move(at.x, at.y);
    await sleep(70);
    return js<string | null>(
      `(() => { const el = document.elementFromPoint(${Math.round(at.x)}, ${Math.round(at.y)}); return el === null ? null : getComputedStyle(el).cursor; })()`,
    );
  };
  /** The act pressed IN HAND: THE PRESS GATE (ours, then the door's), the capsule found by the cursor, pressed there. */
  const pressAct = async (row: string, k: string, n: number, act: PressAct): Promise<void> => {
    const f = await faceOf(k);
    const s = f?.simulator ?? null;
    const why = judgePress({
      act,
      offered: s?.act ?? null,
      name: s?.name ?? null,
      deviceType: s?.deviceType ?? null,
      n,
      type: typeOf(n),
      runId: env.runId,
    });
    if (why !== null) throw new PhoneStop(`${row}: the press gate: ${why}`);
    const gate = await door.row(row, "press", { act, device: s?.name ?? "" });
    if (gate.stop !== null) throw new PhoneStop(`${row}: the door's press gate: ${gate.stop}`);
    const frame = await heldFrame();
    if (frame === null) throw new Error(`${row}: the phone is not in hand for its act`);
    const off = await deskAt();
    for (const p of actScan(frame)) {
      const at = { x: off.left + p.x, y: off.top + p.y };
      if ((await cursorAt(at)) === "pointer") {
        await press(at);
        return;
      }
    }
    throw new Error(`${row}: no point of the held phone is the act's capsule (no pointer cursor)`);
  };
  /** LIVE-PROVEN, read off the face and main's helper (above). */
  const liveProven = async (k: string, bound: number = PHONE_BOUNDS.live): Promise<LiveProof> => {
    const t0 = Date.now();
    const p0 = (await faceOf(k))?.presented ?? 0;
    const c0 = frames();
    let last: PhoneFace | null = null;
    let reached: number | null = null;
    const presentedSince = (f: PhoneFace | null): number =>
      f === null ? 0 : f.presented >= p0 ? f.presented - p0 : f.presented;
    while (Date.now() - t0 < bound) {
      last = await faceOf(k);
      if (
        last?.simulator?.condition === "streaming" &&
        presentedSince(last) >= 3 &&
        frames() - c0 >= 3
      ) {
        reached = Date.now() - t0;
        break;
      }
      await sleep(100);
    }
    const after: (string | null)[] = [];
    if (reached !== null)
      for (let i = 0; i < 10; i += 1) {
        await sleep(200);
        after.push((await faceOf(k))?.simulator?.condition ?? null);
      }
    return {
      bound,
      ms: reached,
      condition: last?.simulator?.condition ?? null,
      presented: presentedSince(last),
      frames: frames() - c0,
      after,
    };
  };
  /** A device's state re-staged through the door: Booted or Shutdown, or the row cannot be staged. */
  const ensure = async (n: number, want: "Booted" | "Shutdown"): Promise<string | null> => {
    const now = await door.act("state", n);
    if (now.state === "stop") throw new PhoneStop(now.why ?? "the door stopped the run");
    if (now.state === want) return null;
    const r = await door.act(want === "Booted" ? "boot" : "shutdown", n);
    if (r.state === "stop") throw new PhoneStop(r.why ?? "the door stopped the run");
    return r.state === want ? null : `device ${n} reads ${r.state}, not ${want}`;
  };
  const quitApp = async (): Promise<string> => {
    const r = await door.act("quit-app");
    if (r.state === "stop") throw new PhoneStop(r.why ?? "the door stopped the run");
    return r.state;
  };
  const openUrl = async (n: number, path: "/motion" | "/still", q: string): Promise<boolean> => {
    const r = await door.act("openurl", n, { url: door.page(path, q) });
    if (r.state === "stop") throw new PhoneStop(r.why ?? "the door stopped the run");
    await sleep(1_500);
    return r.state === "opened";
  };
  /** The door's screenshot of an own device, measured in main against a band. */
  const deviceShot = async (
    n: number,
    file: string,
    band: readonly [number, number, number] | null,
  ): Promise<(Measure & { readonly width: number; readonly height: number }) | null> => {
    if (d.shotDir === undefined) return null;
    const r = await door.act("screenshot", n, { file });
    if (r.state !== "written") return null;
    const png = d.pngPixels(join(d.shotDir, file));
    return png === null
      ? null
      : {
          ...measurePixels(png.rgba, png.width, png.height, band, BAND_TOL),
          width: png.width,
          height: png.height,
        };
  };
  const shootDesk = async (name: string): Promise<boolean> => {
    if (d.shotDir === undefined) return false;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await win.capturePage()).toPNG());
    return true;
  };
  /** A phone brought to LIVE-PROVEN however its device stands: booted, its page moving, its window shown if closed. */
  const bringLive = async (row: string, k: string, n: number, q: string): Promise<LiveProof> => {
    const staged = await ensure(n, "Booted");
    if (staged !== null) throw new Error(`${row}: ${staged}`);
    await openUrl(n, "/motion", q);
    await view([k]);
    await until(
      "the phone's face",
      PHONE_BOUNDS.face,
      `(globalThis.__vfDesk.live()?.faces ?? []).some((f) => f.key === ${JSON.stringify(k)} && f.simulator?.is != null)`,
    );
    const act = (await faceOf(k))?.simulator?.act ?? null;
    if (act === "show" || act === "boot" || act === "retry") {
      await pickUp(k);
      await pressAct(row, k, n, act);
      if (act === "boot") {
        const deadline = Date.now() + PHONE_BOUNDS.boot;
        while (Date.now() < deadline && (await door.act("state", n)).state !== "Booted")
          await sleep(1_000);
        await openUrl(n, "/motion", q);
      }
      const proof = await liveProven(k, act === "boot" ? PHONE_BOUNDS.boot : PHONE_BOUNDS.live);
      await putDown();
      return proof;
    }
    return liveProven(k);
  };
  /** The far ask's size: the phone zoomed out under the law's `nearPx` device px on screen. */
  const zoomFar = async (k: string): Promise<void> => {
    const at = await placeOf(k);
    const dpr = await js<number>("devicePixelRatio");
    if (at === null || at.hx <= 0) return;
    const z = await js<number>("globalThis.__vfDesk.camera().zoom");
    await js(`globalThis.__vfFieldSmoke.zoomTo(${(z * (PHONE.nearPx * 0.6)) / (2 * at.hx * dpr)})`);
    await settledCamera();
    await sleep(1_500);
  };

  // ── the row runner ────────────────────────────────────────────────────────────────────────────────────────────────
  const wordsLine = async (row: string): Promise<void> => {
    try {
      const w = await js<unknown>(`(async () => {
        const d = globalThis.__vfDesk; const project = ${PHONE_ROW_PROJECT}; const local = d.local(${T});
        const phones = d.objects(${T}); const stills = [];
        for (const o of phones) if (o.key !== null) { const s = await d.pageStill(o.key); if (s !== null) stills.push(s.address); }
        return {
          faces: (d.live()?.faces ?? []).filter((f) => f.source === ${JSON.stringify(PHONE.source)}).map(project),
          props: phones.map((o) => o.props),
          screens: phones.map((o) => { const s = local?.screen?.(o.entity); return s === undefined ? null : JSON.parse(JSON.stringify({ key: s.key, state: { is: s.state?.is ?? null, reason: s.state?.reason ?? null }, info: s.info ?? null })); }),
          lines: phones.map((o) => local?.lines?.(o.entity) ?? null),
          stills, notices: d.notices(), devices: d.simulatorDevices(),
        };
      })()`);
      const line = `PHONE_WORDS ${JSON.stringify({ row, words: w })}`;
      words.push(line);
      const faces = (w as { faces?: PhoneFace[] } | null)?.faces ?? [];
      if (
        faces.some((f) =>
          [1, 2, 3].some((n) => isOwnDevice(f.simulator?.name ?? null, env.runId, n)),
        )
      )
        ownRow = true;
      say(line);
    } catch (error) {
      say(
        `PHONE_WORDS ${JSON.stringify({ row, unread: error instanceof Error ? error.message : String(error) })}`,
      );
    }
  };
  /** The no-permission rule: the face recorded, Open Settings pressed ONCE (main records it; nothing opens), then STOP. */
  const metPermission = async (row: string, k: string): Promise<void> => {
    permissionMet = true;
    const f = await faceOf(k);
    const before =
      d.shellOpens === undefined ? { opened: 0, revealed: 0 } : opensMark(d.shellOpens);
    let pressed = false;
    try {
      const n =
        [1, 2, 3, 4].find((m) => isOwnDevice(f?.simulator?.name ?? null, env.runId, m)) ?? 0;
      await pickUp(k);
      await pressAct(row, k, n, "open-settings");
      pressed = true;
      await sleep(1_500);
      await putDown();
    } catch (error) {
      say(
        `SMOKE_PHONE_NO_PERMISSION_PRESS ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const problems = pressed
      ? judgeOpens("SIM-NO-PERMISSION", d.shellOpens, before, [SCREEN_RECORDING_SETTINGS])
      : ["SIM-NO-PERMISSION: Open Settings was not pressed"];
    const r: PhoneRowResult = {
      name: "SIM-NO-PERMISSION",
      klass: "NICE",
      ...rowMark(problems, {}),
      problems,
    };
    say(
      `SMOKE_PHONE_ROW ${JSON.stringify({ ...r, seen: { word: f?.simulator?.is ?? null, act: f?.simulator?.act ?? null, in: row } })}`,
    );
  };
  const row = async (
    name: string,
    klass: RowClass,
    body: () => Promise<RowBody>,
  ): Promise<PhoneRowResult | null> => {
    if (stopped !== null) return null;
    const begin = await door.row(name, "begin");
    if (begin.stop !== null) {
      stopped = `${name}: ${begin.stop}`;
      return null;
    }
    openRow = name;
    let out: RowBody;
    try {
      out = await body();
    } catch (error) {
      if (error instanceof NoPermission) {
        await metPermission(name, error.key);
        stopped = `${name}: no-permission read — TCC dialog suspected`;
        out = { problems: [], void: "no-permission met (TCC dialog suspected)" };
      } else if (error instanceof PhoneStop) {
        stopped = error.message;
        out = { problems: [], void: `STOPPED: ${error.message}` };
      } else
        out = { problems: [`${name}: ${error instanceof Error ? error.message : String(error)}`] };
    }
    await wordsLine(name);
    openRow = null;
    const end = await door.row(name, "end");
    served += 1;
    if (end.stop !== null && stopped === null) stopped = `${name}: ${end.stop}`;
    const voidWhy = endVoid(out.void, end);
    const r: PhoneRowResult = {
      name,
      klass,
      ...rowMark(out.problems, {
        void: voidWhy,
        staging: out.staging ?? null,
        recorded: out.recorded ?? false,
      }),
      problems: [...out.problems],
    };
    results.push(r);
    say(`SMOKE_PHONE_ROW ${JSON.stringify({ ...r, seen: out.seen ?? null })}`);
    return r;
  };

  // ── the rows, by mode ─────────────────────────────────────────────────────────────────────────────────────────────
  const ambient = await js<string>("globalThis.__vfDesk.ambient()");
  const capWas = await js<number | null>("globalThis.__vfDesk.liveCap()");
  const phonesBefore = (await objectsOf(PHONE.type)).length;
  const still = async (): Promise<void> => {
    await js(`globalThis.__vfDesk.ambient("still")`);
  };
  await still();
  await d.focused();
  try {
    if (env.mode === "none") await noneRows();
    else if (env.mode === "devices") await deviceRows();
    else await costRows();
  } catch (error) {
    results.push({
      name: "PHONE",
      klass: "MUST",
      mark: "red",
      problems: [`PT-S3 PHONE: ${error instanceof Error ? error.message : String(error)}`],
      why: null,
    });
  } finally {
    try {
      if (await js<boolean>("globalThis.__vfDesk.held() !== null")) await putDown();
      await js(`globalThis.__vfDesk.liveCap(${capWas ?? 6})`);
      await js("globalThis.__vfDesk.liveGrace(null)");
      for (const k of [...laid]) await remove(k);
      d.fixture.setPlaying(false);
      await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient)})`);
    } catch {
      /* the board as found is checked below */
    }
    const phonesAfter = (await objectsOf(PHONE.type).catch(() => [])).length;
    if (phonesAfter !== phonesBefore)
      results.push({
        name: "CLEARED",
        klass: "MUST",
        mark: "red",
        problems: [
          `CLEARED: ${phonesAfter} phones on the board after the rows, not the ${phonesBefore} found`,
        ],
        why: null,
      });
    if (stopped !== null) say(`SMOKE_PHONE_STOP ${JSON.stringify({ why: stopped })}`);
    say(`PHONE_ROWS_END n=${served}`);
  }
  const problems = phoneProblems(results);
  if (stopped !== null) problems.push(`PT-S3 PHONE: the console acts STOPPED — ${stopped}`);
  return problems;

  // ── L1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function noneRows(): Promise<void> {
    await row("SIM-NONE", "MUST", async () => {
      const mark =
        d.shellOpens === undefined ? { opened: 0, revealed: 0 } : opensMark(d.shellOpens);
      const p = await placePhone("φP", 0, typeOf(1));
      await view([p]);
      await until(
        "φP's face",
        PHONE_BOUNDS.face,
        `(globalThis.__vfDesk.live()?.faces ?? []).some((f) => f.key === ${JSON.stringify(p)} && f.simulator?.is != null)`,
      );
      await sleep(1_000);
      const f = await faceOf(p);
      const screen = await screenOf(p);
      const seen: NoneSeen = {
        is: f?.simulator?.is ?? null,
        act: f?.simulator?.act ?? null,
        name: f?.simulator?.name ?? null,
        lines: screen?.lines ?? null,
        census: census(),
        opens: judgeOpens("SIM-NONE", d.shellOpens, mark, []),
      };
      await remove(p);
      return { problems: judgeNone(seen), seen };
    });
    await noUdidRow();
  }

  async function noUdidRow(): Promise<void> {
    await row("SIM-NO-UDID", "MUST", async () => {
      const j = judgeNoUdid({ mode: env.mode, lines: words, ownRow });
      return {
        problems: j.problems,
        void: j.void,
        // L1 listed nothing: the row is recorded, never counted to the exit (§4)
        recorded: env.mode === "none" && j.problems.length === 0,
        seen: { lines: words.length, hits: j.hits, ownRow },
      };
    });
  }

  // ── L2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function deviceRows(): Promise<void> {
    let p = ""; // φP's durable key: bound to TP (device 1)
    let r = ""; // φR's: TR (device 3)
    let offFace: { colors: number } | null = null;
    let offBootGreen = false;
    let native: readonly [number, number] | null = null;
    let pane: string | null = null;

    const staged = await row("SIM-STAGED", "MUST", async () => {
      const raw = await d.plugin(PHONE.type).catch(() => null);
      const rec = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
      const plugin =
        rec === null
          ? null
          : {
              enabled: rec["enabled"] === true && rec["state"] === "enabled",
              granted: Array.isArray(rec["grantedCapabilities"])
                ? rec["grantedCapabilities"].filter((c): c is string => typeof c === "string")
                : [],
            };
      const before = (await objectsOf(PHONE.type)).length;
      // the run's first input: the lay is a drag from the chip and a key (RM4.5 is read at this row's END)
      await ownInput();
      const at = await layObject(
        h,
        {
          type: PHONE.type,
          category: PHONE.category,
          half: { w: PHONE.size.w / 2, h: PHONE.size.h / 2 },
          label: PHONE.label,
          beside: [],
        },
        before,
        () => undefined,
      );
      let source: string | null = null;
      if (at.object !== undefined) {
        p = await waitKey("φP", at.object);
        laid.add(p);
        const rect = (await objectsOf(PHONE.type)).find((o) => o.entity === at.object)?.rect;
        if (rect !== undefined) base = { x: rect.x, y: rect.y };
        await js(
          `globalThis.__vfDesk.writeProps(${at.object}, ${JSON.stringify({ model: typeOf(1), binding: { deviceType: typeOf(1), runtime: env.runtime } })})`,
        );
        try {
          await until(
            "φP's face",
            PHONE_BOUNDS.face,
            `(globalThis.__vfDesk.live()?.faces ?? []).some((f) => f.key === ${JSON.stringify(p)} && f.source === ${JSON.stringify(PHONE.source)})`,
          );
          source = PHONE.source;
        } catch {
          /* said by the judge */
        }
      }
      const seen: StagedSeen = {
        plugin,
        hung: at.hung,
        before,
        after: at.laid.after,
        faulted: at.laid.faulted,
        source,
      };
      return { problems: judgeStaged(seen), seen: { ...seen, laid: at.laid } };
    });
    // while SIM-STAGED is red every later row is VOID, never judged: none runs (the door's count then reds the run)
    if (staged === null || staged.mark !== "green" || p === "") return;

    await row("SIM-NO-DEVICE", "MUST", async () => {
      const create = count(calls(), "create");
      const q = await placePhone("φN", 1, typeOf(4));
      await view([q]);
      await until(
        "φN's face",
        PHONE_BOUNDS.face,
        `(globalThis.__vfDesk.live()?.faces ?? []).some((f) => f.key === ${JSON.stringify(q)} && f.simulator?.is != null)`,
      );
      await sleep(1_000);
      const f = await faceOf(q);
      const screen = await screenOf(q);
      const seen: NoDeviceSeen = {
        is: f?.simulator?.is ?? null,
        act: f?.simulator?.act ?? null,
        name: f?.simulator?.name ?? null,
        device: screen?.device ?? null,
        lines: screen?.lines ?? null,
        create: { before: create, after: count(calls(), "create") },
      };
      await remove(q);
      return { problems: judgeNoDevice(seen), seen };
    });

    await row("SIM-SHOW-FRESH", "MUST", async () => {
      const quit = await quitApp();
      const booted = await ensure(3, "Booted");
      if (booted !== null) return { problems: [], staging: booted };
      await openUrl(3, "/motion", nonce());
      r = await placePhone("φR", 2, typeOf(3));
      await view([r]);
      await until(
        "φR's face",
        PHONE_BOUNDS.face,
        `(globalThis.__vfDesk.live()?.faces ?? []).some((f) => f.key === ${JSON.stringify(r)} && f.simulator?.is != null)`,
      );
      await sleep(1_000);
      const f0 = await faceOf(r);
      if (f0?.simulator?.is !== "no-window")
        return {
          problems: [],
          staging: `φR read ${f0?.simulator?.is ?? "nothing"} before the press, not no-window`,
          seen: { quit },
        };
      await pickUp(r);
      const acts = f0.acts;
      const before = calls();
      await watchStart(r);
      await pressAct("SIM-SHOW-FRESH", r, 3, "show");
      const proof = await liveProven(r);
      const seq = await watchStop();
      const seen: PressedSeen = {
        act: "show",
        acts: { before: acts, after: (await faceOf(r))?.acts ?? acts },
        seq,
        proof,
        calls: { before, after: calls() },
      };
      await putDown();
      await away();
      return {
        problems: judgePressed("SIM-SHOW-FRESH", seen, { through: "booting", calls: { show: 1 } }),
        seen: { quit, ...seen },
      };
    });

    await row("SIM-OFF-BOOT", "MUST", async () => {
      const quit = await quitApp();
      const off = await ensure(1, "Shutdown");
      if (off !== null) return { problems: [], staging: off };
      await view([p]);
      await until(
        "φP off",
        PHONE_BOUNDS.face,
        `(globalThis.__vfDesk.live()?.faces ?? []).some((f) => f.key === ${JSON.stringify(p)} && f.simulator?.is === "off")`,
      ).catch(() => undefined);
      await sleep(1_200);
      const f0 = await faceOf(p);
      const want = env.runId === null ? "(no run id)" : ownName(env.runId, 1);
      if (f0?.simulator?.is !== "off" || f0.simulator.act !== "boot")
        return {
          problems: [],
          staging: `φP read ${f0?.simulator?.is ?? "nothing"}/${f0?.simulator?.act ?? "no act"}, not off with Boot`,
        };
      const offRead = await faceRead(p, false);
      offFace = offRead;
      const named =
        f0.simulator.name === want
          ? []
          : [
              `SIM-OFF-BOOT: main names the device ${JSON.stringify(f0.simulator.name)}, not ${want}`,
            ];
      await pickUp(p);
      const before = calls();
      const t0 = Date.now();
      await watchStart(p);
      await pressAct("SIM-OFF-BOOT", p, 1, "boot");
      // the page moves once the device is up: LIVE-PROVEN asks frames of a moving screen
      const deadline = t0 + PHONE_BOUNDS.boot;
      while (Date.now() < deadline && (await door.act("state", 1)).state !== "Booted")
        await sleep(1_000);
      await openUrl(1, "/motion", nonce());
      const proofAt = Date.now();
      const proof = await liveProven(p, Math.max(1_000, deadline - proofAt));
      const seq = await watchStop();
      const seen: PressedSeen = {
        act: "boot",
        acts: { before: f0.acts, after: (await faceOf(p))?.acts ?? f0.acts },
        seq,
        // its time from the press, within boot's bound
        proof: {
          ...proof,
          bound: PHONE_BOUNDS.boot,
          ms: proof.ms === null ? null : proofAt - t0 + proof.ms,
        },
        calls: { before, after: calls() },
      };
      await putDown();
      const problems = [
        ...named,
        ...judgePressed("SIM-OFF-BOOT", seen, { through: "booting", calls: { boot: 1, show: 1 } }),
      ];
      offBootGreen = problems.length === 0;
      return { problems, seen: { quit, offFace: offRead, bootMs: Date.now() - t0, ...seen } };
    });

    await row("SIM-P1", "MUST", async () => {
      const j = judgeP1({
        selected: env.selected,
        vetted: census()?.vetted ?? null,
        offBoot: offBootGreen,
        developerDir: d.env["DEVELOPER_DIR"],
      });
      return {
        problems: j.problems,
        void: j.void,
        seen: { selected: env.selected, vetted: census()?.vetted ?? null },
      };
    });

    await row("SIM-LIVE", "MUST", async () => {
      const q = nonce();
      const band = bandColour(q);
      const proof = await bringLive("SIM-LIVE", p, 1, q);
      await sleep(800);
      const shot = await deviceShot(1, `sim-live-${q}.png`, band);
      if (shot !== null) native = [shot.width, shot.height];
      if (shot === null)
        return {
          problems: [
            d.shotDir === undefined
              ? "SIM-LIVE: no VF_SMOKE_SHOT_DIR — the row needs the device's screenshot"
              : "SIM-LIVE: the door's screenshot was not read",
          ],
        };
      if (shot.band < BAND_FLOOR * shot.px)
        return {
          problems: [],
          staging: "the device's screenshot shows no band: Safari covered it",
          seen: { shot },
        };
      const glass = await faceRead(p, false);
      const a = await glassOf(p, false, band);
      const f1 = await faceOf(p);
      const c1 = frames();
      await sleep(500);
      const b = await glassOf(p, false, band);
      const f2 = await faceOf(p);
      const seen: LiveSeen = {
        proof,
        off: offFace,
        glass,
        band: a,
        shot,
        again:
          a === null || b === null
            ? null
            : {
                differ: gridsDiffer(a.grid, b.grid),
                presented: (f2?.presented ?? 0) - (f1?.presented ?? 0),
                frames: frames() - c1,
              },
      };
      // SIM-DEGRADED (NICE): the flag, as recorded — it does not say why (Accessibility, window-not-found, viewport-not-found)
      say(
        `SMOKE_PHONE_ROW ${JSON.stringify({ name: "SIM-DEGRADED", klass: "NICE", mark: "RECORDED", problems: [], why: null, seen: { degraded: f2?.simulator?.degraded ?? null } })}`,
      );
      return {
        problems: judgeLive(seen),
        seen: {
          ...seen,
          texture: f2?.texture ?? null,
          current: f2?.current ?? null,
          degraded: f2?.simulator?.degraded ?? null,
        },
      };
    });

    await row("SIM-USE", "MUST", async () => {
      const q = nonce();
      const staged0 = await ensure(1, "Booted");
      if (staged0 !== null) return { problems: [], staging: staged0 };
      await openUrl(1, "/still", q);
      await view([p]);
      const loaded = (await door.count("/loaded", q)) ?? 0;
      if (native === null) {
        const shot = await deviceShot(1, `sim-use-${q}.png`, null);
        if (shot !== null) native = [shot.width, shot.height];
      }
      const name = env.runId === null ? "" : ownName(env.runId, 1);
      let held = false;
      try {
        await pickUp(p);
        held = true;
      } catch {
        /* said by the judge */
      }
      await sleep(1_200);
      const f = await faceOf(p);
      const bar = await js<{ text: string; readout: string | null } | null>(`(() => {
        const row = document.querySelector('[data-selection-bar] [data-face-row="hand"]'); if (row === null) return null;
        return { text: [row.textContent ?? "", ...[...row.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label") ?? "")].join(" "),
          readout: row.querySelector("[data-readout]")?.textContent ?? null };
      })()`);
      const inputs0 = await door.count("/input", q);
      const acts0 = f?.acts ?? 0;
      const calls0 = calls();
      // a tap off the capsule (live: no act stands) and a key: neither reaches iOS
      const frame = await heldFrame();
      const off = await deskAt();
      if (frame !== null)
        await press({ x: off.left + frame.cx, y: off.top + frame.cy - 0.3 * frame.hy });
      await keyPress("a");
      await sleep(1_000);
      const seen: UseSeen = {
        held,
        wire: f?.wire ?? null,
        native,
        bar,
        name,
        loaded,
        inputs: { before: inputs0, after: await door.count("/input", q) },
        acts: { before: acts0, after: (await faceOf(p))?.acts ?? acts0 },
        calls: { before: calls0, after: calls() },
        rowInputs: f?.inputs ?? 0,
        down: await putDown(),
      };
      const j = judgeUse(seen);
      return { problems: j.problems, void: j.void, seen };
    });

    await row("SIM-UNSEEN", "MUST", async () => {
      const q = nonce();
      const staged0 = await ensure(1, "Booted");
      if (staged0 !== null) return { problems: [], staging: staged0 };
      await openUrl(1, "/motion", q);
      await view([p]);
      await sleep(800);
      const a0 = (await faceOf(p))?.arrivals ?? 0;
      await sleep(1_200);
      const inView = ((await faceOf(p))?.arrivals ?? 0) - a0;
      if (inView <= 0)
        return { problems: [], staging: "no arrivals over 1.2 s in view", seen: { inView } };
      await away();
      await sleep(1_000);
      const o0 = await faceOf(p);
      await sleep(1_200);
      const o1 = await faceOf(p);
      await view([p]);
      const back = await liveProven(p);
      const out: string[] = [];
      if (o1?.demand?.mode !== "paused")
        out.push(`SIM-UNSEEN: off view the face asks ${o1?.demand?.mode ?? "nothing"}, not paused`);
      if (o1?.wire?.mode !== "paused")
        out.push(`SIM-UNSEEN: off view the wire says ${o1?.wire?.mode ?? "nothing"}, not paused`);
      const offArrivals = (o1?.arrivals ?? 0) - (o0?.arrivals ?? 0);
      if (offArrivals !== 0) out.push(`SIM-UNSEEN: ${offArrivals} frames arrived off view`);
      if (o1?.simulator?.is !== "at-rest")
        out.push(
          `SIM-UNSEEN: off view the phone says ${o1?.simulator?.is ?? "nothing"}, not at rest`,
        );
      out.push(...judgeLiveProven("SIM-UNSEEN (back)", back));
      return {
        problems: out,
        seen: {
          inView,
          off: {
            ask: o1?.demand?.mode ?? null,
            wire: o1?.wire?.mode ?? null,
            arrivals: offArrivals,
            is: o1?.simulator?.is ?? null,
          },
          back,
        },
      };
    });

    await row("SIM-STILL", "MUST", async () => {
      const q = nonce();
      const band = bandColour(q);
      const staged0 = await ensure(1, "Booted");
      if (staged0 !== null) return { problems: [], staging: staged0 };
      await openUrl(1, "/motion", q);
      await view([p]);
      await pickUp(p);
      const proof = await liveProven(p);
      if (proof.ms === null) return { problems: judgeLiveProven("SIM-STILL (in hand)", proof) };
      const live = await glassOf(p, true, band);
      const taken0 = (await stats())?.stillsTaken ?? 0;
      await putDown();
      await js("globalThis.__vfDesk.liveSettled()");
      await sleep(800);
      const taken1 = (await stats())?.stillsTaken ?? 0;
      const address = await js<string | null>(
        `globalThis.__vfDesk.pageStill(${JSON.stringify(p)}).then((s) => s?.address ?? null)`,
      );
      const extraStill = (await screenOf(p))?.still ?? false;
      // reopened off view: the reload frames the content on arrival (use-workspace-session), so away AFTER it (R3)
      const reloaded = await d.reload();
      await still();
      await d.focused();
      await away();
      await sleep(1_500);
      const back = await faceOf(p);
      if (back !== null && (back.alive || back.presented > 0))
        return {
          problems: [],
          staging: `after the reload φP was seen live (presented ${back.presented}) before it went off view`,
        };
      const rested =
        back === null
          ? null
          : { still: back.still, rested: back.rested || back.simulator?.is === "at-rest" };
      // the still SEEN: the cap at 1 held by a playing pane, the phone brought into view waits at rest on its still
      pane ??= await placePane(0);
      await view([pane]);
      await until(
        "the fixture's pane alive",
        PHONE_BOUNDS.face,
        `(globalThis.__vfDesk.live()?.faces ?? []).some((f) => f.key === ${JSON.stringify(pane)} && f.alive && f.presented > 0)`,
      );
      const capNow = await js<number | null>("globalThis.__vfDesk.liveCap()");
      await js("globalThis.__vfDesk.liveCap(1)");
      await view([pane, p]);
      await sleep(1_000);
      // the still SEEN only while the phone rests on it — at rest, a still, not alive (R2)
      const atSeen = await faceOf(p);
      const resting =
        atSeen !== null &&
        atSeen.still !== null &&
        !atSeen.alive &&
        (atSeen.rested || atSeen.simulator?.is === "at-rest");
      if (!resting) {
        await js(`globalThis.__vfDesk.liveCap(${capNow ?? 6})`);
        return {
          problems: [],
          staging: `seen under the cap φP is not at rest on its still (${JSON.stringify({ rested: atSeen?.rested, still: atSeen?.still, alive: atSeen?.alive })})`,
        };
      }
      // the band's live colour at the law's dim: the PAGE's light (the band the page draws) at `display.still`, the
      // glass's own beyond it kept (dimmed()'s `page`)
      const lit = live === null ? null : live.bandMean;
      const dim = lit === null ? null : dimmed(lit, band, PHONE.still);
      const predicted: [number, number, number] | null =
        dim === null ? null : [Math.round(dim[0]), Math.round(dim[1]), Math.round(dim[2])];
      const seenStill = await glassOf(p, false, predicted);
      await js(`globalThis.__vfDesk.liveCap(${capNow ?? 6})`);
      await away();
      await view([p]);
      const handover = await liveProven(p);
      const seen: StillSeen = {
        taken: { before: taken0, after: taken1 },
        address,
        want: stillAddress(typeOf(1), env.runtime),
        extraStill,
        live,
        reloaded,
        rested,
        seen: seenStill,
        predicted,
        handover,
      };
      return {
        problems: [...judgeLiveProven("SIM-STILL (in hand)", proof), ...judgeStill(seen)],
        seen,
      };
    });

    await row("SIM-IDLE", "MUST", async () => {
      const staged0 = await ensure(1, "Booted");
      if (staged0 !== null) return { problems: [], staging: staged0 };
      await openUrl(1, "/motion", nonce());
      await view([p]);
      const proof = await liveProven(p);
      await openUrl(1, "/still", nonce());
      await still();
      await sleep(2_000);
      try {
        await until("the desk asleep", 15_000, "globalThis.__vfDesk.rest().asleep === true");
      } catch {
        /* said by the judge */
      }
      await sleep(idleWait(Date.now()));
      const r0 = await js<{ steps: number; wakes: Record<string, number> }>(
        "globalThis.__vfDesk.rest()",
      );
      const p0 = (await stats())?.presented ?? 0;
      const asleep: boolean[] = [];
      for (let i = 0; i < 6; i += 1) {
        asleep.push(await js<boolean>("globalThis.__vfDesk.rest().asleep"));
        await sleep(500);
      }
      const r1 = await js<{ steps: number; wakes: Record<string, number> }>(
        "globalThis.__vfDesk.rest()",
      );
      const p1 = (await stats())?.presented ?? 0;
      const near = (await faceOf(p))?.wire ?? null;
      // the far ask: the phone under the law's nearPx device px on screen (R9, recorded; the exit is the unit's, DLS:240)
      await zoomFar(p);
      const far = (await faceOf(p))?.wire ?? null;
      await view([p]);
      await sleep(1_500);
      // motion wakes it: presents and arrivals within 2 s of the page asked to move
      const f0 = await faceOf(p);
      const s0 = (await stats())?.presented ?? 0;
      await door.act("openurl", 1, { url: door.page("/motion", nonce()) });
      const woke = Date.now();
      let f1 = f0;
      let s1 = s0;
      while (Date.now() - woke < 2_000) {
        await sleep(200);
        f1 = await faceOf(p);
        s1 = (await stats())?.presented ?? 0;
        if (s1 > s0 && (f1?.arrivals ?? 0) > (f0?.arrivals ?? 0)) break;
      }
      const seen: IdleSeen = {
        proof,
        asleep,
        steps: r1.steps - r0.steps,
        presented: p1 - p0,
        wake: { presented: s1 - s0, arrivals: (f1?.arrivals ?? 0) - (f0?.arrivals ?? 0) },
      };
      return {
        problems: judgeIdle(seen),
        seen: {
          ...seen,
          wakes: r1.wakes,
          wire: { near: near?.targetFps ?? null, far: far?.targetFps ?? null },
        },
      };
    });

    await row("SIM-CAP", "MUST", async () => {
      const proof0 = await bringLive("SIM-CAP", p, 1, nonce());
      pane ??= await placePane(0);
      await away();
      await view([pane]);
      await until(
        "the fixture's pane alive",
        PHONE_BOUNDS.face,
        `(globalThis.__vfDesk.live()?.faces ?? []).some((f) => f.key === ${JSON.stringify(pane)} && f.alive)`,
      );
      const capNow = await js<number | null>("globalThis.__vfDesk.liveCap()");
      await js("globalThis.__vfDesk.liveCap(1)");
      await view([pane, p]);
      await sleep(1_500);
      const s0 = await stats();
      const waiting = await faceOf(p);
      const paneBefore = await faceOf(pane);
      await pickUp(p);
      const surface0 = (await faceOf(p))?.surface ?? null;
      const proof = await liveProven(p);
      const inHand = await faceOf(p);
      const paneHeld = await faceOf(pane);
      const s1 = await stats();
      await putDown();
      await js(`globalThis.__vfDesk.liveCap(${capNow ?? 6})`);
      const out: string[] = [...judgeLiveProven("SIM-CAP (staged)", proof0)];
      if (s0?.cap !== 1) out.push(`SIM-CAP: the cap reads ${s0?.cap ?? "nothing"}, not 1`);
      if (paneBefore?.alive !== true) out.push("SIM-CAP: the pane was not alive in the slot");
      if (waiting?.rested !== true || waiting.still === null)
        out.push(
          `SIM-CAP: seen with the slot full the phone is not at rest on its still (${JSON.stringify({ rested: waiting?.rested, still: waiting?.still })})`,
        );
      out.push(...judgeLiveProven("SIM-CAP (in hand)", proof));
      if (inHand?.alive !== true || inHand.wire?.mode !== "live")
        out.push("SIM-CAP: the held phone is not alive with its wire live");
      if (paneHeld?.rested !== true)
        out.push("SIM-CAP: the pane was not put to rest under the held phone");
      // HELD-NEVER of its own: the held phone's surface unchanged under the cap
      if (inHand?.surface !== surface0)
        out.push("SIM-CAP: the held phone's surface changed under the cap — it was rested");
      return {
        problems: out,
        seen: { s0, s1, waiting: { rested: waiting?.rested, still: waiting?.still }, proof },
      };
    });

    await row("SIM-RELOAD", "MUST", async () => {
      const proof0 = await bringLive("SIM-RELOAD", p, 1, nonce());
      const before = { runtimes: d.custody()?.runtimes ?? 0, census: census() };
      const o0 = await js<number>("performance.timeOrigin");
      await d.reload();
      await still();
      await d.focused();
      await sleep(1_500);
      await openUrl(1, "/motion", nonce());
      await view([p]);
      const proof = await liveProven(p);
      const o1 = await js<number>("performance.timeOrigin");
      const seen: ReloadSeen = {
        before,
        after: { runtimes: d.custody()?.runtimes ?? 0, census: census() },
        origins: [o0, o1],
        proof,
      };
      return {
        problems: [...judgeLiveProven("SIM-RELOAD (before)", proof0), ...judgeReload(seen)],
        seen,
      };
    });

    await row("SIM-SHOW-RUNNING", "MUST", async () => {
      // P7 row 1, risk 1: Show it while Simulator.app ALREADY runs — written, may be red, RECORDED and ruled after
      const quit = await quitApp();
      const q = await placePhone("φQ", 3, typeOf(2));
      try {
        const b2 = await ensure(2, "Booted");
        const b1 = await ensure(1, "Booted");
        if (b2 !== null || b1 !== null) return { problems: [], staging: b2 ?? b1, recorded: true };
        await openUrl(2, "/motion", nonce());
        const shown = await door.act("show-app", 1);
        if (shown.state !== "shown")
          return { problems: [], staging: `show-app P read ${shown.state}`, recorded: true };
        await sleep(3_000);
        await view([q]);
        await until(
          "φQ's face",
          PHONE_BOUNDS.face,
          `(globalThis.__vfDesk.live()?.faces ?? []).some((f) => f.key === ${JSON.stringify(q)} && f.simulator?.is != null)`,
        ).catch(() => undefined);
        await sleep(1_000);
        const f0 = await faceOf(q);
        if (f0?.simulator?.is !== "no-window")
          return {
            problems: [],
            staging: `Simulator.app showed every booted device (φQ read ${f0?.simulator?.is ?? "nothing"})`,
            recorded: true,
          };
        await pickUp(q);
        await pressAct("SIM-SHOW-RUNNING", q, 2, "show");
        const word: (string | null)[] = [];
        for (let i = 0; i < 30; i += 1) {
          word.push((await faceOf(q))?.simulator?.is ?? null);
          await sleep(500);
        }
        const proof = await liveProven(q, 5_000);
        await shootDesk("pt-s3-show-running.png");
        await putDown();
        const problems = judgeLiveProven("SIM-SHOW-RUNNING", proof);
        return { problems, recorded: true, seen: { quit, word, proof } };
      } finally {
        // φQ's attachment reaped at once (the grace is read when armed): never inside SIM-GONE's count window (R5)
        await js("globalThis.__vfDesk.liveGrace(1000)");
        await remove(q);
        await sleep(1_500);
        await js("globalThis.__vfDesk.liveGrace(null)");
      }
    });

    await row("SIM-STOPPED", "MUST", async () => {
      // K1(c), the QUIT: `stopped` expected; `off` (the quit shut P down) RECORDED, the stopped face unwitnessed
      const staged0 = await ensure(1, "Booted");
      if (staged0 !== null) return { problems: [], staging: staged0 };
      pane ??= await placePane(0);
      await away();
      const proof0 = await bringLive("SIM-STOPPED", p, 1, nonce());
      const capNow = await js<number | null>("globalThis.__vfDesk.liveCap()");
      await js("globalThis.__vfDesk.liveCap(1)");
      await view([pane, p]);
      await sleep(1_500);
      const paneRested = (await faceOf(pane))?.rested === true;
      const phoneAlive = (await faceOf(p))?.alive === true;
      if (!paneRested || !phoneAlive) {
        await js(`globalThis.__vfDesk.liveCap(${capNow ?? 6})`);
        return {
          problems: judgeLiveProven("SIM-STOPPED (staged)", proof0),
          staging: `under the cap the phone alive ${phoneAlive}, the pane rested ${paneRested}`,
        };
      }
      const wakes0 = (await stats())?.wakes ?? 0;
      const quit = await quitApp();
      let wordNow: string | null = null;
      const deadline = Date.now() + PHONE_BOUNDS.word;
      while (Date.now() < deadline) {
        wordNow = (await faceOf(p))?.simulator?.is ?? null;
        if (wordNow === "stopped" || wordNow === "off") break;
        await sleep(200);
      }
      const stateP = (await door.act("state", 1)).state;
      await sleep(1_500);
      const wakes1 = (await stats())?.wakes ?? 0;
      const paneAlive = (await faceOf(pane))?.alive === true;
      await shootDesk("pt-s3-stopped.png");
      let retry: LiveProof | null = null;
      if (wordNow === "stopped") {
        await pickUp(p);
        const before = calls();
        await pressAct("SIM-STOPPED", p, 1, "retry");
        retry = await liveProven(p);
        await putDown();
        say(`SMOKE_PHONE_RETRY ${JSON.stringify({ before, after: calls() })}`);
      }
      await js(`globalThis.__vfDesk.liveCap(${capNow ?? 6})`);
      const stoppedSeen: StoppedSeen = {
        quit,
        word: wordNow,
        stateP,
        wakes: [wakes0, wakes1],
        paneAlive,
        retry,
      };
      const j = judgeStopped(stoppedSeen);
      const finding =
        wordNow === "stopped"
          ? null
          : `the quit reads ${wordNow ?? "nothing"} (device ${stateP}) — the stopped face unwitnessed`;
      if (finding !== null)
        say(`SMOKE_PHONE_FINDING ${JSON.stringify({ row: "SIM-STOPPED", finding })}`);
      return {
        problems: j.problems,
        recorded: j.recorded,
        staging: j.staging,
        seen: { ...stoppedSeen, finding },
      };
    });

    await row("SIM-ATTACH", "MUST", async () => {
      const staged0 = await ensure(3, "Booted");
      if (staged0 !== null) return { problems: [], staging: staged0 };
      // φA's attachment to R, released at ⌘Z, reaped at once: never warm on R's session in SIM-GONE (R5)
      await js("globalThis.__vfDesk.liveGrace(1000)");
      const a = await placePhone("φA", 4, typeOf(3), false);
      try {
        await view([a]);
        const tr = JSON.stringify(typeOf(3));
        let answer: { deviceType: string; runtime: string } | null = null;
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline && answer === null) {
          answer =
            await js(`(() => { const rows = globalThis.__vfDesk.simulatorDevices()?.rows ?? null; if (rows === null) return null;
            return globalThis.__vfDesk.local(${T})?.devices?.()?.attachable(${tr}) ?? null; })()`);
          if (answer === null) await sleep(500);
        }
        // THE GATE (§4), its first leg: the answer its own type (tier 1). Its second is the door's, right before the
        // press: R Booted and the host's booted set ⊆ the run's own. Any miss STOPs the run without pressing.
        if (answer?.deviceType !== typeOf(3))
          throw new PhoneStop(
            `SIM-ATTACH: the attach gate: the host answers ${JSON.stringify(answer)}, not tier 1`,
          );
        const e = await entityOf(a);
        const at = await placeOf(a);
        if (e === null || at === null) throw new Error("φA left the board");
        const off = await deskAt();
        await ownInput();
        await press({ x: off.left + at.cx, y: off.top + at.cy });
        const act = (id: string): string =>
          `[data-selection-bar] .vf-bar-row [data-act="act:${id}"]`;
        await until(
          "the bar's Attach",
          5_000,
          `document.querySelector(${JSON.stringify(act("attach"))}) !== null && document.querySelector("[data-selection-bar]")?.getAttribute("data-shown") === "true"`,
        );
        const props = async (): Promise<Record<string, unknown>> =>
          (await objectsOf(PHONE.type)).find((o) => o.key === a)?.props ?? {};
        const gate = await door.row("SIM-ATTACH", "press", {
          act: "attach",
          device: env.runId === null ? "" : ownName(env.runId, 3),
        });
        if (gate.stop !== null)
          throw new PhoneStop(`SIM-ATTACH: the door's attach gate: ${gate.stop}`);
        await h.pressSelector(act("attach"));
        await sleep(1_000);
        const bound = bindingRead((await props())["binding"]);
        await undoKey();
        await sleep(800);
        const undone = bindingRead((await props())["binding"]);
        const finish0 = (await props())["finish"];
        await h.pressSelector(act("finish"));
        await sleep(800);
        const finish1 = (await props())["finish"];
        await undoKey();
        await sleep(800);
        const seen: AttachSeen = {
          bound,
          undone,
          finish: { before: finish0, after: finish1, undone: (await props())["finish"] },
          want: { deviceType: typeOf(3), runtime: env.runtime },
        };
        await keyPress("Escape");
        return { problems: judgeAttach(seen), seen };
      } finally {
        await remove(a);
        await sleep(1_500);
        await js("globalThis.__vfDesk.liveGrace(null)");
      }
    });

    await row("SIM-GONE", "MUST", async () => {
      if (r === "") return { problems: [], staging: "φR was never laid (SIM-SHOW-FRESH)" };
      // Show on a FRESH launch: SIM-STOPPED's Try again left Simulator.app up, and Show over a running app is
      // SIM-SHOW-RUNNING's may-be-red case, outside this row's Proves (R5)
      const quit = await quitApp();
      if (quit !== "quit" && quit !== "not-running")
        return { problems: [], staging: `quit-app read ${quit}: Simulator.app may be running` };
      await js("globalThis.__vfDesk.liveGrace(1000)");
      const proof = await bringLive("SIM-GONE", r, 3, nonce());
      const now = (): { runtimes: number; sessions: number; active: number } => ({
        runtimes: d.custody()?.runtimes ?? 0,
        sessions: census()?.sessions ?? 0,
        active: census()?.helper?.activeSessions ?? 0,
      });
      // `before` read only once main's counts hold still (an earlier row's attachment reaping mid-window would move
      // them by more than the one this row removes)
      let before = now();
      for (let i = 0; i < 8; i += 1) {
        await sleep(1_000);
        const again = now();
        const same =
          again.runtimes === before.runtimes &&
          again.sessions === before.sessions &&
          again.active === before.active;
        before = again;
        if (same) break;
      }
      const t0 = Date.now();
      await remove(r);
      let closedMs: number | null = null;
      while (Date.now() - t0 < 3_000) {
        if ((await faceOf(r)) === null) {
          closedMs = Date.now() - t0;
          break;
        }
        await sleep(50);
      }
      let after = now();
      const deadline = Date.now() + 8_000;
      while (
        Date.now() < deadline &&
        (after.runtimes >= before.runtimes ||
          after.sessions >= before.sessions ||
          after.active >= before.active)
      ) {
        await sleep(250);
        after = now();
      }
      await js("globalThis.__vfDesk.liveGrace(null)");
      const seen: GoneSeen = {
        proof,
        closedMs,
        before,
        after,
        state: (await door.act("state", 3)).state,
      };
      return { problems: judgeGone(seen), seen };
    });

    await row("SIM-RATE", "OBSERVATION", async () => {
      // P12: arrivals a second with /motion — numbers that stand only on a timing host (PM-WINDOW): never here
      await bringLive("SIM-RATE", p, 1, nonce());
      const a = await deviceShot(1, `sim-rate-a-${nonce()}.png`, null);
      await sleep(250);
      const b = await deviceShot(1, `sim-rate-b-${nonce()}.png`, null);
      const moving = a !== null && b !== null && gridsDiffer(a.grid, b.grid);
      const rate = async (): Promise<number> => {
        const a0 = (await faceOf(p))?.arrivals ?? 0;
        await sleep(3_000);
        return Math.round((((await faceOf(p))?.arrivals ?? 0) - a0) / 3);
      };
      const near = await rate();
      await zoomFar(p);
      const far = await rate();
      await view([p]);
      await pickUp(p);
      const inHand = await rate();
      await putDown();
      return {
        problems: [],
        recorded: true,
        void: moving ? null : "two device screenshots 250 ms apart do not differ",
        seen: {
          perSecond: { inHand, near, far },
          asked: { inHand: PHONE.fps.focused, near: PHONE.fps.near, far: PHONE.fps.far },
          host: "not a timing host",
        },
      };
    });

    await row("SIM-SHARE", "NICE", async () => {
      await bringLive("SIM-SHARE", p, 1, nonce());
      const before = {
        sessions: census()?.sessions ?? 0,
        active: census()?.helper?.activeSessions ?? 0,
      };
      const p2 = await placePhone("φP2", 5, typeOf(1));
      try {
        await view([p, p2]);
        await liveProven(p2);
        const faces = await js<number>(
          `(globalThis.__vfDesk.live()?.faces ?? []).filter((f) => (f.key === ${JSON.stringify(p)} || f.key === ${JSON.stringify(p2)}) && f.alive).length`,
        );
        const after = {
          sessions: census()?.sessions ?? 0,
          active: census()?.helper?.activeSessions ?? 0,
        };
        const out: string[] = [];
        if (after.sessions !== before.sessions || after.active !== before.active)
          out.push(
            `SIM-SHARE: two phones on one device moved main's sessions ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
          );
        if (faces !== 2) out.push(`SIM-SHARE: ${faces} of the two faces alive under the cap`);
        return { problems: out, seen: { before, after, faces } };
      } finally {
        await remove(p2);
      }
    });

    await row("SIM-REBIND", "NICE", async () => {
      await bringLive("SIM-REBIND", p, 1, nonce());
      const off = await ensure(2, "Shutdown");
      if (off !== null) return { problems: [], staging: off };
      await js("globalThis.__vfDesk.liveGrace(1000)");
      const before = census()?.sessions ?? 0;
      const e = await entityOf(p);
      await js(
        `globalThis.__vfDesk.writeProps(${e}, ${JSON.stringify({ model: typeOf(2), binding: { deviceType: typeOf(2), runtime: env.runtime } })})`,
      );
      const stills: (number | null)[] = [];
      for (let i = 0; i < 10; i += 1) {
        stills.push((await faceOf(p))?.still ?? null);
        await sleep(200);
      }
      await sleep(3_000);
      const after = census()?.sessions ?? 0;
      await js(
        `globalThis.__vfDesk.writeProps(${e}, ${JSON.stringify({ model: typeOf(1), binding: { deviceType: typeOf(1), runtime: env.runtime } })})`,
      );
      await js("globalThis.__vfDesk.liveGrace(null)");
      const out: string[] = [];
      if (stills.some((s) => s !== null))
        out.push("SIM-REBIND: rebound to Q the phone showed a still (R15: never P's)");
      if (after !== before - 1)
        out.push(`SIM-REBIND: P's session was not released after the grace (${before} → ${after})`);
      return { problems: out, seen: { stills, sessions: [before, after] } };
    });

    await noUdidRow();
  }

  // ── L3 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function costRows(): Promise<void> {
    await row("SIM-COST", "OBSERVATION", async () => {
      // P13: RECORDED, never a gate; the stage samples the helper, Simulator.app and the device by pid beside it
      const p = await placePhone("φP", 0, typeOf(1));
      const booted = await ensure(1, "Booted");
      if (booted !== null) return { problems: [], staging: booted, recorded: true };
      const shown = await door.act("show-app", 1);
      await sleep(3_000);
      await openUrl(1, "/motion", nonce());
      const pane = await placePane(0);
      await view([pane, p]);
      const atRest = await liveProven(p);
      /** An 8 s window: the app's processes, the face's presents and arrivals, the desk's perf, rest and budget — R12: no
       * stream texture charged to it (no `live <key>` row of the phone's). */
      const sample = async (): Promise<unknown> => {
        const m0 = d.metrics();
        const f0 = await faceOf(p);
        await sleep(8_000);
        const f1 = await faceOf(p);
        const budget = await js<unknown>("globalThis.__vfDesk.budget()");
        return {
          metrics: [m0, d.metrics()],
          presented: (f1?.presented ?? 0) - (f0?.presented ?? 0),
          arrivals: (f1?.arrivals ?? 0) - (f0?.arrivals ?? 0),
          perf: await js("globalThis.__vfDesk.perf()"),
          rest: await js("globalThis.__vfDesk.rest()"),
          budget,
          streamCharged: JSON.stringify(budget).includes(`live ${p}`),
        };
      };
      const rest = await sample();
      await pickUp(p);
      const inHand = await liveProven(p);
      const held = await sample();
      await putDown();
      return {
        problems: [],
        recorded: true,
        seen: { shown: shown.state, atRest, inHand, rest, held },
      };
    });
  }
}
