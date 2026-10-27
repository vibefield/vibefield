import {
  formatGhosttyTrigger,
  GHOSTTEA_BINDING_EXTENSIONS,
  GHOSTTY_MACOS_DEFAULT_BINDINGS,
  type GhosttyBindingEntry,
  type GhosttyTrigger,
  parseGhostteaBindingAction,
  parseGhosttyTrigger,
  type RoutedAction,
  routeBindingAction,
  routeConsumesInput,
} from "@vibecook/ghosttea-react/workspace";
import type { TerminalConfigKeybinding } from "@vibefield/contracts";
import { PRODUCT_CHORDS, type ProductChord } from "../../field/product-chords";

// Settings → Terminal → Keyboard, as data (GT-7). Every fact here is ghosttea's
// own: the defaults are the pinned package's dump of Ghostty's macOS table
// (`GHOSTTY_MACOS_DEFAULT_BINDINGS`, 93, plus its one extension), whether an
// action RUNS in the deck is its router's answer (`routeBindingAction`), what
// becomes of the key once it has is the surface's own rule (`routeConsumesInput`),
// and the effective list is the loader's snapshot of every layer (`keybindings` +
// `clearKeybindings`). This file only lays them side by side.

/** Where a binding's action goes in the deck — ghosttea's router, or `invalid`
 * for an action its parser refuses. An `unhandled` bind does nothing yet; whether
 * its key still reaches the shell is `keyFate`'s answer, not the route's. */
export type BindingRoute = "workspace" | "terminal" | "platform" | "unhandled" | "invalid";

/** A binding's Ghostty flags (`all:`, `global:`, `unconsumed:`, `performable:`),
 * in ghosttea's own shape. */
export type BindingFlags = GhosttyBindingEntry["flags"];

const NO_FLAGS: BindingFlags = { performable: false };

const TRIGGER_PREFIXES = ["all:", "global:", "unconsumed:", "performable:"] as const;

function prefixesOf(raw: string): { prefixes: Set<string>; rest: string } {
  const prefixes = new Set<string>();
  let rest = raw.trim();
  for (let changed = true; changed; ) {
    changed = false;
    for (const prefix of TRIGGER_PREFIXES) {
      if (rest.startsWith(prefix)) {
        prefixes.add(prefix);
        rest = rest.slice(prefix.length);
        changed = true;
      }
    }
  }
  return { prefixes, rest };
}

function stripPrefixes(raw: string): string {
  return prefixesOf(raw).rest;
}

/** The flags a trigger carries, as a layer wrote it — the loader keeps triggers
 * verbatim, prefixes and all. */
export function triggerFlags(raw: string): BindingFlags {
  const { prefixes } = prefixesOf(raw);
  const flags: BindingFlags = { performable: prefixes.has("performable:") };
  if (prefixes.has("unconsumed:")) flags.unconsumed = true;
  if (prefixes.has("all:")) flags.all = true;
  if (prefixes.has("global:")) flags.global = true;
  return flags;
}

/** Whether a trigger, as a layer wrote it, carries Ghostty's `performable:` flag. */
export function isPerformableTrigger(raw: string): boolean {
  return triggerFlags(raw).performable;
}

/** A bare trigger with `flags` written back as its prefixes, in Ghostty's order —
 * what a chord moved to a new trigger keeps, so its key's fate moves with it. */
export function flaggedTrigger(trigger: string, flags: BindingFlags): string {
  const bare = stripPrefixes(trigger);
  const on: Record<(typeof TRIGGER_PREFIXES)[number], boolean> = {
    "all:": flags.all === true,
    "global:": flags.global === true,
    "unconsumed:": flags.unconsumed === true,
    "performable:": flags.performable,
  };
  return `${TRIGGER_PREFIXES.filter((prefix) => on[prefix]).join("")}${bare}`;
}

function parseTrigger(raw: string): GhosttyTrigger | null {
  try {
    return parseGhosttyTrigger(stripPrefixes(raw));
  } catch {
    return null;
  }
}

