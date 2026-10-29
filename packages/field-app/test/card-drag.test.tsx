// @vitest-environment happy-dom
/**
 * HN-4 — playing a card (DESIGN.md §8 "The hand", where cards go; HN-D4, HN-D6, HN-D7, HN-L2,
 * HN-L5). The one drag machine over fixture places, with the carried card's layer it draws; the
 * spring-loaded view cells of the line; Godview's panes as a place, through a fixture door; and
 * the desk as a place, on a fixture engine. The clock is faked: the spring's 520ms, the play's
 * shrink and flight home, the pane's input wait.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOTE_TYPE, PHOTO_TYPE, printRect } from "@vibecook/ice/desk/objects";
import type { FrameView, FrameViewState } from "@vibefield/contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deskCardTarget, followDeskCardTarget } from "../src/field/desk/desk-card-target";
import { type MountedDesk, publishDesk } from "../src/field/desk/desk-door";
import {
  CarriedCardLayer,
  CarriedCardView,
  carriedTransforms,
} from "../src/frame/cards/CarriedCardLayer";
import {
  CARRIED_LAYER_CLASS,
  type CardBox,
  type CardDragStart,
  type CarriedCard,
  getCarriedCard,
  moveCardDrag,
  PLAY_HOME_MS,
  PLAY_SHRINK_MS,
  playTimings,
  resetCardDragForTest,
  SPRING_LOAD_MS,
  startCardDrag,
} from "../src/frame/cards/card-drag";
import {
  type CardAnswer,
  type CardPlayed,
  type CardTarget,
  cardTargets,
  TARGET_LAYER,
} from "../src/frame/cards/card-targets";
import {
  type Card,
  type PictCard,
  type TextCard,
  termCardOf,
  textCardOf,
} from "../src/frame/cards/cards-model";
import { CardStore } from "../src/frame/cards/cards-store";
import { OUTCOME_WORDS, TARGET_WORDS } from "../src/frame/cards/cards-words";
import { hearLineSays, type LineViewDoor, refusalClaimed } from "../src/frame/line-door";
import { ViewsTrackView } from "../src/frame/ViewsTrack";
import { resetActiveViewForTest, subscribeActiveView } from "../src/frame/view-state";
import { type PaneInputSource, whenPaneInputOpen } from "../src/godview/line-panes";
import {
  PANE_INPUT_WAIT_MS,
  paneCardTarget,
  paneTextOf,
  shellPath,
} from "../src/godview/pane-card-target";
import { type FieldHost, setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import type { RoutedInputRefusal } from "../src/terminal/pool";

// The card's face is W-hand's (CardFace.tsx, HN-1): the layer is held to handing it the card.
vi.mock("../src/frame/cards/CardFace", () => ({
  CardFace: ({ card }: { readonly card: Card }) => (
    <div className="vf-card" data-kind={card.kind} data-card={card.id} />
  ),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
let offs: Array<() => void> = [];
let said: string[] = [];
let viewAsked: FrameView[] = [];
let viewHeard: ((state: FrameViewState) => void) | null = null;
let places = 0;

const ORIGIN = { view: "history", how: "copy" } as const;
const text = (words: string): TextCard =>
  textCardOf(words, { id: `card-text-${words.length}`, origin: ORIGIN, at: 0 });
const SNAPSHOT: PictCard = {
  id: "card-pict-1",
  kind: "pict",
  origin: { view: "canvas", how: "snapshot" },
  at: 0,
  title: "Snapshot",
  width: 1440,
  height: 900,
  src: "vibefield-still://stills/vibefield-screenshot-1.png",
  path: "/tmp/vibefield-screenshot-1.png",
  paste: "/tmp/vibefield-screenshot-1.png",
};
const FILE: Card = {
  id: "card-file-1",
  kind: "file",
  origin: ORIGIN,
  at: 0,
  name: "routes.ts",
  folder: "src/files",
  paste: "/Users/me/vibe-field/src/files/routes.ts",
};
const AGENT: Card = {
  id: "card-agent-1",
  kind: "agent",
  origin: ORIGIN,
  at: 0,
  handle: "claude·2",
  paste: "claude·2",
};
const MESSAGE: Card = {
  id: "card-msg-1",
  kind: "msg",
  origin: ORIGIN,
  at: 0,
  speaker: "claude",
  time: "13:58",
  words: "The routes moved into the files worker.",
  paste: "The routes moved into the files worker.",
};

/** Its slot in the fan, at rest, as the hand's `home()` answers it: untilted — a flight carries
 * no turn, and the fan settles the card into its tilt once it is back. */
const HOME: CardBox = { left: 540, top: 712, width: 104, height: 146 };

const dragOf = (card: Card, over: Partial<CardDragStart> = {}): CardDragStart => ({
  card,
  source: "hand",
  pointerId: 7,
  at: { x: 600, y: 700 },
  grab: { x: 52, y: 20 },
  home: () => HOME,
  ...over,
});

/** The pointer, as the window hears it. */
const pointer = (
  type: "pointermove" | "pointerup" | "pointercancel",
  pointerId: number,
  x: number,
  y: number,
): void => {
  document.body.dispatchEvent(
    new PointerEvent(type, { pointerId, clientX: x, clientY: y, bubbles: true }),
  );
};

/** A DOM that hit-tests: what lies under each point, topmost first (happy-dom draws nothing). */
const hits = (under: (x: number, y: number) => Element[]): void => {
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: under });
};

/** What the carried card's label says now, or null when it shows none. */
const labelShown = (): string | null =>
  document.querySelector(".vf-cards-carried-label")?.textContent ?? null;

const boxed = <E extends Element>(element: E, rect: DOMRect): E => {
  element.getBoundingClientRect = () => rect;
  return element;
};

