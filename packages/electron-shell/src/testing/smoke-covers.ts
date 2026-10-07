// DK-15 — THE COVERS OVER THE DESK, IN THE PRODUCT (smoke:canvas; DESIGN.md §8 "The covers over the desk"; DK-D25 — James:
// "frozen desk should be still and consume no render time at all, do it properly"; R16; FC-D13, FC-D15, FC-D16). Under a
// cover the desk is a STILL and costs nothing. Each row moves the real frame (the window's view, its one owner in main),
// and reads back the cover's record off the desk's door (`__vfDesk.covers()` — every step in the order taken, with its
// time, the still's size, the blur's px, the face, what was said), a page-side recorder (every frame from before the
// cover moves: the cover's opacity, the desk canvas's visibility and display, the still's face, visibility and transform,
// the desk's frames and submits; the still's own transition events), and the desk's counters:
//   GODVIEW / HISTORY — each from the canvas, the wind blowing (the desk BUSY, so "live" means frames moving):
//     RISE    — the cover fades in over the LIVE desk (its first frames up: the canvas shown, the cover under 1, the desk
//               not frozen); the capture answered; the still blurred ONCE by 40 × the view's DPR (the still's px per CSS
//               px); swapped in, the canvas hidden by VISIBILITY (never `display:none`); THEN the freeze; the park within
//               its budget of the rise; never a blank frame (the canvas or the still on every frame);
//     HOLD    — `submits()` and `perf().frames` standing still for ≥ 3 s from the park;
//     RECEDE  — the still 1 → 0.98 over 560 ms on the island curve, transform only; the view's ground at the covers' 72 %,
//               no backdrop filter on it (nor on the room's fades, History);
//     THEME   — the theme changed under the cover: thaw → one frame → capture → blur → swap → hide → freeze → park, the
//               still lit the new way; the stills dk-15-<view>-{light,dark}.png;
//     RESIZE  — the window resized under the cover: taken again at the new size — the still the desk's LAYOUT size at the
//               view's DPR (no transform reaches the desk under a cover — ICE I39's case never met) — and again when put back;
//     BACK    — to the canvas: THAW FIRST, the live canvas shown at once under the lowering cover, the still dropped; the
//               desk drawing again;
//   LOST    — the cover's capture answering nothing (the witnesses' switch, as a lost device answers): the mat's ground
//             (`--vf-mat-ground` — #3D5A30 by day, #313C40 by night), "The desk lost its graphics device" said ONCE, a
//             theme change under it taken again and said no more; the counters still; dk-15-lost-device.png;
//   REDUCED — reduced motion emulated: no recede (the still at scale 1, no transition), the cover's fade 120 ms.
// THE PARK'S BUDGET (the brief's scope 3): the rise → the park, for every rise, held to `COVERS.parkBudgetMs`.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { countersOf, movedBy, STILLNESS_SAMPLE, type StillnessSample } from "./smoke-stillness";
import { hiddenDuring, PAGE_VISIBILITY, type PageVisibility } from "./smoke-visibility";

/** The canon's numbers for the covers (DESIGN.md §8, §6), and the park's budget this slice holds. */
export const COVERS = {
  blurCssPx: 40,
  recedeMs: 560,
  recedeScale: 0.98,
  tint: 0.72,
  fadeMs: 240,
  reducedFadeMs: 120,
  /** the rise → the park: the capture, the blur, the swap, the hide, the freeze and its settle step — all inside the cover's
   * own 240 ms fade over the live desk (measured 26–51 ms on a quiet M1 Max, DK-15's first probe). */
  parkBudgetMs: 240,
  /** the hold under the cover: the counters standing still this long from the park */
  holdMs: 3_200,
  lostWords: "The desk lost its graphics device",
  /** the mat's ground as the theme lights it (DESIGN.md §2.1) */
  ground: { light: "rgb(61, 90, 48)", dark: "rgb(49, 60, 64)" },
} as const;

/** One pass of a stand, as the door records it (field-app `cover-still.ts`). */
export interface CoverPassSeen {
  readonly reason: "rise" | "resize" | "theme";
  readonly asked: number;
  readonly thawed?: number;
  readonly frame?: { readonly frames: number; readonly at: number };
  readonly capture?: {
    readonly asked: number;
    readonly answered: number;
    readonly width: number | null;
    readonly height: number | null;
    readonly viewWidth: number;
    readonly pxPerCss: number | null;
  };
  readonly blur?: { readonly px: number; readonly ms: number };
  readonly face?: "still" | "ground";
  readonly swapped?: number;
  readonly hidden?: number;
  readonly frozen?: number;
  readonly parked?: number;
  readonly aborted?: boolean;
}

