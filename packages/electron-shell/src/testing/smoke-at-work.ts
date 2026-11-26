// Item 550 (2026-11-18) — AT WORK ON THE MAT, IN THE PRODUCT (smoke:canvas; DESIGN.md §8 "At work on the mat", §6 "At
// work on the mat" and M5, §2.10 "the desk is a stage"). No agent feeds a smoke's applier, so the rows hand the
// window's at-work store a fixture through the page's smoke-only door (`?atWorkFixture=1`:
// `__vfDesk.atWorkFixture(objects, sparks)`, the board this mount shows, as the applier publishes a feed's) on one of
// the seeded objects, its spark lent a face seed and a status as Chat's list would hold them (a smoke's window reads no
// spark of its own), and read the layer back through the desk door (`__vfDesk.atWork()`). While a fixture stands the
// store takes no write of the applier's own (a feed's snapshot, its end, a reconnect): each is held back and counted
// (`atWork().held`), and the count is printed, never judged, so no row is judged on a board the applier replaced:
//   DRAW  — a reading row is drawn within two frames: the draws grow, the GL form, its object on screen, the window's
//           ONE at-work context, and none before the row (the context is the first mark's, never the mount's or the
//           read's). By night an acting row's light lies on the bare mat past its stroke's widest wobble: the window's
//           own capture there is brighter than with the layer hidden (the light composed over a desk the layer cannot
//           read);
//   REST  — the M5 row, with the wind stilled: an open mark settled, then 3 s looked at every 50 ms — the desk asleep
//           at every look, its steps and its submits grown by 0, the overlay's draws, rAFs and timers grown by 0; then
//           a reading row draws on the overlay's own frames while the desk's steps stay where they were (the
//           reflector's `always` adds no flush of its own). Every delta is printed, and a red names its counter;
//   RING  — a needs-you row over 5 s: the desk's steps grow by 0, the overlay's draws by more, and its timer woke it at
//           least twice (a ring every 2.4 s, the layer asleep between);
//   COVER — a cover up for 2 s over a reading row: the overlay draws nothing, its verdict "cover";
//   STAGE — a spark's own reading row, its status lent: its live star is drawn on the desk's stage while it reads; then
//           open, and nobody touches it: from the desk's 8 s ambient and a slack on, no stage frame over 1 s, and the
//           stage let go;
//   DOM   — the page loaded again with `?atWorkGl=0` (the layer's context made with no WebGL2): one `.vf-atwork-frame`
//           a marked object, each stroke a computed width above 0 in a colour that is not transparent, no GL draw and
//           no context; then the page loaded back with its own doors.
// And in the GPU-less modes (`atWorkGpuLessRows`, smoke:canvas:no-gpu and smoke:canvas:no-webgpu): the layer hidden
// with the desk ("desk"), drawing nothing, making no context, and no `.vf-atwork` element visible beside the card.
// `--at-work` beside `--smoke-canvas` runs these rows alone after the boot.

import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { AGENT_CATALOG } from "@vibefield/contracts";
import type { BrowserWindow } from "electron";

/** `--at-work` beside `--smoke-canvas`: the at-work rows alone, after the boot's. */
export const AT_WORK_FLAG = "--at-work";

