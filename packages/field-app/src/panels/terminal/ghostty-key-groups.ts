import { GHOSTTY_KEYS, type GhosttyKeySupport } from "./ghostty-keys.generated";

// The Config file tab's reference (GT-7): every Ghostty key the pinned loader
// knows, grouped the way a person looks for them, each with what it does IN
// THE DECK. The keys and their support are generated from the crate
// (`ghostty-keys.generated.ts`); the groups and the notes are this page's
// words, and a test fails unless every generated key lands in exactly one group
// — so a pin move that adds a key cannot silently drop it from the reference.

export interface KeyGroup {
  readonly id: string;
  readonly label: string;
  readonly keys: readonly string[];
}

export const KEY_GROUPS: readonly KeyGroup[] = [
  {
    id: "colors",
    label: "Theme & colors",
    keys: [
      "background",
      "foreground",
      "palette",
      "selection-background",
      "selection-foreground",
      "theme",
      "bold-color",
      "minimum-contrast",
      "palette-generate",
      "palette-harmonious",
      "faint-opacity",
      "search-background",
      "search-foreground",
      "search-selected-background",
      "search-selected-foreground",
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    keys: [
      "cursor-color",
      "cursor-text",
      "adjust-cursor-height",
      "adjust-cursor-thickness",
      "cursor-click-to-move",
      "cursor-opacity",
      "cursor-style",
      "cursor-style-blink",
    ],
  },
  {
    id: "window",
    label: "Window, glass & padding",
    keys: [
      "background-opacity",
      "background-opacity-cells",
      "window-padding-x",
      "window-padding-y",
      "background-blur",
      "background-image",
      "background-image-fit",
      "background-image-opacity",
      "background-image-position",
      "background-image-repeat",
      "fullscreen",
      "initial-window",
      "maximize",
      "resize-overlay",
      "resize-overlay-duration",
      "resize-overlay-position",
      "title",
      "window-colorspace",
      "window-decoration",
      "window-height",
      "window-inherit-font-size",
      "window-padding-balance",
      "window-padding-color",
      "window-position-x",
      "window-position-y",
      "window-save-state",
      "window-step-resize",
      "window-subtitle",
      "window-theme",
      "window-title-font-family",
      "window-titlebar-background",
      "window-titlebar-foreground",
      "window-width",
      "quit-after-last-window-closed",
      "quit-after-last-window-closed-delay",
    ],
  },
  {
    id: "font",
    label: "Font & text",
    keys: [
      "font-family",
      "font-size",
      "adjust-box-thickness",
      "adjust-cell-height",
      "adjust-cell-width",
      "adjust-font-baseline",
      "adjust-icon-height",
      "adjust-overline-position",
      "adjust-overline-thickness",
      "adjust-strikethrough-position",
      "adjust-strikethrough-thickness",
      "adjust-underline-position",
      "adjust-underline-thickness",
      "font-codepoint-map",
      "font-family-bold",
      "font-family-bold-italic",
      "font-family-italic",
      "font-feature",
      "font-shaping-break",
      "font-style",
      "font-style-bold",
      "font-style-bold-italic",
      "font-style-italic",
      "font-synthetic-style",
      "font-thicken",
      "font-thicken-strength",
      "font-variation",
      "font-variation-bold",
      "font-variation-bold-italic",
      "font-variation-italic",
      "freetype-load-flags",
      "grapheme-width-method",
    ],
  },
  { id: "effects", label: "Effects", keys: ["custom-shader", "custom-shader-animation"] },
  {
    id: "scroll",
    label: "Scrollback, selection & clipboard",
    keys: [
      "scrollback-limit",
      "scroll-to-bottom",
      "scrollbar",
      "selection-clear-on-copy",
      "selection-clear-on-typing",
      "selection-word-chars",
      "copy-on-select",
      "clipboard-codepoint-map",
      "clipboard-paste-bracketed-safe",
      "clipboard-paste-protection",
      "clipboard-read",
      "clipboard-trim-trailing-spaces",
      "clipboard-write",
    ],
  },
  {
    id: "mouse",
    label: "Mouse & links",
    keys: [
      "link-url",
      "click-repeat-interval",
      "focus-follows-mouse",
      "link",
      "link-previews",
      "mouse-hide-while-typing",
      "mouse-reporting",
      "mouse-scroll-multiplier",
      "mouse-shift-capture",
      "right-click-action",
    ],
  },
  {
    id: "keys",
    label: "Keyboard",
    keys: ["keybind", "key-remap", "command-palette-entry", "vt-kam-allowed"],
  },
  {
    id: "shell",
    label: "Shell & command",
    keys: [
      "shell-integration",
      "shell-integration-features",
      "command",
      "initial-command",
      "input",
      "env",
      "term",
      "working-directory",
      "wait-after-command",
      "abnormal-command-exit-runtime",
    ],
  },
  {
    id: "bell",
    label: "Bell & notifications",
    keys: [
      "bell-audio-path",
      "bell-audio-volume",
      "bell-features",
      "app-notifications",
      "desktop-notifications",
      "notify-on-command-finish",
      "notify-on-command-finish-action",
      "notify-on-command-finish-after",
    ],
  },
  {
    id: "splits",
    label: "Splits, tabs & closing",
    keys: [
      "split-divider-color",
      "split-inherit-working-directory",
      "split-preserve-zoom",
      "unfocused-split-fill",
      "unfocused-split-opacity",
      "tab-inherit-working-directory",
      "window-inherit-working-directory",
      "window-new-tab-position",
      "window-show-tab-bar",
      "confirm-close-surface",
      "undo-timeout",
    ],
  },
  {
    id: "render",
    label: "Renderer & emulation",
    keys: [
      "alpha-blending",
      "async-backend",
      "image-storage-limit",
      "window-vsync",
      "enquiry-response",
      "osc-color-report-format",
      "title-report",
      "progress-style",
    ],
  },
  {
    id: "files",
    label: "Config files & app",
    keys: ["config-file", "auto-update", "auto-update-channel", "language", "config-default-files"],
  },
  {
    id: "macos",
    label: "macOS",
    keys: [
      "macos-applescript",
      "macos-auto-secure-input",
      "macos-custom-icon",
      "macos-dock-drop-behavior",
      "macos-hidden",
      "macos-icon",
      "macos-icon-frame",
      "macos-icon-ghost-color",
      "macos-icon-screen-color",
      "macos-non-native-fullscreen",
      "macos-option-as-alt",
      "macos-secure-input-indication",
      "macos-shortcuts",
      "macos-titlebar-proxy-icon",
      "macos-titlebar-style",
      "macos-window-buttons",
      "macos-window-shadow",
    ],
  },
  {
    id: "linux",
    label: "GTK, Linux & X11",
    keys: [
      "gtk-custom-css",
      "gtk-opengl-debug",
      "gtk-quick-terminal-layer",
      "gtk-quick-terminal-namespace",
      "gtk-single-instance",
      "gtk-tabs-location",
      "gtk-titlebar",
      "gtk-titlebar-hide-when-maximized",
      "gtk-titlebar-style",
      "gtk-toolbar-style",
      "gtk-wide-tabs",
      "linux-cgroup",
      "linux-cgroup-hard-fail",
      "linux-cgroup-memory-limit",
      "linux-cgroup-processes-limit",
      "class",
      "x11-instance-name",
    ],
  },
  {
    id: "quick",
    label: "Quick terminal",
    keys: [
      "quick-terminal-animation-duration",
      "quick-terminal-autohide",
      "quick-terminal-keyboard-interactivity",
      "quick-terminal-position",
      "quick-terminal-screen",
      "quick-terminal-size",
      "quick-terminal-space-behavior",
    ],
  },
];

/** When a key's value takes effect in the deck, in the page's words. */
export type KeyTiming = "live" | "new-terminals" | "this-window" | "kept" | "ignored";

export interface KeyNote {
  readonly timing: KeyTiming;
  readonly note: string;
}

/** What each key ghosttea reads DOES in VibeField's deck. Keys it ignores need
 * no note beyond their support; a few ignored ones point at the control that
 * does the job in the deck. */
const NOTES: Readonly<Record<string, KeyNote>> = {
  background: {
    timing: "this-window",
    note: "A session default; the deck draws this window's theme instead.",
  },
  foreground: {
    timing: "this-window",
    note: "A session default; the deck draws this window's theme instead.",
  },
  "cursor-color": {
    timing: "this-window",
    note: "A session default; the deck draws this window's theme instead.",
  },
  "cursor-text": { timing: "this-window", note: "The deck draws this window's theme instead." },
  "selection-background": {
    timing: "this-window",
    note: "The deck draws this window's theme instead.",
  },
  "selection-foreground": {
    timing: "this-window",
    note: "The deck draws this window's theme instead.",
  },
  "background-opacity": {
    timing: "this-window",
    note: "The deck uses this window's Glass setting.",
  },
  "background-opacity-cells": {
    timing: "this-window",
    note: "The deck uses this window's Glass setting.",
  },
  palette: {
    timing: "live",
    note: "The colours programs paint with. Every session on this Mac, live after a save.",
  },
  "scrollback-limit": {
    timing: "new-terminals",
    note: "Bytes of history per terminal, for terminals opened after a save.",
  },
  "custom-shader-animation": {
    timing: "this-window",
    note: "Used only when this window has chosen no effect.",
  },
  "custom-shader": {
    timing: "this-window",
    note: "The four ghosttea: ports run when this window has chosen none; any other path is kept and never run.",
  },
  keybind: {
    timing: "live",
    note: "Shortcuts apply after a save. The Keyboard tab says which ones run in the deck.",
  },
  "config-file": {
    timing: "live",
    note: "Includes load in order. Settings keeps them as they are — edit them in the file itself.",
  },
  "font-family": {
    timing: "kept",
    note: "Kept, not drawn: the desktop deck picks its own font (JetBrains Mono first).",
  },
  "font-size": {
    timing: "kept",
    note: "Kept, not drawn: the desktop deck draws at a fixed 13 px.",
  },
  "window-padding-x": {
    timing: "kept",
    note: "Kept, not drawn: the desktop grid has a fixed 2 px inset.",
  },
  "window-padding-y": {
    timing: "kept",
    note: "Kept, not drawn: the desktop grid has a fixed 2 px inset.",
  },
  "link-url": {
    timing: "ignored",
    note: "Recognized, not applied by ghosttea 0.11.1; unreleased ghosttea work applies it.",
  },
  "background-blur": {
    timing: "ignored",
    note: "Ignored by ghosttea. In the deck, Look → Glass → Background blur softens your canvas behind Godview.",
  },
};

export interface KeyEntry {
  readonly key: string;
  readonly support: GhosttyKeySupport;
  readonly group: KeyGroup;
  readonly note: KeyNote | null;
}

const GROUP_OF = new Map<string, KeyGroup>();
for (const group of KEY_GROUPS) for (const key of group.keys) GROUP_OF.set(key, group);

/** Every generated key, with its group and note, in the groups' order. Keys a
 * future pin adds and nobody grouped yet land in a last "Other" group rather
 * than vanishing (the test still fails, which is the point). */
export const KEY_ENTRIES: readonly KeyEntry[] = (() => {
  const other: KeyGroup = { id: "other", label: "Other", keys: [] };
  const entries = GHOSTTY_KEYS.map((entry) => ({
    key: entry.key,
    support: entry.support,
    group: GROUP_OF.get(entry.key) ?? other,
    note: NOTES[entry.key] ?? null,
  }));
  const order = [...KEY_GROUPS, other];
  return entries.sort(
    (a, b) =>
      order.indexOf(a.group) - order.indexOf(b.group) ||
      a.group.keys.indexOf(a.key) - b.group.keys.indexOf(b.key) ||
      a.key.localeCompare(b.key),
  );
})();

export const KEY_BY_NAME: ReadonlyMap<string, KeyEntry> = new Map(
  KEY_ENTRIES.map((entry) => [entry.key, entry]),
);

export const KEY_COUNTS = {
  known: GHOSTTY_KEYS.length,
  applied: GHOSTTY_KEYS.filter((entry) => entry.support === "applied").length,
  parsed: GHOSTTY_KEYS.filter((entry) => entry.support === "parsed").length,
  unsupported: GHOSTTY_KEYS.filter((entry) => entry.support === "unsupported").length,
} as const;
