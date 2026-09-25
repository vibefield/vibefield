import {
  GHOSTTEA_SHADER_OPTIONS,
  GHOSTTY_THEME_CATALOG_REVISION,
  GHOSTTY_THEME_CATALOG_SOURCE,
  UNAVAILABLE_UPSTREAM_SHADERS,
} from "@vibecook/ghosttea-react/workspace";
import { SegmentedControl, UiButton, UiIconButton, UnavailableState } from "@vibefield/design-kit";
import type { ReactElement } from "react";
import { DECK_BACKDROP_BLUR_MAX, deckThemeNameForMode } from "../../godview/deck-appearance";
import { labelCls, SettingsRow, SettingsSwitch } from "../settings-ui";
import { GodviewMiniature } from "./GodviewMiniature";
import type { TerminalPageModel } from "./page-model";
import { Fact, PageSection, RangeControl } from "./parts";
import {
  catalogThemes,
  type PreviewMode,
  type PreviewTheme,
  previewTheme,
  withAlpha,
} from "./theme-view";

// Settings → Terminal → Look (GT-7): how this WINDOW draws terminals (live,
// the viewer's own — GT-D12) and the one device-wide look setting, this Mac's
// program colours. The preview heads it and redraws on every change.

const MODE_LABEL: Record<PreviewMode, "Light" | "Dark"> = { light: "Light", dark: "Dark" };

/** A window theme in miniature: its ground, a prompt, and this Mac's colours. */
export function ThemeSwatch({
  theme,
  palette,
}: {
  theme: PreviewTheme;
  palette: readonly string[];
}): ReactElement {
  return (
    <span
      className="vf-ts-swatch"
      style={{ background: theme.background, color: theme.foreground }}
      aria-hidden="true"
    >
      <span>
        <span style={{ color: palette[4] }}>~/vibe-field</span>{" "}
        <span style={{ color: palette[5] }}>main</span>
      </span>
      <span>
        <span style={{ color: palette[2] }}>❯</span> git status -s
      </span>
      <span>
        <span style={{ color: palette[3] }}> M</span> panels/
        <span style={{ color: palette[6] }}>Terminal.tsx</span>
        <i style={{ background: withAlpha(theme.cursor, theme.cursorAlpha) }} />
      </span>
    </span>
  );
}

function LayerHead({
  at,
  name,
  line,
}: {
  at: 0 | 1 | 2;
  name: string;
  line: string;
}): ReactElement {
  return (
    <div className="vf-ts-layer-head">
      <span className="vf-ts-layer-mark" data-at={at} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="vf-ts-layer-name">{name}</span>
      <span className={labelCls}>{line}</span>
    </div>
  );
}

