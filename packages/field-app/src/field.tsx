import { Camera, type CanvasEngine } from "@vibecook/ice";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type AppearanceOverrideSnapshot,
  type AppearanceOverrideSource,
  effectiveProductAppearance,
} from "./appearance/appearance-override-store";
import { productAppearanceCssVariables } from "./appearance/product-appearance";
import { emitCanvasReadyMarker } from "./development-console";
import type { DocManager } from "./doc-manager";
import { useDocSyncFeed } from "./doc-sync-store";
import { CanvasStage } from "./field/CanvasStage";
import { ChromeLayer, useChromeState } from "./field/ChromeLayer";
import { BEFORE_THE_DESK } from "./field/desk/desk-words";
import { useFieldKeymapOverrides } from "./field/field-keymap";
import { usePreviewWarmup } from "./field/use-preview-warmup";
import { useWorkspaceSession } from "./field/use-workspace-session";
import type { FrameSurface } from "./frame/frame-surface";
import { useCovered } from "./frame/view-state";
import type { FieldUserProfile } from "./host";
import { useReactiveResource } from "./hud/use-reactive";
import { getRendererLogger } from "./logging";
import { setPluginClientBackend } from "./plugin-host/plugin-client";
import {
  getPluginRegistrySnapshot,
  subscribePluginRegistry,
  usePluginRegistryFeed,
} from "./plugin-host/plugin-registry-store";
import type { PreparedRendererPlugins } from "./plugin-host/staged-loader";
import type { ProductPresentationContextReporter } from "./presentation-context";
import { useTheme } from "./theme";

// The Field (B2 + Track D1–D4), decomposed per ESR §5.4.3 (slice 3b):
// FieldView is the WorkspaceApp — it composes the explicit units and owns only
// cross-cutting UI state (sheets, hud motion, chrome settings). The logic
// lives with its owners:
//   useWorkspaceSession — one engine generation + one document-attach lifetime
//   PersistenceController — doc changes → lane, durable flush on close
//   CanvasStage — the desk drawn (ICE's `<Desk>`, inside the generation-keyed wrapper)
//   ChromeLayer — HUD, pills, tray, panels, overlays + chrome effects
//   usePreviewWarmup — preview discovery/chunking into the loading pipeline
//   DocManager — launch, metadata, lanes, switching (React-free; no UI)
// The window IS the field (2026-07-21): no app bar — diagnostics live inside
// Settings, and the theme is the Me menu's (One Frame FC-D5).

const EMPTY_APPEARANCE_SNAPSHOT: AppearanceOverrideSnapshot = Object.freeze({
  revision: 0,
  appearance: null,
});
const EMPTY_APPEARANCE_SOURCE: AppearanceOverrideSource = Object.freeze({
  snapshot: () => EMPTY_APPEARANCE_SNAPSHOT,
  subscribe: () => () => undefined,
});
const cameraZoom = (camera: { zoom: number } | undefined): number => camera?.zoom ?? 1;

