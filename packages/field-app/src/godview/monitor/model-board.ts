import type {
  DeviceOs,
  MonitorAgentRow,
  MonitorModelChange,
  MonitorModelSnapshot,
} from "@vibecook/puppeteer-view-sdk/model";
import type {
  AgentModelBoardRow,
  AgentModelMeshFrame,
  AgentModelMeshOpen,
  RowsDelta,
  RowsDeviceState,
  RowsSnapshot,
  MonitorAgentRow as WireMonitorRow,
} from "@vibefield/contracts";

/**
 * MV-3a (MV-D18, M3, M23) — THE MODEL BOARD, FOLDED INTO ONE CHAIN.
 *
 * The window's one door (`agent.subscribe {projection: "model", scope:
 * "mesh"}`) answers every self desktop's board, each on its OWN revision chain
 * as its owner numbered it (DS-D4: fieldd multiplexes, it never re-folds). The
 * replica wants ONE chain of `MonitorModelChange`s. This fold is the join, and
 * nothing more (M3): a device's snapshot becomes upserts plus the removals of
 * that device's ids that are gone; a device's delta becomes upserts and
 * removals mapped from the board's keys to the model's ids; a device going
 * silent keeps its rows (DS-L8 — asleep is a state, not an absence); a delta
 * the fold cannot follow is a GAP, and the caller re-subscribes (M23: the open
 * replaces everything). No business fact is derived here — every row is the
 * backend's `monitorRow`, read as the contract says, with the one
 * reader-relative fact joined: `device.self`.
 */

/** A desktop as the board stands it: its state and when that was established. */
export interface ModelBoardDevice {
  device: string;
  state: RowsDeviceState;
  /** ISO-8601 */
  asOf: string;
}

/**
 * MV-3b — one row as the fold holds it: the model's row the replica applies,
 * and the BOARD row it rode in on, kept beside it for the window's own joins.
 * The model carries no pane join by design (a view never looks a pane up); the
 * board row does — a terminal row's `terminal.runtimeSessionId` (G3), a desk
 * row's `terminal` and `runtimeRunId` — and that is what lets the window map
 * its panes, its spawn answers and fieldd's history (keyed by run) onto model
 * ids without deriving a business fact. Every row the fold has heard is here,
 * the ones the replica hides included (`alive: false`, M3).
 */
export interface HeldModelRow {
  readonly device: string;
  readonly board: AgentModelBoardRow;
  readonly row: MonitorAgentRow;
}

interface HeldDevice {
  state: RowsDeviceState;
  asOf: string;
  /** the owner's chain; absent until its board has answered */
  epoch?: string | undefined;
  revision?: number | undefined;
  /** the model id each board key (`runtimeRunId`) stands for */
  idByKey: Map<string, string>;
}

const SDK_OS = new Set<string>(["mac", "windows", "linux", "ios", "android"]);

/** The wire row as the SDK's row, with the reader's one fact joined. The wire
 * mirrors the SDK field for field (fieldd parses real backend rows through the
 * contract); the OS mark is kept only when it is one of the SDK's words. */
export function modelRowFrom(wire: WireMonitorRow, here: string | undefined): MonitorAgentRow {
  const { os, ...device } = wire.device;
  const marked = os !== undefined && SDK_OS.has(os) ? (os as DeviceOs) : undefined;
  return {
    ...wire,
    device: {
      ...device,
      ...(marked !== undefined ? { os: marked } : {}),
      self: device.id === here,
    },
  } as unknown as MonitorAgentRow;
}

/** The model row a board row carries, or none (a desk row from an older daemon). */
export function monitorRowOf(row: AgentModelBoardRow): WireMonitorRow | undefined {
  return row.monitorRow;
}

export class ModelBoardFold {
  #revision = 0;
  #here: string | undefined;
  readonly #devices = new Map<string, HeldDevice>();
  readonly #held = new Map<string, HeldModelRow>();

  /** The answering desktop: fieldd lists itself first (`AgentMeshOpen`). */
  get here(): string | undefined {
    return this.#here;
  }

  get revision(): number {
    return this.#revision;
  }

  /** A row the fold holds, by model id — hidden or shown — with its board row. */
  held(id: string): HeldModelRow | undefined {
    return this.#held.get(id);
  }

