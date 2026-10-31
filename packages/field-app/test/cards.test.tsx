// @vitest-environment happy-dom
/**
 * HN-1 — the hand's controller on a fixture host (DESIGN.md §8 "The hand", §10): the ONE
 * screenshot subscription dealing a picture card from its region, saying a failure on the line
 * and telling the line's snapshot every result; ⇧⌘V from inside a focused pane, the raised hand's
 * ← → Return ⌫ Esc and its list for a reader; a click picking a card up and Esc putting it back;
 * the card picked up as a modal that holds every key and the keyboard; a press past 4px handed to
 * the carried layer, and a carry's keys its own; the reach's × and ⌫ — only for the card the
 * pointer is on, never under Settings, once per press; the frame's one owner folding it, the card
 * flying home; the thirteenth pushing the first off, a held or a carried one included; a twin's
 * lift and settle; and its mount, which hears another app's paste only while it stands (HN-6). The
 * carried layer is W-play's (`card-drag.ts`): it stands in here as a recorder.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ScreenshotCaptureOk,
  ScreenshotCaptureResult,
  ShellPlatform,
} from "@vibefield/contracts";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cards, type CardsHost } from "../src/frame/cards/Cards";
import {
  CARD_W,
  CARDS_LINE_RIGHT,
  type Card,
  type CardSlot,
  layoutCards,
  type PictCard,
  textCardOf,
} from "../src/frame/cards/cards-model";
import { CardStore } from "../src/frame/cards/cards-store";
import type { FrameSurface } from "../src/frame/frame-surface";
import { hearLineSays } from "../src/frame/line-door";
import { resetActiveViewForTest } from "../src/frame/view-state";
import { type FieldHost, setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";

const drag = vi.hoisted(() => ({
  carried: null as null | { card: { id: string } },
  starts: [] as Array<Record<string, unknown>>,
}));
/** What the line's snapshot was told (`capture-state.ts`, the line's own store). */
const noted = vi.hoisted(() => [] as unknown[]);

vi.mock("../src/frame/cards/card-drag", () => ({
  startCardDrag: (start: Record<string, unknown>) => {
    drag.starts.push(start);
  },
  useCarriedCard: () => drag.carried,
  getCarriedCard: () => drag.carried,
}));
vi.mock("../src/frame/cards/CarriedCardLayer", () => ({ CarriedCardLayer: () => null }));
vi.mock("../src/frame/capture-state", () => ({
  noteCapture: (result: unknown) => {
    noted.push(result);
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHROME = readFileSync(join(process.cwd(), "src/field/ChromeLayer.tsx"), "utf8");
const NOW = 1_000_000;
const WIN = { width: 1180, height: 780 } as const;
/** In the foot's band, on the fan's own strip: where the reach follows the pointer's x. */
const FOOT = WIN.height - 20;

const OK: ScreenshotCaptureOk = {
  status: "ok",
  path: "/var/folders/ab/T/vibefield-still-0007.png",
  width: 1200,
  height: 750,
  scale: 2,
  displayId: 1,
  bounds: { x: 300, y: 200, width: 600, height: 375 },
  screenBounds: { x: 300, y: 200, width: 600, height: 375 },
};

let root: Root | null = null;
let container: HTMLElement | null = null;
let pane: HTMLElement | null = null;
let surfaceNow: FrameSurface | null = null;
let setSurfaceNow: ((next: FrameSurface | null) => void) | null = null;

beforeEach(() => {
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    platform: "darwin",
  } as FieldHost);
  Object.defineProperty(window, "innerWidth", { value: WIN.width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: WIN.height, configurable: true });
});

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  pane?.remove();
  pane = null;
  surfaceNow = null;
  setSurfaceNow = null;
  drag.carried = null;
  drag.starts.length = 0;
  noted.length = 0;
  Reflect.deleteProperty(window, "innerWidth");
  Reflect.deleteProperty(window, "innerHeight");
  resetActiveViewForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fakeHost(): CardsHost & {
  emit: (result: ScreenshotCaptureResult) => void;
  listening: () => boolean;
} {
  let handler: ((result: ScreenshotCaptureResult) => void) | null = null;
  return {
    onScreenshotResult: (next) => {
      handler = next;
      return () => {
        if (handler === next) handler = null;
      };
    },
    screenshotStillUrl: (path) => `vibefield-still://stills/${path.split("/").at(-1)}`,
    emit: (result) => handler?.(result),
    listening: () => handler !== null,
  };
}

/** FieldView's place: the frame's ONE owner of the open surface, which the test reads and moves. */
function Owned({
  store,
  host,
  tucked = false,
  settingsOpen = false,
}: {
  store: CardStore;
  host: CardsHost;
  tucked?: boolean;
  settingsOpen?: boolean;
}): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  surfaceNow = surface;
  setSurfaceNow = setSurface;
  return (
    <Cards
      surface={surface}
      onSurfaceChange={setSurface}
      store={store}
      host={host}
      tucked={tucked}
      settingsOpen={settingsOpen}
      now={() => NOW}
    />
  );
}

function mount(node: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

const text = (id: string): Card =>
  textCardOf(`Words of ${id}.`, {
    id,
    origin: { view: "history", place: "claude·2", how: "copy" },
    at: NOW - 60_000,
  });

/** A hand of these cards, landed: no flight left in it. */
function handOf(...ids: string[]): CardStore {
  const store = new CardStore(() => NOW);
  for (const id of ids) {
    store.deal(text(id));
    store.landed(id);
  }
  return store;
}

/** A card's place at rest in a hand of `n` at the default window. */
function restSlot(n: number, index: number): CardSlot {
  return layoutCards(n, WIN, CARDS_LINE_RIGHT).slots[index] ?? { x: 0, y: 0, r: 0 };
}

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function point(type: string, target: EventTarget, x: number, y: number): void {
  const init = { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x, clientY: y };
  act(() => {
    target.dispatchEvent(new PointerEvent(type, init));
  });
}

const faceOf = (el: HTMLElement, id: string): Element => {
  const face = el.querySelector(`[data-slot="${id}"] .vf-card`);
  if (face === null) throw new Error(`no card ${id}`);
  return face;
};
const ids = (store: CardStore): string[] => store.snapshot().cards.map((card) => card.id);

function letGo(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  });
}

