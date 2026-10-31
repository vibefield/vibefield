import { lazy, type ReactElement, Suspense } from "react";
import type { HistoryPaneEnd } from "../../../setup/HistoryConsentPane";
import { HISTORY_LOOKING_FACE, HISTORY_WORDS } from "../../../setup/history-words";
import { WizardHold, WizardStatus } from "../wizard-ui";

// History — "Bring in your past sessions." (track AO, AO-3; AO-D3, AO-D13).
// The pane's code (the census, the agents' marks, the rows) loads only when a
// first run reaches it, so it never weighs an ordinary boot; while it arrives
// the glass already holds on what the pane is doing — the logo and its one line
// (FG-L5), the same load as the census's own look, which gives up onto its
// unavailable face after 15s, so the hold needs no way out of its own.
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
        <WizardHold face={HISTORY_LOOKING_FACE}>
          <WizardStatus line={HISTORY_WORDS.looking} />
        </WizardHold>
      }
    >
      <HistoryWizardPane onDone={onDone} onBack={onBack} />
    </Suspense>
  );
}
