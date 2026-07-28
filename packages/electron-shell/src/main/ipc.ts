import { IPC_CHANNELS } from "@vibefield/contracts";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { Logger } from "@vibefield/logging";
import { ipcMain } from "electron";
import { createBootstrapHandler } from "./bootstrap";
import type { WindowRegistry } from "./window-policy";

// The closed IPC surface, main side (ESR §6.2–6.3): one handler, wiring the
// pure bootstrap policy (sender gate + once-per-generation mint cache,
// bootstrap.ts) to ipcMain. The handler awaits supervisor.ensure() itself —
// window creation never waits for daemon readiness (ESR-8), ensure() is
// in-flight-deduped with failure clearing its cache, so a failed boot
// surfaces honestly to the renderer and a later retry re-attempts
// adoption/spawn for real (§6.3).

export function registerWindowBootstrap(
  registry: WindowRegistry,
  ensure: FielddSupervisor["ensure"],
  logger?: Logger,
): void {
  const handle = createBootstrapHandler({
    owns: (sender) => registry.owns(sender),
    ensure,
    onRevokeError: (error, details) => {
      logger?.error(
        "desktop.ipc.window_token_revoke_failed",
        "Electron could not confirm renderer token revocation",
        error,
        details,
      );
    },
  });
  ipcMain.handle(IPC_CHANNELS.windowBootstrap, async (event) => {
    try {
      const result = await handle(event);
      logger?.info(
        "desktop.ipc.window_bootstrap_completed",
        "A registered renderer received its fieldd connection",
        { webContentsId: event.sender.id },
      );
      return result;
    } catch (error) {
      logger?.warn(
        "desktop.ipc.window_bootstrap_rejected",
        "Electron rejected or failed a renderer bootstrap request",
        { webContentsId: event.sender.id, error },
      );
      throw error;
    }
  });
}
