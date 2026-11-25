import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AT_WORK_MOTION } from "../at-work/at-work-model";
import {
  BAR,
  type BarPlace,
  growMenu,
  placeBar,
  placeHand,
  type ScreenBox,
  type ViewSize,
} from "./bar-geometry";
import type { HandCell } from "./bar-hand";
import type { BarCell, MenuRow } from "./bar-model";
import {
  barMotion,
  rowDelay,
  shownTransition,
  swapAt,
  TRAVEL_GRACE_MS,
  TRAVEL_MS,
  travelTransition,
} from "./bar-motion";
import { barStats } from "./bar-stats";
import { WORDS_TOOLBAR, type WordsCell, type WordsChoice, type WordsFace } from "./bar-words";
import { ChoiceFields, type ChoiceFieldsHandle } from "./ChoiceFields";
import { KindGlyph } from "./KindGlyph";
import { PaperCard } from "./PaperCard";
import "./selection-bar.css";

// THE SELECTION BAR (DK-11; DESIGN.md §8 "The selection bar", "The bar grown — More, and right-click"; MC-1, MC-2,
// MC-5, MC-D6; R1–R10, R20, R23 reversed, R25) — and THE TOOLS IN HAND (DK-12; §8 "Tools in hand"; MC-D4, MC-D9; R2,
// R13). Controller-free (UI_SYSTEM.md): this view owns the bar's DOM, its motion, its keyboard and its focus and takes
// plain data — the cells, the menu's rows, the eyebrow, the hand's cells — while `SelectionBar` reads the desk's doors
// and runs the acts. ONE element through every role (M1): the bar on the line's glass over a selection, the same piece
// grown into its solid menu by More or a right-click (MC-D6, FC-D14), and the same piece TRAVELLING into the hand when
// an object is picked up — to y 64 under the head over the anchor's `travelMs` (560, I20) on the island curve, its
// contents swapping by a 120 ms cross-fade over the travel's last 120 ms — and back the same way (R13).
//
// PLACED IMPERATIVELY (§8: "placed imperatively each time the anchor publishes — never a render per frame"): the
// controller calls `place(anchor)` on each publish and the view writes its own transform from its measured width
// — no React render. A render happens only when what the bar SAYS changes (the selection, its acts, its words, the
// hand's tools, the mode in hand, the kind's word). The transform places the bar's CENTRE (`translateX(-50%)`), so
// its width can change with its contents — the cross-fade's 120 ms — without it leaving its place.
//
// OVER AN OBJECT AT WORK (item 550, 2026-11-18; DESIGN.md §8 "The selection bar", Place; §6 "At work on the mat"):
// the place's `clear` stands the foot off the marks. When it turns on over the same selection while the bar is seen,
// the bar travels out with the stroke's draw-on, 780 ms on the island curve; when it turns off, back with the
// stroke's retract, 460 ms on the retract curve — one transform transition, taken off one beat past its end as the
// role change's is. A clearance that changes with the selection, an unseen bar and reduced motion (M6) place at once.
//
// A CHOICE (track OM, 2026-11-25; DESIGN.md §8 "An act that is a choice", "A choice's list"; ICE I61, I62): a kind's act
// that offers choices is a PILL — its glyph, the current choice, a chevron turned down — and a tool in hand that does is
// the same pill. Pressed, the controller names it (`choosing`) and the SAME grown element lists its choices in More's
// place, over a selection or, in hand, down from under the head: the current one checked, a hint in the key's place, a
// swatch's dot, a rule where the kind's group changes. A choice that asks for values opens its fields under its row
// (ChoiceFields), and Use takes it with them. An act its kind says is disabled now is faint by ink and inert; one with a
// swatch shows the hand's dot in its glyph's place. OM-2: a choice whose every choice carries a swatch is a SWATCH PILL —
// the current choice's dot (an empty ring while Mixed) and the chevron, no words — over a selection and in hand alike.
//
// A CHANGE OF SELECTION (track OM, 2026-11-26; DESIGN.md §8 "The bar grown"): placed over another selection than the one
// it stood grown over, the grown element closes AT ONCE (`data-cut` until it next grows). Neither a list nor the fold a
// press began is carried to the next object; the controller has folded it in the read that says the new selection. A
// press the controller says lands on another object (the desk's pick) is that change already, and cuts it as it lands;
// a press on the bare mat or on the selection itself folds it where it stands (M4), fading the list that stood open.
//
// THE WORDS BAR (IK, 2026-11-25; §8 "The words bar"; ICE I60): over the words selected on a sheet being written the same
// element stands with the WORDS' row in the objects' place (the controller places it over the words' box). A choice act's
// cell swaps that row for its choices — a row in the bar's place, never a menu — by a 120 ms cross-fade, the glass's width
// following (reduced motion: halved, a fade only); Back or Esc returns. A press anywhere on it keeps the focus where it is:
// the editor's field keeps it, and with it the range the acts run on (each `pointerdown` and `mousedown` default prevented).
// Its More (V5b) grows the same element into the words' menu — Cut · Copy · Paste | Select all — as the objects' More grows
// theirs: the controller hands the words' rows as `groups`, and the same list, grow and keys serve both.

/** What the bar is placed from: the anchor's box, its count and the view (ICE's `SelectionAnchor`, narrowed). */
export interface PlaceAnchor {
  readonly box: ScreenBox | null;
  readonly count: number;
  readonly view: ViewSize;
  /** Item 550 (2026-11-18): how far the foot stands off the selected objects' edge for an object at work's marks
   * (absent or 0: above the brackets, as ever), and the selection it was read for — its entities, as one key. */
  readonly clear?: number;
  readonly selection?: string;
}

export interface SelectionBarHandle {
  /** Place the bar over the anchor: an imperative write of its place, never a render. `now: false` only
   * remembers it — the anchor whose publish changed what the bar says, placed once the bar has re-rendered. */
  place(anchor: PlaceAnchor, now?: boolean): void;
}

/** The bar's role: over a selection, or the tools in hand (§8). */
export type BarRole = "selection" | "hand";

/** IK — the words' row the bar stands in over the selected words (§8 "The words bar"). */
export interface WordsRow {
  /** Its cells, read by the product's own model (bar-words.ts `wordsCells`). */
  readonly cells: readonly WordsCell[];
  /** The run of words it was read for: a new run (a new range after the words went) closes an open choices row. */
  readonly run: number;
}

/** IK — a words act pressed: its id, and the choice made for a choice act's (the controller runs it: `runWordsAct`, bar-acts.ts). */
export interface WordsPress {
  readonly act: string;
  readonly choice?: string;
}

/** A choice act's cell — its choices are the row it swaps in. */
type ChoiceCell = Extract<WordsCell, { readonly kind: "choice" }>;

const isChoice = (cell: WordsCell): cell is ChoiceCell => cell.kind === "choice";

/** Where the focus goes after a swap made from the keyboard: into the row that came, or back to its opener. */
type WordsFocus = { readonly to: "pick" } | { readonly to: "opener"; readonly id: string };

