import { DESKTOP_TRAY_GUID } from "@vibefield/contracts";
import { Menu, type NativeImage, nativeImage, screen, Tray } from "electron";
import type { DesktopResources, TrayImageKind, TrayImageSet } from "./resources";
import type {
  NativeTrayPort,
  TrayNativeInspection,
  TrayRectangle,
  TrayRuntime,
} from "./tray-controller";
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

function templateItem(item: TrayMenuItem): Electron.MenuItemConstructorOptions {
  if (item.type === "separator") return { type: "separator" as const };
  return {
    ...(item.id !== undefined ? { id: item.id } : {}),
    ...(item.type !== undefined ? { type: item.type } : {}),
    ...(item.label !== undefined ? { label: item.label } : {}),
    ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
    ...(item.checked !== undefined ? { checked: item.checked } : {}),
    ...(item.click !== undefined ? { click: item.click } : {}),
    // UA-5 — the Switch User submenu; recursion keeps the mapping total
    ...(item.submenu !== undefined ? { submenu: item.submenu.map(templateItem) } : {}),
  };
}

function electronMenu(items: readonly TrayMenuItem[]) {
  return Menu.buildFromTemplate(items.map(templateItem));
}

function isFiniteRectangle(rect: TrayRectangle): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/** AppKit parks an overflow-hidden NSStatusItem just beyond a display edge. A
 * one-pixel intersection therefore gives a false "visible"; classify by the
 * item's center point instead. */
export function classifyTrayPlacement(
  bounds: TrayRectangle,
  displayBounds: readonly TrayRectangle[],
): TrayNativeInspection["placement"] {
  if (!isFiniteRectangle(bounds) || displayBounds.length === 0) return "unknown";
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return displayBounds.some(
    (display) =>
      isFiniteRectangle(display) &&
      centerX >= display.x &&
      centerX < display.x + display.width &&
      centerY >= display.y &&
      centerY < display.y + display.height,
  )
    ? "visible"
    : "offscreen";
}

export function trayGuidForPlatform(platform: TrayPlatform): string | null {
  // Windows must not consume the frozen slot until its binary is signed
  // (release-identity.json / EDP §5.6). macOS has no such restriction.
  return platform === "darwin" ? DESKTOP_TRAY_GUID : null;
}

export function createElectronTrayRuntime(
  resources: Pick<DesktopResources, "tray">,
  platform: TrayPlatform = normalizeTrayPlatform(process.platform),
): TrayRuntime {
  const guid = trayGuidForPlatform(platform);
  return {
    platform,
    guid,
    loadImage: (kind) => loadTrayImage(resources.tray, kind, platform),
    inspectImage: (image, kind) => {
      const native = image as NativeImage;
      const size = native.getSize();
      const paths = resources.tray[kind];
      const sourcePath =
        platform === "darwin"
          ? paths.macTemplate1x
          : platform === "win32"
            ? paths.windowsIco
            : platform === "linux"
              ? paths.linuxPng
              : null;
      return {
        sourcePath,
        width: size.width,
        height: size.height,
        scaleFactors: native.getScaleFactors(),
        template: native.isTemplateImage(),
      };
    },
    createTray: (image) =>
      new Tray(image as NativeImage, guid ?? undefined) as unknown as NativeTrayPort,
    inspectTray: (tray) => {
      if (platform !== "darwin") {
        return { bounds: null, displayBounds: [], placement: "unknown" };
      }
      const bounds = (tray as unknown as Tray).getBounds();
      const displayBounds = screen.getAllDisplays().map((display) => ({ ...display.bounds }));
      return {
        bounds,
        displayBounds,
        placement: classifyTrayPlacement(bounds, displayBounds),
      };
    },
    watchDisplays: (callback) => {
      if (platform !== "darwin") return () => undefined;
      const listener = () => callback();
      screen.on("display-added", listener);
      screen.on("display-removed", listener);
      screen.on("display-metrics-changed", listener);
      return () => {
        screen.off("display-added", listener);
        screen.off("display-removed", listener);
        screen.off("display-metrics-changed", listener);
      };
    },
    buildMenu: electronMenu,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancelSchedule: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

export function normalizeTrayPlatform(platform: NodeJS.Platform): TrayPlatform {
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform;
  return "other";
}
