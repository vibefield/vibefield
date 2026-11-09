import {
  type ChipType,
  type FrameView,
  type ObjectRef,
  SCREENSHOT_LIMITS,
} from "@vibefield/contracts";
import { COVER_RESERVE_PX } from "../frame-geometry";
import { ABOUT_WORDS } from "./cards-words";

/**
 * The hand (track HN, *Cards in Hand*; DESIGN.md §8 "The hand"): every copy made
 * in VibeField, and what is brought in from another app, is a CARD at the
 * window's foot, fanned like a hand you hold. This module is the hand's pure
 * half — what a card is, where each one stands in the fan, how far the reach
 * lifts it, and the twelve (HN-D8). No DOM, no clock of its own: the suite pins
 * the numbers. The design's own words call it "the hand"; the code says
 * `cards`, because the desk's tools in hand already own `hand*`.
 *
 * What a card is (OB-D1, OB-D2; `draft/thinking-objects-at-work.md` §4): one value
 * with every FACE of what it was made from, in the kind's order, never empty. Its
 * type IS its first face's, and nothing is chosen until the card lands (§4.3).
 * What a play puts in comes from the face (`card-text.ts`, `card-landing.ts`).
 */

/** Where a card came from — the line its provenance label reads ("Godview ·
 * claude·2 · 2m ago"). `outside` is another app (HN-D2: brought in by a paste
 * with no caret, or a drag). */
export interface CardOrigin {
  readonly view: FrameView | "outside";
  /** the place inside the view: a pane's name, a field's name, a spark's */
  readonly place?: string;
  readonly how: "copy" | "snapshot" | "paste" | "drag";
}

interface FaceBase {
  /** unique on the card: "ref", "outline", "opml", "picture" */
  readonly id: string;
  readonly type: ChipType;
  /** the word on its bud only: "Live" · "Outline" · "OPML" · "Picture". A card marks its faces by icon. */
  readonly label: string;
}

/** How a text face prints on the card: words with their first sentence bold, a terminal's lines,
 * or a message with who said it. */
export type TextShow =
  | {
      readonly as: "words";
      /** the first sentence, run in bold — or the first line when there is none */
      readonly title: string;
      readonly body: string;
      /** the title is a line, not a sentence: no full stop is added after it */
      readonly bare: boolean;
    }
  | {
      readonly as: "term";
      /** the selection's first line, mono 500: a command when it is one */
      readonly first: string;
      /** the rest, cut by the face's right fade */
      readonly rest: string;
    }
  | {
      readonly as: "msg";
      readonly speaker: string;
      /** "13:58", as the thread says it */
      readonly time: string;
      readonly words: string;
    };

export interface TextFace extends FaceBase {
  readonly type: "text";
  readonly format: "plain" | "markdown" | "code";
  readonly language?: string;
  /** What a play puts in, as it was copied. Empty while the card is `waiting`, or until `atPlay` gives it. */
  readonly text: string;
  readonly show: TextShow;
  /** Words over the press's budget, read from the object at the play; null: it has gone. */
  readonly atPlay?: () => string | null;
}

export interface ImageFace extends FaceBase {
  readonly type: "image";
  /** the picture's own pixels, for its proportion and its size line */
  readonly width: number;
  readonly height: number;
  /** what the face draws: a still's `vibefield-still:` URL, or an object URL */
  readonly src: string;
  /** its file on disk: a snapshot's at once, the desk's own at the play (OB-D10 A) */
  readonly path?: string;
  /** its PNG bytes, when the window made them (the desk's Copy, a paste): what the desk prints
   * (HN-D7). A still on disk has none here; its bytes come through the shell's still door when
   * the desk asks. In memory only (HN-D9). */
  readonly bytes?: Blob;
}

export interface FileFace extends FaceBase {
  readonly type: "file";
  readonly name: string;
  /** its path on disk, what a play gives; absent for a file a page made */
  readonly path?: string;
  /** the folder it lives in, as the face prints it (mono) */
  readonly folder?: string;
  /** its first lines, read only for a text file the person brought in */
  readonly lines?: string;
  /** a file's facts when it has no lines: its size, its kind */
  readonly facts?: string;
  readonly mime?: string;
  /** Its body, produced at the play and written to the hand's folder; null: its object has gone. */
  readonly atPlay?: () => string | null;
}

export interface LinkFace extends FaceBase {
  readonly type: "link";
  readonly url: string;
  readonly title: string;
}

export interface SessionFace extends FaceBase {
  readonly type: "session";
  /** the handle the swarm and History name it by ("claude·2") */
  readonly handle: string;
  readonly run?: string;
  /** the catalog's agent id — presentation only (its mark) */
  readonly agent?: string;
  readonly project?: string;
  /** the project's dealt ink (DESIGN.md §2.9): its dot, printed before the project's name */
  readonly projectInk?: number;
  readonly state?: "working" | "waiting" | "idle" | "ended";
  /** about four lines of its last reply; absent, the window is an empty pane with the live dot */
  readonly lastWords?: string;
}

