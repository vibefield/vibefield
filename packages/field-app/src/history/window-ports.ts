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

/** Test seam: let go of the window's ports. */
export function resetWindowHistoryPortsForTest(): void {
  held?.ports.dispose();
  held = null;
}
