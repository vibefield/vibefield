import type {
  AgentFieldRow,
  AgentMeshFrame,
  AgentMeshOpen,
  RowsDeviceState,
} from "@vibefield/contracts";
import { useEffect, useRef, useState } from "react";
import type { MonitorDoor } from "./remote-door";

/**
 * DS-3 — THE MESH BOARD, READ (DS-D4; it replaced GT-D17's two-second host
 * poll, `remote-session-field.ts`, retired 2026-09-30).
 *
 * The window holds ONE door to its own fieldd, and through it every self
 * desktop's agents (DS-L4): `agent.subscribe {projection: "desk", scope:
 * "mesh"}`. fieldd multiplexes — each desktop's board arrives on its OWN chain,
 * numbered by its owner — so the reader keeps one copy per device and applies
 * each device's frames to that copy alone:
 *
 *   · the open (and the client's re-snapshot after a reconnect) REPLACES
 *     everything held;
 *   · `{device, snapshot}` replaces that device's copy and nothing else;
 *   · `{device, delta}` applies on top of that device's chain — a delta whose
 *     epoch or `since` is not where the copy is, is a GAP: the reader cannot
 *     follow it, so it asks again (re-subscribes) rather than repairing
 *     (DS-L3);
 *   · `{device, state, asOf}` moves the state and never the board: a desktop
 *     that falls asleep keeps its last board, which the stage draws greyed
 *     (DS-L8 — asleep is a state, not an absence).
 *
 * Nothing here dials: the transport is the deck's (`door.observeMesh`), and
 * the subscription lives exactly as long as the stage that holds this hook
 * (PF6).
 *
 * S4 (2026-10-01) — the reader heals itself, as the poll it replaced did. A
 * failure that may heal (fieldd's retryable "the mesh board is not ready yet",
 * a socket that dropped while the board was being asked, a replay refused
 * after a reconnect) keeps the honest `unavailable` on screen and asks again
 * after 250 ms, doubling to 8 s; a refusal no second ask can change stays put
 * with its reason; a frame that cannot be read is a gap. It used to re-open
 * only on a gap, so one failed open left "mesh unavailable" until the stage
 * was reopened.
 */

/** One device as the reader holds it. */
export interface MeshDeviceBoard {
  device: string;
  state: RowsDeviceState;
  /** ISO-8601 — when the state was established */
  asOf: string;
  /** the owner's board once it has answered: its chain, and its rows by run */
  board?: {
    epoch: string;
    revision: number;
    rows: ReadonlyMap<string, AgentFieldRow>;
  };
}

/**
 * What the field knows, honestly. `serving` = the board answered (an empty
 * board then means no desktop is running anything); `unavailable` = it could
 * not be opened, with fieldd's own reason; `no-door` = nobody was asked. The
 * words are the marker's (`GodviewMonitorFacts.remoteState`), kept from the
 * poll so a harness reading them did not have to learn new ones.
 */
export type MeshFieldState = "no-door" | "serving" | "unavailable";

export interface MeshFieldSnapshot {
  /** in the board's own order: the answering desktop first (fieldd lists
   * itself first), then the others as the roster ordered them */
  devices: ReadonlyMap<string, MeshDeviceBoard>;
  state: MeshFieldState;
  /** fieldd's own words, while unavailable */
  reason?: string;
}

export const EMPTY_MESH_FIELD: MeshFieldSnapshot = { devices: new Map(), state: "no-door" };

/** S4 — the re-ask backoff after a failure that may heal: 250 ms, doubling,
 * capped at 8 s; reset by the next board that answers. */
export const MESH_RETRY_MIN_MS = 250;
export const MESH_RETRY_MAX_MS = 8_000;

export function meshRetryDelay(failures: number): number {
  return Math.min(MESH_RETRY_MIN_MS * 2 ** failures, MESH_RETRY_MAX_MS);
}

const byRun = (rows: readonly AgentFieldRow[]): ReadonlyMap<string, AgentFieldRow> =>
  new Map(rows.map((row) => [row.runtimeRunId, row]));

/** The open — and every re-snapshot — replaces everything held. */
export function meshFieldFromOpen(open: AgentMeshOpen): MeshFieldSnapshot {
  const devices = new Map<string, MeshDeviceBoard>();
  for (const entry of open.devices) {
    devices.set(entry.device, {
      device: entry.device,
      state: entry.state,
      asOf: entry.asOf,
      ...(entry.snapshot !== undefined
        ? {
            board: {
              epoch: entry.snapshot.epoch,
              revision: entry.snapshot.revision,
              rows: byRun(entry.snapshot.rows),
            },
          }
        : {}),
    });
  }
  return { devices, state: "serving" };
}