/** A trigger's identity, independent of spelling (`cmd+K` ≡ `super+k`), or
 * null when ghosttea's parser refuses it. */
export function triggerKey(raw: string): string | null {
  const trigger = parseTrigger(raw);
  if (trigger === null) return null;
  const mods = (["ctrl", "alt", "shift", "super"] as const).filter((mod) => trigger.mods[mod]);
  const key =
    trigger.key.kind === "unicode"
      ? trigger.key.value.toLowerCase()
      : trigger.key.kind === "physical"
        ? trigger.key.name
        : `special:${trigger.key.name}`;
  // Ghostty's table binds super+digit_1 and super+1 alike; one identity.
  const folded = /^digit_(\d)$/u.exec(key)?.[1] ?? key;
  return [...mods, folded].join("+");
}

/** Split a `keybind` value the way the loader does: the first `=` whose left
 * side is a trigger ghosttea's parser accepts (a trigger may itself end in
 * `=`, as `super+=` does). */
export function splitBinding(value: string): { trigger: string; action: string } | null {
  const text = value.trim();
  for (let index = text.indexOf("="); index >= 0; index = text.indexOf("=", index + 1)) {
    const trigger = text.slice(0, index).trim();
    const action = text.slice(index + 1).trim();
    if (trigger !== "" && action !== "" && triggerKey(trigger) !== null) return { trigger, action };
  }
  return null;
}

const MOD_GLYPH = { ctrl: "⌃", alt: "⌥", shift: "⇧", super: "⌘" } as const;
const KEY_LABEL: Record<string, string> = {
  arrow_left: "←",
  arrow_right: "→",
  arrow_up: "↑",
  arrow_down: "↓",
  enter: "↩",
  tab: "⇥",
  backspace: "⌫",
  delete: "⌦",
  escape: "Esc",
  space: "Space",
  page_up: "Page Up",
  page_down: "Page Down",
  home: "Home",
  end: "End",
  "special:copy": "Copy key",
  "special:paste": "Paste key",
};

/** The chord as a Mac keyboard shows it: ⌃⌥⇧⌘ then the key. */
export function chordGlyphs(raw: string): string[] {
  const trigger = parseTrigger(raw);
  if (trigger === null) return [raw];
  const mods = (["ctrl", "alt", "shift", "super"] as const)
    .filter((mod) => trigger.mods[mod])
    .map((mod) => MOD_GLYPH[mod]);
  const key =
    trigger.key.kind === "unicode"
      ? trigger.key.value.toUpperCase()
      : trigger.key.kind === "special"
        ? (KEY_LABEL[`special:${trigger.key.name}`] ?? trigger.key.name)
        : (KEY_LABEL[trigger.key.name] ??
          /^digit_(\d)$/u.exec(trigger.key.name)?.[1] ??
          /^f(\d{1,2})$/u.exec(trigger.key.name)?.[0].toUpperCase() ??
          trigger.key.name);
  return [...mods, key];
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
};
const PHYSICAL: Record<string, string> = {
  ArrowLeft: "arrow_left",
  ArrowRight: "arrow_right",
  ArrowUp: "arrow_up",
  ArrowDown: "arrow_down",
  PageUp: "page_up",
  PageDown: "page_down",
  Home: "home",
  End: "end",
  Tab: "tab",
  Enter: "enter",
  Escape: "escape",
  Backspace: "backspace",
  Delete: "delete",
  Space: "space",
};

/** A recorded key press as a Ghostty trigger — printable keys by their
 * UNSHIFTED character (Ghostty writes `super+shift+[`), named keys by their
 * physical name — formatted by ghosttea itself so it reads back identically.
 * Null for a lone modifier. */
