// PT-2 — THE PAGE LIVE IN THE PRODUCT (smoke:canvas; the PORTALS brief PT-2 §6 "the product smoke"): a browser pane laid as
// PT-1's rows lay it (taken off the pegboard by the pointer, alone on clear ground at actual size, brought to the middle), then
// pointed at the smoke's OWN fixture page on 127.0.0.1 (testing/live-fixture.ts — the door's one write, `writeProps`): the
// desk's LIVE service opens the page behind the pane's face and the kind draws it. Judged by the fixture's own hue, colour
// count and contrast, the door's counters (the desk's frames; the face's row — its ask, the pool's wire demand, its arrivals,
// presents and texture) and main's live-surface custody — never a hash:
//   LIVE    — the face live with a frame presented, and the PAGE (PT-1's region) the fixture's: mostly its blue, its white
//             headline on it — never the sample's still, never the film;
//   IDLE    — the page still: no desk frame and no present over 1.2 s;
//   PLAYING — the fixture's runner crossing at ~30 a second: the face presented at the source's rate (18–40 a second), the desk
//             drawing as many frames give or take a few, its writer never remade (one writer, one texture epoch);
//   HELD    — ⏎ picks it up: the kind asks the native raster at 60, interactive, and the pool's wire says 60, interactive,
//             priority 80; Esc puts it down;
//   UNSEEN  — the view panned until the pane is off screen: the kind's ask and the wire paused, and no frame ARRIVES over
//             1.2 s though the page still plays (the source paused, not merely undrawn); panned back;
//   RELOAD  — the window's renderer replaced: the desk ready again and the pane's face live with a frame — and the fixture
//             heard no new load and no new token: the SAME page re-attached (main's custody by the object's durable key);
//   GONE    — the pane deleted: its face gone at once, and the page's WebContents released once the window pool's grace (60 s)
//             lapses — main's live-surface runtimes back to the count before the page opened.
// `--live-pane` beside `--smoke-canvas` runs these rows alone after the boot's (the author's loop).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_HUE, type LiveFixture } from "./live-fixture";
import {
  layPane,
  PANE,
  type PaneRowsDriver,
  pageRegion,
  paneHands,
  paneToMiddle,
  type Rect,
} from "./smoke-browser-pane";

/** The flag beside `--smoke-canvas` that runs these rows alone after the boot's (the author's loop). */
export const LIVE_FLAG = "--live-pane";

/** The rows' numbers. */
export const LIVE_ROWS = {
  /** a pixel of the fixture's ground: its hue within this many degrees of the ground's, this saturated, this bright */
  hue: { deg: 14, minSat: 0.45, minMax: 90 },
  /** a pixel near white: every channel at least this */
  white: 215,
  /** the page as the face shows it: at least this share of the page region the fixture's blue, this share its white, this
   * luma range (the headline on the ground) */
  minHueShare: 0.5,
  minWhiteShare: 0.03,
  minLumaRange: 120,
  /** how long the page waits to be live, and the settle before a count */
  liveWithinMs: 30_000,
  settleMs: 1000,
  /** IDLE and UNSEEN watch this long */
  watchMs: 1200,
  /** PLAYING watches this long; the face's presents a second within these; the desk's frames within the presents ± this */
  playMs: 2000,
  playFps: [18, 40] as const,
  frameSlack: { abs: 3, rel: 0.2 },
  /** HELD: the ask and the wire the law and the map make of a picked-up page */
  heldFps: 60,
  heldPriority: 80,
  /** GONE: the window pool's grace (`SURFACE_POOL_GRACE_MS`, 60 s) and the release's margin */
  goneWithinMs: 75_000,
} as const;

/** The fixture ground's hue angle (degrees). */
export const FIXTURE_HUE_DEG = ((): number => {
  const { r, g, b } = FIXTURE_HUE;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
})();

/**
 * The pixel classifier, as source: 1 the fixture's ground, 2 near white, 0 anything else. The renderer runs it over a
 * capture (a bitmap never crosses) and the rows' units run the same text.
 */
export const CLASSIFY = `((r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (min >= ${LIVE_ROWS.white}) return 2;
  if (max < ${LIVE_ROWS.hue.minMax} || d / max < ${LIVE_ROWS.hue.minSat}) return 0;
  const h = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  return Math.abs(h - ${FIXTURE_HUE_DEG.toFixed(2)}) <= ${LIVE_ROWS.hue.deg} ? 1 : 0;
})`;

/** A page region read back from a capture: its pixels, those of the fixture's ground and near white, its colours, its luma range. */
export interface HueSeen {
  readonly px: number;
  readonly hue: number;
  readonly white: number;
  readonly colors: number;
  readonly lumaRange: number;
}

