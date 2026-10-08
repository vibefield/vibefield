// DK-18 — THE PRODUCT DESK RIG'S MISSING ACTS, IN THE PRODUCT (smoke:canvas; thinking-desk-migration.md §5 Phase 5: "an
// Electron harness that opens a fixture board, places each kind, drags one off the pegboard, holds one, and compares stills
// — the K-H discipline for timing rows"). The census (docs/desk-gates.md) maps the five acts onto the rows that already
// witness them: the fixture board is the first board's seed (SEED, CLOCK, PAD_REOPEN), the hold is the tools in hand (HAND_*),
// the stills are QUARTER, THUMB, the theme's and `pnpm still`'s goldens. Two acts had no row: a pointer TAKE off the pegboard
// (KEYS lays one by ⏎, the tray's own lay), and EACH kind placed by a person's act (the seed lays the six, nobody's hand).
// They are one row family here, TAKE — every kind the board hangs, category by category, taken off it by the pointer:
//   TAKE    — by day, the board raised by the line's create, the category chosen by its segment; a press on the specimen
//             where the last frame drew it (what a press grabs, `pegboard().specimens[].object`), a drag up off the board to a
//             point of the desk where nothing picks (the bare mat, or a surface that takes no press — the whiteboard's), a
//             release there: ONE object more of that type, selected, its box under the release (the
//             selection's anchor — a pick would not do: a calendar's paper picks its day, not itself), the board folded as a
//             take folds it, its kind neither refused nor struck (`status().faults`), its face DRAWN — the release's region
//             captured before the take and after it (`capture({ marks: false })`, the wind stilled so the mat does not move
//             under the comparison): judged by how much of it the object changed and by its colours and contrast, never by a
//             hash (two captures of one scene differ by a pixel or two across remounts); then ⌘Z — one undo step, gone;
//   LANDED  — the K-H discipline's timing row: from the release the page HEARD (its own trusted `pointerup`) to the first frame
//             whose census holds the object, read in ONE evaluate per frame; a budget on the MINIMUM over the kinds (load only
//             ever adds time), the median and the host's load beside it; a red minimum measured again ONCE, and red only if the
//             second witness is red too (K-H D-KH.3). No bound is raised to make it pass.
// The stills: dk-18-take-<type>.png (the release's region with the object on it).

import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

/** The row's numbers. */
export const TAKE = {
  /** release → the object in the census: the budget on the minimum over the kinds (a take commits at its release) */
  landBudgetMs: 250,
  /** the release's region, CSS px a side, centred on the release */
  region: 160,
  /** the share of the region's px the object must change to be drawn there */
  minChanged: 0.04,
  /** the distinct colours (5 bits a channel) the drawn region must hold — a face, not a flat fill (the mini mat, itself a
   * mat, holds the fewest: 13 by night in DK-18's probe) */
  minColors: 8,
  /** the luma range (0–255) the drawn region must span — a face with contrast (the mini mat: 30 by night) */
  minLumaRange: 16,
  /** how far a press must travel off the board before it is a take: the drag's steps, CSS px apart at most */
  steps: 12,
  /** the release waits this long after the drag's last move (the board's hand-off slides it away) */
  handOffMs: 350,
  /** after the release, the take settles before its region is captured */
  settleMs: 700,
} as const;

/** One take as the row saw it. */
export interface TakeSeen {
  readonly type: string;
  readonly category: string;
  /** the census of the type before the take, after the release, after ⌘Z */
  readonly counts: { readonly before: number; readonly after: number; readonly undone: number };
  /** the selection once it landed: how many, and whether its box holds the release */
  readonly selected: { readonly count: number; readonly under: boolean };
  /** what the desk's pick names under the release (printed: a calendar's paper picks its day) */
  readonly picked: string | null;
  /** the kind refused or struck — `status().faults` naming the type */
  readonly faulted: boolean;
  /** the board folded after the take */
  readonly folded: boolean;
  /** the region: px it holds, px the object changed, its distinct colours, its luma range — null when no capture answered */
  readonly face: {
    readonly px: number;
    readonly changed: number;
    readonly colors: number;
    readonly lumaRange: number;
  } | null;
  /** release → the object counted, ms (the page's own clock), or null if never seen */
  readonly landedMs: number | null;
}

