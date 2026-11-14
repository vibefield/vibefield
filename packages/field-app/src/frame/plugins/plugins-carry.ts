import { PLUGINS_TABS, type PluginsTab } from "./plugins-model";

// THE POPUP'S NOTE ACROSS THE WINDOW COMING BACK FRESH (MK-E6; MK-UC's UC-C; DESIGN.md §8
// "Updates", "The window coming back fresh"). An install or an update of a plugin with objects can
// bring the window back fresh: the window saves its board and its renderer is replaced
// (`plugin-host/replace-renderer.ts`). So as the act is sent, the popup keeps a note in the
// window's own session, which outlives the renderer as the board the window reopens does
// (`doc-manager.ts`, `vf-window-doc`): the page it stands on and the tab it came from, and, during
// Update all, the updates still to take and those taken. The frame reads it once as it first
// mounts, within a minute of its writing, and opens the popup on it; the popup folding lets it go.
// One note serves an install and an update. Storage can throw or be absent (a private window, a
// browser harness): then there is no note, and the window comes back with the popup folded —
// honest, only plainer. Nothing here names a power, a key or a path.

const CARRY_KEY = "vf-plugins-carry";

/** How long a note is good for: the board's save (at most ten seconds) and a renderer's boot. */
export const PLUGINS_CARRY_FRESH_MS = 60_000;

/** What the popup keeps across the window coming back fresh. */
export interface PluginsCarry {
  /** the page it stood on, and the tab that page opened from; null during Update all, which reopens
   * on Updates */
  readonly page: { readonly id: string; readonly from: PluginsTab } | null;
  /** Update all: the updates it still has to take, by plugin id */
  readonly rest: readonly string[];
  /** Update all: the updates it took, by plugin id and the version taken */
  readonly done: readonly (readonly [string, string])[];
}

/** Keep the note, as an install or an update is sent; a later one replaces it. */
export function keepCarry(carry: PluginsCarry, now: number = Date.now()): void {
  try {
    globalThis.sessionStorage?.setItem(CARRY_KEY, JSON.stringify({ v: 1, at: now, ...carry }));
  } catch {
    // no note: the window comes back with the popup folded
  }
}

/** Let the note go: the popup folded, so a window that never came back keeps none. */
export function dropCarry(): void {
  try {
    globalThis.sessionStorage?.removeItem(CARRY_KEY);
  } catch {
    // nothing to let go
  }
}

const isTab = (value: unknown): value is PluginsTab =>
  typeof value === "string" && (PLUGINS_TABS as readonly string[]).includes(value);

const isIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((id) => typeof id === "string");

const isDone = (value: unknown): value is [string, string][] =>
  Array.isArray(value) &&
  value.every(
    (pair) =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      typeof pair[0] === "string" &&
      typeof pair[1] === "string",
  );

/** Read the note once and let it go: a later reload of the same window boots plainly. A note older
 * than `PLUGINS_CARRY_FRESH_MS`, or one this build can't read, is none. */
export function takeCarry(now: number = Date.now()): PluginsCarry | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(CARRY_KEY) ?? null;
    if (raw === null) return null;
    globalThis.sessionStorage.removeItem(CARRY_KEY);
    const parsed = JSON.parse(raw) as {
      v?: unknown;
      at?: unknown;
      page?: unknown;
      rest?: unknown;
      done?: unknown;
    };
    if (parsed.v !== 1 || typeof parsed.at !== "number") return null;
    const age = now - parsed.at;
    if (age < 0 || age > PLUGINS_CARRY_FRESH_MS) return null;
    if (!isIds(parsed.rest) || !isDone(parsed.done)) return null;
    const page = parsed.page as { id?: unknown; from?: unknown } | null | undefined;
    if (page === null || page === undefined) {
      return { page: null, rest: parsed.rest, done: parsed.done };
    }
    if (typeof page.id !== "string" || !isTab(page.from)) return null;
    return { page: { id: page.id, from: page.from }, rest: parsed.rest, done: parsed.done };
  } catch {
    return null;
  }
}
