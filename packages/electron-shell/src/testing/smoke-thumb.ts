// DK-17b — THE EXPLORER'S THUMBNAIL IS THE DOCUMENT'S PICTURE, NOT THE PERSON'S SELECTION (ICE I40's purpose; the lead's
// ruling 2026-10-08): `desk-stills.ts` asks ICE's capture door WITHOUT the selection's marks (`marks: false`). The
// product's own path, end to end, in smoke:canvas: an object selected and moved — a durable edit, so its save owes a
// still, taken at the desk's next rest with the selection STANDING — then the explorer's new picture read back and held,
// in the selection's own region, to two captures of the same resting frame: the desk without the marks (the thumbnail
// must match it) and with them (it must not; and the marks must show at a quarter, or the row proves nothing). The move
// is taken back (⌘Z) and the next still waited out, so no capture lands in a later row's window. The covers' still keeps
// its marks — a picture of the desk as it stood (DK-17b's reading, the lead's ruling).

import type { BrowserWindow } from "electron";
import { POINT_IN } from "./smoke-selection-bar";

/** What the thumbnail row may take as the same picture, and what the marks must amount to (px of the quarter still, a
 * channel off by more than 24). */
export const THUMB = {
  /** the kind moved and selected: a static one (a clock's minute turns the face) */
  type: "desk.photo",
  /** how far it is moved, CSS px */
  by: { dx: 48, dy: 0 },
  /** how long a still owed by the save may take (the ack, the next rest, the encode) */
  stillMs: 30_000,
  /** the thumbnail is the bare desk: this many px of the selection's region may differ (resampling, a hover) */
  maxBare: 4,
  /** the selection's marks show at a quarter: at least this many px of its region differ with them */
  minMarks: 20,
  /** around the brackets' box, CSS px (their stroke) */
  pad: 4,
} as const;

/** The thumbnail row's witness, read in the renderer. */
export interface ThumbSeen {
  /** a NEW still was kept after the move (the explorer's picture changed) */
  readonly fresh: boolean;
  /** the selection's count as the still was read back (the move keeps it) */
  readonly selected: number;
  /** the thumbnail's size and the captures' */
  readonly size: readonly number[] | null;
  /** px of the selection's region (the brackets' box and their stroke, at the still's scale) where… */
  readonly region: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  } | null;
  /** …the thumbnail differs from the desk captured WITHOUT the marks */
  readonly bare: number | null;
  /** …the desk captured WITH the marks differs from it without them (the marks, at a quarter) */
  readonly marks: number | null;
  /** …the thumbnail differs from the desk captured WITH the marks */
  readonly vsMarked: number | null;
}

/** A thumbnail taken while a selection stands is the desk without its marks. */
export function judgeThumb(seen: ThumbSeen): string[] {
  if (!seen.fresh) return ["no new thumbnail was kept after the move, the selection standing"];
  const problems: string[] = [];
  if (seen.selected < 1) problems.push("nothing stood selected as the thumbnail was taken");
  if (seen.marks === null || seen.marks < THUMB.minMarks)
    problems.push(
      `the selection's marks do not show at a quarter (${seen.marks} px) — nothing to tell the thumbnail by`,
    );
  if (seen.bare === null || seen.bare > THUMB.maxBare)
    problems.push(
      `the thumbnail is not the desk without the selection's marks (${seen.bare} px of its region differ)`,
    );
  if (seen.vsMarked !== null && seen.marks !== null && seen.vsMarked < seen.marks / 2)
    problems.push(
      `the thumbnail carries the selection's marks (${seen.vsMarked} px from the marked capture, the marks ${seen.marks})`,
    );
  return problems;
}

/** The open board's tile in the fields explorer — its picture, when it has one (smoke.ts `CURRENT_STILL`). */
const CURRENT_STILL = `.vf-head-explorer .vf-head-doc[aria-current="true"] img`;

/** The thumbnail and two captures of the resting desk — without the marks and with them — compared in the selection's
 * region, in the renderer (a bitmap never crosses `executeJavaScript`). */
