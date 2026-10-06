// @vitest-environment happy-dom
/**
 * R19 (DK-13) — the kit's `SegmentedControl` EXTENDED (DESIGN.md §8 "Segmented control", "The pegboard"; UI_SYSTEM's
 * primitives): a THUMB element under the chosen segment, sliding (placed at once the first time, from the chosen
 * segment's measured box); options whose ids are distinct from their labels; ← → Home End choosing, the chosen segment
 * the group's one stop of Tab. A bare string option is its id and its label, as every caller before the pegboard
 * wrote it.
 */
import { SegmentedControl, segmentForKey } from "@vibefield/design-kit/primitives";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

function render(node: React.ReactElement): void {
  act(() => root?.render(node));
}

const track = (): HTMLFieldSetElement => host?.querySelector("fieldset") as HTMLFieldSetElement;
const buttons = (): HTMLButtonElement[] => [
  ...track().querySelectorAll<HTMLButtonElement>("button"),
];
const keyDown = (target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

const FILTERS = [
  { id: "", label: "All" },
  { id: "paper", label: "Paper" },
  { id: "surfaces", label: "Surfaces" },
  { id: "things", label: "Things" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

describe("segmentForKey — the keys that choose (R19)", () => {
  it("steps one over with ← →, never wrapping, and jumps with Home End", () => {
    expect(segmentForKey("ArrowRight", 0, 4)).toBe(1);
    expect(segmentForKey("ArrowRight", 3, 4)).toBe(3);
    expect(segmentForKey("ArrowLeft", 2, 4)).toBe(1);
    expect(segmentForKey("ArrowLeft", 0, 4)).toBe(0);
    expect(segmentForKey("Home", 2, 4)).toBe(0);
    expect(segmentForKey("End", 0, 4)).toBe(3);
    // nothing chosen yet: either arrow lands on the first
    expect(segmentForKey("ArrowRight", -1, 4)).toBe(0);
    expect(segmentForKey("ArrowLeft", -1, 4)).toBe(0);
    expect(segmentForKey("ArrowUp", 1, 4)).toBeNull();
    expect(segmentForKey("Enter", 1, 4)).toBeNull();
    expect(segmentForKey("End", 0, 0)).toBeNull();
  });
});

describe("SegmentedControl, extended (R19)", () => {
  it("keeps a bare string option its own id and label", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={["Light", "Dark"] as const}
        value="Dark"
        onChange={onChange}
        label="Theme"
      />,
    );
    expect(
      buttons().map((b) => [b.textContent, b.dataset["id"], b.getAttribute("aria-pressed")]),
    ).toEqual([
      ["Light", "Light", "false"],
      ["Dark", "Dark", "true"],
    ]);
    act(() => buttons()[0]?.click());
    expect(onChange).toHaveBeenCalledWith("Light");
  });

  it("speaks ids and shows labels — All's id is the empty string", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl<Filter> options={FILTERS} value="" onChange={onChange} label="Objects" />,
    );
    expect(buttons().map((b) => b.textContent)).toEqual(["All", "Paper", "Surfaces", "Things"]);
    expect(buttons().map((b) => b.dataset["id"])).toEqual(["", "paper", "surfaces", "things"]);
    expect(buttons()[0]?.getAttribute("aria-pressed")).toBe("true");
    act(() => buttons()[2]?.click());
    expect(onChange).toHaveBeenCalledWith("surfaces");
  });

  it("is ONE stop of Tab: the chosen segment alone is tabbable (the first when none is)", () => {
    render(
      <SegmentedControl<Filter>
        options={FILTERS}
        value="surfaces"
        onChange={() => undefined}
        label="Objects"
      />,
    );
    expect(buttons().map((b) => b.tabIndex)).toEqual([-1, -1, 0, -1]);
    render(
      <SegmentedControl<string>
        options={FILTERS.map((f) => f.id)}
        value="gone"
        onChange={() => undefined}
        label="Objects"
      />,
    );
    expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it("chooses with ← → Home End, moving the focus with the choice, and claims those keys", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl<Filter>
        options={FILTERS}
        value="paper"
        onChange={onChange}
        label="Objects"
      />,
    );
    const right = keyDown(buttons()[1] as HTMLElement, "ArrowRight");
    expect(right.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith("surfaces");
    expect(document.activeElement).toBe(buttons()[2]);
    keyDown(buttons()[1] as HTMLElement, "ArrowLeft");
    expect(onChange).toHaveBeenLastCalledWith("");
    keyDown(buttons()[1] as HTMLElement, "End");
    expect(onChange).toHaveBeenLastCalledWith("things");
    expect(document.activeElement).toBe(buttons()[3]);
    keyDown(buttons()[1] as HTMLElement, "Home");
    expect(onChange).toHaveBeenLastCalledWith("");
    // the desk's keys pass: a modifier, or a key the control does not choose with
    onChange.mockClear();
    expect(
      keyDown(buttons()[1] as HTMLElement, "ArrowRight", { metaKey: true }).defaultPrevented,
    ).toBe(false);
    expect(keyDown(buttons()[1] as HTMLElement, "ArrowDown").defaultPrevented).toBe(false);
    expect(keyDown(buttons()[1] as HTMLElement, "b").defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves on from the FOCUSED segment when the owner has not handed the choice back yet", () => {
    const onChange = vi.fn();
    // the owner keeps "paper" (its value lags or holds); the keys walk on from where the focus is
    render(
      <SegmentedControl<Filter>
        options={FILTERS}
        value="paper"
        onChange={onChange}
        label="Objects"
      />,
    );
    keyDown(buttons()[1] as HTMLElement, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("surfaces");
    keyDown(document.activeElement as HTMLElement, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("things");
    // …and back onto the value itself is still a choice made (the focus moved)
    keyDown(document.activeElement as HTMLElement, "ArrowLeft");
    keyDown(document.activeElement as HTMLElement, "ArrowLeft");
    expect(onChange).toHaveBeenLastCalledWith("paper");
    expect(document.activeElement).toBe(buttons()[1]);
  });

  it("does not call back for a key that lands where it stands (← on the first)", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl<Filter> options={FILTERS} value="" onChange={onChange} label="Objects" />,
    );
    expect(keyDown(buttons()[0] as HTMLElement, "ArrowLeft").defaultPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("draws a THUMB under the chosen segment, placed at once, then following the choice", () => {
    // happy-dom lays nothing out: each segment is given a box (left 3 + 80 a segment, 30 tall)
    const box = (el: HTMLElement): { left: number; width: number } => {
      const i =
        el.parentElement === null
          ? -1
          : [...el.parentElement.querySelectorAll(":scope > button")].indexOf(el);
      return i < 0 ? { left: 0, width: 0 } : { left: 3 + i * 80, width: 70 + i * 4 };
    };
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return box(this).left;
    });
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockReturnValue(3);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return box(this).width;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
    const view = (value: Filter): React.ReactElement => (
      <SegmentedControl<Filter>
        options={FILTERS}
        value={value}
        onChange={() => undefined}
        label="Objects"
      />
    );
    render(view("paper"));
    const thumb = track().querySelector<HTMLElement>(".vf-ui-segmented-thumb");
    expect(thumb?.getAttribute("aria-hidden")).toBe("true");
    expect(track().dataset["thumb"]).toBe("placed");
    expect(thumb?.style.transform).toBe("translate(83px, 3px)");
    expect(thumb?.style.width).toBe("74px");
    expect(thumb?.style.height).toBe("30px");
    // the first placement is not a slide: its transition is put back once placed
    expect(thumb?.style.transition).toBe("");
    render(view("things"));
    expect(thumb?.style.transform).toBe("translate(243px, 3px)");
    expect(thumb?.style.width).toBe("82px");
  });

  it("leaves the choice on its segment until the thumb can be placed (no layout, no measure)", () => {
    render(
      <SegmentedControl<Filter>
        options={FILTERS}
        value="paper"
        onChange={() => undefined}
        label="Objects"
      />,
    );
    expect(track().dataset["thumb"]).toBeUndefined();
    expect(buttons()[1]?.getAttribute("aria-pressed")).toBe("true");
  });
});
