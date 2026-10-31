// @vitest-environment happy-dom
/**
 * SP-1d — the hand's place on Chat's composer (DESIGN.md §8 "The hand", "Chat's composer": a card from the hand): one
 * prompt target while Chat shows, answering a carried card in the hand's words, and a card let go on it landing as a
 * chip at the caret that carries the whole card into the message. The drag machine that asks it is
 * `card-drag.test.tsx`'s; the composer's own keys are `chat-composer.test.tsx`'s.
 */
import { AGENT_CATALOG, type SparkSummary } from "@vibefield/contracts";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatComposer, type ComposerPort } from "../src/chat/ChatComposer";
import type { DraftPart } from "../src/chat/composer-draft";
import { sparkEntriesOf } from "../src/chat/spark-status";
import {
  type CardLetGo,
  endCardDrag,
  getCarriedCard,
  PLAY_HOME_MS,
  PLAY_SHRINK_MS,
  resetCardDragForTest,
  startCardDrag,
} from "../src/frame/cards/card-drag";
import { type CardTarget, CardTargets, cardTargets } from "../src/frame/cards/card-targets";
import type { Card } from "../src/frame/cards/cards-model";
import { waitingCardOf } from "../src/frame/cards/cards-outside";
import { cardsStore } from "../src/frame/cards/cards-store";
import type { FrameSurface } from "../src/frame/frame-surface";
import { hearLineSays } from "../src/frame/line-door";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AT = "2026-10-31T05:00:00.000Z";
const VELA: SparkSummary = {
  id: "sp-vela0001",
  name: "Vela",
  face: { seed: 7 },
  agent: AGENT_CATALOG[0].id,
  profiles: ["native"],
  thinksUnder: "native",
  folder: "/f/vela",
  createdAt: AT,
  updatedAt: AT,
  session: { runtimeRunId: "run-vela", terminalSessionId: "pty-vela", live: true },
};

const port: ComposerPort = {
  providers: async () => [],
  profileSets: async () => [],
  models: async () => {
    throw new Error("no picker here");
  },
};

const text = (paste: string): Card => ({
  id: "t1",
  kind: "text",
  origin: { view: "history", place: "rosetta", how: "copy" },
  at: 0,
  title: "Ship it",
  body: paste,
  bare: true,
  paste,
});

