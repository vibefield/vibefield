import type { Logger } from "@vibefield/logging";
import { app, type BrowserWindow, type WebContents, webContents } from "electron";
import type { ShellMode } from "./modes";
import {
  type VitalsFeedPort,
  VitalsFeedSession,
  type VitalsFielddClient,
  type VitalsShellLogs,
} from "./vitals-feed";
import {
  type ShellRendererRole,
  shellRoster,
  type VitalsRosterClient,
  VitalsRosterReporter,
} from "./vitals-roster";
import { createVitalsWindowHost } from "./vitals-window";

// VT-2 (track VT, 2026-11-24) — Vitals in Electron main, composed in one place: the window (`vitals-window.ts`), the
// feed it reads while open (`vitals-feed.ts`) and the shell's roster for fieldd (`vitals-roster.ts`). `index.ts`
// holds one of these and tells it three things: which fieldd client is live, when to open, and when to close.

type VitalsClient = VitalsFielddClient & VitalsRosterClient;

export interface VitalsHost {
  /** The Window menu's Vitals: open the window, or bring it forward. */
  open(): void;
  /** Close the window: the desk's window closed, or the app is quitting. */
  closeWindow(): void;
  /** Main's fieldd client changed (a first attach, a daemon bounce, a user switch), or went away. */
  setFieldd(client: VitalsClient | null): void;
  dispose(): void;
}

export function installVitals(opts: {
  mode: ShellMode;
  viteUrl: string;
  preloadPath: string;
  adoptHostAuxiliary(window: BrowserWindow): { dispose(): void };
  /** the desk's window now, or null */
  primary(): BrowserWindow | null;
  /** whether a WebContents is a page the person browses or previews (a browser pane, an artifact preview), which
   * main knows by its guarded session */
  isBrowserPane(contents: WebContents): boolean;
  /** main's own log door, read when a feed opens; null in a mode that keeps none */
  shellLogs(): VitalsShellLogs | null;
  quit(): void;
  logger: Logger;
}): VitalsHost {
  const logger = opts.logger.child({ component: "vitals" });
  let fieldd: VitalsClient | null = null;
  const fielddListeners = new Set<(client: VitalsFielddClient | null) => void>();

  const rendererPid = (contents: WebContents | undefined): number | null => {
    if (contents === undefined || contents.isDestroyed() || contents.isCrashed()) return null;
    const pid = contents.getOSProcessId();
    return pid > 0 ? pid : null;
  };

  const roster = new VitalsRosterReporter({
    read: () => {
      const renderers: ShellRendererRole[] = [];
      const named = new Set<number>();
      const name = (pid: number | null, role: ShellRendererRole["role"]): void => {
        if (pid === null || named.has(pid)) return;
        named.add(pid);
        renderers.push({ pid, role });
      };
      name(rendererPid(opts.primary()?.webContents), "window");
      name(windowHost.rendererPid(), "vitals-window");
      // a browsed or previewed page's process is named as a pane; any other renderer stays unnamed and reads as
      // `other`. Its row says "Browser pane" and nothing of the page.
      for (const contents of webContents.getAllWebContents()) {
        if (!contents.isDestroyed() && opts.isBrowserPane(contents)) {
          name(rendererPid(contents), "browser-pane");
        }
      }
      return shellRoster(app.getAppMetrics(), renderers);
    },
    client: () => fieldd,
    logger,
  });

  const windowHost = createVitalsWindowHost({
    mode: opts.mode,
    viteUrl: opts.viteUrl,
    preloadPath: opts.preloadPath,
    adopt: opts.adoptHostAuxiliary,
    feed: (port: VitalsFeedPort) => {
      const shellLogs = opts.shellLogs();
      return new VitalsFeedSession(port, {
        onFieldd: (listener) => {
          fielddListeners.add(listener);
          listener(fieldd);
          return () => fielddListeners.delete(listener);
        },
        ...(shellLogs === null ? {} : { shellLogs }),
        logger,
      });
    },
    onChanged: () => roster.poke(),
    quit: opts.quit,
    logger,
  });

  // Every event that can change which processes the shell has. None is a timer.
  const poke = (): void => roster.poke();
  const onContents = (_event: unknown, contents: WebContents): void => {
    contents.on("did-finish-load", poke);
    contents.on("render-process-gone", poke);
    contents.once("destroyed", poke);
  };
  app.on("web-contents-created", onContents);
  app.on("child-process-gone", poke);
  app.on("browser-window-created", poke);

  return {
    open: () => {
      void windowHost.open().catch(() => undefined); // said in the log by the window host
    },
    closeWindow: () => windowHost.close(),
    setFieldd: (client) => {
      if (client === fieldd) return;
      fieldd = client;
      for (const listener of fielddListeners) listener(client);
      if (client !== null) roster.fresh();
    },
    dispose: () => {
      app.off("web-contents-created", onContents);
      app.off("child-process-gone", poke);
      app.off("browser-window-created", poke);
      roster.dispose();
      windowHost.close();
      fielddListeners.clear();
      fieldd = null;
    },
  };
}
