// @vitest-environment happy-dom
/**
 * HN-1 — the fan (DESIGN.md §8 "The hand", Holding them; §6): the shipping CardsView from props —
 * each card at its slot, the reach's card up whole with its × and where it came from, the raised
 * hand's keyboard card and its list for a reader, a held or carried card's place kept, the deal
 * from its source's box (or rising from the foot) on a forced reflow and its landing on the
 * flight's timer — waiting for a hidden window to show — a twin's lift and settle, a card leaving
 * past the foot, the card picked up as a dialog over the window out of focus with the bar under
 * the head, and the motion its stylesheet gives each of them (§6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CardsView,
  type CardsViewProps,
  heldCentre,
  LEAVE_PAST,
  NUDGE_RISE,
} from "../src/frame/cards/CardsView";
import {
  DEAL_SETTLE_MS,
  DEAL_VISIBILITY_WAIT_MS,
  whenVisible,
} from "../src/frame/cards/card-flight";
import {
  CARD_LIFT,
  CARD_PEEK,
  CARD_W,
  CARDS_LINE_RIGHT,
  type Card,
  layoutCards,
  layoutRaised,
  reachLift,
  textCardOf,
} from "../src/frame/cards/cards-model";
import { HAND_WORDS, OUTCOME_WORDS, provenance } from "../src/frame/cards/cards-words";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CARDS_CSS = readFileSync(join(process.cwd(), "src/frame/cards/cards.css"), "utf8");

/** A rule's body in the hand's stylesheet. */
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
const CARDS = ["a", "b", "c", "d", "e"].map(card);
const REST = layoutCards(CARDS.length, WIN, CARDS_LINE_RIGHT);

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  Reflect.deleteProperty(document, "visibilityState");
  vi.useRealTimers();
});

/** The window's visibility, as the shell reports it (happy-dom's is always "visible"). */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

