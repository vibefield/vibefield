// @vitest-environment happy-dom
/**
 * DK-13 — THE PEGBOARD'S CONTROLLER (field/desk/pegboard/Pegboard.tsx over PegboardView.tsx; DESIGN.md §8 "The pegboard —
 * Objects, behind the line"; R14, R19, P3c; plan addendum 47). Over a real field engine — the seeded first board, its
 * pegboard LAID by core's own tray lay through the pose seam (`stack.trayPose`) — and a tray door that keeps ICE's
 * `handle.tray` contract over that world (core's tray ops; the anchor publishing as the desk would after a frame):
 *   ONE SURFACE AT A TIME — the board out is the frame's "objects"; another surface shuts it; the desk shutting it folds
 *     "objects"; "objects" asked of the owner opens it, and a refusal (in hand) folds the ask;
 *   THE FILTERS — All, then the categories in the lay's order (P3c: none whose every kind's plugin is off), placed
 *     imperatively per publish in the header band, never a render per frame; a click chooses (`tray.category`);
 *   THE KEYS — a keyboard open takes the focus: the first specimen ringed where the board draws it, → ↓ move, ⏎ lays it at
 *     the view's centre (one undo step, selected; the board folds), Esc closes (before the desk's keymap), the pointer
 *     takes the ring away, the focus goes back where it was. Since DK-17b (ICE I37) the keys drive ICE's own doors — the
 *     door here keeps `tray.focus` / `anchor().focused` / `tray.lay` over core's real ops (`focusTray`, `trayFocus`,
 *     `ops.layFromTray`), the scroll into view core's lay's own;
 *   MORE IN PLUGINS… (MK-4d, MK-D1) — the pill at the board's foot, placed with the filters and riding the slide, aside
 *     in hand or over an empty board, the third stop of Tab; a press hands the frame the board's category;
 *   A SET SHOWN AFTER AN INSTALL (MK-4d; MK-D8's fallback B, MK-E14) — Canvas first over a covered view, the board
 *     raised on the set's first category in the board's order with its first object focused, across an install's
 *     remount.
 */
import {
  Camera,
  type CanvasEngine,
  closeTray,
  type Entity,
  ensureTray,
  focusTray,
  hungTypes,
  openTray,
  Position,
  PrefabId,
  Size,
  scrollTray,
  selectedEntities,
  setTrayCategory,
  setTrayHidden,
  setTrayOnly,
  specimensOf,
  Tray,
  toggleTray,
  trayCategories,
  trayCategory,
  trayEntity,
  trayEntryCount,
  trayFocus,
  trayHidden,
  trayHung,
  trayOnly,
  trayOpen,
  Viewport,
} from "@vibecook/ice";
import type { DeskTrayDoor, TrayAnchor } from "@vibecook/ice/desk";
import { DRAWER } from "@vibecook/ice/desk";
import { screenToWorld } from "@vibecook/ice/kernel";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import {
  deskCensus,
  deskObjects,
  type MountedDesk,
  publishDesk,
} from "../src/field/desk/desk-door";
import {
  boardReveal,
  requestBoardFocus,
  resetBoardRevealForTest,
  showOnBoard,
  takeBoardFocusRequest,
  useBoardFacts,
  useBoardLineDoor,
  useBoardNames,
} from "../src/field/desk/pegboard/board-door";
import { readBoardStats, resetBoardStatsForTest } from "../src/field/desk/pegboard/board-stats";
import { Pegboard } from "../src/field/desk/pegboard/Pegboard";
import { moreOf, PegboardView } from "../src/field/desk/pegboard/PegboardView";
import { boardSpecimens, PEGBOARD, placeFilters } from "../src/field/desk/pegboard/pegboard-model";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";
import type { FrameSurface } from "../src/frame/frame-surface";
import { type FieldHost, setHost } from "../src/host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW = { width: 1180, height: 748 };
/** The drawer as the desk draws it out in a 1180 × 748 view (ICE's `drawerRect`: 1120 wide, 44 % high). */
const DRAWER_OUT = { x: 30, y: 419, w: 1120, h: 329 };
/** The drawer's width for this test: the first launch's lineup hangs one row at the real one. */
let drawerWidth = DRAWER_OUT.w;

interface TestDoor extends DeskTrayDoor {
  /** The desk drew a frame that moved what the anchor says: its subscribers are told. */
  publish(over?: { p?: number }): void;
  /** `open()` refuses (an object in hand — R14). */
  refuse: boolean;
}

let ce: CanvasEngine;
let door: TestDoor;
let unpublish: () => void;
let host: HTMLDivElement;
let root: Root;
let surfaceNow: FrameSurface | null;
let setSurfaceNow: (next: FrameSurface | null) => void;
/** Whether a view covers the desk, as ChromeLayer hands it (MK-E14). */
let setCoveredNow: (next: boolean) => void;
/** The categories More in Plugins… handed the frame, press by press (MK-4d). */
let mores: string[];
let clock = 0;
let p = 1;
/** A stand-in for ICE's keymap on the window's bubble phase: what reached it un-taken (its gate 1). */
let keymapHeard: string[];
const keymap = (event: KeyboardEvent): void => {
  if (!event.defaultPrevented) keymapHeard.push(event.key);
};

const step = (): void => {
  clock += 16;
  ce.step(clock);
};

