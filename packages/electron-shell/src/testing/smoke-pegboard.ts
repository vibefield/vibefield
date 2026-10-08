// DK-13 — THE PEGBOARD BEHIND THE LINE, IN THE PRODUCT (smoke:canvas; DESIGN.md §8 "The pegboard — Objects, behind the
// line"; R14, R19, R21, P3c; ICE I21). Driven by the line's own create and the keyboard, over the first board, each row read
// back off the DOM the chrome drew and off the desk's door (`window.__vfDesk`: the tray's anchor and the specimens as the
// desk DREW them — ICE's own witness — the selection's anchor, the census, the pegboard's counters):
//   OPEN      — the create pressed: the board rises behind the line (the tray's `open`, its lay keeping 88 at the foot —
//               the frame's `foot`), the create's plus turned 135° into ✕ ("Close  Esc"), the stage neither receded nor
//               dimmed by the chrome (no backdrop, no recede), Objects the frame's open surface;
//   BAR       — scope 5: a selection made first, the selection bar HIDDEN while the board is out (ICE's anchor answers no
//               box under it), back over the same selection once the board folds;
//   FILTERS   — All first, then `tray.categories()` in the lay's order, no counts; centred in the header band, 12 in, its
//               top 6 under the band's (36 in the 48); a category chosen by a click and by → ← Home End (the tray's
//               category follows; the board hangs only that category's specimens; the thumb under the chosen);
//   KEYS      — B raises the board WITH the focus: the board's stop focused, the first specimen ringed where the desk
//               draws it; → and ↓ move the ring; ⏎ lays the focused specimen at the view's centre — one object more, the
//               selection, its box centred on the view — the board folds; ⌘Z takes it back (ONE undo step); Esc closes;
//               the filters and the board two stops of Tab. Since DK-17b the focus is ICE's (I37 — `tray.focus`, read
//               back from `anchor().focused`): the listbox says ICE's focused id and the ring stands 2 out from ICE's
//               `focused.rect` — where the last frame drew the object;
//   REFUSED   — B while typing in the draft types a b (the board stays shut); B under a cover (Godview) does nothing; an
//               object in hand: the create faint ("Put it down first"), B and the create refused;
//   PLUGIN    — the example clock's plugin off: the desk remounts, and the board no longer offers its "Things" (P3c); on
//               again, offered;
//   MOTION    — under reduced motion (the page's media emulated): the thumb does not travel, the ring only fades (M6);
//   COUNTERS  — the pegboard's placements ≤ the tray's publishes plus the keyboard's own moves; renders a handful.
// The stills: dk-13-board-{light,dark}.png (the window, the board out), dk-13-filters-{light,dark}.png (the header band).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { BAR_CLOCK, POINT_IN } from "./smoke-selection-bar";

/** A rect on screen, CSS px. */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The canon's numbers (§8 "The pegboard"; §10). */
export const BOARD_PLACE = {
  /** the lay's foot (I21) */
  foot: 88,
  /** the filters 12 in from the band's sides */
  inset: 12,
  /** the track 36 tall (segments 30 + padding 3), centred in the band's 48 */
  track: 36,
  /** segments 30 tall */
  segment: 30,
} as const;

const near = (a: number, b: number, eps = 1.5): boolean => Math.abs(a - b) <= eps;

/** The drawer as the tray's anchor says it was drawn. */
export interface DrawerSeen {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly p: number;
  readonly header: { readonly y: number; readonly h: number };
}

/** Are the filters where the canon puts them? Centred on the drawer, inside the header band 12 in from its sides, the
 * track 36 tall centred in the band, its segments 30 tall. Returns what is wrong, in words. */
export function judgeFiltersPlace(
  drawer: DrawerSeen | null,
  track: Rect | null,
  segments: readonly Rect[],
): string[] {
  if (drawer === null) return ["the tray drew no drawer"];
  if (track === null) return ["no filters were drawn"];
  const problems: string[] = [];
  const cx = drawer.x + drawer.w / 2;
  if (!near((track.x0 + track.x1) / 2, cx))
    problems.push(`the filters' centre is ${(track.x0 + track.x1) / 2}, not the drawer's ${cx}`);
  if (
    track.x0 < drawer.x + BOARD_PLACE.inset - 0.5 ||
    track.x1 > drawer.x + drawer.w - BOARD_PLACE.inset + 0.5
  )
    problems.push(`the filters leave the 12 in from the band's sides (${track.x0}…${track.x1})`);
  if (!near(track.y1 - track.y0, BOARD_PLACE.track, 1))
    problems.push(`the track is ${track.y1 - track.y0} tall, not 36`);
  const top = drawer.header.y + (drawer.header.h - BOARD_PLACE.track) / 2;
  if (!near(track.y0, top, 1))
    problems.push(`the track's top is ${track.y0}, not ${top} (centred in the header band)`);
  if (track.y1 > drawer.header.y + drawer.header.h + 0.5)
    problems.push(`the track's foot ${track.y1} leaves the header band`);
  for (const s of segments)
    if (!near(s.y1 - s.y0, BOARD_PLACE.segment, 1)) {
      problems.push(`a segment is ${s.y1 - s.y0} tall, not 30`);
      break;
    }
  return problems;
}