const picture = (path?: string): Card => ({
  id: "p1",
  kind: "pict",
  origin: { view: "canvas", how: "snapshot" },
  at: 0,
  paste: "",
  title: "Snapshot",
  width: 1440,
  height: 900,
  src: "vibefield-still:one",
  ...(path === undefined ? {} : { path }),
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let setActiveNow: ((active: boolean) => void) | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(
  targets: CardTargets,
  send = vi.fn(async () => ({ state: "pasted" as const })),
) {
  const entry = sparkEntriesOf([VELA], [])[0];
  if (entry === undefined) throw new Error("no entry");
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    const [active, setActive] = useState(true);
    setActiveNow = setActive;
    // the thread's draft, kept as Chat keeps it (one copy)
    const [draft, setDraft] = useState<readonly DraftPart[]>([]);
    return (
      <ChatComposer
        entry={entry as NonNullable<typeof entry>}
        active={active}
        parked={draft}
        onPark={setDraft}
        surface={surface}
        onSurfaceChange={setSurface}
        port={port}
        send={send}
        say={() => true}
        targets={targets}
      />
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Owner />));
  return send;
}

const only = (targets: CardTargets): CardTarget => {
  const [target, ...rest] = targets.list();
  if (target === undefined || rest.length > 0) throw new Error(`${targets.list().length} targets`);
  return target;
};
const POINT = { x: 500, y: 650 } as const;
const editor = (): HTMLElement => host?.querySelector<HTMLElement>(".vf-chat-input") as HTMLElement;

describe('the composer as a place for cards (DESIGN.md §8 "Chat\'s composer", a card from the hand)', () => {
  it("registers one prompt target while Chat shows, and none while it does not", async () => {
    const targets = new CardTargets();
    await mount(targets);
    const target = only(targets);
    expect(target.kind).toBe("prompt");
    expect(target.element?.()).toBe(host?.querySelector(".vf-chat-composer"));
    act(() => setActiveNow?.(false));
    expect(targets.list()).toEqual([]);
  });

  it("has no box under an inert cover", async () => {
    const targets = new CardTargets();
    await mount(targets);
    expect(only(targets).rect()).not.toBeNull();
    host?.setAttribute("inert", "");
    expect(only(targets).rect()).toBeNull();
  });

  it("answers a carried card Add to your message to Vela, and one that gives nothing in the hand's words", async () => {
    const targets = new CardTargets();
    await mount(targets);
    const target = only(targets);
    expect(target.answer(text("ship the tray"), POINT)).toEqual({
      ok: true,
      label: "Add to your message to Vela",
    });
    expect(target.answer(picture(), POINT)).toEqual({
      ok: false,
      label: "A picture with no file can't be pasted yet",
    });
    // a card from another app says what it holds only once it is let go: it is answered yes while it waits
    expect(target.answer({ ...text(""), waiting: true }, POINT)).toEqual({
      ok: true,
      label: "Add to your message to Vela",
    });
  });

  it("lands a card let go as a chip at the caret, carrying the whole card, and the hand keeps it", async () => {
    const targets = new CardTargets();
    const send = await mount(targets);
    const hand = cardsStore.snapshot();
    act(() => {
      const field = editor();
      field.focus();
      const node = document.createTextNode("why does ");
      field.append(node);
      const range = document.createRange();
      range.setStart(node, node.length);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const played = await act(async () => only(targets).play(text("pnpm test\nfails\n"), POINT));
    expect(played).toEqual({ ok: true, note: "Added to your message to Vela" });
    const chip = editor().querySelector<HTMLElement>('[data-chip="card"]');
    expect(chip?.dataset.card).toBe("text");
    expect(chip?.querySelector(".vf-chat-chip-label")?.textContent).toBe("Ship it");
    // HN-D4: the card stays in the hand — the place never touches the store
    expect(cardsStore.snapshot()).toBe(hand);
    // its text, as a pane takes it, is what the message carries: set on lines of its own
    act(() => {
      editor().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await act(async () => undefined);
    expect(send).toHaveBeenCalledWith("why does\npnpm test\nfails", []);
  });

  it("never takes an @ being typed as its place: the card lands at the caret, and the @ and its query stay", async () => {
    const targets = new CardTargets();
    await mount(targets);
    act(() => {
      const field = editor();
      field.focus();
      const node = document.createTextNode("ask @cla");
      field.append(node);
      const range = document.createRange();
      range.setStart(node, node.length);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => only(targets).play(text("ship it"), POINT));
    expect(editor().textContent).toContain("ask @cla");
    expect(editor().querySelectorAll('[data-chip="card"]')).toHaveLength(1);
  });

  it("plays a card from another app straight in once it is let go, and refuses one that gives nothing", async () => {
    // the drag machine over the window's own places, as another app's drag reaches it (`endCardDrag`, B2)
    vi.useFakeTimers();
    const said: string[] = [];
    const offs = [hearLineSays((note) => said.push(note))];
    try {
      await mount(cardTargets);
      const box = host?.querySelector<HTMLElement>(".vf-chat-composer") as HTMLElement;
      Object.defineProperty(box, "getBoundingClientRect", {
        configurable: true,
        value: () => new DOMRect(270, 620, 640, 52),
      });
      // what lies under the pointer, topmost first (happy-dom draws nothing): the composer's own field
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: () => [editor(), box, document.body],
      });
      const waiting = (): Card =>
        waitingCardOf(
          {
            items: [{ kind: "string", type: "text/plain" }],
            types: ["text/plain"],
          } as unknown as DataTransfer,
          { nextId: (kind) => `card-${kind}-waiting`, now: () => 0 },
        );
      const carry = (): void =>
        startCardDrag({
          card: waiting(),
          source: "outside",
          pointerId: null,
          at: POINT,
          grab: { x: 52, y: 12 },
          home: () => null,
        });

      act(() => carry());
      // while it waits it says only its kind, and the composer answers it yes
      expect(getCarriedCard()?.answer).toEqual({
        kind: "prompt",
        ok: true,
        label: "Add to your message to Vela",
      });
      let going: Promise<CardLetGo> = Promise.resolve("none");
      act(() => {
        going = endCardDrag(POINT.x, POINT.y, text("from Notes"));
      });
      await act(async () => vi.advanceTimersByTimeAsync(PLAY_SHRINK_MS));
      await expect(going).resolves.toBe("played");
      expect(said).toEqual(["Added to your message to Vela"]);
      expect(editor().querySelectorAll('[data-chip="card"]')).toHaveLength(1);
      await act(async () => vi.advanceTimersByTimeAsync(PLAY_HOME_MS + 40));

      // let go, it turns out to be a picture with no file: refused in the hand's words, and it is the hand's
      act(() => carry());
      await expect(act(async () => endCardDrag(POINT.x, POINT.y, picture()))).resolves.toBe("hand");
      expect(said.at(-1)).toBe("A picture with no file can't be pasted yet");
      expect(editor().querySelectorAll('[data-chip="card"]')).toHaveLength(1);
    } finally {
      for (const off of offs) off();
      resetCardDragForTest();
      delete (document as unknown as Record<string, unknown>)["elementsFromPoint"];
      vi.useRealTimers();
    }
  });
});