/** One stand of a cover, as the door records it. */
export interface CoverRecordSeen {
  readonly seq: number;
  readonly view: string;
  readonly reduced: boolean;
  readonly rose: number;
  readonly passes: readonly CoverPassSeen[];
  readonly steps: readonly string[];
  readonly said: string | null;
  readonly lowered?: number;
  readonly thawed?: number;
  readonly shown?: number;
  readonly dropped?: number;
}

/** One frame as the page-side recorder saw it. */
export interface CoverSample {
  readonly t: number;
  /** the frame's cover: "up" | "down", and its opacity */
  readonly cover: string | null;
  readonly opacity: number;
  /** the desk canvas's computed visibility and display (null: no desk canvas) */
  readonly canvas: string | null;
  readonly display: string | null;
  /** the still's face ("none" | "still" | "ground"), its computed visibility and transform */
  readonly still: string | null;
  readonly stillVisible: string | null;
  readonly transform: string;
  readonly frames: number;
  readonly submits: number;
}

/** What the recorder saw from its arming on. */
export interface CoverRecorded {
  readonly t0: number;
  readonly samples: readonly CoverSample[];
  readonly events: readonly {
    readonly type: string;
    readonly property: string;
    readonly t: number;
  }[];
  /** the still's computed transition as last read */
  readonly transition: string;
}

/** The scale a computed `matrix(a, b, c, d, e, f)` carries ("none" is 1). */
export function scaleOf(transform: string): number {
  const m = /matrix\(([^)]+)\)/u.exec(transform);
  if (m === null) return 1;
  const [a = 1, b = 0] = (m[1] ?? "").split(",").map(Number);
  return Math.hypot(a, b);
}

/** The alpha a computed colour carries (`rgba(…, a)`, `color(srgb … / a)`; 1 when none is written). */
export function alphaOf(color: string): number {
  const slash = /\/\s*([\d.]+)\s*\)/u.exec(color);
  if (slash !== null) return Number(slash[1]);
  const rgba = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/u.exec(color);
  if (rgba !== null) return Number(rgba[1]);
  return 1;
}

const close = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;

/**
 * THE RISE by the ruled order: the capture answered with a still of the desk as it last presented — its drawn size, `drawn`
 * (the canvas's backing px); the blur 40 × the still's px per CSS px, ONCE; then swap, hide, freeze — the freeze after the
 * still stood; the park after the freeze and within the budget of the rise. `cssWidth` is the desk canvas's layout width.
 * (At the view's DPR the still's px per CSS px IS the DPR — unless the desk was mounted under a transform, ICE I39 at
 * desk.4: then it draws a smaller backing, the still is that, and the rule still holds — `i39Of` names it.)
 */
export function judgeRise(
  rec: CoverRecordSeen | undefined,
  cssWidth: number,
  drawn: number | null,
  budgetMs: number = COVERS.parkBudgetMs,
): string[] {
  if (rec === undefined) return ["no cover was recorded"];
  const problems: string[] = [];
  const pass = rec.passes[0];
  if (pass === undefined || pass.reason !== "rise") return ["the stand has no rise"];
  const rise = rec.steps.slice(0, 6);
  if (rise.join(" ") !== "capture blur swap hide freeze park")
    problems.push(
      `the rise ran ${JSON.stringify(rise)}, not capture → blur → swap → hide → freeze → park`,
    );
  const cap = pass.capture;
  const ratio = cap?.pxPerCss ?? null;
  if (cap === undefined || cap.width === null) problems.push("the capture answered nothing");
  else {
    if (drawn !== null && !close(cap.width, drawn, 2))
      problems.push(`the still is ${cap.width} px wide, not the desk's drawn ${drawn}`);
    if (ratio === null || !close(ratio, cap.width / cssWidth, 0.01))
      problems.push(`the still's px per CSS px is ${ratio}, not ${cap.width} / ${cssWidth}`);
  }
  if (pass.blur === undefined) problems.push("the still was not blurred");
  else if (ratio !== null && !close(pass.blur.px, COVERS.blurCssPx * ratio, 0.05))
    problems.push(
      `the blur is ${pass.blur.px} px, not 40 CSS px × ${ratio} px per CSS px = ${COVERS.blurCssPx * ratio}`,
    );
  if (rec.steps.filter((s) => s === "blur").length !== rec.passes.filter((p) => p.blur).length)
    problems.push("a still was blurred more than once");
  if (pass.face !== "still")
    problems.push(`the face under the cover is ${pass.face}, not the still`);
  const { swapped, hidden, frozen, parked } = pass;
  if (swapped === undefined || hidden === undefined || frozen === undefined)
    problems.push("the swap, the hide or the freeze never happened");
  else if (
    !(cap === undefined || cap.answered <= swapped) ||
    !(swapped <= hidden && hidden <= frozen)
  )
    problems.push("the freeze came before the still stood");
  if (parked === undefined) problems.push("the desk never parked under the cover");
  else {
    if (frozen !== undefined && parked < frozen) problems.push("the park came before the freeze");
    if (parked - rec.rose > budgetMs)
      problems.push(
        `the park came ${Math.round(parked - rec.rose)} ms after the rise, over its ${budgetMs} ms budget`,
      );
  }
  return problems;
}

