import { lazy, type ReactElement, Suspense } from "react";
import type { HistoryPaneEnd } from "../../../setup/HistoryConsentPane";
import { HISTORY_WORDS } from "../../../setup/history-words";
import { BackAction, factCls, primaryCls, WizardPane } from "../wizard-ui";

// History — "Bring in your past sessions." (track AO, AO-3; AO-D3, AO-D13).
// The pane's code (the census, the agents' marks, the rows) loads only when a
// first run reaches it, so it never weighs an ordinary boot; while it arrives
// the pane already says what it is doing, and Continue stays live.
const HistoryWizardPane = lazy(() =>
  import("../../../setup/HistoryWizardPane").then((module) => ({
    default: module.HistoryWizardPane,
  })),
);

export function HistoryPane({
  onDone,
  onBack,
}: {
  onDone: (end: HistoryPaneEnd) => void;
  onBack: (() => void) | undefined;
}): ReactElement {
  return (
    <Suspense
      fallback={
        <WizardPane
          eyebrow={HISTORY_WORDS.eyebrow}
          title={HISTORY_WORDS.title}
          voice={HISTORY_WORDS.voice}
          onSubmit={() => onDone("skipped")}
          actions={
            <>
              <button type="submit" className={primaryCls}>
                Continue
              </button>
              <BackAction onBack={onBack} />
            </>
          }
        >
          <p className={factCls}>{HISTORY_WORDS.looking}</p>
        </WizardPane>
      }
    >
      <HistoryWizardPane onDone={onDone} onBack={onBack} />
    </Suspense>
  );
}
