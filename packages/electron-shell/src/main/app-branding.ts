import type { DesktopResources } from "./resources";

export interface DockImagePort {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
}

export interface DockPort {
  setIcon(image: unknown): void;
}

export type DevelopmentDockIconResult =
  | { status: "not-applicable" }
  | {
      status: "applied";
      path: string;
      width: number;
      height: number;
    };

/** Development launches Electron's own bundle, so electron-builder never gets a
 * chance to install VibeField's application icon. Apply Icon Composer's checked
 * 1024px macOS rendition at runtime only; packaged identity remains Info.plist /
 * Assets.car / ICNS territory and must not be overridden here. */
export function applyDevelopmentDockIcon(
  resources: Pick<DesktopResources, "packaged" | "developmentDockIconPath">,
  native: {
    platform: string;
    dock: DockPort | null;
    loadImage(path: string): DockImagePort;
  },
): DevelopmentDockIconResult {
  if (resources.packaged || native.platform !== "darwin") {
    return { status: "not-applicable" };
  }
  if (resources.developmentDockIconPath === null) {
    throw new Error("development macOS Dock icon path is unavailable");
  }
  if (native.dock === null) {
    throw new Error("macOS Dock API is unavailable");
  }

  const image = native.loadImage(resources.developmentDockIconPath);
  if (image.isEmpty()) {
    throw new Error(
      `development Dock icon is empty or unreadable: ${resources.developmentDockIconPath}`,
    );
  }
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) {
    throw new Error(`development Dock icon has invalid dimensions: ${width}x${height}`);
  }
  native.dock.setIcon(image);
  return {
    status: "applied",
    path: resources.developmentDockIconPath,
    width,
    height,
  };
}
