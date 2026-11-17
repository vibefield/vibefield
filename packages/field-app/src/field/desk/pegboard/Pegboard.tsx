import {
  type CanvasEngine,
  type Entity,
  hungTypes,
  Position,
  PrefabId,
  Size,
  specimensOf,
  trayEntity,
  trayFocus,
  trayHung,
} from "@vibecook/ice";
import {
  type FocusEvent,
  type KeyboardEvent,
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
import { requestView } from "../../../frame/view-state";
import { currentDesk } from "../desk-door";
import {
  boardDoor,
  boardReveal,
  dropBoardReveal,
  requestBoardFocus,
  subscribeBoard,
  subscribeBoardFocusRequest,
  subscribeBoardReveal,
  takeBoardFocusRequest,
} from "./board-door";
import { boardStats } from "./board-stats";
import { filtersStyle, PegboardView, pillStyle, ringStyle } from "./PegboardView";
import {
  type BoardSpecimen,
  boardSpecimens,
  filterOptions,
  type HungType,
  type LaidSpecimen,
  NO_SLIDE,
  offeredCategories,
  pillAside,
  placeFilters,
  placePill,
  readSlide,
  revealPlan,
  revealStep,
  rowStep,
  type SlideRead,
} from "./pegboard-model";

// THE PEGBOARD'S CONTROLLER (DK-13; DESIGN.md §8 "The pegboard — Objects, behind the line"; R14, R19, R21, P3c). The
// board rises behind the line — the DESK's own drawer, `handle.tray` — and the line's create is its door (the create
// calls `toggle()`; `frame/Composer.tsx`). This keeps the rest:
//  - ONE SURFACE AT A TIME: Objects is one of the frame's open surfaces (§10). The tray's `open` is the truth and the
//    frame's one value follows it — a board the desk shut (Esc on the desk, a click on the dimmed desk, a take handed
//    out) folds "objects"; another surface opening (the hand raised, the pill's sheet, a menu, the palette, a
//    change of view) shuts the board; "objects" asked of the owner with the board shut opens it, and a refusal (in hand)
//    folds it.
//  - THE FILTERS, placed imperatively each time the tray publishes — following the drawer every frame of its slide,
//    fading in over its last 40 % — never a render per frame; All, then the categories the board hangs whose plugin is
//    on (P3c), chosen by a click or ← → Home End (`tray.category(id)`).
//  - INSERTING BY KEYBOARD (R14), on ICE's own doors since desk.6 (I37; DK-17b retired DK-13's re-derived focus, take
//    and scroll): the board a stop of Tab after the filters, its first specimen focused as it takes the keyboard
//    (`tray.focus("first")`); ← → ICE's walk in the lay's order (`focus("prev" | "next")`), ↑ ↓ the specimen nearest in
//    the row above or below, focused by its id — ICE scrolls the least that shows it; the RING over the focused object
//    where the last frame drew it (`anchor().focused.rect`, 2 out); ⏎ `tray.lay()` — the tray's own take at the view's
//    centre, one undo step, selected, the board folding as a handed take's does; Esc closes the board.
//  - MORE IN PLUGINS… (MK-D1, MK-4d): the pill at the board's foot, placed with the filters on each publish and
//    riding the drawer's slide; it steps aside while an object is in hand and while the board hangs nothing, and a
//    press hands the frame the board's category (`onMorePlugins`): the frame opens the Plugins popup, which folds the
//    board.
//  - A SET SHOWN AFTER AN INSTALL (MK-D8's fallback B, MK-E14; MK-4d): the popup's act asks it (`showOnBoard`); over
//    a covered view Canvas first, then the board raised holding the keyboard, on the set's first category in the
//    board's order with its first object focused, asked again on each publish until the board hangs the set. A view
//    that covers the desk once the showing stood on Canvas is the person's move: the showing goes, Canvas not asked.

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable);

