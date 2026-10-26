import { GHOSTTY_COLOR_THEMES } from "@vibecook/ghosttea-react/workspace";
import type { MonitorParameterDefinition } from "@vibefield/puppeteer-views";
import { type CSSProperties, type ReactElement, useMemo } from "react";
import { createPortal } from "react-dom";
import { type DeckAppearance, deckThemeNameForMode, setDeckAppearance } from "./deck-appearance";
import { GodviewPerfReadout } from "./GodviewPerfReadout";
import type { MonitorTuningSection } from "./monitor/monitor-tuning";

// TEMPORARY: the live measuring instrument requested for the Godview visual
// pass. The controls remain memory-only except terminal appearance and monitor
// parameters, whose existing stores are the real product authorities.

export type GodviewTheme = "light" | "dark";

const DECK_DEFAULT_THEME_VALUE = "";

/** The monitor's stage when its token cannot be read: `--vf-card`, DESIGN.md §2.2's default card
 * surface (the value the DOM card's `CARD_BG` carried until DK-17 deleted the card). */
const STAGE_FALLBACK = "#1C1C1E";

/** The panel's MEMORY-ONLY knobs. The stage's opacity and blur are not here any
 * more: GT-7 moved them into the viewer's saved backdrop, and DK-15 retired that
 * backdrop on the desk — the cover is a tint at the covers' 72% over the desk's
 * still, blurred once (DESIGN.md §8 "The covers over the desk"). */
export interface GodviewTuning {
  stageColor: string;
  bubbleIdleColor: string;
  bubbleWorkingColor: string;
  bubbleWaitingColor: string;
}

function tokenColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (resolved === "") return fallback;
  const input = document.createElement("input");
  input.type = "color";
  input.value = resolved;
  return input.value;
}

/** The Chopsticks reference is flat and opaque by default. The pane renderer's
 * own alpha remains independent, so a transparent terminal is still real. */
export function defaultGodviewTuning(theme: GodviewTheme = "light"): GodviewTuning {
  const light = theme === "light";
  return {
    stageColor: tokenColor(`--vf-godview-${theme}-monitor-bg`, STAGE_FALLBACK),
    bubbleIdleColor: tokenColor(`--vf-godview-${theme}-idle-bg`, light ? "#e5e5e5" : "#2a2a2a"),
    bubbleWorkingColor: tokenColor(
      `--vf-godview-${theme}-working-bg`,
      light ? "#222222" : "#eeeeee",
    ),
    bubbleWaitingColor: tokenColor(
      light ? "--vf-card-deep" : "--vf-godview-dark-text-main",
      light ? "#000000" : "#ffffff",
    ),
  };
}

type GodviewTuningStyle = CSSProperties & Record<`--vf-godview-${string}`, string>;

export function godviewTuningStyle(value: GodviewTuning): GodviewTuningStyle {
  return {
    "--vf-godview-stage-color": value.stageColor,
    "--vf-godview-bubble-idle": value.bubbleIdleColor ?? "var(--idle-bg)",
    "--vf-godview-bubble-working": value.bubbleWorkingColor ?? "var(--working-bg)",
    "--vf-godview-bubble-waiting": value.bubbleWaitingColor ?? "var(--waiting-bg)",
  };
}

function displayedValue(definition: MonitorParameterDefinition, value: number): string {
  if (definition.step >= 1) return String(Math.round(value));
  const precision = Math.max(0, Math.ceil(-Math.log10(definition.step)));
  return value.toFixed(precision);
}

function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <label className="vf-godview-tweak-control">
      <span>{label}</span>
      <output>
        {value}
        {unit}
      </output>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
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
    <label className="vf-godview-tweak-control is-color">
      <span>{label}</span>
      <output>{value}</output>
      <input type="color" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function MonitorGroup({ group, values, onChange }: Omit<MonitorTuningSection, "id">): ReactElement {
  return (
    <fieldset className="vf-godview-tweak-group">
      <legend>{group.title}</legend>
      {group.controls.map((definition) => {
        const value = values[definition.key] ?? definition.defaultValue;
        return (
          <label className="vf-godview-tweak-control" key={definition.key}>
            <span>{definition.label}</span>
            <output>{displayedValue(definition, value)}</output>
            <input
              type="range"
              min={definition.min}
              max={definition.max}
              step={definition.step}
              value={value}
              onChange={(event) => onChange(definition.key, event.currentTarget.valueAsNumber)}
            />
          </label>
        );
      })}
    </fieldset>
  );
}

