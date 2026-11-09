// ES-6 — CHAT'S NIGHT, WITNESSED ON THE GPU (`pnpm smoke:chat-night`, desk-gates; track ES, James's "ES-6 first",
// 2026-11-09 03:04:05Z; VF-PM's V1–V3, 02:26:07Z; DESIGN.md §2.10 and §6, the portal). No landing gate saw the portal on
// a real GPU: its rows are vitest. This run is Godview's launcher under `--chat-night`: that launcher stages the typed
// agent, so New spark is live, and the flag keeps the GPU the launcher otherwise drops (`keepsGpu`, modes.ts).
//
// Five rows, each judged by order and outcome from what the page sets, never by how long a step stood:
//   · THE NIGHT STANDS: Chat with no spark is the night, its canvas drawn, New spark live and reachable;
//   · THE LEAN: the pointer on New spark draws the night in 6px, and it lets go no sooner than its 90ms;
//   · THE CLOSE: New spark pressed, the portal runs drawing, closing, open, the night lent, the window on the sky's place;
//   · CANCEL'S FOLD: Esc folds the window, the night comes back whole, the words return;
//   · THE HAND-OFF: the window's night is the night it was lent, star for star.
//
// The hand-off is the row pixels decide (VF-PM's V3: pixels first). It opens the sheet by ⌘N, so no lean moves the night,
// and it compares where nothing else draws:
//   · the reference is the night itself, Chat's words and their hush hidden for its two captures (the words stand over the
//     very box the sky lands on) and put back before the press;
//   · the window is captured once closed, opaque on the sky's place, and read only below the star's road and around its
//     landing, where the hatch's own star and its burst do not pass;
//   · the bar is the night's own noise over about the same time: two captures of the live night before the press. A window
//     dealt another night moves far past that. A clock restarted on the same stars would not, and this row cannot tell.
// The floor and the verdict are printed on every run (`SMOKE_CHAT_NIGHT_HANDOFF`), and each row keeps a still.
//
// A press and a key go in by `sendInputEvent`, never OS input (smoke-window.ts). The window is the shown, click-through one.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

export const CHAT_NIGHT = {
  /** how long the lean stands once nothing holds it (ChatEmptyView's LEAN_LETS_GO_MS, §6) */
  leanLetsGoMs: 90,
  /** the longest a let-go may take, a slow frame's worth over its 90ms */
  leanLetsGoBoundMs: 2_000,
  /** the sky's corners (§8 "The New spark sheet", `portal.ts`'s SKY_RADIUS) */
  skyRadius: 30,
  /** how far the window may stand off the sky's place, in CSS px */
  boxSlack: 2,
  /** the hush's ellipse, reaching 72% of 620 by 340, centred 16 below the panel's middle (`chat-empty.css`) */
  hushRx: 620 * 0.72,
  hushRy: 340 * 0.72,
  hushBelow: 16,
  /** the edge left out of the panel's mask, where the lean's clip and the panel's corners stand */
  panelEdge: 24,
  /** around the star's landing, in CSS px: the burst the hatch draws there */
  starZone: 110,
  /** a pixel moved when a channel changed by more than this (BGRA) */
  movedAt: 24,
  /** the hand-off's bar: this many times the night's own noise … */
  floorTimes: 3,
  /** … and never stricter than this share of the pixels read */
  movedShare: 0.005,
  /** fewer pixels than this is nothing to compare */
  minPixels: 2_000,
  /** a night whose spread of luminance is less than this is flat: its ground, or a blank */
  minSpread: 8,
  /** the two reference captures stand about as far apart as the press and the closed window */
  floorGapMs: 900,
  standWaitMs: 40_000,
  stepWaitMs: 8_000,
  /** the lean's own transition, 240ms, and a frame or two */
  leanSettleMs: 400,
  /** the words' return: 300 in, over 240 (`portal.ts`) */
  wordsBackMs: 700,
} as const;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export interface NightStep {
  readonly value: string | null;
  readonly at: number;
}
export interface NightSeen {
  readonly lean: readonly NightStep[];
  readonly portal: readonly NightStep[];
  readonly lent: readonly NightStep[];
}
export interface NightFacts {
  readonly view: string;
  readonly chat: Box | null;
  readonly drawn: boolean;
  readonly newSpark: Box | null;
  readonly newSparkOff: boolean;
  readonly hit: boolean;
  readonly nightClip: string;
  readonly sheet: boolean;
  readonly open: string | null;
  readonly portal: string | null;
  readonly lean: string | null;
  readonly lent: string | null;
  readonly sky: Box | null;
  readonly window: Box | null;
  readonly windowClip: string;
  readonly wordsOpacity: number | null;
}
export interface Capture {
  readonly bgra: Uint8Array;
  readonly w: number;
  readonly h: number;
  readonly scale: number;
}
/** Whether a place in a capture, in CSS px from its corner, is read. */
export type Mask = (x: number, y: number) => boolean;
export interface Moved {
  readonly pixels: number;
  readonly moved: number;
}
export interface ChatNightDriver {
  readonly win: BrowserWindow;
  readonly shotDir: string;
  readonly say: (line: string) => void;
  /** ⌘4, Chat, as a keyboard presses it */
  readonly pressChat: () => void;
  /** ⌘N, the line's create, as a keyboard presses it */
  readonly pressNewSparkKey: () => void;
}

