import { Menu, type NativeImage, nativeImage, Tray } from "electron";
import type { DesktopResources, TrayImageKind, TrayImageSet } from "./resources";
import type { NativeTrayPort, TrayRuntime } from "./tray-controller";
import type { TrayMenuItem, TrayPlatform } from "./tray-model";

function assertImage(image: NativeImage, path: string): NativeImage {
  if (image.isEmpty()) throw new Error(`tray image is empty or unreadable: ${path}`);
  return image;
}

export function loadTrayImage(
  assets: Readonly<Record<TrayImageKind, TrayImageSet>>,
  kind: TrayImageKind,
  platform: TrayPlatform,
): NativeImage {
  const paths = assets[kind];
  if (platform === "darwin") {
    const image = assertImage(nativeImage.createFromPath(paths.macTemplate1x), paths.macTemplate1x);
    // Electron discovers the @2x representation from the Template basename;
    // validate it separately so packaging cannot silently ship a blurry or
    // incomplete status item.
    assertImage(nativeImage.createFromPath(paths.macTemplate2x), paths.macTemplate2x);
    image.setTemplateImage(true);
    return image;
  }
  const path = platform === "win32" ? paths.windowsIco : paths.linuxPng;
  return assertImage(nativeImage.createFromPath(path), path);
}

function electronMenu(items: readonly TrayMenuItem[]) {
  return Menu.buildFromTemplate(
    items.map((item) => {
      if (item.type === "separator") return { type: "separator" as const };
      return {
        ...(item.id !== undefined ? { id: item.id } : {}),
        ...(item.type !== undefined ? { type: item.type } : {}),
        ...(item.label !== undefined ? { label: item.label } : {}),
        ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
        ...(item.checked !== undefined ? { checked: item.checked } : {}),
        ...(item.click !== undefined ? { click: item.click } : {}),
      };
    }),
  );
}

export function createElectronTrayRuntime(
  resources: Pick<DesktopResources, "tray">,
  platform: TrayPlatform = normalizeTrayPlatform(process.platform),
): TrayRuntime {
  return {
    platform,
    loadImage: (kind) => loadTrayImage(resources.tray, kind, platform),
    createTray: (image) => new Tray(image as NativeImage) as NativeTrayPort,
    buildMenu: electronMenu,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancelSchedule: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

export function normalizeTrayPlatform(platform: NodeJS.Platform): TrayPlatform {
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform;
  return "other";
}
