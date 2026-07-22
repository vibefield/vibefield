import { type CloseRequest, type CloseResult, IPC_CHANNELS } from "@vibefield/contracts";
import { contextBridge, ipcRenderer } from "electron";

// Product traffic flows over the loopback WS (D27), never over IPC. This bridge
// contains only the connection descriptor plus the native window lifecycle
// handshake, which cannot be represented by fieldd product methods. Channel
// names come from the contracts registry (ESR §6.2 — the closed surface);
// schema validation on both directions arrives with the slice-2 bridge.
contextBridge.exposeInMainWorld("vibefield", {
  getConnection: (): Promise<{ port: number; token: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.windowBootstrap),
  onPrepareClose: (handler: (requestId: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: CloseRequest) =>
      handler(request.requestId);
    ipcRenderer.on(IPC_CHANNELS.prepareClose, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.prepareClose, listener);
  },
  completeClose: (result: CloseResult): void => {
    ipcRenderer.send(IPC_CHANNELS.closeResult, result);
  },
});
