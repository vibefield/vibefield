// @vitest-environment happy-dom
/**
 * GODVIEW'S HEAD — STORIES (GV-D1; DESIGN.md §8 "Godview's head — Stories"),
 * at the grain the repo tests chrome: the row's arithmetic (`head-row.ts`),
 * the shipping view (`GodviewHeadView`) on fixture views, and its stylesheet
 * held to the entry's numbers. The monitor mounting it behind its boundary,
 * and rendering it only for its own inputs (M195), is `godview-monitor.test`'s;
 * the deck's edge staying where the bar left it is `godview-stage-rule.test`'s.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MONITOR_VIEWS } from "@vibefield/puppeteer-views";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type GodviewHeadDeck,
  type GodviewHeadEntry,
  GodviewHeadView,
} from "../src/godview/GodviewHeadView";
import {
  HEAD_RESERVE,
  STORIES_RETURN_MS,
  storiesShown,
  storyHome,
  storyInView,
  storyName,
  storyPages,
  storyTurn,
} from "../src/godview/head-row";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sheet = readFileSync(join(PACKAGE_ROOT, "src/godview/godview-head.css"), "utf8");
/** One rule's declarations, by its exact selector. */
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sheet.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
};

/** `count` views, the first few with marks and keys as a manifest gives them. */
function fixtureViews(count: number): GodviewHeadEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `view-${index}`,
    label: `VIEW ${index}`,
    mark: { viewBox: "0 0 24 24", paths: [`M${index} 0h4v4h-4z`] },
    ...(index === 1
      ? {
          keys: [
            { key: "Escape", label: "put it away" },
            { key: "ArrowRight", label: "the next one" },
          ],
        }
      : {}),
  }));
}

/** The room the head measures: happy-dom lays nothing out, so the fixture says
 * how wide the room is, and re-measures as a window that changed would. */
let roomWidth = 0;
const observers: { callback: ResizeObserverCallback }[] = [];
class FakeResizeObserver {
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    const index = observers.indexOf(this);
    if (index >= 0) observers.splice(index, 1);
  }
}
function resizeRoom(width: number): void {
  roomWidth = width;
  act(() => {
    for (const observer of [...observers]) {
      observer.callback([], observer as unknown as ResizeObserver);
    }
  });
}

let root: Root | null = null;
let host: HTMLElement;
const selected: string[] = [];

beforeEach(() => {
  roomWidth = 0;
  selected.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("vf-stories") ? roomWidth : 0;
  });
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  observers.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(
  views: readonly GodviewHeadEntry[],
  viewId: string,
  deck: GodviewHeadDeck = "up",
): void {
  root ??= createRoot(host);
  act(() =>
    root?.render(
      <GodviewHeadView
        views={views}
        viewId={viewId}
        deck={deck}
        onSelectView={(id) => selected.push(id)}
      />,
    ),
  );
}

const head = (): HTMLElement => host.querySelector<HTMLElement>(".vf-stories") as HTMLElement;
const row = (): HTMLElement => host.querySelector<HTMLElement>(".vf-stories-row") as HTMLElement;
const circles = (): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>(
    '[role="group"][aria-label="Monitor view"] button[aria-pressed]',
  ),
];
const circle = (label: string): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(
    `[role="group"][aria-label="Monitor view"] button[aria-label="${label} view"]`,
  ) as HTMLButtonElement;
const chevron = (name: "Earlier views" | "More views"): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const label = (): HTMLElement | null => host.querySelector<HTMLElement>(".vf-stories-label");
const shown = (): string => row().style.getPropertyValue("--vf-stories-shown");
const offset = (): string => row().style.getPropertyValue("--vf-stories-offset");

// React derives onPointerEnter/Leave from pointerover/pointerout pairs.
function pointerOnto(element: Element): void {
  act(() => {
    element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: null }));
  });
}
function pointerOff(element: Element): void {
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    );
  });
}

