// @vitest-environment happy-dom
/**
 * A card picked up turns toward the pointer (DESIGN.md §8 "Picking one up"; §6 "The hand", the turn; §5 "The lamp,
 * live"; item 596): up, it turns about its level and its upright as the pointer moves over the window, on a spring,
 * and how brightly the lamp lights it rides its own brightness; put back it straightens; under reduced motion it never
 * turns. The shipping CardsView from props, and the hand's stylesheet. The lamp's own surface needs WebGL2, which this
 * environment refuses: the card turns in its print's light, as it does wherever the lamp cannot be lit.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardsView, type CardsViewProps, heldCentre } from "../src/frame/cards/CardsView";
import {
  CARD_H,
  CARD_W,
  CARDS_LINE_RIGHT,
  type Card,
  layoutCards,
  textCardOf,
} from "../src/frame/cards/cards-model";
import { lampOn, normalOf } from "../src/frame/cards/lamp/turn";
import { TURN_PROPS } from "../src/frame/cards/lamp/use-held-turn";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CARDS_CSS = readFileSync(join(process.cwd(), "src/frame/cards/cards.css"), "utf8");

/** A rule's body in the hand's stylesheet: the first rule written with exactly this selector. */
function rule(selector: string): string {
  const from = CARDS_CSS.indexOf(`${selector} {`);
  return from < 0 ? "" : CARDS_CSS.slice(from, CARDS_CSS.indexOf("}", from));
}

const WIN = { width: 1180, height: 780 } as const;
const NOW = 1_000_000;
const card = (id: string): Card =>
  textCardOf(`Words of ${id}.`, {
    id,
    origin: { view: "godview", place: "claude·2", how: "copy" },
    at: NOW - 120_000,
  });
const CARDS = ["a", "b", "c"].map(card);
const REST = layoutCards(CARDS.length, WIN, CARDS_LINE_RIGHT);
const UP = { card: CARDS[1] as Card, phase: "up" as const };

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
});

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

function props(over: Partial<CardsViewProps> = {}): CardsViewProps {
  return {
    cards: CARDS,
    layout: REST,
    lifts: REST.slots.map(() => 0),
    reached: -1,
    raised: false,
    focus: -1,
    held: null,
    arriving: new Map(),
    carried: null,
    nudged: null,
    now: NOW,
    keys: "mac",
    reducedMotion: false,
    win: WIN,
    ...over,
  };
}

function mount(node: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

const layerOf = (el: HTMLElement): HTMLElement => {
  const layer = el.querySelector<HTMLElement>(".vf-cards-held");
  if (layer === null) throw new Error("no held layer");
  // the layer fills the window: the pointer is measured in it
  layer.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: WIN.width, height: WIN.height }) as DOMRect;
  return layer;
};
const turnOf = (el: HTMLElement): HTMLElement => {
  const turn = el.querySelector<HTMLElement>(".vf-cards-held .vf-cards-turn");
  if (turn === null) throw new Error("no turn");
  return turn;
};
const read = (el: HTMLElement, name: string): number =>
  Number(turnOf(el).style.getPropertyValue(name));