const SHEET = "body > .vf-new-spark";
const NIGHT = ".vf-chat-empty .vf-spark-night";

/** Installed once, before the first press: each change of the three states, in order, as the page sets them. */
export const CHAT_NIGHT_RECORDER = `(() => {
  const seen = { lean: [], portal: [], lent: [] };
  const note = (list, value) => {
    const last = list[list.length - 1];
    if (last === undefined || last.value !== value) list.push({ value, at: performance.now() });
  };
  const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) ?? null;
  const read = () => {
    note(seen.lean, attr(".vf-chat-empty", "data-lean"));
    note(seen.portal, attr(${JSON.stringify(SHEET)}, "data-portal"));
    note(seen.lent, attr(${JSON.stringify(NIGHT)}, "data-lent"));
  };
  new MutationObserver(read).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-lean", "data-portal", "data-lent", "data-open"],
  });
  read();
  globalThis.__vfChatNight = seen;
  return "ok";
})()`;

/** What stands now, as a JSON string of `NightFacts`. */
export const CHAT_NIGHT_FACTS = `(() => {
  const box = (node) => {
    if (node === null || node === undefined) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  const chat = document.querySelector(".vf-chat-empty");
  const night = document.querySelector(${JSON.stringify(NIGHT)});
  const create = document.querySelector(".vf-chat-empty-new");
  const sheet = document.querySelector(${JSON.stringify(SHEET)});
  const pane = sheet?.querySelector(".vf-new-spark-window") ?? null;
  const words = document.querySelector(".vf-chat-empty-column");
  const at = box(create);
  const under = at === null ? null : document.elementFromPoint(at.x + at.w / 2, at.y + at.h / 2);
  return JSON.stringify({
    view: document.querySelector(".vf-views-line")?.getAttribute("data-view") ?? "absent",
    chat: box(chat),
    drawn: document.querySelector(${JSON.stringify(`${NIGHT} .vf-spark-night-sky`)}) !== null,
    newSpark: at,
    newSparkOff: create !== null && (create.disabled === true || create.getAttribute("aria-disabled") === "true"),
    hit: under !== null && under.closest(".vf-chat-empty-new") !== null,
    nightClip: night === null ? "none" : getComputedStyle(night).clipPath,
    sheet: sheet !== null,
    open: sheet?.getAttribute("data-open") ?? null,
    portal: sheet?.getAttribute("data-portal") ?? null,
    lean: chat?.getAttribute("data-lean") ?? null,
    lent: night?.getAttribute("data-lent") ?? null,
    sky: box(sheet?.querySelector(".vf-new-spark-sky")),
    window: box(pane),
    windowClip: pane === null ? "none" : getComputedStyle(pane).clipPath,
    wordsOpacity: words === null ? null : Number(getComputedStyle(words).opacity),
  });
})()`;