describe("the row's arithmetic (head-row.ts)", () => {
  it("shows every circle when they fit, nine at most, and whole circles only", () => {
    // five circles are 5 × 40 + 4 × 12 = 248 wide
    expect(storiesShown(5, 248)).toBe(5);
    expect(storiesShown(5, 1_000)).toBe(5);
    // unmeasured: all of them, up to the nine
    expect(storiesShown(5, null)).toBe(5);
    expect(storiesShown(14, null)).toBe(9);
    // nine at most, however wide the room
    expect(storiesShown(14, 4_000)).toBe(9);
    expect(storiesShown(0, 500)).toBe(0);
  });

  it("pages when they do not fit, taking a chevron and its gap off each end first", () => {
    // 247 is one pixel short of five: it pages, and (247 − 2 × 40 + 12) / 52 is 3 whole
    expect(storiesShown(5, 247)).toBe(3);
    // ten show nine and page, in a room that holds the nine and both chevrons:
    // 9 × 40 + 8 × 12 = 456, and 2 × (28 + 12) beside it
    expect(storiesShown(10, 536)).toBe(9);
    expect(storiesShown(10, 535)).toBe(8);
    // twelve in 400: (400 − 80 + 12) / 52 = 6 whole circles
    expect(storiesShown(12, 400)).toBe(6);
    // never none, however narrow
    expect(storiesShown(5, 40)).toBe(1);
    expect(storiesShown(5, 0)).toBe(1);
  });

  it("starts a page every three circles and ends the last on the last circle", () => {
    expect(storyPages(5, 5)).toEqual([0]);
    expect(storyPages(12, 9)).toEqual([0, 3]);
    expect(storyPages(14, 9)).toEqual([0, 3, 5]);
    expect(storyPages(10, 9)).toEqual([0, 1]);
    // a row of two turned by three would skip a circle: it turns by its own two
    expect(storyPages(5, 2)).toEqual([0, 2, 3]);
    expect(storyPages(4, 1)).toEqual([0, 1, 2, 3]);
  });

  it("finds the page that holds a circle, and turns three at a time between the ends", () => {
    expect(storyHome(14, 9, 0)).toBe(0);
    expect(storyHome(14, 9, 8)).toBe(0);
    expect(storyHome(14, 9, 9)).toBe(3);
    expect(storyHome(14, 9, 13)).toBe(5);
    // every circle is on some page, whatever the row shows
    for (const [count, fit] of [
      [14, 9],
      [12, 6],
      [5, 2],
      [7, 1],
    ] as const) {
      for (let index = 0; index < count; index += 1) {
        expect(
          storyInView(storyHome(count, fit, index), fit, index),
          `${count}/${fit}/${index}`,
        ).toBe(true);
      }
    }
    expect(storyTurn(0, 1, 14, 9)).toBe(3);
    expect(storyTurn(3, 1, 14, 9)).toBe(5);
    expect(storyTurn(5, 1, 14, 9)).toBe(5);
    expect(storyTurn(5, -1, 14, 9)).toBe(2);
    expect(storyTurn(2, -1, 14, 9)).toBe(0);
    expect(storyTurn(0, -1, 14, 9)).toBe(0);
  });

  it("says a manifest's capitals in the frame's sentence case, and a mixed-case label as written", () => {
    expect(storyName("SWARM")).toBe("Swarm");
    expect(storyName("TOKEN RAIN")).toBe("Token rain");
    expect(storyName("Spend")).toBe("Spend");
    expect(storyName("")).toBe("");
  });
});

