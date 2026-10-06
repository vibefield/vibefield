// DK-14 — SEND TO…, IN THE PRODUCT (smoke:canvas; DESIGN.md §8 "Send to…", "The missing face", the line's chip; R15, R25;
// DK-D26; plan addenda (50), (56)). It ONLY DRAFTS: pressed on the bar, in the bar grown into its menu, or on the tools in
// hand, the selection becomes ONE chip in the line's draft. Each row presses the real chrome where it stands and reads back
// off the DOM the line drew, off a page-side recorder (the flier's own transition events and its box every frame, the
// moment the chip and @'s list appear, the bar's `data-shown`), and off the desk's door (`__vfDesk.sent()` — the act's
// record: the chip's face, what it carries, the capture's rect, the still's size, the marks hidden and put back):
//   NOTE    — a line written on the note, the note sent from the BAR: the chip wears its paper and its ink, `snippets` and
//             its first 24 characters (24 tall, corners 7, 12.5/500, the glyph 13); the draft focused, the @ typed so @'s
//             list is open, the caret after it; the FLIGHT — one transform transition on the island curve over 560 ms, from
//             the selection's middle at 1.25 to the chip's place at 0.86 on a straight line; the @ 180 ms after the chip
//             lands; the STILL attached, the anchor's box less the brackets' 6 at the view's device px, the selection
//             cleared before it and put back after; the bar away from the press while the list is open, back 200 ms
//             after it folds;
//   CLOCK   — any other kind: its NAME, no glyph ("Clock");
//   TWO     — the clock and the note, sent from the bar grown into its MENU: `package` and "2 objects", both carried;
//   HAND    — the notebook IN HAND, sent from the tools in hand: the object stays in hand, the tools stay under the head,
//             the chip flies from where the desk DRAWS it (`__vfDesk.held()`);
//   MISSING — the clock's plugin off, its missing face sent: its type's name ("Clock"), a still of the hatched card;
//   REDUCED — reduced motion emulated: no flight — the chip fades in at the caret, the @ after it;
//   COUNTERS — the bar's placements ≤ the anchor's publishes through all of it.
// The stills: dk-14-chip-{light,dark}.png (the line with the note's chip and @'s list open), dk-14-flight.png (the window,
// the note's chip in flight).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { type BarCounters, judgeCounters, POINT_IN } from "./smoke-selection-bar";

/** The canon's numbers for Send to… (§8 "Send to…", the line's chip). */
export const SEND = {
  flightMs: 560,
  fromScale: 1.25,
  toScale: 0.86,
  atAfterMs: 180,
  backMs: 200,
  brackets: 6,
  chip: { height: 24, radius: 7, font: "12.5px", weight: "500", glyph: 13 },
  chars: 24,
} as const;

/** The note's line the NOTE row writes, and the chip it must wear: its first 24 characters, cut with "…". */
export const NOTE_LINE = "Ship the desk by Friday, then the covers and presence";
export const NOTE_LABEL = "Ship the desk by Friday,…";
/** The note's paper and ink as the palette gives them (ICE's `deskPalette`: `--vf-note-surface`, the fountain pen). */
export const NOTE_PAPER = "rgb(246, 231, 169)";
export const NOTE_INK = "rgb(38, 74, 154)";

const CLOCK = "vibefield.example.desk-clock";

/** A box on screen, CSS px. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A chip in the draft, as the DOM shows it. */
export interface ChipSeen {
  readonly kind: string | null;
  /** The face's glyph as drawn (its own svg), or null with none. */
  readonly glyph: string | null;
  readonly label: string;
  readonly paper: boolean;
  readonly background: string;
  readonly color: string;
  readonly still: string | null;
  readonly title: string;
  readonly height: number;
  readonly radius: string;
  readonly font: string;
  readonly weight: string;
  readonly glyphSize: number | null;
  readonly rect: Box;
  readonly transition: string;
}

/** The line as the DOM shows it. */
export interface LineSeen {
  readonly text: string;
  readonly chips: readonly ChipSeen[];
  readonly focused: boolean;
  readonly atOpen: boolean;
  readonly sendArmed: boolean;
  /** The caret in the draft: the text from the last chip to the caret, and whether it is at the draft's end. */
  readonly caret: { readonly afterChip: string; readonly atEnd: boolean } | null;
  readonly aim: string | null;
}

/** One frame of the flier, as the recorder saw it. */
export interface FlierSample {
  readonly t: number;
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
  readonly opacity: number;
}

/** A transition event on the flier. */
export interface FlierEvent {
  readonly type: "transitionstart" | "transitionend" | "transitioncancel";
  readonly property: string;
  readonly t: number;
  readonly duration: string;
  readonly timing: string;
}

/** What the page-side recorder saw from the press on. */
export interface SendRecorded {
  readonly t0: number;
  readonly events: readonly FlierEvent[];
  readonly samples: readonly FlierSample[];
  /** when the desk chip first stood in the draft, and when @'s list first stood open */
  readonly chipAt: number | null;
  readonly atAt: number | null;
  /** when @'s list, once open, stood folded again */
  readonly atGoneAt: number | null;
  /** the chip's transition as it first stood, computed — property and duration (reduced motion: its fade) */
  readonly chipTransition: string | null;
  readonly bar: readonly { readonly t: number; readonly shown: string | null }[];
}

