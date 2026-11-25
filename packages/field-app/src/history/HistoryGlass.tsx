import { type ReactElement, type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { HistorySample } from "./HistorySample";
import { type HistoryHolding, useHistoryHoldWords } from "./history-hold";
import { HISTORY_MARK_WIDTH, HistoryMark } from "./history-mark";
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
//
// THE FIRST READING HOLDS BEHIND THE GLASS (History QA, 2026-11-24; DESIGN.md §8
// "History" — before its past, as amended that day). The layer no longer leaves
// when the room stops waiting. While the controller says the first reading
// holds (`history-hold.ts`), the sample stays, the card goes, and the hold
// stands in the card's place: the living mark and the import's own line. The
// room under it is not shown (`data-held`, the view's). The layer leaves when
// the hold ends, which is when the first projects are listed.

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

/** The hold in the card's place (HG-W1's rows and type, `history-room-view.css`): the living mark at the centre of
 * the room's box, the line 26 under it, its count under that. */
function HistoryGlassHold({ holding }: { holding: HistoryHolding }): ReactElement {
  // read here, so a count that moves draws these two lines and nothing above them
  const hold = useHistoryHoldWords(holding);
  return (
    <div className="vf-history-glass-hold vf-history-hold" role="status">
      <div className="vf-history-hold-mark">
        <HistoryMark width={HISTORY_MARK_WIDTH.view} />
      </div>
      <div className="vf-history-hold-words">
        <p className="vf-history-hold-line">{hold.line}</p>
        <p className="vf-history-hold-sub">{hold.detail}</p>
      </div>
    </div>
  );
}

export function HistoryGlass({
  waiting,
  hold = null,
  shown,
  children,
}: {
  /** the room shows its consent slot (the marker stands) */
  waiting: boolean;
  /** the first reading holds (and in which phase), or null */
  hold?: HistoryHolding | null | undefined;
  /** History is the view shown */
  shown: boolean;
  /** the card */
  children: ReactNode;
}): ReactElement | null {
  // The layer stands while the room waits for consent or the first reading holds. The leave: from the moment it
  // stops standing until the sample's fade has run; a stand that comes back before then keeps the layer.
  const standing = waiting || hold !== null;
  const [was, setWas] = useState(standing);
  const [leaving, setLeaving] = useState(false);
  if (was !== standing) {
    setWas(standing);
    setLeaving(!standing);
  }
  // What stands in the room's box: the card while the room waits, the hold after it. Kept through the leave, so
  // what was there is what goes.
  const [last, setLast] = useState<HistoryHolding | null>(hold);
  if (waiting) {
    if (last !== null) setLast(null);
  } else if (hold !== null && hold !== last) setLast(hold);
  const face = waiting ? null : (hold ?? last);
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(
      () => setLeaving(false),
      reducedMotion() ? HISTORY_GLASS_LEAVE_REDUCED_MS : HISTORY_GLASS_LEAVE_MS,
    );
    return () => clearTimeout(timer);
  }, [leaving]);
  // The develop: once each time History shows while the layer stands.
  const visible = standing && shown;
  const [seen, setSeen] = useState(false);
  const [showing, setShowing] = useState<"a" | "b" | null>(null);
  if (seen !== visible) {
    setSeen(visible);
    if (visible) setShowing(showing === "a" ? "b" : "a");
  }
  if (!standing && !leaving) return null;
  return (
    <div
      className="vf-history-glass"
      data-phase={leaving ? "leave" : "rest"}
      data-showing={showing ?? undefined}
      data-face={face === null ? "card" : "hold"}
    >
      <HistorySample />
      {face === null ? (
        <div className="vf-history-glass-card">{children}</div>
      ) : (
        <HistoryGlassHold holding={face} />
      )}
    </div>
  );
}