export interface SelectionBarViewProps {
  readonly cells: readonly BarCell[];
  /** The grown menu's rows, nearest first, in their groups — More's, or a choice's list (track OM). */
  readonly groups: readonly (readonly MenuRow[])[];
  /** Whose choices the grown bar lists, while it lists a choice's (ICE I62): its pill is shown on, the list's rows are its. */
  readonly choosing?: { readonly of: "act" | "tool"; readonly id: string } | null;
  /** A plate's row whose fields stand open as it mounts (the catalog); the product opens them by taking the row. */
  readonly expandedRow?: string;
  /** What the menu acts on, at its far end ("NOTE", "2 OBJECTS", "CLOCK · PLUGIN OFF"). */
  readonly eyebrow: string;
  /** A selection on screen to stand over — or an object in hand (false: the bar fades out, keeping what it said). */
  readonly shown: boolean;
  /** A gesture is on, or a note is being written — or, in hand, the object flies home: the bar steps aside (R8). */
  readonly stepAside: boolean;
  /** The bar grown into its menu — one of the frame's open surfaces (R5). */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Whether a press lands on another object than the selection — the controller's, by the desk's pick (track OM,
   * 2026-11-26). Such a press IS a change of selection: the grown bar closes at once instead of folding. */
  readonly pressSelects?: (event: PointerEvent) => boolean;
  /** A cell pressed (every act but More, which grows the bar). */
  readonly onCell: (cell: BarCell) => void;
  /** A row taken — a choice that asks for values with its fields' values. */
  readonly onRow: (row: MenuRow, values?: Readonly<Record<string, number | string>>) => void;
  /** DK-12 — an object is in hand: the bar's role is the tools in hand under the head (else over the selection). */
  readonly held?: boolean;
  /** DK-12 — the tools in hand's cells (bar-hand.ts `handCells`). */
  readonly hand?: readonly HandCell[];
  /** DK-12 — the travel between the roles, ms: the anchor's `held.travelMs` (I20); the layer's 560 when it carries none. */
  readonly travelMs?: number;
  /** DK-12 — a tool used, or Done (the controller runs `ops.useHeldTool` / `ops.putDown`); HN-D3 — Copy in hand. */
  readonly onHand?: (cell: HandCell) => void;
  /** Reduced motion (M6, R8): every duration halved, fades only. */
  readonly reduced?: boolean;
  /** IK — words selected on a sheet being written: the words' row in place of the objects' (§8 "The words bar"); null or
   * absent, the objects' row. */
  readonly words?: WordsRow | null;
  /** IK — a words act pressed, or one of a choice act's choices (the row stays: a second choice replaces the first). */
  readonly onWords?: (press: WordsPress) => void;
  /** IK — a plate's open choices row (the catalog): the choice act whose choices the words' row shows as it mounts. */
  readonly wordsOpen?: string;
  /** A plate's fixed place (the catalog): the view places itself from it. The product places imperatively. */
  readonly fixed?: PlaceAnchor;
  readonly handleRef?: Ref<SelectionBarHandle>;
}

/** The cells a key can reach — the buttons; the missing face's words and the rules are not stops. */
const focusable = (cell: BarCell): boolean => cell.kind !== "rule" && cell.kind !== "words";
/** In hand: the buttons — the readout and the rules are not stops. */
const handFocusable = (cell: HandCell): boolean => cell.kind !== "rule" && cell.kind !== "readout";

const cellKey = (cell: BarCell, index: number): string => {
  switch (cell.kind) {
    case "rule":
      return `rule-${cell.at}`;
    case "act":
    case "choice":
      return `act-${cell.id}`;
    case "desk":
      return cell.act;
    default:
      return `${cell.kind}-${index}`;
  }
};

const handKey = (cell: HandCell, index: number): string => {
  switch (cell.kind) {
    case "rule":
      return `rule-${cell.at}`;
    case "tool":
      return `tool-${cell.id}`;
    default:
      return `${cell.kind}-${index}`;
  }
};

/** A reduced-motion role change, a fade only: out at the old place, then in at the new one. */
type SwapPhase = "none" | "out" | "in";

/** The foot's travel clear of an object at work's marks, under way: out with the draw-on, back with the retract. */
type Clearing = "none" | "out" | "back";

/** The clearance the bar last stood at, and the selection it was read for. */
interface StoodClear {
  readonly atWork: boolean;
  readonly selection: string | undefined;
}

/** The retract's curve (DESIGN.md §6), as the chat's and the bloom's own CSS spell it. */
const RETRACT = "cubic-bezier(0.4, 0, 1, 1)";

/** Item 550 (2026-11-18): the foot's transform transition clear of an object at work's marks — out with the stroke's
 * draw-on on the island curve, back with its retract (DESIGN.md §6 "At work on the mat"). */
export function clearanceTransition(out: boolean): string {
  return out
    ? travelTransition(AT_WORK_MOTION.drawMs)
    : `transform ${AT_WORK_MOTION.eraseMs}ms ${RETRACT}`;
}

const NO_HAND: readonly HandCell[] = [];

/**
 * A choice's pill inside (§8 "An act that is a choice"), over a selection and in hand: its glyph, the current choice's
 * label and `chevron` 12 turned down — or a SWATCH PILL's (track OM, OM-2, 2026-11-25): the current choice's dot, its ink
 * the pill's `--vf-bar-swatch` (an empty ring while Mixed, the stylesheet's), and the chevron, no words.
 */
function choiceFace(
  swatches: boolean,
  glyph: Extract<BarCell, { kind: "choice" }>["glyph"],
  label: string,
  current: string,
): ReactElement {
  return (
    <>
      {swatches ? (
        <span className="vf-bar-dot-ink" aria-hidden="true" />
      ) : (
        <>
          {glyph === undefined ? null : <KindGlyph glyph={glyph} label={label} />}
          <span className="vf-bar-choice-label">{current}</span>
        </>
      )}
      <FieldGlyph name="chevron" size={12} turn={90} className="vf-bar-chevron" />
    </>
  );
}

