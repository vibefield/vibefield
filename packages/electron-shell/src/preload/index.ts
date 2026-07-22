import { CloseRequest, CloseResult, IPC_CHANNELS, WindowConnection } from "@vibefield/contracts";
import { contextBridge, ipcRenderer } from "electron";

// The bridge (ESR §5.2.5): contextBridge adaptation + validation, nothing else.
// Product traffic flows over the loopback WS (D27), never over IPC. BOTH
// directions validate against the contract schemas — a malformed main→renderer
// payload never reaches a handler, and a malformed renderer→main payload
// throws at its call site instead of crossing the boundary. No ipcRenderer,
// channel string, or Electron object escapes into the page.

contextBridge.exposeInMainWorld("vibefield", {
  getConnection: async (): Promise<{ port: number; token: string }> =>
    WindowConnection.parse(await ipcRenderer.invoke(IPC_CHANNELS.windowBootstrap)),
  onPrepareClose: (handler: (requestId: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, raw: unknown) => {
      const request = CloseRequest.safeParse(raw);
      if (!request.success) {
        console.error("[vibefield] dropped malformed prepare-close payload");
        return;
      }
      handler(request.data.requestId);
    };
    ipcRenderer.on(IPC_CHANNELS.prepareClose, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.prepareClose, listener);
  },
  completeClose: (result: { requestId: string; ok: boolean; error?: string }): void => {
    ipcRenderer.send(IPC_CHANNELS.closeResult, CloseResult.parse(result));
  },
});