/** The act's record (`__vfDesk.sent()`), as the rows read it. */
export interface SentSeen {
  readonly from: string;
  readonly label: string;
  readonly glyph: string | null;
  readonly paper: string | null;
  readonly ink: string | null;
  readonly objects: readonly {
    readonly type: string;
    readonly name: string;
    readonly text: string | null;
  }[];
  readonly fromBox: Box;
  readonly rect: Box | null;
  readonly marks: { readonly cleared: boolean; readonly restored: boolean };
  readonly taken: boolean;
  readonly aimed: boolean | null;
  readonly reduced: boolean | null;
  readonly still: {
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
  } | null;
  readonly at: { readonly pressed: number; readonly landed?: number; readonly typed?: number };
}

const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;
/** A frame's slack and a little: the recorder samples on frames (120 Hz here, 60 under load). */
const SLACK_MS = 40;

/** The chip's face and its size by the canon (§8: 24 tall, corners 7, 12.5/500, the glyph 13). */
export function judgeChip(
  chip: ChipSeen | undefined,
  want: { glyph: string | null; label: string; paper?: string; ink?: string },
): string[] {
  if (chip === undefined) return ["no chip stood in the draft"];
  const problems: string[] = [];
  if (chip.kind !== "desk") problems.push(`the chip is a ${chip.kind}, not the desk's`);
  if (chip.label !== want.label)
    problems.push(
      `the chip reads ${JSON.stringify(chip.label)}, not ${JSON.stringify(want.label)}`,
    );
  if (chip.glyph !== want.glyph)
    problems.push(`the chip wears ${chip.glyph ?? "no glyph"}, not ${want.glyph ?? "no glyph"}`);
  if (want.paper !== undefined && chip.background !== want.paper)
    problems.push(`the chip's paper is ${chip.background}, not ${want.paper}`);
  if (want.ink !== undefined && chip.color !== want.ink)
    problems.push(`the chip's ink is ${chip.color}, not ${want.ink}`);
  if (!near(chip.height, SEND.chip.height, 0.5))
    problems.push(`the chip is ${chip.height} tall, not 24`);
  if (chip.radius !== `${SEND.chip.radius}px`)
    problems.push(`its corners are ${chip.radius}, not 7px`);
  if (chip.font !== SEND.chip.font || chip.weight !== SEND.chip.weight)
    problems.push(`its words are ${chip.font}/${chip.weight}, not 12.5px/500`);
  if (want.glyph !== null && chip.glyphSize !== SEND.chip.glyph)
    problems.push(`its glyph is ${chip.glyphSize}, not 13`);
  return problems;
}

/** The draft after a chip landed un-aimed: focused, the @ typed after the chip, @'s list open, the caret after it. */
export function judgeTyped(line: LineSeen): string[] {
  const problems: string[] = [];
  if (!line.focused) problems.push("the draft was not focused");
  if (!line.atOpen) problems.push("@'s list was not open");
  if (line.caret === null) problems.push("the draft held no caret");
  else {
    if (line.caret.afterChip !== " @")
      problems.push(
        `after the chip the draft read ${JSON.stringify(line.caret.afterChip)}, not " @" (the @ typed after it)`,
      );
    if (!line.caret.atEnd) problems.push("the caret was not after the chip and its @");
  }
  return problems;
}

/** The scale a computed `matrix(a, b, c, d, e, f)` carries. */
export function matrixScale(transform: string): number {
  const m = /matrix\(([^)]+)\)/u.exec(transform);
  if (m === null) return 1;
  const [a = 1, b = 0] = (m[1] ?? "").split(",").map(Number);
  return Math.hypot(a, b);
}

/**
 * The flight by the canon: ONE transform transition on the flier, declared 560 ms on the island curve and run its course;
 * from the selection's middle at 1.25 to the chip's place at 0.86, shrinking all the way, on a straight line.
 */
export function judgeFlight(rec: SendRecorded, from: Box, landed: Box | null): string[] {
  const problems: string[] = [];
  const start = rec.events.find((e) => e.type === "transitionstart" && e.property === "transform");
  const end = rec.events.find(
    (e) =>
      (e.type === "transitionend" || e.type === "transitioncancel") && e.property === "transform",
  );
  if (start === undefined) return ["the chip never flew (no transform transition on the flier)"];
  const ms = start.duration
    .split(",")
    .map((d) => Number.parseFloat(d) * (d.trim().endsWith("ms") ? 1 : 1000));
  if (!ms.some((d) => near(d, SEND.flightMs, 1)))
    problems.push(`the flight declared ${start.duration}, not 560ms`);
  if (!/cubic-bezier\(0\.25,\s*1,\s*0\.3,\s*1\)/u.test(start.timing))
    problems.push(`the flight's curve is ${start.timing}, not the island's`);
  if (end === undefined) problems.push("the flight never ran its course");
  else {
    if (end.type !== "transitionend")
      problems.push("the flight was cut short (`transitioncancel`)");
    if (!near(end.t - start.t, SEND.flightMs, SLACK_MS))
      problems.push(`the flight took ${(end.t - start.t).toFixed(0)} ms, not 560`);
  }
  const path = rec.samples;
  const first = path[0];
  const last = path[path.length - 1];
  if (first === undefined || last === undefined || path.length < 4)
    return [...problems, `the flier was seen on ${path.length} frames — too few to follow`];
  const fx = (from.x0 + from.x1) / 2;
  const fy = (from.y0 + from.y1) / 2;
  if (!near(first.cx, fx, 6) || !near(first.cy, fy, 6))
    problems.push(
      `the chip left from (${first.cx.toFixed(0)}, ${first.cy.toFixed(0)}), not the selection's middle (${fx.toFixed(0)}, ${fy.toFixed(0)})`,
    );
  if (!near(first.scale, SEND.fromScale, 0.04))
    problems.push(`the chip left at ${first.scale.toFixed(2)}, not 1.25`);
  if (!near(last.scale, SEND.toScale, 0.03))
    problems.push(`the chip arrived at ${last.scale.toFixed(2)}, not 0.86`);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as FlierSample;
    const b = path[i] as FlierSample;
    if (b.scale > a.scale + 0.005) {
      problems.push(`the chip grew on its way (${a.scale.toFixed(3)} → ${b.scale.toFixed(3)})`);
      break;
    }
  }
  // a straight line: every frame's middle within 3 px of the segment from the first to the last
  const dx = last.cx - first.cx;
  const dy = last.cy - first.cy;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const off = Math.max(
      ...path.map((p) => Math.abs((p.cx - first.cx) * dy - (p.cy - first.cy) * dx) / len),
    );
    if (off > 3) problems.push(`the flight left its straight line by ${off.toFixed(1)} px`);
  }
  if (landed !== null) {
    const lx = (landed.x0 + landed.x1) / 2;
    const ly = (landed.y0 + landed.y1) / 2;
    if (!near(last.cx, lx, 3) || !near(last.cy, ly, 3))
      problems.push(
        `the chip arrived at (${last.cx.toFixed(0)}, ${last.cy.toFixed(0)}), not where it stands (${lx.toFixed(0)}, ${ly.toFixed(0)})`,
      );
  }
  return problems;
}

