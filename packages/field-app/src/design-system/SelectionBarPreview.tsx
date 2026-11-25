import type { ActChoice } from "@vibecook/ice";
import type { MenuSlot } from "@vibecook/ice/desk";
import { type ReactElement, useMemo, useState } from "react";
import { type HeldAnchor, type HeldSlot, handCells } from "../field/desk/bar/bar-hand";
import {
  barCells,
  choiceEyebrow,
  choiceGroups,
  menuEyebrow,
  menuGroups,
  type SelectionFacts,
} from "../field/desk/bar/bar-model";
import { wordsCells } from "../field/desk/bar/bar-words";
import { WORDS_EYEBROW, type WordsPaste, wordsMenuGroups } from "../field/desk/bar/bar-words-more";
import {
  type PlaceAnchor,
  SelectionBarView,
  type WordsRow,
} from "../field/desk/bar/SelectionBarView";
import { deskLook } from "../field/desk/desk-layer";
import type { ObjectWords } from "../field/desk/desk-object-words";

// The selection bar's fixture ADAPTER (DK-11; docs/UI_SYSTEM.md): the shipping bar — `SelectionBarView` — over
// fixture selections, its cells and its grown menu's rows read by the PRODUCT's own model (`barCells`,
// `menuGroups`, `menuEyebrow`), one plate per state the canon draws: one object with its kind's own act, two
// (one Copy for both), taped ("Lift the tape"), a missing face ("Clock · plugin off"), a glyph-less act and a name the set
// lacks, and the bar grown — up under NOTE, down near the top, two with Clean up. What it replaces is only what a host
// supplies: the desk's anchor (a box on the plate where the brackets would be) and the selection's facts. The
// brackets themselves are the desk's GPU marks; the plate draws a stand-in outline so the bar has something to stand
// over. Track OM (2026-11-25; ICE I61, I62): the browser pane's bar — Device, a choice, and Mute — its device list grown,
// Custom's fields open, two panes on different devices (Mixed), and an act its kind says is disabled beside a swatch.
// OM-2: the simulator's Finish, a swatch choice — the swatch pill, its current finish's dot and the chevron.

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
const PANE: ObjectWords = {
  type: "vibefield.browser-pane",
  title: "Browser pane",
  state: null,
  label: "Browser pane",
};

/** The browser pane's own drawings (plugins/browser-pane `DEVICE_GLYPH`, `SOUND_ON`, `SOUND_OFF`): data, as its kind declares them. */
const DEVICE_PATH = "M3 5 H16 V15 H3 Z M6 19 H12 M9 15 V19 M17 9 H21 V20 H14 V9 Z";
const SOUND_PATH = "M3 9 H7 L12 5 V19 L7 15 H3 Z M16 8 C19 10 19 14 16 16 M18 5 C23 8 23 16 18 19";

/** The pane's device choices as its kind says them (plugins/browser-pane `deviceChoices`), the laptop current. */
const devices = (current: string | undefined): readonly ActChoice[] => [
  ...[
    ["laptop", "Laptop", "1280 × 800"],
    ["desktop", "Desktop", "1440 × 900"],
    ["tablet", "iPad Air 11″", "820 × 1180"],
    ["phone", "iPhone 17 Pro", "402 × 874"],
  ].map(([id = "", label = "", hint = ""]) => ({
    id,
    label,
    hint,
    group: "devices",
    ...(id === current ? { current: true } : {}),
  })),
  {
    id: "custom",
    label: "Custom",
    hint: "your size and agent",
    group: "custom",
    fields: [
      { id: "width", label: "Width", kind: "number", value: 1280, min: 320, max: 8192, step: 1 },
      { id: "height", label: "Height", kind: "number", value: 800, min: 240, max: 8192, step: 1 },
      {
        id: "agent",
        label: "User agent",
        kind: "text",
        value: "",
        maxLength: 512,
        placeholder: "The browser's own",
      },
    ],
  },
];
const paneActs = (current: string | undefined): SelectionFacts["menu"] => [
  { id: "device", label: "Device", glyph: { path: DEVICE_PATH }, choices: devices(current) },
  { id: "sound", label: "Mute", glyph: { path: SOUND_PATH } },
];

