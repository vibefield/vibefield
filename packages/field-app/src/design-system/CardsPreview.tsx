import { AGENT_MARK_PROVIDERS } from "@vibefield/puppeteer-view-sdk/toolkit";
import type { CSSProperties, ReactElement } from "react";
import { type CopiedObject, copyName } from "../field/desk/copy/copy-face";
import { CardFace } from "../frame/cards/CardFace";
import { CardsView, type HeldCard } from "../frame/cards/CardsView";
import { CarriedCardView } from "../frame/cards/CarriedCardLayer";
import type { CardBox, CarriedCard } from "../frame/cards/card-drag";
import {
  type AgentCard,
  CARD_W,
  CARDS_LINE_RIGHT,
  type Card,
  type CardOrigin,
  type CardWindow,
  type FileCard,
  layoutCards,
  layoutRaised,
  type MsgCard,
  type PictCard,
  reachedIndex,
  reachLift,
  termCardOf,
  textCardOf,
} from "../frame/cards/cards-model";
import {
  COPY_PLACES,
  OUTSIDE_WORDS,
  TARGET_WORDS,
  WAITING_WORDS,
} from "../frame/cards/cards-words";

// The hand's fixture ADAPTER (track HN; docs/UI_SYSTEM.md): the shipping fan —
// `CardsView`, placed by the product's own model (`layoutCards`, `layoutRaised`,
// `reachLift`) — the shipping `CardFace`, over fixture cards, one of each kind
// (and the two the desk's Copy deals, named by the product's own `copyName`,
// and what another app, Settings and History deal, in the product's own words
// and provenances), and the shipping `CarriedCardView` over a card carried to
// a pane. What it replaces is only what a host supplies: the cards (a picture
// the catalog draws itself, as the edge tray's fixtures did), the pointer, the
// drag, the clock, the window and the keys (the Mac's). The markup and the CSS
// are the product's.

/** The plates' clock: every card was dealt a few minutes before it. */
const NOW = Date.UTC(2026, 9, 29, 14, 10);
const minutesAgo = (m: number): number => NOW - m * 60_000;
function origin(view: CardOrigin["view"], place: string): CardOrigin {
  return { view, place, how: "copy" };
}

/** A fixture picture: an SVG the catalog draws itself, so a card shows a real
 * image without a still on disk (the product's come through the shell's
 * `vibefield-still://` scheme, which the catalog does not have). */
