import { VITALS_PORT_CHANNEL } from "@vibefield/contracts/registries";
import { contextBridge, ipcRenderer } from "electron";
import {
  type VitalsBridgeHandler,
  VitalsPreloadBridge,
  type VitalsRendererPort,
} from "./vitals-preload-bridge";

// VT-2 (track VT, 2026-11-24) — the Vitals window's preload: the narrowest in the app. It exposes one function, a
// way to hear the stream main relays. No daemon token, no product door, nothing the page can send.

const bridge = new VitalsPreloadBridge();
ipcRenderer.on(VITALS_PORT_CHANNEL, (event) => {
  const port = event.ports[0] as VitalsRendererPort | undefined;
  if (port !== undefined) bridge.attach(port);
});

contextBridge.exposeInMainWorld("vibefieldVitals", {
  subscribe: (handler: VitalsBridgeHandler): (() => void) => bridge.subscribe(handler),
});
