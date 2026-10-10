// PT-1 — THE BROWSER PANE IN THE PRODUCT (smoke:canvas; the PORTALS brief PT-1 §5 "in the product"): VibeField's first
// portal kind (`plugins/browser-pane`, staged through fieldd like the comment pad), driven by a person's acts on the real
// desk and read back off the desk door (`window.__vfDesk`: the census, each object's props and rect, the selection's anchor,
// the hand, a kind's own witness through `local(name)`) — never a hash:
//   LAID    — by day, at actual size (⌘0) on CLEAR GROUND — the view panned until the drop lies 600 units clear of every
//             object on the board (their rects and the camera off the door — a calendar's paper answers no pick), so the pane lies
//             alone and its face is its own (its glass shows the MAT under it, never another object) — the board raised by
//             the line's create, the PORTALS chip chosen once the board's slide is done, the Browser specimen taken off it by
//             the pointer and dropped there: ONE pane more, the one selection, its kind neither refused nor struck, the
//             board folded, the pane over no other object;
//   FACE    — the pane brought to the middle (a drag on the bare mat), at actual size, then its PAGE captured
//             without the marks (the region inside the clear border and under the engraved head — a flat page fails here
//             whatever the head and the glass draw): a face by its colours and its contrast, by day and by night — by day
//             the sample's LIGHT page (never the mat, never the desk's missing face), the night's page (the desk's dark
//             scheme) darker than the day's; the stills pt-1-pane-{light,dark}.png, whole. A step that cannot go on ends the
//             rows with what the steps before it found;
//   RESIZE  — selected, its SE knob dragged by the pointer: its Size grows by what was dragged (its top-left held), and the
//             head's READOUT follows — the pane's own witness (`said(e)`, what its head says) names the viewport the new size
//             cuts at the laptop's density, whole CSS px;
//   DEVICE  — the selection bar's iPhone act: the pane re-cut to the phone's own cut about its centre and `device` written —
//             the head says 402 × 874 — then ONE ⌘Z takes the size, the place and the device back together (one transaction);
//   HAND    — ⏎ picks it up (ICE's pick-up, never a camera lean-in): in hand, settled, its word the address as printed, its
//             five held tools shown LIVE (PT-3: they work — testing/smoke-use-pane.ts presses them); the still
//             pt-1-pane-held.png; Esc puts it down, still selected.
// Then the pane is deleted (⌫) and the board is as found: the census back, the theme and the wind as they were.
// `--browser-pane` beside `--smoke-canvas` runs these rows alone after the boot's (the author's loop; this file's header).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

/** The flag beside `--smoke-canvas` that runs these rows alone after the boot's (the author's loop). */
export const PANE_FLAG = "--browser-pane";

/** The pane's facts as the product holds them — the plugin's law's numbers, said again here (plugins/browser-pane/src/devices.ts). */
export const PANE = {
  type: "vibefield.browser-pane",
  category: "portals",
  /** world units per millimetre (the note's scale: 200 = 3″) */
  mm: 200 / 76.2,
  /** the clear border round the page and the engraved head, mm */
  border: 5,
  head: 11,
  /** the laptop's density (mm a CSS px) and the smallest viewport */
  laptop: 0.2,
  min: [320, 240],
  /** the phone's own cut — 402 × 874 at its density, to the hundredth — as a device switch writes it */
  phoneCut: { w: 201.03, h: 421.99 },
  phoneViewport: [402, 874],
  /** the address the default pane's head prints, and the held tools it declares (ids, in order) */
  display: "lumen.example",
  tools: ["back", "forward", "reload", "address", "device"],
  /** the face's floors — a page, not a fill: its distinct colours (5 bits a channel) and its luma range */
  minColors: 40,
  minLumaRange: 120,
  /** by day the sample page is LIGHT (its ground near white): its mean luma at least this — never the mat, never the missing face */
  minDayMean: 150,
  /** the drag the resize makes on the SE knob, CSS px, in so many moves */
  drag: { dx: 90, dy: 60 },
  dragSteps: 10,
  /** ICE's dead zone: a drag's origin is where the pointer LEAVES it (core's `Drag` — "Origin from dead-zone exit";
   * `GESTURE_DEFAULTS.dragSlopPx`), so what a handle's drag writes is the travel after that move */
  slop: 10,
} as const;

/** The travel a stepped drag makes AFTER it leaves ICE's dead zone: the whole drag less the first move past the slop. */
export function travelAfterSlop(
  drag: { readonly dx: number; readonly dy: number },
  steps: number,
  slop: number,
): { readonly dx: number; readonly dy: number } {
  for (let i = 1; i <= steps; i += 1) {
    const at = { dx: (drag.dx * i) / steps, dy: (drag.dy * i) / steps };
    if (Math.hypot(at.dx, at.dy) > slop) return { dx: drag.dx - at.dx, dy: drag.dy - at.dy };
  }
  return { dx: 0, dy: 0 };
}

/** Half the size a pane is laid at (the manifest's: a laptop's page, its border and its head). */
const PANE_HALF = { w: 698.16 / 2, h: 461.94 / 2 } as const;

