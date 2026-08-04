import { CARD_BG } from "@vibefield/shell-ui";
import { type CSSProperties, type ReactElement, useState } from "react";

// TEMPORARY: an in-product surface lab for James's Godview visual pass. It is
// deliberately local state — no setting, storage key, contract, or synced doc.
// Once the chosen recipe moves into DESIGN.md + styles.css, delete this file and
// leave only the resulting CSS variables/defaults behind.

export const GODVIEW_BLEND_MODES = [
  "normal",
  "screen",
  "lighten",
  "plus-lighter",
  "multiply",
  "overlay",
  "soft-light",
  "color-dodge",
  "difference",
] as const;

export type GodviewBlendMode = (typeof GODVIEW_BLEND_MODES)[number];

export interface GodviewTuning {
  stageColor: string;
  stageOpacity: number;
  stageBlur: number;
  paneColor: string;
  paneOpacity: number;
  blendMode: GodviewBlendMode;
  canvasOpacity: number;
  brightness: number;
  contrast: number;
  saturation: number;
}

function tokenColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (resolved === "") return fallback;
  // A color input is a useful normalizer here: the source tokens are hex, and
  // the browser owns the exact lowercase six-digit value the control expects.
  const input = document.createElement("input");
  input.type = "color";
  input.value = resolved;
  return input.value;
}

export function defaultGodviewTuning(): GodviewTuning {
  return {
    stageColor: tokenColor("--vf-card", CARD_BG),
    stageOpacity: 92,
    stageBlur: 48,
    paneColor: tokenColor("--vf-card-deep", CARD_BG),
    paneOpacity: 0,
    blendMode: "screen",
    canvasOpacity: 100,
    brightness: 100,
    contrast: 100,
    saturation: 100,
  };
}

type GodviewTuningStyle = CSSProperties & Record<`--vf-godview-${string}`, string>;

/** Convert human-readable panel values into the variables styles.css consumes. */
export function godviewTuningStyle(value: GodviewTuning): GodviewTuningStyle {
  return {
    "--vf-godview-stage-color": value.stageColor,
    "--vf-godview-stage-opacity": `${value.stageOpacity}%`,
    "--vf-godview-stage-blur": `${value.stageBlur}px`,
    "--vf-godview-pane-color": value.paneColor,
    "--vf-godview-pane-opacity": `${value.paneOpacity}%`,
    "--vf-godview-terminal-blend-mode": value.blendMode,
    "--vf-godview-terminal-opacity": String(value.canvasOpacity / 100),
    "--vf-godview-terminal-brightness": `${value.brightness}%`,
    "--vf-godview-terminal-contrast": `${value.contrast}%`,
    "--vf-godview-terminal-saturation": `${value.saturation}%`,
  };
}

function RangeControl({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <label className="vf-godview-tuner-control">
      <span className="vf-godview-tuner-label">
        <span>{label}</span>
        <output>
          {value}
          {unit}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <label className="vf-godview-tuner-color">
      <span>{label}</span>
      <span className="vf-godview-tuner-color-value">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <output>{value}</output>
      </span>
    </label>
  );
}

export function GodviewTuningPanel({
  value,
  onChange,
  onReset,
}: {
  value: GodviewTuning;
  onChange: (patch: Partial<GodviewTuning>) => void;
  onReset: () => void;
}): ReactElement {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className="vf-godview-tuner"
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="Godview live surface tuning"
    >
      <header className="vf-godview-tuner-header">
        <span>
          <strong>Surface lab</strong>
          <small>temporary · live</small>
        </span>
        <span className="vf-godview-tuner-actions">
          <button type="button" onClick={onReset}>
            reset
          </button>
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? "show" : "hide"}
          </button>
        </span>
      </header>

      {!collapsed && (
        <div className="vf-godview-tuner-body">
          <fieldset>
            <legend>Stage</legend>
            <ColorControl
              label="color"
              value={value.stageColor}
              onChange={(stageColor) => onChange({ stageColor })}
            />
            <RangeControl
              label="opacity"
              value={value.stageOpacity}
              min={0}
              max={100}
              unit="%"
              onChange={(stageOpacity) => onChange({ stageOpacity })}
            />
            <RangeControl
              label="backdrop blur"
              value={value.stageBlur}
              min={0}
              max={80}
              unit="px"
              onChange={(stageBlur) => onChange({ stageBlur })}
            />
          </fieldset>

          <fieldset>
            <legend>Terminal background</legend>
            <ColorControl
              label="color"
              value={value.paneColor}
              onChange={(paneColor) => onChange({ paneColor })}
            />
            <RangeControl
              label="opacity"
              value={value.paneOpacity}
              min={0}
              max={100}
              unit="%"
              onChange={(paneOpacity) => onChange({ paneOpacity })}
            />
            <p>Background sits behind the canvas; screen and lighten reveal it.</p>
          </fieldset>

          <fieldset>
            <legend>Terminal canvas</legend>
            <label className="vf-godview-tuner-select">
              <span>blend mode</span>
              <select
                value={value.blendMode}
                onChange={(event) =>
                  onChange({ blendMode: event.currentTarget.value as GodviewBlendMode })
                }
              >
                {GODVIEW_BLEND_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
            <RangeControl
              label="opacity"
              value={value.canvasOpacity}
              min={0}
              max={100}
              unit="%"
              onChange={(canvasOpacity) => onChange({ canvasOpacity })}
            />
            <RangeControl
              label="brightness"
              value={value.brightness}
              min={0}
              max={200}
              unit="%"
              onChange={(brightness) => onChange({ brightness })}
            />
            <RangeControl
              label="contrast"
              value={value.contrast}
              min={0}
              max={200}
              unit="%"
              onChange={(contrast) => onChange({ contrast })}
            />
            <RangeControl
              label="saturation"
              value={value.saturation}
              min={0}
              max={200}
              unit="%"
              onChange={(saturation) => onChange({ saturation })}
            />
          </fieldset>
        </div>
      )}
    </aside>
  );
}
