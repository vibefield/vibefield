// DK-11 — THE SELECTION BAR, ITS MENU, RIGHT-CLICK AND THE STATUS LINE, IN THE PRODUCT (smoke:canvas; DESIGN.md §8 "The
// selection bar", "The bar grown — More, and right-click", "The status line", "The missing face"; R5–R12, R24, R26).
//
// Driven by the desk's own input — a primary tap selects, ⇧ adds, a secondary press is a point the desk never acts
// on (ICE I28) that VibeField's `contextmenu` listener turns into its menu — over the first board at its arrival fit,
// each row read back off the DOM the chrome drew and off the desk's door (`window.__vfDesk`: the anchor it published,
// the bar's counters, the status line's said notices):
//   ONE      — the clock selected: the bar over its brackets (centred, its foot 10 above them, or 10 below under the
//              safe top; 16 from the sides; 40 tall), in the canon's order with the clock's own act drawn by the bar's
//              ONE path renderer and no key printed for it; "Tape it down  ⇧⌘L" and "Copy  ⌘C" printed (R23
//              reversed; HN-D3);
//   TWO      — ⇧ and the note: one Copy for both (never counted), and More grows "Clean up" under "2 OBJECTS";
//   TAPED    — the note taped from the bar: "Lift the tape" wearing `lift`, no Duplicate; lifted again;
//   MENU     — More on the note: the grown menu nearest first under "NOTE", at least 244 wide, inside 94…the line's
//              reserve, the bar's own row unmoved; Esc folds it;
//   RIGHT    — the notebook right-clicked, unselected: selected FIRST by the desk's pick, then the same menu grown;
//   MISSING  — the example clock's plugin turned off: the desk remounts, the status line says "Clock · plugin off" ONCE,
//              the clock's missing face selected names its type and word where its act stood, Duplicate offered; on
//              again, drawn;
//   COUNTERS — the bar's placements ≤ the anchor's publishes; its renders a handful (never a render per frame).
// The stills: dk-11-bar-{light,dark}.png, dk-11-menu-{light,dark}.png, dk-11-missing.png.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

/** The example plugin's clock: its plugin id and its type are one (DK-6 input (b)). */
export const BAR_CLOCK = "vibefield.example.desk-clock";
/** The clock's act in the selection menu (examples/plugins/desk-clock `CLOCK_SECONDS_ACT`). */
export const BAR_CLOCK_ACT = "desk-clock.seconds";

/** A rect on screen, CSS px (window coordinates — the desk's view is the window). */
export interface ScreenRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** What the desk published (`handle.selection.anchor()`), as the door reads it. */
export interface DoorAnchor {
  readonly box: ScreenRect | null;
  readonly count: number;
  readonly locked: boolean;
  readonly view: { readonly width: number; readonly height: number };
}

/** The bar as the DOM shows it. */
export interface BarSeen {
  readonly shown: boolean;
  readonly open: boolean;
  /** the bar's own row (the 40 tall glass), window CSS px */
  readonly row: ScreenRect | null;
  /** the grown element (the solid), when open */
  readonly panel: ScreenRect | null;
  readonly dir: string | null;
  /** the cells in order: their acts, `|` for a rule, `words:<label>` for a missing face's words */
  readonly cells: readonly string[];
  /** the Copy pill's word (HN-D3) */
  readonly copy: string | null;
  readonly tips: Readonly<Record<string, string>>;
  /** each kind act's drawn glyph (`data-glyph`) */
  readonly glyphs: Readonly<Record<string, string | null>>;
  /** the menu's rows, nearest first, and its eyebrow */
  readonly rows: readonly string[];
  readonly eyebrow: string | null;
}

/** The bar's counters (`__vfDesk.bar()`). */
export interface BarCounters {
  readonly publishes: number;
  readonly placements: number;
  readonly renders: number;
}

/** The numbers the canon places the bar by (DESIGN.md §8 "The selection bar" — Place; §10) — restated, as field-app's
 * `BAR` (`field/desk/bar/bar-geometry.ts`) holds them, because the shell imports no field-app. */
