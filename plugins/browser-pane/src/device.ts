// THE DEVICE SWITCH — the selection menu's acts (PT-1 scope 4: "Device ▸ Laptop · Desktop · iPad · iPhone"; core's
// `MenuActionDef`, one undo step each). A device is a DENSITY as well as a viewport (devices.ts), so a switch re-cuts the
// pane: to the device's own viewport at its density — a new `Size` — about the pane's centre (the prototype's
// `setDevice`), and the `device` prop with it, ALL IN ONE TRANSACTION (PT-1 ruling 5: `Size` is the truth; a switch that
// wrote the prop alone would leave a pane whose size reads another device's viewport).
//
// The act writes the object's `Position` and `Size` and its props' cell directly, through the menu's one transaction:
// the `/desk` door carries no `Size` (a kind is handed its rect, never its components), so this module alone reads the
// SDK's `/canvas` door — `Position`, `Size` and the widget catalog's read helper (said in the import wall and the note).

import { getWidgetType, Position, Size } from "@vibefield/plugin-sdk/canvas";
import type { MenuActionDef } from "@vibefield/plugin-sdk/desk";
import { cutOf, DEVICES, type Device } from "./devices";
import { BROWSER_PANE_TYPE } from "./ids";

/** Each device's word on the menu, and its glyph (the bar's 24-unit box, stroked). */
const SWITCH: Readonly<Record<Device["id"], { readonly label: string; readonly path: string }>> = {
  laptop: { label: "Laptop", path: "M5 6.5 H19 V15 H5 Z M3 18 H21" },
  desktop: { label: "Desktop", path: "M3.5 5 H20.5 V16 H3.5 Z M12 16 V19.5 M8 19.5 H16" },
  tablet: {
    label: "iPad",
    path: "M7 3.5 H17 A1.5 1.5 0 0 1 18.5 5 V19 A1.5 1.5 0 0 1 17 20.5 H7 A1.5 1.5 0 0 1 5.5 19 V5 A1.5 1.5 0 0 1 7 3.5 Z",
  },
  phone: {
    label: "iPhone",
    path: "M9 3.5 H15 A1.5 1.5 0 0 1 16.5 5 V19 A1.5 1.5 0 0 1 15 20.5 H9 A1.5 1.5 0 0 1 7.5 19 V5 A1.5 1.5 0 0 1 9 3.5 Z M11 18 H13",
  },
};

/** The act id that switches a pane to `device`. */
export const deviceActId = (device: Device["id"]): string => `device-${device}`;

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

/** The four acts: each re-cuts every selected pane to its device in ONE transaction (one undo step). */
export const DEVICE_ACTS: readonly MenuActionDef[] = DEVICES.map((device) => ({
  id: deviceActId(device.id),
  label: SWITCH[device.id].label,
  glyph: { path: SWITCH[device.id].path },
  run(api) {
    const cell = getWidgetType(BROWSER_PANE_TYPE)?.groups.find(
      (g) => g.name === "props",
    )?.component;
    if (cell === undefined) return;
    api.transact((tx) => {
      for (const e of api.entities) {
        const at = api.world.get(e, Position);
        const size = api.world.get(e, Size);
        if (at === undefined || size === undefined) continue;
        const next = switchedRect(at, size, device);
        const props = (api.world.get(e, cell) ?? {}) as Record<string, unknown>;
        tx.edit(e)
          .set(Position, { x: next.x, y: next.y })
          .set(Size, { w: next.w, h: next.h })
          .set(cell, { ...props, device: device.id });
      }
    });
  },
}));