const PHONE: ObjectWords = {
  type: "vibefield.simulator",
  title: "iOS Simulator",
  state: null,
  label: "iOS Simulator",
};

/** The iPhone 17 Pro's finishes as the simulator's kind says them (track OM, OM-2, 2026-11-25): by name, each with its
 * swatch. The phone's own colours are the plugin's (DESIGN.md §5.1's finishes table), which the catalog may not import
 * and holds no colour literal of, so its swatches here are stand-ins from the product's tokens: the shape is the plate's
 * subject, not the colours. */
const PRO_FINISHES = [
  ["cosmic-orange", "Cosmic Orange", "var(--vf-orange)"],
  ["deep-blue", "Deep Blue", "var(--vf-ink-info)"],
  ["silver-17p", "Silver", "var(--vf-text-tertiary)"],
] as const;
const finishes = (current: string): readonly ActChoice[] =>
  PRO_FINISHES.map(([id, label, swatch]) => ({
    id,
    label,
    swatch,
    ...(id === current ? { current: true } : {}),
  }));

const facts = (over: Partial<SelectionFacts>): SelectionFacts => ({
  count: 1,
  locked: false,
  menu: [],
  words: [NOTE],
  openable: false,
  downloadable: false,
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
  "A choice — the pane's Device, and Mute",
  "A choice's list — Device",
  "Custom… — its fields open",
  "Mixed — two panes on two devices",
  "Disabled now, and a swatch",
  "A swatch choice — the simulator's Finish",
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
  /** Grown on a choice's list (ICE I62): the act whose choices it lists, and a row whose fields stand open. */
  readonly choosing?: string;
  readonly expanded?: string;
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
  "A choice — the pane's Device, and Mute": {
    facts: facts({ words: [PANE], menu: paneActs("laptop") }),
    height: 400,
    box: { x0: 120, y0: 200, x1: 440, y1: 380 },
    open: false,
  },
  "A choice's list — Device": {
    facts: facts({ words: [PANE], menu: paneActs("laptop") }),
    height: 640,
    box: { x0: 120, y0: 470, x1: 440, y1: 560 },
    open: true,
    choosing: "device",
  },
  "Custom… — its fields open": {
    facts: facts({ words: [PANE], menu: paneActs("laptop") }),
    height: 640,
    box: { x0: 120, y0: 520, x1: 440, y1: 580 },
    open: true,
    choosing: "device",
    expanded: "choice:custom",
  },
  "Mixed — two panes on two devices": {
    facts: facts({ count: 2, words: [PANE], menu: paneActs(undefined) }),
    height: 400,
    box: { x0: 90, y0: 200, x1: 470, y1: 380 },
    open: false,
  },
  "Disabled now, and a swatch": {
    facts: facts({
      words: [PANE],
      menu: [
        { id: "sound", label: "Mute", glyph: { path: SOUND_PATH }, enabled: false },
        // a kind's own colour as its word (the simulator's finish); here the product palette's blue marker, no literal
        { id: "finish", label: "Finish", swatch: inks(false).marker("blue") },
      ],
    }),
    height: 400,
    box: { x0: 160, y0: 220, x1: 400, y1: 360 },
    open: false,
  },
  // one phone, on Cosmic Orange: its Finish the swatch pill — the current finish's dot and the chevron, no words
  "A swatch choice — the simulator's Finish": {
    facts: facts({
      words: [PHONE],
      menu: [{ id: "finish", label: "Finish", choices: finishes("cosmic-orange") }],
    }),
    height: 400,
    box: { x0: 225, y0: 156, x1: 335, y1: 392 },
    open: false,
  },
};

const WIDTH = 560;

/** One plate: the shipping bar over a fixture selection, placed from the plate's own anchor. */
export function SelectionBarPlate({ state }: { state: BarState }): ReactElement {
  const plate = PLATES[state];
  const [open, setOpen] = useState(plate.open);
  const cells = useMemo(() => barCells(plate.facts, "mac"), [plate]);
  const chosen = plate.facts.menu.find((act) => act.id === plate.choosing);
  const groups = useMemo(
    () =>
      chosen?.choices === undefined ? menuGroups(plate.facts, "mac") : choiceGroups(chosen.choices),
    [plate, chosen],
  );
  const eyebrow = useMemo(
    () => (chosen === undefined ? menuEyebrow(plate.facts) : choiceEyebrow(chosen.label)),
    [plate, chosen],
  );
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
        {...(open && plate.choosing !== undefined
          ? { choosing: { of: "act" as const, id: plate.choosing } }
          : {})}
        {...(plate.expanded === undefined ? {} : { expandedRow: plate.expanded })}
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

// ── IK — THE WORDS BAR (DESIGN.md §8 "The words bar"): the same shipping bar over the words selected on a sheet being
// written, its cells read by the product's own model (`wordsCells`) from fixture WORDS acts as a kind declares them — the
// shape of ICE's ink acts: Pen ▾ over the desk's four pens, Highlight ▾ over the desk's five highlighters and None, Strike
// and Underline as toggles, Clear — their glyphs §13's names, their swatches drawn by NAME from the product's own palette
// (`deskLook`), as ICE's own note's are. A plate per row: the words' row, the same with no pen shared and no highlight, the pens' row and
// the highlighters' row, each opened by the view's own state (`wordsOpen`). The plate stages the sheet, its brackets and
// the words' wash, which the desk draws in the product; the place is the view's, over the words' box. V5b: the words' More
// grown — its rows read by the product's own model (`wordsMenuGroups`) — where the host has the clipboard door (the app;
// round two), and where it has none, so Paste waits; More folds and grows it again on the plate. The toggles and Highlight carry the keys ICE's written
// part declares (⇧⌘X, ⌘U, ⇧⌘H), printed in their tips.

const PEN_NAMES = ["felt", "ball", "fountain", "red"] as const;
const HIGHLIGHTER_NAMES = ["yellow", "green", "pink", "blue", "orange"] as const;
const titled = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/** The words acts as the anchor carries them (`WordsAnchor.menu`; ICE's `inkActs` on I61/I62's shape), each as it stands
 * for the words now — the words' value `current` on one choice. No swatch is said (ICE's own note's), so the bar draws the
 * pens and highlighters from the product's palette by name. */
function wordsMenu(now: {
  readonly pen?: string;
  readonly highlight?: string;
  readonly strike: boolean;
  readonly underline: boolean;
}): MenuSlot[] {
  const current = (id: string, at: string | undefined) => (id === at ? { current: true } : {});
  return [
    {
      id: "ink.pen",
      label: "Pen",
      glyph: "pen",
      choices: PEN_NAMES.map((name) => ({
        id: name,
        label: `${titled(name)} pen`,
        ...current(name, now.pen),
      })),
    },
    {
      id: "ink.highlight",
      label: "Highlight",
      glyph: "highlighter",
      keys: "⇧⌘H",
      choices: [
        ...HIGHLIGHTER_NAMES.map((name) => ({
          id: name,
          label: titled(name),
          ...current(name, now.highlight),
        })),
        { id: "none", label: "None", ...current("none", now.highlight) },
      ],
    },
    { id: "ink.strike", label: "Strike", glyph: "strike", keys: "⇧⌘X", pressed: now.strike },
    {
      id: "ink.underline",
      label: "Underline",
      glyph: "underline",
      keys: "⌘U",
      pressed: now.underline,
    },
    { id: "ink.clear", label: "Clear", glyph: "clear-marks" },
  ];
}

export const WORDS_STATES = [
  "Words — the fountain pen, yellow, underlined",
  "Words — no pen shared, no highlight",
  "Words — the pens",
  "Words — the highlighters",
  "Words — More",
  "Words — More with no clipboard door: Paste waits",
] as const;
export type WordsState = (typeof WORDS_STATES)[number];

const MARKED = wordsMenu({ pen: "fountain", highlight: "yellow", strike: false, underline: true });

const WORDS_PLATES: Record<
  WordsState,
  {
    readonly menu: readonly MenuSlot[];
    readonly open?: string;
    /** The words' More grown, by the page's road to the clipboard. */
    readonly more?: WordsPaste;
  }
> = {
  "Words — the fountain pen, yellow, underlined": { menu: MARKED },
  "Words — no pen shared, no highlight": {
    menu: wordsMenu({ highlight: "none", strike: false, underline: false }),
  },
  "Words — the pens": { menu: MARKED, open: "ink.pen" },
  "Words — the highlighters": { menu: MARKED, open: "ink.highlight" },
  "Words — More": { menu: MARKED, more: "door" },
  "Words — More with no clipboard door: Paste waits": { menu: MARKED, more: "none" },
};

/** A plate whose menu grows stands its sheet this much lower, and is this tall, so the menu grows UP as it does mid-desk. */
const MORE_DROP = 130;
const MORE_HEIGHT = 520;

/** The sheet on the plate (its brackets 6 out of it), and the words selected on it. */
const SHEET_BOX = { x0: 170, y0: 190, x1: 390, y1: 350 } as const;
const WORDS_BOX = { x0: 214, y0: 244, x1: 336, y1: 266 } as const;

/** A box stood `dy` lower. */
const at = (box: { x0: number; y0: number; x1: number; y1: number }, dy: number) => ({
  x0: box.x0,
  y0: box.y0 + dy,
  x1: box.x1,
  y1: box.y1 + dy,
});

/** One plate: the shipping bar over the words selected on a stand-in sheet, placed from the plate's own words. */
export function WordsPlate({ state, dark }: { state: WordsState; dark: boolean }): ReactElement {
  const plate = WORDS_PLATES[state];
  const words = useMemo<WordsRow>(
    () => ({ cells: wordsCells(plate.menu, deskLook(dark ? "dark" : "light").palette), run: 1 }),
    [plate, dark],
  );
  const [open, setOpen] = useState(plate.more !== undefined);
  const groups = useMemo(
    () => (plate.more === undefined ? NO_GROUPS : wordsMenuGroups("mac", plate.more)),
    [plate],
  );
  const drop = plate.more === undefined ? 0 : MORE_DROP;
  const height = plate.more === undefined ? 400 : MORE_HEIGHT;
  const sheet = at(SHEET_BOX, drop);
  const wordsBox = at(WORDS_BOX, drop);
  const anchor = useMemo<PlaceAnchor>(
    () => ({ box: at(WORDS_BOX, drop), count: 1, view: { width: WIDTH, height } }),
    [drop, height],
  );
  return (
    <div className="vf-ds-bar-plate" data-state={state} style={{ height }}>
      <div
        className="vf-ds-bar-object"
        style={{
          left: sheet.x0 + 6,
          top: sheet.y0 + 6,
          width: sheet.x1 - sheet.x0 - 12,
          height: sheet.y1 - sheet.y0 - 12,
        }}
      />
      <div
        className="vf-ds-bar-brackets"
        style={{
          left: sheet.x0,
          top: sheet.y0,
          width: sheet.x1 - sheet.x0,
          height: sheet.y1 - sheet.y0,
        }}
      />
      <div
        className="vf-ds-bar-wash"
        style={{
          left: wordsBox.x0,
          top: wordsBox.y0,
          width: wordsBox.x1 - wordsBox.x0,
          height: wordsBox.y1 - wordsBox.y0,
        }}
      />
      <SelectionBarView
        cells={NO_CELLS}
        groups={groups}
        eyebrow={plate.more === undefined ? "" : WORDS_EYEBROW}
        shown
        stepAside={false}
        open={open && plate.more !== undefined}
        onOpenChange={setOpen}
        onCell={() => undefined}
        onRow={() => setOpen(false)}
        words={words}
        onWords={() => undefined}
        {...(plate.open === undefined ? {} : { wordsOpen: plate.open })}
        fixed={anchor}
      />
      <span className="vf-ds-bar-caption">{state}</span>
    </div>
  );
}

const NO_CELLS: Parameters<typeof SelectionBarView>[0]["cells"] = [];
const NO_GROUPS: Parameters<typeof SelectionBarView>[0]["groups"] = [];
