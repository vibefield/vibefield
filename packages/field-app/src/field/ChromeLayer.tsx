import type { CanvasEngine, WidgetType } from "@vibecook/ice";
import { attachDevtools, type DevtoolsHandle } from "@vibecook/ice/devtools";
import { useFrameFreeze, useStageHold } from "@vibecook/ice/react";
import type { DesktopShellState } from "@vibefield/contracts";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import {
  type Dispatch,
  type MutableRefObject,
  type ReactElement,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MeMenu } from "../account/MeMenu";
import { isSwitchCovering, useSwitchState } from "../boot/switch";
import type { DocManager, DocManagerState } from "../doc-manager";
import type { LineActs } from "../frame/Composer";
import { type FrameSurface, foldSurface } from "../frame/frame-surface";
import { Head } from "../frame/Head";
import { canvasHead } from "../frame/head-canvas";
import type { FrameActRun } from "../frame/palette-acts";
import { ViewFrame } from "../frame/ViewFrame";
import { requestView, subscribeMenuZoom, useActiveView } from "../frame/view-state";
import { viewKeysOf } from "../frame/views";
import { runZoom } from "../frame/zoom";
import { GodviewOverlay } from "../godview";
import { HistoryView } from "../history/HistoryView";
import { getHost } from "../host";
import { CommandPalette } from "../hud/CommandPalette";
import { ArtifactsTray, ClipboardTray } from "../hud/edge-tray/EdgeTray";
import { LoadingVeil } from "../hud/LoadingVeil";
import { PluginSurfaceHost } from "../hud/PluginSurfaceSlot";
import { WidgetTray } from "../hud/WidgetTray";
import { SettingsPanel } from "../panels";
import type { MagnetGridGlyph } from "./canvas-appearance";
import { useSettingsChord } from "./me-menu-wiring";
import { isCommandPaletteChord, listenForProductChord } from "./product-chords";
import { INITIAL_SHELL_PRESENTATION, reduceShellPresentation } from "./shell-presentation";
import { useMagnetGridGlyph } from "./use-magnet-grid-glyph";