export function LookTab({
  model,
  previewRef,
}: {
  model: TerminalPageModel;
  /** the page watches THIS element to dock the preview once it scrolls away */
  previewRef?: (node: HTMLDivElement | null) => void;
}): ReactElement {
  const { appearance, previewMode, device } = model;
  const set = (patch: Partial<typeof appearance>): void =>
    model.setAppearance({ ...appearance, ...patch });
  const theme = previewTheme(deckThemeNameForMode(appearance, previewMode), previewMode);
  const stack = appearance.shaderEffects;
  const ordered = [...GHOSTTEA_SHADER_OPTIONS].sort((a, b) => {
    const ia = stack.indexOf(a.id);
    const ib = stack.indexOf(b.id);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return 0;
  });
  const anyAnimated = GHOSTTEA_SHADER_OPTIONS.some(
    (shader) => shader.animated && stack.includes(shader.id),
  );
  const toggleEffect = (id: string): void =>
    set({
      shaderEffects: stack.includes(id) ? stack.filter((entry) => entry !== id) : [...stack, id],
    });
  const moveEffect = (id: string, delta: -1 | 1): void => {
    const from = stack.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= stack.length) return;
    const next = [...stack];
    [next[from], next[to]] = [next[to] as string, next[from] as string];
    set({ shaderEffects: next });
  };
  const snapshot = device.kind === "ready" ? device.snapshot : null;
  const askedFont =
    snapshot !== null && snapshot.fontFamilies.length > 0
      ? `${snapshot.fontFamilies[0]} at ${snapshot.fontSize}`
      : null;

  return (
    <div className="vf-ts-tab" data-tab="look">
      <div className="vf-ts-preview-head">
        <span className="vf-ts-eyebrow">Preview</span>
        <SegmentedControl
          options={["Light", "Dark"] as const}
          value={MODE_LABEL[previewMode]}
          onChange={(value) => model.setPreviewMode(value === "Dark" ? "dark" : "light")}
          label="Preview Godview's light or dark mode"
          size="small"
        />
      </div>
      <div className="vf-ts-preview" data-ts-preview="" ref={previewRef}>
        <GodviewMiniature
          mode={previewMode}
          theme={theme}
          palette={model.palette}
          appearance={appearance}
          caption={
            <>
              <span>
                <b>{theme.name}</b> · {MODE_LABEL[previewMode]} mode
              </span>
              <span>{stack.length > 0 ? "Effects approximated" : "JetBrains Mono · 13 px"}</span>
            </>
          }
        />
      </div>

      <PageSection
        id="look-theme"
        title="Theme"
        scope="window"
        description="One for each of Godview's modes. It sets this window's ground, text, cursor and selection, and applies as you pick."
      >
        <div className="vf-ts-slots">
          {(["light", "dark"] as const).map((mode) => {
            const slotTheme = previewTheme(deckThemeNameForMode(appearance, mode), mode);
            return (
              <button
                key={mode}
                type="button"
                className="vf-ts-slot"
                aria-label={`${MODE_LABEL[mode]} mode theme: ${slotTheme.name}. Choose another`}
                onClick={() => model.openThemes({ kind: "window", mode })}
              >
                <ThemeSwatch theme={slotTheme} palette={model.palette} />
                <span className="vf-ts-slot-foot">
                  <span className="vf-ts-slot-copy">
                    <span className="vf-ts-eyebrow">{MODE_LABEL[mode]} mode</span>
                    <span className="vf-ts-slot-name">{slotTheme.name}</span>
                  </span>
                  <span className="vf-ts-chevron" aria-hidden="true" />
                </span>
              </button>
            );
          })}
        </div>
        <p className={`vf-ts-provenance ${labelCls}`} title={GHOSTTY_THEME_CATALOG_SOURCE}>
          {catalogThemes().length} themes from iTerm2-Color-Schemes, as ghosttea bundles them ·
          revision <span className="vf-ui-mono">{GHOSTTY_THEME_CATALOG_REVISION.slice(0, 8)}</span>
        </p>
      </PageSection>

      <PageSection
        id="look-glass"
        title="Glass"
        scope="window"
        description="Three layers, top to bottom: each terminal's ground, Godview's backdrop, then your canvas. Thin one to see the next through it. The blur only reaches what's behind, never the text."
      >
        <div className="vf-ts-glass">
          <LayerHead at={0} name="Terminal" line="each pane's ground, drawn by the renderer" />
          <SettingsRow
            title="Background opacity"
            description={
              appearance.opacity >= 1
                ? "Solid: Godview's backdrop stays behind the pane."
                : "Godview's backdrop shows through each pane."
            }
          >
            <RangeControl
              id="vf-ts-opacity"
              label="Terminal background opacity"
              min={20}
              max={100}
              value={Math.round(appearance.opacity * 100)}
              format={(value) => `${value}%`}
              onChange={(value) => set({ opacity: value / 100 })}
            />
          </SettingsRow>
          <SettingsRow
            title="Dim program backgrounds too"
            description="Apply the same alpha to backgrounds a program painted itself, like the PASS and FAIL badges. Off by default: a program that colours a cell usually means it."
          >
            <SettingsSwitch
              checked={appearance.opacityCells}
              onChange={(opacityCells) => set({ opacityCells })}
              label="Dim program backgrounds too"
            />
          </SettingsRow>
          <LayerHead
            at={1}
            name="Godview's backdrop"
            line="the stage behind the bodies and the panes"
          />
          <SettingsRow
            title="Backdrop opacity"
            description={
              <>
                {appearance.backdropOpacity >= 1
                  ? "Solid, as Godview ships: your canvas stays hidden."
                  : "Your canvas shows through Godview, behind the bodies and the panes."}
                <span className="vf-ts-was">
                  Godview's system controls edit this same setting; it's saved with this window.
                </span>
              </>
            }
          >
            <RangeControl
              id="vf-ts-backdrop"
              label="Godview backdrop opacity"
              min={0}
              max={100}
              value={Math.round(appearance.backdropOpacity * 100)}
              format={(value) => `${value}%`}
              onChange={(value) => set({ backdropOpacity: value / 100 })}
            />
          </SettingsRow>
          <SettingsRow
            title="Background blur"
            description={
              appearance.backdropOpacity >= 1
                ? "Softens your canvas where it shows through. Godview's backdrop is solid, so there's nothing to soften yet: lower Backdrop opacity first."
                : "Softens your canvas where it shows through, so the bodies and the text stay the sharpest things on screen."
            }
          >
            <RangeControl
              id="vf-ts-blur"
              label="Background blur"
              min={0}
              max={DECK_BACKDROP_BLUR_MAX}
              value={appearance.backdropBlur}
              format={(value) => (value === 0 ? "Off" : `${value} px`)}
              onChange={(backdropBlur) => set({ backdropBlur })}
            />
          </SettingsRow>
          <LayerHead
            at={2}
            name="Your canvas"
            line="the field, held still while Godview covers it"
          />
        </div>
      </PageSection>

      <PageSection
        id="look-effects"
        title="Effects"
        scope="window"
        description="Drawn over this window's panes by its own renderer, top to bottom. They need WebGPU: on the fallback renderer, panes draw without them."
      >
        <div className="vf-ts-effects">
          {ordered.map((shader) => {
            const at = stack.indexOf(shader.id);
            return (
              <div key={shader.id} className="vf-ts-effect" data-ts-anchor={`effect-${shader.id}`}>
                <SettingsSwitch
                  checked={at >= 0}
                  onChange={() => toggleEffect(shader.id)}
                  label={shader.name}
                />
                <div className="vf-ts-effect-copy">
                  <div className="vf-ts-effect-name">
                    {shader.name}
                    {shader.animated && <span className="vf-ts-tag">Moves</span>}
                    <span className="vf-ts-tag" title="Licence">
                      {shader.license}
                    </span>
                  </div>
                  <div className={labelCls}>{shader.description}</div>
                </div>
                {at >= 0 && stack.length > 1 ? (
                  <fieldset className="vf-ts-effect-order" aria-label={`Order of ${shader.name}`}>
                    <span className="vf-ts-effect-index">{at + 1}</span>
                    <UiIconButton
                      disabled={at === 0}
                      aria-label={`Move ${shader.name} up`}
                      onClick={() => moveEffect(shader.id, -1)}
                    >
                      <span className="vf-ts-chevron" data-turn="up" aria-hidden="true" />
                    </UiIconButton>
                    <UiIconButton
                      disabled={at === stack.length - 1}
                      aria-label={`Move ${shader.name} down`}
                      onClick={() => moveEffect(shader.id, 1)}
                    >
                      <span className="vf-ts-chevron" data-turn="down" aria-hidden="true" />
                    </UiIconButton>
                  </fieldset>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
        <SettingsRow
          title="Animate effects"
          divider={false}
          description={
            anyAnimated
              ? "Runs the motion in VHS and Sparks from Fire. It stops whenever the deck is hidden or loses focus."
              : "Only VHS and Sparks from Fire move. Turn one on to use this."
          }
        >
          <SettingsSwitch
            checked={appearance.shaderAnimate && anyAnimated}
            disabled={!anyAnimated}
            onChange={(shaderAnimate) => set({ shaderAnimate })}
            label="Animate effects"
          />
        </SettingsRow>
        <details className="vf-ts-more">
          <summary>
            {UNAVAILABLE_UPSTREAM_SHADERS.length} more of Ghostty's community shaders aren't bundled
          </summary>
          <p className={labelCls}>
            Their redistribution terms are unclear, so ghosttea names them and doesn't ship them:{" "}
            {UNAVAILABLE_UPSTREAM_SHADERS.join(", ")}.
          </p>
        </details>
      </PageSection>

      <PageSection
        id="look-palette"
        title="Program colors"
        scope="mac"
        when="after-save"
        description="The sixteen colours programs paint with. The terminal service applies them to every session on this Mac, so every window shows the same ones — a window's theme can't carry them yet."
        action={
          device.kind === "ready" ? (
            <UiButton onClick={() => model.openThemes({ kind: "palette" })}>
              Match a theme…
            </UiButton>
          ) : undefined
        }
      >
        {device.kind === "ready" ? (
          <>
            <div className="vf-ts-palette">
              {model.palette.map((color, index) => {
                const from = model.paletteHere.has(index)
                  ? "set in config.ghostty"
                  : model.paletteElsewhere.has(index)
                    ? "from your Ghostty file"
                    : "Ghostty's default";
                return (
                  <span
                    key={index}
                    className="vf-ts-palette-cell"
                    title={`${index} · ${color} · ${from}`}
                  >
                    <i style={{ background: color }} />
                    <span>
                      {index}
                      {from !== "Ghostty's default" && <b title={from}>•</b>}
                    </span>
                  </span>
                );
              })}
            </div>
            <div className="vf-ts-palette-foot">
              <span className={labelCls}>
                {model.paletteHere.size > 0
                  ? `${model.paletteHere.size} set in config.ghostty`
                  : "None set in config.ghostty"}
                {model.paletteElsewhere.size > 0
                  ? ` · ${model.paletteElsewhere.size} from your Ghostty file (•)`
                  : ""}
              </span>
              {/* Dropping this Mac's lines leaves your Ghostty file's colours in
                  force — the button says Ghostty's defaults only when that's
                  what the click leaves. */}
              <UiButton
                disabled={model.managed.palette === null}
                onClick={() => model.setManaged({ ...model.managed, palette: null })}
              >
                {model.paletteElsewhere.size > 0
                  ? "Clear this Mac's colors"
                  : "Use Ghostty's defaults"}
              </UiButton>
            </div>
          </>
        ) : (
          <DeviceUnavailable model={model} compact />
        )}
      </PageSection>

      <PageSection
        id="look-text"
        title="Font & cursor"
        scope="fact"
        description="ghosttea 0.12.0 draws the desktop terminal with a fixed font and cursor, so these are facts rather than choices."
      >
        <SettingsRow
          title="Font"
          description={
            <>
              The first of JetBrains Mono, Fira Code, Cascadia Code, SF Mono and Menlo installed on
              this Mac, at a fixed 13 px.
              {askedFont !== null && (
                <>
                  {" "}
                  Your Ghostty file asks for <b>{askedFont}</b>; ghosttea keeps those lines, but the
                  desktop doesn't read them yet.
                </>
              )}{" "}
              When it does, this becomes a font picker.
            </>
          }
        >
          <Fact>JetBrains Mono · 13 px</Fact>
        </SettingsRow>
        <SettingsRow
          title="Cursor"
          divider={false}
          description="ghosttea's block cursor. cursor-style and cursor-style-blink are recognized in a config file but not applied yet."
        >
          <Fact>Block</Fact>
        </SettingsRow>
      </PageSection>
    </div>
  );
}

/** The device side's honest face when the terminal service can't be asked. */
export function DeviceUnavailable({
  model,
  compact = false,
}: {
  model: TerminalPageModel;
  compact?: boolean;
}): ReactElement | null {
  const { device } = model;
  if (device.kind === "loading") {
    return <p className={labelCls}>Reading config.ghostty…</p>;
  }
  if (device.kind !== "unavailable") return null;
  return (
    <div className="vf-ts-unavailable">
      <UnavailableState
        compact={compact}
        title={device.title}
        description={
          <>{device.detail} This window's look still works: it's stored here, not in the file.</>
        }
      />
      {device.retryable && (
        <UiButton onClick={model.retry} className="vf-ts-unavailable-retry">
          Try again
        </UiButton>
      )}
    </div>
  );
}
