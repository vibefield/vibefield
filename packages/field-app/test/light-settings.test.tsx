// @vitest-environment happy-dom

// Item 583 (DESIGN.md §8 "Settings → Canvas") — the Light section, as a pure view over its model: the still of the mat,
// eight plant tiles, Mirror, five sliders with words at their ends, and Reset light. Under the Moon, Shade and Tint
// rest and each says why; under Reduce motion, Wind does: never a slider that silently does nothing.

import { type DeskLightValues, deskLightValues } from "@vibefield/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gridColumns,
  type LightSettingsModel,
  LightSettingsView,
  PLANTS,
  type PlantSilhouettes,
  tileAfter,
} from "../src/panels/canvas/LightSettings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REST = deskLightValues(undefined);
const SHADE = "rgb(65% 67% 71%)";
/** A stand-in for the plants' shadows: any image a mask can name. */
const LEAF = "data:image/png;base64,AAAA";
const SILHOUETTES: PlantSilhouettes = {
  monstera: LEAF,
  "climbing-monstera": LEAF,
  "fan-palm": LEAF,
  "coconut-palm": LEAF,
  "under-the-palm": LEAF,
  palm: LEAF,
  canopy: LEAF,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function mount(model: Partial<LightSettingsModel> = {}, values: Partial<DeskLightValues> = {}) {
  const onPlant = vi.fn();
  const onMirror = vi.fn();
  const onSlide = vi.fn();
  const onLetGo = vi.fn();
  const onReset = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(LightSettingsView, {
        model: {
          values: { ...REST, ...values },
          theme: "light",
          shade: SHADE,
          silhouettes: SILHOUETTES,
          reducedMotion: false,
          ...model,
        },
        onPlant,
        onMirror,
        onSlide,
        onLetGo,
        onReset,
      }),
    ),
  );
  const el = container;
  const plant = (id: string) =>
    el.querySelector<HTMLButtonElement>(`[role="radio"][data-light-plant="${id}"]`);
  const row = (name: string) => el.querySelector<HTMLElement>(`[data-light-row="${name}"]`);
  const slider = (name: string) =>
    row(name)?.querySelector<HTMLInputElement>('input[type="range"]');
  const reset = () =>
    [...el.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Reset light",
    );
  const preview = () => el.querySelector<HTMLElement>("[data-light-preview]");
  return { el, plant, row, slider, reset, preview, onPlant, onMirror, onSlide, onLetGo, onReset };
}

/** Drag a slider's thumb to a place on its track, as the browser reports it. */
function slide(input: HTMLInputElement | null | undefined, track: number): void {
  if (input === null || input === undefined) throw new Error("no slider");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
    input,
    String(track),
  );
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Press a key on the chosen tile, as a person who tabbed to the tiles would; true when the tiles took it. */
function press(m: ReturnType<typeof mount>, key: string): boolean {
  const tile = m.el.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]');
  if (tile === null) throw new Error("no chosen tile");
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    tile.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** Lay the tiles `columns` to a row, as the stylesheet does at its two widths (a test loads no stylesheet). */
function lay(m: ReturnType<typeof mount>, columns: number): void {
  const group = m.el.querySelector<HTMLElement>('[role="radiogroup"]');
  if (group === null) throw new Error("no tiles");
  group.style.setProperty("grid-template-columns", Array(columns).fill("164px").join(" "));
}

