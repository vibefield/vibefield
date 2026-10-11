import { Camera, type CanvasEngine, type Entity } from "@vibecook/ice";
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
import { CoverStill } from "./field/desk/CoverStill";
import { BEFORE_THE_DESK } from "./field/desk/desk-words";
import { useWorkspaceSession } from "./field/use-workspace-session";
import type { FrameSurface } from "./frame/frame-surface";
import { useActiveView } from "./frame/view-state";
import { type FieldUserProfile, peekHost } from "./host";
import { useReactiveResource } from "./hud/use-reactive";
import { getRendererLogger } from "./logging";
import { setPluginClientBackend } from "./plugin-host/plugin-client";
import {
  getPluginRegistrySnapshot,
  subscribePluginRegistry,
  usePluginRegistryFeed,
} from "./plugin-host/plugin-registry-store";
import { RendererWindowController } from "./plugin-host/renderer-controller";
import { replaceThisRenderer } from "./plugin-host/replace-renderer";
import {
  type PreparedRendererPlugins,
  type StagedLoaderDeps,
  stageAdditionalPlugins,
} from "./plugin-host/staged-loader";
import { WindowKinds } from "./plugin-host/window-kinds";
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
//   DocManager — launch, metadata, lanes, switching, stills (React-free; no UI)
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
  // THE RUNTIME WITH KINDS (DK-9, plugin-host/window-kinds.ts): the window's plugin set over its life —
  // a plugin turned off or on remounts the desk without or with its kinds; one enabled that this
  // renderer never defined is staged and the board reopens on a new engine; a kind it defined otherwise
  // (an update) saves the board and replaces the renderer, which reopens it.
  const kinds = useMemo(() => {
    if (plugins === undefined) return undefined;
    const log = getRendererLogger().child({ component: "plugin.kinds" });
    return new WindowKinds(plugins, {
      stage: async (pluginIds, existing) => {
        const runtime = existing ?? new RendererWindowController();
        const deps: StagedLoaderDeps = {
          request: async (method, params) => await fielddClient.request(method, params),
          subscribe: async (method, params, onEvent) => {
            const subscription = await fielddClient.subscribe(method, params, onEvent);
            return { snapshot: subscription.snapshot, unsubscribe: subscription.unsubscribe };
          },
          pluginClientBackend: { windowClient: fielddClient },
          windowId: runtime.windowId,
        };
        return { staged: await stageAdditionalPlugins(pluginIds, deps, runtime), runtime };
      },
      remountGeneration: async (reason) => await manager.remount(reason),
      replaceRenderer: () => {
        // the board saved first (its lease closed, its lane drained) — then a NEW realm, made by the
        // shell (main reloads the page: its own reload is refused outside dev), which stages the
        // approved set and reopens this window's own board (`vf-window-doc`) with the new kinds
        void replaceThisRenderer({
          shutdown: () => manager.shutdown(),
          door: peekHost()?.replaceRenderer,
          reload: () => globalThis.location?.reload(),
          log,
        });
      },
      updating: (pluginId) => plugins.runtime?.updating(pluginId) ?? false,
      logger: log,
    });
  }, [plugins, manager, fielddClient]);
  useEffect(() => {
    if (kinds === undefined) return;
    const reconcile = (): void => {
      const snapshot = getPluginRegistrySnapshot();
      if (snapshot === null) return;
      const runtime = kinds.current().runtime;
      void (runtime === undefined ? Promise.resolve() : runtime.reconcile(snapshot))
        .then(() => kinds.observe(snapshot))
        .catch((error) => {
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
    const offRegistry = subscribePluginRegistry(reconcile);
    // an update's episode settled (its commit, an old recovery): the kinds re-read the last snapshot
    const offSettled = kinds.current().runtime?.onSettled(() => void kinds.again());
    return () => {
      offRegistry();
      offSettled?.();
    };
  }, [kinds]);

  const { ce, registry, generation, docState, beforeTheDesk } = useWorkspaceSession(
    manager,
    plugins,
    profile,
    kinds,
  );
  // Ruling 7: a board from before the desk is refused at open — by its header
  // here, or by the open's own word the manager keeps.
  const refused =
    beforeTheDesk ||
    (docState.pending !== null && (docState.beforeTheDesk ?? []).includes(docState.pending.docId));
  // The manager's launch. Its veil waits for the board presented, never on previews (DK-4: the
  // preview warm-up that ran here left with the R3F capture at DK-2).
  useEffect(() => {
    void manager.boot();
  }, [manager]);

  // the plugins staged NOW: the boot's, and any a mid-session enable staged (DK-9) — re-read per registry
  const stagedPlugins = (kinds?.current() ?? plugins)?.staged.length ?? 0;
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
      // PT-5b — and three more a smoke's rows need of a desk of many panes, each an op the product's own chrome
      // performs: an object deleted (selected, then ⌫'s own op — one undo step), the view framed on some objects (the
      // head's "Zoom to fit" over a selection), the view panned to a world point
      removeWidget: (entity: string): boolean => {
        const e = Number(entity) as Entity;
        if (!Number.isFinite(e) || !ce.world.isAlive(e)) return false;
        ce.ops.setSelection([e]);
        ce.ops.deleteSelection();
        return true;
      },
      frame: (entities: readonly string[]): void => {
        ce.ops.zoomToFit(entities.map((entity) => Number(entity) as Entity));
      },
      panTo: (x: number, y: number): void => {
        ce.ops.panTo(x, y);
      },
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
  // the recede derives from the explorer in this render. Objects — the desk's
  // pegboard since DK-13 — recedes nothing: the stage behind it neither recedes
  // nor dims (R14), the desk dimming under the board itself.
  const [surface, setSurfaceRaw] = useState<FrameSurface | null>(null);
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
  const sheetOpen = docsOpen || chrome.showSettings;
  // A covered view (One Frame FR-1): the field goes out of reach under it, and
  // the desk becomes a STILL that costs nothing (DK-15, `CoverStill` below —
  // the still recedes, the desk never does).
  const view = useActiveView();
  const covered = view !== "canvas";

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
    () => effectiveProductAppearance(appearanceOverride.appearance),
    [appearanceOverride.appearance],
  );
  const effectiveAppearanceStyle = useMemo(
    () => productAppearanceCssVariables(effectiveAppearance, dark) as CSSProperties,
    [dark, effectiveAppearance],
  );

  // The Peek (search, the frame's; DESIGN.md §8 "Search — the Peek", §6): its
  // scrim and popup are drawn outside this wrapper, which is out of reach while
  // they stand (a modal: nothing under the scrim may hold the keyboard). What
  // you see recedes under them — the cover's still and the frame's chrome, in
  // `.field-recede` below — and the desk's own box never does (DK-15).
  const searching = surface === "search";

  return (
    <div
      className="field-wrap"
      data-doc-transition={hudMotion}
      inert={searching}
      {...(appearanceOverride.appearance === null
        ? {}
        : { "data-appearance-override-revision": appearanceOverride.revision })}
      style={effectiveAppearanceStyle}
    >
      {onPresentationContextChange !== undefined && (
        <PresentationContextReporter ce={ce} dark={dark} report={onPresentationContextChange} />
      )}
      {/* The recede (reference design): the canvas eases to 0.98 while a
          sheet is up (the explorer, Settings — never the pegboard, DK-13).
          Only the wrapper transforms, so the transient scale never skews
          engine picks. Under a cover the wrapper does NOT recede (DK-15): the
          desk's still does, so nothing transforms the desk's own box while a
          cover stands (ICE I39 — a desk resized under a transform measured it).
          KEYED by doc generation: a switch remounts the whole canvas stack
          (engine + the desk's layer and its device) — see the session.
          DK-9 (the plan's Phase 3 input (1)): the stage WAITS for the board —
          no desk is mounted for generation 0, the transient before the open
          lands, so a launch acquires ONE device and boots ONE desk (its
          `perf().boot` counted once); the veil covers the wait. */}
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
        {generation === 0 ? null : (
          <CanvasStage
            ce={ce}
            generation={generation}
            refused={refused ? BEFORE_THE_DESK : null}
            {...(kinds === undefined ? {} : { kinds })}
            registry={registry}
            {...(docState.pending === null ? {} : { docId: docState.pending.docId })}
          />
        )}
      </div>
      {/* THE RECEDE UNDER THE PEEK (GV-D8 × DK-15; DESIGN.md §6, §8 "Search —
          the Peek"): what you see over the desk — its still under a cover and
          the frame's chrome, the cover with it — in ONE full-window box that
          recedes to 0.98 about the window's 50% 46% while the Peek stands
          (`data-peek-recede`, frame/peek.css). The desk's own box stays outside
          it, so no transform reaches the desk under a cover. At rest the box
          carries no transform (no stacking context) and takes no pointer; its
          children keep theirs (styles/base.css). */}
      <div className="field-recede" data-peek-recede={searching ? "true" : "false"}>
        {/* THE STILL UNDER THE COVERS (DK-15; DESIGN.md §8): over the desk and
            under every piece of chrome; outside the keyed scene, so a remount
            under a standing cover keeps it. */}
        <CoverStill ce={ce} covered={covered} view={view} dark={dark} />
        <ChromeLayer
          ce={ce}
          manager={manager}
          hudMotion={hudMotion}
          docState={docState}
          surface={surface}
          onSurfaceChange={setSurface}
          chrome={chrome}
        />
      </div>
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