function trayDoor(engine: CanvasEngine): TestDoor {
  const w = engine.world;
  const listeners = new Set<() => void>();
  const fact = (): number => {
    const tray = trayEntity(w);
    return tray === undefined ? 0 : (w.get(tray, Tray)?.scroll ?? 0);
  };
  /** The scroll as the desk last DREW it — the fact as of the last frame (a publish), trailing a scroll set since. */
  let drawnScroll = 0;
  /** The focus as the last frame drew it (I37's `anchor().focused`): its type and its object where the board drew it. */
  let drawnFocus: TrayAnchor["focused"] = null;
  const frame = () => {
    const scroll = drawnScroll;
    return {
      ...DRAWER_OUT,
      w: drawerWidth,
      y: VIEW.height - DRAWER_OUT.h * p,
      p,
      max: 2000,
      pitch: DRAWER.pitch,
      scroll,
      face: DRAWER_OUT.h,
      head: DRAWER.header,
      foot: 4,
    };
  };
  const self: TestDoor = {
    refuse: false,
    open: () => (self.refuse ? false : openTray(w)),
    close: () => closeTray(w),
    toggle: () => (self.refuse && !trayOpen(w) ? false : toggleTray(w)),
    isOpen: () => trayOpen(w),
    scroll(px?: number) {
      if (px !== undefined) scrollTray(w, px);
      const tray = trayEntity(w);
      return tray === undefined ? 0 : (w.get(tray, Tray)?.scroll ?? 0);
    },
    state: () =>
      ({ frame: frame(), specimens: [] }) as unknown as ReturnType<DeskTrayDoor["state"]>,
    pin: () => undefined,
    category(id?: string) {
      if (id !== undefined) setTrayCategory(w, id);
      return trayCategory(w);
    },
    categories: () => trayCategories(w),
    // ICE 0.18.0's set and hidden types (I54), written as the desk's own door writes them,
    // less the publish its `only` asks, which no row here reads (MK-7, 2026-11-19)
    only(types) {
      if (types !== undefined) setTrayOnly(w, types);
      return trayOnly(w);
    },
    hide(types) {
      if (types !== undefined) setTrayHidden(w, types);
      return trayHidden(w);
    },
    anchor(): TrayAnchor {
      const f = frame();
      const out = trayOpen(w);
      return {
        open: out,
        drawer: out
          ? { x: f.x, y: f.y, w: f.w, p, header: { y: f.y + DRAWER.arris, h: DRAWER.header } }
          : null,
        view: VIEW,
        night: 0,
        held: false,
        entries: trayEntryCount(w),
        category: trayCategory(w),
        categories: trayCategories(w),
        only: trayOnly(w),
        focused: drawnFocus,
      };
    },
    focus: (to) => focusTray(w, to),
    lay(id, opts) {
      const type = id ?? trayFocus(w);
      if (type === "") return undefined;
      const camera = w.getResource(Camera);
      if (camera === undefined) return undefined;
      const at = opts?.at ?? { x: VIEW.width / 2, y: VIEW.height / 2 };
      return engine.ops.layFromTray(
        type,
        opts?.space === "world" ? at : screenToWorld(at.x, at.y, camera),
      );
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    publish(over = {}) {
      if (over.p !== undefined) p = over.p;
      act(() => {
        step();
        drawnScroll = fact();
        const id = trayFocus(w);
        const drawer = self.anchor().drawer;
        const at =
          drawer === null
            ? undefined
            : laidNow(engine, drawer, drawnScroll).find((d) => d.type === id);
        drawnFocus = id === "" ? null : { id, rect: at === undefined ? null : at.rect };
        for (const fn of [...listeners]) fn();
      });
    },
  } as TestDoor;
  return self;
}

function Harness(): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  const [covered, setCovered] = useState(false);
  surfaceNow = surface;
  setSurfaceNow = setSurface;
  setCoveredNow = setCovered;
  return createElement(Pegboard, {
    surface,
    onSurfaceChange: setSurface,
    covered,
    // the frame's door, as ChromeLayer's `openPlugins` is: the popup is the frame's one open surface
    onMorePlugins: (category: string) => {
      mores.push(category);
      setSurface("plugins");
    },
  });
}

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const el = host.querySelector<T>(selector);
  if (el === null) throw new Error(`no ${selector}`);
  return el;
};
const filters = (): string[] =>
  [...host.querySelectorAll(".vf-pegboard-track > button")].map((b) => b.textContent ?? "");
const board = (): HTMLElement => q(".vf-pegboard-board");
const focusedType = (): string | null =>
  host.querySelector('.vf-pegboard-board [aria-selected="true"]')?.getAttribute("data-type") ??
  null;
const key = (
  k: string,
  target: EventTarget = document.activeElement ?? document.body,
): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

/** Where the board draws each specimen now: the model over the world's laid specimens, the drawer and the scroll. */
function drawnNow() {
  const drawer = door.anchor().drawer;
  if (drawer === null) return [];
  return laidNow(ce, drawer, door.scroll());
}

/** The specimens core laid on `engine`'s board, where a drawer at `drawer` scrolled by `scroll` draws their objects. */
function laidNow(engine: CanvasEngine, drawer: { x: number; y: number }, scroll: number) {
  const w = engine.world;
  const tray = trayEntity(w);
  if (tray === undefined) return [];
  const laid = specimensOf(w, tray).map((e) => {
    const type = w.get(e, PrefabId)?.id as string;
    const at = w.get(e, Position) as { x: number; y: number };
    const size = w.get(e, Size) as { w: number; h: number };
    const widget = engine.catalog.widget(type);
    return {
      type,
      label: widget?.tray?.label ?? type,
      hang: { x: at.x, y: at.y, w: size.w, h: size.h },
      natural: widget?.defaultSize ?? { w: 1, h: 1 },
    };
  });
  return boardSpecimens(laid, trayHung(w), drawer, scroll);
}

