import {
  GHOSTTEA_SHADER_OPTIONS,
  GHOSTTY_COLOR_THEMES,
  GHOSTTY_THEME_CATALOG_REVISION,
  GHOSTTY_THEME_CATALOG_SOURCE,
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
// export map at 0.9.0; it is rendered by `GhostteaWorkspace` from the
// `saveAppearance`/`configEditor` platform seams and reads its whole draft from
// the ConfigSnapshot. That makes it structurally unusable here twice over: it
// cannot be imported, and it would display config-derived values while these
// panes render from a viewer-local store. So the data is upstream's and the
// chrome is ours, which is the split the export surface was shaped for.

/** The stack DESIGN.md §3 reserves for data, paths, and ids. */
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';

/** The built-in palette for each Godview mode, offered as a first-class choice
 * rather than an empty selection; "no theme" would misname it. */
const DECK_DEFAULT_VALUE = "";

export function TerminalAppearanceSection(): ReactElement {
  const appearance = useDeckAppearance();
  // 602 options built once. The catalog is a pinned module constant, so this
  // never changes for the life of the page.
  const themeOptions = useMemo(() => GHOSTTY_COLOR_THEMES.map((theme) => theme.name), []);

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

      <SettingsRow title="Shader effects" align="start" divider={false}>
        <span className="flex max-w-[38ch] flex-col gap-1 text-right">
          {/* An honest UNAVAILABLE with its reason and its cause, not a
              disabled control implying it is coming back on its own. The four
              ports are named with their terms anyway: they ARE bundled with
              the terminal, their attribution travels with them, and a user who
              reads this list learns what is on their disk. */}
          <span className={labelCls}>
            Not available on this deck yet — the workspace accepts a viewer's theme but reads
            shaders only from the device configuration, which every viewer of these sessions shares.
          </span>
          {GHOSTTEA_SHADER_OPTIONS.map((shader) => (
            <span key={shader.id} className={labelCls}>
              <span style={{ fontFamily: MONO }}>{shader.name}</span>
              {shader.animated ? " · animated" : ""}
              {" · "}
              {shader.license}
            </span>
          ))}
        </span>
      </SettingsRow>

      {/* Provenance for the catalog, where the catalog is used (its licence
          terms travel with the themes, and a pinned revision is a fact about
          what is installed). */}
      <p className={`pt-3 ${labelCls}`}>
        <span style={{ fontFamily: MONO }}>{themeOptions.length}</span> themes from{" "}
        {GHOSTTY_THEME_CATALOG_SOURCE} · revision{" "}
        <span style={{ fontFamily: MONO }}>{GHOSTTY_THEME_CATALOG_REVISION}</span>
      </p>
    </SettingsSection>
  );
}