/** The @ after the chip lands: 180 ms (`atAfterMs` — 90 under reduced motion), give or take a frame or two. */
export function judgeAtAfter(rec: SendRecorded, atAfterMs: number = SEND.atAfterMs): string[] {
  if (rec.chipAt === null) return ["the chip never stood in the draft"];
  if (rec.atAt === null) return ["@'s list never opened"];
  const after = rec.atAt - rec.chipAt;
  return near(after, atAfterMs, SLACK_MS + 10)
    ? []
    : [`@'s list opened ${after.toFixed(0)} ms after the chip landed, not ${atAfterMs}`];
}

/**
 * The still the chip carries (DK-D26): taken, the rect the anchor's box less the brackets' outset, its size that rect at
 * the view's device px; the marks hidden first (the selection cleared) and put back after. `box` is the anchor's box as
 * published before the press (null in hand: the drawn box is the rect).
 */
export function judgeStill(
  sent: SentSeen | null,
  box: Box | null,
  dpr: number,
  inHand = false,
): string[] {
  if (sent === null) return ["no Send to… was recorded"];
  const problems: string[] = [];
  if (sent.rect === null) problems.push("the act had no rect to capture");
  if (sent.still === null) problems.push("no still was attached to the chip");
  if (box !== null && sent.rect !== null) {
    const want = {
      x0: box.x0 + SEND.brackets,
      y0: box.y0 + SEND.brackets,
      x1: box.x1 - SEND.brackets,
      y1: box.y1 - SEND.brackets,
    };
    if (
      !near(sent.rect.x0, Math.max(0, want.x0), 1) ||
      !near(sent.rect.y0, Math.max(0, want.y0), 1) ||
      !near(sent.rect.x1, want.x1, 1) ||
      !near(sent.rect.y1, want.y1, 1)
    )
      problems.push(
        `the still's rect ${JSON.stringify(sent.rect)} is not the anchor's box less the brackets' 6 ${JSON.stringify(want)}`,
      );
  }
  if (sent.rect !== null && sent.still !== null) {
    const w = (sent.rect.x1 - sent.rect.x0) * dpr;
    const h = (sent.rect.y1 - sent.rect.y0) * dpr;
    if (!near(sent.still.width, w, 2) || !near(sent.still.height, h, 2))
      problems.push(
        `the still is ${sent.still.width} × ${sent.still.height}, not its rect at the device's ${w.toFixed(0)} × ${h.toFixed(0)}`,
      );
    if (sent.still.bytes <= 0) problems.push("the still carries no bytes");
  }
  if (inHand) {
    if (sent.marks.cleared)
      problems.push("in hand the selection was cleared (nothing to hide there)");
  } else if (!sent.marks.cleared || !sent.marks.restored)
    problems.push(`the marks were not hidden first and put back (${JSON.stringify(sent.marks)})`);
  return problems;
}

/**
 * The bar over the selection: away from the press (the act's own time) while the act is on — the chip flying, @'s list
 * open — and back `backMs` after the list folds (the recorder's frame that saw it gone).
 */
