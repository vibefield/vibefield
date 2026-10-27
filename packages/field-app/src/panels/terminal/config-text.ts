// The text of config.ghostty, as Settings → Terminal reads and writes it (GT-7).
//
// Two rules keep this file honest. It never JUDGES a line — what a key means,
// whether a value is valid, whether ghosttea applies it: that is the loader's,
// asked through `terminal.config.validate`, and its diagnostics are the only
// verdict the page shows. And it only ever REWRITES the managed block, the
// region between ghosttea's own markers; every other line the user wrote stays
// byte for byte, comments and unknown keys included.

/** ghosttea's markers for the block its own settings editor writes
 * (`appearance/config-draft.ts`, 0.11.1 — `FRIENDLY_BLOCK_START/END`). The same
 * markers, so either editor recognizes the other's block as managed. */
export const MANAGED_BLOCK_START =
  "# >>> Ghosttea common settings (managed; edit through Settings)";
export const MANAGED_BLOCK_END = "# <<< Ghosttea common settings";
const MANAGED_BLOCK_NOTE =
  "# Settings → Terminal writes the lines in this block. Everything outside it is yours.";

/** Ghostty's built-in first sixteen colours — what programs paint with when no
 * layer sets `palette` (Ghostty `src/terminal/color.zig`, the table ghosttea's
 * VT hands out as `resolved_palette(&[])`). The loader's snapshot is sparse, so
 * the page fills every index nobody set from here. */
export const GHOSTTY_DEFAULT_PALETTE: readonly string[] = [
  "#1d1f21",
  "#cc6666",
  "#b5bd68",
  "#f0c674",
  "#81a2be",
  "#b294bb",
  "#8abeb7",
  "#c5c8c6",
  "#666666",
  "#d54e53",
  "#b9ca4a",
  "#e7c547",
  "#7aa6da",
  "#c397d8",
  "#70c0b1",
  "#eaeaea",
];

/** Ghostty's default `scrollback-limit`, in bytes. */
export const GHOSTTY_DEFAULT_SCROLLBACK = 10_000_000;

export type ConfigLineKind = "blank" | "comment" | "setting" | "bare";

export interface ConfigLine {
  /** 1-based, as the loader's diagnostics count lines */
  readonly number: number;
  readonly raw: string;
  readonly kind: ConfigLineKind;
  /** the key, for `setting` and `bare` lines */
  readonly key?: string;
  /** the value with one pair of surrounding quotes removed, for `setting` lines */
  readonly value?: string;
  /** inside (or one of) the managed block's marker lines */
  readonly managed: boolean;
  readonly marker?: "start" | "end";
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

export function splitConfigLines(text: string): string[] {
  return text === "" ? [] : text.split(/\r\n|\r|\n/u);
}

/** The file's own newline, kept on every write (ghosttea's `preferredConfigNewline`). */
export function preferredNewline(text: string): "\n" | "\r\n" {
  const first = text.match(/\r\n|\n/u)?.[0];
  return first === "\r\n" ? "\r\n" : "\n";
}

export type ManagedBlockState = "absent" | "present" | "malformed";

/** Where the managed block is, if it is well formed: one start, one end after
 * it. Anything else is `malformed` and the page refuses to rewrite it — the
 * same refusal ghosttea's editor makes — rather than guessing which marker the
 * user meant. */
export function managedBlockState(text: string): ManagedBlockState {
  return blockRange(splitConfigLines(text)).state;
}

function blockRange(lines: readonly string[]): {
  state: ManagedBlockState;
  start: number;
  end: number;
} {
  const starts: number[] = [];
  const ends: number[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === MANAGED_BLOCK_START) starts.push(index);
    else if (trimmed === MANAGED_BLOCK_END) ends.push(index);
  });
  if (starts.length === 0 && ends.length === 0) return { state: "absent", start: -1, end: -1 };
  const [start] = starts;
  const [end] = ends;
  if (
    starts.length !== 1 ||
    ends.length !== 1 ||
    start === undefined ||
    end === undefined ||
    end < start
  ) {
    return { state: "malformed", start: -1, end: -1 };
  }
  return { state: "present", start, end };
}