export function GodviewTuningPanel({
  open,
  theme,
  value,
  appearance,
  monitorSections,
  rendererBackend,
  onClose,
  onChange,
  onReset,
  onResetMonitor,
}: {
  open: boolean;
  theme: GodviewTheme;
  value: GodviewTuning;
  appearance: DeckAppearance;
  monitorSections: readonly MonitorTuningSection[];
  rendererBackend: string | null;
  onClose: () => void;
  onChange: (patch: Partial<GodviewTuning>) => void;
  onReset: () => void;
  onResetMonitor: () => void;
}): ReactElement | null {
  const colorThemeNames = useMemo(() => GHOSTTY_COLOR_THEMES.map((entry) => entry.name), []);

  if (!open) return null;

  const selectedColorTheme = deckThemeNameForMode(appearance, theme);
  const setSelectedColorTheme = (themeName: string | null): void => {
    setDeckAppearance({
      ...appearance,
      ...(theme === "dark" ? { darkThemeName: themeName } : { lightThemeName: themeName }),
    });
  };

  return createPortal(
    <aside
      id="vf-godview-tweak-panel"
      className={`vf-godview-tweak-panel theme-${theme}`}
      aria-label="Godview system controls"
    >
      <header className="vf-godview-tweak-header">
        <span>SYSTEM CONTROL</span>
        <button type="button" aria-label="Close system controls" onClick={onClose}>
          ×
        </button>
      </header>

      {/* Godview's mode is the app's (FC-D7) — or Settings → Terminal's one
          override — so the panel no longer carries a Theme of its own. */}

      <fieldset className="vf-godview-tweak-group">
        <legend>STAGE SURFACE</legend>
        <ColorControl
          label="Stage color"
          value={value.stageColor}
          onChange={(stageColor) => onChange({ stageColor })}
        />
        {/* DK-15: the stage's opacity and blur retired on the desk — the cover is
            a tint at the covers' 72% over the desk's still, blurred once. */}
      </fieldset>

      <fieldset className="vf-godview-tweak-group">
        <legend>TERMINAL PANES</legend>
        <label className="vf-godview-tweak-control is-select">
          <span>Color theme · {theme === "dark" ? "Dark" : "Light"}</span>
          <select
            aria-label={`${theme === "dark" ? "Dark" : "Light"} terminal color theme`}
            value={selectedColorTheme ?? DECK_DEFAULT_THEME_VALUE}
            onChange={(event) =>
              setSelectedColorTheme(
                event.currentTarget.value === DECK_DEFAULT_THEME_VALUE
                  ? null
                  : event.currentTarget.value,
              )
            }
          >
            <option value={DECK_DEFAULT_THEME_VALUE}>
              Godview {theme === "dark" ? "Midnight" : "Daylight"}
            </option>
            {colorThemeNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <RangeControl
          label="Background opacity"
          value={Math.round(appearance.opacity * 100)}
          min={0}
          max={100}
          unit="%"
          onChange={(percent) => setDeckAppearance({ ...appearance, opacity: percent / 100 })}
        />
        <label className="vf-godview-tweak-check">
          <span>Fade cell backgrounds</span>
          <input
            type="checkbox"
            checked={appearance.opacityCells}
            onChange={(event) =>
              setDeckAppearance({ ...appearance, opacityCells: event.currentTarget.checked })
            }
          />
        </label>
      </fieldset>

      <fieldset className="vf-godview-tweak-group">
        <legend>BUBBLE COLORS</legend>
        <ColorControl
          label="Idle fill"
          value={value.bubbleIdleColor ?? defaultGodviewTuning(theme).bubbleIdleColor}
          onChange={(bubbleIdleColor) => onChange({ bubbleIdleColor })}
        />
        <ColorControl
          label="Working fill"
          value={value.bubbleWorkingColor ?? defaultGodviewTuning(theme).bubbleWorkingColor}
          onChange={(bubbleWorkingColor) => onChange({ bubbleWorkingColor })}
        />
        <ColorControl
          label="Waiting fill"
          value={value.bubbleWaitingColor ?? defaultGodviewTuning(theme).bubbleWaitingColor}
          onChange={(bubbleWaitingColor) => onChange({ bubbleWaitingColor })}
        />
      </fieldset>

      {monitorSections.map((section) => (
        <MonitorGroup
          key={section.id}
          group={section.group}
          values={section.values}
          onChange={section.onChange}
        />
      ))}

      <GodviewPerfReadout rendererBackend={rendererBackend} />

      <button
        className="vf-godview-tweak-reset"
        type="button"
        onClick={() => {
          onReset();
          onResetMonitor();
        }}
      >
        RESET DEFAULTS
      </button>
    </aside>,
    document.body,
  );
}