describe("the head, mounted (GodviewHeadView)", () => {
  it("keeps the contract the instruments pick a view by: the group, its label, each view's label, and the pressed one", () => {
    mount(MONITOR_VIEWS, "list");
    const group = host.querySelector('[role="group"][aria-label="Monitor view"]');
    expect(group).not.toBeNull();
    expect(circles().map((button) => button.getAttribute("aria-label"))).toEqual(
      MONITOR_VIEWS.map((view) => `${view.label} view`),
    );
    // the lab's own selector, letter for letter (godview-lab-window.ts)
    for (const name of ["SWARM", "LIST", "RAIN", "TIMELINE", "SPEND"]) {
      expect(
        document.querySelector(
          `[role="group"][aria-label="Monitor view"] button[aria-label="${name} view"]`,
        ),
        name,
      ).toBeInstanceOf(HTMLButtonElement);
    }
    // the current view is said as the bar said it: aria-pressed, on it alone
    expect(circles().map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
      "false",
      "false",
    ]);
    act(() => circle("SPEND").click());
    expect(selected).toEqual(["spend"]);
  });

  it("draws each view's manifest mark, filled and never stroked, and nothing else in a circle (MV-D6, MV-D16)", () => {
    mount(MONITOR_VIEWS, "swarm");
    for (const entry of MONITOR_VIEWS) {
      const button = circle(entry.label);
      const mark = button.querySelector("svg");
      expect(mark?.getAttribute("viewBox")).toBe(entry.mark.viewBox);
      expect(
        [...(mark?.querySelectorAll("path") ?? [])].map((path) => path.getAttribute("d")),
      ).toEqual(entry.mark.paths);
      for (const path of mark?.querySelectorAll("path") ?? []) {
        expect(path.getAttribute("stroke")).toBeNull();
      }
      // marks only: one mark, no still, no canvas, no key of its own
      expect(button.childElementCount).toBe(1);
      expect(button.querySelector("canvas, img, kbd")).toBeNull();
      expect(button.getAttribute("aria-keyshortcuts")).toBeNull();
    }
    // the stylesheet fills the mark in its 22 box and strokes nothing
    const mark = rule(".vf-story > svg");
    expect(mark).toContain("width: 22px");
    expect(mark).toContain("height: 22px");
    expect(mark).toMatch(/fill: currentcolor/i);
    expect(mark).toContain("stroke: none");
  });

  it("draws no Add a view circle: a control that opens nothing is not drawn (N13 (a))", () => {
    mount(MONITOR_VIEWS, "swarm");
    expect(host.querySelectorAll("button").length).toBe(MONITOR_VIEWS.length);
    expect(host.querySelector('button[aria-label="Add a view"]')).toBeNull();
    expect(host.textContent).toBe("");
  });

  it("says a circle's name under it while the pointer is on it, then the keys the view takes while focused", () => {
    const views = fixtureViews(5);
    mount(views, "view-0");
    expect(label()).toBeNull();
    pointerOnto(circle("VIEW 1"));
    expect(label()?.getAttribute("role")).toBe("tooltip");
    expect(label()?.firstChild?.textContent).toBe("View 1");
    const keys = label()?.querySelector("kbd");
    expect(keys?.textContent).toBe("⎋ →");
    expect(keys?.getAttribute("aria-label")).toBe(
      "while focused: Escape, put it away; ArrowRight, the next one",
    );
    // it is placed from its circle: the second, on a row not paged
    expect(label()?.style.getPropertyValue("--vf-stories-at")).toBe("1");
    // a view that declares no key says its name alone
    pointerOnto(circle("VIEW 3"));
    expect(label()?.textContent).toBe("View 3");
    expect(label()?.querySelector("kbd")).toBeNull();
    pointerOff(circle("VIEW 3"));
    expect(label()).toBeNull();
  });

  it("says it for the keyboard's focus too, and takes it back on blur", () => {
    mount(MONITOR_VIEWS, "swarm");
    act(() => circle("TIMELINE").focus());
    expect(label()?.firstChild?.textContent).toBe("Timeline");
    act(() => circle("TIMELINE").blur());
    expect(label()).toBeNull();
    // the real manifests: the swarm's four keys, as the bar's tooltip printed them
    act(() => circle("SWARM").focus());
    expect(label()?.querySelector("kbd")?.textContent).toBe("⎋ ↵ → ←");
  });

  it("shows every circle, with no chevron, while they fit", () => {
    mount(MONITOR_VIEWS, "swarm");
    resizeRoom(964);
    expect(shown()).toBe("5");
    expect(offset()).toBe("0");
    expect(head().hasAttribute("data-paged")).toBe(false);
    expect(chevron("Earlier views")).toBeNull();
    expect(chevron("More views")).toBeNull();
  });

  it("shows whole circles only in a narrow room, and pages to the rest", () => {
    mount(MONITOR_VIEWS, "swarm");
    // 200: five do not fit, and (200 − 80 + 12) / 52 is two whole circles
    resizeRoom(200);
    expect(shown()).toBe("2");
    expect(head().hasAttribute("data-paged")).toBe(true);
    expect(chevron("Earlier views")?.disabled).toBe(true);
    expect(chevron("More views")?.disabled).toBe(false);
    act(() => chevron("More views")?.click());
    expect(offset()).toBe("2");
    act(() => chevron("More views")?.click());
    // the last page ends on the last circle
    expect(offset()).toBe("3");
    expect(chevron("More views")?.disabled).toBe(true);
    expect(chevron("Earlier views")?.disabled).toBe(false);
    // the room grows back: every circle, no chevron
    resizeRoom(964);
    expect(shown()).toBe("5");
    expect(offset()).toBe("0");
    expect(chevron("More views")).toBeNull();
  });

  it("pages nine at a time past nine, three circles a turn, and hands the focus on when a chevron empties", () => {
    const views = fixtureViews(14);
    mount(views, "view-0");
    resizeRoom(964);
    expect(shown()).toBe("9");
    const more = chevron("More views") as HTMLButtonElement;
    act(() => more.click());
    expect(offset()).toBe("3");
    act(() => {
      more.focus();
      more.click();
    });
    expect(offset()).toBe("5");
    expect(more.disabled).toBe(true);
    // the chevron stepped out from under the focus: it went on to the circle at that end
    expect(document.activeElement).toBe(circle("VIEW 13"));
  });

  it("comes back to the page that holds the current view 700ms after the pointer leaves the head", () => {
    vi.useFakeTimers();
    const views = fixtureViews(14);
    mount(views, "view-1");
    resizeRoom(964);
    const more = chevron("More views") as HTMLButtonElement;
    pointerOnto(more);
    act(() => more.click());
    act(() => more.click());
    expect(offset()).toBe("5");
    // the pointer still on the head: it stays where it was turned
    act(() => vi.advanceTimersByTime(STORIES_RETURN_MS * 2));
    expect(offset()).toBe("5");
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    pointerOff(more);
    act(() => vi.advanceTimersByTime(STORIES_RETURN_MS - 1));
    expect(offset()).toBe("5");
    act(() => vi.advanceTimersByTime(1));
    expect(offset()).toBe("0");
    // coming back onto the head before the 700 are up keeps the page
    act(() => (chevron("More views") as HTMLButtonElement).click());
    pointerOff(row());
    act(() => vi.advanceTimersByTime(STORIES_RETURN_MS - 100));
    pointerOnto(circle("VIEW 4"));
    act(() => vi.advanceTimersByTime(STORIES_RETURN_MS));
    expect(offset()).toBe("3");
  });

  it("turns to the page that holds the view when the view changes under it, and to a circle the keyboard reaches off the page", () => {
    const views = fixtureViews(14);
    mount(views, "view-0");
    resizeRoom(964);
    expect(offset()).toBe("0");
    // the view chosen from elsewhere (the lab clicks a circle off the page)
    act(() => circle("VIEW 12").click());
    expect(selected).toEqual(["view-12"]);
    mount(views, "view-12");
    expect(offset()).toBe("5");
    expect(circle("VIEW 12").getAttribute("aria-pressed")).toBe("true");
    // Tab reaches a circle off the page: the row turns to it
    act(() => circle("VIEW 0").focus());
    expect(offset()).toBe("0");
  });

  it("makes every circle and chevron in view a hole in the window's drag strip, and nothing off the page", () => {
    const views = fixtureViews(14);
    mount(views, "view-0");
    resizeRoom(964);
    const holes = circles().map((button) => button.classList.contains("no-drag"));
    expect(holes.slice(0, 9).every(Boolean)).toBe(true);
    expect(holes.slice(9).some(Boolean)).toBe(false);
    expect(chevron("More views")?.classList.contains("no-drag")).toBe(true);
    // a chevron with nothing behind it is not there (drawn at 0, no pointer), so it is no hole
    // either: its box lets the strip drag the window
    expect(chevron("Earlier views")?.disabled).toBe(true);
    expect(chevron("Earlier views")?.classList.contains("no-drag")).toBe(false);
    // turned to the far end, the two swap
    act(() => chevron("More views")?.click());
    act(() => chevron("More views")?.click());
    expect(chevron("More views")?.disabled).toBe(true);
    expect(chevron("More views")?.classList.contains("no-drag")).toBe(false);
    expect(chevron("Earlier views")?.classList.contains("no-drag")).toBe(true);
    // the head itself and its row are not holes: the app's strip drags the window across them
    expect(head().classList.contains("no-drag")).toBe(false);
    expect(row().classList.contains("no-drag")).toBe(false);
    expect(rule(".vf-stories")).toContain("pointer-events: none");
    expect(rule(".vf-story")).toContain("pointer-events: auto");
    expect(rule(".vf-stories-chev")).toContain("pointer-events: auto");
  });

  it("steps away while the terminals are maximized: faded, inert, and no hole in the title bar (GV-D11)", () => {
    const views = fixtureViews(14);
    mount(views, "view-0", "up");
    resizeRoom(964);
    expect(head().getAttribute("data-deck")).toBe("up");
    expect(head().hasAttribute("inert")).toBe(false);
    mount(views, "view-0", "maximized");
    expect(head().getAttribute("data-deck")).toBe("maximized");
    expect(head().hasAttribute("inert")).toBe(true);
    expect(host.querySelector(".no-drag")).toBeNull();
    expect(rule('.vf-stories[data-deck="maximized"]')).toContain("opacity: 0");
    expect(rule(".vf-stories")).toContain("transition: opacity 200ms ease");
    // away, the head stands as it does while they are up
    mount(views, "view-0", "away");
    expect(head().hasAttribute("inert")).toBe(false);
    expect(circle("VIEW 0").classList.contains("no-drag")).toBe(true);
  });
});