/** Every line, classified — for the editor's gutter and the page's facts. */
export function parseConfigLines(text: string): ConfigLine[] {
  const lines = splitConfigLines(text);
  const range = blockRange(lines);
  return lines.map((raw, index) => {
    const number = index + 1;
    const trimmed = raw.trim();
    const managed = range.state === "present" && index >= range.start && index <= range.end;
    if (managed && index === range.start) {
      return { number, raw, kind: "comment", managed, marker: "start" };
    }
    if (managed && index === range.end) {
      return { number, raw, kind: "comment", managed, marker: "end" };
    }
    if (trimmed === "") return { number, raw, kind: "blank", managed };
    if (trimmed.startsWith("#")) return { number, raw, kind: "comment", managed };
    const separator = raw.indexOf("=");
    if (separator < 0) return { number, raw, kind: "bare", key: trimmed, managed };
    return {
      number,
      raw,
      kind: "setting",
      key: raw.slice(0, separator).trim(),
      value: unquote(raw.slice(separator + 1).trim()),
      managed,
    };
  });
}

/** What the page's controls own: the managed block's values. `null` means the
 * block says nothing about that key (the layers below decide). */
export interface ManagedValues {
  /** palette index → `#rrggbb`, 0–15 */
  readonly palette: ReadonlyMap<number, string> | null;
  readonly scrollbackLimit: number | null;
  /** GT-8a — `link-url`: whether terminals find links in their output */
  readonly linkUrl: boolean | null;
  /** `keybind` lines in order, each `trigger=action`; `clearDefaults` writes
   * `keybind = clear` ahead of them (Ghostty's defaults removed) */
  readonly keybinds: readonly string[] | null;
  readonly clearDefaults: boolean;
}

export const EMPTY_MANAGED_VALUES: ManagedValues = {
  palette: null,
  scrollbackLimit: null,
  linkUrl: null,
  keybinds: null,
  clearDefaults: false,
};

/** A `link-url` value as the loader reads it (ghosttea-config's `parse_bool`
 * on the trimmed value): `true` or `false`; an empty value resets the key to
 * its default, which is on; anything else is the loader's error to report, so
 * it says nothing here. */
function linkUrlValue(value: string): boolean | null {
  const trimmed = value.trim();
  if (trimmed === "true" || trimmed === "") return true;
  if (trimmed === "false") return false;
  return null;
}

/** `palette = N=#rrggbb` → [N, "#rrggbb"], for N in 0–15 and a hex colour. */
export function parsePaletteValue(value: string): [number, string] | null {
  const match = /^(\d{1,3})\s*=\s*#?([0-9a-f]{6})$/iu.exec(value.trim());
  if (match === null) return null;
  const index = Number(match[1]);
  if (!Number.isInteger(index) || index > 15) return null;
  return [index, `#${(match[2] ?? "").toLowerCase()}`];
}

/** The managed block's values, read back — what the controls show as "set here". */
export function readManagedValues(text: string): ManagedValues {
  if (managedBlockState(text) !== "present") return EMPTY_MANAGED_VALUES;
  let palette: Map<number, string> | null = null;
  let scrollbackLimit: number | null = null;
  let linkUrl: boolean | null = null;
  let keybinds: string[] | null = null;
  let clearDefaults = false;
  for (const line of parseConfigLines(text)) {
    if (!line.managed || line.kind !== "setting" || line.value === undefined) continue;
    if (line.key === "palette") {
      const entry = parsePaletteValue(line.value);
      if (entry === null) continue;
      palette ??= new Map();
      palette.set(entry[0], entry[1]);
    } else if (line.key === "scrollback-limit") {
      const bytes = Number(line.value);
      if (Number.isFinite(bytes) && bytes >= 0) scrollbackLimit = Math.round(bytes);
    } else if (line.key === "link-url") {
      // the last readable line wins, as it does in the loader
      linkUrl = linkUrlValue(line.value) ?? linkUrl;
    } else if (line.key === "keybind") {
      if (line.value === "clear") {
        // As the loader reads it: `clear` drops every binding before it too.
        clearDefaults = true;
        keybinds = [];
      } else if (line.value !== "") {
        keybinds ??= [];
        keybinds.push(normalizeBinding(line.value));
      }
    }
  }
  return { palette, scrollbackLimit, linkUrl, keybinds, clearDefaults };
}

