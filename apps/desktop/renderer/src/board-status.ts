// Board-persistence status — a module-level store so the SystemSection row can
// read it without threading props through the ported widgetlab panels. Written
// by FieldView's doc-attach effect; read via useSyncExternalStore.

export type BoardPersistenceState =
  | "booting" // pre-attach
  | "live" // attached, last save acknowledged
  | "saving" // a PUT is in flight
  | "detached" // no lane (degraded boot / reconnecting) — edits are in-memory only
  | "quarantined"; // at-rest bytes unreadable by this build — left untouched on disk

export interface BoardStatus {
  state: BoardPersistenceState;
  /** human detail for degraded states (reason / reconnect note). */
  detail?: string;
  /** wall-clock ms of the last acknowledged PUT. */
  lastSavedAt?: number | null;
}

let current: BoardStatus = { state: "booting" };
const listeners = new Set<() => void>();

export function setBoardStatus(next: BoardStatus): void {
  current = next;
  for (const fn of listeners) fn();
}

export function getBoardStatus(): BoardStatus {
  return current;
}

export function subscribeBoardStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