/** Item 550 (2026-11-18): the rows' numbers (DESIGN.md §6 "At work on the mat", §8). */
export const AT_WORK_SMOKE = {
  /** the page's smoke-only doors (field-app's `AT_WORK_FIXTURE`, `AT_WORK_GL_SWITCH`), restated: the shell imports no
   * field-app module */
  fixtureDoor: "atWorkFixture",
  glDoor: "atWorkGl",
  /** a mark is drawn within this many frames of its row */
  drawFrames: 2,
  /** M5: the mark's settle, then the window, read every `lookMs` */
  settleMs: 2_000,
  restMs: 3_000,
  lookMs: 50,
  /** a reading row's window after REST: the overlay draws, the desk does not step */
  movingMs: 1_000,
  /** RING: the window, and the timer wakes it holds (a ring every 2.4 s) */
  ringMs: 5_000,
  ringTimers: 2,
  /** COVER: how long the cover stands */
  coverMs: 2_000,
  /** STAGE: the desk's ambient after the last touch (field-app's `DESK_WIND_IDLE_MS`), its slack, the quiet window */
  ambientMs: 8_000,
  slackMs: 1_500,
  quietMs: 1_000,
  /** DRAW's light: how far past the object's edge the pixel stands, in ink px (the stroke's 17 gap, its 4.5 half-width
   * and its 8 of wobble, then 6), and how much brighter it is (the three channels summed, of 255 each) */
  glowOutInk: 17 + 4.5 + 8 + 6,
  glowLeast: 6,
  /** the marks' scale, `clamp(zoom, 0.7, 2.2)` screen px an ink px (DESIGN.md §8 "Zoom") */
  inkScale: { least: 0.7, most: 2.2 },
  /** a fixture's runs and its spark (a spark's id is `sp-` and six or more), the seed its face is dealt, and the status
   * lent it as Chat's list would hold it (the kit's `reviewing`, whose word is Reading), restated: the shell imports no
   * field-app module */
  spark: "sp-atworksmoke",
  sparkSeed: 7,
  sparkStatus: "reviewing",
} as const;

/** The page's at-work doors on smoke:canvas's own load (the fixture), and on the DOM row's (the fixture, WebGL2
 * declined). */
export const AT_WORK_DOORS = { [AT_WORK_SMOKE.fixtureDoor]: "1" } as const;
export const AT_WORK_DOM_DOORS = {
  [AT_WORK_SMOKE.fixtureDoor]: "1",
  [AT_WORK_SMOKE.glDoor]: "0",
} as const;

/** The layer's record as the desk door reads it (field-app's `AtWorkLayerRecord`, the fields the rows judge). */
export interface AtWorkRecordSeen {
  readonly form: string;
  readonly why: string | null;
  readonly hidden: string | null;
  readonly objects: number;
  readonly onScreen: number;
  readonly contexts: number;
  readonly stageContexts: number;
  readonly rafs: number;
  readonly timers: number;
  readonly deferred: number;
  readonly moving: boolean;
}

/** `__vfDesk.atWork()`: the layer's record, and the window-wide counts. */
export interface AtWorkSeen {
  readonly record: AtWorkRecordSeen | null;
  readonly draws: number;
  readonly stageFrames: number;
  readonly renders: number;
  readonly contexts: number;
  readonly stageContexts: number;
  /** the applier's writes the fixture held back from the store: said, never judged */
  readonly held: number;
}

/** DRAW: within two frames of its row the mark is drawn, in the GL form, its object on screen, the window's one context
 * made by it — none before it. */
export function judgeDraw(before: AtWorkSeen, after: AtWorkSeen): string[] {
  const problems: string[] = [];
  if (before.contexts !== 0)
    problems.push(`the window held ${before.contexts} at-work context(s) before its first mark`);
  if (after.draws <= before.draws)
    problems.push(`the mark was not drawn within ${AT_WORK_SMOKE.drawFrames} frames of its row`);
  const record = after.record;
  if (record === null) return [...problems, "the layer kept no record"];
  if (record.form !== "gl")
    problems.push(`the mark stood in the ${record.form} form (${record.why})`);
  if (record.onScreen !== 1) problems.push(`${record.onScreen} marked objects on screen, not 1`);
  if (after.contexts !== 1)
    problems.push(`${after.contexts} at-work contexts after the mark, not 1`);
  return problems;
}

