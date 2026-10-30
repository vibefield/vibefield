import { SCREENSHOT_STILL, SHELL_CLIPBOARD, utf8ByteLength } from "@vibefield/contracts";
import { GHOSTTEA_PANE_SELECTOR } from "@vibefield/puppeteer-views";
import type { FieldHost } from "../../host";
import { sayOnLine } from "../line-door";
import {
  cancelCardDrag,
  endCardDrag,
  fieldTakesDrop,
  getCarriedCard,
  moveCardDrag,
  startCardDrag,
  subscribeCarriedCard,
} from "./card-drag";
import {
  CARD_H,
  CARD_W,
  CARDS_CAP,
  type Card,
  type CardOrigin,
  sameAs,
  textCardOf,
} from "./cards-model";
import { dealCard } from "./cards-sources";
import { type CardStore, cardsStore, type DealFrom } from "./cards-store";
import { OUTSIDE_WORDS, WAITING_WORDS } from "./cards-words";
import { isField } from "./caret";

// WHAT ANOTHER APP HANDS OVER (track HN, HN-6; DESIGN.md §8 "The hand", where cards come from —
// brought in; HN-D2, HN-D10, HN-L1, HN-L3; LC-7, LC-8). Another app's copy comes in as cards only
// when the person brings it: the clipboard is never read on its own (HN-L1), and a paste's own
// `clipboardData` and a drop's `dataTransfer` are the only reads, each made while its event is
// dispatched — after it, the transfer gives nothing.
// - ⌘V with no caret: the app menu's Edit role sends the page a paste wherever the keys are, and
//   the caret's owner takes it first (HN-L3) — a field, a Godview pane, anything that took it. One
//   listener on the document's bubble phase hears only what none of them took: one card for each
//   thing the clipboard holds, dealt from the pointer's last place; a paste of what the newest
//   card already is lifts that card instead (HN-D10), and deals none. While a card is picked up,
//   or Settings stands over the window, it is not the hand's: its card would land unseen.
// - A drag from another app is a card the moment it enters the window: the drag machine's waiting
//   card (`card-drag.ts`), its kind's index alone until the drop says what it holds. The window's
//   capture phase takes its events, so a file let go is never opened in the page's place and a
//   pane's own text drop never pastes it a second time. Let go on a pane or Chat's prompt it plays
//   straight in, once — a place registered for cards outranks the field it holds; on a field no
//   place answers for, one that takes an insert (`caret.ts`), the field takes it, as a paste goes
//   where the caret is (HN-L3), and the card is gone; anywhere else — or on a place that refused
//   what it held once it played — it settles into the hand; carried back out of the window, or
//   lost by the system, it is gone.
// A file is what its path says (the preload's `pathForFile`; none in the catalog) and a picture
// what its pixels are, read from the bytes the person handed over and kept in memory only, with
// the card (LC-7, HN-D9). What comes in is bounded as the frame's own roads are (LC-24): words
// past what one paste reads are not brought in, and a picture past the still's cap comes in as
// its file — its path, never its pixels: the bound is on pixels held in memory, and a path holds
// none. Of the rest the first twelve are (HN-D8, LC-23); the line says what was left out (§9).

/** A text file's first lines are read from this much of it, and no more. */
export const FIRST_LINES_BYTES = 640;
/** The system sends a drag's moves while it is over the window — the HTML standard's at most
 * 350ms (±200) apart, held still or not — so a drag that sends none this long was lost (called
 * off with no word to the page), and its card is gone. */
export const OUTSIDE_WATCH_MS = 1_200;
/** A card from another app hangs from its top edge, so the pointer stays clear of its face (the
 * page's). */
const OUTSIDE_GRAB = { x: CARD_W / 2, y: 12 } as const;
/** Several cards dealt at once leave a step apart, so they fan on their way in (the page's). */
const DEAL_STEP_PX = 14;
/** The system reports a drag leaving the window on its edge, not past it. */
const EDGE_PX = 1;
/** What a transfer carries that a card can be: files, or words. */
const CARD_TYPES = ["Files", "text/plain", "text/uri-list"] as const;
/** A file whose first lines are words: by its type, or by its name's kind. */
const TEXT_TYPE = /^(?:text\/|application\/(?:json|xml|javascript|yaml|toml))/u;
const TEXT_NAME = /\.(?:txt|md|json|ya?ml|toml|xml|html?|css|[cm]?[jt]sx?|rs|py|swift|sh)$/iu;

