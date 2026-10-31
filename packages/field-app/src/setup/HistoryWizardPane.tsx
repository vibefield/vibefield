import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useRef } from "react";
import {
  BackAction,
  primaryCls,
  SkipAction,
  WizardError,
  WizardPane,
} from "../boot/onboarding/wizard-ui";
import {
  HistoryConsentPane,
  type HistoryPaneEnd,
  type HistoryPaneParts,
} from "./HistoryConsentPane";
import { HISTORY_WORDS } from "./history-words";
import { useHistoryCensus } from "./use-history-census";

// The History pane on the Setup Assistant's glass (track AO, AO-3; DESIGN.md §8
// "The Setup Assistant's agent chapter" — History): the Setup Assistant's own
// pane, and the same pane in Finish setting up's sheet. A pane with nothing to
// decide moves on by itself (AO-L2): no history on this Mac, or all of it
// already brought in.

export function HistoryWizardPane({
  onDone,
  onBack,
  now,
}: {
  onDone: (end: HistoryPaneEnd) => void;
  onBack?: (() => void) | undefined;
  /** the moment "last used" is said against; the pane's own clock when not given */
  now?: number | undefined;
}): ReactElement {
  const client = useFielddClient();
  const { census } = useHistoryCensus(client);
  // The pane ends once, however it ends (an act, or nothing to ask).
  const ended = useRef(false);
  const end = (how: HistoryPaneEnd): void => {
    if (ended.current) return;
    ended.current = true;
    onDone(how);
  };
  const nothingToAsk = census.kind === "found" && !census.rows.some((row) => !row.consented);
  useEffect(() => {
    if (nothingToAsk && !ended.current) {
      ended.current = true;
      onDone("skipped");
    }
  }, [nothingToAsk, onDone]);
  return (
    <HistoryConsentPane
      census={census}
      onDone={end}
      now={now}
      frame={(parts) => <HistoryWizardPaneView parts={parts} onBack={onBack} />}
    />
  );
}

/** The pane on the wizard's glass, controller-free (the catalog's face): the
 * question, its body, Bring in history, Not now with its home, Back. */
export function HistoryWizardPaneView({
  parts,
  onBack,
}: {
  parts: HistoryPaneParts;
  onBack?: (() => void) | undefined;
}): ReactElement {
  return (
    <WizardPane
      eyebrow={HISTORY_WORDS.eyebrow}
      title={HISTORY_WORDS.title}
      voice={HISTORY_WORDS.voice}
      later={parts.choosing ? HISTORY_WORDS.later : undefined}
      onSubmit={parts.onPrimary}
      actions={
        <>
          <button type="submit" className={primaryCls} disabled={parts.primaryBusy}>
            {parts.primaryLabel}
          </button>
          {parts.choosing && <SkipAction label={HISTORY_WORDS.notNow} onSkip={parts.onLater} />}
          <BackAction onBack={onBack} />
        </>
      }
    >
      {parts.body}
      {parts.error !== null && <WizardError reason={parts.error} />}
    </WizardPane>
  );
}
