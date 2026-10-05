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
 *   THE ACTS — through the engine's ops.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasEngine, Entity } from "@vibecook/ice";
import type { SelectionAnchor } from "@vibecook/ice/desk";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBarStats, resetBarStatsForTest } from "../src/field/desk/bar/bar-stats";
import { SelectionBar } from "../src/field/desk/bar/SelectionBar";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { deskObjects, type MountedDesk, publishDesk } from "../src/field/desk/desk-door";
import type { ObjectWords } from "../src/field/desk/desk-object-words";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";
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
  rulers: { margin: 60, band: 26 },
  ...over,
});

interface FakeSelection {
  anchor(): SelectionAnchor;
  subscribe(fn: () => void): () => void;
  /** The desk drew a frame that moved what the anchor says: the subscribers are told. */
  publish(over: Partial<SelectionAnchor>): void;
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
      anchor = { ...anchor, ...over };
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
  await seedField(ce, ce.docs.create(), createDeskBlobStore());
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
    expect(cellActs()).toEqual(["send", "|", "duplicate", "tape", "more", "|", "delete"]);
    expect(cell("send").textContent).toBe("Send to…");
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
    // the last place: centred over the moved brackets (happy-dom lays nothing out: the bar's own width reads 0)
    expect(bar().style.transform).toBe(`translate(${(500 + 60).toFixed(1)}px, 250.0px)`);
    expect(after.placements).toBeLessThanOrEqual(after.publishes);
  });

  it('says "Send 2 to…" for two, and "Lift the tape" with no Duplicate for a taped selection', () => {
    mount();
    act(() => {
      ce.ops.setSelection([note, pad]);
      selection.publish({ count: 2 });
    });
    expect(cell("send").textContent).toBe("Send 2 to…");
    act(() => selection.publish({ count: 1, locked: true }));
    expect(cellActs()).toEqual(["send", "|", "tape", "more", "|", "delete"]);
    expect(cell("tape").getAttribute("aria-label")).toBe("Lift the tape");
    expect(cell("tape").querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe("lift");
  });

  it("names a missing face's type and word where the kind's acts would stand — Duplicate still offered", () => {
    words = (type) => ({ type, title: "Note", state: "plugin off", label: "Note · plugin off" });
    mount();
    expect(cellActs()).toEqual([
      "send",
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
    expect(bar().style.transform).toBe("translate(200.0px, 350.0px)");
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
    expect(cell("send").textContent).toBe("Send 2 to…");
    act(() => {
      ce.ops.clearSelection();
      selection.publish({ count: 0, box: null });
    });
    expect(bar().dataset.shown).toBe("false");
    expect(bar().style.transition).toBe("opacity 120ms ease-out, visibility 0s linear 120ms");
    expect(cellActs()).toEqual(said);
    expect(cell("send").textContent).toBe("Send 2 to…"); // what it said, not what an empty selection would
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
    expect(rows()).toEqual(["comment", "send", "duplicate", "front", "back", "tape", "delete"]);
    expect(bar().querySelector(".vf-bar-eye")?.textContent).toBe("NOTE");
    // the nearest takeable row is hot; keys at the rows' ends
    expect(bar().querySelector("[data-hot]")?.getAttribute("data-row")).toBe("comment");
    expect(
      [...bar().querySelectorAll(".vf-bar-list .vf-bar-key")].map((el) => el.textContent),
    ).toEqual(["⌘D", "⇧⌘L", "⌫"]);
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
    // grown up (the default room) the list reads bottom-up: ↑ walks away from the bar — comment, then (Send to…
    // waits, so it is no stop) Duplicate, then Bring to front
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
    act(() => cell("send").focus());
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

  it("is reached by Tab from the draft: the bar stands after the line in the chrome's document order (R9)", () => {
    const chrome = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/field/ChromeLayer.tsx"),
      "utf8",
    );
    // the line (the draft, the mic, send) is the frame's — <ViewFrame> — and the bar comes next, before the status line
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