/** ICE I39 at desk.4, named: the desk draws a backing other than its layout × the DPR (mounted or resized under a CSS
 * transform) — null when it draws its layout size. Said, never the cover's fault: under a cover nothing transforms the desk. */
export function i39Of(
  cssWidth: number,
  dpr: number,
  drawn: number | null,
): { readonly drawn: number; readonly layout: number } | null {
  if (drawn === null) return null;
  const layout = Math.round(cssWidth * dpr);
  return close(drawn, layout, 2) ? null : { drawn, layout };
}

/**
 * THE FADE OVER THE LIVE DESK, AND NEVER A BLANK: the first frames with the cover up show the desk's canvas (its visibility
 * `visible`), the cover under full opacity, and no still yet; on EVERY frame either the canvas or the still is visible; the
 * canvas is never `display:none`. `swappedAt` is the record's swap.
 */
export function judgeFade(recorded: CoverRecorded, swappedAt: number | undefined): string[] {
  const problems: string[] = [];
  const up = recorded.samples.filter((s) => s.cover === "up");
  const first = up[0];
  if (first === undefined) return ["no frame showed the cover up"];
  if (first.canvas !== "visible" || first.still !== "none")
    problems.push(
      `the cover's first frame showed ${JSON.stringify({ canvas: first.canvas, still: first.still })}, not the live desk`,
    );
  if (!(first.opacity < 1))
    problems.push(`the cover's first frame was already opaque (${first.opacity})`);
  const before = up.filter((s) => swappedAt === undefined || s.t < swappedAt);
  if (before.length > 1) {
    const moved = (before.at(-1)?.frames ?? 0) - (before[0]?.frames ?? 0);
    if (moved <= 0) problems.push("the desk drew nothing under the cover's fade — not live");
  }
  const blank = recorded.samples.filter(
    (s) => s.canvas !== "visible" && s.stillVisible !== "visible",
  );
  if (blank.length > 0)
    problems.push(
      `${blank.length} frame(s) showed neither the desk nor its still (first at ${Math.round((blank[0]?.t ?? 0) - recorded.t0)} ms)`,
    );
  if (recorded.samples.some((s) => s.display === "none"))
    problems.push("the desk canvas was set display:none");
  const hidden = up.filter((s) => swappedAt !== undefined && s.t > swappedAt + 50);
  if (hidden.some((s) => s.canvas !== "hidden"))
    problems.push("the desk canvas was not hidden (by visibility) under the still");
  return problems;
}

/** THE HOLD: from the park, the counters stand still for the whole window. */
export function judgeHold(
  a: StillnessSample,
  b: StillnessSample,
  heldMs: number,
  atLeastMs = 3_000,
): string[] {
  const problems: string[] = [];
  if (heldMs < atLeastMs) problems.push(`the hold lasted ${heldMs} ms, under ${atLeastMs} ms`);
  if (a.frames !== b.frames || a.submits !== b.submits)
    problems.push(
      `the desk ran under the cover (${JSON.stringify({ from: countersOf(a), to: countersOf(b), movedBy: movedBy(a, b) })})`,
    );
  return problems;
}

/** THE RECEDE: one transform transition on the still, 560 ms on the island curve, ending at 0.98 (transform only). */
export function judgeRecede(recorded: CoverRecorded, swappedAt: number | undefined): string[] {
  const problems: string[] = [];
  if (!/transform 0\.56s cubic-bezier\(0\.25,\s*1,\s*0\.3,\s*1\)/u.test(recorded.transition))
    problems.push(
      `the still's transition is ${JSON.stringify(recorded.transition)}, not transform 560 ms on the island curve`,
    );
  const end = recorded.events.find((e) => e.type === "transitionend" && e.property === "transform");
  if (end === undefined) problems.push("the still's recede never ended");
  else if (swappedAt !== undefined && !close(end.t - swappedAt, COVERS.recedeMs, 120))
    problems.push(`the recede ended ${Math.round(end.t - swappedAt)} ms after the swap, not 560`);
  if (recorded.events.some((e) => e.property !== "transform"))
    problems.push(
      `the still moved more than its transform (${JSON.stringify(recorded.events.map((e) => e.property))})`,
    );
  const last = recorded.samples.at(-1);
  if (last === undefined || !close(scaleOf(last.transform), COVERS.recedeScale, 0.001))
    problems.push(
      `the still settled at ${last === undefined ? "?" : scaleOf(last.transform)}, not 0.98`,
    );
  return problems;
}

