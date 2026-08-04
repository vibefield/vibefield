import {
  GHOSTTEA_SHADER_OPTIONS,
  GHOSTTY_COLOR_THEMES,
  GHOSTTY_THEME_CATALOG_REVISION,
  GHOSTTY_THEME_CATALOG_SOURCE,
  UNAVAILABLE_UPSTREAM_SHADERS,
} from "@vibecook/ghosttea-react/workspace";
import { type ReactElement, useMemo } from "react";
import {
  type DeckAppearance,
  setDeckAppearance,
  useDeckAppearance,
} from "../godview/deck-appearance";
import { fieldCls, labelCls, SettingsRow, SettingsSection, SettingsSwitch } from "./settings-ui";

// How the Godview deck DRAWS, as opposed to what it runs (GT-D12).
//
// This is a viewer preference and it is stored as one — on this device, beside
// the deck's layout, never in the floor's configuration document below. The
// section under this one edits that document, which is a different thing with a
// different owner: the file every terminal on this device loads, versus how
// this window paints them. Keeping them adjacent and distinct is the point.
//
// The CONTENT is upstream's — 0.9.0 pins a catalog of Ghostty-compatible color
// themes and bundles four shader ports with their licenses, and both are
// exported as data (`GHOSTTY_COLOR_THEMES`, `GHOSTTEA_SHADER_OPTIONS`) rather
// than as a component. `AppearanceSettings` itself is not in the package's
// export map; it is rendered by `GhostteaWorkspace` from the
// `saveAppearance`/`configEditor` platform seams and reads its whole draft from
// the ConfigSnapshot. That makes it structurally unusable here twice over: it
// cannot be imported, and it would display config-derived values while these
// panes render from a viewer-local store. So the data is upstream's and the
// chrome is ours, which is the split the export surface was shaped for — and
// at 0.9.1 that split is deliberate rather than incidental: petition G11's
// second ask made these exports the documented, semver-protected host
// appearance contract, so this file's imports are a supported dependency
// instead of a pin away from a silent break.
//
// TWO DIFFERENT UNAVAILABILITIES live below, and only one of them retired.
// GT-3v could not offer the four bundled ports at all — effects reached the
// renderer solely through the floor's shared config, so choosing one here would
// have restyled every viewer of these sessions — and said so as an honest
// UNAVAILABLE with that cause. G11 removed the cause, so the cards are live.
// The rights-unclear upstream list is NOT that: those shaders are named and
// withheld because their redistribution terms were never cleared, which no
// prop can fix. It stays, permanently.

/** The stack DESIGN.md §3 reserves for data, paths, and ids. */
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';

/** DESIGN.md §8 chips: full-round, fill at rest, ACTIVE is inverted solid with
 * `shadow-md`; §7 adds `active:scale-95` and a keyboard focus ring that is never
 * optional. The resting fill is the panel's own `black/5 · white/10` ramp rather
 * than `--vf-fill`, matching every other control in this surface. */
const CHIP_BASE =
  "inline-flex h-9 items-center justify-center rounded-full px-3.5 text-[12px] font-medium transition-[background-color,color,box-shadow,transform] duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 dark:focus-visible:ring-white/30";
const CHIP_SELECTED = "bg-black text-white shadow-md dark:bg-white dark:text-black";
const CHIP_RESTING =
  "bg-black/5 text-black/65 hover:bg-black/10 hover:text-black dark:bg-white/10 dark:text-white/65 dark:hover:bg-white/15 dark:hover:text-white";

/** The absence of an effect, as a first-class choice — and the one that omits
 * the `effects` prop entirely rather than sending an empty override. */
const NO_SHADER_VALUE = null;

/** The built-in palette for each Godview mode, offered as a first-class choice
 * rather than an empty selection; "no theme" would misname it. */
const DECK_DEFAULT_VALUE = "";