interface Point {
  readonly x: number;
  readonly y: number;
}

/** One thing a paste or a drop holds, read while its event is dispatched. */
export type Brought =
  | { readonly kind: "file"; readonly file: File; readonly folder: boolean }
  | { readonly kind: "text"; readonly text: string };

/** A picture's own pixels. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
}

/** A picture's pixels, measured; null where this renderer cannot draw it. */
export type PictureSize = (picture: Blob) => Promise<Pixels | null>;

/** The words another app handed over: its plain text, else its links (a uri-list's comment lines
 * left out). */
function wordsOf(transfer: DataTransfer): string {
  const plain = transfer.getData("text/plain");
  if (plain.trim() !== "") return plain;
  return transfer
    .getData("text/uri-list")
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .join("\n");
}

/** What a paste or a drop holds, read NOW: each file, else its words; nothing when it holds
 * neither. All of it — what the hand takes of it is `takenOf`'s. */
export function broughtIn(transfer: DataTransfer | null): readonly Brought[] {
  if (transfer === null) return [];
  const files: Brought[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file === null) continue;
    files.push({ kind: "file", file, folder: item.webkitGetAsEntry?.()?.isDirectory === true });
  }
  if (files.length === 0) {
    for (const file of Array.from(transfer.files)) {
      files.push({ kind: "file", file, folder: false });
    }
  }
  if (files.length > 0) return files;
  const words = wordsOf(transfer);
  return words.trim() === "" ? [] : [{ kind: "text", text: words }];
}

/** Is this file one a picture card would hold — its bytes kept, its pixels drawn — when this
 * renderer can draw it? A folder never is, nor a picture past the still's cap
 * (`SCREENSHOT_STILL.MAX_BYTES`, LC-24): that bound is on pixels held in memory, and a path holds
 * none, so it comes in as its file — a 200 MB image dropped on a pane pastes its path. Only its
 * size is read: it is never decoded to be sent there. PURE. */
function isPicture(file: File, folder: boolean): boolean {
  return !folder && file.type.startsWith("image/") && file.size <= SCREENSHOT_STILL.MAX_BYTES;
}

/** Why a thing is not brought in, as the line says it — or null for one a card can hold (LC-24):
 * words past what one paste reads (`SHELL_CLIPBOARD.READ_MAX_BYTES`), the bound of the frame's
 * own road for words, which have no path to come in as. A file is never refused: a picture past
 * the still's cap comes in as its file (`isPicture`). PURE. */
function refusalOf(thing: Brought): string | null {
  if (thing.kind !== "text") return null;
  const bytes = utf8ByteLength(thing.text);
  const bound = SHELL_CLIPBOARD.READ_MAX_BYTES;
  return bytes > bound ? OUTSIDE_WORDS.tooLarge(bytes, bound) : null;
}

/** What the hand takes of what was handed over (DESIGN.md §8 "The hand", brought in): of what a
 * card can hold, the first twelve, as many as the hand holds (HN-D8, LC-23); and what the line
 * says of the rest — that only twelve came in, else the words too large and why — or null when
 * all of it came in. PURE. */
export function takenOf(things: readonly Brought[]): {
  readonly taken: readonly Brought[];
  readonly left: string | null;
} {
  const holdable: Brought[] = [];
  let refused: string | null = null;
  for (const thing of things) {
    const refusal = refusalOf(thing);
    if (refusal === null) holdable.push(thing);
    else refused ??= refusal;
  }
  const taken = holdable.slice(0, CARDS_CAP);
  if (holdable.length > taken.length) {
    return { taken, left: OUTSIDE_WORDS.capped(taken.length, things.length) };
  }
  return { taken, left: refused };
}

