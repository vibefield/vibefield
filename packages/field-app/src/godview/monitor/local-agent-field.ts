import { useEffect, useState } from "react";
import type { AgentSessionSummary } from "./facet-types";
import type { MonitorDoor } from "./remote-door";

/**
 * THE LOCAL SOURCE (AR-3), beside `RemoteSessionField` behind the same seam —
 * and the one that replaced the mock: fieldd's fold, read through the door.
 *
 * What arrives is `agent.subscribe`'s stream — a snapshot, then FULL frames at
 * most once per PF5 tick (state transfer, never edges, so a missed frame is
 * repaired by the next one and a reconnect re-snapshots). The field keeps the
 * latest frame and nothing else: no interval, no poll, no invented rows. PF6
 * rides along for free — the subscription is opened on mount and closed on
 * unmount, and the stage that owns this hook is mounted only while the overlay
 * is open.
 *
 * The transport is the DECK'S: `door.observe` is the deck's fieldd client
 * subscribing on the monitor's behalf (EL2 — this is control, and bytes never
 * come near it). Nothing here opens a socket.
 */

/**
 * What the field knows, honestly (the tolerant-reader law's UI half).
 *
 * `no-door` is the state before a deck exists — this host has no fieldd
 * connection, or the overlay has never been opened far enough to build one.
 * It is deliberately NOT the same as `live` with zero rows: "nobody has been
 * asked" and "the daemon answered, and nothing is running" are different
 * facts, and only the second is an empty field.
 */
export type LocalFieldState = "no-door" | "live" | "unavailable";

export interface LocalAgentFieldSnapshot {
  rows: readonly AgentSessionSummary[];
  state: LocalFieldState;
  /** fieldd's own words when the subscription failed; absent while live. */
  reason?: string;
}

export const EMPTY_LOCAL_FIELD: LocalAgentFieldSnapshot = { rows: [], state: "no-door" };

/** A frame replaces everything: the daemon sends whole fields. */
export function localFieldFromFrame(rows: readonly AgentSessionSummary[]): LocalAgentFieldSnapshot {
  return { rows, state: "live" };
}

/**
 * A failed subscription withdraws the rows and says why. An unchanged state
 * with an unchanged reason returns `current` ITSELF (GT-D15.3's identity rule:
 * React bails out on the same reference, and the damage gate stays armed).
 */
export function localFieldAfterFailure(
  current: LocalAgentFieldSnapshot,
  reason: string,
): LocalAgentFieldSnapshot {
  if (current.state === "unavailable" && current.reason === reason) return current;
  return { rows: [], state: "unavailable", reason };
}

export function useLocalAgentField({
  door,
}: {
  door: MonitorDoor | null;
}): LocalAgentFieldSnapshot {
  const [snapshot, setSnapshot] = useState<LocalAgentFieldSnapshot>(EMPTY_LOCAL_FIELD);

  useEffect(() => {
    if (door === null) {
      setSnapshot(EMPTY_LOCAL_FIELD);
      return;
    }
    let alive = true;
    const dispose = door.observe({
      onFrame: (rows) => {
        if (alive) setSnapshot(localFieldFromFrame(rows));
      },
      onError: (reason) => {
        if (alive) setSnapshot((current) => localFieldAfterFailure(current, reason));
      },
    });
    return () => {
      alive = false;
      dispose();
    };
  }, [door]);

  return snapshot;
}
