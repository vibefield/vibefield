// @vitest-environment happy-dom
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { VisualTweakPanel } from "../src/dev-tweaks/VisualTweakPanel";
import { defaultVisualTweakValues, type VisualTweakValues } from "../src/field/visual-tuning";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let latest: VisualTweakValues = defaultVisualTweakValues();

function Harness(): ReactElement {
  const [value, setValue] = useState(defaultVisualTweakValues);
  latest = value;
  return <VisualTweakPanel value={value} onChange={setValue} />;
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
  latest = defaultVisualTweakValues();
});

describe("VisualTweakPanel", () => {
  it("keeps a topmost toggle independent of its compact draggable panel", () => {
    mount();

    const toggle = document.querySelector<HTMLButtonElement>("[data-dev-tweak-toggle]");
    expect(toggle?.getAttribute("aria-label")).toBe("Show developer tweaks");
    expect(toggle?.style.zIndex).toBe("2147483647");
    expect(document.querySelector("[data-dev-tweak-panel]")).toBeNull();

    act(() => toggle?.click());
    const panel = document.querySelector<HTMLElement>("[data-dev-tweak-panel]");
    expect(panel).not.toBeNull();
    expect(panel?.style.zIndex).toBe("2147483646");
    expect(panel?.className).toContain("backdrop-blur-2xl");
    expect(panel?.className).toContain("max-h-[calc(100vh-5rem)]");
    expect(panel?.querySelector("[data-dev-tweak-drag-handle]")).not.toBeNull();
    expect(document.body.textContent).toContain("Canvas palette");
    expect(document.body.textContent).toContain("World grid");
    expect(document.body.textContent).toContain("Overlap feedback");
    expect(document.body.textContent).toContain("Import JSON");
    expect(document.body.textContent).toContain("Export JSON");

    const handle = panel?.querySelector<HTMLElement>("[data-dev-tweak-drag-handle]");
    Object.defineProperties(panel, {
      offsetWidth: { configurable: true, value: 352 },
      offsetHeight: { configurable: true, value: 400 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({
          left: 16,
          top: 112,
          right: 368,
          bottom: 512,
          width: 352,
          height: 400,
          x: 16,
          y: 112,
          toJSON: () => undefined,
        }),
      },
    });
    Object.defineProperties(handle, {
      setPointerCapture: { configurable: true, value: () => undefined },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: () => undefined },
    });
    act(() => {
      handle?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 7,
          clientX: 36,
          clientY: 132,
        }),
      );
      handle?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 7,
          clientX: 300,
          clientY: 260,
        }),
      );
      handle?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7 }));
    });
    expect(panel?.style.left).toBe("280px");
    expect(panel?.style.top).toBe("240px");
  });

  it("edits live values and resets the whole document atomically", () => {
    mount();
    act(() => document.querySelector<HTMLButtonElement>("[data-dev-tweak-toggle]")?.click());

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

    const reset = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Reset",
    );
    act(() => reset?.click());
    expect(latest).toEqual(defaultVisualTweakValues());
  });
});
