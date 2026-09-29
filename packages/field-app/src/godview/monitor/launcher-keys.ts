// QL-D2 (thinking-ql-empty-pane-launcher.md) — who owns ⌥0–⌥9 and ⌥↵.
//
// A key routed into a pane that shows the empty pane launcher is that
// launcher's (⌥n launches the nth agent there; puppeteer's DeckLaunchers gives
// each key to the launcher of the pane that holds it, selected or not); at
// every other time the profile tab strip keeps the digits (⌥0 All, ⌥n the nth
// tab). The launcher lives under the deck and the strip under the monitor —
// siblings in the overlay — so the one fact they share is this: the deck's
// host takes a CLAIM whose predicate says, at event time, whether a key's
// target is inside a pane showing a launcher, and the monitor's ⌥-digit
// listener yields exactly those keys (`launcherOwnsKeyEvent`). With the focus
// in the monitor, or in any input outside such a pane, the strip keeps its
// digits (the review's finding 3 — a bare flag had made ⌥digits dead
// everywhere while a launcher was up).
//
// Claims rather than a boolean: every host takes its own and gives back only
// that one, so two decks (a remount racing its predecessor's cleanup) never
// have the second's take erased by the first's give-back.

/** Whether this key's target is inside a pane whose launcher takes it. */
export type LauncherKeysHolds = (target: Node) => boolean;

const claims = new Set<{ holds: LauncherKeysHolds }>();

/** A host whose launchers may be up takes the keys routed into their panes;
 * call the answer to give them back (idempotent). */
export function takeLauncherKeys(holds: LauncherKeysHolds): () => void {
  const claim = { holds };
  claims.add(claim);
  return () => {
    claims.delete(claim);
  };
}

/** Whether any host holds a claim right now (a launcher may be up). */
export function launcherOwnsKeys(): boolean {
  return claims.size > 0;
}

/** Whether THIS key is a launcher's: its target is inside a pane showing one.
 * Read at event time by the monitor's ⌥-digit listener, which yields exactly
 * these. */
export function launcherOwnsKeyEvent(event: Pick<Event, "target">): boolean {
  const target = event.target;
  if (typeof Node === "undefined" || !(target instanceof Node)) return false;
  for (const claim of claims) {
    if (claim.holds(target)) return true;
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
