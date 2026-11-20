import {
  DESK_LIGHT,
  DESK_LIGHT_SLIDERS,
  type DeskLightPlant,
  type DeskLightSlider,
  type DeskLightValues,
  deskLightToSet,
} from "@vibefield/contracts";
import { UiButton } from "@vibefield/design-kit";
import type { CSSProperties, KeyboardEvent, ReactElement } from "react";
import { SettingsRow, SettingsSection, SettingsSwitch } from "../settings-ui";
import "./light-settings.css";

// Item 583 — Settings → Canvas, its first section, LIGHT (DESIGN.md §8 "Settings → Canvas"; the light is §2.1's),
// controller-free: what the section shows and where each act goes. A still of the mat in CSS with the chosen plant's
// shadow, eight plant tiles, Mirror, five sliders with words at their ends, and Reset light at its foot. Under the
// Moon, Shade and Tint rest and say why; under Reduce motion, Wind does. The desk behind Settings' backdrop takes
// every change too. The live section (`LightSection`) and the catalog (`LightSettingsPreview`) both
// mount it.

/** A plant's shadow as a CSS image (a data URI whose alpha is the leaf), by plant. */
export type PlantSilhouettes = Readonly<Record<Exclude<DeskLightPlant, "none">, string>>;

export interface LightSettingsModel {
  /** Every row as the desk wears it now, a slider in hand included. */
  readonly values: DeskLightValues;
  /** The theme the mat is drawn in. By night the shadow is moonlight's: Shade and Tint are sunlight's and rest. */
  readonly theme: "light" | "dark";
  /** The deepest shade as the CSS colour the preview multiplies the mat by: the engine's number, the caller's. */
  readonly shade: string;
  /** The plants' shadows, once their module has loaded; until then the tiles and the preview are the bare mat. */
  readonly silhouettes?: PlantSilhouettes;
  /** The OS asks for reduced motion: Wind is disabled and says why. */
  readonly reducedMotion: boolean;
  /** False while the preferences cannot be read: nothing can be changed (default true). */
  readonly writable?: boolean;
  /** A change is on its way: nothing more is taken until it lands (default false). The switch, the sliders and
   * Reset are disabled for it. The tiles are NOT: a disabled tile drops the focus, and the arrows would stop after
   * one step, so a tile keeps the focus and takes no key and no click. */
  readonly busy?: boolean;
}

/** The plants in the page's order, each with its name (DESIGN.md §8). */
export const PLANTS: readonly { readonly id: DeskLightPlant; readonly name: string }[] = [
  { id: "none", name: "None" },
  { id: "monstera", name: "Monstera" },
  { id: "climbing-monstera", name: "Climbing monstera" },
  { id: "fan-palm", name: "Fan palm" },
  { id: "coconut-palm", name: "Coconut palm" },
  { id: "under-the-palm", name: "Under the palm" },
  { id: "palm", name: "Palm" },
  { id: "canopy", name: "Canopy" },
];

/** How many columns a grid's computed `grid-template-columns` names: its tracks. A grid that is laid out says each
 * track's width; one that is not still says `repeat(4, …)`. At least one. */
export function gridColumns(template: string): number {
  const text = template.trim();
  const repeated = /^repeat\(\s*(\d+)\s*,/.exec(text);
  if (repeated !== null) return Math.max(1, Number(repeated[1] ?? 1));
  let depth = 0;
  let tracks = 0;
  let within = false;
  for (const character of text) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    const gap = depth === 0 && character.trim() === "";
    if (!gap && !within) tracks += 1;
    within = !gap;
  }
  return Math.max(1, tracks);
}

/** Where an arrow key goes from tile `at` of `count`, laid `columns` to a row (DESIGN.md §8 "Settings → Canvas"):
 * ← and → to the one before and the next; ↑ and ↓ to the tile over and under, in the tile's own column; each wraps
 * at its ends. Any other key goes nowhere. */
export function tileAfter(
  key: string,
  at: number,
  count: number,
  columns: number,
): number | undefined {
  if (key === "ArrowRight") return (at + 1) % count;
  if (key === "ArrowLeft") return (at - 1 + count) % count;
  if (key !== "ArrowDown" && key !== "ArrowUp") return undefined;
  const column: number[] = [];
  for (let tile = at % columns; tile < count; tile += columns) column.push(tile);
  const step = key === "ArrowDown" ? 1 : -1;
  return column[(column.indexOf(at) + step + column.length) % column.length];
}

