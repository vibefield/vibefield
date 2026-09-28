// QL-D2 (thinking-ql-empty-pane-launcher.md) — who owns ⌥0–⌥9 and ⌥↵.
//
// While the empty pane launcher is up in the FOCUSED pane it owns the digits
// (⌥n launches the nth agent into that pane); at every other time the profile
// tab strip keeps them (⌥0 All, ⌥n the nth tab). The launcher lives under the
// deck and the strip under the monitor — siblings in the overlay — so the one
// fact they share is this flag: `DeckLaunchers`' `onOwnsKeysChange` sets it,
// and the monitor's ⌥-digit listener yields (returns without touching the
// event) while it is set.
//
// A counter rather than a boolean: every launcher mounter reports its own
// ownership with a set and a matching clear, and two decks (a remount racing
// its predecessor's cleanup) must not have the second's `true` erased by the
// first's `false`.

let owners = 0;

/** The launcher in the focused pane took (true) or gave back (false) the keys. */
export function setLauncherOwnsKeys(owns: boolean): void {
  owners = Math.max(0, owners + (owns ? 1 : -1));
}

/** Whether a launcher owns ⌥0–⌥9 and ⌥↵ right now. Read at event time. */
export function launcherOwnsKeys(): boolean {
  return owners > 0;
}

/** Tests only: forget every owner and every hold. */
export function resetLauncherKeys(): void {
  owners = 0;
  monitorHolds = 0;
}

// ── the other direction: the monitor's own sheet holds the keys ──
//
// Found by the godview smoke (its find-sheet row): ⌘F opens the find sheet
// with the keyboard still in the terminal, and the sheet closes on a window
// Escape. With a fresh pane focused, the launcher's capture listener took that
// Escape as "put the launcher away" and stopped it, so the sheet never closed.
// While the monitor has a sheet up over the stage, the launcher yields its
// keys (the deck hands it no active pane), exactly as the tab strip yields
// the digits to it.

let monitorHolds = 0;
const holdListeners = new Set<() => void>();

/** A monitor sheet (the find sheet) opened (true) or closed (false). */
export function setMonitorHoldsKeys(holds: boolean): void {
  const before = monitorHolds > 0;
  monitorHolds = Math.max(0, monitorHolds + (holds ? 1 : -1));
  if (before !== monitorHolds > 0) for (const listener of holdListeners) listener();
}

/** Whether a monitor sheet holds the keyboard right now. */
export function monitorHoldsKeys(): boolean {
  return monitorHolds > 0;
}

/** For `useSyncExternalStore`: the deck re-renders when the hold flips. */
export function subscribeMonitorHoldsKeys(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => holdListeners.delete(listener);
}
