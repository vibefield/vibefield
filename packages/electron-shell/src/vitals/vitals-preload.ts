import { VITALS_PORT_CHANNEL } from "@vibefield/contracts/registries";
import { contextBridge, ipcRenderer } from "electron";
import { vitalsCaptureBridge } from "./vitals-capture-preload";
import {
  type VitalsBridgeHandler,
  VitalsPreloadBridge,
  type VitalsRendererPort,
} from "./vitals-preload-bridge";

// VT-2 (track VT, 2026-11-24) — the Vitals window's preload: the narrowest in the app. It exposes one function, a
// way to hear the stream main relays. No daemon token, no product door, nothing the page can send.
// VT-5 (2026-11-24): and one thing it may ask, a capture armed by hand (`vitals-capture-preload.ts`), which main checks
// against its closed lists. Still no daemon token and no product door.
// VT-4b (2026-11-24): and one thing it may send, an incident's id to open, which main reads for it.

const bridge = new VitalsPreloadBridge();
ipcRenderer.on(VITALS_PORT_CHANNEL, (event) => {
  const port = event.ports[0] as VitalsRendererPort | undefined;
  if (port !== undefined) bridge.attach(port);
});

contextBridge.exposeInMainWorld("vibefieldVitals", {
  subscribe: (handler: VitalsBridgeHandler): (() => void) => bridge.subscribe(handler),
  captures: vitalsCaptureBridge(ipcRenderer),
  // VT-4b — the one thing the page may send: an incident's id to open, which main reads for it
  openIncident: (id: unknown): void => bridge.openIncident(id),
});