const PLACE = {
  above: 10,
  height: 40,
  safeTop: 94,
  /** kept from each side: 16 since the edges left (HN-8) — the notch's 26 + 16 until then */
  sides: 16,
  lowest: 120,
  foot: 80,
  minWidth: 244,
} as const;
const near = (a: number, b: number, eps = 1.5): boolean => Math.abs(a - b) <= eps;

/**
 * Is the bar where the canon puts it over this anchor? Centred over the brackets (or held 16 from a side), its foot
 * 10 above them — or its top 10 below them, at least 94, when above would cross the safe top — its top never below
 * the window's foot less 120, 40 tall. Returns what is wrong, in words.
 */
export function judgeBarPlace(anchor: DoorAnchor, row: ScreenRect | null): string[] {
  const box = anchor.box;
  if (box === null) return ["the desk published no box for the selection"];
  if (row === null) return ["no bar was drawn over the selection"];
  const problems: string[] = [];
  const { width: W, height: H } = anchor.view;
  const w = row.x1 - row.x0;
  if (!near(row.y1 - row.y0, PLACE.height))
    problems.push(`the bar is ${row.y1 - row.y0} tall, not 40`);
  const centred = (box.x0 + box.x1) / 2 - w / 2;
  const x = Math.min(Math.max(centred, PLACE.sides), W - PLACE.sides - w);
  if (!near(row.x0, x))
    problems.push(`the bar's left is ${row.x0}, not ${x} (centred, 16 from the sides)`);
  const above = box.y0 - PLACE.above - PLACE.height;
  const lowest = H - PLACE.lowest;
  const y = Math.min(
    above >= PLACE.safeTop ? above : Math.max(box.y1 + PLACE.above, PLACE.safeTop),
    lowest,
  );
  if (!near(row.y0, y))
    problems.push(`the bar's top is ${row.y0}, not ${y} (its foot 10 off the brackets)`);
  if (row.y0 < PLACE.safeTop - 0.5)
    problems.push(`the bar's top ${row.y0} crosses the safe top (94)`);
  return problems;
}

/** Is the grown menu where the canon grows it from this bar? ≥ 244 wide (the bar's when wider), 16 from the sides,
 * inside the safe top and the line's reserve, and the bar's own row where it stood. */
export function judgeMenuPlace(
  view: { readonly width: number; readonly height: number },
  rowBefore: ScreenRect,
  seen: BarSeen,
): string[] {
  const problems: string[] = [];
  const { panel, row } = seen;
  if (!seen.open || panel === null) return ["the bar did not grow into its menu"];
  if (row === null || !near(row.x0, rowBefore.x0, 0.5) || !near(row.y0, rowBefore.y0, 0.5))
    problems.push(`the bar's own row moved as it grew (${JSON.stringify({ rowBefore, row })})`);
  const width = panel.x1 - panel.x0;
  const barWidth = rowBefore.x1 - rowBefore.x0;
  if (!near(width, Math.max(PLACE.minWidth, barWidth)))
    problems.push(`the menu is ${width} wide, not ${Math.max(PLACE.minWidth, barWidth)}`);
  if (panel.x0 < PLACE.sides - 0.5 || panel.x1 > view.width - PLACE.sides + 0.5)
    problems.push(`the menu leaves the 16 at the sides (${panel.x0}…${panel.x1})`);
  if (panel.y0 < PLACE.safeTop - 0.5)
    problems.push(`the menu's top ${panel.y0} crosses the safe top (94)`);
  if (panel.y1 > view.height - PLACE.foot + 0.5)
    problems.push(
      `the menu's foot ${panel.y1} is over the line's reserve (${view.height - PLACE.foot})`,
    );
  return problems;
}

