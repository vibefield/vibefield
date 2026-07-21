import { contextBridge, ipcRenderer } from "electron";

// The whole bridge (design-03 A2): the renderer gets a connection descriptor —
// port + a per-window scoped token — and NOTHING else. All product traffic
// then flows over the loopback WS (D27), never over IPC.
contextBridge.exposeInMainWorld("vibefield", {
  getConnection: (): Promise<{ port: number; token: string }> => ipcRenderer.invoke("vibefield:connection"),
});