const READ_THUMB = `(async () => {
  const d = globalThis.__vfDesk;
  const img = document.querySelector(${JSON.stringify(CURRENT_STILL)});
  const anchor = d.anchor();
  if (img === null || !img.complete || img.naturalWidth === 0 || anchor === null || anchor.box === null) return null;
  const w = img.naturalWidth, h = img.naturalHeight;
  const bareBitmap = await d.capture({ scale: 0.25, marks: false });
  const markedBitmap = await d.capture({ scale: 0.25 });
  if (bareBitmap === undefined || markedBitmap === undefined) { bareBitmap?.close(); markedBitmap?.close(); return null; }
  const size = [w, h, bareBitmap.width, bareBitmap.height];
  const read = (src) => {
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext("2d");
    x.drawImage(src, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  };
  const thumb = read(img), bare = read(bareBitmap), marked = read(markedBitmap);
  bareBitmap.close(); markedBitmap.close();
  const k = w / anchor.view.width;
  const pad = ${THUMB.pad};
  const region = {
    x0: Math.max(0, Math.floor((anchor.box.x0 - pad) * k)),
    y0: Math.max(0, Math.floor((anchor.box.y0 - pad) * k)),
    x1: Math.min(w, Math.ceil((anchor.box.x1 + pad) * k)),
    y1: Math.min(h, Math.ceil((anchor.box.y1 + pad) * k)),
  };
  const differ = (a, b) => {
    let n = 0;
    for (let y = region.y0; y < region.y1; y += 1)
      for (let x = region.x0; x < region.x1; x += 1) {
        const i = (y * w + x) * 4;
        if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) n += 1;
      }
    return n;
  };
  return { selected: anchor.count, size, region, bare: differ(thumb, bare), marks: differ(marked, bare), vsMarked: differ(thumb, marked) };
})()`;

export interface ThumbRowDriver {
  readonly win: BrowserWindow;
  readonly say: (line: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A box in CSS px of the view (the selection's anchor). */
interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A point of the bare mat — the desk receives it and picks nothing there (smoke-desk-copy.ts's deselect). */
const BARE_MAT = `(() => {
  const d = globalThis.__vfDesk; const el = document.querySelector("[data-desk]");
  const r = el.getBoundingClientRect();
  for (let y = 140; y < r.height - 140; y += 24) for (let x = 80; x < r.width - 80; x += 24) {
    if (d.pick({ x, y }) !== null) continue;
    const under = document.elementFromPoint(r.left + x, r.top + y);
    if (under !== null && el.contains(under)) return { x: r.left + x, y: r.top + y };
  }
  return null;
})()`;

/** The thumbnail row (above). Returns the problems, each in words. */
export async function thumbnailRows(d: ThumbRowDriver): Promise<string[]> {
  const { win, say } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const until = async (label: string, timeoutMs: number, expression: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await js<unknown>(expression)) === true) return;
      await sleep(100);
    }
    throw new Error(`${label} did not happen within ${timeoutMs}ms`);
  };
  const key = async (keyCode: string, modifiers: ("meta" | "control")[] = []): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await sleep(80);
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
    await sleep(120);
  };
  const explorer = async (open: boolean): Promise<void> => {
    await js(
      `document.querySelector('.vf-head-chev[aria-expanded="${open ? "false" : "true"}"]')?.click()`,
    );
    await until(
      `the fields explorer ${open ? "open" : "shut"}`,
      10_000,
      `document.querySelector('.vf-head-chev[aria-expanded="${open ? "true" : "false"}"]') !== null`,
    );
  };
  /** The explorer's picture of the open board (its blob: URL), or "" — read with the explorer open. */
  const picture = async (): Promise<string> => {
    await explorer(true);
    // the board's picture loaded first (the explorer's tiles land as it opens): a "" would take ANY picture for new
    await until(
      "the board's picture in the explorer",
      15_000,
      `(() => { const img = document.querySelector(${JSON.stringify(CURRENT_STILL)}); return img !== null && img.complete && img.naturalWidth > 0; })()`,
    );
    const src = await js<string>(`document.querySelector(${JSON.stringify(CURRENT_STILL)}).src`);
    await explorer(false);
    return src;
  };
  /** A NEW picture than `before`, owed by a save and taken at the desk's rest — the explorer left open on it. */
  const newPicture = async (before: string): Promise<boolean> => {
    await explorer(true);
    try {
      await until(
        "a new still in the explorer",
        THUMB.stillMs,
        `(() => { const img = document.querySelector(${JSON.stringify(CURRENT_STILL)}); return img !== null && img.complete && img.naturalWidth > 0 && img.src !== ${JSON.stringify(before)}; })()`,
      );
      return true;
    } catch {
      return false;
    }
  };

