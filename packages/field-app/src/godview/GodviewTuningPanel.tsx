import { CARD_BG } from "@vibefield/shell-ui";
import { type CSSProperties, type ReactElement, useState } from "react";
import { type DeckAppearance, setDeckAppearance } from "./deck-appearance";

// TEMPORARY: an in-product surface lab for James's Godview visual pass. The
// STAGE values are deliberately local state — no setting, storage key, contract
// or synced doc. Once the chosen recipe moves into DESIGN.md + styles.css,
// delete this file and leave only the resulting CSS variables/defaults behind.
//
// GT-3v rebased it onto the real knobs. It was born over the screen-composite
// interim and half its controls existed to compensate for that trick: a blend
// mode, a canvas opacity, and brightness/contrast/saturation filters over the
// terminal canvas. 0.9.0 makes the pane transparent in the RENDERER, so there
// is nothing left to compensate and those controls are gone with the mechanism.
//
// The pane opacity survived, but it is no longer this panel's own value: it
// writes the viewer's real appearance (`deck-appearance.ts`), the same value
// Settings → Terminal edits and the deck renders. A lab slider holding a second
// pane opacity beside the product's would be exactly the duplicate authority
// this slice deleted everywhere else — so what remains here is a live handle on
// the one truth, not a copy of it.

export interface GodviewTuning {
  stageColor: string;
  stageOpacity: number;
  stageBlur: number;
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

/** DESIGN.md §5's Sheet tier — `surface /90` + `backdrop-blur-3xl` — which is
 * the material a full-stage panel takes. The overlay was tuned to 92%/48px over
 * the composited stack; the ground beneath it has changed, so the defaults go
 * back to the documented recipe and the lab reaches the rest. */
export function defaultGodviewTuning(): GodviewTuning {
  return {
    stageColor: tokenColor("--vf-card", CARD_BG),
    stageOpacity: 90,
    stageBlur: 64,
  };
}

type GodviewTuningStyle = CSSProperties & Record<`--vf-godview-${string}`, string>;

/** Convert human-readable panel values into the variables styles.css consumes. */
export function godviewTuningStyle(value: GodviewTuning): GodviewTuningStyle {
  return {
    "--vf-godview-stage-color": value.stageColor,
    "--vf-godview-stage-opacity": `${value.stageOpacity}%`,
    "--vf-godview-stage-blur": `${value.stageBlur}px`,
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
  appearance,
  onChange,
  onReset,
}: {
  value: GodviewTuning;
  appearance: DeckAppearance;
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
            <legend>Terminal panes</legend>
            <RangeControl
              label="background opacity"
              value={Math.round(appearance.opacity * 100)}
              min={0}
              max={100}
              unit="%"
              onChange={(percent) => setDeckAppearance({ ...appearance, opacity: percent / 100 })}
            />
            <p>
              The renderer's own background alpha — the same setting as Settings → Terminal, saved
              for this device.
            </p>
          </fieldset>
        </div>
      )}
    </aside>
  );
}
