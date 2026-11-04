import { UiButton } from "@vibefield/design-kit/primitives";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import type { ReactElement } from "react";
import { HistoryConsentPane } from "../setup/HistoryConsentPane";
import { HISTORY_WORDS } from "../setup/history-words";
import { useHistoryCensus } from "../setup/use-history-census";
import "./history-consent-slot.css";

// History's consent slot (track AO, AO-3; AO-D9; DESIGN.md §8 "History is
// rosetta's room" — its honest states, amended): while the index waits for
// consent, the room shows the History pane itself — the same rows and the same
// act as the Setup Assistant's — on every visit until answered. It is the
// view's empty state, so it has no Not now: leaving History is that. The room
// takes over the moment the history service restarts with the set.
//
// *2026-11-03 (rosetta 0.1.3, its ux:X7):* `index.enroll` answers once the
// restarted service is ready, and the room learned of it only at its next
// consent-pause poll (2.5 s). `onGranted` is told when the act has landed — the
// controller asks the room's status then (`HistoryRoomHandle.refreshStatus`),
// as rosetta's own app does from its roll call. The slot's one act is Bring in
// history, live only with a switch on, so an answer here is always a grant: the
// room re-asks every 100 ms until its phase leaves awaiting consent, and an
// empty set (which never leaves it) must not start that.

export function HistoryConsent({
  onGranted,
}: {
  /** the act landed (the record is the set, the service restarted with it) */
  onGranted?: (() => void) | undefined;
}): ReactElement {
  const client = useFielddClient();
  const { census } = useHistoryCensus(client);
  return (
    <HistoryConsentPane
      census={census}
      onDone={(end) => {
        if (end === "answered") onGranted?.();
      }}
      frame={(parts) => (
        <section className="vf-history-consent" aria-labelledby="vf-history-consent-title">
          <h2 id="vf-history-consent-title" className="vf-history-consent-title">
            {HISTORY_WORDS.title}
          </h2>
          <p className="vf-history-consent-voice">{HISTORY_WORDS.voice}</p>
          {parts.body}
          {parts.error !== null && (
            <p className="vf-history-consent-error" role="alert">
              {parts.error}
            </p>
          )}
          {parts.choosing && (
            <div className="vf-history-consent-acts">
              <UiButton
                variant="primary"
                disabled={parts.primaryBusy || parts.primaryLabel !== HISTORY_WORDS.bringIn}
                onClick={parts.onPrimary}
              >
                {HISTORY_WORDS.bringIn}
              </UiButton>
            </div>
          )}
        </section>
      )}
    />
  );
}