/** Is the ring around the desk's own drawing of the focused specimen — 2 out, its 2px ring outside that? */
export function judgeRing(ring: Rect | null, object: Rect | null, type: string): string[] {
  if (object === null) return [`the desk drew no ${type} on the board`];
  if (ring === null) return [`no ring stood over the focused ${type}`];
  const out = (a: number, b: number): boolean => near(a, b, 1);
  return out(ring.x0, object.x0 - 2) &&
    out(ring.y0, object.y0 - 2) &&
    out(ring.x1, object.x1 + 2) &&
    out(ring.y1, object.y1 + 2)
    ? []
    : [
        `the ring ${JSON.stringify(ring)} is not 2 out from where the desk draws the ${type} ${JSON.stringify(object)}`,
      ];
}

/** The board's focus is ICE's (I37): the listbox's focused option is the anchor's `focused.id`, and the ring stands 2 out
 * from the anchor's `focused.rect`. */
export function judgeIceFocus(
  listbox: string | null,
  focused: { readonly id: string; readonly rect: Rect | null } | null,
  ring: Rect | null,
): string[] {
  if (focused === null) return ["ICE's anchor says nothing focused"];
  const problems: string[] = [];
  if (listbox !== focused.id)
    problems.push(`the listbox says ${listbox}, ICE's focus ${focused.id}`);
  problems.push(...judgeRing(ring, focused.rect, `${focused.id} (ICE's focused.rect)`));
  return problems;
}

/** Is a box centred on the view's centre (the object laid by ⏎)? */
export function judgeCentred(view: { width: number; height: number }, box: Rect | null): string[] {
  if (box === null) return ["the laid object has no box"];
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return near(cx, view.width / 2, 3) && near(cy, view.height / 2, 3)
    ? []
    : [
        `the laid object's centre is (${cx}, ${cy}), not the view's (${view.width / 2}, ${view.height / 2})`,
      ];
}

/** The pegboard's counters (`__vfDesk.pegboard().stats`). */
export interface BoardCounters {
  readonly publishes: number;
  readonly placements: number;
  readonly renders: number;
  readonly inserts: number;
}

