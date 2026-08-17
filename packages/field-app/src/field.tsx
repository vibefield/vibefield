import type { DevtoolsHandle } from "@vibecook/ice/devtools";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { emitCanvasReadyMarker } from "./development-console";
import type { DocManager } from "./doc-manager";
import { useDocSyncFeed } from "./doc-sync-store";
import { CanvasStage } from "./field/CanvasStage";
import { ChromeLayer, useChromeState } from "./field/ChromeLayer";
import { defaultCanvasGridConfig } from "./field/canvas-appearance";
import { useFieldKeymapOverrides } from "./field/field-keymap";
import { usePreviewWarmup } from "./field/use-preview-warmup";
import { useWorkspaceSession } from "./field/use-workspace-session";
import type { FieldUserProfile } from "./host";
import { getRendererLogger } from "./logging";
import { setPluginClientBackend } from "./plugin-host/plugin-client";
import {
  getPluginRegistrySnapshot,
  subscribePluginRegistry,
  usePluginRegistryFeed,
} from "./plugin-host/plugin-registry-store";
import type { PreparedRendererPlugins } from "./plugin-host/staged-loader";
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

export function FieldView({
  manager,
  plugins,
  profile,
}: {
  manager: DocManager;
  /** P8b-3 — the staged set the boot phase resolved. Absent only in harnesses
   * that mount the view without a boot machine; the session then builds an
   * empty registry rather than reaching for a loader of its own. */
  plugins?: PreparedRendererPlugins;
  /** Real supervisor-owned identity; absent harnesses run without presence. */
  profile?: FieldUserProfile;
}): ReactElement {
  const { dark, toggle: toggleTheme } = useTheme();
  // Shared seams between units: the stage publishes its GL/halo teardown for
  // the session's engine disposal (the GL disposal order invariant); chrome
  // publishes the live devtools handle for the stage's GL profiling lanes.
  const stageDisposeRef = useRef<(() => void) | null>(null);
  const devtoolsRef = useRef<DevtoolsHandle | null>(null);

  // PLUG-P2: stream the fieldd plugin-registry snapshot into the module store
  // (session sampling + Settings section read it; daemon-away stays honest).
  usePluginRegistryFeed();
  // C6-4: stream per-doc sync standing into its store (the file pill and the
  // Settings Mesh section read it; empty = sync has nothing to say).
  useDocSyncFeed();
  // PLUG-P3b: hand the plugin-client module its backend — plugin-bound leases
  // dial the same daemon this window reached (cleared on unmount, honestly).
  const fielddClient = useFielddClient();
  useEffect(() => {
    setPluginClientBackend({ windowClient: fielddClient });
    return () => setPluginClientBackend(null);
  }, [fielddClient]);
  useEffect(() => {
    const runtime = plugins?.runtime;
    if (runtime === undefined) return;
    const reconcile = (): void => {
      const snapshot = getPluginRegistrySnapshot();
      if (snapshot === null) return;
      void runtime.reconcile(snapshot).catch((error) => {
        getRendererLogger()
          .child({ component: "plugin.host" })
          .error(
            "renderer.plugins.reconcile_failed",
            "Renderer plugin targets could not converge on the registry observation",
            error,
          );
      });
    };
    reconcile();
    return subscribePluginRegistry(reconcile);
  }, [plugins]);

  const { ce, registry, generation, docState } = useWorkspaceSession(
    manager,
    stageDisposeRef,
    plugins,
    profile,
  );
  usePreviewWarmup(manager, registry);

  const stagedPlugins = plugins?.staged.length ?? 0;
  useEffect(() => {
    // after mount commit — the smoke's pass condition covers InfiniteCanvas itself
    const widgetTypes = registry.allWidgets().size;
    const registered = registry.all().length;
    getRendererLogger()
      .child({ component: "canvas" })
      .info("renderer.canvas.ready", "The canvas renderer is ready", {
        widgetTypes,
        plugins: registered,
        stagedPlugins,
      });
    emitCanvasReadyMarker(widgetTypes, registered, stagedPlugins);
  }, [registry, stagedPlugins]);

  const [trayOpen, setTrayOpenRaw] = useState(false);
  const [docsOpen, setDocsOpenRaw] = useState(false);
  const chrome = useChromeState();
  // One modal surface at a time: sheets dismiss Settings when opened, while
  // ChromeLayer performs the inverse when Settings or the command palette opens.
  const setTrayOpen = useCallback(
    (o: boolean) => {
      setTrayOpenRaw(o);
      if (o) {
        setDocsOpenRaw(false);
        chrome.setShowSettings(false);
      }
    },
    [chrome.setShowSettings],
  );
  const setDocsOpen = useCallback(
    (o: boolean) => {
      setDocsOpenRaw(o);
      if (o) {
        setTrayOpenRaw(false);
        chrome.setShowSettings(false);
      }
    },
    [chrome.setShowSettings],
  );
  const sheetOpen = trayOpen || docsOpen || chrome.showSettings;

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

  const effectiveGrid = useMemo(() => defaultCanvasGridConfig(dark), [dark]);

  // I1 (ice 0.4.0): the C key's "selection decides" behavior rides the engine
  // keymap's own override surface — stable entries; runs read the Settings
  // gate through a ref (field-keymap.ts).
  const keymapOverrides = useFieldKeymapOverrides(chrome.showSettings);

  return (
    <div className="field-wrap" data-doc-transition={hudMotion}>
      {/* The recede (reference design): the canvas eases to 0.98 while the
          sheet is up. Only the wrapper transforms — the tray handoff
          ratio-corrects, so the transient scale never skews engine picks.
          KEYED by doc generation: a switch remounts the whole canvas stack
          (engine + InfiniteCanvas + GL Canvas + ground) — see the session. */}
      <div
        key={generation}
        className="field-scene"
        data-sheet-open={sheetOpen ? "true" : "false"}
        data-doc-loading={docState.phase === "loading" ? "true" : "false"}
      >
        <CanvasStage
          ce={ce}
          grid={effectiveGrid}
          keymapOverrides={keymapOverrides}
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
