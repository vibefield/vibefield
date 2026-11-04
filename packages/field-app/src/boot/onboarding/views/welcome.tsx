import type { ReactElement } from "react";
import { primaryCls, voiceCls, WizardHold, WizardPane, WizardStatus } from "../wizard-ui";

/** The read before the first pane: a load, the logo and one line (FG-L5). */
export function OnboardingDerivingPaneView(): ReactElement {
  return (
    <WizardHold face="deriving">
      <WizardStatus line="Getting your field ready…" />
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
        Your agents, sessions, and projects. Together in one field.
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
      title="Welcome back."
      voice="Your work is right where you left it. Give your field a name and a face, so everyone on this computer can have their own."
      actions={
        <button type="submit" className={primaryCls}>
          Continue
        </button>
      }
      onSubmit={onContinue}
    />
  );
}