/** The viewport a size cuts at the laptop's density — the law's `viewportOf`, said again: whole CSS px, never under the floor. */
export function laptopViewport(rect: {
  readonly w: number;
  readonly h: number;
}): readonly [number, number] {
  const scale = PANE.laptop * PANE.mm;
  const w = Math.round((rect.w - 2 * PANE.border * PANE.mm) / scale);
  const h = Math.round((rect.h - (PANE.border + PANE.head) * PANE.mm) / scale);
  return [Math.max(w, PANE.min[0]), Math.max(h, PANE.min[1])];
}

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * The PAGE of a framed pane on screen: inside the clear border and under the engraved head (the law's `shapeOf` — the page
 * from 11 mm under the top edge to 5 mm over the foot, 5 mm in from each side), cut a further 4 % in. The frame is the pane's
 * silhouette about its centre — its own eye magnifies the outline a hair — so the scale is the frame's width over the rect's.
 */
export function pageRegion(frame: Rect, rect: { readonly w: number; readonly h: number }): Rect {
  const k = (frame.x1 - frame.x0) / Math.max(rect.w, 1e-6);
  const cx = (frame.x0 + frame.x1) / 2;
  const cy = (frame.y0 + frame.y1) / 2;
  const border = PANE.border * PANE.mm;
  const x0 = cx + (-rect.w / 2 + border) * k;
  const x1 = cx + (rect.w / 2 - border) * k;
  const y0 = cy + (-rect.h / 2 + PANE.head * PANE.mm) * k;
  const y1 = cy + (rect.h / 2 - border) * k;
  const ix = 0.04 * (x1 - x0);
  const iy = 0.04 * (y1 - y0);
  return { x0: x0 + ix, y0: y0 + iy, x1: x1 - ix, y1: y1 - iy };
}

/** A world rect as the door reads it (Position + Size). */
export interface DoorRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A face read back from a capture: px, distinct colours, luma range and mean. */
export interface FaceSeen {
  readonly px: number;
  readonly colors: number;
  readonly lumaRange: number;
  readonly lumaMean: number;
}

/** What the rows saw, whole. */
export interface PaneSeen {
  readonly laid: {
    readonly before: number;
    readonly after: number;
    readonly selected: number;
    readonly faulted: boolean;
    readonly folded: boolean;
    /** the laid pane overlaps no other object on the board (world rects) — its face is its own */
    readonly alone: boolean;
  };
  readonly face: {
    readonly day: FaceSeen | null;
    readonly night: FaceSeen | null;
    /** the page's region as captured (desk CSS px) */
    readonly page?: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  };
  readonly resize: {
    readonly before: DoorRect;
    readonly after: DoorRect;
    /** the head's viewport readout before and after, as the pane's witness says it */
    readonly saidBefore: readonly [number, number] | null;
    readonly saidAfter: readonly [number, number] | null;
    /** the drag on screen, the travel it made past ICE's dead zone, and the zoom it was made at (CSS px a world unit) */
    readonly dragged: { readonly dx: number; readonly dy: number };
    readonly travel: { readonly dx: number; readonly dy: number };
    readonly zoom: number;
  };
  readonly device: {
    readonly after: DoorRect;
    readonly afterDevice: string | null;
    readonly said: readonly [number, number] | null;
    readonly undone: DoorRect;
    readonly undoneDevice: string | null;
  };
  readonly hand: {
    readonly held: boolean;
    readonly settled: boolean;
    /** the kind's word in hand as ICE's anchor carries it, and as the held bar PRINTS it */
    readonly word: string | null;
    readonly readout: string | null;
    /** the held bar's tools as shown: id and whether it is dim (declared only) */
    readonly tools: readonly { readonly id: string; readonly dim: boolean }[];
    readonly down: boolean;
    readonly selectedAfter: number;
  };
}