/** DRAW's light: the pixel past the stroke's widest wobble is brighter with the layer than without it. */
export function judgeGlow(lit: number | null, bare: number | null): string[] {
  if (lit === null || bare === null) return ["the light's pixel could not be captured"];
  return lit - bare >= AT_WORK_SMOKE.glowLeast
    ? []
    : [
        `the ink's light did not reach the bare mat: ${lit.toFixed(1)} with the layer, ${bare.toFixed(1)} without (the three channels summed; at least ${AT_WORK_SMOKE.glowLeast} brighter)`,
      ];
}

/** One look of the M5 row: the desk at rest, and the overlay's counters. */
export interface RestLook {
  readonly asleep: boolean;
  readonly steps: number;
  readonly submits: number;
  readonly draws: number;
  readonly rafs: number;
  readonly timers: number;
}

/** The counters' growth from the first look to the last, by name. */
export function restDeltas(looks: readonly RestLook[]): Readonly<Record<string, number>> {
  const first = looks[0];
  const last = looks.at(-1);
  if (first === undefined || last === undefined) return {};
  return {
    steps: last.steps - first.steps,
    submits: last.submits - first.submits,
    draws: last.draws - first.draws,
    rafs: last.rafs - first.rafs,
    timers: last.timers - first.timers,
  };
}

/** REST (M5): the desk asleep at every look; its steps and submits, and the overlay's draws, rAFs and timers, grown by
 * none. A red names its counter. */
export function judgeRest(looks: readonly RestLook[]): string[] {
  if (looks.length < 2) return ["REST took fewer than two looks"];
  const problems: string[] = [];
  const awake = looks.filter((look) => !look.asleep).length;
  if (awake > 0) problems.push(`the desk was awake at ${awake} of ${looks.length} looks`);
  for (const [name, grew] of Object.entries(restDeltas(looks)))
    if (grew !== 0) problems.push(`${name} grew by ${grew} at rest with a mark on the board`);
  return problems;
}

/** REST, then: a reading row moves the overlay on its own frames, and the desk does not step for it. */
export function judgeMovingAlone(a: RestLook, b: RestLook): string[] {
  const problems: string[] = [];
  if (b.draws <= a.draws) problems.push("a reading row drew nothing while the desk slept");
  if (b.steps !== a.steps)
    problems.push(`the desk stepped ${b.steps - a.steps} time(s) for the overlay's motion`);
  return problems;
}

/** RING: the ring draws on the layer's own timer while the desk sleeps. */
export function judgeRing(a: RestLook, b: RestLook): string[] {
  const problems: string[] = [];
  if (b.steps !== a.steps)
    problems.push(`the desk stepped ${b.steps - a.steps} time(s) for a needs-you ring`);
  if (b.draws <= a.draws) problems.push("the needs-you ring drew nothing");
  if (b.timers - a.timers < AT_WORK_SMOKE.ringTimers)
    problems.push(
      `the layer's timer woke it ${b.timers - a.timers} time(s) in ${AT_WORK_SMOKE.ringMs} ms, under ${AT_WORK_SMOKE.ringTimers}`,
    );
  return problems;
}

/** COVER: nothing drawn under a cover, the verdict "cover". */
export function judgeCover(a: AtWorkSeen, b: AtWorkSeen): string[] {
  const problems: string[] = [];
  if (b.draws !== a.draws)
    problems.push(`the overlay drew ${b.draws - a.draws} time(s) under the cover`);
  if (b.record?.hidden !== "cover")
    problems.push(`under the cover the layer's verdict was ${JSON.stringify(b.record?.hidden)}`);
  return problems;
}