/** The counters' witness: placements ≤ the anchor's publishes over the rows; renders few. */
export function judgeCounters(before: BarCounters, after: BarCounters): string[] {
  const publishes = after.publishes - before.publishes;
  const placements = after.placements - before.placements;
  return placements <= publishes
    ? []
    : [
        `the bar was placed ${placements} times for ${publishes} publishes — a placement without a publish`,
      ];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The bar's DOM, read whole. */
const READ_BAR = `(() => {
  const bar = document.querySelector("[data-selection-bar]");
  if (bar === null) return null;
  const rect = (el) => { if (el === null) return null; const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; };
  const cells = [...bar.querySelectorAll(".vf-bar-row > *")].map((el) =>
    el.classList.contains("vf-bar-rule") ? "|" : el.hasAttribute("data-bar-words") ? "words:" + el.textContent : el.getAttribute("data-act"));
  const tips = {}, glyphs = {};
  for (const el of bar.querySelectorAll(".vf-bar-row [data-act]")) {
    tips[el.getAttribute("data-act")] = el.getAttribute("title") ?? "";
    if (el.getAttribute("data-act").startsWith("act:")) glyphs[el.getAttribute("data-act")] = el.querySelector("[data-glyph]")?.getAttribute("data-glyph") ?? null;
  }
  const open = bar.hasAttribute("data-open");
  return {
    shown: bar.getAttribute("data-shown") === "true",
    open,
    row: rect(bar.querySelector(".vf-bar-row")),
    panel: open ? rect(bar.querySelector(".vf-bar-panel")) : null,
    dir: bar.getAttribute("data-dir"),
    cells,
    copy: bar.querySelector('[data-act="copy"]')?.textContent ?? null,
    tips,
    glyphs,
    rows: [...bar.querySelectorAll(".vf-bar-list [data-row]")].map((el) => el.getAttribute("data-row")),
    eyebrow: bar.querySelector(".vf-bar-eye")?.textContent ?? null,
  };
})()`;

const ANCHOR = "globalThis.__vfDesk?.anchor() ?? null";

/** One object type's box on the drawn frame — the desk's own pick every 8 CSS px of the view. */
const BOX_OF = (type: string): string => `(() => {
  const d = globalThis.__vfDesk;
  const el = document.querySelector("[data-desk]");
  if (d === undefined || el === null) return null;
  const r = el.getBoundingClientRect();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 4; y < r.height; y += 8)
    for (let x = 4; x < r.width; x += 8) {
      const hit = d.pick({ x, y });
      if (hit === null || hit.type !== ${JSON.stringify(type)}) continue;
      x0 = Math.min(x0, r.left + x); y0 = Math.min(y0, r.top + y); x1 = Math.max(x1, r.left + x); y1 = Math.max(y1, r.top + y);
    }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
})()`;

/** A point of an object's box the desk's own element receives (no chrome over it), nearest its centre. */
export const POINT_IN = (type: string): string => `(() => {
  const d = globalThis.__vfDesk;
  const el = document.querySelector("[data-desk]");
  if (d === undefined || el === null) return null;
  const r = el.getBoundingClientRect();
  let best = null, bestD = Infinity, sx = 0, sy = 0, n = 0;
  const hits = [];
  for (let y = 4; y < r.height; y += 8)
    for (let x = 4; x < r.width; x += 8) {
      const hit = d.pick({ x, y });
      if (hit === null || hit.type !== ${JSON.stringify(type)} || hit.part !== "") continue;
      hits.push([x, y]); sx += x; sy += y; n += 1;
    }
  if (n === 0) return null;
  const cx = sx / n, cy = sy / n;
  for (const [x, y] of hits) {
    const under = document.elementFromPoint(r.left + x, r.top + y);
    if (under === null || !el.contains(under)) continue;
    const dd = Math.hypot(x - cx, y - cy);
    if (dd < bestD) { bestD = dd; best = { x: r.left + x, y: r.top + y }; }
  }
  return best;
})()`;

export interface BarRowsDriver {
  readonly win: BrowserWindow;
  /** fieldd's plugins door. */
  readonly plugins: {
    disable(id: string): Promise<unknown>;
    enable(id: string): Promise<unknown>;
  };
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

/** DK-11's rows (above). Returns the problems, each in words. */
export async function selectionBarRows(d: BarRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const until = async (label: string, timeoutMs: number, expression: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await js<unknown>(expression)) === true) return;
      await sleep(80);
    }
    throw new Error(
      `${label} did not happen within ${timeoutMs}ms (bar ${JSON.stringify(await js(READ_BAR))})`,
    );
  };
  const bar = (): Promise<BarSeen> => js<BarSeen>(READ_BAR);
  const point = async (type: string): Promise<{ x: number; y: number }> => {
    const p = await js<{ x: number; y: number } | null>(POINT_IN(type));
    if (p === null) throw new Error(`${type} was not picked where the desk receives a press`);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };
  const press = async (
    at: { x: number; y: number },
    button: "left" | "right" = "left",
    modifiers: "shift"[] = [],
  ): Promise<void> => {
    win.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
    await sleep(40);
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: at.x,
      y: at.y,
      button,
      clickCount: 1,
      modifiers,
    });
    await sleep(50);
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: at.x,
      y: at.y,
      button,
      clickCount: 1,
      modifiers,
    });
  };
  const key = async (keyCode: string): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
    await sleep(60);
  };
  /**
   * An object of `type` selected by a tap where the desk receives it. A note tapped on its body is being WRITTEN (the
   * desk's one editor leased to its text part) — the bar steps aside while a note is written (R8) — so the writing is
   * let go with Escape, the note still selected, and the bar comes back.
   */
  const select = async (type: string, modifiers: "shift"[] = []): Promise<void> => {
    await press(await point(type), "left", modifiers);
    await sleep(300);
    if (await js<boolean>(`document.activeElement?.hasAttribute("data-desk-editor") === true`)) {
      await key("Escape");
      await until(
        "the note's writing let go",
        5_000,
        `document.activeElement?.hasAttribute("data-desk-editor") !== true`,
      );
    }
  };
  /** A cell of the bar pressed where it stands. */
  const pressCell = async (act: string): Promise<void> => {
    const at = await js<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector('[data-selection-bar] .vf-bar-row [data-act="${act}"]');
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (at === null) throw new Error(`the bar has no ${act} cell`);
    await press(at);
  };
  const settled = async (label: string, expression: string): Promise<BarSeen> => {
    await until(label, 10_000, expression);
    await sleep(450); // the bar's fade (180 ms) and a grow (600 ms) mostly done; the rows' stagger past
    return bar();
  };
  const theme = async (name: "light" | "dark"): Promise<void> => {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    await until(
      `the desk dressed ${name}`,
      10_000,
      `globalThis.__vfDesk.theme() === ${JSON.stringify(name)}`,
    );
    await sleep(500);
  };
  const shoot = async (name: string, rect?: ScreenRect): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    const view = await js<{ w: number; h: number }>("({ w: innerWidth, h: innerHeight })");
    const crop =
      rect === undefined
        ? undefined
        : {
            x: Math.max(0, Math.floor(rect.x0)),
            y: Math.max(0, Math.floor(rect.y0)),
            width: Math.ceil(Math.min(view.w, rect.x1) - Math.max(0, rect.x0)),
            height: Math.ceil(Math.min(view.h, rect.y1) - Math.max(0, rect.y0)),
          };
    const image = crop === undefined ? await win.capturePage() : await win.capturePage(crop);
    writeFileSync(join(d.shotDir, name), image.toPNG());
  };
  const union = (a: ScreenRect, b: ScreenRect, m: number): ScreenRect => ({
    x0: Math.min(a.x0, b.x0) - m,
    y0: Math.min(a.y0, b.y0) - m,
    x1: Math.max(a.x1, b.x1) + m,
    y1: Math.max(a.y1, b.y1) + m,
  });
  const deselect = async (): Promise<void> => {
    await key("Escape");
    await key("Escape");
    await js("globalThis.__vfDesk.anchor()?.count ?? 0").then(async (count) => {
      if (count === 0) return;
      // a press on the bare mat clears what Escape left
      const mat = await js<{ x: number; y: number } | null>(`(() => {
        const d = globalThis.__vfDesk; const el = document.querySelector("[data-desk]");
        const r = el.getBoundingClientRect();
        for (let y = 140; y < r.height - 140; y += 24) for (let x = 80; x < r.width - 80; x += 24) {
          if (d.pick({ x, y }) !== null) continue;
          const under = document.elementFromPoint(r.left + x, r.top + y);
          if (under !== null && el.contains(under)) return { x: r.left + x, y: r.top + y };
        }
        return null;
      })()`);
      if (mat !== null) await press(mat);
    });
    await until("nothing selected", 5_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 0");
  };

  const problems: string[] = [];
  const counters0 = await js<BarCounters>("globalThis.__vfDesk.bar()");
  await theme("light");
  await deselect();

  // ── ONE: the clock — its own act drawn by the bar's one path renderer ────────────────────────────────────────
  await select(BAR_CLOCK);
  const one = await settled(
    "the bar over the clock",
    `(() => { const b = ${READ_BAR}; return b !== null && b.shown && b.cells.includes("act:${BAR_CLOCK_ACT}"); })()`,
  );
  const oneAnchor = await js<DoorAnchor>(ANCHOR);
  const oneOrder = [
    "copy",
    "|",
    `act:${BAR_CLOCK_ACT}`,
    "duplicate",
    "tape",
    "more",
    "|",
    "delete",
  ];
  problems.push(...judgeBarPlace(oneAnchor, one.row).map((p) => `ONE: ${p}`));
  if (JSON.stringify(one.cells) !== JSON.stringify(oneOrder))
    problems.push(
      `ONE: the bar's cells were ${JSON.stringify(one.cells)}, not ${JSON.stringify(oneOrder)}`,
    );
  if (one.copy !== "Copy") problems.push(`ONE: Copy read ${JSON.stringify(one.copy)}`);
  if (one.tips["copy"] !== "Copy  ⌘C")
    problems.push(`ONE: Copy's tip read ${JSON.stringify(one.tips["copy"])}`);
  if (one.glyphs[`act:${BAR_CLOCK_ACT}`] !== "kind")
    problems.push(
      `ONE: the clock's act was not drawn by the bar's path renderer (${JSON.stringify(one.glyphs)})`,
    );
  if (one.tips[`act:${BAR_CLOCK_ACT}`] !== "Seconds hand")
    problems.push(
      `ONE: the clock's act printed ${JSON.stringify(one.tips[`act:${BAR_CLOCK_ACT}`])} — a kind's act prints no key (R1)`,
    );
  if (one.tips["tape"] !== "Tape it down  ⇧⌘L")
    problems.push(`ONE: the tape's tip read ${JSON.stringify(one.tips["tape"])}`);
  say(
    `SMOKE_CANVAS_BAR_ONE ${JSON.stringify({ anchor: oneAnchor, row: one.row, cells: one.cells, tips: one.tips, glyphs: one.glyphs })}`,
  );
  if (oneAnchor.box !== null && one.row !== null) {
    const frame = union(oneAnchor.box, one.row, 48);
    await shoot("dk-11-bar-light.png", frame);
    await theme("dark");
    await shoot("dk-11-bar-dark.png", frame);
    await theme("light");
  }

  // ── TWO: ⇧ and the note — one Copy for both, and More grows Clean up under "2 OBJECTS" ────────────────────
  await select("desk.note", ["shift"]);
  const two = await settled(
    "the bar over two",
    `(() => { const b = ${READ_BAR}; return b !== null && b.shown && b.copy === "Copy" && globalThis.__vfDesk.anchor()?.count === 2; })()`,
  );
  await pressCell("more");
  const twoMenu = await settled(
    "the menu for two",
    `(() => { const b = ${READ_BAR}; return b !== null && b.open && b.rows.includes("cleanup"); })()`,
  );
  if (twoMenu.eyebrow !== "2 OBJECTS")
    problems.push(`TWO: the eyebrow read ${JSON.stringify(twoMenu.eyebrow)}`);
  say(
    `SMOKE_CANVAS_BAR_TWO ${JSON.stringify({ copy: two.copy, rows: twoMenu.rows, eyebrow: twoMenu.eyebrow })}`,
  );
  await key("Escape");
  await until(
    "the menu folded by Esc",
    5_000,
    `(() => { const b = ${READ_BAR}; return b !== null && !b.open; })()`,
  );
  await deselect();

  // ── TAPED: the note taped from the bar — Lift the tape, no Duplicate — then lifted ──────────────────────────
  await select("desk.note");
  await settled(
    "the bar over the note",
    `(() => { const b = ${READ_BAR}; return b !== null && b.shown && b.cells.includes("duplicate"); })()`,
  );
  await pressCell("tape");
  const taped = await settled(
    "the bar over the taped note",
    `(() => { const b = ${READ_BAR}; return b !== null && b.shown && b.tips["tape"] === "Lift the tape  ⇧⌘L"; })()`,
  );
  const tapedGlyph = await js<string | null>(
    `document.querySelector('[data-selection-bar] [data-act="tape"] [data-glyph]')?.getAttribute("data-glyph") ?? null`,
  );
  if (taped.cells.includes("duplicate"))
    problems.push("TAPED: Duplicate was offered for a taped selection");
  if (tapedGlyph !== "lift")
    problems.push(`TAPED: Lift the tape wore ${JSON.stringify(tapedGlyph)}, not lift`);
  say(
    `SMOKE_CANVAS_BAR_TAPED ${JSON.stringify({ cells: taped.cells, tape: taped.tips["tape"], glyph: tapedGlyph })}`,
  );
  await pressCell("tape");
  await settled(
    "the tape lifted",
    `(() => { const b = ${READ_BAR}; return b !== null && b.cells.includes("duplicate"); })()`,
  );

  // ── MENU: More on the note — nearest first under NOTE, inside its reserves, the row unmoved ────────────────
  const before = (await bar()).row;
  await pressCell("more");
  const menu = await settled(
    "the bar grown into its menu",
    `(() => { const b = ${READ_BAR}; return b !== null && b.open && b.eyebrow === "NOTE"; })()`,
  );
  await sleep(400); // the grow's 600 ms and the rows' stagger, whole
  const grown = await bar();
  const view = await js<{ width: number; height: number }>(
    "({ width: innerWidth, height: innerHeight })",
  );
  if (before !== null)
    problems.push(...judgeMenuPlace(view, before, grown).map((p) => `MENU: ${p}`));
  const nearestFirst = ["comment", "copy", "duplicate", "front", "back", "tape", "delete"];
  if (JSON.stringify(menu.rows) !== JSON.stringify(nearestFirst))
    problems.push(
      `MENU: the rows were ${JSON.stringify(menu.rows)}, not ${JSON.stringify(nearestFirst)}`,
    );
  say(
    `SMOKE_CANVAS_BAR_MENU ${JSON.stringify({ rows: grown.rows, eyebrow: grown.eyebrow, dir: grown.dir, row: grown.row, panel: grown.panel })}`,
  );
  if (grown.panel !== null && grown.row !== null) {
    const noteBox = (await js<DoorAnchor>(ANCHOR)).box;
    const frame = union(noteBox ?? grown.panel, grown.panel, 48);
    await shoot("dk-11-menu-light.png", frame);
    await theme("dark");
    await shoot("dk-11-menu-dark.png", frame);
    await theme("light");
  }
  await key("Escape");
  await until(
    "the menu folded by Esc",
    5_000,
    `(() => { const b = ${READ_BAR}; return b !== null && !b.open; })()`,
  );
  await deselect();

  // ── RIGHT: the notebook right-clicked — selected FIRST by the desk's pick, then the same menu grown ─────────
  const notebookAt = await point("desk.notebook");
  await press(notebookAt, "right");
  const right = await settled(
    "the notebook selected and the menu grown by a right-click",
    `(() => { const b = ${READ_BAR}; return b !== null && b.open && b.eyebrow === "NOTEBOOK"; })()`,
  );
  const rightAnchor = await js<DoorAnchor>(ANCHOR);
  const notebookBox = await js<ScreenRect | null>(BOX_OF("desk.notebook"));
  const inBox =
    rightAnchor.box !== null &&
    notebookBox !== null &&
    rightAnchor.box.x0 <= notebookBox.x0 + 12 &&
    rightAnchor.box.x1 >= notebookBox.x1 - 12;
  if (rightAnchor.count !== 1 || !inBox)
    problems.push(
      `RIGHT: the right-click did not select the notebook (${JSON.stringify({ rightAnchor, notebookBox })})`,
    );
  say(
    `SMOKE_CANVAS_BAR_RIGHT ${JSON.stringify({ at: notebookAt, count: rightAnchor.count, eyebrow: right.eyebrow, rows: right.rows })}`,
  );
  await key("Escape");
  await deselect();

  // ── MISSING: the clock's plugin off — the status line once, the bar's words; on again ──────────────────────
  const mount0 = await js<number>("globalThis.__vfDesk.mount");
  const said0 = await js<readonly { id: string; text: string }[]>("globalThis.__vfDesk.notices()");
  await d.plugins.disable(BAR_CLOCK);
  await until(
    "the desk remounted without the clock's kind and said so",
    30_000,
    `(globalThis.__vfDesk?.mount ?? -1) > ${mount0} && globalThis.__vfDesk.notices().some((n) => n.text === "Clock · plugin off")`,
  );
  await select(BAR_CLOCK);
  const missing = await settled(
    "the bar naming the missing face",
    `(() => { const b = ${READ_BAR}; return b !== null && b.shown && b.cells.includes("words:Clock · plugin off"); })()`,
  );
  await shoot("dk-11-missing.png");
  const said = (
    await js<readonly { id: string; text: string }[]>("globalThis.__vfDesk.notices()")
  ).slice(said0.length);
  const clockSaid = said.filter((n) => n.text === "Clock · plugin off");
  if (clockSaid.length !== 1)
    problems.push(
      `MISSING: the status line said the clock's word ${clockSaid.length} times, not once`,
    );
  if (!missing.cells.includes("duplicate"))
    problems.push("MISSING: Duplicate was not offered for the missing face (R11)");
  if (missing.cells.some((c) => c.startsWith("act:")))
    problems.push(
      `MISSING: the missing face's kind acts were offered (${JSON.stringify(missing.cells)})`,
    );
  say(`SMOKE_CANVAS_BAR_MISSING ${JSON.stringify({ cells: missing.cells, said })}`);
  await deselect();
  const mount1 = await js<number>("globalThis.__vfDesk.mount");
  await d.plugins.enable(BAR_CLOCK);
  await until(
    "the clock drawn again",
    30_000,
    `(globalThis.__vfDesk?.mount ?? -1) > ${mount1} && globalThis.__vfDesk.words(${JSON.stringify(BAR_CLOCK)}).state === null`,
  );
  // the remounted desk hands the next rows a DRAWN desk: ready, its first frame presented, the clock picked again
  await until(
    "the remounted desk drawn, the clock picked on it",
    30_000,
    `globalThis.__vfDesk.status().state === "ready" && globalThis.__vfDesk.perf().frames >= 1 && (${POINT_IN(BAR_CLOCK)}) !== null`,
  );

  // ── COUNTERS: placements ≤ publishes; a handful of renders ─────────────────────────────────────────────────
  const counters1 = await js<BarCounters>("globalThis.__vfDesk.bar()");
  problems.push(...judgeCounters(counters0, counters1));
  say(`SMOKE_CANVAS_BAR_COUNTERS ${JSON.stringify({ before: counters0, after: counters1 })}`);
  return problems;
}
