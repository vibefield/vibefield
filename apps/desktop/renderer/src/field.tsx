import { Canvas, useThree } from "@react-three/fiber";
import { DEFAULT_GRID_CONFIG, type GridConfig, selectedEntities } from "@vibecook/ice";
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
import { InfiniteCanvas, type InfiniteCanvasHandle } from "@vibecook/ice/react";
import { spawnCommentAroundSelection } from "@vibefield/plugin-field-tools";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PMREMGenerator, type Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { installCursorHalo } from "./cursor";
import { buildRegistry, createFieldEngine } from "./field-engine";
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

// The Field (B2 + Track D1–D4): plugins' widgets → one canvas engine →
// InfiniteCanvas over the widgetlab ground, the GL island layer (bridge +
// pointer router + composite views), the cursor halo, the morphing island
// (WidgetTray) as the spawn door, and the diagnostics panels. Composition is
// widgetlab App.tsx, decomposed per design-03 (the engine/seed lives in
// field-engine.ts; the theme lives in the App header).

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

export function FieldView({ dark }: { dark: boolean }): ReactElement {
  const registry = useMemo(buildRegistry, []);
  const ce = useMemo(() => createFieldEngine(registry), [registry]);
  // The P0 ground layer (grid + wires + snap guides, one WebGPU canvas) —
  // memoized: a new factory identity re-boots the canvas mount effect.
  const groundFactory = useMemo(() => ground(), []);
  const [trayOpen, setTrayOpen] = useState(false);

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

  // GL tray previews (design-005 §2 P2): the r3f capture pipeline runs in
  // IDLE time — never on the boot path (the "cached after first capture"
  // contract). The environment is a FACTORY, built ON the capture renderer:
  // PMREM textures don't cross renderers (no CPU image — the main canvas's
  // envTex reads black there), so the capture mirrors EnvLoader instead.
  // Skip-if-captured + coalescing live in the capturer, so StrictMode
  // double-fires cost nothing.
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const kick = (): void => {
      captureWidgetPreviews({
        environment: (gl) => new PMREMGenerator(gl).fromScene(new RoomEnvironment(), 0.04).texture,
      }).catch((e) =>
        console.warn("[field] GL preview capture failed — tray tiles keep their fallback.", e),
      );
    };
    const idleId = w.requestIdleCallback?.(kick, { timeout: 4000 });
    const timerId = idleId === undefined ? window.setTimeout(kick, 1500) : undefined;
    return () => {
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, []);

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
  // upper and bottom cap"): frame the seeds once the viewport is measured and
  // membership has stamped the first tick.
  useEffect(() => {
    if (ce.ops.frameContent()) return;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (ce.ops.frameContent() || tries > 40) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [ce]);

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
          ratio-corrects, so the transient scale never skews engine picks. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: trayOpen ? "scale(0.98)" : "scale(1)",
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
    </div>
  );
}