export function triggerFromKeyEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): string | null {
  if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn"].includes(event.key)) return null;
  const mods = {
    super: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
  const letter = /^Key([A-Z])$/u.exec(event.code)?.[1];
  const digit = /^Digit(\d)$/u.exec(event.code)?.[1];
  const fkey = /^F(\d{1,2})$/u.exec(event.code)?.[1];
  let key: GhosttyTrigger["key"];
  if (letter !== undefined) key = { kind: "unicode", value: letter.toLowerCase() };
  else if (digit !== undefined) key = { kind: "unicode", value: digit };
  else if (CODE_KEYS[event.code] !== undefined)
    key = { kind: "unicode", value: CODE_KEYS[event.code] ?? "" };
  else if (PHYSICAL[event.code] !== undefined)
    key = { kind: "physical", name: PHYSICAL[event.code] ?? "" };
  else if (fkey !== undefined) key = { kind: "physical", name: `f${fkey}` };
  else if (event.key.length === 1) key = { kind: "unicode", value: event.key.toLowerCase() };
  else return null;
  return formatGhosttyTrigger({ mods, key });
}

function routed(action: string, flags: BindingFlags): RoutedAction | null {
  try {
    return routeBindingAction(parseGhostteaBindingAction(action), flags);
  } catch {
    return null;
  }
}

/** An action's route in the deck, as ghosttea's router classifies it. */
export function routeOfAction(action: string, flags: BindingFlags = NO_FLAGS): BindingRoute {
  return routed(action, flags)?.kind ?? "invalid";
}

/** What becomes of a binding's key, once its action ran (`performed`) and when it
 * could not (`unperformed`): `consume` keeps it from the shell, `encode` sends it
 * on, as if nothing were bound. Ghosttea 0.13.3's surface rule (#81, after Ghostty's
 * `Surface.maybeHandleBinding`): an `unconsumed:` bind sends its key on after its
 * action, a `performable:` one whose action could not run acts absent, `all:` and
 * `global:` binds and `ignore` always consume, and anything else consumes, so app
 * shortcuts never leak to the PTY. `routeConsumesInput` is ghosttea's
 * `bindingKeyDisposition` plus the `ignore` rule, which is why this asks it rather
 * than the bare disposition. An unhandled action is never performed. */
export function keyFate(
  action: string,
  flags: BindingFlags,
): { performed: "consume" | "encode"; unperformed: "consume" | "encode" } | null {
  const route = routed(action, flags);
  if (route === null) return null;
  const fate = (performed: boolean) =>
    routeConsumesInput(route, performed) ? ("consume" as const) : ("encode" as const);
  const unperformed = fate(false);
  return { performed: route.kind === "unhandled" ? unperformed : fate(true), unperformed };
}

const ACTION_LABEL: Record<string, string> = {
  copy_to_clipboard: "Copy",
  paste_from_clipboard: "Paste",
  paste_from_selection: "Paste the selection",
  select_all: "Select all",
  clear_screen: "Clear the screen",
  increase_font_size: "Bigger text",
  decrease_font_size: "Smaller text",
  reset_font_size: "Default text size",
  new_tab: "New tab",
  close_tab: "Close tab",
  new_window: "New window",
  close_window: "Close window",
  close_all_windows: "Close all windows",
  close_surface: "Close pane",
  new_split: "Split",
  goto_split: "Move to split",
  resize_split: "Resize split",
  equalize_splits: "Equalize splits",
  toggle_split_zoom: "Zoom the pane",
  toggle_fullscreen: "Full screen",
  open_config: "Open the config",
  reload_config: "Reload the config",
  toggle_command_palette: "Command palette",
  start_search: "Find",
  search_selection: "Find the selection",
  navigate_search: "Find next or previous",
  end_search: "Close find",
  scroll_to_top: "Scroll to top",
  scroll_to_bottom: "Scroll to bottom",
  scroll_to_selection: "Scroll to selection",
  scroll_page_up: "Page up",
  scroll_page_down: "Page down",
  jump_to_prompt: "Jump between prompts",
  adjust_selection: "Grow the selection",
  goto_tab: "Go to tab",
  next_tab: "Next tab",
  previous_tab: "Previous tab",
  last_tab: "Last tab",
  write_screen_file: "Screen to a file",
  inspector: "Terminal inspector",
  undo: "Undo",
  redo: "Redo",
  quit: "Quit",
  text: "Type text",
  esc: "Send escape sequence",
  csi: "Send control sequence",
  "ghosttea.remote_sessions": "Remote sessions",
};

/** A person's name for an action (`new_split:right` → "Split · right"). */
export function actionLabel(action: string): string {
  const [name = action, ...rest] = action.split(":");
  const base =
    ACTION_LABEL[name] ?? `${name.charAt(0).toUpperCase()}${name.slice(1).replaceAll("_", " ")}`;
  const parameter = rest.join(":");
  // `this` is Ghostty's spelling of the default target (`close_tab:this`):
  // saying it adds nothing a person reads.
  return parameter === "" || parameter === "this"
    ? base
    : `${base} · ${parameter.replaceAll("_", " ")}`;
}

export type KeyboardGroup =
  | "Tabs & windows"
  | "Splits"
  | "Editing & clipboard"
  | "Scrolling"
  | "Find"
  | "Text size"
  | "The app"
  | "Terminal input";

const GROUP_OF: Record<string, KeyboardGroup> = {
  new_tab: "Tabs & windows",
  close_tab: "Tabs & windows",
  goto_tab: "Tabs & windows",
  next_tab: "Tabs & windows",
  previous_tab: "Tabs & windows",
  last_tab: "Tabs & windows",
  new_window: "Tabs & windows",
  close_window: "Tabs & windows",
  close_all_windows: "Tabs & windows",
  toggle_fullscreen: "Tabs & windows",
  quit: "Tabs & windows",
  "ghosttea.remote_sessions": "Tabs & windows",
  new_split: "Splits",
  goto_split: "Splits",
  resize_split: "Splits",
  equalize_splits: "Splits",
  toggle_split_zoom: "Splits",
  close_surface: "Splits",
  copy_to_clipboard: "Editing & clipboard",
  paste_from_clipboard: "Editing & clipboard",
  paste_from_selection: "Editing & clipboard",
  select_all: "Editing & clipboard",
  adjust_selection: "Editing & clipboard",
  undo: "Editing & clipboard",
  redo: "Editing & clipboard",
  clear_screen: "Scrolling",
  scroll_to_top: "Scrolling",
  scroll_to_bottom: "Scrolling",
  scroll_to_selection: "Scrolling",
  scroll_page_up: "Scrolling",
  scroll_page_down: "Scrolling",
  jump_to_prompt: "Scrolling",
  start_search: "Find",
  search_selection: "Find",
  navigate_search: "Find",
  end_search: "Find",
  increase_font_size: "Text size",
  decrease_font_size: "Text size",
  reset_font_size: "Text size",
  text: "Terminal input",
  esc: "Terminal input",
  csi: "Terminal input",
};

export function groupOfAction(action: string): KeyboardGroup {
  return GROUP_OF[action.split(":")[0] ?? action] ?? "The app";
}

export const KEYBOARD_GROUP_ORDER: readonly KeyboardGroup[] = [
  "Tabs & windows",
  "Splits",
  "Editing & clipboard",
  "Scrolling",
  "Find",
  "Text size",
  "The app",
  "Terminal input",
];

export type RowState = "default" | "changed" | "added" | "removed";
export type RowSetter = "ghostty" | "your-ghostty" | "this-mac";

export interface KeyboardRow {
  /** the trigger's identity (`triggerKey`) — stable across spellings */
  readonly id: string;
  /** the trigger as the row shows and writes it */
  readonly trigger: string;
  /** the effective action, or null once unbound or cleared */
  readonly action: string | null;
  readonly route: BindingRoute | null;
  /** the effective binding's flags — with its action, they decide whether its
   * key also reaches the shell (`keyFate`) */
  readonly flags: BindingFlags;
  /** Ghostty's own action on this chord, when it has one */
  readonly defaultAction: string | null;
  readonly state: RowState;
  /** whose line decided the effective action */
  readonly setBy: RowSetter;
  /** VibeField keeps this chord (GT-D21): the pane never sees it */
  readonly reserved: ProductChord | null;
  readonly group: KeyboardGroup;
}

interface DefaultEntry {
  trigger: string;
  action: string;
  flags: BindingFlags;
}

/** Ghostty's macOS defaults + ghosttea's extension, one per chord identity. */
export function defaultBindings(): Map<string, DefaultEntry> {
  const map = new Map<string, DefaultEntry>();
  for (const entry of [...GHOSTTY_MACOS_DEFAULT_BINDINGS, ...GHOSTTEA_BINDING_EXTENSIONS]) {
    const id = triggerKey(entry.triggerRaw);
    if (id === null || map.has(id)) continue;
    map.set(id, {
      trigger: entry.triggerRaw,
      action: entry.actionRaw,
      flags: entry.flags,
    });
  }
  return map;
}

const DEFAULTS = defaultBindings();

function reservedChord(id: string): ProductChord | null {
  return PRODUCT_CHORDS.find((chord) => triggerKey(chord.trigger) === id) ?? null;
}

/** Every chord the deck knows, as rows: Ghostty's defaults (unless a layer
 * cleared them) with the layers' bindings applied IN LOAD ORDER — exactly the
 * list the loader's snapshot carries — and each row says who decided it. A
 * binding counts as this Mac's when the overlay's own text holds it; otherwise
 * it came from the user's Ghostty file. */
export function keyboardRows(
  snapshot: { keybindings: readonly TerminalConfigKeybinding[]; clearKeybindings: boolean },
  overlayBindings: readonly string[],
): KeyboardRow[] {
  const overlay = new Set(
    overlayBindings.flatMap((binding) => {
      const split = splitBinding(binding);
      const id = split === null ? null : triggerKey(split.trigger);
      return split === null || id === null ? [] : [`${id}=${split.action}`];
    }),
  );
  // The snapshot says the defaults were cleared, not by whom: this Mac when the
  // overlay itself says `keybind = clear`, otherwise the user's Ghostty file.
  const clearedBy: RowSetter = overlayBindings.some((binding) => binding.trim() === "clear")
    ? "this-mac"
    : "your-ghostty";
  const effective = new Map<
    string,
    { trigger: string; action: string | null; setBy: RowSetter; flags: BindingFlags }
  >();
  if (!snapshot.clearKeybindings) {
    for (const [id, entry] of DEFAULTS) {
      effective.set(id, {
        trigger: entry.trigger,
        action: entry.action,
        setBy: "ghostty",
        flags: entry.flags,
      });
    }
  }
  for (const binding of snapshot.keybindings) {
    const id = triggerKey(binding.trigger);
    if (id === null) continue;
    const setBy: RowSetter = overlay.has(`${id}=${binding.action}`) ? "this-mac" : "your-ghostty";
    const action = binding.action === "unbind" ? null : binding.action;
    effective.set(id, {
      trigger: binding.trigger.trim(),
      action,
      setBy,
      flags: triggerFlags(binding.trigger),
    });
  }
  const ids = new Set([...DEFAULTS.keys(), ...effective.keys()]);
  const rows: KeyboardRow[] = [];
  for (const id of ids) {
    const fallback = DEFAULTS.get(id);
    const now = effective.get(id);
    const action = now === undefined ? null : now.action;
    const defaultAction = fallback?.action ?? null;
    const state: RowState =
      fallback === undefined
        ? "added"
        : action === null
          ? "removed"
          : action === defaultAction
            ? "default"
            : "changed";
    if (fallback === undefined && action === null) continue; // unbinding a chord nothing bound
    const flags = now?.flags ?? fallback?.flags ?? NO_FLAGS;
    rows.push({
      id,
      trigger: now?.trigger ?? fallback?.trigger ?? id,
      action,
      route: action === null ? null : routeOfAction(action, flags),
      flags,
      defaultAction,
      state,
      setBy: now?.setBy ?? (snapshot.clearKeybindings ? clearedBy : "ghostty"),
      reserved: reservedChord(id),
      group: groupOfAction(action ?? defaultAction ?? ""),
    });
  }
  const order = (group: KeyboardGroup): number => KEYBOARD_GROUP_ORDER.indexOf(group);
  return rows.sort(
    (a, b) =>
      order(a.group) - order(b.group) ||
      actionLabel(a.action ?? a.defaultAction ?? "").localeCompare(
        actionLabel(b.action ?? b.defaultAction ?? ""),
      ) ||
      a.trigger.localeCompare(b.trigger),
  );
}

type PlatformAction =
  | "close_window"
  | "close_all_windows"
  | "quit"
  | "reload_config"
  | "toggle_fullscreen"
  | "new_window"
  | "open_config";

/** What the deck does with a PLATFORM action — the `platform` object
 * GodviewDeck hands the workspace: its "window" is the overlay, so the closing
 * verbs put the terminals away (N16) and Godview stays; the config reload is
 * ghosttea's own; the rest are hooks the deck leaves empty. A change to that
 * object changes these words.
 *
 * AL-9 (AL-D18, 2026-10-27): these said "Closes Godview" while every closing
 * verb also swapped the active pane's session out. Only `close_window` empties
 * a pane now, and only the deck's last one, because ghosttea calls the same hook
 * for the last pane's ⌘W. ⌘Q's own row is the shell's (`PRODUCT_CHORDS`); these
 * words are for any other chord bound to `quit`. */
const PLATFORM_WORDS: Partial<Record<PlatformAction, { text: string; runs: boolean }>> = {
  close_window: {
    text: "Puts the terminals away — with one pane, it empties that pane too",
    runs: true,
  },
  close_all_windows: { text: "Puts the terminals away", runs: true },
  quit: { text: "Puts the terminals away", runs: true },
  reload_config: { text: "Reloads the config", runs: true },
};

/** A kept chord's sentence on the page: what VibeField does with it and,
 * for a chord kept only sometimes (the Peek's ⌘F), when — Ghostty's default
 * never runs on it then. Honest about the when, never an always. */
export function reservedWords(chord: ProductChord, defaultAction: string | null): string {
  const ghostty = actionLabel(defaultAction ?? "").toLowerCase();
  return chord.when === undefined
    ? `VibeField: ${chord.label} — Ghostty's ${ghostty} never runs on this chord.`
    : `VibeField: ${chord.label}, ${chord.when} — Ghostty's ${ghostty} never runs on this chord then.`;
}

/** How a row's route reads on the page. */
export function routeWords(row: KeyboardRow): { text: string; runs: boolean } {
  if (row.action === null) return { text: "Unbound", runs: false };
  if (row.reserved !== null) return { text: `VibeField: ${row.reserved.label}`, runs: false };
  const fate = keyFate(row.action, row.flags);
  switch (row.route) {
    case "workspace":
    case "terminal":
      // ghosttea 0.13.3 (#81): the key's fate is said beside the action, because
      // Shift+Arrow with no selection and an `unconsumed:` bind reach the shell
      if (fate?.performed === "encode")
        return { text: "Runs in the deck, and the key goes on to the shell", runs: true };
      if (fate?.unperformed === "encode")
        return {
          text: "Runs in the deck when it can — otherwise the key goes to the shell",
          runs: true,
        };
      return { text: "Runs in the deck", runs: true };
    case "platform":
      return (
        PLATFORM_WORDS[(row.action.split(":")[0] ?? "") as PlatformAction] ?? {
          text: "Does nothing in the deck",
          runs: false,
        }
      );
    case "unhandled":
      return fate?.unperformed === "encode"
        ? { text: "Not in ghosttea yet — the key goes to the shell", runs: false }
        : { text: "Not in ghosttea yet — the key is swallowed", runs: false };
    default:
      return { text: "Not an action ghosttea knows", runs: false };
  }
}

/** A chord's rows in the editable list, as `keybind` lines for the managed
 * block: only what differs from what the layers below already say. An
 * `unbind` names the bare chord — the flags belonged to the binding it frees. */
export function bindingLine(trigger: string, action: string | null): string {
  return action === null ? `${stripPrefixes(trigger)}=unbind` : `${trigger}=${action}`;
}
