import { type FrameView, SCREENSHOT_LIMITS } from "@vibefield/contracts";

/**
 * The hand (track HN, *Cards in Hand*; DESIGN.md §8 "The hand"): every copy made
 * in VibeField, and what is brought in from another app, is a CARD at the
 * window's foot, fanned like a hand you hold. This module is the hand's pure
 * half — what a card is, where each one stands in the fan, how far the reach
 * lifts it, and the twelve (HN-D8). No DOM, no clock of its own: the suite pins
 * the numbers. The design's own words call it "the hand"; the code says
 * `cards`, because the desk's tools in hand already own `hand*`.
 */

/** HN-D1, one stock and six faces: what a card can be. */
export type CardKind = "text" | "file" | "agent" | "term" | "msg" | "pict";

/** Where a card came from — the line its provenance label reads ("Godview ·
 * claude·2 · 2m ago"). `outside` is another app (HN-D2: brought in by a paste
 * with no caret, or a drag). */
export interface CardOrigin {
  readonly view: FrameView | "outside";
  /** the place inside the view: a pane's name, a field's name, a spark's */
  readonly place?: string;
  readonly how: "copy" | "snapshot" | "paste" | "drag";
}

interface CardBase {
  readonly id: string;
  readonly kind: CardKind;
  readonly origin: CardOrigin;
  /** epoch ms, when the card was dealt */
  readonly at: number;
  /** What a play puts in: a pane's paste, a prompt's text. Empty while the card
   * is `waiting` — a drag from another app, before the system says what it holds. */
  readonly paste: string;
  readonly waiting?: true;
}

export interface TextCard extends CardBase {
  readonly kind: "text";
  /** the first sentence, run in bold — or the first line when there is none */
  readonly title: string;
  readonly body: string;
  /** the title is a line, not a sentence: no full stop is added after it */
  readonly bare: boolean;
}

export interface FileCard extends CardBase {
  readonly kind: "file";
  readonly name: string;
  /** the folder it lives in, as the face prints it (mono) */
  readonly folder?: string;
  /** its first lines, read only for a text file the person brought in */
  readonly lines?: string;
  /** a file's facts when it has no lines: its size, its kind */
  readonly facts?: string;
}

export interface AgentCard extends CardBase {
  readonly kind: "agent";
  /** the handle the swarm and History name it by ("claude·2") */
  readonly handle: string;
  /** the catalog's agent id — presentation only (its mark) */
  readonly agent?: string;
  readonly project?: string;
  /** the project's dealt ink (DESIGN.md §2.9): its dot, printed before the project's name */
  readonly projectInk?: number;
  readonly state?: "working" | "waiting" | "idle" | "ended";
}

export interface TermCard extends CardBase {
  readonly kind: "term";
  /** the selection's first line, mono 500: a command when it is one */
  readonly first: string;
  /** the rest, cut by the face's right fade */
  readonly rest: string;
}

export interface MsgCard extends CardBase {
  readonly kind: "msg";
  readonly speaker: string;
  /** "13:58", as the thread says it */
  readonly time: string;
  readonly words: string;
}

export interface PictCard extends CardBase {
  readonly kind: "pict";
  readonly title: string;
  /** the picture's own pixels, for its proportion and its size line */
  readonly width: number;
  readonly height: number;
  /** what the face draws: a still's `vibefield-still:` URL, or an object URL */
  readonly src: string;
  /** the picture's file on disk, when it has one — what a pane takes (HN-L5) */
  readonly path?: string;
  /** its PNG bytes, when the window made them (the desk's Copy, a paste): what
   * the desk prints (HN-D7). A still on disk has none here; its bytes come
   * through the shell's still door when the desk asks. In memory only (HN-D9). */
  readonly bytes?: Blob;
}

export type Card = TextCard | FileCard | AgentCard | TermCard | MsgCard | PictCard;

/** HN-D8 — twelve: as many as main keeps stills, so every picture card keeps its
 * still. The thirteenth pushes the oldest off the left end. */
export const CARDS_CAP = SCREENSHOT_LIMITS.RETAINED_STILLS;

