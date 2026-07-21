import { Canvas, useThree } from "@react-three/fiber";
import {
  DEFAULT_GRID_CONFIG,
  ENGINE_SCHEMA_VERSION,
  type GridConfig,
  selectedEntities,
} from "@vibecook/ice";
import { attachDevtools, type DevtoolsHandle } from "@vibecook/ice/devtools";
import { ground } from "@vibecook/ice/ground";
import {
  captureWidgetPreviews,
  createGLBridge,
  createGLPointerRouter,
  type GLBridge,
  type GLPointerRouter,
  GLViews,
  type GlFrameStats,
} from "@vibecook/ice/r3f";
import { InfiniteCanvas, type InfiniteCanvasHandle, useStageHold } from "@vibecook/ice/react";
import { spawnCommentAroundSelection } from "@vibefield/plugin-field-tools";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { PMREMGenerator, type Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { setBoardStatus } from "./board-status";
import { installCursorHalo } from "./cursor";
import type { DocManager } from "./doc-manager";
import { captureDocThumbnailScene } from "./doc-thumbnail-scene";
import { buildRegistry, createFieldEngine, seedField } from "./field-engine";
import { FilePill } from "./hud/FilePill";
import { LoadingVeil } from "./hud/LoadingVeil";
import { NavigationBreadcrumbs } from "./hud/NavigationBreadcrumbs";
import { WidgetTray } from "./hud/WidgetTray";
import { ZoomPill } from "./hud/ZoomPill";
import {
  InspectorPanel,
  type OverlapGlowConfig,
  type OverlapGlowThemeColors,
  SettingsPanel,
  type ThemeColors,
} from "./panels";
import { useTheme } from "./theme";

// The Field (B2 + Track D1–D4): plugins' widgets → one canvas engine →
// InfiniteCanvas over the widgetlab ground, the GL island layer (bridge +
// pointer router + composite views), the cursor halo, the morphing island
// (WidgetTray) as the spawn door, and the diagnostics panels. Composition is
// widgetlab App.tsx, decomposed per design-03 (the engine/seed lives in
// field-engine.ts). The window IS the field (2026-07-21): no app bar — the
// theme toggle floats top-right, diagnostics live inside Settings.

// === v1 theme constants (widgetlab App.tsx verbatim) ===

const DEFAULT_THEME_COLORS: ThemeColors = {
  dotLight: "#BFC4CC",
  dotDark: "#595E66",
  bgLight: "#FAFAFA",
  bgDark: "#171717",
};

const DEFAULT_OVERLAP_GLOW_THEME_COLORS: OverlapGlowThemeColors = {
  glowLight: "#808080",
  glowDark: "#FFFFFF",
  rimLight: "#808080",
  rimDark: "#FFFFFF",
};

/** v1 DEFAULT_OVERLAP_GLOW_CONFIG values ([candidate, target] pairs — CardShell's var defaults). */
const DEFAULT_OVERLAP_GLOW: OverlapGlowConfig = {
  glowColor: [0.5, 0.5, 0.5],
  glowAlpha: [0.25, 0.45],
  glowSize: [60, 80],
  rimColor: [0.5, 0.5, 0.5],
  rimWidth: 1,
  rimAlpha: [0.3, 0.5],
  rimRadius: 40,
};

function hexToRgb01(hex: string): [number, number, number] {
  const s = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return [
    Number.parseInt(s.slice(0, 2), 16) / 255,
    Number.parseInt(s.slice(2, 4), 16) / 255,
    Number.parseInt(s.slice(4, 6), 16) / 255,
  ];
}

function hexToRgb255(hex: string): string {
  const s = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return `${Number.parseInt(s.slice(0, 2), 16)}, ${Number.parseInt(s.slice(2, 4), 16)}, ${Number.parseInt(s.slice(4, 6), 16)}`;
}

/**
 * v1's `r3fRoot={<Environment preset="apartment"/>}` equivalent — but
 * DETERMINISTIC: three's built-in RoomEnvironment through PMREM instead of
 * drei's CDN HDR (a slow/blocked fetch left the metallic cards silhouetted —
 * field-verified 2026-07-12). Near-identical neutral studio look, zero
 * network. <GLViews environment> stamps it on every island scene.
 */
function EnvLoader({ onTex }: { onTex: (t: Texture | null) => void }) {
  const gl = useThree((s) => s.gl);
  const tex = useMemo(() => {
    const pmrem = new PMREMGenerator(gl);
    const t = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return t;
  }, [gl]);
  useEffect(() => {
    onTex(tex);
    return () => onTex(null);
  }, [tex, onTex]);
  return null;
}

const fabCls = (active: boolean) =>
  `absolute z-50 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-colors ${
    active
      ? "bg-neutral-800 text-white dark:bg-white dark:text-neutral-800"
      : "bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
  }`;

export function FieldView({ manager }: { manager: DocManager }): ReactElement {
  const { dark, toggle: toggleTheme } = useTheme();
  const registry = useMemo(buildRegistry, []);
  const docState = useSyncExternalStore(manager.subscribe, manager.getState);
  const pending = docState.pending;
  // ONE ENGINE PER DOC (B4 fix, 2026-07-21): a doc switch REMOUNTS the engine
  // and the whole canvas stack (key below). The store layer supports in-place
  // close→open (doc-swap.test pins it), but our composition stacks six
  // stateful layers on the engine (GL bridge/router/plane, halo, ground,
  // devtools) and the retained GL + WebGPU frames survive a world reset —
  // field report: stale 3D cards + wires after "new field". Remounting lands
  // every switch on the exact path boot/restart already prove, behind the
  // veil. The extra virgin engine at first boot (generation 0 → 1) is the
  // accepted cost of uniformity.
  const generation = pending?.generation ?? 0;
  const ce = useMemo(() => createFieldEngine(registry), [registry, generation]);

  // B4 launch: register the previews stage (chunks of 3 — each capture call
  // owns one WebGL context, and 7 rapid context cycles flirts with the browser
  // cap; skip-if-captured makes doc-switch re-runs instant), then boot the
  // manager. StrictMode double-effect is absorbed by boot()'s guard.
  useEffect(() => {
    manager.setPreviewRunner(async (onTick) => {
      const glTypes = [...registry.allWidgets().values()]
        .filter((w) => w.surface === "gl")
        .map((w) => w.type);
      const chunks: string[][] = [];
      for (let i = 0; i < glTypes.length; i += 3) chunks.push(glTypes.slice(i, i + 3));
      let done = 0;
      onTick(0, glTypes.length);
      for (const types of chunks) {
        await captureWidgetPreviews({
          types,
          environment: (gl) =>
            new PMREMGenerator(gl).fromScene(new RoomEnvironment(), 0.04).texture,
        });
        done += types.length;
        onTick(done, glTypes.length);
      }
    });
    void manager.boot();
    return () => manager.setPreviewRunner(null);
  }, [manager, registry]);

  // B3 law carried into B4 — the doc attaches to the COMMITTED engine only,
  // never in the memo factory (the StrictMode twin must never stream to the
  // daemon). Keyed on the manager's pending session: a doc switch tears the
  // old session down (flush → stop → close; the manager drains the retired
  // lane after this effect re-applies) and lands the new one before paint.
  useLayoutEffect(() => {
    if (pending === null) return;
    const lane = pending.lane;
    if (pending.initialBytes !== null) {
      const res = ce.docs.open(pending.initialBytes);
      if (!res.ok) {
        // Honest quarantine (the M5 law): the at-rest bytes stay untouched on
        // disk; a blank board + surfaced state beats autosaving over them.
        console.error(`[board] quarantined: ${res.reason}`);
        setBoardStatus({ state: "quarantined", detail: res.reason });
        ce.docs.create();
        ce.world.sync();
        manager.contentApplied(pending.generation);
        return () => ce.docs.close();
      }
      ce.world.sync();
    } else {
      const session = ce.docs.create();
      // The demo scene belongs to the bootstrap default doc alone (seed flag);
      // user-created docs open as an empty field.
      if (pending.seed) seedField(ce, session);
      else ce.world.sync();
    }
    if (lane === null) {
      // degraded (in-memory) session — the manager already set the board row
      manager.contentApplied(pending.generation);
      return () => ce.docs.close();
    }
    // Autosave starts DIRTY (ice law): a seeded first-run board reaches fieldd
    // after the first debounce, no user edit required. Lane status → board row
    // wiring lives in the manager now (it owns lane lifecycles).
    const autosave = ce.docs.autosave({
      put: async (bytes) => {
        const savedAt = Date.now();
        // Capture only durable structural state, synchronously, while this
        // engine is still alive. Rendering/encoding happens later in a worker.
        const thumbnailScene = captureDocThumbnailScene(ce);
        setBoardStatus({ state: "saving", lastSavedAt: lane.lastPutAt });
        await lane.put(bytes, { engineSchema: ENGINE_SCHEMA_VERSION, savedAt });
        manager.thumbnailCheckpoint(
          pending.docId,
          `${savedAt}:${bytes.byteLength}`,
          thumbnailScene,
        );
        setBoardStatus({ state: "live", lastSavedAt: lane.lastPutAt });
      },
    });
    manager.contentApplied(pending.generation);
    const flush = () => void autosave.flush();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      // Order is load-bearing: flush exports SYNCHRONOUSLY at entry (final
      // save), stop() then bars any later export — so close()'s world reset
      // can never be persisted as an empty board.
      void autosave.flush();
      autosave.stop();
      ce.docs.close();
    };
  }, [ce, manager, pending]);
  // The P0 ground layer (grid + wires + snap guides, one WebGPU canvas) —
  // memoized per doc generation: the ground remounts WITH the engine (a
  // factory is one canvas-mount's state; reuse across remounts is undefined).
  const groundFactory = useMemo(() => ground(), [generation]);
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
  // The docs sheet + the loading veil quiesce the stage exactly like the tray.
  useStageHold(ce, docsOpen, "docs-explorer");
  useStageHold(ce, docState.phase === "loading", "loading-veil");
  useEffect(() => {
    if (docsOpen) ce.ops.cancelActiveGestures();
  }, [docsOpen, ce]);

  const [showSettings, setShowSettings] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showEcs, setShowEcs] = useState(false);
  const [gridConfig, setGridConfig] = useState<GridConfig>({ ...DEFAULT_GRID_CONFIG });
  const [themeColors, setThemeColors] = useState<ThemeColors>(DEFAULT_THEME_COLORS);
  const [overlapGlow, setOverlapGlow] = useState<OverlapGlowConfig>(DEFAULT_OVERLAP_GLOW);
  const [overlapGlowThemeColors, setOverlapGlowThemeColors] = useState<OverlapGlowThemeColors>(
    DEFAULT_OVERLAP_GLOW_THEME_COLORS,
  );

  useEffect(() => {
    // after mount commit — the smoke's pass condition covers InfiniteCanvas itself
    console.log(
      `CANVAS_READY {"widgetTypes":${registry.allWidgets().size},"plugins":${registry.all().length}}`,
    );
  }, [registry]);

  // --- GL root: bridge + router + P2 plane arrive in onReady; glRoute delegates
  // via ref. glRef keeps the whole set so we can tear it down — onReady fires
  // from InfiniteCanvas's mount effect, so a StrictMode double-mount would
  // otherwise stack a stale bridge (reflector + world observer) and a stale
  // plane div (glboard disposes the same set in its boot handle's dispose()).
  const routerRef = useRef<GLPointerRouter | null>(null);
  const glRef = useRef<{ bridge: GLBridge; router: GLPointerRouter; plane: HTMLDivElement } | null>(
    null,
  );
  const [gl, setGl] = useState<{ bridge: GLBridge; plane: HTMLDivElement } | null>(null);
  const [envTex, setEnvTex] = useState<Texture | null>(null);
  const glRoute = useCallback(
    (kind: "down" | "move" | "up" | "cancel", x: number, y: number, e: PointerEvent) => {
      const router = routerRef.current;
      if (router === null) return false;
      const handled = router.route(kind, x, y, e);
      // Moves carry the rich verdict: the router's hover-time overInteractive
      // feeds the pointer's OverInteractive tag (cursor-halo dot over the
      // orbit cube / claimed shapes, same telegraph as DOM interactives).
      return kind === "move" ? { handled, overInteractive: router.overInteractive() } : handled;
    },
    [],
  );
  const disposeGl = useCallback(() => {
    const prev = glRef.current;
    if (prev === null) return;
    prev.bridge.uninstall(); // unregisters the render reflector + world observer
    prev.plane.remove();
    glRef.current = null;
    routerRef.current = null;
  }, []);
  // Cursor halo (2026-07-18): the pointerlab morph as an OS-cursor accent —
  // ring on canvas, zoomed-in ring over cards, solid dot over internal
  // interactives (the opt-out telegraph). Same StrictMode discipline as GL:
  // dispose the prior mount's install before wiring a fresh one.
  const haloRef = useRef<(() => void) | null>(null);
  const disposeHalo = useCallback(() => {
    haloRef.current?.();
    haloRef.current = null;
  }, []);
  const onReady = useCallback(
    (handle: InfiniteCanvasHandle) => {
      disposeHalo();
      haloRef.current = installCursorHalo(ce, handle.host.container);
      disposeGl(); // drop a prior mount's set before wiring a fresh one
      const bridge = createGLBridge(ce.engine);
      // DEV-only forensics twin of __ice — headless scripts inspect islands.
      (window as unknown as { __iceBridge?: GLBridge }).__iceBridge = bridge;
      const router = createGLPointerRouter({ world: ce.world, bridge, index: ce.stack.index });
      routerRef.current = router;
      const plane = handle.host.container.ownerDocument.createElement("div");
      plane.style.cssText = "position:absolute;inset:0;pointer-events:none;"; // P2: display-only (router owns GL hits)
      // P2 sits UNDER the lifted plane (P3) and chrome — glboard's insertion
      // point; appending last would stack GL over dragged widgets/chrome.
      handle.host.container.insertBefore(plane, handle.planes.lifted);
      glRef.current = { bridge, router, plane };
      setGl({ bridge, plane });
    },
    [ce, disposeGl, disposeHalo],
  );
  useEffect(() => disposeGl, [disposeGl]);
  useEffect(() => disposeHalo, [disposeHalo]);

  // Engine lifecycle (one per doc): when the generation re-keys `ce`, tear the
  // PRIOR engine's wiring down and dispose it. Ordering is safe by React's
  // rules: the attach layout-effect's cleanup (final flush → stop → close)
  // runs in the commit phase, BEFORE this passive cleanup disposes the engine.
  useEffect(() => {
    return () => {
      disposeGl();
      disposeHalo();
      setGl(null);
      ce.dispose();
    };
  }, [ce, disposeGl, disposeHalo]);

  // (B4: the GL preview capture moved OFF the idle path into the loading
  // pipeline's previews stage — registered with the manager above. The
  // environment stays a factory built ON the capture renderer: PMREM textures
  // don't cross renderers.)

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

  const effectiveGrid = useMemo<Partial<GridConfig>>(
    () => ({
      ...gridConfig,
      dotColor: hexToRgb01(dark ? themeColors.dotDark : themeColors.dotLight),
    }),
    [gridConfig, dark, themeColors],
  );

  // Natural boot framing (widgetlab, 2026-07-18: "zoom to fit, but with an
  // upper and bottom cap"): frame the content once the viewport is measured
  // and membership has stamped the first tick. Re-keyed per doc generation
  // (B4): a switched-in doc gets its own arrival framing.
  useEffect(() => {
    if (generation === 0) return; // no doc landed yet — the veil is up
    if (ce.ops.frameContent()) return;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (ce.ops.frameContent() || tries > 40) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [ce, generation]);

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
  // tracks docs.current() live only through it. The handle also rides a ref
  // so the GL profiling callback below can feed the profiler HUD's lanes.
  const devtoolsRef = useRef<DevtoolsHandle | null>(null);
  useEffect(() => {
    if (!showEcs) return;
    const d = attachDevtools(ce, { presence: () => ce.docs.presence() });
    devtoolsRef.current = d;
    return () => {
      devtoolsRef.current = null;
      d.detach();
    };
  }, [showEcs, ce]);

  // GL frame profiling → profiler HUD lanes ("gl cpu" = the whole compositor
  // pass on the main thread; "gpu" = summed render-call GPU time, 0 where
  // timer queries are unsupported). Only wired while the ECS panel is open —
  // GLViews skips all measurement when the prop is absent.
  const onGlStats = useCallback((s: GlFrameStats) => {
    const dt = devtoolsRef.current;
    if (dt === null) return;
    dt.lane("gl cpu", s.cpuMs);
    if (s.gpuMs > 0) dt.lane("gpu", s.gpuMs);
    dt.glStats(s); // the full GL panel: renderer counts, VT census, LOD bands, culls
  }, []);

  return (
    <div className="field-wrap" style={{ background: "var(--vf-canvas-bg)" }}>
      {/* The recede (reference design): the canvas eases to 0.98 while the
          sheet is up. Only the wrapper transforms — the tray handoff
          ratio-corrects, so the transient scale never skews engine picks.
          KEYED by doc generation: a switch remounts the whole canvas stack
          (engine + InfiniteCanvas + GL Canvas + ground) — see the ce memo. */}
      <div
        key={generation}
        style={{
          position: "absolute",
          inset: 0,
          transform: sheetOpen ? "scale(0.98)" : "scale(1)",
          transition: "transform 600ms var(--vf-ease-island)",
        }}
      >
        <InfiniteCanvas
          engine={ce}
          ground={groundFactory}
          grid={effectiveGrid}
          glRoute={glRoute}
          onReady={onReady}
          className="field-canvas"
        >
          {/* Canvas pointerEvents none is LOAD-BEARING (glboard precedent):
              without it the R3F canvas swallows every pointer event over the
              whole viewport — DOM widgets lose hover/click while the engine
              keeps working via container bubbling (field report 2026-07-12). */}
          {gl !== null &&
            createPortal(
              <Canvas
                orthographic
                frameloop="never"
                gl={{ alpha: true, antialias: false }}
                style={{ pointerEvents: "none", position: "absolute", inset: 0 }}
              >
                <EnvLoader onTex={setEnvTex} />
                <GLViews
                  engine={ce.engine}
                  bridge={gl.bridge}
                  store={ce.runtime.store}
                  environment={envTex}
                  {...(showEcs ? { onFrameStats: onGlStats } : {})}
                />
              </Canvas>,
              gl.plane,
            )}
        </InfiniteCanvas>
      </div>
      {/* Chrome overlays sit OUTSIDE the recede wrapper — they never scale. */}
      <NavigationBreadcrumbs engine={ce} />
      <ZoomPill ce={ce} />
      {/* The file pill (B4): top-center — new doc, the editable name, and the
          morph-open docs explorer. */}
      <FilePill manager={manager} open={docsOpen} onOpenChange={setDocsOpen} />
      {/* Dark mode toggle (widgetlab position) — no-drag: it sits in the titlebar strip. */}
      <button
        type="button"
        onClick={toggleTheme}
        className="no-drag absolute top-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-500 shadow-lg transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {dark ? "☀" : "☾"}
      </button>
      <WidgetTray ce={ce} registry={registry} open={trayOpen} onOpenChange={setTrayOpen} />

      <button
        type="button"
        onClick={() => setShowSettings((s) => !s)}
        className={`${fabCls(showSettings)} bottom-4 left-4`}
        title="Settings"
      >
        ⚙
      </button>
      <button
        type="button"
        onClick={() => setShowEcs((s) => !s)}
        className={`${fabCls(showEcs)} bottom-4 right-16`}
        title="ECS Editor"
      >
        ▦
      </button>
      <button
        type="button"
        onClick={() => setShowInspector((s) => !s)}
        className={`${fabCls(showInspector)} bottom-4 right-4`}
        title="Inspector"
      >
        ✎
      </button>

      {showSettings && (
        <SettingsPanel
          engine={ce}
          gridConfig={gridConfig}
          onGridChange={setGridConfig}
          themeColors={themeColors}
          onThemeColorsChange={setThemeColors}
          overlapGlow={overlapGlow}
          onOverlapGlowChange={setOverlapGlow}
          overlapGlowThemeColors={overlapGlowThemeColors}
          onOverlapGlowThemeColorsChange={setOverlapGlowThemeColors}
          stressWidgetType="widgetlab.clock"
          onClose={() => setShowSettings(false)}
        />
      )}
      {showInspector && <InspectorPanel engine={ce} onClose={() => setShowInspector(false)} />}

      {/* The loading veil rides ABOVE all chrome — loading is modal (B4 §2). */}
      <LoadingVeil loading={docState.loading} />
    </div>
  );
}