/** A click on a card of a hand of `n` at rest: it is picked up (HN-D5). */
function clickUp(el: HTMLElement, id: string, n: number, index: number): void {
  const slot = restSlot(n, index);
  point("pointerdown", faceOf(el, id), slot.x + 50, slot.y + 30);
  point("pointerup", window, slot.x + 50, slot.y + 30);
}

/** The desk's keymap, as ICE attaches it: the window, in the bubble phase. What it hears is what
 * reached the desk. */
function deskHears(): { readonly keys: string[]; readonly stop: () => void } {
  const keys: string[] = [];
  const hear = (event: KeyboardEvent): void => {
    keys.push(event.key);
  };
  window.addEventListener("keydown", hear);
  return { keys, stop: () => window.removeEventListener("keydown", hear) };
}

/** A pane under the hand that holds the keyboard, and every key it hears. */
function paneHears(): { readonly keys: string[]; readonly el: HTMLElement } {
  const keys: string[] = [];
  const el = document.createElement("div");
  el.tabIndex = 0;
  el.addEventListener("keydown", (event) => keys.push(event.key));
  document.body.appendChild(el);
  pane = el;
  act(() => el.focus());
  return { keys, el };
}

/** A picture brought in from another app: its own object URL, which goes with it. */
const pasted = (id: string): PictCard => ({
  id,
  kind: "pict",
  origin: { view: "outside", how: "paste" },
  at: NOW,
  title: "Pasted",
  width: 640,
  height: 400,
  src: `blob:${id}`,
  paste: "",
});

/** A full hand — the picture `p1` oldest, then c2…c12 — landed. */
function fullHand(): CardStore {
  const store = new CardStore(() => NOW);
  for (const card of [pasted("p1"), ...Array.from({ length: 11 }, (_, n) => text(`c${n + 2}`))]) {
    store.deal(card);
    store.landed(card.id);
  }
  return store;
}

