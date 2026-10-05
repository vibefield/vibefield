import { type Entity, PrefabId, selectedEntities } from "@vibecook/ice";
import type { MenuSlot, SelectionAnchor } from "@vibecook/ice/desk";
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
import { type FrameSurface, foldSurface } from "../../../frame/frame-surface";
import { inHand } from "../desk-anchor";
import { currentDesk, type MountedDesk, plainWords, subscribeDesk } from "../desk-door";
import type { ObjectWords } from "../desk-object-words";
import { type BarActId, COMMENT_PAD_TYPE, runBarAct } from "./bar-acts";
import { offScreen } from "./bar-geometry";
import {
  type BarCell,
  barCells,
  type DeskKeys,
  type MenuRow,
  menuEyebrow,
  menuGroups,
  type SelectionFacts,
} from "./bar-model";
import { useReducedMotion } from "./bar-motion";
import { barStats } from "./bar-stats";
import { type SelectionBarHandle, SelectionBarView } from "./SelectionBarView";

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
// re-renders and then places once. Never a render per frame (`barStats`: placements ≤ publishes).
//
// The grown menu is one of the frame's open surfaces (`surface === "selection"`, §10): opening it folds the rest,
// any of them folds it. It closes on Esc, a press elsewhere (the view's), a gesture, a change of selection — and when
// the bar goes (R5). RIGHT-CLICK (R26, I27 + I28): a `contextmenu` listener over the desk selects the object under
// the pointer FIRST by the desk's pick (`handle.pick`), then grows this same bar into this same menu (MC-D6).

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
  /** An object is in hand (DK-12's: the bar travels there; until then it steps aside). */
  readonly inHand: boolean;
  /** A gesture is on, or a note is being written (R8). */
  readonly stepAside: boolean;
  readonly selection: SelectionFacts;
}

const keyOf = (entities: readonly Entity[]): string =>
  entities
    .map((e) => e as number)
    .sort((a, b) => a - b)
    .join(",");

const menuKeyOf = (menu: readonly MenuSlot[] | undefined): string =>
  (menu ?? [])
    .map((act) => `${act.id}:${act.label}:${JSON.stringify(act.glyph ?? null)}`)
    .join("|");

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
  const stepAside = anchor.gesturing || anchor.editing || anchor.held?.landing === true;
  if (
    prev !== null &&
    prev.key === key &&
    prev.count === anchor.count &&
    prev.locked === anchor.locked &&
    prev.menuKey === menuKey &&
    prev.faults === faults &&
    prev.onScreen === onScreen &&
    prev.inHand === held &&
    prev.stepAside === stepAside
  ) {
    return prev;
  }
  const same =
    prev !== null &&
    prev.key === key &&
    prev.count === anchor.count &&
    prev.locked === anchor.locked &&
    prev.menuKey === menuKey &&
    prev.faults === faults;
  return {
    key,
    count: anchor.count,
    locked: anchor.locked,
    menuKey,
    faults,
    onScreen,
    inHand: held,
    stepAside,
    // deselected, the bar fades out still saying what it said (R8): its content stays the last selection's
    selection:
      prev !== null && (same || anchor.count === 0)
        ? prev.selection
        : readSelection(anchor, desk, entities),
  };
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

  const fold = useCallback((): void => {
    const { surface: now, onSurfaceChange: change } = surfaceRef.current;
    change(foldSurface(now, "selection"));
  }, []);

  // THE READS — each publish, and the anchor as the bar mounts: placed imperatively at once; or, when what the bar
  // SAYS changed (its width with it), remembered and placed once the bar has re-rendered. One read, one placement
  // at most — none while it is away or has nowhere to stand (a gesture's end places it where the object came to rest).
  useLayoutEffect(() => {
    const read = (): void => {
      barStats.publishes += 1;
      const anchor = source.anchor();
      const prev = factsRef.current;
      const next = readFacts(anchor, desk, prev);
      if (next !== prev) {
        factsRef.current = next;
        setFacts(next);
        if (next.selection !== prev.selection) {
          barRef.current?.place(anchor, false);
          return;
        }
      }
      const placing = next.count > 0 && next.onScreen && !next.inHand && !next.stepAside;
      barRef.current?.place(anchor, placing);
    };
    read();
    return source.subscribe(read);
  }, [source, desk]);

  const shown = facts.count > 0 && facts.onScreen && !facts.inHand && !hidden;

  // R5: the menu closes on a gesture and when the bar goes
  useEffect(() => {
    if (open && (!shown || facts.stepAside)) fold();
  }, [open, shown, facts.stepAside, fold]);

  // R5: a change of selection closes it — but a right-click's own selection is the one it grows for (R26)
  const keySeen = useRef(facts.key);
  useEffect(() => {
    if (facts.key === keySeen.current) return;
    keySeen.current = facts.key;
    if (growFor.current !== null && growFor.current === facts.key) {
      growFor.current = null;
      surfaceRef.current.onSurfaceChange("selection");
      return;
    }
    growFor.current = null;
    if (surfaceRef.current.surface === "selection") fold();
  }, [facts.key, fold]);

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

  const cells = useMemo(() => barCells(facts.selection, keys), [facts.selection, keys]);
  const groups = useMemo(() => menuGroups(facts.selection, keys), [facts.selection, keys]);
  const eyebrow = useMemo(() => menuEyebrow(facts.selection), [facts.selection]);

  const onOpenChange = useCallback(
    (next: boolean): void => {
      if (next) surfaceRef.current.onSurfaceChange("selection");
      else fold();
    },
    [fold],
  );
  const onCell = useCallback(
    (cell: BarCell): void => {
      const locked = factsRef.current.locked;
      if (cell.kind === "act") runBarAct(engine, `act:${cell.id}`, locked);
      else if (cell.kind === "desk" && cell.act !== "more") runBarAct(engine, cell.act, locked);
    },
    [engine],
  );
  const onRow = useCallback(
    (row: MenuRow): void => {
      if (row.waits !== undefined) return;
      runBarAct(engine, row.id as BarActId, factsRef.current.locked);
    },
    [engine],
  );

  return (
    <SelectionBarView
      handleRef={barRef}
      cells={cells}
      groups={groups}
      eyebrow={eyebrow}
      shown={shown}
      stepAside={facts.stepAside}
      open={open && shown}
      onOpenChange={onOpenChange}
      onCell={onCell}
      onRow={onRow}
      reduced={reduced}
    />
  );
}
