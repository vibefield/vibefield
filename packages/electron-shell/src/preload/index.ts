import { forwardGhostteaRendererPorts } from "@vibecook/ghosttea-electron/preload";
import {
  CloseRequest,
  CloseResult,
  type DesktopShellState,
  GodviewSetRequest,
  type GodviewState,
  GodviewState as GodviewStateSchema,
  IPC_CHANNELS,
  type ShellCommand,
  ShellPlatform,
  TerminalBackendAttachResult,
  type TerminalBridgeStatus,
  TerminalTicket,
  type UserRecord,
  UserRecord as UserRecordSchema,
  UsersUpdateParams,
  WindowConnection,
} from "@vibefield/contracts";
import { contextBridge, ipcRenderer } from "electron";
import { PreloadDesktopStateBridge } from "./desktop-state";
import { type DiagnosticsRendererPort, PreloadDiagnosticsBridge } from "./diagnostics";
import { PreloadGodviewStateBridge } from "./godview";
import { PreloadLogBridge, type RendererLogPort } from "./logging";
import { PreloadShellCommandBridge } from "./shell-commands";
import { PreloadTerminalStatusBridge } from "./terminal";

// The bridge (ESR §5.2.5): contextBridge adaptation + validation, nothing else.
// Product traffic flows over the loopback WS (D27), never over IPC. BOTH
// directions validate against the contract schemas — a malformed main→renderer
// payload never reaches a handler, and a malformed renderer→main payload
// throws at its call site instead of crossing the boundary. No ipcRenderer,
// channel string, or Electron object escapes into the page.

const logging = new PreloadLogBridge();
const diagnostics = new PreloadDiagnosticsBridge();
const desktopState = new PreloadDesktopStateBridge((issueCount) => {
  logging.submit(
    JSON.stringify({
      v: 1,
      records: [
        {
          v: 1,
          time: Date.now(),
          level: "error",
          event: "renderer.preload.desktop_state_rejected",
          msg: "Preload rejected malformed desktop capability state",
          component: "preload.shell",
          attrs: { issueCount },
        },
      ],
    }),
  );
});
const shellCommands = new PreloadShellCommandBridge((issueCount) => {
  logging.submit(
    JSON.stringify({
      v: 1,
      records: [
        {
          v: 1,
          time: Date.now(),
          level: "error",
          event: "renderer.preload.shell_command_rejected",
          msg: "Preload rejected a malformed shell command",
          component: "preload.shell",
          attrs: { issueCount },
        },
      ],
    }),
  );
});
const terminalStatus = new PreloadTerminalStatusBridge((issueCount) => {
  logging.submit(
    JSON.stringify({
      v: 1,
      records: [
        {
          v: 1,
          time: Date.now(),
          level: "error",
          event: "renderer.preload.terminal_status_rejected",
          msg: "Preload rejected a malformed terminal bridge status",
          component: "preload.terminal",
          attrs: { issueCount },
        },
      ],
    }),
  );
});
const godviewState = new PreloadGodviewStateBridge((issueCount) => {
  logging.submit(
    JSON.stringify({
      v: 1,
      records: [
        {
          v: 1,
          time: Date.now(),
          level: "error",
          event: "renderer.preload.godview_state_rejected",
          msg: "Preload rejected a malformed Godview state",
          component: "preload.godview",
          attrs: { issueCount },
        },
      ],
    }),
  );
});
/** The control and frame ports cross a world boundary no page can span alone
 * (GT-0 finding 2): main transfers them with `webContents.postMessage`, which
 * lands on `ipcRenderer` in the ISOLATED world, while the ghosttea runtime
 * listens for a `window` message in the MAIN world. Installed on the first
 * connect rather than at load: a window that never asks for a terminal keeps no
 * port forward at all, and main only posts to a window that has asked. */
let portForwardInstalled = false;
const installPortForward = (): void => {
  if (portForwardInstalled) return;
  portForwardInstalled = true;
  forwardGhostteaRendererPorts(ipcRenderer);
};
const platform = ShellPlatform.parse(
  process.platform === "darwin" || process.platform === "win32" || process.platform === "linux"
    ? process.platform
    : "other",
);
ipcRenderer.on(IPC_CHANNELS.rendererLogPort, (event) => {
  const port = event.ports[0] as RendererLogPort | undefined;
  if (port !== undefined) logging.attach(port);
});
ipcRenderer.on(IPC_CHANNELS.diagnosticsPort, (event) => {
  const port = event.ports[0] as DiagnosticsRendererPort | undefined;
  if (port !== undefined) diagnostics.attach(port);
});
ipcRenderer.on(IPC_CHANNELS.shellCommand, (_event, raw: unknown) => {
  shellCommands.accept(raw);
});
ipcRenderer.on(IPC_CHANNELS.desktopState, (_event, raw: unknown) => {
  desktopState.accept(raw);
});
ipcRenderer.on(IPC_CHANNELS.terminalStatus, (_event, raw: unknown) => {
  terminalStatus.accept(raw);
});
ipcRenderer.on(IPC_CHANNELS.godviewState, (_event, raw: unknown) => {
  godviewState.accept(raw);
});

contextBridge.exposeInMainWorld("vibefield", {
  platform,
  submitRendererLogs: (serializedBatch: string): boolean => logging.submit(serializedBatch),
  getConnection: async (): Promise<{ port: number; token: string }> =>
    WindowConnection.parse(await ipcRenderer.invoke(IPC_CHANNELS.windowBootstrap)),
  /** UA-3 — the Account page's profile write (name/color/resident/onboarded).
   * Validated both directions; main owns users.json and refuses empty or
   * unregistered-sender updates. */
  usersUpdate: async (params: UsersUpdateParams): Promise<UserRecord> =>
    UserRecordSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.usersUpdate, UsersUpdateParams.parse(params)),
    ),
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
  onShellCommand: (handler: (command: ShellCommand) => void): (() => void) =>
    shellCommands.subscribe(handler),
  onDesktopState: (handler: (state: DesktopShellState) => void): (() => void) =>
    desktopState.subscribe(handler),
  terminal: {
    connect: async (ticket: unknown): Promise<TerminalBackendAttachResult> => {
      // Parsed here, before the port forward exists: a malformed ticket must
      // throw at the call site rather than arm a listener and cross IPC. The
      // ANSWER is parsed too (GT-D10): the page mounts a workspace on the
      // `defaultShell` it carries, and a missing one must fail here rather
      // than become `undefined` in a spawn.
      const validated = TerminalTicket.parse(ticket);
      installPortForward();
      return TerminalBackendAttachResult.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.terminalConnect, validated),
      );
    },
    onStatus: (handler: (status: TerminalBridgeStatus) => void): (() => void) =>
      terminalStatus.subscribe(handler),
  },
  godview: {
    /** `open` omitted = flip. The page never sends the value it believes,
     * because main is the one holding it (GT-D2). */
    set: async (open?: boolean): Promise<GodviewState> =>
      GodviewStateSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.godviewSet,
          GodviewSetRequest.parse(open === undefined ? {} : { open }),
        ),
      ),
    onState: (handler: (state: GodviewState) => void): (() => void) =>
      godviewState.subscribe(handler),
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
