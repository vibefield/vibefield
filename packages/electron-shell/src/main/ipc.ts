import { IPC_CHANNELS } from "@vibefield/contracts";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
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
  supervisor: FielddSupervisor,
): void {
  ipcMain.handle(
    IPC_CHANNELS.windowBootstrap,
    createBootstrapHandler({
      owns: (sender) => registry.owns(sender),
      ensure: (o) => supervisor.ensure(o),
    }),
  );
}
