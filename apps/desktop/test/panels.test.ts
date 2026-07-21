// @vitest-environment happy-dom
/**
 * Smoke tests for the remaining canvas chrome. Each mounts against a REAL
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
import { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { NavigationBreadcrumbs } from "../renderer/src/hud/NavigationBreadcrumbs";
import {
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
    // SystemSection (diagnostics live inside Settings) reads the fieldd hooks —
    // a provider with a never-connected client renders the honest idle state.
    const client = new FielddClient({ url: "ws://127.0.0.1:1", token: "test" });
    mount(
      createElement(
        FielddProvider,
        { client },
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
      ),
    );

    expect(container?.textContent).toContain("Settings");
    expect(container?.textContent).toContain("Grid Spacings");
    expect(container?.textContent).toContain("Zoom Range");
    // The System diagnostics section renders inside the panel (2026-07-21 law).
    expect(container?.textContent).toContain("System");
    expect(container?.textContent).toContain("connection");
    // C4: the Mesh section is a sibling of System; its device roster renders the
    // honest empty state for the never-connected client here (the subscription
    // sits in loading — no data, no error — so "no devices yet").
    expect(container?.textContent).toContain("Mesh");
    expect(container?.textContent).toContain("devices");
    expect(container?.textContent).toContain("no devices yet");
    // B3: the board-persistence row (module store; "booting" pre-attach).
    expect(container?.textContent).toContain("board");
    // Controlled: the grid inputs render (a spacing value from the default cfg).
    const numberInputs = container?.querySelectorAll('input[type="number"]');
    expect(numberInputs?.length ?? 0).toBeGreaterThan(0);
    // Stress buttons are disabled without a stressWidgetType.
    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    const stress = buttons.find((b) => b.textContent === "+50");
    expect(stress?.disabled).toBe(true);
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