  /** Every row the fold holds, this desktop's first and then by device order. */
  heldRows(): readonly HeldModelRow[] {
    return [...this.#held.values()];
  }

  /** Every desktop the board lists, in the board's order. */
  devices(): ModelBoardDevice[] {
    return [...this.#devices.entries()].map(([device, held]) => ({
      device,
      state: held.state,
      asOf: held.asOf,
    }));
  }

  /** The open — and every re-snapshot — replaces everything held (M23). */
  open(open: AgentModelMeshOpen): MonitorModelSnapshot {
    this.#devices.clear();
    this.#held.clear();
    this.#here = open.devices[0]?.device;
    for (const entry of open.devices) {
      const held: HeldDevice = { state: entry.state, asOf: entry.asOf, idByKey: new Map() };
      this.#devices.set(entry.device, held);
      if (entry.snapshot !== undefined) this.#replaceBoard(entry.device, held, entry.snapshot);
    }
    this.#revision += 1;
    return { revision: this.#revision, rows: this.#ordered() };
  }

  /**
   * One per-device frame. A device's snapshot replaces that device's rows; a
   * delta applies on its owner's chain or is a GAP; a state change keeps the
   * rows (DS-L8) and moves nothing in the model.
   */
  frame(frame: AgentModelMeshFrame): MonitorModelChange | "gap" | null {
    const held = this.#devices.get(frame.device);
    if ("state" in frame) {
      if (held === undefined) {
        this.#devices.set(frame.device, {
          state: frame.state,
          asOf: frame.asOf,
          idByKey: new Map(),
        });
      } else {
        held.state = frame.state;
        held.asOf = frame.asOf;
      }
      return null;
    }
    if ("snapshot" in frame) {
      const target: HeldDevice = held ?? {
        state: "live",
        asOf: new Date().toISOString(),
        idByKey: new Map(),
      };
      if (held === undefined) this.#devices.set(frame.device, target);
      const before = new Set(target.idByKey.values());
      const upserts = this.#replaceBoard(frame.device, target, frame.snapshot);
      const removed = [...before].filter((id) => !target.idByKey.has(this.#keyOf(target, id)));
      return this.#change(upserts, removed);
    }
    const delta = frame.delta;
    if (
      held === undefined ||
      held.epoch === undefined ||
      delta.epoch !== held.epoch ||
      delta.since !== held.revision
    ) {
      return "gap";
    }
    const upserts: MonitorAgentRow[] = [];
    const removed: string[] = [];
    for (const row of delta.upserts) {
      const previous = held.idByKey.get(row.runtimeRunId);
      const wire = monitorRowOf(row);
      if (wire === undefined) {
        // an owner with no model row for this key (an older daemon): the key
        // stands for nothing now
        if (previous !== undefined) {
          held.idByKey.delete(row.runtimeRunId);
          this.#held.delete(previous);
          removed.push(previous);
        }
        continue;
      }
      const next = modelRowFrom(wire, this.#here);
      if (previous !== undefined && previous !== next.id) {
        this.#held.delete(previous);
        removed.push(previous);
      }
      held.idByKey.set(row.runtimeRunId, next.id);
      this.#held.set(next.id, { device: frame.device, board: row, row: next });
      upserts.push(next);
    }
    for (const key of delta.removed) {
      const id = held.idByKey.get(key);
      if (id === undefined) continue;
      held.idByKey.delete(key);
      this.#held.delete(id);
      removed.push(id);
    }
    held.revision = delta.revision;
    return this.#change(upserts, removed);
  }

  /** A device's board, whole: its rows replace that device's; the upserts. */
  #replaceBoard(
    device: string,
    held: HeldDevice,
    snapshot: RowsSnapshot<AgentModelBoardRow>,
  ): MonitorAgentRow[] {
    for (const id of held.idByKey.values()) this.#held.delete(id);
    held.idByKey = new Map();
    held.epoch = snapshot.epoch;
    held.revision = snapshot.revision;
    const upserts: MonitorAgentRow[] = [];
    for (const row of snapshot.rows) {
      const wire = monitorRowOf(row);
      if (wire === undefined) continue;
      const next = modelRowFrom(wire, this.#here);
      held.idByKey.set(row.runtimeRunId, next.id);
      this.#held.set(next.id, { device, board: row, row: next });
      upserts.push(next);
    }
    return upserts;
  }

  #keyOf(held: HeldDevice, id: string): string {
    for (const [key, candidate] of held.idByKey) if (candidate === id) return key;
    return id;
  }

  #change(upserts: MonitorAgentRow[], removed: string[]): MonitorModelChange | null {
    if (upserts.length === 0 && removed.length === 0) return null;
    const since = this.#revision;
    this.#revision += 1;
    return { since, revision: this.#revision, upserts, removed };
  }

  /** Every row the fold holds, this desktop's first and then by device order;
   * the replica sorts by the contract's own rule. */
  #ordered(): MonitorAgentRow[] {
    return [...this.#held.values()].map((held) => held.row);
  }
}

export type { RowsDelta };
