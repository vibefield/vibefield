import type { ReactElement } from "react";
import { type StatusNotice, useStatusNotice } from "./status-line";
import "./status-line.css";

// THE STATUS LINE (DESIGN.md §8 "The status line", §10; R12, R16, R18) — the frame's one line for
// the desk's notices, centred under the head at y 56 (8 under its 48): solid chrome ringed by the
// strong hairline with the island shadow, corners 10, padded 7 10, 12/500 in secondary ink, rising 4
// as it fades in. A notice with an act carries it at its end, a text button in primary ink. It stands
// with the frame, above the cover. Controller-free (`StatusLineView`), so the catalog mounts this
// exact markup on a fixture notice; `StatusLine` reads the store.

export function StatusLineView({ notice }: { notice: StatusNotice | null }): ReactElement | null {
  if (notice === null) return null;
  return (
    <div className="vf-status-line" role="status" data-status-line={notice.id}>
      <span className="vf-status-line__text">{notice.text}</span>
      {notice.act === undefined ? null : (
        <button type="button" className="vf-status-line__act" onClick={notice.act.run}>
          {notice.act.label}
        </button>
      )}
    </div>
  );
}

/** The line, read from its one store — keyed by the notice, so each one rises in afresh. */
export function StatusLine(): ReactElement | null {
  const notice = useStatusNotice();
  return <StatusLineView key={notice?.id ?? ""} notice={notice} />;
}