/** The ring as the controller wrote it: its rect on screen. */
function ringRect(): { x0: number; y0: number; x1: number; y1: number } | null {
  const ring = q(".vf-pegboard-ring");
  if (ring.dataset.shown !== "true") return null;
  const m = /^translate\(([-\d.]+)px, ([-\d.]+)px\)$/u.exec(ring.style.transform);
  if (m === null) return null;
  const x0 = Number(m[1]);
  const y0 = Number(m[2]);
  return {
    x0,
    y0,
    x1: x0 + Number.parseFloat(ring.style.width),
    y1: y0 + Number.parseFloat(ring.style.height),
  };
}

async function mountDesk(off: ReadonlySet<string> = new Set(), mount = 0): Promise<void> {
  ce = createFieldEngine(buildRegistry());
  await seedField(ce, ce.docs.create(), createDeskBlobStore());
  ce.world.setResource(Viewport, { w: VIEW.width, h: VIEW.height, dpr: 1 });
  ensureTray(ce.world);
  door = trayDoor(ce);
  // the pose seam: the desk's word on the drawer as drawn — core's tray lay hangs the specimens across it
  ce.stack.trayPose.current = { frame: () => door.state().frame };
  step();
  step();
  const desk: MountedDesk = {
    engine: ce,
    handle: { tray: door } as unknown as MountedDesk["handle"],
    generation: 1,
    mount,
    theme: "light",
    off,
  };
  unpublish = publishDesk(desk);
}

beforeEach(async () => {
  resetBoardStatsForTest();
  resetBoardRevealForTest();
  mores = [];
  keymapHeard = [];
  clock = 0;
  p = 1;
  window.addEventListener("keydown", keymap);
  await mountDesk();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  drawerWidth = DRAWER_OUT.w;
  act(() => root.unmount());
  host.remove();
  unpublish();
  window.removeEventListener("keydown", keymap);
  ce.dispose();
  vi.restoreAllMocks();
});

const openBoard = (): void => {
  act(() => {
    door.toggle();
  });
  door.publish({ p: 1 });
};

describe("one surface at a time (§10)", () => {
  it("folds the frame's open surface into Objects when the board is out, and shuts the board when another opens", () => {
    openBoard();
    expect(surfaceNow).toBe("objects");
    act(() => setSurfaceNow("palette"));
    expect(trayOpen(ce.world)).toBe(false);
    expect(surfaceNow).toBe("palette");
  });

  it("folds Objects when the desk shuts the board itself (its Esc, a click on the dimmed desk, a take handed out)", () => {
    openBoard();
    act(() => closeTray(ce.world));
    door.publish();
    expect(surfaceNow).toBeNull();
  });

  it("opens the board when Objects is asked of the owner — and folds the ask when the desk refuses it (R14)", () => {
    act(() => setSurfaceNow("objects"));
    expect(trayOpen(ce.world)).toBe(true);
    act(() => setSurfaceNow(null));
    expect(trayOpen(ce.world)).toBe(false);
    door.refuse = true;
    act(() => setSurfaceNow("objects"));
    expect(trayOpen(ce.world)).toBe(false);
    expect(surfaceNow).toBeNull();
  });

  it("is inert while shut: nothing of it reachable", () => {
    expect(q(".vf-pegboard").hasAttribute("inert")).toBe(true);
    openBoard();
    expect(q(".vf-pegboard").hasAttribute("inert")).toBe(false);
    expect(q(".vf-pegboard").getAttribute("data-open")).toBe("true");
  });
});

describe("the filters (R19, P3c)", () => {
  it("are All, then the board's categories in the lay's order by their labels — no counts", () => {
    openBoard();
    const categories = trayCategories(ce.world);
    expect(categories.length).toBeGreaterThan(1);
    expect(filters()).toEqual(["All", ...categories.map((c) => c.label)]);
    expect(filters().some((label) => /\d/u.test(label))).toBe(false);
    expect(q('.vf-pegboard-track > button[aria-pressed="true"]').textContent).toBe("All");
  });

  it("choose the board's category by a click, the thumb's choice following the tray's", () => {
    openBoard();
    const second = trayCategories(ce.world)[1];
    if (second === undefined) throw new Error("one category");
    act(() => q<HTMLButtonElement>(`.vf-pegboard-track > button[data-id="${second.id}"]`).click());
    expect(trayCategory(ce.world)).toBe(second.id);
    door.publish();
    expect(q('.vf-pegboard-track > button[aria-pressed="true"]').textContent).toBe(second.label);
  });

  it("offer no category whose every kind's plugin is off (P3c), and the board shows All when its category goes", async () => {
    // the portals category is the browser pane's plugin's alone
    act(() => root.unmount());
    unpublish();
    ce.dispose();
    await mountDesk(new Set(["vibefield.browser-pane"]));
    root = createRoot(host);
    act(() => root.render(createElement(Harness)));
    const pane = trayCategories(ce.world).find((c) => c.id === "portals");
    expect(pane).toBeDefined();
    act(() => {
      setTrayCategory(ce.world, "portals");
      openTray(ce.world);
    });
    door.publish();
    expect(filters()).not.toContain("Portals");
    expect(filters()[0]).toBe("All");
    expect(trayCategory(ce.world)).toBe("");
  });

  it("stand in the header band, following the drawer every frame of its slide — placed, never rendered, per frame", () => {
    openBoard();
    const renders = readBoardStats().renders;
    for (const slide of [0.62, 0.7, 0.8, 0.9, 1]) {
      door.publish({ p: slide });
      const place = placeFilters(door.anchor().drawer);
      const el = q(".vf-pegboard-filters");
      expect(el.style.transform).toBe(`translate(${place?.cx}px, ${place?.y}px) translateX(-50%)`);
      expect(el.style.maxWidth).toBe(`${place?.maxWidth}px`);
      expect(Number(el.style.opacity)).toBeCloseTo(place?.opacity ?? -1, 6);
    }
    expect(readBoardStats().renders).toBe(renders);
    const stats = readBoardStats();
    expect(stats.placements).toBeLessThanOrEqual(2 * stats.publishes);
  });
});