/** A RE-CAPTURE by the order: thaw → one frame → capture → blur → swap → hide → freeze → park. */
export function judgeAgain(
  rec: CoverRecordSeen | undefined,
  reason: "theme" | "resize",
  nth = 1,
): { pass: CoverPassSeen | undefined; problems: string[] } {
  const passes = rec?.passes.filter((p) => p.reason === reason) ?? [];
  const pass = passes[nth - 1];
  if (pass === undefined)
    return { pass, problems: [`no ${reason} pass was taken under the cover`] };
  const problems: string[] = [];
  const order: [string, number | undefined][] = [
    ["thaw", pass.thawed],
    ["frame", pass.frame?.at],
    ["capture", pass.capture?.asked],
    ["swap", pass.swapped],
    ["hide", pass.hidden],
    ["freeze", pass.frozen],
    ["park", pass.parked],
  ];
  const missing = order.filter(([, t]) => t === undefined).map(([n]) => n);
  if (missing.length > 0) problems.push(`the ${reason} pass never took ${missing.join(", ")}`);
  else {
    for (let i = 1; i < order.length; i += 1) {
      const [was, at0] = order[i - 1] as [string, number];
      const [now, at1] = order[i] as [string, number];
      if (at1 < at0) problems.push(`the ${reason} pass took ${now} before ${was}`);
    }
  }
  return { pass, problems };
}

/** THE LOWERING: thaw FIRST, the canvas shown, the still dropped — and on the first frame down, the desk shown under a
 * cover still lowering, the still gone. */