// ChromeLayer (§5.4.3): the head, Objects' sheet (behind the line), the
// edges, the corner, settings, and overlays — WITHOUT owning document or
// engine lifetime. All the chrome-scoped effects live here too: the two
// keyboard additions, the hud-flight dock choreography, the devtools attach,
// and the sheet/loading stage holds. Sheet open/close STATE stays in FieldView
// (the canvas recede transform derives from it in the same render — a
// callback-up would land the recede one frame late). The theme is not here:
// it has one owner, main's, and `theme.ts` is its mirror (One Frame FC-D5).

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
  hudMotion,
  docState,
  surface,
  onSurfaceChange,
  appearanceControlledByStudio,
  chrome,
  devtoolsRef,
}: {
  ce: CanvasEngine;
  manager: DocManager;
  registry: PluginRegistry<WidgetType>;
  hudMotion: "out" | "in" | "idle";
  docState: DocManagerState;
  /** The frame's open surface (One Frame FR-2/FR-3/FR-4) and its one owner's
   * setter — FieldView's, where Objects' and the explorer's recede is
   * computed. */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  appearanceControlledByStudio: boolean;
  chrome: ChromeState;
  devtoolsRef: MutableRefObject<DevtoolsHandle | null>;
}): ReactElement {
  const { showSettings, setShowSettings, showEcs } = chrome;
  // Objects, on this build: the widget tray's sheet behind the line.
  const trayOpen = surface === "objects";
  const docsOpen = surface === "fields";
  const paletteOpen = surface === "palette";
  // UA-D19 — the Me menu: one of the frame's open surfaces since FR-4, so the
  // one owner folds it when any other opens, and it folds them (DESIGN.md §10).
  const meOpen = surface === "me";
  const [shellPresentation, setShellPresentation] = useState(INITIAL_SHELL_PRESENTATION);
  const [desktopState, setDesktopState] = useState<DesktopShellState | null>(null);
  // Artifacts' drawer is open (One Frame FR-4): the attention stack steps
  // clear of it, as it stepped clear of the side panel.
  const artifactsOpen = surface === "artifacts";
  // Whether a view covers the field (One Frame FR-1): every view but the
  // canvas. The window's view is main's (one owner); this is its mirror.
  const view = useActiveView();
  const covered = view !== "canvas";
  const [keys] = useState(() => viewKeysOf(getHost().platform));
  // The head's door over this engine (its path and its zoom), and where the
  // line lends the palette its create (One Frame FR-3).
  const head = useMemo(() => canvasHead(ce), [ce]);
  const lineActs = useRef<LineActs | null>(null);
  // History's view in the frame's cover (AR-8c): rosetta's room over this
  // window's fieldd client, told whether it is the view showing.
  const historyView = useCallback((active: boolean) => <HistoryView active={active} />, []);

  /** Settings, on the page asked for — the Me menu's Settings… and ⌘, open
   * General; its name row and its Link… open Account (UA-D19). */
  const openSettings = useCallback(
    (page: "general" | "account") => {
      setShellPresentation((state) => ({ ...state, target: page }));
      onSurfaceChange(null);
      setShowSettings(true);
    },
    [onSurfaceChange, setShowSettings],
  );

  // Opening it is asking the owner (which folds Settings and every other
  // surface); a fold of its own leaves the others alone.
  const onMeOpenChange = useCallback(
    (open: boolean) => onSurfaceChange(open ? "me" : foldSurface(surface, "me")),
    [onSurfaceChange, surface],
  );

  useEffect(() => {
    const onShellCommand = getHost().onShellCommand;
    if (onShellCommand === undefined) return;
    return onShellCommand((command) => {
      setShellPresentation((state) => reduceShellPresentation(state, command));
      onSurfaceChange(null);
      setShowSettings(true);
    });
  }, [setShowSettings, onSurfaceChange]);

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

  // ⌘K / Ctrl+K toggles the command palette (§8.3; One Frame §7). ⌘K is free —
  // the ICE keymap, the line's B and the tray's Esc never claim it. The palette
  // is one of the frame's surfaces, so opening it folds whichever was open —
  // the drawers and the Me menu included — and the owner folds Settings.
  // GT-D21: caught in the window's capture phase, so a focused Godview pane
  // (whose Ghostty default for ⌘K is clear_screen) never sees it.
  useEffect(
    () =>
      listenForProductChord(isCommandPaletteChord, () => {
        if (surface === "palette") {
          onSurfaceChange(null);
          return;
        }
        onSurfaceChange("palette");
      }),
    [onSurfaceChange, surface],
  );

  // The palette's frame acts, run through the frame's own doors: the view's
  // one owner, the line's create, the head's zoom, Settings.
  const runFrameAct = useCallback(
    (run: FrameActRun) => {
      switch (run.kind) {
        case "view":
          void requestView(run.view);
          return;
        case "create":
          lineActs.current?.create();
          return;
        case "zoom":
          runZoom(head, run.act);
          return;
        case "settings":
          openSettings("general");
      }
    },
    [head, openSettings],
  );
  const closePalette = useCallback(
    () => onSurfaceChange(foldSurface(surface, "palette")),
    [onSurfaceChange, surface],
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
      {/* THE HEAD (One Frame FR-3, DESIGN.md §8 "The head"): the field's name
          pill with the crumbs folded in, which grows the fields explorer, and
          the zoom readout — alone at the right since FR-4 took the theme into
          the Me menu and Artifacts behind the right notch. Still the canvas's
          chrome: under the cover. */}
      <Head
        manager={manager}
        canvas={head}
        view={view}
        keys={keys}
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        menuZoom={subscribeMenuZoom}
      />

      {/* THE EDGES (SNAP-3; One Frame FR-4, DESIGN.md §8 edge trays, §10): the
          clipboard's notch on the left and Artifacts' on the right — its
          drawer the Artifact Hub, the side panel's contents — each a notch at
          mid-edge with its drawer behind it. The frame's, not the canvas's:
          they stand above the cover in every view, resting there as slivers,
          and each drawer is one of the frame's open surfaces. */}
      <ClipboardTray surface={surface} onSurfaceChange={onSurfaceChange} sliver={covered} />
      <ArtifactsTray
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        sliver={covered}
        windowId={FIELD_WINDOW_ID}
      />

      {/* hud.attention (§8.4): the top-right attention stack, under the head.
          pointer-events-none wrapper so an empty slot never blocks the
          canvas; the host restores pointer-events on its own content. It
          steps clear of Artifacts' drawer while that is open. */}
      <div
        data-hud-flight="top-right"
        className="hud-flight pointer-events-none absolute top-16 z-40 flex w-72 max-w-[80vw] flex-col transition-[right] duration-300"
        style={{ right: artifactsOpen ? "calc(152px + 1rem)" : "1rem" }}
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
        onOpenChange={(open) => onSurfaceChange(open ? "objects" : foldSurface(surface, "objects"))}
      />

      {/* THE CORNER (One Frame FR-4, DESIGN.md §8 "The Me menu", §10): the
          owner's face, the account's one door — the 44px button at 16 from
          the left and 24 from the foot, centred on the foot axis (y 734). Its
          menu opens ABOVE the line, never around the face (FC-D14), and it is
          the frame's, not the canvas's: it stands above the cover with the
          line (62) in every view. The corner keeps only the face — the
          devtools button left for Settings → Advanced (FC-D12). */}
      <div
        data-hud-flight="bottom-left"
        className="hud-flight no-drag absolute bottom-[24px] left-4 z-[62]"
      >
        <MeMenu
          open={meOpen}
          onOpenChange={onMeOpenChange}
          onOpenSettings={openSettings}
          shortcut={getHost().platform === "darwin" ? "⌘," : "Ctrl+,"}
        />
      </div>

      {showSettings && (
        <SettingsPanel
          engine={ce}
          stressWidgetType="vibefield.widgetlab.clock"
          platform={getHost().platform ?? "other"}
          desktopState={desktopState}
          magnetGridGlyph={chrome.magnetGridGlyph}
          onMagnetGridGlyphChange={chrome.setMagnetGridGlyph}
          appearanceControlledByStudio={appearanceControlledByStudio}
          diagnosticsRequest={shellPresentation.diagnosticsRequest}
          diagnosticsInitiallyOpen={shellPresentation.target === "diagnostics"}
          initialPage={shellPresentation.target === "account" ? "account" : "general"}
          devtools={{ open: showEcs, onToggle: () => chrome.setShowEcs((open) => !open) }}
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

      {/* The ⌘K command palette (§8.3; One Frame §7) — a solid panel under
          the head, above the frame, below the modal loading veil. */}
      <CommandPalette
        ce={ce}
        open={paletteOpen}
        onClose={closePalette}
        windowId={FIELD_WINDOW_ID}
        view={view}
        keys={keys}
        onAct={runFrameAct}
      />

      {/* THE FRAME (One Frame FR-1, DESIGN.md §10): the cover the covered views
          live in — Godview, History — over every piece of the canvas's own
          chrome, and the views track standing above the cover. Below Settings,
          the palette and the loading veil: a document that is still opening
          owns the window more than any view does. */}
      <ViewFrame
        godview={<GodviewOverlay />}
        history={historyView}
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        lineActs={lineActs}
      />

      {/* The loading veil rides ABOVE all chrome — loading is modal (B4 §2). */}
      <LoadingVeil loading={docState.loading} />
    </>
  );
}