describe("the Light section (583)", () => {
  it("says what it is for, and shows the eight plants by name, the chosen one checked", () => {
    const m = mount();
    expect(m.el.textContent).toContain("Light");
    expect(m.el.textContent).toContain(
      "The plant whose shadow falls on your desk, and how the light moves. By day it is sunlight, and by night moonlight.",
    );
    expect(PLANTS.map((p) => p.name)).toEqual([
      "None",
      "Monstera",
      "Climbing monstera",
      "Fan palm",
      "Coconut palm",
      "Under the palm",
      "Palm",
      "Canopy",
    ]);
    const tiles = [...m.el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(tiles.map((t) => t.textContent)).toEqual(PLANTS.map((p) => p.name));
    expect(tiles.filter((t) => t.getAttribute("aria-checked") === "true")).toHaveLength(1);
    expect(m.plant("monstera")?.getAttribute("aria-checked")).toBe("true");
  });

  it("chooses a plant by its tile, and does nothing for the one already chosen", () => {
    const m = mount();
    act(() => m.plant("fan-palm")?.click());
    expect(m.onPlant).toHaveBeenCalledWith("fan-palm");
    act(() => m.plant("none")?.click());
    expect(m.onPlant).toHaveBeenLastCalledWith("none");
    m.onPlant.mockClear();
    act(() => m.plant("monstera")?.click());
    expect(m.onPlant).not.toHaveBeenCalled();
  });

  it("is one stop for Tab, the chosen tile, and the arrows reach the rest", () => {
    const m = mount({}, { plant: "fan-palm" });
    const tiles = [...m.el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const stops = tiles.filter((t) => t.tabIndex === 0);
    expect(stops.map((t) => t.getAttribute("data-light-plant"))).toEqual(["fan-palm"]);
    expect(tiles.filter((t) => t.tabIndex === -1)).toHaveLength(PLANTS.length - 1);
  });

  it("chooses with ← and → the next and the one before, wrapping at the ends, and the focus goes too", () => {
    const m = mount({}, { plant: "none" });
    expect(press(m, "ArrowRight")).toBe(true);
    expect(m.onPlant).toHaveBeenLastCalledWith("monstera");
    expect(document.activeElement).toBe(m.plant("monstera"));
    expect(press(m, "ArrowLeft")).toBe(true);
    expect(m.onPlant).toHaveBeenLastCalledWith("canopy");
    expect(document.activeElement).toBe(m.plant("canopy"));
    // any other key is not the tiles': Home, End and a letter choose nothing, and a tile's own click stays its own
    m.onPlant.mockClear();
    for (const key of ["Home", "End", "p", "Enter", " "]) expect(press(m, key), key).toBe(false);
    expect(m.onPlant).not.toHaveBeenCalled();
  });

  it("chooses with ↑ and ↓ the tile over or under, as the rows lie: four to a row, or two", () => {
    const m = mount({}, { plant: "monstera" });
    lay(m, 4);
    press(m, "ArrowDown");
    expect(m.onPlant).toHaveBeenLastCalledWith("under-the-palm");
    // two rows: the tile over the top one is the bottom one
    press(m, "ArrowUp");
    expect(m.onPlant).toHaveBeenCalledTimes(2);
    expect(m.onPlant).toHaveBeenLastCalledWith("under-the-palm");
    // where Settings is narrow the tiles lie two to a row, and the same keys follow them
    lay(m, 2);
    press(m, "ArrowDown");
    expect(m.onPlant).toHaveBeenLastCalledWith("fan-palm");
    press(m, "ArrowUp");
    expect(m.onPlant).toHaveBeenLastCalledWith("canopy");
  });

  it("reads the columns off the grid's computed template, laid out or not", () => {
    expect(gridColumns("164px 164px 164px 164px")).toBe(4);
    expect(gridColumns("300.5px 300.5px")).toBe(2);
    expect(gridColumns("repeat(4, minmax(0px, 1fr))")).toBe(4);
    expect(gridColumns("minmax(0px, 1fr) minmax(0px, 1fr)")).toBe(2);
    expect(gridColumns("none")).toBe(1);
    expect(gridColumns("")).toBe(1);
  });

  it("steps along the tiles and along a tile's own column, wrapping at the ends", () => {
    expect(tileAfter("ArrowRight", 7, 8, 4)).toBe(0);
    expect(tileAfter("ArrowLeft", 0, 8, 4)).toBe(7);
    expect(tileAfter("ArrowDown", 2, 8, 4)).toBe(6);
    expect(tileAfter("ArrowDown", 6, 8, 4)).toBe(2);
    expect(tileAfter("ArrowUp", 2, 8, 2)).toBe(0);
    expect(tileAfter("ArrowUp", 0, 8, 2)).toBe(6);
    expect(tileAfter("Home", 3, 8, 4)).toBeUndefined();
  });

  it("while a change is on its way, a tile keeps the focus and takes no key and no click", () => {
    const m = mount({ busy: true }, { tint: 0.5 });
    const chosen = m.plant("monstera");
    expect(chosen?.disabled).toBe(false);
    chosen?.focus();
    // the arrow is still the tiles' own (the page does not scroll), and it chooses nothing
    expect(press(m, "ArrowRight")).toBe(true);
    act(() => m.plant("fan-palm")?.click());
    expect(m.onPlant).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(chosen);
    // the switch, the sliders and Reset wait for it
    expect(
      m.el.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Mirror"]')?.disabled,
    ).toBe(true);
    expect(m.slider("softness")?.disabled).toBe(true);
    expect(m.reset()?.disabled).toBe(true);
  });

  it("draws the chosen plant's shadow on the still, flipped under Mirror, and the bare mat for None", () => {
    const worn = mount();
    expect(worn.preview()?.getAttribute("data-light-preview")).toBe("monstera");
    expect(worn.preview()?.querySelectorAll(".vf-light-shadow")).toHaveLength(2);
    expect(worn.preview()?.querySelector(".vf-light-shadows")?.hasAttribute("data-mirror")).toBe(
      false,
    );
    expect(worn.preview()?.style.getPropertyValue("--vf-light-shade")).toBe(SHADE);
    act(() => root?.unmount());
    root = null;
    const mirrored = mount({}, { mirror: true });
    expect(
      mirrored.preview()?.querySelector(".vf-light-shadows")?.getAttribute("data-mirror"),
    ).toBe("true");
    act(() => root?.unmount());
    root = null;
    const bare = mount({}, { plant: "none" });
    expect(bare.preview()?.querySelectorAll(".vf-light-shadow")).toHaveLength(0);
    // the None tile is the bare mat too; every other tile wears its plant
    expect(bare.plant("none")?.querySelector(".vf-light-tile-leaf")).toBeNull();
    expect(bare.plant("palm")?.querySelector(".vf-light-tile-leaf")).not.toBeNull();
  });

  it("until the plants' shadows have loaded, the still and the tiles are the bare mat", () => {
    const { silhouettes: _none, ...model } = {
      values: REST,
      theme: "light" as const,
      shade: SHADE,
      silhouettes: SILHOUETTES,
      reducedMotion: false,
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        createElement(LightSettingsView, {
          model,
          onPlant: vi.fn(),
          onMirror: vi.fn(),
          onSlide: vi.fn(),
          onLetGo: vi.fn(),
          onReset: vi.fn(),
        }),
      ),
    );
    expect(container.querySelectorAll(".vf-light-shadow, .vf-light-tile-leaf")).toHaveLength(0);
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(8);
  });

  it("flips the shadow with Mirror", () => {
    const m = mount();
    const toggle = m.el.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Mirror"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(m.row("mirror")?.textContent).toContain("Flip the plant's shadow left to right.");
    act(() => toggle?.click());
    expect(m.onMirror).toHaveBeenCalledWith(true);
  });

  it("has five sliders with words at their ends and no number", () => {
    const m = mount();
    const ends = (name: string) =>
      [...(m.row(name)?.querySelectorAll(".vf-light-ends span") ?? [])].map((s) => s.textContent);
    expect(ends("softness")).toEqual(["Sharp", "Soft"]);
    expect(ends("shade")).toEqual(["Lighter", "Deeper"]);
    expect(ends("tint")).toEqual(["Neutral", "Cool"]);
    expect(ends("size")).toEqual(["Smaller", "Larger"]);
    expect(ends("wind")).toEqual(["Still", "Breezy"]);
    for (const name of ["softness", "shade", "tint", "size", "wind"]) {
      expect(m.slider(name)?.disabled, name).toBe(false);
      expect(m.row(name)?.textContent, name).not.toMatch(/[0-9]/);
    }
  });

  it("moves the desk as a slider is dragged, and is written when it is let go", () => {
    const m = mount();
    // Softness runs 0.5 … 2: its rest, 1, is a third of the way along
    expect(m.slider("softness")?.value).toBe("33");
    slide(m.slider("softness"), 100);
    expect(m.onSlide).toHaveBeenLastCalledWith("softness", 2);
    slide(m.slider("wind"), 0);
    expect(m.onSlide).toHaveBeenLastCalledWith("wind", 0);
    expect(m.onLetGo).not.toHaveBeenCalled();
    act(() => {
      m.slider("wind")?.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    expect(m.onLetGo).toHaveBeenCalledTimes(1);
  });

  it("runs Shade from Lighter to Deeper: its stored share of the lit mat falls along the track", () => {
    const m = mount();
    // 0.7 of lit between 0.9 (Lighter, the track's start) and 0.55 (Deeper, its end)
    expect(m.slider("shade")?.value).toBe("57");
    slide(m.slider("shade"), 100);
    expect(m.onSlide).toHaveBeenLastCalledWith("shade", 0.55);
    slide(m.slider("shade"), 0);
    expect(m.onSlide).toHaveBeenLastCalledWith("shade", 0.9);
  });

  it("under the Moon, Shade and Tint rest at their value and each says why; the others still move", () => {
    const m = mount({ theme: "dark" }, { shade: 0.6 });
    expect(m.slider("shade")?.disabled).toBe(true);
    expect(m.slider("tint")?.disabled).toBe(true);
    expect(m.slider("shade")?.value).toBe("86");
    expect(m.row("shade")?.textContent).toContain(
      "Sets the daylight's shade. In the dark theme, moonlight keeps its own.",
    );
    expect(m.row("tint")?.textContent).toContain(
      "Sets the daylight's tint. In the dark theme, moonlight keeps its own.",
    );
    for (const name of ["softness", "size", "wind"]) {
      expect(m.slider(name)?.disabled, name).toBe(false);
    }
  });

  it("under Reduce motion, Wind rests and says why", () => {
    const m = mount({ reducedMotion: true });
    expect(m.slider("wind")?.disabled).toBe(true);
    expect(m.row("wind")?.textContent).toContain(
      "Still while Reduce motion is on in System Settings.",
    );
    expect(m.slider("softness")?.disabled).toBe(false);
    // by day Shade and Tint say nothing of the Moon
    expect(m.el.textContent).not.toContain("moonlight keeps its own");
  });

  it("resets every row at once, and only when a row is off its rest", () => {
    const rest = mount();
    expect(rest.reset()?.disabled).toBe(true);
    act(() => root?.unmount());
    root = null;
    const moved = mount({}, { tint: 0.5 });
    expect(moved.reset()?.disabled).toBe(false);
    act(() => moved.reset()?.click());
    expect(moved.onReset).toHaveBeenCalledTimes(1);
  });

  it("changes nothing while the preferences cannot be written", () => {
    const m = mount({ writable: false }, { tint: 0.5 });
    expect(
      [...m.el.querySelectorAll<HTMLButtonElement>('[role="radio"]')].every((t) => t.disabled),
    ).toBe(true);
    expect(
      m.el.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Mirror"]')?.disabled,
    ).toBe(true);
    for (const name of ["softness", "shade", "tint", "size", "wind"]) {
      expect(m.slider(name)?.disabled, name).toBe(true);
    }
    expect(m.reset()?.disabled).toBe(true);
  });
});