describe("inserting by keyboard (R14) — on ICE's own doors (I37)", () => {
  const raise = (): void => {
    act(() => {
      requestBoardFocus();
      door.toggle();
    });
    door.publish({ p: 1 });
    // the focus the board took moved ICE's: that move is a frame, and the ring is placed from what it drew
    door.publish();
  };
  /** The ring 2 out from where the last frame drew ICE's focused object (`anchor().focused.rect`). */
  const ringOnFocus = () => {
    const rect = door.anchor().focused?.rect;
    if (rect === null || rect === undefined) return null;
    return { x0: rect.x0 - 2, y0: rect.y0 - 2, x1: rect.x1 + 2, y1: rect.y1 + 2 };
  };
  // the ring where ICE's anchor puts it, to the CSSOM's own grain: a width or a height reads back at six decimals
  // ("213.44498px" for 213.444979…), so a hang whose size is no round number never round-trips exactly
  const expectRingOnFocus = () => {
    const ring = ringRect();
    const want = ringOnFocus();
    expect(ring === null).toBe(want === null);
    for (const k of ["x0", "y0", "x1", "y1"] as const)
      expect(ring?.[k]).toBeCloseTo(want?.[k] ?? 0, 5);
  };

  it("takes the focus when the keyboard raised the board, the first specimen ringed where the board draws it", () => {
    raise();
    expect(document.activeElement).toBe(board());
    const specimens = [...board().querySelectorAll('[role="option"]')].map((o) =>
      o.getAttribute("data-type"),
    );
    expect(specimens.length).toBeGreaterThan(2);
    // ICE's focus — the board's first — and the listbox says it
    expect(trayFocus(ce.world)).toBe(specimens[0]);
    expect(focusedType()).toBe(specimens[0]);
    // ringed 2 out from where the board draws its object (the focus ring's offset)
    const at = drawnNow().find((d) => d.type === specimens[0]);
    expect(ringRect()).toEqual({
      x0: (at?.rect.x0 ?? 0) - 2,
      y0: (at?.rect.y0 ?? 0) - 2,
      x1: (at?.rect.x1 ?? 0) + 2,
      y1: (at?.rect.y1 ?? 0) + 2,
    });
    expectRingOnFocus();
  });

  it("rings ICE's first when the board holds the keyboard with no focus event — B in a window that is not the key window (DK-13's path)", async () => {
    // not the key window: the focus moves to the board, its event waits (here it never reaches React)
    const hold = (event: Event): void => event.stopImmediatePropagation();
    window.addEventListener("focus", hold, true);
    window.addEventListener("focusin", hold, true);
    try {
      raise();
    } finally {
      window.removeEventListener("focus", hold, true);
      window.removeEventListener("focusin", hold, true);
    }
    expect(document.activeElement).toBe(board());
    // the publish that found the board holding the keyboard took this open's first stop: ICE's first, asked a
    // microtask after it; the frame that focus asked for rings it
    await Promise.resolve();
    door.publish();
    const first = [...board().querySelectorAll('[role="option"]')][0]?.getAttribute("data-type");
    expect(trayFocus(ce.world)).toBe(first);
    expect(focusedType()).toBe(first);
    expect(ringRect()).not.toBeNull();
    expectRingOnFocus();
  });

  it("asks ICE for the first again when B raised the board before its first lay — a microtask after the publish, never inside it", async () => {
    // ICE's focus finds nothing hung yet as the drawer starts to rise: its `focus` answers "" and writes no specimen
    const real = door.focus.bind(door);
    let laid = false;
    const asks = vi.spyOn(door, "focus").mockImplementation((to) => (laid ? real(to) : ""));
    raise();
    expect(document.activeElement).toBe(board());
    expect(trayFocus(ce.world)).toBe("");
    expect(focusedType()).toBeNull();
    // the first lay lands: its publish asks for the first — but not inside the publish (the desk's frame)
    laid = true;
    asks.mockClear();
    door.publish();
    expect(asks).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(asks).toHaveBeenCalledWith("first");
    // the frame that focus asked for: ICE's anchor says the first, and the listbox and the ring follow it
    door.publish();
    const first = [...board().querySelectorAll('[role="option"]')][0]?.getAttribute("data-type");
    expect(trayFocus(ce.world)).toBe(first);
    expect(focusedType()).toBe(first);
    expectRingOnFocus();
    // ICE holding a focus, a publish asks nothing more
    asks.mockClear();
    door.publish();
    await Promise.resolve();
    expect(asks).not.toHaveBeenCalled();
  });

  it("moves to the row below with ↓ — focused by its id, ICE scrolling the board to show it, the ring following its anchor", () => {
    // the first launch's lineup hangs one row at the real width: a narrow drawer gives it a row below
    drawerWidth = 260;
    raise();
    const rows = new Set(drawnNow().map((d) => d.row));
    expect(rows.size).toBeGreaterThan(1);
    const from = drawnNow().find((d) => d.type === focusedType());
    const scrolls = vi.spyOn(door, "scroll");
    key("ArrowDown");
    // the focus moved at once (ICE's fact); the scroll that shows it is the lay's, in the frame the move asks for
    expect(focusedType()).toBe(trayFocus(ce.world));
    door.publish();
    const to = drawnNow().find((d) => d.type === focusedType());
    expect(to?.row).toBeGreaterThan(from?.row ?? Number.POSITIVE_INFINITY);
    expect(door.scroll()).toBeGreaterThan(0);
    // VibeField scrolled nothing itself (DK-13's own scroll into view retired): every call a read
    expect(scrolls.mock.calls.every((c) => c[0] === undefined)).toBe(true);
    expectRingOnFocus();
    expect(ringRect()?.y0).toBeCloseTo((to?.rect.y0 ?? 0) - 2, 6);
  });

  it("moves between the specimens with the arrows, claiming them from the desk's keymap", () => {
    raise();
    const options = [...board().querySelectorAll('[role="option"]')].map((o) =>
      o.getAttribute("data-type"),
    );
    const right = key("ArrowRight");
    expect(right.defaultPrevented).toBe(true);
    // ICE's walk in the lay's order is the listbox's reading order
    expect(trayFocus(ce.world)).toBe(options[1]);
    expect(focusedType()).toBe(options[1]);
    key("ArrowLeft");
    expect(focusedType()).toBe(options[0]);
    // never wrapping: ← at the first stays there
    key("ArrowLeft");
    expect(focusedType()).toBe(options[0]);
    expect(keymapHeard).toEqual([]);
  });

  it("lays the focused one at the view's centre with ⏎ — the tray's own take: selected, ONE undo step — and ICE folds the board", () => {
    raise();
    key("ArrowRight");
    const type = focusedType();
    if (type === null) throw new Error("nothing focused");
    const before = deskCensus(ce)[type] ?? 0;
    const had = new Set(deskObjects(ce, type).map((o) => o.entity));
    const lays = vi.spyOn(door, "lay");
    const closes = vi.spyOn(door, "close");
    const enter = key("Enter");
    expect(enter.defaultPrevented).toBe(true);
    // ICE's door, asked with nothing: the focused specimen at the view's centre
    expect(lays).toHaveBeenCalledWith();
    // the board folded by the lay itself (core's `closeTray`), never by VibeField's close
    expect(trayOpen(ce.world)).toBe(false);
    expect(closes).not.toHaveBeenCalled();
    act(() => step());
    expect(deskCensus(ce)[type]).toBe(before + 1);
    expect(readBoardStats().inserts).toBe(1);
    door.publish();
    expect(surfaceNow).toBeNull();
    // the new one, selected, its centre on the view's centre, at its own size
    const made = deskObjects(ce, type).find((o) => !had.has(o.entity))?.entity as Entity;
    expect(selectedEntities(ce.world)).toEqual([made]);
    const camera = ce.world.getResource(Camera);
    if (camera === undefined) throw new Error("no camera");
    const centre = screenToWorld(VIEW.width / 2, VIEW.height / 2, camera);
    const at = ce.world.get(made, Position) as { x: number; y: number };
    const size = ce.world.get(made, Size) as { w: number; h: number };
    // the component's floats: a size like the pane's 698.16, and its centre, read back at float32's grain
    const natural = ce.catalog.widget(type)?.defaultSize;
    expect(size.w).toBeCloseTo(natural?.w ?? Number.NaN, 3);
    expect(size.h).toBeCloseTo(natural?.h ?? Number.NaN, 3);
    expect(at.x + size.w / 2).toBeCloseTo(centre.x, 3);
    expect(at.y + size.h / 2).toBeCloseTo(centre.y, 3);
    act(() => {
      ce.docs.undo();
      step();
    });
    expect(deskCensus(ce)[type] ?? 0).toBe(before);
  });

  it("lays nothing and keeps the board out when ICE refuses the lay (nothing focused it hangs)", () => {
    raise();
    vi.spyOn(door, "lay").mockReturnValue(undefined);
    const before = JSON.stringify(deskCensus(ce));
    key("Enter");
    act(() => step());
    expect(JSON.stringify(deskCensus(ce))).toBe(before);
    expect(readBoardStats().inserts).toBe(0);
    expect(trayOpen(ce.world)).toBe(true);
    expect(surfaceNow).toBe("objects");
  });

  it("closes the board on Esc before the desk's keymap hears it — but not from a field being typed in", () => {
    raise();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    key("Escape", input);
    expect(trayOpen(ce.world)).toBe(true);
    input.remove();
    const esc = key("Escape", document.body);
    expect(esc.defaultPrevented).toBe(true);
    expect(trayOpen(ce.world)).toBe(false);
    expect(keymapHeard).toEqual(["Escape"]);
  });

  it("lets the pointer take the ring away, and gives the focus back where it was when the board folds", () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    raise();
    expect(q(".vf-pegboard-ring").dataset.shown).toBe("true");
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(q(".vf-pegboard-ring").dataset.shown).toBeUndefined();
    key("Escape", board());
    door.publish();
    expect(document.activeElement).toBe(before);
    before.remove();
  });
});