const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;
const centre = (r: DoorRect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** LAID: one pane more, the one selection, its kind not faulted, the board folded. */
export function judgeLaid(seen: PaneSeen["laid"]): string[] {
  const problems: string[] = [];
  if (seen.after !== seen.before + 1)
    problems.push(
      `LAID: the take laid ${seen.after - seen.before} panes, not one (${seen.before} → ${seen.after})`,
    );
  if (seen.selected !== 1)
    problems.push(`LAID: ${seen.selected} selected after the take, not the one pane`);
  if (seen.faulted)
    problems.push("LAID: the pane's kind is refused or struck — not drawn as itself");
  if (!seen.folded) problems.push("LAID: the board stayed out after the take");
  if (!seen.alone)
    problems.push("LAID: the pane lies over another object — its face would not be its own");
  return problems;
}

/** FACE: the page by day — many colours, a wide contrast — and by night the page in the desk's dark scheme, darker than by day. */
export function judgeFace(seen: PaneSeen["face"]): string[] {
  const problems: string[] = [];
  for (const [when, face] of [
    ["by day", seen.day],
    ["by night", seen.night],
  ] as const) {
    if (face === null) {
      problems.push(`FACE: no capture answered ${when}`);
      continue;
    }
    if (face.colors < PANE.minColors || face.lumaRange < PANE.minLumaRange)
      problems.push(
        `FACE: ${when} the page is flat — ${face.colors} colours over a luma range of ${face.lumaRange} (≥ ${PANE.minColors}, ≥ ${PANE.minLumaRange})`,
      );
  }
  if (seen.day !== null && seen.day.lumaMean < PANE.minDayMean)
    problems.push(
      `FACE: by day the page is not the sample's light page (its mean luma ${seen.day.lumaMean}, ≥ ${PANE.minDayMean})`,
    );
  if (seen.day !== null && seen.night !== null && seen.night.lumaMean >= seen.day.lumaMean * 0.75)
    problems.push(
      `FACE: by night the page is no darker than by day (its mean luma ${seen.night.lumaMean} against the day's ${seen.day.lumaMean})`,
    );
  return problems;
}

/** RESIZE: the size grows by the drag's travel (its top-left held), and the head's readout follows — the viewport the new size cuts. */
export function judgeResize(seen: PaneSeen["resize"]): string[] {
  const problems: string[] = [];
  const { before, after, zoom } = seen;
  const want = { w: before.w + seen.travel.dx / zoom, h: before.h + seen.travel.dy / zoom };
  // the zoom is read off the frame — the pane's silhouette, its own eye's hair past the rect — so to a few CSS px
  const eps = 6 / zoom;
  if (!near(after.w, want.w, eps) || !near(after.h, want.h, eps))
    problems.push(
      `RESIZE: the size is ${after.w.toFixed(1)} × ${after.h.toFixed(1)}, not the ${want.w.toFixed(1)} × ${want.h.toFixed(1)} the drag's travel makes (±${eps.toFixed(1)})`,
    );
  if (!near(after.x, before.x, 0.5) || !near(after.y, before.y, 0.5))
    problems.push(`RESIZE: the SE knob moved the top-left (${JSON.stringify({ before, after })})`);
  const cut = laptopViewport(after);
  if (seen.saidAfter === null) problems.push("RESIZE: the pane's witness says nothing of its head");
  else if (seen.saidAfter[0] !== cut[0] || seen.saidAfter[1] !== cut[1])
    problems.push(
      `RESIZE: the head reads ${seen.saidAfter.join(" × ")}, not the ${cut.join(" × ")} the new size cuts — the readout did not follow`,
    );
  if (
    seen.saidBefore !== null &&
    seen.saidAfter !== null &&
    seen.saidBefore.join() === seen.saidAfter.join()
  )
    problems.push(`RESIZE: the head's readout stayed ${seen.saidBefore.join(" × ")}`);
  return problems;
}

/** DEVICE: re-cut to the phone about its centre, the device written, the head at the phone's viewport — ONE ⌘Z takes all back. */
export function judgeDevice(resized: DoorRect, seen: PaneSeen["device"]): string[] {
  const problems: string[] = [];
  if (seen.afterDevice !== "phone")
    problems.push(`DEVICE: the act wrote device ${seen.afterDevice}, not phone`);
  if (!near(seen.after.w, PANE.phoneCut.w, 0.01) || !near(seen.after.h, PANE.phoneCut.h, 0.01))
    problems.push(
      `DEVICE: the size is ${seen.after.w} × ${seen.after.h}, not the phone's cut ${PANE.phoneCut.w} × ${PANE.phoneCut.h}`,
    );
  const c0 = centre(resized);
  const c1 = centre(seen.after);
  if (!near(c0.x, c1.x, 0.5) || !near(c0.y, c1.y, 0.5))
    problems.push(`DEVICE: the re-cut moved the pane's centre (${JSON.stringify({ c0, c1 })})`);
  if (seen.said === null || seen.said.join() !== PANE.phoneViewport.join())
    problems.push(
      `DEVICE: the head reads ${seen.said?.join(" × ") ?? "nothing"}, not the phone's 402 × 874`,
    );
  if (seen.undoneDevice !== "laptop")
    problems.push(
      `DEVICE: one ⌘Z left the device ${seen.undoneDevice} — the switch was not one transaction`,
    );
  if (
    !near(seen.undone.w, resized.w, 0.01) ||
    !near(seen.undone.h, resized.h, 0.01) ||
    !near(seen.undone.x, resized.x, 0.01) ||
    !near(seen.undone.y, resized.y, 0.01)
  )
    problems.push(
      `DEVICE: one ⌘Z did not take the size and place back with the device (${JSON.stringify({ resized, undone: seen.undone })}) — not one transaction`,
    );
  return problems;
}

/** HAND: picked up, settled, the address printed in the held bar, its five tools live (PT-3); Esc puts it down, still selected. */
export function judgeHand(seen: PaneSeen["hand"]): string[] {
  const problems: string[] = [];
  if (!seen.held) problems.push("HAND: ⏎ did not pick the pane up");
  else if (!seen.settled) problems.push("HAND: the pick-up never settled");
  if (seen.readout !== PANE.display)
    problems.push(
      `HAND: the held bar prints ${JSON.stringify(seen.readout)}, not the address ${PANE.display}`,
    );
  const ids = seen.tools.map((t) => t.id);
  if (ids.join() !== PANE.tools.join())
    problems.push(
      `HAND: the held tools are ${ids.join(", ") || "none"}, not ${PANE.tools.join(", ")}`,
    );
  const dim = seen.tools.filter((t) => t.dim).map((t) => t.id);
  if (dim.length > 0)
    problems.push(
      `HAND: ${dim.join(", ")} shown dim — declared only, though PT-3's held tools work`,
    );
  if (!seen.down) problems.push("HAND: Esc did not put the pane down");
  if (seen.selectedAfter !== 1)
    problems.push(`HAND: put down, ${seen.selectedAfter} selected — not the pane still`);
  return problems;
}

export interface PaneRowsDriver {
  readonly win: BrowserWindow;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The board as the rows read it (the tray's anchor and the specimens as the desk drew them), the desk's place in the window. */
const READ_BOARD = `(() => {
  const b = globalThis.__vfDesk.pegboard();
  const el = document.querySelector("[data-desk]")?.getBoundingClientRect();
  return b === null ? null : {
    open: b.anchor.open,
    category: b.anchor.category,
    specimens: b.specimens.map((s) => ({ type: s.type, object: s.object })),
    desk: { left: el?.left ?? 0, top: el?.top ?? 0 },
  };
})()`;

/** A point of the desk where nothing picks in a region round it, the desk's own element under it (desk CSS px). */
const BARE = (region: number): string => `(() => {
  const d = globalThis.__vfDesk; const el = document.querySelector("[data-desk]");
  const r = el.getBoundingClientRect(); const half = ${region} / 2;
  for (let y = 120 + half; y < r.height - half - 40; y += 20) for (let x = half + 40; x < r.width - half - 40; x += 20) {
    let clear = true;
    for (let dy = -half; dy <= half && clear; dy += 20) for (let dx = -half; dx <= half && clear; dx += 20)
      if (d.pick({ x: x + dx, y: y + dy }) !== null) clear = false;
    if (!clear) continue;
    const under = document.elementFromPoint(r.left + x, r.top + y);
    if (under !== null && el.contains(under)) return { x, y };
  }
  return null;
})()`;

/** Every object's world rect on the board but the panes' (the door's census, each type's rows). */
const OTHERS = `(() => {
  const d = globalThis.__vfDesk; const out = [];
  for (const type of Object.keys(d.census())) if (type !== ${JSON.stringify("vibefield.browser-pane")}) for (const o of d.objects(type)) out.push(o.rect);
  return out;
})()`;

/**
 * A point where a press PANS (nothing takes it — the bare mat, or a calendar's paper, which pans too) from which a drag by
 * (dx, dy) stays inside the desk (desk CSS px).
 */
export const BARE_FOR = (dx: number, dy: number): string => `(() => {
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

/** Whether two world rects overlap. */
export const overlaps = (a: DoorRect, b: DoorRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A region of the desk captured without the marks, read back as a face (in the renderer: a bitmap never crosses). */
const FACE = (rect: {
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
  const colors = new Set(); let lo = 255, hi = 0, sum = 0;
  for (let i = 0; i < b.length; i += 4) {
    colors.add(((b[i] >> 3) << 10) | ((b[i + 1] >> 3) << 5) | (b[i + 2] >> 3));
    const l = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
    if (l < lo) lo = l; if (l > hi) hi = l; sum += l;
  }
  return { px: w * h, colors: colors.size, lumaRange: Math.round(hi - lo), lumaMean: Math.round(sum / Math.max(1, w * h)) };
})()`;

/** The held bar's tools as shown: each slot's id and whether it is dim (declared only — ICE's bar marks it). */
const READ_HAND_TOOLS = `(() => {
  const row = document.querySelector('[data-selection-bar] [data-face-row="hand"]');
  return [...(row?.querySelectorAll("[data-tool]") ?? [])].map((el) => ({
    id: el.getAttribute("data-tool"),
    dim: el.getAttribute("data-look") === "faint" && el.getAttribute("aria-disabled") === "true",
  }));
})()`;

/** A pane as the door's `objects(type)` reads it. */
export interface PaneRow {
  readonly entity: number;
  /** The object's durable key in the open document — the same pane across a reload (PT-2). */
  readonly key: string | null;
  readonly props: Record<string, unknown>;
  readonly rect: DoorRect;
}

/** The person's hands on the window and the door's reads — the pane's rows' (PT-1) and the live page's (PT-2). */
export interface PaneHands {
  js<T>(expression: string): Promise<T>;
  /** Polls `expression` until it answers true, or throws in words after `timeoutMs`. */
  until(label: string, timeoutMs: number, expression: string): Promise<void>;
  move(x: number, y: number): void;
  press(at: { x: number; y: number }, clickCount?: number): Promise<void>;
  /** A press-drag-release by the primary button, in steps. */
  drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps?: number,
    holdMs?: number,
  ): Promise<void>;
  key(keyCode: string, modifiers?: ("meta" | "control")[]): Promise<void>;
  undoKey(): Promise<void>;
  pressSelector(selector: string): Promise<void>;
  /** The panes on the board. */
  census(): Promise<number>;
  /** The panes on the board as the door reads them: each one's entity, its durable key (PT-2), props and rect. */
  rows(): Promise<PaneRow[]>;
  said(e: number): Promise<readonly [number, number] | null>;
  deskAt(): Promise<{ left: number; top: number }>;
  /** The selection's frame on screen (the brackets stand 6 out of it), desk CSS px. */
  frame(): Promise<Rect | null>;
  theme(name: "light" | "dark"): Promise<void>;
  shoot(name: string, r: Rect): Promise<void>;
}

export function paneHands(d: PaneRowsDriver): PaneHands {
  const { win } = d;
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
  const move = (x: number, y: number): void =>
    win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x), y: Math.round(y) });
  const press = async (at: { x: number; y: number }, clickCount = 1): Promise<void> => {
    move(at.x, at.y);
    await sleep(40);
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: Math.round(at.x),
      y: Math.round(at.y),
      button: "left",
      clickCount,
    });
    await sleep(50);
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: Math.round(at.x),
      y: Math.round(at.y),
      button: "left",
      clickCount,
    });
  };
  /** A press-drag-release by the primary button, in steps. */
  const drag = async (
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps = 12,
    holdMs = 0,
  ): Promise<void> => {
    move(from.x, from.y);
    await sleep(60);
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: Math.round(from.x),
      y: Math.round(from.y),
      button: "left",
      clickCount: 1,
    });
    await sleep(60);
    for (let i = 1; i <= steps; i += 1) {
      win.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(from.x + ((to.x - from.x) * i) / steps),
        y: Math.round(from.y + ((to.y - from.y) * i) / steps),
        button: "left",
        modifiers: ["leftbuttondown"],
      });
      await sleep(30);
    }
    if (holdMs > 0) await sleep(holdMs);
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: Math.round(to.x),
      y: Math.round(to.y),
      button: "left",
      clickCount: 1,
    });
  };
  const key = async (keyCode: string, modifiers: ("meta" | "control")[] = []): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await sleep(100);
  };
  const undoKey = (): Promise<void> =>
    key("z", [process.platform === "darwin" ? "meta" : "control"]);
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
  const census = async (): Promise<number> =>
    (await js<Record<string, number>>("globalThis.__vfDesk.census()"))[PANE.type] ?? 0;
  const rows = (): Promise<PaneRow[]> =>
    js(`globalThis.__vfDesk.objects(${JSON.stringify(PANE.type)})`);
  const said = async (e: number): Promise<readonly [number, number] | null> =>
    js(`globalThis.__vfDesk.local(${JSON.stringify(PANE.type)})?.said?.(${e})?.viewport ?? null`);
  const deskAt = (): Promise<{ left: number; top: number }> =>
    js(
      `(() => { const r = document.querySelector("[data-desk]").getBoundingClientRect(); return { left: r.left, top: r.top }; })()`,
    );
  /** The selection's frame on screen (the brackets stand 6 out of it), desk CSS px. */
  const frame = async (): Promise<Rect | null> => {
    const box = await js<Rect | null>("globalThis.__vfDesk.anchor()?.box ?? null");
    return box === null ? null : { x0: box.x0 + 6, y0: box.y0 + 6, x1: box.x1 - 6, y1: box.y1 - 6 };
  };
  const theme = async (name: "light" | "dark"): Promise<void> => {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    await until(
      `the desk dressed ${name}`,
      10_000,
      `globalThis.__vfDesk.theme() === ${JSON.stringify(name)}`,
    );
    await sleep(700);
  };
  const shoot = async (name: string, r: Rect): Promise<void> => {
    if (d.shotDir === undefined) return;
    const at = await deskAt();
    const m = 36;
    mkdirSync(d.shotDir, { recursive: true });
    const image = await win.capturePage({
      x: Math.max(0, Math.floor(at.left + r.x0 - m)),
      y: Math.max(0, Math.floor(at.top + r.y0 - m)),
      width: Math.ceil(r.x1 - r.x0 + 2 * m),
      height: Math.ceil(r.y1 - r.y0 + 2 * m),
    });
    writeFileSync(join(d.shotDir, name), image.toPNG());
  };

  return {
    js,
    until,
    move,
    press,
    drag,
    key,
    undoKey,
    pressSelector,
    census,
    rows,
    said,
    deskAt,
    frame,
    theme,
    shoot,
  };
}

