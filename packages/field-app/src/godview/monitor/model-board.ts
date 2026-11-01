import type {
  AgentDeskTerminalRow,
  AgentModelDeskRow,
  AgentModelMeshFrame,
  AgentModelMeshOpen,
  AgentModelMeshRow,
  RowsDelta,
  RowsDeviceState,
  RowsSnapshot,
  MonitorAgentRow as WireMonitorRow,
} from "@vibefield/contracts";
import type {
  DeviceOs,
  MonitorAgentRow,
  MonitorModelChange,
  MonitorModelSnapshot,
} from "@vibefield/puppeteer-view-sdk/model";

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
 *
 * MV-3d (M35, M19) — the fold also keeps THIS desktop's run rows whole, beside
 * the model and never in it: every run row of the answering desktop's board,
 * assembled by the backend or not, with the chrome's facts it rode in with
 * (`local`). That is what the window's chrome reads — the deck's pane frames,
 * the find sheet, the AR-7 marker — now that the fold's `full` board is no
 * longer asked (`runs()`; `model-replica.ts` publishes it as `chrome`).
 *
 * PG-2 (PG-L1) — every other desktop's board is its owner's REMOTE cut
 * (`AgentRemoteRow`): the model's row and its joins, a bare terminal's among
 * them, with no field half beside it. The fold reads a peer's row for exactly
 * what it read before: its `monitorRow`, its `terminal` join and its key.
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
 * or remote row's `terminal` and `runtimeRunId` — and that is what lets the window map
 * its panes, its spawn answers and fieldd's history (keyed by run) onto model
 * ids without deriving a business fact. Every row the fold has heard is here,
 * the ones the replica hides included (`alive: false`, M3).
 */
export interface HeldModelRow {
  readonly device: string;
  readonly board: AgentModelMeshRow;
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

/** A board row is a bare terminal's when it is of the terminal kind, carries no
 * status of its own and names its pane: the join every reader of one reads. A
 * peer's terminal whose owner's doors are down names none (F-M4, PG-2), and no
 * join is read off it. */
export function isTerminalBoardRow(row: AgentModelMeshRow): row is AgentDeskTerminalRow {
  return row.kind === "terminal" && !("status" in row) && row.terminal !== undefined;
}

/** A board row is a run's desk row (this desktop's model board) when it carries
 * the field half, a status of its own; a bare terminal's and a peer's remote row
 * carry none. */
export function isDeskBoardRow(row: AgentModelMeshRow): row is AgentModelDeskRow {
  return "status" in row;
}

/** A wire OS word as the SDK's mark, kept only when it is one of the SDK's words. */
export function sdkOsMark(os: string | undefined): DeviceOs | undefined {
  return os !== undefined && SDK_OS.has(os) ? (os as DeviceOs) : undefined;
}

/** The wire row as the SDK's row, with the reader's one fact joined. The wire
 * mirrors the SDK field for field (fieldd parses real backend rows through the
 * contract); the OS mark is kept only when it is one of the SDK's words.
 *
 * M41 — `writable` is the home desktop's own word and passes as sent. A peer
 * on an older daemon sends none (the tolerant reader), and the row is then
 * given the rule that daemon applied, `attachable`, so the SDK's row always
 * carries the fact and no view derives write policy. */
export function modelRowFrom(wire: WireMonitorRow, here: string | undefined): MonitorAgentRow {
  const { os, ...device } = wire.device;
  const marked = sdkOsMark(os);
  return {
    ...wire,
    writable: wire.writable ?? wire.attachable,
    device: {
      ...device,
      ...(marked !== undefined ? { os: marked } : {}),
      self: device.id === here,
    },
  } as unknown as MonitorAgentRow;
}

/** The model row a board row carries, or none (a run the backend has not assembled yet). */
export function monitorRowOf(row: AgentModelMeshRow): WireMonitorRow | undefined {
  return row.monitorRow;
}

/** The model ids a board's rows carry, in the board's order. */
function modelIdsOf(rows: readonly AgentModelMeshRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const wire = monitorRowOf(row);
    if (wire !== undefined) ids.push(wire.id);
  }
  return ids;
}