export function judgeBack(rec: CoverRecordSeen | undefined, recorded: CoverRecorded): string[] {
  if (rec === undefined) return ["no cover was recorded"];
  const problems: string[] = [];
  const tail = rec.steps.slice(-3).join(" ");
  if (tail !== "thaw show drop")
    problems.push(
      `back to the canvas ran ${JSON.stringify(rec.steps.slice(-3))}, not thaw → show → drop`,
    );
  if (rec.thawed === undefined || rec.shown === undefined || rec.dropped === undefined)
    problems.push("the thaw, the show or the drop never happened");
  const down = recorded.samples.find((s) => s.cover === "down");
  if (down === undefined) problems.push("no frame showed the cover lowering");
  else {
    if (down.canvas !== "visible") problems.push(`the desk was not shown at once (${down.canvas})`);
    if (down.still !== "none") problems.push(`the still was not dropped (${down.still})`);
    if (!(down.opacity > 0))
      problems.push("the cover was already gone — the desk not shown UNDER it");
  }
  const last = recorded.samples.at(-1);
  if (down !== undefined && last !== undefined && last.frames <= down.frames)
    problems.push("the desk did not draw again after the cover");
  return problems;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The page-side recorder, armed BEFORE the cover moves: every frame for `ms`, and the still's transition events. */
const ARM_RECORDER = (ms: number): string => `(() => {
  const g = globalThis;
  const still = document.querySelector(".field-still");
  const cover = document.querySelector(".vf-cover");
  const rec = { t0: performance.now(), samples: [], events: [], transition: "" };
  g.__vfCoverRec = rec;
  if (g.__vfCoverEvents === undefined && still !== null) {
    g.__vfCoverEvents = (e) => { if (e.target === still) g.__vfCoverRec?.events.push({ type: e.type, property: e.propertyName, t: performance.now() }); };
    for (const type of ["transitionstart", "transitionend", "transitioncancel"]) still.addEventListener(type, g.__vfCoverEvents);
  }
  const step = () => {
    const now = performance.now();
    const canvas = document.querySelector("[data-ice-canvas] > canvas");
    const cs = canvas === null ? null : getComputedStyle(canvas);
    const ss = still === null ? null : getComputedStyle(still);
    const d = g.__vfDesk;
    rec.samples.push({
      t: now,
      cover: cover?.getAttribute("data-cover") ?? null,
      opacity: cover === null ? 0 : Number(getComputedStyle(cover).opacity),
      canvas: cs === null ? null : cs.visibility,
      display: cs === null ? null : cs.display,
      still: still?.getAttribute("data-still") ?? null,
      stillVisible: ss === null ? null : ss.visibility,
      transform: ss === null ? "none" : ss.transform,
      frames: d?.perf().frames ?? -1,
      submits: d?.submits()?.total ?? -1,
    });
    if (ss !== null) rec.transition = ss.transitionProperty + " " + ss.transitionDuration + " " + ss.transitionTimingFunction;
    if (now - rec.t0 < ${ms}) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return rec.t0;
})()`;

const READ_RECORDER = "globalThis.__vfCoverRec";

/** The view's facts a row judges by: the DPR, the desk canvas's layout and backing size, the views' grounds. */
const READ_VIEW = `(() => {
  const canvas = document.querySelector("[data-ice-canvas] > canvas");
  const still = document.querySelector(".field-still");
  const ground = (sel) => { const el = document.querySelector(sel); if (el === null) return null; const cs = getComputedStyle(el); return { background: cs.backgroundColor, backdrop: cs.backdropFilter }; };
  const frosts = [...document.querySelectorAll(".vf-history .tr-frost, .vf-history .ah-day")].map((el) => getComputedStyle(el, "::before").backdropFilter).filter((f) => f !== "none");
  return {
    dpr: devicePixelRatio,
    cssWidth: canvas?.clientWidth ?? 0,
    cssHeight: canvas?.clientHeight ?? 0,
    backing: canvas === null ? null : { width: canvas.width, height: canvas.height },
    still: still === null ? null : { face: still.getAttribute("data-still"), background: getComputedStyle(still).backgroundColor, transform: getComputedStyle(still).transform, transition: getComputedStyle(still).transition },
    godview: ground(".vf-godview"),
    history: ground(".vf-history"),
    frosts,
    cover: (() => { const c = document.querySelector(".vf-cover"); return c === null ? null : getComputedStyle(c).transitionDuration; })(),
  };
})()`;

interface ViewFacts {
  readonly dpr: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly backing: { readonly width: number; readonly height: number } | null;
  readonly still: {
    readonly face: string | null;
    readonly background: string;
    readonly transform: string;
    readonly transition: string;
  } | null;
  readonly godview: { readonly background: string; readonly backdrop: string } | null;
  readonly history: { readonly background: string; readonly backdrop: string } | null;
  readonly frosts: readonly string[];
  readonly cover: string | null;
}

/** The still under the cover, read back as a mean luma (drawn small into a 2D canvas — the still is a bitmap canvas). */
const STILL_LUMA = `(() => {
  const still = document.querySelector(".field-still");
  if (still === null || still.getAttribute("data-still") !== "still") return null;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 40;
  const ctx = c.getContext("2d");
  ctx.drawImage(still, 0, 0, 64, 40);
  const px = ctx.getImageData(0, 0, 64, 40).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  return Math.round(sum / (px.length / 4));
})()`;

export interface CoverRowsDriver {
  readonly win: BrowserWindow;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

/** DK-15's rows (above). Returns the problems, each in words. */
export async function coverRows(d: CoverRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const problems: string[] = [];
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const covers = (): Promise<CoverRecordSeen[]> =>
    js<CoverRecordSeen[]>("globalThis.__vfDesk.covers()");
  const lastCover = async (): Promise<CoverRecordSeen | undefined> => (await covers()).at(-1);
  const until = async (label: string, timeoutMs: number, expression: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await js<unknown>(expression)) === true) return;
      await sleep(40);
    }
    throw new Error(
      `${label} did not happen within ${timeoutMs}ms (last cover ${JSON.stringify(await lastCover())})`,
    );
  };
  const view = (): Promise<ViewFacts> => js<ViewFacts>(READ_VIEW);
  const sample = (): Promise<StillnessSample> => js<StillnessSample>(STILLNESS_SAMPLE);
  const visibility = (): Promise<PageVisibility> => js<PageVisibility>(PAGE_VISIBILITY);
  const shoot = async (name: string): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await win.capturePage()).toPNG());
  };
  const theme = async (name: "light" | "dark"): Promise<void> => {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    await until(
      `the desk dressed ${name}`,
      10_000,
      `globalThis.__vfDesk.theme() === ${JSON.stringify(name)}`,
    );
  };
  const setView = async (name: "canvas" | "godview" | "history"): Promise<void> => {
    await js(`globalThis.vibefield.view.set(${JSON.stringify(name)})`);
  };
  /** the newest stand's `reason` pass number `nth`, parked */
  const parkedPass = (reason: string, nth: number, seq: number): string =>
    `(() => { const r = globalThis.__vfDesk.covers().at(-1); if (r === undefined || r.seq !== ${seq}) return false; const p = r.passes.filter((x) => x.reason === ${JSON.stringify(reason)})[${nth - 1}]; return p !== undefined && p.parked !== undefined; })()`;
  const nextSeq = async (): Promise<number> => ((await lastCover())?.seq ?? 0) + 1;
  /** the counters standing still from now for `ms` — the page visible throughout */
  const hold = async (row: string, ms: number): Promise<{ problems: string[]; facts: object }> => {
    const v0 = await visibility();
    const a = await sample();
    const t0 = Date.now();
    await sleep(ms);
    const b = await sample();
    const held = Date.now() - t0;
    const hidden = hiddenDuring(row, v0, await visibility());
    const facts = {
      from: countersOf(a),
      to: countersOf(b),
      heldMs: held,
      parkedWakes: movedBy(a, b).wakes,
    };
    return {
      problems: hidden !== null ? [hidden] : judgeHold(a, b, held, Math.min(ms, 3_000)),
      facts,
    };
  };
  const canvasFirst = async (): Promise<void> => {
    await setView("canvas");
    await until(
      "the canvas view",
      10_000,
      `document.querySelector(".vf-cover")?.getAttribute("data-cover") === "down"`,
    );
    await sleep(400);
  };

  // ── GODVIEW (rising by day) and HISTORY (rising by night) ─────────────────────────────────────────────────────────
  const parks: Record<string, number> = {};
  for (const [name, first, second] of [
    ["godview", "light", "dark"],
    ["history", "dark", "light"],
  ] as const) {
    const ROW = name.toUpperCase();
    const row = (p: string): string => `COVER ${ROW}: ${p}`;
    await canvasFirst();
    await theme(first);
    await sleep(500);
    // the wind blowing: the desk BUSY, so the fade is over a live desk with frames moving
    await js(`globalThis.__vfDesk.ambient("live")`);
    await sleep(300);
    const seq = await nextSeq();
    await js(ARM_RECORDER(1_600));
    await setView(name);
    await until(`the ${name} cover parked`, 10_000, parkedPass("rise", 1, seq));
    // HOLD — from the park, for ≥ 3 s
    const held = await hold(row("hold"), COVERS.holdMs);
    const rec = await lastCover();
    const recorded = await js<CoverRecorded>(READ_RECORDER);
    const facts = await view();
    const swapped = rec?.passes[0]?.swapped;
    problems.push(
      ...judgeRise(rec, facts.cssWidth, facts.backing?.width ?? null).map(row),
      ...judgeFade(recorded, swapped).map(row),
      ...held.problems.map(row),
      ...judgeRecede(recorded, swapped).map(row),
    );
    const ground = name === "godview" ? facts.godview : facts.history;
    if (ground === null) problems.push(row("the view's ground is not there"));
    else {
      if (!close(alphaOf(ground.background), COVERS.tint, 0.011))
        problems.push(row(`the view's ground is ${ground.background}, not the covers' 72 %`));
      if (ground.backdrop !== "none")
        problems.push(row(`the view's ground wears a backdrop filter (${ground.backdrop})`));
    }
    if (facts.frosts.length > 0)
      problems.push(row(`the room's fades still frost (${facts.frosts.join(", ")})`));
    if (rec?.passes[0]?.parked !== undefined)
      parks[name] = Math.round(rec.passes[0].parked - rec.rose);
    const luma0 = await js<number | null>(STILL_LUMA);
    await shoot(`dk-15-${name}-${first}.png`);
    say(
      `SMOKE_CANVAS_COVER_${ROW} ${JSON.stringify({
        seq: rec?.seq,
        theme: first,
        dpr: facts.dpr,
        view: { width: facts.cssWidth, height: facts.cssHeight },
        drawn: facts.backing,
        i39: i39Of(facts.cssWidth, facts.dpr, facts.backing?.width ?? null),
        capture: rec?.passes[0]?.capture,
        blur: rec?.passes[0]?.blur,
        steps: rec?.steps,
        ms:
          rec === undefined
            ? null
            : {
                captured: Math.round((rec.passes[0]?.capture?.answered ?? 0) - rec.rose),
                swapped: Math.round((rec.passes[0]?.swapped ?? 0) - rec.rose),
                frozen: Math.round((rec.passes[0]?.frozen ?? 0) - rec.rose),
                parked: Math.round((rec.passes[0]?.parked ?? 0) - rec.rose),
              },
        fade: (() => {
          const up = recorded.samples.filter((s) => s.cover === "up");
          return {
            firstUp: up[0],
            beforeSwap: up.filter((s) => swapped === undefined || s.t < swapped).length,
          };
        })(),
        hold: held.facts,
        recede: {
          transition: recorded.transition,
          ended:
            recorded.events.find((e) => e.type === "transitionend") === undefined
              ? null
              : Math.round(
                  (recorded.events.find((e) => e.type === "transitionend")?.t ?? 0) -
                    (swapped ?? 0),
                ),
          settled: scaleOf(recorded.samples.at(-1)?.transform ?? "none"),
        },
        ground,
        luma: luma0,
      })}`,
    );

    // THEME — taken again under the cover
    await theme(second);
    await until(`the ${name} cover taken again for the theme`, 10_000, parkedPass("theme", 1, seq));
    const afterTheme = await lastCover();
    const again = judgeAgain(afterTheme, "theme");
    problems.push(...again.problems.map(row));
    const heldTheme = await hold(row("hold after the theme"), 1_200);
    problems.push(...heldTheme.problems.map(row));
    const luma1 = await js<number | null>(STILL_LUMA);
    if (luma0 === null || luma1 === null) problems.push(row("no still to read the theme by"));
    else if (second === "dark" ? luma1 >= luma0 : luma1 <= luma0)
      problems.push(row(`the still was not lit ${second} again (${luma0} → ${luma1})`));
    await sleep(300);
    await shoot(`dk-15-${name}-${second}.png`);
    say(
      `SMOKE_CANVAS_COVER_${ROW}_THEME ${JSON.stringify({ pass: again.pass, luma: { [first]: luma0, [second]: luma1 }, hold: heldTheme.facts })}`,
    );

    // RESIZE — taken again at the new size, and again put back
    const [w0, h0] = win.getContentSize() as [number, number];
    win.setContentSize(w0 - 120, h0 - 60);
    await until(
      `the ${name} cover taken again for the resize`,
      10_000,
      parkedPass("resize", 1, seq),
    );
    const resized = await view();
    const afterResize = await lastCover();
    const r1 = judgeAgain(afterResize, "resize", 1);
    problems.push(...r1.problems.map(row));
    const wide = r1.pass?.capture?.width ?? null;
    if (wide === null || !close(wide, Math.round(resized.cssWidth * resized.dpr), 2))
      problems.push(
        row(
          `the resized still is ${wide} px, not the desk's layout ${resized.cssWidth} × DPR ${resized.dpr}`,
        ),
      );
    if (
      resized.backing === null ||
      !close(resized.backing.width, Math.round(resized.cssWidth * resized.dpr), 2)
    )
      problems.push(
        row(
          `the desk drew ${JSON.stringify(resized.backing)} for its ${resized.cssWidth} CSS px — a transformed rect (I39)`,
        ),
      );
    const heldResize = await hold(row("hold after the resize"), 1_200);
    problems.push(...heldResize.problems.map(row));
    win.setContentSize(w0, h0);
    await until(
      `the ${name} cover taken again as the size came back`,
      10_000,
      parkedPass("resize", 2, seq),
    );
    const r2 = judgeAgain(await lastCover(), "resize", 2);
    problems.push(...r2.problems.map(row));
    say(
      `SMOKE_CANVAS_COVER_${ROW}_RESIZE ${JSON.stringify({ to: { w: w0 - 120, h: h0 - 60 }, pass: r1.pass, backing: resized.backing, css: resized.cssWidth, back: r2.pass?.capture, hold: heldResize.facts })}`,
    );

    // BACK — thaw first, the canvas at once under the lowering cover, the still dropped
    await js(ARM_RECORDER(900));
    await setView("canvas");
    await until(
      "the cover lowered",
      10_000,
      `(() => { const r = globalThis.__vfDesk.covers().at(-1); return r !== undefined && r.seq === ${seq} && r.dropped !== undefined; })()`,
    );
    await sleep(1_000);
    const lowered = await covers();
    const back = lowered.find((r) => r.seq === seq);
    const backRec = await js<CoverRecorded>(READ_RECORDER);
    problems.push(...judgeBack(back, backRec).map(row));
    say(
      `SMOKE_CANVAS_COVER_${ROW}_BACK ${JSON.stringify({ steps: back?.steps.slice(-3), ms: back === undefined ? null : { thawed: Math.round((back.thawed ?? 0) - (back.lowered ?? 0)), shown: Math.round((back.shown ?? 0) - (back.lowered ?? 0)), dropped: Math.round((back.dropped ?? 0) - (back.lowered ?? 0)) }, firstDown: backRec.samples.find((s) => s.cover === "down"), frames: { down: backRec.samples.find((s) => s.cover === "down")?.frames, last: backRec.samples.at(-1)?.frames } })}`,
    );
    await js(`globalThis.__vfDesk.ambient("idle")`);
  }

  // ── LOST: the cover's capture answering nothing ──────────────────────────────────────────────────────────────────
  {
    const row = (p: string): string => `COVER LOST: ${p}`;
    await canvasFirst();
    await theme("light");
    await sleep(400);
    const said0 = (await js<{ id: string }[]>("globalThis.__vfDesk.notices()")).filter(
      (n) => n.id === "desk-lost-device",
    ).length;
    await js(`globalThis.__vfDesk.coverCaptures("nothing")`);
    try {
      const seq = await nextSeq();
      await setView("godview");
      await until("the lost-device cover parked", 10_000, parkedPass("rise", 1, seq));
      await sleep(400);
      const rec = await lastCover();
      const facts = await view();
      if (rec?.passes[0]?.face !== "ground")
        problems.push(row(`the face is ${rec?.passes[0]?.face}, not the mat's ground`));
      if (facts.still?.face !== "ground" || facts.still.background !== COVERS.ground.light)
        problems.push(
          row(
            `the still is ${JSON.stringify(facts.still)}, not the mat's ground by day (${COVERS.ground.light})`,
          ),
        );
      if (rec?.said !== COVERS.lostWords)
        problems.push(row(`the status line was asked ${JSON.stringify(rec?.said)}`));
      const line = await js<string | null>(
        `document.querySelector(".vf-status-line__text")?.textContent ?? null`,
      );
      if (line !== COVERS.lostWords)
        problems.push(row(`the status line reads ${JSON.stringify(line)}`));
      const held = await hold(row("hold"), 1_500);
      problems.push(...held.problems.map(row));
      await shoot("dk-15-lost-device.png");
      await theme("dark");
      await until(
        "the lost-device cover taken again for the theme",
        10_000,
        parkedPass("theme", 1, seq),
      );
      await sleep(300);
      const night = await view();
      if (night.still?.face !== "ground" || night.still.background !== COVERS.ground.dark)
        problems.push(
          row(
            `by night the still is ${JSON.stringify(night.still)}, not the mat's ground (${COVERS.ground.dark})`,
          ),
        );
      const said1 = (await js<{ id: string }[]>("globalThis.__vfDesk.notices()")).filter(
        (n) => n.id === "desk-lost-device",
      ).length;
      if (said1 - said0 !== 1)
        problems.push(row(`the words were said ${said1 - said0} times, not once`));
      say(
        `SMOKE_CANVAS_COVER_LOST ${JSON.stringify({ face: rec?.passes[0]?.face, steps: rec?.steps, said: rec?.said, line, day: facts.still, night: night.still, notices: said1 - said0, hold: held.facts })}`,
      );
    } finally {
      await js(`globalThis.__vfDesk.coverCaptures("desk")`);
    }
    await canvasFirst();
  }

  // ── REDUCED: no recede, the cover's fade halved ──────────────────────────────────────────────────────────────────
  {
    const row = (p: string): string => `COVER REDUCED: ${p}`;
    const dbg = win.webContents.debugger;
    try {
      dbg.attach("1.3");
      await dbg.sendCommand("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await sleep(200);
      const seq = await nextSeq();
      await js(ARM_RECORDER(1_200));
      await setView("history");
      await until("the reduced cover parked", 10_000, parkedPass("rise", 1, seq));
      await sleep(900);
      const rec = await lastCover();
      const recorded = await js<CoverRecorded>(READ_RECORDER);
      const facts = await view();
      if (rec?.reduced !== true) problems.push(row("the stand was not recorded as reduced"));
      if (recorded.samples.some((s) => scaleOf(s.transform) !== 1))
        problems.push(row("the still receded under reduced motion"));
      if (recorded.events.length > 0)
        problems.push(row(`the still transitioned (${JSON.stringify(recorded.events)})`));
      if (
        facts.cover === null ||
        !facts.cover
          .split(",")
          .map((s) => s.trim())
          .includes("0.12s")
      )
        problems.push(row(`the cover's fade is ${facts.cover}, not 120 ms`));
      if (rec !== undefined && rec.passes[0]?.parked !== undefined)
        parks["reduced"] = Math.round(rec.passes[0].parked - rec.rose);
      problems.push(...judgeRise(rec, facts.cssWidth, facts.backing?.width ?? null).map(row));
      say(
        `SMOKE_CANVAS_COVER_REDUCED ${JSON.stringify({ reduced: rec?.reduced, transform: facts.still?.transform, transition: facts.still?.transition, cover: facts.cover, steps: rec?.steps })}`,
      );
      await setView("canvas");
      await sleep(400);
    } finally {
      if (dbg.isAttached()) {
        await dbg.sendCommand("Emulation.setEmulatedMedia", { features: [] });
        dbg.detach();
      }
    }
  }

  // ── THE PARK'S BUDGET, said ──────────────────────────────────────────────────────────────────────────────────────
  say(
    `SMOKE_CANVAS_COVER_BUDGET ${JSON.stringify({ budgetMs: COVERS.parkBudgetMs, parkedMs: parks })}`,
  );
  return problems;
}
