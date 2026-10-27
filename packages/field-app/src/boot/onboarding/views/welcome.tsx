import type { ReactElement } from "react";
import { eyebrowCls, factCls, primaryCls, WizardPane } from "../wizard-ui";

export function OnboardingDerivingPaneView(): ReactElement {
  return (
    <div className="vf-wizard-pane w-full max-w-[30rem]">
      <span className={eyebrowCls}>Setup</span>
      <p className={`mt-2 ${factCls}`}>Reading what this field already knows…</p>
    </div>
  );
}

export function OnboardingWelcomePaneView({
  onContinue,
}: {
  onContinue: () => void;
}): ReactElement {
  return (
    <WizardPane
      eyebrow="VibeField"
      title="Welcome."
      voice="Manage all your agents and compose your agentic workflow in one place."
      centered
      actions={
        <button type="submit" className={primaryCls}>
          Get started
        </button>
      }
      onSubmit={onContinue}
    />
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