/**
 * One per-device frame, applied. Answers `"gap"` when a delta does not
 * continue the chain the reader holds for its device — the one case the
 * reader cannot answer itself, and the caller re-subscribes. A device the
 * reader has not met (a desktop that joined the roster after the open) is
 * added on its first frame.
 */
export function meshFieldAfterFrame(
  current: MeshFieldSnapshot,
  frame: AgentMeshFrame,
): MeshFieldSnapshot | "gap" {
  const held = current.devices.get(frame.device);
  let next: MeshDeviceBoard;
  if ("state" in frame) {
    next =
      held === undefined
        ? { device: frame.device, state: frame.state, asOf: frame.asOf }
        : { ...held, state: frame.state, asOf: frame.asOf };
  } else if ("snapshot" in frame) {
    next = {
      device: frame.device,
      // a reset with no state frame before it can only come from a desktop
      // that is answering: it is live until the board says otherwise
      state: held?.state ?? "live",
      asOf: held?.asOf ?? new Date().toISOString(),
      board: {
        epoch: frame.snapshot.epoch,
        revision: frame.snapshot.revision,
        rows: byRun(frame.snapshot.rows),
      },
    };
  } else {
    const board = held?.board;
    const delta = frame.delta;
    if (
      held === undefined ||
      board === undefined ||
      delta.epoch !== board.epoch ||
      delta.since !== board.revision
    ) {
      return "gap";
    }
    const rows = new Map(board.rows);
    for (const row of delta.upserts) rows.set(row.runtimeRunId, row);
    for (const id of delta.removed) rows.delete(id);
    next = { ...held, board: { epoch: board.epoch, revision: delta.revision, rows } };
  }
  const devices = new Map(current.devices);
  devices.set(frame.device, next);
  return { ...current, devices };
}

/** A board that could not be opened withdraws what it held and says why. An
 * unchanged state with an unchanged reason returns `current` ITSELF (GT-D15.3's
 * identity rule: React bails out on the same reference). */
export function meshFieldAfterFailure(
  current: MeshFieldSnapshot,
  reason: string,
): MeshFieldSnapshot {
  if (current.state === "unavailable" && current.reason === reason) return current;
  return { devices: new Map(), state: "unavailable", reason };
}

/** The mesh board while the stage holds a door. A gap re-subscribes — the
 * fresh open replaces everything, which is the only repair a copy gets — and a
 * failure that may heal re-subscribes on the backoff (S4). */
export function useMeshField({ door }: { door: MonitorDoor | null }): MeshFieldSnapshot {
  const [snapshot, setSnapshot] = useState<MeshFieldSnapshot>(EMPTY_MESH_FIELD);
  const [attempt, setAttempt] = useState(0);
  const held = useRef<MeshFieldSnapshot>(EMPTY_MESH_FIELD);
  /** failures since a board last answered on this door — the backoff's exponent */
  const failures = useRef({ door: null as MonitorDoor | null, count: 0 });

  // `attempt` is the re-subscribe signal itself: a gap bumps it at once, a
  // failure that may heal after the backoff, and the board is opened afresh
  useEffect(() => {
    const publish = (next: MeshFieldSnapshot): void => {
      held.current = next;
      setSnapshot(next);
    };
    if (failures.current.door !== door) failures.current = { door, count: 0 };
    if (door === null) {
      publish(EMPTY_MESH_FIELD);
      return;
    }
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    /** ask again, once: the frames still in flight on this subscription are
     * ignored from here, and the fresh open replaces the copy */
    const reopen = (): void => {
      alive = false;
      setAttempt((count) => count + 1);
    };
    const dispose = door.observeMesh({
      onOpen: (open) => {
        if (!alive) return;
        failures.current.count = 0;
        publish(meshFieldFromOpen(open));
      },
      onFrame: (frame) => {
        if (!alive) return;
        const next = meshFieldAfterFrame(held.current, frame);
        if (next === "gap") {
          reopen();
          return;
        }
        publish(next);
      },
      onError: (failure) => {
        if (!alive) return;
        // a frame the reader cannot read is one its copy cannot follow: a gap
        if (failure.frame === true) {
          reopen();
          return;
        }
        publish(meshFieldAfterFailure(held.current, failure.reason));
        if (!failure.retryable) return; // a refusal no second ask changes: the reason stands
        // the honest `unavailable` stays on screen while the reader waits
        alive = false;
        const delay = meshRetryDelay(failures.current.count);
        failures.current.count += 1;
        retry = setTimeout(() => {
          retry = null;
          setAttempt((count) => count + 1);
        }, delay);
      },
    });
    return () => {
      alive = false;
      if (retry !== null) clearTimeout(retry);
      dispose();
    };
  }, [door, attempt]);

  return snapshot;
}
