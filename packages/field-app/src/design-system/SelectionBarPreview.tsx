import { type ReactElement, useMemo, useState } from "react";
import { type HeldAnchor, type HeldSlot, handCells } from "../field/desk/bar/bar-hand";
import {
  barCells,
  menuEyebrow,
  menuGroups,
  type SelectionFacts,
} from "../field/desk/bar/bar-model";
import { type PlaceAnchor, SelectionBarView } from "../field/desk/bar/SelectionBarView";
import { deskLook } from "../field/desk/desk-layer";
import type { ObjectWords } from "../field/desk/desk-object-words";

// The selection bar's fixture ADAPTER (DK-11; docs/UI_SYSTEM.md): the shipping bar — `SelectionBarView` — over
// fixture selections, its cells and its grown menu's rows read by the PRODUCT's own model (`barCells`,
// `menuGroups`, `menuEyebrow`), one plate per state the canon draws: one object with its kind's own act, two
// (one Copy for both), taped ("Lift the tape"), a missing face ("Clock · plugin off"), a glyph-less act and a name the set
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
  "Two — one Copy for both",
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
  "Two — one Copy for both": {
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

// ── DK-12 — THE TOOLS IN HAND (§8 "Tools in hand"): the same shipping bar in its hand's role, over a fixture HAND — the
// four specimens' slots as their kinds declare them (ICE's notebook, whiteboard and calendar; the example plugin's
// clock, its own five drawings), the inks the PRODUCT's palette hands the kinds (`deskLook`), the mode in hand and the
// kind's word — its cells read by the product's own model (`handCells`). The plate is the top of the desk's view: the
// bar under the head at y 64, and the held object's stand-in in the reading fit's band (116 under the top, 100 over
// the foot).

/** The clock's own drawings (examples/plugins/desk-clock `glyphs.ts`): data, as the kind declares them. */
const CLOCK_GLYPHS = {
  seconds: STOPWATCH,
  ring24:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 3v2M21 12h-2M12 21v-2M3 12h2",
  back: "M12 20a8 8 0 1 0-8-8M4 12l-2-3M4 12l3-2M12 8v4l2 2",
  ahead: "M12 20a8 8 0 1 1 8-8M20 12l2-3M20 12l-3-2M12 8v4l-2 2",
  dial: "M7 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 21a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
} as const;

export const HAND_STATES = [
  "In hand — the notebook",
  "In hand — the whiteboard",
  "In hand — the calendar",
  "In hand — the clock",
] as const;
export type HandState = (typeof HAND_STATES)[number];

/** The product's inks for the pens and the markers, by name — what the kinds' looks hand their slots as swatches. */
function inks(dark: boolean): { pen(name: string): string; marker(name: string): string } {
  const palette = deskLook(dark ? "dark" : "light").palette as unknown as {
    readonly pens: Readonly<Record<string, { readonly css: string }>>;
    readonly markers: Readonly<Record<string, { readonly css: string }>>;
  };
  return {
    pen: (name) => palette.pens[name]?.css ?? "",
    marker: (name) => palette.markers[name]?.css ?? "",
  };
}

/** A specimen's hand as the anchor carries it: its slots in their declared order, the mode in hand, its word. */
function handOf(state: HandState, dark: boolean): Pick<HeldAnchor, "tools" | "active" | "readout"> {
  const ink = inks(dark);
  const pen = (name: string, label: string, hint: string): HeldSlot => ({
    id: `pen:${name}`,
    label,
    kind: "mode",
    hint,
    glyph: "pen",
    swatch: ink.pen(name),
  });
  const marker = (name: string, hint: string): HeldSlot => ({
    id: `marker:${name}`,
    label: `${name.charAt(0).toUpperCase()}${name.slice(1)} marker`,
    kind: "mode",
    hint,
    glyph: "pen",
    swatch: ink.marker(name),
  });
  const undo: HeldSlot = { id: "undo", label: "Undo", kind: "action", hint: "⌘Z", glyph: "undo" };
  switch (state) {
    case "In hand — the notebook":
      return {
        tools: [
          {
            id: "turn:-1",
            label: "Previous page",
            kind: "action",
            hint: "←",
            glyph: "chevron-left",
          },
          { id: "turn:1", label: "Next page", kind: "action", hint: "→", glyph: "chevron" },
          pen("felt", "Felt pen", "1"),
          pen("ball", "Ballpoint", "2"),
          pen("fountain", "Fountain pen", "3"),
          pen("red", "Red pen", "4"),
          undo,
        ],
        active: "pen:fountain",
        readout: "Page 1",
      };
    case "In hand — the whiteboard":
      return {
        tools: [
          marker("black", "1"),
          marker("blue", "2"),
          marker("red", "3"),
          marker("green", "4"),
          { id: "eraser", label: "Eraser", kind: "mode", hint: "E", glyph: "eraser" },
          undo,
          { id: "redo", label: "Redo", kind: "action", hint: "⇧⌘Z", glyph: "redo" },
        ],
        active: "marker:blue",
      };
    case "In hand — the calendar":
      return {
        tools: [
          {
            id: "month:-1",
            label: "Previous month",
            kind: "action",
            hint: "←",
            glyph: "chevron-left",
          },
          { id: "month:1", label: "Next month", kind: "action", hint: "→", glyph: "chevron" },
          { id: "today", label: "Today", kind: "action", hint: "T", glyph: "today" },
          { id: "pen", label: "The pen", kind: "mode", hint: "P", glyph: "pen" },
        ],
        active: "pen",
        readout: "September",
      };
    case "In hand — the clock":
      return {
        tools: [
          {
            id: "seconds",
            label: "Seconds hand",
            kind: "action",
            hint: "S",
            glyph: { path: CLOCK_GLYPHS.seconds },
          },
          {
            id: "ring24",
            label: "24-hour ring",
            kind: "action",
            hint: "H",
            glyph: { path: CLOCK_GLYPHS.ring24 },
          },
          {
            id: "zone-back",
            label: "An hour back",
            kind: "action",
            hint: "[",
            glyph: { path: CLOCK_GLYPHS.back },
          },
          {
            id: "zone-ahead",
            label: "An hour ahead",
            kind: "action",
            hint: "]",
            glyph: { path: CLOCK_GLYPHS.ahead },
          },
          {
            id: "dial",
            label: "Next dial",
            kind: "action",
            hint: "F",
            glyph: { path: CLOCK_GLYPHS.dial },
          },
        ],
        active: "",
        readout: "10:08:42",
      };
  }
}

/** The plate's view: the top of a desk 560 wide and 400 tall. */
const HAND_VIEW = { width: WIDTH, height: 400 } as const;
/** The reading fit's band on the plate: 116 under its top, 100 over its foot (the layer's `hold`). */
const FIT = { top: 116, bottom: 400 - 100 } as const;

/** One plate: the shipping bar as the tools in hand, under the head, over a held object's stand-in. */
export function HandPlate({ state, dark }: { state: HandState; dark: boolean }): ReactElement {
  const hand = useMemo(() => handCells(handOf(state, dark), "mac"), [state, dark]);
  const anchor = useMemo<PlaceAnchor>(() => ({ box: null, count: 1, view: HAND_VIEW }), []);
  return (
    <div className="vf-ds-bar-plate" data-state={state} style={{ height: HAND_VIEW.height }}>
      <div
        className="vf-ds-bar-object"
        style={{ left: 150, top: FIT.top, width: WIDTH - 300, height: FIT.bottom - FIT.top }}
      />
      <SelectionBarView
        cells={NO_CELLS}
        groups={NO_GROUPS}
        eyebrow=""
        shown
        stepAside={false}
        open={false}
        onOpenChange={() => undefined}
        onCell={() => undefined}
        onRow={() => undefined}
        held
        hand={hand}
        onHand={() => undefined}
        fixed={anchor}
      />
      <span className="vf-ds-bar-caption">{state}</span>
    </div>
  );
}

const NO_CELLS: Parameters<typeof SelectionBarView>[0]["cells"] = [];
const NO_GROUPS: Parameters<typeof SelectionBarView>[0]["groups"] = [];
