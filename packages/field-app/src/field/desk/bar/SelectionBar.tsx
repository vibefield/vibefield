import { Camera, type Entity, PrefabId, selectedEntities } from "@vibecook/ice";
import type { MenuSlot, SelectionAnchor } from "@vibecook/ice/desk";
import { isEditableTarget, keyboardClaimOf } from "@vibecook/ice/dom";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { type FrameSurface, foldSurface } from "../../../frame/frame-surface";
import { useAppTheme } from "../../../theme";
import { isCopyChord, listenForProductChord } from "../../product-chords";
import { atWorkBarClear, atWorkInkScale } from "../at-work/at-work-model";
import { atWorkStore } from "../at-work/at-work-store";
import { copySelection } from "../copy/copy-to-hand";
import { inHand } from "../desk-anchor";
import { currentDesk, type MountedDesk, plainWords, subscribeDesk } from "../desk-door";
import { deskLook } from "../desk-layer";
import type { ObjectWords } from "../desk-object-words";
import { type BarActId, COMMENT_PAD_TYPE, runBarAct, runWordsAct } from "./bar-acts";
import { offScreen } from "./bar-geometry";
import { type HandCell, type HeldSlot, handCells, slotsKey } from "./bar-hand";
import {
  type BarCell,
  barCells,
  choiceEyebrow,
  choiceGroups,
  choiceOfRow,
  type DeskKeys,
  type MenuRow,
  menuEyebrow,
  menuGroups,
  type SelectionFacts,
} from "./bar-model";
import { TRAVEL_MS, useReducedMotion } from "./bar-motion";
import { barStats } from "./bar-stats";
import { sayMissingSwatches, wordsCells, wordsKey } from "./bar-words";
import { downloadable, downloadPrint } from "./print-download";
import {
  type PlaceAnchor,
  type SelectionBarHandle,
  SelectionBarView,
  type WordsPress,
  type WordsRow,
} from "./SelectionBarView";

