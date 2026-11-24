import { VITALS_PORT_CHANNEL } from "@vibefield/contracts/registries";
import type { Logger } from "@vibefield/logging";
import { type BrowserWindow, MessageChannelMain } from "electron";
import { APP_ORIGIN } from "./app-origin";
import type { ShellMode } from "./modes";
import { installNavigationPolicy } from "./security";
import type { VitalsFeedPort } from "./vitals-feed";
import { installWindowChords } from "./window-chords";
import { createVitalsWindow } from "./windows";

// VT-2 (track VT, 2026-11-24) — THE VITALS WINDOW'S HOST (DESIGN.md §8 "Vitals"; DECISIONS VT, VT-D1 A): a window
// of its own in every build, opened from the Window menu. It is a host window, never a product one: the registry
// gives it no product IPC, its preload exposes one read-only stream, and it is closed with the app (a quit never
// waits on it).

const VITALS_DOCUMENT = "/vitals.html";
const DEV_LOAD_TRIES = 40;
const DEV_LOAD_WAIT_MS = 500;

/** The Vitals document's URL: the app's own origin in a build, the dev server in dev. */
export function vitalsRendererUrl(mode: ShellMode, viteUrl: string): string {
  return mode === "dev"
    ? new URL(VITALS_DOCUMENT, viteUrl).href
    : `${APP_ORIGIN}${VITALS_DOCUMENT}`;
}

export interface VitalsWindowHost {
  /** Open the window, or bring the open one forward. */
  open(): Promise<void>;
  /** Close it, if open. A quit calls this first, so the app never waits on it. */
  close(): void;
  /** The window's renderer process, for the shell's roster; null while it has none. */
  rendererPid(): number | null;
}

export function createVitalsWindowHost(opts: {
  mode: ShellMode;
  viteUrl: string;
  preloadPath: string;
  /** the registry's host-window adoption */
  adopt(window: BrowserWindow): { dispose(): void };
  /** one feed per document generation, over the port main keeps */
  feed(port: VitalsFeedPort): { start(): void; close(): void };
  /** the window was opened, loaded or closed: the shell's roster changed */
  onChanged(): void;
  quit(): void;
  /** A test harness's run: the window is kept from the person at the desk, shown without taking the keys and
   * passed through by the pointer, as the harness's own windows are. */
  quiet?: boolean;
  logger: Logger;
}): VitalsWindowHost {
  let window: BrowserWindow | null = null;
  let opening: Promise<void> | null = null;
  let session: { start(): void; close(): void } | null = null;

  const closeFeed = (): void => {
    session?.close();
    session = null;
  };
  const openFeed = (target: BrowserWindow): void => {
    if (target.isDestroyed()) return;
    closeFeed();
    const { port1, port2 } = new MessageChannelMain();
    const next = opts.feed(port1 as unknown as VitalsFeedPort);
    session = next;
    next.start();
    try {
      target.webContents.postMessage(VITALS_PORT_CHANNEL, null, [port2]);
    } catch (error) {
      closeFeed();
      opts.logger.error(
        "desktop.vitals.port_failed",
        "Electron could not hand the Vitals window its port",
        error,
      );
    }
  };

  const load = async (target: BrowserWindow): Promise<void> => {
    const url = vitalsRendererUrl(opts.mode, opts.viteUrl);
    if (opts.mode !== "dev") {
      await target.loadURL(url);
      return;
    }
    for (let attempt = 0; attempt < DEV_LOAD_TRIES; attempt++) {
      try {
        await target.loadURL(url);
        return;
      } catch (error) {
        if (target.isDestroyed()) throw error;
        await new Promise((resolve) => setTimeout(resolve, DEV_LOAD_WAIT_MS)); // vite still booting
      }
    }
    throw new Error("the dev server never served the Vitals document");
  };

  const present = (target: BrowserWindow): void => {
    if (opts.quiet === true) {
      target.setIgnoreMouseEvents(true);
      target.showInactive();
      return;
    }
    target.show();
    target.focus();
  };

  const open = async (): Promise<void> => {
    if (window !== null && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      present(window);
      return;
    }
    if (opening !== null) return opening;
    const attempt = (async () => {
      const next = createVitalsWindow({ preloadPath: opts.preloadPath, show: false });
      const lifetime = opts.adopt(next);
      window = next;
      next.once("closed", () => {
        closeFeed();
        lifetime.dispose();
        if (window === next) window = null;
        opts.onChanged();
      });
      next.webContents.on("did-finish-load", () => {
        openFeed(next);
        opts.onChanged();
      });
      next.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) closeFeed();
      });
      next.webContents.on("render-process-gone", () => {
        closeFeed();
        opts.onChanged();
      });
      installNavigationPolicy(next, opts.mode);
      // ⌘Q is main's above every page, this one's too (AL-9)
      installWindowChords(next, { quit: opts.quit });
      try {
        await load(next);
        if (next.isDestroyed()) throw new Error("the Vitals window closed before it loaded");
        present(next);
        opts.logger.info("desktop.vitals.window_opened", "The Vitals window opened");
      } catch (error) {
        closeFeed();
        lifetime.dispose();
        if (!next.isDestroyed()) next.destroy();
        if (window === next) window = null;
        opts.logger.error(
          "desktop.vitals.window_failed",
          "The Vitals window could not load its document",
          error,
        );
        throw error;
      }
    })().finally(() => {
      if (opening === attempt) opening = null;
    });
    opening = attempt;
    return attempt;
  };

  return {
    open,
    close: () => {
      const current = window;
      if (current === null || current.isDestroyed()) return;
      // destroyed, not asked: the page holds nothing to save, and a quit must not wait on it
      current.destroy();
    },
    rendererPid: () => {
      const current = window;
      if (current === null || current.isDestroyed()) return null;
      const contents = current.webContents;
      if (contents.isDestroyed() || contents.isCrashed()) return null;
      const pid = contents.getOSProcessId();
      return pid > 0 ? pid : null;
    },
  };
}
