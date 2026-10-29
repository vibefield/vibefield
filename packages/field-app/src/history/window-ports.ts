import { copyWords } from "../frame/cards/copy-door";
import { getHost } from "../host";
import { terminalBootstrapHome } from "../terminal/pool";
import {
  type HistoryDoorClient,
  type HistoryPorts,
  type HistoryPortsOptions,
  historyPortsOver,
} from "./doors";

// ONE SET OF HISTORY'S PORTS PER WINDOW (PJ-4; lane room's finding 1). The
// room's ports used to be History's own; since the Peek draws the room's
// reader (PK3) beside History's room, both read the SAME ports — one catalog
// (one meta feed, `catalogPortOver`'s sharing), one session port (one lease per
// session, one grant), one asset source. Held per fieldd client: a new client
// (a test's, a window's reconnect to another daemon) lets go of the old ports.
// A module store, as `open-at.ts` is: History sits in the cover and the Peek in
// the frame, and neither owns the other.

let held: { client: HistoryDoorClient; ports: HistoryPorts } | null = null;

/** The window's History ports over `client`, made once (`options` is read
 * only when they are made). */
export function windowHistoryPorts(
  client: HistoryDoorClient,
  options: () => HistoryPortsOptions,
): HistoryPorts {
  if (held !== null && held.client === client) return held.ports;
  held?.ports.dispose();
  held = { client, ports: historyPortsOver(client, options()) };
  return held.ports;
}

/** HN-5 — a copy History's room makes through its workspace port (a file's path, from its
 * room or the Peek's reader of it) is a copy like any other: on the system clipboard through
 * the one copy door, then a text card in the hand (DESIGN.md §8 "The hand"). No button's box
 * reaches the port, so the card rises into its place, and it says History, where it came
 * from. A refusal rejects in its words, which the room says as the file action's failure. */
export async function copyFromHistory(text: string): Promise<void> {
  const copied = await copyWords(text, { view: "history", how: "copy" }, null);
  if (!copied.ok) throw new Error(copied.reason);
}

/** The product's ports for this window: the platform from the preload, the
 * home from the window's bootstrap (AR-8 L2), its copies the copy door's. */
export function productHistoryPorts(client: HistoryDoorClient): HistoryPorts {
  return windowHistoryPorts(client, () => ({
    platform: getHost().platform ?? null,
    home: terminalBootstrapHome(),
    workspace: { copyText: copyFromHistory },
  }));
}

/** Test seam: let go of the window's ports. */
export function resetWindowHistoryPortsForTest(): void {
  held?.ports.dispose();
  held = null;
}