// THE SELECTION BAR'S CONTROLLER (DK-11; DESIGN.md §8 "The doors", "The selection bar", "The bar grown — More, and
// right-click"; R5, R7, R8, R26). ICE gives the chrome DATA, never pixels: `handle.selection` offers `anchor()` and
// `subscribe()` — the brackets' `box`, `count`, `locked`, `gesturing`, `editing`, the `view`, the `rulers`, the hand
// (`held`) and the kinds' acts (`menu`), no ids, no types, no names. The host reads the rest itself, here, in one
// place: the selection's entities (`selectedEntities`), each one's type (`PrefabId`), its definition
// (`engine.catalog.widget(type)` — `openable`, its container) and its words (the mount's, desk-object-words.ts). The
// acts run through the engine's ops (bar-acts.ts).
//
// Each publish the bar either PLACES itself (an imperative write — the common case: the selection moved) or, when
// what it says changed (the selection, its tape, its acts, its words, a gesture, the hand, the screen's edge), it
// re-renders and then places once. Never a render per frame (`barStats`: placements ≤ publishes). A CHANGE OF
// SELECTION that the desk publishes re-renders IN the publish (track OM, 2026-11-26): ICE publishes from its frame, right
// after drawing it, and an update made there renders in a task after that frame's paint, so the bar (its grown
// element with it) would stand a frame over the next object's brackets.
//
// The grown menu is one of the frame's open surfaces (`surface === "selection"`, §10): opening it folds the rest,
// any of them folds it. It closes on Esc, a press elsewhere (the view's), a gesture, a change of selection — and when
// the bar goes (R5). A change of selection closes it AT ONCE (track OM, 2026-11-26): in the read that says the new
// selection, and the view cuts the fold a press began, so nothing of the list is carried to the next object. A press
// the desk's pick lands on another object is that change already: the view cuts it as it lands (`pressSelects`).
// RIGHT-CLICK (R26, I27 + I28): a `contextmenu` listener over the desk selects the object under
// the pointer FIRST by the desk's pick (`handle.pick`), then grows this same bar into this same menu (MC-D6).
//
// IN HAND (DK-12; §8 "Tools in hand"; R13): when an object is picked up (the anchor's `held`, not flying home) the same
// bar TRAVELS into the hand and becomes the tools in hand — the kind's slots, the mode in hand, the kind's word — placed
// under the head whatever the selection's box; each tool used through `ops.useHeldTool(id)`, Done through
// `ops.putDown()`. While the object flies home (`landing`) the bar steps aside, and comes back over it 200 ms after it
// lands, as the bar over the selection again.
//
// A CHOICE (track OM, 2026-11-25; ICE I62; §8 "An act that is a choice", "A choice's list"): a kind's act or a held
// action that offers choices is a pill; pressed, the SAME grown element shows its choices in More's place (`choosing`),
// over a selection or under the head in hand — the frame's same open surface. A choice is taken through the engine's
// op with it — `ops.runMenuAction(id, choice)` or `ops.useHeldTool(id, choice)` — its fields' values with it for one
// that asks for values (the view holds them to their fields first; core holds them again).
//
// MAKE A CARD (HN-D3, where Send to… stood; §8 "Make a card"): four doors — the bar's pill, the grown menu's row, the
// pill in hand, and ⌘C over the desk — run ONE act (copy/copy-to-hand.ts): the selection, or the object in hand, dealt
// into the hand as one card. Nothing is drafted and nothing waits on the line, so the bar never steps aside for it;
// the tools in hand stay under the head (plan addendum (50)).
//
// DOWNLOAD… (item 578; §8 "The bar grown"): the grown menu's row for one print whose picture the desk holds, the
// host's own act (print-download.ts). Whether it is offered is read with the selection AND on every publish after,
// because a print's picture can arrive after the print was selected, and the row must then appear.
//
// OVER AN OBJECT AT WORK (item 550, 2026-11-18; §8 "The selection bar", Place): while any selected object is at work
// the foot clears its marks (`atWorkClearOf`). The clearance is read at each publish and whenever the at-work store
// moves it, so an agent arriving on the selection or leaving it re-places the bar while the desk sleeps; the view
// travels it on the stroke's own times when it turns on or off over the same selection.
// THE WORDS BAR (IK, 2026-11-25; §8 "The words bar"; ICE I60): while a sheet is written and words on it are selected, the
// anchor carries `words` — their box on screen, their object, their range and the object's WORDS acts — and the same bar
// stands over them (by the bar's own place: its foot 10 above, flipped below at 94, 16 from the sides) with the words' row
// in the objects' place (bar-words.ts). While a press the editor claimed is down ICE says no words, so a sheet being written
// keeps the bar away, and it comes 200 ms after the release, as after a gesture; a gesture still sends it away. Each act
// runs through `ops.runMenuAction(id, { choice?, range })`, the range read at the press from the publish's own copy — never
// a render's. A kind whose words declare no acts brings no words' row: the bar stays away while it is written, as before.

export interface SelectionBarProps {
  /** The frame's open surface and its one owner's setter (FR-4). */
  readonly surface: FrameSurface | null;
  readonly onSurfaceChange: (next: FrameSurface | null) => void;
  /** The field is covered by a view, or receded under a sheet: the bar is not shown over it. */
  readonly hidden: boolean;
  /** The desk's keys as this platform spells them. */
  readonly keys: DeskKeys;
}

/** The mounted desk's selection door — absent on a handle without one (a test's double). */
const selectionDoorOf = (desk: MountedDesk | null) =>
  (desk?.handle as Partial<MountedDesk["handle"]> | undefined)?.selection;

export function SelectionBar(props: SelectionBarProps): ReactElement | null {
  const desk = useSyncExternalStore(subscribeDesk, currentDesk, currentDesk);
  const selection = selectionDoorOf(desk);
  if (desk === null || selection === undefined) return null;
  // one bar per mount: a remount's handle is a new door, and what the old bar heard is not this one's
  return <SelectionBarOn key={`${desk.generation}.${desk.mount}`} desk={desk} {...props} />;
}

