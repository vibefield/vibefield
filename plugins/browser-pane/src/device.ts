// Object-menu settings write viewport size and emulation together, preserving the pane's centre
// in one undo step. This module owns the canvas components; page navigation stays in its own URL cell.

import { getWidgetType, Position, Size, type WidgetType } from "@vibefield/plugin-sdk/canvas";
import type { Entity, HeldToolApi, MenuActionDef, World } from "@vibefield/plugin-sdk/desk";
import {
  cutOf,
  type Device,
  deviceForProps,
  deviceOf,
  hundredth,
  sizeOf,
  viewportOf,
} from "./devices";
import { BROWSER_PANE_TYPE } from "./ids";
import { paneMenuOf } from "./menu-host";

/** The cut a device switch lands: the device's own viewport at its density, about the old centre — a pane's Position and Size. */
export function switchedRect(
  at: { readonly x: number; readonly y: number },
  size: { readonly w: number; readonly h: number },
  device: Device,
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const next = cutOf(device);
  const cx = at.x + size.w / 2;
  const cy = at.y + size.h / 2;
  return { x: cx - next.w / 2, y: cy - next.h / 2, w: next.w, h: next.h };
}

/** The pane type's props CELL — the component its props live in (the catalog's group `props`); undefined before the type is defined. */
export const propsCell = (): WidgetType["groups"][number]["component"] | undefined =>
  getWidgetType(BROWSER_PANE_TYPE)?.groups.find((g) => g.name === "props")?.component;

/** The cell the pane's `url` lives in — the catalog's group that holds it (its own: an undo of the desk's edits to the other
 * props never re-asserts an old address — the manifest's `groups`); undefined before the type is defined. */
export const urlCell = (): WidgetType["groups"][number]["component"] | undefined => {
  const type = getWidgetType(BROWSER_PANE_TYPE);
  const group = type?.propToGroup.url;
  return group === undefined ? undefined : type?.groups.find((g) => g.name === group)?.component;
};

export type PaneSettingsApi = Pick<HeldToolApi, "world" | "transact">;
export const DEVICE_GLYPH = {
  path: "M3 5 H16 V15 H3 Z M6 19 H12 M9 15 V19 M17 9 H21 V20 H14 V9 Z",
};
export const SOUND_ON = {
  path: "M3 9 H7 L12 5 V19 L7 15 H3 Z M16 8 C19 10 19 14 16 16 M18 5 C23 8 23 16 18 19",
};
export const SOUND_OFF = { path: "M3 9 H7 L12 5 V19 L7 15 H3 Z M16 9 L22 15 M22 9 L16 15" };

export const configureDevice = (api: PaneSettingsApi, entities: readonly Entity[]): void =>
  paneMenuOf(api.world)?.configure(api, entities);

/** A mixed selection mutes together; a silent selection turns sound on together. */
export function togglePaneSound(api: PaneSettingsApi, entities: readonly Entity[]): void {
  const cell = propsCell();
  if (cell === undefined || entities.length === 0) return;
  const muted = !entities.every(
    (e) => (api.world.get(e, cell) as { muted?: boolean } | undefined)?.muted === true,
  );
  if (
    api.transact((tx) => {
      for (const e of entities) tx.edit(e).set(cell, { ...(api.world.get(e, cell) ?? {}), muted });
    })
  )
    paneMenuOf(api.world)?.say(muted ? "Sound muted" : "Sound on");
}

/** The object menu configures the browser environment. Navigation stays on the pane. */
export const DEVICE_ACTS: readonly MenuActionDef[] = [
  {
    id: "device",
    label: "Device emulation",
    glyph: DEVICE_GLYPH,
    run: (api) => configureDevice(api, api.entities),
  },
  {
    id: "sound",
    label: "Toggle sound",
    glyph: SOUND_ON,
    run: (api) => togglePaneSound(api, api.entities),
  },
];

export interface PaneSettings {
  readonly device: Device["id"];
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly inputMode: string;
  readonly userAgentMode: string;
  readonly userAgent: string;
  readonly navigatorPlatform: string;
}
export function readPaneSettings(world: World, entity: Entity): PaneSettings | undefined {
  const cell = propsCell();
  const size = world.get(entity, Size);
  if (cell === undefined || size === undefined) return undefined;
  const props = (world.get(entity, cell) ?? {}) as Record<string, unknown>;
  const device = deviceForProps(props);
  const [width, height] = viewportOf(size, device);
  return {
    device: device.id,
    width,
    height,
    deviceScaleFactor: device.dpr,
    inputMode: device.mobile
      ? device.touch
        ? "mobile"
        : "mobile-pointer"
      : device.touch
        ? "desktop-touch"
        : "desktop",
    userAgentMode: typeof props.userAgentMode === "string" ? props.userAgentMode : "device",
    userAgent: typeof props.userAgent === "string" ? props.userAgent : "",
    navigatorPlatform: typeof props.navigatorPlatform === "string" ? props.navigatorPlatform : "",
  };
}

/** Resize and emulation changes are one undo step. Pixel-ratio changes may recreate the source. */
export function applyPaneSettings(
  api: PaneSettingsApi,
  entities: readonly Entity[],
  settings: PaneSettings,
): boolean {
  const { width, height, deviceScaleFactor: dpr } = settings;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 320 ||
    height < 240 ||
    width > 8192 ||
    height > 8192 ||
    !Number.isFinite(dpr) ||
    dpr < 0.5 ||
    dpr > 8
  )
    return false;
  if (
    !["desktop", "desktop-touch", "mobile", "mobile-pointer"].includes(settings.inputMode) ||
    !["device", "browser", "custom"].includes(settings.userAgentMode)
  )
    return false;
  // Reject control characters before they reach the host's bounded device reader.
  if (
    // biome-ignore lint/suspicious/noControlCharactersInRegex: user-agent headers cannot carry control characters
    /[\u0000-\u001f\u007f]/u.test(settings.userAgent + settings.navigatorPlatform) ||
    settings.userAgent.length > 512 ||
    settings.navigatorPlatform.length > 32 ||
    (settings.userAgentMode === "custom" && !settings.userAgent.trim())
  )
    return false;
  const cell = propsCell();
  if (cell === undefined || entities.length === 0) return false;
  const cut = sizeOf([width, height], deviceOf(settings.device));
  const next = { w: hundredth(cut.w), h: hundredth(cut.h) };
  const { width: _w, height: _h, ...props } = settings;
  return api.transact((tx) => {
    for (const e of entities) {
      const at = api.world.get(e, Position),
        size = api.world.get(e, Size);
      if (at === undefined || size === undefined) continue;
      tx.edit(e)
        .set(Position, { x: at.x + (size.w - next.w) / 2, y: at.y + (size.h - next.h) / 2 })
        .set(Size, next)
        .set(cell, { ...(api.world.get(e, cell) ?? {}), ...props });
    }
  });
}
