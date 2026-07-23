import {
  type CanvasEngine,
  DEFAULT_GRID_CONFIG,
  type GridConfig,
  selectedEntities,
  type WidgetType,
} from "@vibecook/ice";
import { attachDevtools, type DevtoolsHandle } from "@vibecook/ice/devtools";
import { useStageHold } from "@vibecook/ice/react";
import { spawnCommentAroundSelection } from "@vibefield/plugin-field-tools";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import {
  type Dispatch,
  type MutableRefObject,
  type ReactElement,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import type { DocManager, DocManagerState } from "../doc-manager";
import { FilePill } from "../hud/FilePill";
import { LoadingVeil } from "../hud/LoadingVeil";
import { NavigationBreadcrumbs } from "../hud/NavigationBreadcrumbs";
import { WidgetTray } from "../hud/WidgetTray";
import { ZoomPill } from "../hud/ZoomPill";
import {
  type OverlapGlowConfig,
  type OverlapGlowThemeColors,
  SettingsPanel,
  type ThemeColors,
} from "../panels";
import {
  DEFAULT_OVERLAP_GLOW,
  DEFAULT_OVERLAP_GLOW_THEME_COLORS,
  DEFAULT_THEME_COLORS,
  fabCls,
  hexToRgb255,
} from "./theme-constants";

// ChromeLayer (§5.4.3): HUD, file pill, the tray (DESIGN.md's bottom toolbar),
// settings, and overlays — WITHOUT owning document or engine lifetime. All the
// chrome-scoped effects live here too: the live theme-token writes, the two
// keyboard additions, the hud-flight dock choreography, the devtools attach,
// and the sheet/loading stage holds. Sheet open/close STATE stays in FieldView
// (the canvas recede transform derives from it in the same render — a
// callback-up would land the recede one frame late).

/** The chrome-owned settings state, bundled so FieldView can thread it to the
 * canvas (grid dot color, ECS profiling) without a dozen loose props. */
export interface ChromeState {
  gridConfig: GridConfig;
  setGridConfig: Dispatch<SetStateAction<GridConfig>>;
  themeColors: ThemeColors;
  setThemeColors: Dispatch<SetStateAction<ThemeColors>>;
  overlapGlow: OverlapGlowConfig;
  setOverlapGlow: Dispatch<SetStateAction<OverlapGlowConfig>>;
  overlapGlowThemeColors: OverlapGlowThemeColors;
  setOverlapGlowThemeColors: Dispatch<SetStateAction<OverlapGlowThemeColors>>;
  showSettings: boolean;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  showEcs: boolean;
  setShowEcs: Dispatch<SetStateAction<boolean>>;
}

export function useChromeState(): ChromeState {
  const [gridConfig, setGridConfig] = useState<GridConfig>({ ...DEFAULT_GRID_CONFIG });
  const [themeColors, setThemeColors] = useState<ThemeColors>(DEFAULT_THEME_COLORS);
  const [overlapGlow, setOverlapGlow] = useState<OverlapGlowConfig>(DEFAULT_OVERLAP_GLOW);
  const [overlapGlowThemeColors, setOverlapGlowThemeColors] = useState<OverlapGlowThemeColors>(
    DEFAULT_OVERLAP_GLOW_THEME_COLORS,
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showEcs, setShowEcs] = useState(false);
  return {
    gridConfig,
    setGridConfig,
    themeColors,
    setThemeColors,
    overlapGlow,
    setOverlapGlow,
    overlapGlowThemeColors,
    setOverlapGlowThemeColors,
    showSettings,
    setShowSettings,
    showEcs,
    setShowEcs,
  };
}

export function ChromeLayer({
  ce,
  manager,
  registry,
  dark,
  onToggleTheme,
  hudMotion,
  docState,
  trayOpen,
  onTrayOpenChange,
  docsOpen,
  onDocsOpenChange,
  chrome,
  devtoolsRef,
}: {
  ce: CanvasEngine;
  manager: DocManager;
  registry: PluginRegistry<WidgetType>;
  dark: boolean;
  onToggleTheme: () => void;
  hudMotion: "out" | "in" | "idle";
  docState: DocManagerState;
  trayOpen: boolean;
  onTrayOpenChange: (open: boolean) => void;
  docsOpen: boolean;
  onDocsOpenChange: (open: boolean) => void;
  chrome: ChromeState;
  devtoolsRef: MutableRefObject<DevtoolsHandle | null>;
}): ReactElement {
  const { themeColors, overlapGlow, overlapGlowThemeColors, showSettings, showEcs } = chrome;

  // The docs sheet + the loading veil quiesce the stage exactly like the tray
  // (WidgetTray holds for itself).
  useStageHold(ce, docsOpen, "docs-explorer");
  useStageHold(ce, docState.phase === "loading", "loading-veil");
  useEffect(() => {
    if (docsOpen) ce.ops.cancelActiveGestures();
  }, [docsOpen, ce]);

  // Theme → live tokens: the settings panel makes DESIGN.md's static defaults
  // dynamic. We write the TOKEN source (--vf-canvas-bg — the widgetlab-compat
  // --canvas-bg alias follows), and CardShell's glow knobs; the rim colors
  // stay tokens.css's .dark-aware defaults. --ic-selection-radius is static in
  // tokens.css (22px, the union-box corner).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--vf-canvas-bg", dark ? themeColors.bgDark : themeColors.bgLight);
    root.style.setProperty(
      "--ic-glow-color",
      hexToRgb255(dark ? overlapGlowThemeColors.glowDark : overlapGlowThemeColors.glowLight),
    );
    root.style.setProperty("--ic-glow-size-c", `${overlapGlow.glowSize[0]}px`);
    root.style.setProperty("--ic-glow-size-t", `${overlapGlow.glowSize[1]}px`);
    root.style.setProperty("--ic-glow-alpha-c", String(overlapGlow.glowAlpha[0]));
    root.style.setProperty("--ic-glow-alpha-t", String(overlapGlow.glowAlpha[1]));
  }, [dark, themeColors, overlapGlow, overlapGlowThemeColors]);

  // Keyboard shortcuts. <InfiniteCanvas> already installs the engine default
  // keymap (⌘Z undo, ⇧⌘Z redo, ⌫ delete, Esc cancel, v/h/c tools — all
  // skipping editable targets). This handler adds ONLY the two pieces the
  // default keymap lacks (widgetlab App law — a duplicate listener would fire
  // engine actions twice):
  //  - Esc exits the current container when nested;
  //  - C with a SELECTION wraps it in a comment (capture phase +
  //    stopPropagation, so the keymap's connect-tool binding never sees it;
  //    with no selection C falls through and stays the tool shortcut — the
  //    widgetlab C/connect collision resolved by "selection decides").
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isEditableTarget(e.target)) return;
      if (ce.nav.depth() > 0) {
        e.preventDefault();
        ce.ops.exitContainer();
      }
    };
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if ((e.key !== "c" && e.key !== "C") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (selectedEntities(ce.world).length === 0) return; // fall through → connect tool
      e.preventDefault();
      e.stopPropagation();
      spawnCommentAroundSelection(ce);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [ce]);

  // ECS devtools while the button is active (v1's EcsDevtools panel slot).
  // The FACADE goes in (not ce.engine): the strata observer's durable tab
  // tracks docs.current() live only through it. The handle also rides the
  // shared ref so CanvasStage's GL profiling callback can feed the HUD lanes.
  useEffect(() => {
    if (!showEcs) return;
    const d = attachDevtools(ce, { presence: () => ce.docs.presence() });
    devtoolsRef.current = d;
    return () => {
      devtoolsRef.current = null;
      d.detach();
    };
  }, [showEcs, ce, devtoolsRef]);

  useLayoutEffect(() => {
    const dock = document.querySelector<HTMLElement>(".ice-dock");
    if (!dock) return;

    dock.classList.add("hud-flight");
    if (hudMotion === "idle") {
      delete dock.dataset.docTransition;
      return;
    }

    if (hudMotion === "out") {
      const rect = dock.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - window.innerWidth / 2;
      const dy = rect.top + rect.height / 2 - window.innerHeight / 2;
      const length = Math.hypot(dx, dy) || 1;
      const distance =
        Math.hypot(window.innerWidth, window.innerHeight) + Math.hypot(rect.width, rect.height);
      dock.style.setProperty("--hud-flight-x", `${(dx / length) * distance}px`);
      dock.style.setProperty("--hud-flight-y", `${(dy / length) * distance}px`);
    }

    dock.dataset.docTransition = hudMotion;
  }, [hudMotion, showEcs]);

  return (
    <>
      {/* Chrome overlays sit OUTSIDE the recede wrapper — they never scale. */}
      <NavigationBreadcrumbs engine={ce} />
      <ZoomPill ce={ce} />
      {/* The file pill (B4): top-center — new doc, the editable name, and the
          morph-open docs explorer. */}
      <FilePill manager={manager} open={docsOpen} onOpenChange={onDocsOpenChange} />
      {/* Dark mode toggle (widgetlab position) — no-drag: it sits in the titlebar strip. */}
      <button
        type="button"
        onClick={onToggleTheme}
        data-hud-flight="top-right"
        className="hud-flight no-drag absolute top-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-500 shadow-lg transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {dark ? (
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />
          </svg>
        )}
      </button>
      <WidgetTray ce={ce} registry={registry} open={trayOpen} onOpenChange={onTrayOpenChange} />

      <button
        type="button"
        onClick={() => chrome.setShowSettings((s) => !s)}
        data-hud-flight="bottom-left"
        className={`hud-flight ${fabCls(showSettings)} bottom-4 left-4`}
        title="Settings"
      >
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-1.5-1H2.5V10h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 4.2l.06.06A1.7 1.7 0 0 0 8.5 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 18.9 9a1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => chrome.setShowEcs((s) => !s)}
        data-hud-flight="bottom-right"
        className={`hud-flight ${fabCls(showEcs)} bottom-4 right-4`}
        title="ICE Devtools"
      >
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m8 2 1.5 2M16 2l-1.5 2M3 13h3M18 13h3M5 7l2 1M19 7l-2 1" />
          <rect x="6" y="5" width="12" height="16" rx="6" />
          <path d="M6 13h12M12 5v16" />
        </svg>
      </button>

      {showSettings && (
        <SettingsPanel
          engine={ce}
          gridConfig={chrome.gridConfig}
          onGridChange={chrome.setGridConfig}
          themeColors={themeColors}
          onThemeColorsChange={chrome.setThemeColors}
          overlapGlow={overlapGlow}
          onOverlapGlowChange={chrome.setOverlapGlow}
          overlapGlowThemeColors={overlapGlowThemeColors}
          onOverlapGlowThemeColorsChange={chrome.setOverlapGlowThemeColors}
          stressWidgetType="vibefield.widgetlab.clock"
          onClose={() => chrome.setShowSettings(false)}
        />
      )}

      {/* The loading veil rides ABOVE all chrome — loading is modal (B4 §2). */}
      <LoadingVeil loading={docState.loading} />
    </>
  );
}
