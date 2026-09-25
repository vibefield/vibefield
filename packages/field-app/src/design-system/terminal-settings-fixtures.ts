import type { TerminalConfigSnapshot, TerminalConfigValidation } from "@vibefield/contracts";

// Settings → Terminal's catalog fixtures (GT-7): the documents and loader
// snapshots a real fieldd would answer, written out — never a copy of the
// page's markup. The preview mounts the shipping `TerminalSettingsView` over
// them (docs/UI_SYSTEM.md's fixture-adapter rule).

export const TERMINAL_FIXTURE_STATES = [
  "everyday",
  "pending",
  "error",
  "includes",
  "unavailable",
] as const;
export type TerminalFixtureState = (typeof TERMINAL_FIXTURE_STATES)[number];

export const FIXTURE_CONFIG_PATH =
  "/Users/you/Library/Application Support/VibeField/native/config.ghostty";
const GHOSTTY_FILE = "/Users/you/.config/ghostty/config";

export const FIXTURE_SAVED_TEXT = `# By hand — Settings leaves these lines alone.
cursor-style = bar
font-thicken = true

# >>> Ghosttea common settings (managed; edit through Settings)
# Settings → Terminal writes the lines in this block. Everything outside it is yours.
scrollback-limit = 25000000
keybind = ctrl+super+k=clear_screen
# <<< Ghosttea common settings
`;

const BASE: TerminalConfigSnapshot = {
  revision: "fixture-effective-1",
  ghosttyVersion: "1.3.1",
  knownKeyCount: 202,
  sources: [
    { path: GHOSTTY_FILE, kind: "ghostty-default" },
    { path: FIXTURE_CONFIG_PATH, kind: "ghosttea-overlay" },
  ],
  diagnostics: [
    {
      severity: "info",
      code: "recognized-not-applied",
      message:
        "Ghostty key `cursor-style` is recognized by the compatibility schema but is not applied yet",
      key: "cursor-style",
    },
    {
      severity: "info",
      code: "recognized-not-applied",
      message:
        "Ghostty key `font-thicken` is recognized by the compatibility schema but is not applied yet",
      key: "font-thicken",
    },
  ],
  configuredKeys: [
    { key: "cursor-style", support: "unsupported", occurrences: 1 },
    { key: "font-family", support: "parsed", occurrences: 1 },
    { key: "font-size", support: "parsed", occurrences: 1 },
    { key: "font-thicken", support: "unsupported", occurrences: 1 },
    { key: "keybind", support: "parsed", occurrences: 2 },
    { key: "palette", support: "applied", occurrences: 2 },
    { key: "scrollback-limit", support: "applied", occurrences: 1 },
  ],
  keybindings: [
    { trigger: "super+shift+enter", action: "toggle_split_zoom" },
    { trigger: "ctrl+super+k", action: "clear_screen" },
  ],
  clearKeybindings: false,
  scrollbackBytes: 25_000_000,
  palette: [
    { index: 1, color: "#e06c75" },
    { index: 2, color: "#98c379" },
  ],
  fontSize: 14,
  fontFamilies: ["Berkeley Mono"],
};

export const FIXTURE_SAVED_SNAPSHOT: TerminalConfigSnapshot = BASE;

/** The draft each state opens with, and what the loader said about it. */
export function fixtureDraft(state: TerminalFixtureState): {
  draft: string;
  validation: TerminalConfigValidation | null;
} {
  if (state === "pending") {
    const draft = FIXTURE_SAVED_TEXT.replace(
      "scrollback-limit = 25000000",
      "palette = 1=#bf616a\npalette = 2=#a3be8c\npalette = 4=#81a1c1\nscrollback-limit = 50000000",
    );
    return {
      draft,
      validation: {
        documentRevision: "fixture-document-1",
        includesAllowed: true,
        blocking: [],
        config: {
          ...BASE,
          scrollbackBytes: 50_000_000,
          palette: [
            { index: 1, color: "#bf616a" },
            { index: 2, color: "#a3be8c" },
            { index: 4, color: "#81a1c1" },
          ],
        },
      },
    };
  }
  if (state === "error") {
    const draft = `${FIXTURE_SAVED_TEXT}background = #12\n`;
    const error = {
      severity: "error",
      code: "invalid-color",
      message: "`background` is not a Ghostty color: `#12`",
      source: FIXTURE_CONFIG_PATH,
      line: 10,
      key: "background",
    };
    return {
      draft,
      validation: {
        documentRevision: "fixture-document-1",
        includesAllowed: true,
        blocking: [error],
        config: { ...BASE, diagnostics: [...BASE.diagnostics, error] },
      },
    };
  }
  if (state === "includes") {
    return {
      draft: `config-file = ~/work/ghostty-theme\n${FIXTURE_SAVED_TEXT}`,
      validation: { documentRevision: "fixture-document-1", includesAllowed: false, blocking: [] },
    };
  }
  return { draft: FIXTURE_SAVED_TEXT, validation: null };
}
