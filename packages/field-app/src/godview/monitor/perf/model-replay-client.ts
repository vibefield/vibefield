import type {
  AgentModelBoardRow,
  AgentModelMeshFrame,
  AgentModelMeshOpen,
  RowsDeviceState,
} from "@vibefield/contracts";
import type { DoorClient } from "../doors";

// THE MODEL REPLAY CLIENT (MV-3c, build-mv M30) — the B side of the paired
// harness: a `DoorClient` whose model board (`agent.subscribe {projection:
// "model", …}`) is answered from a model stream (`model-stream.ts`) instead of
// fieldd, so the window adapter (`createGodviewMonitorFeed`: `ModelBoardFold`,
// the replica) and every view behind it run exactly as they run live, on
// recorded answers. Every other call goes to the REAL client when there is one,
// as the replay door does for the fold's half (`replay-door.ts`).
//
// It holds what it delivered, folded per desktop like the relay holds it, so a
// feed that subscribes late — or asks again after a gap — is answered with the
// board as it stands, never with an open that is minutes stale. A report of the
// active pane (`agent.reportShown`) is acknowledged here: a replay has no
// backend to clear an unread mark in.

/** Cumulative over the renderer's life; a reader takes differences. */
export interface ModelReplayStats {
  /** model-board subscriptions asked (a feed's open, and each re-ask) */
  subscribes: number;
  opens: number;
  frames: number;
  reports: number;
}

export interface ModelReplayClient extends DoorClient {
  /** A whole board: every subscriber REPLACES what it held (a `.snapshot`). */
  deliverOpen(open: AgentModelMeshOpen): void;
  /** One device's frame (a `.delta`). */
  deliverFrame(frame: AgentModelMeshFrame): void;
  /** The client every other call goes to (the deck's own; null refuses). */
  setReal(real: DoorClient | null): void;
  /** Model-board subscribers standing right now. */
  listeners(): number;
  stats(): ModelReplayStats;
  /** The board as delivered so far, composed as an open. */
  current(): AgentModelMeshOpen;
  /** Forget the board (a new stream is about to play). */
  reset(): void;
}

interface HeldDevice {
  state: RowsDeviceState;
  asOf: string;
  board?: { epoch: string; revision: number; rows: Map<string, AgentModelBoardRow> };
}

type FrameListener = (payload: unknown, kind?: "snapshot" | "delta") => void;

export function createModelReplayClient(
  options: { real?: DoorClient | null } = {},
): ModelReplayClient {
  let real = options.real ?? null;
  const listeners = new Set<FrameListener>();
  const devices = new Map<string, HeldDevice>();
  const stats: ModelReplayStats = { subscribes: 0, opens: 0, frames: 0, reports: 0 };

  const current = (): AgentModelMeshOpen => ({
    devices: [...devices.entries()].map(([device, held]) => ({
      device,
      state: held.state,
      asOf: held.asOf,
      ...(held.board !== undefined
        ? {
            snapshot: {
              epoch: held.board.epoch,
              revision: held.board.revision,
              rows: [...held.board.rows.values()],
            },
          }
        : {}),
    })),
  });

  const broadcast = (payload: unknown, kind: "snapshot" | "delta"): void => {
    for (const listener of [...listeners]) listener(payload, kind);
  };

  return {
    async request(method, params) {
      if (method === "agent.reportShown") {
        stats.reports += 1;
        return { reported: true };
      }
      if (real === null) throw new Error(`replay: no daemon answers ${method} here`);
      return await real.request(method, params);
    },
    async subscribe(method, params, onFrame, opts) {
      if (method === "agent.subscribe" && params["projection"] === "model") {
        stats.subscribes += 1;
        const listener: FrameListener = (payload, kind) => onFrame(payload, kind);
        listeners.add(listener);
        return {
          snapshot: current(),
          unsubscribe: () => {
            listeners.delete(listener);
          },
        };
      }
      if (real === null) throw new Error(`replay: no daemon answers ${method} here`);
      return await real.subscribe(method, params, onFrame, opts);
    },
    deliverOpen(open) {
      stats.opens += 1;
      devices.clear();
      for (const entry of open.devices) {
        devices.set(entry.device, {
          state: entry.state,
          asOf: entry.asOf,
          ...(entry.snapshot !== undefined
            ? {
                board: {
                  epoch: entry.snapshot.epoch,
                  revision: entry.snapshot.revision,
                  rows: new Map(entry.snapshot.rows.map((row) => [row.runtimeRunId, row])),
                },
              }
            : {}),
        });
      }
      broadcast(open, "snapshot");
    },
    deliverFrame(frame) {
      stats.frames += 1;
      const held = devices.get(frame.device);
      if ("state" in frame) {
        if (held === undefined) devices.set(frame.device, { state: frame.state, asOf: frame.asOf });
        else {
          held.state = frame.state;
          held.asOf = frame.asOf;
        }
      } else if ("snapshot" in frame) {
        const board = {
          epoch: frame.snapshot.epoch,
          revision: frame.snapshot.revision,
          rows: new Map(frame.snapshot.rows.map((row) => [row.runtimeRunId, row])),
        };
        if (held === undefined) {
          devices.set(frame.device, { state: "live", asOf: new Date().toISOString(), board });
        } else held.board = board;
      } else if (held?.board !== undefined) {
        const board = held.board;
        for (const row of frame.delta.upserts) board.rows.set(row.runtimeRunId, row);
        for (const key of frame.delta.removed) board.rows.delete(key);
        board.revision = frame.delta.revision;
      }
      broadcast(frame, "delta");
    },
    setReal(next) {
      real = next;
    },
    listeners: () => listeners.size,
    stats: () => ({ ...stats }),
    current,
    reset() {
      devices.clear();
    },
  };
}
