/**
 * How a card's face sets its one line of words and its window's words (DESIGN.md §8 "A card"; *Card Stock* round 5,
 * faces.js `head` and `WINDOW.text`; item 405). The name is set at 11.5 and set down in quarter steps to 10 before it is
 * ever cut; a file's is cut in its middle, as Finder cuts one, so its extension stays. A text window's words are set at
 * the largest of three sizes at which they fit. PURE but for `faceMeasure`, the one 2D context it measures with (it
 * never draws), and the small cache that keeps what it set: the same card is drawn by the fan, the held layer and the
 * carry.
 */

/** The width of `text` in px, set in the face's sans at `px`, weight `weight`, tracked `tracking` px. */
export type Measure = (text: string, px: number, weight: 400 | 700, tracking: number) => number;

/** The head's name: 700 at 11.5, set down by 0.25 to 10, tracked −0.22, in the 88.6 from x 21.4 to 10 inside the
 * right side. */
export const NAME = { max: 11.5, min: 10, step: 0.25, tracking: -0.22, room: 88.6 } as const;

/** A text window's three sizes, largest first, each with its line pitch; its words are inset 6 a side (88 of 100)
 * and its lines fit in 110 less 9. */
export const WORDS = {
  sizes: [
    [8.4, 11.2],
    [7.4, 10],
    [6.4, 8.8],
  ],
  tracking: -0.05,
  width: 88,
  height: 101,
} as const;

/** The longest name the head measures: past it no name could fit at 10, so the rest is never read. */
const NAME_CAP = 120;

export interface FittedName {
  /** the size it is set at */
  readonly px: number;
  /** what it prints: the name, or the name cut with an ellipsis */
  readonly text: string;
}

export interface FittedWords {
  readonly px: number;
  readonly pitch: number;
  /** the lines the window holds at that size */
  readonly lines: number;
}

/** The first `n` UTF-16 units of `text`, never splitting a pair. PURE. */
export function headOf(text: string, n: number): string {
  if (text.length <= n) return text;
  const code = text.charCodeAt(n - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n);
}

/** The longest head of `chars` (at least one) whose `shape` fits `room`. Binary: a head's width grows with it. */
function longestThatFits(
  chars: readonly string[],
  room: number,
  width: (text: string) => number,
  shape: (head: string) => string,
): string {
  let lo = 1;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (width(shape(chars.slice(0, mid).join(""))) <= room) lo = mid;
    else hi = mid - 1;
  }
  return shape(chars.slice(0, lo).join(""));
}

/** Cut at the end: after a whole word when that keeps more than half the line (its trailing punctuation dropped),
 * else where it runs out. PURE. */
function cutEnd(text: string, room: number, width: (text: string) => number): string {
  const words = text.split(" ");
  for (let n = words.length - 1; n > 0; n--) {
    const kept = `${words.slice(0, n).join(" ").replace(/[,;:·]$/u, "")}…`;
    const w = width(kept);
    if (w <= room) {
      if (w >= room * 0.55) return kept;
      break;
    }
  }
  return longestThatFits(Array.from(text), room, width, (head) => `${head.trimEnd()}…`);
}

/** Cut in the middle, as Finder cuts a file's name: its tail from three before the last dot stays. PURE. */
function cutMiddle(text: string, room: number, width: (text: string) => number): string {
  const chars = Array.from(text);
  const dot = chars.lastIndexOf(".");
  const tailFrom = dot > 0 ? Math.max(0, dot - 3) : Math.max(0, chars.length - 4);
  const tail = chars.slice(tailFrom).join("");
  return longestThatFits(chars.slice(0, tailFrom), room, width, (head) => `${head}…${tail}`);
}

/** Sets a name in the head's room (DESIGN.md §8 "A card"). With no measure (no 2D context, as in a test's DOM) the
 * name stands whole at its largest size, and the stylesheet's own clip and ellipsis hold it. PURE. */