/** What the board SAYS — its re-render key: the facts that change what the chrome shows, never the slide's frames. */
interface BoardState {
  readonly ready: boolean;
  readonly open: boolean;
  /** More in Plugins… steps aside: an object in hand, or a board that hangs nothing (MK-4d). */
  readonly aside: boolean;
  readonly category: string;
  readonly categories: readonly {
    readonly id: string;
    readonly label: string;
    readonly count: number;
  }[];
  /** The mounted desk (a remount brings a new off set, a new door). */
  readonly desk: string;
}

const NO_BOARD: BoardState = {
  ready: false,
  open: false,
  aside: true,
  category: "",
  categories: [],
  desk: "",
};
let lastKey = "";
let lastState: BoardState = NO_BOARD;
function boardState(): BoardState {
  const desk = currentDesk();
  const door = boardDoor();
  if (desk === null || door === null) {
    lastKey = "";
    lastState = NO_BOARD;
    return NO_BOARD;
  }
  const a = door.anchor();
  const next: BoardState = {
    ready: true,
    open: a.open,
    aside: pillAside(a),
    category: a.category,
    categories: a.categories.map((c) => ({ id: c.id, label: c.label, count: c.count })),
    desk: `${desk.generation}.${desk.mount}`,
  };
  const key = JSON.stringify(next);
  if (key !== lastKey) {
    lastKey = key;
    lastState = next;
  }
  return lastState;
}
const subscribeCounted = (fn: () => void): (() => void) =>
  subscribeBoard(() => {
    boardStats.publishes += 1;
    fn();
  });

/** The person chose on the board themselves (a filter, a key): a showing still standing goes (MK-4d). */
function movedOn(): void {
  const want = boardReveal();
  if (want !== null) dropBoardReveal(want.id);
}

/** The types the board hangs with their categories (core's `hungTypes` — the engine catalog's tray entries). */
function hungOf(engine: CanvasEngine): HungType[] {
  return hungTypes(engine.world).map((w) => ({ type: w.type, category: w.tray?.category ?? "" }));
}

/** The specimens core laid on the board now (the category's), less the kinds the desk was mounted without. */
function laidOf(engine: CanvasEngine, off: ReadonlySet<string>): LaidSpecimen[] {
  const world = engine.world;
  const tray = trayEntity(world);
  if (tray === undefined) return [];
  const out: LaidSpecimen[] = [];
  for (const e of specimensOf(world, tray)) {
    const type = world.get(e, PrefabId)?.id;
    if (typeof type !== "string" || off.has(type)) continue;
    const widget = engine.catalog.widget(type);
    const at = world.get(e, Position);
    const size = world.get(e, Size);
    if (widget?.tray === undefined || at === undefined || size === undefined) continue;
    out.push({
      type,
      label: widget.tray.label,
      hang: { x: at.x, y: at.y, w: size.w, h: size.h },
      natural: widget.defaultSize,
    });
  }
  return out;
}

/**
 * The specimens where the board hangs them (the drawer as last drawn) at the board's scroll — the listbox's options in
 * the lay's order, and the rows ↑ ↓ step between. Never the ring's place: that is ICE's (`anchor().focused.rect`).
 */
function drawnSpecimens(): BoardSpecimen[] {
  const desk = currentDesk();
  const door = boardDoor();
  if (desk === null || door === null) return [];
  const drawer = door.anchor().drawer;
  if (drawer === null) return [];
  const engine = desk.engine;
  return boardSpecimens(
    laidOf(engine, desk.off ?? new Set()),
    trayHung(engine.world),
    drawer,
    door.scroll(),
  );
}

