/**
 * IK — THE WORDS BAR IN THE CHROME (field/desk/bar/SelectionBar.tsx over SelectionBarView.tsx and bar-words.ts; DESIGN.md
 * §8 "The words bar"; ICE I60). Over a real field engine and a desk handle that keeps ICE's doors' contract, the test
 * publishes the anchor as the desk would while a sheet is written — its `words` (their box, their object, their range, the
 * object's WORDS acts) — and holds:
 *   THE MODEL AND PLACE — words with acts bring the words' row in the objects' place, over the words' box by the bar's own
 *     place (foot 10 above, flipped below at 94, 16 from the sides); no words, the objects' bar; words with no acts change
 *     nothing; while a claimed press is down ICE says no words: the bar waits, saying what it said, and comes 200 ms after
 *     the release; a gesture sends it away as before;
 *   THE ROWS — a choice act swaps the row for its choices (Back first, the words' choice on), a choice runs at once with
 *     the range and the row stays, Back and Esc return (Esc taken ahead of the editor's field), a 120 ms cross-fade (reduced
 *     motion halved); a toggle shows `aria-pressed`; each act runs `ops.runMenuAction(id, taken?, { range })` (I62's
 *     call, the choice taken as `{ id }`) with the range the LAST PUBLISH said; More grows the words' menu (V5b, below);
 *   THE FOCUS — a press on the words' row keeps the field's focus and its range (pointerdown's and mousedown's defaults);
 *     the keys as the bar has (← →, Esc back to the desk);
 *   ⌘C — while words are selected on a sheet being written the bar claims no ⌘C (the field's copy runs); with objects
 *     selected it is still Make a card.
 *   THE WORDS' MORE (V5b) — More and a right-click on the sheet being written grow the bar into the words' menu, Cut · Copy ·
 *     Paste | Select all with the field's keys, each run ONCE through the desk's one editor's `command` (a double: happy-dom
 *     has no editor) with the field's focus kept; a command that did nothing is said on the status line; in the app (a host
 *     that reads the clipboard through main) Paste waits and says ⌘V; a right-click anywhere else is the objects' as before;
 *     a slot's declared `keys` printed in its tip.
 * No kind on the desk declares words acts yet (ICE's ink acts arrive with the note's next slice): the anchors are fixtures.
 */
import { type CanvasEngine, type Entity, setWidgetProps } from "@vibecook/ice";
import type { MenuSlot, SelectionAnchor, WordsAnchor } from "@vibecook/ice/desk";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBarStats, resetBarStatsForTest } from "../src/field/desk/bar/bar-stats";
import { SelectionBar } from "../src/field/desk/bar/SelectionBar";
import { lastCopy } from "../src/field/desk/copy/copy-record";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { deskObjects, type MountedDesk, publishDesk } from "../src/field/desk/desk-door";
import { deskLook } from "../src/field/desk/desk-layer";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";
import { cardsStore } from "../src/frame/cards/cards-store";
import type { FrameSurface } from "../src/frame/frame-surface";
import { hearLineSays } from "../src/frame/line-door";
import { type FieldHost, setHost } from "../src/host";
import { getAppTheme } from "../src/theme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW = { width: 1180, height: 780 };
const BOX = { x0: 400, y0: 300, x1: 600, y1: 450 };
/** The words selected on the note: their box on screen, CSS px. */
const WORDS_BOX = { x0: 450, y0: 320, x1: 570, y1: 342 };

const PENS = ["felt", "ball", "fountain", "red"] as const;
const HIGHLIGHTERS = ["yellow", "green", "pink", "blue", "orange"] as const;
const titled = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/** ICE's ink acts as the anchor carries them (this build's `inkActs`, I61/I62's shape: the words' value as `current` on one
 * choice; no swatch said — ICE's own note's — so the bar draws the pens and highlighters by name), each as it stands now. */
function inkMenu(
  now: { pen?: string; highlight?: string; strike?: boolean; underline?: boolean } = {},
): MenuSlot[] {
  const current = (id: string, at: string | undefined) => (id === at ? { current: true } : {});
  return [
    {
      id: "ink.pen",
      label: "Pen",
      glyph: "pen",
      choices: PENS.map((n) => ({ id: n, label: `${titled(n)} pen`, ...current(n, now.pen) })),
    },
    {
      id: "ink.highlight",
      label: "Highlight",
      glyph: "highlighter",
      choices: [
        ...HIGHLIGHTERS.map((n) => ({ id: n, label: titled(n), ...current(n, now.highlight) })),
        { id: "none", label: "None", ...current("none", now.highlight) },
      ],
    },
    { id: "ink.strike", label: "Strike", glyph: "strike", pressed: now.strike ?? false },
    {
      id: "ink.underline",
      label: "Underline",
      glyph: "underline",
      pressed: now.underline ?? false,
    },
    { id: "ink.clear", label: "Clear", glyph: "clear-marks" },
  ];
}

const restingAnchor = (over: Partial<SelectionAnchor> = {}): SelectionAnchor => ({
  box: BOX,
  count: 1,
  locked: false,
  gesturing: false,
  editing: false,
  view: VIEW,
  rulers: { margin: 0, band: 26 },
  ...over,
});