export function SelectionBarView({
  cells,
  groups,
  eyebrow,
  shown,
  stepAside,
  open,
  choosing = null,
  expandedRow,
  onOpenChange,
  pressSelects,
  onCell,
  onRow,
  held = false,
  hand = NO_HAND,
  travelMs = TRAVEL_MS,
  onHand,
  reduced = false,
  words,
  onWords,
  wordsOpen,
  fixed,
  handleRef,
}: SelectionBarViewProps): ReactElement {
  barStats.renders += 1;
  const role: BarRole = held ? "hand" : "selection";
  const motion = barMotion(reduced);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const handRowRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  /** The bar's own row width, measured after each content change. */
  const widthRef = useRef(0);
  /** The tools in hand's row width, measured after each content change. */
  const handWidthRef = useRef(0);
  /** The list's natural height (rows, rules, eyebrow, padding), measured after each content change. */
  const listNatural = useRef(0);
  const lastAnchor = useRef<PlaceAnchor | null>(fixed ?? null);
  const placed = useRef<BarPlace | null>(null);
  /** The selection the grown element last stood open over (the anchor's key), until it is cut over another. */
  const grownOver = useRef<string | undefined>(undefined);
  const openRef = useRef(open);
  openRef.current = open;
  /** The role the bar is placed for — its target; the face below is what it SHOWS (they differ through a travel). */
  const roleRef = useRef<BarRole>(role);
  /** Opened from the keyboard: the hot row takes the focus as it shows. */
  const focusOnOpen = useRef(false);
  const [rover, setRover] = useState(0);
  const [handRover, setHandRover] = useState(0);
  const [hot, setHot] = useState<string | null>(null);
  /** The row whose fields are open under it (a choice that asks for values), or null (ICE I62). */
  const [expanded, setExpanded] = useState<string | null>(expandedRow ?? null);
  /** The row a plate opened as it mounted: its fields take no focus (the person opened none). */
  const seeded = useRef(expandedRow);
  const fieldsRef = useRef<ChoiceFieldsHandle>(null);
  const choosingRef = useRef(choosing);
  choosingRef.current = choosing;
  // THE FOLD FOLDS WHAT STOOD OPEN (track OM, 2026-11-26; M4): the list as it last stood open, its rows and its eyebrow,
  // stays in it until it next grows, so a fold fades the rows it folds. The controller names More's menu again as the
  // list closes, and those rows, new and unseen, would leave the material empty as it folds.
  const [stood, setStood] = useState({ groups, eyebrow });
  if (open && (stood.groups !== groups || stood.eyebrow !== eyebrow)) setStood({ groups, eyebrow });
  const listGroups = open ? groups : stood.groups;
  const listEyebrow = open ? eyebrow : stood.eyebrow;

  // AWAY for a gesture and while a note is written (R8) — and, in hand, while the object flies home: out at once, back
  // `backMs` (200) after it ends
  const [away, setAway] = useState(stepAside);
  useEffect(() => {
    if (stepAside) {
      setAway(true);
      return;
    }
    const t = setTimeout(() => setAway(false), motion.backMs);
    return () => clearTimeout(t);
  }, [stepAside, motion.backMs]);

  // THE ROLE CHANGE (DK-12, M1, R13): what the bar SHOWS (`face`) follows its role at the travel's end
  const [face, setFace] = useState<BarRole>(role);
  const faceRef = useRef<BarRole>(role);
  const [traveling, setTraveling] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swapPhase, setSwapPhase] = useState<SwapPhase>("none");
  const swapPhaseRef = useRef<SwapPhase>("none");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // OVER AN OBJECT AT WORK (item 550): the foot's travel clear of the marks, and the clearance it last stood at (null:
  // none yet, or in hand)
  const [clearing, setClearing] = useState<Clearing>("none");
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoodClear = useRef<StoodClear | null>(null);
  const visible = shown && !away && swapPhase !== "out";
  /** Whether the bar was SEEN as of the last render committed — what a role change travels from, or not. */
  const wasVisible = useRef(visible);
  const roleSeen = useRef(role);
  /** The tools in hand as last given — they stay on their row through the travel home and its cross-fade. */
  const lastHand = useRef(hand);
  if (hand.length > 0) lastHand.current = hand;
  const handShown = role === "hand" || face === "hand" || swapping ? lastHand.current : NO_HAND;

  // IK — THE WORDS' ROW (§8 "The words bar"): in the objects' place while words are given; a choice act's choices swap into
  // the row's place. Every choice act's row is drawn beside the main one, out, so a swap cross-fades both ways.
  const wordsRow = words ?? null;
  const wordsShown = wordsRow !== null;
  /** The words' row is what the bar shows (its width is the glass's) — read by the place and the fit. */
  const wordsModeRef = useRef(wordsShown);
  wordsModeRef.current = wordsShown;
  /** The open choice act, by id: its choices stand in the words' row until Back or Esc. */
  const [choiceAt, setChoiceAt] = useState<string | null>(wordsOpen ?? null);
  // a new run of words — a new range after the words went, or none — closes the choices (state derived as it renders)
  const [runSeen, setRunSeen] = useState(wordsRow?.run);
  if (wordsRow?.run !== runSeen) {
    setRunSeen(wordsRow?.run);
    if (choiceAt !== null) setChoiceAt(null);
  }
  const opener =
    choiceAt === null
      ? undefined
      : wordsRow?.cells.find((c): c is ChoiceCell => isChoice(c) && c.id === choiceAt);
  /** The words' row shown: "main", or the open choice act's id. */
  const wordsAt = opener?.id ?? "main";
  /** Each words' row element by its key ("main", or its choice act's id) — measured, and walked by the keys. */
  const wordsRows = useRef(new Map<string, HTMLDivElement>());
  /** The shown words' row's width, measured after each content change. */
  const wordsWidthRef = useRef(0);
  const [wordsRover, setWordsRover] = useState(0);
  /** The open choices row's stop: 0 is Back, k + 1 the k-th choice. */
  const [pickRover, setPickRover] = useState(0);
  /** A swap between the words' rows is on: the glass's width follows over the cross-fade. */
  const [wordsSwapping, setWordsSwapping] = useState(false);
  const wordsSwapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A swap made from the keyboard: where the focus goes once the row has come. */
  const wordsFocus = useRef<WordsFocus | null>(null);

  /** The root's transitions: its opacity's (shown, away, out — or a reduced role change's fade), the travel's transform
   * while it travels (else the foot's travel clear of an object at work's marks, item 550), and the width's while the
   * contents cross-fade. */
  const transitionOf = (
    phase: SwapPhase,
    travelOn: boolean,
    swapOn: boolean,
    shownNow: boolean,
    awayNow: boolean,
    clearOn: Clearing,
  ): string => {
    const parts = [
      phase === "out"
        ? `opacity ${motion.swapMs}ms ease-out, visibility 0s linear ${motion.swapMs}ms`
        : phase === "in"
          ? `opacity ${motion.swapMs}ms ease-out`
          : shownTransition(motion, !shownNow ? "out" : awayNow ? "away" : "in"),
    ];
    if (travelOn) parts.push(travelTransition(travelMs));
    else if (clearOn !== "none") parts.push(clearanceTransition(clearOn === "out"));
    if (swapOn) parts.push(`width ${motion.swapMs}ms ease`);
    return parts.join(", ");
  };
  /** This render's transitions with a clearance travel on (item 550): what `place` writes before the new place. */
  const clearingTransition = useRef<(clearOn: Clearing) => string>(() => "");
  clearingTransition.current = (clearOn) =>
    transitionOf(swapPhase, traveling, swapping, shown, away, clearOn);
  const travelsRef = useRef(motion.travels);
  travelsRef.current = motion.travels;

  /** The width of the row the bar stands in: the tools in hand's, the words' row shown (IK), or the objects'. */
  const rowWidth = useCallback(
    (hand: boolean): number =>
      hand ? handWidthRef.current : wordsModeRef.current ? wordsWidthRef.current : widthRef.current,
    [],
  );

  /** The width of what the bar shows — its glass — written with its place. */
  const fit = useCallback((): void => {
    const root = rootRef.current;
    if (root === null) return;
    root.style.width = `${rowWidth(faceRef.current === "hand")}px`;
  }, [rowWidth]);

  /** THE GROW (R6, R20): the one element's material grows from the bar's own row — up, or down with the row
   * heading it — to the menu, which is placed from that row; written imperatively, as the place is. */
  const layoutGrow = useCallback((): void => {
    const root = rootRef.current;
    const at = placed.current;
    const anchor = lastAnchor.current;
    if (root === null) return;
    const set = (name: string, px: number): void => root.style.setProperty(name, `${px}px`);
    // grown over a selection — or in hand, for a tool's choices (the controller grows nothing else there)
    if (!openRef.current || at === null || anchor === null) {
      for (const name of [
        "--vf-bar-grow-l",
        "--vf-bar-grow-r",
        "--vf-bar-grow-t",
        "--vf-bar-grow-b",
      ])
        set(name, 0);
      return;
    }
    // grown, it is this selection's, and its motion is its own again (a cut, below, lasts until it grows)
    grownOver.current = anchor.selection;
    delete root.dataset.cut;
    const w = rowWidth(roleRef.current === "hand");
    const g = growMenu({ x: at.x, y: at.y, width: w }, listNatural.current, anchor.view);
    const listOut = g.listHeight + 1; // the list and the strong hairline between it and the row
    set("--vf-bar-grow-l", at.x - g.x);
    set("--vf-bar-grow-r", g.x + g.width - (at.x + w));
    set("--vf-bar-grow-t", g.up ? listOut : 0);
    set("--vf-bar-grow-b", g.up ? 0 : listOut);
    set("--vf-bar-list-x", g.x - at.x);
    set("--vf-bar-list-w", g.width);
    set("--vf-bar-list-h", g.listHeight);
    root.dataset.dir = g.up ? "up" : "down";
    root.dataset.scroll = g.scroll ? "true" : "false";
  }, [rowWidth]);

  /** Item 550: the foot travels clear of the marks (`out`) or back — while the bar is seen and travels at all. The
   * transition goes on before the new place is written, and comes off one beat past its end. */
  const travelClear = useCallback((root: HTMLElement, out: boolean): void => {
    if (!wasVisible.current || !travelsRef.current) return;
    const kind: Clearing = out ? "out" : "back";
    if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    root.style.transition = clearingTransition.current(kind);
    setClearing(kind);
    clearTimer.current = setTimeout(
      () => {
        clearTimer.current = null;
        setClearing("none");
      },
      (out ? AT_WORK_MOTION.drawMs : AT_WORK_MOTION.eraseMs) + TRAVEL_GRACE_MS,
    );
  }, []);
  useEffect(
    () => () => {
      if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    },
    [],
  );

  const place = useCallback(
    (anchor: PlaceAnchor, now = true): void => {
      lastAnchor.current = anchor;
      if (!now) return;
      const root = rootRef.current;
      const inHand = roleRef.current === "hand";
      const w = rowWidth(inHand);
      const at = inHand ? placeHand(anchor.view, w) : placeBar(anchor, w, anchor.clear ?? 0);
      if (root === null || at === null) return;
      placed.current = at;
      // a reduced role change places at its swap point, unseen (a fade only): this anchor is remembered for it
      if (swapPhaseRef.current === "out") return;
      // item 550: a clearance that turned on or off over the same selection travels; in hand there is none
      const atWork = !inHand && (anchor.clear ?? 0) > 0;
      const stood = stoodClear.current;
      stoodClear.current = inHand ? null : { atWork, selection: anchor.selection };
      if (
        stood !== null &&
        stood.atWork !== atWork &&
        stood.selection !== undefined &&
        stood.selection === anchor.selection
      ) {
        travelClear(root, atWork);
      }
      root.style.transform = `translate(${(at.x + w / 2).toFixed(1)}px, ${at.y.toFixed(1)}px) translateX(-50%)`;
      root.dataset.below = at.below ? "true" : "false";
      fit();
      barStats.placements += 1;
      // track OM (2026-11-26): over another selection than the one it stood grown over, the grown element closes AT
      // ONCE. `data-cut` takes its parts' motion off until it next grows, so a fold that a press on this object
      // began is never carried here
      const over = grownOver.current;
      if (
        !openRef.current &&
        over !== undefined &&
        anchor.count > 0 &&
        anchor.selection !== undefined &&
        anchor.selection !== over
      ) {
        grownOver.current = undefined;
        root.dataset.cut = "";
        layoutGrow();
      }
      if (openRef.current) layoutGrow();
    },
    [layoutGrow, fit, travelClear, rowWidth],
  );
  useImperativeHandle(handleRef, () => ({ place }), [place]);

  const clearTimers = useCallback((): void => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // THE ROLE CHANGE — declared before the content's measure-and-place, so the travel's transition is on before the new
  // place is written (else the bar jumps). Seen, it TRAVELS: the transform over `travelMs` on the island curve, the face
  // changing at the travel's last 120 ms (the rows cross-fade and the glass's width follows), the transition off at the
  // end so a moving selection places instantly again. Reduced (M6): out over half the swap, the new place and face, in
  // over the other half. Unseen (the bar hidden as the hand came or went): the new face at once, placed where it stands.
  useLayoutEffect(() => {
    if (role === roleSeen.current) return;
    roleSeen.current = role;
    roleRef.current = role;
    // a role change travels on its own: the clearance is read afresh from the next place (item 550)
    stoodClear.current = null;
    clearTimers();
    const root = rootRef.current;
    const settle = (): void => {
      faceRef.current = role;
      setFace(role);
    };
    if (!wasVisible.current || root === null) {
      setTraveling(false);
      setSwapping(false);
      swapPhaseRef.current = "none";
      setSwapPhase("none");
      settle();
      return;
    }
    if (!motion.travels) {
      swapPhaseRef.current = "out";
      setSwapPhase("out");
      timers.current.push(
        setTimeout(() => {
          settle();
          swapPhaseRef.current = "in";
          setSwapPhase("in");
          const anchor = lastAnchor.current;
          if (anchor !== null) place(anchor);
          timers.current.push(
            setTimeout(() => {
              swapPhaseRef.current = "none";
              setSwapPhase("none");
            }, motion.swapMs),
          );
        }, motion.swapMs),
      );
      return;
    }
    root.style.transition = transitionOf("none", true, false, true, false, "none");
    setTraveling(true);
    setSwapping(false);
    timers.current.push(
      setTimeout(
        () => {
          settle();
          setSwapping(true);
        },
        swapAt(motion, travelMs),
      ),
      setTimeout(() => {
        setTraveling(false);
        setSwapping(false);
      }, travelMs + TRAVEL_GRACE_MS),
    );
  }, [role]);

  // what was seen, for the next role change (after the role change has read it)
  useLayoutEffect(() => {
    wasVisible.current = visible;
  });

  // the face changed: the glass takes the width of what it now shows (over the cross-fade, while `swapping`)
  useLayoutEffect(() => {
    faceRef.current = face;
    fit();
  }, [face, fit]);

  // A content change: measure the rows and the list, then place from the last anchor — the publish that changed
  // the content placed nothing (the controller leaves it to this), so it is still one placement for one publish.
  useLayoutEffect(() => {
    widthRef.current = rowRef.current?.offsetWidth ?? 0;
    handWidthRef.current = handRowRef.current?.offsetWidth ?? 0;
    wordsWidthRef.current = wordsRows.current.get(wordsAt)?.offsetWidth ?? 0;
    listNatural.current = listRef.current?.scrollHeight ?? 0;
    const anchor = fixed ?? lastAnchor.current;
    if (anchor !== null) place(anchor);
  }, [cells, handShown, listGroups, listEyebrow, expanded, fixed, place, wordsRow, wordsAt]);

  // the grow follows `open`; the hot row is the nearest takeable one as it opens
  useLayoutEffect(() => {
    layoutGrow();
    if (!open) {
      setHot(null);
      return;
    }
    const nearest = groups.flat().find((row) => row.waits === undefined);
    setHot(nearest?.id ?? null);
  }, [open, groups, layoutGrow]);
  // a row's fields close with the list, and when another list takes its place (state kept from the last render)
  const listOf = open ? `${choosing?.of ?? "more"}:${choosing?.id ?? ""}` : "";
  const [listSeen, setListSeen] = useState(listOf);
  if (listSeen !== listOf) {
    setListSeen(listOf);
    setExpanded(null);
  }

  /** Where the focus goes back to as the list folds from the keyboard: the pill whose list it was, else More. */
  const focusOrigin = useCallback((): void => {
    const now = choosingRef.current;
    // found by its data, never by a selector built from the kind's id
    const pill =
      now === null
        ? undefined
        : now.of === "act"
          ? [...(rowRef.current?.querySelectorAll<HTMLElement>("[data-act]") ?? [])].find(
              (el) => el.dataset.act === `act:${now.id}`,
            )
          : [...(handRowRef.current?.querySelectorAll<HTMLElement>("[data-tool]") ?? [])].find(
              (el) => el.dataset.tool === now.id,
            );
    (pill ?? moreRef.current)?.focus({ preventScroll: true });
  }, []);

  // IK — the words' menu grows from the words' MAIN row, where its More stands: a right-click over the pens' row returns it
  useEffect(() => {
    if (open) setChoiceAt(null);
  }, [open]);

  // keyboard-opened: the hot row takes the focus once it can
  useEffect(() => {
    if (!open || !focusOnOpen.current || hot === null) return;
    focusOnOpen.current = false;
    rowElement(hot)?.focus({ preventScroll: true });
  }, [open, hot]);

  /** A row's element by its id (no selector built from it). */
  const rowElement = (id: string): HTMLElement | undefined =>
    [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])].find(
      (el) => el.dataset.row === id,
    );

  /** The rows a key walks, nearest first — those that can be taken. */
  const takeable = useCallback(
    (): MenuRow[] => groups.flat().filter((row) => row.waits === undefined),
    [groups],
  );

  const walk = useCallback(
    (key: "ArrowUp" | "ArrowDown"): void => {
      const rows = takeable();
      if (rows.length === 0) return;
      const at = rows.findIndex((row) => row.id === hot);
      // grown up the list reads bottom-up, nearest first: ↑ walks AWAY from the bar there, toward it grown down
      const up = rootRef.current?.dataset.dir !== "down";
      const away = key === "ArrowUp" ? up : !up;
      const next = rows[at < 0 ? 0 : (at + (away ? 1 : rows.length - 1)) % rows.length];
      if (next === undefined) return;
      setHot(next.id);
      if (rootRef.current?.contains(document.activeElement))
        rowElement(next.id)?.focus({ preventScroll: true });
    },
    [hot, takeable],
  );

  const take = useCallback(
    (row: MenuRow): void => {
      if (row.waits !== undefined) return;
      // a choice that asks for values opens its fields under its row; More's row for a choice act opens its list
      if (row.fields !== undefined) {
        seeded.current = undefined;
        setExpanded((now) => (now === row.id ? null : row.id));
        return;
      }
      if (row.opens !== true) onOpenChange(false);
      onRow(row);
    },
    [onOpenChange, onRow],
  );
  /** Use: the choice taken with its fields' values, the list folding. */
  const use = useCallback(
    (row: MenuRow, values: Readonly<Record<string, number | string>>): void => {
      const inside = rootRef.current?.contains(document.activeElement) === true;
      onOpenChange(false);
      onRow(row, values);
      if (inside) focusOrigin();
    },
    [onOpenChange, onRow, focusOrigin],
  );

  // OPEN: it closes on Esc — taken before the desk's Esc ladder (R5) — and on a press anywhere else; ↑ ↓ walk and
  // Return takes, wherever the focus is but a field being typed in (the desk's arrows never nudge under a menu)
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (root?.contains(event.target as Node)) return;
      // a press on another object IS a change of selection (track OM, 2026-11-26): the grown element closes at once,
      // nothing of it folding over the object it leaves; on the bare mat or the selection itself it folds (M4)
      if (root !== null && pressSelects?.(event) === true) {
        grownOver.current = undefined;
        root.dataset.cut = "";
      }
      onOpenChange(false);
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName));
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        // in a choice's field: its value put back first; Esc again folds the list (§8 "A choice's list")
        if (
          typing &&
          rootRef.current?.contains(target) === true &&
          fieldsRef.current?.escape() === true
        )
          return;
        const inside = rootRef.current?.contains(document.activeElement) === true;
        onOpenChange(false);
        if (inside) focusOrigin();
        return;
      }
      if (typing) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        event.stopImmediatePropagation();
        walk(event.key);
        return;
      }
      if (event.key === "Enter") {
        const row = takeable().find((r) => r.id === hot);
        if (row === undefined) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        take(row);
        if (
          row.fields === undefined &&
          row.opens !== true &&
          rootRef.current?.contains(document.activeElement)
        )
          focusOrigin();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpenChange, pressSelects, walk, take, takeable, hot, focusOrigin]);

  // IK — THE SWAP between the words' rows (§8 "The words bar"): to a choice act's choices, or back to the main row, by the
  // 120 ms cross-fade, the glass's width following (reduced motion: a fade alone). The open row's stop is the words' choice,
  // else Back.
  const swapWords = useCallback(
    (to: ChoiceCell | null, focus: WordsFocus | null): void => {
      wordsFocus.current = focus;
      setChoiceAt(to?.id ?? null);
      if (to !== null) setPickRover(to.choices.findIndex((c) => c.on) + 1);
      setWordsSwapping(true);
      if (wordsSwapTimer.current !== null) clearTimeout(wordsSwapTimer.current);
      wordsSwapTimer.current = setTimeout(() => {
        wordsSwapTimer.current = null;
        setWordsSwapping(false);
      }, motion.swapMs + TRAVEL_GRACE_MS);
    },
    [motion.swapMs],
  );
  useEffect(
    () => () => {
      if (wordsSwapTimer.current !== null) clearTimeout(wordsSwapTimer.current);
    },
    [],
  );

  // a swap made from the keyboard: the focus goes into the row that came — the words' choice, else Back — or back to the
  // cell that opened it (asked after each render the row or its acts changed; only a swap leaves a focus to give)
  useEffect(() => {
    const focus = wordsFocus.current;
    if (focus === null) return;
    wordsFocus.current = null;
    if (focus.to === "pick") {
      if (opener === undefined) return;
      const at = opener.choices.findIndex((c) => c.on) + 1;
      wordsRows.current
        .get(opener.id)
        ?.querySelector<HTMLElement>(`[data-cell="${at}"]`)
        ?.focus({ preventScroll: true });
      return;
    }
    const index = wordsRow?.cells.findIndex((c) => isChoice(c) && c.id === focus.id) ?? -1;
    if (index < 0) return;
    setWordsRover(index);
    wordsRows.current
      .get("main")
      ?.querySelector<HTMLElement>(`[data-cell="${index}"]`)
      ?.focus({ preventScroll: true });
  }, [opener, wordsRow]);

  // ESC while a choice act's choices are open returns to the main row — taken on the capture phase, ahead of the editor's
  // field (whose lease would let the sheet go) and of the desk's Esc ladder; never an IME's own Esc
  const choicesOpen = opener !== undefined;
  const openerId = opener?.id;
  useEffect(() => {
    if (!choicesOpen || !visible || openerId === undefined) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const inside = rootRef.current?.contains(document.activeElement) === true;
      swapWords(null, inside ? { to: "opener", id: openerId } : null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [choicesOpen, visible, openerId, swapWords]);

  // A PRESS ON THE WORDS' ROW KEEPS THE FOCUS where it is (§8, I60): the editor's field holds it and the range with it, so
  // the act runs on the words — the default of every press's `pointerdown` and `mousedown` prevented (the click still comes)
  useEffect(() => {
    const root = rootRef.current;
    if (root === null || !wordsShown) return;
    const keep = (event: Event): void => event.preventDefault();
    root.addEventListener("pointerdown", keep);
    root.addEventListener("mousedown", keep);
    return () => {
      root.removeEventListener("pointerdown", keep);
      root.removeEventListener("mousedown", keep);
    };
  }, [wordsShown]);

  // THE TOOLBAR'S KEYS (R9): ← → between its cells, Home End to its ends, Esc back to the desk, Enter and Space
  // run the cell — each taken from the desk's keymap (its arrows nudge, its ⏎ opens, its Esc climbs out). In hand the
  // tools in hand are a toolbar of their own, keyed the same way.
  const stops = cells.map((cell, index) => (focusable(cell) ? index : -1)).filter((i) => i >= 0);
  const rovingAt = stops.includes(rover) ? rover : (stops[0] ?? 0);
  const handStops = handShown
    .map((cell, index) => (handFocusable(cell) ? index : -1))
    .filter((i) => i >= 0);
  const handRovingAt = handStops.includes(handRover) ? handRover : (handStops[0] ?? 0);

  /** ← → Home End within one toolbar's stops. Answers true when the key was taken. */
  const roveKey = (
    event: KeyboardEvent<HTMLDivElement>,
    index: number,
    toolbarStops: readonly number[],
    toolbar: HTMLDivElement | null,
    setAt: (i: number) => void,
  ): boolean => {
    const at = toolbarStops.indexOf(index);
    const go = (to: number): void => {
      event.preventDefault();
      const next = toolbarStops[(to + toolbarStops.length) % toolbarStops.length];
      if (next === undefined) return;
      setAt(next);
      toolbar?.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus();
    };
    switch (event.key) {
      case "ArrowRight":
        go(at + 1);
        return true;
      case "ArrowLeft":
        go(at - 1);
        return true;
      case "Home":
        go(0);
        return true;
      case "End":
        go(toolbarStops.length - 1);
        return true;
      default:
        return false;
    }
  };

  const onToolbarKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const index = Number(target.dataset.cell);
    if (!Number.isFinite(index)) return;
    const cell = cells[index];
    if (roveKey(event, index, stops, rowRef.current, setRover)) return;
    switch (event.key) {
      case "Escape":
        if (open) return; // the open menu's own Esc (above) takes it first
        event.preventDefault();
        target.blur();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (cell !== undefined) press(cell, true);
        return;
      case "ArrowUp":
      case "ArrowDown":
        event.preventDefault();
        if (cell?.kind === "desk" && cell.act === "more" && !open) {
          focusOnOpen.current = true;
          onOpenChange(true);
        }
        // ↓ on a choice's pill grows its list from the keyboard, as on More
        if (cell?.kind === "choice" && cell.disabled !== true && !open) {
          focusOnOpen.current = true;
          onCell(cell);
        }
        return;
    }
  };

  const onHandKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const index = Number(target.dataset.cell);
    if (!Number.isFinite(index)) return;
    const cell = handShown[index];
    if (roveKey(event, index, handStops, handRowRef.current, setHandRover)) return;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        target.blur();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (cell !== undefined) runHand(cell);
        return;
    }
  };

  // IK — THE WORDS' ROWS' KEYS (R9, as the bar has): a toolbar named "Words" — ← → Home End between its cells (a rule is
  // no stop; More a stop: ↑ ↓ or Enter grow it), Esc back to the desk, Enter and Space press; a choice act's row of choices is a toolbar of
  // its own, named for the act, Back its first stop (its Esc, the capture's above, returns to the main row).
  const wordsStops = (wordsRow?.cells ?? [])
    .map((cell, index) => (cell.kind === "rule" ? -1 : index))
    .filter((i) => i >= 0);
  const wordsRovingAt = wordsStops.includes(wordsRover) ? wordsRover : (wordsStops[0] ?? 0);

  /** A words act pressed: a choice act swaps in its choices; a toggle or a plain act runs; one its kind says is disabled
   * does nothing; More grows the bar into the words' menu, or folds it. */
  const pressWords = (cell: WordsCell, fromKeyboard: boolean): void => {
    if ("disabled" in cell && cell.disabled) return;
    if (cell.kind === "more") {
      focusOnOpen.current = fromKeyboard && !open;
      onOpenChange(!open);
      return;
    }
    if (cell.kind === "choice") swapWords(cell, fromKeyboard ? { to: "pick" } : null);
    else if (cell.kind === "toggle" || cell.kind === "act") onWords?.({ act: cell.id });
  };

  /** A choice chosen: it runs at once and the row stays, so a second choice replaces the first (§8). */
  const pick = (cell: ChoiceCell, choice: WordsChoice): void =>
    onWords?.({ act: cell.id, choice: choice.id });

  /** Back to the main row — the focus to the cell that opened it, when the press was the keyboard's. */
  const back = (cell: ChoiceCell, fromKeyboard: boolean): void =>
    swapWords(null, fromKeyboard ? { to: "opener", id: cell.id } : null);

  const onWordsKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const index = Number(target.dataset.cell);
    if (!Number.isFinite(index)) return;
    const cell = wordsRow?.cells[index];
    if (roveKey(event, index, wordsStops, wordsRows.current.get("main") ?? null, setWordsRover))
      return;
    switch (event.key) {
      case "Escape":
        if (open) return; // the open menu's own Esc takes it first
        event.preventDefault();
        target.blur();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (cell !== undefined) pressWords(cell, true);
        return;
      case "ArrowUp":
      case "ArrowDown":
        event.preventDefault();
        if (cell?.kind === "more" && !open) {
          focusOnOpen.current = true;
          onOpenChange(true);
        }
        return;
    }
  };

  const onPickKey = (event: KeyboardEvent<HTMLDivElement>, cell: ChoiceCell): void => {
    const target = event.target as HTMLElement;
    const index = Number(target.dataset.cell);
    if (!Number.isFinite(index)) return;
    const stops = [0, ...cell.choices.map((_, k) => k + 1)];
    if (roveKey(event, index, stops, wordsRows.current.get(cell.id) ?? null, setPickRover)) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const choice = cell.choices[index - 1];
    if (index === 0) back(cell, true);
    else if (choice !== undefined) pick(cell, choice);
  };

  const press = (cell: BarCell, fromKeyboard: boolean): void => {
    if (cell.kind === "rule" || cell.kind === "words") return;
    if (cell.kind === "desk" && cell.act === "more") {
      // over a choice's list More shows its own menu in the list's place; else it grows or folds the bar
      const over = open && choosing !== null;
      focusOnOpen.current = fromKeyboard && (!open || over);
      onOpenChange(over ? true : !open);
      return;
    }
    // an act its kind says is disabled now does nothing (ICE I61)
    if ((cell.kind === "act" || cell.kind === "choice") && cell.disabled === true) return;
    // a choice's pill: the controller grows its list, or folds it when it is the one listed
    if (cell.kind === "choice") {
      focusOnOpen.current = fromKeyboard;
      onCell(cell);
      return;
    }
    if (open) onOpenChange(false);
    onCell(cell);
  };

  /** Copy, a tool used, or Done: never a faint slot, one its kind says is disabled (ICE I49), a rule or the readout. A
   * choice's pill (ICE I62) grows its list under the head — the controller's to name. */
  const runHand = (cell: HandCell): void => {
    if (
      cell.kind === "copy" ||
      cell.kind === "done" ||
      (cell.kind === "tool" && cell.look !== "faint" && !cell.disabled)
    )
      onHand?.(cell);
  };

  const cellNode = (cell: BarCell, index: number): ReactElement => {
    const stop = {
      "data-cell": index,
      tabIndex: index === rovingAt ? 0 : -1,
      onFocus: () => setRover(index),
    };
    switch (cell.kind) {
      case "rule":
        return <span key={cellKey(cell, index)} className="vf-bar-rule" aria-hidden="true" />;
      case "words":
        return (
          <span key={cellKey(cell, index)} className="vf-bar-words" data-bar-words="">
            {cell.label}
          </span>
        );
      case "copy":
        return (
          <button
            key={cellKey(cell, index)}
            type="button"
            className="vf-bar-copy"
            data-act="copy"
            title={cell.tip}
            onClick={() => press(cell, false)}
            {...stop}
          >
            <PaperCard />
            <span>{cell.label}</span>
          </button>
        );
      case "act":
        return (
          <button
            key={cellKey(cell, index)}
            type="button"
            className={
              cell.swatch !== undefined
                ? "vf-bar-cell vf-bar-swatch"
                : cell.glyph === undefined
                  ? "vf-bar-cell vf-bar-cell--text"
                  : "vf-bar-cell"
            }
            data-act={`act:${cell.id}`}
            aria-label={cell.label}
            title={cell.label}
            {...(cell.disabled === true ? { "aria-disabled": true, "data-disabled": "" } : {})}
            {...(cell.swatch === undefined
              ? {}
              : { style: { "--vf-bar-swatch": cell.swatch } as CSSProperties })}
            onClick={() => press(cell, false)}
            {...stop}
          >
            {cell.swatch !== undefined ? (
              <span className="vf-bar-dot-ink" aria-hidden="true" />
            ) : cell.glyph === undefined ? (
              cell.label
            ) : (
              <KindGlyph glyph={cell.glyph} label={cell.label} />
            )}
          </button>
        );
      case "choice": {
        const on = open && choosing?.of === "act" && choosing.id === cell.id;
        return (
          <button
            key={cellKey(cell, index)}
            type="button"
            className="vf-bar-cell vf-bar-choice"
            data-act={`act:${cell.id}`}
            data-choice=""
            {...(cell.swatches === true ? { "data-swatch": "" } : {})}
            {...(cell.mixed ? { "data-mixed": "" } : {})}
            aria-label={cell.tip}
            title={cell.tip}
            aria-haspopup="menu"
            aria-expanded={on}
            {...(cell.disabled === true ? { "aria-disabled": true, "data-disabled": "" } : {})}
            {...(cell.swatch === undefined
              ? {}
              : { style: { "--vf-bar-swatch": cell.swatch } as CSSProperties })}
            onClick={() => press(cell, false)}
            {...stop}
          >
            {choiceFace(cell.swatches === true, cell.glyph, cell.label, cell.current)}
          </button>
        );
      }
      case "desk": {
        const more = cell.act === "more";
        return (
          <button
            key={cellKey(cell, index)}
            ref={more && !wordsShown ? moreRef : undefined}
            type="button"
            className="vf-bar-cell"
            data-act={cell.act}
            aria-label={cell.label}
            title={cell.tip}
            {...(more
              ? { "aria-haspopup": "menu" as const, "aria-expanded": open && choosing === null }
              : {})}
            onClick={() => press(cell, false)}
            {...stop}
          >
            <FieldGlyph name={cell.glyph} size={16} />
          </button>
        );
      }
    }
  };

  // THE TOOLS IN HAND's cells (§8 "Tools in hand"): Make a card · rule · the kind's tools · the readout · rule · Done
  const handNode = (cell: HandCell, index: number): ReactElement => {
    const stop = {
      "data-cell": index,
      tabIndex: index === handRovingAt ? 0 : -1,
      onFocus: () => setHandRover(index),
    };
    switch (cell.kind) {
      case "rule":
        return <span key={handKey(cell, index)} className="vf-bar-rule" aria-hidden="true" />;
      case "copy":
        return (
          <button
            key={handKey(cell, index)}
            type="button"
            className="vf-bar-copy"
            data-act="copy"
            title={cell.tip}
            onClick={() => runHand(cell)}
            {...stop}
          >
            <PaperCard />
            <span>{cell.label}</span>
          </button>
        );
      case "readout":
        return (
          <span key={handKey(cell, index)} className="vf-bar-readout" data-readout="">
            {cell.text}
          </span>
        );
      case "done":
        return (
          <button
            key={handKey(cell, index)}
            type="button"
            className="vf-bar-done"
            data-act="done"
            title={cell.tip}
            onClick={() => runHand(cell)}
            {...stop}
          >
            {cell.label}
          </button>
        );
      case "tool": {
        const mode = cell.look === "dot" || cell.look === "mode";
        const choice = cell.look === "choice";
        const chosenNow = choice && open && choosing?.of === "tool" && choosing.id === cell.id;
        const className = choice
          ? "vf-bar-cell vf-bar-choice"
          : cell.look === "dot"
            ? "vf-bar-cell vf-bar-dot"
            : cell.glyph === undefined
              ? "vf-bar-cell vf-bar-cell--text"
              : "vf-bar-cell";
        return (
          <button
            key={handKey(cell, index)}
            type="button"
            className={className}
            data-tool={cell.id}
            data-look={cell.look}
            data-run={cell.run}
            {...(cell.gap ? { "data-gap": "" } : {})}
            {...(cell.on ? { "data-on": "" } : {})}
            {...(cell.swatches === true ? { "data-swatch": "" } : {})}
            {...(cell.mixed === true ? { "data-mixed": "" } : {})}
            aria-label={choice ? cell.tip : cell.label}
            title={cell.tip}
            {...(mode ? { "aria-pressed": cell.on } : {})}
            {...(choice ? { "aria-haspopup": "menu" as const, "aria-expanded": chosenNow } : {})}
            {...(cell.look === "faint" || cell.disabled ? { "aria-disabled": true } : {})}
            {...(cell.disabled ? { "data-disabled": "" } : {})}
            {...(cell.swatch === undefined
              ? {}
              : { style: { "--vf-bar-swatch": cell.swatch } as CSSProperties })}
            onClick={() => runHand(cell)}
            {...stop}
          >
            {choice ? (
              choiceFace(cell.swatches === true, cell.glyph, cell.label, cell.current ?? "")
            ) : cell.look === "dot" ? (
              <span className="vf-bar-dot-ink" aria-hidden="true" />
            ) : cell.glyph === undefined ? (
              cell.label
            ) : (
              <KindGlyph glyph={cell.glyph} label={cell.label} />
            )}
          </button>
        );
      }
    }
  };

  // IK — THE WORDS' CELLS (§8 "The words bar"): a swatch in the desk palette's own ink (the dot of a pen, the stripe of a
  // highlighter; hollow when none is shared), a kind's glyph by §13's table, or a label
  const faceNode = (face: WordsFace, label: string): ReactElement | string => {
    if (face.by === "glyph") return <KindGlyph glyph={face.glyph} label={label} />;
    if (face.by === "label") return label;
    const { shape, ink } = face.swatch;
    return (
      <span
        className="vf-bar-swatch"
        data-shape={shape}
        aria-hidden="true"
        {...(ink === undefined
          ? { "data-hollow": "" }
          : { style: { "--vf-bar-swatch": ink } as CSSProperties })}
      />
    );
  };

  // the words' row: Pen ▾ · Highlight ▾ · rule · Strike · Underline · rule · Clear · More — as the kind declares them
  const wordsNode = (cell: WordsCell, index: number): ReactElement => {
    const stop = {
      "data-cell": index,
      tabIndex: index === wordsRovingAt ? 0 : -1,
      onFocus: () => setWordsRover(index),
    };
    switch (cell.kind) {
      case "rule":
        return <span key={`rule-${index}`} className="vf-bar-rule" aria-hidden="true" />;
      case "choice":
        return (
          <button
            key={`word-${cell.id}`}
            type="button"
            className={
              cell.face.by === "label"
                ? "vf-bar-cell vf-bar-choice vf-bar-cell--text"
                : "vf-bar-cell vf-bar-choice"
            }
            data-act={`word:${cell.id}`}
            data-face={cell.face.by}
            aria-label={cell.label}
            title={cell.tip}
            {...(cell.disabled ? { "aria-disabled": true, "data-disabled": "" } : {})}
            onClick={() => pressWords(cell, false)}
            {...stop}
          >
            {faceNode(cell.face, cell.label)}
            <FieldGlyph name="chevron" size={8} turn={90} />
          </button>
        );
      case "toggle":
      case "act":
        return (
          <button
            key={`word-${cell.id}`}
            type="button"
            className={cell.glyph === undefined ? "vf-bar-cell vf-bar-cell--text" : "vf-bar-cell"}
            data-act={`word:${cell.id}`}
            aria-label={cell.label}
            title={cell.tip}
            {...(cell.kind === "toggle"
              ? {
                  "data-toggle": "",
                  "aria-pressed": cell.on,
                  ...(cell.on ? { "data-on": "" } : {}),
                }
              : {})}
            {...(cell.disabled ? { "aria-disabled": true, "data-disabled": "" } : {})}
            onClick={() => pressWords(cell, false)}
            {...stop}
          >
            {cell.glyph === undefined ? (
              cell.label
            ) : (
              <KindGlyph glyph={cell.glyph} label={cell.label} />
            )}
          </button>
        );
      case "more":
        return (
          <button
            key="more"
            ref={moreRef}
            type="button"
            className="vf-bar-cell"
            data-act="more"
            aria-label={cell.label}
            title={cell.tip}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => pressWords(cell, false)}
            {...stop}
          >
            <FieldGlyph name="ellipsis" size={16} />
          </button>
        );
    }
  };

  // a choice act's row: Back · each choice a 32 cell holding its swatch, the words' choice shown on — Back wears §13's
  // chevron turned 180, its one drawing for going back
  const choicesNode = (cell: ChoiceCell): ReactElement => {
    const shown = wordsAt === cell.id;
    const stop = (index: number) => ({
      "data-cell": index,
      tabIndex: index === (shown ? pickRover : 0) ? 0 : -1,
      onFocus: () => setPickRover(index),
    });
    return (
      <div
        key={`choices-${cell.id}`}
        ref={(el) => {
          if (el === null) wordsRows.current.delete(cell.id);
          else wordsRows.current.set(cell.id, el);
        }}
        className="vf-bar-row"
        data-face-row="words"
        data-words-row={cell.id}
        {...(shown ? { "data-shown": "" } : {})}
        role="toolbar"
        aria-label={cell.label}
        aria-orientation="horizontal"
        {...(shown && face === "selection" ? {} : { "aria-hidden": true })}
        inert={!shown || face !== "selection"}
        onKeyDown={(event) => onPickKey(event, cell)}
        style={{ height: BAR.height }}
      >
        <button
          type="button"
          className="vf-bar-cell"
          data-act="back"
          aria-label="Back"
          title="Back"
          onClick={() => back(cell, false)}
          {...stop(0)}
        >
          <FieldGlyph name="chevron" size={16} turn={180} />
        </button>
        {cell.choices.map((choice, k) => (
          <button
            key={choice.id}
            type="button"
            className={
              choice.face.by === "label"
                ? "vf-bar-cell vf-bar-pick vf-bar-cell--text"
                : "vf-bar-cell vf-bar-pick"
            }
            data-choice={choice.id}
            data-face={choice.face.by}
            aria-label={choice.label}
            title={choice.label}
            aria-pressed={choice.on}
            {...(choice.on ? { "data-on": "" } : {})}
            onClick={() => pick(cell, choice)}
            {...stop(k + 1)}
          >
            {faceNode(choice.face, choice.label)}
          </button>
        ))}
      </div>
    );
  };

  // the list, nearest first in the DOM (it is read that way); grown up it stands bottom-up (column-reverse)
  let order = 0;
  const listNodes: ReactElement[] = [];
  listGroups.forEach((group, g) => {
    if (group.length === 0) return;
    if (listNodes.length > 0) listNodes.push(<hr key={`sep-${g}`} className="vf-bar-sep" />);
    for (const row of group) {
      const delay = rowDelay(motion, order);
      order += 1;
      const choice = row.checked !== undefined;
      const item = (
        <button
          key={row.id}
          type="button"
          role={choice ? "menuitemradio" : "menuitem"}
          className="vf-bar-item"
          data-row={row.id}
          {...(choice ? { "aria-checked": row.checked === true } : {})}
          {...(row.fields === undefined ? {} : { "aria-expanded": expanded === row.id })}
          {...(row.id === hot ? { "data-hot": "" } : {})}
          {...(row.danger === true ? { "data-danger": "" } : {})}
          {...(row.waits === undefined
            ? {}
            : {
                "aria-disabled": true,
                title: row.waits === "" ? row.label : `${row.label} — ${row.waits}`,
              })}
          tabIndex={-1}
          style={{ "--vf-bar-delay": `${delay}ms` } as CSSProperties}
          onPointerEnter={() => {
            if (row.waits === undefined) setHot(row.id);
          }}
          onClick={() => take(row)}
        >
          {choice ? (
            <span className="vf-bar-check" aria-hidden="true">
              {row.checked === true ? <FieldGlyph name="check" size={14} /> : null}
            </span>
          ) : null}
          {row.swatch === undefined ? null : (
            <span
              className="vf-bar-swatch-dot"
              aria-hidden="true"
              style={{ "--vf-bar-swatch": row.swatch } as CSSProperties}
            />
          )}
          <span className="vf-bar-item-label">{row.label}</span>
          {row.key === undefined ? null : <span className="vf-bar-key">{row.key}</span>}
        </button>
      );
      // a choice that asks for values: its row and its fields as one piece of the list, the fields UNDER the row
      // whichever way the list reads (grown up, the list's column is reversed; this piece's is not)
      listNodes.push(
        row.fields === undefined ? (
          item
        ) : (
          <div key={row.id} className="vf-bar-choice-item">
            {item}
            {expanded === row.id ? (
              <ChoiceFields
                key={`${row.id}-fields`}
                fields={row.fields}
                handleRef={fieldsRef}
                autoFocus={seeded.current !== row.id}
                onUse={(values) => use(row, values)}
              />
            ) : null}
          </div>
        ),
      );
    }
  });
  listNodes.push(
    <div
      key="eyebrow"
      className="vf-bar-eye"
      role="presentation"
      style={{ "--vf-bar-delay": `${rowDelay(motion, order)}ms` } as CSSProperties}
    >
      {listEyebrow}
    </div>,
  );

  const rootStyle = {
    "--vf-bar-grow-ms": `${motion.growMs}ms`,
    "--vf-bar-fold-ms": `${motion.foldDelayMs}ms`,
    "--vf-bar-firm-ms": `${motion.firmMs}ms`,
    "--vf-bar-row-ms": `${motion.rowMs}ms`,
    "--vf-bar-out-ms": `${motion.contentOutMs}ms`,
    "--vf-bar-swap-ms": `${motion.swapMs}ms`,
    opacity: visible ? 1 : 0,
    visibility: visible ? "visible" : "hidden",
    transition: transitionOf(
      swapPhase,
      traveling,
      swapping || (wordsSwapping && !reduced),
      shown,
      away,
      clearing,
    ),
  } as CSSProperties;

  const selectionShown = face === "selection";
  /** The objects' row is the one shown: over a selection, and no words given (IK). */
  const objectsShown = selectionShown && !wordsShown;
  return (
    <div
      ref={rootRef}
      className="vf-bar"
      data-selection-bar=""
      data-shown={visible ? "true" : "false"}
      data-motion={motion.grows ? "grow" : "fade"}
      data-role={role}
      data-face={face}
      {...(traveling ? { "data-traveling": "" } : {})}
      {...(open ? { "data-open": "" } : {})}
      {...(wordsShown ? { "data-words": "" } : {})}
      style={rootStyle}
      inert={!visible}
    >
      <div className="vf-bar-glass" aria-hidden="true" />
      <div className="vf-bar-panel" aria-hidden="true">
        <span className="vf-bar-hairline" />
      </div>
      <div
        ref={listRef}
        className="vf-bar-list"
        role="menu"
        aria-label={`${listEyebrow.charAt(0)}${listEyebrow.slice(1).toLowerCase()}`}
        {...(choosing === null ? {} : { "data-choices": choosing.id })}
        inert={!open}
      >
        {listNodes}
      </div>
      <div
        ref={rowRef}
        className="vf-bar-row"
        data-face-row="selection"
        role="toolbar"
        aria-label="Selection"
        aria-orientation="horizontal"
        {...(objectsShown ? {} : { "aria-hidden": true })}
        inert={!objectsShown}
        onKeyDown={onToolbarKey}
        style={{ height: BAR.height }}
      >
        {cells.map(cellNode)}
      </div>
      {wordsRow === null ? null : (
        <div
          ref={(el) => {
            if (el === null) wordsRows.current.delete("main");
            else wordsRows.current.set("main", el);
          }}
          className="vf-bar-row"
          data-face-row="words"
          data-words-row="main"
          {...(wordsAt === "main" ? { "data-shown": "" } : {})}
          role="toolbar"
          aria-label={WORDS_TOOLBAR}
          aria-orientation="horizontal"
          {...(wordsAt === "main" && selectionShown ? {} : { "aria-hidden": true })}
          inert={wordsAt !== "main" || !selectionShown}
          onKeyDown={onWordsKey}
          style={{ height: BAR.height }}
        >
          {wordsRow.cells.map(wordsNode)}
        </div>
      )}
      {wordsRow === null ? null : wordsRow.cells.filter(isChoice).map(choicesNode)}
      {handShown.length === 0 ? null : (
        <div
          ref={handRowRef}
          className="vf-bar-row vf-bar-row--hand"
          data-face-row="hand"
          role="toolbar"
          aria-label="Tools in hand"
          aria-orientation="horizontal"
          {...(selectionShown ? { "aria-hidden": true } : {})}
          inert={selectionShown}
          onKeyDown={onHandKey}
          style={{ height: BAR.height }}
        >
          {handShown.map(handNode)}
        </div>
      )}
    </div>
  );
}
