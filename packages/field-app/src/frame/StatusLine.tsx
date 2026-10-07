import { type ReactElement, useSyncExternalStore } from "react";
import { deskAnchor, inHand, subscribeDeskAnchor } from "../field/desk/desk-anchor";
import { type StatusNotice, useStatusNotice } from "./status-line";
import "./status-line.css";

// THE STATUS LINE (DESIGN.md §8 "The status line", §10; R12, R16, R18) — the frame's one line for
// the desk's notices, centred under the head at y 56 (8 under its 48) — and 8 under the tools in hand,
// y 112, while an object is held (R12): solid chrome ringed by the strong hairline with the island
// shadow, corners 10, padded 7 10, 12/500 in secondary ink, rising 4 as it fades in. A notice with an
// act carries it at its end, a text button in primary ink; one with a detail carries it on a row of
// its own under the words — 11 mono, faint, verbatim, as the unavailable card carries its detail
// (the degraded desk's ICE message; DK-17). It stands with the frame, above the cover.
// Controller-free (`StatusLineView`), so the catalog mounts this exact markup on a fixture notice;
// `StatusLine` reads the store, and the hand off the desk's anchor.

export function StatusLineView({
  notice,
  held = false,
}: {
  notice: StatusNotice | null;
  /** An object is in hand: the line stands under the tools in hand (y 112), not the head. */
  held?: boolean;
}): ReactElement | null {
  if (notice === null) return null;
  return (
    <div
      className="vf-status-line"
      role="status"
      data-status-line={notice.id}
      {...(held ? { "data-held": "" } : {})}
      {...(notice.detail === undefined ? {} : { "data-detail": "" })}
    >
      <span className="vf-status-line__text">{notice.text}</span>
      {notice.act === undefined ? null : (
        <button type="button" className="vf-status-line__act" onClick={notice.act.run}>
          {notice.act.label}
        </button>
      )}
      {notice.detail === undefined ? null : (
        <span className="vf-status-line__detail">{notice.detail}</span>
      )}
    </div>
  );
}

const handNow = (): boolean => inHand(deskAnchor());

/** The line, read from its one store — keyed by the notice, so each one rises in afresh. */
export function StatusLine(): ReactElement | null {
  const notice = useStatusNotice();
  // a boolean read off the anchor: the line re-renders when the hand changes, never per frame
  const held = useSyncExternalStore(subscribeDeskAnchor, handNow, handNow);
  return <StatusLineView key={notice?.id ?? ""} notice={notice} held={held} />;
}