/** What the bar has read of the selection: the anchor's discrete facts, and the host's read built on them. */
interface BarFacts {
  /** The selection's entities, as one key. */
  readonly key: string;
  readonly count: number;
  readonly locked: boolean;
  readonly menuKey: string;
  readonly faults: number;
  /** The selection is drawn and some of it is on screen (R7). */
  readonly onScreen: boolean;
  /** An object is in hand, not flying home: the bar is the tools in hand (DK-12). */
  readonly inHand: boolean;
  /** A gesture is on, or a note is being written with no words selected on it (R8; IK) — or the object in hand flies
   * home. Never while it is in hand. */
  readonly stepAside: boolean;
  readonly selection: SelectionFacts;
  /** What the bar says in hand (the anchor's `held`), or null with nothing in hand. */
  readonly hand: HandFacts | null;
  /** IK — what the bar says of the words selected on a sheet being written: kept while the bar steps aside or fades out
   * (it says what it said, R8); null — the objects' row. */
  readonly words: WordsFacts | null;
  /** IK — the anchor carries words with acts to offer NOW (not merely kept). */
  readonly wordsLive: boolean;
  /** IK — those words are on screen. */
  readonly wordsOnScreen: boolean;
}

/** IK — the words as the bar says them: the object's words acts (the anchor's `words.menu`), and their run. */
interface WordsFacts {
  /** The acts as one key (what the bar says of them). */
  readonly key: string;
  readonly menu: readonly MenuSlot[];
  /** Counts the runs of words: a new range after the words went (a press, a caret) is a new run, and closes the choices. */
  readonly run: number;
}

/** IK — the anchor's words when they bring the words' row: some acts to offer, and nothing in hand. */
const liveWords = (anchor: SelectionAnchor) => {
  const words = anchor.words;
  return words !== undefined && words.menu.length > 0 && !inHand(anchor) ? words : undefined;
};

/** IK — the words as of this anchor: the live ones (`prev`'s own when nothing the bar says moved), else the last ones while
 * the bar is not to show the objects' row (`keep`), else none. */
function readWords(
  live: ReturnType<typeof liveWords>,
  prev: BarFacts | null,
  keep: boolean,
): WordsFacts | null {
  const was = prev?.words ?? null;
  if (live === undefined) return keep ? was : null;
  const key = wordsKey(live.menu);
  const run = prev?.wordsLive === true && was !== null ? was.run : (was?.run ?? 0) + 1;
  if (was !== null && was.key === key && was.run === run) return was;
  return { key, menu: live.menu, run };
}

/** The hand as the bar says it: the kind's slots (and their key), the mode in hand, the kind's word, the travel. */
interface HandFacts {
  readonly key: string;
  readonly tools: readonly HeldSlot[];
  readonly active: string;
  readonly readout: string | undefined;
  readonly travelMs: number | undefined;
}

/** The hand's facts as of this anchor — `prev` itself when nothing the bar says of it changed. */
function readHand(anchor: SelectionAnchor, prev: HandFacts | null): HandFacts | null {
  const held = anchor.held;
  if (!inHand(anchor) || held === undefined) return null;
  const key = slotsKey(held.tools);
  if (
    prev !== null &&
    prev.key === key &&
    prev.active === held.active &&
    prev.readout === held.readout &&
    prev.travelMs === held.travelMs
  )
    return prev;
  return {
    key,
    tools: held.tools,
    active: held.active,
    readout: held.readout,
    travelMs: held.travelMs,
  };
}

const keyOf = (entities: readonly Entity[]): string =>
  entities
    .map((e) => e as number)
    .sort((a, b) => a - b)
    .join(",");

const menuKeyOf = (menu: readonly MenuSlot[] | undefined): string =>
  (menu ?? [])
    .map(
      (act) =>
        `${act.id}:${act.label}:${JSON.stringify(act.glyph ?? null)}:${act.enabled === false ? "off" : ""}:${act.swatch ?? ""}:${JSON.stringify(act.choices ?? null)}`,
    )
    .join("|");

/** Whose choices the grown bar lists (ICE I62): a kind's act over a selection, or a tool in hand. */
export interface Choosing {
  readonly of: "act" | "tool";
  readonly id: string;
}

