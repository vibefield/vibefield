import type { FielddClient } from "@vibefield/fieldd-client";

// CP-3 — a subscription asked again after a dropped connection, the window's side. The client reconnects while the
// same fieldd stays up and replays every subscription it holds, but one refused because the socket closed under its
// ask holds none to replay: its reader asks it again once the client is `ready` again. A fieldd restart is not this
// seam: it refuses the client's token and replaces the window's document, so every reader starts again. Chat's feed
// (its field board and its queue, `chat/sparks-feed.ts`) and the window's notify carrier (`frame/needs-notices.ts`)
// ask again on it.

/** Heard each time `client` turns `ready` again: its socket closed while the same fieldd stayed up, and it reconnected
 * on the token fieldd still holds. The answer stops it. */
export function onReconnectedOver(client: FielddClient): (listener: () => void) => () => void {
  return (listener) =>
    client.onStatusChange(() => {
      if (client.status === "ready") listener();
    });
}

/** Whether fieldd may answer a subscription asked again: its refusal's own `retryable` (a FielddRpcError's). fieldd's
 * doors refuse the subscriptions asked again here only for good (a malformed or unpermitted ask, or a fieldd without
 * the door), so a retryable refusal is the connection's: the socket closed under the ask, and the client reconnected
 * (`onReconnectedOver`) is when to ask again. */
export function askAgain(refusal: unknown): boolean {
  return (
    typeof refusal === "object" &&
    refusal !== null &&
    !Array.isArray(refusal) &&
    (refusal as { readonly retryable?: unknown }).retryable === true
  );
}