/** STAGE: the star drawn on its stage while its work moves; past the ambient and its slack, no frame and no stage. */
export function judgeStage(
  reading: { readonly a: AtWorkSeen; readonly b: AtWorkSeen },
  quiet: { readonly a: AtWorkSeen; readonly b: AtWorkSeen },
): string[] {
  const problems: string[] = [];
  if (reading.b.stageFrames <= reading.a.stageFrames)
    problems.push("the spark's live star was drawn on no stage while it read");
  if (reading.b.stageContexts !== 1)
    problems.push(`${reading.b.stageContexts} stage contexts while it read, not 1`);
  if (quiet.b.stageFrames !== quiet.a.stageFrames)
    problems.push(
      `${quiet.b.stageFrames - quiet.a.stageFrames} stage frames over ${AT_WORK_SMOKE.quietMs} ms past the ambient`,
    );
  if (quiet.b.stageContexts !== 0)
    problems.push(`${quiet.b.stageContexts} stage contexts past the ambient, not 0`);
  return problems;
}

/** The DOM form as the page shows it: its frames, and each stroke's computed width and colour. */
export interface DomSeen {
  readonly frames: number;
  readonly strokes: readonly { readonly width: number; readonly colour: string }[];
}

/** A computed colour's alpha (its fourth number; three numbers are opaque), 0 for one that names none. */
export function alphaOf(colour: string): number {
  const numbers = colour.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length >= 4) return numbers[3] ?? 0;
  return numbers.length === 3 ? 1 : 0;
}

/** DOM: one frame a marked object, each stroke wide and coloured, no GL draw, no context. */
export function judgeDom(dom: DomSeen, a: AtWorkSeen, b: AtWorkSeen, marked: number): string[] {
  const problems: string[] = [];
  if (dom.frames !== marked)
    problems.push(`${dom.frames} DOM frames for ${marked} marked object(s)`);
  if (dom.strokes.length === 0) problems.push("the DOM form drew no stroke");
  for (const [i, stroke] of dom.strokes.entries()) {
    if (!(stroke.width > 0)) problems.push(`stroke ${i} is ${stroke.width} px wide`);
    if (alphaOf(stroke.colour) <= 0) problems.push(`stroke ${i} has no colour (${stroke.colour})`);
  }
  if (b.record?.form !== "dom") problems.push(`the layer stood in the ${b.record?.form} form`);
  if (b.draws !== a.draws) problems.push(`the DOM form drew ${b.draws - a.draws} GL frame(s)`);
  if (b.contexts !== 0) problems.push(`${b.contexts} WebGL2 context(s) with WebGL2 declined`);
  return problems;
}

/** The GPU-less modes: hidden with the desk, drawing nothing, no context, nothing of it visible. */
export function judgeGpuLess(took: boolean | null, seen: AtWorkSeen, visible: number): string[] {
  const problems: string[] = [];
  if (took !== true) problems.push(`the fixture was not taken (${JSON.stringify(took)})`);
  if (seen.record?.hidden !== "desk")
    problems.push(`the layer's verdict was ${JSON.stringify(seen.record?.hidden)}, not "desk"`);
  if (seen.draws !== 0)
    problems.push(`the layer drew ${seen.draws} time(s) on a desk that does not draw`);
  if (seen.contexts !== 0)
    problems.push(`${seen.contexts} at-work context(s) on a desk that does not draw`);
  if (seen.stageContexts !== 0) problems.push(`${seen.stageContexts} stage context(s)`);
  if (visible > 0) problems.push(`${visible} visible .vf-atwork element(s) beside the card`);
  return problems;
}

// ———————————————————————————————————————————————————————————————— the page's reads

const READ = "globalThis.__vfDesk.atWork()";

const LOOK = `(() => {
  const d = globalThis.__vfDesk;
  const r = d.rest();
  const a = d.atWork();
  return {
    asleep: r.asleep,
    steps: r.steps,
    submits: d.submits()?.total ?? -1,
    draws: a.draws,
    rafs: a.record?.rafs ?? -1,
    timers: a.record?.timers ?? -1,
  };
})()`;

/** A box on the page, CSS px. */
interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A seeded object the rows mark, wholly on screen: its type, durable key, its box on the page (CSS px), the zoom. */
interface ObjectSeen {
  readonly type: string;
  readonly key: string;
  readonly zoom: number;
  readonly box: Rect;
  readonly desk: Rect;
}