/** One `keybind` value as the block writes it: no line breaks, no spaces at
 * its ends. Splitting it into trigger and action is the keyboard model's job
 * (it asks ghosttea's own trigger parser, as the loader does). */
export function normalizeBinding(binding: string): string {
  return binding.replaceAll(/[\r\n]/gu, "").trim();
}

function blockLines(values: ManagedValues): string[] {
  const lines: string[] = [];
  if (values.palette !== null) {
    for (const [index, color] of [...values.palette.entries()].sort(([a], [b]) => a - b)) {
      lines.push(`palette = ${index}=${color.toLowerCase()}`);
    }
  }
  if (values.scrollbackLimit !== null) {
    lines.push(`scrollback-limit = ${Math.max(0, Math.round(values.scrollbackLimit))}`);
  }
  if (values.linkUrl !== null) lines.push(`link-url = ${values.linkUrl}`);
  if (values.clearDefaults) lines.push("keybind = clear");
  if (values.keybinds !== null) {
    for (const binding of values.keybinds) lines.push(`keybind = ${normalizeBinding(binding)}`);
  }
  return lines;
}

/** Thrown when the page is asked to rewrite a block it cannot find cleanly. */
export class MalformedManagedBlockError extends Error {
  constructor() {
    super("The managed block in config.ghostty has a missing or repeated marker line");
  }
}

/** Rewrite the managed block to hold exactly `values`, in place (or appended,
 * after one blank line, when there is none), keeping the file's newline style
 * and every line outside the block. Values that say nothing remove the block. */
export function writeManagedValues(text: string, values: ManagedValues): string {
  const newline = preferredNewline(text);
  const lines = splitConfigLines(text);
  const range = blockRange(lines);
  if (range.state === "malformed") throw new MalformedManagedBlockError();
  const body = blockLines(values);
  const block =
    body.length === 0 ? [] : [MANAGED_BLOCK_START, MANAGED_BLOCK_NOTE, ...body, MANAGED_BLOCK_END];
  if (range.state === "present") {
    const before = lines.slice(0, range.start);
    const after = lines.slice(range.end + 1);
    if (block.length === 0) {
      // Removing the block takes one blank separator with it, so a
      // save-then-clear round trip returns the user's own bytes.
      if (
        before.length > 0 &&
        before[before.length - 1]?.trim() === "" &&
        after.every((line) => line.trim() === "")
      ) {
        before.pop();
      }
      return [...before, ...after].join(newline);
    }
    return [...before, ...block, ...after].join(newline);
  }
  if (block.length === 0) return text;
  const trimmedEnd = [...lines];
  while (trimmedEnd.length > 0 && trimmedEnd[trimmedEnd.length - 1]?.trim() === "")
    trimmedEnd.pop();
  const head = trimmedEnd.length === 0 ? [] : [...trimmedEnd, ""];
  return `${[...head, ...block].join(newline)}${newline}`;
}

/** The overlay's own lines for a key — outside and inside the block — so a
 * control can say "you also set this by hand on line 4". */
export function linesSetting(text: string, key: string): ConfigLine[] {
  return parseConfigLines(text).filter((line) => line.kind === "setting" && line.key === key);
}

/** Palette indices this document sets anywhere (valid entries only). */
export function paletteIndicesSet(text: string): Set<number> {
  const set = new Set<number>();
  for (const line of linesSetting(text, "palette")) {
    if (line.value === "") {
      set.clear();
      continue;
    }
    const entry = line.value === undefined ? null : parsePaletteValue(line.value);
    if (entry !== null) set.add(entry[0]);
  }
  return set;
}

/** How many settings a draft changes against the saved text: lines added or
 * removed, counted by key, comments and blank lines ignored. */
export function changedKeyCount(saved: string, draft: string): number {
  const meaningful = (text: string): string[] =>
    splitConfigLines(text)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
  const before = meaningful(saved);
  const after = meaningful(draft);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const keys = new Set<string>();
  for (const line of before) if (!afterSet.has(line)) keys.add(line.split("=")[0]?.trim() ?? line);
  for (const line of after) if (!beforeSet.has(line)) keys.add(line.split("=")[0]?.trim() ?? line);
  return keys.size;
}
