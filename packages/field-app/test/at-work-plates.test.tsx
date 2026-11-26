// @vitest-environment happy-dom
/**
 * Item 550b (2026-11-24) — THE CATALOG'S PLATE OF A LIVE PAGE AT WORK (DESIGN.md §8 "At work on the
 * mat"; docs/UI_SYSTEM.md: the catalog mounts the shipping view with a fixture adapter). An agent's browser pane wears
 * the at-work mark as any object does, round its own silhouette, head included: the plates hold one of it reading and
 * one acting, by the plates' own pattern — the shipping `AtWorkView` over fixture rows, marked by the product's model on
 * a pane's frame (not the note's), named as the bar names the kind ("Browser").
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  AT_WORK_LIVE_PLATES,
  AT_WORK_PLATES,
  AtWorkPlate,
  type AtWorkPlateState,
} from "../src/design-system/AtWorkPreview";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const READING = "A page at work — reading";
const ACTING = "A page at work — acting";

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.reverse()) fn();
  cleanups = [];
});

/** One plate mounted, light. */
function plate(state: string): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<AtWorkPlate state={state as AtWorkPlateState} dark={false} />));
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

describe("the plates of a live page at work", () => {
  it("are among the still plates and the live plate's picks", () => {
    expect(AT_WORK_PLATES as readonly string[]).toContain(READING);
    expect(AT_WORK_PLATES as readonly string[]).toContain(ACTING);
    expect(AT_WORK_LIVE_PLATES as readonly string[]).toContain(READING);
    expect(AT_WORK_LIVE_PLATES as readonly string[]).toContain(ACTING);
  });

  it("frame a pane, not the note, and name it as the bar names its kind", () => {
    expect(AT_WORK_PLATES as readonly string[]).toContain(READING);
    const reading = plate(READING);
    const note = plate("Reading");
    const frame = reading.querySelector(".vf-atwork-frame");
    expect(frame).not.toBeNull();
    expect(reading.querySelectorAll(".vf-atwork-stroke")).toHaveLength(1);
    // the same row on a pane's silhouette: placed apart from the note's
    expect(frame?.getAttribute("style")).not.toBe(
      note.querySelector(".vf-atwork-frame")?.getAttribute("style"),
    );
    expect(reading.querySelector("[data-atwork-names]")?.textContent).toContain(
      "is reading Browser",
    );
    const acting = plate(ACTING);
    expect(acting.querySelector("[data-atwork-names]")?.textContent).toContain(
      "is changing Browser",
    );
  });
});

const IN_HAND = "A page in your hand — another behind it";

describe("the plate of a page in your hand (DESIGN.md §8 When not; 2026-11-24)", () => {
  it("is among the still plates and the live plate's picks", () => {
    expect(AT_WORK_PLATES as readonly string[]).toContain(IN_HAND);
    expect(AT_WORK_LIVE_PLATES as readonly string[]).toContain(IN_HAND);
  });

  it("shows the held page's own mark, and the object behind it covered: its frame at none in the DOM form", () => {
    const host = plate(IN_HAND);
    const frames = [...host.querySelectorAll<HTMLElement>(".vf-atwork-frame")];
    expect(frames).toHaveLength(2);
    const opacities = frames.map((frame) => frame.style.opacity).sort();
    expect(opacities).toEqual(["0", "1"]);
    // both are named: no mark says nobody works, though one is hidden under the hand
    const names = host.querySelector("[data-atwork-names]")?.textContent ?? "";
    expect(names).toContain("Browser");
    expect(names).toContain("iOS Simulator");
  });
});