interface FakeSelection {
  anchor(): SelectionAnchor;
  subscribe(fn: () => void): () => void;
  publish(over: { readonly [K in keyof SelectionAnchor]?: SelectionAnchor[K] | undefined }): void;
}

function fakeSelection(initial: SelectionAnchor): FakeSelection {
  let anchor = initial;
  const listeners = new Set<() => void>();
  return {
    anchor: () => anchor,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    publish(over) {
      anchor = { ...anchor, ...over } as SelectionAnchor;
      for (const fn of [...listeners]) fn();
    },
  };
}

let host: HTMLDivElement;
let root: Root;
let ce: CanvasEngine;
let selection: FakeSelection;
let unpublish: () => void;
let deskElement: HTMLDivElement;
let surfaceNow: FrameSurface | null;
let note: Entity;
/** The editor's field stands in as a textarea, as ICE's one editor is: what reached its own listeners. */
let field: HTMLTextAreaElement;
let fieldHeard: string[];
/** The desk's pick (`handle.pick`): what a right-click is over. */
let pick: ReturnType<typeof vi.fn>;
/** The commands the desk's one editor was asked, in order, and what it answers. */
let commands: string[];
let answer: boolean | Error;

/** The words as ICE publishes them while the note is written: the note's words [4, 12) and its ink acts. */
const words = (over: Partial<WordsAnchor> = {}): WordsAnchor => ({
  box: WORDS_BOX,
  entity: note,
  from: 4,
  to: 12,
  menu: inkMenu({ pen: "fountain" }),
  ...over,
});

function Harness(): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  surfaceNow = surface;
  return createElement(SelectionBar, {
    surface,
    onSurfaceChange: setSurface,
    hidden: false,
    keys: "mac",
  });
}

const bar = (): HTMLElement => {
  const el = host.querySelector<HTMLElement>("[data-selection-bar]");
  if (el === null) throw new Error("no bar");
  return el;
};
const row = (key: string): HTMLElement => {
  const el = [...bar().querySelectorAll<HTMLElement>('[data-face-row="words"]')].find(
    (r) => r.dataset.wordsRow === key,
  );
  if (el === undefined) throw new Error(`no words row ${key}`);
  return el;
};
/** The words' row shown: its key ("main", or the open choice act's id). */
const shownRow = (): string | undefined =>
  bar().querySelector<HTMLElement>('[data-face-row="words"][data-shown]')?.dataset.wordsRow;
/** The main row as a reader meets it: its cells' acts, `|` a rule. */
const wordsSaid = (): string[] =>
  [...row("main").children].map((el) =>
    el.classList.contains("vf-bar-rule") ? "|" : ((el as HTMLElement).dataset.act ?? "?"),
  );
