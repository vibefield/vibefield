import type { GridConfig } from "@vibecook/ice";
import type { DevtoolsHandle } from "@vibecook/ice/devtools";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DocManager } from "./doc-manager";
import { CanvasStage } from "./field/CanvasStage";
import { ChromeLayer, useChromeState } from "./field/ChromeLayer";
import { hexToRgb01 } from "./field/theme-constants";
import { usePreviewWarmup } from "./field/use-preview-warmup";
import { useWorkspaceSession } from "./field/use-workspace-session";
import { usePluginRegistryFeed } from "./plugin-host/plugin-registry-store";
import { useTheme } from "./theme";

// The Field (B2 + Track D1–D4), decomposed per ESR §5.4.3 (slice 3b):
// FieldView is the WorkspaceApp — it composes the explicit units and owns only
// cross-cutting UI state (sheets, hud motion, chrome settings). The logic
// lives with its owners:
//   useWorkspaceSession — one engine generation + one document-attach lifetime
//   PersistenceController — doc changes → lane, durable flush on close
//   CanvasStage — ICE/DOM/GL composition (inside the generation-keyed wrapper)
//   ChromeLayer — HUD, pills, tray, panels, overlays + chrome effects
//   usePreviewWarmup — preview discovery/chunking into the loading pipeline
//   DocManager — launch, metadata, lanes, switching (React-free; no UI)
// The window IS the field (2026-07-21): no app bar — the theme toggle floats
// top-right, diagnostics live inside Settings.

export function FieldView({ manager }: { manager: DocManager }): ReactElement {
  const { dark, toggle: toggleTheme } = useTheme();
  // Shared seams between units: the stage publishes its GL/halo teardown for
  // the session's engine disposal (the GL disposal order invariant); chrome
  // publishes the live devtools handle for the stage's GL profiling lanes.
  const stageDisposeRef = useRef<(() => void) | null>(null);
  const devtoolsRef = useRef<DevtoolsHandle | null>(null);

  // PLUG-P2: stream the fieldd plugin-registry snapshot into the module store
  // (session sampling + Settings section read it; daemon-away stays honest).
  usePluginRegistryFeed();

  const { ce, registry, generation, docState } = useWorkspaceSession(manager, stageDisposeRef);
  usePreviewWarmup(manager, registry);

  useEffect(() => {
    // after mount commit — the smoke's pass condition covers InfiniteCanvas itself
    console.log(
      `CANVAS_READY {"widgetTypes":${registry.allWidgets().size},"plugins":${registry.all().length}}`,
    );
  }, [registry]);

  const [trayOpen, setTrayOpenRaw] = useState(false);
  const [docsOpen, setDocsOpenRaw] = useState(false);
  // One sheet at a time: the tray and the docs explorer are mutually exclusive
  // (two simultaneous sheets would fight over the recede and the stage hold).
  const setTrayOpen = useCallback((o: boolean) => {
    setTrayOpenRaw(o);
    if (o) setDocsOpenRaw(false);
  }, []);
  const setDocsOpen = useCallback((o: boolean) => {
    setDocsOpenRaw(o);
    if (o) setTrayOpenRaw(false);
  }, []);
  const sheetOpen = trayOpen || docsOpen;

  const chrome = useChromeState();

  const [hudReturning, setHudReturning] = useState(false);
  const hudWasLoading = useRef(docState.phase === "loading");
  useLayoutEffect(() => {
    if (docState.phase === "loading") {
      hudWasLoading.current = true;
      setHudReturning(false);
      return;
    }

    if (!hudWasLoading.current) return;

    hudWasLoading.current = false;
    setHudReturning(true);
    const timeout = window.setTimeout(() => setHudReturning(false), 760);
    return () => window.clearTimeout(timeout);
  }, [docState.phase]);

  const hudMotion = docState.phase === "loading" ? "out" : hudReturning ? "in" : "idle";

  const effectiveGrid = useMemo<Partial<GridConfig>>(
    () => ({
      ...chrome.gridConfig,
      dotColor: hexToRgb01(dark ? chrome.themeColors.dotDark : chrome.themeColors.dotLight),
    }),
    [chrome.gridConfig, dark, chrome.themeColors],
  );

  return (
    <div
      className="field-wrap"
      data-doc-transition={hudMotion}
      style={{ background: "var(--vf-canvas-bg)" }}
    >
      {/* The recede (reference design): the canvas eases to 0.98 while the
          sheet is up. Only the wrapper transforms — the tray handoff
          ratio-corrects, so the transient scale never skews engine picks.
          KEYED by doc generation: a switch remounts the whole canvas stack
          (engine + InfiniteCanvas + GL Canvas + ground) — see the session. */}
      <div
        key={generation}
        style={{
          position: "absolute",
          inset: 0,
          transform: sheetOpen
            ? "scale(0.98)"
            : docState.phase === "loading"
              ? "scale(0.992)"
              : "scale(1)",
          opacity: docState.phase === "loading" ? 0.72 : 1,
          transition: "transform 600ms var(--vf-ease-island), opacity 420ms var(--vf-ease-island)",
        }}
      >
        <CanvasStage
          ce={ce}
          grid={effectiveGrid}
          ecsOpen={chrome.showEcs}
          devtoolsRef={devtoolsRef}
          disposeRef={stageDisposeRef}
        />
      </div>
      <ChromeLayer
        ce={ce}
        manager={manager}
        registry={registry}
        dark={dark}
        onToggleTheme={toggleTheme}
        hudMotion={hudMotion}
        docState={docState}
        trayOpen={trayOpen}
        onTrayOpenChange={setTrayOpen}
        docsOpen={docsOpen}
        onDocsOpenChange={setDocsOpen}
        chrome={chrome}
        devtoolsRef={devtoolsRef}
      />
    </div>
  );
}