/** TAKE: one object more of the type, under the release, the board folded, the face drawn, one undo step back. */
export function judgeTake(seen: TakeSeen): string[] {
  const problems: string[] = [];
  const { before, after, undone } = seen.counts;
  if (after !== before + 1)
    problems.push(`${seen.type}: the take laid ${after - before}, not one (${before} → ${after})`);
  if (seen.selected.count !== 1 || !seen.selected.under)
    problems.push(
      `${seen.type}: the take is not the one selection under the release (${JSON.stringify(seen.selected)})`,
    );
  if (seen.faulted)
    problems.push(`${seen.type}: its kind is refused or struck — not drawn as itself`);
  if (!seen.folded) problems.push(`${seen.type}: the board stayed out after the take`);
  if (seen.face === null) problems.push(`${seen.type}: no capture answered for its face`);
  else {
    const share = seen.face.changed / Math.max(1, seen.face.px);
    if (share < TAKE.minChanged)
      problems.push(
        `${seen.type}: the face changed ${(share * 100).toFixed(1)} % of the release's region — not drawn there (≥ ${TAKE.minChanged * 100} %)`,
      );
    if (seen.face.colors < TAKE.minColors || seen.face.lumaRange < TAKE.minLumaRange)
      problems.push(
        `${seen.type}: the face is flat — ${seen.face.colors} colours over a luma range of ${seen.face.lumaRange} (≥ ${TAKE.minColors}, ≥ ${TAKE.minLumaRange})`,
      );
  }
  if (undone !== before)
    problems.push(`${seen.type}: ⌘Z did not take the take back in one step (${after} → ${undone})`);
  return problems;
}

/** LANDED (K-H): the minimum over the takes within the budget — load only ever adds time; the median and the spread printed. */
export function judgeLanded(samples: readonly (number | null)[]): {
  readonly min: number | null;
  readonly median: number | null;
  readonly max: number | null;
  readonly n: number;
  readonly problems: string[];
} {
  const xs = samples.filter((x): x is number => x !== null).sort((a, b) => a - b);
  const n = xs.length;
  const min = n === 0 ? null : (xs[0] as number);
  const max = n === 0 ? null : (xs[n - 1] as number);
  const median = n === 0 ? null : (xs[Math.floor(n / 2)] as number);
  const problems: string[] = [];
  if (n < 5) problems.push(`LANDED: ${n} takes timed — the minimum needs five`);
  else if (min !== null && min > TAKE.landBudgetMs)
    problems.push(
      `LANDED: the fastest take landed ${min.toFixed(0)} ms after its release, over the budget's ${TAKE.landBudgetMs}`,
    );
  return { min, median, max, n, problems };
}

