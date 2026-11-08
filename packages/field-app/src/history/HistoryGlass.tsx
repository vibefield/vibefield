import { type ReactElement, type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { HistorySample } from "./HistorySample";
import "./history-glass.css";

// HISTORY BEFORE ITS PAST (track HG, HG-2; HG-D1…HG-D6 ruled by James
// 2026-11-08; DESIGN.md §8 "History" — before its past, the room behind glass;
// §6 History's motions). While the index waits for consent the view stands, in
// its own layer over the room, the sample — the room itself, frosted
// (`HistorySample.tsx`) — and the card the controller hands it, centred in the
// room's box. The room's own consent slot holds only a marker: the room
// unmounts its slot the moment it stops waiting, so the layer is the view's and
// the card and the sample leave in their own time — the card in 240ms, the
// sample over 480ms (one 120ms fade each under reduced motion) — uncovering the
// room's own import, which never waits for them. It develops each time History
// shows, never on a render of its own: `data-showing` turns between two names
// for one motion, so each showing restarts it (`history-glass.css`).

/** The leave's length: the sample's fade (§6, HG-D6). */
export const HISTORY_GLASS_LEAVE_MS = 480;
/** …and under reduced motion, its one fade. */
export const HISTORY_GLASS_LEAVE_REDUCED_MS = 120;

const reducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What the room's consent slot holds: nothing to see, and the room's word
 * that it waits, from the slot's first commit to its last. */
export function HistoryConsentMarker({
  onWaiting,
}: {
  onWaiting: (waiting: boolean) => void;
}): ReactElement {
  useLayoutEffect(() => {
    onWaiting(true);
    return () => onWaiting(false);
  }, [onWaiting]);
  return <span className="vf-history-consent-marker" hidden />;
}

export function HistoryGlass({
  waiting,
  shown,
  children,
}: {
  /** the room shows its consent slot (the marker stands) */
  waiting: boolean;
  /** History is the view shown */
  shown: boolean;
  /** the card */
  children: ReactNode;
}): ReactElement | null {
  // The leave: from the moment the room stops waiting until the sample's fade
  // has run; a wait that comes back before then keeps the layer.
  const [was, setWas] = useState(waiting);
  const [leaving, setLeaving] = useState(false);
  if (was !== waiting) {
    setWas(waiting);
    setLeaving(!waiting);
  }
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(
      () => setLeaving(false),
      reducedMotion() ? HISTORY_GLASS_LEAVE_REDUCED_MS : HISTORY_GLASS_LEAVE_MS,
    );
    return () => clearTimeout(timer);
  }, [leaving]);
  // The develop: once each time History shows while the room waits.
  const visible = waiting && shown;
  const [seen, setSeen] = useState(false);
  const [showing, setShowing] = useState<"a" | "b" | null>(null);
  if (seen !== visible) {
    setSeen(visible);
    if (visible) setShowing(showing === "a" ? "b" : "a");
  }
  if (!waiting && !leaving) return null;
  return (
    <div
      className="vf-history-glass"
      data-phase={leaving ? "leave" : "rest"}
      data-showing={showing ?? undefined}
    >
      <HistorySample />
      <div className="vf-history-glass-card">{children}</div>
    </div>
  );
}