  const before = await picture();
  const savedBefore = await js<number | null>("globalThis.__vfDesk.board().lastSavedAt");
  // selected, then moved: a press on its body, a drag, the button let go — one durable move, the selection standing
  const at = await js<{ x: number; y: number } | null>(POINT_IN(THUMB.type));
  if (at === null)
    return [`THUMB: the ${THUMB.type} was not picked where the desk receives a press`];
  const from = { x: Math.round(at.x), y: Math.round(at.y) };
  // selected first, by a tap where the desk receives it — a drag alone moves an object without selecting it — and its
  // box as it stood, the undo's witness below
  await press(from);
  await sleep(300);
  const stood = await js<Box | null>("globalThis.__vfDesk.anchor()?.box ?? null");
  win.webContents.sendInputEvent({ type: "mouseMove", x: from.x, y: from.y });
  await sleep(60);
  win.webContents.sendInputEvent({
    type: "mouseDown",
    x: from.x,
    y: from.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(60);
  for (const k of [0.15, 0.35, 0.55, 0.75, 0.9, 1]) {
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(from.x + THUMB.by.dx * k),
      y: Math.round(from.y + THUMB.by.dy * k),
      button: "left",
      modifiers: ["leftbuttondown"],
    });
    await sleep(40);
  }
  const to = { x: from.x + THUMB.by.dx, y: from.y + THUMB.by.dy };
  win.webContents.sendInputEvent({
    type: "mouseUp",
    x: to.x,
    y: to.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(300);
  const landed = await js<{ x: number; y: number } | null>(POINT_IN(THUMB.type));
  const movedBy =
    landed === null
      ? null
      : { dx: Math.round(landed.x - from.x), dy: Math.round(landed.y - from.y) };
  // the still's own conditions, waited with the explorer SHUT (the head's sheet is not the desk): the move's save
  // acknowledged (`board().lastSavedAt` past the one before), then the desk at rest — the owed still is taken at its next
  // look (`REST_POLL_MS` 400) and kept; then the explorer opened on the board's new picture
  const waited = Date.now();
  let saved: number | null = savedBefore;
  try {
    await until(
      "the move's save acknowledged",
      THUMB.stillMs,
      `(() => { const b = globalThis.__vfDesk.board(); return b.lastSavedAt !== null && b.lastSavedAt !== ${JSON.stringify(savedBefore)}; })()`,
    );
    saved = await js<number | null>("globalThis.__vfDesk.board().lastSavedAt");
    await until(
      "the desk at rest after the save",
      THUMB.stillMs,
      "globalThis.__vfDesk.rest().asleep === true",
    );
  } catch {
    // said below: the record carries what came and what did not
  }
  const waitedMs = Date.now() - waited;
  const fresh = await newPicture(before);
  const facts = fresh ? await js<Omit<ThumbSeen, "fresh"> | null>(READ_THUMB) : null;
  await explorer(false);
  const seen: ThumbSeen =
    facts === null
      ? {
          fresh: false,
          selected: 0,
          size: null,
          region: null,
          bare: null,
          marks: null,
          vsMarked: null,
        }
      : { fresh, ...facts };
  say(
    `SMOKE_CANVAS_THUMB ${JSON.stringify({ ...seen, movedBy, saved: { before: savedBefore, after: saved }, waitedMs, rest: await js("globalThis.__vfDesk.rest()") })}`,
  );
  const problems = judgeThumb(seen).map((p) => `THUMB: ${p}`);
  // the move taken back by the desk's own undo (the desk holds the keyboard since the tap) — the selection's box back where
  // it stood — then the selection let go (Esc, and a press on the bare mat), and the still that owes waited out, so no
  // capture lands in a later row's window
  const moved = await picture();
  await key("z", [process.platform === "darwin" ? "meta" : "control"]);
  await sleep(300);
  const back = await js<Box | null>("globalThis.__vfDesk.anchor()?.box ?? null");
  if (
    stood === null ||
    back === null ||
    Math.abs(back.x0 - stood.x0) > 2 ||
    Math.abs(back.y0 - stood.y0) > 2
  )
    problems.push(`THUMB: ⌘Z did not take the move back (${JSON.stringify({ stood, back })})`);
  await key("Escape");
  await key("Escape");
  if ((await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0")) > 0) {
    const mat = await js<{ x: number; y: number } | null>(BARE_MAT);
    if (mat !== null) await press(mat);
  }
  if (!(await newPicture(moved))) problems.push("THUMB: the undo's still never came");
  await explorer(false);
  return problems;
}