const WORDS = `document.querySelectorAll(".vf-chat-empty-column, .vf-chat-empty-hush").forEach`;
/** Chat's words and their hush out of a reference capture, and back; both restate nothing but this one property. */
const HIDE_WORDS = `${WORDS}((n) => { n.style.visibility = "hidden"; }); "ok"`;
const SHOW_WORDS = `${WORDS}((n) => { n.style.removeProperty("visibility"); }); "ok"`;

/** A capture of `cssW` × `cssH` CSS px at the screen's density (BGRA, Electron's `toBitmap`); null when it is no picture. */
export function captureOf(bgra: Uint8Array, cssW: number, cssH: number): Capture | null {
  const pixels = bgra.length / 4;
  if (cssW <= 0 || cssH <= 0 || pixels <= 0) return null;
  const scale = Math.sqrt(pixels / (cssW * cssH));
  return { bgra, w: Math.round(cssW * scale), h: Math.round(cssH * scale), scale };
}

/** The panel, in its own CSS px, without its edge and the hush behind the words. */
export function outsideHush(panel: Box): Mask {
  const { hushRx, hushRy, hushBelow, panelEdge } = CHAT_NIGHT;
  const cx = panel.w / 2;
  const cy = panel.h / 2 + hushBelow;
  return (x, y) =>
    x >= panelEdge &&
    y >= panelEdge &&
    x <= panel.w - panelEdge &&
    y <= panel.h - panelEdge &&
    ((x - cx) / hushRx) ** 2 + ((y - cy) / hushRy) ** 2 > 1;
}

/** The sky's lower half, in the panel's CSS px, around the star's landing at its centre. */
export function belowTheStar(sky: Box, panel: Box): Mask {
  const left = sky.x - panel.x;
  const top = sky.y - panel.y;
  const cx = left + sky.w / 2;
  const cy = top + sky.h / 2;
  return (x, y) =>
    x >= left &&
    x <= left + sky.w &&
    y >= cy &&
    y <= top + sky.h &&
    (x - cx) ** 2 + (y - cy) ** 2 > CHAT_NIGHT.starZone ** 2;
}

const luminanceAt = (c: Capture, i: number): number =>
  0.0722 * (c.bgra[i] ?? 0) + 0.7152 * (c.bgra[i + 1] ?? 0) + 0.2126 * (c.bgra[i + 2] ?? 0);

/** The brightest read pixel's luminance less the median's: near nothing on a flat ground. */
export function spreadOf(c: Capture, mask: Mask): number {
  const seen: number[] = [];
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (mask(x / c.scale, y / c.scale)) seen.push(luminanceAt(c, (y * c.w + x) * 4));
    }
  }
  if (seen.length === 0) return 0;
  seen.sort((a, b) => a - b);
  return (seen[seen.length - 1] ?? 0) - (seen[Math.floor(seen.length / 2)] ?? 0);
}

/** Of the pixels read, how many changed by more than `movedAt` in a channel. */
export function movedBetween(a: Capture, b: Capture, mask: Mask): Moved {
  let pixels = 0;
  let moved = 0;
  const w = Math.min(a.w, b.w);
  const h = Math.min(a.h, b.h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask(x / a.scale, y / a.scale)) continue;
      pixels += 1;
      const i = (y * a.w + x) * 4;
      const j = (y * b.w + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        if (
          Math.abs((a.bgra[i + channel] ?? 0) - (b.bgra[j + channel] ?? 0)) > CHAT_NIGHT.movedAt
        ) {
          moved += 1;
          break;
        }
      }
    }
  }
  return { pixels, moved };
}

