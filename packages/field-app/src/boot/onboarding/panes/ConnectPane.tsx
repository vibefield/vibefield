import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useState } from "react";
import type { LinkBeginStep, LinkFace } from "../../../account/link";
import { OnboardingConnectPaneView } from "../views/connect";

/** The Connect pane — the link, and since UA-P-0g the place it BEGINS. The same act as
 * Settings → Account: the same method, the same phrase on the button, and the
 * same rule about where the face comes from — `user.link.subscribe` moves it,
 * this call never does. Only the in-flight beat and a refusal live here.
 *
 * The client rather than the view owns it for the same reason `PosturePane`
 * does: `views/` is the Electron-free surface the catalog
 * mounts, and a view that reached for a daemon could not be shown there. */
export function ConnectPane({
  face,
  onContinue,
  onSkip,
  onBack,
}: {
  face: LinkFace;
  onContinue: () => void;
  onSkip: () => void;
  onBack: (() => void) | undefined;
}): ReactElement {
  const client = useFielddClient();
  const [step, setStep] = useState<LinkBeginStep>({ kind: "idle" });

  const begin = async (): Promise<void> => {
    setStep({ kind: "pending" });
    try {
      await client.request("user.link.begin", {});
      setStep({ kind: "idle" });
    } catch (cause) {
      setStep({
        kind: "failed",
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  return (
    <OnboardingConnectPaneView
      face={face}
      beginStep={step}
      onBeginLink={() => void begin()}
      onContinue={onContinue}
      onSkip={onSkip}
      onBack={onBack}
    />
  );
}