/** Placements ≤ publishes + the keyboard's own moves (each a ring placed) — never one per frame on its own. */
export function judgeBoardCounters(
  before: BoardCounters,
  after: BoardCounters,
  keyMoves: number,
): string[] {
  const publishes = after.publishes - before.publishes;
  // each publish places the filters and (while focused) the ring: two writes at most, and the keyboard's own moves
  const placements = after.placements - before.placements;
  const most = 2 * publishes + 2 * keyMoves;
  return placements <= most
    ? []
    : [
        `the pegboard placed ${placements} times for ${publishes} publishes and ${keyMoves} key moves — a placement without a publish`,
      ];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The pegboard's chrome and the line's create, read whole. */
const READ = `(() => {
  const rect = (el) => { if (el === null || el === undefined) return null; const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; };
  const create = document.querySelector(".vf-line-create");
  const plus = create?.querySelector('[data-glyph="plus"]');
  const board = document.querySelector(".vf-pegboard");
  const track = board?.querySelector(".vf-pegboard-track");
  const filters = board?.querySelector(".vf-pegboard-filters");
  const ring = board?.querySelector(".vf-pegboard-ring");
  const listbox = board?.querySelector(".vf-pegboard-board");
  const thumb = track?.querySelector(".vf-ui-segmented-thumb");
  const segs = [...(track?.querySelectorAll(":scope > button") ?? [])];
  return {
    open: board?.getAttribute("data-open") === "true",
    create: create === null ? null : {
      expanded: create.getAttribute("aria-expanded"),
      title: create.getAttribute("title"),
      disabled: create.getAttribute("aria-disabled"),
      held: create.getAttribute("data-held"),
      color: getComputedStyle(create).color,
      turn: plus === null || plus === undefined ? null : getComputedStyle(plus).transform,
    },
    filters: filters === null || filters === undefined ? null : { opacity: Number(getComputedStyle(filters).opacity), visibility: getComputedStyle(filters).visibility },
    track: rect(track),
    more: track?.getAttribute("data-more") ?? null,
    segments: segs.map((b) => ({ id: b.getAttribute("data-id"), label: b.textContent, pressed: b.getAttribute("aria-pressed"), rect: rect(b), tab: b.tabIndex })),
    thumb: rect(thumb),
    placed: track?.getAttribute("data-thumb") ?? null,
    ring: ring?.hasAttribute("data-shown") ? rect(ring) : null,
    focused: listbox?.querySelector('[aria-selected="true"]')?.getAttribute("data-type") ?? null,
    options: [...(listbox?.querySelectorAll('[role="option"]') ?? [])].map((o) => o.getAttribute("data-type")),
    active: document.activeElement === listbox ? "board" : track?.contains(document.activeElement) ? "filters" : document.activeElement?.className ?? null,
    sheet: document.querySelector(".field-scene")?.getAttribute("data-sheet-open") ?? null,
    backdrop: document.querySelector(".vf-ui-backdrop") !== null,
    bar: document.querySelector("[data-selection-bar]")?.getAttribute("data-shown") ?? null,
  };
})()`;

interface Seen {
  readonly open: boolean;
  readonly create: {
    readonly expanded: string | null;
    readonly title: string | null;
    readonly disabled: string | null;
    readonly held: string | null;
    readonly color: string;
    readonly turn: string | null;
  } | null;
  readonly filters: { readonly opacity: number; readonly visibility: string } | null;
  readonly track: Rect | null;
  readonly more: string | null;
  readonly segments: readonly {
    readonly id: string | null;
    readonly label: string | null;
    readonly pressed: string | null;
    readonly rect: Rect | null;
    readonly tab: number;
  }[];
  readonly thumb: Rect | null;
  readonly placed: string | null;
  readonly ring: Rect | null;
  readonly focused: string | null;
  readonly options: readonly (string | null)[];
  readonly active: string | null;
  readonly sheet: string | null;
  readonly backdrop: boolean;
  readonly bar: string | null;
}

interface DoorBoard {
  readonly anchor: {
    readonly open: boolean;
    readonly held: boolean;
    readonly drawer: DrawerSeen | null;
    readonly view: { readonly width: number; readonly height: number };
    readonly category: string;
    readonly categories: readonly {
      readonly id: string;
      readonly label: string;
      readonly count: number;
    }[];
    /** ICE's keyboard focus (I37): its type and its object as the last frame drew it */
    readonly focused: { readonly id: string; readonly rect: Rect | null } | null;
  };
  readonly scroll: number;
  readonly foot: number | null;
  readonly laid: readonly string[];
  readonly specimens: readonly {
    readonly type: string;
    readonly label: string;
    readonly object: Rect;
  }[];
  readonly stats: BoardCounters;
}

export interface BoardRowsDriver {
  readonly win: BrowserWindow;
  readonly plugins: {
    disable(id: string): Promise<unknown>;
    enable(id: string): Promise<unknown>;
  };
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

/** The categories of the six built-ins and the example clock (§8: "the six built-ins' Paper and Surfaces, the example
 * clock's Things") — and the comment pad's, VibeField's own. */
const CLOCK_CATEGORY = "things";

/** DK-13's rows (above). Returns the problems, each in words. */
export async function pegboardRows(d: BoardRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const seen = (): Promise<Seen> => js<Seen>(READ);
  const door = (): Promise<DoorBoard> => js<DoorBoard>("globalThis.__vfDesk.pegboard()");
  const until = async (label: string, timeoutMs: number, expression: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await js<unknown>(expression)) === true) return;
      await sleep(80);
    }
    throw new Error(
      `${label} did not happen within ${timeoutMs}ms (${JSON.stringify(await seen())})`,
    );
  };
  const press = async (at: { x: number; y: number }): Promise<void> => {
    win.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
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
  const pressAt = async (selector: string): Promise<void> => {
    const at = await js<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (at === null) throw new Error(`no ${selector} to press`);
    await press(at);
  };
  const key = async (
    keyCode: string,
    modifiers: ("meta" | "control" | "shift")[] = [],
    char = false,
  ): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    if (char) win.webContents.sendInputEvent({ type: "char", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await sleep(80);
  };
  const theme = async (name: "light" | "dark"): Promise<void> => {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    await until(
      `the desk dressed ${name}`,
      10_000,
      `globalThis.__vfDesk.theme() === ${JSON.stringify(name)}`,
    );
    await sleep(600);
  };
  const shoot = async (name: string, rect?: Rect): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    const view = await js<{ w: number; h: number }>("({ w: innerWidth, h: innerHeight })");
    const image =
      rect === undefined
        ? await win.capturePage()
        : await win.capturePage({
            x: Math.max(0, Math.floor(rect.x0)),
            y: Math.max(0, Math.floor(rect.y0)),
            width: Math.ceil(Math.min(view.w, rect.x1) - Math.max(0, rect.x0)),
            height: Math.ceil(Math.min(view.h, rect.y1) - Math.max(0, rect.y0)),
          });
    writeFileSync(join(d.shotDir, name), image.toPNG());
  };
  const open = (): Promise<void> =>
    until("the board out", 5_000, "globalThis.__vfDesk.pegboard()?.anchor.open === true");
  /** the slide done: the drawer drawn whole, the filters faded in */
  const settled = async (): Promise<void> => {
    await until(
      "the board's slide done",
      5_000,
      `(() => { const b = globalThis.__vfDesk.pegboard(); return b !== null && b.anchor.open && b.anchor.drawer !== null && b.anchor.drawer.p >= 0.999; })()`,
    );
    await sleep(350); // the thumb's 300 ms, the ring's 160
  };
  const shut = (): Promise<void> =>
    until(
      "the board shut",
      5_000,
      `(() => { const b = globalThis.__vfDesk.pegboard(); return b !== null && !b.anchor.open; })()`,
    );
  const census = (): Promise<Record<string, number>> => js("globalThis.__vfDesk.census()");
  const deselect = async (): Promise<void> => {
    await key("Escape");
    await key("Escape");
    const count = await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0");
    if (count === 0) return;
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
    await until("nothing selected", 5_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 0");
  };

  const problems: string[] = [];
  const counters0 = (await door()).stats;
  let keyMoves = 0;
  await theme("light");
  await deselect();

  // ── BAR (scope 5) + OPEN: the clock selected, then the create pressed ───────────────────────────────────────────
  const clockAt = await js<{ x: number; y: number } | null>(POINT_IN(BAR_CLOCK));
  if (clockAt === null) throw new Error("the clock was not picked where the desk receives a press");
  await press({ x: Math.round(clockAt.x), y: Math.round(clockAt.y) });
  await until(
    "the bar over the clock",
    10_000,
    `document.querySelector("[data-selection-bar]")?.getAttribute("data-shown") === "true"`,
  );
  const boxBefore = await js<Rect | null>("globalThis.__vfDesk.anchor()?.box ?? null");
  await pressAt(".vf-line-create");
  await open();
  await settled();
  const out = await seen();
  const board = await door();
  if (out.create?.expanded !== "true" || out.create.title !== "Close  Esc")
    problems.push(`OPEN: the create did not turn to its ✕ (${JSON.stringify(out.create)})`);
  // the plus turned 135°: its matrix's first two terms are cos 135, sin 135
  const turn = /matrix\(([-\d.e]+), ([-\d.e]+)/u.exec(out.create?.turn ?? "");
  if (
    turn === null ||
    !near(Number(turn[1]), Math.cos((135 * Math.PI) / 180), 0.02) ||
    !near(Number(turn[2]), Math.sin((135 * Math.PI) / 180), 0.02)
  )
    problems.push(`OPEN: the plus was not turned 135° (${out.create?.turn})`);
  if (board.foot !== BOARD_PLACE.foot)
    problems.push(`OPEN: the board's lay keeps ${board.foot} at its foot, not 88 (I21)`);
  if (out.sheet !== "false" || out.backdrop)
    problems.push(
      `OPEN: the stage receded or dimmed behind the board (sheet ${out.sheet}, backdrop ${out.backdrop})`,
    );
  if (out.bar === "true") problems.push("BAR: the selection bar stood while the board was out");
  const surfaceNow = await js<string | null>(
    `document.querySelector(".vf-line-create")?.getAttribute("aria-expanded")`,
  );
  say(
    `SMOKE_CANVAS_BOARD_OPEN ${JSON.stringify({ create: out.create, foot: board.foot, drawer: board.anchor.drawer, sheet: out.sheet, backdrop: out.backdrop, bar: out.bar, expanded: surfaceNow, specimens: board.specimens.map((s) => s.type) })}`,
  );
  await shoot("dk-13-board-light.png");
  await theme("dark");
  await shoot("dk-13-board-dark.png");
  await theme("light");

  // ── FILTERS: All first, then the categories in the lay's order; placed in the header band; chosen ─────────────
  const labels = out.segments.map((s) => s.label);
  const expected = ["All", ...board.anchor.categories.map((c) => c.label)];
  if (JSON.stringify(labels) !== JSON.stringify(expected))
    problems.push(
      `FILTERS: the filters read ${JSON.stringify(labels)}, not ${JSON.stringify(expected)}`,
    );
  if (labels.some((l) => /\d/u.test(l ?? "")))
    problems.push(`FILTERS: a filter carries a count (${JSON.stringify(labels)})`);
  problems.push(
    ...judgeFiltersPlace(
      board.anchor.drawer,
      out.track,
      out.segments.flatMap((s) => (s.rect === null ? [] : [s.rect])),
    ).map((p) => `FILTERS: ${p}`),
  );
  if (out.segments[0]?.pressed !== "true" || out.placed !== "placed")
    problems.push(
      `FILTERS: All was not chosen under its thumb (${JSON.stringify(out.segments[0])}, thumb ${out.placed})`,
    );
  // a click: Surfaces
  const surfaces = board.anchor.categories.find((c) => c.id === "surfaces");
  if (surfaces === undefined) problems.push("FILTERS: the board offers no Surfaces");
  await pressAt('.vf-pegboard-track button[data-id="surfaces"]');
  await until(
    "the board showing Surfaces",
    5_000,
    `globalThis.__vfDesk.pegboard()?.anchor.category === "surfaces"`,
  );
  await sleep(450);
  const clicked = await seen();
  const onSurfaces = (await door()).specimens.map((s) => s.type).sort();
  const pressed = clicked.segments.find((s) => s.id === "surfaces");
  if (
    clicked.thumb === null ||
    pressed?.rect == null ||
    !near(clicked.thumb.x0, pressed.rect.x0, 1.5) ||
    !near(clicked.thumb.x1, pressed.rect.x1, 1.5)
  )
    problems.push(
      `FILTERS: the thumb did not slide under Surfaces (${JSON.stringify({ thumb: clicked.thumb, segment: pressed?.rect })})`,
    );
  if (JSON.stringify(onSurfaces) !== JSON.stringify(["desk.board", "desk.minimat"]))
    problems.push(
      `FILTERS: Surfaces hung ${JSON.stringify(onSurfaces)}, not the whiteboard and the mini mat`,
    );
  await shoot(
    "dk-13-filters-light.png",
    board.anchor.drawer === null
      ? undefined
      : {
          x0: board.anchor.drawer.x,
          y0: board.anchor.drawer.header.y - 24,
          x1: board.anchor.drawer.x + board.anchor.drawer.w,
          y1: board.anchor.drawer.header.y + board.anchor.drawer.header.h + 140,
        },
  );
  await theme("dark");
  await shoot(
    "dk-13-filters-dark.png",
    board.anchor.drawer === null
      ? undefined
      : {
          x0: board.anchor.drawer.x,
          y0: board.anchor.drawer.header.y - 24,
          x1: board.anchor.drawer.x + board.anchor.drawer.w,
          y1: board.anchor.drawer.header.y + board.anchor.drawer.header.h + 140,
        },
  );
  await theme("light");
  // the keys: → ← Home End on the focused segment
  const keysSeen: string[] = [];
  const order = ["", ...board.anchor.categories.map((c) => c.id)];
  for (const [k, want] of [
    ["Right", order[order.indexOf("surfaces") + 1] ?? "surfaces"],
    ["Left", "surfaces"],
    ["Home", ""],
    ["End", order[order.length - 1] ?? ""],
  ] as const) {
    await key(k);
    await sleep(120);
    const now = (await door()).anchor.category;
    keysSeen.push(`${k}:${now}`);
    if (now !== want)
      problems.push(`FILTERS: ${k} chose ${JSON.stringify(now)}, not ${JSON.stringify(want)}`);
  }
  const filtersFocused = (await seen()).active;
  if (filtersFocused !== "filters")
    problems.push(`FILTERS: the keys left the focus off the filters (${filtersFocused})`);
  // Tab: the filters, then the board — two stops
  await key("Tab");
  const tabbed = (await seen()).active;
  if (tabbed !== "board")
    problems.push(`KEYS: Tab from the filters reached ${tabbed}, not the board`);
  say(
    `SMOKE_CANVAS_BOARD_FILTERS ${JSON.stringify({ labels, track: out.track, header: board.anchor.drawer?.header, keys: keysSeen, surfaces: onSurfaces, tab: tabbed })}`,
  );
  // back to All, then Esc closes
  await js(
    `globalThis.__vfDesk.pegboard() && document.querySelector('.vf-pegboard-track button[data-id=""]')?.click()`,
  );
  await until(
    "the board showing All",
    5_000,
    `globalThis.__vfDesk.pegboard()?.anchor.category === ""`,
  );
  await key("Escape");
  await shut();
  const closed = await seen();
  if (closed.create?.expanded !== "false")
    problems.push(`KEYS: Esc left the create ${JSON.stringify(closed.create)}`);
  // BAR: back over the same selection
  await until(
    "the bar back over the selection",
    5_000,
    `document.querySelector("[data-selection-bar]")?.getAttribute("data-shown") === "true"`,
  );
  const boxAfter = await js<Rect | null>("globalThis.__vfDesk.anchor()?.box ?? null");
  if (
    boxBefore === null ||
    boxAfter === null ||
    !near(boxBefore.x0, boxAfter.x0, 1) ||
    !near(boxBefore.y0, boxAfter.y0, 1)
  )
    problems.push(
      `BAR: the selection did not persist under the board (${JSON.stringify({ boxBefore, boxAfter })})`,
    );
  say(
    `SMOKE_CANVAS_BOARD_BAR ${JSON.stringify({ shownWhileOut: out.bar, after: closed.bar, boxBefore, boxAfter })}`,
  );
  await deselect();

  // ── KEYS: B raises the board with the focus; → ↓ move; ⏎ lays one at the view's centre; ⌘Z takes it back ──────
  await key("B", [], true);
  await open();
  await settled();
  await until(
    "the board focused",
    5_000,
    `document.activeElement?.classList.contains("vf-pegboard-board") === true`,
  );
  await until(
    "the first specimen focused",
    5_000,
    `document.querySelector('.vf-pegboard-board [aria-selected="true"]') !== null`,
  );
  await sleep(250); // the ring's fade and glide
  const first = await seen();
  const firstType = first.focused;
  if (firstType !== first.options[0])
    problems.push(
      `KEYS: the board took the focus on ${firstType}, not its first specimen ${first.options[0]}`,
    );
  const drawnOf = async (type: string | null): Promise<Rect | null> =>
    (await door()).specimens.find((s) => s.type === type)?.object ?? null;
  problems.push(
    ...judgeRing(first.ring, await drawnOf(firstType), String(firstType)).map((p) => `KEYS: ${p}`),
    ...judgeIceFocus(first.focused, (await door()).anchor.focused, first.ring).map(
      (p) => `KEYS: ${p}`,
    ),
  );
  await key("Right");
  keyMoves += 1;
  await sleep(250);
  const right = await seen();
  if (right.focused !== first.options[1])
    problems.push(
      `KEYS: → moved the focus to ${right.focused}, not the next specimen ${first.options[1]}`,
    );
  problems.push(
    ...judgeRing(right.ring, await drawnOf(right.focused), String(right.focused)).map(
      (p) => `KEYS: → ${p}`,
    ),
    ...judgeIceFocus(right.focused, (await door()).anchor.focused, right.ring).map(
      (p) => `KEYS: → ${p}`,
    ),
  );
  await key("Down");
  keyMoves += 1;
  await sleep(250);
  const down = await seen();
  if (down.focused === right.focused)
    problems.push("KEYS: ↓ did not move the focus to the row below");
  const downAnchor = (await door()).anchor;
  problems.push(
    ...judgeRing(down.ring, await drawnOf(down.focused), String(down.focused)).map(
      (p) => `KEYS: ↓ ${p}`,
    ),
    ...judgeIceFocus(down.focused, downAnchor.focused, down.ring).map((p) => `KEYS: ↓ ${p}`),
  );
  // ⏎ — the focused one at the view's centre, one object more, selected, the board folded
  const before = await census();
  const laying = down.focused;
  await key("Return");
  await shut();
  await sleep(400);
  const afterInsert = await census();
  // the VIEW's centre: the desk's own view (the tray's anchor says it) — the window's
  const view = (await door()).anchor.view;
  const windowView = await js<{ width: number; height: number }>(
    "({ width: innerWidth, height: innerHeight })",
  );
  if (!near(view.width, windowView.width, 1) || !near(view.height, windowView.height, 1))
    problems.push(
      `KEYS: the desk's view ${JSON.stringify(view)} is not the window's ${JSON.stringify(windowView)}`,
    );
  const laid = laying === null ? 0 : (afterInsert[laying] ?? 0) - (before[laying] ?? 0);
  if (laying === null || laid !== 1)
    problems.push(
      `KEYS: ⏎ laid ${laid} ${laying} (census ${JSON.stringify({ before, afterInsert })})`,
    );
  await until(
    "the laid object selected",
    5_000,
    "(globalThis.__vfDesk.anchor()?.count ?? 0) === 1",
  );
  const laidBox = await js<Rect | null>("globalThis.__vfDesk.anchor()?.box ?? null");
  // ICE's brackets stand 6 out of one object on every side: the box's centre is the object's
  problems.push(...judgeCentred(view, laidBox).map((p) => `KEYS: ${p}`));
  // one undo step
  await key("z", [process.platform === "darwin" ? "meta" : "control"]);
  await sleep(400);
  const undone = await census();
  if (laying !== null && (undone[laying] ?? 0) !== (before[laying] ?? 0))
    problems.push(
      `KEYS: ⌘Z did not take the laid ${laying} back in one step (${JSON.stringify({ before, undone })})`,
    );
  say(
    `SMOKE_CANVAS_BOARD_KEYS ${JSON.stringify({ first: firstType, ring: first.ring, right: right.focused, rightRing: right.ring, down: laying, downRing: down.ring, iceFocused: downAnchor.focused, laid, box: laidBox, view, windowView, undone: laying === null ? null : (undone[laying] ?? 0) })}`,
  );
  await deselect();

  // ── REFUSED: B while typing; B under a cover; in hand the create faint and the board refused ───────────────────
  await pressAt(".vf-line-input");
  await until(
    "the draft focused",
    5_000,
    `document.activeElement?.classList.contains("vf-line-input") === true`,
  );
  await key("B", [], true);
  await sleep(300);
  const typing = await door();
  const typed = await js<string>(`document.querySelector(".vf-line-input")?.textContent ?? ""`);
  if (typing.anchor.open) problems.push("REFUSED: B while typing raised the board");
  if (!/b/iu.test(typed))
    problems.push(`REFUSED: B while typing did not type (${JSON.stringify(typed)})`);
  await js(
    `(() => { const e = document.querySelector(".vf-line-input"); e.textContent = ""; e.dispatchEvent(new InputEvent("input", { bubbles: true })); e.blur(); })()`,
  );
  // under a cover: Godview
  await key("2", [process.platform === "darwin" ? "meta" : "control"]);
  await until(
    "Godview's cover",
    10_000,
    `document.querySelector(".vf-line")?.getAttribute("data-view") === "godview"`,
  );
  await js("document.activeElement?.blur?.()");
  await key("B", [], true);
  await sleep(300);
  const covered = await door();
  if (covered.anchor.open) problems.push("REFUSED: B under a cover raised the board");
  await key("1", [process.platform === "darwin" ? "meta" : "control"]);
  await until(
    "the canvas again",
    10_000,
    `document.querySelector(".vf-line")?.getAttribute("data-view") === "canvas"`,
  );
  await sleep(600);
  // in hand: the notebook picked up by the desk's own ⏎
  const notebookAt = await js<{ x: number; y: number } | null>(POINT_IN("desk.notebook"));
  let hand: Seen | null = null;
  if (notebookAt === null)
    problems.push("REFUSED: the notebook was not picked where the desk receives a press");
  else {
    await press({ x: Math.round(notebookAt.x), y: Math.round(notebookAt.y) });
    await until("the notebook selected", 5_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 1");
    await key("Return");
    await until("the notebook in hand", 10_000, "globalThis.__vfDesk.held() !== null");
    await until(
      "the create faint",
      5_000,
      `document.querySelector(".vf-line-create")?.getAttribute("data-held") === "true"`,
    );
    hand = await seen();
    if (hand.create?.title !== "Put it down first" || hand.create.disabled !== "true")
      problems.push(`REFUSED: in hand the create read ${JSON.stringify(hand.create)}`);
    await key("B", [], true);
    await pressAt(".vf-line-create");
    await sleep(400);
    if ((await door()).anchor.open) problems.push("REFUSED: the board rose with an object in hand");
    await key("Escape");
    await until("put down", 10_000, "globalThis.__vfDesk.held() === null");
    await sleep(600);
  }
  say(
    `SMOKE_CANVAS_BOARD_REFUSED ${JSON.stringify({ typing: typing.anchor.open, typed, covered: covered.anchor.open, hand: hand?.create ?? null })}`,
  );
  await deselect();

  // ── PLUGIN (P3c): the clock's plugin off — "Things" no longer offered; on again ────────────────────────────────
  const mount0 = await js<number>("globalThis.__vfDesk.mount");
  await d.plugins.disable(BAR_CLOCK);
  await until(
    "the desk remounted without the clock",
    30_000,
    `(globalThis.__vfDesk?.mount ?? -1) > ${mount0} && globalThis.__vfDesk.status().state === "ready"`,
  );
  await sleep(500);
  await pressAt(".vf-line-create");
  await open();
  await settled();
  const off = await seen();
  const offBoard = await door();
  const offIds = off.segments.map((s) => s.id);
  if (offIds.includes(CLOCK_CATEGORY))
    problems.push(
      `PLUGIN: the board offered ${CLOCK_CATEGORY} with the clock's plugin off (${JSON.stringify(offIds)})`,
    );
  if (offBoard.specimens.some((s) => s.type === BAR_CLOCK))
    problems.push("PLUGIN: the desk drew the clock's specimen with its plugin off");
  await shoot("dk-13-plugin-off.png");
  if (off.options.includes(BAR_CLOCK))
    problems.push("PLUGIN: the board's stop offered the clock with its plugin off");
  say(
    `SMOKE_CANVAS_BOARD_PLUGIN ${JSON.stringify({ off: offIds, ice: offBoard.anchor.categories.map((c) => c.id), laid: offBoard.laid, drawn: offBoard.specimens.map((s) => s.type) })}`,
  );
  await key("Escape");
  await shut();
  const mount1 = await js<number>("globalThis.__vfDesk.mount");
  await d.plugins.enable(BAR_CLOCK);
  await until(
    "the clock drawn again",
    30_000,
    `(globalThis.__vfDesk?.mount ?? -1) > ${mount1} && globalThis.__vfDesk.words(${JSON.stringify(BAR_CLOCK)}).state === null && globalThis.__vfDesk.status().state === "ready"`,
  );
  await until(
    "the remounted desk drawn",
    30_000,
    `globalThis.__vfDesk.perf().frames >= 1 && (${POINT_IN(BAR_CLOCK)}) !== null`,
  );
  await pressAt(".vf-line-create");
  await open();
  await settled();
  const on = (await seen()).segments.map((s) => s.id);
  if (!on.includes(CLOCK_CATEGORY))
    problems.push(
      `PLUGIN: on again, the board did not offer ${CLOCK_CATEGORY} (${JSON.stringify(on)})`,
    );
  await key("Escape");
  await shut();

  // ── MOTION (M6): under reduced motion the thumb does not travel and the ring only fades ─────────────────────────
  const dbg = win.webContents.debugger;
  let motion: { thumb: string; ring: string; ringProperty: string } | null = null;
  try {
    dbg.attach("1.3");
    await dbg.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await key("B", [], true);
    await open();
    await settled();
    motion = await js(`(() => {
      const thumb = document.querySelector(".vf-pegboard-track .vf-ui-segmented-thumb");
      const ring = document.querySelector(".vf-pegboard-ring");
      return { thumb: getComputedStyle(thumb).transitionDuration, ring: getComputedStyle(ring).transitionDuration, ringProperty: getComputedStyle(ring).transitionProperty };
    })()`);
    if (motion?.thumb.split(",").some((d) => d.trim() !== "0s") !== false)
      problems.push(
        `MOTION: under reduced motion the thumb still travels (${JSON.stringify(motion)})`,
      );
    if (motion?.ringProperty !== "opacity" || motion.ring !== "0.06s")
      problems.push(
        `MOTION: under reduced motion the ring does more than fade (${JSON.stringify(motion)})`,
      );
    await key("Escape");
    await shut();
  } finally {
    if (dbg.isAttached()) {
      await dbg.sendCommand("Emulation.setEmulatedMedia", { features: [] });
      dbg.detach();
    }
  }
  say(`SMOKE_CANVAS_BOARD_MOTION ${JSON.stringify(motion)}`);

  // ── COUNTERS ───────────────────────────────────────────────────────────────────────────────────────────────────
  const counters1 = (await door()).stats;
  problems.push(...judgeBoardCounters(counters0, counters1, keyMoves));
  say(
    `SMOKE_CANVAS_BOARD_COUNTERS ${JSON.stringify({ before: counters0, after: counters1, keyMoves })}`,
  );
  return problems;
}
