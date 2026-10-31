// @vitest-environment happy-dom
/**
 * R-T 2 — the hand's lab door (`window.__vfCards`, frame/cards/cards-lab.ts): a headless smoke's
 * hands. It deals a text card as any source deals one, plays the newest through the place a drop
 * finds at a pane's centre — the deck's own pane target, hit-tested as the drag hit-tests, its
 * outcome said on the line — and empties the hand. smoke:godview's 11h drives it in a real window
 * (the paste reaching the shell, Return never pressed); these cases hold what it does without one.
 */
import { afterEach, describe, expect, it } from "vitest";
import { CardTargets } from "../src/frame/cards/card-targets";
import { cardsLab, installCardsLab } from "../src/frame/cards/cards-lab";
import type { PictCard } from "../src/frame/cards/cards-model";
import { CardStore } from "../src/frame/cards/cards-store";
import { hearLineSays, type LineViewDoor } from "../src/frame/line-door";
import { paneCardTarget } from "../src/godview/pane-card-target";

const LINE = "echo hn4abc > /tmp/hn4abc.txt";

let stage: HTMLElement[] = [];

afterEach(() => {
  for (const element of stage) element.remove();
  stage = [];
  delete (document as unknown as Record<string, unknown>)["elementsFromPoint"];
});

const boxed = <E extends Element>(element: E, rect: DOMRect): E => {
  element.getBoundingClientRect = () => rect;
  return element;
};

/** What the window has on top at any point: `top`, as `elementsFromPoint` answers in a real one. */
function onTop(top: Element): void {
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [top] });
}

/** A deck as ghosttea lays it out: two panes side by side under the deck's own element, each
 * with the input a paste goes through. */
