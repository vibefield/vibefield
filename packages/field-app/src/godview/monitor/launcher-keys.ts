// QL-D2 (thinking-ql-empty-pane-launcher.md) — who owns ⌥0–⌥9 and ⌥↵.
//
// While the empty pane launcher is up in the FOCUSED pane it owns the digits
// (⌥n launches the nth agent into that pane); at every other time the profile
// tab strip keeps them (⌥0 All, ⌥n the nth tab). The launcher lives under the
// deck and the strip under the monitor — siblings in the overlay — so the one
// fact they share is this: `DeckLaunchers`' `onOwnsKeysChange` takes a CLAIM
// naming where the owning launcher's pane is, and the monitor's ⌥-digit
// listener yields (returns without touching the event) only for a key whose
// target is inside that pane (`launcherOwnsKeyEvent`). The launcher's own
// listener takes only keys routed into its pane, so the two agree: with the
// focus in the monitor, or in any input outside that pane, the strip keeps
// its digits even while a launcher is up (the review's finding 3 — a bare
// flag had made ⌥digits dead everywhere while the active pane showed one).
//
// Claims rather than a boolean: every launcher mounter takes its own and
// gives back only that one, so two decks (a remount racing its predecessor's
// cleanup) never have the second's take erased by the first's give-back.

/** Where the owning launcher's pane element is, asked at event time. */
export type LauncherKeysWhere = () => Element | null | undefined;

const claims = new Set<{ where: LauncherKeysWhere }>();

/** The launcher in the focused pane took the keys; call the answer to give
 * them back (idempotent). */
export function takeLauncherKeys(where: LauncherKeysWhere): () => void {
  const claim = { where };
  claims.add(claim);
  return () => {
    claims.delete(claim);
  };
}

/** Whether any launcher holds a claim right now (it owns the keys routed into
 * its pane). */
export function launcherOwnsKeys(): boolean {
  return claims.size > 0;
}

/** Whether THIS key is the launcher's: its target is inside the pane of a
 * launcher that holds the keys. Read at event time by the monitor's ⌥-digit
 * listener, which yields exactly these. */
export function launcherOwnsKeyEvent(event: Pick<Event, "target">): boolean {
  const target = event.target;
  if (typeof Node === "undefined" || !(target instanceof Node)) return false;
  for (const claim of claims) {
    if (claim.where()?.contains(target) === true) return true;
  }
  return false;
}

/** Tests only: forget every claim and every hold. */
export function resetLauncherKeys(): void {
  claims.clear();
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
