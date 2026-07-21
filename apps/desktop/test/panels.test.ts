// @vitest-environment happy-dom
/**
 * Smoke test for the three ported chrome panels. Each mounts against a REAL
 * `createCanvasEngine()`, survives engine steps, and unmounts cleanly.
 * `createElement` (not JSX) keeps this a `.ts` file. No `EngineProvider`: the
 * panels take the engine as a prop and read it directly (no `@ice/react` hooks).
 *
 * DOC-LESS by design: this app's standalone `vitest.config.ts` does not inherit
 * vite.config's `loro-crdt → loro-crdt/base64` alias, so `docs.create()` would
 * build a `LoroDoc` from the wrong loro build and throw. Doc-less construction
 * never touches loro at runtime, and the panels handle the doc-less case
 * (undo-status resource absent ⇒ flags false). The environment is happy-dom
 * (vitest.config + the docblock pragma above); the JSX transform for the `.tsx`
 * panels comes from vitest.config's `esbuild.jsx: "automatic"`.
 */
import { type CanvasEngine, createCanvasEngine, DEFAULT_GRID_CONFIG } from "@vibecook/ice";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { NavigationBreadcrumbs } from "../renderer/src/hud/NavigationBreadcrumbs";
import {
  InspectorPanel,
  type OverlapGlowConfig,
  type OverlapGlowThemeColors,
  SettingsPanel,
  type ThemeColors,
} from "../renderer/src/panels";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THEME: ThemeColors = {
  dotLight: "#c0c0c0",
  dotDark: "#333333",
  bgLight: "#fafafa",
  bgDark: "#171717",
};
const GLOW: OverlapGlowConfig = {
  glowColor: [0.5, 0.5, 0.5],
  glowAlpha: [0.25, 0.45],
  glowSize: [60, 80],
  rimColor: [0.5, 0.5, 0.5],
  rimWidth: 1.5,
  rimAlpha: [0.55, 0.85],
  rimRadius: 600,
};
const GLOW_THEME: OverlapGlowThemeColors = {
  glowLight: "#808080",
  glowDark: "#ffffff",
  rimLight: "#808080",
  rimDark: "#ffffff",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let disposeEngine: (() => void) | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  disposeEngine?.();
  disposeEngine = null;
  document.body.innerHTML = "";
});

function makeEngine(): CanvasEngine {
  const engine = createCanvasEngine({});
  disposeEngine = () => engine.dispose();
  return engine;
}

function mount(node: ReactElement): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
}

describe("widgetlab panels", () => {
  it("SettingsPanel mounts with controlled grid/theme/glow props", () => {
    const engine = makeEngine();
    let grid = DEFAULT_GRID_CONFIG;
    mount(
      createElement(SettingsPanel, {
        engine,
        gridConfig: grid,
        onGridChange: (g) => {
          grid = g;
        },
        themeColors: THEME,
        onThemeColorsChange: () => {},
        overlapGlow: GLOW,
        onOverlapGlowChange: () => {},
        overlapGlowThemeColors: GLOW_THEME,
        onOverlapGlowThemeColorsChange: () => {},
        onClose: () => {},
      }),
    );

    expect(container?.textContent).toContain("Settings");
    expect(container?.textContent).toContain("Grid Spacings");
    expect(container?.textContent).toContain("Zoom Range");
    // Controlled: the grid inputs render (a spacing value from the default cfg).
    const numberInputs = container?.querySelectorAll('input[type="number"]');
    expect(numberInputs?.length ?? 0).toBeGreaterThan(0);
    // Stress buttons are disabled without a stressWidgetType.
    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    const stress = buttons.find((b) => b.textContent === "+50");
    expect(stress?.disabled).toBe(true);
  });

  it("InspectorPanel mounts, reads metrics, and survives engine steps", () => {
    const engine = makeEngine();
    mount(createElement(InspectorPanel, { engine, onClose: () => {} }));

    expect(container?.textContent).toContain("Inspector");
    expect(container?.textContent).toContain("ECS");
    expect(container?.textContent).toContain("entities");
    expect(container?.textContent).toContain("world tick");

    // Stepping the engine with the panel mounted must not throw.
    act(() => {
      let now = 0;
      for (let i = 0; i < 4; i++) {
        now += 16;
        engine.step(now);
      }
    });
    expect(container?.textContent).toContain("Navigation");
  });

  it("NavigationBreadcrumbs renders the root state at depth 0", () => {
    const engine = makeEngine();
    mount(createElement(NavigationBreadcrumbs, { engine }));

    // Root crumb present; back button disabled at the root of the nav stack.
    expect(container?.textContent).toContain("Root");
    const back = container?.querySelector("button") as HTMLButtonElement | null;
    expect(back).not.toBeNull();
    expect(back?.disabled).toBe(true);
  });
});