describe("the line's door to the board (board-door.ts)", () => {
  it("says the board's facts — out, in hand — and toggles it, asking for the focus only from the keyboard", () => {
    let line: ReturnType<typeof useBoardLineDoor> = null;
    let facts: ReturnType<typeof useBoardFacts> = null;
    function Probe(): null {
      line = useBoardLineDoor();
      facts = useBoardFacts();
      return null;
    }
    const probe = document.createElement("div");
    const probeRoot = createRoot(probe);
    act(() => probeRoot.render(createElement(Probe)));
    expect(facts).toEqual({ open: false, held: false });
    takeBoardFocusRequest();
    act(() => {
      expect(line?.toggle(false)).toBe(true);
    });
    expect(takeBoardFocusRequest()).toBe(false);
    door.publish();
    expect(facts).toEqual({ open: true, held: false });
    act(() => {
      line?.toggle(false);
    });
    door.publish();
    act(() => {
      expect(line?.toggle(true)).toBe(true);
    });
    expect(takeBoardFocusRequest()).toBe(true);
    act(() => {
      line?.toggle(false);
    });
    // refused (in hand): the ask for the focus is dropped with it
    door.refuse = true;
    act(() => {
      expect(line?.toggle(true)).toBe(false);
    });
    expect(takeBoardFocusRequest()).toBe(false);
    act(() => probeRoot.unmount());
  });

  it("says an object in hand", () => {
    let facts: ReturnType<typeof useBoardFacts> = null;
    const anchor = door.anchor.bind(door);
    door.anchor = () => ({ ...anchor(), held: true });
    function Probe(): null {
      facts = useBoardFacts();
      return null;
    }
    const probe = document.createElement("div");
    const probeRoot = createRoot(probe);
    act(() => probeRoot.render(createElement(Probe)));
    expect(facts).toEqual({ open: false, held: true });
    act(() => probeRoot.unmount());
  });
});