function fixtureStill(label: string, hue: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='288' height='180'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue} 70% 62%)'/><stop offset='1' stop-color='hsl(${hue + 30} 70% 40%)'/></linearGradient></defs>` +
    `<rect width='288' height='180' fill='url(#g)'/>` +
    `<rect x='24' y='28' width='240' height='96' rx='12' fill='rgba(255,255,255,0.22)'/>` +
    `<text x='28' y='158' font-family='ui-sans-serif' font-size='18' fill='rgba(255,255,255,0.9)'>${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** An agent the toolkit has a mark for, picked by index as its fixtures pick theirs. */
const MARKED = AGENT_MARK_PROVIDERS[0];

const TEXT = textCardOf(
  "Never drop a paste unsaid. Say its size and how much of it one paste carries, both as Finder counts the text.",
  { id: "fx-text", origin: origin("history", "claude·2"), at: minutesAgo(18) },
);

const FILE: FileCard = {
  id: "fx-file",
  kind: "file",
  origin: origin("history", "files"),
  at: minutesAgo(8),
  paste: "packages/fieldd/src/files/routes.ts",
  name: "routes.ts",
  folder: "packages/fieldd/src/files/",
  lines:
    'export const ROUTES = {\n  list: "files.list",\n  read: "files.read",\n  watch: "files.watch",\n} as const;',
};

const AGENT: AgentCard = {
  id: "fx-agent",
  kind: "agent",
  origin: origin("godview", "swarm"),
  at: minutesAgo(5),
  paste: "claude·2",
  handle: "claude·2",
  ...(MARKED === undefined ? {} : { agent: MARKED }),
  project: "vibe-field",
  projectInk: 3,
  state: "working",
};

const TERM = termCardOf(
  "$ pnpm --filter @vibefield/fieldd test files\n ✓ files-worker.test.ts (14)\n ✓ route-table.test.ts (9)\n Test Files  2 passed (2)\n      Tests  23 passed (23)",
  { id: "fx-term", origin: origin("godview", "claude·2"), at: minutesAgo(4) },
);

const MSG: MsgCard = {
  id: "fx-msg",
  kind: "msg",
  origin: origin("assistant", "Vela"),
  at: minutesAgo(1),
  paste:
    "codex·2 wants to push to main. claude·2 is still writing the LANDED entry, so I'd hold the push until that lands.",
  speaker: "Vela",
  time: "14:09",
  words:
    "codex·2 wants to push to main. claude·2 is still writing the LANDED entry, so I'd hold the push until that lands.",
};

const PICT: PictCard = {
  id: "fx-pict",
  kind: "pict",
  origin: { view: "canvas", how: "snapshot" },
  at: NOW - 20_000,
  title: "Snapshot",
  width: 1440,
  height: 900,
  src: fixtureStill("Godview · swarm", 214),
  path: "/var/folders/T/vibefield-still-0007.png",
  paste: "/var/folders/T/vibefield-still-0007.png",
};

/** One card of each kind, oldest first, as a hand holds them. */
export const CARD_FIXTURES: readonly Card[] = [TEXT, FILE, AGENT, TERM, MSG, PICT];

/** Two objects on the desk as the desk's Copy reads them (`copySelection`'s `CopiedObject`). */
function copied(type: string, title: string): CopiedObject {
  return { type, words: { type, title, state: null, label: title }, props: {} };
}

/** What the desk's Copy deals (HN-D3; §8 "The desk's Copy"): one note's words as a text card, and
 * anything else as a picture of the selection, named as the product names it ("2 objects"). Both
 * from Canvas, by Copy — no place of their own. */
export const COPY_FIXTURES: readonly Card[] = [
  textCardOf(
    "Ship the hand on Thursday. The deal, the fan and the play are in; the drag in waits for B2.",
    { id: "fx-copy-note", origin: { view: "canvas", how: "copy" }, at: minutesAgo(2) },
  ),
  {
    id: "fx-copy-pict",
    kind: "pict",
    origin: { view: "canvas", how: "copy" },
    at: NOW - 30_000,
    title: copyName([copied("desk.note", "Note"), copied("desk.clock", "Clock")]),
    width: 1280,
    height: 720,
    src: fixtureStill("Studio desk", 32),
    paste: "",
  },
];

/** What a drag from another app shows before it is let go: only its kind. */
export const WAITING_FIXTURES: readonly Card[] = [
  {
    id: "fx-wait-pict",
    kind: "pict",
    origin: { view: "outside", how: "drag" },
    at: NOW,
    title: "",
    width: 0,
    height: 0,
    src: "",
    paste: "",
    waiting: true,
  },
  {
    id: "fx-wait-file",
    kind: "file",
    origin: { view: "outside", how: "drag" },
    at: NOW,
    name: WAITING_WORDS.files(3),
    paste: "",
    waiting: true,
  },
];

/** What another app, Settings and History deal (HN-5, HN-6; DESIGN.md §8 "The hand"): a file
 * dragged in from another app — not words, so its kind and its size, in the product's own words —
 * words ⌘V brought in with no caret, a device's name copied in Settings over Canvas, and a path
 * History's room copied. */
export const FROM_FIXTURES: readonly Card[] = [
  {
    id: "fx-from-file",
    kind: "file",
    origin: { view: "outside", how: "drag" },
    at: minutesAgo(3),
    paste: "/Users/james/Desktop/report.pdf",
    name: "report.pdf",
    folder: "james/Desktop",
    facts: OUTSIDE_WORDS.facts("PDF", 2_400_000),
  },
  textCardOf("Can you check the routes table before the cut? The files worker moved.", {
    id: "fx-from-paste",
    origin: { view: "outside", how: "paste" },
    at: NOW - 20_000,
  }),
  textCardOf("james-mac-mini", {
    id: "fx-from-settings",
    origin: { view: "canvas", place: COPY_PLACES.settings, how: "copy" },
    at: NOW - 15_000,
  }),
  textCardOf("/Users/james/vibe-field/packages/fieldd/src/files/routes.ts", {
    id: "fx-from-history",
    origin: { view: "history", how: "copy" },
    at: NOW - 10_000,
  }),
];

/** The cards of FROM_FIXTURES a plate reaches, to read where each came from above it (§8 "The
 * hand", Holding them): a paste with no caret, a copy made in Settings over Canvas, and one
 * History's room made. */
export const FROM_REACHED = ["fx-from-paste", "fx-from-settings", "fx-from-history"] as const;

/** The page's hand plates, in its order. */
export const CARDS_STATES = ["rest", "reached", "raised", "held", "carried"] as const;
export type CardsState = (typeof CARDS_STATES)[number];

/** A plate is the window's foot at this size (the held card's, the window's middle). */
const PLATE: CardWindow = { width: 900, height: 360 };
const HELD_PLATE: CardWindow = { width: 900, height: 640 };
const NONE = new Map<string, null>();

/** Carried: the hand's text card out of the fan and over a pane, which answers what letting go
 * will do — its box ringed, "Paste into vibe-field" over the card (§8 "The hand"). */
const PANE: CardBox = { left: 150, top: 28, width: 470, height: 200 };
const CARRIED: CarriedCard = {
  card: TEXT,
  source: "hand",
  x: 400,
  y: 150,
  grab: { x: 46, y: 40 },
  answer: { kind: "pane", ok: true, label: TARGET_WORDS.pane("vibe-field") },
  opening: null,
  phase: "carry",
  drag: 1,
  tilt: -4,
  ducked: false,
  ring: PANE,
  cell: null,
  home: null,
};

/** The carried layer stands fixed to the window: held in a plate, the plate is its window. */
const CONTAINED: CSSProperties = { contain: "layout" };

/** The pane under the carried card: a stand-in panel — the catalog's own, never a pane's markup. */
const PANE_STAND_IN: CSSProperties = {
  position: "absolute",
  left: PANE.left,
  top: PANE.top,
  width: PANE.width,
  height: PANE.height,
  borderRadius: 8,
  background: "var(--vf-chrome-solid)",
  boxShadow: "0 0 0 1px var(--vf-hairline), var(--vf-shadow-island)",
};

/** The hand in one state, placed by the product's own model over the mat. The
 * line's place at the left (`CARDS_LINE_RIGHT`) is left empty. */
export function CardsPlate({ state }: { state: CardsState }): ReactElement {
  const win = state === "held" ? HELD_PLATE : PLATE;
  const raised = state === "raised";
  const lay = raised ? layoutRaised : layoutCards;
  const layout = lay(CARD_FIXTURES.length, win, CARDS_LINE_RIGHT);
  // reached: the pointer on the third card's middle, as the product measures it
  const third = layout.slots[2];
  const pointerX = state === "reached" && third !== undefined ? third.x + CARD_W / 2 : null;
  const lifts = reachLift(layout.slots, pointerX);
  const held: HeldCard | null = state === "held" ? { card: TEXT, phase: "up" } : null;
  const carried = state === "carried" ? CARRIED : null;
  return (
    <div
      className="vf-ds-cards-plate"
      data-state={state}
      {...(carried === null ? {} : { style: CONTAINED })}
    >
      {carried !== null && <div aria-hidden="true" style={PANE_STAND_IN} />}
      <CardsView
        cards={CARD_FIXTURES}
        layout={layout}
        lifts={lifts}
        reached={reachedIndex(lifts)}
        raised={raised}
        focus={raised ? 3 : -1}
        held={held}
        arriving={NONE}
        carried={carried?.card.id ?? null}
        nudged={null}
        now={NOW}
        keys="mac"
        reducedMotion={false}
        win={win}
      />
      {carried !== null && <CarriedCardView carried={carried} viewport={win} />}
    </div>
  );
}

/** Where those came from, each over its own card as the reach shows it: the hand of FROM_FIXTURES
 * at rest, the pointer on that card's middle as the product measures it — the card up whole, and
 * above it where it came from. */
export function CardsFromPlate({ reach }: { readonly reach: string }): ReactElement {
  const layout = layoutCards(FROM_FIXTURES.length, PLATE, CARDS_LINE_RIGHT);
  const slot = layout.slots[FROM_FIXTURES.findIndex((card) => card.id === reach)];
  const lifts = reachLift(layout.slots, slot === undefined ? null : slot.x + CARD_W / 2);
  return (
    <div className="vf-ds-cards-plate" data-state="from" data-reach={reach}>
      <CardsView
        cards={FROM_FIXTURES}
        layout={layout}
        lifts={lifts}
        reached={reachedIndex(lifts)}
        raised={false}
        focus={-1}
        held={null}
        arriving={NONE}
        carried={null}
        nudged={null}
        now={NOW}
        keys="mac"
        reducedMotion={false}
        win={PLATE}
      />
    </div>
  );
}

/** The six faces at twice their size (and a drag's two waiting faces, the
 * two the desk's Copy deals, and what another app, Settings and History deal),
 * by the page's light or by the Moon's. */
export function CardFacesPlate({
  cards,
  night = false,
}: {
  cards: readonly Card[];
  night?: boolean;
}): ReactElement {
  return (
    <div className={night ? "vf-ds-card-faces dark" : "vf-ds-card-faces"}>
      {cards.map((card) => (
        <div key={card.id} className="vf-ds-card-2x">
          <div className="vf-ds-card-2x-inner">
            <CardFace card={card} />
          </div>
        </div>
      ))}
    </div>
  );
}