function deckOf(): { root: HTMLElement; inputs: HTMLTextAreaElement[] } {
  const root = boxed(document.createElement("div"), new DOMRect(0, 52, 1180, 640));
  const inputs: HTMLTextAreaElement[] = [];
  [new DOMRect(0, 52, 590, 640), new DOMRect(590, 52, 590, 640)].forEach((box, i) => {
    const pane = boxed(document.createElement("div"), box);
    pane.className = "ghostty-pane";
    pane.dataset.paneId = `pane-${i + 1}`;
    const input = document.createElement("textarea");
    pane.append(input);
    root.append(pane);
    inputs.push(input);
  });
  document.body.append(root);
  stage.push(root);
  return { root, inputs };
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
        sessionId: "s-ros",
        name: "rosetta",
        runs: "shell",
        state: null,
        active: false,
      },
      {
        paneId: "pane-2",
        sessionId: "s-vibe",
        name: "vibe-field",
        runs: "shell",
        state: null,
        active: true,
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

/** A lab over a fixture hand and the deck's own pane target, registered as the deck
 * registers it. */
function labOver(door: LineViewDoor, root: HTMLElement) {
  const store = new CardStore(() => 7_000);
  const targets = new CardTargets();
  targets.register(paneCardTarget({ root: () => root, door: () => door }));
  return { store, lab: cardsLab({ store, targets, door: () => door }) };
}

describe("the hand's lab door: a smoke's hands (R-T 2)", () => {
  it("deals a text card as a paste from another app deals one, and answers its id", () => {
    const store = new CardStore(() => 7_000);
    const lab = cardsLab({ store, targets: new CardTargets(), door: () => null });
    const id = lab.deal(LINE);
    const { cards, arriving } = store.snapshot();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id,
      kind: "text",
      origin: { view: "outside", how: "paste" },
      at: 7_000,
      title: LINE,
      paste: LINE,
    });
    // no box to leave from: it rises into its place
    expect(arriving.get(id ?? "")).toBeNull();
  });

  it("plays the newest card at the centre of the pane showing the session, through the deck's own target, and says it on the line", async () => {
    const { root, inputs } = deckOf();
    const door = doorOf();
    const { lab } = labOver(door, root);
    lab.deal("an older card");
    lab.deal(LINE);
    const [, aimed] = inputs;
    if (aimed === undefined) throw new Error("the deck drew two panes");
    onTop(aimed);
    const said: string[] = [];
    const stop = hearLineSays((text) => said.push(text));
    const play = await lab.playInto("s-vibe");
    stop();
    expect(play).toEqual({
      at: { x: 885, y: 372 },
      target: "pane",
      answer: { ok: true, label: "Paste into vibe-field" },
      played: { ok: true, note: "Pasted into vibe-field" },
      refused: null,
    });
    // the newest card's words, pasted into that pane alone — Return is the pane's own
    expect(door.pasted).toEqual([["pane-2", LINE]]);
    expect(said).toEqual(["Pasted into vibe-field"]);
  });

  it("aims at the active pane when two show the session", async () => {
    const { root, inputs } = deckOf();
    const door = doorOf();
    const [first, second] = door.panes;
    if (first === undefined || second === undefined) throw new Error("the door names two panes");
    const mirrored = doorOf({
      panes: [
        { ...first, sessionId: "s-vibe", active: false },
        { ...second, active: true },
      ],
    });
    const { lab } = labOver(mirrored, root);
    lab.deal(LINE);
    const [, active] = inputs;
    if (active === undefined) throw new Error("the deck drew two panes");
    onTop(active);
    expect((await lab.playInto("s-vibe")).at).toEqual({ x: 885, y: 372 });
    expect(mirrored.pasted).toEqual([["pane-2", LINE]]);
  });

  it("plays nothing, and says why, with no card, no pane of the session, another place on top, or a place that refuses the card", async () => {
    const { root, inputs } = deckOf();
    const door = doorOf();
    const { store, lab } = labOver(door, root);
    expect(await lab.playInto("s-vibe")).toEqual({
      at: null,
      target: null,
      answer: null,
      played: null,
      refused: "the hand holds no card",
    });
    lab.deal(LINE);
    expect((await lab.playInto("s-gone")).refused).toBe("the deck shows no pane of session s-gone");
    // a cover over the deck: only what is on top takes a card (HN-L5)
    const cover = document.createElement("div");
    cover.className = "vf-cover";
    document.body.append(cover);
    stage.push(cover);
    onTop(cover);
    expect(await lab.playInto("s-vibe")).toEqual({
      at: { x: 885, y: 372 },
      target: null,
      answer: null,
      played: null,
      refused: "no place takes a card there — div.vf-cover is on top",
    });
    // a picture with no file: the pane answers in words, and nothing is pasted
    const [, aimed] = inputs;
    if (aimed === undefined) throw new Error("the deck drew two panes");
    onTop(aimed);
    const picture: PictCard = {
      id: store.nextId("pict"),
      kind: "pict",
      origin: { view: "canvas", how: "copy" },
      at: 7_000,
      title: "Clock",
      width: 376,
      height: 276,
      src: "",
      paste: "",
    };
    store.deal(picture);
    const refused = await lab.playInto("s-vibe");
    expect([refused.target, refused.answer?.ok, refused.played, refused.refused]).toEqual([
      "pane",
      false,
      null,
      "A picture with no file can't be pasted yet",
    ]);
    expect(door.pasted).toEqual([]);
  });

  it("empties the hand: nothing held, the hand lowered, every card gone — and says how many", () => {
    const store = new CardStore(() => 7_000);
    const lab = cardsLab({ store, targets: new CardTargets(), door: () => null });
    lab.deal("one");
    lab.deal("two");
    const held = lab.deal("three");
    store.pickUp(held);
    expect(lab.clear()).toBe(3);
    expect(store.snapshot()).toMatchObject({ cards: [], raised: false, held: null });
    store.raise(true);
    expect(lab.clear()).toBe(0);
    expect(store.snapshot().raised).toBe(false);
  });

  it("is installed on the window for one line, and taken back only by that line", () => {
    const undoFirst = installCardsLab({ store: new CardStore() });
    const first = window.__vfCards;
    const undoSecond = installCardsLab({ store: new CardStore() });
    const second = window.__vfCards;
    expect(first).toBeDefined();
    expect(second).not.toBe(first);
    undoFirst();
    expect(window.__vfCards).toBe(second);
    undoSecond();
    expect(window.__vfCards).toBeUndefined();
  });
});