/** What a computed `inset(…)` leaves of a box, or null where the clip is not one. */
export function windowVisibleBox(window: Box | null, clip: string): Box | null {
  if (window === null) return null;
  const inset = /^inset\(([^)]*?)(?:\s+round\s+[^)]*)?\)$/u.exec(clip.trim());
  if (inset === null) return null;
  const values = (inset[1] ?? "").trim().split(/\s+/u).map(Number.parseFloat);
  if (values.length < 1 || values.length > 4 || values.some(Number.isNaN)) return null;
  const top = values[0] ?? 0;
  const right = values[1] ?? top;
  const bottom = values[2] ?? top;
  const left = values[3] ?? right;
  return {
    x: window.x + left,
    y: window.y + top,
    w: window.w - left - right,
    h: window.h - top - bottom,
  };
}

/** The values a list of steps took, the empty ones left out. */
const taken = (steps: readonly NightStep[]): (string | null)[] =>
  steps.map((step) => step.value).filter((value) => value !== null);

export function judgeNightStands(f: NightFacts, spread: number): string[] {
  const found: string[] = [];
  if (f.view !== "assistant") found.push(`Chat is not the view: ${f.view}`);
  if (f.chat === null)
    found.push("no .vf-chat-empty: a spark is here, or the list could not be read");
  if (!f.drawn) found.push("the night is its ground, with no canvas: WebGL2 did not stand");
  if (f.newSpark === null) found.push("no New spark on the night");
  if (f.newSparkOff) found.push("New spark is Off: no agent here can be a spark");
  if (!f.hit) found.push("nothing reaches New spark: another element takes its centre");
  if (spread < CHAT_NIGHT.minSpread) found.push(`the night is flat: spread ${spread.toFixed(1)}`);
  return found;
}

export function judgeLean(seen: NightSeen, clipLeaning: string, leftAt: number): string[] {
  const found: string[] = [];
  const on = seen.lean.findIndex((step) => step.value === "true");
  if (on === -1) return ["the night never leaned under the pointer"];
  if (!clipLeaning.includes("6px")) {
    found.push(`the night did not draw in by 6px while leaning: its clip reads ${clipLeaning}`);
  }
  const off = seen.lean.slice(on + 1).find((step) => step.value === null);
  if (off === undefined) {
    found.push("the lean never let go once the pointer left");
  } else {
    const after = off.at - leftAt;
    if (after < CHAT_NIGHT.leanLetsGoMs) {
      found.push(`the lean let go ${after.toFixed(0)}ms after the pointer left, inside its 90ms`);
    }
    if (after > CHAT_NIGHT.leanLetsGoBoundMs) {
      found.push(`the lean took ${after.toFixed(0)}ms to let go`);
    }
  }
  return found;
}

export function judgeClose(seen: NightSeen, f: NightFacts): string[] {
  const found: string[] = [];
  const phases = taken(seen.portal);
  const closing = phases.indexOf("closing");
  const open = phases.indexOf("open");
  if (closing === -1 || open === -1 || open < closing) {
    found.push(`the portal did not run closing then open: ${JSON.stringify(phases)}`);
  }
  if (phases.includes("folding") || phases.includes("leaving")) {
    found.push(`the portal left before it stood: ${JSON.stringify(phases)}`);
  }
  if (!taken(seen.lent).includes("true")) found.push("the night was never lent to the window");
  if (f.open !== "true") found.push(`the sheet does not stand: data-open ${f.open}`);
  const visible = windowVisibleBox(f.window, f.windowClip);
  if (visible === null || f.sky === null) {
    found.push(`the window on the sky's place could not be read: ${f.windowClip}`);
  } else {
    const off = Math.max(
      Math.abs(visible.x - f.sky.x),
      Math.abs(visible.y - f.sky.y),
      Math.abs(visible.w - f.sky.w),
      Math.abs(visible.h - f.sky.h),
    );
    if (off > CHAT_NIGHT.boxSlack) {
      found.push(`the window stands ${off.toFixed(1)}px off the sky's place`);
    }
  }
  if (!f.windowClip.includes(`round ${CHAT_NIGHT.skyRadius}px`)) {
    found.push(`the window's corners are not the sky's 30px: ${f.windowClip}`);
  }
  return found;
}