const cell = (act: string, key = "main"): HTMLElement => {
  const el = [...row(key).querySelectorAll<HTMLElement>("[data-act]")].find(
    (c) => c.dataset.act === act,
  );
  if (el === undefined) throw new Error(`no ${act} in ${key}`);
  return el;
};
const pickOf = (act: string, choice: string): HTMLElement => {
  const el = [...row(act).querySelectorAll<HTMLElement>("[data-choice]")].find(
    (c) => c.dataset.choice === choice,
  );
  if (el === undefined) throw new Error(`no ${choice} in ${act}`);
  return el;
};
const key = (k: string, target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

beforeEach(async () => {
  resetBarStatsForTest();
  ce = createFieldEngine(buildRegistry());
  await seedField(ce, ce.docs.create(), createDeskBlobStore(), undefined, { examples: true });
  note = deskObjects(ce, "desk.note")[0]?.entity as Entity;
  ce.ops.setSelection([note]);
  selection = fakeSelection(restingAnchor({ editing: true, words: words() }));
  deskElement = document.createElement("div");
  deskElement.setAttribute("data-ice-canvas", "");
  const canvas = document.createElement("canvas");
  deskElement.append(canvas);
  document.body.append(deskElement);
  field = document.createElement("textarea");
  field.value = "Ship the desk by Friday.";
  fieldHeard = [];
  field.addEventListener("keydown", (event) => fieldHeard.push(event.key));
  document.body.append(field);
  pick = vi.fn(() => null);
  commands = [];
  answer = true;
  const editor = {
    command: vi.fn(async (name: string) => {
      commands.push(name);
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
  const desk: MountedDesk = {
    engine: ce,
    handle: {
      selection,
      pick,
      editor: () => editor,
      canvas,
      status: () => ({ state: "ready" }),
      capture: vi.fn(async () => undefined),
      perf: () => ({ frames: 0 }),
      dirty: () => false,
    } as unknown as MountedDesk["handle"],
    generation: 1,
    mount: 0,
    theme: "light",
    words: (type) => ({ type, title: "Note", state: null, label: "Note" }),
  };
  unpublish = publishDesk(desk);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  deskElement.remove();
  field.remove();
  unpublish();
  ce.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const mount = (): void => {
  act(() => root.render(createElement(Harness)));
};

describe("the words bar: the model and its place (IK)", () => {
  it("comes to the words: the words' row in the objects' place, over their box, a toolbar named Words with ONE tab stop", () => {
    mount();
    expect(bar().dataset.shown).toBe("true");
    expect(bar().hasAttribute("data-words")).toBe(true);
    expect(wordsSaid()).toEqual([
      "word:ink.pen",
      "word:ink.highlight",
      "|",
      "word:ink.strike",
      "word:ink.underline",
      "|",
      "word:ink.clear",
      "more",
    ]);
    expect(shownRow()).toBe("main");
    expect(row("main").getAttribute("role")).toBe("toolbar");
    expect(row("main").getAttribute("aria-label")).toBe("Words");
    expect([...row("main").querySelectorAll('[tabindex="0"]')]).toHaveLength(1);
    // the objects' row stands aside, unread and unreachable
    const objects = bar().querySelector<HTMLElement>('[data-face-row="selection"]');
    expect(objects?.hasAttribute("inert")).toBe(true);
    expect(objects?.getAttribute("aria-hidden")).toBe("true");
    // centred over the words, its foot 10 above them (happy-dom lays nothing out: the bar's own width reads 0)
    expect(bar().style.transform).toBe(
      `translate(${((450 + 570) / 2).toFixed(1)}px, ${(320 - 10 - 40).toFixed(1)}px) translateX(-50%)`,
    );
    expect(bar().dataset.below).toBe("false");
  });

  it("draws the words' pen a dot and their highlighter a stripe in the desk's own inks — hollow when none is shared", () => {
    mount();
    const palette = deskLook(getAppTheme().resolved).palette;
    const pen = cell("word:ink.pen").querySelector<HTMLElement>(".vf-bar-swatch");
    expect(pen?.dataset.shape).toBe("dot");
    expect(pen?.style.getPropertyValue("--vf-bar-swatch")).toBe(palette.pens?.fountain?.css);
    const highlight = cell("word:ink.highlight").querySelector<HTMLElement>(".vf-bar-swatch");
    expect(highlight?.dataset.shape).toBe("stripe");
    expect(highlight?.hasAttribute("data-hollow")).toBe(true);
    // each choice cell is a 44 cell: its value, then the ▾ — the chevron turned down
    expect(cell("word:ink.pen").classList.contains("vf-bar-choice")).toBe(true);
    const tick = cell("word:ink.pen").querySelector('[data-glyph="chevron"]');
    expect(tick?.getAttribute("width")).toBe("8");
    expect(tick?.firstElementChild?.getAttribute("transform")).toBe("rotate(90 12 12)");
    // the kind's glyphs by §13's table — the set's own strike, underline and clear-marks
    expect(
      ["word:ink.strike", "word:ink.underline", "word:ink.clear"].map((a) =>
        cell(a).querySelector("[data-glyph]")?.getAttribute("data-glyph"),
      ),
    ).toEqual(["strike", "underline", "clear-marks"]);
    act(() => selection.publish({ words: words({ menu: inkMenu({ highlight: "orange" }) }) }));
    expect(
      cell("word:ink.highlight")
        .querySelector<HTMLElement>(".vf-bar-swatch")
        ?.style.getPropertyValue("--vf-bar-swatch"),
    ).toBe(palette.calendars?.highlighters?.orange?.css);
    expect(
      cell("word:ink.pen")
        .querySelector<HTMLElement>(".vf-bar-swatch")
        ?.hasAttribute("data-hollow"),
    ).toBe(true);
  });

  it("no words, the objects' bar; words whose kind declares no acts change nothing — the bar stays away while it is written", () => {
    vi.useFakeTimers();
    selection.publish({ editing: false, words: undefined });
    mount();
    expect(bar().hasAttribute("data-words")).toBe(false);
    expect(bar().querySelector('[data-face-row="words"]')).toBeNull();
    expect(bar().querySelector('[data-face-row="selection"]')?.getAttribute("aria-label")).toBe(
      "Selection",
    );
    // the note today: words published with an empty menu (ICE E7's note) — away, as while any note is written
    act(() => selection.publish({ editing: true, words: words({ menu: [] }) }));
    expect(bar().dataset.shown).toBe("false");
    expect(bar().hasAttribute("data-words")).toBe(false);
    act(() => selection.publish({ editing: false, words: undefined }));
    act(() => vi.advanceTimersByTime(200));
    expect(bar().dataset.shown).toBe("true");
    expect(bar().querySelector('[data-face-row="words"]')).toBeNull();
  });

  it("WAITS while a claimed press is down (ICE says no words then), saying what it said — and comes 200 ms after the release, over the new words", () => {
    vi.useFakeTimers();
    mount();
    const stood = bar().style.transform;
    // the press: no words while it is down, the sheet still written
    act(() => selection.publish({ words: undefined }));
    expect(bar().dataset.shown).toBe("false");
    expect(bar().style.transition).toBe("opacity 90ms ease-out, visibility 0s linear 90ms");
    // it fades out still saying the words — never a flash of the objects' row — where it stood
    expect(bar().hasAttribute("data-words")).toBe(true);
    expect(wordsSaid()[0]).toBe("word:ink.pen");
    expect(bar().style.transform).toBe(stood);
    // the release: a new range, its own box
    act(() =>
      selection.publish({
        words: words({ from: 0, to: 4, box: { x0: 300, y0: 400, x1: 380, y1: 422 } }),
      }),
    );
    expect(bar().style.transform).toBe("translate(340.0px, 350.0px) translateX(-50%)");
    act(() => vi.advanceTimersByTime(199));
    expect(bar().dataset.shown).toBe("false");
    act(() => vi.advanceTimersByTime(1));
    expect(bar().dataset.shown).toBe("true");
    expect(bar().style.transition).toBe("opacity 180ms ease-out");
  });

  it("flips below at the safe top (94) and keeps 16 from the sides, as over objects; words off-screen hide it", () => {
    mount();
    act(() => selection.publish({ words: words({ box: { x0: -20, y0: 60, x1: 10, y1: 80 } }) }));
    expect(bar().style.transform).toBe("translate(16.0px, 94.0px) translateX(-50%)");
    expect(bar().dataset.below).toBe("true");
    act(() => selection.publish({ words: words({ box: { x0: -90, y0: 300, x1: -20, y1: 320 } }) }));
    expect(bar().dataset.shown).toBe("false");
  });

  it("goes for a gesture as now — out at once, back 200 ms after it ends", () => {
    vi.useFakeTimers();
    mount();
    act(() => selection.publish({ gesturing: true }));
    expect(bar().dataset.shown).toBe("false");
    act(() => selection.publish({ gesturing: false }));
    act(() => vi.advanceTimersByTime(199));
    expect(bar().dataset.shown).toBe("false");
    act(() => vi.advanceTimersByTime(1));
    expect(bar().dataset.shown).toBe("true");
    expect(bar().hasAttribute("data-words")).toBe(true);
  });
});

describe("the words bar: its rows and its acts (IK)", () => {
  it("Pen ▾ swaps the row for the pens — Back first, the words' pen on — by a 120 ms cross-fade, the glass's width following; Back returns", () => {
    vi.useFakeTimers();
    mount();
    expect(bar().style.getPropertyValue("--vf-bar-swap-ms")).toBe("120ms");
    act(() => cell("word:ink.pen").click());
    expect(shownRow()).toBe("ink.pen");
    expect(row("main").hasAttribute("data-shown")).toBe(false);
    expect(row("main").hasAttribute("inert")).toBe(true);
    expect(row("ink.pen").getAttribute("aria-label")).toBe("Pen");
    expect(row("ink.pen").hasAttribute("inert")).toBe(false);
    expect(
      [...row("ink.pen").children].map(
        (el) => (el as HTMLElement).dataset.act ?? (el as HTMLElement).dataset.choice,
      ),
    ).toEqual(["back", "felt", "ball", "fountain", "red"]);
    // Back wears §13's chevron turned 180
    expect(
      cell("back", "ink.pen")
        .querySelector("[data-glyph]")
        ?.firstElementChild?.getAttribute("transform"),
    ).toBe("rotate(180 12 12)");
    expect(PENS.map((n) => pickOf("ink.pen", n).getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    expect(pickOf("ink.pen", "ball").getAttribute("aria-label")).toBe("Ball pen");
    expect(
      pickOf("ink.pen", "felt").querySelector<HTMLElement>(".vf-bar-swatch")?.dataset.shape,
    ).toBe("dot");
    expect(bar().style.transition).toContain("width 120ms ease");
    act(() => vi.advanceTimersByTime(120 + 100));
    expect(bar().style.transition).not.toContain("width");
    act(() => cell("back", "ink.pen").click());
    expect(shownRow()).toBe("main");
    // Highlight ▾'s own row: the five and None, hollow
    act(() => cell("word:ink.highlight").click());
    expect(
      [...row("ink.highlight").querySelectorAll<HTMLElement>("[data-choice]")].map(
        (el) => el.dataset.choice,
      ),
    ).toEqual(["yellow", "green", "pink", "blue", "orange", "none"]);
    expect(
      pickOf("ink.highlight", "none")
        .querySelector<HTMLElement>(".vf-bar-swatch")
        ?.hasAttribute("data-hollow"),
    ).toBe(true);
  });

  it("a choice runs at once with the words' range, and the row STAYS — a second choice replaces the first, on the range the last publish said", () => {
    mount();
    const run = vi.spyOn(ce.ops, "runMenuAction");
    act(() => cell("word:ink.pen").click());
    expect(run).not.toHaveBeenCalled(); // the swap runs nothing
    act(() => pickOf("ink.pen", "red").click());
    expect(run).toHaveBeenLastCalledWith(
      "ink.pen",
      { id: "red" },
      {
        range: { entity: note, from: 4, to: 12 },
      },
    );
    expect(shownRow()).toBe("ink.pen");
    // the kind says its words are red now — the same run, the row still open, red on
    act(() => selection.publish({ words: words({ menu: inkMenu({ pen: "red" }) }) }));
    expect(shownRow()).toBe("ink.pen");
    expect(pickOf("ink.pen", "red").getAttribute("aria-pressed")).toBe("true");
    expect(pickOf("ink.pen", "red").hasAttribute("data-on")).toBe(true);
    // the range ALONE grows (Shift, the field's own): what the bar says is the same, so nothing renders — and the next
    // choice runs on the range the publish said, never a render's copy
    const renders = readBarStats().renders;
    act(() =>
      selection.publish({
        words: words({ to: 16, box: { ...WORDS_BOX, x1: 610 }, menu: inkMenu({ pen: "red" }) }),
      }),
    );
    expect(readBarStats().renders).toBe(renders);
    act(() => pickOf("ink.pen", "felt").click());
    expect(run).toHaveBeenLastCalledWith(
      "ink.pen",
      { id: "felt" },
      {
        range: { entity: note, from: 4, to: 16 },
      },
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a toggle shows aria-pressed and runs with the range; a plain act runs with it; More runs no act", () => {
    mount();
    const run = vi.spyOn(ce.ops, "runMenuAction");
    expect(cell("word:ink.strike").getAttribute("aria-pressed")).toBe("false");
    expect(cell("word:ink.clear").hasAttribute("aria-pressed")).toBe(false);
    act(() => cell("word:ink.strike").click());
    expect(run).toHaveBeenLastCalledWith("ink.strike", undefined, {
      range: { entity: note, from: 4, to: 12 },
    });
    act(() => selection.publish({ words: words({ menu: inkMenu({ strike: true }) }) }));
    expect(cell("word:ink.strike").getAttribute("aria-pressed")).toBe("true");
    expect(cell("word:ink.strike").hasAttribute("data-on")).toBe(true);
    act(() => cell("word:ink.clear").click());
    expect(run).toHaveBeenLastCalledWith("ink.clear", undefined, {
      range: { entity: note, from: 4, to: 12 },
    });
    // More runs no act: it grows the words' menu (V5b)
    const more = cell("more");
    expect(more.hasAttribute("aria-disabled")).toBe(false);
    act(() => more.click());
    expect(run).toHaveBeenCalledTimes(2);
    expect(surfaceNow).toBe("selection");
    expect(bar().hasAttribute("data-open")).toBe(true);
  });

  it("an act its kind says is not enabled is drawn dim and aria-disabled, and its press runs nothing — a choice act opens no row", () => {
    const off = (slot: MenuSlot): MenuSlot =>
      slot.id === "ink.clear" ? slot : ({ ...slot, enabled: false } as MenuSlot);
    selection.publish({ words: words({ menu: inkMenu().map(off) }) });
    mount();
    const run = vi.spyOn(ce.ops, "runMenuAction");
    for (const id of ["ink.pen", "ink.highlight", "ink.strike", "ink.underline"]) {
      expect(cell(`word:${id}`).getAttribute("aria-disabled")).toBe("true");
      expect(cell(`word:${id}`).hasAttribute("data-disabled")).toBe(true);
      act(() => cell(`word:${id}`).click());
    }
    expect(run).not.toHaveBeenCalled();
    expect(shownRow()).toBe("main");
    expect(cell("word:ink.clear").hasAttribute("aria-disabled")).toBe(false);
    act(() => cell("word:ink.clear").click());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("Esc returns from the choices to the main row — taken ahead of the editor's field, which keeps the focus; the next Esc is the field's", () => {
    mount();
    act(() => field.focus());
    field.setSelectionRange(4, 12);
    act(() => cell("word:ink.pen").click());
    expect(shownRow()).toBe("ink.pen");
    // an IME's own Esc is never taken
    const composing = key("Escape", field, { isComposing: true });
    expect(composing.defaultPrevented).toBe(false);
    expect(shownRow()).toBe("ink.pen");
    fieldHeard = [];
    const taken = key("Escape", field);
    expect(taken.defaultPrevented).toBe(true);
    expect(shownRow()).toBe("main");
    expect(fieldHeard).toEqual([]);
    expect(document.activeElement).toBe(field);
    // on the main row the bar takes no Esc: the field's lease hears it
    const next = key("Escape", field);
    expect(next.defaultPrevented).toBe(false);
    expect(fieldHeard).toEqual(["Escape"]);
  });

  it("a new run of words — the words gone at a press and back at its release — closes the choices", () => {
    mount();
    act(() => cell("word:ink.pen").click());
    expect(shownRow()).toBe("ink.pen");
    act(() => selection.publish({ words: undefined }));
    // fading out, it still says the pens
    expect(shownRow()).toBe("ink.pen");
    act(() => selection.publish({ words: words({ from: 20, to: 24 }) }));
    expect(shownRow()).toBe("main");
  });

  it("REDUCED MOTION: the swap halved — 60 ms — a fade alone, the glass's width never animated (M6)", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...matchMedia.call(window, query),
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as typeof window.matchMedia;
    try {
      mount();
      expect(bar().style.getPropertyValue("--vf-bar-swap-ms")).toBe("60ms");
      act(() => cell("word:ink.pen").click());
      expect(shownRow()).toBe("ink.pen");
      expect(bar().style.transition).not.toContain("width");
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});

describe("the words bar: the focus and the keys (IK)", () => {
  it("a press on the words' row keeps the field's focus and its range — pointerdown's and mousedown's defaults prevented; the objects' bar keeps its own", () => {
    mount();
    act(() => field.focus());
    field.setSelectionRange(4, 12);
    for (const target of [cell("word:ink.pen"), cell("word:ink.strike"), cell("more")]) {
      const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
      const mouse = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      act(() => {
        target.dispatchEvent(down);
        target.dispatchEvent(mouse);
      });
      expect(down.defaultPrevented, target.dataset.act).toBe(true);
      expect(mouse.defaultPrevented, target.dataset.act).toBe(true);
    }
    act(() => cell("word:ink.pen").click());
    const pick = pickOf("ink.pen", "red");
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    act(() => {
      pick.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    act(() => pick.click());
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([4, 12]);
    // the words gone (the sheet put down), the objects' bar's presses are its own again
    act(() => selection.publish({ editing: false, words: undefined }));
    const objects = bar().querySelector<HTMLElement>(
      '[data-face-row="selection"] [data-act="duplicate"]',
    );
    const plain = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    act(() => {
      objects?.dispatchEvent(plain);
    });
    expect(plain.defaultPrevented).toBe(false);
  });

  it("the keys as the bar has: ← → Home End between its cells (a rule no stop, More a stop), Enter on a choice opens its row on the words' choice, Esc and Back return to it, Esc on the row goes back to the desk", () => {
    mount();
    act(() => cell("word:ink.pen").focus());
    key("ArrowRight", document.activeElement as Element);
    expect(document.activeElement).toBe(cell("word:ink.highlight"));
    key("ArrowRight", document.activeElement as Element);
    expect(document.activeElement).toBe(cell("word:ink.strike"));
    key("End", document.activeElement as Element);
    expect(document.activeElement).toBe(cell("more"));
    key("Home", document.activeElement as Element);
    expect(document.activeElement).toBe(cell("word:ink.pen"));
    // Enter on Pen: its row, the focus on the words' pen
    key("Enter", document.activeElement as Element);
    expect(shownRow()).toBe("ink.pen");
    expect(document.activeElement).toBe(pickOf("ink.pen", "fountain"));
    key("Home", document.activeElement as Element);
    expect(document.activeElement).toBe(cell("back", "ink.pen"));
    key("Enter", document.activeElement as Element);
    expect(shownRow()).toBe("main");
    expect(document.activeElement).toBe(cell("word:ink.pen"));
    // Space opens it too; Esc returns, the focus back on Pen
    key(" ", document.activeElement as Element);
    expect(shownRow()).toBe("ink.pen");
    key("Escape", document.activeElement as Element);
    expect(shownRow()).toBe("main");
    expect(document.activeElement).toBe(cell("word:ink.pen"));
    // a choice taken from the keyboard runs, and the row stays
    const run = vi.spyOn(ce.ops, "runMenuAction");
    key("Enter", document.activeElement as Element);
    key("ArrowRight", document.activeElement as Element);
    expect(document.activeElement).toBe(pickOf("ink.pen", "red"));
    key("Enter", document.activeElement as Element);
    expect(run).toHaveBeenLastCalledWith(
      "ink.pen",
      { id: "red" },
      {
        range: { entity: note, from: 4, to: 12 },
      },
    );
    expect(shownRow()).toBe("ink.pen");
    key("Escape", document.activeElement as Element);
    // on the main row Esc goes back to the desk
    key("Escape", document.activeElement as Element);
    expect(bar().contains(document.activeElement)).toBe(false);
  });
});

describe("⌘C while a sheet is written (IK; DESIGN.md §8 'The words bar' — Keys)", () => {
  afterEach(() => {
    for (const card of cardsStore.snapshot().cards) cardsStore.remove(card.id);
  });

  const chord = (target: EventTarget): KeyboardEvent => key("c", target, { metaKey: true });

  it("the bar claims no ⌘C while words are selected or a caret is in the sheet — the field's copy runs — and with objects selected it is Make a card", async () => {
    const doc = ce.docs.current()?.store;
    if (doc === undefined) throw new Error("no document");
    setWidgetProps(doc, ce.world, note, { text: "Ship the desk by Friday." });
    ce.world.sync();
    mount();
    const seq = lastCopy()?.seq;
    act(() => field.focus());
    field.setSelectionRange(4, 12);
    // words selected: the field's own copy — never Make a card, from the field or from anywhere else
    expect(chord(field).defaultPrevented).toBe(false);
    expect(chord(document.body).defaultPrevented).toBe(false);
    // a caret only, the sheet still written: the field's
    act(() => selection.publish({ words: undefined }));
    expect(chord(document.body).defaultPrevented).toBe(false);
    expect(lastCopy()?.seq).toBe(seq);
    expect(cardsStore.snapshot().cards).toHaveLength(0);
    // the sheet put down, the note selected: ⌘C over the desk is Make a card again
    act(() => {
      field.blur();
      selection.publish({ editing: false });
    });
    expect(chord(document.body).defaultPrevented).toBe(true);
    expect(lastCopy()?.from).toBe("key");
    await act(async () => {
      await vi.waitFor(() => expect(cardsStore.snapshot().cards).toHaveLength(1), {
        timeout: 2_000,
      });
    });
    await vi.waitFor(() => expect(lastCopy()?.kept).not.toBeNull(), { timeout: 2_000 });
  });
});

describe("the words' More: Cut, Copy, Paste and Select all, right-click at the words, the keys' tips (IK, V5b)", () => {
  /** The grown menu's rows as a reader meets them, nearest first: `id key`, `|` a group's hairline. */
  const menuSaid = (): string[] =>
    [...bar().querySelectorAll<HTMLElement>(".vf-bar-list > *")].map((el) =>
      el.classList.contains("vf-bar-sep")
        ? "|"
        : el.classList.contains("vf-bar-eye")
          ? `eyebrow ${el.textContent}`
          : `${el.dataset.row} ${el.querySelector(".vf-bar-key")?.textContent ?? ""}`,
    );
  const menuRow = (id: string): HTMLElement => {
    const el = [...bar().querySelectorAll<HTMLElement>("[data-row]")].find(
      (r) => r.dataset.row === id,
    );
    if (el === undefined) throw new Error(`no row ${id}`);
    return el;
  };
  const rightClick = (): MouseEvent => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 500,
      clientY: 330,
    });
    act(() => {
      deskElement.querySelector("canvas")?.dispatchEvent(event);
    });
    return event;
  };
  /** Let the editor's answer and its `then` run. */
  const settle = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  afterEach(() => {
    setHost(null as unknown as FieldHost);
  });

  it("More grows the bar into the words' menu: Cut ⌘X · Copy ⌘C · Paste ⌘V | Select all ⌘A, WORDS at its far end; More shown on", () => {
    mount();
    act(() => cell("more").click());
    expect(surfaceNow).toBe("selection");
    expect(bar().hasAttribute("data-open")).toBe(true);
    expect(cell("more").getAttribute("aria-expanded")).toBe("true");
    expect(cell("more").getAttribute("aria-haspopup")).toBe("menu");
    expect(menuSaid()).toEqual([
      "words:cut ⌘X",
      "words:copy ⌘C",
      "words:paste ⌘V",
      "|",
      "words:selectAll ⌘A",
      "eyebrow WORDS",
    ]);
    expect(bar().querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe("Words");
    // the nearest row is hot; nothing waits where the page reads the clipboard
    expect(menuRow("words:cut").hasAttribute("data-hot")).toBe(true);
    expect(menuRow("words:paste").hasAttribute("aria-disabled")).toBe(false);
    // More again folds it
    act(() => cell("more").click());
    expect(surfaceNow).toBeNull();
  });

  it("each row runs its command ONCE through the desk's one editor, inside the press, the field's focus and range kept; the menu closes", async () => {
    mount();
    act(() => field.focus());
    field.setSelectionRange(4, 12);
    for (const name of ["cut", "copy", "paste", "selectAll"]) {
      act(() => cell("more").click());
      const target = menuRow(`words:${name}`);
      const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
      const mouse = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      act(() => {
        target.dispatchEvent(down);
        target.dispatchEvent(mouse);
      });
      expect(down.defaultPrevented, name).toBe(true);
      expect(mouse.defaultPrevented, name).toBe(true);
      act(() => target.click());
      expect(commands.at(-1), name).toBe(name);
      expect(surfaceNow, name).toBeNull();
      expect(document.activeElement, name).toBe(field);
      expect([field.selectionStart, field.selectionEnd], name).toEqual([4, 12]);
      await settle();
    }
    expect(commands).toEqual(["cut", "copy", "paste", "selectAll"]);
    // no act of a kind ran for them
  });

  it("a command that did nothing is SAID on the status line with the key that does it; Select all says nothing; a refusal is said and logged", async () => {
    const said: string[] = [];
    const unhear = hearLineSays((text) => said.push(text));
    try {
      mount();
      answer = false;
      for (const name of ["copy", "cut", "paste", "selectAll"]) {
        act(() => cell("more").click());
        act(() => menuRow(`words:${name}`).click());
        await settle();
      }
      expect(said).toEqual([
        "Couldn't copy these words. ⌘C copies them.",
        "Couldn't cut these words. ⌘X cuts them.",
        "Nothing to paste here. ⌘V pastes from the clipboard.",
      ]);
      answer = new Error("refused");
      act(() => cell("more").click());
      act(() => menuRow("words:copy").click());
      await settle();
      expect(said.at(-1)).toBe("Couldn't copy these words. ⌘C copies them.");
      // done, nothing is said
      answer = true;
      const before = said.length;
      act(() => cell("more").click());
      act(() => menuRow("words:copy").click());
      await settle();
      expect(said).toHaveLength(before);
    } finally {
      unhear();
    }
  });

  it("IN THE APP (a host that reads the clipboard through main, where the web's read is refused) Paste WAITS and says ⌘V — never a paste of stale words", () => {
    setHost({
      clipboard: { readText: async () => "words", writeImage: async () => undefined },
    } as unknown as FieldHost);
    mount();
    act(() => cell("more").click());
    const paste = menuRow("words:paste");
    expect(paste.getAttribute("aria-disabled")).toBe("true");
    expect(paste.getAttribute("title")).toBe(
      "Paste — the bar can't read the clipboard here; ⌘V pastes",
    );
    expect(paste.querySelector(".vf-bar-key")?.textContent).toBe("⌘V");
    act(() => paste.click());
    expect(commands).toEqual([]);
    // Cut, Copy and Select all still run
    act(() => menuRow("words:selectAll").click());
    expect(commands).toEqual(["selectAll"]);
  });

  it("Esc folds the words' menu, taken ahead of the editor's field, which keeps the focus; the next Esc is the field's", () => {
    mount();
    act(() => field.focus());
    act(() => cell("more").click());
    fieldHeard = [];
    const taken = key("Escape", field);
    expect(taken.defaultPrevented).toBe(true);
    expect(surfaceNow).toBeNull();
    expect(fieldHeard).toEqual([]);
    expect(document.activeElement).toBe(field);
    const next = key("Escape", field);
    expect(next.defaultPrevented).toBe(false);
    expect(fieldHeard).toEqual(["Escape"]);
  });

  it("RIGHT-CLICK on the sheet being written, words on it selected: the words' menu grows from the bar over the words, the selection untouched — from the pens' row too, back on the main row", () => {
    // the sheet is the lease's, not the desk's selection (a kind that writes without being selected): the right-click
    // must not select it first, as it would another object
    ce.ops.setSelection([]);
    mount();
    const select = vi.spyOn(ce.ops, "setSelection");
    pick.mockReturnValue({ entity: note });
    act(() => cell("word:ink.pen").click());
    expect(shownRow()).toBe("ink.pen");
    const event = rightClick();
    expect(event.defaultPrevented).toBe(true);
    expect(surfaceNow).toBe("selection");
    expect(select).not.toHaveBeenCalled();
    expect(shownRow()).toBe("main");
    expect(menuSaid()[0]).toBe("words:cut ⌘X");
    expect(bar().querySelector(".vf-bar-eye")?.textContent).toBe("WORDS");
  });

  it("RIGHT-CLICK elsewhere is the objects' as before: another object is selected first (its menu grows for it), the bare mat grows nothing", () => {
    mount();
    const select = vi.spyOn(ce.ops, "setSelection").mockImplementation(() => undefined);
    pick.mockReturnValue(null);
    rightClick();
    expect(surfaceNow).toBeNull();
    const other = (note + 1000) as Entity;
    pick.mockReturnValue({ entity: other });
    rightClick();
    expect(select).toHaveBeenCalledWith([other]);
    expect(surfaceNow).toBeNull();
  });

  it("at a CARET alone a right-click grows nothing (as before): the bar is away while no words are selected — §8's caret rows are not built", () => {
    selection.publish({ words: undefined });
    mount();
    pick.mockReturnValue({ entity: note });
    rightClick();
    expect(bar().hasAttribute("data-open")).toBe(false);
    expect(bar().dataset.shown).toBe("false");
  });

  it("the words going — or coming — folds an open menu: each menu is its own row's", () => {
    mount();
    act(() => cell("more").click());
    expect(surfaceNow).toBe("selection");
    act(() => selection.publish({ editing: false, words: undefined }));
    expect(surfaceNow).toBeNull();
    // the objects' menu open, words coming fold it too
    act(() => {
      bar().querySelector<HTMLElement>('[data-face-row="selection"] [data-act="more"]')?.click();
    });
    expect(surfaceNow).toBe("selection");
    expect(bar().querySelector(".vf-bar-eye")?.textContent).toBe("NOTE");
    act(() => selection.publish({ editing: true, words: words() }));
    expect(surfaceNow).toBeNull();
  });

  it("THE KEYS' TIPS: a slot's declared keys are printed in its tip the bar's way (two spaces); a slot that declares none, its label alone; nothing is bound", () => {
    const keyed = inkMenu().map((slot) =>
      slot.id === "ink.strike"
        ? { ...slot, keys: "⇧⌘X" }
        : slot.id === "ink.underline"
          ? { ...slot, keys: "⌘U" }
          : slot.id === "ink.highlight"
            ? { ...slot, keys: "⇧⌘H" }
            : slot,
    );
    selection.publish({ words: words({ menu: keyed }) });
    mount();
    expect(cell("word:ink.strike").getAttribute("title")).toBe("Strike  ⇧⌘X");
    expect(cell("word:ink.underline").getAttribute("title")).toBe("Underline  ⌘U");
    expect(cell("word:ink.highlight").getAttribute("title")).toBe("Highlight  ⇧⌘H");
    expect(cell("word:ink.clear").getAttribute("title")).toBe("Clear");
    expect(cell("word:ink.pen").getAttribute("title")).toBe("Pen");
    // the bar binds none of them: the key reaches the field untaken
    const run = vi.spyOn(ce.ops, "runMenuAction");
    act(() => field.focus());
    const chord = key("x", field, { metaKey: true, shiftKey: true });
    expect(chord.defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