/** Does a paste or a drag carry what a card can be? */
function carriesCards(transfer: DataTransfer | null): transfer is DataTransfer {
  return transfer !== null && CARD_TYPES.some((type) => transfer.types.includes(type));
}

/** A drag from another app before it is let go: the system says only what kind of thing it carries,
 * so the card is that kind's, waiting (HN-D2) — one picture, a file or how many, or words. */
export function waitingCardOf(
  transfer: Pick<DataTransfer, "items" | "types">,
  store: Pick<CardStore, "nextId" | "now">,
): Card {
  const files = Array.from(transfer.items).filter((item) => item.kind === "file");
  const [only] = files;
  const waiting = {
    origin: { view: "outside", how: "drag" },
    at: store.now(),
    paste: "",
    waiting: true,
  } as const;
  if (files.length === 1 && only?.type.startsWith("image/") === true) {
    return {
      ...waiting,
      id: store.nextId("pict"),
      kind: "pict",
      title: "",
      width: 0,
      height: 0,
      src: "",
    };
  }
  if (files.length > 0 || transfer.types.includes("Files")) {
    const name = files.length > 1 ? WAITING_WORDS.files(files.length) : "";
    return { ...waiting, id: store.nextId("file"), kind: "file", name };
  }
  return { ...waiting, id: store.nextId("text"), kind: "text", title: "", body: "", bare: true };
}

/** A file's kind as its name says it ("PDF"); null with none — a dot file has none. PURE. */
function kindOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : null;
}

/** What a file is and its size, as its card says when it shows no lines: "PDF · 2.4 MB". */
function factsOf(file: File): string {
  return OUTSIDE_WORDS.facts(kindOf(file.name), file.size);
}

/** Whether a file's first lines are words: by its type, or by its name's kind. PURE. */
function readsAsWords(file: File): boolean {
  return TEXT_TYPE.test(file.type) || TEXT_NAME.test(file.name);
}

/** The folder a path's file lives in, as a card's face prints it: its last two names ("src/files",
 * as a project file's reads), on either platform's separator; null for a file at the root. PURE. */
export function folderOf(path: string): string | null {
  const names = path.split(/[\\/]/u).filter((name) => name !== "");
  names.pop();
  return names.length === 0 ? null : names.slice(-2).join("/");
}

/** A text file's first lines, as many as its first 640 bytes hold whole — a line cut at the end
 * is left out — or null for one that is not words (a NUL among them) or cannot be read. */