export function judgeFold(seen: NightSeen, f: NightFacts, spread: number): string[] {
  const found: string[] = [];
  const phases = taken(seen.portal);
  const folding = phases.lastIndexOf("folding");
  const folded = phases.lastIndexOf("folded");
  if (folding === -1 || folded === -1 || folded < folding) {
    found.push(`the window did not fold, then stand folded: ${JSON.stringify(phases)}`);
  }
  const lastLent = seen.lent[seen.lent.length - 1];
  if (lastLent === undefined || lastLent.value !== null) {
    found.push("the night was not handed back: it still reads lent");
  }
  if (f.sheet && f.open === "true") found.push("the sheet still stands after Esc");
  if (f.wordsOpacity === null || f.wordsOpacity < 0.99) {
    found.push(`the words did not return: opacity ${String(f.wordsOpacity)}`);
  }
  if (spread < CHAT_NIGHT.minSpread) {
    found.push(`the night came back flat: spread ${spread.toFixed(1)}`);
  }
  return found;
}

export function judgeHandOff(floor: Moved, handOff: Moved, spread: number): string[] {
  const { floorTimes, movedShare, minPixels, minSpread } = CHAT_NIGHT;
  if (handOff.pixels < minPixels) return [`nothing to compare: ${handOff.pixels} pixels read`];
  if (spread < minSpread)
    return [`the reference is flat, spread ${spread.toFixed(1)}: nothing to compare`];
  const bar = Math.max(floor.moved * floorTimes, Math.ceil(handOff.pixels * movedShare));
  return handOff.moved > bar
    ? [
        `the stars moved at the hand-off: ${handOff.moved} of ${handOff.pixels} pixels, over a bar of ${bar}`,
      ]
    : [];
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The value `read` gives once `done` holds, or the last one it gave when `ms` runs out: the row's judge says why. */
async function settled<T>(
  ms: number,
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(30);
    value = await read();
  }
  return value;
}