export function fitName(
  name: string,
  middle: boolean,
  measure: Measure | null,
  room: number = NAME.room,
): FittedName {
  const text = name.length > NAME_CAP ? headOf(name, NAME_CAP) : name;
  if (measure === null) return { px: NAME.max, text };
  const at = (px: number) => (t: string) => measure(t, px, 700, NAME.tracking);
  let px: number = NAME.max;
  while (px > NAME.min && at(px)(text) > room) px -= NAME.step;
  if (text === name && at(px)(text) <= room) return { px, text };
  return { px, text: (middle ? cutMiddle : cutEnd)(text, room, at(px)) };
}

/** Whether `words`, wrapped greedily at `width`, fit in `lines` lines; it stops at the first line past them. PURE. */
function wrapsWithin(
  words: string,
  width: number,
  lines: number,
  w: (text: string) => number,
): boolean {
  let count = 0;
  let line = "";
  for (const word of words.split(/\s+/u)) {
    if (word === "") continue;
    const next = line === "" ? word : `${line} ${word}`;
    if (line === "" || w(next) <= width) {
      line = next;
      continue;
    }
    count += 1;
    if (count >= lines) return false;
    line = word;
  }
  return count + (line === "" ? 0 : 1) <= lines;
}

/** Sets a text window's words at the largest of its three sizes at which they all fit; at the smallest they are cut
 * (the stylesheet clamps the lines). No measure: the middle size. PURE. */
export function fitWords(words: string, measure: Measure | null): FittedWords {
  const [large, middle, small] = WORDS.sizes;
  const fitted = ([px, pitch]: readonly [number, number]): FittedWords => ({
    px,
    pitch,
    lines: Math.floor(WORDS.height / pitch),
  });
  if (measure === null) return fitted(middle);
  for (const size of [large, middle]) {
    const { px, lines } = fitted(size);
    if (wrapsWithin(words, WORDS.width, lines, (t) => measure(t, px, 400, WORDS.tracking))) {
      return fitted(size);
    }
  }
  return fitted(small);
}

/** The 2D context the face measures with, or null where the DOM has none (a test's DOM answers null or throws). */
function measuringContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  try {
    const context = document.createElement("canvas").getContext("2d");
    return context != null && typeof context.measureText === "function" ? context : null;
  } catch {
    return null;
  }
}

let made: Measure | null | undefined;

/** The face's own measure: one 2D context, set in the face's sans (`--vf-font-sans`), made at first use. Null where
 * there is no 2D context (a test's DOM). */
export function faceMeasure(): Measure | null {
  if (made !== undefined) return made;
  const context = measuringContext();
  if (context === null) {
    made = null;
    return made;
  }
  const family =
    getComputedStyle(document.documentElement).getPropertyValue("--vf-font-sans").trim() ||
    "system-ui, sans-serif";
  made = (text, px, weight, tracking) => {
    context.font = `${weight} ${px}px ${family}`;
    context.letterSpacing = `${tracking}px`;
    return context.measureText(text).width;
  };
  return made;
}

/** What the face has set, by what it set: a name or a window's words is measured once however many places draw it. */
const kept = new Map<string, FittedName | FittedWords>();
const KEPT_MAX = 512;

function keep<T extends FittedName | FittedWords>(key: string, make: () => T): T {
  const had = kept.get(key);
  if (had !== undefined) return had as T;
  if (kept.size >= KEPT_MAX) kept.clear();
  const value = make();
  kept.set(key, value);
  return value;
}

/** The head's name as the face sets it, kept. */
export function nameOnFace(name: string, middle: boolean): FittedName {
  return keep(`n${middle ? "m" : "e"}\u0000${name}`, () => fitName(name, middle, faceMeasure()));
}

/** A text window's words as the face sets them, kept. */
export function wordsOnFace(words: string): FittedWords {
  return keep(`w\u0000${words}`, () => fitWords(words, faceMeasure()));
}
