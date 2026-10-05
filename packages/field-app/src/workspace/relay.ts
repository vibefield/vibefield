import { connectWebSocketChannel, relayExplorerChannel } from "@vibecook/mille/remote";
import {
  WORKSPACE_LIMITS,
  WorkspaceGitOpened,
  WorkspaceGitPortRequest,
  WorkspaceGitPortResponse,
  type WorkspaceOpenTicketResult,
} from "@vibefield/contracts";

/** Runs in the window's Worker; the room receives only two MessagePorts. */
export async function openWorkspaceRelay(
  ticket: WorkspaceOpenTicketResult,
  onClosed: () => void,
  WebSocketImpl: typeof WebSocket = WebSocket,
): Promise<{ treePort: MessagePort; gitPort: MessagePort; dispose: () => void }> {
  const tree = await connectWebSocketChannel(ticket.endpoints.treeUrl, {
    exportId: ticket.rootId,
    credential: ticket.ticket,
    access: "read-only",
    WebSocket: WebSocketImpl,
    openTimeoutMs: WORKSPACE_LIMITS.ATTACH_TIMEOUT_MS,
  });
  const git = new WebSocketImpl(ticket.endpoints.gitUrl);
  const treePorts = new MessageChannel();
  const gitPorts = new MessageChannel();
  let ended = false;
  let live = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    tree.close();
    git.close();
    treePorts.port1.close();
    gitPorts.port1.close();
    if (live) onClosed();
  };
  tree.channel.onClose(finish);
  git.addEventListener("close", finish);
  git.addEventListener("error", finish);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail(), WORKSPACE_LIMITS.ATTACH_TIMEOUT_MS);
      const fail = () => {
        cleanup();
        reject(new Error("The files connection did not open"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        git.removeEventListener("message", opened);
        git.removeEventListener("error", fail);
        git.removeEventListener("close", fail);
      };
      const opened = (event: MessageEvent) => {
        try {
          if (!WorkspaceGitOpened.safeParse(JSON.parse(String(event.data))).success) {
            fail();
            return;
          }
          cleanup();
          resolve();
        } catch {
          fail();
        }
      };
      git.addEventListener(
        "open",
        () =>
          git.send(
            JSON.stringify({
              type: "open",
              rootId: ticket.rootId,
              credential: ticket.gitTicket,
            }),
          ),
        { once: true },
      );
      git.addEventListener("message", opened);
      git.addEventListener("error", fail, { once: true });
      git.addEventListener("close", fail, { once: true });
    });
    if (ended) throw new Error("The files connection closed while opening");
    relayExplorerChannel(tree.channel, treePorts.port1, { transfer: true, onClose: finish });
    gitPorts.port1.onmessage = (event: MessageEvent) => {
      const request = WorkspaceGitPortRequest.safeParse(event.data);
      if (!request.success || git.readyState !== 1) {
        finish();
        return;
      }
      const encoded = JSON.stringify(request.data);
      if (
        new TextEncoder().encode(encoded).byteLength > WORKSPACE_LIMITS.GIT_REQUEST_BYTES ||
        git.bufferedAmount > WORKSPACE_LIMITS.SOCKET_BUFFER_BYTES
      ) {
        finish();
        return;
      }
      git.send(encoded);
    };
    git.addEventListener("message", (event: MessageEvent) => {
      try {
        const response = WorkspaceGitPortResponse.safeParse(JSON.parse(String(event.data)));
        if (!response.success) {
          finish();
          return;
        }
        gitPorts.port1.postMessage(response.data);
      } catch {
        finish();
      }
    });
    gitPorts.port1.start();
    live = true;
    return {
      treePort: treePorts.port2,
      gitPort: gitPorts.port2,
      dispose: () => {
        live = false;
        finish();
        treePorts.port2.close();
        gitPorts.port2.close();
      },
    };
  } catch (error) {
    finish();
    treePorts.port2.close();
    gitPorts.port2.close();
    throw error;
  }
}
