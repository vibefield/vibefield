import { contextBridge, ipcRenderer } from "electron";
import { STUDIO_PUBLISHER_PORT_CHANNEL } from "./channels";
import type { RendererPort } from "./studio-preload-bridge";
import { StudioPreloadBridge } from "./studio-preload-bridge";

const isolatedWindow = globalThis as unknown as {
  requestAnimationFrame(callback: () => void): number;
};
const bridge = new StudioPreloadBridge((callback) =>
  isolatedWindow.requestAnimationFrame(callback),
);
ipcRenderer.on(STUDIO_PUBLISHER_PORT_CHANNEL, (event) => {
  const port = event.ports[0] as RendererPort | undefined;
  if (port !== undefined) bridge.attach(port);
});

contextBridge.exposeInMainWorld("vibefieldStudio", {
  environment: "electron" as const,
  publishAppearance: (serialized: string): string => bridge.publish(serialized),
  clearAppearance: (): string => bridge.clear(),
  onMessage: (handler: Parameters<typeof bridge.subscribe>[0]): (() => void) =>
    bridge.subscribe(handler),
});
