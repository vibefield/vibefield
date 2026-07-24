import { CloseRequest, CloseResult, IPC_CHANNELS, WindowConnection } from "@vibefield/contracts";
import { contextBridge, ipcRenderer } from "electron";
import { type DiagnosticsRendererPort, PreloadDiagnosticsBridge } from "./diagnostics";
import { PreloadLogBridge, type RendererLogPort } from "./logging";

// The bridge (ESR §5.2.5): contextBridge adaptation + validation, nothing else.
// Product traffic flows over the loopback WS (D27), never over IPC. BOTH
// directions validate against the contract schemas — a malformed main→renderer
// payload never reaches a handler, and a malformed renderer→main payload
// throws at its call site instead of crossing the boundary. No ipcRenderer,
// channel string, or Electron object escapes into the page.

const logging = new PreloadLogBridge();
const diagnostics = new PreloadDiagnosticsBridge();
ipcRenderer.on(IPC_CHANNELS.rendererLogPort, (event) => {
  const port = event.ports[0] as RendererLogPort | undefined;
  if (port !== undefined) logging.attach(port);
});
ipcRenderer.on(IPC_CHANNELS.diagnosticsPort, (event) => {
  const port = event.ports[0] as DiagnosticsRendererPort | undefined;
  if (port !== undefined) diagnostics.attach(port);
});

contextBridge.exposeInMainWorld("vibefield", {
  submitRendererLogs: (serializedBatch: string): boolean => logging.submit(serializedBatch),
  getConnection: async (): Promise<{ port: number; token: string }> =>
    WindowConnection.parse(await ipcRenderer.invoke(IPC_CHANNELS.windowBootstrap)),
  onPrepareClose: (handler: (requestId: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, raw: unknown) => {
      const request = CloseRequest.safeParse(raw);
      if (!request.success) {
        logging.submit(
          JSON.stringify({
            v: 1,
            records: [
              {
                v: 1,
                time: Date.now(),
                level: "error",
                event: "renderer.preload.close_payload_rejected",
                msg: "Preload rejected a malformed prepare-close payload",
                component: "preload.close",
                attrs: { issueCount: request.error.issues.length },
              },
            ],
          }),
        );
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
  diagnostics: {
    query: (query: unknown) => diagnostics.query(query),
    subscribe: (query: unknown, onEvent: Parameters<typeof diagnostics.subscribe>[1]) =>
      diagnostics.subscribe(query, onEvent),
    unsubscribe: (subId: string) => diagnostics.unsubscribe(subId),
    createLease: (request: unknown) => diagnostics.createLease(request),
    listLeases: () => diagnostics.listLeases(),
    revokeLease: (request: unknown) => diagnostics.revokeLease(request),
    openLogs: () => diagnostics.openLogs(),
    listCrashes: () => diagnostics.listCrashes(),
    markCrashViewed: (request: unknown) => diagnostics.markCrashViewed(request),
    previewSupport: (selection: unknown) => diagnostics.previewSupport(selection),
    exportSupport: (request: unknown) => diagnostics.exportSupport(request),
    copyText: (text: unknown) => diagnostics.copyText(text),
  },
});
