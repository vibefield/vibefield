import { lazy, type ReactElement, Suspense } from "react";
import type { AgentsPaneEnd } from "../../../setup/AgentsWizardPane";
import { AGENTS_LOOKING_FACE, AGENTS_WORDS } from "../../../setup/agents-words";
import { WizardHold, WizardStatus } from "../wizard-ui";

// Agents — "Your agents are ready." (track AO, AO-5; AO-D1, AO-D13). The pane's
// code (the agents' marks, the inventory's join) loads only when a first run
// reaches it, so it never weighs an ordinary boot; while it arrives the glass
// already holds on what the pane is doing — the logo and its one line (FG-L5),
// the same load as the pane's own look, which gives up onto its unavailable
// face after 15s, so the hold needs no way out of its own.
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
        <WizardHold face={AGENTS_LOOKING_FACE}>
          <WizardStatus line={AGENTS_WORDS.looking} />
        </WizardHold>
      }
    >
      <AgentsWizardPane onDone={onDone} onBack={onBack} />
    </Suspense>
  );
}
