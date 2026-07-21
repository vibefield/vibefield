/**
 * Settings panel — ported from the v1 playground
 * (`../../../infinite-canvas/apps/playground/src/panels/SettingsPanel.tsx`).
 *
 * JSX + Tailwind are VERBATIM; only the engine calls changed for v3:
 *  - Grid / Theme / Overlap-Glow sections are CONTROLLED props (the App owns
 *    the state and pipes `gridConfig` into `<InfiniteCanvas grid>`; theme into
 *    CSS vars). `GridConfig` is `@ice/dom`'s and maps field-for-field to v1's.
 *  - Zoom Range wires to the live `CameraLimits` resource via
 *    `writeRuntimeResource` (the sanctioned runtime-resource write).
 *  - Zoom-to-Fit / Exit-Layer go through `ce.ops` / `ce.nav`.
 *  - Stress Test spawns through `ce.ops.spawnWidget` (needs a doc + a widget
 *    type; the App passes `stressWidgetType`).
 *
 * NO v3 SEAM (kept as UI, reported):
 *  - "Breakpoint Thresholds": v3 has no live breakpoint-config resource (the
 *    LOD system uses reviewed constants). The inputs edit LOCAL state only.
 *  - "Overlap Glow": v3 has no GL glow pass. The whole section forwards to app
 *    state whose consumer would be a future CSS-level adaptation in the App.
 */
import {
  CameraLimits,
  type CanvasEngine,
  defineQuery,
  type Entity,
  type GridConfig,
  guardedTransaction,
  Opacity,
  PrefabId,
  SnapConfig,
  widgets,
  writeRuntimeResource,
} from "@vibecook/ice";
import { useState } from "react";
import { SystemSection } from "./SystemSection";
import type { OverlapGlowConfig, OverlapGlowThemeColors, ThemeColors } from "./types";

interface SettingsPanelProps {
  engine: CanvasEngine;
  gridConfig: GridConfig;
  onGridChange: (config: GridConfig) => void;
  themeColors: ThemeColors;
  onThemeColorsChange: (colors: ThemeColors) => void;
  overlapGlow: OverlapGlowConfig;
  onOverlapGlowChange: (config: OverlapGlowConfig) => void;
  overlapGlowThemeColors: OverlapGlowThemeColors;
  onOverlapGlowThemeColorsChange: (colors: OverlapGlowThemeColors) => void;
  /**
   * v3 addition: the widget type the Stress Test spawns. v1 built raw entities
   * with `engine.createEntity`; v3 has no such path — spawns go through
   * `ce.ops.spawnWidget(type, …)`, which needs a registered type + a doc. The
   * App (which owns the widget catalog) supplies it; absent ⇒ buttons disabled.
   */
  stressWidgetType?: string;
  onClose: () => void;
}

// Every prefab-spawned entity; filtered to registered widget types below.
const widgetQ = defineQuery([PrefabId]);

const inputCls =
  "w-full rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-right dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200";
// Exported: sibling panel SECTIONS (SystemSection — diagnostics live inside
// Settings, never as pages) share the vocabulary instead of redeclaring it.
export const labelCls = "text-neutral-400 dark:text-neutral-500";
export const sectionCls = "mb-1 text-neutral-400 dark:text-neutral-500";
export const borderCls = "border-t border-neutral-100 pt-2 dark:border-neutral-700";
const btnCls =
  "flex-1 rounded bg-neutral-100 py-1 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700";