/** The object the rows mark: a still kind first (a photo's face turns nothing), else the first wholly on screen. */
const PICK_OBJECT = `(() => {
  const d = globalThis.__vfDesk;
  const el = document.querySelector("[data-desk]");
  if (d === undefined || el === null) return null;
  const r = el.getBoundingClientRect();
  const cam = d.camera();
  for (const type of ["desk.photo", ...Object.keys(d.census())]) {
    for (const o of d.objects(type)) {
      if (o.key === null) continue;
      const x = (o.rect.x - cam.x) * cam.zoom;
      const y = (o.rect.y - cam.y) * cam.zoom;
      const w = o.rect.w * cam.zoom;
      const h = o.rect.h * cam.zoom;
      if (x < 0 || y < 0 || x + w > r.width || y + h > r.height) continue;
      return {
        type,
        key: o.key,
        zoom: cam.zoom,
        box: { left: r.left + x, top: r.top + y, width: w, height: h },
        desk: { left: r.left, top: r.top, width: r.width, height: r.height },
      };
    }
  }
  return null;
})()`;

/** Any object's durable key, on screen or not (the GPU-less modes: nothing is placed there anyway). */
const ANY_KEY = `(() => {
  const d = globalThis.__vfDesk;
  if (d === undefined) return null;
  for (const type of Object.keys(d.census()))
    for (const o of d.objects(type)) if (o.key !== null) return o.key;
  return null;
})()`;

/** Whether the desk picks nothing at a page point, and the desk is what lies there (bare mat). */
const BARE_AT = (x: number, y: number): string => `(() => {
  const d = globalThis.__vfDesk;
  const el = document.querySelector("[data-desk]");
  if (d === undefined || el === null) return false;
  const r = el.getBoundingClientRect();
  if (${x} < r.left + 2 || ${y} < r.top + 2 || ${x} > r.right - 2 || ${y} > r.bottom - 2) return false;
  const under = document.elementFromPoint(${x}, ${y});
  return d.pick({ x: ${x} - r.left, y: ${y} - r.top }) === null && under !== null && el.contains(under);
})()`;

/** The at-work layer shown or hidden by its own style (the light's comparison), waited two frames. */
const LAYER_SHOWN = (shown: boolean): string => `(async () => {
  for (const el of document.querySelectorAll(".vf-atwork")) el.style.visibility = ${shown ? '""' : '"hidden"'};
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()`;

const READ_DOM = `(() => {
  const frames = document.querySelectorAll(".vf-atwork .vf-atwork-frame").length;
  const strokes = [...document.querySelectorAll(".vf-atwork .vf-atwork-stroke")].map((el) => {
    const s = getComputedStyle(el);
    return { width: Number.parseFloat(s.borderTopWidth), colour: s.borderTopColor };
  });
  return { frames, strokes };
})()`;

const VISIBLE_LAYERS = `[...document.querySelectorAll(".vf-atwork")].filter((el) => {
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return s.visibility === "visible" && s.display !== "none" && r.width > 0 && r.height > 0;
}).length`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The page's next `n` frames, waited for. */
const FRAMES = (n: number): string => `new Promise((resolve) => {
  let left = ${n};
  const f = () => (--left <= 0 ? resolve(true) : requestAnimationFrame(f));
  requestAnimationFrame(f);
})`;

/** A fixture row as the presence feed spells one: an agent by its catalog id, read from the catalog (never spelled). */
function rowOf(
  run: string,
  state: "open" | "reading" | "acting" | "needs-you",
  since: number,
  ids: Readonly<Record<string, string>> = {},
): Readonly<Record<string, unknown>> {
  return {
    run,
    handle: `${run} in the smoke`,
    agent: AGENT_CATALOG[0]?.id ?? "agent",
    state,
    since,
    ...ids,
  };
}

