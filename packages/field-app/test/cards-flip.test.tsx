// @vitest-environment happy-dom
/**
 * Flip it (DESIGN.md §8 "Picking one up"; §5 "the press", the back Pressed and flat): a card picked up turns over
 * about its upright to its printed back, and again to its face, by its bar's Flip it between Remove and Done or by a
 * double-click on the card, and a card put back goes home face up. The back is its own side wearing its own print
 * (flat until it has printed), each side hidden from behind and casting the card's shadow; reduced motion is a 90ms
 * cross-fade. The shipping CardsView from props, and the hand's stylesheet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CardsView, type CardsViewProps } from "../src/frame/cards/CardsView";
import {
  CARDS_LINE_RIGHT,
  type Card,
  layoutCards,
  textCardOf,
} from "../src/frame/cards/cards-model";
import { HAND_WORDS } from "../src/frame/cards/cards-words";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CARDS_CSS = readFileSync(join(process.cwd(), "src/frame/cards/cards.css"), "utf8");
const TOKENS = readFileSync(join(process.cwd(), "../design-kit/src/tokens.css"), "utf8");

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

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
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

/** Which side of the held card is up, as its turning layer says. */
const sideOf = (el: HTMLElement): string | undefined =>
  el.querySelector<HTMLElement>(".vf-cards-held .vf-cards-flip")?.dataset.side;
const barButtons = (el: HTMLElement): HTMLButtonElement[] => [
  ...el.querySelectorAll<HTMLButtonElement>(".vf-cards-held .vf-cards-bar button"),
];
const flipButton = (el: HTMLElement): HTMLButtonElement | undefined =>
  barButtons(el).find((button) => button.textContent === HAND_WORDS.flip);
