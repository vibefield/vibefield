import { join } from "node:path";
import { type BrowserWindow, session } from "electron";
import type {
  DesktopDevelopmentExtension,
  DevelopmentExtensionContext,
} from "../main/development-extension";
import { installNavigationPolicy, installPermissionPolicy } from "../main/security";
import { createHostAuxiliaryWindow, loadRenderer } from "../main/windows";
import { studioRendererUrl } from "./url";

export const STUDIO_SESSION_PARTITION = "vibefield-studio";

export function createStudioHost(opts: { openAtStartup: boolean }): DesktopDevelopmentExtension {
  const preloadPath = join(__dirname, "..", "preload", "studio.cjs");
  let context: DevelopmentExtensionContext | null = null;
  let window: BrowserWindow | null = null;
  let opening: Promise<BrowserWindow> | null = null;

  const open = async (): Promise<BrowserWindow> => {
    if (window !== null && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return window;
    }
    if (opening !== null) return opening;
    if (context === null) throw new Error("Studio cannot open before the product host is ready");

    const attempt = (async () => {
      const studioSession = session.fromPartition(STUDIO_SESSION_PARTITION);
      installPermissionPolicy(studioSession);
      const next = createHostAuxiliaryWindow({
        title: "VibeField Studio",
        preloadPath,
        partition: STUDIO_SESSION_PARTITION,
        width: 1280,
        height: 900,
        backgroundColor: "#171717",
        show: false,
      });
      const lifetime = context.adoptHostAuxiliary(next);
      window = next;
      next.once("closed", () => {
        lifetime.dispose();
        if (window === next) window = null;
      });
      installNavigationPolicy(next, "dev");
      try {
        await loadRenderer(next, "dev", studioRendererUrl(context.rendererBaseUrl));
        if (next.isDestroyed()) throw new Error("Studio closed before its renderer became ready");
        next.show();
        next.focus();
        return next;
      } catch (error) {
        lifetime.dispose();
        if (!next.isDestroyed()) next.destroy();
        if (window === next) window = null;
        throw error;
      }
    })().finally(() => {
      if (opening === attempt) opening = null;
    });
    opening = attempt;
    return attempt;
  };

  return {
    async onProductWindowReady(nextContext) {
      context = nextContext;
    },
    async onHostReady() {
      if (opts.openAtStartup) await open();
    },
    dispose() {
      context = null;
      if (window !== null && !window.isDestroyed()) window.destroy();
      window = null;
    },
  };
}