export interface AtWorkRowsDriver {
  readonly win: BrowserWindow;
  /** the page loaded again with these doors, its desk drawn and revealed */
  readonly reload: (search: Readonly<Record<string, string>>) => Promise<void>;
  /** the doors smoke:canvas loads its page with, to load it back after the DOM row */
  readonly doors: Readonly<Record<string, string>>;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

/** The at-work rows on a drawing desk (above). Returns the problems, each in words. */
export async function atWorkRows(d: AtWorkRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const read = (): Promise<AtWorkSeen> => js<AtWorkSeen>(READ);
  const look = (): Promise<RestLook> => js<RestLook>(LOOK);
  const problems: string[] = [];
  const row = (name: string, found: readonly string[]): void => {
    problems.push(...found.map((p) => `AT WORK ${name}: ${p}`));
  };
  const objectOf = async (): Promise<ObjectSeen> => {
    const seen = await js<ObjectSeen | null>(PICK_OBJECT);
    if (seen === null) throw new Error("no seeded object lies wholly on screen to mark");
    return seen;
  };
  let target = await objectOf();
  /** the fixture: these rows on the object, the spark's seed and status lent; null clears it */
  const fixture = async (
    rows: readonly Readonly<Record<string, unknown>>[] | null,
  ): Promise<boolean | null> => {
    const objects = rows === null ? null : [{ key: target.key, agents: rows }];
    const sparks = {
      [AT_WORK_SMOKE.spark]: { seed: AT_WORK_SMOKE.sparkSeed, status: AT_WORK_SMOKE.sparkStatus },
    };
    return js<boolean | null>(
      `globalThis.__vfDesk.atWorkFixture?.(${JSON.stringify(objects)}, ${JSON.stringify(sparks)}) ?? null`,
    );
  };
  const mark = async (rows: readonly Readonly<Record<string, unknown>>[]): Promise<void> => {
    const took = await fixture(rows);
    if (took !== true)
      throw new Error(`the at-work fixture was not taken (${JSON.stringify(took)})`);
  };
  /** the run's next `since`: a new one each row, so a state's start is always new */
  let since = Date.now();
  const next = (): number => {
    since += 1;
    return since;
  };
  const theme0 = await js<string>("globalThis.__vfDesk.theme()");
  const ambient0 = await js<string>("globalThis.__vfDesk.ambient()");
  const theme = async (name: string): Promise<void> => {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if ((await js<string>("globalThis.__vfDesk.theme()")) === name) break;
      await sleep(60);
    }
    await sleep(600);
  };
  const asleep = async (boundMs: number): Promise<boolean> => {
    const deadline = Date.now() + boundMs;
    while (Date.now() < deadline) {
      if (await js<boolean>("globalThis.__vfDesk.rest().asleep === true")) return true;
      await sleep(AT_WORK_SMOKE.lookMs);
    }
    return false;
  };
  /** the page's capture at a point, its three channels summed, averaged over the pixels there */
  const captured = async (x: number, y: number): Promise<number | null> => {
    const image = await win.webContents.capturePage({
      x: Math.round(x) - 1,
      y: Math.round(y) - 1,
      width: 3,
      height: 3,
    });
    const pixels = image.toBitmap();
    const count = Math.floor(pixels.length / 4);
    if (count === 0) return null;
    let sum = 0;
    for (let i = 0; i < count; i += 1)
      sum += (pixels[i * 4] ?? 0) + (pixels[i * 4 + 1] ?? 0) + (pixels[i * 4 + 2] ?? 0);
    return sum / count;
  };
  const shoot = async (name: string): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await win.capturePage()).toPNG());
  };
  const run = "run-at-work-1";
  const own = "run-at-work-spark";
  /** the DOM row loaded the page again with WebGL2 declined: it is loaded back on its own doors after */
  let declined = false;

  try {
    // ── DRAW: the first mark is drawn within two frames, the window's one context its own ─────────────────────────
    const before = await read();
    await mark([rowOf(run, "reading", next())]);
    await js(FRAMES(AT_WORK_SMOKE.drawFrames));
    const after = await read();
    row("DRAW", judgeDraw(before, after));
    say(`SMOKE_CANVAS_AT_WORK_DRAW ${JSON.stringify({ object: target.type, before, after })}`);
    // its light by night: past the stroke's widest wobble the bare mat is lit, and not without the layer
    await theme("dark");
    await mark([rowOf(run, "acting", next())]);
    await sleep(600);
    const zs = Math.min(
      Math.max(target.zoom, AT_WORK_SMOKE.inkScale.least),
      AT_WORK_SMOKE.inkScale.most,
    );
    const out = AT_WORK_SMOKE.glowOutInk * zs;
    const { box } = target;
    const candidates = [
      { x: box.left - out, y: box.top + box.height / 2 },
      { x: box.left + box.width / 2, y: box.top + box.height + out },
      { x: box.left + box.width / 2, y: box.top - out },
    ];
    let point: { x: number; y: number } | null = null;
    for (const at of candidates)
      if (await js<boolean>(BARE_AT(at.x, at.y))) {
        point = at;
        break;
      }
    if (point === null) {
      row("DRAW", ["no bare mat beside the marked object to read its light on"]);
    } else {
      const lit = await captured(point.x, point.y);
      await js(LAYER_SHOWN(false));
      const bare = await captured(point.x, point.y);
      await js(LAYER_SHOWN(true));
      row("DRAW", judgeGlow(lit, bare));
      say(`SMOKE_CANVAS_AT_WORK_LIGHT ${JSON.stringify({ point, lit, bare })}`);
    }
    await shoot("item-550-at-work-night.png");
    await theme(theme0);

    // ── REST (M5): the wind stilled, an open mark settled — nothing moves, nothing draws ─────────────────────────
    // (the store cleared first, so the open row lands as a feed's first does: already at work, never arriving)
    await js(`globalThis.__vfDesk.ambient("still")`);
    await fixture(null);
    await mark([rowOf(run, "open", next())]);
    await sleep(AT_WORK_SMOKE.settleMs);
    if (!(await asleep(10_000))) row("REST", ["the desk never fell asleep after the open mark"]);
    const looks: RestLook[] = [];
    const t0 = Date.now();
    while (Date.now() - t0 < AT_WORK_SMOKE.restMs) {
      looks.push(await look());
      await sleep(AT_WORK_SMOKE.lookMs);
    }
    looks.push(await look());
    row("REST", judgeRest(looks));
    // a reading row: the overlay moves on its own frames, and the desk does not step for it
    const a = await look();
    await mark([rowOf(run, "reading", next())]);
    await sleep(AT_WORK_SMOKE.movingMs);
    const b = await look();
    row("REST", judgeMovingAlone(a, b));
    const rest = {
      looks: looks.length,
      deltas: restDeltas(looks),
      moving: restDeltas([a, b]),
      load: loadavg().map((v) => Number(v.toFixed(1))),
    };
    say(`SMOKE_CANVAS_AT_WORK_REST ${JSON.stringify(rest)}`);

    // ── RING: needs you, on the layer's own timer ─────────────────────────────────────────────────────────────────
    await mark([rowOf(run, "needs-you", next())]);
    await sleep(300);
    const r0 = await look();
    await sleep(AT_WORK_SMOKE.ringMs);
    const r1 = await look();
    row("RING", judgeRing(r0, r1));
    say(`SMOKE_CANVAS_AT_WORK_RING ${JSON.stringify({ deltas: restDeltas([r0, r1]) })}`);

    // ── COVER: nothing drawn under a cover ────────────────────────────────────────────────────────────────────────
    await mark([rowOf(run, "reading", next())]);
    await sleep(300);
    await js(`globalThis.vibefield.view.set("godview")`);
    await js("globalThis.__vfDesk.whenParked(10000)");
    const c0 = await read();
    await sleep(AT_WORK_SMOKE.coverMs);
    const c1 = await read();
    row("COVER", judgeCover(c0, c1));
    await js(`globalThis.vibefield.view.set("canvas")`);
    await sleep(600);

    // ── STAGE: a spark's live star on the desk's stage, let go after the ambient ──────────────────────────────────
    await mark([rowOf(own, "reading", next(), { spark: AT_WORK_SMOKE.spark })]);
    await sleep(300);
    const s0 = await read();
    await sleep(1_000);
    const s1 = await read();
    await mark([rowOf(own, "open", next(), { spark: AT_WORK_SMOKE.spark })]);
    const touched = Date.now();
    await sleep(AT_WORK_SMOKE.ambientMs + AT_WORK_SMOKE.slackMs - (Date.now() - touched));
    const q0 = await read();
    await sleep(AT_WORK_SMOKE.quietMs);
    const q1 = await read();
    row("STAGE", judgeStage({ a: s0, b: s1 }, { a: q0, b: q1 }));
    say(`SMOKE_CANVAS_AT_WORK_STAGE ${JSON.stringify({ reading: [s0, s1], quiet: [q0, q1] })}`);
    // the applier's writes the fixture held back over these rows: said, never judged
    say(`SMOKE_CANVAS_AT_WORK_HELD ${JSON.stringify({ held: (await read()).held - before.held })}`);
    await fixture(null);
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient0)})`);

    // ── DOM: WebGL2 declined, over a drawing desk ─────────────────────────────────────────────────────────────────
    declined = true;
    await d.reload(AT_WORK_DOM_DOORS);
    target = await objectOf();
    await mark([rowOf(run, "reading", next())]);
    await sleep(600);
    const g0 = await read();
    await sleep(1_000);
    const g1 = await read();
    const dom = await js<DomSeen>(READ_DOM);
    row("DOM", judgeDom(dom, g0, g1, 1));
    say(`SMOKE_CANVAS_AT_WORK_DOM ${JSON.stringify({ dom, record: g1.record })}`);
    await shoot("item-550-at-work-dom.png");
  } finally {
    await fixture(null).catch(() => null);
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient0)})`).catch(() => null);
    await theme(theme0).catch(() => undefined);
    // the page back on its own doors, for the rows after these
    if (declined) await d.reload(d.doors);
  }
  return problems;
}

