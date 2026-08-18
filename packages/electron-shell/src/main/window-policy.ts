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

interface ManagedWindowSession extends WindowSession {
  readonly primary: boolean;
  closing: boolean;
}

interface QueuedReopen {
  readonly factory: () => PrimaryWindowCandidate;
  readonly promise: Promise<BrowserWindow>;
  readonly resolve: (window: BrowserWindow) => void;
  readonly reject: (error: unknown) => void;
}

export interface PrimaryWindowCandidate {
  readonly window: BrowserWindow;
  /** Installs the window's host bridges and loads the renderer. The registry
   * adopts the BrowserWindow before this runs, so bootstrap sender policy is
   * already armed when renderer code starts. */
  prepare(): Promise<void>;
}

export class WindowRegistry {
  private readonly sessions = new Map<number, ManagedWindowSession>();
  private readonly primaryListeners = new Set<(open: boolean) => void>();
  private opening: Promise<BrowserWindow> | null = null;
  private queuedReopen: QueuedReopen | null = null;
  private shuttingDown = false;

  adopt(window: BrowserWindow): WindowSession {
    const current = this.primary();
    if (current !== null && current !== window) {
      throw new Error(
        `single-primary-window invariant violated: ${current.id} is already registered`,
      );
    }
    return this.adoptSession(window, true);
  }

  /** Register a host-owned auxiliary renderer realm without changing which
   * window tray/lifecycle operations treat as primary. This narrow seam is
   * also what lets the physical restart harness prove a multi-window fence. */
  adoptAuxiliary(window: BrowserWindow): WindowSession {
    return this.adoptSession(window, false);
  }

  private adoptSession(window: BrowserWindow, primary: boolean): WindowSession {
    const existing = this.sessions.get(window.id);
    if (existing !== undefined) {
      if (existing.primary !== primary) {
        throw new Error(`${window.id}: renderer window cannot change primary role after adoption`);
      }
      return existing;
    }
    const session: ManagedWindowSession = {
      window,
      primary,
      closing: false,
      dispose: () => {
        if (!this.sessions.delete(window.id)) return;
        if (session.primary) this.emitPrimaryChanged();
      },
    };
    this.sessions.set(window.id, session);
    window.on("closed", () => {
      session.dispose();
      if (session.primary) this.launchQueuedReopen();
    });
    if (session.primary) this.emitPrimaryChanged();
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
      if (s.primary && !s.window.isDestroyed()) return s.window;
    }
    return null;
  }

  /** Reveal an existing primary window. Kept synchronous for narrow callers;
   * entry points that may recreate it use revealPrimary(). */
  focusPrimary(): void {
    const win = this.primary();
    if (win === null) return;
    this.revealWindow(win);
  }

  /** Durable close is asynchronous. Once it starts, reveal intents queue for
   * the replacement generation instead of focusing a window committed to die. */
  markClosing(window: BrowserWindow): boolean {
    const session = this.sessions.get(window.id);
    if (session === undefined || session.window !== window) return false;
    session.closing = true;
    return true;
  }

  beginShutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const queued = this.queuedReopen;
    this.queuedReopen = null;
    queued?.reject(new Error("primary window reopen cancelled: shell is shutting down"));
  }

  /** The one create-or-reveal operation for initial boot, tray, Dock
   * activation, second-instance, and future deep links. Concurrent callers
   * share the same preparation promise and can never create a second canvas. */
  revealPrimary(factory: () => PrimaryWindowCandidate): Promise<BrowserWindow> {
    if (this.shuttingDown) {
      return Promise.reject(new Error("primary window cannot open while shell is shutting down"));
    }
    const existing = this.primary();
    // markClosing() is synchronous, while prepare() may still be in flight.
    // A later Open intent belongs to the replacement generation even in that
    // overlap; returning `opening` here would focus the window committed to die
    // and silently lose the user's intent.
    if (existing !== null && this.sessions.get(existing.id)?.closing) {
      return this.queueReopen(factory);
    }
    if (this.opening !== null) return this.opening;
    if (existing !== null) {
      this.revealWindow(existing);
      return Promise.resolve(existing);
    }

    let candidate: PrimaryWindowCandidate;
    let session: WindowSession;
    try {
      candidate = factory();
      session = this.adopt(candidate.window);
    } catch (error) {
      return Promise.reject(error);
    }
    const attempt = Promise.resolve()
      .then(() => candidate.prepare())
      .then(() => {
        if (candidate.window.isDestroyed()) {
          throw new Error("primary window was destroyed before its renderer became ready");
        }
        this.revealWindow(candidate.window);
        return candidate.window;
      })
      .catch((error: unknown) => {
        session.dispose();
        if (!candidate.window.isDestroyed()) candidate.window.destroy();
        throw error;
      })
      .finally(() => {
        if (this.opening === attempt) this.opening = null;
      });
    this.opening = attempt;
    return attempt;
  }

  onPrimaryChanged(listener: (open: boolean) => void): () => void {
    this.primaryListeners.add(listener);
    return () => this.primaryListeners.delete(listener);
  }

  disposeAll(): void {
    this.beginShutdown();
    for (const session of [...this.sessions.values()]) {
      session.dispose();
      if (!session.window.isDestroyed()) session.window.destroy();
    }
  }

  private queueReopen(factory: () => PrimaryWindowCandidate): Promise<BrowserWindow> {
    if (this.queuedReopen !== null) return this.queuedReopen.promise;
    let resolve!: (window: BrowserWindow) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<BrowserWindow>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    this.queuedReopen = { factory, promise, resolve, reject };
    return promise;
  }

  private launchQueuedReopen(): void {
    const queued = this.queuedReopen;
    if (queued === null) return;
    if (this.shuttingDown) {
      this.queuedReopen = null;
      queued.reject(new Error("primary window reopen cancelled: shell is shutting down"));
      return;
    }
    if (this.opening !== null) {
      const opening = this.opening;
      void opening.then(
        () => this.launchQueuedReopen(),
        () => this.launchQueuedReopen(),
      );
      return;
    }
    if (this.primary() !== null) return;
    this.queuedReopen = null;
    void this.revealPrimary(queued.factory).then(queued.resolve, queued.reject);
  }

  private revealWindow(win: BrowserWindow): void {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  }

  private emitPrimaryChanged(): void {
    const open = this.primary() !== null;
    for (const listener of this.primaryListeners) listener(open);
  }
}
