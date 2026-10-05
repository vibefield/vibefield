import { type ReactElement, useMemo, useState } from "react";
import {
  barCells,
  menuEyebrow,
  menuGroups,
  type SelectionFacts,
} from "../field/desk/bar/bar-model";
import { type PlaceAnchor, SelectionBarView } from "../field/desk/bar/SelectionBarView";
import type { ObjectWords } from "../field/desk/desk-object-words";

// The selection bar's fixture ADAPTER (DK-11; docs/UI_SYSTEM.md): the shipping bar — `SelectionBarView` — over
// fixture selections, its cells and its grown menu's rows read by the PRODUCT's own model (`barCells`,
// `menuGroups`, `menuEyebrow`), one plate per state the canon draws: one object with its kind's own act, two
// ("Send 2 to…"), taped ("Lift the tape"), a missing face ("Clock · plugin off"), a glyph-less act and a name the set
// lacks, and the bar grown — up under NOTE, down near the top, two with Clean up. What it replaces is only what a host
// supplies: the desk's anchor (a box on the plate where the brackets would be) and the selection's facts. The
// brackets themselves are the desk's GPU marks; the plate draws a stand-in outline so the bar has something to stand
// over.

/** The clock's own act glyph (examples/plugins/desk-clock `SECONDS_GLYPH`): data, as a kind declares it. */
const STOPWATCH = "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 13l3-3M10 2h4M12 2v3";

const NOTE: ObjectWords = { type: "desk.note", title: "Note", state: null, label: "Note" };
const PAD: ObjectWords = {
  type: "vibefield.comment-pad",
  title: "Comment pad",
  state: null,
  label: "Comment pad",
};
const CLOCK: ObjectWords = {
  type: "vibefield.example.desk-clock",
  title: "Clock",
  state: null,
  label: "Clock",
};
const CLOCK_OFF: ObjectWords = { ...CLOCK, state: "plugin off", label: "Clock · plugin off" };

const facts = (over: Partial<SelectionFacts>): SelectionFacts => ({
  count: 1,
  locked: false,
  menu: [],
  words: [NOTE],
  openable: false,
  commentable: true,
  ...over,
});

export const BAR_STATES = [
  "One — the clock's own act",
  "Two — Send 2 to…",
  "Taped — Lift the tape",
  "A missing face",
  "A label, and a name the set lacks",
  "Grown up — NOTE",
  "Grown down — near the top",
  "Grown — two, Clean up",
  "Grown — fitting neither way, the list scrolls",
] as const;
export type BarState = (typeof BAR_STATES)[number];

interface Plate {
  readonly facts: SelectionFacts;
  /** The plate's view: 560 wide, 400 tall — 640 for a menu grown whole (the line's reserve, 80, at its foot). */
  readonly height: number;
  /** Where the selection's brackets stand on the plate. */
  readonly box: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
  readonly open: boolean;
}

const PLATES: Record<BarState, Plate> = {
  "One — the clock's own act": {
    facts: facts({
      words: [CLOCK],
      menu: [{ id: "desk-clock.seconds", label: "Seconds hand", glyph: { path: STOPWATCH } }],
    }),
    height: 400,
    box: { x0: 210, y0: 220, x1: 350, y1: 360 },
    open: false,
  },
  "Two — Send 2 to…": {
    facts: facts({ count: 2, words: [NOTE, PAD] }),
    height: 400,
    box: { x0: 150, y0: 210, x1: 410, y1: 360 },
    open: false,
  },
  "Taped — Lift the tape": {
    facts: facts({ locked: true }),
    height: 400,
    box: { x0: 200, y0: 220, x1: 360, y1: 350 },
    open: false,
  },
  "A missing face": {
    facts: facts({
      words: [CLOCK_OFF],
      menu: [{ id: "desk-clock.seconds", label: "Seconds hand" }],
    }),
    height: 400,
    box: { x0: 210, y0: 220, x1: 350, y1: 360 },
    open: false,
  },
  "A label, and a name the set lacks": {
    facts: facts({
      words: [PAD],
      menu: [
        { id: "shuffle", label: "Shuffle" },
        { id: "lap", label: "Lap", glyph: "stopwatch" },
      ],
    }),
    height: 400,
    box: { x0: 190, y0: 220, x1: 370, y1: 360 },
    open: false,
  },
  "Grown up — NOTE": {
    facts: facts({}),
    height: 640,
    box: { x0: 200, y0: 500, x1: 360, y1: 550 },
    open: true,
  },
  "Grown down — near the top": {
    facts: facts({
      words: [CLOCK],
      menu: [{ id: "desk-clock.seconds", label: "Seconds hand", glyph: { path: STOPWATCH } }],
    }),
    height: 640,
    box: { x0: 210, y0: 30, x1: 350, y1: 84 },
    open: true,
  },
  "Grown — two, Clean up": {
    facts: facts({ count: 2, words: [NOTE, PAD] }),
    height: 640,
    box: { x0: 150, y0: 500, x1: 410, y1: 550 },
    open: true,
  },
  "Grown — fitting neither way, the list scrolls": {
    facts: facts({}),
    height: 400,
    box: { x0: 200, y0: 240, x1: 360, y1: 290 },
    open: true,
  },
};

const WIDTH = 560;

/** One plate: the shipping bar over a fixture selection, placed from the plate's own anchor. */
export function SelectionBarPlate({ state }: { state: BarState }): ReactElement {
  const plate = PLATES[state];
  const [open, setOpen] = useState(plate.open);
  const cells = useMemo(() => barCells(plate.facts, "mac"), [plate]);
  const groups = useMemo(() => menuGroups(plate.facts, "mac"), [plate]);
  const eyebrow = useMemo(() => menuEyebrow(plate.facts), [plate]);
  const anchor = useMemo<PlaceAnchor>(
    () => ({
      box: plate.box,
      count: plate.facts.count,
      view: { width: WIDTH, height: plate.height },
    }),
    [plate],
  );
  const { x0, y0, x1, y1 } = plate.box;
  return (
    <div className="vf-ds-bar-plate" data-state={state} style={{ height: plate.height }}>
      <div
        className="vf-ds-bar-object"
        style={{ left: x0 + 6, top: y0 + 6, width: x1 - x0 - 12, height: y1 - y0 - 12 }}
      />
      <div
        className="vf-ds-bar-brackets"
        style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }}
      />
      <SelectionBarView
        cells={cells}
        groups={groups}
        eyebrow={eyebrow}
        shown
        stepAside={false}
        open={open}
        onOpenChange={setOpen}
        onCell={() => undefined}
        onRow={() => setOpen(false)}
        fixed={anchor}
      />
      <span className="vf-ds-bar-caption">{state}</span>
    </div>
  );
}
