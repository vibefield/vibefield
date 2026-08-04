// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DECK_APPEARANCE,
  getDeckAppearance,
  resetDeckAppearanceForTest,
} from "../src/godview/deck-appearance";
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
  resetDeckAppearanceForTest();
});

function mountPanel(onChange = vi.fn(), onReset = vi.fn()): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <GodviewTuningPanel
        value={defaultGodviewTuning()}
        appearance={DEFAULT_DECK_APPEARANCE}
        onChange={onChange}
        onReset={onReset}
      />,
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
  it("projects the stage values it still owns, and nothing else", () => {
    const style = godviewTuningStyle({
      ...defaultGodviewTuning(),
      stageOpacity: 73,
      stageBlur: 22,
    });

    expect(style["--vf-godview-stage-opacity"]).toBe("73%");
    expect(style["--vf-godview-stage-blur"]).toBe("22px");
    // The compositing variables retired with the mechanism they drove: pane
    // transparency is the renderer's background alpha now, so a lab that still
    // published a blend mode would be publishing a knob nothing reads.
    expect(Object.keys(style).filter((key) => key.includes("terminal"))).toEqual([]);
    expect(Object.keys(style)).not.toContain("--vf-godview-pane-opacity");
  });

  it("defaults the stage to DESIGN.md §5's Sheet tier", () => {
    const tuning = defaultGodviewTuning();
    expect(tuning.stageOpacity).toBe(90);
    expect(tuning.stageBlur).toBe(64);
  });

  it("publishes stage edits immediately", () => {
    const onChange = vi.fn();
    const element = mountPanel(onChange);

    const stage = fieldsetNamed(element, "Stage");
    const stageOpacity = stage.querySelector<HTMLInputElement>('input[type="range"]');
    const stageColor = stage.querySelector<HTMLInputElement>('input[type="color"]');
    if (stageOpacity === null || stageColor === null) {
      throw new Error("the tuning controls did not render");
    }

    act(() => setControlValue(stageOpacity, "64"));
    act(() => setControlValue(stageColor, "#123456"));

    expect(onChange).toHaveBeenCalledWith({ stageOpacity: 64 });
    expect(onChange).toHaveBeenCalledWith({ stageColor: "#123456" });
  });

  it("drives the REAL appearance from the pane slider, not a second copy", () => {
    // The handover, asserted where it could regress: the lab's pane control
    // writes the viewer's appearance store — the same value Settings edits and
    // the deck renders — rather than a memory-only duplicate.
    const onChange = vi.fn();
    const element = mountPanel(onChange);
    const paneOpacity = fieldsetNamed(element, "Terminal panes").querySelector<HTMLInputElement>(
      'input[type="range"]',
    );
    if (paneOpacity === null) throw new Error("the pane opacity control did not render");

    act(() => setControlValue(paneOpacity, "45"));

    expect(getDeckAppearance().opacity).toBeCloseTo(0.45);
    // It is NOT the panel's own state: nothing about a pane went through the
    // stage patch channel.
    expect(onChange).not.toHaveBeenCalled();
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