/** A fixture place, registered for the case: what it says, what it was handed. */
function place(options: {
  readonly kind?: CardTarget["kind"];
  readonly box: DOMRect;
  readonly element?: Element;
  readonly answer?: CardAnswer | null;
  readonly played?: CardPlayed;
}): { readonly played: Array<{ card: Card; at: { x: number; y: number } }> } {
  places += 1;
  const kind = options.kind ?? "pane";
  const played: Array<{ card: Card; at: { x: number; y: number } }> = [];
  const target: CardTarget = {
    id: `place-${places}`,
    kind,
    layer: TARGET_LAYER[kind],
    rect: () => options.box,
    ...(options.element === undefined ? {} : { element: () => options.element ?? null }),
    answer: () =>
      options.answer === undefined ? { ok: true, label: "Paste into vibe-field" } : options.answer,
    play: async (card, at) => {
      played.push({ card, at: { x: at.x, y: at.y } });
      return options.played ?? { ok: true, note: "Pasted into vibe-field" };
    },
  };
  offs.push(cardTargets.register(target));
  return { played };
}

/** The carried layer, and what else the case draws beside it (the line's shipping track). */
function mountLayer(beside: ReactElement | null = null): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <>
        {beside}
        <CarriedCardLayer />
      </>,
    ),
  );
}

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  resetCardDragForTest();
  resetActiveViewForTest();
  said = [];
  viewAsked = [];
  viewHeard = null;
  offs = [hearLineSays((note) => said.push(note))];
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    view: {
      set: async (view: FrameView) => {
        viewAsked.push(view);
        return { view };
      },
      onState: (handler: (state: FrameViewState) => void) => {
        viewHeard = handler;
        return () => {
          viewHeard = null;
        };
      },
    },
  } as FieldHost);
});

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container = null;
  for (const off of offs.splice(0)) off();
  resetCardDragForTest();
  document.body.innerHTML = "";
  delete (document as unknown as Record<string, unknown>)["elementsFromPoint"];
  vi.useRealTimers();
});