/** The kind's ask as the face's row carries it. */
export interface AskSeen {
  readonly mode: string;
  readonly fps: number;
  readonly raster: readonly [number, number];
  readonly interactive: boolean;
}

/** The pool's wire demand as the face's row carries it (LSF's). */
export interface WireSeen {
  readonly mode: string;
  readonly targetFps: number;
  readonly priority: number;
  readonly interactive: boolean;
}

/** A face's row, as the door's `live()` reads it. */
export interface FaceRowSeen {
  readonly key: string;
  readonly demand: AskSeen | null;
  readonly wire: WireSeen | null;
  readonly state: { readonly is: string; readonly reason?: string };
  readonly info: {
    readonly address?: string;
    readonly title?: string;
    readonly loading?: number;
  };
  readonly arrivals: number;
  readonly presented: number;
  readonly dropped: number;
  readonly texture: {
    readonly width: number;
    readonly height: number;
    readonly revision: number;
    readonly epoch: number;
  } | null;
}

/** The counters a watch reads at its start and end. */
export interface Counts {
  readonly frames: number;
  readonly arrivals: number;
  readonly presented: number;
  readonly writers: number;
  readonly epoch: number | null;
}

/** What the rows saw, whole. */
export interface LiveSeen {
  readonly live: {
    readonly state: string | null;
    readonly presented: number;
    readonly address: string | null;
    readonly face: HueSeen | null;
  };
  readonly idle: { readonly ms: number; readonly from: Counts; readonly to: Counts };
  readonly playing: { readonly ms: number; readonly from: Counts; readonly to: Counts };
  readonly held: {
    readonly held: boolean;
    readonly ask: AskSeen | null;
    readonly wire: WireSeen | null;
  };
  readonly unseen: {
    readonly offScreen: boolean;
    readonly ask: AskSeen | null;
    readonly wire: WireSeen | null;
    readonly ms: number;
    readonly from: Counts;
    readonly to: Counts;
  };
  readonly reload: {
    readonly ready: boolean;
    readonly state: string | null;
    readonly presented: number;
    readonly loads: readonly [number, number];
    readonly tokens: readonly [readonly string[], readonly string[]];
  };
  readonly gone: {
    readonly before: number | null;
    readonly with: number | null;
    readonly after: number | null;
    readonly faceLeft: boolean;
    readonly ms: number;
  };
}

const share = (n: number, of: number): number => n / Math.max(of, 1);
const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/** LIVE: the face live with a frame presented; the page the fixture's — its blue, its white, their contrast. */
export function judgeLive(seen: LiveSeen["live"]): string[] {
  const out: string[] = [];
  if (seen.state !== "live") out.push(`LIVE: the face is ${seen.state ?? "not open"}, not live`);
  if (seen.presented < 1) out.push("LIVE: no frame was presented into the face");
  const f = seen.face;
  if (f === null) return [...out, "LIVE: the page was not captured"];
  if (share(f.hue, f.px) < LIVE_ROWS.minHueShare)
    out.push(
      `LIVE: ${fmt(share(f.hue, f.px))} of the page is the fixture's blue, under ${LIVE_ROWS.minHueShare} (${JSON.stringify(f)})`,
    );
  if (share(f.white, f.px) < LIVE_ROWS.minWhiteShare)
    out.push(
      `LIVE: ${fmt(share(f.white, f.px))} of the page is its white headline, under ${LIVE_ROWS.minWhiteShare}`,
    );
  if (f.lumaRange < LIVE_ROWS.minLumaRange)
    out.push(`LIVE: the page's luma spans ${f.lumaRange}, under ${LIVE_ROWS.minLumaRange}`);
  return out;
}

/** IDLE: the page still — no desk frame, no present, over the watch. */
export function judgeIdle(seen: LiveSeen["idle"]): string[] {
  const out: string[] = [];
  if (seen.ms < LIVE_ROWS.watchMs)
    out.push(`IDLE: watched ${seen.ms} ms, under ${LIVE_ROWS.watchMs}`);
  const frames = seen.to.frames - seen.from.frames;
  const presented = seen.to.presented - seen.from.presented;
  if (frames !== 0)
    out.push(`IDLE: the desk drew ${frames} frames over ${seen.ms} ms of a still page`);
  if (presented !== 0) out.push(`IDLE: ${presented} frames presented from a still page`);
  return out;
}