function mount(node: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

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

const slotOf = (el: HTMLElement, id: string): HTMLElement => {
  const slot = el.querySelector<HTMLElement>(`[data-slot="${id}"]`);
  if (slot === null) throw new Error(`no slot for ${id}`);
  return slot;
};
const liftOf = (slot: HTMLElement): HTMLElement =>
  slot.querySelector<HTMLElement>(".vf-cards-lift") ?? slot;
/** A placement property's number, as the wrapper carries it. */
const num = (el: HTMLElement, property: string): number =>
  Number.parseFloat(el.style.getPropertyValue(property));

describe("the fan at rest and the reach (HN: Holding them)", () => {
  it("stands each card at its slot, and brings the reached card up whole and straight, its × inside and where it came from above it", () => {
    const centre = (REST.slots[2]?.x ?? 0) + CARD_W / 2;
    const lifts = reachLift(REST.slots, centre);
    const el = mount(<CardsView {...props({ lifts, reached: 2 })} />);
    for (const [index, each] of CARDS.entries()) {
      const slot = slotOf(el, each.id);
      expect(slot.dataset.phase).toBe("rest");
      expect(num(slot, "--vf-cards-x")).toBeCloseTo(REST.slots[index]?.x ?? Number.NaN, 1);
      const y = (REST.slots[index]?.y ?? 0) - (lifts[index] ?? 0) * CARD_LIFT;
      expect(num(liftOf(slot), "--vf-cards-y")).toBeCloseTo(y, 1);
    }
    const reached = slotOf(el, "c");
    expect(num(liftOf(reached), "--vf-cards-r")).toBeCloseTo(0, 2);
    expect(num(liftOf(reached), "--vf-cards-lp")).toBe(1);
    // the nearest in front
    expect(Number(reached.style.zIndex)).toBeGreaterThan(Number(slotOf(el, "b").style.zIndex));
    expect(Number(reached.style.zIndex)).toBeGreaterThan(Number(slotOf(el, "d").style.zIndex));
    // its × alone, and its provenance above it
    expect(el.querySelectorAll(".vf-card-x")).toHaveLength(1);
    expect(reached.querySelector(".vf-card-x")).not.toBeNull();
    const label = el.querySelector<HTMLElement>(".vf-cards-label");
    expect(label?.textContent).toBe(provenance(CARDS[2] as Card, NOW, "mac"));
    expect(label?.textContent).toBe("Godview · claude·2 · 2m ago");
    expect(Number.parseFloat(label?.style.left ?? "")).toBeCloseTo(centre, 1);
    const above = (REST.slots[2]?.y ?? 0) - CARD_LIFT - 32;
    expect(Number.parseFloat(label?.style.top ?? "")).toBeCloseTo(above, 1);
  });

  it("says nothing above a hand nothing reaches, and the fan stands one above the line's layer (R-D 13)", () => {
    const el = mount(<CardsView {...props()} />);
    expect(el.querySelector(".vf-cards-label")).toBeNull();
    expect(el.querySelector(".vf-card-x")).toBeNull();
    expect(el.querySelector(".vf-cards")?.hasAttribute("data-raised")).toBe(false);
    for (const each of CARDS) expect(num(liftOf(slotOf(el, each.id)), "--vf-cards-lp")).toBe(0);
    // over the line (62), so a card dealt across the line's glass passes over it; under a card
    // picked up (64)
    expect(rule(".vf-cards")).toContain("z-index: 63;");
    expect(rule(".vf-cards-held")).toContain("z-index: 64;");
  });

  it("names the fan for a reader at rest, a name and nothing more (R-D 11)", () => {
    const fan = mount(<CardsView {...props()} />).querySelector<HTMLElement>(".vf-cards");
    expect(fan?.getAttribute("aria-label")).toBe(HAND_WORDS.name);
    expect(HAND_WORDS.name).toBe("Your hand");
    expect(fan?.hasAttribute("role")).toBe(false);
    expect(fan?.hasAttribute("tabindex")).toBe(false);
    expect(fan?.querySelector('[role="option"]')).toBeNull();
  });

  it("raised, is a list of its cards for a reader — each named by its name and where it came from — the keyboard's card its active descendant (R-D 11)", () => {
    const layout = layoutRaised(CARDS.length, WIN, CARDS_LINE_RIGHT);
    const el = mount(<CardsView {...props({ layout, raised: true, focus: 3 })} />);
    const list = el.querySelector<HTMLElement>(".vf-cards");
    expect(list?.getAttribute("role")).toBe("listbox");
    expect(list?.getAttribute("aria-label")).toBe("Your hand");
    expect(list?.getAttribute("tabindex")).toBe("-1");
    const options = [...el.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((option) => option.dataset.slot)).toEqual(["a", "b", "c", "d", "e"]);
    const d = slotOf(el, "d");
    expect(d.id).not.toBe("");
    expect(list?.getAttribute("aria-activedescendant")).toBe(d.id);
    expect(d.getAttribute("aria-selected")).toBe("true");
    expect(slotOf(el, "c").getAttribute("aria-selected")).toBe("false");
    expect(d.getAttribute("aria-label")).toBe("Words of d. — Godview · claude·2 · 2m ago");
    expect(d.getAttribute("aria-label")).toBe(
      HAND_WORDS.option("Words of d.", provenance(CARDS[3] as Card, NOW, "mac")),
    );
  });

  it("spells a paste's key as its keys say — Ctrl+V off the Mac — above the card reached, and on the bar under a card picked up", () => {
    const pasted = textCardOf("From Notes.", {
      id: "v",
      origin: { view: "outside", how: "paste" },
      at: NOW - 20_000,
    });
    const cards = [...CARDS.slice(0, 4), pasted];
    const lifts = reachLift(REST.slots, (REST.slots[4]?.x ?? 0) + CARD_W / 2);
    const el = mount(<CardsView {...props({ cards, lifts, reached: 4, keys: "other" })} />);
    expect(el.querySelector(".vf-cards-label")?.textContent).toBe("Ctrl+V · just now");
    act(() => root?.unmount());
    root = null;
    const held = { card: pasted, phase: "up" as const };
    const up = mount(<CardsView {...props({ cards, held, keys: "other" })} />);
    expect(up.querySelector(".vf-cards-bar-from")?.textContent).toBe("Ctrl+V · just now");
    expect(provenance(pasted, NOW, "mac"), "the same card on the Mac").toBe("⌘V · just now");
  });

  it("raises every card the full lift and straight (⇧⌘V), the keyboard's card ringed and saying where it came from", () => {
    const layout = layoutRaised(CARDS.length, WIN, CARDS_LINE_RIGHT);
    const el = mount(<CardsView {...props({ layout, raised: true, focus: 3 })} />);
    expect(el.querySelector(".vf-cards")?.hasAttribute("data-raised")).toBe(true);
    expect(el.querySelectorAll("[data-focus]")).toHaveLength(1);
    expect(slotOf(el, "d").hasAttribute("data-focus")).toBe(true);
    for (const each of CARDS) {
      const lift = liftOf(slotOf(el, each.id));
      expect(num(lift, "--vf-cards-y")).toBeCloseTo(WIN.height - CARD_PEEK - CARD_LIFT, 1);
      expect(num(lift, "--vf-cards-r")).toBe(0);
      expect(num(lift, "--vf-cards-lp")).toBe(1);
    }
    expect(el.querySelector(".vf-card-x")).toBeNull();
    expect(el.querySelector(".vf-cards-label")?.textContent).toBe(
      provenance(CARDS[3] as Card, NOW, "mac"),
    );
  });

  it("rings the keyboard's card with the frame's focus ring, 2px at offset 2, and never the window-wide root (R-D 10)", () => {
    const ring = rule(".vf-cards-slot[data-focus] .vf-card");
    expect(ring).toContain("outline: 2px solid var(--vf-select);");
    expect(ring).toContain("outline-offset: 2px;");
    expect(rule(".vf-cards:focus")).toContain("outline: none;");
  });

  it("moves nothing under reduced motion: the reach and the raise at once, only a coming or a going fading (R-D 4)", () => {
    const el = mount(<CardsView {...props({ reducedMotion: true })} />);
    expect(el.querySelector(".vf-cards")?.getAttribute("data-motion")).toBe("reduced");
    expect(rule('.vf-cards[data-motion="reduced"] :is(.vf-cards-slot, .vf-card)')).toContain(
      "transition: none;",
    );
    const lift = rule('.vf-cards[data-motion="reduced"] .vf-cards-lift');
    expect(lift).toContain("transition: opacity 120ms ease-out;");
    expect(lift).not.toContain("transform");
  });

  it("steps out of the pegboard's way at once and keeps the gloss still under reduced motion (M6)", () => {
    expect(rule('.vf-cards[data-motion="reduced"]')).toContain("transition: none;");
    // the tuck's rule weighs the same, so the reduced one must come after it to win
    expect(CARDS_CSS.indexOf(".vf-cards[data-tucked] {")).toBeGreaterThan(-1);
    expect(CARDS_CSS.indexOf('.vf-cards[data-motion="reduced"] {')).toBeGreaterThan(
      CARDS_CSS.indexOf(".vf-cards[data-tucked] {"),
    );
    expect(rule('.vf-cards[data-motion="reduced"] .vf-card-gloss')).toContain("transition: none;");
    expect(rule('.vf-cards-held[data-motion="reduced"] .vf-card-gloss')).toContain(
      "transition: none;",
    );
  });

  it("says so when the hand raised holds nothing", () => {
    const layout = layoutRaised(0, WIN, CARDS_LINE_RIGHT);
    const el = mount(<CardsView {...props({ cards: [], layout, lifts: [], raised: true })} />);
    expect(el.querySelector(".vf-cards-label")?.textContent).toBe(HAND_WORDS.empty);
    expect(HAND_WORDS.empty).toBe("Nothing in your hand yet");
  });

  it("keeps a carried card's place — hidden, straight — and the others never close over it", () => {
    const el = mount(<CardsView {...props({ carried: "b" })} />);
    const carried = slotOf(el, "b");
    expect(carried.dataset.phase).toBe("hidden");
    expect(num(carried, "--vf-cards-x")).toBeCloseTo(REST.slots[1]?.x ?? Number.NaN, 1);
    expect(num(liftOf(carried), "--vf-cards-r")).toBe(0);
    expect(num(slotOf(el, "c"), "--vf-cards-x")).toBeCloseTo(REST.slots[2]?.x ?? Number.NaN, 1);
  });

  it("lifts a twin of the newest card a little and says it is already in your hand (HN-D10)", () => {
    const el = mount(<CardsView {...props({ nudged: "e" })} />);
    const twin = slotOf(el, "e");
    expect(twin.hasAttribute("data-nudged")).toBe(true);
    const y = (REST.slots[4]?.y ?? 0) - NUDGE_RISE;
    expect(num(liftOf(twin), "--vf-cards-y")).toBeCloseTo(y, 1);
    expect(el.querySelector(".vf-cards-label")?.textContent).toBe(OUTCOME_WORDS.already);
    // up on the pop in 280ms (§6), not the reach's 240ms on the island curve
    expect(rule(".vf-cards-slot[data-nudged] .vf-cards-lift")).toContain(
      "transform 280ms var(--vf-ease-pop)",
    );
  });

  it("settles the twin back to its place on the retract curve once its lift is over (HN-D10)", () => {
    const el = mount(<CardsView {...props({ settling: "e" })} />);
    const twin = slotOf(el, "e");
    expect(twin.hasAttribute("data-settling")).toBe(true);
    expect(twin.hasAttribute("data-nudged")).toBe(false);
    expect(num(liftOf(twin), "--vf-cards-y")).toBeCloseTo(REST.slots[4]?.y ?? Number.NaN, 1);
    expect(el.querySelector(".vf-cards-label")).toBeNull();
    expect(rule(".vf-cards-slot[data-settling] .vf-cards-lift")).toContain(
      "transform 280ms cubic-bezier(0.4, 0, 1, 1)",
    );
  });

  it("draws a leaving card past the foot from the place it held among the others", () => {
    const gone = card("z");
    const leaving = [{ card: gone, slot: { x: 300, y: 712, r: -6.5 }, index: 0 }];
    const el = mount(<CardsView {...props({ leaving })} />);
    const slots = [...el.querySelectorAll<HTMLElement>(".vf-cards-slot")];
    expect(slots.map((slot) => slot.dataset.slot)).toEqual(["z", "a", "b", "c", "d", "e"]);
    const z = slotOf(el, "z");
    expect(z.dataset.phase).toBe("leaving");
    expect(num(z, "--vf-cards-x")).toBe(300);
    expect(num(liftOf(z), "--vf-cards-y")).toBe(WIN.height + LEAVE_PAST);
  });
});

describe("the deal (HN: Where cards come from)", () => {
  const from = { left: 200, top: 120, width: 520, height: 300 };

  it("draws an arriving card at its source's box first — centred, scaled to it, turned — then flies it home and lands it on the flight's timer", async () => {
    vi.useFakeTimers();
    const onLanded = vi.fn();
    const arriving = new Map([["e", from]]);
    const el = mount(<CardsView {...props({ arriving, onLanded })} />);
    const dealt = slotOf(el, "e");
    expect(dealt.dataset.phase).toBe("from");
    expect(num(dealt, "--vf-cards-x")).toBeCloseTo(200 + 260 - 52, 1);
    expect(num(liftOf(dealt), "--vf-cards-y")).toBeCloseTo(120 + 150 - 73, 1);
    expect(num(liftOf(dealt), "--vf-cards-r")).toBe(-7);
    // min(520 / 104, 300 / 146) is past the clamp: 1.3 of its own size at most
    expect(num(liftOf(dealt), "--vf-cards-s")).toBe(1.3);
    // the window is visible: once its start is committed, it flies — no animation frame asked
    await act(async () => {
      await Promise.resolve();
    });
    expect(dealt.dataset.phase).toBe("deal");
    expect(num(dealt, "--vf-cards-x")).toBeCloseTo(REST.slots[4]?.x ?? Number.NaN, 1);
    expect(num(liftOf(dealt), "--vf-cards-y")).toBeCloseTo(REST.slots[4]?.y ?? Number.NaN, 1);
    expect(num(liftOf(dealt), "--vf-cards-r")).toBe(0);
    expect(onLanded).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(DEAL_SETTLE_MS);
    });
    expect(onLanded).toHaveBeenCalledWith("e");
    expect(onLanded).toHaveBeenCalledTimes(1);
  });

  it("fades a deal in at its place under reduced motion (M6)", () => {
    const arriving = new Map([["e", from]]);
    const el = mount(<CardsView {...props({ arriving, reducedMotion: true })} />);
    const dealt = slotOf(el, "e");
    expect(el.querySelector(".vf-cards")?.getAttribute("data-motion")).toBe("reduced");
    expect(dealt.dataset.phase).toBe("from");
    expect(num(dealt, "--vf-cards-x")).toBeCloseTo(REST.slots[4]?.x ?? Number.NaN, 1);
    expect(liftOf(dealt).style.getPropertyValue("--vf-cards-o")).toBe("0");
  });

  it("raises a card with nowhere to leave from out of the window's foot into its place, its own size and seen (R-D 2)", async () => {
    vi.useFakeTimers();
    const arriving = new Map<string, null>([["e", null]]);
    const el = mount(<CardsView {...props({ arriving })} />);
    const dealt = slotOf(el, "e");
    expect(dealt.dataset.phase).toBe("from");
    expect(num(dealt, "--vf-cards-x")).toBeCloseTo(REST.slots[4]?.x ?? Number.NaN, 1);
    expect(num(liftOf(dealt), "--vf-cards-y")).toBe(WIN.height + LEAVE_PAST);
    expect(num(liftOf(dealt), "--vf-cards-s")).toBe(1);
    expect(num(liftOf(dealt), "--vf-cards-o")).toBe(1);
    expect(num(liftOf(dealt), "--vf-cards-r")).toBe(0);
    await act(async () => {
      await Promise.resolve();
    });
    expect(dealt.dataset.phase).toBe("deal");
    expect(num(liftOf(dealt), "--vf-cards-y")).toBeCloseTo(REST.slots[4]?.y ?? Number.NaN, 1);
  });

  it("arcs: across on the island curve, and up on the arc's own curve, which dips before it climbs (R-D 1)", () => {
    const deal = '.vf-cards-slot[data-phase="deal"]';
    expect(CARDS_CSS).toContain(
      [`${deal},`, `${deal} .vf-cards-lift {`, "  transition-duration: 560ms;", "}"].join("\n"),
    );
    expect(CARDS_CSS).toContain(
      [
        `${deal} .vf-cards-lift {`,
        "  transition-timing-function: cubic-bezier(0.45, -0.3, 0.7, 1);",
        "}",
      ].join("\n"),
    );
    // the slot, which carries x, keeps the island curve of its own rule
    expect(rule(".vf-cards-slot")).toContain("transition: transform 240ms var(--vf-ease-island);");
  });

  it("holds a deal at its start while the window is hidden, and lets it fly once the window shows", async () => {
    setVisibility("hidden");
    const el = mount(<CardsView {...props({ arriving: new Map([["e", from]]) })} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(slotOf(el, "e").dataset.phase).toBe("from");
    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(slotOf(el, "e").dataset.phase).toBe("deal");
  });
});

