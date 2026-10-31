import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { EmptyState, UiButton } from "@vibefield/design-kit/primitives";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { COVER_RESERVE_PX, HEAD_BAND_PX } from "../frame/frame-geometry";
import "./history-room-view.css";

// HISTORY BEFORE ITS ROOM (2026-10-04; DESIGN.md §8 "History" — "Its first
// open says 'Opening History'"). The room is its own chunk (`room-chunk.tsx`),
// so what the view shows until the room is here is VibeField's: the covers'
// glass with the room's edges, and the words in the consent line's place and
// type. Two faces, controller-free so the catalog mounts them as they ship —
// the room arriving, and a room that could not open. This module rides the
// canvas's chunk with the controller, never the room's, and brings the view's
// sheet with it, so the glass is drawn before the room's chunk is.

/** The covers' glass and the room's box, the frame's numbers projected for the
 * view's sheet (`history-room-view.css`) — the same edges the room keeps. */
function HistoryGlass({
  face,
  children,
}: {
  face: "opening" | "failed";
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className="vf-history"
      data-face={face}
      style={
        {
          "--vf-history-reserve": `${COVER_RESERVE_PX}px`,
          "--vf-history-head": `${HEAD_BAND_PX}px`,
        } as CSSProperties
      }
    >
      <div className="vf-history-room">{children}</div>
    </div>
  );
}

/** While the room's chunk arrives. The words are LATE, as the veil's are —
 * the sheet holds them invisible for 120ms — so a room already loaded never
 * flashes them, and the glass under them is the room's own. */
export function HistoryOpeningState(): ReactElement {
  return (
    <HistoryGlass face="opening">
      <div className="vf-history-state vf-history-face" data-late="" role="status">
        <EmptyState visual={<FieldGlyph name="history" size={28} />} title="Opening History…" />
      </div>
    </HistoryGlass>
  );
}

/** A room that could not open — its chunk refused, or the room failed as it
 * drew — said in its place, in what failed's own words, with Retry (the
 * splash's rule: the plain reason, then Retry). Never a blank. */
export function HistoryOpenFailedState({
  reason,
  onRetry,
}: {
  reason: string;
  onRetry: () => void;
}): ReactElement {
  return (
    <HistoryGlass face="failed">
      <div className="vf-history-state vf-history-face" role="alert">
        <EmptyState
          visual={<FieldGlyph name="history" size={28} />}
          title="History could not open"
          description={reason}
          actions={<UiButton onClick={onRetry}>Retry</UiButton>}
        />
      </div>
    </HistoryGlass>
  );
}