export function TerminalAppearanceSection(): ReactElement {
  const appearance = useDeckAppearance();
  // 602 options built once. The catalog is a pinned module constant, so this
  // never changes for the life of the page.
  const themeOptions = useMemo(() => GHOSTTY_COLOR_THEMES.map((theme) => theme.name), []);
  // `undefined` for both "nothing chosen" and "chosen a port this pinned build
  // no longer carries" — the same two cases the deck's own projection collapses
  // into an omitted prop, resolved here the same way so the panel can never
  // show a port selected that the panes are not drawing.
  const selectedShader = GHOSTTEA_SHADER_OPTIONS.find(
    (shader) => shader.id === appearance.shaderEffect,
  );

  const update = (patch: Partial<DeckAppearance>): void => {
    setDeckAppearance({ ...appearance, ...patch });
  };

  const percent = Math.round(appearance.opacity * 100);

  return (
    <SettingsSection
      title="Deck appearance"
      description="How the Godview deck draws on this device. Light and dark keep separate color-theme choices; opacity is shared. These follow this window — not the sessions, which look the same to whatever else attaches to them."
    >
      <SettingsRow
        title="Light color theme"
        description="Used whenever Godview is in Light mode. The first choice is Godview's built-in daylight palette; the rest are Ghostty themes bundled with the terminal."
      >
        <select
          aria-label="Light terminal color theme"
          className={fieldCls}
          value={appearance.lightThemeName ?? DECK_DEFAULT_VALUE}
          onChange={(event) =>
            update({
              lightThemeName:
                event.currentTarget.value === DECK_DEFAULT_VALUE ? null : event.currentTarget.value,
            })
          }
        >
          <option value={DECK_DEFAULT_VALUE}>Godview Daylight</option>
          {themeOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </SettingsRow>

      <SettingsRow
        title="Dark color theme"
        description="Used whenever Godview is in Dark mode. Its choice is independent from Light mode."
      >
        <select
          aria-label="Dark terminal color theme"
          className={fieldCls}
          value={appearance.darkThemeName ?? DECK_DEFAULT_VALUE}
          onChange={(event) =>
            update({
              darkThemeName:
                event.currentTarget.value === DECK_DEFAULT_VALUE ? null : event.currentTarget.value,
            })
          }
        >
          <option value={DECK_DEFAULT_VALUE}>Godview Midnight</option>
          {themeOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </SettingsRow>

      <SettingsRow
        title="Background opacity"
        description="The terminal's own background alpha. The renderer applies it, so the stage shows through the pane itself rather than through a filter over it."
      >
        <span className="flex items-center gap-3">
          <input
            type="range"
            aria-label="Terminal background opacity"
            min={20}
            max={100}
            value={percent}
            onChange={(event) => update({ opacity: Number(event.currentTarget.value) / 100 })}
          />
          <span className={`w-10 text-right tabular-nums ${labelCls}`} style={{ fontFamily: MONO }}>
            {percent}%
          </span>
        </span>
      </SettingsRow>

      <SettingsRow
        title="Dim program backgrounds too"
        description="Apply the same alpha to backgrounds a program painted itself. Off by default: a program that colors a cell's background usually means it."
      >
        <SettingsSwitch
          label="Dim program backgrounds too"
          checked={appearance.opacityCells}
          onChange={(opacityCells) => update({ opacityCells })}
        />
      </SettingsRow>

      <SettingsRow
        title="Shader effect"
        description="Drawn over this deck's panes by this window's own renderer, and yours alone — anything else attached to these sessions renders them with its own settings. Effects need the WebGPU renderer; on the fallback the panes draw without them."
        align="start"
        divider={selectedShader?.animated === true}
      >
        <div className="flex max-w-[38ch] flex-col items-end gap-2">
          {/* A fieldset because these five ARE one question with one answer, and
              a screen reader should hear that before it hears "CRT". The legend
              carries the grouping without repeating the row title on screen. */}
          <fieldset className="m-0 flex flex-wrap justify-end gap-1.5 border-0 p-0">
            <legend className="sr-only">Shader effect</legend>
            <button
              type="button"
              aria-pressed={appearance.shaderEffect === NO_SHADER_VALUE}
              className={`${CHIP_BASE} ${
                appearance.shaderEffect === NO_SHADER_VALUE ? CHIP_SELECTED : CHIP_RESTING
              }`}
              onClick={() => update({ shaderEffect: NO_SHADER_VALUE })}
            >
              No effect
            </button>
            {GHOSTTEA_SHADER_OPTIONS.map((shader) => (
              <button
                key={shader.id}
                type="button"
                aria-pressed={appearance.shaderEffect === shader.id}
                className={`${CHIP_BASE} ${
                  appearance.shaderEffect === shader.id ? CHIP_SELECTED : CHIP_RESTING
                }`}
                onClick={() => update({ shaderEffect: shader.id })}
              >
                {shader.name}
              </button>
            ))}
          </fieldset>
          {selectedShader !== undefined && (
            <span className={`text-right ${labelCls}`}>{selectedShader.description}</span>
          )}
        </div>
      </SettingsRow>

      {/* Only where the port has something to animate. Upstream's own gate
          ignores the flag for a static shader, so a switch offered beside CRT
          would be a control that does nothing — and the stored answer survives
          a trip through the static ports so coming back to VHS restores it. */}
      {selectedShader?.animated === true && (
        <SettingsRow
          title="Animate"
          description="Runs the effect's motion. It stops on its own whenever the deck is hidden or unfocused — a shader never animates behind the canvas."
          divider={false}
        >
          <SettingsSwitch
            label="Animate the shader effect"
            checked={appearance.shaderAnimate}
            onChange={(shaderAnimate) => update({ shaderAnimate })}
          />
        </SettingsRow>
      )}

      {/* Provenance for the catalog, where the catalog is used (its licence
          terms travel with the themes, and a pinned revision is a fact about
          what is installed). */}
      <p className={`pt-3 ${labelCls}`}>
        <span style={{ fontFamily: MONO }}>{themeOptions.length}</span> themes from{" "}
        {GHOSTTY_THEME_CATALOG_SOURCE} · revision{" "}
        <span style={{ fontFamily: MONO }}>{GHOSTTY_THEME_CATALOG_REVISION}</span>
      </p>

      {/* Attribution for every port on the disk, not merely the selected one:
          these ship bundled with the terminal whether or not this viewer turns
          one on, and that is what their terms attach to. */}
      <p className={`pt-1 ${labelCls}`}>
        Bundled shaders ·{" "}
        {GHOSTTEA_SHADER_OPTIONS.map((shader, index) => (
          <span key={shader.id}>
            {index > 0 ? " · " : ""}
            {shader.name} <span style={{ fontFamily: MONO }}>{shader.license}</span>
          </span>
        ))}
      </p>

      {/* The OTHER unavailability, and the one that never retires. Naming what
          was withheld is the honest report (DESIGN.md §9): a user comparing
          this deck to upstream's shader gallery learns why the rest are missing
          instead of assuming this app dropped them. */}
      <p className={`pt-1 ${labelCls}`}>
        <span style={{ fontFamily: MONO }}>{UNAVAILABLE_UPSTREAM_SHADERS.length}</span> more
        upstream shaders are named but not bundled — their redistribution terms are unclear:{" "}
        {UNAVAILABLE_UPSTREAM_SHADERS.join(", ")}
      </p>
    </SettingsSection>
  );
}
