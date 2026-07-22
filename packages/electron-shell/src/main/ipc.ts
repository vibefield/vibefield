import { IPC_CHANNELS, type WindowConnection } from "@vibefield/contracts";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { ipcMain } from "electron";
import type { WindowRegistry } from "./window-policy";

// The closed IPC surface, main side (ESR §6.2–6.3). One handler; the sender
// policy refuses webContents this shell did not register — a frame or foreign
// window cannot mint itself a token.
//
// Slice 4: the handler awaits supervisor.ensure() itself — window creation no
// longer waits for daemon readiness (ESR-8), and ensure() is in-flight-deduped
// with failure clearing its cache, so a failed boot surfaces honestly to the
// renderer and a later retry re-attempts adoption/spawn for real (§6.3).

export function registerWindowBootstrap(
  registry: WindowRegistry,
  supervisor: FielddSupervisor,
): void {
  ipcMain.handle(IPC_CHANNELS.windowBootstrap, async (event) => {
    if (!registry.owns(event.sender)) {
      throw new Error("window bootstrap refused: unregistered sender");
    }
    const handle = await supervisor.ensure();
    const minted = (await handle.client.request("system.mintWindowToken", {
      // B3: the renderer owns the board doc — doc.* is scope-gated (EL7), and
      // the doc lane itself is entered through doc.open's one-shot ticket.
      // C4: workspace.read lets the Settings mesh section read the device roster.
      scopes: ["doc.read", "doc.write", "workspace.read"],
      label: `window-${event.sender.id}`,
    })) as { token: string };
    return { port: handle.info.port, token: minted.token } satisfies WindowConnection;
  });
}