export function judgeBarAside(rec: SendRecorded, pressedAt: number): string[] {
  const problems: string[] = [];
  const foldedAt = rec.atGoneAt;
  if (foldedAt === null) return ["@'s list never folded"];
  const backAt = rec.bar.find((b) => b.t > foldedAt && b.shown === "true")?.t ?? null;
  const shownBetween = rec.bar.filter(
    (b) => b.t > pressedAt + 40 && b.t < foldedAt && b.shown === "true",
  );
  if (shownBetween.length > 0)
    problems.push(
      `the bar stood over the selection while Send to… was on (${shownBetween.map((b) => (b.t - pressedAt).toFixed(0)).join(", ")} ms in)`,
    );
  const awayBy = rec.bar.find((b) => b.t >= pressedAt && b.shown === "false");
  if (awayBy === undefined || awayBy.t - pressedAt > 40)
    problems.push("the bar did not step aside as Send to… was pressed");
  if (awayBy === undefined) return problems; // it never left: there is no way back to judge
  if (backAt === null) problems.push("the bar did not come back after @'s list folded");
  else if (!near(backAt - foldedAt, SEND.backMs, SLACK_MS + 20))
    problems.push(`the bar came back ${(backAt - foldedAt).toFixed(0)} ms after the fold, not 200`);
  return problems;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The line's DOM, read whole. */
const READ_LINE = `(() => {
  const line = document.querySelector(".vf-line");
  const editor = line?.querySelector(".vf-line-input") ?? null;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; };
  const chips = [...(editor?.querySelectorAll(".vf-line-chip[data-chip]") ?? [])].map((el) => {
    const cs = getComputedStyle(el);
    const glyph = el.querySelector(":scope > svg[data-glyph]");
    return {
      kind: el.getAttribute("data-chip"),
      glyph: glyph?.getAttribute("data-glyph") ?? null,
      label: el.querySelector(".vf-line-chip-label")?.textContent ?? "",
      paper: el.hasAttribute("data-paper"),
      background: cs.backgroundColor,
      color: cs.color,
      still: el.getAttribute("data-still"),
      title: el.getAttribute("title") ?? "",
      height: el.getBoundingClientRect().height,
      radius: cs.borderTopLeftRadius,
      font: cs.fontSize,
      weight: cs.fontWeight,
      glyphSize: glyph === null ? null : Number(glyph.getAttribute("width")),
      rect: rect(el),
      transition: el.style.transition,
    };
  });
  let caret = null;
  const sel = getSelection();
  if (editor !== null && sel !== null && sel.rangeCount > 0 && sel.isCollapsed && editor.contains(sel.anchorNode)) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    const before = range.cloneContents();
    const nodes = [...before.childNodes];
    let afterChip = "";
    for (const n of nodes) {
      if (n.nodeType === 1 && n.hasAttribute?.("data-chip")) afterChip = "";
      else afterChip += n.textContent ?? "";
    }
    const tail = document.createRange();
    tail.selectNodeContents(editor);
    tail.setStart(sel.anchorNode, sel.anchorOffset);
    caret = { afterChip, atEnd: tail.toString() === "" && tail.cloneContents().querySelector?.("[data-chip]") == null };
  }
  return {
    text: editor?.textContent ?? "",
    chips,
    focused: editor !== null && document.activeElement === editor,
    atOpen: document.querySelector(".vf-at-menu") !== null,
    sendArmed: line?.querySelector(".vf-line-send")?.getAttribute("data-armed") === "true",
    caret,
    aim: line?.querySelector('.vf-line-chip[data-chip="aim"]')?.textContent ?? null,
  };
})()`;

/** The recorder, armed just before a press: the flier's transitions and its box every frame, the chip and the list
 * appearing, the bar's `data-shown`. */
const ARM = `(() => {
  const rec = { t0: performance.now(), events: [], samples: [], chipAt: null, atAt: null, atGoneAt: null, chipTransition: null, bar: [] };
  globalThis.__dk14rec = rec;
  const on = (type) => (e) => {
    const el = e.target;
    if (!(el instanceof Element) || !el.classList.contains("vf-line-flier")) return;
    const cs = getComputedStyle(el);
    rec.events.push({ type, property: e.propertyName, t: performance.now(), duration: cs.transitionDuration, timing: cs.transitionTimingFunction });
  };
  for (const type of ["transitionstart", "transitionend", "transitioncancel"]) document.addEventListener(type, on(type), true);
  let lastShown;
  const scaleOf = (m) => { const x = /matrix\\(([^)]+)\\)/.exec(m); if (x === null) return 1; const [a, b] = x[1].split(",").map(Number); return Math.hypot(a, b); };
  const step = () => {
    const now = performance.now();
    const f = document.querySelector(".vf-line-flier");
    if (f !== null) {
      const r = f.getBoundingClientRect();
      const cs = getComputedStyle(f);
      rec.samples.push({ t: now, cx: r.left + r.width / 2, cy: r.top + r.height / 2, scale: scaleOf(cs.transform), opacity: Number(cs.opacity) });
    }
    const chip = document.querySelector('.vf-line-input .vf-line-chip[data-chip="desk"]');
    if (rec.chipAt === null && chip !== null) { const cs = getComputedStyle(chip); rec.chipAt = now; rec.chipTransition = cs.transitionProperty + " " + cs.transitionDuration; }
    const list = document.querySelector(".vf-at-menu") !== null;
    if (rec.atAt === null && list) rec.atAt = now;
    if (rec.atAt !== null && rec.atGoneAt === null && !list) rec.atGoneAt = now;
    const shown = document.querySelector("[data-selection-bar]")?.getAttribute("data-shown") ?? null;
    if (shown !== lastShown) { rec.bar.push({ t: now, shown }); lastShown = shown; }
    if (now - rec.t0 < 6000) requestAnimationFrame(step);
  };
  step();
  return rec.t0;
})()`;

export interface SendRowsDriver {
  readonly win: BrowserWindow;
  /** fieldd's plugins door. */
  readonly plugins: {
    disable(id: string): Promise<unknown>;
    enable(id: string): Promise<unknown>;
  };
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

/** DK-14's rows (above). Returns the problems, each in words. */
export async function sendToRows(d: SendRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const line = (): Promise<LineSeen> => js<LineSeen>(READ_LINE);
  const until = async (label: string, timeoutMs: number, expression: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await js<unknown>(expression)) === true) return;
      await sleep(60);
    }
    throw new Error(
      `${label} did not happen within ${timeoutMs}ms (line ${JSON.stringify(await line())})`,
    );
  };
  const press = async (at: { x: number; y: number }, modifiers: "shift"[] = []): Promise<void> => {
    win.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
    await sleep(40);
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: at.x,
      y: at.y,
      button: "left",
      clickCount: 1,
      modifiers,
    });
    await sleep(50);
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: at.x,
      y: at.y,
      button: "left",
      clickCount: 1,
      modifiers,
    });
  };
  const key = async (keyCode: string): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
    await sleep(80);
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
  const point = async (type: string): Promise<{ x: number; y: number }> => {
    const p = await js<{ x: number; y: number } | null>(POINT_IN(type));
    if (p === null) throw new Error(`${type} was not picked where the desk receives a press`);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };
  const letWritingGo = async (): Promise<void> => {
    if (await js<boolean>(`document.activeElement?.hasAttribute("data-desk-editor") === true`)) {
      await key("Escape");
      await until(
        "the writing let go",
        5_000,
        `document.activeElement?.hasAttribute("data-desk-editor") !== true`,
      );
    }
  };
  const select = async (type: string, modifiers: "shift"[] = []): Promise<void> => {
    await press(await point(type), modifiers);
    await sleep(300);
    await letWritingGo();
  };
  const barShown = async (label: string, extra = "true"): Promise<void> => {
    await until(
      label,
      10_000,
      `(() => { const b = document.querySelector("[data-selection-bar]"); return b?.getAttribute("data-shown") === "true" && (${extra}); })()`,
    );
    await sleep(300); // the bar's fade in (180 ms), whole
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
  const shoot = async (name: string, rect?: Box): Promise<void> => {
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
  const deselect = async (): Promise<void> => {
    await js(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    await key("Escape");
    await key("Escape");
    if ((await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0")) === 0) return;
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
  /** The draft emptied by the editor's own commands (select all, delete), then given back to the view. */
  const clearDraft = async (): Promise<void> => {
    await js(`document.querySelector(".vf-line-input")?.focus()`);
    await sleep(60);
    win.webContents.selectAll();
    await sleep(60);
    win.webContents.delete();
    await sleep(120);
    if (await js<boolean>(`document.querySelector(".vf-at-menu") !== null`)) await key("Escape");
    await until(
      "the draft emptied",
      5_000,
      `(document.querySelector(".vf-line-input")?.textContent ?? "x") === "" && document.querySelectorAll(".vf-line-input .vf-line-chip").length === 0`,
    );
    await key("Escape"); // CB-2: Escape gives the keyboard back to the view
    await until("the send phase over", 5_000, `document.querySelector(".vf-at-menu") === null`);
  };
  const sent = (): Promise<SentSeen | null> => js<SentSeen | null>("globalThis.__vfDesk.sent()");
  const recorded = (): Promise<SendRecorded> => js<SendRecorded>("globalThis.__dk14rec");
  /** Press a Send to… door where it stands, the recorder armed first. */
  const pressSend = async (selector: string): Promise<void> => {
    await js(ARM);
    await pressAt(selector);
  };
  /** The chip landed and the act over — its still attached (the act's last step, after the selection was put back),
   * @'s list open — or, aimed, no @. What the act recorded is the judges', never this wait's. */
  const landed = async (label: string, expectList = true): Promise<void> => {
    await until(
      label,
      10_000,
      `(() => { const s = globalThis.__vfDesk.sent(); return s !== null && s.at.landed !== undefined && s.at.captured !== undefined && ${expectList ? 'document.querySelector(".vf-at-menu") !== null' : "true"}; })()`,
    );
    await sleep(250);
  };
  /** @'s list folded by Esc (the draft's own), the bar given its time to come back. */
  const fold = async (): Promise<void> => {
    await js(`document.querySelector(".vf-line-input")?.focus()`);
    await key("Escape");
    await until("@'s list folded", 5_000, `document.querySelector(".vf-at-menu") === null`);
    await sleep(500);
  };
  const dpr = await js<number>("devicePixelRatio");

  const problems: string[] = [];
  const counters0 = await js<BarCounters>("globalThis.__vfDesk.bar()");
  await theme("light");
  await deselect();
  await clearDraft();

  // ── NOTE: a line written on the note, the note sent from the BAR ────────────────────────────────────────────────
  {
    const row = (p: string): string => `NOTE: ${p}`;
    await press(await point("desk.note"));
    await until(
      "the desk's editor lent to the note",
      10_000,
      `document.activeElement?.hasAttribute("data-desk-editor") === true`,
    );
    for (const ch of NOTE_LINE) {
      win.webContents.sendInputEvent({ type: "char", keyCode: ch });
      await sleep(12);
    }
    await until(
      "the note's line in its ink cell",
      15_000,
      `globalThis.__vfDesk.objects("desk.note")[0]?.props.text === ${JSON.stringify(NOTE_LINE)}`,
    );
    await letWritingGo();
    await barShown("the bar over the note", `globalThis.__vfDesk.anchor()?.count === 1`);
    const box = await js<Box | null>("globalThis.__vfDesk.anchor()?.box ?? null");
    await pressSend('[data-selection-bar] .vf-bar-row [data-act="send"]');
    await landed("the note's chip landed, its still attached, @'s list open");
    const seen = await line();
    const record = await sent();
    const rec = await recorded();
    const chip = seen.chips.at(-1);
    problems.push(
      ...judgeChip(chip, {
        glyph: "snippets",
        label: NOTE_LABEL,
        paper: NOTE_PAPER,
        ink: NOTE_INK,
      }).map(row),
      ...judgeTyped(seen).map(row),
      ...judgeFlight(
        rec,
        record?.fromBox ?? { x0: 0, y0: 0, x1: 0, y1: 0 },
        chip?.rect ?? null,
      ).map(row),
      ...judgeAtAfter(rec).map(row),
      ...judgeStill(record, box, dpr).map(row),
    );
    if (record?.from !== "bar")
      problems.push(row(`the act was recorded from ${record?.from}, not the bar`));
    if (record?.objects[0]?.text !== NOTE_LINE)
      problems.push(
        row(`the chip carries ${JSON.stringify(record?.objects)}, not the note's line`),
      );
    const restored = await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0");
    if (restored !== 1)
      problems.push(row(`the selection was not put back after the still (${restored})`));
    const pressedAt = record?.at.pressed ?? rec.t0;
    say(
      `SMOKE_CANVAS_SEND_NOTE ${JSON.stringify({ chip, line: { ...seen, chips: undefined }, sent: record, flight: { events: rec.events.map((e) => ({ ...e, t: Math.round(e.t - pressedAt) })), frames: rec.samples.length, first: rec.samples[0], last: rec.samples.at(-1) }, at: { chip: rec.chipAt === null ? null : Math.round(rec.chipAt - pressedAt), list: rec.atAt === null ? null : Math.round(rec.atAt - pressedAt) } })}`,
    );
    // the stills: the line with the note's chip and @'s list open, by day and by night
    const frame = await js<Box | null>(`(() => {
      const a = document.querySelector(".vf-line")?.getBoundingClientRect();
      const m = document.querySelector(".vf-at-menu")?.getBoundingClientRect();
      if (a === undefined) return null;
      return { x0: Math.min(a.left, m?.left ?? a.left) - 24, y0: Math.min(a.top, m?.top ?? a.top) - 24, x1: Math.max(a.right, m?.right ?? a.right) + 24, y1: a.bottom + 16 };
    })()`);
    await shoot("dk-14-chip-light.png", frame ?? undefined);
    await theme("dark");
    await shoot("dk-14-chip-dark.png", frame ?? undefined);
    await theme("light");
    await fold();
    const after = await recorded();
    problems.push(...judgeBarAside(after, pressedAt).map(row));
    say(
      `SMOKE_CANVAS_SEND_BAR ${JSON.stringify({ folded: after.atGoneAt === null ? null : Math.round(after.atGoneAt - pressedAt), bar: after.bar.map((b) => ({ t: Math.round(b.t - pressedAt), shown: b.shown })) })}`,
    );
    await clearDraft();

    // the flight's still: the note sent again, the window taken mid-flight
    await select("desk.note");
    await barShown("the bar over the note again", `globalThis.__vfDesk.anchor()?.count === 1`);
    await pressSend('[data-selection-bar] .vf-bar-row [data-act="send"]');
    await sleep(240);
    await shoot("dk-14-flight.png");
    await landed("the note's chip landed again");
    await fold();
    await clearDraft();
    await deselect();
  }

  // ── CLOCK: any other kind — its name, no glyph ──────────────────────────────────────────────────────────────────
  {
    const row = (p: string): string => `CLOCK: ${p}`;
    await select(CLOCK);
    await barShown("the bar over the clock", `globalThis.__vfDesk.anchor()?.count === 1`);
    const box = await js<Box | null>("globalThis.__vfDesk.anchor()?.box ?? null");
    await pressSend('[data-selection-bar] .vf-bar-row [data-act="send"]');
    await landed("the clock's chip landed");
    const seen = await line();
    const record = await sent();
    const rec = await recorded();
    const chip = seen.chips.at(-1);
    problems.push(
      ...judgeChip(chip, { glyph: null, label: "Clock" }).map(row),
      ...judgeTyped(seen).map(row),
      ...judgeFlight(
        rec,
        record?.fromBox ?? { x0: 0, y0: 0, x1: 0, y1: 0 },
        chip?.rect ?? null,
      ).map(row),
      ...judgeStill(record, box, dpr).map(row),
    );
    say(`SMOKE_CANVAS_SEND_CLOCK ${JSON.stringify({ chip, sent: record })}`);
    await fold();
    await clearDraft();
  }

  // ── TWO: the clock and the note, sent from the bar grown into its MENU — `package`, "2 objects" ────────────────
  {
    const row = (p: string): string => `TWO: ${p}`;
    await select("desk.note", ["shift"]);
    await barShown(
      "the bar over two",
      `document.querySelector('[data-selection-bar] [data-act="send"]')?.textContent === "Send 2 to…"`,
    );
    const box = await js<Box | null>("globalThis.__vfDesk.anchor()?.box ?? null");
    await pressAt('[data-selection-bar] .vf-bar-row [data-act="more"]');
    await until(
      "the menu grown",
      5_000,
      `document.querySelector('[data-selection-bar] .vf-bar-list [data-row="send"]') !== null && document.querySelector("[data-selection-bar]")?.hasAttribute("data-open") === true`,
    );
    await sleep(700); // the grow and the rows' stagger
    const rowTitle = await js<string | null>(
      `document.querySelector('[data-selection-bar] .vf-bar-list [data-row="send"]')?.getAttribute("aria-disabled") ?? null`,
    );
    if (rowTitle !== null) problems.push(row("the menu's Send to… row still waits"));
    await pressSend('[data-selection-bar] .vf-bar-list [data-row="send"]');
    await landed("the two's chip landed");
    const seen = await line();
    const record = await sent();
    const chip = seen.chips.at(-1);
    const union =
      box === null ? null : { x0: box.x0 + 4, y0: box.y0 + 4, x1: box.x1 - 4, y1: box.y1 - 4 }; // 10 out, not 6
    problems.push(
      ...judgeChip(chip, { glyph: "package", label: "2 objects" }).map(row),
      ...judgeTyped(seen).map(row),
      ...judgeStill(record, union, dpr).map(row),
    );
    if (record?.from !== "menu")
      problems.push(row(`the act was recorded from ${record?.from}, not the menu`));
    const types = (record?.objects ?? []).map((o) => o.type).sort();
    if (JSON.stringify(types) !== JSON.stringify(["desk.note", CLOCK].sort()))
      problems.push(row(`the chip carries ${JSON.stringify(types)}, not the note and the clock`));
    const count = await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0");
    if (count !== 2)
      problems.push(row(`the two were not selected again after the still (${count})`));
    say(`SMOKE_CANVAS_SEND_TWO ${JSON.stringify({ chip, sent: record })}`);
    await fold();
    await clearDraft();
    await deselect();
  }

  // ── HAND: the notebook in hand, sent from the tools in hand — it stays in hand ─────────────────────────────────
  {
    const row = (p: string): string => `HAND: ${p}`;
    await select("desk.notebook");
    await barShown("the bar over the notebook", `globalThis.__vfDesk.anchor()?.count === 1`);
    await key("Return");
    await until(
      "the notebook in hand, its tools under the head",
      10_000,
      `(() => { const h = globalThis.__vfDesk.held(); const b = document.querySelector("[data-selection-bar]"); return h !== null && h.frame?.settled === true && b?.getAttribute("data-face") === "hand" && b?.getAttribute("data-shown") === "true" && !b.hasAttribute("data-traveling"); })()`,
    );
    await sleep(300);
    const held = await js<{
      entity: number;
      frame: { cx: number; cy: number; hx: number; hy: number } | null;
    } | null>("globalThis.__vfDesk.held()");
    await pressSend('[data-selection-bar] [data-face-row="hand"] [data-act="send"]');
    await landed("the notebook's chip landed");
    const seen = await line();
    const record = await sent();
    const rec = await recorded();
    const chip = seen.chips.at(-1);
    const f = held?.frame ?? null;
    const drawn =
      f === null ? null : { x0: f.cx - f.hx, y0: f.cy - f.hy, x1: f.cx + f.hx, y1: f.cy + f.hy };
    problems.push(
      ...judgeChip(chip, { glyph: null, label: "Notebook" }).map(row),
      ...judgeTyped(seen).map(row),
      ...judgeStill(record, null, dpr, true).map(row),
    );
    if (drawn !== null) problems.push(...judgeFlight(rec, drawn, chip?.rect ?? null).map(row));
    if (record?.from !== "hand")
      problems.push(row(`the act was recorded from ${record?.from}, not the hand`));
    const after = await js<{
      held: boolean;
      face: string | null;
      shown: string | null;
      top: number | null;
    }>(`(() => {
      const b = document.querySelector("[data-selection-bar]");
      const r = b?.querySelector('[data-face-row="hand"]')?.getBoundingClientRect();
      return { held: globalThis.__vfDesk.held() !== null, face: b?.getAttribute("data-face") ?? null, shown: b?.getAttribute("data-shown") ?? null, top: r === undefined ? null : r.top };
    })()`);
    if (!after.held) problems.push(row("Send to… put the notebook down"));
    if (
      after.face !== "hand" ||
      after.shown !== "true" ||
      after.top === null ||
      !near(after.top, 64, 1)
    )
      problems.push(
        row(`the tools in hand did not stay under the head (${JSON.stringify(after)})`),
      );
    say(`SMOKE_CANVAS_SEND_HAND ${JSON.stringify({ chip, sent: record, held, after })}`);
    await shoot("dk-14-hand.png");
    await fold();
    await clearDraft();
    await pressAt('[data-selection-bar] [data-face-row="hand"] [data-act="done"]');
    await until("the notebook put down", 10_000, "globalThis.__vfDesk.held() === null");
    await sleep(800);
    await deselect();
  }

  // ── MISSING: the clock's plugin off — its missing face sent wears its type's name ─────────────────────────────
  {
    const row = (p: string): string => `MISSING: ${p}`;
    const mount0 = await js<number>("globalThis.__vfDesk.mount");
    await d.plugins.disable(CLOCK);
    await until(
      "the desk remounted without the clock's kind",
      30_000,
      `(globalThis.__vfDesk?.mount ?? -1) > ${mount0} && globalThis.__vfDesk.words(${JSON.stringify(CLOCK)}).state === "plugin off" && globalThis.__vfDesk.status().state === "ready" && globalThis.__vfDesk.perf().frames >= 1`,
    );
    await select(CLOCK);
    await barShown(
      "the bar naming the missing face",
      `document.querySelector("[data-selection-bar] [data-bar-words]")?.textContent === "Clock · plugin off"`,
    );
    const box = await js<Box | null>("globalThis.__vfDesk.anchor()?.box ?? null");
    await pressSend('[data-selection-bar] .vf-bar-row [data-act="send"]');
    await landed("the missing face's chip landed");
    const seen = await line();
    const record = await sent();
    const chip = seen.chips.at(-1);
    problems.push(
      ...judgeChip(chip, { glyph: null, label: "Clock" }).map(row),
      ...judgeStill(record, box, dpr).map(row),
    );
    say(`SMOKE_CANVAS_SEND_MISSING ${JSON.stringify({ chip, sent: record })}`);
    await fold();
    await clearDraft();
    await deselect();
    const mount1 = await js<number>("globalThis.__vfDesk.mount");
    await d.plugins.enable(CLOCK);
    await until(
      "the clock drawn again",
      30_000,
      `(globalThis.__vfDesk?.mount ?? -1) > ${mount1} && globalThis.__vfDesk.words(${JSON.stringify(CLOCK)}).state === null && globalThis.__vfDesk.status().state === "ready" && globalThis.__vfDesk.perf().frames >= 1 && (${POINT_IN(CLOCK)}) !== null`,
    );
  }

  // ── REDUCED: no flight — the chip fades in at the caret, the @ after it ─────────────────────────────────────────
  {
    const row = (p: string): string => `REDUCED: ${p}`;
    const dbg = win.webContents.debugger;
    try {
      dbg.attach("1.3");
      await dbg.sendCommand("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await sleep(200);
      await select(CLOCK);
      await barShown(
        "the bar over the clock (reduced)",
        `globalThis.__vfDesk.anchor()?.count === 1`,
      );
      await pressSend('[data-selection-bar] .vf-bar-row [data-act="send"]');
      await landed("the clock's chip faded in");
      const seen = await line();
      const record = await sent();
      const rec = await recorded();
      const chip = seen.chips.at(-1);
      problems.push(
        ...judgeChip(chip, { glyph: null, label: "Clock" }).map(row),
        ...judgeTyped(seen).map(row),
      );
      if (rec.samples.length > 0 || rec.events.length > 0)
        problems.push(
          row(`the chip flew under reduced motion (${rec.samples.length} frames of a flier)`),
        );
      if (rec.chipTransition !== "opacity 0.12s")
        problems.push(
          row(`the chip did not fade in over 120 ms (${JSON.stringify(rec.chipTransition)})`),
        );
      problems.push(...judgeAtAfter(rec, SEND.atAfterMs / 2).map(row));
      if (record?.reduced !== true) problems.push(row("the act was not recorded as reduced"));
      say(
        `SMOKE_CANVAS_SEND_REDUCED ${JSON.stringify({ chip, transition: rec.chipTransition, at: { chip: rec.chipAt, list: rec.atAt }, reduced: record?.reduced })}`,
      );
      await fold();
      await clearDraft();
      await deselect();
    } finally {
      if (dbg.isAttached()) {
        await dbg.sendCommand("Emulation.setEmulatedMedia", { features: [] });
        dbg.detach();
      }
    }
  }

  // ── AIMED: a draft already aimed takes the chip with no @ — and send arms ──────────────────────────────────────
  {
    const row = (p: string): string => `AIMED: ${p}`;
    // aimed the one way VibeField aims: @ typed in the draft, a Send to row taken (the pane the deck shows)
    await js(`document.querySelector(".vf-line-input")?.focus()`);
    win.webContents.sendInputEvent({ type: "char", keyCode: "@" });
    await until(
      "@'s list open with a pane to send to",
      10_000,
      `document.querySelector(".vf-at-menu .vf-at-row.is-aim:not([aria-disabled])") !== null`,
    );
    await pressAt(".vf-at-menu .vf-at-row.is-aim:not([aria-disabled])");
    await until(
      "the draft aimed",
      5_000,
      `document.querySelector('.vf-line-chip[data-chip="aim"]') !== null`,
    );
    await key("Escape");
    await select(CLOCK);
    await barShown("the bar over the clock (aimed)", `globalThis.__vfDesk.anchor()?.count === 1`);
    await pressSend('[data-selection-bar] .vf-bar-row [data-act="send"]');
    await landed("the clock's chip in the aimed draft", false);
    await sleep(600); // past the 180 an @ would have come in
    const seen = await line();
    const record = await sent();
    const chip = seen.chips.find((c) => c.kind === "desk");
    problems.push(...judgeChip(chip, { glyph: null, label: "Clock" }).map(row));
    if (seen.atOpen || seen.text.includes("@"))
      problems.push(row(`an @ was typed into an aimed draft (${JSON.stringify(seen.text)})`));
    if (!seen.sendArmed) problems.push(row("send did not arm"));
    if (record?.aimed !== true) problems.push(row("the act did not find the draft aimed"));
    if (seen.aim === null) problems.push(row("the aim was lost"));
    const shown = await js<string | null>(
      `document.querySelector("[data-selection-bar]")?.getAttribute("data-shown") ?? null`,
    );
    if (shown !== "true")
      problems.push(row(`the bar did not come back with no list to wait for (${shown})`));
    say(
      `SMOKE_CANVAS_SEND_AIMED ${JSON.stringify({ chip, aim: seen.aim, sendArmed: seen.sendArmed, text: seen.text, aimed: record?.aimed })}`,
    );
    // the aim taken away again, and the draft emptied
    await pressAt('.vf-line-chip[data-chip="aim"] .vf-line-chip-x');
    await until(
      "the aim gone",
      5_000,
      `document.querySelector('.vf-line-chip[data-chip="aim"]') === null`,
    );
    await clearDraft();
    await deselect();
  }

  // ── COUNTERS: placements ≤ publishes ────────────────────────────────────────────────────────────────────────────
  const counters1 = await js<BarCounters>("globalThis.__vfDesk.bar()");
  problems.push(...judgeCounters(counters0, counters1).map((p) => `COUNTERS: ${p}`));
  say(`SMOKE_CANVAS_SEND_COUNTERS ${JSON.stringify({ before: counters0, after: counters1 })}`);
  return problems;
}