export interface DeskRigDriver {
  readonly win: BrowserWindow;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface BoardNow {
  readonly open: boolean;
  readonly p: number;
  readonly category: string;
  readonly categories: readonly { readonly id: string; readonly label: string }[];
  readonly specimens: readonly { readonly type: string; readonly object: Rect }[];
  /** the desk container's place in the window (the door's rects are the desk's own CSS px) */
  readonly desk: { readonly left: number; readonly top: number };
}

const READ_BOARD = `(() => {
  const b = globalThis.__vfDesk.pegboard();
  const el = document.querySelector("[data-desk]")?.getBoundingClientRect();
  return b === null ? null : {
    open: b.anchor.open,
    p: b.anchor.drawer?.p ?? 0,
    category: b.anchor.category,
    categories: b.anchor.categories.map((c) => ({ id: c.id, label: c.label })),
    specimens: b.specimens.map((s) => ({ type: s.type, object: s.object })),
    desk: { left: el?.left ?? 0, top: el?.top ?? 0 },
  };
})()`;

/** A release point in the board's upper half where nothing picks — not there nor anywhere in the region around it, the desk's
 * own element under it, the whole region inside the view — in the desk's CSS px; null when the board's upper half has none. */
const BARE_DROP = (region: number): string => `(() => {
  const d = globalThis.__vfDesk; const el = document.querySelector("[data-desk]");
  const r = el.getBoundingClientRect();
  const half = ${region} / 2;
  for (let y = 120 + half; y < r.height / 2; y += 20) for (let x = half + 40; x < r.width - half - 40; x += 20) {
    let clear = true;
    for (let dy = -half; dy <= half && clear; dy += 20) for (let dx = -half; dx <= half && clear; dx += 20)
      if (d.pick({ x: x + dx, y: y + dy }) !== null) clear = false;
    if (!clear) continue;
    const under = document.elementFromPoint(r.left + x, r.top + y);
    if (under !== null && el.contains(under)) return { x, y };
  }
  return null;
})()`;

/** The page-side witness of one take, armed before the release: the page's own `pointerup` heard (trusted), then every frame
 * the census of the type, read in ONE evaluate (K-H FRAMES) — until it grows or 3 s pass. */
const ARM_LANDED = (type: string, before: number): string => `(() => {
  const g = globalThis;
  const rec = { up: null, landed: null };
  g.__vfTakeRec = rec;
  const onUp = (e) => { if (e.isTrusted && rec.up === null) rec.up = performance.now(); };
  window.addEventListener("pointerup", onUp, { capture: true });
  const t0 = performance.now();
  const step = () => {
    const now = performance.now();
    if (rec.up !== null && rec.landed === null && (g.__vfDesk?.census()?.[${JSON.stringify(type)}] ?? 0) > ${before}) rec.landed = now;
    if (rec.landed === null && now - t0 < 3000) requestAnimationFrame(step);
    else window.removeEventListener("pointerup", onUp, { capture: true });
  };
  requestAnimationFrame(step);
  return true;
})()`;

/** The release's region before the take — a bitmap kept in the page (a bitmap never crosses `executeJavaScript`). */
const KEEP_BEFORE = (rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string => `(async () => {
  globalThis.__vfTakeBefore?.close?.();
  globalThis.__vfTakeBefore = await globalThis.__vfDesk.capture({ rect: ${JSON.stringify(rect)}, marks: false });
  return globalThis.__vfTakeBefore !== undefined;
})()`;

/** The region after the take against the one before: px changed (a channel off by more than 24), distinct colours (5 bits a
 * channel), luma range — read in the renderer. */
const FACE_AFTER = (rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string => `(async () => {
  const before = globalThis.__vfTakeBefore;
  const after = await globalThis.__vfDesk.capture({ rect: ${JSON.stringify(rect)}, marks: false });
  if (before === undefined || after === undefined) { after?.close(); return null; }
  const w = after.width, h = after.height;
  const read = (src) => { const c = new OffscreenCanvas(w, h); const x = c.getContext("2d"); x.drawImage(src, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
  const a = read(before), b = read(after);
  after.close(); before.close(); globalThis.__vfTakeBefore = undefined;
  let changed = 0; const colors = new Set(); let lo = 255, hi = 0;
  for (let i = 0; i < b.length; i += 4) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) changed += 1;
    colors.add(((b[i] >> 3) << 10) | ((b[i + 1] >> 3) << 5) | (b[i + 2] >> 3));
    const l = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
    if (l < lo) lo = l; if (l > hi) hi = l;
  }
  return { px: w * h, changed, colors: colors.size, lumaRange: Math.round(hi - lo) };
})()`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** DK-18's TAKE rows (above). Returns the problems, each in words. */
export async function deskRigRows(d: DeskRigDriver): Promise<string[]> {
  const { win, say } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const until = async (label: string, timeoutMs: number, expression: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await js<unknown>(expression)) === true) return;
      await sleep(60);
    }
    throw new Error(`${label} did not happen within ${timeoutMs}ms`);
  };
  const board = async (): Promise<BoardNow> => {
    const b = await js<BoardNow | null>(READ_BOARD);
    if (b === null) throw new Error("the desk has no pegboard door");
    return b;
  };
  const census = (): Promise<Record<string, number>> => js("globalThis.__vfDesk.census()");
  const move = (x: number, y: number): void =>
    win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x), y: Math.round(y) });
  const press = async (at: { x: number; y: number }): Promise<void> => {
    move(at.x, at.y);
    await sleep(40);
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: at.x,
      y: at.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(50);
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: at.x,
      y: at.y,
      button: "left",
      clickCount: 1,
    });
  };
  const pressSelector = async (selector: string): Promise<void> => {
    const at = await js<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (at === null) throw new Error(`no ${selector} to press`);
    await press(at);
  };
  const key = async (keyCode: string, modifiers: ("meta" | "control")[] = []): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await sleep(80);
  };
  const raise = async (category: string): Promise<BoardNow> => {
    if (!(await board()).open) {
      await pressSelector(".vf-line-create");
      await until("the board out", 5_000, "globalThis.__vfDesk.pegboard()?.anchor.open === true");
    }
    if ((await board()).category !== category) {
      await pressSelector(`.vf-pegboard-track button[data-id="${category}"]`);
      await until(
        `the board on ${category}`,
        5_000,
        `globalThis.__vfDesk.pegboard()?.anchor.category === ${JSON.stringify(category)}`,
      );
    }
    await until(
      "the board's slide done",
      5_000,
      `(() => { const b = globalThis.__vfDesk.pegboard(); return b !== null && b.anchor.open && (b.anchor.drawer?.p ?? 0) >= 0.999; })()`,
    );
    await sleep(350);
    return board();
  };
  const shoot = async (name: string, rect: Rect): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    const image = await win.capturePage({
      x: Math.max(0, Math.floor(rect.x0)),
      y: Math.max(0, Math.floor(rect.y0)),
      width: Math.ceil(rect.x1 - rect.x0),
      height: Math.ceil(rect.y1 - rect.y0),
    });
    writeFileSync(join(d.shotDir, name), image.toPNG());
  };

  /** One pass: every kind the board hangs, category by category, taken off it — each judged, each undone. */
  const pass = async (): Promise<TakeSeen[]> => {
    const seen: TakeSeen[] = [];
    const taken = new Set<string>();
    const categories = (await raise((await board()).category)).categories;
    for (const category of categories) {
      for (;;) {
        const now = await raise(category.id);
        const specimen = now.specimens.find((s) => !taken.has(s.type));
        if (specimen === undefined) break;
        taken.add(specimen.type);
        // the release: a point where nothing picks, found with the board shut (its pick answers nothing under the board)
        await key("Escape");
        await until(
          "the board shut",
          5_000,
          "globalThis.__vfDesk.pegboard()?.anchor.open === false",
        );
        await sleep(300);
        const drop = await js<{ x: number; y: number } | null>(BARE_DROP(TAKE.region));
        if (drop === null)
          throw new Error("no point where nothing picks in the board's upper half to drop on");
        const half = TAKE.region / 2;
        const rect = {
          x: drop.x - half,
          y: drop.y - half,
          width: TAKE.region,
          height: TAKE.region,
        };
        if (!(await js<boolean>(KEEP_BEFORE(rect))))
          throw new Error("the capture door answered nothing before the take");
        const before = (await census())[specimen.type] ?? 0;
        const at = await raise(category.id);
        const hung = at.specimens.find((s) => s.type === specimen.type);
        if (hung === undefined) throw new Error(`${specimen.type} left the board`);
        const from = {
          x: at.desk.left + (hung.object.x0 + hung.object.x1) / 2,
          y: at.desk.top + (hung.object.y0 + hung.object.y1) / 2,
        };
        const to = { x: at.desk.left + drop.x, y: at.desk.top + drop.y };
        // THE TAKE: pressed where the specimen is drawn, dragged up off the board, released where nothing picks
        move(from.x, from.y);
        await sleep(40);
        win.webContents.sendInputEvent({
          type: "mouseDown",
          x: Math.round(from.x),
          y: Math.round(from.y),
          button: "left",
          clickCount: 1,
        });
        for (let i = 1; i <= TAKE.steps; i += 1) {
          await sleep(16);
          move(
            from.x + ((to.x - from.x) * i) / TAKE.steps,
            from.y + ((to.y - from.y) * i) / TAKE.steps,
          );
        }
        await sleep(TAKE.handOffMs);
        await js(ARM_LANDED(specimen.type, before));
        win.webContents.sendInputEvent({
          type: "mouseUp",
          x: Math.round(to.x),
          y: Math.round(to.y),
          button: "left",
          clickCount: 1,
        });
        let after = before;
        const deadline = Date.now() + 5_000;
        while (after === before && Date.now() < deadline) {
          await sleep(60);
          after = (await census())[specimen.type] ?? 0;
        }
        await sleep(TAKE.settleMs);
        const landed = await js<{ up: number | null; landed: number | null }>(
          "globalThis.__vfTakeRec",
        );
        const picked =
          (await js<{ type: string } | null>(`globalThis.__vfDesk.pick(${JSON.stringify(drop)})`))
            ?.type ?? null;
        const selected = await js<{ count: number; under: boolean }>(`(() => {
          const a = globalThis.__vfDesk.anchor();
          const b = a?.box ?? null;
          const at = ${JSON.stringify(drop)};
          return { count: a?.count ?? 0, under: b !== null && b.x0 <= at.x && at.x <= b.x1 && b.y0 <= at.y && at.y <= b.y1 };
        })()`);
        const faulted = await js<boolean>(
          `(globalThis.__vfDesk.status().faults ?? []).some((f) => f.kind === ${JSON.stringify(specimen.type)})`,
        );
        const folded = !(await board()).open;
        const face = await js<TakeSeen["face"]>(FACE_AFTER(rect));
        await shoot(`dk-18-take-${specimen.type}.png`, {
          x0: to.x - half,
          y0: to.y - half,
          x1: to.x + half,
          y1: to.y + half,
        });
        // one undo step takes it back
        await key("z", [process.platform === "darwin" ? "meta" : "control"]);
        await sleep(400);
        const undone = (await census())[specimen.type] ?? 0;
        await key("Escape");
        seen.push({
          type: specimen.type,
          category: category.id,
          counts: { before, after, undone },
          selected,
          picked,
          faulted,
          folded,
          face,
          landedMs:
            landed.up === null || landed.landed === null
              ? null
              : Math.round((landed.landed - landed.up) * 10) / 10,
        });
      }
    }
    return seen;
  };

  const problems: string[] = [];
  const ambient = await js<string>("globalThis.__vfDesk.ambient()");
  const themeWas = await js<string>("globalThis.__vfDesk.theme()");
  // by day (a note's paper by night is near the night mat's own grey), the wind stilled (the mat must not move under the
  // before/after comparison)
  await js(`globalThis.vibefield.theme.set("light")`);
  await until("the desk dressed light", 10_000, `globalThis.__vfDesk.theme() === "light"`);
  await sleep(600);
  await js(`globalThis.__vfDesk.ambient("still")`);
  try {
    const first = await pass();
    for (const take of first) problems.push(...judgeTake(take).map((p) => `TAKE: ${p}`));
    say(`SMOKE_CANVAS_TAKE ${JSON.stringify(first)}`);
    let landed = judgeLanded(first.map((t) => t.landedMs));
    const witnesses = [landed];
    if (landed.problems.length > 0) {
      // K-H's second witness: a burst fails one, a regression fails both
      const second = await pass();
      landed = judgeLanded(second.map((t) => t.landedMs));
      witnesses.push(landed);
    }
    problems.push(...landed.problems);
    say(
      `SMOKE_CANVAS_TAKE_LANDED ${JSON.stringify({ budgetMs: TAKE.landBudgetMs, witnesses: witnesses.map(({ min, median, max, n }) => ({ min, median, max, n })), load: loadavg().map((v) => Number(v.toFixed(1))) })}`,
    );
    if (first.length === 0) problems.push("TAKE: the board hung nothing to take");
  } finally {
    // the board as it was found: All (`""`), folded; the wind as it was
    try {
      await raise("");
      await key("Escape");
    } catch {
      /* a row that cannot go on ends the rows, never what the earlier rows found */
    }
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient)})`);
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(themeWas)})`);
  }
  return problems;
}
