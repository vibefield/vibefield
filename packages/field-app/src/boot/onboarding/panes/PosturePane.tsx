import type { ReactElement } from "react";
import { useSyncPosture } from "../../../account/posture";
import { OnboardingPosturePaneView } from "../views/posture";

/** The posture question — the same two cards, the same words, the same key as
 * Settings → Account (they share `POSTURE_CHOICES` and `useSyncPosture`). */
export function PosturePane({
  onBack,
  onDone,
}: {
  onBack: (() => void) | undefined;
  onDone: () => void;
}): ReactElement {
  const posture = useSyncPosture();
  return <OnboardingPosturePaneView posture={posture} onDone={onDone} onBack={onBack} />;
}
