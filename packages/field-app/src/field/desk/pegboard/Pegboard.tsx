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
import { currentDesk } from "../desk-door";
import {
  boardDoor,
  subscribeBoard,
  subscribeBoardFocusRequest,
  takeBoardFocusRequest,
} from "./board-door";
import { boardStats } from "./board-stats";
import { filtersStyle, PegboardView, ringStyle } from "./PegboardView";
import {
  type BoardSpecimen,
  boardSpecimens,
  filterOptions,
  type HungType,
  type LaidSpecimen,
  offeredCategories,
  placeFilters,
  rowStep,
} from "./pegboard-model";

// THE PEGBOARD'S CONTROLLER (DK-13; DESIGN.md §8 "The pegboard — Objects, behind the line"; R14, R19, R21, P3c). The
// board rises behind the line — the DESK's own drawer, `handle.tray` — and the line's create is its door (the create
// calls `toggle()`; `frame/Composer.tsx`). This keeps the rest:
//  - ONE SURFACE AT A TIME: Objects is one of the frame's open surfaces (§10). The tray's `open` is the truth and the
//    frame's one value follows it — a board the desk shut (Esc on the desk, a click on the dimmed desk, a take handed
//    out) folds "objects"; another surface opening (@'s list, the explorer, a menu, a drawer, the palette, a change of
//    view) shuts the board; "objects" asked of the owner with the board shut opens it, and a refusal (in hand) folds it.
//  - THE FILTERS, placed imperatively each time the tray publishes — following the drawer every frame of its slide,
//    fading in over its last 40 % — never a render per frame; All, then the categories the board hangs whose plugin is
//    on (P3c), chosen by a click or ← → Home End (`tray.category(id)`).
//  - INSERTING BY KEYBOARD (R14), on ICE's own doors since desk.6 (I37; DK-17b retired DK-13's re-derived focus, take
//    and scroll): the board a stop of Tab after the filters, its first specimen focused as it takes the keyboard
//    (`tray.focus("first")`); ← → ICE's walk in the lay's order (`focus("prev" | "next")`), ↑ ↓ the specimen nearest in
//    the row above or below, focused by its id — ICE scrolls the least that shows it; the RING over the focused object
//    where the last frame drew it (`anchor().focused.rect`, 2 out); ⏎ `tray.lay()` — the tray's own take at the view's
//    centre, one undo step, selected, the board folding as a handed take's does; Esc closes the board.

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
  readonly category: string;
  readonly categories: readonly {
    readonly id: string;
    readonly label: string;
    readonly count: number;
  }[];
  /** The mounted desk (a remount brings a new off set, a new door). */
  readonly desk: string;
}

const NO_BOARD: BoardState = { ready: false, open: false, category: "", categories: [], desk: "" };
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
 * reading order, and the rows ↑ ↓ step between. Never the ring's place: that is ICE's (`anchor().focused.rect`).
 */
function drawnSpecimens(): BoardSpecimen[] {
  const desk = currentDesk();
  const door = boardDoor();
  if (desk === null || door === null) return [];
  const drawer = door.anchor().drawer;
  if (drawer === null) return [];
  return boardSpecimens(laidOf(desk.engine, desk.off ?? new Set()), drawer, door.scroll());
}

export function Pegboard({
  surface,
  onSurfaceChange,
}: {
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
}): ReactElement {
  const state = useSyncExternalStore(subscribeCounted, boardState, () => NO_BOARD);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  /** The specimen the keyboard is on — ICE's (`anchor().focused`, I37), followed for the listbox's words — and whether
   * the ring shows (the board focused, by the keyboard). */
  const [focused, setFocused] = useState<string | null>(null);
  const ringOn = useRef(false);
  /** The board took the keyboard since it last came out: its first focus lands on its first specimen (DK-13). */
  const focusedThisOpen = useRef(false);
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

  const place = useCallback((): void => {
    const filters = filtersRef.current;
    const anchor = boardDoor()?.anchor() ?? null;
    if (filters !== null) {
      Object.assign(filters.style, filtersStyle(placeFilters(anchor?.drawer ?? null)));
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
    placeRing();
  }, [placeRing]);

  useLayoutEffect(() => {
    place();
    return subscribeBoard(place);
  }, [place]);

  // the board holds the keyboard and ICE holds no focus — its first lay not laid yet (B: the focus comes as the drawer
  // starts to rise), or a category ICE let the focus go in — the first it hangs (DK-13's reading); a write, so never
  // inside the tray's publish
  useEffect(() => {
    if (focused !== null || hung.length === 0 || !state.open) return;
    if (document.activeElement !== boardRef.current) return;
    boardDoor()?.focus("first");
  }, [focused, hung, state.open]);
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
    ringOn.current = true;
    setFocused(to === "" ? null : to);
    // the ring follows the frame this focus move asks for (ICE scrolls the specimen into the face in it)
  };
  const onBoardFocus = (_event: FocusEvent<HTMLDivElement>): void => {
    ringOn.current = true;
    const door = boardDoor();
    if (door !== null && !focusedThisOpen.current) {
      focusedThisOpen.current = true;
      const to = door.focus("first");
      setFocused(to === "" ? null : to);
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
      category={options.some((o) => o.id === state.category) ? state.category : ""}
      onCategory={(id) => boardDoor()?.category(id)}
      filtersRef={filtersRef}
      specimens={hung}
      focused={focused}
      boardRef={boardRef}
      ringRef={ringRef}
      onBoardKeyDown={onBoardKeyDown}
      onBoardFocus={onBoardFocus}
      onBoardBlur={onBoardBlur}
    />
  );
}
