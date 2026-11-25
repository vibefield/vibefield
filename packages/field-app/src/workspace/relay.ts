import { connectWebSocketChannel, relayExplorerChannel } from "@vibecook/mille/remote";
import {
  WORKSPACE_LIMITS,
  WorkspaceGitOpened,
  WorkspaceGitPortRequest,
  WorkspaceGitPortResponse,
  type WorkspaceOpenTicketResult,
} from "@vibefield/contracts";

/** What a paused relay answers an ask the room makes on its timer. The room keeps its last good answer when a
 * read fails and asks again at its next tick, so this is never shown. */
export const WORKSPACE_GIT_PAUSED = "paused";

export interface WorkspaceRelay {
  treePort: MessagePort;
  gitPort: MessagePort;
  dispose: () => void;
  /** History QA (2026-11-24): while paused (History is not the view showing, or the window is hidden) the asks
   * the room makes on its timer are answered here and never reach the files worker. */
  setPaused: (paused: boolean) => void;
}

/** The room's git asks on their way to the files worker (`createGitAskRelay`). */
export interface GitAskRelay {
  /** An ask from the room. `send` puts one on the socket and says whether it could; false back means the
   * connection must end (the ask could not be sent). */
  ask(
    request: WorkspaceGitPortRequest,
    send: (request: WorkspaceGitPortRequest) => boolean,
  ): boolean;
  /** An answer from the files worker. */
  answer(response: WorkspaceGitPortResponse): void;
  setPaused(paused: boolean): void;
}

/**
 * History QA (2026-11-24) — the room's pane asks `branch`, `status` and `log` every four seconds without waiting
 * for the last answers, and the files worker ends a connection with more than `GIT_REQUESTS_IN_FLIGHT` asks open:
 * a repository slower than two ticks would have had its pane torn down and attached again, over and over. So an
 * ask with no arguments (the timed reads: one answer serves every asker) that is already in flight is JOINED: one
 * request crosses, and its answer goes to each asker under their own id. And while paused those asks are answered
 * here, `WORKSPACE_GIT_PAUSED`, and never cross. An ask with arguments (a diff, a commit's files) is a person's
 * and always crosses.
 */
export function createGitAskRelay(post: (response: WorkspaceGitPortResponse) => void): GitAskRelay {
  // the timed asks in flight, by op: who leads, and who joined
  const flights = new Map<string, { lead: number; joined: number[] }>();
  let paused = false;
  return {
    ask(request, send) {
      const timed = request.args === undefined;
      if (timed && paused) {
        post({ id: request.id, ok: false, error: WORKSPACE_GIT_PAUSED });
        return true;
      }
      const flight = timed ? flights.get(request.op) : undefined;
      if (flight !== undefined) {
        flight.joined.push(request.id);
        return true;
      }
      if (!send(request)) return false;
      if (timed) flights.set(request.op, { lead: request.id, joined: [] });
      return true;
    },
    answer(response) {
      post(response);
      for (const [op, flight] of flights) {
        if (flight.lead !== response.id) continue;
        flights.delete(op);
        for (const id of flight.joined) post({ ...response, id });
        return;
      }
    },
    setPaused(next) {
      paused = next;
    },
  };
}

/** Runs in the window's Worker; the room receives only two MessagePorts. */
export async function openWorkspaceRelay(
  ticket: WorkspaceOpenTicketResult,
  onClosed: () => void,
  WebSocketImpl: typeof WebSocket = WebSocket,
): Promise<WorkspaceRelay> {
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
  const asks = createGitAskRelay((response) => gitPorts.port1.postMessage(response));
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
      const crossed = asks.ask(request.data, (ask) => {
        const encoded = JSON.stringify(ask);
        if (
          new TextEncoder().encode(encoded).byteLength > WORKSPACE_LIMITS.GIT_REQUEST_BYTES ||
          git.bufferedAmount > WORKSPACE_LIMITS.SOCKET_BUFFER_BYTES
        )
          return false;
        git.send(encoded);
        return true;
      });
      if (!crossed) finish();
    };
    git.addEventListener("message", (event: MessageEvent) => {
      try {
        const response = WorkspaceGitPortResponse.safeParse(JSON.parse(String(event.data)));
        if (!response.success) {
          finish();
          return;
        }
        asks.answer(response.data);
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
      setPaused: (paused: boolean) => asks.setPaused(paused),
    };
  } catch (error) {
    finish();
    treePorts.port2.close();
    gitPorts.port2.close();
    throw error;
  }
}
