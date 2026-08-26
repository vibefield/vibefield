import type { BrowserWindow } from "electron";
import type { WindowSession } from "./window-policy";

export interface DevelopmentExtensionContext {
  readonly productWindow: BrowserWindow;
  readonly rendererBaseUrl: string;
  adoptHostAuxiliary(window: BrowserWindow): WindowSession;
}

/** Optional host composition supplied only by a development entry graph. */
export interface DesktopDevelopmentExtension {
  productRendererUrl(rendererBaseUrl: string): string;
  onProductWindowReady(context: DevelopmentExtensionContext): Promise<void>;
  onHostReady(): Promise<void>;
  dispose(): void;
}

let registered: DesktopDevelopmentExtension | null = null;

export function registerDesktopDevelopmentExtension(extension: DesktopDevelopmentExtension): void {
  if (registered !== null) throw new Error("a desktop development extension is already registered");
  registered = extension;
}

export function desktopDevelopmentExtension(): DesktopDevelopmentExtension | null {
  return registered;
}