describe("the shell's screenshots (the ONE subscription, moved from the clipboard tray)", () => {
  it("deals a capture main ran as a picture card, drawn first over its region", () => {
    const store = new CardStore(() => NOW);
    const host = fakeHost();
    const el = mount(<Owned store={store} host={host} />);
    expect(host.listening()).toBe(true);
    act(() => host.emit(OK));
    const [dealt] = store.snapshot().cards;
    expect(dealt).toMatchObject({
      kind: "pict",
      title: "Snapshot",
      width: 1200,
      height: 750,
      path: OK.path,
      paste: OK.path,
      src: "vibefield-still://stills/vibefield-still-0007.png",
      origin: { view: "canvas", how: "snapshot" },
    });
    const box = { left: 300, top: 200, width: 600, height: 375 };
    expect(store.snapshot().arriving.get(dealt?.id ?? "")).toEqual(box);
    const slot = el.querySelector<HTMLElement>(`[data-slot="${dealt?.id}"]`);
    expect(slot?.dataset.phase).toBe("from");
    const x = Number.parseFloat(slot?.style.getPropertyValue("--vf-cards-x") ?? "");
    expect(x).toBeCloseTo(300 + 300 - CARD_W / 2, 1);
    act(() => root?.unmount());
    root = null;
    expect(host.listening()).toBe(false);
  });

  it("says a capture that failed on the line's note, and a cancel nothing", () => {
    const store = new CardStore(() => NOW);
    const host = fakeHost();
    mount(<Owned store={store} host={host} />);
    const heard: string[] = [];
    const stop = hearLineSays((said) => heard.push(said));
    const refused: ScreenshotCaptureResult = {
      status: "error",
      code: "permission-denied",
      message: "Screen Recording is off",
    };
    try {
      act(() => host.emit(refused));
      act(() => host.emit({ status: "cancel" }));
    } finally {
      stop();
    }
    expect(heard).toEqual(["Screen Recording is off — System Settings › Privacy & Security"]);
    expect(store.snapshot().cards).toHaveLength(0);
  });

  it("tells the line's snapshot every result it hears, so a refusal of ⌃⌘A makes it wait too", () => {
    const host = fakeHost();
    mount(<Owned store={new CardStore(() => NOW)} host={host} />);
    const missing: ScreenshotCaptureResult = {
      status: "error",
      code: "helper-missing",
      message: "no helper",
    };
    act(() => host.emit(missing));
    act(() => host.emit(OK));
    act(() => host.emit({ status: "cancel" }));
    expect(noted).toEqual([missing, OK, { status: "cancel" }]);
  });

  it("puts a card in hand back when a copy is dealt, so the deal is seen", () => {
    const store = handOf("a", "b");
    const host = fakeHost();
    mount(<Owned store={store} host={host} />);
    press(document.body, { key: "V", metaKey: true, shiftKey: true });
    press(document.body, { key: "Enter" });
    expect(store.snapshot().held).toBe("b");
    act(() => host.emit(OK));
    expect(store.snapshot().held).toBeNull();
    expect(surfaceNow).toBeNull();
    expect(store.snapshot().cards).toHaveLength(3);
  });
});

describe("raised (⇧⌘V) and picked up (HN-D5)", () => {
  it("raises on ⇧⌘V from inside a focused pane, walks with ← →, picks up with Return, and Esc puts the card back", () => {
    vi.useFakeTimers();
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    const heard: string[] = [];
    pane = document.createElement("div");
    pane.tabIndex = 0;
    pane.addEventListener("keydown", (event) => {
      heard.push(event.key);
      event.preventDefault();
      event.stopPropagation();
    });
    document.body.appendChild(pane);
    pane.focus();
    press(pane, { key: "V", metaKey: true, shiftKey: true });
    // the pane never hears it: Ghostty's paste_from_selection never runs (GT-D21)
    expect(heard).toEqual([]);
    expect(surfaceNow).toBe("cards");
    expect(store.snapshot().raised).toBe(true);
    expect(el.querySelector(".vf-cards")?.hasAttribute("data-raised")).toBe(true);
    // the newest in the keyboard's hand
    expect(el.querySelector<HTMLElement>("[data-focus]")?.dataset.slot).toBe("c");
    press(document.body, { key: "ArrowLeft" });
    expect(el.querySelector<HTMLElement>("[data-focus]")?.dataset.slot).toBe("b");
    press(document.body, { key: "Enter" });
    expect(store.snapshot().held).toBe("b");
    expect(surfaceNow).toBe("cards");
    expect(el.querySelector<HTMLElement>(".vf-cards-held")?.dataset.phase).toBe("up");
    const esc = press(document.body, { key: "Escape" });
    expect(esc.defaultPrevented).toBe(true);
    expect(store.snapshot().held).toBeNull();
    expect(surfaceNow).toBeNull();
    // home: a 140ms lead, then 440ms into its place, and the layer is gone
    expect(el.querySelector<HTMLElement>(".vf-cards-held")?.dataset.phase).toBe("home");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(el.querySelector(".vf-cards-held")).toBeNull();
  });

  it("removes the raised hand's card with ⌫, and Esc lowers the hand", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    press(document.body, { key: "v", metaKey: true, shiftKey: true });
    press(document.body, { key: "ArrowLeft" });
    press(document.body, { key: "Backspace" });
    expect(ids(store)).toEqual(["a", "c"]);
    press(document.body, { key: "Escape" });
    expect(surfaceNow).toBeNull();
    expect(store.snapshot().raised).toBe(false);
    expect(el.querySelector(".vf-cards")?.hasAttribute("data-raised")).toBe(false);
    // ⇧⌘V again raises it; ⇧⌘V once more lowers it
    press(document.body, { key: "V", metaKey: true, shiftKey: true });
    expect(surfaceNow).toBe("cards");
    press(document.body, { key: "V", metaKey: true, shiftKey: true });
    expect(surfaceNow).toBeNull();
  });

  it("picks a card up on a click, and Esc puts it back", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    const slot = restSlot(3, 1);
    point("pointerdown", faceOf(el, "b"), slot.x + 50, slot.y + 30);
    point("pointerup", window, slot.x + 51, slot.y + 30);
    expect(store.snapshot().held).toBe("b");
    expect(surfaceNow).toBe("cards");
    expect(drag.starts).toHaveLength(0);
    press(document.body, { key: "Escape" });
    expect(store.snapshot().held).toBeNull();
    expect(surfaceNow).toBeNull();
  });

  it("lowers when another of the frame's surfaces opens, and puts a card in hand back (HN-L7)", () => {
    const store = handOf("a", "b");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    press(document.body, { key: "V", metaKey: true, shiftKey: true });
    expect(surfaceNow).toBe("cards");
    act(() => setSurfaceNow?.("palette"));
    expect(store.snapshot().raised).toBe(false);
    expect(el.querySelector(".vf-cards")?.hasAttribute("data-raised")).toBe(false);
    act(() => setSurfaceNow?.(null));
    press(document.body, { key: "V", metaKey: true, shiftKey: true });
    press(document.body, { key: "Enter" });
    expect(store.snapshot().held).toBe("b");
    const layer = el.querySelector<HTMLElement>(".vf-cards-held");
    act(() => setSurfaceNow?.("zoom"));
    expect(store.snapshot().held).toBeNull();
    // the SAME layer flies home from the middle (R-B 11) — never dropped, then drawn again at its
    // place a render later, which is a blink and not a flight
    expect(el.querySelector(".vf-cards-held")).toBe(layer);
    expect(layer?.dataset.phase).toBe("home");
  });
});