/** The hand in its order — oldest at the left, newest at the right — with the
 * new card dealt last and the oldest past the cap gone. A card already held
 * (the same id) is not dealt twice. PURE. */
export function addCard(cards: readonly Card[], card: Card): readonly Card[] {
  if (cards.some((c) => c.id === card.id)) return cards;
  const next = [...cards, card];
  return next.length > CARDS_CAP ? next.slice(next.length - CARDS_CAP) : next;
}

// ── The fan (DESIGN.md §8 "The hand", Holding them) ─────────────────────────

/** Poker size and proportion. */
export const CARD_W = 104;
export const CARD_H = 146;
/** What shows of every card at rest: their tips on y 712 of the default
 * window, level with the line's top. */
export const CARD_PEEK = 68;
/** How far the reach lifts a card, and the distance it reaches over. */
export const CARD_LIFT = 86;
export const CARD_REACH = 120;
/** The fan tightens as it fills: never wider than this between cards, never
 * steeper than this at its ends. */
export const FAN_MAX_PITCH = 66;
export const FAN_MAX_TILT = 6.5;
/** The fan keeps this clear of the line's right end, and this from the
 * window's right edge. */
export const FAN_LINE_CLEAR = 28;
export const FAN_RIGHT_CLEAR = 24;
/** Raised (⇧⌘V): every card up and straight, this far apart at most. */
export const RAISED_GAP = 14;
/** The foot's band: within it, and within this of the fan's ends, the cards
 * answer the pointer. */
export const REACH_BAND = 214;
export const REACH_SIDE = 70;
/** The line's right end, which the fan keeps clear of: the line is 300 wide at
 * 76 in (LN-D1), so 376 at every window width (DESIGN.md §10 "One frame, every
 * view"). The line's own CSS draws it; the fan only stands clear of it. */
export const CARDS_LINE_RIGHT = 376;

export interface CardSlot {
  /** the card's left edge, window px */
  readonly x: number;
  /** its top edge at rest */
  readonly y: number;
  /** its tilt, degrees */
  readonly r: number;
}

export interface CardLayout {
  readonly slots: readonly CardSlot[];
  /** the fan's left and right ends */
  readonly left: number;
  readonly right: number;
}

export interface CardWindow {
  readonly width: number;
  readonly height: number;
}

function span(win: CardWindow, lineRight: number): { min: number; max: number } {
  return { min: lineRight + FAN_LINE_CLEAR, max: win.width - FAN_RIGHT_CLEAR };
}

function placed(n: number, win: CardWindow, lineRight: number, widest: number) {
  const { min, max } = span(win, lineRight);
  const pitch = n > 1 ? Math.max(0, Math.min(widest, (max - min - CARD_W) / (n - 1))) : 0;
  const total = CARD_W + (n - 1) * pitch;
  // centred on the window, pushed right to stay clear of the line, and never
  // past the right edge's clearance unless the line leaves no room at all
  const left = Math.max(min, Math.min(win.width / 2 - total / 2, max - total));
  return { pitch, total, left };
}

/** At rest: the top `CARD_PEEK` of each card, fanned about a point below the
 * window — the ends a little lower and tilted, the middle level. PURE. */
export function layoutCards(n: number, win: CardWindow, lineRight: number): CardLayout {
  const { pitch, total, left } = placed(n, win, lineRight, FAN_MAX_PITCH);
  const tilt = Math.min(FAN_MAX_TILT, 1.3 * (n - 1));
  const slots: CardSlot[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
    slots.push({ x: left + i * pitch, y: win.height - CARD_PEEK + t * t * 7, r: t * tilt });
  }
  return { slots, left, right: left + total };
}

/** Raised (⇧⌘V): every card up by the full lift and straight. PURE. */
export function layoutRaised(n: number, win: CardWindow, lineRight: number): CardLayout {
  const { pitch, total, left } = placed(n, win, lineRight, CARD_W + RAISED_GAP);
  const slots: CardSlot[] = [];
  for (let i = 0; i < n; i += 1) {
    slots.push({ x: left + i * pitch, y: win.height - CARD_PEEK - CARD_LIFT, r: 0 });
  }
  return { slots, left, right: left + total };
}