/** The host's own read of the selection (§8 "The doors"): its types' words, whether the one selected opens, and
 * whether a comment pad can be laid here. */
function readSelection(
  anchor: SelectionAnchor,
  desk: MountedDesk,
  entities: readonly Entity[],
): SelectionFacts {
  const { engine } = desk;
  const words = desk.words ?? plainWords;
  const types: string[] = [];
  for (const e of entities) {
    const type = engine.world.get(e, PrefabId)?.id;
    if (typeof type === "string" && !types.includes(type)) types.push(type);
  }
  const typeWords: ObjectWords[] = types.map((type) => words(type));
  const one = types.length === 1 && entities.length === 1 ? types[0] : undefined;
  const widget = one === undefined ? undefined : engine.catalog.widget(one);
  const pad = engine.catalog.widget(COMMENT_PAD_TYPE);
  return {
    count: anchor.count,
    locked: anchor.locked,
    menu: anchor.menu ?? [],
    words: typeWords,
    openable:
      widget?.openable === true && widget.container === undefined && typeWords[0]?.state === null,
    downloadable: downloadable(desk, entities),
    commentable: pad !== undefined && words(COMMENT_PAD_TYPE).state === null,
  };
}

/** The facts as of this anchor — `prev` itself when nothing the bar SAYS has changed (the anchor merely moved). */
function readFacts(anchor: SelectionAnchor, desk: MountedDesk, prev: BarFacts | null): BarFacts {
  const entities = selectedEntities(desk.engine.world);
  const key = keyOf(entities);
  const menuKey = menuKeyOf(anchor.menu);
  const faults = (desk.handle.status().faults ?? []).length;
  const onScreen = anchor.box !== null && !offScreen(anchor.box, anchor.view);
  const held = inHand(anchor);
  const live = liveWords(anchor);
  const wordsLive = live !== undefined;
  const wordsOnScreen = live !== undefined && !offScreen(live.box, anchor.view);
  // in hand the tools stay through a stroke or a line being written; only the flight home steps them aside — and a sheet
  // being written sends the bar away only while no words on it are selected (IK: then it comes to them)
  const stepAside =
    !held && (anchor.gesturing || (anchor.editing && !wordsLive) || anchor.held?.landing === true);
  const hand = readHand(anchor, prev?.hand ?? null);
  // the words are kept while the bar is not to show the objects' row — it steps aside, or it goes — so it says what it said
  const words = readWords(live, prev, stepAside || !(anchor.count > 0 && onScreen));
  // a print's picture may arrive after the print was selected: the one fact of the selection read again each publish
  // (one lookup in memory). Deselected, the bar fades out saying what it said, so nothing is asked then.
  const savable =
    prev === null ||
    anchor.count === 0 ||
    prev.selection.downloadable === downloadable(desk, entities);
  if (
    prev !== null &&
    prev.key === key &&
    prev.count === anchor.count &&
    prev.locked === anchor.locked &&
    prev.menuKey === menuKey &&
    prev.faults === faults &&
    prev.onScreen === onScreen &&
    prev.inHand === held &&
    prev.stepAside === stepAside &&
    prev.hand === hand &&
    prev.words === words &&
    prev.wordsLive === wordsLive &&
    prev.wordsOnScreen === wordsOnScreen &&
    savable
  ) {
    return prev;
  }
  const same =
    prev !== null &&
    prev.key === key &&
    prev.count === anchor.count &&
    prev.locked === anchor.locked &&
    prev.menuKey === menuKey &&
    prev.faults === faults &&
    savable;
  return {
    key,
    count: anchor.count,
    locked: anchor.locked,
    menuKey,
    faults,
    onScreen,
    inHand: held,
    stepAside,
    hand,
    words,
    wordsLive,
    wordsOnScreen,
    // deselected, the bar fades out still saying what it said (R8): its content stays the last selection's
    selection:
      prev !== null && (same || anchor.count === 0)
        ? prev.selection
        : readSelection(anchor, desk, entities),
  };
}