export interface RefFace extends FaceBase {
  readonly type: "ref";
  readonly ref: ObjectRef;
  /** "Mind map": the kind's word, for the card and for the model */
  readonly kindName: string;
  readonly title: string;
  /** the object as drawn at the press: the same capture as its Picture face */
  readonly still: { readonly src: string; readonly width: number; readonly height: number };
  /** several selected: the stack's other refs ("N objects") */
  readonly more?: readonly ObjectRef[];
}

export type Face = TextFace | ImageFace | FileFace | LinkFace | SessionFace | RefFace;

export interface Card {
  readonly id: string;
  /** epoch ms, when the card was dealt */
  readonly at: number;
  readonly origin: CardOrigin;
  /** a drag from another app, before the system says what it holds */
  readonly waiting?: true;
  /** what the card is called in the hand's words: the head's one line */
  readonly title: string;
  /** the held bar's bold half: "Mind map" · "TypeScript · 343 lines · 13 KB" · "PNG · 1440 × 900 · 412 KB" */
  readonly about: string;
  /** every face, in the kind's order, never empty (OB-D2). A card's type is the first's. */
  readonly faces: readonly [Face, ...Face[]];
}

/** What every card is made with, before its faces. */
export type CardStub = Pick<Card, "id" | "at" | "origin" | "waiting">;

/** A card's type: its first face's (OB-D1). PURE. */
export function cardType(card: Card): ChipType {
  return card.faces[0].type;
}

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

/** Every object URL a card's faces draw from, once each: what leaves with the card. PURE. */
export function blobUrlsOf(card: Card): readonly string[] {
  const urls = new Set<string>();
  for (const face of card.faces) {
    const src = face.type === "image" ? face.src : face.type === "ref" ? face.still.src : "";
    if (src.startsWith("blob:")) urls.add(src);
  }
  return [...urls];
}

// ── What a copy becomes ─────────────────────────────────────────────────────

/** a sentence on the first line, ending in its own . ! or ? */
const SENTENCE = /^(.{1,80}?[.!?])(\s|$)/u;

function wordsCard(
  text: string,
  show: { readonly title: string; readonly body: string; readonly bare: boolean },
  base: CardStub,
): Card {
  return {
    ...base,
    title: show.title,
    about: ABOUT_WORDS.text(text),
    faces: [
      {
        id: "text",
        type: "text",
        label: "Text",
        format: "plain",
        text,
        show: { as: "words", ...show },
      },
    ],
  };
}

/** How words print on a card: the first sentence (80 characters at most) is the title, run in bold; with none, the first
 * line is, `bare`. PURE. */
export function wordsShowOf(text: string): Extract<TextShow, { as: "words" }> {
  const trimmed = text.trim();
  const sentence = SENTENCE.exec(trimmed);
  const firstLine = trimmed.split(/\r?\n/u)[0] ?? "";
  const title = sentence?.[1] ?? firstLine;
  return { as: "words", title, body: trimmed.slice(title.length).trim(), bare: sentence === null };
}

/** A text card from words, titled as `wordsShowOf` prints them. PURE. */
export function textCardOf(text: string, base: CardStub): Card {
  return wordsCard(text, wordsShowOf(text), base);
}

/** A text card of words that are no prose, under a name of their own: titled by it as a line,
 * with a line of its own beside. What a play gives is the words. PURE. */
export function namedTextCardOf(
  text: string,
  name: { readonly title: string; readonly body: string },
  base: CardStub,
): Card {
  return wordsCard(text, { ...name, bare: true }, base);
}

/** A terminal card from a pane's selection: its first line over the rest. PURE. */
export function termCardOf(text: string, base: CardStub): Card {
  const lines = text.replace(/\s+$/u, "").split(/\r?\n/u);
  const first = lines[0] ?? "";
  return {
    ...base,
    title: first,
    about: ABOUT_WORDS.terminal(text),
    faces: [
      {
        id: "text",
        type: "text",
        label: "Terminal",
        format: "code",
        text,
        show: { as: "term", first, rest: lines.slice(1).join("\n") },
      },
    ],
  };
}

/** A message card: who said it, when, and the words. PURE. */
export function messageCardOf(
  message: { readonly speaker: string; readonly time: string; readonly words: string },
  base: CardStub,
): Card {
  return {
    ...base,
    title: `${message.speaker}: ${message.words}`,
    about: ABOUT_WORDS.message,
    faces: [
      {
        id: "text",
        type: "text",
        label: "Message",
        format: "plain",
        text: message.words,
        show: { as: "msg", ...message },
      },
    ],
  };
}

/** A picture's face, for a card of it or a card that offers it among others. PURE. */
export function pictureFaceOf(picture: Omit<ImageFace, "id" | "type" | "label">): ImageFace {
  return { id: "picture", type: "image", label: "Picture", ...picture };
}