describe("past the band's width (R19)", () => {
  it("says where more lies beyond: the end, both, the start — or nothing when it fits", () => {
    expect(moreOf({ scrollLeft: 0, clientWidth: 200, scrollWidth: 400 })).toBe("end");
    expect(moreOf({ scrollLeft: 80, clientWidth: 200, scrollWidth: 400 })).toBe("both");
    expect(moreOf({ scrollLeft: 200, clientWidth: 200, scrollWidth: 400 })).toBe("start");
    expect(moreOf({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 })).toBeNull();
  });

  it("marks the track as it scrolls, so the end where more lies fades", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(400);
    const box = document.createElement("div");
    const boxRoot = createRoot(box);
    act(() =>
      boxRoot.render(
        createElement(PegboardView, {
          open: true,
          options: [
            { id: "", label: "All" },
            { id: "paper", label: "Paper" },
          ],
          category: "",
          onCategory: () => undefined,
          specimens: [],
          focused: null,
        }),
      ),
    );
    const track = box.querySelector<HTMLElement>(".vf-pegboard-track");
    if (track === null) throw new Error("no track");
    expect(track.dataset.more).toBe("end");
    act(() => {
      track.scrollLeft = 200;
      track.dispatchEvent(new Event("scroll"));
    });
    expect(track.dataset.more).toBe("start");
    act(() => boxRoot.unmount());
  });
});

/** More in Plugins… as the controller placed it: its centre's x, its top and its opacity. */
function pillAt(): { cx: number; y: number; opacity: number } | null {
  const place = q(".vf-pegboard-more-place");
  const m = /^translate\(([-\d.e]+)px, ([-\d.e]+)px\) translateX\(-50%\)$/u.exec(
    place.style.transform,
  );
  if (m === null) return null;
  return { cx: Number(m[1]), y: Number(m[2]), opacity: Number(place.style.opacity) };
}

describe("More in Plugins… (MK-4d; MK-D1)", () => {
  const pill = (): HTMLButtonElement => q<HTMLButtonElement>(".vf-pegboard-more");

  it("says More in Plugins… wearing `plugin` at 15 — the third stop of Tab, after the filters and the board", () => {
    openBoard();
    expect(pill().textContent).toBe("More in Plugins…");
    const glyph = pill().querySelector("svg");
    expect(glyph?.getAttribute("data-glyph")).toBe("plugin");
    expect(glyph?.getAttribute("width")).toBe("15");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    // the document's order is Tab's: the filters' track, the board, then the pill
    const before = (a: Node, b: Node): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(before(q(".vf-pegboard-track"), board())).toBe(true);
    expect(before(board(), pill())).toBe(true);
    expect(q(".vf-pegboard-more-place").hasAttribute("inert")).toBe(false);
  });

  it("stands its foot 100 above the view's foot on the drawer's centre line, riding its slide — placed, never rendered, per frame", () => {
    openBoard();
    const renders = readBoardStats().renders;
    const rest = VIEW.height - PEGBOARD.pill.foot - PEGBOARD.pill.height;
    for (const slide of [0.62, 0.7, 0.8, 0.9, 1]) {
      door.publish({ p: slide });
      const at = pillAt();
      const drawer = door.anchor().drawer;
      expect(at?.cx).toBe(DRAWER_OUT.x + DRAWER_OUT.w / 2);
      // this drawer slides its whole height (its top VIEW.height − h·p), so the frames say a travel of h
      expect(at?.y).toBeCloseTo(rest + DRAWER_OUT.h * (1 - slide), 6);
      // the pill and the drawer's top move together, and it fades in with the filters
      expect((at?.y ?? 0) - (drawer?.y ?? 0)).toBeCloseTo(rest - (VIEW.height - DRAWER_OUT.h), 6);
      expect(at?.opacity).toBeCloseTo(Number(q(".vf-pegboard-filters").style.opacity), 6);
    }
    // out: 1180 × 748's 616…648, its foot 100 above the view's
    expect(pillAt()?.y).toBeCloseTo(616, 6);
    expect(readBoardStats().renders).toBe(renders);
    const stats = readBoardStats();
    expect(stats.placements).toBeLessThanOrEqual(2 * stats.publishes);
  });

  it("steps aside while an object is in hand and while the board hangs nothing — taking no press and no stop", () => {
    openBoard();
    expect(pill().hasAttribute("data-aside")).toBe(false);
    const anchor = door.anchor.bind(door);
    door.anchor = () => ({ ...anchor(), held: true });
    door.publish();
    expect(pill().getAttribute("data-aside")).toBe("true");
    expect(q(".vf-pegboard-more-place").hasAttribute("inert")).toBe(true);
    door.anchor = () => ({ ...anchor(), entries: 0 });
    door.publish();
    expect(pill().getAttribute("data-aside")).toBe("true");
    door.anchor = anchor;
    door.publish();
    expect(pill().hasAttribute("data-aside")).toBe(false);
    expect(q(".vf-pegboard-more-place").hasAttribute("inert")).toBe(false);
  });

  it("hands the frame the board's category — All as the empty id — and the board folds as the popup opens", () => {
    openBoard();
    act(() => pill().click());
    expect(mores).toEqual([""]);
    expect(surfaceNow).toBe("plugins");
    expect(trayOpen(ce.world)).toBe(false);
    // a category chosen: Discover's categories are the pegboard's own (MK-D2)
    openBoard();
    const second = trayCategories(ce.world)[1];
    if (second === undefined) throw new Error("one category");
    act(() => q<HTMLButtonElement>(`.vf-pegboard-track > button[data-id="${second.id}"]`).click());
    door.publish();
    act(() => pill().click());
    expect(mores).toEqual(["", second.id]);
  });
});

