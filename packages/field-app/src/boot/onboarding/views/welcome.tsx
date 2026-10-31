import type { ReactElement } from "react";
import { primaryCls, voiceCls, WizardHold, WizardPane, WizardStatus } from "../wizard-ui";

/** The read before the first pane: a load, the logo and one line (FG-L5). */
export function OnboardingDerivingPaneView(): ReactElement {
  return (
    <WizardHold face="deriving">
      <WizardStatus line="Reading what this field already knows…" />
    </WizardHold>
  );
}

/** The welcome: the hold's title card under the logo (FG-4b) — Welcome., AO's
 * line, and Get started. */
export function OnboardingWelcomePaneView({
  onContinue,
}: {
  onContinue: () => void;
}): ReactElement {
  return (
    <WizardHold face="welcome" card onSubmit={onContinue}>
      <h1 className="text-[32px] font-light leading-[1.15] tracking-[-0.02em] text-black dark:text-white">
        Welcome.
      </h1>
      <p className={`vf-wizard-hold-voice ${voiceCls}`}>
        Manage all your agents and compose your agentic workflow in one place.
      </p>
      <div className="vf-wizard-hold-actions">
        <button type="submit" className={primaryCls}>
          Get started
        </button>
      </div>
    </WizardHold>
  );
}

export function OnboardingWelcomeBackPaneView({
  onContinue,
}: {
  onContinue: () => void;
}): ReactElement {
  return (
    <WizardPane
      eyebrow="VibeField"
      title="Your field now lives in a user."
      voice="Everything you had is exactly where you left it — it just moved under a user, so this machine can hold more than one. Two questions and you are back."
      actions={
        <button type="submit" className={primaryCls}>
          Continue
        </button>
      }
      onSubmit={onContinue}
    />
  );
}
