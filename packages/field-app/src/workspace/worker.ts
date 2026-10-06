import { WorkspaceOpenTicketResult } from "@vibefield/contracts";
import { openWorkspaceRelay } from "./relay";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
let current: Awaited<ReturnType<typeof openWorkspaceRelay>> | null = null;
let revision = 0;
scope.onmessage = (event) => {
  const id = ++revision;
  current?.dispose();
  current = null;
  if (event.data?.type === "close") return;
  const ticket = WorkspaceOpenTicketResult.safeParse(event.data?.ticket);
  if (event.data?.type !== "attach" || !ticket.success) {
    scope.postMessage({ type: "error", message: "The files ticket did not parse" });
    return;
  }
  void openWorkspaceRelay(ticket.data, () => {
    if (revision === id) scope.postMessage({ type: "closed" });
  }).then(
    (connection) => {
      if (revision !== id) {
        connection.dispose();
        return;
      }
      current = connection;
      scope.postMessage(
        { type: "ports", treePort: connection.treePort, gitPort: connection.gitPort },
        [connection.treePort, connection.gitPort],
      );
    },
    (error: unknown) => {
      if (revision === id)
        scope.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : "The files connection could not open",
        });
    },
  );
};