describe("a set shown after an install (MK-4d; MK-D8's fallback B, MK-E14)", () => {
  /** A type hanging under the board's first category and one under its last, in the board's order. */
  const ends = () => {
    const categories = trayCategories(ce.world);
    const under = (id: string): string => {
      const type = hungTypes(ce.world).find((h) => h.tray?.category === id)?.type;
      if (type === undefined) throw new Error(`nothing hangs under ${id}`);
      return type;
    };
    const first = categories[0];
    const last = categories[categories.length - 1];
    if (first === undefined || last === undefined || first.id === last.id)
      throw new Error("one category");
    return {
      first: { category: first.id, type: under(first.id) },
      last: { category: last.id, type: under(last.id) },
    };
  };
  /** The frames and microtasks a showing takes to land: the board out, its category laid, its object focused. */
  const land = async (): Promise<void> => {
    door.publish({ p: 1 });
    await Promise.resolve();
    door.publish();
    await Promise.resolve();
    door.publish();
  };

  it("raises the board over the popup on the set's first category in the board's order, its first object there focused, the board holding the keyboard", async () => {
    const { first, last } = ends();
    act(() => setSurfaceNow("plugins"));
    // the set's own order names the last category's object first: the board's order chooses the category
    act(() => showOnBoard([last.type, first.type]));
    expect(surfaceNow).toBe("objects");
    expect(trayOpen(ce.world)).toBe(true);
    await land();
    expect(trayCategory(ce.world)).toBe(first.category);
    expect(trayFocus(ce.world)).toBe(first.type);
    expect(document.activeElement).toBe(board());
    expect(focusedType()).toBe(first.type);
    expect(ringRect()).not.toBeNull();
    expect(boardReveal()).toBeNull();
    // ⏎ lays it, as the board's own keys do
    const before = deskCensus(ce)[first.type] ?? 0;
    key("Enter");
    act(() => step());
    expect(deskCensus(ce)[first.type]).toBe(before + 1);
  });

  it("goes to Canvas first over a covered view (MK-E14), and raises the board once the frame is there", async () => {
    const asked: string[] = [];
    setHost({
      view: {
        set: (view: string) => {
          asked.push(view);
          return Promise.resolve({ view });
        },
        onState: () => () => undefined,
      },
    } as unknown as FieldHost);
    const { last } = ends();
    act(() => {
      setCoveredNow(true);
      setSurfaceNow("plugins");
    });
    act(() => showOnBoard([last.type]));
    expect(asked).toEqual(["canvas"]);
    expect(trayOpen(ce.world)).toBe(false);
    expect(surfaceNow).toBe("plugins");
    // the frame is on Canvas: the board rises there, on the set
    act(() => setCoveredNow(false));
    expect(surfaceNow).toBe("objects");
    await land();
    expect(trayCategory(ce.world)).toBe(last.category);
    expect(trayFocus(ce.world)).toBe(last.type);
    expect(asked).toEqual(["canvas"]);
  });

  it("raises nothing on a later visit to Canvas once the popup folded over a cover that never moved", () => {
    setHost({
      view: { set: () => Promise.resolve(), onState: () => () => undefined },
    } as unknown as FieldHost);
    const { last } = ends();
    act(() => {
      setCoveredNow(true);
      setSurfaceNow("plugins");
    });
    act(() => showOnBoard([last.type]));
    act(() => setSurfaceNow(null));
    expect(boardReveal()).toBeNull();
    act(() => setCoveredNow(false));
    expect(trayOpen(ce.world)).toBe(false);
    expect(surfaceNow).toBeNull();
  });

  /** A host whose view door records each view asked of it: Canvas is the only one a showing may ask. */
  const recordingHost = (): string[] => {
    const asked: string[] = [];
    setHost({
      view: {
        set: (view: string) => {
          asked.push(view);
          return Promise.resolve({ view });
        },
        onState: () => () => undefined,
      },
    } as unknown as FieldHost);
    return asked;
  };

  it("goes, asking for no Canvas, when a view covers the desk while the board rises — before its first frame", async () => {
    const asked = recordingHost();
    const { last } = ends();
    const before = trayCategory(ce.world);
    expect(before).not.toBe(last.category);
    act(() => setSurfaceNow("plugins"));
    act(() => showOnBoard([last.type]));
    expect(surfaceNow).toBe("objects");
    // ⌘2 before the desk drew a frame of the rise: the person's own move, never taken back to Canvas
    act(() => setCoveredNow(true));
    expect(asked).toEqual([]);
    expect(boardReveal()).toBeNull();
    // the lay it had asked for finds no showing: the set's category is never laid
    await land();
    expect(trayCategory(ce.world)).toBe(before);
    expect(asked).toEqual([]);
  });

  it("goes, asking for no Canvas, when a view covers the desk while the board waits for an install's remount", async () => {
    const asked = recordingHost();
    const pane = "vibefield.browser-pane";
    act(() => root.unmount());
    unpublish();
    ce.dispose();
    await mountDesk(new Set([pane]));
    root = createRoot(host);
    act(() => root.render(createElement(Harness)));
    act(() => setSurfaceNow("plugins"));
    act(() => showOnBoard([pane]));
    await land();
    // out, and waiting: the desk draws no pane yet
    expect(trayOpen(ce.world)).toBe(true);
    expect(boardReveal()).not.toBeNull();
    // ⌘3: the person went to another view
    act(() => setCoveredNow(true));
    expect(asked).toEqual([]);
    expect(boardReveal()).toBeNull();
    // the install's remount then raises nothing, and asks for nothing
    const old = ce;
    await act(async () => {
      await mountDesk(new Set(), 1);
    });
    old.dispose();
    expect(trayOpen(ce.world)).toBe(false);
    expect(asked).toEqual([]);
  });

  it("is dropped when the board folds before it lands, and asks nothing while an object is in hand (R14)", () => {
    const { last } = ends();
    act(() => setSurfaceNow("plugins"));
    act(() => showOnBoard([last.type]));
    door.publish({ p: 1 });
    key("Escape", document.body);
    door.publish();
    expect(boardReveal()).toBeNull();
    expect(surfaceNow).toBeNull();
    // in hand the desk refuses the board: nothing rises, and nothing waits to
    const anchor = door.anchor.bind(door);
    door.anchor = () => ({ ...anchor(), held: true });
    door.refuse = true;
    act(() => setSurfaceNow("plugins"));
    act(() => showOnBoard([last.type]));
    expect(boardReveal()).toBeNull();
    expect(trayOpen(ce.world)).toBe(false);
    expect(surfaceNow).toBe("plugins");
  });

  it("goes when the person chooses on the board before it lands — a filter, or a key", async () => {
    const { first, last } = ends();
    act(() => setSurfaceNow("plugins"));
    act(() => showOnBoard([last.type]));
    door.publish({ p: 1 });
    const filter = q<HTMLButtonElement>(`.vf-pegboard-track > button[data-id="${first.category}"]`);
    act(() => filter.click());
    expect(boardReveal()).toBeNull();
    // the lay it had asked for finds no showing: the person's category stands
    await Promise.resolve();
    door.publish();
    expect(trayCategory(ce.world)).toBe(first.category);
    // a key on the board, the same
    act(() => showOnBoard([last.type]));
    act(() => board().focus());
    key("ArrowRight");
    expect(boardReveal()).toBeNull();
  });

  it("waits while the desk draws none of the set, and raises the board again on the desk an install's remount brings", async () => {
    const pane = "vibefield.browser-pane";
    act(() => root.unmount());
    unpublish();
    ce.dispose();
    await mountDesk(new Set([pane]));
    root = createRoot(host);
    act(() => root.render(createElement(Harness)));
    act(() => setSurfaceNow("plugins"));
    act(() => showOnBoard([pane]));
    // raised at once, the popup folding as it rises; the desk draws no pane, so nothing is laid or focused for it
    expect(surfaceNow).toBe("objects");
    await land();
    expect(trayFocus(ce.world)).toBe("");
    expect(boardReveal()).not.toBeNull();
    // the install's remount: a new desk that draws the pane. The board on it is shut, so Objects folds, and the
    // showing raises the board again there
    const old = ce;
    await act(async () => {
      await mountDesk(new Set(), 1);
    });
    old.dispose();
    expect(surfaceNow).toBe("objects");
    expect(trayOpen(ce.world)).toBe(true);
    await land();
    const category = hungTypes(ce.world).find((h) => h.type === pane)?.tray?.category;
    expect(category).toBeDefined();
    expect(trayCategory(ce.world)).toBe(category);
    expect(trayFocus(ce.world)).toBe(pane);
    expect(boardReveal()).toBeNull();
  });
});

