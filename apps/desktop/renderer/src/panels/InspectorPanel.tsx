/**
 * Inspector / metrics HUD — ported from the v1 playground
 * (`../../../infinite-canvas/apps/playground/src/panels/InspectorPanel.tsx`).
 *
 * NOTE: despite the name, the v1 panel is a global metrics + profiler HUD — it
 * does NOT inspect/edit the selected widget's props. So the widget-prop seams
 * (`useWidgetProps`/`useCommit`/`Position`/`Size`) don't apply here; they'd be
 * for a per-widget property inspector that v1 never had. Reported.
 *
 * Presentational parts (Row / BudgetBar / StackedBudgetBar / LegendDot + the
 * ms/big/bytes formatters) are VERBATIM. Metric wiring changed for v3:
 *  - entity counts → `world.count(query)` (v3 exposes no total-entity count, so
 *    "entities" counts prefab-spawned widgets — see prefabQ, reported);
 *  - camera → the `Camera` resource; nav depth/container → `ce.nav` /
 *    `currentNavFrame`; undo flags → the `DurableUndoStatus` resource.
 *
 * Profiler: v3 has NO v1-style profiler (`ProfilerStats`: layered ECS/WebGL/R3F
 * with windowed percentiles, GPU + compositor counters). It exposes only
 * per-frame engine telemetry (`ce.engine.enableTelemetry()` + `lastFrame()`).
 * The toggle arms that telemetry and the section renders the ECS-tick layer
 * from the LAST frame (single-sample: avg = p50 = p95, from real µs); the
 * WebGL and R3F layers have no source and stay empty (`sampleCount: 0`). The
 * local `ProfilerStats` type below mirrors v1's shape so the JSX is verbatim.
 */
import {
  Active,
  Camera,
  type CanvasEngine,
  currentNavFrame,
  DurableUndoStatus,
  defineQuery,
  PrefabId,
  Selected,
  Visible,
} from "@vibecook/ice";
import { useEffect, useState } from "react";

interface InspectorPanelProps {
  engine: CanvasEngine;
  onClose: () => void;
}

// --- local ProfilerStats shape (mirrors v1 so the JSX below is verbatim) -----

interface FrameTimeStats {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}
interface EcsLayer {
  sampleCount: number;
  fps: number;
  budgetUsed: number;
  frameTime: FrameTimeStats;
  systemAvg: Record<string, number>;
  systemP95: Record<string, number>;
}
interface WebglLayer {
  sampleCount: number;
  fps: number;
  budgetUsed: number;
  frameTime: FrameTimeStats;
  gridAvg: number;
  gridP95: number;
  selectionAvg: number;
  selectionP95: number;
  avgDrawCalls: number;
  avgTriangles: number;
  avgSelectionFrames: number;
  avgSnapGuides: number;
  avgDomUpdates: number;
}
interface R3fLayer {
  sampleCount: number;
  fps: number;
  frameTime: FrameTimeStats;
  avgDrawCalls: number;
  avgTriangles: number;
  activeWidgets: number;
  programs: number;
  geometries: number;
  textures: number;
  avgWidgetsRepainted: number;
  fboBytes: number;
  phases: { hot: number; warm: number; waking: number; cold: number; dormant: number };
  avgGpuPaintMs?: number;
  avgGpuCompositeMs?: number;
}
interface ProfilerStats {
  ecs: EcsLayer;
  webgl: WebglLayer;
  r3f: R3fLayer;
}

interface Metrics {
  totalEntities: number;
  activeEntities: number;
  visibleEntities: number;
  selectedEntities: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  navDepth: number;
  activeContainer: number | null;
  canUndo: boolean;
  canRedo: boolean;
  profilerEnabled: boolean;
  stats: ProfilerStats | null;
}

// v3 exposes no total-entity count on World — count prefab-spawned widgets as
// the closest honest proxy (chrome/pointer/nav-entry entities excluded).
const prefabQ = defineQuery([PrefabId]);
const activeQ = defineQuery([Active]);
// `Visible` is a subset of `Active` by catalog invariant (Active = Visible ⊕
// Culled), so a bare `[Visible]` count IS the in-viewport count.
const visibleQ = defineQuery([Visible]);
const selectedQ = defineQuery([Selected]);

