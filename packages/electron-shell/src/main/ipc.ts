import {
  GodviewSetRequest,
  GodviewState as GodviewStateSchema,
  IPC_CHANNELS,
  TerminalBackendAttachResult,
} from "@vibefield/contracts";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { Logger } from "@vibefield/logging";
import { ipcMain } from "electron";
import { createBootstrapHandler } from "./bootstrap";
import type { GodviewRegistry } from "./godview";
import { shellIdentity } from "./login-shell";
import type { TerminalBackendRegistry } from "./terminal-backend";
import type { WindowRegistry } from "./window-policy";

// The closed IPC surface, main side (ESR §6.2–6.3): handlers wiring pure policy
// to ipcMain. The bootstrap handler awaits supervisor.ensure() itself —
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

/** The Backend door (GT-D3). Same sender gate as bootstrap: only a window THIS
 * shell registered may hand main a connection to dial. The ticket itself is
 * never inspected beyond its schema — main forwards transport coordinates and
 * holds no terminal product logic (design-03 A1).
 *
 * The answer also carries the shell identity (GT-D10). That is not product
 * logic sneaking in: `SHELL`, the passwd entry and `$HOME` are facts about the
 * machine that a sandboxed page cannot read, and the deck needs them before it
 * may mount a workspace. Composed HERE rather than inside the Backend host,
 * which stays exactly what it was — a ticket in, a bridge out. */
export function registerTerminalBackend(
  registry: WindowRegistry,
  backends: TerminalBackendRegistry,
  logger?: Logger,
): void {
  ipcMain.handle(IPC_CHANNELS.terminalConnect, async (event, raw: unknown) => {
    if (!registry.owns(event.sender)) {
      logger?.warn(
        "desktop.ipc.terminal_connect_refused",
        "Electron refused a terminal connection from an unregistered sender",
        { webContentsId: event.sender.id },
      );
      throw new Error("terminal connect refused: unregistered sender");
    }
    try {
      const result = await backends.ensure(event.sender).connect(raw);
      logger?.info(
        "desktop.ipc.terminal_backend_attached",
        "A registered renderer received the terminal bridge ports",
        { webContentsId: event.sender.id },
      );
      return TerminalBackendAttachResult.parse({ ...result, ...shellIdentity() });
    } catch (error) {
      logger?.error(
        "desktop.ipc.terminal_connect_failed",
        "Electron could not attach a terminal backend for a renderer",
        error,
        { webContentsId: event.sender.id },
      );
      throw error;
    }
  });
}

/** The Godview door (GT-D2). The toolbar button's request and the menu
 * accelerator's are the SAME transition applied to the same bit — this handler
 * exists so the button can reach it, not so the renderer can hold an opinion.
 * Same registered-sender gate as the others: a window this shell did not make
 * cannot flip a window it does not own. */
export function registerGodviewToggle(
  registry: WindowRegistry,
  godview: GodviewRegistry,
  logger?: Logger,
): void {
  ipcMain.handle(IPC_CHANNELS.godviewSet, async (event, raw: unknown) => {
    if (!registry.owns(event.sender)) {
      logger?.warn(
        "desktop.ipc.godview_set_refused",
        "Electron refused a Godview transition from an unregistered sender",
        { webContentsId: event.sender.id },
      );
      throw new Error("godview set refused: unregistered sender");
    }
    const request = GodviewSetRequest.parse(raw);
    return GodviewStateSchema.parse(godview.ensure(event.sender).set(request.open));
  });
}