describe("the board's names, for the popup (MK-4d's names; James's MK-O10 pick A)", () => {
  it("names each category the board hangs by the board's own name, in its order, and renders only when they change", async () => {
    const seen: (ReadonlyMap<string, string> | null)[] = [];
    function Names(): null {
      seen.push(useBoardNames());
      return null;
    }
    const said = (): [string, string][] => [...(seen.at(-1) ?? [])];
    const probe = createRoot(document.createElement("div"));
    act(() => probe.render(createElement(Names)));
    try {
      const categories = trayCategories(ce.world);
      expect(categories.length).toBeGreaterThan(1);
      expect(said()).toEqual(categories.map((c) => [c.id, c.label]));
      // the board out, its slide frame by frame, another category chosen: the same names, no render
      const renders = seen.length;
      openBoard();
      door.publish({ p: 0.5 });
      door.publish({ p: 1 });
      const second = categories[1];
      if (second === undefined) throw new Error("one category");
      act(() => setTrayCategory(ce.world, second.id));
      door.publish();
      expect(seen.length).toBe(renders);
      // the desk gone: no names; the next desk mounted: its board's
      act(() => unpublish());
      expect(seen.at(-1)).toBeNull();
      const old = ce;
      await act(async () => {
        await mountDesk(new Set(), 1);
      });
      old.dispose();
      expect(said()).toEqual(trayCategories(ce.world).map((c) => [c.id, c.label]));
    } finally {
      act(() => probe.unmount());
    }
  });
});