describe("whenVisible — a flight waits for a window it can be seen in (the 2026-09-23 lesson; R-T 14)", () => {
  it("answers at once for a window that shows", async () => {
    await expect(whenVisible(document)).resolves.toBeUndefined();
  });

  it("waits on a hidden window for its visibilitychange, and stops listening once it shows", async () => {
    vi.useFakeTimers();
    setVisibility("hidden");
    const removed = vi.spyOn(document, "removeEventListener");
    try {
      let shown = false;
      void whenVisible(document).then(() => {
        shown = true;
      });
      vi.advanceTimersByTime(DEAL_VISIBILITY_WAIT_MS - 1);
      await Promise.resolve();
      expect(shown).toBe(false);
      // a change that leaves it hidden is not the one it waits for
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      expect(shown).toBe(false);
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      expect(shown).toBe(true);
      expect(removed).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    } finally {
      removed.mockRestore();
    }
  });

  it("flies anyway at its bound when the window never shows, and stops listening", async () => {
    vi.useFakeTimers();
    setVisibility("hidden");
    const removed = vi.spyOn(document, "removeEventListener");
    try {
      let flown = false;
      void whenVisible(document, 200).then(() => {
        flown = true;
      });
      vi.advanceTimersByTime(199);
      await Promise.resolve();
      expect(flown).toBe(false);
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(flown).toBe(true);
      expect(removed).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    } finally {
      removed.mockRestore();
    }
  });
});