/** The pointer moved to a place in the window, and the frames that follow run for `ms`. */
function pointTo(el: HTMLElement, x: number, y: number, ms: number): void {
  const layer = layerOf(el);
  act(() => {
    layer.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
  });
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("a card picked up turns toward the pointer (DESIGN.md §8 'Picking one up')", () => {
  it("stands its turn between the held card and its flip, so the turn and Flip it are one card's", () => {
    const el = mount(<CardsView {...props({ held: UP })} />);
    const turn = el.querySelector(".vf-cards-heldcard > .vf-cards-turn");
    expect(turn).not.toBeNull();
    expect(turn?.querySelector(":scope > .vf-cards-flip > .vf-card[data-held]")).not.toBeNull();
    expect(turn?.querySelector(":scope > .vf-cards-flip > .vf-card-back")).not.toBeNull();
  });

  it("turns toward the pointer on its spring: up and right for a pointer at the window's top right", () => {
    const el = mount(<CardsView {...props({ held: UP })} />);
    // at rest it stands flat, and nothing is written
    expect(turnOf(el).style.getPropertyValue(TURN_PROPS.x)).toBe("");
    pointTo(el, WIN.width, 0, 1000);
    expect(read(el, TURN_PROPS.x)).toBeCloseTo(0.3, 3);
    expect(read(el, TURN_PROPS.y)).toBeCloseTo(0.42, 3);
    // and the lamp lights it as the press's diffuse says for a card turned so
    expect(read(el, TURN_PROPS.lamp)).toBeCloseTo(lampOn(normalOf({ x: 0.3, y: 0.42 }), false), 3);
  });

  it("is on its way after a few frames, never there at once", () => {
    const el = mount(<CardsView {...props({ held: UP })} />);
    pointTo(el, WIN.width, 0, 50);
    const soon = read(el, TURN_PROPS.y);
    expect(soon).toBeGreaterThan(0.02);
    expect(soon).toBeLessThan(0.4);
  });

  it("turns from the card's own middle: a pointer on it asks for no turn", () => {
    const el = mount(<CardsView {...props({ held: UP })} />);
    const centre = heldCentre(WIN);
    pointTo(el, WIN.width, 0, 1000);
    pointTo(el, centre.x + CARD_W / 2, centre.y + CARD_H / 2, 1000);
    expect(read(el, TURN_PROPS.x)).toBeCloseTo(0, 3);
    expect(read(el, TURN_PROPS.y)).toBeCloseTo(0, 3);
    expect(read(el, TURN_PROPS.lamp)).toBeCloseTo(1, 3);
  });

  it("straightens when the pointer leaves the window, and when it is put back", () => {
    const el = mount(<CardsView {...props({ held: UP })} />);
    pointTo(el, 0, WIN.height, 1000);
    expect(read(el, TURN_PROPS.y)).toBeCloseTo(-0.42, 3);
    act(() => {
      layerOf(el).dispatchEvent(
        new MouseEvent("pointerout", { bubbles: true, relatedTarget: null }),
      );
      layerOf(el).dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(read(el, TURN_PROPS.y)).toBeCloseTo(0, 3);
    pointTo(el, 0, WIN.height, 1000);
    act(() => root?.render(<CardsView {...props({ held: { ...UP, phase: "home" } })} />));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(read(el, TURN_PROPS.x)).toBeCloseTo(0, 3);
    expect(read(el, TURN_PROPS.y)).toBeCloseTo(0, 3);
    // home, it answers the pointer no more
    pointTo(el, WIN.width, 0, 1000);
    expect(read(el, TURN_PROPS.y)).toBeCloseTo(0, 3);
  });

  it("stands at a still's pose at once, and there the pointer moves nothing (the catalog's)", () => {
    const pose = { x: -0.2, y: 0.3 };
    const el = mount(<CardsView {...props({ held: { ...UP, pose } })} />);
    expect(read(el, TURN_PROPS.x)).toBeCloseTo(-0.2, 4);
    expect(read(el, TURN_PROPS.y)).toBeCloseTo(0.3, 4);
    expect(read(el, TURN_PROPS.lamp)).toBeCloseTo(lampOn(normalOf(pose), false), 3);
    pointTo(el, WIN.width, 0, 1000);
    expect(read(el, TURN_PROPS.y)).toBeCloseTo(0.3, 4);
  });

  it("never turns under reduced motion (M6): the pointer writes nothing", () => {
    const el = mount(<CardsView {...props({ held: UP, reducedMotion: true })} />);
    pointTo(el, WIN.width, 0, 1000);
    expect(read(el, TURN_PROPS.x)).toBe(0);
    expect(read(el, TURN_PROPS.y)).toBe(0);
    expect(read(el, TURN_PROPS.lamp)).toBeCloseTo(1, 3);
    expect(rule('.vf-cards-held[data-motion="reduced"] .vf-cards-turn')).toContain(
      "transform: none;",
    );
  });

  it("lights no lamp where WebGL2 is refused: the card keeps its print and its still gloss", () => {
    document.documentElement.setAttribute("data-vf-card-print", "ready");
    try {
      const el = mount(<CardsView {...props({ held: UP })} />);
      // the lamp's place stands over the face; no surface is left in it, and the turn is not lit
      const place = el.querySelector(".vf-cards-flip > .vf-card > .vf-card-lamp");
      expect(place).not.toBeNull();
      expect(place?.querySelector("canvas")).toBeNull();
      expect(turnOf(el).hasAttribute("data-lit")).toBe(false);
    } finally {
      document.documentElement.removeAttribute("data-vf-card-print");
    }
  });
});

describe("a lamp is its card's own (DESIGN.md §5: no canvas stands over the window)", () => {
  it("stands inside the side it lights, the face's and the back's, and nowhere else in the layer", () => {
    document.documentElement.setAttribute("data-vf-card-print", "ready");
    try {
      const el = mount(<CardsView {...props({ held: UP })} />);
      // face up, one place: in the face. The back's comes the first time the card is turned over
      expect(el.querySelectorAll(".vf-card-lamp")).toHaveLength(1);
      const flip = el.querySelector<HTMLButtonElement>(".vf-cards-bar button[aria-pressed]");
      act(() => flip?.click());
      expect(el.querySelectorAll(".vf-card-lamp")).toHaveLength(2);
      expect(el.querySelector(".vf-cards-flip > .vf-card > .vf-card-lamp")).not.toBeNull();
      expect(el.querySelector(".vf-cards-flip > .vf-card-back > .vf-card-lamp")).not.toBeNull();
      // and no surface of the lamp's anywhere but inside a place
      for (const canvas of el.querySelectorAll("canvas"))
        expect(canvas.closest(".vf-card-lamp")).not.toBeNull();
    } finally {
      document.documentElement.removeAttribute("data-vf-card-print");
    }
  });

  it("is not wanted until the stock has printed, nor under reduced motion", () => {
    const el = mount(<CardsView {...props({ held: UP })} />);
    expect(el.querySelector(".vf-card-lamp")).toBeNull();
    document.documentElement.setAttribute("data-vf-card-print", "ready");
    try {
      act(() => root?.render(<CardsView {...props({ held: UP, reducedMotion: true })} />));
      expect(el.querySelector(".vf-card-lamp")).toBeNull();
    } finally {
      document.documentElement.removeAttribute("data-vf-card-print");
    }
  });
});

describe("the turn and the lamp in the hand's stylesheet (DESIGN.md §8; §5 'The lamp, live')", () => {
  it("turns about its upright, then its level, by the layer's two numbers, in the flip's own space", () => {
    const turn = rule(".vf-cards-turn");
    expect(turn).toContain("rotateY(calc(var(--vf-cards-turn-y, 0) * 1rad))");
    expect(turn).toContain("rotateX(calc(var(--vf-cards-turn-x, 0) * 1rad))");
    expect(turn).toContain("transform-style: preserve-3d;");
    // a spring's, written a frame at a time: never a transition
    expect(turn).not.toContain("transition");
    expect(TURN_PROPS).toEqual({
      x: "--vf-cards-turn-x",
      y: "--vf-cards-turn-y",
      lamp: "--vf-cards-lamp",
    });
  });

  it("brightens and darkens each side by the lamp's light on it, times the night's dim", () => {
    const lit = "filter: brightness(calc(var(--vf-card-dim) * var(--vf-cards-lamp, 1)));";
    expect(rule(".vf-card")).toContain(lit);
    expect(rule(".vf-card-back")).toContain(lit);
  });

  it("stands the lamp over the side, cut to the card's corners, and never under the pointer", () => {
    const lamp = rule(".vf-card-lamp");
    expect(lamp).toContain("inset: 0;");
    expect(lamp).toContain("border-radius: inherit;");
    expect(lamp).toContain("overflow: hidden;");
    expect(lamp).toContain("pointer-events: none;");
    // lit, the stock's own still gloss steps aside
    expect(rule(".vf-cards-turn[data-lit] .vf-card-gloss")).toContain("opacity: 0;");
  });
});