export function SettingsPanel({
  engine,
  gridConfig,
  onGridChange,
  themeColors,
  onThemeColorsChange,
  overlapGlow,
  onOverlapGlowChange,
  overlapGlowThemeColors,
  onOverlapGlowThemeColorsChange,
  stressWidgetType,
  onClose,
}: SettingsPanelProps) {
  const camLimits = engine.world.getResource(CameraLimits);

  const [minZoom, setMinZoom] = useState(camLimits?.minZoom ?? 0.1);
  const [maxZoom, setMaxZoom] = useState(camLimits?.maxZoom ?? 4);
  // Breakpoint thresholds: NO v3 live-config resource — local-state only (see
  // file header). Seeded with sane v1-shaped defaults so the UI is populated.
  const [bpMicro, setBpMicro] = useState(80);
  const [bpCompact, setBpCompact] = useState(160);
  const [bpNormal, setBpNormal] = useState(320);
  const [bpExpanded, setBpExpanded] = useState(640);
  const [glowOpen, setGlowOpen] = useState(false);

  function setGlow<K extends keyof OverlapGlowConfig>(key: K, value: OverlapGlowConfig[K]) {
    onOverlapGlowChange({ ...overlapGlow, [key]: value });
  }
  function setGlowTuple<K extends keyof OverlapGlowConfig>(key: K, index: number, value: number) {
    const arr = [...(overlapGlow[key] as number[])];
    arr[index] = value;
    onOverlapGlowChange({ ...overlapGlow, [key]: arr });
  }

  // Live-tune the zoom clamp (v1 wrote ZoomConfigResource; v3's mirror is the
  // CameraLimits runtime resource, camera-sim consumes it next frame).
  const applyZoom = () => {
    writeRuntimeResource(engine.world, CameraLimits, { minZoom, maxZoom });
  };

  // Snapping — the SnapConfig runtime resource (CameraLimits pattern): the
  // snapSystem reads it next frame, so the toggle/threshold are live mid-drag.
  const snapCfg = engine.world.getResource(SnapConfig);
  const [snapEnabled, setSnapEnabled] = useState(snapCfg?.enabled ?? true);
  const [snapThreshold, setSnapThreshold] = useState(snapCfg?.thresholdPx ?? 5);
  const applySnap = (enabled: boolean, thresholdPx: number) => {
    setSnapEnabled(enabled);
    setSnapThreshold(thresholdPx);
    writeRuntimeResource(engine.world, SnapConfig, { enabled, thresholdPx });
  };

  const [cardOpacity, setCardOpacity] = useState(1);
  // All-cards durable Opacity write: one guardedTransaction over every spawned
  // widget. The dom host reflects it as `style.opacity`; a gl card fades via
  // its composite quad's `uOpacity` (+ its DOM chrome through the same host
  // path). `undoable: false` — a slider drag is a stream of txs, not edits the
  // user expects ⌘Z to unwind one notch at a time.
  const applyCardOpacity = (a: number) => {
    setCardOpacity(a);
    const session = engine.docs.current();
    if (session === undefined || session.readOnly) return;
    const world = engine.world;
    const targets: Entity[] = [];
    world.query(widgetQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        const type = world.get(e, PrefabId)?.id;
        if (typeof type === "string" && widgets.get(type) !== undefined) targets.push(e);
      }
    });
    guardedTransaction(
      session.store,
      world,
      (tx) => {
        for (const e of targets) {
          if (world.get(e, Opacity) === undefined) tx.addComponent(e, Opacity, { a });
          else tx.edit(e).set(Opacity, { a });
        }
      },
      { undoable: false },
    );
  };

  // Helper to update a grid field
  function setGrid<K extends keyof GridConfig>(key: K, value: GridConfig[K]) {
    onGridChange({ ...gridConfig, [key]: value });
  }

  // Helper to update one element of a tuple field
  function setGridTuple<K extends keyof GridConfig>(key: K, index: number, value: number) {
    const arr = [...(gridConfig[key] as number[])];
    arr[index] = value;
    onGridChange({ ...gridConfig, [key]: arr as never });
  }

  const stressDisabled = stressWidgetType === undefined;

  return (
    <div className="absolute bottom-14 left-4 z-50 w-72 max-h-[80vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white/95 shadow-lg backdrop-blur-sm font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-300">
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-700">
        <span className="font-semibold text-neutral-700 dark:text-neutral-200">Settings</span>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        >
          x
        </button>
      </div>

      <div className="space-y-3 p-3">
        {/* Zoom limits */}
        <div>
          <div className={sectionCls}>Zoom Range</div>
          <div className="flex gap-2">
            <label className="flex flex-1 items-center gap-1">
              <span className={labelCls}>min</span>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={minZoom}
                onChange={(e) => setMinZoom(Number(e.target.value))}
                onBlur={applyZoom}
              />
            </label>
            <label className="flex flex-1 items-center gap-1">
              <span className={labelCls}>max</span>
              <input
                type="number"
                step="0.1"
                className={inputCls}
                value={maxZoom}
                onChange={(e) => setMaxZoom(Number(e.target.value))}
                onBlur={applyZoom}
              />
            </label>
          </div>
        </div>

        {/* Snapping — live SnapConfig writes; guides render at P0 (ground). */}
        <div>
          <div className={sectionCls}>Snapping</div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={(e) => applySnap(e.target.checked, snapThreshold)}
              />
              <span className={labelCls}>enabled (drag cards near each other)</span>
            </label>
            <label className="flex items-center gap-2">
              <span className={`w-10 ${labelCls}`}>range</span>
              <input
                type="range"
                min="1"
                max="20"
                step="1"
                className="flex-1 accent-neutral-600 dark:accent-neutral-300"
                value={snapThreshold}
                onChange={(e) => applySnap(snapEnabled, Number(e.target.value))}
              />
              <span className="w-10 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                {snapThreshold}px
              </span>
            </label>
          </div>
        </div>

        {/* Card opacity — the durable Opacity cell on EVERY widget (design-004
            §3: `{opacity}` is the whole per-widget composite fact). */}
        <div>
          <div className={sectionCls}>Card Opacity (all widgets)</div>
          <label className="flex items-center gap-2">
            <span className={`w-10 ${labelCls}`}>alpha</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              className="flex-1 accent-neutral-600 dark:accent-neutral-300"
              value={cardOpacity}
              onChange={(e) => applyCardOpacity(Number(e.target.value))}
            />
            <span className="w-10 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
              {cardOpacity.toFixed(2)}
            </span>
          </label>
        </div>

        {/* Breakpoint thresholds — NO v3 seam; local state only (reported). */}
        <div>
          <div className={sectionCls}>Breakpoint Thresholds (screen px)</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["micro", bpMicro, setBpMicro],
                ["compact", bpCompact, setBpCompact],
                ["normal", bpNormal, setBpNormal],
                ["expanded", bpExpanded, setBpExpanded],
              ] as const
            ).map(([label, val, set]) => (
              <label key={label} className="flex items-center gap-1">
                <span className={`w-14 ${labelCls}`}>{label}</span>
                <input
                  type="number"
                  className={inputCls}
                  value={val}
                  onChange={(e) => (set as (v: number) => void)(Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Grid: Spacings */}
        <div className={borderCls}>
          <div className={sectionCls}>Grid Spacings (world px)</div>
          <div className="flex gap-1.5">
            {(["fine", "medium", "coarse"] as const).map((label, i) => (
              <label key={label} className="flex flex-1 flex-col items-center gap-0.5">
                <span className={labelCls}>{label}</span>
                <input
                  type="number"
                  step="1"
                  className={inputCls}
                  value={gridConfig.spacings[i]}
                  onChange={(e) => setGridTuple("spacings", i, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Grid: Dot Appearance */}
        <div>
          <div className={sectionCls}>Dot Appearance</div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2">
              <span className={`w-10 ${labelCls}`}>size</span>
              <input
                type="range"
                min="0"
                max="3"
                step="0.05"
                className="flex-1 accent-neutral-600 dark:accent-neutral-300"
                value={gridConfig.dotRadius[0]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  // Lock min and max together — Freeform/FigJam use
                  // constant-size dots. Advanced users can still set
                  // them independently via the `grid` prop on
                  // InfiniteCanvas.
                  onGridChange({ ...gridConfig, dotRadius: [v, v] });
                }}
              />
              <span className="w-10 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                {gridConfig.dotRadius[0].toFixed(2)}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <span className={`w-10 ${labelCls}`}>alpha</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                className="flex-1 accent-neutral-600 dark:accent-neutral-300"
                value={gridConfig.dotAlpha}
                onChange={(e) => setGrid("dotAlpha", Number(e.target.value))}
              />
              <span className="w-10 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                {gridConfig.dotAlpha.toFixed(2)}
              </span>
            </label>
          </div>
        </div>

        {/* Theme colors — dot + bg, split per theme */}
        <div className={borderCls}>
          <div className={sectionCls}>Theme Colors</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["dot · light", "dotLight"],
                ["dot · dark", "dotDark"],
                ["bg · light", "bgLight"],
                ["bg · dark", "bgDark"],
              ] as const
            ).map(([label, key]) => (
              <label
                key={key}
                className="flex items-center gap-1.5 rounded border border-neutral-200 bg-neutral-50 px-1.5 py-1 dark:border-neutral-600 dark:bg-neutral-800"
              >
                <input
                  type="color"
                  className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                  value={themeColors[key]}
                  onChange={(e) => onThemeColorsChange({ ...themeColors, [key]: e.target.value })}
                />
                <span className={`flex-1 ${labelCls}`}>{label}</span>
                <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                  {themeColors[key].toUpperCase()}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Grid: Fade Curve */}
        <div>
          <div className={sectionCls}>Fade Curve (CSS px)</div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex items-center gap-1">
              <span className={`w-12 ${labelCls}`}>in start</span>
              <input
                type="number"
                step="1"
                className={inputCls}
                value={gridConfig.fadeIn[0]}
                onChange={(e) => setGridTuple("fadeIn", 0, Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-1">
              <span className={`w-12 ${labelCls}`}>in end</span>
              <input
                type="number"
                step="1"
                className={inputCls}
                value={gridConfig.fadeIn[1]}
                onChange={(e) => setGridTuple("fadeIn", 1, Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-1">
              <span className={`w-12 ${labelCls}`}>out start</span>
              <input
                type="number"
                step="10"
                className={inputCls}
                value={gridConfig.fadeOut[0]}
                onChange={(e) => setGridTuple("fadeOut", 0, Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-1">
              <span className={`w-12 ${labelCls}`}>out end</span>
              <input
                type="number"
                step="10"
                className={inputCls}
                value={gridConfig.fadeOut[1]}
                onChange={(e) => setGridTuple("fadeOut", 1, Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        {/* Grid: Level Weights */}
        <div>
          <div className={sectionCls}>Level Weight</div>
          <div className="flex gap-2">
            <label className="flex flex-1 items-center gap-1">
              <span className={labelCls}>base</span>
              <input
                type="number"
                step="0.1"
                className={inputCls}
                value={gridConfig.levelWeight[0]}
                onChange={(e) => setGridTuple("levelWeight", 0, Number(e.target.value))}
              />
            </label>
            <label className="flex flex-1 items-center gap-1">
              <span className={labelCls}>step</span>
              <input
                type="number"
                step="0.1"
                className={inputCls}
                value={gridConfig.levelWeight[1]}
                onChange={(e) => setGridTuple("levelWeight", 1, Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        {/* Overlap Glow — togglable. NO v3 GL glow pass: this whole section
            forwards to app state with no engine consumer today (reported). */}
        <div className={borderCls}>
          <button
            type="button"
            onClick={() => setGlowOpen((v) => !v)}
            className="flex w-full items-center justify-between text-left text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            aria-expanded={glowOpen}
          >
            <span>Overlap Glow {glowOpen ? "▾" : "▸"}</span>
            <span className="text-neutral-400 dark:text-neutral-600">
              {glowOpen ? "collapse" : "expand"}
            </span>
          </button>
          {glowOpen && (
            <div className="mt-2 space-y-3">
              {/* Theme-aware colors — 4 pickers */}
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ["glow · light", "glowLight"],
                    ["glow · dark", "glowDark"],
                    ["rim · light", "rimLight"],
                    ["rim · dark", "rimDark"],
                  ] as const
                ).map(([label, key]) => (
                  <label
                    key={key}
                    className="flex items-center gap-1.5 rounded border border-neutral-200 bg-neutral-50 px-1.5 py-1 dark:border-neutral-600 dark:bg-neutral-800"
                  >
                    <input
                      type="color"
                      className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                      value={overlapGlowThemeColors[key]}
                      onChange={(e) =>
                        onOverlapGlowThemeColorsChange({
                          ...overlapGlowThemeColors,
                          [key]: e.target.value,
                        })
                      }
                    />
                    <span className={`flex-1 ${labelCls}`}>{label}</span>
                    <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                      {overlapGlowThemeColors[key].toUpperCase()}
                    </span>
                  </label>
                ))}
              </div>

              {/* Glow + rim params (candidate vs target). Glow alpha /
                  falloff control the inner radial; rim alpha controls
                  the edge highlight; rim width is shared. */}
              <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1.5">
                <span className={`w-16 ${labelCls}`} />
                <span className={`text-center ${labelCls}`}>candidate</span>
                <span className={`text-center ${labelCls}`}>target</span>

                <span className={`w-16 ${labelCls}`}>glow α</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.02}
                  className={inputCls}
                  value={overlapGlow.glowAlpha[0]}
                  onChange={(e) => setGlowTuple("glowAlpha", 0, Number(e.target.value))}
                />
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.02}
                  className={inputCls}
                  value={overlapGlow.glowAlpha[1]}
                  onChange={(e) => setGlowTuple("glowAlpha", 1, Number(e.target.value))}
                />

                <span className={`w-16 ${labelCls}`}>size px</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={2}
                  className={inputCls}
                  value={overlapGlow.glowSize[0]}
                  onChange={(e) => setGlowTuple("glowSize", 0, Number(e.target.value))}
                />
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={2}
                  className={inputCls}
                  value={overlapGlow.glowSize[1]}
                  onChange={(e) => setGlowTuple("glowSize", 1, Number(e.target.value))}
                />

                <span className={`w-16 ${labelCls}`}>rim α</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.02}
                  className={inputCls}
                  value={overlapGlow.rimAlpha[0]}
                  onChange={(e) => setGlowTuple("rimAlpha", 0, Number(e.target.value))}
                />
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.02}
                  className={inputCls}
                  value={overlapGlow.rimAlpha[1]}
                  onChange={(e) => setGlowTuple("rimAlpha", 1, Number(e.target.value))}
                />
              </div>

              <div className="flex gap-2">
                <label className="flex flex-1 items-center gap-1">
                  <span className={`w-16 ${labelCls}`}>rim width</span>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    step={0.1}
                    className={inputCls}
                    value={overlapGlow.rimWidth}
                    onChange={(e) => setGlow("rimWidth", Number(e.target.value))}
                  />
                </label>
                <label className="flex flex-1 items-center gap-1">
                  <span className={`w-16 ${labelCls}`}>rim radius</span>
                  <input
                    type="number"
                    min={50}
                    max={2000}
                    step={20}
                    className={inputCls}
                    value={overlapGlow.rimRadius}
                    onChange={(e) => setGlow("rimRadius", Number(e.target.value))}
                  />
                </label>
              </div>

              <button
                type="button"
                className={btnCls}
                onClick={() => {
                  onOverlapGlowChange({
                    glowColor: [0.5, 0.5, 0.5],
                    glowAlpha: [0.25, 0.45],
                    glowSize: [60, 80],
                    rimColor: [0.5, 0.5, 0.5],
                    rimWidth: 1.5,
                    rimAlpha: [0.55, 0.85],
                    rimRadius: 600,
                  });
                  onOverlapGlowThemeColorsChange({
                    glowLight: "#808080",
                    glowDark: "#FFFFFF",
                    rimLight: "#808080",
                    rimDark: "#FFFFFF",
                  });
                }}
              >
                Reset to defaults
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className={`flex gap-2 ${borderCls}`}>
          <button
            type="button"
            className={btnCls}
            onClick={() => {
              engine.ops.zoomToFit();
            }}
          >
            Zoom to Fit
          </button>
          <button
            type="button"
            className={btnCls}
            onClick={() => {
              if (engine.nav.depth() > 0) {
                engine.ops.exitContainer();
              }
            }}
          >
            Exit Layer
          </button>
        </div>

        {/* Stress Test */}
        <div className={borderCls}>
          <div className={sectionCls}>Stress Test</div>
          <div className="flex gap-2">
            {[50, 200, 500].map((count) => (
              <button
                key={count}
                type="button"
                disabled={stressDisabled}
                className="flex-1 rounded bg-orange-50 py-1 text-orange-600 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-orange-950 dark:text-orange-400 dark:hover:bg-orange-900"
                onClick={() => {
                  // v1 built raw entities inline; v3 spawns through the paved
                  // op, which needs a doc + a registered widget type.
                  if (stressWidgetType === undefined || engine.docs.current() === undefined) return;
                  const cols = Math.ceil(Math.sqrt(count));
                  for (let i = 0; i < count; i++) {
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    engine.ops.spawnWidget(stressWidgetType, {
                      x: col * 270 + Math.random() * 20 - 10,
                      y: row * 200 + Math.random() * 20 - 10,
                    });
                  }
                  engine.ops.zoomToFit();
                }}
              >
                +{count}
              </button>
            ))}
          </div>
        </div>

        {/* System diagnostics — sections, never pages (2026-07-21). */}
        <SystemSection />
      </div>
    </div>
  );
}
