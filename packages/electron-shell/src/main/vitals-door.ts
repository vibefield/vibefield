import { IPC_CHANNELS } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { ipcMain, type WebContents } from "electron";

// VT-2c (track VT, 2026-11-24; DESIGN.md §8 "Vitals", the recorder's switch) — Settings → Diagnostics' Open Vitals,
// main's half. It opens the Vitals window or brings it forward, the Window menu's own action (`vitals.ts` `open`), and
// nothing else: no argument is read and nothing is answered. Only a registered product window's own page may ask, and
// only while it holds the focus, because the press that asks is in it: a page in the background, a frame inside a page,
// a browsed site and the Vitals window itself (a host auxiliary, which `owns` never counts) are refused.

/** What the door needs of the window registry: whether a sender is a product window this shell made. */
export interface VitalsDoorRegistry {
  owns(sender: WebContents): boolean;
}

interface VitalsDoorEvent {
  sender: WebContents;
  senderFrame: unknown;
}

/** The refusal's words when no Vitals is installed in this mode (a harness with no menu). */
export const VITALS_DOOR_UNAVAILABLE = "Vitals is not available in this window";

export function createVitalsOpenHandler(opts: {
  registry: VitalsDoorRegistry;
  /** the Window menu's Vitals action now, or null in a mode that installs none */
  open: () => (() => void) | null;
  logger?: Logger;
}): (event: VitalsDoorEvent) => void {
  return (event) => {
    const sender = event.sender;
    if (
      !opts.registry.owns(sender) ||
      event.senderFrame !== sender.mainFrame ||
      !sender.isFocused()
    ) {
      opts.logger?.warn(
        "desktop.ipc.vitals_open_refused",
        "Electron refused to open Vitals for a sender that is not the focused product window",
        { webContentsId: sender.id },
      );
      throw new Error("Open Vitals requires the focused product window");
    }
    const open = opts.open();
    if (open === null) throw new Error(VITALS_DOOR_UNAVAILABLE);
    open();
  };
}

export function registerVitalsOpen(opts: Parameters<typeof createVitalsOpenHandler>[0]): void {
  const handle = createVitalsOpenHandler(opts);
  ipcMain.handle(IPC_CHANNELS.vitalsOpen, (event) => {
    handle(event);
  });
}
