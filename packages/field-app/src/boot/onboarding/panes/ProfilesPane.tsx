import { lazy, type ReactElement, Suspense } from "react";
import type { ProfilesPaneEnd } from "../../../setup/ProfilesWizardPane";
import { PROFILES_WORDS } from "../../../setup/profiles-words";
import { BackAction, factCls, primaryCls, WizardPane } from "../wizard-ui";

// Profiles — "Every subscription, side by side." (track AO, AO-5; AO-D6, AO-D7).
// The pane's code (the profiles feed's join, the agents' marks, the sign-in's
// terminal) loads only when a first run reaches it, so it never weighs an
// ordinary boot; while it arrives the pane already says what it is doing, and
// Continue stays live.
const ProfilesWizardPane = lazy(() =>
  import("../../../setup/ProfilesWizardPane").then((module) => ({
    default: module.ProfilesWizardPane,
  })),
);

export function ProfilesPane({
  onDone,
  onBack,
}: {
  onDone: (end: ProfilesPaneEnd) => void;
  onBack: (() => void) | undefined;
}): ReactElement {
  return (
    <Suspense
      fallback={
        <WizardPane
          eyebrow={PROFILES_WORDS.eyebrow}
          title={PROFILES_WORDS.title}
          voice={PROFILES_WORDS.voice}
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
          <p className={factCls}>{PROFILES_WORDS.reading}</p>
        </WizardPane>
      }
    >
      <ProfilesWizardPane onDone={onDone} onBack={onBack} />
    </Suspense>
  );
}
