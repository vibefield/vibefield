import { describe, expect, it } from "vitest";
import { type CardTarget, CardTargets, cardTargets } from "../src/frame/cards/card-targets";
import {
  addCard,
  CARD_LIFT,
  CARD_PEEK,
  CARD_W,
  CARDS_CAP,
  type Card,
  type CardOrigin,
  FAN_LINE_CLEAR,
  FAN_MAX_PITCH,
  FAN_MAX_TILT,
  inReach,
  layoutCards,
  layoutRaised,
  type PictCard,
  reachedIndex,
  reachLift,
  reachX,
  sameAs,
  termCardOf,
  textCardOf,
} from "../src/frame/cards/cards-model";
import { CardStore } from "../src/frame/cards/cards-store";
import { provenance, TARGET_WORDS } from "../src/frame/cards/cards-words";

// The hand's pure half (track HN; DESIGN.md §8 "The hand"): the fan's numbers,
// the reach, the twelve, what a copy becomes, and the store's order.

const WIN = { width: 1180, height: 780 } as const;
/** the line's right end at the default window: 76 in, 300 wide (LN-D1) */
const LINE_RIGHT = 376;
const base = (id: string, at = 0) => ({
  id,
  origin: { view: "godview", how: "copy" } as const,
  at,
});
const text = (id: string, words = `Words of ${id}.`): Card => textCardOf(words, base(id));
const pict = (id: string, extra: Partial<PictCard> = {}): PictCard => ({
  ...base(id),
  kind: "pict",
  title: "Snapshot",
  width: 640,
  height: 400,
  src: `vibefield-still://stills/${id}.png`,
  paste: `/tmp/${id}.png`,
  path: `/tmp/${id}.png`,
  ...extra,
});

describe("the fan (HN: Holding them)", () => {
  it("shows the top 68 of a lone card, centred on the window and level", () => {
    const { slots, left, right } = layoutCards(1, WIN, LINE_RIGHT);
    expect(slots).toEqual([{ x: WIN.width / 2 - CARD_W / 2, y: WIN.height - CARD_PEEK, r: 0 }]);
    expect(right - left).toBe(CARD_W);
  });

  it("fans up to 66 apart and never past ±6.5° at its ends", () => {
    const { slots } = layoutCards(6, WIN, LINE_RIGHT);
    expect(slots[1]!.x - slots[0]!.x).toBe(FAN_MAX_PITCH);
    expect(slots[0]!.r).toBe(-FAN_MAX_TILT);
    expect(slots[5]!.r).toBe(FAN_MAX_TILT);
    // the ends sit lower than the middle: a fan about a point below the window
    expect(slots[0]!.y).toBeGreaterThan(slots[2]!.y);
  });

  it("tightens as it fills, and stays 28 clear of the line", () => {
    const narrow = { width: 900, height: 780 };
    const { slots, left } = layoutCards(12, narrow, LINE_RIGHT);
    expect(left).toBeGreaterThanOrEqual(LINE_RIGHT + FAN_LINE_CLEAR);
    expect(slots[1]!.x - slots[0]!.x).toBeLessThan(FAN_MAX_PITCH);
    expect(slots[11]!.x + CARD_W).toBeLessThanOrEqual(narrow.width - 24 + 0.001);
  });

  it("raises every card the full lift, straight (⇧⌘V)", () => {
    const { slots } = layoutRaised(3, WIN, LINE_RIGHT);
    for (const s of slots) expect(s).toMatchObject({ y: WIN.height - CARD_PEEK - CARD_LIFT, r: 0 });
  });
});

describe("the reach", () => {
  const layout = layoutCards(5, WIN, LINE_RIGHT);

  it("lifts the card under the pointer whole and its neighbours by a smoothstep", () => {
    const centre = layout.slots[2]!.x + CARD_W / 2;
    const lifts = reachLift(layout.slots, centre);
    expect(lifts[2]).toBe(1);
    expect(lifts[1]).toBeGreaterThan(0);
    expect(lifts[1]).toBeLessThan(1);
    expect(lifts[1]).toBeCloseTo(lifts[3]!, 10);
    expect(reachedIndex(lifts)).toBe(2);
    expect(reachLift(layout.slots, null)).toEqual([0, 0, 0, 0, 0]);
  });

  it("answers only in the foot's band", () => {
    expect(inReach(layout, WIN, { x: layout.left + 10, y: WIN.height - 20 })).toBe(true);
    expect(inReach(layout, WIN, { x: layout.left + 10, y: 300 })).toBe(false);
    expect(inReach(layout, WIN, { x: 10, y: WIN.height - 20 })).toBe(false);
    expect(inReach(layout, WIN, null)).toBe(false);
  });

  it("holds the reach on the card the pointer is ON above the fan, so its × is reachable", () => {
    const over = 1;
    const cornerX = layout.slots[over]!.x + CARD_W - 10;
    const above = { x: cornerX, y: WIN.height - CARD_PEEK - 40 };
    expect(reachX(layout, WIN, above, over)).toBe(layout.slots[over]!.x + CARD_W / 2);
    // on the fan's own rest line and below, the pointer's x
    const below = { x: cornerX, y: WIN.height - 10 };
    expect(reachX(layout, WIN, below, over)).toBe(cornerX);
  });
});