export function Pegboard({
  surface,
  onSurfaceChange,
  covered,
  onMorePlugins,
}: {
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  /** A view covers the desk (every view but Canvas): a showing asks for Canvas first (MK-E14). */
  covered: boolean;
  /**
   * More in Plugins… pressed (MK-D1): the frame opens the Plugins popup on Discover. It is handed the board's
   * category ("" All), which Discover opens on, its categories being the pegboard's (item 433; DESIGN.md §8 "The
   * pegboard").
   */
  onMorePlugins: (category: string) => void;
}): ReactElement {
  const state = useSyncExternalStore(subscribeCounted, boardState, () => NO_BOARD);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  /** The drawer's slide as read from the frames it drew, so More in Plugins… rides it (MK-4d). */
  const slide = useRef<SlideRead>(NO_SLIDE);
  /** The specimen the keyboard is on — ICE's (`anchor().focused`, I37), followed for the listbox's words — and whether
   * the ring shows (the board focused, by the keyboard). */
  const [focused, setFocused] = useState<string | null>(null);
  const ringOn = useRef(false);
  /** The board took the keyboard since it last came out: its first focus lands on its first specimen (DK-13). */
  const focusedThisOpen = useRef(false);
  /** A first focus asked of ICE from a publish, not yet run (one at a time — never a write inside the frame). */
  const firstAsked = useRef(false);
  /** A showing's lay asked of ICE from a publish, not yet run (one at a time, as the first focus is; MK-4d). */
  const revealAsked = useRef(false);
  /** Where the focus was before the board took it, to give it back when the board folds. */
  const returnFocus = useRef<HTMLElement | null>(null);
  /** The specimens the board hangs now — the listbox's options (re-set only when the list itself changes). */
  const [hung, setHung] = useState<readonly { type: string; label: string }[]>([]);

  // P3c — All, then the categories the board hangs whose plugin is on (the mount's off set), in the lay's order
  const options = useMemo(() => {
    const desk = currentDesk();
    if (!state.ready || desk === null) return filterOptions([]);
    return filterOptions(
      offeredCategories(state.categories, hungOf(desk.engine), desk.off ?? new Set()),
    );
  }, [state]);
  const category = options.some((o) => o.id === state.category) ? state.category : "";

  // a category whose every kind's plugin went off is no longer offered: the board shows All
  useEffect(() => {
    if (state.category !== "" && !options.some((o) => o.id === state.category))
      boardDoor()?.category("");
  }, [state.category, options]);

  // ── the imperative placements: the filters in the header band, the ring over the focused specimen ───────────────
  // The ring stands where the LAST FRAME drew the focused object (ICE's `anchor().focused.rect` — the fit inside its
  // hang, what a press grabs; null while the drawer is not drawn): a focus move is a frame, and the scroll ICE takes to
  // show it is drawn in it, so the ring never stands where a specimen was.
  const placeRing = useCallback((): void => {
    const ring = ringRef.current;
    if (ring === null) return;
    const rect = ringOn.current ? (boardDoor()?.anchor().focused?.rect ?? null) : null;
    if (rect === null) {
      delete ring.dataset["shown"];
      return;
    }
    Object.assign(ring.style, ringStyle(rect));
    ring.dataset["shown"] = "true";
    boardStats.placements += 1;
  }, []);

  // MK-4d — a showing's LAY, once the board is out and hangs the set: the set's first category in the board's order,
  // then its first object there focused, the board holding the keyboard (so ⏎ lays it). WRITES, so asked a microtask
  // after the frame that called for them, one at a time; a category changed is laid by the next frame, whose publish
  // asks again for the focus, and ICE focuses nothing until the board is laid (I37), so each publish asks until it
  // lands
  const askLay = useCallback((): void => {
    const want = boardReveal();
    const desk = currentDesk();
    const anchor = boardDoor()?.anchor() ?? null;
    if (want === null || desk === null || anchor === null) return;
    if (!anchor.open || anchor.drawer === null || revealAsked.current) return;
    const off: ReadonlySet<string> = desk.off ?? new Set();
    const hangs = hungOf(desk.engine);
    const offered = offeredCategories(anchor.categories, hangs, off);
    const plan = revealPlan(want.types, offered, hangs, off);
    if (plan === null) return;
    revealAsked.current = true;
    queueMicrotask(() => {
      revealAsked.current = false;
      const door = boardDoor();
      if (door === null || boardReveal()?.id !== want.id || !door.isOpen()) return;
      if (door.category() !== plan.category) {
        door.category(plan.category);
        return;
      }
      const board = boardRef.current;
      if (board !== null && document.activeElement !== board) {
        focusedThisOpen.current = true;
        board.focus({ preventScroll: true });
      }
      ringOn.current = true;
      const to = door.focus(plan.type);
      if (to !== plan.type) return;
      dropBoardReveal(want.id);
      setFocused(to);
    });
  }, []);

  const place = useCallback((): void => {
    const filters = filtersRef.current;
    const pill = pillRef.current;
    const anchor = boardDoor()?.anchor() ?? null;
    const drawer = anchor?.drawer ?? null;
    // the drawer's slide, read from the frames it drew: More in Plugins… rides it (MK-4d)
    if (anchor !== null && drawer !== null) {
      slide.current = readSlide(slide.current, drawer, anchor.view.height);
    }
    // the board's controls — the filters in its header band, More in Plugins… at its foot — written together, one
    // placement a publish
    if (filters !== null || pill !== null) {
      if (filters !== null) Object.assign(filters.style, filtersStyle(placeFilters(drawer)));
      if (pill !== null) {
        const at = anchor === null ? null : placePill(drawer, anchor.view, slide.current.travel);
        Object.assign(pill.style, pillStyle(at));
      }
      boardStats.placements += 1;
    }
    // the list the board hangs (a lay: the board out, a category, a remount, a resize) — re-set only when it changes,
    // and kept while no drawer is drawn (shut, its specimens still hang)
    if (anchor?.drawer !== null && anchor?.drawer !== undefined) {
      const next = drawnSpecimens().map((s) => ({ type: s.type, label: s.label }));
      setHung((prev) =>
        prev.length === next.length && prev.every((p, i) => p.type === next[i]?.type) ? prev : next,
      );
    }
    // ICE's focus, followed (a render only when it moved to another specimen)
    const id = anchor?.focused?.id ?? null;
    setFocused((prev) => (prev === id ? prev : id));
    // the board holds the keyboard. Taken with no focus event this open (B raised it while the window was not the key
    // window, so the event waits; DK-13's path) it is this open's first stop: ringed, on ICE's first specimen. And while
    // ICE holds no focus — B raised the board before its first lay was laid (the focus comes as the drawer starts to
    // rise, and ICE's focus finds nothing hung yet), or ICE let it go with a category — the first it hangs (DK-13's
    // reading). A WRITE — and this runs inside the desk's frame (the tray's publish is its reflector's), so it is asked a
    // microtask after it, one at a time, until ICE's anchor says a focus. A showing lands its own object (MK-4d), so
    // while one stands the first is not asked.
    if (
      anchor?.drawer != null &&
      document.activeElement === boardRef.current &&
      drawnSpecimens().length > 0
    ) {
      const took = !focusedThisOpen.current;
      if (took) {
        focusedThisOpen.current = true;
        ringOn.current = true;
      }
      if ((took || id === null) && !firstAsked.current && boardReveal() === null) {
        firstAsked.current = true;
        queueMicrotask(() => {
          firstAsked.current = false;
          if (document.activeElement === boardRef.current && boardReveal() === null)
            boardDoor()?.focus("first");
        });
      }
    }
    askLay();
    placeRing();
  }, [placeRing, askLay]);

  useLayoutEffect(() => {
    place();
    return subscribeBoard(place);
  }, [place]);

  useLayoutEffect(() => {
    placeRing();
  }, [focused, placeRing]);

  // ── one surface at a time (§10): the tray's open is the truth; the frame's one value follows it ─────────────────
  // What the DESK did to the board is heard as it publishes (after the frame that drew it): a board the desk shut (its
  // own Esc, a click on the dimmed desk, a take handed out) folds "objects"; one opened by another door than the line's
  // (a rig's) is "objects". The line's create and this controller's own asks set the surface as they ask, so their
  // publishes find it already said — never a change answered twice (a render-time read of the fact would chase the
  // controller's own writes round and round).
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  useEffect(() => {
    let last = boardDoor()?.isOpen() ?? false;
    return subscribeBoard(() => {
      const open = boardDoor()?.isOpen() ?? false;
      if (open === last) return;
      last = open;
      const now = surfaceRef.current;
      if (open && now !== "objects") onSurfaceChange("objects");
      else if (!open && now === "objects") onSurfaceChange(null);
    });
  }, [onSurfaceChange]);
  useEffect(() => {
    const door = boardDoor();
    if (door === null || !state.ready) return;
    if (surface === "objects") {
      // asked of the owner with the board shut: open it — the desk refuses it in hand (R14), and the ask folds
      if (!door.isOpen() && !door.open()) onSurfaceChange(foldSurface(surface, "objects"));
    } else if (door.isOpen()) door.close();
  }, [surface, onSurfaceChange, state.ready]);

  // ── MK-4d: a set shown on the board after an install (MK-D8's fallback B; MK-E14) ─────────────────────────────
  // The popup's act hands the set here (`showOnBoard`), and `revealStep` says what the frame does next: over a covered
  // view Canvas first; on Canvas the board raised holding the keyboard (the frame's one value, so the popup folds as it
  // rises); once out, its lay on the desk's publish (`askLay`, above). It goes once the person moves on (a view
  // covering the desk once it stood on Canvas is theirs too), and an install's remount (a new desk) raises the board
  // again on the set.
  const reveal = useSyncExternalStore(subscribeBoardReveal, boardReveal, () => null);
  /** The showing the facts below are of, whether it asked for Canvas, whether it has stood on Canvas, and the desk it
   * last saw the board out on. */
  const revealFor = useRef<number | null>(null);
  const revealAskedCanvas = useRef(false);
  const revealOnCanvas = useRef(false);
  const revealShownOn = useRef<string | null>(null);
  useEffect(() => {
    if (reveal === null) return;
    if (revealFor.current !== reveal.id) {
      revealFor.current = reveal.id;
      revealAskedCanvas.current = false;
      revealOnCanvas.current = false;
      revealShownOn.current = null;
    }
    // read before the desk is: a showing on Canvas while no desk is mounted (a remount's gap) stood there too
    if (!covered) revealOnCanvas.current = true;
    if (!state.ready) return;
    const door = boardDoor();
    if (door === null) return;
    const step = revealStep({
      covered,
      askedCanvas: revealAskedCanvas.current,
      onCanvas: revealOnCanvas.current,
      surface,
      open: state.open,
      held: door.anchor().held,
      desk: state.desk,
      shownOn: revealShownOn.current,
    });
    if (step === "canvas") {
      revealAskedCanvas.current = true;
      void requestView("canvas");
    } else if (step === "raise") {
      requestBoardFocus();
      onSurfaceChange("objects");
    } else if (step === "out") {
      revealShownOn.current = state.desk;
      askLay();
    } else if (step === "drop") dropBoardReveal(reveal.id);
  }, [reveal, covered, surface, state.ready, state.open, state.desk, onSurfaceChange, askLay]);

  // ── the focus: taken when the board was asked for from the keyboard; given back when it folds ──────────────────
  const takeFocus = useCallback((): void => {
    const board = boardRef.current;
    if (board === null || !state.open) return;
    if (!takeBoardFocusRequest()) return;
    const active = document.activeElement;
    returnFocus.current =
      active instanceof HTMLElement && active !== document.body && !active.closest(".vf-pegboard")
        ? active
        : null;
    board.focus({ preventScroll: true });
  }, [state.open]);
  useEffect(() => {
    takeFocus();
    return subscribeBoardFocusRequest(takeFocus);
  }, [takeFocus]);
  useEffect(() => {
    if (state.open) return;
    // the board folded: the chrome over it lets go of the focus — back where it was, or to the desk's window
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".vf-pegboard") !== null) {
      const back = returnFocus.current;
      if (back?.isConnected) back.focus({ preventScroll: true });
      else active.blur();
    }
    returnFocus.current = null;
    ringOn.current = false;
    focusedThisOpen.current = false;
  }, [state.open]);

  // ── Esc closes the board (taken before the desk's own Esc ladder, which would also shut it — once is the board's) ─
  useEffect(() => {
    if (!state.open) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape" || isEditable(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      boardDoor()?.close();
      onSurfaceChange(foldSurface(surface, "objects"));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state.open, surface, onSurfaceChange]);

  // the pointer takes over: the ring is the keyboard's, and a wheel or a press moves the board under it
  useEffect(() => {
    if (!state.open) return;
    const away = (): void => {
      if (!ringOn.current) return;
      ringOn.current = false;
      placeRing();
    };
    window.addEventListener("pointerdown", away, { capture: true, passive: true });
    window.addEventListener("wheel", away, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", away, { capture: true });
      window.removeEventListener("wheel", away, { capture: true });
    };
  }, [state.open, placeRing]);

  // ── MK-4d: More in Plugins… (MK-D1) — the board's category to the frame, whose popup folds the board ───────────
  const onMore = useCallback(() => onMorePlugins(category), [onMorePlugins, category]);

  // ── the board's keys (R14), on ICE's doors (I37) ──────────────────────────────────────────────────────────────
  const onBoardKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const door = boardDoor();
    const desk = currentDesk();
    if (door === null || desk === null) return;
    if (event.key === "Enter") {
      event.preventDefault();
      // the tray's OWN take of the focused specimen, at the view's centre: one undo step, selected — and ICE folds the
      // board as a handed take's does (refused — undefined — with nothing focused or a type the board no longer hangs)
      let made: Entity | undefined;
      try {
        made = door.lay();
      } catch {
        return; // a document that takes no write (read-only) refuses the spawn, as ⏎ always did
      }
      if (made === undefined) return;
      boardStats.inserts += 1;
      onSurfaceChange(foldSurface(surface, "objects"));
      return;
    }
    let to: string;
    if (event.key === "ArrowLeft") to = door.focus("prev");
    else if (event.key === "ArrowRight") to = door.focus("next");
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      // ICE's walk is linear; the row above or below is this board's geometry — focused by its id
      const specimens = drawnSpecimens();
      const index = specimens.findIndex((s) => s.type === trayFocus(desk.engine.world));
      const next = rowStep(specimens, index, event.key);
      const type = next === null ? undefined : specimens[next]?.type;
      to = type === undefined ? door.focus("first") : door.focus(type);
    } else return;
    event.preventDefault();
    movedOn();
    ringOn.current = true;
    setFocused(to === "" ? null : to);
    // the ring follows the frame this focus move asks for (ICE scrolls the specimen into the face in it)
  };
  const onBoardFocus = (_event: FocusEvent<HTMLDivElement>): void => {
    ringOn.current = true;
    const door = boardDoor();
    if (door !== null && !focusedThisOpen.current) {
      focusedThisOpen.current = true;
      // a showing lands its own object (MK-4d): the board's first is not asked while one stands
      if (boardReveal() === null) {
        const to = door.focus("first");
        setFocused(to === "" ? null : to);
      }
    }
    placeRing();
  };
  const onBoardBlur = (_event: FocusEvent<HTMLDivElement>): void => {
    ringOn.current = false;
    placeRing();
  };

  return (
    <PegboardView
      open={state.open}
      options={options}
      category={category}
      onCategory={(id) => {
        movedOn();
        boardDoor()?.category(id);
      }}
      filtersRef={filtersRef}
      specimens={hung}
      focused={focused}
      boardRef={boardRef}
      ringRef={ringRef}
      onBoardKeyDown={onBoardKeyDown}
      onBoardFocus={onBoardFocus}
      onBoardBlur={onBoardBlur}
      pillRef={pillRef}
      pillAside={state.aside}
      onMore={onMore}
    />
  );
}
