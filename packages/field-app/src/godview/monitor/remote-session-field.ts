import type { RemoteHostSummary } from "@vibecook/ghosttea-protocol";
import { useEffect, useRef, useState } from "react";
import { type RemoteSessionDoor, type RemoteSessionRow, remoteSessionRows } from "./remote-door";

/**
 * THE REAL SOURCE (GT-D17), beside `MockAgentField` behind the same seam.
 *
 * `MockAgentField` invents a field; this one asks the mesh for one. Both answer
 * in records the projection turns into `MonitorAgent[]`, and `useMonitorAgents`
 * composes them — which is the whole shape of the honesty split: two sources,
 * two claims, one stage.
 *
 * The transport is the DECK'S: `door.listHosts()` is `runtime.listRemoteHosts()`
 * over the control channel the panes already ride (EL2 — this is control, and
 * bytes never come near it). Nothing here opens a socket, and there is no
 * second connection to the floor anywhere in this file.
 *
 * PF6 rides along for free: the interval belongs to the stage, and the stage
 * exists only while the overlay is open.
 */

/** Upstream's own remote-palette cadence (2s), kept deliberately: this asks the
 * same daemon the same question, and inventing a different number would only
 * mean two answers to "how fresh is the mesh". */
export const REMOTE_POLL_MS = 2_000;

/**
 * How many consecutive failed asks it takes to stop believing the last answer.
 *
 * One failure is a round trip, not a verdict — a peer list does not become
 * false because one request timed out, and dropping every bubble on a single
 * hiccup would make the stage flicker on a healthy mesh. Two in a row is a
 * standing condition, and standing conditions are told the truth about: the
 * rows leave and the state says UNAVAILABLE with the reason it was given.
 */
export const REMOTE_FAILURE_TOLERANCE = 2;

/**
 * What the field knows, honestly (the tolerant-reader law's UI half).
 *
 * `no-door` is the state before a deck exists — this host has no bridge, or the
 * overlay has never been opened far enough to build one. It is deliberately NOT
 * the same as `serving` with zero rows: "nobody has been asked" and "the mesh
 * answered, and it is empty" are different facts, and only the second is an
 * empty mesh.
 */
export type RemoteFieldState = "no-door" | "serving" | "unavailable";

export interface RemoteSessionFieldSnapshot {
  rows: readonly RemoteSessionRow[];
  /** Online peers the last good answer named. */
  hosts: number;
  state: RemoteFieldState;
  /** The floor's own words when the ask failed; absent while serving. */
  reason?: string;
  /** Bookkeeping for the tolerance rule above, carried on the snapshot so the
   * rule is a pure function of it and can be tested without a clock. */
  failures: number;
}

export const EMPTY_REMOTE_FIELD: RemoteSessionFieldSnapshot = {
  rows: [],
  hosts: 0,
  state: "no-door",
  failures: 0,
};

/** A good answer replaces everything, including the failure count. */
export function remoteFieldFromHosts(
  hosts: readonly RemoteHostSummary[],
): RemoteSessionFieldSnapshot {
  return {
    rows: remoteSessionRows(hosts),
    hosts: hosts.filter((host) => host.online).length,
    state: "serving",
    failures: 0,
  };
}

/**
 * A failed ask, per the tolerance rule.
 *
 * IDENTITY IS PART OF THE ANSWER (GT-D15.3, and the code review's finding 8). A
 * floor serving no mesh REFUSES this call — the default on a stock machine,
 * where the flag is off — so this runs every 2s forever. Minting a fresh object
 * each time was a new snapshot, a new agents array, a re-render of every view
 * and an `updateAgents` posted to the swarm, twice a minute for the life of the
 * open overlay, all to say a thing that had not changed. An unchanged state
 * with an unchanged reason therefore returns `current` ITSELF: React bails out
 * on the same reference, and the damage gate above stays armed.
 *
 * The failure counter stops climbing with it, deliberately. Once the rows are
 * withdrawn the count has nothing left to decide, and a number that only ever
 * grew would be the one field keeping the object churning.
 */
export function remoteFieldAfterFailure(
  current: RemoteSessionFieldSnapshot,
  reason: string,
): RemoteSessionFieldSnapshot {
  if (current.state === "unavailable" && current.reason === reason) return current;
  const failures = current.failures + 1;
  if (failures < REMOTE_FAILURE_TOLERANCE && current.state === "serving") {
    // Still believed: the rows stand, and the count remembers that they are one
    // failure short of being withdrawn.
    return { ...current, failures };
  }
  return { rows: [], hosts: 0, state: "unavailable", reason, failures };
}

export interface UseRemoteSessionFieldOptions {
  door: RemoteSessionDoor | null;
  /** Test seam. Product code takes the constant. */
  pollMs?: number;
}

export function useRemoteSessionField({
  door,
  pollMs = REMOTE_POLL_MS,
}: UseRemoteSessionFieldOptions): RemoteSessionFieldSnapshot {
  const [snapshot, setSnapshot] = useState<RemoteSessionFieldSnapshot>(EMPTY_REMOTE_FIELD);
  /** In-flight guard. A slow mesh must not stack asks behind itself — upstream's
   * palette holds the same latch for the same reason. */
  const asking = useRef(false);

  useEffect(() => {
    if (door === null) {
      setSnapshot(EMPTY_REMOTE_FIELD);
      return;
    }
    let alive = true;
    const ask = async (): Promise<void> => {
      if (asking.current) return;
      asking.current = true;
      try {
        const hosts = await door.listHosts();
        if (alive) setSnapshot(remoteFieldFromHosts(hosts));
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        // A floor with no mesh REFUSES this call, and that is the ordinary
        // state on a machine whose mesh flag is off. It is a state, not an
        // incident: no log line per tick, and the stage says UNAVAILABLE with
        // this reason in its own chip (`remoteUnavailableClaim`) — which it did
        // NOT do until GT-5c, so a mesh that was ON with the gateway down drew
        // exactly what a healthy empty mesh draws.
        if (alive) setSnapshot((current) => remoteFieldAfterFailure(current, reason));
      } finally {
        asking.current = false;
      }
    };
    void ask();
    const timer = window.setInterval(() => void ask(), pollMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [door, pollMs]);

  return snapshot;
}