describe("a card picked up is a modal (R-B 1, R-D 11)", () => {
  it("holds every key: ⌫ removes the held card and never the desk's selection, other keys — chorded too — reach nothing under the scrim, and the product chords still run", () => {
    vi.useFakeTimers();
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    const under = paneHears();
    const desk = deskHears();
    try {
      clickUp(el, "b", 3, 1);
      expect(store.snapshot().held).toBe("b");
      // a pane that kept the keyboard, its prompt behind the blur: nothing under the scrim hears
      for (const init of [
        { key: "b" },
        { key: "ArrowLeft" },
        { key: "Enter" },
        { key: "d", metaKey: true },
        { key: "z", metaKey: true },
      ]) {
        press(under.el, init);
      }
      expect(under.keys).toEqual([]);
      expect(desk.keys).toEqual([]);
      expect(store.snapshot().held).toBe("b");
      // ⌫ is the held card's
      expect(press(under.el, { key: "Backspace" }).defaultPrevented).toBe(true);
      expect(ids(store)).toEqual(["a", "c"]);
      expect(desk.keys).toEqual([]);
      expect(surfaceNow).toBeNull();
      // once it has shrunk away (the hand answers nothing meanwhile), the next is picked up — and
      // the product chords, the window's own capture listeners, still run under it
      act(() => {
        vi.advanceTimersByTime(400);
      });
      clickUp(el, "c", 2, 1);
      expect(store.snapshot().held).toBe("c");
      press(under.el, { key: "V", metaKey: true, shiftKey: true });
      expect(store.snapshot().held).toBeNull();
      expect(store.snapshot().raised).toBe(true);
    } finally {
      desk.stop();
    }
  });

  it("is a dialog named by its card: the keyboard moves to Done, Tab walks Remove and Done and never out, a key on its own button goes no further, and Esc gives the keyboard back", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    const under = paneHears();
    clickUp(el, "b", 3, 1);
    const layer = el.querySelector<HTMLElement>(".vf-cards-held");
    expect(layer?.getAttribute("role")).toBe("dialog");
    expect(layer?.getAttribute("aria-modal")).toBe("true");
    expect(layer?.getAttribute("aria-label")).toBe("Words of b.");
    const bar = layer?.querySelectorAll<HTMLElement>(".vf-cards-bar button") ?? [];
    const [remove, done] = [...bar];
    if (remove === undefined || done === undefined) throw new Error("no bar");
    expect(document.activeElement).toBe(done);
    expect(press(done, { key: "Tab" }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(remove);
    press(remove, { key: "Tab" });
    expect(document.activeElement).toBe(done);
    press(done, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(remove);
    const desk = deskHears();
    try {
      press(remove, { key: "b" });
      expect(desk.keys).toEqual([]);
    } finally {
      desk.stop();
    }
    expect(under.keys).toEqual([]);
    press(remove, { key: "Escape" });
    expect(store.snapshot().held).toBeNull();
    expect(layer?.dataset.phase).toBe("home");
    expect(layer?.hasAttribute("role")).toBe(false);
    expect(document.activeElement).toBe(under.el);
  });
});

describe("the raised hand, for a reader (R-D 11)", () => {
  it("is named at rest; raised, it is a list whose root takes the keyboard, walked by its active descendant, and Esc gives the keyboard back", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    const under = paneHears();
    const fan = el.querySelector<HTMLElement>(".vf-cards");
    if (fan === null) throw new Error("no fan");
    expect(fan.getAttribute("aria-label")).toBe("Your hand");
    expect(fan.hasAttribute("role")).toBe(false);
    expect(fan.hasAttribute("tabindex")).toBe(false);
    press(under.el, { key: "V", metaKey: true, shiftKey: true });
    expect(fan.getAttribute("role")).toBe("listbox");
    expect(fan.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(fan);
    const active = (): Element | null =>
      document.getElementById(fan.getAttribute("aria-activedescendant") ?? "");
    expect(active()?.getAttribute("data-slot")).toBe("c");
    expect(active()?.getAttribute("role")).toBe("option");
    expect(active()?.getAttribute("aria-selected")).toBe("true");
    expect(active()?.getAttribute("aria-label")).toBe("Words of c. — History · claude·2 · 1m ago");
    expect(fan.querySelectorAll('[role="option"]')).toHaveLength(3);
    press(fan, { key: "ArrowLeft" });
    expect(active()?.getAttribute("data-slot")).toBe("b");
    expect(fan.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
    press(fan, { key: "Escape" });
    expect(fan.hasAttribute("role")).toBe(false);
    expect(fan.hasAttribute("aria-activedescendant")).toBe(false);
    expect(fan.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(document.activeElement).toBe(under.el);
    expect(under.keys).toEqual([]);
  });

  it("names a pasted card by the key its host's platform spells, as the frame spells its keys — ⌘V on a Mac, Ctrl+V on Windows", () => {
    const rows: ReadonlyArray<readonly [ShellPlatform, string]> = [
      ["darwin", "Pasted — ⌘V · just now"],
      ["win32", "Pasted — Ctrl+V · just now"],
    ];
    for (const [platform, said] of rows) {
      const store = new CardStore(() => NOW);
      store.deal(pasted("p1"));
      store.landed("p1");
      const el = mount(<Owned store={store} host={{ ...fakeHost(), platform }} />);
      press(document.body, { key: "V", metaKey: true, shiftKey: true });
      const option = el.querySelector('[role="option"]');
      expect(option?.getAttribute("aria-label"), platform).toBe(said);
      act(() => root?.unmount());
      root = null;
      container?.remove();
      container = null;
    }
  });
});

describe("whose key it is (the one scope rule; R-B 2, 3, 14)", () => {
  it("takes ⌫ only for the card the pointer is ON: near the fan, over the desk, the desk keeps its own ⌫", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    const mat = document.createElement("div");
    document.body.appendChild(mat);
    const desk = deskHears();
    try {
      // in the strip above the fan, over the desk: the nearest card rises, the pointer on none
      point("pointermove", mat, restSlot(3, 2).x + CARD_W / 2, WIN.height - 190);
      expect(el.querySelector('[data-slot="c"] .vf-card-x')).not.toBeNull();
      expect(press(document.body, { key: "Backspace" }).defaultPrevented).toBe(false);
      expect(ids(store)).toEqual(["a", "b", "c"]);
      expect(desk.keys).toEqual(["Backspace"]);
    } finally {
      desk.stop();
      mat.remove();
    }
  });

  it("reads the card under the pointer at the key itself: one that has moved out from under a still pointer stays", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    const x = restSlot(3, 2).x + CARD_W / 2;
    point("pointermove", faceOf(el, "c"), x, FOOT);
    const mat = document.createElement("div");
    document.body.appendChild(mat);
    try {
      const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(mat);
      expect(press(document.body, { key: "Backspace" }).defaultPrevented).toBe(false);
      expect(ids(store)).toEqual(["a", "b", "c"]);
      hit.mockReturnValue(faceOf(el, "c"));
      expect(press(document.body, { key: "Backspace" }).defaultPrevented).toBe(true);
      expect(ids(store)).toEqual(["a", "b"]);
      expect(hit).toHaveBeenCalledWith(x, FOOT);
    } finally {
      mat.remove();
    }
  });

  it("answers neither the pointer nor ⌫ under Settings' backdrop", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} settingsOpen />);
    point("pointermove", faceOf(el, "c"), restSlot(3, 2).x + CARD_W / 2, FOOT);
    expect(el.querySelector(".vf-card-x")).toBeNull();
    expect(el.querySelector(".vf-cards-label")).toBeNull();
    expect(press(document.body, { key: "Backspace" }).defaultPrevented).toBe(false);
    expect(ids(store)).toEqual(["a", "b", "c"]);
  });

  it("leaves a carry its own keys: Esc, Return, ⌫ and the arrows do nothing to the raised hand while a drag carries a card", () => {
    const store = handOf("a", "b", "c");
    mount(<Owned store={store} host={fakeHost()} />);
    press(document.body, { key: "V", metaKey: true, shiftKey: true });
    // a drag out of the raised hand, under way — heard live, before any render
    drag.carried = { card: { id: "c" } };
    for (const key of ["Escape", "Enter", "Backspace", "ArrowLeft"]) {
      expect(press(document.body, { key }).defaultPrevented).toBe(false);
    }
    expect(store.snapshot().raised).toBe(true);
    expect(store.snapshot().held).toBeNull();
    expect(ids(store)).toEqual(["a", "b", "c"]);
    expect(surfaceNow).toBe("cards");
  });

  it("removes one card for a held ⌫: its repeats are claimed and do nothing — the desk never hears them, even once that card is gone — and a new press takes the next", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    const desk = deskHears();
    try {
      point("pointermove", faceOf(el, "c"), restSlot(3, 2).x + CARD_W / 2, FOOT);
      expect(press(document.body, { key: "Backspace" }).defaultPrevented).toBe(true);
      expect(ids(store)).toEqual(["a", "b"]);
      for (let n = 0; n < 3; n += 1) {
        const repeat = press(document.body, { key: "Backspace", repeat: true });
        expect(repeat.defaultPrevented).toBe(true);
      }
      expect(ids(store)).toEqual(["a", "b"]);
      expect(desk.keys).toEqual([]);
      letGo("Backspace");
      point("pointermove", faceOf(el, "b"), restSlot(2, 1).x + CARD_W / 2, FOOT);
      expect(press(document.body, { key: "Backspace" }).defaultPrevented).toBe(true);
      expect(ids(store)).toEqual(["a"]);
    } finally {
      desk.stop();
    }
  });
});