/** Item 550 (2026-11-18): how far the bar's foot stands off the selection's edge for the marks of an object at work —
 * `atWorkBarClear` at the desk's ink scale while any selected object is at work, else 0, the place it has always had
 * (§8 "The selection bar", Place). The count of agents is never read: three strokes' reach clears any count. A key
 * whose agents have all released is not at work: its marks are leaving. */
export function atWorkClearOf(desk: MountedDesk): number {
  const docId = desk.docId;
  const keys = desk.engine.docs.current()?.store;
  if (docId === undefined || keys === undefined) return 0;
  const { objects } = atWorkStore.current(docId);
  if (objects.size === 0) return 0;
  const { world } = desk.engine;
  const atWork = selectedEntities(world).some((e) => {
    const key = keys.keyOf(e) as string | undefined;
    const object = key === undefined ? undefined : objects.get(key);
    return object?.agents.some((row) => row.state !== "released") === true;
  });
  return atWork ? atWorkBarClear(atWorkInkScale(world.getResource(Camera)?.zoom ?? 1)) : 0;
}

/** The desk's own element, which the right-click is heard on (the layer's canvas lies in it). */
const containerOf = (desk: MountedDesk): HTMLElement | null => {
  const canvas = (desk.handle as Partial<MountedDesk["handle"]>).canvas;
  return canvas instanceof HTMLElement
    ? ((canvas.closest("[data-ice-canvas]") as HTMLElement | null) ?? canvas.parentElement)
    : null;
};

