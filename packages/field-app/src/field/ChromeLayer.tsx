import type { CanvasEngine, WidgetType } from "@vibecook/ice";
import { attachDevtools, type DevtoolsHandle } from "@vibecook/ice/devtools";
import { useFrameFreeze, useStageHold } from "@vibecook/ice/react";
import type { DesktopShellState } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import {
  type Dispatch,
  type MutableRefObject,
  type ReactElement,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MeMenu } from "../account/MeMenu";
import { isSwitchCovering, useSwitchState } from "../boot/switch";
import type { DocManager, DocManagerState } from "../doc-manager";
import { foldSurface, type LineSurface } from "../frame/line-surface";
import { ViewFrame } from "../frame/ViewFrame";
import { requestView, useCovered } from "../frame/view-state";
import { GodviewOverlay } from "../godview";
import { getHost } from "../host";
import { CommandPalette } from "../hud/CommandPalette";
import { ClipboardTray } from "../hud/edge-tray/EdgeTray";
import { FilePill } from "../hud/FilePill";
import { LoadingVeil } from "../hud/LoadingVeil";
import { NavigationBreadcrumbs } from "../hud/NavigationBreadcrumbs";
import { PluginSurfaceHost, useVisiblePluginSurfaces } from "../hud/PluginSurfaceSlot";
import { SidePanelStage, SidePanelToggle } from "../hud/SidePanelStage";
import { WidgetTray } from "../hud/WidgetTray";
import { ZoomPill } from "../hud/ZoomPill";
import { SettingsPanel } from "../panels";
import { ThemeToggleButton } from "../ThemeToggleButton";
import type { MagnetGridGlyph } from "./canvas-appearance";
import { useMeMenuYields, useSettingsChord } from "./me-menu-wiring";
import { isCommandPaletteChord, listenForProductChord } from "./product-chords";
import { INITIAL_SHELL_PRESENTATION, reduceShellPresentation } from "./shell-presentation";
import { fabCls } from "./theme-constants";
import { useMagnetGridGlyph } from "./use-magnet-grid-glyph";

// ChromeLayer (§5.4.3): HUD, file pill, Objects' sheet (behind the line),
// settings, and overlays — WITHOUT owning document or engine lifetime. All the
// chrome-scoped effects live here too: the live theme-token writes, the two
// keyboard additions, the hud-flight dock choreography, the devtools attach,
// and the sheet/loading stage holds. Sheet open/close STATE stays in FieldView
// (the canvas recede transform derives from it in the same render — a
// callback-up would land the recede one frame late).

// §13.1 windowId: the renderer has no per-window identity yet (v1 is one field
// window). A stable constant names it honestly; the id becomes real when
// multi-window lands (recorded delta).
export const FIELD_WINDOW_ID = "field";

/** Chrome-only state shared with FieldView's sheet/recede choreography. */
export interface ChromeState {
  showSettings: boolean;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  showEcs: boolean;
  setShowEcs: Dispatch<SetStateAction<boolean>>;
  magnetGridGlyph: MagnetGridGlyph;
  setMagnetGridGlyph: (glyph: MagnetGridGlyph) => void;
}