export class ModelBoardFold {
  #revision = 0;
  #here: string | undefined;
  readonly #devices = new Map<string, HeldDevice>();
  readonly #held = new Map<string, HeldModelRow>();
  /** MV-3d — this desktop's run rows by board key, in the board's order */
  readonly #runs = new Map<string, AgentModelDeskRow>();
  /** `#runs` as handed out: the same array until a run row moves */
  #runsList: readonly AgentModelDeskRow[] | null = null;

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
    return this.#byDevice();
  }

  /**
   * MV-3d — this desktop's runs as its board last sent them: every run row of
   * the answering desktop, the model's row and the chrome's facts (`local`) on
   * each, in the board's order. The SAME array until one of them moves: a frame
   * that touches only peers' rows or terminals hands back the one it had.
   */
  runs(): readonly AgentModelDeskRow[] {
    this.#runsList ??= Object.freeze([...this.#runs.values()]);
    return this.#runsList;
  }

  /** Every desktop the board lists, in the board's order. */
  devices(): ModelBoardDevice[] {
    return [...this.#devices.entries()].map(([device, held]) => ({
      device,
      state: held.state,
      asOf: held.asOf,
    }));
  }

  /** The open — and every re-snapshot — replaces everything held (M23). A row
   * the new open still holds keeps its place among its desktop's (item 138). */
  open(open: AgentModelMeshOpen): MonitorModelSnapshot {
    const kept = new Set<string>();
    for (const entry of open.devices) {
      for (const id of modelIdsOf(entry.snapshot?.rows ?? [])) kept.add(id);
    }
    for (const id of [...this.#held.keys()]) if (!kept.has(id)) this.#held.delete(id);
    this.#devices.clear();
    this.#runs.clear();
    this.#runsList = null;
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
      // gone is an id no key of the device maps to now (item 137's rule)
      const mapped = new Set(target.idByKey.values());
      const removed = [...before].filter((id) => !mapped.has(id));
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
    // Item 137 — the ids a key let go of in this frame, each dropped only if
    // no key of the device maps to it once the whole frame is applied. One
    // model id can change keys inside one delta: a shell promoted to an agent
    // is the run's key carrying the shell's id while the shell's key leaves
    // (M22, fieldd's `hostRunFromSummary`), and the run's end is the shell's
    // key back with the id while the run's key leaves (fieldd's
    // `agent-board-promotion.test.ts`). Dropping by key alone deleted the row
    // in the frame that moved it: a window drew a departure and a birth where
    // M22 keeps one body.
    const released = new Set<string>();
    const here = frame.device === this.#here;
    for (const row of delta.upserts) {
      if (here) this.#takeRun(row);
      const previous = held.idByKey.get(row.runtimeRunId);
      const wire = monitorRowOf(row);
      if (wire === undefined) {
        // an owner with no model row for this key (an older daemon): the key
        // stands for nothing now
        if (previous !== undefined) {
          held.idByKey.delete(row.runtimeRunId);
          released.add(previous);
        }
        continue;
      }
      const next = modelRowFrom(wire, this.#here);
      if (previous !== undefined && previous !== next.id) released.add(previous);
      held.idByKey.set(row.runtimeRunId, next.id);
      this.#held.set(next.id, { device: frame.device, board: row, row: next });
      upserts.push(next);
    }
    for (const key of delta.removed) {
      if (here && this.#runs.delete(key)) this.#runsList = null;
      const id = held.idByKey.get(key);
      if (id === undefined) continue;
      held.idByKey.delete(key);
      released.add(id);
    }
    const mapped = new Set(held.idByKey.values());
    const removed = [...released].filter((id) => !mapped.has(id));
    for (const id of removed) this.#held.delete(id);
    held.revision = delta.revision;
    return this.#change(upserts, removed);
  }

  /** A device's board, whole: its rows replace that device's; the upserts. A
   * row the new board still holds keeps its place (item 138): only the ids it
   * no longer holds leave, so a re-send that changed nothing moves nothing. */
  #replaceBoard(
    device: string,
    held: HeldDevice,
    snapshot: RowsSnapshot<AgentModelMeshRow>,
  ): MonitorAgentRow[] {
    const kept = new Set(modelIdsOf(snapshot.rows));
    for (const id of held.idByKey.values()) if (!kept.has(id)) this.#held.delete(id);
    held.idByKey = new Map();
    held.epoch = snapshot.epoch;
    held.revision = snapshot.revision;
    const here = device === this.#here;
    if (here) {
      this.#runs.clear();
      this.#runsList = null;
    }
    const upserts: MonitorAgentRow[] = [];
    for (const row of snapshot.rows) {
      if (here) this.#takeRun(row);
      const wire = monitorRowOf(row);
      if (wire === undefined) continue;
      const next = modelRowFrom(wire, this.#here);
      held.idByKey.set(row.runtimeRunId, next.id);
      this.#held.set(next.id, { device, board: row, row: next });
      upserts.push(next);
    }
    return upserts;
  }

  /** One of this desktop's board rows, for the chrome: a run row is kept whole
   * (assembled by the backend or not); a key that turned into any other row is
   * a run no more. */
  #takeRun(row: AgentModelMeshRow): void {
    if (!isDeskBoardRow(row)) {
      if (this.#runs.delete(row.runtimeRunId)) this.#runsList = null;
      return;
    }
    this.#runs.set(row.runtimeRunId, row);
    this.#runsList = null;
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
    return this.#byDevice().map((held) => held.row);
  }

  /**
   * Item 138 — the held rows grouped by desktop, in the board's device order
   * (the open's, then each desktop as it is first heard), each desktop's rows
   * in the order the fold first took them (a whole re-send keeps every row it
   * still holds in place). `#held` alone is insertion order across every
   * desktop: a device's whole re-send (`#replaceBoard`: a re-present, a
   * re-attach, a resync) re-inserted its rows after every other desktop's, and
   * a birth landed after every desktop's, so a peer's rows moved in the
   * window's order (the rain's columns) on a frame that changed nothing.
   */
  #byDevice(): HeldModelRow[] {
    const groups = new Map<string, HeldModelRow[]>();
    for (const device of this.#devices.keys()) groups.set(device, []);
    for (const held of this.#held.values()) {
      const group = groups.get(held.device);
      if (group === undefined) groups.set(held.device, [held]);
      else group.push(held);
    }
    return [...groups.values()].flat();
  }
}

export type { RowsDelta };