function SelectionBarOn({
  desk,
  surface,
  onSurfaceChange,
  hidden,
  keys,
}: SelectionBarProps & { readonly desk: MountedDesk }): ReactElement {
  const { engine, handle } = desk;
  const source = handle.selection;
  const reduced = useReducedMotion();
  const barRef = useRef<SelectionBarHandle>(null);
  const [facts, setFacts] = useState<BarFacts>(() => readFacts(source.anchor(), desk, null));
  const factsRef = useRef(facts);
  const open = surface === "selection";
  const surfaceRef = useRef({ surface, onSurfaceChange });
  surfaceRef.current = { surface, onSurfaceChange };
  /** A right-click asked to grow the menu for this selection once the desk has drawn it (R26). */
  const growFor = useRef<string | null>(null);
  /** Whose choices the grown bar lists, or null for More's menu (ICE I62). */
  const [choosing, setChoosing] = useState<Choosing | null>(null);
  const choosingRef = useRef(choosing);
  choosingRef.current = choosing;
  /** IK — the words a words act runs on, as the last publish said them (never a render's copy: E7's M13). */
  const rangeRef = useRef<{
    readonly entity: Entity;
    readonly from: number;
    readonly to: number;
  } | null>(null);

  const fold = useCallback((): void => {
    const { surface: now, onSurfaceChange: change } = surfaceRef.current;
    change(foldSurface(now, "selection"));
  }, []);

  // THE READS — each publish, and the anchor as the bar mounts: placed imperatively at once; or, when what the bar
  // SAYS changed (its width with it), remembered and placed once the bar has re-rendered. One read, one placement
  // at most — none while it is away or has nowhere to stand (a gesture's end places it where the object came to rest).
  useLayoutEffect(() => {
    /** the clearance the bar was last placed with (item 550): a store change re-places it only when it moved */
    let clear = 0;
    /** `fromDesk`: the desk's own publish, from its frame — never a render or an effect of ours (the mount's read, a
     * store's), where React cannot render at once. */
    const read = (fromDesk: boolean): void => {
      barStats.publishes += 1;
      const anchor = source.anchor();
      const prev = factsRef.current;
      const next = readFacts(anchor, desk, prev);
      clear = atWorkClearOf(desk);
      // IK: over words the bar stands over THEIR box, by its own place's rules; the range is kept for the acts' runs
      const live = liveWords(anchor);
      rangeRef.current =
        live === undefined ? null : { entity: live.entity, from: live.from, to: live.to };
      const at: PlaceAnchor =
        live === undefined
          ? { ...anchor, clear, selection: next.key }
          : { box: live.box, count: 1, view: anchor.view };
      if (next !== prev) {
        factsRef.current = next;
        // what it SAYS changed — the selection's cells, the hand's, or the words' — so it is placed once it has re-rendered:
        // this anchor is remembered first, since that render may be this very read's
        const says =
          next.selection !== prev.selection || next.hand !== prev.hand || next.words !== prev.words;
        if (says) barRef.current?.place(at, false);
        const commit = (): void => {
          setFacts(next);
          // R5: a change of selection closes the grown bar in the read that says it, so it is never drawn grown over
          // the next selection (track OM, 2026-11-26), unless a right-click grows it for that selection (R26)
          if (
            next.key !== prev.key &&
            growFor.current !== next.key &&
            surfaceRef.current.surface === "selection"
          )
            fold();
        };
        // a change of selection the desk published is drawn with the frame that publishes it (track OM, 2026-11-26)
        if (fromDesk && next.key !== prev.key) flushSync(commit);
        else commit();
        if (says) return;
      }
      // in hand it stands under the head whatever the selection's box; over words or a selection, only where it can stand
      const placing =
        next.inHand ||
        (!next.stepAside &&
          (next.wordsLive ? next.wordsOnScreen : next.count > 0 && next.onScreen));
      barRef.current?.place(at, placing);
    };
    read(false);
    const offAnchor = source.subscribe(() => read(true));
    // an agent arriving on the selection or leaving it moves the foot, even while the desk sleeps (item 550)
    const offAtWork = atWorkStore.subscribe(() => {
      if (atWorkClearOf(desk) !== clear) read(false);
    });
    return () => {
      offAnchor();
      offAtWork();
    };
  }, [source, desk, fold]);

  // over words, while they are on screen (IK); over a selection on screen; or in hand
  const shown =
    !hidden &&
    (facts.inHand || (facts.wordsLive ? facts.wordsOnScreen : facts.count > 0 && facts.onScreen));
  const stepAside = facts.stepAside;
  const overWords = facts.words !== null;

  // R5: the menu closes on a gesture and when the bar goes — into the hand too, unless it is a tool in hand's choices
  // that are listed (ICE I62); and a choice's list closes as its role goes (picked up, or put down); and to the words (IK)
  const listFits = choosing === null ? !facts.inHand : (choosing.of === "tool") === facts.inHand;
  useEffect(() => {
    if (open && (!shown || stepAside || !listFits || overWords)) fold();
  }, [open, shown, stepAside, listFits, overWords, fold]);
  // folded, the bar lists More's menu again when it next grows
  useEffect(() => {
    if (!open) setChoosing(null);
  }, [open]);

  // R26: a right-click's own selection is the one the menu grows for, once the desk has drawn it (any other change of
  // selection folded it in the read, above)
  const keySeen = useRef(facts.key);
  useEffect(() => {
    if (facts.key === keySeen.current) return;
    keySeen.current = facts.key;
    const grow = growFor.current === facts.key;
    growFor.current = null;
    if (grow) surfaceRef.current.onSurfaceChange("selection");
  }, [facts.key]);

  // RIGHT-CLICK over the desk (R26, I27; MC-D6): the object under the pointer is selected FIRST by the desk's own
  // pick, then the same bar grows the same menu. On the bare mat nothing grows (the mat's own menu is not built).
  useEffect(() => {
    const container = containerOf(desk);
    if (container === null) return;
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      // a Mac's control-click is a PRIMARY press the desk takes as a click (ICE I28's note): no menu of ours over it
      if (event.button === 0 && event.ctrlKey) return;
      const rect = container.getBoundingClientRect();
      const hit = handle.pick({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      if (hit === null) return;
      const selected = selectedEntities(engine.world);
      if (selected.includes(hit.entity)) {
        surfaceRef.current.onSurfaceChange("selection");
        return;
      }
      growFor.current = keyOf([hit.entity]);
      engine.ops.setSelection([hit.entity]);
    };
    container.addEventListener("contextmenu", onContextMenu);
    return () => container.removeEventListener("contextmenu", onContextMenu);
  }, [desk, engine, handle]);

  /** A press on the desk that its pick lands on another object than the selection IS a change of selection (track OM,
   * 2026-11-26): the grown bar closes at once (the view's cut). A press on the bare mat, on the selection itself or off
   * the desk is not, and folds it where it stands (M4). */
  const pressSelects = useCallback(
    (event: PointerEvent): boolean => {
      const container = containerOf(desk);
      if (container === null || !(event.target instanceof Node)) return false;
      if (!container.contains(event.target)) return false;
      const rect = container.getBoundingClientRect();
      const hit = handle.pick({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      return hit !== null && !selectedEntities(engine.world).includes(hit.entity);
    },
    [desk, engine, handle],
  );

  const cells = useMemo(() => barCells(facts.selection, keys), [facts.selection, keys]);
  const hand = useMemo(() => {
    if (facts.hand === null) return NO_HAND;
    const { tools, active, readout } = facts.hand;
    return handCells({ tools, active, ...(readout === undefined ? {} : { readout }) }, keys);
  }, [facts.hand, keys]);
  /** The travel the anchor last told while something was in hand (I20) — the way home keeps it after the hand is gone. */
  const travel = useRef(TRAVEL_MS);
  if (facts.hand?.travelMs !== undefined) travel.current = facts.hand.travelMs;
  /** The slot whose choices are listed, as the anchor last said it — its act's over a selection, its tool's in hand. */
  const chosen = useMemo(() => {
    if (choosing === null) return undefined;
    const slots = choosing.of === "act" ? facts.selection.menu : (facts.hand?.tools ?? []);
    const slot = slots.find((s) => s.id === choosing.id);
    return slot?.choices === undefined ? undefined : { label: slot.label, choices: slot.choices };
  }, [choosing, facts.selection, facts.hand]);
  const groups = useMemo(
    () => (chosen === undefined ? menuGroups(facts.selection, keys) : choiceGroups(chosen.choices)),
    [chosen, facts.selection, keys],
  );
  const eyebrow = useMemo(
    () => (chosen === undefined ? menuEyebrow(facts.selection) : choiceEyebrow(chosen.label)),
    [chosen, facts.selection],
  );
  // IK — the words' row, its swatches in the desk's own palette as the theme dresses it (the stage's `deskLook`)
  const theme = useAppTheme().resolved;
  const palette = useMemo(() => deskLook(theme).palette, [theme]);
  const wordsRow = useMemo<WordsRow | null>(
    () =>
      facts.words === null
        ? null
        : { cells: wordsCells(facts.words.menu, palette), run: facts.words.run },
    [facts.words, palette],
  );
  // a swatch role the palette lacks draws hollow, and is said once
  useEffect(() => {
    if (wordsRow !== null) sayMissingSwatches(wordsRow.cells);
  }, [wordsRow]);
  // IK — a words act runs on the words as the anchor last said them, through the bar's one words run (bar-acts.ts)
  const onWords = useCallback(
    (press: WordsPress): void => {
      const range = rangeRef.current;
      if (range !== null) runWordsAct(engine, press, range);
    },
    [engine],
  );

  // More grows the bar into ITS menu — over a choice's list too, which gives way to it (§8 "A choice's list")
  const onOpenChange = useCallback(
    (next: boolean): void => {
      if (next) {
        setChoosing(null);
        surfaceRef.current.onSurfaceChange("selection");
      } else fold();
    },
    [fold],
  );
  /** A choice's pill pressed: its list grows in the bar — or, open on it already, the bar folds (ICE I62). */
  const onChoice = useCallback(
    (next: Choosing): void => {
      const now = choosingRef.current;
      if (surfaceRef.current.surface === "selection" && now?.of === next.of && now.id === next.id) {
        fold();
        return;
      }
      setChoosing(next);
      surfaceRef.current.onSurfaceChange("selection");
    },
    [fold],
  );
  /** A choice taken — with its fields' values for one that asks for them — through the engine's op (ICE I62). */
  const take = useCallback(
    (id: string, values?: Readonly<Record<string, number | string>>): void => {
      const now = choosingRef.current;
      if (now === null) return;
      const taken = values === undefined ? { id } : { id, values };
      if (now.of === "act") {
        engine.ops.runMenuAction(now.id, taken);
        return;
      }
      // biome-ignore lint/correctness/useHookAtTopLevel: the engine's op, not a hook
      engine.ops.useHeldTool(now.id, taken);
    },
    [engine],
  );
  const onCell = useCallback(
    (cell: BarCell): void => {
      const locked = factsRef.current.locked;
      if (cell.kind === "copy") copySelection(desk, "bar");
      else if (cell.kind === "choice") onChoice({ of: "act", id: cell.id });
      else if (cell.kind === "act") runBarAct(engine, `act:${cell.id}`, locked);
      else if (cell.kind === "desk" && cell.act !== "more") runBarAct(engine, cell.act, locked);
    },
    [desk, engine, onChoice],
  );
  const onRow = useCallback(
    (row: MenuRow, values?: Readonly<Record<string, number | string>>): void => {
      if (row.waits !== undefined) return;
      const choice = choiceOfRow(row.id);
      if (choice !== undefined) {
        take(choice, values);
        return;
      }
      // More's row for a choice act: its list in More's place, the menu staying grown
      if (row.opens === true && row.id.startsWith("act:")) {
        setChoosing({ of: "act", id: row.id.slice("act:".length) });
        return;
      }
      if (row.id === "copy") copySelection(desk, "menu");
      else if (row.id === "download") void downloadPrint(desk);
      else runBarAct(engine, row.id as BarActId, factsRef.current.locked);
    },
    [desk, engine, take],
  );
  // a tool in hand used through the engine — a mode taken up, an action run — Done, the object put down, or Copy, the
  // object copied while it stays in hand
  const onHand = useCallback(
    (cell: HandCell): void => {
      // Item 620 (2026-11-20): `useHeldTool` is the engine's op, not a React hook
      if (cell.kind === "tool" && cell.look === "choice") onChoice({ of: "tool", id: cell.id });
      // biome-ignore lint/correctness/useHookAtTopLevel: the engine's op, not a hook
      else if (cell.kind === "tool") engine.ops.useHeldTool(cell.id);
      else if (cell.kind === "done") engine.ops.putDown();
      else if (cell.kind === "copy") copySelection(desk, "hand");
    },
    [desk, engine, onChoice],
  );

  // ⌘C — Copy over the desk (HN-D3; product-chords' `desk-copy`): a product chord on the capture phase, claimed only
  // where the bar's Copy could be pressed — the desk showing (no cover over it, no sheet, the board put away), a
  // selection or an object in hand, no gesture and no writing — and never from a field or a kind that holds the
  // keyboard (the desk keymap's own gates: a note's editor, a page in hand, any input keep their native copy). Not
  // claimed, the key goes on as it always did. IK (§8 "The words bar" — Keys): while words are selected on a sheet being
  // written the keys are the field's, so ⌘C copies the words and Make a card's stands down, wherever the focus is.
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  useEffect(
    () =>
      listenForProductChord(
        (event) => {
          const now = factsRef.current;
          return (
            isCopyChord(event, keys) &&
            !hiddenRef.current &&
            (now.inHand || (now.count > 0 && !now.stepAside && !now.wordsLive)) &&
            !isEditableTarget(event.target) &&
            !keyboardClaimOf(event.target).claimed
          );
        },
        (event) => {
          if (!event.repeat) copySelection(desk, "key");
        },
      ),
    [desk, keys],
  );

  return (
    <SelectionBarView
      handleRef={barRef}
      cells={cells}
      groups={groups}
      eyebrow={eyebrow}
      shown={shown}
      stepAside={stepAside}
      open={open && shown && !overWords}
      choosing={open && shown && chosen !== undefined ? choosing : null}
      onOpenChange={onOpenChange}
      pressSelects={pressSelects}
      onCell={onCell}
      onRow={onRow}
      held={facts.inHand}
      hand={hand}
      travelMs={travel.current}
      onHand={onHand}
      reduced={reduced}
      words={wordsRow}
      onWords={onWords}
    />
  );
}

const NO_HAND: readonly HandCell[] = [];
