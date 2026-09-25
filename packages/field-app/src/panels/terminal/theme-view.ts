import {
  GHOSTTY_COLOR_THEMES,
  type GhostteaColorTheme,
  TERMINAL_THEMES,
} from "@vibecook/ghosttea-react/workspace";

// A window theme as the page DRAWS it (GT-7): the preview, the slots and the
// browser's rows all colour from this one shape, resolved the way the deck
// resolves its own theme (`deck-theme.ts`): a catalog name, or Godview's
// built-in palette for that mode when there is none (or the name is gone).

export type PreviewMode = "light" | "dark";

export interface PreviewTheme {
  /** the catalog name, or the built-in's product name */
  readonly name: string;
  /** the catalog entry's name, null for Godview's own */
  readonly catalogName: string | null;
  readonly dark: boolean;
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAlpha: number;
  readonly selection: string;
  readonly selectionAlpha: number;
  readonly selectionForeground: string;
  /** the theme's own sixteen, or null for Godview's (which bring none) */
  readonly palette: readonly string[] | null;
}

type Rgba = readonly [number, number, number, number];

function hexOf([r, g, b]: Rgba): string {
  const channel = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Relative luminance of `#rrggbb`, 0–1. */
export function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (!Number.isFinite(value)) return 0;
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear((value >> 16) & 255) +
    0.7152 * linear((value >> 8) & 255) +
    0.0722 * linear(value & 255)
  );
}

function builtin(mode: PreviewMode): PreviewTheme {
  const theme = mode === "dark" ? TERMINAL_THEMES.midnight : TERMINAL_THEMES.daylight;
  return {
    name: mode === "dark" ? "Godview Midnight" : "Godview Daylight",
    catalogName: null,
    dark: mode === "dark",
    background: hexOf(theme.background),
    foreground: hexOf(theme.foreground),
    cursor: hexOf(theme.cursor),
    cursorAlpha: theme.cursor[3],
    selection: hexOf(theme.selection),
    selectionAlpha: theme.selection[3],
    selectionForeground: hexOf(theme.selectionForeground),
    palette: null,
  };
}

function normalizeHex(value: string): string {
  const raw = value.trim().replace(/^#/u, "").toLowerCase();
  if (/^[0-9a-f]{6}$/u.test(raw)) return `#${raw}`;
  if (/^[0-9a-f]{3}$/u.test(raw)) return `#${[...raw].map((c) => c + c).join("")}`;
  return `#${raw.slice(0, 6).padEnd(6, "0")}`;
}

function fromCatalog(theme: GhostteaColorTheme): PreviewTheme {
  const background = normalizeHex(theme.background);
  return {
    name: theme.name,
    catalogName: theme.name,
    dark: luminance(background) < 0.3,
    background,
    foreground: normalizeHex(theme.foreground),
    cursor: normalizeHex(theme.cursor),
    cursorAlpha: 1,
    selection: normalizeHex(theme.selection),
    selectionAlpha: 1,
    selectionForeground: normalizeHex(theme.selectionForeground),
    palette: theme.palette.length >= 16 ? theme.palette.slice(0, 16).map(normalizeHex) : null,
  };
}

let catalog: readonly PreviewTheme[] | null = null;
let byName: ReadonlyMap<string, PreviewTheme> | null = null;

/** The 602 catalog themes as previews, built once on first use. */
export function catalogThemes(): readonly PreviewTheme[] {
  catalog ??= GHOSTTY_COLOR_THEMES.map(fromCatalog).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return catalog;
}

/** Godview's two built-in palettes. */
export const BUILTIN_THEMES: Readonly<Record<PreviewMode, PreviewTheme>> = {
  light: builtin("light"),
  dark: builtin("dark"),
};

/** The theme a window draws for a mode: the named catalog entry, else Godview's own. */
export function previewTheme(name: string | null, mode: PreviewMode): PreviewTheme {
  if (name === null) return BUILTIN_THEMES[mode];
  byName ??= new Map(catalogThemes().map((theme) => [theme.name, theme]));
  return byName.get(name) ?? BUILTIN_THEMES[mode];
}

/** `#rrggbb` + alpha as a CSS colour. */
export function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  return `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)`;
}
