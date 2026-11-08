import { UiButton } from "@vibefield/design-kit/primitives";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import type { ReactElement } from "react";
import { HistoryConsentPane, type HistoryPaneParts } from "../setup/HistoryConsentPane";
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
//
// *2026-11-08 (track HG, HG-2; HG-D1…HG-D6; §8 "History" — before its past):*
// the pane is a CARD now, in the Setup Assistant's glass over the sample room
// (the view's own layer, `HistoryGlass.tsx`, stands it centred in the room's
// box). Its act names its press, "Bringing in…" (§7's running press: the kit's
// primary passes `running`, the kit's own since 241b `3063c980b`, so it is held
// off and keeps its look rather than drawn Off); a line under the
// act says the room behind is a sample; a census with nothing to bring in says
// "Your history starts here." with Look again, never a dead end; and inside
// History a census that could not answer says its first sentence alone.

/** The card behind glass: the History pane's parts, laid out. Controller-free,
 * so the catalog mounts the shipping face over a fixture census. `empty`: the
 * census answered with nothing to bring in. */
export function HistoryConsentCard({
  parts,
  empty,
  onLookAgain,
}: {
  parts: HistoryPaneParts;
  empty: boolean;
  onLookAgain: () => void;
}): ReactElement {
  return (
    <section className="vf-history-consent" aria-labelledby="vf-history-consent-title">
      <h2 id="vf-history-consent-title" className="vf-history-consent-title">
        {empty ? HISTORY_WORDS.emptyTitle : HISTORY_WORDS.title}
      </h2>
      <p className="vf-history-consent-voice">
        {empty ? HISTORY_WORDS.emptyVoice : HISTORY_WORDS.voice}
      </p>
      {!empty && parts.body}
      {parts.error !== null && (
        <p className="vf-history-consent-error" role="alert">
          {parts.error}
        </p>
      )}
      {parts.choosing ? (
        <div className="vf-history-consent-acts">
          <UiButton
            variant="primary"
            running={parts.primaryBusy}
            disabled={parts.primaryLabel !== HISTORY_WORDS.bringIn}
            onClick={parts.onPrimary}
          >
            {parts.primaryBusy ? HISTORY_WORDS.bringingIn : HISTORY_WORDS.bringIn}
          </UiButton>
        </div>
      ) : empty ? (
        <div className="vf-history-consent-acts">
          <UiButton onClick={onLookAgain}>{HISTORY_WORDS.lookAgain}</UiButton>
        </div>
      ) : null}
      <p className="vf-history-consent-sample">
        {empty ? HISTORY_WORDS.sampleShort : HISTORY_WORDS.sample}
      </p>
    </section>
  );
}

export function HistoryConsent({
  onGranted,
}: {
  /** the act landed (the record is the set, the service restarted with it) */
  onGranted?: (() => void) | undefined;
}): ReactElement {
  const client = useFielddClient();
  const { census, lookAgain } = useHistoryCensus(client);
  const empty = census.kind === "found" && census.rows.length === 0;
  return (
    <HistoryConsentPane
      census={census}
      unavailable={HISTORY_WORDS.unavailableHere}
      onDone={(end) => {
        if (end === "answered") onGranted?.();
      }}
      frame={(parts) => <HistoryConsentCard parts={parts} empty={empty} onLookAgain={lookAgain} />}
    />
  );
}
