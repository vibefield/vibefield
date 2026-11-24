import type { Logger } from "@vibefield/logging";
import { app, type BrowserWindow, type WebContents, webContents } from "electron";
import { isSmokeLike, type ShellMode } from "./modes";
import { installVitalsCaptures } from "./vitals-capture-host";
import {
  type VitalsFeedPort,
  VitalsFeedSession,
  type VitalsFielddClient,
  type VitalsShellLogs,
} from "./vitals-feed";
import { ShellIncidentReporter } from "./vitals-incidents";
import { MainOwnReporter } from "./vitals-own";
import {
  type ShellRendererRole,
  shellRoster,
  type VitalsRosterClient,
  VitalsRosterReporter,
} from "./vitals-roster";
import { afterDeskShown, createVitalsWindowHost } from "./vitals-window";

// VT-2 (track VT, 2026-11-24) — Vitals in Electron main, composed in one place: the window (`vitals-window.ts`), the
// feed it reads while open (`vitals-feed.ts`) and the shell's roster for fieldd (`vitals-roster.ts`). `index.ts`
// holds one of these and tells it three things: which fieldd client is live, when to open, and when to close.

type VitalsClient = VitalsFielddClient & VitalsRosterClient;

export interface VitalsHost {
  /** The Window menu's Vitals: open the window, or bring it forward. */
  open(): void;
  /** VT-6 — the desk's window is open: open Vitals beside it, unasked, once the desk is shown. `pnpm dev` alone
   * calls this (`opensVitalsWithDesk`). */
  openWithDesk(): void;
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
  /** VT-5 — the attached user's root, where the armed captures are kept; null while there is none */
  userRoot(): string | null;
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

  const own = new MainOwnReporter({ client: () => fieldd, logger });
  // VT-4b — what main alone sees die or stop responding, said to fieldd as incidents (`vitals-incidents.ts`)
  const incidents = new ShellIncidentReporter({ client: () => fieldd, logger });
  const nameOf = (contents: WebContents) => (): { role: string; pid: number | null } => {
    const pid = rendererPid(contents);
    if (contents === opts.primary()?.webContents) return { role: "window", pid };
    if (pid !== null && pid === windowHost.rendererPid()) return { role: "vitals-window", pid };
    return { role: opts.isBrowserPane(contents) ? "browser-pane" : "other", pid };
  };
  const stopHearingMain = incidents.listen(process);
  const leaving = (): void => incidents.leave();
  const onChildGone = (_event: unknown, details: Electron.Details): void =>
    incidents.childGone(details);

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
    onChanged: () => {
      roster.poke();
      // VT-3b: main says its own loop only while the window is open (`vitals-own.ts`)
      if (windowHost.rendererPid() === null) own.stop();
      else own.start();
      // VT-5: a trace or a count armed from a window that went is stopped and not saved
      if (windowHost.rendererPid() === null) captures.cut();
    },
    quit: opts.quit,
    // a harness's Vitals window never takes the person's keys or pointer (the Godview smoke's VITALS row)
    quiet: isSmokeLike(opts.mode),
    logger,
  });

  // VT-5 — the armed captures (`vitals-capture-host.ts`): a trace, a profile of fieldd, the desk's frames
  const captures = installVitalsCaptures({
    userRoot: opts.userRoot,
    vitalsContents: () => windowHost.contents(),
    deskContents: () => {
      const desk = opts.primary();
      return desk === null || desk.isDestroyed() ? null : desk.webContents;
    },
    fieldd: () => fieldd,
    logger,
  });

  // Every event that can change which processes the shell has. None is a timer.
  const poke = (): void => roster.poke();
  const onContents = (_event: unknown, contents: WebContents): void => {
    contents.on("did-finish-load", poke);
    contents.on("render-process-gone", poke);
    contents.once("destroyed", poke);
    incidents.watchContents(contents, nameOf(contents));
  };
  app.on("web-contents-created", onContents);
  app.on("child-process-gone", poke);
  app.on("browser-window-created", poke);
  app.on("child-process-gone", onChildGone);
  app.on("will-quit", leaving);
  for (const contents of webContents.getAllWebContents())
    incidents.watchContents(contents, nameOf(contents));

  let disposed = false;
  return {
    open: () => {
      void windowHost.open().catch(() => undefined); // said in the log by the window host
    },
    openWithDesk: () => {
      const desk = opts.primary();
      if (desk === null) return;
      // after the desk is shown and holds the keys, so this window is in front of it and never takes them
      afterDeskShown(desk, () => {
        if (disposed) return;
        void windowHost.openBeside().catch(() => undefined); // said in the log by the window host
      });
    },
    closeWindow: () => windowHost.close(),
    setFieldd: (client) => {
      if (client === fieldd) return;
      fieldd = client;
      for (const listener of fielddListeners) listener(client);
      if (client !== null) roster.fresh();
      if (client !== null) incidents.flush();
    },
    dispose: () => {
      disposed = true;
      app.off("web-contents-created", onContents);
      app.off("child-process-gone", poke);
      app.off("browser-window-created", poke);
      app.off("child-process-gone", onChildGone);
      app.off("will-quit", leaving);
      stopHearingMain();
      incidents.leave();
      roster.dispose();
      own.stop();
      captures.dispose();
      windowHost.close();
      fielddListeners.clear();
      fieldd = null;
    },
  };
}