const doubleClick = (target: Element | null | undefined): void => {
  act(() => {
    target?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
};

describe("Flip it (DESIGN.md §8 'Picking one up')", () => {
  it("stands between Remove and Done in the held card's bar, and says which side is up to a reader", () => {
    expect(HAND_WORDS.flip).toBe("Flip it");
    const el = mount(<CardsView {...props({ held: UP })} />);
    expect(barButtons(el).map((button) => button.textContent)).toEqual([
      "Remove",
      "Flip it",
      "Done",
    ]);
    const flip = flipButton(el);
    expect(flip?.getAttribute("aria-pressed")).toBe("false");
    // it has no key: its other way is a double-click on the card
    expect(flip?.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(sideOf(el)).toBe("face");
  });

  it("turns the card over to its printed back, and again to its face", () => {
    const el = mount(<CardsView {...props({ held: UP })} />);
    act(() => flipButton(el)?.click());
    expect(sideOf(el)).toBe("back");
    expect(flipButton(el)?.getAttribute("aria-pressed")).toBe("true");
    // the back is its own side, beside the face and never the face seen through
    const back = el.querySelector<HTMLElement>(".vf-cards-flip > .vf-card-back");
    expect(back).not.toBeNull();
    expect(back?.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector(".vf-cards-flip > .vf-card")?.hasAttribute("data-held")).toBe(true);
    // the dialog is still named by its card
    expect(el.querySelector(".vf-cards-held")?.getAttribute("aria-label")).toBe("Words of b.");
    act(() => flipButton(el)?.click());
    expect(sideOf(el)).toBe("face");
    expect(flipButton(el)?.getAttribute("aria-pressed")).toBe("false");
  });

  it("turns over on a double-click on either side, and the double-click goes no further than the card", () => {
    const el = mount(<CardsView {...props({ held: UP })} />);
    let heard = 0;
    const hear = (): void => {
      heard += 1;
    };
    document.addEventListener("dblclick", hear);
    try {
      doubleClick(el.querySelector(".vf-cards-flip > .vf-card"));
      expect(sideOf(el)).toBe("back");
      doubleClick(el.querySelector(".vf-cards-flip > .vf-card-back"));
      expect(sideOf(el)).toBe("face");
    } finally {
      document.removeEventListener("dblclick", hear);
    }
    expect(heard).toBe(0);
  });

  it("goes home face up when it is put back, and does not turn on its way", () => {
    const el = mount(<CardsView {...props({ held: UP })} />);
    act(() => flipButton(el)?.click());
    expect(sideOf(el)).toBe("back");
    act(() => root?.render(<CardsView {...props({ held: { ...UP, phase: "home" } })} />));
    expect(el.querySelector<HTMLElement>(".vf-cards-held")?.dataset.phase).toBe("home");
    expect(sideOf(el)).toBe("face");
    doubleClick(el.querySelector(".vf-cards-flip > .vf-card"));
    expect(sideOf(el)).toBe("face");
  });
});

describe("the turn and the back it shows (DESIGN.md §8; §5 'the press')", () => {
  it("turns about its upright in 480ms on the island curve, seen from 1000, each side hidden from behind", () => {
    expect(rule(".vf-cards-heldcard")).toContain("perspective: 1000px;");
    expect(rule(".vf-cards-flip")).toContain("transform-style: preserve-3d;");
    expect(rule(".vf-cards-flip")).toContain("transition: transform 480ms var(--vf-ease-island);");
    expect(rule('.vf-cards-flip[data-side="back"]')).toContain("transform: rotateY(180deg);");
    expect(rule(".vf-cards-flip > .vf-card")).toContain("backface-visibility: hidden;");
    expect(rule(".vf-card-back")).toContain("backface-visibility: hidden;");
    expect(rule(".vf-card-back")).toContain("transform: rotateY(180deg);");
  });

  it("casts the card's own shadow from its back, and keeps the night's dim", () => {
    const back = rule(".vf-card-back");
    expect(back).toContain("box-shadow:");
    expect(back).toContain("var(--vf-card-shade)");
    expect(back).toContain("var(--vf-card-edge)");
    expect(back).toContain("filter: brightness(var(--vf-card-dim));");
    expect(back).toContain("border-radius: 6px;");
  });

  it("wears the back's own print once it is ready, and the flat back until then: its field and its rule, no mark", () => {
    expect(rule(':root[data-vf-card-print="ready"] .vf-card-back')).toContain(
      "var(--vf-card-print-back-held, var(--vf-card-print-back))",
    );
    expect(rule(".vf-card-back")).toContain("background: var(--vf-card-stock);");
    const field = rule(".vf-card-back::before");
    expect(field).toContain("inset: 5.5px;");
    expect(field).toContain("border-radius: 3.6px;");
    expect(field).toContain("background: var(--vf-card-back);");
    // the rule: a hairline of 0.32 centred 2.6 inside the field's edge
    expect(field).toContain("inset 0 0 0 2.44px var(--vf-card-back)");
    expect(field).toContain("inset 0 0 0 2.76px var(--vf-card-back-rule)");
    expect(rule(':root[data-vf-card-print="ready"] .vf-card-back::before')).toContain(
      "display: none;",
    );
    expect(TOKENS).toContain("--vf-card-back: #2d4824;");
    expect(TOKENS).toContain("--vf-card-back-rule: #eee4c8;");
  });

  it("cross-fades in 90ms under reduced motion (M6), and never turns", () => {
    expect(rule('.vf-cards-held[data-motion="reduced"] .vf-cards-flip')).toContain(
      "transform: none;",
    );
    expect(rule('.vf-cards-held[data-motion="reduced"] .vf-cards-flip > *')).toContain(
      "transition: opacity 90ms ease;",
    );
    expect(rule('.vf-cards-held[data-motion="reduced"] .vf-card-back')).toContain(
      "transform: none;",
    );
    expect(
      rule('.vf-cards-held[data-motion="reduced"] .vf-cards-flip[data-side="back"] > .vf-card'),
    ).toContain("opacity: 0;");
  });
});