/** Each slider's name and the words at its two ends, low end first as the slider runs. `runs` says which way the
 * stored number goes along it: Shade is a share of the lit mat, so Deeper is its LOWER end. */
const SLIDERS: Readonly<
  Record<DeskLightSlider, { name: string; ends: readonly [string, string]; runs: "up" | "down" }>
> = {
  softness: { name: "Softness", ends: ["Sharp", "Soft"], runs: "up" },
  shade: { name: "Shade", ends: ["Lighter", "Deeper"], runs: "down" },
  tint: { name: "Tint", ends: ["Neutral", "Cool"], runs: "up" },
  size: { name: "Size", ends: ["Smaller", "Larger"], runs: "up" },
  wind: { name: "Wind", ends: ["Still", "Breezy"], runs: "up" },
};

const LIGHT_LINE =
  "The plant whose shadow falls on your desk, and how the light moves. By day it is sunlight, and by night moonlight.";
const STILL_LINE = "Still while Reduce motion is on in System Settings.";
/** Under the Moon, Shade and Tint rest at their value and each says why (§8): they are the daylight's. */
const MOON_LINES: Readonly<Partial<Record<DeskLightSlider, string>>> = {
  shade: "Sets the daylight's shade. In the dark theme, moonlight keeps its own.",
  tint: "Sets the daylight's tint. In the dark theme, moonlight keeps its own.",
};

/** The slider's track is 0 … 100 along the way it is read; a row that runs down is stored the other way round. */
const STEPS = 100;
const toTrack = (row: DeskLightSlider, value: number): number => {
  const { min, max } = DESK_LIGHT[row];
  const along = ((value - min) / (max - min)) * STEPS;
  return Math.round(SLIDERS[row].runs === "up" ? along : STEPS - along);
};
const fromTrack = (row: DeskLightSlider, track: number): number => {
  const { min, max } = DESK_LIGHT[row];
  const along = SLIDERS[row].runs === "up" ? track : STEPS - track;
  // a number of at most four decimals, so the stored value is what the slider can say again
  return Math.round((min + (along / STEPS) * (max - min)) * 1e4) / 1e4;
};

// THE PREVIEW'S GEOMETRY is the engine's (ICE's `SOFT_LIGHT`, DESIGN.md §2.1): two layers of the plate, each a square
// whose side is a share of the frame's longer side, centred at a share of the frame, the far one turned and fainter.
// Lengths are in `cqw` (the preview is its own container), so the still is the desk's picture at any width. The blur
// is the layer's disc, read as a Gaussian of half its radius.
const LAYERS = [
  { key: "far", at: [10, 5], side: 150, turn: 2.5, opacity: 0.5, blur: 1.76 },
  { key: "near", at: [84, 36], side: 115, turn: 0, opacity: 0.9, blur: 0.84 },
] as const;

function Shadows({
  values,
  silhouette,
}: {
  values: DeskLightValues;
  silhouette: string;
}): ReactElement {
  return (
    <div className="vf-light-shadows" data-mirror={values.mirror ? "true" : undefined}>
      {LAYERS.map((layer) => (
        <div
          key={layer.key}
          className="vf-light-shadow"
          style={
            {
              left: `${layer.at[0]}%`,
              top: `${layer.at[1]}%`,
              width: `${layer.side * values.size}cqw`,
              opacity: layer.opacity,
              "--vf-light-turn": `${layer.turn}rad`,
              "--vf-light-blur": `${layer.blur * values.softness * values.size}cqw`,
            } as CSSProperties
          }
        >
          <div className="vf-light-leaf" style={{ maskImage: `url("${silhouette}")` }} />
        </div>
      ))}
    </div>
  );
}

