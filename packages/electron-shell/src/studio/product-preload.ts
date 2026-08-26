import "../preload/index";
import { contextBridge, ipcRenderer } from "electron";
import { STUDIO_PRODUCT_PORT_CHANNEL } from "./channels";
import { ProductPreloadBridge } from "./product-preload-bridge";
import type { RendererPort } from "./studio-preload-bridge";

const bridge = new ProductPreloadBridge(`product-${crypto.randomUUID()}`);
ipcRenderer.on(STUDIO_PRODUCT_PORT_CHANNEL, (event) => {
  const port = event.ports[0] as RendererPort | undefined;
  if (port !== undefined) bridge.attach(port);
});

contextBridge.exposeInMainWorld("vibefieldStudioAppearance", {
  onCommand: (handler: Parameters<typeof bridge.subscribe>[0]): (() => void) =>
    bridge.subscribe(handler),
  reportApplied: (revision: number): void => bridge.applied(revision),
  reportRejected: (revision: number, code: Parameters<typeof bridge.rejected>[1]): void =>
    bridge.rejected(revision, code),
});
