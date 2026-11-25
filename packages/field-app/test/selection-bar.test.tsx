/**
 * DK-11 — THE SELECTION BAR IN THE CHROME (field/desk/bar/SelectionBar.tsx over SelectionBarView.tsx; DESIGN.md §8 "The
 * selection bar", "The bar grown — More, and right-click"; R5, R7, R8, R9, R26). Over a real field engine (the seeded
 * first board) and a desk handle that keeps ICE's doors' contract — `selection.anchor()`/`subscribe()`, `pick`,
 * `status`, the canvas in its container — the test moves the anchor as the desk would publish it and holds:
 *   PLACEMENT — an imperative write per publish, never a render per frame (placements ≤ publishes);
 *   MOTION — away for a gesture (out 90, back 200 after, in 180), out over 120 on a deselect still saying what it
 *     said; REDUCED MOTION halves every duration and fades only (R8, M6);
 *   THE GROWN MENU — More grows it (the frame's open surface `selection`), nearest first under its eyebrow; it closes
 *     on Esc (taken before the desk's keymap), a press elsewhere, a gesture and a change of selection (R5);
 *   THE KEYS — a toolbar named "Selection" with one tab stop, ← → between its cells, Esc back to the desk (R9);
 *   RIGHT-CLICK — the object under the pointer selected FIRST by the desk's pick, then the same menu grown (R26);
 *   THE ACTS — through the engine's ops; COPY — its four doors, ⌘C among them, deal ONE card (HN-D3);
 *   OVER AN OBJECT AT WORK (item 550) — the foot clear of the marks, out with the draw-on and back with the retract.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CanvasEngine, type Entity, setWidgetProps } from "@vibecook/ice";
import type { SelectionAnchor } from "@vibecook/ice/desk";
import type { ObjectsPresenceSnapshot } from "@vibefield/contracts";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atWorkStore } from "../src/field/desk/at-work/at-work-store";
import { readBarStats, resetBarStatsForTest } from "../src/field/desk/bar/bar-stats";
import { SelectionBar } from "../src/field/desk/bar/SelectionBar";
import { lastCopy } from "../src/field/desk/copy/copy-record";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import {
  currentDesk,
  deskObjects,
  type MountedDesk,
  publishDesk,
} from "../src/field/desk/desk-door";
import type { ObjectWords } from "../src/field/desk/desk-object-words";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";
import { cardsStore } from "../src/frame/cards/cards-store";
import type { FrameSurface } from "../src/frame/frame-surface";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW = { width: 1180, height: 780 };
const BOX = { x0: 400, y0: 300, x1: 600, y1: 450 };

/** The anchor as the desk publishes it: one object selected, at rest. */
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
  /** The desk drew a frame that moved what the anchor says: the subscribers are told (an `undefined` takes a fact away —
   * the hand gone). */
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
let pick: ReturnType<typeof vi.fn>;
let surfaceNow: FrameSurface | null;
let note: Entity;
let pad: Entity;
let words: (type: string) => ObjectWords;
/** A stand-in for ICE's keymap on the window's bubble phase: what reached it un-taken (its gate 1). */
let keymapHeard: string[];
const keymap = (event: KeyboardEvent): void => {
  if (!event.defaultPrevented) keymapHeard.push(event.key);
};

function Harness({ hidden = false }: { hidden?: boolean }): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  surfaceNow = surface;
  return createElement(SelectionBar, {
    surface,
    onSurfaceChange: setSurface,
    hidden,
    keys: "mac",
  });
}

const bar = (): HTMLElement => {
  const el = host.querySelector<HTMLElement>("[data-selection-bar]");
  if (el === null) throw new Error("no bar");
  return el;
};
const cellActs = (): string[] =>
  [
    ...bar().querySelectorAll<HTMLElement>(
      ".vf-bar-row [data-act], .vf-bar-row .vf-bar-rule, .vf-bar-words",
    ),
  ].map(
    (el) =>
      el.dataset.act ?? (el.classList.contains("vf-bar-rule") ? "|" : `words:${el.textContent}`),
  );
const cell = (act: string): HTMLElement => {
  const el = bar().querySelector<HTMLElement>(`.vf-bar-row [data-act="${act}"]`);
  if (el === null) throw new Error(`no ${act} cell`);
  return el;
};
const rows = (): string[] =>
  [...bar().querySelectorAll<HTMLElement>(".vf-bar-list [data-row]")].map(
    (el) => el.dataset.row ?? "",
  );
const key = (k: string, target: EventTarget = document.activeElement ?? document.body): void => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
};

