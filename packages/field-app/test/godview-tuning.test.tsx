// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DECK_APPEARANCE,
  type DeckAppearance,
  getDeckAppearance,
  resetDeckAppearanceForTest,
} from "../src/godview/deck-appearance";
import {
  defaultGodviewTuning,
  type GodviewTheme,
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

function mountPanel(
  onChange = vi.fn(),
  onReset = vi.fn(),
  onClose = vi.fn(),
  theme: GodviewTheme = "light",
  appearance: DeckAppearance = DEFAULT_DECK_APPEARANCE,
): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <GodviewTuningPanel
        open
        theme={theme}
        value={defaultGodviewTuning(theme)}
        appearance={appearance}
        // GT-3m folded the monitor's groups into this one instrument. Empty
        // here on purpose: these tests are about the STAGE knobs, and the
        // monitor's own wiring is asserted in godview-monitor.test.tsx.
        monitorSections={[]}
        // GT-3p: no deck has been opened in these cases, which is the state the
        // readout renders as "no deck opened yet" rather than guessing one.
        rendererBackend={null}
        onClose={onClose}
        onThemeChange={vi.fn()}
        onChange={onChange}
        onReset={onReset}
        onResetMonitor={vi.fn()}
      />,
    ),
  );
  return document.body;
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
    expect(style["--vf-godview-bubble-working"]).toBe("#222222");
    // The compositing variables retired with the mechanism they drove: pane
    // transparency is the renderer's background alpha now, so a lab that still
    // published a blend mode would be publishing a knob nothing reads.
    expect(Object.keys(style).filter((key) => key.includes("terminal"))).toEqual([]);
    expect(Object.keys(style)).not.toContain("--vf-godview-pane-opacity");
  });

  it("defaults the stage to the flat Chopsticks reference surface", () => {
    const tuning = defaultGodviewTuning();
    expect(tuning.stageOpacity).toBe(100);
    expect(tuning.stageBlur).toBe(0);
  });

  it("publishes stage edits immediately", () => {
    const onChange = vi.fn();
    const element = mountPanel(onChange);

    const stage = fieldsetNamed(element, "STAGE SURFACE");
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

  it("publishes status-body colors immediately", () => {
    const onChange = vi.fn();
    const element = mountPanel(onChange);
    const colors = fieldsetNamed(element, "BUBBLE COLORS").querySelectorAll<HTMLInputElement>(
      'input[type="color"]',
    );
    const working = colors[1];
    if (working === undefined) throw new Error("the working-fill control did not render");

    act(() => setControlValue(working, "#556677"));

    expect(onChange).toHaveBeenCalledWith({ bubbleWorkingColor: "#556677" });
  });

  it("drives the REAL appearance from the pane slider, not a second copy", () => {
    // The handover, asserted where it could regress: the lab's pane control
    // writes the viewer's appearance store — the same value Settings edits and
    // the deck renders — rather than a memory-only duplicate.
    const onChange = vi.fn();
    const element = mountPanel(onChange);
    const terminal = fieldsetNamed(element, "TERMINAL PANES");
    const paneOpacity = terminal.querySelector<HTMLInputElement>('input[type="range"]');
    const opacityCells = terminal.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (paneOpacity === null || opacityCells === null) {
      throw new Error("the pane appearance controls did not render");
    }

    act(() => setControlValue(paneOpacity, "45"));
    expect(getDeckAppearance().opacity).toBeCloseTo(0.45);

    act(() => opacityCells.click());
    expect(getDeckAppearance().opacityCells).toBe(true);
    // It is NOT the panel's own state: nothing about a pane went through the
    // stage patch channel.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stores a separate terminal color theme for light and dark mode", () => {
    let element = mountPanel();
    let terminal = fieldsetNamed(element, "TERMINAL PANES");
    const lightTheme = terminal.querySelector<HTMLSelectElement>(
      'select[aria-label="Light terminal color theme"]',
    );
    const lightName = lightTheme?.options.item(1)?.value;
    if (lightTheme === null || lightName === undefined || lightName === "") {
      throw new Error("the light color-theme catalog did not render");
    }

    act(() => setControlValue(lightTheme, lightName));
    expect(getDeckAppearance().lightThemeName).toBe(lightName);
    expect(getDeckAppearance().darkThemeName).toBeNull();

    const lightAppearance = getDeckAppearance();
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;

    element = mountPanel(vi.fn(), vi.fn(), vi.fn(), "dark", lightAppearance);
    terminal = fieldsetNamed(element, "TERMINAL PANES");
    const darkTheme = terminal.querySelector<HTMLSelectElement>(
      'select[aria-label="Dark terminal color theme"]',
    );
    const darkName = darkTheme?.options.item(2)?.value;
    if (darkTheme === null || darkName === undefined || darkName === "") {
      throw new Error("the dark color-theme catalog did not render");
    }

    act(() => setControlValue(darkTheme, darkName));
    expect(getDeckAppearance().lightThemeName).toBe(lightName);
    expect(getDeckAppearance().darkThemeName).toBe(darkName);
  });

  it("resets on demand and closes through the reference panel header", () => {
    const onReset = vi.fn();
    const onClose = vi.fn();
    const element = mountPanel(vi.fn(), onReset, onClose);
    const buttons = [...element.querySelectorAll("button")];
    const reset = buttons.find((button) => button.textContent === "RESET DEFAULTS");
    const close = buttons.find(
      (button) => button.getAttribute("aria-label") === "Close system controls",
    );

    act(() => reset?.click());
    expect(onReset).toHaveBeenCalledOnce();

    act(() => close?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
