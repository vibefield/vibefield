import type { BrowserWindow, WebContents, WebPreferences } from "electron";

// The PURE window policy (ESR §5.2.2–5.2.3): the one web-preferences literal
// and the registry that replaces the global mainWin pointer. Electron appears
// as TYPES only — tests drive the registry with structural fakes; windows.ts
// owns the runtime BrowserWindow construction.

/** The one production web-preferences policy — never inlined at call sites. */
export function webPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    // Electron's default (throttle hidden renderers) restored — ESR slice 5.
    // Safe because durable truth lives in the daemons: autosave is
    // commit-driven, never rAF-driven, and the persistence path is
    // visibility-EXEMPT by law (§5.4.5 — persistence-exemption.test.ts).
    // Hidden work pauses at its source (field-app visibility.ts); refocus
    // recovers from daemon truth (P5). Closes design-03 §4.7's PF6 verify item.
    backgroundThrottling: true,
  };
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
