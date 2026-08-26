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
    expect(controls?.textContent).toContain("World grid");
    expect(controls?.textContent).toContain("Magnet grid");
    expect(controls?.textContent).toContain("Field reach");
    expect(controls?.textContent).toContain("Polarity");
    expect(controls?.textContent).toContain("Widget silhouettes");
    expect(controls?.textContent).toContain("Widget strength");
    expect(controls?.textContent).toContain("Widget corner radius");
    expect(controls?.textContent).toContain("Needle alignment");
    expect(controls?.textContent).toContain("Needle half-length / dot swell");
    expect(controls?.textContent).toContain("Needle half-width");
    expect(controls?.textContent).toContain("Source buffer cap");
    expect(controls?.textContent).toContain("Field fade below zoom");
    expect(controls?.textContent).toContain("Overlap feedback");
    expect(controls?.textContent).toContain("Import JSON");
    expect(controls?.textContent).toContain("Export JSON");
    expect(document.querySelector("[data-dev-tweak-toggle]")).toBeNull();
    expect(document.querySelector("[data-dev-tweak-panel]")).toBeNull();
  });

  it("edits live values and resets the whole document atomically", () => {
    mount();

    const background = document.querySelector<HTMLInputElement>(
      'input[type="color"][aria-label="Background · light"]',
    );
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(background, "#123456");
      background?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(latest.canvasPalette.bgLight).toBe("#123456");

    const fineSpacing = document.querySelector<HTMLInputElement>('input[aria-label="Fine"]');
    act(() => {
      setter?.call(fineSpacing, "24");
      fineSpacing?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(latest.worldGrid.spacings[0]).toBe(24);

    const reach = document.querySelector<HTMLInputElement>('input[aria-label="Reach"]');
    act(() => {
      setter?.call(reach, "90");
      reach?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(latest.magnetGrid.reach).toBe(90);

    const maxSources = document.querySelector<HTMLInputElement>('input[aria-label="Max sources"]');
    act(() => {
      setter?.call(maxSources, "63.5");
      maxSources?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(latest.magnetGrid.maxSources).toBe(64);

    const repel = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Repel",
    );
    act(() => repel?.click());
    expect(latest.magnetGrid.polarity).toBe(-1);

    const reset = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Reset",
    );
    act(() => reset?.click());
    expect(latest).toEqual(defaultProductAppearance());
  });
});