/** The reach: each card's lift, 0…1, a smoothstep on the pointer's distance to
 * the card's centre. `null` (the pointer is elsewhere) lifts nothing. PURE. */
export function reachLift(slots: readonly CardSlot[], x: number | null): readonly number[] {
  if (x === null) return slots.map(() => 0);
  return slots.map((s) => {
    const p = Math.max(0, 1 - Math.abs(x - (s.x + CARD_W / 2)) / CARD_REACH);
    return p * p * (3 - 2 * p);
  });
}

/** Is the pointer in the foot's band, where the cards answer it? PURE. */
export function inReach(
  layout: CardLayout,
  win: CardWindow,
  pointer: { readonly x: number; readonly y: number } | null,
): boolean {
  if (pointer === null || layout.slots.length === 0) return false;
  return (
    pointer.y > win.height - REACH_BAND &&
    pointer.x > layout.left - REACH_SIDE &&
    pointer.x < layout.right + REACH_SIDE
  );
}

/** The x the reach is measured from. Above the fan's rest line, the card the
 * pointer is ON holds the reach, centred on it — otherwise a middle card's top
 * right corner (its ×) is nearer its right neighbour's centre, and the × could
 * never be reached (found on the page, v3). Below that line the pointer's own x.
 * PURE. */
export function reachX(
  layout: CardLayout,
  win: CardWindow,
  pointer: { readonly x: number; readonly y: number },
  overIndex: number,
): number {
  const slot = overIndex >= 0 ? layout.slots[overIndex] : undefined;
  if (slot !== undefined && pointer.y < win.height - CARD_PEEK) return slot.x + CARD_W / 2;
  return pointer.x;
}

/** The card the reach brings forward: the most lifted, once it is mostly up. */
export function reachedIndex(lifts: readonly number[]): number {
  let best = -1;
  lifts.forEach((v, i) => {
    if (v > 0.75 && (best < 0 || v > (lifts[best] ?? 0))) best = i;
  });
  return best;
}

// ── What a copy becomes ─────────────────────────────────────────────────────

/** a sentence on the first line, ending in its own . ! or ? */
const SENTENCE = /^(.{1,80}?[.!?])(\s|$)/u;

/** A text card from words: the first sentence (80 characters at most) is its
 * title, run in bold; with none, the first line is, `bare`. PURE. */
export function textCardOf(
  text: string,
  base: { readonly id: string; readonly origin: CardOrigin; readonly at: number },
): TextCard {
  const trimmed = text.trim();
  const sentence = SENTENCE.exec(trimmed);
  const firstLine = trimmed.split(/\r?\n/u)[0] ?? "";
  const title = sentence?.[1] ?? firstLine;
  return {
    ...base,
    kind: "text",
    title,
    body: trimmed.slice(title.length).trim(),
    bare: sentence === null,
    paste: text,
  };
}

/** A terminal card from a pane's selection: its first line over the rest. PURE. */
export function termCardOf(
  text: string,
  base: { readonly id: string; readonly origin: CardOrigin; readonly at: number },
): TermCard {
  const lines = text.replace(/\s+$/u, "").split(/\r?\n/u);
  return {
    ...base,
    kind: "term",
    first: lines[0] ?? "",
    rest: lines.slice(1).join("\n"),
    paste: text,
  };
}

/** HN-D10: is what is being brought in already the newest card? Text by its
 * words (trimmed), a file by its path, a picture by its file — or, for a
 * picture pasted with no file, by its pixels' size: the snapshot tool puts its
 * still on the clipboard as well, so the paste right after a snapshot is that
 * picture without its path. PURE. */
export function sameAs(card: Card | undefined, incoming: Card): boolean {
  if (card === undefined || card.kind !== incoming.kind) return false;
  if (card.kind === "pict" && incoming.kind === "pict") {
    if (card.path !== undefined && card.path === incoming.path) return true;
    return (
      incoming.path === undefined &&
      card.width === incoming.width &&
      card.height === incoming.height
    );
  }
  if (card.kind === "file" && incoming.kind === "file") return card.paste === incoming.paste;
  return card.paste.trim() !== "" && card.paste.trim() === incoming.paste.trim();
}