/** PLAYING: presents at the source's rate, the desk's frames as many, the writer never remade. */
export function judgePlaying(seen: LiveSeen["playing"]): string[] {
  const out: string[] = [];
  const s = seen.ms / 1000;
  const presented = seen.to.presented - seen.from.presented;
  const frames = seen.to.frames - seen.from.frames;
  const rate = presented / Math.max(s, 1e-6);
  const [lo, hi] = LIVE_ROWS.playFps;
  if (rate < lo || rate > hi)
    out.push(
      `PLAYING: ${fmt(rate)} presents a second (${presented} in ${seen.ms} ms), not ${lo}–${hi}`,
    );
  const slack = Math.max(LIVE_ROWS.frameSlack.abs, LIVE_ROWS.frameSlack.rel * presented);
  if (Math.abs(frames - presented) > slack)
    out.push(`PLAYING: the desk drew ${frames} frames for ${presented} presents (± ${fmt(slack)})`);
  if (seen.to.writers !== seen.from.writers)
    out.push(`PLAYING: the writer was remade (${seen.from.writers} → ${seen.to.writers})`);
  if (seen.to.epoch !== seen.from.epoch)
    out.push(
      `PLAYING: the face's texture was remade (epoch ${seen.from.epoch} → ${seen.to.epoch})`,
    );
  return out;
}

/** HELD: the kind asks native at 60, interactive; the wire says 60, interactive, priority 80. */
export function judgeHeld(seen: LiveSeen["held"]): string[] {
  const out: string[] = [];
  if (!seen.held) out.push("HELD: the pane never came into the hand");
  const a = seen.ask;
  if (a === null || a.mode !== "live" || a.fps !== LIVE_ROWS.heldFps || !a.interactive)
    out.push(
      `HELD: the kind asked ${JSON.stringify(a)}, not live at ${LIVE_ROWS.heldFps}, interactive`,
    );
  const w = seen.wire;
  if (
    w === null ||
    w.mode !== "live" ||
    w.targetFps !== LIVE_ROWS.heldFps ||
    !w.interactive ||
    w.priority !== LIVE_ROWS.heldPriority
  )
    out.push(
      `HELD: the wire says ${JSON.stringify(w)}, not live at ${LIVE_ROWS.heldFps}, interactive, priority ${LIVE_ROWS.heldPriority}`,
    );
  return out;
}

/** UNSEEN: off screen; the ask and the wire paused; no frame arrives over the watch. */
export function judgeUnseen(seen: LiveSeen["unseen"]): string[] {
  const out: string[] = [];
  if (!seen.offScreen) out.push("UNSEEN: the pane never left the screen");
  if (seen.ask?.mode !== "paused")
    out.push(`UNSEEN: the kind asked ${JSON.stringify(seen.ask)}, not paused`);
  if (seen.wire?.mode !== "paused")
    out.push(`UNSEEN: the wire says ${JSON.stringify(seen.wire)}, not paused`);
  if (seen.ms < LIVE_ROWS.watchMs)
    out.push(`UNSEEN: watched ${seen.ms} ms, under ${LIVE_ROWS.watchMs}`);
  const arrivals = seen.to.arrivals - seen.from.arrivals;
  const presented = seen.to.presented - seen.from.presented;
  if (arrivals !== 0)
    out.push(`UNSEEN: ${arrivals} frames arrived from a paused source over ${seen.ms} ms`);
  if (presented !== 0) out.push(`UNSEEN: ${presented} frames presented off screen`);
  return out;
}

/** RELOAD: the desk ready again, the face live with a frame, and the fixture heard no new load and no new token. */
export function judgeReload(seen: LiveSeen["reload"]): string[] {
  const out: string[] = [];
  if (!seen.ready) out.push("RELOAD: the desk was not ready again after the reload");
  if (seen.state !== "live")
    out.push(`RELOAD: the face is ${seen.state ?? "not open"} after the reload, not live`);
  if (seen.presented < 1) out.push("RELOAD: no frame was presented after the reload");
  const [loadsBefore, loadsAfter] = seen.loads;
  if (loadsAfter !== loadsBefore)
    out.push(
      `RELOAD: the fixture was loaded again (${loadsBefore} → ${loadsAfter}): a new page, not the same`,
    );
  const [before, after] = seen.tokens;
  if (before.length !== 1) out.push(`RELOAD: ${before.length} pages before the reload, not one`);
  if (after.length !== before.length || after.some((t, i) => t !== before[i]))
    out.push(
      `RELOAD: the page's memory is not the same (${before.length} → ${after.length} tokens): a new page`,
    );
  return out;
}

/** GONE: the face gone at once; main's runtimes back to the count before the page opened, after the pool's grace. */
export function judgeGone(seen: LiveSeen["gone"]): string[] {
  const out: string[] = [];
  if (!seen.faceLeft) out.push("GONE: the pane's face was still open after the pane was deleted");
  if (seen.before === null || seen.with === null || seen.after === null)
    return [...out, "GONE: main's live-surface custody could not be read"];
  if (seen.with !== seen.before + 1)
    out.push(`GONE: ${seen.with} runtimes with the page open, not ${seen.before + 1}`);
  if (seen.after !== seen.before)
    out.push(
      `GONE: ${seen.after} runtimes ${seen.ms} ms after the pane was deleted, not the ${seen.before} before its page opened`,
    );
  return out;
}

