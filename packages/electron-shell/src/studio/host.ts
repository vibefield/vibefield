import { join } from "node:path";
import { type BrowserWindow, MessageChannelMain, session } from "electron";
import type {
  DesktopDevelopmentExtension,
  DevelopmentExtensionContext,
} from "../main/development-extension";
import { installNavigationPolicy, installPermissionPolicy } from "../main/security";
import { createHostAuxiliaryWindow, loadRenderer } from "../main/windows";
import {
  STUDIO_PRODUCT_PORT_CHANNEL,
  STUDIO_PUBLISHER_PORT_CHANNEL,
  type StudioPortEnvelope,
} from "./channels";
import type { StudioCommandHost, StudioHostCommand } from "./command-channel";
import { StudioRouter } from "./router";
import { studioProductRendererUrl, studioRendererUrl } from "./url";

export const STUDIO_SESSION_PARTITION = "vibefield-studio";

export function createStudioHost(opts: {
  openAtStartup: boolean;
  physicalAcceptance?: boolean;
}): DesktopDevelopmentExtension & StudioCommandHost {
  const preloadPath = join(__dirname, "..", "preload", "studio.cjs");
  let context: DevelopmentExtensionContext | null = null;
  let window: BrowserWindow | null = null;
  let opening: Promise<BrowserWindow> | null = null;
  let productWindow: BrowserWindow | null = null;
  let desiredOpen = opts.openAtStartup;
  let physicalAcceptanceStarted = false;
  let productPortGeneration = 0;
  let studioPortGeneration = 0;
  const router = new StudioRouter(Date.now, () => {
    if (productWindow === null || productWindow.isDestroyed()) return;
    if (productWindow.isMinimized()) productWindow.restore();
    productWindow.show();
    productWindow.focus();
  });

  const attachProductPort = (target: BrowserWindow): void => {
    if (target.isDestroyed()) return;
    productPortGeneration += 1;
    const { port1, port2 } = new MessageChannelMain();
    router.attachProduct(port1);
    target.webContents.postMessage(
      STUDIO_PRODUCT_PORT_CHANNEL,
      { generation: productPortGeneration } satisfies StudioPortEnvelope,
      [port2],
    );
  };

  const attachStudioPort = (target: BrowserWindow): void => {
    if (target.isDestroyed()) return;
    studioPortGeneration += 1;
    const { port1, port2 } = new MessageChannelMain();
    router.attachStudio(port1);
    target.webContents.postMessage(
      STUDIO_PUBLISHER_PORT_CHANNEL,
      { generation: studioPortGeneration } satisfies StudioPortEnvelope,
      [port2],
    );
  };

  const open = async (): Promise<BrowserWindow> => {
    desiredOpen = true;
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
        desiredOpen = false;
        router.closeStudio("studio-closed");
        lifetime.dispose();
        if (window === next) window = null;
      });
      next.webContents.on("did-finish-load", () => attachStudioPort(next));
      next.webContents.on("render-process-gone", () => router.closeStudio("studio-crashed"));
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

  const status = (): Record<string, unknown> => ({
    state: context === null ? "starting" : "ready",
    studio: window !== null && !window.isDestroyed() ? "open" : "closed",
    studioRequested: desiredOpen,
    productConnected: router.state().productConnection === "connected",
  });

  const handleCommand = async (command: StudioHostCommand): Promise<Record<string, unknown>> => {
    if (command.type === "studio.open" || command.type === "studio.focus") {
      desiredOpen = true;
      if (command.type === "studio.open" && command.section !== undefined) {
        router.navigateStudio(command.section);
      }
      if (context === null) return { ...status(), state: "queued" };
      await open();
      return { ...status(), section: command.type === "studio.open" ? command.section : undefined };
    }
    if (command.type === "studio.close") {
      desiredOpen = false;
      if (opening !== null) await opening.catch(() => undefined);
      if (window !== null && !window.isDestroyed()) window.close();
      return { ...status(), studio: "closed", studioRequested: false };
    }
    return status();
  };

  return {
    handleCommand,
    productRendererUrl: studioProductRendererUrl,
    async onProductWindowReady(nextContext) {
      context = nextContext;
      if (productWindow !== nextContext.productWindow) {
        productWindow = nextContext.productWindow;
        productWindow.webContents.on("did-finish-load", () => {
          if (productWindow === nextContext.productWindow) {
            attachProductPort(nextContext.productWindow);
          }
        });
        productWindow.webContents.on("render-process-gone", () => router.detachProductEndpoint());
        productWindow.once("closed", () => {
          if (productWindow === nextContext.productWindow) productWindow = null;
          router.detachProductEndpoint();
        });
      }
      attachProductPort(nextContext.productWindow);
    },
    async onHostReady() {
      if (!desiredOpen) return;
      const studioWindow = await open();
      if (opts.physicalAcceptance !== true || physicalAcceptanceStarted) return;
      physicalAcceptanceStarted = true;
      if (productWindow === null) throw new Error("Studio physical gate has no product window");
      const { runStudioPhysicalAcceptance } = await import("./physical-acceptance");
      await runStudioPhysicalAcceptance({
        productWindow,
        studioWindow,
        studioPartition: STUDIO_SESSION_PARTITION,
      });
    },
    dispose() {
      desiredOpen = false;
      context = null;
      productWindow = null;
      router.dispose();
      if (window !== null && !window.isDestroyed()) window.destroy();
      window = null;
    },
  };
}
