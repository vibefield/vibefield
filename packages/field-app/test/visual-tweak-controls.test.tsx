// @vitest-environment happy-dom
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultProductAppearance,
  type ProductAppearance,
} from "../src/appearance/product-appearance";
import { VisualTweakControls } from "../src/design-system/tweaks/VisualTweakControls";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let latest: ProductAppearance = defaultProductAppearance();

function Harness(): ReactElement {
  const [value, setValue] = useState(defaultProductAppearance);
  latest = value;
  return <VisualTweakControls value={value} onChange={setValue} />;
}

function mount(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<Harness />));
}

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  latest = defaultProductAppearance();
});

describe("VisualTweakControls", () => {
  it("renders the complete workbench-owned control inventory inline", () => {
    mount();

    const controls = document.querySelector<HTMLElement>("[data-visual-tweak-controls]");
    expect(controls).not.toBeNull();
    expect(controls?.textContent).toContain("Canvas palette");
    expect(controls?.textContent).toContain("Background · light");
    expect(controls?.textContent).toContain("Background · dark");
    expect(controls?.textContent).toContain("Import JSON");
    expect(controls?.textContent).toContain("Export JSON");
    // DK-17: Studio's grid tweak controls and the overlap feedback's left with the 0.11 ground and the
    // DOM card — the palette is the plain ground alone (its dot inks went with the grid).
    for (const retired of ["World grid", "Magnet grid", "Field reach", "Overlap feedback", "Dots"])
      expect(controls?.textContent).not.toContain(retired);
    expect(controls?.querySelectorAll('input[type="color"]')).toHaveLength(2);
    expect(controls?.querySelector('input[type="number"]')).toBeNull();
    expect(document.querySelector("[data-dev-tweak-toggle]")).toBeNull();
    expect(document.querySelector("[data-dev-tweak-panel]")).toBeNull();
  });

  it("edits live values and resets the whole document atomically", () => {
    mount();

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const pick = (label: string, color: string): void => {
      const input = document.querySelector<HTMLInputElement>(
        `input[type="color"][aria-label="${label}"]`,
      );
      act(() => {
        setter?.call(input, color);
        input?.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    pick("Background · light", "#123456");
    expect(latest.canvasPalette.bgLight).toBe("#123456");
    pick("Background · dark", "#abcdef");
    expect(latest.canvasPalette.bgDark).toBe("#ABCDEF");

    const reset = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Reset",
    );
    act(() => reset?.click());
    expect(latest).toEqual(defaultProductAppearance());
  });
});