/** The rows' driver: PT-1's, the fixture, main's custody read, and the renderer's replacement. */
export interface LiveRowsDriver extends PaneRowsDriver {
  readonly fixture: LiveFixture;
  /** Main's live-surface custody (`LiveSurfaceAuthority.state()`); null where none is installed. PT-5c2 (F4): with the
   * device switches its browser pages took (each producer's `stats.emulations`) — main's own count. */
  readonly custody: () => {
    readonly runtimes: number;
    readonly owners: number;
    readonly emulations?: number;
    /** PT-5d (M15): the key-like events refused while a frame of another site held the focus (FRAME-TYPE) */
    readonly frameKeysRefused?: number;
    /** PT-6a (K5): the hand's commands main's pages have SENT and not had answered, now (STUCK: its chain stalled) */
    readonly handInFlight?: number;
    /** PT-6a (M4 — F1): main's pages whose current document is PULL-ONLY (FRAME-OPENED) */
    readonly pullOnly?: number;
    /** PT-6a (M8 — C5): the sessions of main's pages' frames of other sites (FRAME-SESSIONS) */
    readonly childSessions?: number;
  } | null;
  /** The window's renderer replaced (a reload), resolved once the desk says DESK_READY again. */
  readonly reload: () => Promise<boolean>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A region of the desk captured without the marks, read back by the classifier (in the renderer: a bitmap never crosses). */
const PAGE_HUE = (rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string => `(async () => {
  const shot = await globalThis.__vfDesk.capture({ rect: ${JSON.stringify(rect)}, marks: false });
  if (shot === undefined) return null;
  const w = shot.width, h = shot.height;
  const c = new OffscreenCanvas(w, h); const x = c.getContext("2d"); x.drawImage(shot, 0, 0, w, h); shot.close();
  const b = x.getImageData(0, 0, w, h).data;
  const classify = ${CLASSIFY};
  const colors = new Set(); let hue = 0, white = 0, lo = 255, hi = 0;
  for (let i = 0; i < b.length; i += 4) {
    const k = classify(b[i], b[i + 1], b[i + 2]);
    if (k === 1) hue += 1; else if (k === 2) white += 1;
    colors.add(((b[i] >> 3) << 10) | ((b[i + 1] >> 3) << 5) | (b[i + 2] >> 3));
    const l = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
    if (l < lo) lo = l; if (l > hi) hi = l;
  }
  return { px: w * h, hue, white, colors: colors.size, lumaRange: Math.round(hi - lo) };
})()`;

/** A face's row by its key, off the door. */
const FACE_ROW = (key: string): string =>
  `(globalThis.__vfDesk.live()?.faces ?? []).find((f) => f.key === ${JSON.stringify(key)}) ?? null`;

/** PT-2's rows (above). Returns the problems, each in words. */
export async function livePaneRows(d: LiveRowsDriver): Promise<string[]> {
  const { say } = d;
  const h = paneHands(d);
  const { js, until, press, drag, key, census, rows, frame, theme } = h;
  const problems: string[] = [];
  const ambient = await js<string>("globalThis.__vfDesk.ambient()");
  const themeWas = await js<string>("globalThis.__vfDesk.theme()");
  await theme("light");
  await js(`globalThis.__vfDesk.ambient("still")`);
  d.fixture.setPlaying(false);
  let pane: number | undefined;
  let paneKey: string | undefined;
  const before = await census();
  const runtimesBefore = d.custody()?.runtimes ?? null;
  const said: Partial<Record<keyof LiveSeen, unknown>> = {};
  const faceRow = async (): Promise<FaceRowSeen | null> =>
    paneKey === undefined ? null : js<FaceRowSeen | null>(FACE_ROW(paneKey));
  const counts = async (): Promise<Counts> => {
    const perf = await js<{ frames: number }>("globalThis.__vfDesk.perf()");
    const writers = await js<number>("globalThis.__vfDesk.live()?.stats.writers ?? 0");
    const row = await faceRow();
    return {
      frames: perf.frames,
      arrivals: row?.arrivals ?? 0,
      presented: row?.presented ?? 0,
      writers,
      epoch: row?.texture?.epoch ?? null,
    };
  };
  /** The desk at rest before a watch: its frame count the same over 250 ms, waited up to 3 s (a desk that never rests is
   * watched anyway, and said by the judge). */
  const atRest = async (): Promise<void> => {
    let last = -1;
    for (let i = 0; i < 12; i += 1) {
      const now = (await counts()).frames;
      if (now === last) return;
      last = now;
      await sleep(250);
    }
  };
  const watch = async (ms: number): Promise<{ ms: number; from: Counts; to: Counts }> => {
    const from = await counts();
    const t0 = Date.now();
    await sleep(ms);
    const to = await counts();
    return { ms: Date.now() - t0, from, to };
  };
  /** The desk's place in the window, and whether the pane's world rect stands off its view (camera off the door). */
  const onScreen = async (
    e: number,
  ): Promise<{ off: boolean; centre: { x: number; y: number } | null }> => {
    const r = (await rows()).find((x) => x.entity === e)?.rect;
    if (r === undefined) return { off: true, centre: null };
    const v = await js<{
      x: number;
      y: number;
      zoom: number;
      w: number;
      h: number;
      left: number;
      top: number;
    }>(
      `(() => { const c = globalThis.__vfDesk.camera(); const b = document.querySelector("[data-desk]").getBoundingClientRect();
        return { x: c.x, y: c.y, zoom: c.zoom, w: b.width, h: b.height, left: b.left, top: b.top }; })()`,
    );
    const x0 = (r.x - v.x) * v.zoom;
    const y0 = (r.y - v.y) * v.zoom;
    const x1 = x0 + r.w * v.zoom;
    const y1 = y0 + r.h * v.zoom;
    const off = x1 <= 0 || x0 >= v.w || y1 <= 0 || y0 >= v.h;
    return { off, centre: { x: v.left + (x0 + x1) / 2, y: v.top + (y0 + y1) / 2 } };
  };
  /** The camera once it holds still (a reload's arrival fit flies it): two reads 250 ms apart, the same. */
  const settledCamera = async (): Promise<void> => {
    let last = "";
    for (let i = 0; i < 24; i += 1) {
      const now = JSON.stringify(await js("globalThis.__vfDesk.camera()"));
      if (now === last) return;
      last = now;
      await sleep(250);
    }
  };
  /** `e` brought to the middle of the view by drags on the bare mat, judged by the camera (no selection needed); said whole if
   * eight drags do not bring it there. */
  const bringToMiddle = async (e: number): Promise<void> => {
    for (let i = 0; ; i += 1) {
      const r = (await rows()).find((x) => x.entity === e)?.rect;
      if (r === undefined) throw new Error("the pane left the board");
      const v = await js<{
        x: number;
        y: number;
        zoom: number;
        w: number;
        h: number;
        left: number;
        top: number;
      }>(
        `(() => { const c = globalThis.__vfDesk.camera(); const b = document.querySelector("[data-desk]").getBoundingClientRect();
          return { x: c.x, y: c.y, zoom: c.zoom, w: b.width, h: b.height, left: b.left, top: b.top }; })()`,
      );
      const by = {
        dx: v.w / 2 - (r.x + r.w / 2 - v.x) * v.zoom,
        dy: v.h / 2 - (r.y + r.h / 2 - v.y) * v.zoom,
      };
      if (Math.hypot(by.dx, by.dy) < 40) return;
      if (i === 8)
        throw new Error(
          `the pane not brought to the middle in 8 drags (camera ${JSON.stringify(v)}, rect ${JSON.stringify(r)})`,
        );
      let step = {
        dx: Math.round(Math.max(-400, Math.min(400, by.dx))),
        dy: Math.round(Math.max(-250, Math.min(250, by.dy))),
      };
      // a crowded view (a reload's arrival fit frames the whole board) may hold no bare mat for a long drag: a shorter one
      let mat: { x: number; y: number } | null = null;
      for (let k = 0; k < 4 && mat === null; k += 1) {
        mat = await js<{ x: number; y: number } | null>(BARE_FOR_PAN(step.dx, step.dy));
        if (mat === null) step = { dx: Math.round(step.dx / 2), dy: Math.round(step.dy / 2) };
      }
      if (mat === null) {
        // say what stands where the mat should be: what covers the desk's middle, how much of it picks nothing
        const seen = await js(`(() => {
          const d = globalThis.__vfDesk; const el = document.querySelector("[data-desk]"); const r = el.getBoundingClientRect();
          let bare = 0, all = 0;
          for (let y = 40; y < r.height - 40; y += 40) for (let x = 40; x < r.width - 40; x += 40) { all += 1; if (d.pick({ x, y }) === null) bare += 1; }
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { desk: [Math.round(r.width), Math.round(r.height)], bare, all, middle: top === null ? null : top.tagName + "." + String(top.className).slice(0, 60), inDesk: top !== null && el.contains(top) };
        })()`);
        throw new Error(
          `no bare mat to bring the pane to the middle from (${JSON.stringify(seen)})`,
        );
      }
      const from = { x: v.left + mat.x, y: v.top + mat.y };
      await drag(from, { x: from.x + step.dx, y: from.y + step.dy }, 8, 300);
      // measured once the camera holds, not after a fixed wait: the camera has inertia, and a release it reads as moving
      // glides on
      await settledCamera();
    }
  };
  /** `e` taken by a press on its page: the camera settled first, a second press if the first is not heard; said whole if neither is. */
  const selectPane = async (e: number, label: string): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await settledCamera();
      const where = await onScreen(e);
      if (where.off || where.centre === null) throw new Error(`${label}: the pane is off screen`);
      await press(where.centre);
      try {
        await until(label, 3_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 1");
        return;
      } catch {
        if (attempt === 0) continue;
        const at = await js<{ left: number; top: number }>(
          `(() => { const r = document.querySelector("[data-desk]").getBoundingClientRect(); return { left: r.left, top: r.top }; })()`,
        );
        const picked = await js(
          `globalThis.__vfDesk.pick({ x: ${where.centre.x - at.left}, y: ${where.centre.y - at.top} })`,
        );
        const camera = await js("globalThis.__vfDesk.camera()");
        const rect = (await rows()).find((r) => r.entity === e)?.rect;
        throw new Error(
          `${label} did not happen (pressed ${JSON.stringify(where.centre)}, picked ${JSON.stringify(picked)}, camera ${JSON.stringify(camera)}, rect ${JSON.stringify(rect)})`,
        );
      }
    }
  };
  try {
    // ── the pane laid alone on clear ground, at actual size, brought to the middle (PT-1's steps) ──────────────────
    const at = await layPane(h, before, (e) => {
      pane = e;
    });
    if (at.pane === undefined) throw new Error("no new pane on the board after the take");
    let e = at.pane;
    await paneToMiddle(h, e, at);
    await sleep(500);
    paneKey = (await rows()).find((r) => r.entity === e)?.key ?? undefined;
    if (paneKey === undefined) throw new Error("the door gives the pane no durable key");

    // ── LIVE: the door's one write points the pane at the fixture; the face opens, a frame lands, the page is drawn ──
    if (
      !(await js<boolean>(
        `globalThis.__vfDesk.writeProps(${e}, { url: ${JSON.stringify(d.fixture.url)} })`,
      ))
    )
      throw new Error("the door could not point the pane at the fixture");
    await until(
      "the page live on the face",
      LIVE_ROWS.liveWithinMs,
      `(() => { const f = ${FACE_ROW(paneKey)}; return f !== null && f.state.is === "live" && f.presented >= 1 && f.info.loading === undefined; })()`,
    );
    await sleep(LIVE_ROWS.settleMs);
    const f0 = await frame();
    const rect0 = (await rows()).find((r) => r.entity === e)?.rect;
    let face: HueSeen | null = null;
    if (f0 !== null && rect0 !== undefined) {
      const page = pageRegion(f0, rect0);
      face = await js<HueSeen | null>(
        PAGE_HUE({ x: page.x0, y: page.y0, width: page.x1 - page.x0, height: page.y1 - page.y0 }),
      );
      await shootLive(d, h, "pt-2-pane-live.png", f0);
    }
    const row0 = await faceRow();
    const live: LiveSeen["live"] = {
      state: row0?.state.is ?? null,
      presented: row0?.presented ?? 0,
      address: row0?.info.address ?? null,
      face,
    };
    said.live = live;
    problems.push(...judgeLive(live));

    // ── IDLE: the page still — nothing drawn, nothing presented ───────────────────────────────────────────────────
    // watched from rest: a frame the desk still owes (after the LIVE row's captures, or another kind's owed wake) is not the
    // page's
    await atRest();
    const idle = await watch(LIVE_ROWS.watchMs);
    said.idle = idle;
    problems.push(...judgeIdle(idle));

    // ── PLAYING: the runner crossing — the face presented at the source's rate, the desk drawing as many ────────────
    d.fixture.setPlaying(true);
    const started = (await counts()).arrivals;
    await until(
      "the playing page's frames arriving",
      5_000,
      `(() => { const f = ${FACE_ROW(paneKey)}; return f !== null && f.arrivals >= ${started + 3}; })()`,
    );
    await sleep(500);
    const playing = await watch(LIVE_ROWS.playMs);
    said.playing = playing;
    problems.push(...judgePlaying(playing));

    // ── HELD: taken by a click on its page, ⏎ picks it up; the ask and the wire; Esc puts it down ──────────────────
    const fHeld = await frame();
    const rHeld = (await rows()).find((r) => r.entity === e)?.rect;
    if (fHeld === null || rHeld === undefined)
      throw new Error("the pane is not on screen for the pick-up");
    const pHeld = pageRegion(fHeld, rHeld);
    await press({
      x: at.deskOff.left + (pHeld.x0 + pHeld.x1) / 2,
      y: at.deskOff.top + (pHeld.y0 + pHeld.y1) / 2,
    });
    await until("the pane selected", 10_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 1");
    await sleep(300);
    await key("Return");
    let held = false;
    try {
      await until("the pane in hand", 10_000, `globalThis.__vfDesk.held()?.entity === ${e}`);
      held = true;
      await until(
        "the held page asked at 60",
        5_000,
        `(() => { const f = ${FACE_ROW(paneKey)}; return f?.wire?.targetFps === ${LIVE_ROWS.heldFps}; })()`,
      );
    } catch {
      /* said by the judge below */
    }
    const rowHeld = await faceRow();
    const heldSeen: LiveSeen["held"] = {
      held,
      ask: rowHeld?.demand ?? null,
      wire: rowHeld?.wire ?? null,
    };
    said.held = heldSeen;
    problems.push(...judgeHeld(heldSeen));
    await key("Escape");
    await until("the pane put down", 10_000, "globalThis.__vfDesk.held() === null");
    await sleep(700);

    // ── UNSEEN: the view panned until the pane is off screen; the source paused; panned back ───────────────────────
    const view = at.view;
    const pans: { dx: number; dy: number }[] = [];
    for (let i = 0; i < 4 && !(await onScreen(e)).off; i += 1) {
      const step = { dx: -Math.round(view.w * 0.45), dy: 0 };
      const mat = await js<{ x: number; y: number } | null>(BARE_FOR_PAN(step.dx));
      if (mat === null) throw new Error("no bare mat to pan the pane away from");
      const from = { x: at.deskOff.left + mat.x, y: at.deskOff.top + mat.y };
      await drag(from, { x: from.x + step.dx, y: from.y + step.dy }, 8, 300);
      pans.push(step);
      await sleep(500);
    }
    const offScreen = (await onScreen(e)).off;
    await until(
      "the unseen page paused",
      5_000,
      `(() => { const f = ${FACE_ROW(paneKey)}; return f?.wire?.mode === "paused"; })()`,
    ).catch(() => undefined);
    await sleep(LIVE_ROWS.settleMs);
    const rowUnseen = await faceRow();
    const watched = await watch(LIVE_ROWS.watchMs);
    const unseen: LiveSeen["unseen"] = {
      offScreen,
      ask: rowUnseen?.demand ?? null,
      wire: rowUnseen?.wire ?? null,
      ...watched,
    };
    said.unseen = unseen;
    problems.push(...judgeUnseen(unseen));
    for (const step of pans.reverse()) {
      const mat = await js<{ x: number; y: number } | null>(BARE_FOR_PAN(-step.dx));
      if (mat === null) throw new Error("no bare mat to pan the pane back from");
      const from = { x: at.deskOff.left + mat.x, y: at.deskOff.top + mat.y };
      await drag(from, { x: from.x - step.dx, y: from.y - step.dy }, 8, 300);
      await sleep(500);
    }

    // ── RELOAD: the renderer replaced; the same page re-attached ─────────────────────────────────────────────────
    const loadsBefore = d.fixture.loads();
    const tokensBefore = d.fixture.tokens();
    const ready = await d.reload();
    // the desk reachable again: DESK_READY is the desk's first frame, said under the boot's splash — the splash lifts once
    // the board is warm and the frames are steady, and until then nothing on the desk takes a press
    await until(
      "the desk reachable after the reload (the boot's splash lifted)",
      45_000,
      `(() => { const el = document.querySelector("[data-desk]"); if (el === null) return false; const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top !== null && el.contains(top); })()`,
    );
    // the pane by its key on the new document (its entity may be another), brought into view: the reload's arrival fit
    // frames the board as it likes, and a page seen at no px is paused — the row is the PAGE's, not the camera's
    await settledCamera();
    if (d.shotDir !== undefined) {
      mkdirSync(d.shotDir, { recursive: true });
      writeFileSync(join(d.shotDir, "pt-2-after-reload.png"), (await d.win.capturePage()).toPNG());
    }
    const again = (await rows()).find((r) => r.key === paneKey);
    if (again === undefined) throw new Error("the pane is not on the board after the reload");
    e = again.entity;
    pane = e;
    await bringToMiddle(e);
    let stateAfter: string | null = null;
    let presentedAfter = 0;
    try {
      await until(
        "the page live again after the reload",
        LIVE_ROWS.liveWithinMs,
        `(() => { const f = ${FACE_ROW(paneKey)}; return f !== null && f.state.is === "live" && f.presented >= 1; })()`,
      );
    } catch {
      /* said by the judge below */
    }
    await sleep(LIVE_ROWS.settleMs);
    const rowAfter = await faceRow();
    stateAfter = rowAfter?.state.is ?? null;
    presentedAfter = rowAfter?.presented ?? 0;
    const reload: LiveSeen["reload"] = {
      ready,
      state: stateAfter,
      presented: presentedAfter,
      loads: [loadsBefore, d.fixture.loads()],
      tokens: [tokensBefore, d.fixture.tokens()],
    };
    said.reload = reload;
    problems.push(...judgeReload(reload));

    // ── GONE: the pane deleted; its face gone at once; main's runtimes back after the pool's grace ──────────────────
    const runtimesWith = d.custody()?.runtimes ?? null;
    d.fixture.setPlaying(false);
    await selectPane(e, "the pane selected to delete");
    await sleep(300);
    await key("Backspace");
    await until(
      "the pane deleted",
      5_000,
      `(globalThis.__vfDesk.census()[${JSON.stringify(PANE.type)}] ?? 0) === ${before}`,
    );
    pane = undefined;
    const deletedAt = Date.now();
    // the face closes when the kind forgets the pane — once its delete's ghost has faded (`KindLocal.forget`), not at the census
    let faceLeft = false;
    try {
      await until("the pane's face closed", 5_000, `${FACE_ROW(paneKey)} === null`);
      faceLeft = true;
    } catch {
      /* said by the judge below */
    }
    let runtimesAfter = d.custody()?.runtimes ?? null;
    while (runtimesAfter !== runtimesBefore && Date.now() - deletedAt < LIVE_ROWS.goneWithinMs) {
      await sleep(500);
      runtimesAfter = d.custody()?.runtimes ?? null;
    }
    const gone: LiveSeen["gone"] = {
      before: runtimesBefore,
      with: runtimesWith,
      after: runtimesAfter,
      faceLeft,
      ms: Date.now() - deletedAt,
    };
    said.gone = gone;
    problems.push(...judgeGone(gone));
  } catch (error) {
    // a step that cannot go on ends the rows — never what the rows before it found (they are said with it)
    problems.push(`PT-2 LIVE: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    d.fixture.setPlaying(false);
    say(`SMOKE_CANVAS_LIVE ${JSON.stringify(said)}`);
    try {
      if (pane !== undefined && (await js<boolean>("globalThis.__vfDesk.held() === null"))) {
        await bringToMiddle(pane).catch(() => undefined);
        const where = await onScreen(pane);
        if (!where.off && where.centre !== null) {
          await press(where.centre);
          await sleep(300);
          if ((await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0")) === 1)
            await key("Backspace");
        }
      }
      await sleep(500);
    } catch {
      /* a row that cannot go on ends the rows, never what the earlier rows found */
    }
    const after = await census();
    if (after !== before)
      problems.push(
        `CLEARED: ${after} panes on the board after the live rows, not the ${before} found`,
      );
    say(`SMOKE_CANVAS_LIVE_CLEARED ${JSON.stringify({ before, after })}`);
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient)})`);
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(themeWas)})`);
  }
  return problems;
}

/** A bare point of the mat — nothing picks round it, the desk's own element under it — from which a pan by (dx, dy) stays inside
 * the desk (desk CSS px). */
const BARE_FOR_PAN = (dx: number, dy = 0): string => `(() => {
  const d = globalThis.__vfDesk; const el = document.querySelector("[data-desk]"); const r = el.getBoundingClientRect();
  for (let y = 160; y < r.height - 160; y += 20) for (let x = 40; x < r.width - 40; x += 20) {
    const tx = x + ${dx}, ty = y + ${dy};
    if (tx < 40 || tx > r.width - 40 || ty < 120 || ty > r.height - 120) continue;
    let clear = true;
    for (let k = -20; k <= 20 && clear; k += 10) for (let l = -20; l <= 20 && clear; l += 10)
      if (d.pick({ x: x + k, y: y + l }) !== null) clear = false;
    if (!clear) continue;
    const under = document.elementFromPoint(r.left + x, r.top + y);
    if (under !== null && el.contains(under)) return { x, y };
  }
  return null;
})()`;

/** The pane's still, whole, when the run keeps stills. */
async function shootLive(
  d: LiveRowsDriver,
  h: ReturnType<typeof paneHands>,
  name: string,
  r: Rect,
): Promise<void> {
  if (d.shotDir === undefined) return;
  const at = await h.deskAt();
  const m = 36;
  mkdirSync(d.shotDir, { recursive: true });
  const image = await d.win.capturePage({
    x: Math.max(0, Math.floor(at.left + r.x0 - m)),
    y: Math.max(0, Math.floor(at.top + r.y0 - m)),
    width: Math.ceil(r.x1 - r.x0 + 2 * m),
    height: Math.ceil(r.y1 - r.y0 + 2 * m),
  });
  writeFileSync(join(d.shotDir, name), image.toPNG());
}