describe("the head's stylesheet, held to DESIGN.md's entry", () => {
  it("is tokens only: no hex, no keyframe, and only the island curve by name", () => {
    expect(sheet).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(sheet).not.toContain("@keyframes");
    expect(sheet).not.toMatch(/cubic-bezier/);
    expect(sheet.match(/var\(--vf-ease-[a-z]+\)/g)).toEqual(["var(--vf-ease-island)"]);
  });

  it("puts the row on the frame's head row: 40 at top 8, centred, one gap from the package circle and from the search button", () => {
    const room = rule(".vf-stories");
    expect(room).toContain("top: 8px");
    expect(room).toContain("height: 40px");
    expect(room).toContain("justify-content: center");
    // the wider end on both sides: the package circle's 96 + 40 + 12 (PL-D2, HN-8 — the lights'
    // slot's 96 + 12 until then), or 16 + the Peek's own measure + 12
    expect(room).toContain(
      "--vf-stories-side: max(96px + 40px + 12px, 16px + var(--vf-peek-find-width, 40px) + 12px)",
    );
    expect(room).toContain("right: var(--vf-stories-side)");
    expect(room).toContain("left: var(--vf-stories-side)");
    // the slot takes no height from the column, and stands over the sheet and the CRT layers
    const slot = rule(".vf-stories-slot");
    expect(slot).toContain("height: 0");
    expect(slot).toContain("z-index: 31");
    expect(slot).toContain("font-family: var(--vf-font-sans)");
  });

  it("draws a circle as the line's glass, 40 and 12 apart, its ring and its edge inside its own 40", () => {
    const circleRule = rule(".vf-story");
    expect(circleRule).toContain("width: 40px");
    expect(circleRule).toContain("height: 40px");
    expect(circleRule).toContain("border-radius: 20px");
    expect(circleRule).toContain("background: var(--vf-stories-glass)");
    expect(circleRule).toContain("backdrop-filter: blur(24px)");
    expect(circleRule).toMatch(
      /box-shadow:\s*0 0 0 1px var\(--vf-stories-edge\),\s*var\(--vf-shadow-island\),\s*var\(--vf-stories-lift\)/,
    );
    expect(circleRule).toContain("color: var(--vf-text-secondary)");
    expect(circleRule).toMatch(/transition:\s*box-shadow 120ms ease,\s*color 120ms ease/);
    // the line's glass, by day and by night (§5)
    expect(rule(".vf-stories")).toContain(
      "--vf-stories-glass: color-mix(in srgb, var(--vf-chrome-solid) 88%, transparent)",
    );
    expect(rule(".vf-stories")).toContain("--vf-stories-edge: var(--vf-hairline)");
    const night = rule(".dark .vf-stories");
    expect(night).toContain("color-mix(in srgb, var(--vf-chrome-solid) 94%, transparent)");
    expect(night).toContain("--vf-stories-edge: var(--vf-hairline-strong)");
    expect(night).toContain("--vf-stories-lift: inset 0 1px 0 rgb(255 255 255 / 6%)");
    // 12 apart, a step of 52
    expect(rule(".vf-stories-track")).toContain("gap: 12px");
    expect(rule(".vf-stories-row")).toContain("width: calc(var(--vf-stories-shown) * 52px - 12px)");
    // the current view's ring: 2 in primary ink, inside, in place of the hairline
    const ring = rule('.vf-story[aria-pressed="true"]');
    expect(ring).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--vf-text-primary\)/);
    expect(ring).not.toContain("--vf-stories-edge");
    expect(ring).toContain("color: var(--vf-text-primary)");
    // under the pointer or the focus: 1.5 in tertiary ink
    const edge = rule(".vf-story:is(:hover, :focus-visible)");
    expect(edge).toMatch(/box-shadow:\s*inset 0 0 0 1\.5px var\(--vf-text-tertiary\)/);
    // …and the ring wins on the current circle: its rule comes after
    expect(sheet.indexOf('.vf-story[aria-pressed="true"]')).toBeGreaterThan(
      sheet.indexOf(".vf-story:is(:hover, :focus-visible)"),
    );
  });

  it("draws the label solid, 24 tall, 8 under the circle and centred on it, arriving in 140ms from 3 above", () => {
    const labelRule = rule(".vf-stories-label");
    expect(labelRule).toContain("top: 48px");
    expect(labelRule).toContain(
      "left: calc((var(--vf-stories-at) - var(--vf-stories-offset)) * 52px + 20px)",
    );
    expect(labelRule).toContain("transform: translateX(-50%)");
    expect(labelRule).toContain("height: 24px");
    expect(labelRule).toContain("padding: 0 10px");
    expect(labelRule).toContain("border-radius: 12px");
    expect(labelRule).toContain("background: var(--vf-chrome-solid)");
    expect(labelRule).toMatch(
      /box-shadow:\s*0 0 0 1px var\(--vf-hairline-strong\),\s*var\(--vf-shadow-island\)/,
    );
    expect(labelRule).toContain("color: var(--vf-text-primary)");
    expect(labelRule).toContain("font-size: 12px");
    expect(labelRule).toContain("font-weight: 500");
    expect(labelRule).toContain("pointer-events: none");
    expect(labelRule).toMatch(/transition:\s*opacity 140ms ease,\s*transform 140ms ease/);
    expect(sheet).toMatch(
      /@starting-style \{\s*\.vf-stories-label \{\s*opacity: 0;\s*transform: translate\(-50%, -3px\);/,
    );
    const keys = rule(".vf-stories-label > kbd");
    expect(keys).toContain("color: var(--vf-text-tertiary)");
    expect(keys).toContain("font-size: 11px");
    expect(keys).toContain("font-weight: 400");
  });

  it("pages in 320ms on the island curve past 28 glass chevrons, and at once under reduced motion", () => {
    expect(rule(".vf-stories-track")).toContain(
      "transition: transform 320ms var(--vf-ease-island)",
    );
    expect(rule(".vf-stories-track")).toContain(
      "transform: translateX(calc(var(--vf-stories-offset) * -52px))",
    );
    const chev = rule(".vf-stories-chev");
    expect(chev).toContain("width: 28px");
    expect(chev).toContain("height: 28px");
    // on the row's axis: 6 down the 40
    expect(chev).toContain("top: 6px");
    expect(chev).toContain("background: var(--vf-stories-glass)");
    expect(rule('.vf-stories-chev[data-end="start"]')).toContain("right: calc(100% + 12px)");
    expect(rule('.vf-stories-chev[data-end="end"]')).toContain("left: calc(100% + 12px)");
    // a paged row clips along the row alone, and by overflow: a clip path would
    // make the reel the circles' backdrop root and their glass would blur nothing
    const reel = rule(".vf-stories[data-paged] .vf-stories-reel");
    expect(reel).toContain("overflow-x: clip");
    expect(reel).toContain("overflow-y: visible");
    expect(sheet).not.toMatch(/clip-path\s*:/);
    expect(sheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.vf-stories-track,\s*\.vf-stories-label \{\s*transition: none;/,
    );
  });

  it("says a failed head where the row stood, and spells the reserve the stage publishes", () => {
    const failed = rule('.vf-stories-slot > span[role="status"]');
    expect(failed).toContain("left: 50%");
    expect(failed).toContain("top: 16px");
    expect(failed).toContain("height: 24px");
    // the head's foot at 48 (its 40 at top 8), plus 8 — the token, and the number script reads
    const tokens = readFileSync(join(PACKAGE_ROOT, "../design-kit/src/tokens.css"), "utf8");
    expect(tokens).toMatch(/^\s*--vf-godview-head-reserve: 56px;/m);
    expect(HEAD_RESERVE).toBe(56);
    expect(HEAD_RESERVE).toBe(8 + 40 + 8);
  });

  it("dissolves the field under the head: the stage masked from clear at the head's axis to whole at the reserve (2026-10-12)", () => {
    // the swarm's crowd is bigger than its field and no edge holds it (the probe
    // of 2026-10-12), so what a field draws in the head's band fades under the glass
    const stage = rule(".vf-godview-monitor-stage").replace(/\s+/g, " ");
    expect(stage).toContain(
      "mask-image: linear-gradient( to bottom, transparent var(--vf-godview-head-fade-from), black var(--vf-godview-head-reserve) )",
    );
    // the axis is the head's own: its 40 at top 8, centred on 28
    const tokens = readFileSync(join(PACKAGE_ROOT, "../design-kit/src/tokens.css"), "utf8");
    expect(tokens).toMatch(/^\s*--vf-godview-head-fade-from: 28px;/m);
    expect(28).toBe(8 + 40 / 2);
    // and DESIGN.md says it, with both numbers
    const design = readFileSync(join(PACKAGE_ROOT, "../../DESIGN.md"), "utf8");
    expect(design).toContain("**The field dissolves under the head**");
    expect(design).toContain("`--vf-godview-head-fade-from` → `--vf-godview-head-reserve`");
  });
});
