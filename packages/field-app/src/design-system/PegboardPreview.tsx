import { type ReactElement, useState } from "react";
import { PegboardView } from "../field/desk/pegboard/PegboardView";
import {
  type DrawnDrawer,
  type FiltersPlace,
  filterOptions,
  placeFilters,
  type ScreenRect,
} from "../field/desk/pegboard/pegboard-model";

// THE PEGBOARD'S CHROME IN THE CATALOG (DK-13; DESIGN.md §8 "The pegboard — Objects, behind the line"; UI_SYSTEM's
// catalog fidelity): the shipping view (`PegboardView`) over a fixture TRAY — the drawer where the desk would draw it,
// its clear header band, the categories the lay would offer — placed by the product's own model (`placeFilters`,
// `filterOptions`). The board itself is the desk's, drawn on the GPU behind the line; here a plain stand-in shows where
// it lies, as the selection bar's plates stand an object in for the desk's (DK-11).

/** The categories the first board's lay offers: VibeField's comment pad, ICE's six built-ins, the example clock. */
const CATEGORIES = [
  { id: "comments", label: "Comments", count: 1 },
  { id: "paper", label: "Paper", count: 4 },
  { id: "surfaces", label: "Surfaces", count: 2 },
  { id: "things", label: "Things", count: 1 },
] as const;

export const PEGBOARD_STATES = [
  "Out — All",
  "A category chosen — Surfaces",
  "Past the band's width — the far end fading",
  "Rising — 80 % of the slide",
  "A specimen in the keyboard's focus",
] as const;
export type PegboardState = (typeof PEGBOARD_STATES)[number];

const PLATE = { width: 560, height: 300 } as const;

interface BoardFixture {
  readonly drawer: DrawnDrawer & { readonly h: number };
  readonly category: string;
  /** stand-in specimens on the board (screen rects in the plate) */
  readonly specimens: readonly (ScreenRect & { readonly type: string; readonly label: string })[];
  readonly focused: string | null;
}

/** The drawer out at slide `p`: 520 wide, 220 tall in the plate, its bottom flush with the plate's foot when out. */
const drawerAt = (p: number, w = 520): BoardFixture["drawer"] => {
  const h = 220;
  const y = PLATE.height - h * p;
  return { x: (PLATE.width - w) / 2, y, w, h, p, header: { y: y + 1.5, h: 48 } };
};

const SPECIMENS = (drawer: BoardFixture["drawer"]): BoardFixture["specimens"] => {
  const top = drawer.header.y + drawer.header.h + 34;
  return [
    {
      type: "vibefield.comment-pad",
      label: "Comment pad",
      x0: drawer.x + 34,
      y0: top,
      x1: drawer.x + 104,
      y1: top + 90,
    },
    {
      type: "desk.note",
      label: "Note",
      x0: drawer.x + 134,
      y0: top,
      x1: drawer.x + 214,
      y1: top + 80,
    },
    {
      type: "desk.photo",
      label: "Print",
      x0: drawer.x + 244,
      y0: top + 6,
      x1: drawer.x + 354,
      y1: top + 82,
    },
    {
      type: "desk.notebook",
      label: "Notebook",
      x0: drawer.x + 384,
      y0: top,
      x1: drawer.x + 474,
      y1: top + 110,
    },
  ];
};

const FIXTURES: Record<PegboardState, () => BoardFixture> = {
  "Out — All": () => {
    const drawer = drawerAt(1);
    return { drawer, category: "", specimens: SPECIMENS(drawer), focused: null };
  },
  "A category chosen — Surfaces": () => {
    const drawer = drawerAt(1);
    return { drawer, category: "surfaces", specimens: [], focused: null };
  },
  "Past the band's width — the far end fading": () => {
    const drawer = drawerAt(1, 280);
    return { drawer, category: "", specimens: [], focused: null };
  },
  "Rising — 80 % of the slide": () => {
    const drawer = drawerAt(0.8);
    return { drawer, category: "", specimens: SPECIMENS(drawer), focused: null };
  },
  "A specimen in the keyboard's focus": () => {
    const drawer = drawerAt(1);
    return { drawer, category: "", specimens: SPECIMENS(drawer), focused: "desk.note" };
  },
};

/** The board's stand-in and the shipping chrome over it, placed from a fixture drawer. */
export function BoardStandIn({
  drawer,
  category,
  onCategory,
  specimens = [],
  focused = null,
}: {
  drawer: DrawnDrawer & { readonly h: number };
  category: string;
  onCategory: (id: string) => void;
  specimens?: BoardFixture["specimens"];
  focused?: string | null;
}): ReactElement {
  const place: FiltersPlace | null = placeFilters(drawer);
  const ring = specimens.find((s) => s.type === focused) ?? null;
  return (
    <>
      <div
        className="vf-ds-board-standin"
        style={{ left: drawer.x, top: drawer.y, width: drawer.w, height: drawer.h }}
        aria-hidden
      />
      {specimens.map((s) => (
        <div
          key={s.type}
          className="vf-ds-board-specimen"
          style={{ left: s.x0, top: s.y0, width: s.x1 - s.x0, height: s.y1 - s.y0 }}
          aria-hidden
        />
      ))}
      <PegboardView
        open
        options={filterOptions(CATEGORIES)}
        category={category}
        onCategory={onCategory}
        place={place}
        specimens={specimens.map((s) => ({ type: s.type, label: s.label }))}
        focused={focused}
        ring={ring}
      />
    </>
  );
}

/** One plate: the pegboard's chrome over a fixture tray. */
export function PegboardPlate({ state }: { state: PegboardState }): ReactElement {
  const fixture = FIXTURES[state]();
  const [category, setCategory] = useState(fixture.category);
  return (
    <div
      className="vf-ds-board-plate"
      data-state={state}
      style={{ width: PLATE.width, height: PLATE.height }}
    >
      <BoardStandIn
        drawer={fixture.drawer}
        category={category}
        onCategory={setCategory}
        specimens={fixture.specimens}
        focused={fixture.focused}
      />
      <span className="vf-ds-board-caption">{state}</span>
    </div>
  );
}