/** A picture card, titled as the place that made it calls it. PURE. */
export function pictureCardOf(
  picture: Omit<ImageFace, "id" | "type" | "label"> & { readonly title: string },
  base: CardStub,
): Card {
  const { title, ...rest } = picture;
  return {
    ...base,
    title,
    about: ABOUT_WORDS.picture(rest),
    faces: [pictureFaceOf(rest)],
  };
}

/** A file card; one with no path (a file a page made, a drag not yet let go) has nothing to give. PURE. */
export function fileCardOf(file: Omit<FileFace, "id" | "type" | "label">, base: CardStub): Card {
  return {
    ...base,
    title: file.name,
    about: ABOUT_WORDS.file(file),
    faces: [{ id: "file", type: "file", label: "File", ...file }],
  };
}

/** An agent's card: its session. PURE. */
export function sessionCardOf(
  session: Omit<SessionFace, "id" | "type" | "label">,
  base: CardStub,
): Card {
  return {
    ...base,
    title: session.handle,
    about: ABOUT_WORDS.session,
    faces: [{ id: "session", type: "session", label: "Session", ...session }],
  };
}

/** HN-D10: is what is being brought in already the newest card? It is asked of the newest card's
 * face of the same type: text by its words (trimmed) and how they print, a file by its path — one
 * with none (a file a page made) is never a twin, nothing tells two such apart — a picture by its
 * file — or, for a picture pasted with no file, by its pixels' size: the snapshot tool puts its
 * still on the clipboard as well, so the paste right after a snapshot is that picture without its
 * path. PURE. */
export function sameAs(card: Card | undefined, incoming: Card): boolean {
  if (card === undefined) return false;
  const brought = incoming.faces[0];
  const held = card.faces.find((face) => face.type === brought.type);
  if (held === undefined) return false;
  if (held.type === "image" && brought.type === "image") {
    if (held.path !== undefined && held.path === brought.path) return true;
    return (
      brought.path === undefined && held.width === brought.width && held.height === brought.height
    );
  }
  if (held.type === "file" && brought.type === "file") {
    return held.path !== undefined && held.path === brought.path;
  }
  if (held.type === "text" && brought.type === "text") {
    const words = held.text.trim();
    return held.show.as === brought.show.as && words !== "" && words === brought.text.trim();
  }
  if (held.type === "session" && brought.type === "session") return held.handle === brought.handle;
  if (held.type === "link" && brought.type === "link") return held.url === brought.url;
  return held.type === "ref" && brought.type === "ref" && held.ref === brought.ref;
}

// ── The fan (DESIGN.md §8 "The hand", Holding them) ─────────────────────────

/** Poker size and proportion (CS-D8 A: a fifth wider than HN's 104 × 146, the same 5 : 7). */
export const CARD_W = 120;
export const CARD_H = 168;
/** What shows of every card at rest: their tips on y 712 of the default
 * window, level with the line's top. */
export const CARD_PEEK = 68;
/** How far the reach lifts a card (the height less the peek, plus 8), and the
 * distance it reaches over (120 × pitch / 66). */
export const CARD_LIFT = 108;
export const CARD_REACH = 138;
/** The fan tightens as it fills: never wider than this between cards (0.635 of
 * a card), never steeper than this at its ends. */
export const FAN_MAX_PITCH = 76;
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

/** How the hand answers the pointer in a view (DESIGN.md §8 "The hand", Holding them): the foot's
 * band it hears the pointer in, and how far the reach lifts a card. */
export interface CardReach {
  /** the foot's band: the window's bottom this many px */
  readonly band: number;
  /** how far the reach lifts a card */
  readonly lift: number;
}

/** In every view but Chat: the bottom 214, and up to 108. */
export const HAND_REACH: CardReach = { band: REACH_BAND, lift: CARD_LIFT };

/** While Chat shows (SP-1d; Q5): the band begins at the panel's foot — the cover's reserve,
 * FC-D15 — so a pointer on the thread, its composer or the 16 under it lifts no card, and a card
 * rises only its tip to that foot (20), never over the composer or under it. */
export const CHAT_REACH: CardReach = {
  band: COVER_RESERVE_PX,
  lift: COVER_RESERVE_PX - CARD_PEEK,
};

/** The reach in a view: Chat's, or the hand's. PURE. */
export function reachIn(view: FrameView): CardReach {
  return view === "assistant" ? CHAT_REACH : HAND_REACH;
}

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

/** Is the pointer in the foot's band, where the cards answer it — the view's band (`reachIn`)?
 * PURE. */
export function inReach(
  layout: CardLayout,
  win: CardWindow,
  pointer: { readonly x: number; readonly y: number } | null,
  reach: CardReach = HAND_REACH,
): boolean {
  if (pointer === null || layout.slots.length === 0) return false;
  return (
    pointer.y > win.height - reach.band &&
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
