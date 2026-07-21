import { contextBridge, ipcRenderer } from "electron";

// Product traffic flows over the loopback WS (D27), never over IPC. This bridge
// contains only the connection descriptor plus the native window lifecycle
// handshake, which cannot be represented by fieldd product methods.
contextBridge.exposeInMainWorld("vibefield", {
  getConnection: (): Promise<{ port: number; token: string }> =>
    ipcRenderer.invoke("vibefield:connection"),
  onPrepareClose: (handler: (requestId: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: string) => handler(requestId);
    ipcRenderer.on("vibefield:prepare-close", listener);
    return () => ipcRenderer.off("vibefield:prepare-close", listener);
  },
  completeClose: (result: { requestId: string; ok: boolean; error?: string }): void => {
    ipcRenderer.send("vibefield:close-ready", result);
  },
});