describe("the reach, the press and the drag", () => {
  it("hands a press that moves 4px or more to the carried layer — the card, its grab point and its way home", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    const slot = restSlot(3, 1);
    point("pointerdown", faceOf(el, "b"), slot.x + 50, slot.y + 30);
    point("pointermove", window, slot.x + 52, slot.y + 30);
    expect(drag.starts).toHaveLength(0);
    point("pointermove", window, slot.x + 56, slot.y + 30);
    expect(drag.starts).toHaveLength(1);
    const start = drag.starts[0] as { card: Card; home: () => unknown };
    expect(start.card.id).toBe("b");
    expect(start).toMatchObject({
      source: "hand",
      pointerId: 1,
      at: { x: slot.x + 56, y: slot.y + 30 },
      grab: { x: 50, y: 30 },
    });
    // home is its place at rest, straight: flights carry no rotation
    expect(start.home()).toEqual({ left: slot.x, top: slot.y, width: 104, height: 146 });
    // the drag is the carried layer's now: letting go here picks nothing up
    point("pointerup", window, slot.x + 56, slot.y + 30);
    expect(store.snapshot().held).toBeNull();
  });

  it("reaches the card under the pointer — its × removes it, and so does ⌫, but never a field's own ⌫", () => {
    vi.useFakeTimers();
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    point("pointermove", window, restSlot(3, 2).x + CARD_W / 2, FOOT);
    const x = el.querySelector<HTMLButtonElement>('[data-slot="c"] .vf-card-x');
    expect(x).not.toBeNull();
    expect(el.querySelectorAll(".vf-card-x")).toHaveLength(1);
    act(() => x?.click());
    expect(ids(store)).toEqual(["a", "b"]);
    // it leaves past the foot, then is gone
    expect(el.querySelector<HTMLElement>('[data-slot="c"]')?.dataset.phase).toBe("leaving");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(el.querySelector('[data-slot="c"]')).toBeNull();
    // the pointer ON the card now (its face under it), which is what ⌫ takes
    point("pointermove", faceOf(el, "b"), restSlot(2, 1).x + CARD_W / 2, FOOT);
    expect(el.querySelector('[data-slot="b"] .vf-card-x')).not.toBeNull();
    const field = document.createElement("input");
    document.body.appendChild(field);
    try {
      field.focus();
      expect(press(field, { key: "Backspace" }).defaultPrevented).toBe(false);
      expect(ids(store)).toEqual(["a", "b"]);
    } finally {
      field.remove();
    }
    expect(press(document.body, { key: "Backspace" }).defaultPrevented).toBe(true);
    expect(ids(store)).toEqual(["a"]);
  });

  it("takes ⌫ from a control that holds no caret — a checkbox — and leaves it to what is editable (the one field test, caret.ts)", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    point("pointermove", faceOf(el, "c"), restSlot(3, 2).x + CARD_W / 2, FOOT);
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    const box = document.createElement("input");
    box.type = "checkbox";
    document.body.append(editor, box);
    try {
      expect(press(editor, { key: "Backspace" }).defaultPrevented, "the editor's").toBe(false);
      expect(ids(store)).toEqual(["a", "b", "c"]);
      expect(press(box, { key: "Backspace" }).defaultPrevented, "the hand's").toBe(true);
      expect(ids(store)).toEqual(["a", "b"]);
    } finally {
      editor.remove();
      box.remove();
    }
  });

  it("keeps a carried card's place, hidden, and answers nothing while a drag carries", () => {
    drag.carried = { card: { id: "b" } };
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    expect(el.querySelector<HTMLElement>('[data-slot="b"]')?.dataset.phase).toBe("hidden");
    point("pointermove", window, restSlot(3, 2).x + CARD_W / 2, FOOT);
    expect(el.querySelector(".vf-card-x")).toBeNull();
    expect(el.querySelector(".vf-cards-label")).toBeNull();
  });

  it("steps down out of the pegboard's way, and answers nothing there", () => {
    const store = handOf("a", "b", "c");
    const el = mount(<Owned store={store} host={fakeHost()} tucked />);
    expect(el.querySelector(".vf-cards")?.hasAttribute("data-tucked")).toBe(true);
    point("pointermove", window, restSlot(3, 2).x + CARD_W / 2, FOOT);
    expect(el.querySelector(".vf-card-x")).toBeNull();
  });
});