beforeEach(async () => {
  resetBarStatsForTest();
  keymapHeard = [];
  window.addEventListener("keydown", keymap);
  ce = createFieldEngine(buildRegistry());
  await seedField(ce, ce.docs.create(), createDeskBlobStore(), undefined, { examples: true });
  note = deskObjects(ce, "desk.note")[0]?.entity as Entity;
  pad = deskObjects(ce, "vibefield.comment-pad")[0]?.entity as Entity;
  ce.ops.setSelection([note]);
  selection = fakeSelection(restingAnchor());
  deskElement = document.createElement("div");
  deskElement.setAttribute("data-ice-canvas", "");
  const canvas = document.createElement("canvas");
  deskElement.append(canvas);
  document.body.append(deskElement);
  pick = vi.fn(() => null);
  words = (type) =>
    type === "desk.note"
      ? { type, title: "Note", state: null, label: "Note" }
      : type === "vibefield.comment-pad"
        ? { type, title: "Comment pad", state: null, label: "Comment pad" }
        : { type, title: type, state: null, label: type };
  const desk: MountedDesk = {
    engine: ce,
    handle: {
      selection,
      pick,
      canvas,
      status: () => ({ state: "ready" }),
      // HN-D3: the capture door and the frame counters Copy's still reads (no still here: undefined)
      capture: vi.fn(async () => undefined),
      perf: () => ({ frames: 0 }),
      dirty: () => false,
    } as unknown as MountedDesk["handle"],
    generation: 1,
    mount: 0,
    theme: "light",
    words: (type) => words(type),
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
  unpublish();
  window.removeEventListener("keydown", keymap);
  ce.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const mount = (hidden = false): void => {
  act(() => root.render(createElement(Harness, { hidden })));
};

describe("the selection bar over the desk's anchor (DK-11)", () => {
  it("stands over the selection, in the canon's order, as a toolbar named Selection with ONE tab stop", () => {
    mount();
    expect(bar().dataset.shown).toBe("true");
    expect(cellActs()).toEqual(["copy", "|", "duplicate", "tape", "more", "|", "delete"]);
    expect(cell("copy").textContent).toBe("Make a card");
    expect(cell("tape").getAttribute("title")).toBe("Tape it down  ⇧⌘L");
    expect(cell("duplicate").getAttribute("title")).toBe("Duplicate  ⌘D");
    expect(cell("delete").getAttribute("title")).toBe("Delete  ⌫");
    const toolbar = bar().querySelector('[role="toolbar"]');
    expect(toolbar?.getAttribute("aria-label")).toBe("Selection");
    expect([...bar().querySelectorAll('.vf-bar-row [tabindex="0"]')]).toHaveLength(1);
    // never aria-pressed: the tape act's NAME changes (R10)
    expect(cell("tape").hasAttribute("aria-pressed")).toBe(false);
  });

  it("is PLACED imperatively on each publish — never a render per frame (placements ≤ publishes)", () => {
    mount();
    const mounted = readBarStats();
    expect(mounted).toMatchObject({ publishes: 1, placements: 1 }); // the anchor read as it mounted, placed once
    const before = readBarStats();
    for (let i = 1; i <= 12; i += 1) {
      act(() => selection.publish({ box: { ...BOX, x0: BOX.x0 + 5 * i, x1: BOX.x1 + 5 * i } }));
    }
    const after = readBarStats();
    expect(after.publishes - before.publishes).toBe(12);
    expect(after.placements - before.placements).toBe(12);
    expect(after.renders).toBe(before.renders); // the anchor moved; what the bar says did not
    // the last place: centred over the moved brackets (happy-dom lays nothing out: the bar's own width reads 0) — DK-12:
    // the transform places the bar's CENTRE, so its width may change with its contents without it leaving its place
    expect(bar().style.transform).toBe(
      `translate(${(500 + 60).toFixed(1)}px, 250.0px) translateX(-50%)`,
    );
    expect(after.placements).toBeLessThanOrEqual(after.publishes);
  });

  it('says Make a card for two as for one, and "Lift the tape" with no Duplicate for a taped selection', () => {
    mount();
    act(() => {
      ce.ops.setSelection([note, pad]);
      selection.publish({ count: 2 });
    });
    expect(cell("copy").textContent).toBe("Make a card");
    act(() => selection.publish({ count: 1, locked: true }));
    expect(cellActs()).toEqual(["copy", "|", "tape", "more", "|", "delete"]);
    expect(cell("tape").getAttribute("aria-label")).toBe("Lift the tape");
    expect(cell("tape").querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe("lift");
  });

  it("names a missing face's type and word where the kind's acts would stand — Duplicate still offered", () => {
    words = (type) => ({ type, title: "Note", state: "plugin off", label: "Note · plugin off" });
    mount();
    expect(cellActs()).toEqual([
      "copy",
      "|",
      "words:Note · plugin off",
      "duplicate",
      "tape",
      "more",
      "|",
      "delete",
    ]);
  });

  it("steps aside for a gesture — out in 90 ms, back 200 ms after it ends, in over 180 ms (R8)", () => {
    vi.useFakeTimers();
    mount();
    act(() => selection.publish({ gesturing: true }));
    expect(bar().dataset.shown).toBe("false");
    expect(bar().style.transition).toBe("opacity 90ms ease-out, visibility 0s linear 90ms");
    // the drag carried the object: the gesture's end places the bar where it came to rest
    act(() => selection.publish({ gesturing: false, box: { x0: 100, y0: 400, x1: 300, y1: 500 } }));
    expect(bar().style.transform).toBe("translate(200.0px, 350.0px) translateX(-50%)");
    act(() => vi.advanceTimersByTime(199));
    expect(bar().dataset.shown).toBe("false");
    act(() => vi.advanceTimersByTime(1));
    expect(bar().dataset.shown).toBe("true");
    expect(bar().style.transition).toBe("opacity 180ms ease-out");
    // a note being written steps it aside the same way
    act(() => selection.publish({ editing: true }));
    expect(bar().dataset.shown).toBe("false");
  });

  it("fades out over 120 ms ease-out on a deselect, still saying what it said (R8)", () => {
    mount();
    act(() => {
      ce.ops.setSelection([note, pad]);
      selection.publish({ count: 2 });
    });
    const said = cellActs();
    expect(said).toEqual(["copy", "|", "duplicate", "tape", "more", "|", "delete"]);
    act(() => {
      ce.ops.clearSelection();
      selection.publish({ count: 0, box: null, locked: true });
    });
    expect(bar().dataset.shown).toBe("false");
    expect(bar().style.transition).toBe("opacity 120ms ease-out, visibility 0s linear 120ms");
    // what it said, not what an empty selection would (a taped one: no Duplicate)
    expect(cellActs()).toEqual(said);
  });

  it("hides for a selection wholly off-screen, and under a cover or a sheet (R7)", () => {
    mount();
    act(() => selection.publish({ box: { x0: -400, y0: 300, x1: -20, y1: 400 } }));
    expect(bar().dataset.shown).toBe("false");
    act(() => selection.publish({ box: BOX }));
    expect(bar().dataset.shown).toBe("true");
    mount(true);
    expect(bar().dataset.shown).toBe("false");
  });

  it("REDUCED MOTION halves every duration and fades only: out 45, back after 100, in 90, deselect 60 — the menu fading in whole (R8, M6)", () => {
    vi.useFakeTimers();
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...matchMedia.call(window, query),
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as typeof window.matchMedia;
    try {
      mount();
      expect(bar().dataset.motion).toBe("fade");
      expect(bar().style.getPropertyValue("--vf-bar-grow-ms")).toBe("300ms");
      expect(bar().style.getPropertyValue("--vf-bar-row-ms")).toBe("120ms");
      act(() => selection.publish({ gesturing: true }));
      expect(bar().style.transition).toBe("opacity 45ms ease-out, visibility 0s linear 45ms");
      act(() => selection.publish({ gesturing: false }));
      act(() => vi.advanceTimersByTime(100));
      expect(bar().dataset.shown).toBe("true");
      expect(bar().style.transition).toBe("opacity 90ms ease-out");
      act(() => selection.publish({ count: 0, box: null }));
      expect(bar().style.transition).toBe("opacity 60ms ease-out, visibility 0s linear 60ms");
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});

describe("the bar grown — More, and right-click (DK-11)", () => {
  it("More grows it into its menu — the frame's open surface — nearest first, under its eyebrow; More shown on", () => {
    mount();
    act(() => cell("more").click());
    expect(surfaceNow).toBe("selection");
    expect(bar().hasAttribute("data-open")).toBe(true);
    expect(cell("more").getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toEqual(["comment", "copy", "duplicate", "front", "back", "tape", "delete"]);
    expect(bar().querySelector(".vf-bar-eye")?.textContent).toBe("NOTE");
    // the nearest takeable row is hot; keys at the rows' ends
    expect(bar().querySelector("[data-hot]")?.getAttribute("data-row")).toBe("comment");
    expect(
      [...bar().querySelectorAll(".vf-bar-list .vf-bar-key")].map((el) => el.textContent),
    ).toEqual(["⌘C", "⌘D", "⇧⌘L", "⌫"]);
  });

  it("closes on Esc — taken BEFORE the desk's keymap (R5)", () => {
    mount();
    act(() => cell("more").click());
    key("Escape", document.body);
    expect(surfaceNow).toBeNull();
    expect(keymapHeard).not.toContain("Escape");
  });

  it("closes on a press elsewhere, on a gesture, and on a change of selection (R5)", () => {
    mount();
    act(() => cell("more").click());
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(surfaceNow).toBeNull();
    act(() => cell("more").click());
    act(() => selection.publish({ gesturing: true }));
    expect(surfaceNow).toBeNull();
    act(() => selection.publish({ gesturing: false }));
    act(() => cell("more").click());
    expect(surfaceNow).toBe("selection");
    act(() => {
      ce.ops.setSelection([pad]);
      selection.publish({ box: { x0: 700, y0: 300, x1: 900, y1: 500 } });
    });
    expect(surfaceNow).toBeNull();
  });

  it("↑ ↓ walk the rows and Return takes the hot one; the desk's arrows and ⏎ never see them", () => {
    mount();
    const front = vi.spyOn(ce.ops, "reorder");
    act(() => cell("more").click());
    // grown up (the default room) the list reads bottom-up: ↑ walks away from the bar — comment, then Copy
    // (HN-D3: a row like any other), then Duplicate, then Bring to front
    key("ArrowUp", document.body);
    expect(bar().querySelector("[data-hot]")?.getAttribute("data-row")).toBe("copy");
    key("ArrowUp", document.body);
    key("ArrowUp", document.body);
    expect(bar().querySelector("[data-hot]")?.getAttribute("data-row")).toBe("front");
    key("Enter", document.body);
    expect(front).toHaveBeenCalledWith([note], "top");
    expect(surfaceNow).toBeNull();
    expect(keymapHeard).toEqual([]);
  });

  it("RIGHT-CLICK selects the object under the pointer FIRST by the desk's pick, then grows the same menu (R26)", () => {
    mount();
    pick.mockImplementation(() => ({
      entity: pad,
      type: "vibefield.comment-pad",
      canvas: 0,
      part: "",
    }));
    const select = vi.spyOn(ce.ops, "setSelection");
    const menu = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 750,
      clientY: 380,
      button: 2,
    });
    act(() => {
      deskElement.querySelector("canvas")?.dispatchEvent(menu);
    });
    expect(menu.defaultPrevented).toBe(true);
    expect(pick).toHaveBeenCalledWith({ x: 750, y: 380 });
    expect(select).toHaveBeenCalledWith([pad]);
    expect(surfaceNow).toBeNull(); // not before the desk has drawn the new selection
    act(() => selection.publish({ box: { x0: 700, y0: 300, x1: 900, y1: 500 } }));
    expect(surfaceNow).toBe("selection");
    expect(bar().querySelector(".vf-bar-eye")?.textContent).toBe("COMMENT PAD");
  });

  it("a right-click on the bare mat grows nothing and keeps the selection; on a selected object it grows at once", () => {
    mount();
    const menu = () =>
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        button: 2,
      });
    act(() => {
      deskElement.dispatchEvent(menu());
    });
    expect(surfaceNow).toBeNull();
    expect(ce.ops).toBeDefined();
    pick.mockImplementation(() => ({ entity: note, type: "desk.note", canvas: 0, part: "" }));
    act(() => {
      deskElement.dispatchEvent(menu());
    });
    expect(surfaceNow).toBe("selection");
  });

  it("a Mac's control-click is the desk's click, never our menu (ICE I28's note)", () => {
    mount();
    pick.mockImplementation(() => ({
      entity: pad,
      type: "vibefield.comment-pad",
      canvas: 0,
      part: "",
    }));
    const click = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    act(() => {
      deskElement.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(pick).not.toHaveBeenCalled();
    expect(surfaceNow).toBeNull();
  });
});

describe("the bar's keys and acts (R9; the engine's ops)", () => {
  it("← → move between its cells (the rules and the words are no stops), Esc goes back to the desk — the desk's keys never see them", () => {
    mount();
    act(() => cell("copy").focus());
    key("ArrowRight");
    expect(document.activeElement).toBe(cell("duplicate"));
    key("ArrowRight");
    key("ArrowRight");
    expect(document.activeElement).toBe(cell("more"));
    key("ArrowLeft");
    expect(document.activeElement).toBe(cell("tape"));
    key("Escape");
    expect(document.activeElement).not.toBe(cell("tape"));
    expect(keymapHeard).toEqual([]);
  });

  it("runs each act through the engine's ops — Duplicate, Tape it down, Delete; Enter on a cell, never the desk's ⏎", () => {
    mount();
    const duplicate = vi.spyOn(ce.ops, "duplicateSelection");
    const locked = vi.spyOn(ce.ops, "setLocked");
    const remove = vi.spyOn(ce.ops, "deleteSelection");
    act(() => cell("duplicate").click());
    expect(duplicate).toHaveBeenCalledTimes(1);
    act(() => cell("tape").focus());
    key("Enter");
    expect(locked).toHaveBeenCalledWith([expect.anything()], true);
    expect(keymapHeard).toEqual([]);
    act(() => cell("delete").click());
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("is reached by Tab from the line: the bar stands after the line in the chrome's document order (R9)", () => {
    const chrome = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/field/ChromeLayer.tsx"),
      "utf8",
    );
    // the line (its snapshot, its create) is the frame's — <ViewFrame> — and the bar comes next, before the status line
    const frame = chrome.indexOf("<ViewFrame");
    const theBar = chrome.indexOf("<SelectionBar");
    expect(frame).toBeGreaterThan(0);
    expect(theBar).toBeGreaterThan(frame);
    expect(chrome.indexOf("<StatusLine")).toBeGreaterThan(theBar);
  });

  it("↓ on More grows the menu from the keyboard, the nearest row taking the focus", () => {
    mount();
    act(() => cell("more").focus());
    key("ArrowDown");
    expect(surfaceNow).toBe("selection");
    expect(document.activeElement?.getAttribute("data-row")).toBe("comment");
  });
});

// DK-12 — THE TOOLS IN HAND (DESIGN.md §8 "Tools in hand"; R13; ICE I20, I22): when the anchor carries `held` (an object
// picked up, not flying home) the SAME element travels to y 64 under the head over the anchor's `travelMs` on the island
// curve, its contents swapping by a 120 ms cross-fade over the travel's last 120 ms, and becomes the tools in hand: Copy
// · rule · the kind's tools (dots, cells, faint) · the readout · rule · Done — each tool used through
// `ops.useHeldTool`, Done through `ops.putDown`; hidden while the object flies home, back over it 200 ms after it lands.
describe("a kind's act now, and a choice (track OM; ICE I61, I62)", () => {
  const FIELDS = [
    { id: "width", label: "Width", kind: "number", value: 1280, min: 320, max: 8192, step: 1 },
    { id: "height", label: "Height", kind: "number", value: 800, min: 240, max: 8192, step: 1 },
    {
      id: "agent",
      label: "User agent",
      kind: "text",
      value: "",
      maxLength: 512,
      placeholder: "The browser's own",
    },
  ] as const;
  const CHOICES = [
    { id: "laptop", label: "Laptop", hint: "1280 × 800", group: "devices", current: true },
    { id: "phone", label: "iPhone 17 Pro", hint: "402 × 874", group: "devices" },
    { id: "custom", label: "Custom", hint: "your size and agent", group: "custom", fields: FIELDS },
  ] as const;
  const DEVICE = {
    id: "device",
    label: "Device",
    glyph: { path: "M3 5 H16 V15 H3 Z" },
    choices: CHOICES,
  };
  const SOUND = { id: "sound", label: "Mute", glyph: { path: "M3 9 H7 L12 5 V19 L7 15 H3 Z" } };
  const listRows = (): { row: string; checked: string | null }[] =>
    [...bar().querySelectorAll<HTMLElement>(".vf-bar-list [data-row]")].map((el) => ({
      row: el.dataset.row ?? "",
      checked: el.getAttribute("aria-checked"),
    }));
  const listRow = (id: string): HTMLElement => {
    const el = [...bar().querySelectorAll<HTMLElement>(".vf-bar-list [data-row]")].find(
      (r) => r.dataset.row === id,
    );
    if (el === undefined) throw new Error(`no ${id} row`);
    return el;
  };
  const field = (name: string): HTMLInputElement => {
    const el = bar().querySelector<HTMLInputElement>(`[data-choice-fields] input[name="${name}"]`);
    if (el === null) throw new Error(`no ${name} field`);
    return el;
  };
  /** Typing into a field as a person does: its value set, its input event fired (React's change). */
  const type = (input: HTMLInputElement, text: string): void => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const withActs = (menu: NonNullable<SelectionAnchor["menu"]>): void => {
    mount();
    act(() => selection.publish({ menu }));
  };

  it("the pill says its current choice, Device: Laptop; pressed, the bar grows into its list — checked, under its eyebrow — and a press again folds it", () => {
    withActs([DEVICE, SOUND]);
    const pill = cell("act:device");
    expect(pill.dataset.choice).toBe("");
    expect(pill.textContent).toBe("Laptop");
    expect(pill.getAttribute("aria-label")).toBe("Device: Laptop");
    expect(pill.getAttribute("aria-haspopup")).toBe("menu");
    act(() => pill.click());
    expect(surfaceNow).toBe("selection");
    expect(pill.getAttribute("aria-expanded")).toBe("true");
    expect(listRows()).toEqual([
      { row: "choice:laptop", checked: "true" },
      { row: "choice:phone", checked: "false" },
      { row: "choice:custom", checked: "false" },
    ]);
    expect(listRow("choice:custom").textContent).toBe("Custom…your size and agent");
    expect(bar().querySelector(".vf-bar-eye")?.textContent).toBe("DEVICE");
    expect(bar().querySelector(".vf-bar-list")?.getAttribute("data-choices")).toBe("device");
    act(() => pill.click());
    expect(surfaceNow).toBeNull();
  });

  it("a choice taken runs the act WITH it through the engine's op, and the list folds", () => {
    withActs([DEVICE]);
    const run = vi.spyOn(ce.ops, "runMenuAction");
    act(() => cell("act:device").click());
    act(() => listRow("choice:phone").click());
    expect(run).toHaveBeenLastCalledWith("device", { id: "phone" });
    expect(surfaceNow).toBeNull();
  });

  it("Custom… opens its fields under its row; a value that does not fit says why and Use waits; Return takes the values", () => {
    withActs([DEVICE]);
    const run = vi.spyOn(ce.ops, "runMenuAction");
    act(() => cell("act:device").click());
    act(() => listRow("choice:custom").click());
    expect(run).not.toHaveBeenCalled();
    expect(listRow("choice:custom").getAttribute("aria-expanded")).toBe("true");
    expect([field("width").value, field("height").value, field("agent").value]).toEqual([
      "1280",
      "800",
      "",
    ]);
    expect(field("agent").placeholder).toBe("The browser's own");
    expect(document.activeElement).toBe(field("width"));
    const use = (): HTMLElement =>
      bar().querySelector<HTMLElement>('[data-act="use"]') as HTMLElement;
    type(field("width"), "100");
    expect(field("width").getAttribute("aria-invalid")).toBe("true");
    expect(bar().querySelector(".vf-bar-field-why")?.textContent).toBe("Width is 320 to 8192");
    expect(use().getAttribute("aria-disabled")).toBe("true");
    act(() => use().click());
    type(field("width"), "960.5");
    expect(bar().querySelector(".vf-bar-field-why")?.textContent).toBe("Width is a whole number");
    expect(run).not.toHaveBeenCalled();
    type(field("width"), "960");
    type(field("agent"), "VibeField-Emulation-Test/1.0");
    expect(use().hasAttribute("aria-disabled")).toBe(false);
    key("Enter", field("agent"));
    expect(run).toHaveBeenLastCalledWith("device", {
      id: "custom",
      values: { width: 960, height: 800, agent: "VibeField-Emulation-Test/1.0" },
    });
    expect(surfaceNow).toBeNull();
    expect(keymapHeard).toEqual([]);
  });

  it("Esc in a changed field puts its value back; Esc again folds the list (R5)", () => {
    withActs([DEVICE]);
    act(() => cell("act:device").click());
    act(() => listRow("choice:custom").click());
    type(field("width"), "1024");
    key("Escape", field("width"));
    expect(field("width").value).toBe("1280");
    expect(surfaceNow).toBe("selection");
    key("Escape", field("width"));
    expect(surfaceNow).toBeNull();
    expect(keymapHeard).not.toContain("Escape");
  });

  it("More over a choice's list shows ITS menu in the list's place; More's Device row shows the list in its place, the bar staying grown", () => {
    withActs([DEVICE]);
    act(() => cell("act:device").click());
    act(() => cell("more").click());
    expect(surfaceNow).toBe("selection");
    expect(rows()[0]).toBe("act:device");
    expect(bar().querySelector(".vf-bar-eye")?.textContent).toBe("NOTE");
    expect(listRow("act:device").querySelector(".vf-bar-key")?.textContent).toBe("Laptop");
    act(() => listRow("act:device").click());
    expect(surfaceNow).toBe("selection");
    expect(rows()).toEqual(["choice:laptop", "choice:phone", "choice:custom"]);
  });

  it("an act its kind says is disabled is faint and inert; one whose word changed says it (Mute → Unmute); a swatch is a dot", () => {
    withActs([
      { ...SOUND, enabled: false },
      { id: "finish", label: "Finish", swatch: "#2b3c5c" },
    ]);
    const run = vi.spyOn(ce.ops, "runMenuAction");
    expect(cell("act:sound").getAttribute("aria-disabled")).toBe("true");
    act(() => cell("act:sound").click());
    expect(run).not.toHaveBeenCalled();
    expect(cell("act:finish").querySelector(".vf-bar-dot-ink")).not.toBeNull();
    expect(cell("act:finish").style.getPropertyValue("--vf-bar-swatch")).toBe("#2b3c5c");
    act(() =>
      selection.publish({ menu: [{ ...SOUND, label: "Unmute", glyph: { path: "M1 1" } }] }),
    );
    expect(cell("act:sound").getAttribute("aria-label")).toBe("Unmute");
    expect(cell("act:sound").hasAttribute("aria-pressed")).toBe(false);
    act(() => cell("act:sound").click());
    expect(run).toHaveBeenLastCalledWith("act:sound".slice(4));
  });

  it("IN HAND: the tool that is a choice is the same pill; its list grows under the head and a choice is used through ops.useHeldTool", () => {
    vi.useFakeTimers();
    mount();
    const use = vi.spyOn(ce.ops, "useHeldTool");
    const tools = [
      {
        id: "device",
        label: "Device",
        kind: "action",
        glyph: { path: "M3 5 H16 V15 H3 Z" },
        choices: CHOICES,
      },
      { id: "sound", label: "Mute", kind: "action", glyph: { path: "M1 1" } },
    ] as NonNullable<SelectionAnchor["held"]>["tools"];
    act(() =>
      selection.publish({
        held: { tools, active: "", landing: false, settled: true, travelMs: 560 } as NonNullable<
          SelectionAnchor["held"]
        >,
      }),
    );
    act(() => vi.advanceTimersByTime(560 + 100));
    const pill = [
      ...bar().querySelectorAll<HTMLElement>('[data-face-row="hand"] [data-tool]'),
    ].find((t) => t.dataset.tool === "device") as HTMLElement;
    expect(pill.textContent).toBe("Laptop");
    expect(pill.getAttribute("aria-label")).toBe("Device: Laptop");
    act(() => pill.click());
    expect(use).not.toHaveBeenCalled();
    expect(surfaceNow).toBe("selection");
    expect(bar().hasAttribute("data-open")).toBe(true);
    expect(pill.getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toEqual(["choice:laptop", "choice:phone", "choice:custom"]);
    act(() => listRow("choice:phone").click());
    expect(use).toHaveBeenLastCalledWith("device", { id: "phone" });
    expect(surfaceNow).toBeNull();
  });

  // OM-2 (DESIGN.md §8 "An act that is a choice", its swatch pill; §9 "The simulator's acts"): a choice whose every choice
  // carries a swatch — the simulator's Finish — is the current choice's dot and the chevron, no words; Mixed, an empty ring
  describe("a swatch choice — the simulator's Finish (OM-2)", () => {
    const FINISHES = [
      { id: "cosmic-orange", label: "Cosmic Orange", swatch: "#e0692a", current: true },
      { id: "deep-blue", label: "Deep Blue", swatch: "#2b3c5c" },
      { id: "silver-17p", label: "Silver", swatch: "#dededb" },
    ] as const;
    const FINISH = { id: "finish", label: "Finish", choices: FINISHES };
    const UNMARKED = FINISHES.map(({ id, label, swatch }) => ({ id, label, swatch }));
    /** A list row's swatch dot's ink, or null for a row with none. */
    const rowSwatch = (id: string): string | null =>
      listRow(id)
        .querySelector<HTMLElement>(".vf-bar-swatch-dot")
        ?.style.getPropertyValue("--vf-bar-swatch") ?? null;

    it("is the current choice's dot and the chevron, no words — its tip and its name the act and the choice", () => {
      withActs([FINISH]);
      const pill = cell("act:finish");
      expect(pill.dataset.choice).toBe("");
      expect(pill.hasAttribute("data-swatch")).toBe(true);
      expect(pill.hasAttribute("data-mixed")).toBe(false);
      expect(pill.textContent).toBe("");
      expect(pill.querySelector(".vf-bar-choice-label")).toBeNull();
      expect(pill.querySelector(".vf-bar-dot-ink")).not.toBeNull();
      expect(pill.querySelector(".vf-bar-chevron")).not.toBeNull();
      expect(pill.style.getPropertyValue("--vf-bar-swatch")).toBe("#e0692a");
      expect(pill.getAttribute("aria-label")).toBe("Finish: Cosmic Orange");
      expect(pill.getAttribute("title")).toBe("Finish: Cosmic Orange");
      expect(pill.getAttribute("aria-haspopup")).toBe("menu");
    });

    it("phones on different finishes: the empty ring — no ink of its own — and Finish: Mixed", () => {
      withActs([{ ...FINISH, choices: UNMARKED }]);
      const pill = cell("act:finish");
      expect(pill.hasAttribute("data-swatch")).toBe(true);
      expect(pill.hasAttribute("data-mixed")).toBe(true);
      expect(pill.textContent).toBe("");
      expect(pill.querySelector(".vf-bar-dot-ink")).not.toBeNull();
      expect(pill.style.getPropertyValue("--vf-bar-swatch")).toBe("");
      expect(pill.getAttribute("aria-label")).toBe("Finish: Mixed");
    });

    it("pressed, its list: the finishes by name, each with its dot, the current one checked; a finish taken runs the act with it", () => {
      withActs([FINISH]);
      const run = vi.spyOn(ce.ops, "runMenuAction");
      act(() => cell("act:finish").click());
      expect(surfaceNow).toBe("selection");
      expect(cell("act:finish").getAttribute("aria-expanded")).toBe("true");
      expect(listRows()).toEqual([
        { row: "choice:cosmic-orange", checked: "true" },
        { row: "choice:deep-blue", checked: "false" },
        { row: "choice:silver-17p", checked: "false" },
      ]);
      expect(listRow("choice:deep-blue").textContent).toBe("Deep Blue");
      expect(listRow("choice:cosmic-orange").querySelector(".vf-bar-check svg")).not.toBeNull();
      expect(listRow("choice:deep-blue").querySelector(".vf-bar-check svg")).toBeNull();
      expect(
        ["choice:cosmic-orange", "choice:deep-blue", "choice:silver-17p"].map(rowSwatch),
      ).toEqual(["#e0692a", "#2b3c5c", "#dededb"]);
      expect(bar().querySelector(".vf-bar-eye")?.textContent).toBe("FINISH");
      act(() => listRow("choice:deep-blue").click());
      expect(run).toHaveBeenLastCalledWith("finish", { id: "deep-blue" });
      expect(surfaceNow).toBeNull();
    });

    it("IN HAND beside Home: the same swatch pill; its list grows under the head and a finish is used through ops.useHeldTool", () => {
      vi.useFakeTimers();
      mount();
      const use = vi.spyOn(ce.ops, "useHeldTool");
      const tools = [
        { id: "home", label: "Home", kind: "action", glyph: { path: "M1 1" } },
        { id: "finish", label: "Finish", kind: "action", choices: FINISHES },
      ] as NonNullable<SelectionAnchor["held"]>["tools"];
      act(() =>
        selection.publish({
          held: { tools, active: "", landing: false, settled: true, travelMs: 560 } as NonNullable<
            SelectionAnchor["held"]
          >,
        }),
      );
      act(() => vi.advanceTimersByTime(560 + 100));
      const pill = [
        ...bar().querySelectorAll<HTMLElement>('[data-face-row="hand"] [data-tool]'),
      ].find((t) => t.dataset.tool === "finish") as HTMLElement;
      expect(pill.dataset.look).toBe("choice");
      expect(pill.hasAttribute("data-swatch")).toBe(true);
      expect(pill.textContent).toBe("");
      expect(pill.querySelector(".vf-bar-dot-ink")).not.toBeNull();
      expect(pill.querySelector(".vf-bar-chevron")).not.toBeNull();
      expect(pill.style.getPropertyValue("--vf-bar-swatch")).toBe("#e0692a");
      expect(pill.getAttribute("aria-label")).toBe("Finish: Cosmic Orange");
      act(() => pill.click());
      expect(use).not.toHaveBeenCalled();
      expect(surfaceNow).toBe("selection");
      expect(pill.getAttribute("aria-expanded")).toBe("true");
      expect(listRows().map((r) => r.row)).toEqual([
        "choice:cosmic-orange",
        "choice:deep-blue",
        "choice:silver-17p",
      ]);
      expect(rowSwatch("choice:silver-17p")).toBe("#dededb");
      act(() => listRow("choice:silver-17p").click());
      expect(use).toHaveBeenLastCalledWith("finish", { id: "silver-17p" });
      expect(surfaceNow).toBeNull();
    });
  });
});

describe("the tools in hand (DK-12)", () => {
  /** The notebook's slots as the anchor carries them (bar-hand's own test holds the real kinds' to the canon). */
  const NOTEBOOK: NonNullable<SelectionAnchor["held"]>["tools"] = [
    { id: "turn:-1", label: "Previous page", kind: "action", hint: "←", glyph: "chevron-left" },
    { id: "turn:1", label: "Next page", kind: "action", hint: "→", glyph: "chevron" },
    {
      id: "pen:felt",
      label: "Felt pen",
      kind: "mode",
      hint: "1",
      glyph: "pen",
      swatch: "rgb(26 26 28)",
    },
    {
      id: "pen:ball",
      label: "Ballpoint",
      kind: "mode",
      hint: "2",
      glyph: "pen",
      swatch: "rgb(32 48 112)",
    },
    {
      id: "pen:fountain",
      label: "Fountain pen",
      kind: "mode",
      hint: "3",
      glyph: "pen",
      swatch: "rgb(22 40 92)",
    },
    {
      id: "pen:red",
      label: "Red pen",
      kind: "mode",
      hint: "4",
      glyph: "pen",
      swatch: "rgb(184 40 32)",
    },
    { id: "undo", label: "Undo", kind: "action", hint: "⌘Z", glyph: "undo" },
  ];
  type Held = NonNullable<SelectionAnchor["held"]>;
  const held = (over: { readonly [K in keyof Held]?: Held[K] | undefined } = {}): Held =>
    ({
      tools: NOTEBOOK,
      active: "pen:fountain",
      landing: false,
      settled: true,
      travelMs: 560,
      readout: "Page 1",
      ...over,
    }) as Held;
  const handRow = (): HTMLElement => {
    const el = bar().querySelector<HTMLElement>('[data-face-row="hand"]');
    if (el === null) throw new Error("no tools in hand");
    return el;
  };
  const selectionRow = (): HTMLElement =>
    bar().querySelector<HTMLElement>('[data-face-row="selection"]') as HTMLElement;
  const tool = (id: string): HTMLElement => {
    const el = [...handRow().querySelectorAll<HTMLElement>("[data-tool]")].find(
      (t) => t.dataset.tool === id,
    );
    if (el === undefined) throw new Error(`no ${id} in hand`);
    return el;
  };
  /** The tools in hand as a reader meets them: their acts and tools in order, `|` a rule, the word. */
  const handSaid = (): string[] =>
    [...handRow().children].map((el) => {
      const e = el as HTMLElement;
      if (e.classList.contains("vf-bar-rule")) return "|";
      if (e.dataset.readout !== undefined) return `“${e.textContent}”`;
      return `${e.dataset.gap !== undefined ? "+" : ""}${e.dataset.tool ?? e.dataset.act}`;
    });
  /** Picked up, and the travel over. */
  const inHandNow = (over: Parameters<typeof held>[0] = {}): void => {
    act(() => selection.publish({ held: held(over) }));
    act(() => vi.advanceTimersByTime(560 + 100));
  };

  it("TRAVELS into the hand: the one element to y 64 under the head, centred — the anchor's 560 ms on the island curve, its contents cross-faded over the last 120 (R13)", () => {
    vi.useFakeTimers();
    mount();
    expect(bar().style.transform).toBe("translate(500.0px, 250.0px) translateX(-50%)");
    // every value the root's style takes, in order — the travel's transition must be on BEFORE the new place is written,
    // or the browser jumps the bar there (desk.js `morphBar`'s order)
    const styles = new MutationObserver(() => undefined);
    styles.observe(bar(), {
      attributes: true,
      attributeFilter: ["style"],
      attributeOldValue: true,
    });
    act(() => selection.publish({ held: held() }));
    const values = [
      ...styles.takeRecords().map((r) => r.oldValue ?? ""),
      bar().getAttribute("style") ?? "",
    ];
    styles.disconnect();
    const placed = values.find((v) => v.includes("translate(590.0px, 64.0px)"));
    expect(placed).toBeDefined();
    expect(placed).toContain("transform 560ms var(--vf-ease-island)");
    expect(bar().dataset.role).toBe("hand");
    // the tools in hand stand ready under the selection's row, inert and unread until the cross-fade
    expect(handRow().hasAttribute("inert")).toBe(true);
    expect(handRow().getAttribute("aria-hidden")).toBe("true");
    // still saying the selection as it travels; its new place written with the travel's transition on
    expect(bar().dataset.face).toBe("selection");
    expect(bar().dataset.shown).toBe("true");
    expect(bar().style.transform).toBe("translate(590.0px, 64.0px) translateX(-50%)");
    expect(bar().style.transition).toBe(
      "opacity 180ms ease-out, transform 560ms var(--vf-ease-island)",
    );
    act(() => vi.advanceTimersByTime(439));
    expect(bar().dataset.face).toBe("selection");
    // the travel's last 120 ms: the rows cross-fade, the glass's width following them
    act(() => vi.advanceTimersByTime(1));
    expect(bar().dataset.face).toBe("hand");
    expect(bar().style.transition).toBe(
      "opacity 180ms ease-out, transform 560ms var(--vf-ease-island), width 120ms ease",
    );
    expect(bar().style.getPropertyValue("--vf-bar-swap-ms")).toBe("120ms");
    // declared one beat past the travel's length, so the browser ends both on their own frame — never cut short
    act(() => vi.advanceTimersByTime(120 + 99));
    expect(bar().style.transition).toContain("transform 560ms");
    expect(bar().style.transition).toContain("width 120ms ease");
    act(() => vi.advanceTimersByTime(1));
    expect(bar().style.transition).toBe("opacity 180ms ease-out");
    expect(handRow().getAttribute("aria-label")).toBe("Tools in hand");
    expect(handRow().hasAttribute("inert")).toBe(false);
    expect(selectionRow().hasAttribute("inert")).toBe(true);
    // a travel the anchor says is longer is the anchor's (I20)
    act(() => selection.publish({ held: undefined }));
    act(() => vi.advanceTimersByTime(600));
    act(() => selection.publish({ held: held({ travelMs: 800 }) }));
    expect(bar().style.transition).toBe(
      "opacity 180ms ease-out, transform 800ms var(--vf-ease-island)",
    );
  });

  it("becomes the tools in hand in the canon's order — the pens dots, the one in hand ringed and pressed, the word, Done", () => {
    vi.useFakeTimers();
    mount();
    inHandNow();
    expect(handSaid()).toEqual([
      "copy",
      "|",
      "turn:-1",
      "turn:1",
      "+pen:felt",
      "pen:ball",
      "pen:fountain",
      "pen:red",
      "+undo",
      "“Page 1”",
      "|",
      "done",
    ]);
    expect(handRow().querySelectorAll(".vf-bar-dot")).toHaveLength(4);
    expect(tool("pen:fountain").getAttribute("aria-pressed")).toBe("true");
    expect(tool("pen:fountain").hasAttribute("data-on")).toBe(true);
    expect(tool("pen:ball").getAttribute("aria-pressed")).toBe("false");
    expect(tool("pen:felt").style.getPropertyValue("--vf-bar-swatch")).toBe("rgb(26 26 28)");
    // an action is never pressed; its glyph by §13's table (chevron-left turned 180)
    expect(tool("turn:-1").hasAttribute("aria-pressed")).toBe(false);
    expect(tool("turn:-1").querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe(
      "chevron",
    );
    expect(tool("pen:felt").getAttribute("title")).toBe("Felt pen  1");
    const done = handRow().querySelector<HTMLElement>('[data-act="done"]');
    expect(done?.textContent).toBe("Done");
    expect(done?.getAttribute("title")).toBe("Put it down  Esc");
    expect(handRow().querySelector('[data-act="copy"]')?.getAttribute("title")).toBe(
      "Make a card  ⌘C",
    );
    // the mode in hand moved: the ring and the press follow it
    act(() => selection.publish({ held: held({ active: "pen:red" }) }));
    expect(tool("pen:red").getAttribute("aria-pressed")).toBe("true");
    expect(tool("pen:fountain").getAttribute("aria-pressed")).toBe("false");
    // a mode without a swatch is a cell, the inverted solid while in hand
    act(() =>
      selection.publish({
        held: held({
          tools: [{ id: "eraser", label: "Eraser", kind: "mode", hint: "E", glyph: "eraser" }],
          active: "eraser",
          readout: undefined,
        }),
      }),
    );
    expect(tool("eraser").dataset.look).toBe("mode");
    expect(tool("eraser").getAttribute("aria-pressed")).toBe("true");
    expect(handRow().querySelector("[data-readout]")).toBeNull();
  });

  it("uses each tool through ops.useHeldTool and puts it down through ops.putDown — a slot that only waits, never", () => {
    vi.useFakeTimers();
    mount();
    const use = vi.spyOn(ce.ops, "useHeldTool");
    const putDown = vi.spyOn(ce.ops, "putDown");
    inHandNow({
      tools: [...NOTEBOOK, { id: "later", label: "Later" }],
    });
    act(() => tool("pen:felt").click());
    expect(use).toHaveBeenLastCalledWith("pen:felt");
    act(() => tool("turn:1").click());
    expect(use).toHaveBeenLastCalledWith("turn:1");
    act(() => tool("undo").focus());
    key("Enter");
    expect(use).toHaveBeenLastCalledWith("undo");
    expect(keymapHeard).toEqual([]);
    expect(tool("later").getAttribute("aria-disabled")).toBe("true");
    act(() => tool("later").click());
    act(() => handRow().querySelector<HTMLElement>('[data-act="copy"]')?.click());
    expect(use).toHaveBeenCalledTimes(3);
    act(() => handRow().querySelector<HTMLElement>('[data-act="done"]')?.click());
    expect(putDown).toHaveBeenCalledTimes(1);
  });

  it("PT-5a (ICE I49): a tool its kind says is DISABLED is dim, aria-disabled, and its press and its key use nothing; live again, it is used — and a tool that changed its word (Reload → Stop) says the new one", () => {
    vi.useFakeTimers();
    mount();
    const use = vi.spyOn(ce.ops, "useHeldTool");
    const back = {
      id: "back",
      label: "Back",
      kind: "action",
      hint: "⌘[",
      glyph: { path: "M0 0" },
    } as const;
    const reload = {
      id: "reload",
      label: "Reload",
      kind: "action",
      glyph: { path: "M1 1" },
    } as const;
    inHandNow({ tools: [{ ...back, enabled: false }, reload], active: "", readout: "A page" });
    expect(tool("back").getAttribute("aria-disabled")).toBe("true");
    expect(tool("back").hasAttribute("data-disabled")).toBe(true);
    // it keeps its look (an action's cell), never the faint slot's
    expect(tool("back").dataset.look).toBe("action");
    expect(tool("reload").hasAttribute("aria-disabled")).toBe(false);
    expect(tool("reload").hasAttribute("data-disabled")).toBe(false);
    act(() => tool("back").click());
    act(() => tool("back").focus());
    key("Enter");
    expect(use).not.toHaveBeenCalled();
    act(() => tool("reload").click());
    expect(use).toHaveBeenLastCalledWith("reload");
    // the page went somewhere: ‹ is live — and loading, ↻ reads Stop
    act(() =>
      selection.publish({
        held: held({
          tools: [back, { ...reload, label: "Stop", glyph: { path: "M2 2" } }],
          active: "",
          readout: "A page",
        }),
      }),
    );
    expect(tool("back").hasAttribute("aria-disabled")).toBe(false);
    expect(tool("back").hasAttribute("data-disabled")).toBe(false);
    expect(tool("reload").getAttribute("aria-label")).toBe("Stop");
    act(() => tool("back").click());
    expect(use).toHaveBeenLastCalledWith("back");
    expect(use).toHaveBeenCalledTimes(2);
  });

  it("is a toolbar named “Tools in hand” with one tab stop: ← → between its tools and Done, the word no stop; Esc back to the desk", () => {
    vi.useFakeTimers();
    mount();
    inHandNow();
    expect([...handRow().querySelectorAll('[tabindex="0"]')]).toHaveLength(1);
    act(() => tool("undo").focus());
    key("ArrowRight");
    expect(document.activeElement?.getAttribute("data-act")).toBe("done");
    key("ArrowRight");
    expect(document.activeElement?.getAttribute("data-act")).toBe("copy");
    key("ArrowLeft");
    key("ArrowLeft");
    expect(document.activeElement).toBe(tool("undo"));
    key("Escape");
    expect(handRow().contains(document.activeElement)).toBe(false);
    expect(keymapHeard).toEqual([]);
  });

  it("stays through a stroke or a line written in hand; folds the menu as it goes into the hand", () => {
    vi.useFakeTimers();
    mount();
    act(() => cell("more").click());
    expect(surfaceNow).toBe("selection");
    act(() => selection.publish({ held: held() }));
    expect(surfaceNow).toBeNull();
    act(() => vi.advanceTimersByTime(660));
    act(() => selection.publish({ held: held(), gesturing: true, editing: true }));
    act(() => vi.advanceTimersByTime(300));
    expect(bar().dataset.shown).toBe("true");
  });

  it("hides while the object flies home, and is back over it 200 ms after it lands — the bar over the selection again", () => {
    vi.useFakeTimers();
    mount();
    inHandNow();
    act(() => selection.publish({ held: held({ landing: true }), gesturing: false }));
    expect(bar().dataset.shown).toBe("false");
    expect(bar().dataset.role).toBe("selection");
    expect(bar().style.transition).toBe(
      "opacity 90ms ease-out, visibility 0s linear 90ms, transform 560ms var(--vf-ease-island)",
    );
    act(() => vi.advanceTimersByTime(700)); // the flight home
    expect(bar().dataset.face).toBe("selection");
    act(() => selection.publish({ held: undefined }));
    expect(bar().style.transform).toBe("translate(500.0px, 250.0px) translateX(-50%)");
    act(() => vi.advanceTimersByTime(199));
    expect(bar().dataset.shown).toBe("false");
    act(() => vi.advanceTimersByTime(1));
    expect(bar().dataset.shown).toBe("true");
    expect(cellActs()).toEqual(["copy", "|", "duplicate", "tape", "more", "|", "delete"]);
    expect(bar().querySelector('[data-face-row="hand"]')).toBeNull();
  });

  it("unseen as the hand comes (nothing was selected): stands under the head at once and fades in — no travel", () => {
    vi.useFakeTimers();
    act(() => selection.publish({ count: 0, box: null }));
    mount();
    expect(bar().dataset.shown).toBe("false");
    act(() => selection.publish({ count: 1, box: BOX, held: held() }));
    expect(bar().dataset.face).toBe("hand");
    expect(bar().dataset.shown).toBe("true");
    expect(bar().style.transform).toBe("translate(590.0px, 64.0px) translateX(-50%)");
    expect(bar().style.transition).toBe("opacity 180ms ease-out");
  });

  it("the word changing is a render and one placement for its publish — never a render per frame (placements ≤ publishes)", () => {
    vi.useFakeTimers();
    mount();
    inHandNow();
    const before = readBarStats();
    for (let i = 2; i <= 11; i += 1)
      act(() => selection.publish({ held: held({ readout: `Page ${i}` }) }));
    const mid = readBarStats();
    expect(mid.publishes - before.publishes).toBe(10);
    expect(mid.renders - before.renders).toBe(10);
    expect(mid.placements - before.placements).toBe(10);
    expect(handRow().querySelector("[data-readout]")?.textContent).toBe("Page 11");
    // the same hand published again (a frame drawn while held): placed, never re-rendered
    for (let i = 0; i < 5; i += 1)
      act(() => selection.publish({ held: held({ readout: "Page 11" }) }));
    const after = readBarStats();
    expect(after.renders).toBe(mid.renders);
    expect(after.placements).toBeLessThanOrEqual(after.publishes);
    expect(bar().style.transform).toBe("translate(590.0px, 64.0px) translateX(-50%)");
  });

  it("REDUCED MOTION: no travel — out over 60 ms where it stood, then the tools in hand under the head, in over 60 ms (M6, R8)", () => {
    vi.useFakeTimers();
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...matchMedia.call(window, query),
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as typeof window.matchMedia;
    try {
      mount();
      const stood = bar().style.transform;
      act(() => selection.publish({ held: held() }));
      expect(bar().dataset.shown).toBe("false");
      expect(bar().style.transition).toBe("opacity 60ms ease-out, visibility 0s linear 60ms");
      expect(bar().style.transition).not.toContain("transform");
      expect(bar().style.transform).toBe(stood); // not one frame of travel
      expect(bar().dataset.face).toBe("selection");
      act(() => vi.advanceTimersByTime(60));
      expect(bar().dataset.face).toBe("hand");
      expect(bar().style.transform).toBe("translate(590.0px, 64.0px) translateX(-50%)");
      expect(bar().dataset.shown).toBe("true");
      expect(bar().style.transition).toBe("opacity 60ms ease-out");
      act(() => vi.advanceTimersByTime(60));
      expect(bar().style.transition).toBe("opacity 90ms ease-out");
      expect(bar().dataset.motion).toBe("fade"); // and the dots do not pop (selection-bar.css)
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});

// ── HN-D3 — COPY's FOUR DOORS (DESIGN.md §8 "Make a card"; R25; plan addendum (50)) ─────────────────────────────
// The bar's pill, the grown menu's row, the pill in hand and ⌘C over the desk each run ONE act: the selection — or the
// object in hand — dealt into the window's hand as ONE card. Nothing waits on the line, so the bar never steps aside
// for it; in hand the tools stay under the head and the object stays in hand.
describe("Make a card — four doors deal ONE card (HN-D3)", () => {
  const WRITING = "Ship the desk by Friday. Then the covers.";
  beforeEach(() => {
    // the note holds a line of writing: its copy is a text card, dealt at once (a picture needs the desk's GPU)
    const doc = ce.docs.current()?.store;
    if (doc === undefined) throw new Error("no document");
    setWidgetProps(doc, ce.world, note, { text: WRITING });
    ce.world.sync();
  });
  afterEach(() => {
    for (const card of cardsStore.snapshot().cards) cardsStore.remove(card.id);
  });

  /** The act's tail is over: the selection observed standing as at the press. */
  const settled = async (): Promise<void> => {
    await vi.waitFor(() => expect(lastCopy()?.kept).not.toBeNull(), { timeout: 2_000 });
  };

  /** The card is dealt once the clipboard took the words — a copy the clipboard refuses deals nothing (HN-5, DESIGN.md
   * §8 "Make a card") — so a press is followed by the clipboard's turn before the hand holds ONE card. */
  const dealt = async (): Promise<void> => {
    await act(async () => {
      await vi.waitFor(() => expect(cardsStore.snapshot().cards).toHaveLength(1), {
        timeout: 2_000,
      });
    });
  };

  it("the BAR's pill — Make a card, the paper card, its key said — deals the selection as ONE card, and the bar stays", async () => {
    mount();
    const pill = cell("copy");
    expect(pill.textContent).toBe("Make a card");
    // CS-D12 E (§13): it wears the paper card, a card in the hand's stock — and no clipboard
    expect(pill.querySelector(".vf-paper-card")).not.toBeNull();
    expect(pill.querySelector(".vf-paper-card svg")).not.toBeNull();
    expect(pill.querySelector('[data-glyph="clipboard"]')).toBeNull();
    expect(pill.getAttribute("title")).toBe("Make a card  ⌘C");
    expect(pill.querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe("type-ref");
    act(() => pill.click());
    await dealt();
    const cards = cardsStore.snapshot().cards;
    expect(cards[0]).toMatchObject({
      faces: [{ type: "text" }],
      title: "Ship the desk by Friday.",
      origin: { view: "canvas", how: "copy" },
    });
    expect(lastCopy()?.from).toBe("bar");
    // nothing waits on the line: the bar never steps aside for a copy
    expect(bar().getAttribute("data-shown")).toBe("true");
    await settled();
    expect(bar().getAttribute("data-shown")).toBe("true");
  });

  it("the GROWN MENU's row — Make a card ⌘C — is taken like any other: the menu folds and the same act runs", async () => {
    mount();
    act(() => cell("more").click());
    expect(surfaceNow).toBe("selection");
    const row = bar().querySelector<HTMLElement>('.vf-bar-list [data-row="copy"]');
    expect(row?.hasAttribute("aria-disabled")).toBe(false);
    expect(row?.querySelector(".vf-bar-key")?.textContent).toBe("⌘C");
    act(() => row?.click());
    expect(surfaceNow).toBeNull();
    expect(lastCopy()?.from).toBe("menu");
    await dealt();
    await settled();
  });

  it("⌘C over the desk is Copy — never from a field or a kind holding the keyboard, nor with nothing selected, nor under a cover", async () => {
    mount();
    const chord = (target: EventTarget, init: KeyboardEventInit = { metaKey: true }) => {
      const event = new KeyboardEvent("keydown", {
        key: "c",
        bubbles: true,
        cancelable: true,
        ...init,
      });
      act(() => {
        target.dispatchEvent(event);
      });
      return event;
    };
    expect(chord(document.body).defaultPrevented).toBe(true);
    expect(lastCopy()?.from).toBe("key");
    await dealt();
    expect(keymapHeard).not.toContain("c");
    await settled();
    const seq = lastCopy()?.seq;
    // a field keeps its own copy
    const field = document.createElement("input");
    document.body.append(field);
    expect(chord(field).defaultPrevented).toBe(false);
    field.remove();
    // so does a kind that holds the keyboard — the desk's editor while a note is written, a page in hand
    const claim = document.createElement("div");
    claim.setAttribute("data-canvas-keyboard", "");
    document.body.append(claim);
    expect(chord(claim).defaultPrevented).toBe(false);
    claim.remove();
    // Ctrl+C on the Mac is a shell's interrupt, never Copy
    expect(chord(document.body, { ctrlKey: true }).defaultPrevented).toBe(false);
    // nothing selected: nothing to copy
    act(() => {
      ce.ops.clearSelection();
      selection.publish({ count: 0, box: null });
    });
    expect(chord(document.body).defaultPrevented).toBe(false);
    // under a cover (the bar hidden), a selection all the same
    act(() => {
      ce.ops.setSelection([note]);
      selection.publish({ count: 1, box: BOX });
    });
    mount(true);
    expect(chord(document.body).defaultPrevented).toBe(false);
    expect(lastCopy()?.seq).toBe(seq);
    expect(cardsStore.snapshot().cards).toHaveLength(1);
  });

  it("IN HAND: the pill in hand copies the object as DRAWN — it stays in hand, the tools stay under the head", async () => {
    vi.useFakeTimers();
    mount();
    const whiteboard = deskObjects(ce, "desk.board")[0]?.entity as Entity;
    ce.ops.setSelection([whiteboard]);
    ce.ops.open(whiteboard);
    ce.stack.heldPose.current = {
      frame: () => ({ cx: 590, cy: 382, hx: 120, hy: 160, s: 2, settled: true }),
    } as never;
    act(() =>
      selection.publish({
        held: { tools: [], active: "", landing: false, settled: true, travelMs: 560 },
      }),
    );
    act(() => vi.advanceTimersByTime(660));
    const pill = bar().querySelector<HTMLElement>('[data-face-row="hand"] [data-act="copy"]');
    expect(pill?.getAttribute("title")).toBe("Make a card  ⌘C");
    const putDown = vi.spyOn(ce.ops, "putDown");
    act(() => pill?.click());
    expect(lastCopy()).toMatchObject({
      from: "hand",
      fromBox: { left: 470, top: 222, width: 240, height: 320 },
      marks: false,
    });
    expect(lastCopy()?.objects.map((o) => o.type)).toEqual(["desk.board"]);
    // the object stays in hand; the tools are not stepped aside
    expect(putDown).not.toHaveBeenCalled();
    expect(bar().getAttribute("data-role")).toBe("hand");
    expect(bar().getAttribute("data-shown")).toBe("true");
    vi.useRealTimers();
    await settled();
    // this harness's desk draws nothing (its capture door answers none): no picture, no card — and the line is told
    expect(lastCopy()?.refused).toBe("No card made — the desk could not draw it");
    expect(cardsStore.snapshot().cards).toEqual([]);
  });
});

// ── ITEM 550 — OVER AN OBJECT AT WORK (DESIGN.md §8 "The selection bar", Place; §6 "At work on the mat") ─────────
// While a selected object is at work the foot clears its marks. The clearance turning on over the same selection
// TRAVELS the bar out with the stroke's draw-on, 780 ms on the island curve; turning off, back with its retract, 460 ms
// on the retract curve — one transform transition, taken off one beat past its end. The store's change places it while
// the desk sleeps; a new selection, and reduced motion, place it at once.
describe("over an object at work (item 550)", () => {
  /** This mount names its board, so the window's at-work store reaches the bar. */
  const nameTheBoard = (): void => {
    const desk = currentDesk();
    if (desk === null) throw new Error("no desk");
    unpublish();
    unpublish = publishDesk({ ...desk, docId: "doc-1" });
  };
  /** The store's rows for the selected note: one agent on it, at `state`. */
  const noteAtWork = (state: "open" | "released", since = 1): void => {
    const key = ce.docs.current()?.store.keyOf(note) as string;
    const agents = [{ run: "r1", handle: "r1 in vibe-field", agent: "agent", state, since }];
    atWorkStore.publish("doc-1", {
      objects: [
        {
          ref: "vf:obj/note0000",
          docId: "doc-1",
          key,
          agents: agents as ObjectsPresenceSnapshot["objects"][number]["agents"],
        },
      ],
    });
  };
  /** The bar over the note's brackets, its foot `above` over them (happy-dom lays out no width: its centre). */
  const standing = (above: number): string =>
    `translate(500.0px, ${(300 - above - 40).toFixed(1)}px) translateX(-50%)`;

  afterEach(() => atWorkStore.clear());

  it("travels its foot clear of the marks as an agent opens the selection — 780 ms on the island curve — and back on the retract, 460 ms, as it lets go", () => {
    vi.useFakeTimers();
    nameTheBoard();
    mount();
    expect(bar().style.transform).toBe(standing(10));
    expect(bar().style.transition).toBe("opacity 180ms ease-out");
    // an agent opens the note while the desk sleeps: the store places the bar (31.171 + 9) off the note, so 34.171
    // above the brackets' 6
    act(() => noteAtWork("open"));
    expect(bar().style.transform).toBe(standing(40.171 - 6));
    expect(bar().style.transition).toBe(
      "opacity 180ms ease-out, transform 780ms var(--vf-ease-island)",
    );
    // declared one beat past the draw-on, then off: a moving selection places at once again
    act(() => vi.advanceTimersByTime(780 + 99));
    expect(bar().style.transition).toContain("transform 780ms");
    act(() => vi.advanceTimersByTime(1));
    expect(bar().style.transition).toBe("opacity 180ms ease-out");
    // the agent works on: the store moves, the clearance does not, and nothing is placed for it
    const placements = readBarStats().placements;
    act(() => noteAtWork("open", 2));
    expect(readBarStats().placements).toBe(placements);
    // the agent lets it go: back with the retract
    act(() => noteAtWork("released", 3));
    expect(bar().style.transform).toBe(standing(10));
    expect(bar().style.transition).toBe(
      "opacity 180ms ease-out, transform 460ms cubic-bezier(0.4, 0, 1, 1)",
    );
    act(() => vi.advanceTimersByTime(460 + 100));
    expect(bar().style.transition).toBe("opacity 180ms ease-out");
  });

  it("stands at once over a new selection: a clearance that changes with the selection never travels", () => {
    vi.useFakeTimers();
    nameTheBoard();
    mount();
    act(() => noteAtWork("open"));
    act(() => vi.advanceTimersByTime(780 + 100));
    expect(bar().style.transform).toBe(standing(40.171 - 6));
    // the comment pad, which no agent has open, selected in the note's place
    act(() => {
      ce.ops.setSelection([pad]);
      selection.publish({ box: { ...BOX } });
    });
    expect(bar().style.transform).toBe(standing(10));
    expect(bar().style.transition).not.toContain("transform");
  });

  it("REDUCED MOTION: the foot stands clear at once, and comes back at once (M6)", () => {
    vi.useFakeTimers();
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...matchMedia.call(window, query),
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as typeof window.matchMedia;
    try {
      nameTheBoard();
      mount();
      act(() => noteAtWork("open"));
      expect(bar().style.transform).toBe(standing(40.171 - 6));
      expect(bar().style.transition).toBe("opacity 90ms ease-out");
      act(() => noteAtWork("released", 2));
      expect(bar().style.transform).toBe(standing(10));
      expect(bar().style.transition).toBe("opacity 90ms ease-out");
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});