export function LightSettingsView({
  model,
  onPlant,
  onMirror,
  onSlide,
  onLetGo,
  onReset,
}: {
  model: LightSettingsModel;
  onPlant: (plant: DeskLightPlant) => void;
  onMirror: (mirror: boolean) => void;
  /** A slider moved: the desk follows at once. */
  onSlide: (row: DeskLightSlider, value: number) => void;
  /** The slider was let go: what it holds is written, one undo step. */
  onLetGo: () => void;
  onReset: () => void;
}): ReactElement {
  const { values, silhouettes } = model;
  const writable = model.writable ?? true;
  const busy = model.busy ?? false;
  const locked = !writable || busy;
  const night = model.theme === "dark";
  const shadow = values.plant === "none" ? undefined : silhouettes?.[values.plant];
  const whyNot = (row: DeskLightSlider): string | undefined => {
    if (row === "wind" && model.reducedMotion) return STILL_LINE;
    return night ? MOON_LINES[row] : undefined;
  };
  // The tiles are ONE stop for Tab, and the arrows choose as they move (DESIGN.md §8), as the profiles' glyphs do.
  // The columns are the grid's own, read as the key is pressed: four to a row, or two where Settings is narrow.
  const onTileKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const group = event.currentTarget;
    const columns = gridColumns(getComputedStyle(group).getPropertyValue("grid-template-columns"));
    const at = PLANTS.findIndex((plant) => plant.id === values.plant);
    const next = PLANTS[tileAfter(event.key, at, PLANTS.length, columns) ?? -1];
    if (next === undefined) return;
    event.preventDefault();
    if (locked) return;
    onPlant(next.id);
    group.querySelector<HTMLElement>(`[data-light-plant="${next.id}"]`)?.focus();
  };
  return (
    <SettingsSection title="Light" description={LIGHT_LINE} className="vf-light">
      <div
        className="vf-light-preview"
        data-light-preview={values.plant}
        style={{ "--vf-light-shade": model.shade } as CSSProperties}
        aria-hidden="true"
      >
        {shadow !== undefined && <Shadows values={values} silhouette={shadow} />}
      </div>

      {/* picture tiles, not inputs: buttons in the radio role carry the choice and the arrows */}
      <div className="vf-light-plants" role="radiogroup" aria-label="Plant" onKeyDown={onTileKey}>
        {PLANTS.map((plant) => {
          const chosen = plant.id === values.plant;
          const leaf = plant.id === "none" ? undefined : silhouettes?.[plant.id];
          return (
            // biome-ignore lint/a11y/useSemanticElements: a picture tile in the radio role
            <button
              key={plant.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              tabIndex={chosen ? 0 : -1}
              className="vf-light-plant"
              data-light-plant={plant.id}
              disabled={!writable}
              onClick={() => {
                if (!chosen && !busy) onPlant(plant.id);
              }}
            >
              <span
                className="vf-light-tile"
                style={{ "--vf-light-shade": model.shade } as CSSProperties}
              >
                {leaf !== undefined && (
                  <span className="vf-light-tile-shadow">
                    <span className="vf-light-tile-leaf" style={{ maskImage: `url("${leaf}")` }} />
                  </span>
                )}
              </span>
              <span className="vf-light-plant-name">{plant.name}</span>
            </button>
          );
        })}
      </div>

      <SettingsRow
        title="Mirror"
        description="Flip the plant's shadow left to right."
        marks={{ "data-light-row": "mirror" }}
      >
        <SettingsSwitch
          label="Mirror"
          checked={values.mirror}
          disabled={locked}
          onChange={onMirror}
        />
      </SettingsRow>

      {DESK_LIGHT_SLIDERS.map((row, index) => {
        const { name, ends } = SLIDERS[row];
        const why = whyNot(row);
        return (
          <SettingsRow
            key={row}
            title={name}
            {...(why === undefined ? {} : { description: why })}
            divider={index < DESK_LIGHT_SLIDERS.length - 1}
            align={why === undefined ? "center" : "start"}
            marks={{ "data-light-row": row }}
          >
            <div className="vf-light-slider">
              <input
                type="range"
                aria-label={name}
                aria-valuetext={`${toTrack(row, values[row])} of ${STEPS}, from ${ends[0]} to ${ends[1]}`}
                className="min-w-0 accent-black disabled:opacity-40 dark:accent-white"
                min={0}
                max={STEPS}
                step={1}
                value={toTrack(row, values[row])}
                disabled={locked || why !== undefined}
                onChange={(event) => onSlide(row, fromTrack(row, Number(event.target.value)))}
                onPointerUp={onLetGo}
                onKeyUp={onLetGo}
                onBlur={onLetGo}
              />
              <div className="vf-light-ends" aria-hidden="true">
                <span>{ends[0]}</span>
                <span>{ends[1]}</span>
              </div>
            </div>
          </SettingsRow>
        );
      })}

      <div className="vf-light-foot">
        <UiButton
          variant="quiet"
          disabled={locked || deskLightToSet(values) === null}
          onClick={onReset}
        >
          Reset light
        </UiButton>
      </div>
    </SettingsSection>
  );
}
