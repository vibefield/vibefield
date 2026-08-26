import "../preload/index";
import { contextBridge, ipcRenderer } from "electron";
import { parseStudioPortGeneration, STUDIO_PRODUCT_PORT_CHANNEL } from "./channels";
import { ProductPreloadBridge } from "./product-preload-bridge";
import type { RendererPort } from "./studio-preload-bridge";

const bridge = new ProductPreloadBridge(`product-${crypto.randomUUID()}`);
const physicalAcceptance = process.env["VIBEFIELD_STUDIO_PHYSICAL"] === "1";
ipcRenderer.on(STUDIO_PRODUCT_PORT_CHANNEL, (event, envelope: unknown) => {
  const port = event.ports[0] as RendererPort | undefined;
  const generation = parseStudioPortGeneration(envelope);
  if (port === undefined) return;
  if (generation === null) port.close();
  else bridge.attach(port, generation);
});

const api = {
  onCommand: (handler: Parameters<typeof bridge.subscribe>[0]): (() => void) =>
    bridge.subscribe(handler),
  reportApplied: (revision: number): void => bridge.applied(revision),
  reportRejected: (revision: number, code: Parameters<typeof bridge.rejected>[1]): void =>
    bridge.rejected(revision, code),
  reportContext: (context: Parameters<typeof bridge.context>[0]): void => bridge.context(context),
  ...(physicalAcceptance ? { physicalState: () => bridge.physicalState() } : {}),
};
contextBridge.exposeInMainWorld("vibefieldStudioAppearance", api);