async function firstLinesOf(file: File): Promise<string | null> {
  try {
    const head = await file.slice(0, FIRST_LINES_BYTES).text();
    if (head.includes("\u0000")) return null;
    const lines = head.split(/\r?\n/u);
    if (file.size > FIRST_LINES_BYTES) lines.pop();
    const text = lines.join("\n").trimEnd();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

/** A picture's own pixels, decoded from its bytes; null where this renderer cannot draw it (a
 * kind it does not decode, bytes that are not a picture). */
async function decodedSize(picture: Blob): Promise<Pixels | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(picture);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

interface Bringing {
  readonly store: CardStore;
  readonly how: "paste" | "drag";
  readonly pathOf: (file: File) => string | null;
  readonly measure: PictureSize;
}

/** One thing brought in as the card it is (DESIGN.md §8 "The hand", brought in): words a text
 * card; a picture this renderer can draw a picture card — its bytes kept as the card's own and
 * shown through an object URL, its pixels measured (LC-7) — with its file's path when it has one;
 * any other file (a picture it cannot draw, or one past the still's cap, included) a file card:
 * its path, the folder it lives in, its first lines when they are words, else what it is and its
 * size. */
async function cardOf(thing: Brought, bringing: Bringing): Promise<Card> {
  const { store } = bringing;
  const origin: CardOrigin = { view: "outside", how: bringing.how };
  if (thing.kind === "text") {
    return textCardOf(thing.text, { id: store.nextId("text"), origin, at: store.now() });
  }
  const { file, folder } = thing;
  const path = bringing.pathOf(file);
  if (isPicture(file, folder)) {
    const size = await bringing.measure(file).catch(() => null);
    if (size !== null) {
      return {
        id: store.nextId("pict"),
        kind: "pict",
        origin,
        at: store.now(),
        title: file.name === "" ? OUTSIDE_WORDS.picture : file.name,
        width: size.width,
        height: size.height,
        src: URL.createObjectURL(file),
        bytes: file,
        paste: path ?? "",
        ...(path === null ? {} : { path }),
      };
    }
  }
  const lines = folder || !readsAsWords(file) ? null : await firstLinesOf(file);
  const facts = folder || lines !== null ? null : factsOf(file);
  const where = path === null ? null : folderOf(path);
  return {
    id: store.nextId("file"),
    kind: "file",
    origin,
    at: store.now(),
    name: file.name === "" ? OUTSIDE_WORDS.file : file.name,
    paste: path ?? "",
    ...(where === null ? {} : { folder: where }),
    ...(lines === null ? {} : { lines }),
    ...(facts === null ? {} : { facts }),
  };
}

/** A card that never reached the hand takes its picture's object URL with it (HN-D9: nothing of
 * the hand outlives it). */
function release(card: Card): void {
  if (card.kind === "pict" && card.src.startsWith("blob:")) URL.revokeObjectURL(card.src);
}

/** Run once the drag machine draws no card: one played straight in shrinks into its place and
 * fades there first. */
function whenUncarried(run: () => void): void {
  if (getCarriedCard() === null) {
    run();
    return;
  }
  const off = subscribeCarriedCard(() => {
    if (getCarriedCard() !== null) return;
    off();
    run();
  });
}

/** Inside a Godview pane: its own paste handling takes a paste there (HN-L3), as a field's does. */
function inPane(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(GHOSTTEA_PANE_SELECTOR) !== null;
}

/** Is a point on or past the window's edge — where the system reports a drag that left it? */
function pastTheEdge(x: number, y: number): boolean {
  const right = window.innerWidth - EDGE_PX;
  const bottom = window.innerHeight - EDGE_PX;
  return x <= EDGE_PX || y <= EDGE_PX || x >= right || y >= bottom;
}

/** Where a pasted card leaves from: the point itself — the smallest box, so it leaves at the
 * deal's smallest and grows on its way in — each of several a step to the right; null with no
 * point (it rises from the foot). PURE. */
function fromPoint(at: Point | null, index: number): DealFrom | null {
  if (at === null) return null;
  return { left: at.x + index * DEAL_STEP_PX, top: at.y, width: 0, height: 0 };
}

/** Where a card let go leaves for the hand: the box it hung in from the pointer, each of several a
 * step to the right. PURE. */
function fromHung(at: Point, index: number): DealFrom {
  return {
    left: at.x - OUTSIDE_GRAB.x + index * DEAL_STEP_PX,
    top: at.y - OUTSIDE_GRAB.y,
    width: CARD_W,
    height: CARD_H,
  };
}

export interface OtherAppsOptions {
  /** The window's hand (left out: `cardsStore`). */
  readonly store?: CardStore;
  /** The shell's file door; without one (the catalog) no file has a path. */
  readonly host?: Pick<FieldHost, "pathForFile">;
  /** A picture's pixel size (left out: decoded here); a test hands its own. */
  readonly measure?: PictureSize;
  /** Whether Settings stands over the window now, read at each paste (left out: never) — it is
   * not one of the frame's surfaces, so the hand's mount says (`Cards`' `settingsOpen`). */
  readonly settingsOpen?: () => boolean;
}

/** Hear what another app hands over — ⌘V with no caret, and a drag into the window — while the
 * hand is mounted. Returns the undo, which lets a card carried in from another app go. */
export function listenForOtherApps(options: OtherAppsOptions = {}): () => void {
  if (typeof window === "undefined") return () => undefined;
  const store = options.store ?? cardsStore;
  const pathOf = (file: File): string | null => {
    try {
      const path = options.host?.pathForFile?.(file) ?? null;
      return path === "" ? null : path;
    } catch {
      return null;
    }
  };
  const cardsOf = (things: readonly Brought[], how: "paste" | "drag"): Promise<Card[]> => {
    const bringing: Bringing = { store, how, pathOf, measure: options.measure ?? decodedSize };
    return Promise.all(things.map((thing) => cardOf(thing, bringing)));
  };

  /** The pointer's last place in the window: where a paste's cards leave from. */
  let pointer: Point | null = null;
  /** A drag that began in this page — a selection, a link — is never another app's. */
  let inner = false;
  /** The drag machine's number for the carry this listener started. */
  let carrying: number | null = null;
  let watch: ReturnType<typeof setTimeout> | null = null;

  /** A card is being carried — the hand's or this listener's. One going home or into its place is
   * not: a new carry ends it (`startCardDrag`). */
  const busy = (): boolean => getCarriedCard()?.phase === "carry";
  /** The carry this listener started, still carried. */
  const ours = (): boolean => {
    const carried = getCarriedCard();
    return (
      carrying !== null &&
      carried !== null &&
      carried.drag === carrying &&
      carried.source === "outside" &&
      carried.phase === "carry"
    );
  };
  const stopWatch = (): void => {
    if (watch !== null) clearTimeout(watch);
    watch = null;
  };
  /** Carried back out of the window, or lost by the system: its card is gone — it fades where it
   * is, with no home to fly to. */
  const cancel = (): void => {
    stopWatch();
    if (ours()) cancelCardDrag();
    carrying = null;
  };
  const restartWatch = (): void => {
    stopWatch();
    watch = setTimeout(cancel, OUTSIDE_WATCH_MS);
  };
  /** The drag is a card from here: a card picked up goes back and the raised hand lowers, so the
   * carry has the window. */
  const begin = (transfer: DataTransfer, at: Point): void => {
    store.pickUp(null);
    store.raise(false);
    startCardDrag({
      card: waitingCardOf(transfer, store),
      source: "outside",
      pointerId: null,
      at,
      grab: OUTSIDE_GRAB,
      home: () => null,
    });
    carrying = getCarriedCard()?.drag ?? null;
    restartWatch();
  };

  /** ⌘V's cards: one per thing, dealt from the pointer's last place — or, for one thing the newest
   * card already is (its words, its file, its pixels: `sameAs`), that card lifted (HN-D10). */
  const dealPasted = async (things: readonly Brought[], from: Point | null): Promise<void> => {
    const cards = await cardsOf(things, "paste");
    const newest = store.newest();
    const [only] = cards;
    if (cards.length === 1 && only !== undefined && newest !== undefined && sameAs(newest, only)) {
      release(only);
      store.nudge(newest.id);
      return;
    }
    for (const [index, card] of cards.entries()) dealCard(card, fromPoint(from, index), store);
  };

  /** The drop says what the drag held: the first thing the hand takes fills the carried card,
   * which plays straight into the pane or the prompt under it — or, refused there once it played,
   * or let go anywhere else, settles into the hand from where it hung; the rest follow it into the
   * hand. A drop that held nothing a card can be is gone, and the line says so; what it held past
   * what the hand takes is said last, once the first card's own outcome has been. */
  const land = async (things: readonly Brought[], at: Point): Promise<void> => {
    const drag = carrying;
    const { taken, left } = takenOf(things);
    const cards = await cardsOf(taken, "drag");
    if (carrying !== drag || !ours()) {
      // let go of while the drop was read (the listener undone): nothing comes in
      for (const card of cards) release(card);
      return;
    }
    carrying = null;
    const [first, ...rest] = cards;
    if (first === undefined) {
      cancelCardDrag();
      sayOnLine(left ?? OUTSIDE_WORDS.nothing);
      return;
    }
    const went = await endCardDrag(at.x, at.y, first);
    if (went === "none") {
      for (const card of cards) release(card);
      return;
    }
    // a place that refused it once it played has said so (HN-L5: once); the card is the hand's
    if (went === "hand" || went === "refused") dealCard(first, fromHung(at, 0), store);
    else whenUncarried(() => release(first));
    for (const [index, card] of rest.entries()) dealCard(card, fromHung(at, index + 1), store);
    if (left !== null) sayOnLine(left);
  };

  const onPointer = (event: PointerEvent): void => {
    pointer = { x: event.clientX, y: event.clientY };
    // the system's drag holds the pointer while it lasts: a pointer heard again means it is over
    inner = false;
  };
  const onPaste = (event: ClipboardEvent): void => {
    if (!event.isTrusted || event.defaultPrevented || busy()) return;
    if (inPane(event.target) || isField(event.target)) return;
    // a card picked up is a modal, and Settings' sheet stands over the hand: a card dealt now
    // would land unseen under either
    if (store.snapshot().held !== null || options.settingsOpen?.() === true) return;
    const things = broughtIn(event.clipboardData);
    if (things.length === 0) return;
    event.preventDefault();
    const { taken, left } = takenOf(things);
    if (left !== null) sayOnLine(left);
    if (taken.length > 0) void dealPasted(taken, pointer);
  };
  const onDragStart = (): void => {
    inner = true;
  };
  const onDragEnd = (): void => {
    inner = false;
  };
  const onEnter = (event: DragEvent): void => {
    const transfer = event.dataTransfer;
    if (inner || !carriesCards(transfer)) return;
    event.preventDefault();
    const at = { x: event.clientX, y: event.clientY };
    pointer = at;
    // one card a drag — entering each element under it is the same drag — and none while a card
    // from the hand is carried
    if (!busy()) begin(transfer, at);
  };
  const onOver = (event: DragEvent): void => {
    const transfer = event.dataTransfer;
    if (inner || !carriesCards(transfer)) return;
    // always: the drop is then the page's to take, and a file let go never opens in its place
    event.preventDefault();
    transfer.dropEffect = "copy";
    const at = { x: event.clientX, y: event.clientY };
    pointer = at;
    if (ours()) {
      moveCardDrag(at.x, at.y);
      restartWatch();
    } else if (!busy()) {
      // back over the window after the system went quiet: a card again
      begin(transfer, at);
    }
  };
  const onLeave = (event: DragEvent): void => {
    if (!ours() || event.relatedTarget !== null) return;
    if (pastTheEdge(event.clientX, event.clientY)) cancel();
  };
  const onDrop = (event: DragEvent): void => {
    const transfer = event.dataTransfer;
    if (inner || !carriesCards(transfer)) return;
    const at = { x: event.clientX, y: event.clientY };
    // a field that takes an insert, and that no registered place answers for, takes the drop
    // itself, as a paste there (HN-L3): it inserts what it holds, and the card carried in is gone,
    // with nothing said. The place is asked of the card carried — or, its enter unheard, of the
    // card it would have been
    const carried = ours() ? getCarriedCard()?.card : undefined;
    if (fieldTakesDrop(at.x, at.y, carried ?? waitingCardOf(transfer, store))) {
      cancel();
      return;
    }
    // the hand's, whatever else is under it: a pane's own text drop would paste it a second time,
    // and a file let go is never opened in the page's place
    event.preventDefault();
    event.stopPropagation();
    const things = broughtIn(transfer);
    if (!ours()) {
      if (busy()) return;
      // its enter went unheard, or the system went quiet just before: a card from here
      begin(transfer, at);
    }
    stopWatch();
    void land(things, at);
  };

  const quiet = { capture: true, passive: true } as const;
  window.addEventListener("pointermove", onPointer, quiet);
  window.addEventListener("pointerdown", onPointer, quiet);
  document.addEventListener("paste", onPaste);
  window.addEventListener("dragstart", onDragStart, true);
  window.addEventListener("dragend", onDragEnd, true);
  window.addEventListener("dragenter", onEnter, true);
  window.addEventListener("dragover", onOver, true);
  window.addEventListener("dragleave", onLeave, true);
  window.addEventListener("drop", onDrop, true);
  return () => {
    window.removeEventListener("pointermove", onPointer, true);
    window.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("paste", onPaste);
    window.removeEventListener("dragstart", onDragStart, true);
    window.removeEventListener("dragend", onDragEnd, true);
    window.removeEventListener("dragenter", onEnter, true);
    window.removeEventListener("dragover", onOver, true);
    window.removeEventListener("dragleave", onLeave, true);
    window.removeEventListener("drop", onDrop, true);
    cancel();
  };
}