export interface AtWorkGpuLessDriver {
  readonly win: BrowserWindow;
  readonly say: (line: string) => void;
}

/** The GPU-less modes (above): a fixture handed to a desk that does not draw is hidden with it. */
export async function atWorkGpuLessRows(d: AtWorkGpuLessDriver): Promise<string[]> {
  const { win, say } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  // a key the board holds when it has one; the layer places nothing on a desk that does not draw, whatever the key
  const key = (await js<string | null>(ANY_KEY)) ?? "at-work-gpu-less";
  const objects = [{ key, agents: [rowOf("run-at-work-gpu-less", "reading", Date.now())] }];
  const took = await js<boolean | null>(
    `globalThis.__vfDesk?.atWorkFixture?.(${JSON.stringify(objects)}) ?? null`,
  );
  await sleep(1_000);
  const seen = await js<AtWorkSeen | null>("globalThis.__vfDesk?.atWork() ?? null");
  const visible = await js<number>(VISIBLE_LAYERS);
  await js("globalThis.__vfDesk?.atWorkFixture?.(null)").catch(() => null);
  say(`SMOKE_CANVAS_AT_WORK_GPU_LESS ${JSON.stringify({ took, seen, visible })}`);
  if (seen === null) return ["AT WORK GPU-LESS: the page has no desk door to read the layer by"];
  return judgeGpuLess(took, seen, visible).map((p) => `AT WORK GPU-LESS: ${p}`);
}
