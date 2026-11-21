import { SegmentedControl, UiButton } from "@vibefield/design-kit";
import { type KeyboardEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { deckThemeNameForMode } from "../../godview/deck-appearance";
import { labelCls } from "../settings-ui";
import { GodviewMiniature } from "./GodviewMiniature";
import type { TerminalPageModel, ThemeBrowserTarget } from "./page-model";
import {
  BUILTIN_THEMES,
  catalogThemes,
  type PreviewMode,
  type PreviewTheme,
  previewTheme,
} from "./theme-view";

// The theme browser (GT-7; a Settings subpage, GT-D18): Ghostty's 602 themes
// in one searchable list beside a stage that previews whichever row is under
// the pointer or the keyboard. For a window mode, picking applies at once — it
// is this window's, live. For program colours, picking copies a theme's sixteen
// into config.ghostty's managed block, and waits for Save like every Mac-wide
// change.

type Tone = "All" | "Dark" | "Light";
const TONES: readonly Tone[] = ["All", "Dark", "Light"];

/** Whether a slot is one the person set, in config.ghostty or their own Ghostty file. */
function setByThem(model: TerminalPageModel, index: number): boolean {
  return model.paletteHere.has(index) || model.paletteElsewhere.has(index);
}

/** A theme's sixteen as every session on this Mac draws them (item 590, 2026-11-19): the theme's,
 * but for a slot the person set, which is theirs (`model.palette` holds their colour there).
 * PURE. */
function withTheirs(palette: readonly string[], model: TerminalPageModel): string[] {
  return palette.map((color, index) =>
    setByThem(model, index) ? (model.palette[index] ?? color) : color,
  );
}

export function themeBrowserTitle(target: ThemeBrowserTarget): string {
  return target.kind === "palette"
    ? "Program colors"
    : `${target.mode === "dark" ? "Dark" : "Light"} mode theme`;
}

/** The line under the browser's stage (item 590, 2026-11-19; DESIGN.md §2.7 "The terminal's own
 * colours"): what the theme shown brings to the sixteen, and what copying does. PURE. */
export function themeBrowserLine(
  forPalette: boolean,
  shown: Pick<PreviewTheme, "catalogName" | "palette">,
  onThisMac: boolean,
): string {
  if (forPalette) return "Copying sets all sixteen on this Mac, in both modes.";
  if (shown.catalogName === null) {
    return "Godview's own colors for this mode. A color you set in Program colors or your Ghostty file wins over them.";
  }
  if (shown.palette === null) {
    return "This theme doesn't bring all sixteen program colors, so it can't be copied.";
  }
  return onThisMac
    ? "This Mac already uses these colors, in both modes."
    : "Its sixteen colors come with it while Godview is in this mode; a color you set in Program colors or your Ghostty file still wins. Copy them to use them in both modes.";
}

export function ThemeBrowser({
  model,
  target,
}: {
  model: TerminalPageModel;
  target: ThemeBrowserTarget;
}): ReactElement {
  const forPalette = target.kind === "palette";
  const mode: PreviewMode = target.kind === "window" ? target.mode : model.previewMode;
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState<Tone>(forPalette ? "All" : mode === "dark" ? "Dark" : "Light");
  const [hover, setHover] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const chosenName = forPalette ? null : deckThemeNameForMode(model.appearance, mode);
  const chosen = previewTheme(chosenName, mode);
  const needle = query.trim().toLowerCase();

  const matches = useMemo(
    () =>
      catalogThemes().filter(
        (theme) =>
          (tone === "All" || (tone === "Dark") === theme.dark) &&
          (needle === "" || theme.name.toLowerCase().includes(needle)) &&
          (!forPalette || theme.palette !== null),
      ),
    [tone, needle, forPalette],
  );
  const builtin = forPalette ? null : BUILTIN_THEMES[mode];
  const rows: PreviewTheme[] = [
    ...(builtin !== null && needle === "" ? [builtin] : []),
    ...matches,
  ];
  const shown =
    rows.find((theme) => theme.name === hover) ?? (forPalette ? rows[0] : chosen) ?? chosen;
  // This Mac's Ghostty files set all sixteen, and to this theme's: since item 590 a slot nobody
  // set is Godview's look, so `model.palette` alone is not what the files hold.
  const macHas = (theme: PreviewTheme): boolean =>
    theme.palette?.every(
      (color, index) => setByThem(model, index) && model.palette[index] === color,
    ) === true;
  const isChosen = (theme: PreviewTheme): boolean =>
    forPalette ? macHas(theme) : theme.name === chosen.name;

  const pick = (theme: PreviewTheme): void => {
    if (forPalette) {
      if (theme.palette !== null) {
        model.setManaged({
          ...model.managed,
          palette: new Map(theme.palette.map((color, index) => [index, color])),
        });
      }
      return;
    }
    model.setAppearance({
      ...model.appearance,
      ...(mode === "dark"
        ? { darkThemeName: theme.catalogName }
        : { lightThemeName: theme.catalogName }),
    });
  };

  // Keep the chosen row in view on open.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
  }, []);

  const move = (delta: number): void => {
    const index = rows.findIndex((theme) => theme.name === (hover ?? chosen.name));
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
    if (next === undefined) return;
    setHover(next.name);
    list.current
      ?.querySelector(`[data-theme-name="${CSS.escape(next.name)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };
  const onKeys = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      const theme = rows.find((entry) => entry.name === hover);
      if (theme !== undefined) {
        event.preventDefault();
        pick(theme);
      }
    }
  };

  let letter = "";
  const ownPalette = shown.palette;
  return (
    <div className="vf-ts-browser">
      <div className="vf-ts-browser-bar">
        <input
          type="search"
          className="vf-ui-field vf-ts-browser-search"
          placeholder={`Search ${catalogThemes().length} themes`}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="vf-ts-theme-list"
          aria-label="Search themes"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setHover(null);
          }}
          onKeyDown={onKeys}
        />
        <SegmentedControl
          options={TONES}
          value={tone}
          onChange={(next) => {
            setTone(next);
            setHover(null);
          }}
          label="Filter by ground"
          size="small"
        />
        <span className={`vf-ts-browser-count ${labelCls}`}>
          {matches.length} {matches.length === 1 ? "theme" : "themes"}
        </span>
      </div>
      <div className="vf-ts-browser-body">
        <div
          id="vf-ts-theme-list"
          ref={list}
          className="vf-ts-theme-list"
          role="listbox"
          tabIndex={-1}
          aria-label={
            forPalette
              ? "Themes to copy program colors from"
              : `${mode === "dark" ? "Dark" : "Light"} mode themes`
          }
          onKeyDown={onKeys}
          onMouseLeave={() => setHover(null)}
        >
          {rows.map((theme) => {
            const first = theme.catalogName === null ? "" : (theme.name[0] ?? "").toUpperCase();
            const head =
              theme.catalogName === null ? "Godview's own" : /[A-Z]/u.test(first) ? first : "#";
            const showHead = head !== letter;
            letter = head;
            return (
              <div key={theme.name} role="presentation">
                {showHead && <div className="vf-ts-theme-letter">{head}</div>}
                <div
                  role="option"
                  tabIndex={-1}
                  aria-selected={isChosen(theme)}
                  data-theme-name={theme.name}
                  data-hover={hover === theme.name ? "" : undefined}
                  className="vf-ts-theme-row"
                  onMouseEnter={() => setHover(theme.name)}
                  onFocus={() => setHover(theme.name)}
                  onClick={() => pick(theme)}
                  onKeyDown={onKeys}
                >
                  <span
                    className="vf-ts-theme-chip"
                    style={{ background: theme.background }}
                    aria-hidden="true"
                  >
                    {(forPalette
                      ? (theme.palette ?? model.palette)
                      : withTheirs(theme.palette ?? model.palette, model)
                    )
                      .slice(1, 7)
                      .map((color, index) => (
                        <i key={index} style={{ background: color }} />
                      ))}
                  </span>
                  <span className="vf-ts-theme-name">{theme.name}</span>
                  {isChosen(theme) && <span className="vf-ts-theme-check" aria-hidden="true" />}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className={`vf-ts-empty ${labelCls}`}>
              No theme is called “{query}”. The list is Ghostty's {catalogThemes().length}, from
              iTerm2-Color-Schemes.
            </p>
          )}
        </div>
        <aside className="vf-ts-browser-stage" aria-live="polite">
          <GodviewMiniature
            variant="deck"
            mode={mode}
            theme={forPalette ? chosen : shown}
            palette={
              forPalette && ownPalette !== null
                ? ownPalette
                : withTheirs(ownPalette ?? model.palette, model)
            }
            appearance={model.appearance}
          />
          <div className="vf-ts-browser-meta">
            <div className="vf-ts-browser-title">
              {shown.name}
              {isChosen(shown) && <span className="vf-ts-tag">In use</span>}
            </div>
            <div className={labelCls}>
              {forPalette
                ? isChosen(shown)
                  ? "This Mac's program colors match this theme."
                  : "Click to copy these colors into config.ghostty; every terminal on this Mac uses them after you save."
                : isChosen(shown)
                  ? `This window's ${mode === "dark" ? "Dark" : "Light"} mode theme.`
                  : "Click or press Return to use it in this window."}
            </div>
          </div>
          <div className="vf-ts-browser-palette">
            <div className="vf-ts-eyebrow">
              {ownPalette === null ? "Program colors · this Mac's" : "Its program colors"}
            </div>
            <div className="vf-ts-browser-swatches">
              {(forPalette && ownPalette !== null
                ? ownPalette
                : withTheirs(ownPalette ?? model.palette, model)
              ).map((color, index) => (
                <i key={index} title={`${index} · ${color}`} style={{ background: color }} />
              ))}
            </div>
            {!forPalette && ownPalette !== null && shown.catalogName !== null && (
              <UiButton
                disabled={macHas(shown)}
                onClick={() =>
                  model.setManaged({
                    ...model.managed,
                    palette: new Map(ownPalette.map((color, index) => [index, color])),
                  })
                }
              >
                {macHas(shown) ? "Used on this Mac" : "Copy to this Mac"}
              </UiButton>
            )}
            <p className={labelCls}>{themeBrowserLine(forPalette, shown, macHas(shown))}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
