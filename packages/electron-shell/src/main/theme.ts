import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  IPC_CHANNELS,
  resolveTheme,
  type ThemeName,
  type ThemePreference,
  ThemePreference as ThemePreferenceSchema,
  type ThemeState,
  ThemeState as ThemeStateSchema,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { WebContents } from "electron";

// THE APP'S THEME, owned by MAIN (One Frame FR-4, FC-D5; DESIGN.md §10).
//
// Three states — Light, Dark, Auto — and ONE owner, which is main's because
// Auto is the OS's theme and main is where Electron says what the OS is
// (`nativeTheme`). It replaces the renderer's sticky boolean (`vf-dark`, no
// Auto, no OS follow — r4 §4) and the second, third and fourth controls that
// wrote their own copies (F3): the Me menu's Theme, Settings → Appearance and
// the Setup Assistant's button all ASK this owner, and every window is told
// what it holds. Godview reads the same answer (FC-D7).
//
// The owner PROJECTS what it resolves to back into Electron: `themeSource` is
// the preference (Auto → "system"), so the window's native chrome and menus
// agree with the app, and the page's `prefers-color-scheme` matches the owner
// from the document's first frame — before any message could reach it, which
// is what lets the splash paint in the right theme (DESIGN.md §8 "The switch").
//
// Kept as one small file in the shell's own profile (Electron's userData,
// beside Chromium's own Preferences — the scope the renderer's localStorage
// key had), never in the data root's LAYOUT: it is the shell's preference for
// this device, not product state.

/** Electron's `nativeTheme`, as much of it as the owner uses — a port, so the
 * suite can flip the OS under it. */
export interface NativeThemePort {
  themeSource: "system" | "light" | "dark";
  readonly shouldUseDarkColors: boolean;
  on(event: "updated", listener: () => void): unknown;
  removeListener(event: "updated", listener: () => void): unknown;
}

/** Where the choice is kept between launches. */
export interface ThemeStore {
  read(): ThemePreference | null;
  write(preference: ThemePreference): void;
}

/** The file's name inside Electron's userData. */
export const THEME_FILE = "vibefield-theme.json";

/** The file store. A tolerant reader (design-00): anything unreadable is "no
 * choice yet", which is Auto. A write goes through a temporary file and a
 * rename, so a crash mid-write never leaves half a preference behind. */
export function fileThemeStore(path: string, logger?: Logger): ThemeStore {
  return {
    read() {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as { preference?: unknown };
        const parsed = ThemePreferenceSchema.safeParse(raw?.preference);
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    write(preference) {
      const pending = `${path}.tmp`;
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(pending, `${JSON.stringify({ preference })}\n`, "utf8");
        renameSync(pending, path);
      } catch (error) {
        logger?.error(
          "desktop.theme.save_failed",
          "The theme could not be saved; it holds for this session only",
          error,
        );
      }
    },
  };
}

/** What a preference asks Electron for: Auto is the OS's own. */
function sourceFor(preference: ThemePreference): NativeThemePort["themeSource"] {
  return preference === "auto" ? "system" : preference;
}

export class ThemeOwner {
  private preference: ThemePreference;
  /** What every watched window was last told it resolves to. `updated` fires
   * for more than the theme (contrast, inverted colours); only a change of
   * THIS is news. */
  private told: ThemeName;
  /** The owner is projecting a choice: the `updated` that projection fires is
   * its own, and the choice is told once, by `set`. */
  private projecting = false;
  private readonly watched = new Set<WebContents>();

  constructor(
    private readonly native: NativeThemePort,
    private readonly store: ThemeStore,
    private readonly opts: { logger?: Logger } = {},
  ) {
    // No choice yet is Auto: the OS's theme, which is also what a page reading
    // `prefers-color-scheme` saw before this owner existed.
    this.preference = store.read() ?? "auto";
    native.themeSource = sourceFor(this.preference);
    this.told = this.resolved();
    native.on("updated", this.onNative);
  }

  current(): ThemeState {
    return { preference: this.preference, resolved: this.resolved() };
  }

  /** Choose the theme. Kept, projected and told — and answered even when
   * nothing changed, since a request is also how a page asks for the truth. */
  set(preference: ThemePreference): ThemeState {
    if (preference !== this.preference) {
      const from = this.preference;
      this.preference = preference;
      this.store.write(preference);
      this.projecting = true;
      try {
        this.native.themeSource = sourceFor(preference);
      } finally {
        this.projecting = false;
      }
      this.opts.logger?.info("desktop.theme.changed", "The app's theme changed", {
        from,
        preference,
        resolved: this.resolved(),
      });
    }
    this.broadcast();
    return this.current();
  }

  /** Tell a window the theme on every load (a reload included) and on every
   * change, until it is gone. Idempotent. */
  watch(target: WebContents): void {
    if (this.watched.has(target)) return;
    this.watched.add(target);
    target.on("did-finish-load", () => this.publish(target));
    target.once("destroyed", () => {
      this.watched.delete(target);
    });
  }

  dispose(): void {
    this.native.removeListener("updated", this.onNative);
    this.watched.clear();
  }

  private resolved(): ThemeName {
    return resolveTheme(this.preference, this.native.shouldUseDarkColors);
  }

  /** The OS flipped (or something else in `nativeTheme` moved): Auto's answer
   * may have changed with it. */
  private readonly onNative = (): void => {
    if (this.projecting || this.resolved() === this.told) return;
    this.broadcast();
  };

  private broadcast(): void {
    this.told = this.resolved();
    for (const target of this.watched) this.publish(target);
  }

  private publish(target: WebContents): void {
    if (target.isDestroyed()) return;
    target.send(IPC_CHANNELS.themeState, ThemeStateSchema.parse(this.current()));
  }
}
