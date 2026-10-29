import { AgentModelBoardRow, type RowsDeviceState } from "@vibefield/contracts";

/**
 * PG-1b (PG-L4.1, 2026-10-29) — the window reads the model board one desktop at a
 * time.
 *
 * Since PG-1b the mesh relay reads each peer row's key alone
 * (`AgentBoardRowKey`), so a row this build cannot read (a newer peer's word, a
 * shape it does not know) reaches the window. The relay used to refuse that
 * whole desktop instead. Parsed whole here, one such row would fail the
 * window's open (the Godview unavailable, not retryable) or every frame of
 * every desktop (a reopen each time).
 *
 * So each row is read on its own before the envelope:
 * - an unreadable row is dropped, and its desktop reads as another version
 *   (`incompatible`, the state the relay gave it before) while it holds one;
 * - its readable rows and every other desktop's board stand;
 * - the frame stays whole and the chain is kept: a delta loses its unreadable
 *   upserts, never its `since` or `revision`;
 * - once the desktop holds no unreadable row, it reads as the wire last said.
 *
 * A payload not shaped like an open or a frame passes through untouched, and
 * the envelope's own parse decides it as before. The tolerant reader, per desktop.
 */
export class BoardScreen {
  /** device → the keys of its rows this build cannot read */
  readonly #unreadable = new Map<string, Set<string>>();
  /** device → its standing as the wire last said it */
  readonly #said = new Map<string, { state: RowsDeviceState; asOf: string }>();

  /** The open, screened. An open replaces everything, the screen's memory too. */
  open(payload: unknown): unknown {
    this.#unreadable.clear();
    this.#said.clear();
    if (!isRecord(payload) || !Array.isArray(payload["devices"])) return payload;
    return {
      ...payload,
      devices: payload["devices"].map((entry: unknown) => {
        if (!isRecord(entry) || typeof entry["device"] !== "string") return entry;
        const device = entry["device"];
        this.#hear(device, entry);
        const snapshot = entry["snapshot"];
        if (!isRecord(snapshot) || !Array.isArray(snapshot["rows"])) return entry;
        const { readable, unreadable } = split(snapshot["rows"]);
        if (unreadable.size === 0) return entry;
        this.#unreadable.set(device, unreadable);
        return { ...entry, state: "incompatible", snapshot: { ...snapshot, rows: readable } };
      }),
    };
  }

  /** One frame, screened: the frames to deliver, in order. Each is the frame
   * without its unreadable rows, then a state frame when the desktop's standing
   * moved. */
  frame(payload: unknown): unknown[] {
    if (!isRecord(payload) || typeof payload["device"] !== "string") return [payload];
    const device = payload["device"];
    if ("state" in payload) {
      this.#hear(device, payload);
      return [this.#holds(device) ? { ...payload, state: "incompatible" } : payload];
    }
    const before = this.#holds(device);
    let screened: unknown = payload;
    const snapshot = payload["snapshot"];
    const delta = payload["delta"];
    if (isRecord(snapshot) && Array.isArray(snapshot["rows"])) {
      const { readable, unreadable } = split(snapshot["rows"]);
      this.#unreadable.set(device, unreadable);
      if (unreadable.size > 0) screened = { ...payload, snapshot: { ...snapshot, rows: readable } };
    } else if (isRecord(delta) && Array.isArray(delta["upserts"])) {
      const held = this.#unreadable.get(device) ?? new Set<string>();
      const { readable, unreadable } = split(delta["upserts"]);
      for (const row of readable) held.delete(keyOf(row));
      for (const key of unreadable) held.add(key);
      if (Array.isArray(delta["removed"])) {
        for (const key of delta["removed"]) if (typeof key === "string") held.delete(key);
      }
      this.#unreadable.set(device, held);
      if (unreadable.size > 0) screened = { ...payload, delta: { ...delta, upserts: readable } };
    } else {
      return [payload];
    }
    const after = this.#holds(device);
    if (before === after) return [screened];
    const said = this.#said.get(device);
    const asOf = said?.asOf ?? new Date().toISOString();
    const state: RowsDeviceState = after ? "incompatible" : (said?.state ?? "live");
    return [screened, { device, state, asOf }];
  }

  #holds(device: string): boolean {
    return (this.#unreadable.get(device)?.size ?? 0) > 0;
  }

  #hear(device: string, entry: Record<string, unknown>): void {
    const state = entry["state"];
    const asOf = entry["asOf"];
    if (typeof state === "string" && typeof asOf === "string") {
      this.#said.set(device, { state: state as RowsDeviceState, asOf });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A row's key as the relay read it, or a stand-in that is never a real key. */
function keyOf(row: unknown): string {
  return isRecord(row) && typeof row["runtimeRunId"] === "string" ? row["runtimeRunId"] : "\u0000";
}

function split(rows: readonly unknown[]): { readable: unknown[]; unreadable: Set<string> } {
  const readable: unknown[] = [];
  const unreadable = new Set<string>();
  for (const row of rows) {
    if (AgentModelBoardRow.safeParse(row).success) readable.push(row);
    else unreadable.add(keyOf(row));
  }
  return { readable, unreadable };
}