export function useChromeState(): ChromeState {
  const [showSettings, setShowSettings] = useState(false);
  const [showEcs, setShowEcs] = useState(false);
  const { magnetGridGlyph, setMagnetGridGlyph } = useMagnetGridGlyph();
  return {
    showSettings,
    setShowSettings,
    showEcs,
    setShowEcs,
    magnetGridGlyph,
    setMagnetGridGlyph,
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
  lineSurface,
  onLineSurfaceChange,
  docsOpen,
  onDocsOpenChange,
  appearanceControlledByStudio,
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
  /** The line's open surface (One Frame FR-2/FR-4) and its one owner's
   * setter — FieldView's, where Objects' recede is computed. */
  lineSurface: LineSurface | null;
  onLineSurfaceChange: (next: LineSurface | null) => void;
  docsOpen: boolean;
  onDocsOpenChange: (open: boolean) => void;
  appearanceControlledByStudio: boolean;
  chrome: ChromeState;
  devtoolsRef: MutableRefObject<DevtoolsHandle | null>;
}): ReactElement {
  const { showSettings, setShowSettings, showEcs } = chrome;
  // Objects, on this build: the widget tray's sheet behind the line.
  const trayOpen = lineSurface === "objects";
  const lineOpen = lineSurface !== null;
  const [paletteOpen, setPaletteOpen] = useState(false);
  // UA-D19 — the Me menu. One of the expanded surfaces: opening it folds the
  // others, and any of them opening folds it (DESIGN.md §8).
  const [meOpen, setMeOpen] = useState(false);
  const [shellPresentation, setShellPresentation] = useState(INITIAL_SHELL_PRESENTATION);
  const [desktopState, setDesktopState] = useState<DesktopShellState | null>(null);
  const sidePanelSurfaces = useVisiblePluginSurfaces("hud.side-panel");
  const sidePanelSurface = sidePanelSurfaces[0] ?? null;
  const [sidePanelSurfaceId, setSidePanelSurfaceId] = useState<string | null>(null);
  const sidePanelToggleRef = useRef<HTMLButtonElement | null>(null);
  const activeSidePanel =
    sidePanelSurface?.surfaceId === sidePanelSurfaceId ? sidePanelSurface : null;
  // Whether a view covers the field (One Frame FR-1): every view but the
  // canvas. The window's view is main's (one owner); this is its mirror.
  const covered = useCovered();

  const closeSidePanel = useCallback((returnFocus: boolean) => {
    setSidePanelSurfaceId(null);
    if (returnFocus) {
      window.setTimeout(() => sidePanelToggleRef.current?.focus(), 0);
    }
  }, []);

  const toggleSidePanel = useCallback(() => {
    if (sidePanelSurface === null) return;
    if (sidePanelSurfaceId === sidePanelSurface.surfaceId) {
      closeSidePanel(true);
      return;
    }
    const reveal = () => {
      onLineSurfaceChange(null);
      onDocsOpenChange(false);
      setShowSettings(false);
      setPaletteOpen(false);
      setSidePanelSurfaceId(sidePanelSurface.surfaceId);
    };
    // The Artifact panel is the canvas's chrome: back to the canvas first.
    if (covered) {
      void requestView("canvas").then(reveal);
      return;
    }
    reveal();
  }, [
    closeSidePanel,
    covered,
    onDocsOpenChange,
    onLineSurfaceChange,
    setShowSettings,
    sidePanelSurface,
    sidePanelSurfaceId,
  ]);

  // Disable/unbind removes both stage and toggle in one render. An existing
  // toggle receives focus only while it still exists (§13.2).
  useEffect(() => {
    if (
      sidePanelSurfaceId !== null &&
      !sidePanelSurfaces.some((surface) => surface.surfaceId === sidePanelSurfaceId)
    ) {
      setSidePanelSurfaceId(null);
    }
  }, [sidePanelSurfaceId, sidePanelSurfaces]);

  /** Settings, on the page asked for — the Me menu's Settings… and ⌘, open
   * General; its name row and its Link… open Account (UA-D19). */
  const openSettings = useCallback(
    (page: "general" | "account") => {
      setShellPresentation((state) => ({ ...state, target: page }));
      onLineSurfaceChange(null);
      onDocsOpenChange(false);
      setPaletteOpen(false);
      closeSidePanel(false);
      setMeOpen(false);
      setShowSettings(true);
    },
    [closeSidePanel, onDocsOpenChange, onLineSurfaceChange, setShowSettings],
  );

  const onMeOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onLineSurfaceChange(null);
        onDocsOpenChange(false);
        setPaletteOpen(false);
        closeSidePanel(false);
        setShowSettings(false);
      }
      setMeOpen(open);
    },
    [closeSidePanel, onDocsOpenChange, onLineSurfaceChange, setShowSettings],
  );

  const foldMe = useCallback(() => setMeOpen(false), []);
  useMeMenuYields(
    meOpen,
    lineOpen || docsOpen || showSettings || paletteOpen || covered || sidePanelSurfaceId !== null,
    foldMe,
  );

  // Expanded focus surfaces remain exclusive. The Artifact panel itself is
  // non-modal, so this arbitration does not recede or hold the canvas.
  useEffect(() => {
    if (
      sidePanelSurfaceId !== null &&
      (lineOpen || docsOpen || showSettings || paletteOpen || covered)
    ) {
      closeSidePanel(false);
    }
  }, [closeSidePanel, covered, docsOpen, lineOpen, paletteOpen, showSettings, sidePanelSurfaceId]);

  useEffect(() => {
    if (activeSidePanel === null) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSidePanel(true);
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [activeSidePanel, closeSidePanel]);

  useEffect(() => {
    const onShellCommand = getHost().onShellCommand;
    if (onShellCommand === undefined) return;
    return onShellCommand((command) => {
      setShellPresentation((state) => reduceShellPresentation(state, command));
      onLineSurfaceChange(null);
      onDocsOpenChange(false);
      setPaletteOpen(false);
      closeSidePanel(false);
      setShowSettings(true);
    });
  }, [closeSidePanel, setShowSettings, onLineSurfaceChange, onDocsOpenChange]);

  useEffect(() => {
    const onDesktopState = getHost().onDesktopState;
    if (onDesktopState === undefined) return;
    return onDesktopState(setDesktopState);
  }, []);

  // The docs sheet + the loading veil quiesce the stage exactly like the tray
  // (WidgetTray holds for itself).
  useStageHold(ce, docsOpen, "docs-explorer");
  useStageHold(ce, showSettings, "settings-panel");
  useStageHold(ce, docState.phase === "loading", "loading-veil");
  // A covered view gets the STRICTER gate (ice 0.3.0). A stage hold is
  // presentation policy over a world that keeps stepping — right for the
  // sheets above, which recede a canvas that stays visible behind them. But
  // the cover (One Frame FR-1 — Godview, History) is over the field, so the
  // engine would still tick at display rate for pixels only its glass lets
  // through: the hold quiets the GL compositor and nothing else. A freeze parks
  // the loop outright — no step, no systems, no notify, no reflectors, no rAF —
  // after walking a settle so the frozen image is whole (DESIGN.md §6: the
  // field recedes and freezes). Thaw drops the input banked behind the cover
  // and resumes on a clamped dt, so nothing teleports.
  useFrameFreeze(ce, covered, "cover");
  // The switch covers the window too (DESIGN.md §8): the field it leaves is
  // frozen whole under the frost, and thaws if a refused switch hands it back.
  const switchCovering = isSwitchCovering(useSwitchState());
  useFrameFreeze(ce, switchCovering, "user-switch");
  useEffect(() => {
    if (docsOpen || showSettings) ce.ops.cancelActiveGestures();
  }, [docsOpen, showSettings, ce]);

  // Keyboard shortcuts. <InfiniteCanvas> already installs the engine default
  // keymap (⌘Z undo, ⇧⌘Z redo, ⌫ delete, Esc cancel, v/h/c tools — all
  // skipping editable targets), and since ice 0.4.0 the C-with-selection
  // behavior rides the keymap's OWN override surface (field-keymap.ts, wired
  // through CanvasStage) — the capture-phase stopPropagation trap this layer
  // carried retired with petition I1. This handler adds ONLY the one piece the
  // default keymap lacks (widgetlab App law — a duplicate listener would fire
  // engine actions twice): Esc exits the current container when nested.
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (showSettings) return;
      if (e.key !== "Escape" || isEditableTarget(e.target)) return;
      if (ce.nav.depth() > 0) {
        e.preventDefault();
        ce.ops.exitContainer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [ce, showSettings]);

  // ⌘K / Ctrl+K toggles the command palette (§8.3). ⌘K is free — the ICE keymap
  // and the line's B and the tray's Esc never claim it. Opening it folds the
  // line's surfaces and the docs sheet (one modal at a time — the FieldView
  // mutual-exclusion rule).
  // GT-D21: caught in the window's capture phase, so a focused Godview pane
  // (whose Ghostty default for ⌘K is clear_screen) never sees it.
  useEffect(
    () =>
      listenForProductChord(isCommandPaletteChord, () => {
        setPaletteOpen((v) => {
          const next = !v;
          if (next) {
            onLineSurfaceChange(null);
            onDocsOpenChange(false);
            setShowSettings(false);
            closeSidePanel(false);
          }
          return next;
        });
      }),
    [closeSidePanel, onLineSurfaceChange, onDocsOpenChange, setShowSettings],
  );

  // ⌘, / Ctrl+, — Settings from anywhere (DESIGN.md §8, the Me menu).
  const openGeneralSettings = useCallback(() => openSettings("general"), [openSettings]);
  const closeSettings = useCallback(() => setShowSettings(false), [setShowSettings]);
  useSettingsChord(showSettings, openGeneralSettings, closeSettings);

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
      {/* The file pill (B4): top-center — new doc, the editable name, and the
          morph-open docs explorer. */}
      <FilePill manager={manager} open={docsOpen} onOpenChange={onDocsOpenChange} />
      {/* DESIGN §8: one no-drag top-right cluster. Artifact is outermost so its
          control stays physically attached to the edge it opens from. */}
      <div
        data-hud-flight="top-right"
        className="hud-flight no-drag absolute top-4 right-4 z-50 flex items-center gap-2"
      >
        <ZoomPill ce={ce} />
        <ThemeToggleButton dark={dark} onToggle={onToggleTheme} />
        {sidePanelSurface !== null && (
          <SidePanelToggle
            entry={sidePanelSurface}
            active={activeSidePanel !== null}
            buttonRef={sidePanelToggleRef}
            onToggle={toggleSidePanel}
          />
        )}
      </div>

      <SidePanelStage
        entry={activeSidePanel}
        windowId={FIELD_WINDOW_ID}
        onClose={() => closeSidePanel(true)}
      />

      {/* The clipboard tray (SNAP-3, DESIGN.md §8 edge trays): the notch at
          the left edge's mid-height and the drawer behind it. Non-modal like
          the Artifact panel, and self-governing — its hover, pin and keyboard
          grammar live in the controller; it joins no exclusivity here. */}
      <ClipboardTray />

      {/* hud.attention (§8.4): the top-right attention stack, below the theme
          fab. pointer-events-none wrapper so an empty slot never blocks the
          canvas; the host restores pointer-events on its own content. */}
      <div
        data-hud-flight="top-right"
        className="hud-flight pointer-events-none absolute top-16 z-40 flex w-72 max-w-[80vw] flex-col transition-[right] duration-300"
        style={{ right: activeSidePanel === null ? "1rem" : "calc(min(92vw, 26rem) + 1rem)" }}
      >
        <PluginSurfaceHost slot="hud.attention" windowId={FIELD_WINDOW_ID} />
      </div>

      {/* Objects (One Frame FR-2, DK-D29): the old tray's SHEET, risen behind
          the line by the line's create or B; its island is gone, so the
          line's ⊕ is its only door until the pegboard replaces it (DK-13). */}
      <WidgetTray
        ce={ce}
        registry={registry}
        open={trayOpen}
        onOpenChange={(open) =>
          onLineSurfaceChange(open ? "objects" : foldSurface(lineSurface, "objects"))
        }
      />

      {/* UA-D19 — the owner's face, where the Settings gear was: the account's
          one door, and the menu grows out of it (DESIGN.md §8). Placed so the
          40px face sits exactly where the 40px gear did. Open, it still grows
          up and right around the face, over the views track's left end — so it
          stands above the frame (62, One Frame FR-1) until FR-4 opens it above
          the line instead; its rows are never under the track. (Godview's
          button beside it retired with FR-1: the views track is the way in.) */}
      <div
        data-hud-flight="bottom-left"
        className={`hud-flight no-drag absolute bottom-[14px] left-[14px] ${meOpen ? "z-[63]" : "z-50"}`}
      >
        <MeMenu
          open={meOpen}
          onOpenChange={onMeOpenChange}
          onOpenSettings={openSettings}
          shortcut={getHost().platform === "darwin" ? "⌘," : "Ctrl+,"}
        />
      </div>
      <button
        type="button"
        onClick={() => chrome.setShowEcs((s) => !s)}
        data-hud-flight="bottom-right"
        className={`hud-flight ${fabCls(showEcs)} bottom-4`}
        style={{ right: activeSidePanel === null ? "1rem" : "calc(min(92vw, 26rem) + 1rem)" }}
        title="ICE Devtools"
      >
        <FieldGlyph name="bug" size={20} />
      </button>

      {showSettings && (
        <SettingsPanel
          engine={ce}
          stressWidgetType="vibefield.widgetlab.clock"
          platform={getHost().platform ?? "other"}
          desktopState={desktopState}
          dark={dark}
          onToggleTheme={onToggleTheme}
          magnetGridGlyph={chrome.magnetGridGlyph}
          onMagnetGridGlyphChange={chrome.setMagnetGridGlyph}
          appearanceControlledByStudio={appearanceControlledByStudio}
          diagnosticsRequest={shellPresentation.diagnosticsRequest}
          diagnosticsInitiallyOpen={shellPresentation.target === "diagnostics"}
          initialPage={shellPresentation.target === "account" ? "account" : "general"}
          onClose={() => {
            setShellPresentation((state) => ({ ...state, target: "general" }));
            setShowSettings(false);
          }}
        />
      )}

      {/* hud.panel (§8.4): the bottom-anchored panel area, above the Me menu's
          face, clear of the line. Empty → invisible (host null). */}
      <div
        data-hud-flight="bottom-left"
        className="hud-flight pointer-events-none absolute bottom-20 left-4 z-40 flex w-72 max-w-[80vw] flex-col"
      >
        <PluginSurfaceHost slot="hud.panel" windowId={FIELD_WINDOW_ID} />
      </div>

      {/* The ⌘K command palette (§8.3) — a floating overlay above the field
          chrome, below the modal loading veil. */}
      <CommandPalette
        ce={ce}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        windowId={FIELD_WINDOW_ID}
      />

      {/* THE FRAME (One Frame FR-1, DESIGN.md §10): the cover the covered views
          live in — Godview, History — over every piece of the canvas's own
          chrome, and the views track standing above the cover. Below Settings,
          the palette and the loading veil: a document that is still opening
          owns the window more than any view does. */}
      <ViewFrame
        godview={<GodviewOverlay />}
        surface={lineSurface}
        onSurfaceChange={onLineSurfaceChange}
      />

      {/* The loading veil rides ABOVE all chrome — loading is modal (B4 §2). */}
      <LoadingVeil loading={docState.loading} />
    </>
  );
}
