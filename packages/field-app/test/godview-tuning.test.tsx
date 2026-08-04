// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultGodviewTuning,
  GodviewTuningPanel,
  godviewTuningStyle,
} from "../src/godview/GodviewTuningPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mountPanel(onChange = vi.fn(), onReset = vi.fn()): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <GodviewTuningPanel value={defaultGodviewTuning()} onChange={onChange} onReset={onReset} />,
    ),
  );
  return host;
}

function fieldsetNamed(element: HTMLElement, name: string): HTMLFieldSetElement {
  const hit = [...element.querySelectorAll("fieldset")].find(
    (fieldset) => fieldset.querySelector("legend")?.textContent === name,
  );
  if (hit === undefined) throw new Error(`missing ${name} fieldset`);
  return hit;
}

function setControlValue(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype =
    control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("the temporary Godview surface lab", () => {
  it("turns every exposed value into a live CSS variable", () => {
    const style = godviewTuningStyle({
      ...defaultGodviewTuning(),
      stageOpacity: 73,
      stageBlur: 22,
      paneOpacity: 41,
      blendMode: "lighten",
      canvasOpacity: 88,
      brightness: 112,
      contrast: 93,
      saturation: 76,
    });

    expect(style["--vf-godview-stage-opacity"]).toBe("73%");
    expect(style["--vf-godview-stage-blur"]).toBe("22px");
    expect(style["--vf-godview-pane-opacity"]).toBe("41%");
    expect(style["--vf-godview-terminal-blend-mode"]).toBe("lighten");
    expect(style["--vf-godview-terminal-opacity"]).toBe("0.88");
    expect(style["--vf-godview-terminal-brightness"]).toBe("112%");
    expect(style["--vf-godview-terminal-contrast"]).toBe("93%");
    expect(style["--vf-godview-terminal-saturation"]).toBe("76%");
  });

  it("publishes color, range, and blend edits immediately", () => {
    const onChange = vi.fn();
    const element = mountPanel(onChange);

    const stageOpacity = fieldsetNamed(element, "Stage").querySelector<HTMLInputElement>(
      'input[type="range"]',
    );
    const paneColor = fieldsetNamed(element, "Terminal background").querySelector<HTMLInputElement>(
      'input[type="color"]',
    );
    const blendMode = fieldsetNamed(element, "Terminal canvas").querySelector<HTMLSelectElement>(
      "select",
    );
    if (stageOpacity === null || paneColor === null || blendMode === null) {
      throw new Error("the tuning controls did not render");
    }

    act(() => setControlValue(stageOpacity, "64"));
    act(() => setControlValue(paneColor, "#123456"));
    act(() => setControlValue(blendMode, "overlay"));

    expect(onChange).toHaveBeenCalledWith({ stageOpacity: 64 });
    expect(onChange).toHaveBeenCalledWith({ paneColor: "#123456" });
    expect(onChange).toHaveBeenCalledWith({ blendMode: "overlay" });
  });

  it("resets on demand and collapses without losing the floating handle", () => {
    const onReset = vi.fn();
    const element = mountPanel(vi.fn(), onReset);
    const buttons = [...element.querySelectorAll("button")];
    const reset = buttons.find((button) => button.textContent === "reset");
    const hide = buttons.find((button) => button.textContent === "hide");

    act(() => reset?.click());
    expect(onReset).toHaveBeenCalledOnce();

    act(() => hide?.click());
    expect(element.querySelector("fieldset")).toBeNull();
    const show = [...element.querySelectorAll("button")].find(
      (button) => button.textContent === "show",
    );
    expect(show?.getAttribute("aria-expanded")).toBe("false");
  });
});