describe("the twelve (HN-D8)", () => {
  it("deals at the right end and pushes the oldest off the left past twelve", () => {
    let cards: readonly Card[] = [];
    for (let i = 1; i <= CARDS_CAP + 1; i += 1) cards = addCard(cards, text(`c${i}`));
    expect(cards).toHaveLength(CARDS_CAP);
    expect(cards[0]!.id).toBe("c2");
    expect(cards.at(-1)!.id).toBe(`c${CARDS_CAP + 1}`);
    expect(addCard(cards, cards[3]!)).toBe(cards);
  });
});

describe("what a copy becomes", () => {
  it("titles a text card by its first sentence, or its first line, bare", () => {
    const a = textCardOf("Never drop a paste unsaid. Say its size.", base("a"));
    expect(a).toMatchObject({
      title: "Never drop a paste unsaid.",
      body: "Say its size.",
      bare: false,
    });
    const b = textCardOf("TypeError: x is undefined\n    at f (a.js:1)", base("b"));
    expect(b).toMatchObject({ title: "TypeError: x is undefined", bare: true });
    expect(b.paste).toBe("TypeError: x is undefined\n    at f (a.js:1)");
  });

  it("splits a pane's selection into its first line and the rest", () => {
    const t = termCardOf("$ pnpm test\n✓ a.test.ts (3)\n", base("t"));
    expect(t).toMatchObject({ first: "$ pnpm test", rest: "✓ a.test.ts (3)" });
  });

  it("knows a twin of the newest card (HN-D10)", () => {
    expect(sameAs(text("x", "Same words."), text("y", "  Same words.\n"))).toBe(true);
    expect(sameAs(text("x", "Same words."), text("y", "Other words."))).toBe(false);
    expect(sameAs(undefined, text("y"))).toBe(false);
    // the snapshot's still comes back through ⌘V without its path: the same pixels
    const { path: _still, ...pasted } = pict("p", { src: "blob:1", paste: "" });
    expect(sameAs(pict("s"), pasted)).toBe(true);
    expect(sameAs(pict("s"), { ...pasted, width: 641 })).toBe(false);
  });
});

describe("the store", () => {
  it("deals, lands, removes and keeps the held card honest", () => {
    const store = new CardStore(() => 5);
    store.deal(text("a"), { left: 0, top: 0, width: 10, height: 10 });
    store.deal(text("b"));
    expect(store.snapshot().cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect([...store.snapshot().arriving.keys()]).toEqual(["a", "b"]);
    store.landed("a");
    expect(store.snapshot().arriving.has("a")).toBe(false);
    store.pickUp("b");
    expect(store.snapshot().held).toBe("b");
    store.remove("b");
    expect(store.snapshot()).toMatchObject({ held: null });
    store.raise(true);
    store.pickUp("a");
    expect(store.snapshot()).toMatchObject({ held: "a", raised: false });
    store.nudge("a");
    expect(store.snapshot().nudged).toEqual({ id: "a", at: 5 });
  });
});

describe("the provenance line and the targets", () => {
  it("says where a card came from", () => {
    const card = textCardOf("Hi.", {
      id: "p",
      origin: { view: "godview", place: "claude·2", how: "copy" },
      at: 0,
    });
    expect(provenance(card, 120_000)).toBe("Godview · claude·2 · 2m ago");
    const from = (origin: CardOrigin): string =>
      provenance(textCardOf("Hi.", { id: "q", origin, at: 0 }), 1_000);
    // a paste with no caret says its act alone: where its words were copied is not known (LC-21)
    expect(from({ view: "outside", how: "paste" })).toBe("⌘V · just now");
    expect(from({ view: "outside", how: "drag" })).toBe("Another app · dragged in · just now");
    // a copy on a sheet by the view under it; one History's room made by History alone
    expect(from({ view: "canvas", place: "Settings", how: "copy" })).toBe(
      "Canvas · Settings · just now",
    );
    expect(from({ view: "history", how: "copy" })).toBe("History · just now");
    expect(TARGET_WORDS.pane("claude·2")).toBe("Paste into claude·2");
  });

  it("answers the topmost place under a point, and forgets one unregistered", () => {
    const targets = new CardTargets();
    const box = (l: number, t: number, w: number, h: number) =>
      ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h }) as DOMRect;
    const target = (id: string, layer: number, r: DOMRect): CardTarget => ({
      id,
      kind: id === "desk" ? "desk" : "pane",
      layer,
      rect: () => r,
      answer: () => ({ ok: true, label: id }),
      play: async () => ({ ok: true, note: id }),
    });
    const offDesk = targets.register(target("desk", 10, box(0, 0, 1000, 700)));
    const offPane = targets.register(target("pane", 30, box(100, 100, 200, 200)));
    expect(targets.at(150, 150)?.id).toBe("pane");
    expect(targets.at(500, 500)?.id).toBe("desk");
    offPane();
    expect(targets.at(150, 150)?.id).toBe("desk");
    offDesk();
    expect(targets.at(150, 150)).toBeNull();
    expect(cardTargets).toBeInstanceOf(CardTargets);
  });
});