/** The rows, in order; each problem says its row. */
export async function chatNightRows(d: ChatNightDriver): Promise<string[]> {
  const problems: string[] = [];
  const input = d.win.webContents;
  const page = <T>(expression: string): Promise<T> =>
    input.executeJavaScript(expression) as Promise<T>;
  const facts = async (): Promise<NightFacts> =>
    JSON.parse(await page<string>(CHAT_NIGHT_FACTS)) as NightFacts;
  const seen = async (): Promise<NightSeen> =>
    JSON.parse(await page<string>("JSON.stringify(globalThis.__vfChatNight)")) as NightSeen;
  const row = (name: string, found: readonly string[]): void => {
    d.say(`SMOKE_CHAT_NIGHT ${name} ${found.length === 0 ? "ok" : `RED ${JSON.stringify(found)}`}`);
    problems.push(...found.map((one) => `${name}: ${one}`));
  };
  const capture = async (panel: Box, still: string): Promise<Capture | null> => {
    const image = await d.win.capturePage({
      x: Math.round(panel.x),
      y: Math.round(panel.y),
      width: Math.round(panel.w),
      height: Math.round(panel.h),
    });
    writeFileSync(join(d.shotDir, `chat-night-${still}.png`), image.toPNG());
    return captureOf(new Uint8Array(image.toBitmap()), Math.round(panel.w), Math.round(panel.h));
  };
  const spreadOutsideHush = async (panel: Box, still: string): Promise<number> => {
    const shot = await capture(panel, still);
    return shot === null ? 0 : spreadOf(shot, outsideHush(panel));
  };
  const closedOf = (f: NightFacts): boolean => (!f.sheet || f.open !== "true") && f.lent === null;
  const pointerAt = async (x: number, y: number): Promise<void> => {
    input.sendInputEvent({ type: "mouseMove", x: Math.round(x), y: Math.round(y) });
    await sleep(40);
  };
  const pressEscape = (): void => {
    input.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    input.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  };

  await page(CHAT_NIGHT_RECORDER);
  d.pressChat();
  const stands = await settled(
    CHAT_NIGHT.standWaitMs,
    facts,
    (f) => f.chat !== null && f.drawn && f.newSpark !== null && !f.newSparkOff && f.hit,
  );
  const panel = stands.chat;
  const spread = panel === null ? 0 : await spreadOutsideHush(panel, "stands");
  row("stands", judgeNightStands(stands, spread));
  const button = stands.newSpark;
  if (panel === null || button === null) return problems;
  const centre = { x: button.x + button.w / 2, y: button.y + button.h / 2 };
  const away = { x: panel.x + 8, y: panel.y + 8 };

  // the lean: on New spark, and off it again
  await pointerAt(centre.x, centre.y);
  const leaning = await settled(CHAT_NIGHT.stepWaitMs, facts, (f) => f.lean === "true");
  await sleep(CHAT_NIGHT.leanSettleMs);
  const clipLeaning = leaning.lean === "true" ? (await facts()).nightClip : leaning.nightClip;
  const leftAt = await page<number>("performance.now()");
  await pointerAt(away.x, away.y);
  await settled(CHAT_NIGHT.stepWaitMs, facts, (f) => f.lean === null);
  row("lean", judgeLean(await seen(), clipLeaning, leftAt));

  // the close: New spark pressed, as a person presses it
  await pointerAt(centre.x, centre.y);
  await sleep(CHAT_NIGHT.leanSettleMs);
  input.sendInputEvent({
    type: "mouseDown",
    x: Math.round(centre.x),
    y: Math.round(centre.y),
    button: "left",
    clickCount: 1,
  });
  await sleep(50);
  input.sendInputEvent({
    type: "mouseUp",
    x: Math.round(centre.x),
    y: Math.round(centre.y),
    button: "left",
    clickCount: 1,
  });
  const stood = await settled(CHAT_NIGHT.stepWaitMs, facts, (f) => f.portal === "open");
  await capture(panel, "closed");
  row("close", judgeClose(await seen(), stood));

  // Cancel's fold
  pressEscape();
  await settled(CHAT_NIGHT.stepWaitMs, facts, closedOf);
  await sleep(CHAT_NIGHT.wordsBackMs);
  row("fold", judgeFold(await seen(), await facts(), await spreadOutsideHush(panel, "folded")));

  // the hand-off, by ⌘N and with the pointer away, so no lean moves the night
  await pointerAt(away.x, away.y);
  await settled(CHAT_NIGHT.stepWaitMs, facts, (f) => f.lean === null);
  await sleep(CHAT_NIGHT.leanSettleMs);
  await page(HIDE_WORDS);
  await sleep(100);
  const before = await capture(panel, "night-a");
  await sleep(CHAT_NIGHT.floorGapMs);
  const lentNight = await capture(panel, "night-b");
  await page(SHOW_WORDS);
  d.pressNewSparkKey();
  const open = await settled(CHAT_NIGHT.stepWaitMs, facts, (f) => f.portal === "open");
  const closed = await capture(panel, "window");
  if (before === null || lentNight === null || closed === null || open.sky === null) {
    row("handoff", [`it could not be read: sky ${JSON.stringify(open.sky)}, a capture missing`]);
  } else {
    const mask = belowTheStar(open.sky, panel);
    const floor = movedBetween(before, lentNight, mask);
    const handOff = movedBetween(lentNight, closed, mask);
    const reference = spreadOf(lentNight, mask);
    d.say(
      `SMOKE_CHAT_NIGHT_HANDOFF ${JSON.stringify({ floor, handOff, reference, scale: closed.scale })}`,
    );
    row("handoff", judgeHandOff(floor, handOff, reference));
  }
  pressEscape();
  await settled(CHAT_NIGHT.stepWaitMs, facts, closedOf);
  return problems;
}
