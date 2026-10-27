import { lazy, type ReactElement, Suspense } from "react";
import type { AgentsPaneEnd } from "../../../setup/AgentsWizardPane";
import { AGENTS_WORDS } from "../../../setup/agents-words";
import { BackAction, factCls, primaryCls, WizardPane } from "../wizard-ui";

// Agents — "Your agents are ready." (track AO, AO-5; AO-D1, AO-D13). The pane's
// code (the agents' marks, the inventory's join) loads only when a first run
// reaches it, so it never weighs an ordinary boot; while it arrives the pane
// already says what it is doing, and Continue stays live.
const AgentsWizardPane = lazy(() =>
  import("../../../setup/AgentsWizardPane").then((module) => ({
    default: module.AgentsWizardPane,
  })),
);

export function AgentsPane({
  onDone,
  onBack,
}: {
  onDone: (end: AgentsPaneEnd) => void;
  onBack: (() => void) | undefined;
}): ReactElement {
  return (
    <Suspense
      fallback={
        <WizardPane
          eyebrow={AGENTS_WORDS.eyebrow}
          title={AGENTS_WORDS.plainTitle}
          voice={AGENTS_WORDS.firstVoice}
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
          <p className={factCls}>{AGENTS_WORDS.looking}</p>
        </WizardPane>
      }
    >
      <AgentsWizardPane onDone={onDone} onBack={onBack} />
    </Suspense>
  );
}
