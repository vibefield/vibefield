import type { BrowserWindow, WebContents, WebPreferences } from "electron";

// The PURE window policy (ESR §5.2.2–5.2.3): the one web-preferences literal
// and the registry that replaces the global mainWin pointer. Electron appears
// as TYPES only — tests drive the registry with structural fakes; windows.ts
// owns the runtime BrowserWindow construction.

/** The fields a call site may neither restate nor relax (ESP §7.1). Every one is
 * stated EXPLICITLY even where it matches an Electron default: ESP-5 forbids a
 * privileged surface resting on defaults alone, so a future default flip lands
 * as a visible diff here instead of a silent downgrade.
 *
 * `webviewTag:false` governs whether the tag PARSES; security.ts additionally
 * refuses attachment at runtime — the browser widget uses WebContentsView
 * through shell.webcontents (design-03 03·A §5.5), never <webview>.
 * `spellcheck:false` holds until a product decision accounts for Chromium's
 * dictionary fetches against PP6 local-first — a spell checker that phones out
 * is a network behavior we have not chosen. */
const SECURITY_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  spellcheck: false,
} as const satisfies WebPreferences;

/** The one production web-preferences policy — never inlined at call sites. */
export function webPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    ...SECURITY_PREFERENCES,
    // Electron's default (throttle hidden renderers) restored — ESR slice 5.
    // Safe because durable truth lives in the daemons: autosave is
    // commit-driven, never rAF-driven, and the persistence path is
    // visibility-EXEMPT by law (§5.4.5 — persistence-exemption.test.ts).
    // Hidden work pauses at its source (field-app visibility.ts); refocus
    // recovers from daemon truth (P5). Closes design-03 §4.7's PF6 verify item.
    // Deliberately NOT a security field: PF6 demoted it to a tunable, so a
    // future perf slice may flip it without touching the hardened set.
    backgroundThrottling: true,
  };
}

/** The factory's last word before `new BrowserWindow` (ESP §13.1: "call-site
 * overrides cannot weaken it"). A presentation option is welcome; a relaxed
 * security field throws where it is written rather than shipping a quietly
 * downgraded surface. */
export function assertSecurePreferences(prefs: WebPreferences): WebPreferences {
  for (const [field, required] of Object.entries(SECURITY_PREFERENCES)) {
    const actual = (prefs as Record<string, unknown>)[field];
    if (actual !== required) {
      throw new Error(
        `insecure webPreferences: ${field} must be ${String(required)}, got ${String(actual)}`,
      );
    }
  }
  return prefs;
}

export interface WindowSession {
  readonly window: BrowserWindow;
  dispose(): void;
}

export class WindowRegistry {
  private readonly sessions = new Map<number, WindowSession>();

  adopt(window: BrowserWindow): WindowSession {
    const session: WindowSession = {
      window,
      dispose: () => {
        this.sessions.delete(window.id);
      },
    };
    this.sessions.set(window.id, session);
    window.on("closed", () => session.dispose());
    return session;
  }

  /** Sender policy (§6.3): only webContents of windows THIS shell registered
   * may use the bootstrap surface. */
  owns(sender: WebContents): boolean {
    for (const s of this.sessions.values()) {
      if (!s.window.isDestroyed() && s.window.webContents === sender) return true;
    }
    return false;
  }

  primary(): BrowserWindow | null {
    for (const s of this.sessions.values()) {
      if (!s.window.isDestroyed()) return s.window;
    }
    return null;
  }

  /** second-instance behavior: restore + focus the primary window. */
  focusPrimary(): void {
    const win = this.primary();
    if (win === null) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  }

  disposeAll(): void {
    for (const s of [...this.sessions.values()]) s.dispose();
  }
}