const EMPTY_FRAME_TIME: FrameTimeStats = { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
const EMPTY_WEBGL: WebglLayer = {
  sampleCount: 0,
  fps: 0,
  budgetUsed: 0,
  frameTime: EMPTY_FRAME_TIME,
  gridAvg: 0,
  gridP95: 0,
  selectionAvg: 0,
  selectionP95: 0,
  avgDrawCalls: 0,
  avgTriangles: 0,
  avgSelectionFrames: 0,
  avgSnapGuides: 0,
  avgDomUpdates: 0,
};
const EMPTY_R3F: R3fLayer = {
  sampleCount: 0,
  fps: 0,
  frameTime: EMPTY_FRAME_TIME,
  avgDrawCalls: 0,
  avgTriangles: 0,
  activeWidgets: 0,
  programs: 0,
  geometries: 0,
  textures: 0,
  avgWidgetsRepainted: 0,
  fboBytes: 0,
  phases: { hot: 0, warm: 0, waking: 0, cold: 0, dormant: 0 },
};

/** Build a v1-shaped `ProfilerStats` from the last frame's engine telemetry. */
function readTelemetry(engine: CanvasEngine): ProfilerStats | null {
  const frame = engine.engine.lastFrame();
  if (frame === undefined) return null;
  const ecsMs = frame.totalMicros / 1000;
  // Single frame ⇒ every "percentile" IS this frame (labelled honestly above).
  const frameTime: FrameTimeStats = { avg: ecsMs, p50: ecsMs, p95: ecsMs, p99: ecsMs, max: ecsMs };
  const systemAvg: Record<string, number> = {};
  const systemP95: Record<string, number> = {};
  for (const s of frame.systems) {
    if (!s.ran) continue;
    systemAvg[s.system] = s.micros / 1000;
    systemP95[s.system] = s.micros / 1000;
  }
  return {
    ecs: {
      sampleCount: 1,
      fps: ecsMs > 0 ? Math.round(1000 / ecsMs) : 0,
      budgetUsed: (ecsMs / 16.67) * 100,
      frameTime,
      systemAvg,
      systemP95,
    },
    webgl: EMPTY_WEBGL,
    r3f: EMPTY_R3F,
  };
}

const sectionCls =
  "mb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider dark:text-neutral-600";

const ms = (v: number) => (v < 0.01 ? "<0.01" : v.toFixed(2));
const big = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(2)}M`
    : v >= 1_000
      ? `${(v / 1_000).toFixed(1)}k`
      : `${Math.round(v)}`;
const bytes = (v: number) =>
  v >= 1024 * 1024
    ? `${(v / (1024 * 1024)).toFixed(1)} MB`
    : v >= 1024
      ? `${(v / 1024).toFixed(1)} KB`
      : `${v} B`;

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-400 dark:text-neutral-500">{label}</span>
      <span className="text-neutral-600 dark:text-neutral-300">{value}</span>
    </div>
  );
}

function BudgetBar({ percent, label }: { percent: number; label: string }) {
  const color =
    percent < 50
      ? { text: "text-green-600 dark:text-green-400", bg: "bg-green-500" }
      : percent < 80
        ? { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500" }
        : { text: "text-red-600 dark:text-red-400", bg: "bg-red-500" };
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-neutral-400 dark:text-neutral-500">{label}</span>
        <span className={`font-medium ${color.text}`}>{percent.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color.bg}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Stacked frame-budget bar: three segments scaled to the 16.67ms budget.
 * ECS and WebGL are direct work measurements; "R3F + idle" is the residual
 * frame interval left after subtracting engine work — it lumps together R3F
 * rendering, browser paint, and vsync idle, but gives an honest sense of
 * where time in a 60fps frame is going.
 */
function StackedBudgetBar({
  ecsMs,
  webglMs,
  r3fMs,
}: {
  ecsMs: number;
  webglMs: number;
  r3fMs: number;
}) {
  const BUDGET = 16.67;
  // r3f.frameTime includes the full rAF interval at 60fps ≈ 16.67ms, so the
  // residual (frame minus engine work) is the closest honest proxy for R3F
  // rendering + browser paint + idle.
  const r3fResidual = Math.max(0, r3fMs - ecsMs - webglMs);
  const pct = (v: number) => (v / BUDGET) * 100;
  const ecsPct = pct(ecsMs);
  const webglPct = pct(webglMs);
  const r3fPct = pct(r3fResidual);
  const totalPct = ecsPct + webglPct + r3fPct;
  const totalMs = ecsMs + webglMs + r3fResidual;
  const over = totalPct > 100;
  const rawEcs = Math.min(100, ecsPct);
  const rawWebgl = Math.min(100, webglPct);
  const rawR3f = Math.min(100, Math.max(0, 100 - rawEcs - rawWebgl));
  const vUsed = over ? rawEcs + rawWebgl + Math.min(100 - rawEcs - rawWebgl, r3fPct) : null;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-neutral-400 dark:text-neutral-500">total budget (16.67ms)</span>
        <span
          className={`font-medium ${
            over
              ? "text-red-600 dark:text-red-400"
              : totalPct > 80
                ? "text-amber-600 dark:text-amber-400"
                : "text-green-600 dark:text-green-400"
          }`}
        >
          {ms(totalMs)} ms · {totalPct.toFixed(1)}%
        </span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div
          className="h-full bg-orange-500 transition-all"
          style={{ width: `${rawEcs}%` }}
          title={`ECS: ${ms(ecsMs)}ms`}
        />
        <div
          className="h-full bg-sky-500 transition-all"
          style={{ width: `${rawWebgl}%` }}
          title={`Engine WebGL: ${ms(webglMs)}ms`}
        />
        <div
          className="h-full bg-violet-500 transition-all"
          style={{ width: `${over ? 0 : rawR3f}%` }}
          title={`R3F + idle: ${ms(r3fResidual)}ms`}
        />
      </div>
      {/* Legend */}
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]">
        <LegendDot color="bg-orange-500" label="ECS" value={`${ms(ecsMs)}ms`} />
        <LegendDot color="bg-sky-500" label="WebGL" value={`${ms(webglMs)}ms`} />
        <LegendDot color="bg-violet-500" label="R3F+idle" value={`${ms(r3fResidual)}ms`} />
      </div>
      {over && vUsed !== null && (
        <div className="mt-1 text-[9px] text-red-600 dark:text-red-400">
          over budget — frame exceeds 16.67ms
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />
      {label} <span className="tabular-nums">{value}</span>
    </span>
  );
}

export function InspectorPanel({ engine, onClose }: InspectorPanelProps) {
  const [telemetryOn, setTelemetryOn] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>({
    totalEntities: 0,
    activeEntities: 0,
    visibleEntities: 0,
    selectedEntities: 0,
    cameraX: 0,
    cameraY: 0,
    cameraZoom: 1,
    navDepth: 0,
    activeContainer: null,
    canUndo: false,
    canRedo: false,
    profilerEnabled: false,
    stats: null,
  });

  useEffect(() => {
    const read = () => {
      const camera = engine.world.getResource(Camera);
      const undo = engine.world.getResource(DurableUndoStatus);
      const frame = currentNavFrame(engine.world);
      setMetrics({
        totalEntities: engine.world.count(prefabQ),
        activeEntities: engine.world.count(activeQ),
        visibleEntities: engine.world.count(visibleQ),
        selectedEntities: engine.world.count(selectedQ),
        cameraX: camera?.x ?? 0,
        cameraY: camera?.y ?? 0,
        cameraZoom: camera?.zoom ?? 1,
        navDepth: engine.nav.depth(),
        activeContainer: frame === undefined ? null : Number(frame),
        canUndo: undo?.canUndo ?? false,
        canRedo: undo?.canRedo ?? false,
        profilerEnabled: telemetryOn,
        stats: telemetryOn ? readTelemetry(engine) : null,
      });
    };
    read();
    const interval = setInterval(read, 200);
    return () => clearInterval(interval);
  }, [engine, telemetryOn]);

  const stats = metrics.stats;

  return (
    <div className="absolute bottom-14 right-4 z-50 w-72 max-h-[85vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white/95 shadow-lg backdrop-blur-sm font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-300">
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-700">
        <span className="font-semibold text-neutral-700 dark:text-neutral-200">Inspector</span>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        >
          x
        </button>
      </div>

      <div className="space-y-2 p-3">
        {/* ECS entities */}
        <div>
          <div className={sectionCls}>ECS</div>
          <Row label="entities" value={metrics.totalEntities} />
          <Row label="active" value={metrics.activeEntities} />
          <Row label="visible" value={metrics.visibleEntities} />
          <Row label="selected" value={metrics.selectedEntities} />
        </div>

        {/* Camera */}
        <div>
          <div className={sectionCls}>Camera</div>
          <Row label="x" value={metrics.cameraX.toFixed(1)} />
          <Row label="y" value={metrics.cameraY.toFixed(1)} />
          <Row label="zoom" value={metrics.cameraZoom.toFixed(3)} />
        </div>

        {/* Navigation */}
        <div>
          <div className={sectionCls}>Navigation</div>
          <Row label="depth" value={metrics.navDepth} />
          <Row
            label="container"
            value={metrics.activeContainer !== null ? `e${metrics.activeContainer}` : "root"}
          />
        </div>

        {/* History */}
        <div>
          <div className={sectionCls}>History</div>
          <Row label="can undo" value={metrics.canUndo ? "yes" : "no"} />
          <Row label="can redo" value={metrics.canRedo ? "yes" : "no"} />
        </div>

        {/* Profiler toggle */}
        <div className="border-t border-neutral-100 pt-2 dark:border-neutral-700">
          <div className="flex items-center justify-between">
            <div className={sectionCls}>Performance</div>
            <button
              type="button"
              className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                metrics.profilerEnabled
                  ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              }`}
              onClick={() => {
                // Telemetry arming is ONE-WAY (idempotent, no disable); toggling
                // "off" just stops reading it. Arm on first enable.
                setTelemetryOn((on) => {
                  if (!on) engine.engine.enableTelemetry();
                  return !on;
                });
              }}
            >
              {metrics.profilerEnabled ? "ON" : "OFF"}
            </button>
          </div>
          <Row label="world tick" value={engine.world.tickCount} />
        </div>

        {/* Profiler stats */}
        {stats && (
          <>
            {/* === Total (combined) === */}
            {(stats.ecs.sampleCount > 0 || stats.r3f.sampleCount > 0) && (
              <div className="border-t border-neutral-100 pt-2 dark:border-neutral-700">
                <div className={`${sectionCls} text-neutral-700 dark:text-neutral-300`}>Total</div>
                <Row label="fps (rAF)" value={stats.r3f.fps > 0 ? stats.r3f.fps : stats.ecs.fps} />
                <Row
                  label="frame avg"
                  value={`${ms(stats.r3f.frameTime.avg || stats.ecs.frameTime.avg)} ms`}
                />
                <div className="mt-1.5">
                  <StackedBudgetBar
                    ecsMs={stats.ecs.frameTime.avg}
                    webglMs={stats.webgl.frameTime.avg}
                    r3fMs={stats.r3f.frameTime.avg}
                  />
                </div>
              </div>
            )}

            {/* === ECS tick layer === */}
            {stats.ecs.sampleCount > 0 && (
              <div className="border-t border-neutral-100 pt-2 dark:border-neutral-700">
                <div className={`${sectionCls} text-neutral-600 dark:text-neutral-400`}>
                  ECS Tick
                </div>
                <BudgetBar percent={stats.ecs.budgetUsed} label="budget (16.67ms)" />
                <div className="mt-1.5">
                  <Row label="fps" value={stats.ecs.fps} />
                  <Row label="avg" value={`${ms(stats.ecs.frameTime.avg)} ms`} />
                  <Row label="p50" value={`${ms(stats.ecs.frameTime.p50)} ms`} />
                  <Row label="p95" value={`${ms(stats.ecs.frameTime.p95)} ms`} />
                  <Row label="p99" value={`${ms(stats.ecs.frameTime.p99)} ms`} />
                  <Row label="max" value={`${ms(stats.ecs.frameTime.max)} ms`} />
                  <Row label="samples" value={stats.ecs.sampleCount} />
                </div>
                {Object.keys(stats.ecs.systemAvg).length > 0 && (
                  <div className="mt-1.5">
                    <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-300 dark:text-neutral-600">
                      systems (avg · p95)
                    </div>
                    <div className="space-y-0.5">
                      {Object.entries(stats.ecs.systemAvg)
                        .sort((a, b) => b[1] - a[1])
                        .map(([name, avg]) => (
                          <div key={name} className="flex justify-between">
                            <span className="text-neutral-400 dark:text-neutral-500 truncate mr-2">
                              {name}
                            </span>
                            <span className="text-neutral-600 dark:text-neutral-300 shrink-0">
                              {ms(avg)}{" "}
                              <span className="text-neutral-300 dark:text-neutral-600">
                                · {ms(stats.ecs.systemP95[name] ?? 0)}
                              </span>
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* === Engine WebGL layer === */}
            {stats.webgl.sampleCount > 0 && (
              <div className="border-t border-neutral-100 pt-2 dark:border-neutral-700">
                <div className={`${sectionCls} text-neutral-600 dark:text-neutral-400`}>
                  Engine WebGL
                </div>
                <BudgetBar percent={stats.webgl.budgetUsed} label="budget (16.67ms)" />
                <div className="mt-1.5">
                  <Row label="fps" value={stats.webgl.fps} />
                  <Row label="avg" value={`${ms(stats.webgl.frameTime.avg)} ms`} />
                  <Row label="p95" value={`${ms(stats.webgl.frameTime.p95)} ms`} />
                  <Row label="max" value={`${ms(stats.webgl.frameTime.max)} ms`} />
                </div>
                <div className="mt-1.5 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-300 dark:text-neutral-600">
                  pass time (avg · p95)
                </div>
                <Row
                  label="grid"
                  value={`${ms(stats.webgl.gridAvg)} · ${ms(stats.webgl.gridP95)} ms`}
                />
                <Row
                  label="selection"
                  value={`${ms(stats.webgl.selectionAvg)} · ${ms(stats.webgl.selectionP95)} ms`}
                />
                <div className="mt-1.5 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-300 dark:text-neutral-600">
                  gpu work (avg / tick)
                </div>
                <Row label="draw calls" value={stats.webgl.avgDrawCalls.toFixed(1)} />
                <Row label="triangles" value={big(stats.webgl.avgTriangles)} />
                <div className="mt-1.5 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-300 dark:text-neutral-600">
                  chrome (avg / tick)
                </div>
                <Row label="sel frames" value={stats.webgl.avgSelectionFrames.toFixed(1)} />
                <Row label="snap guides" value={stats.webgl.avgSnapGuides.toFixed(1)} />
                <Row label="dom updates" value={stats.webgl.avgDomUpdates.toFixed(1)} />
              </div>
            )}

            {/* === R3F layer === */}
            {stats.r3f.sampleCount > 0 && (
              <div className="border-t border-neutral-100 pt-2 dark:border-neutral-700">
                <div className={`${sectionCls} text-neutral-600 dark:text-neutral-400`}>
                  R3F Canvas
                </div>
                <BudgetBar
                  percent={(stats.r3f.frameTime.avg / 16.67) * 100}
                  label="budget (16.67ms)"
                />
                <div className="mt-1.5">
                  <Row label="fps" value={stats.r3f.fps} />
                  <Row label="avg" value={`${ms(stats.r3f.frameTime.avg)} ms`} />
                  <Row label="p95" value={`${ms(stats.r3f.frameTime.p95)} ms`} />
                  <Row label="max" value={`${ms(stats.r3f.frameTime.max)} ms`} />
                </div>
                <div className="mt-1.5 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-300 dark:text-neutral-600">
                  gpu work (avg / frame)
                </div>
                <Row label="draw calls" value={stats.r3f.avgDrawCalls.toFixed(1)} />
                <Row label="triangles" value={big(stats.r3f.avgTriangles)} />
                <div className="mt-1.5 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-300 dark:text-neutral-600">
                  scene (current)
                </div>
                <Row label="widgets" value={stats.r3f.activeWidgets} />
                <Row label="programs" value={stats.r3f.programs} />
                <Row label="geometries" value={stats.r3f.geometries} />
                <Row label="textures" value={stats.r3f.textures} />
                <Row label="samples" value={stats.r3f.sampleCount} />

                {/* === RFC-002 compositor metrics === */}
                <div className="mt-1.5 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-300 dark:text-neutral-600">
                  compositor
                </div>
                <Row label="repaints / frame" value={stats.r3f.avgWidgetsRepainted.toFixed(1)} />
                <Row label="fbo memory" value={bytes(stats.r3f.fboBytes)} />
                <div className="mt-1.5 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-300 dark:text-neutral-600">
                  phases
                </div>
                <Row label="hot" value={stats.r3f.phases.hot} />
                <Row label="warm" value={stats.r3f.phases.warm} />
                <Row label="waking" value={stats.r3f.phases.waking} />
                <Row label="cold" value={stats.r3f.phases.cold} />
                <Row label="dormant" value={stats.r3f.phases.dormant} />
                {stats.r3f.avgGpuPaintMs !== undefined && (
                  <>
                    <div className="mt-1.5 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-300 dark:text-neutral-600">
                      gpu (avg / frame)
                    </div>
                    <Row label="paint" value={`${ms(stats.r3f.avgGpuPaintMs)} ms`} />
                    {stats.r3f.avgGpuCompositeMs !== undefined && (
                      <Row label="composite" value={`${ms(stats.r3f.avgGpuCompositeMs)} ms`} />
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* Shortcuts */}
        <div className="border-t border-neutral-100 pt-2 text-[9px] text-neutral-300 space-y-0.5 dark:border-neutral-700 dark:text-neutral-600">
          <div>Cmd+Z undo / Cmd+Shift+Z redo</div>
          <div>Esc exit container / Del delete</div>
        </div>
      </div>
    </div>
  );
}