describe("a card picked up (HN-D5)", () => {
  it("holds it at reading size in the middle over the window out of focus, its place kept, the bar under the head saying where it came from", () => {
    const onPutBack = vi.fn();
    const onRemoveHeld = vi.fn();
    const held = { card: CARDS[1] as Card, phase: "up" as const };
    const el = mount(<CardsView {...props({ held, onPutBack, onRemoveHeld })} />);
    expect(slotOf(el, "b").dataset.phase).toBe("hidden");
    const layer = el.querySelector<HTMLElement>(".vf-cards-held");
    expect(layer?.dataset.phase).toBe("up");
    const centre = heldCentre(WIN);
    expect(centre).toEqual({ x: 538, y: 325, s: 2.6 });
    const box = layer?.querySelector<HTMLElement>(".vf-cards-heldcard");
    expect(box?.style.transform).toBe("translate(538px, 325px) scale(2.6)");
    expect(box?.querySelector(".vf-card")?.hasAttribute("data-held")).toBe(true);
    const bar = layer?.querySelector<HTMLElement>(".vf-cards-bar");
    expect(bar?.hasAttribute("data-on")).toBe(true);
    expect(bar?.hasAttribute("inert")).toBe(false);
    expect(bar?.querySelector(".vf-cards-bar-from")?.textContent).toBe(
      provenance(CARDS[1] as Card, NOW, "mac"),
    );
    const [remove, done] = [...(bar?.querySelectorAll("button") ?? [])];
    expect([remove?.textContent, done?.textContent]).toEqual(["Remove", "Done"]);
    act(() => remove?.click());
    expect(onRemoveHeld).toHaveBeenCalledTimes(1);
    act(() => done?.click());
    expect(onPutBack).toHaveBeenCalledTimes(1);
    act(() => layer?.querySelector<HTMLElement>(".vf-cards-scrim")?.click());
    expect(onPutBack).toHaveBeenCalledTimes(2);
  });

  it("is a dialog named by its card while it is up, its buttons saying their keys, and a key inside it goes no further (R-D 11, R-D 19, R-B 1)", () => {
    const held = { card: CARDS[1] as Card, phase: "up" as const };
    const el = mount(<CardsView {...props({ held })} />);
    const layer = el.querySelector<HTMLElement>(".vf-cards-held");
    expect(layer?.getAttribute("role")).toBe("dialog");
    expect(layer?.getAttribute("aria-modal")).toBe("true");
    expect(layer?.getAttribute("aria-label")).toBe("Words of b.");
    const bar = layer?.querySelectorAll<HTMLElement>(".vf-cards-bar button") ?? [];
    const [remove, done] = [...bar];
    // the keys said, never printed (FR-5)
    expect(remove?.getAttribute("title")).toBe("Remove  ⌫");
    expect(remove?.getAttribute("aria-keyshortcuts")).toBe("Backspace");
    expect(done?.getAttribute("title")).toBe("Done  Esc");
    expect(done?.getAttribute("aria-keyshortcuts")).toBe("Escape");
    expect(done?.textContent).toBe("Done");
    // the desk's keymap listens on the window: a key on Done never reaches it
    const heard: string[] = [];
    const hear = (event: KeyboardEvent): void => {
      heard.push(event.key);
    };
    window.addEventListener("keydown", hear);
    try {
      act(() => {
        done?.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
      });
    } finally {
      window.removeEventListener("keydown", hear);
    }
    expect(heard).toEqual([]);
  });

  it("fades the window out of focus in 240ms plain ease, 120ms under reduced motion (R-D 3)", () => {
    expect(rule(".vf-cards-scrim")).toContain("transition: opacity 240ms ease;");
    expect(rule('.vf-cards-held[data-motion="reduced"] .vf-cards-scrim')).toContain(
      "transition-duration: 120ms;",
    );
  });

  it("sends it home to its place after a put back, and shrinks a removed one where it stands", () => {
    // the middle card, whose place stands level: x 538, y 712 at the default window
    const home = { card: CARDS[2] as Card, phase: "home" as const };
    const el = mount(<CardsView {...props({ held: home })} />);
    const layer = el.querySelector<HTMLElement>(".vf-cards-held");
    expect(layer?.dataset.phase).toBe("home");
    expect(REST.slots[2]).toMatchObject({ x: 538, y: WIN.height - CARD_PEEK });
    const box = layer?.querySelector<HTMLElement>(".vf-cards-heldcard");
    expect(box?.style.transform).toBe("translate(538px, 712px) scale(1)");
    expect(layer?.querySelector(".vf-cards-bar")?.hasAttribute("data-on")).toBe(false);
    expect(layer?.querySelector(".vf-cards-bar")?.hasAttribute("inert")).toBe(true);
    // on its way home it is no longer a dialog
    expect(layer?.hasAttribute("role")).toBe(false);
    expect(layer?.hasAttribute("aria-modal")).toBe(false);
    act(() => root?.unmount());
    root = null;
    const gone = { card: card("gone"), phase: "gone" as const };
    const again = mount(<CardsView {...props({ held: gone })} />);
    const shrunk = again.querySelector<HTMLElement>(".vf-cards-heldcard");
    expect(shrunk?.style.transform).toBe("translate(538px, 325px) scale(0)");
  });

  it("fits the held card in a short window's reading fit, never under its own size", () => {
    expect(heldCentre({ width: 1180, height: 500 }).s).toBeCloseTo(284 / 146, 5);
    expect(heldCentre({ width: 1180, height: 300 }).s).toBe(1);
  });
});