export function FieldView({
  manager,
  plugins,
  profile,
  appearanceOverrideSource,
  onPresentationContextChange,
}: {
  manager: DocManager;
  /** P8b-3 — the staged set the boot phase resolved. Absent only in harnesses
   * that mount the view without a boot machine; the session then builds an
   * empty registry rather than reaching for a loader of its own. */
  plugins?: PreparedRendererPlugins;
  /** Real supervisor-owned identity; absent harnesses run without presence. */
  profile?: FieldUserProfile;
  /** Optional host-provided ephemeral full-appearance override. */
  appearanceOverrideSource?: AppearanceOverrideSource;
  onPresentationContextChange?: ProductPresentationContextReporter;
}): ReactElement {
  // The app's one theme (One Frame FC-D5), main's — read here for the field's
  // own appearance (and by the stage, whose desk it dresses); the controls that
  // choose it ask the owner themselves.
  const { dark } = useTheme();

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

  const { ce, registry, generation, docState, beforeTheDesk } = useWorkspaceSession(
    manager,
    plugins,
    profile,
  );
  // Ruling 7: a board from before the desk is refused at open — by its header
  // here, or by the open's own word the manager keeps.
  const refused =
    beforeTheDesk ||
    (docState.pending !== null && (docState.beforeTheDesk ?? []).includes(docState.pending.docId));
  usePreviewWarmup(manager, registry);

  const stagedPlugins = plugins?.staged.length ?? 0;
  useEffect(() => {
    // The console marker is a smoke adapter, so make its runtime census a
    // quiescent fact: the earlier reconcile effect may have entered its first
    // async controller transition in this same passive-effect turn.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const publish = (): void => {
      const runtime = plugins?.runtime?.state();
      if (runtime !== undefined && runtime.inFlight > 0) {
        timer = setTimeout(publish, 25);
        return;
      }
      const widgetTypes = registry.allWidgets().size;
      const registered = registry.all().length;
      getRendererLogger()
        .child({ component: "canvas" })
        .info("renderer.canvas.ready", "The canvas renderer is ready", {
          widgetTypes,
          plugins: registered,
          stagedPlugins,
        });
      emitCanvasReadyMarker(widgetTypes, registered, stagedPlugins, runtime);
    };
    publish();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [registry, stagedPlugins, plugins?.runtime]);

  useEffect(() => {
    // The CANVAS_READY bargain (development-console.ts), extended one door: a
    // headless smoke has no hands, so the field exposes ONE narrow driving
    // surface — spawn a widget through the engine's own op, list the widget
    // types the palette would list. Reads plus one op this bundle's own
    // palette already performs; no authority beyond what renderer code holds.
    const door = {
      widgetTypes: (): string[] => [...registry.allWidgets().keys()],
      spawnWidget: (
        type: string,
        opts: {
          x: number;
          y: number;
          w: number;
          h: number;
          props?: Record<string, unknown>;
        },
      ): string =>
        String(
          ce.ops.spawnWidget(type, {
            x: opts.x,
            y: opts.y,
            w: opts.w,
            h: opts.h,
            undoable: false,
            ...(opts.props === undefined ? {} : { props: opts.props }),
          }),
        ),
    };
    const scope = globalThis as Record<string, unknown>;
    scope["__vfFieldSmoke"] = door;
    return () => {
      if (scope["__vfFieldSmoke"] === door) delete scope["__vfFieldSmoke"];
    };
  }, [ce, registry]);

  // THE FRAME'S OPEN SURFACE (One Frame FR-2/FR-3/FR-4, `frame/frame-surface.ts`):
  // its one owner. Objects, @'s list, the fields explorer, the zoom's menu and
  // the palette are one value, so any one folds the rest; held here because
  // the recede derives from Objects and the explorer in this render.
  const [surface, setSurfaceRaw] = useState<FrameSurface | null>(null);
  const trayOpen = surface === "objects";
  const docsOpen = surface === "fields";
  const chrome = useChromeState();
  const appearanceSource = appearanceOverrideSource ?? EMPTY_APPEARANCE_SOURCE;
  const appearanceOverride = useSyncExternalStore(
    appearanceSource.subscribe,
    appearanceSource.snapshot,
  );
  // One surface at a time: any of the frame's surfaces dismisses Settings as
  // it opens, while ChromeLayer performs the inverse when Settings opens.
  const setSurface = useCallback(
    (next: FrameSurface | null) => {
      setSurfaceRaw(next);
      if (next !== null) chrome.setShowSettings(false);
    },
    [chrome.setShowSettings],
  );
  const sheetOpen = trayOpen || docsOpen || chrome.showSettings;
  // A covered view (One Frame FR-1) recedes the field too — and ChromeLayer
  // freezes it, since a cover covers (DESIGN.md §6).
  const covered = useCovered();

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

  const effectiveAppearance = useMemo(
    () => effectiveProductAppearance(appearanceOverride.appearance, chrome.magnetGridGlyph),
    [appearanceOverride.appearance, chrome.magnetGridGlyph],
  );
  const effectiveAppearanceStyle = useMemo(
    () => productAppearanceCssVariables(effectiveAppearance, dark) as CSSProperties,
    [dark, effectiveAppearance],
  );

  // I1 (ice 0.4.0): the C key's "selection decides" behavior rides the engine
  // keymap's own override surface — stable entries; runs read the Settings
  // gate through a ref (field-keymap.ts).
  const keymapOverrides = useFieldKeymapOverrides(chrome.showSettings);

  return (
    <div
      className="field-wrap"
      data-doc-transition={hudMotion}
      {...(appearanceOverride.appearance === null
        ? {}
        : { "data-appearance-override-revision": appearanceOverride.revision })}
      style={effectiveAppearanceStyle}
    >
      {onPresentationContextChange !== undefined && (
        <PresentationContextReporter ce={ce} dark={dark} report={onPresentationContextChange} />
      )}
      {/* The recede (reference design): the canvas eases to 0.98 while the
          sheet is up. Only the wrapper transforms — the tray handoff
          ratio-corrects, so the transient scale never skews engine picks.
          KEYED by doc generation: a switch remounts the whole canvas stack
          (engine + the desk's layer and its device) — see the session. */}
      <div
        key={generation}
        className="field-scene"
        data-sheet-open={sheetOpen ? "true" : "false"}
        data-covered={covered ? "true" : "false"}
        // Under a cover the field is out of reach: nothing in it may hold the
        // keyboard (a note being typed in when ⌘2 was pressed lets go of it).
        inert={covered}
        data-doc-loading={docState.phase === "loading" ? "true" : "false"}
      >
        <CanvasStage
          ce={ce}
          keymapOverrides={keymapOverrides}
          generation={generation}
          refused={refused ? BEFORE_THE_DESK : null}
        />
      </div>
      <ChromeLayer
        ce={ce}
        manager={manager}
        registry={registry}
        hudMotion={hudMotion}
        docState={docState}
        surface={surface}
        onSurfaceChange={setSurface}
        appearanceControlledByStudio={appearanceOverride.appearance !== null}
        chrome={chrome}
      />
    </div>
  );
}

function PresentationContextReporter({
  ce,
  dark,
  report,
}: {
  ce: CanvasEngine;
  dark: boolean;
  report: ProductPresentationContextReporter;
}): null {
  const zoom = useReactiveResource(ce, Camera, cameraZoom);
  useEffect(() => report({ theme: dark ? "dark" : "light", zoom }), [dark, report, zoom]);
  return null;
}