/** Where a laid pane stands: the window's view and the desk's place in it (CSS px). */
export interface LaidAt {
  readonly view: { readonly w: number; readonly h: number };
  readonly deskOff: { readonly left: number; readonly top: number };
}

/**
 * CLEAR GROUND then LAID (the header's first row): the pane taken off the pegboard by the pointer and dropped alone on clear
 * ground at actual size. `onPane` hears the new pane the moment it is found, so a later step that throws leaves it to the
 * caller to delete.
 */
export async function layPane(
  h: PaneHands,
  before: number,
  onPane: (e: number) => void,
): Promise<LaidAt & { readonly laid: PaneSeen["laid"]; readonly pane: number | undefined }> {
  const { js, until, drag, key, pressSelector, census, rows, deskAt } = h;

  // ── CLEAR GROUND: actual size (⌘0, the head's zoom act), then the view panned — drags on the bare mat (or a calendar's
  // paper: a press there pans too), each held before its release so no inertia carries the pan on — until the drop point
  // stands over ground 600 units clear of every object on the board: found in WORLD units, each object's rect and the
  // camera off the door — never by a pick, which a calendar's paper does not answer ──────────────────────────────────────
  await key("Escape");
  const view = await js<{ w: number; h: number }>("({ w: innerWidth, h: innerHeight })");
  const deskOff = await deskAt();
  await key("0", [process.platform === "darwin" ? "meta" : "control"]);
  await until(
    "the desk at actual size",
    5_000,
    `document.querySelector(".vf-head-zoom")?.getAttribute("aria-label") === "Zoom, 100%"`,
  );
  await sleep(600);
  const deskSize = await js<{ w: number; h: number }>(
    `(() => { const r = document.querySelector("[data-desk]").getBoundingClientRect(); return { w: r.width, h: r.height }; })()`,
  );
  const drop = { x: Math.round(deskSize.w / 2), y: Math.round(deskSize.h * 0.36) };
  const others = await js<DoorRect[]>(OTHERS);
  // every object's rect, in whichever canvas it lies (a mini mat's inside included) — the union only grows by them
  const right = Math.max(...others.map((r) => r.x + r.w));
  const top = Math.min(...others.map((r) => r.y));
  const foot = Math.max(...others.map((r) => r.y + r.h));
  const ground = { x: right + 600 + PANE_HALF.w, y: (top + foot) / 2 };
  /** Where the ground stands on screen against the drop point (desk CSS px). */
  const offBy = async (): Promise<{ dx: number; dy: number }> => {
    const c = await js<{ x: number; y: number; zoom: number }>("globalThis.__vfDesk.camera()");
    return { dx: (ground.x - c.x) * c.zoom - drop.x, dy: (ground.y - c.y) * c.zoom - drop.y };
  };
  let off = await offBy();
  // within 60 px is near enough (the ground is 600 clear): a drag shorter than ICE's 10-px dead zone does not pan at all
  for (let i = 0; i < 24 && Math.hypot(off.dx, off.dy) > 60; i += 1) {
    const step = {
      dx: Math.max(-500, Math.min(500, off.dx)),
      dy: Math.max(-300, Math.min(300, off.dy)),
    };
    const mat = await js<{ x: number; y: number } | null>(BARE_FOR(-step.dx, -step.dy));
    if (mat === null) throw new Error("no bare mat to pan the desk from");
    const from = { x: deskOff.left + mat.x, y: deskOff.top + mat.y };
    await drag(from, { x: from.x - step.dx, y: from.y - step.dy }, 8, 300);
    await sleep(500);
    off = await offBy();
  }
  if (Math.hypot(off.dx, off.dy) > 60)
    throw new Error(`the view never reached the clear ground (${JSON.stringify(off)} to go)`);

  // ── LAID: the Browser specimen taken off the PORTALS chip by the pointer, dropped on the clear ground ────────────
  const known = new Set((await rows()).map((r) => r.entity));
  await pressSelector(".vf-line-create");
  await until("the board out", 5_000, "globalThis.__vfDesk.pegboard()?.anchor.open === true");
  // the chip pressed once the board's slide is done: `open` is said from the slide's start, its chips still under the view
  const slid = (): Promise<void> =>
    until(
      "the board's slide done",
      5_000,
      `(() => { const b = globalThis.__vfDesk.pegboard(); return b !== null && b.anchor.open && (b.anchor.drawer?.p ?? 0) >= 0.999; })()`,
    );
  await slid();
  await sleep(200);
  await pressSelector(`.vf-pegboard-track button[data-id="${PANE.category}"]`);
  try {
    await until(
      "the board on its portals",
      5_000,
      `globalThis.__vfDesk.pegboard()?.anchor.category === ${JSON.stringify(PANE.category)}`,
    );
  } catch (error) {
    const chips =
      await js(`[...document.querySelectorAll(".vf-pegboard-track button[data-id]")].map((b) => {
      const r = b.getBoundingClientRect();
      return [b.getAttribute("data-id"), Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
    })`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} (the chips: ${JSON.stringify(chips)}; the view ${JSON.stringify(await js("[innerWidth, innerHeight]"))})`,
    );
  }
  await slid();
  await sleep(350);
  const board = await js<{
    specimens: { type: string; object: Rect }[];
    desk: { left: number; top: number };
  } | null>(READ_BOARD);
  const hung = board?.specimens.find((s) => s.type === PANE.type);
  if (board === null || hung === undefined)
    throw new Error("the board hangs no Browser on its portals chip");
  await drag(
    {
      x: board.desk.left + (hung.object.x0 + hung.object.x1) / 2,
      y: board.desk.top + (hung.object.y0 + hung.object.y1) / 2,
    },
    { x: board.desk.left + drop.x, y: board.desk.top + drop.y },
    12,
    350,
  );
  const deadline = Date.now() + 5_000;
  while ((await census()) === before && Date.now() < deadline) await sleep(60);
  await sleep(700);
  const pane = (await rows()).find((r) => !known.has(r.entity))?.entity;
  if (pane !== undefined) onPane(pane);
  const laidAt = (await rows()).find((r) => r.entity === pane)?.rect;
  const othersNow = await js<DoorRect[]>(OTHERS);
  const laid: PaneSeen["laid"] = {
    before,
    after: await census(),
    selected: await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0"),
    faulted: await js<boolean>(
      `(globalThis.__vfDesk.status().faults ?? []).some((f) => f.kind === ${JSON.stringify(PANE.type)})`,
    ),
    folded: await js<boolean>("globalThis.__vfDesk.pegboard()?.anchor.open === false"),
    alone: laidAt !== undefined && !othersNow.some((r) => overlaps(laidAt, r)),
  };
  return { laid, pane, view, deskOff };
}

/** The laid pane brought to the middle of the view by drags on the bare mat (the FACE row's first step). */
export async function paneToMiddle(h: PaneHands, e: number, at: LaidAt): Promise<void> {
  const { js, drag, rows, frame } = h;
  const { view, deskOff } = at;
  // ── the pane brought to the middle by a drag on the bare mat ──────────────────────────────────────────────────
  for (let i = 0; i < 3; i += 1) {
    const f = await frame();
    if (f === null) break;
    const by = {
      dx: view.w / 2 - (deskOff.left + (f.x0 + f.x1) / 2),
      dy: view.h / 2 - (deskOff.top + (f.y0 + f.y1) / 2),
    };
    if (Math.hypot(by.dx, by.dy) < 24) break;
    const mat = await js<{ x: number; y: number } | null>(BARE(40));
    if (mat === null) break;
    const from = { x: deskOff.left + mat.x, y: deskOff.top + mat.y };
    await drag(from, { x: from.x + by.dx, y: from.y + by.dy }, 6);
    await sleep(400);
    // a drag on the mat may have let the selection go: take it again by a click on the pane's head
    if ((await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0")) === 0) {
      const r = (await rows()).find((x) => x.entity === e);
      if (r === undefined) break;
    }
  }
}

/** PT-1's rows (above). Returns the problems, each in words. */
export async function browserPaneRows(d: PaneRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const h = paneHands(d);
  const {
    js,
    until,
    press,
    drag,
    key,
    undoKey,
    pressSelector,
    census,
    rows,
    said,
    frame,
    theme,
    shoot,
  } = h;
  const problems: string[] = [];
  const ambient = await js<string>("globalThis.__vfDesk.ambient()");
  const themeWas = await js<string>("globalThis.__vfDesk.theme()");
  await theme("light");
  await js(`globalThis.__vfDesk.ambient("still")`);
  let pane: number | undefined;
  const before = await census();
  try {
    const at = await layPane(h, before, (e) => {
      pane = e;
    });
    const { laid, deskOff } = at;
    problems.push(...judgeLaid(laid));
    if (at.pane === undefined) throw new Error("no new pane on the board after the take");
    const e = at.pane;

    await paneToMiddle(h, e, at);
    // at actual size the pane is about three fifths of the view: framed as it lies, its bar and the line clear of it
    const width = (f: Rect | null): number => (f === null ? 0 : f.x1 - f.x0);
    await sleep(500);
    const f0 = await frame();
    if (f0 === null) throw new Error("the pane was not selected after it was framed");

    // ── FACE: the PAGE captured without the marks, by day and by night; the stills, whole ───────────────────────
    const laidRect = (await rows()).find((r) => r.entity === e)?.rect;
    if (laidRect === undefined) throw new Error("the pane left the board");
    const page = pageRegion(f0, laidRect);
    const region = { x: page.x0, y: page.y0, width: page.x1 - page.x0, height: page.y1 - page.y0 };
    const day = await js<FaceSeen | null>(FACE(region));
    await shoot("pt-1-pane-light.png", f0);
    await theme("dark");
    const night = await js<FaceSeen | null>(FACE(region));
    await shoot("pt-1-pane-dark.png", f0);
    await theme("light");
    const face: PaneSeen["face"] = { day, night, page: region };
    problems.push(...judgeFace(face));

    // ── RESIZE: the SE knob dragged by the pointer; Size grows, the readout follows ────────────────────────────
    const rect0 = (await rows()).find((r) => r.entity === e)?.rect;
    if (rect0 === undefined) throw new Error("the pane left the board");
    const saidBefore = await said(e);
    const zoom = width(f0) / Math.max(rect0.w, 1); // CSS px a world unit (the frame is the rect, magnified ~1 % by the pane's own eye)
    const knob = { x: deskOff.left + f0.x1 - 3, y: deskOff.top + f0.y1 - 2 };
    // held a moment before the release, as a hand does
    await drag(knob, { x: knob.x + PANE.drag.dx, y: knob.y + PANE.drag.dy }, PANE.dragSteps, 300);
    await sleep(900);
    const rect1 = (await rows()).find((r) => r.entity === e)?.rect;
    if (rect1 === undefined) throw new Error("the pane left the board in the resize");
    const resize: PaneSeen["resize"] = {
      before: rect0,
      after: rect1,
      saidBefore,
      saidAfter: await said(e),
      dragged: PANE.drag,
      travel: travelAfterSlop(PANE.drag, PANE.dragSteps, PANE.slop),
      zoom,
    };
    problems.push(...judgeResize(resize));
    const fResized = await frame();
    if (fResized !== null) await shoot("pt-1-pane-resized.png", fResized);

    // ── DEVICE: the bar's iPhone act; then ONE ⌘Z ──────────────────────────────────────────────────────────────
    await until(
      "the selection bar over the pane",
      10_000,
      `document.querySelector('[data-selection-bar] .vf-bar-row [data-act="act:device-phone"]') !== null && document.querySelector("[data-selection-bar]")?.getAttribute("data-shown") === "true"`,
    );
    await sleep(300);
    await pressSelector('[data-selection-bar] .vf-bar-row [data-act="act:device-phone"]');
    await sleep(900);
    const switched = (await rows()).find((r) => r.entity === e);
    const saidPhone = await said(e);
    const fPhone = await frame();
    if (fPhone !== null) await shoot("pt-1-pane-phone.png", fPhone);
    await undoKey();
    await sleep(900);
    const undone = (await rows()).find((r) => r.entity === e);
    const device: PaneSeen["device"] = {
      after: switched?.rect ?? { x: 0, y: 0, w: 0, h: 0 },
      afterDevice: (switched?.props.device as string | undefined) ?? null,
      said: saidPhone,
      undone: undone?.rect ?? { x: 0, y: 0, w: 0, h: 0 },
      undoneDevice: (undone?.props.device as string | undefined) ?? null,
    };
    problems.push(...judgeDevice(rect1, device));

    // ── HAND: the pane taken by a click on its page — the focus back on the desk, never left on the bar's last pressed cell
    // (⏎ there would press the cell again) — then ⏎ picks it up; its word, its tools; the still; Esc puts it down ─────
    const fHand = (await frame()) ?? fResized;
    const rHand = (await rows()).find((r) => r.entity === e)?.rect;
    if (fHand === null || rHand === undefined)
      throw new Error("the pane is not on screen for the pick-up");
    const pHand = pageRegion(fHand, rHand);
    await press({
      x: deskOff.left + (pHand.x0 + pHand.x1) / 2,
      y: deskOff.top + (pHand.y0 + pHand.y1) / 2,
    });
    await until(
      "the pane selected, its bar shown",
      10_000,
      `(() => { const b = document.querySelector("[data-selection-bar]"); return (globalThis.__vfDesk.anchor()?.count ?? 0) === 1 && b?.getAttribute("data-shown") === "true" && b?.getAttribute("data-face") === "selection"; })()`,
    );
    await sleep(300);
    await key("Return");
    let held = false;
    let settled = false;
    try {
      await until("the pane in hand", 10_000, `globalThis.__vfDesk.held()?.entity === ${e}`);
      held = true;
      await until(
        "the pick-up settled",
        10_000,
        "globalThis.__vfDesk.held()?.frame?.settled === true",
      );
      settled = true;
    } catch {
      /* said by the judge below */
    }
    await sleep(500);
    const word = await js<string | null>("globalThis.__vfDesk.anchor()?.held?.readout ?? null");
    const readout = await js<string | null>(
      `document.querySelector('[data-selection-bar] [data-face-row="hand"] [data-readout]')?.textContent ?? null`,
    );
    const tools = await js<{ id: string; dim: boolean }[]>(READ_HAND_TOOLS);
    if (held && d.shotDir !== undefined) {
      mkdirSync(d.shotDir, { recursive: true });
      writeFileSync(join(d.shotDir, "pt-1-pane-held.png"), (await win.capturePage()).toPNG());
    }
    await key("Escape");
    let down = false;
    try {
      await until("the pane put down", 10_000, "globalThis.__vfDesk.held() === null");
      down = true;
    } catch {
      /* said by the judge below */
    }
    await sleep(700);
    const hand: PaneSeen["hand"] = {
      held,
      settled,
      word,
      readout,
      tools,
      down,
      selectedAfter: await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0"),
    };
    problems.push(...judgeHand(hand));
    say(`SMOKE_CANVAS_PANE ${JSON.stringify({ laid, face, resize, device, hand })}`);
  } catch (error) {
    // a step that cannot go on ends the rows — never what the rows before it found (they are said with it)
    problems.push(`PT-1 PANE: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // the board as it was found: the pane deleted, the theme and the wind as they were
    try {
      if (pane !== undefined && (await js<boolean>(`globalThis.__vfDesk.held() === null`))) {
        if ((await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0")) === 1)
          await key("Backspace");
      }
      await sleep(500);
    } catch {
      /* a row that cannot go on ends the rows, never what the earlier rows found */
    }
    const after = await census();
    if (after !== before)
      problems.push(`CLEARED: ${after} panes on the board after the rows, not the ${before} found`);
    say(`SMOKE_CANVAS_PANE_CLEARED ${JSON.stringify({ before, after })}`);
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient)})`);
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(themeWas)})`);
  }
  return problems;
}