describe("the one drag machine (HN-4)", () => {
  it("over a place, shows its label and its ring; let go, one copy plays in, its outcome is said once, and the card flies home, still in the hand (HN-D4)", async () => {
    const store = new CardStore(() => 0);
    const card = text("Move the route table. Into the files worker before the cut.");
    store.deal(card);
    const { played } = place({ box: new DOMRect(100, 100, 400, 300) });
    mountLayer();

    act(() => startCardDrag(dragOf(card)));
    expect(document.querySelector(`.vf-cards-carried [data-card="${card.id}"]`)).not.toBeNull();
    expect(labelShown(), "nothing is under it yet").toBeNull();

    act(() => pointer("pointermove", 7, 300, 250));
    expect(getCarriedCard()?.answer).toEqual({
      kind: "pane",
      ok: true,
      label: "Paste into vibe-field",
    });
    expect(labelShown()).toBe("Paste into vibe-field");
    const ring = document.querySelector<HTMLElement>(".vf-cards-carried-ring");
    expect([ring?.style.left, ring?.style.top, ring?.style.width, ring?.style.height]).toEqual([
      "100px",
      "100px",
      "400px",
      "300px",
    ]);
    // another pointer's moves are not this drag's
    act(() => pointer("pointermove", 8, 900, 40));
    expect(getCarriedCard()?.x).toBe(300);

    act(() => pointer("pointerup", 7, 300, 250));
    expect(getCarriedCard()?.phase).toBe("play");
    // the place's ring stays while the card goes in, and fades (§6; under M6 it rings once)
    expect(getCarriedCard()?.ring).toEqual({ left: 100, top: 100, width: 400, height: 300 });
    expect(
      document.querySelector(".vf-cards-carried-ring")?.getAttribute("data-phase"),
      "the ring is not told to fade",
    ).toBe("play");
    await advance(PLAY_SHRINK_MS);
    expect(played).toEqual([{ card, at: { x: 300, y: 250 } }]);
    expect(said).toEqual(["Pasted into vibe-field"]);
    expect(getCarriedCard()?.phase).toBe("home");
    expect(getCarriedCard()?.home).toEqual(HOME);
    expect(getCarriedCard()?.ring, "a card going home rings nothing").toBeNull();
    expect(document.querySelector(".vf-cards-carried-ring")).toBeNull();

    await advance(PLAY_HOME_MS + 40);
    expect(getCarriedCard()).toBeNull();
    expect(document.querySelector(".vf-cards-carried")).toBeNull();
    expect(
      store.snapshot().cards.map((c) => c.id),
      "a played card is never spent",
    ).toEqual([card.id]);
    // the pointer is free again: a later let-go plays nothing
    act(() => pointer("pointerup", 7, 300, 250));
    expect(played).toHaveLength(1);
  });

  it("a refusal says so under the pointer, in the same voice and with no ring; let go, the card goes straight home and nothing plays", async () => {
    const card = text("Keep track of my agents.");
    const { played } = place({
      kind: "desk",
      box: new DOMRect(0, 0, 1180, 780),
      answer: { ok: false, label: "Put it down first" },
    });
    mountLayer();

    act(() => startCardDrag(dragOf(card)));
    act(() => pointer("pointermove", 7, 400, 300));
    expect(labelShown()).toBe("Put it down first");
    expect(document.querySelector(".vf-cards-carried-ring")).toBeNull();

    act(() => pointer("pointerup", 7, 400, 300));
    expect(getCarriedCard()?.phase).toBe("home");
    await advance(PLAY_HOME_MS + 40);
    expect(getCarriedCard()).toBeNull();
    expect(played).toEqual([]);
    expect(said).toEqual([]);
  });

  it("let go over nothing, it flies straight home and nothing is said", async () => {
    mountLayer();
    act(() => startCardDrag(dragOf(text("Nowhere."))));
    act(() => pointer("pointermove", 7, 400, 300));
    expect(getCarriedCard()?.answer).toBeNull();
    act(() => pointer("pointerup", 7, 400, 300));
    expect(getCarriedCard()?.phase).toBe("home");
    await advance(PLAY_HOME_MS + 40);
    expect(getCarriedCard()).toBeNull();
    expect(said).toEqual([]);
  });

  it("Esc while carrying sends it home, heard before anything under it; the window's blur does too", async () => {
    const { played } = place({ box: new DOMRect(100, 100, 400, 300) });
    mountLayer();
    const below = vi.fn();
    document.addEventListener("keydown", below);
    offs.push(() => document.removeEventListener("keydown", below));

    act(() => startCardDrag(dragOf(text("Escape."))));
    act(() => pointer("pointermove", 7, 300, 250));
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(esc);
    });
    expect(esc.defaultPrevented).toBe(true);
    expect(below, "Esc reached what lies under the carried card").not.toHaveBeenCalled();
    expect(getCarriedCard()?.phase).toBe("home");
    // the pointer is no longer the drag's
    act(() => pointer("pointerup", 7, 300, 250));
    await advance(PLAY_HOME_MS + 40);
    expect(played).toEqual([]);
    expect(getCarriedCard()).toBeNull();

    act(() => startCardDrag(dragOf(text("Blurred."))));
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(getCarriedCard()?.phase).toBe("home");
    await advance(PLAY_HOME_MS + 40);
    expect(getCarriedCard()).toBeNull();
    expect(played).toEqual([]);
  });

  it("spring-loads a view's cell on the line's own track: held 520ms, that view opens under the card — never before, once per hover", async () => {
    mountLayer(<ViewsTrackView view="canvas" keys="mac" />);
    // the shipping cells, found as a person finds them — by their names, not their classes
    const cellNamed = (name: string, box: DOMRect): HTMLElement => {
      const cell = document.querySelector<HTMLElement>(`button[aria-label="${name}"]`);
      if (cell === null) throw new Error(`the track drew no "${name}" cell`);
      return boxed(cell, box);
    };
    const godview = cellNamed("Godview", new DOMRect(130, 716, 46, 36));
    const assistant = cellNamed("Assistant, not built yet", new DOMRect(226, 716, 46, 36));
    // under a point on a cell: its glyph, the cell, the page
    hits((x, y) => {
      for (const cell of [godview, assistant]) {
        const r = cell.getBoundingClientRect();
        if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
          return [cell.querySelector(".vf-views-glyph") ?? cell, cell, document.body];
        }
      }
      return [document.body];
    });

    act(() => startCardDrag(dragOf(text("Copy in History, play in Godview."))));
    act(() => pointer("pointermove", 7, 150, 730));
    expect(getCarriedCard()?.opening).toEqual({ view: "godview", progress: 0 });
    expect(labelShown()).toBe("Opening Godview");
    expect(document.querySelector(".vf-cards-carried-opening")).not.toBeNull();

    await advance(SPRING_LOAD_MS - 1);
    expect(viewAsked, "the view opened before the hold was done").toEqual([]);
    await advance(1);
    expect(viewAsked).toEqual(["godview"]);
    expect(getCarriedCard()?.opening).toBeNull();

    // held on, it does not ask again
    act(() => pointer("pointermove", 7, 152, 731));
    await advance(SPRING_LOAD_MS * 3);
    expect(viewAsked).toEqual(["godview"]);

    // leaving resets the clock: a short hover opens nothing, a new full one opens again
    act(() => pointer("pointermove", 7, 600, 400));
    act(() => pointer("pointermove", 7, 150, 730));
    await advance(300);
    act(() => pointer("pointermove", 7, 600, 400));
    await advance(SPRING_LOAD_MS);
    expect(viewAsked).toEqual(["godview"]);
    act(() => pointer("pointermove", 7, 150, 730));
    await advance(SPRING_LOAD_MS);
    expect(viewAsked).toEqual(["godview", "godview"]);

    // the view already open opens nothing, nor does the cell that waits ("not built yet")
    act(() => pointer("pointermove", 7, 600, 400));
    act(() => viewHeard?.({ view: "godview" }));
    act(() => pointer("pointermove", 7, 150, 730));
    expect(getCarriedCard()?.opening).toBeNull();
    act(() => pointer("pointermove", 7, 600, 400));
    act(() => pointer("pointermove", 7, 250, 730));
    expect(getCarriedCard()?.opening).toBeNull();
    await advance(SPRING_LOAD_MS * 2);
    expect(viewAsked).toEqual(["godview", "godview"]);

    // let go over a cell: nothing plays, it goes home
    act(() => pointer("pointerup", 7, 150, 730));
    expect(getCarriedCard()?.phase).toBe("home");
  });

  it("ducks to 0.55 over the line's box, read from the DOM", () => {
    mountLayer();
    document.body.append(
      Object.assign(boxed(document.createElement("div"), new DOMRect(76, 708, 300, 52)), {
        className: "vf-line",
      }),
    );
    act(() => startCardDrag(dragOf(text("Duck."))));
    act(() => pointer("pointermove", 7, 200, 730));
    expect(getCarriedCard()?.ducked).toBe(true);
    const size = (): number | null => {
      const carried = getCarriedCard();
      return carried === null ? null : carriedTransforms(carried).scale;
    };
    expect(size()).toBe(0.55);
    act(() => pointer("pointermove", 7, 600, 400));
    expect(getCarriedCard()?.ducked).toBe(false);
    expect(size()).toBe(1.06);
  });

  it("never takes itself for a place: its layer is inert and hidden, and a stack that starts with the carried card still finds the pane under it", () => {
    const { root: deck } = deckOf();
    offs.push(cardTargets.register(paneCardTarget({ root: () => deck, door: () => doorOf() })));
    mountLayer();
    act(() => startCardDrag(dragOf(text("Over a pane."))));
    const layer = document.querySelector(`.${CARRIED_LAYER_CLASS}`);
    expect(layer?.hasAttribute("inert"), "the carried card would take the pointer").toBe(true);
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    // a browser that let the card's own `pointer-events: auto` win would put the card on top
    const face = document.querySelector(".vf-cards-carried .vf-card");
    const pane = deck.querySelector('[data-pane-id="pane-2"]');
    if (face === null || pane === null) throw new Error("the card or the pane is not drawn");
    hits(() => [face, pane, deck, document.body]);
    act(() => pointer("pointermove", 7, 900, 300));
    expect(getCarriedCard()?.answer).toEqual({
      kind: "pane",
      ok: true,
      label: "Paste into rosetta",
    });
    expect(getCarriedCard()?.ring).toEqual({ left: 590, top: 52, width: 590, height: 640 });
  });

  it("a hand drag holds its pointer for the carry — captured on the hand, the cursor grabbing — and lets both go when the card is let go", async () => {
    const hand = document.createElement("div");
    hand.className = "vf-cards";
    document.body.append(hand);
    const grabbing = (): boolean => document.documentElement.hasAttribute("data-vf-cards-carrying");
    mountLayer();

    act(() => startCardDrag(dragOf(text("Held."))));
    expect(hand.hasPointerCapture(7), "what lay under the card would hear the pointer").toBe(true);
    expect(grabbing()).toBe(true);
    act(() => pointer("pointerup", 7, 400, 300));
    expect(getCarriedCard()?.phase).toBe("home");
    expect(hand.hasPointerCapture(7)).toBe(false);
    expect(grabbing()).toBe(false);
    await advance(PLAY_HOME_MS + 40);

    // Esc lets both go too
    act(() => startCardDrag(dragOf(text("Esc."))));
    expect(grabbing()).toBe(true);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(hand.hasPointerCapture(7)).toBe(false);
    expect(grabbing()).toBe(false);
    await advance(PLAY_HOME_MS + 40);

    // a drag from another app holds no pointer of the window's: the system's drag owns the cursor
    act(() =>
      startCardDrag(
        dragOf(text("From Notes."), { source: "outside", pointerId: null, home: () => null }),
      ),
    );
    expect(grabbing()).toBe(false);
  });

  it("halves the play and the flight home under reduced motion (M6), and hands the layer those lengths", async () => {
    expect(playTimings(false)).toEqual({ shrinkMs: PLAY_SHRINK_MS, homeMs: PLAY_HOME_MS });
    expect(playTimings(true)).toEqual({ shrinkMs: PLAY_SHRINK_MS / 2, homeMs: PLAY_HOME_MS / 2 });
    const carried: CarriedCard = {
      card: text("Reduced."),
      source: "hand",
      x: 300,
      y: 250,
      grab: { x: 52, y: 20 },
      answer: null,
      opening: null,
      phase: "play",
      drag: 1,
      tilt: 0,
      ducked: false,
      ring: { left: 100, top: 100, width: 400, height: 300 },
      cell: null,
      home: null,
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(<CarriedCardView carried={carried} reducedMotion viewport={{ width: 1180 }} />),
    );
    const layer = document.querySelector<HTMLElement>(`.${CARRIED_LAYER_CLASS}`);
    expect(layer?.style.getPropertyValue("--vf-cards-carried-play-ms")).toBe("100ms");
    expect(layer?.style.getPropertyValue("--vf-cards-carried-home-ms")).toBe("220ms");
    act(() => root?.unmount());
    root = null;

    // the machine's own clock follows the person's setting: home in half the time
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      act(() => startCardDrag(dragOf(text("Home soon."))));
      act(() => pointer("pointerup", 7, 400, 300));
      expect(getCarriedCard()?.phase).toBe("home");
      await advance(PLAY_HOME_MS / 2 + 40);
      expect(getCarriedCard(), "the flight home was not halved").toBeNull();
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it("only what is on top answers: a place with the line, the head or the hand over it takes nothing there", () => {
    const deck = document.createElement("section");
    const inDeck = document.createElement("div");
    deck.append(inDeck);
    const line = document.createElement("div");
    document.body.append(deck, line);
    place({ box: new DOMRect(0, 52, 1180, 640), element: deck });
    let over: Element = inDeck;
    hits(() => [over, document.body]);
    mountLayer();

    act(() => startCardDrag(dragOf(text("On top."))));
    act(() => pointer("pointermove", 7, 300, 300));
    expect(getCarriedCard()?.answer?.label).toBe("Paste into vibe-field");
    over = line;
    act(() => pointer("pointermove", 7, 300, 301));
    expect(getCarriedCard()?.answer).toBeNull();
  });

  it("from another app, only a pane or the prompt takes it straight; anywhere else, the desk included, it is for the hand", () => {
    place({ kind: "desk", box: new DOMRect(0, 0, 1180, 780) });
    place({ kind: "pane", box: new DOMRect(600, 100, 400, 300) });
    mountLayer();
    act(() =>
      startCardDrag(
        dragOf(text("From Notes."), { source: "outside", pointerId: null, home: () => null }),
      ),
    );
    act(() => moveCardDrag(200, 600));
    expect(getCarriedCard()?.answer).toEqual({ kind: "hand", ok: true, label: "Into your hand" });
    act(() => moveCardDrag(700, 200));
    expect(getCarriedCard()?.answer?.kind).toBe("pane");
    // an outside drag hears no window pointer of its own
    act(() => pointer("pointermove", 7, 200, 600));
    expect(getCarriedCard()?.x).toBe(700);
  });

  it("draws the carried card hung from its grab point, lifted, and home on the slot's pivot (PURE)", () => {
    const carried: CarriedCard = {
      card: text("Pure."),
      source: "hand",
      x: 300,
      y: 250,
      grab: { x: 52, y: 20 },
      answer: null,
      opening: null,
      phase: "carry",
      drag: 1,
      tilt: 4,
      ducked: false,
      ring: null,
      cell: null,
      home: null,
    };
    // its turn and its hang on `transform`, its size apart (the `scale` property, its own time)
    expect(carriedTransforms(carried)).toEqual({
      anchor: "translate3d(300px, 250px, 0)",
      card: "rotate(4deg) translate(-52px, -20px)",
      scale: 1.06,
    });
    expect(carriedTransforms({ ...carried, ducked: true }).scale).toBe(0.55);
    expect(carriedTransforms({ ...carried, phase: "play", tilt: 0 })).toMatchObject({
      card: "rotate(0deg) translate(-52px, -20px)",
      scale: 0.12,
    });
    expect(carriedTransforms({ ...carried, phase: "home", tilt: 0, home: HOME })).toEqual({
      anchor: "translate3d(592px, 894.5px, 0)",
      card: "rotate(0deg) translate(-52px, -182.5px)",
      scale: 1,
    });
    // a slot that names a turn is landed on about the fan's own pivot
    const turned = { ...HOME, rotate: -3 };
    expect(carriedTransforms({ ...carried, phase: "home", tilt: 0, home: turned }).card).toBe(
      "rotate(-3deg) translate(-52px, -182.5px)",
    );
  });

  it("wears the lifted shadow while carried and the resting one going home, the face's own turn and scale held at rest (the card reads all three)", () => {
    const css = readFileSync(join(process.cwd(), "src/frame/cards/carried.css"), "utf8");
    const rule = (selector: string): string =>
      css.slice(css.indexOf(`${selector} {`)).split("}")[0] ?? "";
    const carriedRule = rule(".vf-cards-carried");
    expect(carriedRule).toContain("--vf-cards-lp: 1;");
    expect(carriedRule).toContain("--vf-cards-r: 0deg;");
    expect(carriedRule).toContain("--vf-cards-s: 1;");
    expect(rule('.vf-cards-carried[data-phase="home"]')).toContain("--vf-cards-lp: 0;");
  });

  it("keeps the duck's own time, fades the place's ring through the play, and grabs the cursor for the carry (§6, §7)", () => {
    const css = readFileSync(join(process.cwd(), "src/frame/cards/carried.css"), "utf8");
    const rule = (selector: string): string =>
      css.slice(css.indexOf(`${selector} {`)).split("}")[0] ?? "";
    // the lean in 90ms (the page's), the size — the duck to 0.55 — in 160ms plain ease
    expect(rule(".vf-cards-carried-card")).toMatch(/transform 90ms ease,\s*scale 160ms ease;/);
    expect(rule('.vf-cards-carried-ring[data-phase="play"]')).toContain(
      "vf-cards-carried-ring-out 120ms ease",
    );
    expect(css).toMatch(/@keyframes vf-cards-carried-ring-out \{\s*to \{\s*opacity: 0;/);
    expect(rule(":root[data-vf-cards-carrying] *")).toContain("cursor: grabbing !important;");
  });
});

// ── Godview's panes ─────────────────────────────────────────────────────────

/** A deck as ghosttea lays it out: two panes side by side under the deck's own element. */
function deckOf(): { root: HTMLElement; panes: HTMLElement[] } {
  const root = boxed(document.createElement("div"), new DOMRect(0, 52, 1180, 640));
  root.className = "vf-deck-zoom";
  const panes = [
    boxed(document.createElement("div"), new DOMRect(0, 52, 590, 640)),
    boxed(document.createElement("div"), new DOMRect(590, 52, 590, 640)),
  ];
  panes.forEach((pane, i) => {
    pane.className = "ghostty-pane";
    pane.dataset.paneId = `pane-${i + 1}`;
  });
  root.append(...panes);
  document.body.append(root);
  return { root, panes };
}

function doorOf(over: Partial<LineViewDoor> = {}): LineViewDoor & {
  readonly pasted: Array<[string, string]>;
} {
  const pasted: Array<[string, string]> = [];
  return {
    pasted,
    panes: [
      {
        paneId: "pane-1",
        sessionId: "s-vibe",
        name: "vibe-field",
        runs: "Claude Code",
        state: "working",
        active: true,
      },
      {
        paneId: "pane-2",
        sessionId: "s-ros",
        name: "rosetta",
        runs: "shell",
        state: null,
        active: false,
      },
    ],
    onScreen: true,
    newTerminal: async () => ({ state: "opened" }),
    pasteInto: (paneId, words) => {
      pasted.push([paneId, words]);
      return true;
    },
    whenInputOpen: async () => true,
    canPlace: true,
    place: async () => ({ state: "opened" }),
    reveal: async () => ({ state: "opened" }),
    ...over,
  };
}

describe("Godview's panes take a card (HN-4, HN-L5)", () => {
  it("answers by the pane under the point, named as the line names it and ringed on that pane; between panes, nothing", () => {
    const { root } = deckOf();
    const door = doorOf();
    const target = paneCardTarget({ root: () => root, door: () => door });
    const card = text("Run the tests.");

    const over = target.answer(card, { x: 900, y: 300 });
    expect([over?.ok, over?.label, over?.ring?.left, over?.ring?.width]).toEqual([
      true,
      "Paste into rosetta",
      590,
      590,
    ]);
    expect(target.answer(card, { x: 300, y: 300 })?.label).toBe("Paste into vibe-field");
    expect(target.answer(card, { x: 300, y: 20 }), "above the panes").toBeNull();
    expect(target.rect()?.top).toBe(52);
  });

  it("passes over a zoomed pane's hidden siblings, and an inert deck (away, curtained, covered) takes nothing", () => {
    const { root, panes } = deckOf();
    const [one, two] = panes;
    if (one === undefined || two === undefined) throw new Error("the deck drew two panes");
    // pane-1 is zoomed over the whole deck; pane-2 keeps its box, hidden — and comes first
    root.prepend(two);
    two.style.visibility = "hidden";
    one.getBoundingClientRect = () => new DOMRect(0, 52, 1180, 640);
    const target = paneCardTarget({ root: () => root, door: () => doorOf() });
    expect(target.answer(text("Zoomed."), { x: 900, y: 300 })?.label).toBe("Paste into vibe-field");

    const away = document.createElement("section");
    away.setAttribute("inert", "");
    away.append(root);
    document.body.append(away);
    expect(target.rect()).toBeNull();
  });

  it("says what each kind puts in: words as they are, a file's path and a picture's file shell-quoted, an agent's handle", () => {
    expect(paneTextOf(text("Run the tests. Then push."))).toBe("Run the tests. Then push.");
    expect(paneTextOf(MESSAGE)).toBe("The routes moved into the files worker.");
    const run = termCardOf("pnpm test\n✓ 12 passed", { id: "t", origin: ORIGIN, at: 0 });
    expect(paneTextOf(run)).toBe("pnpm test\n✓ 12 passed");
    // a line break at the end is Return to a program that never asked for bracketed paste, and
    // Return is never pressed for you: the words go in without it — the breaks inside are theirs
    expect(paneTextOf(text("echo hello\n"))).toBe("echo hello");
    expect(paneTextOf(text("first\r\nsecond\r\n\n"))).toBe("first\r\nsecond");
    const ran = termCardOf("pnpm test\n✓ 12 passed\n", { id: "t2", origin: ORIGIN, at: 0 });
    expect(paneTextOf(ran)).toBe("pnpm test\n✓ 12 passed");
    // …for every kind, in the one place: whatever a card gives, it gives without a final break
    const hung: Card = {
      id: "card-agent-2",
      kind: "agent",
      origin: ORIGIN,
      at: 0,
      handle: "claude·2\r\n",
      paste: "claude·2",
    };
    expect(paneTextOf(hung)).toBe("claude·2");
    expect(paneTextOf(FILE)).toBe("/Users/me/vibe-field/src/files/routes.ts");
    expect(paneTextOf(SNAPSHOT)).toBe("/tmp/vibefield-screenshot-1.png");
    expect(paneTextOf(AGENT)).toBe("claude·2");
    const { path: _path, ...noFile } = SNAPSHOT;
    expect(paneTextOf(noFile)).toBeNull();
    expect(shellPath("/Users/me/My Files/a.png")).toBe("'/Users/me/My Files/a.png'");
    expect(shellPath("/Users/me/don't stop.txt")).toBe("'/Users/me/don'\\''t stop.txt'");

    const { root } = deckOf();
    const target = paneCardTarget({ root: () => root, door: () => doorOf() });
    expect(target.answer(noFile, { x: 300, y: 300 })).toMatchObject({
      ok: false,
      label: "A picture with no file can't be pasted yet",
    });
  });

  it("plays into the pane under the point through the door, once its input is open, and says so", async () => {
    const { root } = deckOf();
    const whenInputOpen = vi.fn(async () => true);
    const door = doorOf({ whenInputOpen });
    const target = paneCardTarget({ root: () => root, door: () => door });

    await expect(target.play(FILE, { x: 900, y: 300 })).resolves.toEqual({
      ok: true,
      note: OUTCOME_WORDS.pasted("rosetta"),
    });
    expect(door.pasted).toEqual([["pane-2", "/Users/me/vibe-field/src/files/routes.ts"]]);
    expect(whenInputOpen).toHaveBeenCalledWith("pane-2", PANE_INPUT_WAIT_MS);
    await expect(target.play(FILE, { x: 300, y: 20 })).resolves.toEqual({
      ok: false,
      note: OUTCOME_WORDS.paneGone,
    });
    // a note ending in a line break goes in without it: nothing runs the line for you
    await target.play(text("echo hello\n"), { x: 300, y: 300 });
    expect(door.pasted.at(-1)).toEqual(["pane-1", "echo hello"]);
  });

  it("asks main whether a snapshot's still is still kept: a still let go is pasted nowhere, and says so", async () => {
    const { root } = deckOf();
    const whenInputOpen = vi.fn(async () => true);
    const door = doorOf({ whenInputOpen });
    const asked: string[] = [];
    let kept = false;
    const target = paneCardTarget({
      root: () => root,
      door: () => door,
      host: {
        screenshotStillKept: async (path) => {
          asked.push(path);
          return kept;
        },
      },
    });

    await expect(target.play(SNAPSHOT, { x: 900, y: 300 })).resolves.toEqual({
      ok: false,
      note: "Not pasted — that snapshot is no longer kept",
    });
    expect(asked).toEqual(["/tmp/vibefield-screenshot-1.png"]);
    expect(door.pasted, "a pane was handed a path to nothing").toEqual([]);
    expect(whenInputOpen, "a still let go waited on the pane's input").not.toHaveBeenCalled();

    kept = true;
    await expect(target.play(SNAPSHOT, { x: 900, y: 300 })).resolves.toEqual({
      ok: true,
      note: OUTCOME_WORDS.pasted("rosetta"),
    });
    expect(door.pasted).toEqual([["pane-2", "/tmp/vibefield-screenshot-1.png"]]);
    // only a snapshot's still is asked about: words, a file and an agent are pasted as they are
    for (const card of [text("Run it."), FILE, AGENT]) await target.play(card, { x: 900, y: 300 });
    expect(asked).toHaveLength(2);
  });

  it("waits for a pane's input on the runtime's announcement, bounded: open the moment it opens, closed at the bound", async () => {
    const hearers = new Set<() => void>();
    let inputAllowed = false;
    const source: PaneInputSource = {
      routedActivation: () => ({ inputAllowed }),
      addEventListener: (_type, hear) => {
        hearers.add(hear);
      },
      removeEventListener: (_type, hear) => {
        hearers.delete(hear);
      },
    };
    const answers: boolean[] = [];

    void whenPaneInputOpen(source, () => "s-ros", PANE_INPUT_WAIT_MS).then((open) => {
      answers.push(open);
    });
    await advance(PANE_INPUT_WAIT_MS - 1);
    expect(answers).toEqual([]);
    inputAllowed = true;
    for (const hear of [...hearers]) hear();
    await advance(0);
    expect(answers).toEqual([true]);
    expect(hearers.size, "the wait kept listening").toBe(0);

    inputAllowed = false;
    void whenPaneInputOpen(source, () => "s-ros", PANE_INPUT_WAIT_MS).then((open) => {
      answers.push(open);
    });
    for (const hear of [...hearers]) hear();
    await advance(PANE_INPUT_WAIT_MS - 1);
    expect(answers, "an announcement that opened nothing ended the wait").toEqual([true]);
    await advance(1);
    expect(answers).toEqual([true, false]);
    expect(hearers.size).toBe(0);
  });

  it("a pane whose input never opened in its wait is handed nothing, and says it is not taking input", async () => {
    const { root } = deckOf();
    const door = doorOf({ whenInputOpen: async () => false });
    const target = paneCardTarget({ root: () => root, door: () => door });
    await expect(target.play(text("Too soon."), { x: 300, y: 300 })).resolves.toEqual({
      ok: false,
      note: "Not pasted — vibe-field's pane is not taking input",
    });
    expect(door.pasted).toEqual([]);
  });

  it("D6: a paste too large for the terminal is the play's own refusal, said once in the line's words", async () => {
    const { root } = deckOf();
    let refusal: RoutedInputRefusal = {
      sessionId: "s-ros",
      kind: "paste",
      bytes: 300_000,
      limitBytes: 261_000,
    };
    let hear: ((refused: RoutedInputRefusal) => void) | null = null;
    const claimed: boolean[] = [];
    const door = doorOf({
      // the pane's handler claims the paste; the encoder refuses it INSIDE the call
      pasteInto: () => {
        claimed.push(refusalClaimed());
        hear?.(refusal);
        return true;
      },
    });
    const target = paneCardTarget({
      root: () => root,
      door: () => door,
      inputRefusals: (heard) => {
        hear = heard;
        return () => {
          hear = null;
        };
      },
    });

    await expect(target.play(text("A long paste."), { x: 900, y: 300 })).resolves.toEqual({
      ok: false,
      note: "Not pasted into rosetta — 300 KB, and one paste carries 261 KB of it",
    });
    expect(claimed, "the line's hearer would have said it too").toEqual([true]);
    expect(refusalClaimed(), "claimed past the paste").toBe(false);
    expect(hear, "the play kept hearing").toBeNull();

    // the pane's session was replaced while the card waited for its input (⌘T, a Resume): the
    // refusal names the new session, and it is still this paste's — said once, as the play's
    // outcome, never "Pasted into rosetta" after the line had said it was not
    refusal = { ...refusal, sessionId: "s-new" };
    await expect(target.play(text("A long paste."), { x: 900, y: 300 })).resolves.toEqual({
      ok: false,
      note: "Not pasted into rosetta — 300 KB, and one paste carries 261 KB of it",
    });
    expect(claimed).toEqual([true, true]);
    expect(refusalClaimed()).toBe(false);
  });
});

// ── The desk ────────────────────────────────────────────────────────────────

/** A desk on a fixture engine: one spawn op, the selection, the board's facts, its camera. */
function deskOf(
  options: { readonly readOnly?: boolean; readonly held?: boolean; readonly open?: boolean } = {},
) {
  const box = boxed(document.createElement("div"), new DOMRect(0, 0, 1180, 780));
  box.setAttribute("data-ice-canvas", "");
  const canvas = document.createElement("canvas");
  box.append(canvas);
  document.body.append(box);
  const spawned: Array<{ type: string; at: Record<string, unknown> }> = [];
  const selected: unknown[][] = [];
  const arrived: unknown[] = [];
  const session = { readOnly: options.readOnly ?? false };
  // the pegboard's anchor as the desk reads it at each ask: a case may change it mid-play
  const tray = { open: options.open ?? false, held: options.held ?? false };
  const desk = {
    engine: {
      // the view's top-left is world (100, 50), at 2 screen px a world unit
      world: { getResource: () => ({ x: 100, y: 50, zoom: 2, gesturing: false }) },
      docs: { current: () => session },
      catalog: {
        widget: (type: string) =>
          type === NOTE_TYPE ? { defaultSize: { w: 220, h: 220 } } : undefined,
      },
      ops: {
        spawnWidget: (type: string, at: Record<string, unknown>) => {
          spawned.push({ type, at });
          return spawned.length;
        },
        setSelection: (ids: readonly unknown[]) => {
          selected.push([...ids]);
        },
      },
    },
    handle: {
      canvas,
      tray: { anchor: () => ({ ...tray }) },
      local: (name: string) =>
        name === "photo" ? { arrive: (entity: unknown) => arrived.push(entity) } : undefined,
    },
    generation: 0,
    mount: 0,
    theme: "light",
  } as unknown as MountedDesk;
  return { desk, spawned, selected, arrived, tray };
}

describe("the desk takes a card (HN-D7)", () => {
  it("text, a message or a terminal's lines land as a note centred where it is let go, one spawn, selected", async () => {
    for (const card of [
      text("Move the route table."),
      MESSAGE,
      termCardOf("pnpm test", { id: "t", origin: ORIGIN, at: 0 }),
    ]) {
      const { desk, spawned, selected } = deskOf();
      const target = deskCardTarget(desk, { host: {} });
      expect(target.answer(card, { x: 400, y: 300 })).toEqual({
        ok: true,
        label: "Place as a note",
      });
      await expect(target.play(card, { x: 400, y: 300 })).resolves.toEqual({
        ok: true,
        note: OUTCOME_WORDS.placedNote,
      });
      // client (400, 300) → world (100 + 400 / 2, 50 + 300 / 2) = (300, 200); 220 centred on it
      expect(spawned).toEqual([
        { type: NOTE_TYPE, at: { x: 190, y: 90, w: 220, h: 220, props: { text: card.paste } } },
      ]);
      expect(selected).toEqual([[1]]);
      document.body.innerHTML = "";
    }
  });

  it("a picture lands as a print from its own bytes, kept in the byte store first, falling in", async () => {
    const { desk, spawned, selected, arrived } = deskOf();
    const put = vi.fn(async (_bytes: Uint8Array<ArrayBuffer>, _type: string) => "hash-1");
    const copied: PictCard = {
      ...SNAPSHOT,
      bytes: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
    };
    const { path: _path, ...ofTheDesk } = copied;
    const target = deskCardTarget(desk, { host: {}, blobs: { put } });
    expect(target.answer(ofTheDesk, { x: 400, y: 300 })).toEqual({
      ok: true,
      label: "Place as a print",
    });

    await expect(target.play(ofTheDesk, { x: 400, y: 300 })).resolves.toEqual({
      ok: true,
      note: OUTCOME_WORDS.placedPrint,
    });
    expect([...(put.mock.calls[0]?.[0] ?? [])]).toEqual([137, 80, 78, 71]);
    expect(put.mock.calls[0]?.[1]).toBe("image/png");
    const r = printRect(300, 200, 1440, 900);
    expect(spawned).toEqual([
      {
        type: PHOTO_TYPE,
        at: {
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          props: { blob: "hash-1", width: 1440, height: 900, angle: 0 },
        },
      },
    ]);
    expect(arrived).toEqual([1]);
    expect(selected).toEqual([[1]]);
  });

  it("a snapshot is printed from its still, asked of the shell by its path; a still no longer kept says so", async () => {
    const kept = deskOf();
    const put = vi.fn(async (_bytes: Uint8Array<ArrayBuffer>, _type: string) => "hash-2");
    const stillBytes = vi.fn(async (_path: string) => new Uint8Array([1, 2, 3]));
    const target = deskCardTarget(kept.desk, {
      host: { screenshotStillBytes: stillBytes },
      blobs: { put },
    });
    await expect(target.play(SNAPSHOT, { x: 400, y: 300 })).resolves.toEqual({
      ok: true,
      note: OUTCOME_WORDS.placedPrint,
    });
    expect(stillBytes).toHaveBeenCalledWith("/tmp/vibefield-screenshot-1.png");
    expect([...(put.mock.calls[0]?.[0] ?? [])]).toEqual([1, 2, 3]);
    expect(kept.spawned.map((s) => s.type)).toEqual([PHOTO_TYPE]);

    const gone = deskOf();
    const lost = deskCardTarget(gone.desk, {
      host: { screenshotStillBytes: async () => null },
      blobs: { put },
    });
    await expect(lost.play(SNAPSHOT, { x: 400, y: 300 })).resolves.toEqual({
      ok: false,
      note: "Not placed — that snapshot is no longer kept",
    });
    expect(gone.spawned).toEqual([]);
  });

  it("asks the desk again once the bytes have come: taken into hand, the pegboard out, or another view meanwhile, it lays nothing", async () => {
    // the view is followed from the fixture host (`viewHeard`), as the frame follows it
    offs.push(subscribeActiveView(() => undefined));
    const cases: Array<[string, (f: ReturnType<typeof deskOf>) => void, string]> = [
      ["held", (f) => Object.assign(f.tray, { held: true }), TARGET_WORDS.deskHeld],
      ["out", (f) => Object.assign(f.tray, { open: true }), TARGET_WORDS.deskBoardOut],
      ["covered", () => act(() => viewHeard?.({ view: "godview" })), OUTCOME_WORDS.notPlaced],
    ];
    for (const [name, meanwhile, words] of cases) {
      act(() => viewHeard?.({ view: "canvas" }));
      const f = deskOf();
      let send: (bytes: Uint8Array<ArrayBuffer>) => void = () => undefined;
      const target = deskCardTarget(f.desk, {
        host: {
          screenshotStillBytes: () =>
            new Promise((resolve) => {
              send = resolve;
            }),
        },
        blobs: { put: async () => "hash-3" },
      });
      const played = target.play(SNAPSHOT, { x: 400, y: 300 });
      await advance(0);
      meanwhile(f);
      send(new Uint8Array([1, 2, 3]));
      await expect(played, name).resolves.toEqual({ ok: false, note: words });
      expect(f.spawned, name).toEqual([]);
      expect(f.selected, name).toEqual([]);
      document.body.innerHTML = "";
    }
  });

  it("refuses in the desk's own words, and a refused play lays nothing", async () => {
    const cases: Array<[ReturnType<typeof deskOf>, Card, string]> = [
      [deskOf(), FILE, "The desk can't hold a file yet"],
      [deskOf(), AGENT, "The desk can't hold an agent yet"],
      [deskOf({ held: true }), text("In hand."), TARGET_WORDS.deskHeld],
      [deskOf({ open: true }), text("Board out."), TARGET_WORDS.deskBoardOut],
      [deskOf({ readOnly: true }), text("Read only."), TARGET_WORDS.deskReadOnly],
      // a snapshot with no still door to ask (a harness without the shell)
      [deskOf(), SNAPSHOT, TARGET_WORDS.deskNoPicture],
    ];
    for (const [{ desk, spawned }, card, words] of cases) {
      const target = deskCardTarget(desk, { host: {} });
      expect(target.answer(card, { x: 400, y: 300 })).toEqual({ ok: false, label: words });
      await expect(target.play(card, { x: 400, y: 300 })).resolves.toEqual({
        ok: false,
        note: words,
      });
      expect(spawned).toEqual([]);
    }
    expect(TARGET_WORDS.deskHeld).toBe("Put it down first");
    expect(TARGET_WORDS.deskBoardOut).toBe("Close the objects first");
    expect(TARGET_WORDS.deskReadOnly).toBe("This board is read-only");
  });

  it("is a place while Canvas is the view and a desk is mounted, and only then", () => {
    const desks = (): string[] =>
      cardTargets
        .list()
        .filter((target) => target.kind === "desk")
        .map((target) => target.id);
    // following the view attaches its mirror to the fixture host (`viewHeard`)
    offs.push(followDeskCardTarget());
    expect(desks()).toEqual([]);
    const unpublish = publishDesk(deskOf().desk);
    expect(desks()).toEqual(["desk"]);
    act(() => viewHeard?.({ view: "godview" }));
    expect(desks(), "a covered desk took a card").toEqual([]);
    act(() => viewHeard?.({ view: "canvas" }));
    expect(desks()).toEqual(["desk"]);
    unpublish();
    expect(desks()).toEqual([]);
  });
});