describe("the twelve (HN-D8) and the mount", () => {
  it("pushes the oldest off the left when the thirteenth is dealt, and frees its picture once it is past the foot", async () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const store = new CardStore(() => NOW);
    const pasted: PictCard = {
      id: "p1",
      kind: "pict",
      origin: { view: "outside", how: "paste" },
      at: NOW,
      title: "Pasted",
      width: 640,
      height: 400,
      src: "blob:pasted-picture",
      paste: "",
    };
    store.deal(pasted);
    store.landed("p1");
    for (let n = 2; n <= 12; n += 1) {
      store.deal(text(`c${n}`));
      store.landed(`c${n}`);
    }
    const el = mount(<Owned store={store} host={fakeHost()} />);
    await act(async () => {
      store.deal(text("c13"));
      await Promise.resolve();
    });
    expect(store.snapshot().cards).toHaveLength(12);
    expect(ids(store)[0]).toBe("c2");
    expect(el.querySelector<HTMLElement>('[data-slot="p1"]')?.dataset.phase).toBe("leaving");
    expect(revoke).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(el.querySelector('[data-slot="p1"]')).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:pasted-picture");
  });

  it("leaves nothing open when the card in hand is the one the thirteenth pushes off", () => {
    const store = handOf(...Array.from({ length: 12 }, (_, n) => `c${n + 1}`));
    mount(<Owned store={store} host={fakeHost()} />);
    press(document.body, { key: "V", metaKey: true, shiftKey: true });
    for (let n = 0; n < 11; n += 1) press(document.body, { key: "ArrowLeft" });
    press(document.body, { key: "Enter" });
    expect(store.snapshot().held).toBe("c1");
    expect(surfaceNow).toBe("cards");
    act(() => store.deal(text("c13")));
    expect(store.snapshot().held).toBeNull();
    expect(surfaceNow).toBeNull();
  });

  it("shrinks a held card the thirteenth pushes off where it stands — its layer kept, no twin off the foot — and frees its picture after (R-B 10)", async () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const store = fullHand();
    const el = mount(<Owned store={store} host={fakeHost()} />);
    clickUp(el, "p1", 12, 0);
    const layer = el.querySelector<HTMLElement>(".vf-cards-held");
    expect(layer?.dataset.phase).toBe("up");
    await act(async () => {
      store.deal(text("c13"));
      await Promise.resolve();
    });
    expect(store.snapshot().held).toBeNull();
    expect(surfaceNow).toBeNull();
    expect(el.querySelector(".vf-cards-held")).toBe(layer);
    expect(layer?.dataset.phase).toBe("gone");
    expect(el.querySelector('[data-slot="p1"]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(320);
    });
    expect(el.querySelector(".vf-cards-held")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:p1");
  });

  it("leaves a carried card the thirteenth pushes off to its carry — no twin slides off the foot — and frees its picture once the carry has ended (R-B 10)", async () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const store = fullHand();
    drag.carried = { card: { id: "p1" } };
    const el = mount(<Owned store={store} host={fakeHost()} />);
    expect(el.querySelector<HTMLElement>('[data-slot="p1"]')?.dataset.phase).toBe("hidden");
    await act(async () => {
      store.deal(text("c13"));
      await Promise.resolve();
    });
    expect(ids(store)[0]).toBe("c2");
    expect(el.querySelector('[data-slot="p1"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(revoke).not.toHaveBeenCalled();
    // the carry ends (home, or faded where it was let go): the next render lets the picture go
    drag.carried = null;
    point("pointermove", window, 600, FOOT);
    expect(revoke).toHaveBeenCalledWith("blob:p1");
  });

  it("removes a card picked up: it leaves the hand and shrinks where it stands — never also off the foot — and its picture goes once it has (R-T 10)", () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const store = new CardStore(() => NOW);
    for (const card of [text("a"), pasted("p"), text("c")]) {
      store.deal(card);
      store.landed(card.id);
    }
    const el = mount(<Owned store={store} host={fakeHost()} />);
    clickUp(el, "p", 3, 1);
    const layer = el.querySelector<HTMLElement>(".vf-cards-held");
    const remove = layer?.querySelector<HTMLButtonElement>(".vf-cards-bar button");
    expect(remove?.textContent).toBe("Remove");
    act(() => remove?.click());
    expect(ids(store)).toEqual(["a", "c"]);
    expect(store.snapshot().held).toBeNull();
    expect(surfaceNow).toBeNull();
    expect(el.querySelector('[data-slot="p"]')).toBeNull();
    expect(el.querySelector(".vf-cards-held")).toBe(layer);
    expect(layer?.dataset.phase).toBe("gone");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(revoke).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:p");
    expect(el.querySelector(".vf-cards-held")).toBeNull();
  });

  it("lifts a twin of the newest on the pop and says so, then settles it back on the retract curve (HN-D10)", () => {
    vi.useFakeTimers();
    const store = handOf("a", "b");
    const el = mount(<Owned store={store} host={fakeHost()} />);
    act(() => store.nudge("b"));
    const twin = el.querySelector<HTMLElement>('[data-slot="b"]');
    expect(twin?.hasAttribute("data-nudged")).toBe(true);
    expect(twin?.hasAttribute("data-settling")).toBe(false);
    expect(el.querySelector(".vf-cards-label")?.textContent).toBe("Already in your hand");
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(twin?.hasAttribute("data-nudged")).toBe(false);
    expect(twin?.hasAttribute("data-settling")).toBe(true);
    expect(el.querySelector(".vf-cards-label")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(280);
    });
    expect(twin?.hasAttribute("data-settling")).toBe(false);
  });

  it("is mounted by ChromeLayer where the clipboard tray stood, on the frame's one owner, told when Settings is open", () => {
    expect(CHROME).toMatch(
      /<Cards\s+surface=\{surface\}\s+onSurfaceChange=\{onSurfaceChange\}\s+tucked=\{boardOut\}\s+settingsOpen=\{showSettings\}\s+\/>/u,
    );
    expect(CHROME).not.toContain("ClipboardTray");
    // The right edge's tray, which stood on beside the hand after HN-1, left the frame at HN-8:
    // its absence is held with the edges' other pieces (`ui-system-boundaries.test.ts`).
  });

  it("hears another app while it is here (HN-6): a paste with no caret deals into its hand, a file named through its host's door — and once it is gone, nothing", async () => {
    const store = new CardStore(() => NOW);
    const notes = new File(["one\n"], "notes.md", { type: "text/markdown" });
    const host: CardsHost = {
      ...fakeHost(),
      pathForFile: (file) => (file === notes ? "/Users/me/notes.md" : null),
    };
    mount(<Owned store={store} host={host} />);
    const paste = (): ClipboardEvent => {
      const data = {
        types: ["Files"],
        items: [{ kind: "file", type: notes.type, getAsFile: () => notes }],
        files: [notes],
        getData: () => "",
      } as unknown as DataTransfer;
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      // the person's own ⌘V, as the app menu sends it: trusted, as no test's event is
      Object.defineProperty(event, "isTrusted", { value: true });
      document.body.dispatchEvent(event);
      return event;
    };

    await act(async () => {
      expect(paste().defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(ids(store)).toHaveLength(1));
    });
    expect(store.snapshot().cards[0]).toMatchObject({
      kind: "file",
      name: "notes.md",
      paste: "/Users/me/notes.md",
      origin: { view: "outside", how: "paste" },
    });
    act(() => root?.unmount());
    root = null;
    expect(paste().defaultPrevented, "a hand gone hears no paste").toBe(false);
  });

  it("deals no paste with no caret while Settings is open over it — its card would land unseen under the sheet — and deals again once it has closed", async () => {
    const store = new CardStore(() => NOW);
    const host = fakeHost();
    const paste = (): ClipboardEvent => {
      const data = {
        types: ["text/plain"],
        items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
        files: [],
        getData: (format: string) => (format === "text/plain" ? "From Notes." : ""),
      } as unknown as DataTransfer;
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      Object.defineProperty(event, "isTrusted", { value: true });
      document.body.dispatchEvent(event);
      return event;
    };
    mount(<Owned store={store} host={host} settingsOpen />);
    expect(paste().defaultPrevented, "Settings stands over the hand").toBe(false);
    // the same hand, its sheet closed: read at the paste, never when it began to listen
    act(() => root?.render(<Owned store={store} host={host} settingsOpen={false} />));
    await act(async () => {
      expect(paste().defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(ids(store)).toHaveLength(1));
    });
    expect(store.snapshot().cards[0]).toMatchObject({ kind: "text", paste: "From Notes." });
  });
});
