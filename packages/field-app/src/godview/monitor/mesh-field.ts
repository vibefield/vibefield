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
 * fresh open replaces everything, which is the only repair a copy gets. */
export function useMeshField({ door }: { door: MonitorDoor | null }): MeshFieldSnapshot {
  const [snapshot, setSnapshot] = useState<MeshFieldSnapshot>(EMPTY_MESH_FIELD);
  const [attempt, setAttempt] = useState(0);
  const held = useRef<MeshFieldSnapshot>(EMPTY_MESH_FIELD);

  // `attempt` is the re-subscribe signal itself: a gap bumps it, and the
  // subscription is opened afresh
  useEffect(() => {
    const publish = (next: MeshFieldSnapshot): void => {
      held.current = next;
      setSnapshot(next);
    };
    if (door === null) {
      publish(EMPTY_MESH_FIELD);
      return;
    }
    let alive = true;
    const dispose = door.observeMesh({
      onOpen: (open) => {
        if (alive) publish(meshFieldFromOpen(open));
      },
      onFrame: (frame) => {
        if (!alive) return;
        const next = meshFieldAfterFrame(held.current, frame);
        if (next === "gap") {
          // asked once: the frames still in flight on the old subscription
          // are ignored from here, and the fresh open replaces the copy
          alive = false;
          setAttempt((count) => count + 1);
          return;
        }
        publish(next);
      },
      onError: (reason) => {
        if (alive) publish(meshFieldAfterFailure(held.current, reason));
      },
    });
    return () => {
      alive = false;
      dispose();
    };
  }, [door, attempt]);

  return snapshot;
}
