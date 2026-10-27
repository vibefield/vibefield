import type { ReactElement } from "react";
import {
  LINK_ACT_LABEL,
  LINK_ACT_PENDING_LABEL,
  type LinkBeginStep,
  type LinkFace,
  readableTime,
} from "../../../account/link";
import {
  BackAction,
  factCls,
  primaryCls,
  quietCls,
  SkipAction,
  voiceCls,
  WizardError,
  WizardPane,
} from "../wizard-ui";

export function OnboardingConnectPaneView({
  face,
  beginStep,
  onBeginLink,
  onContinue,
  onSkip,
  onBack,
}: {
  face: LinkFace;
  /** UA-P-0g — whether the act is in flight, and what the daemon said if it
   * refused. The FACE still comes from the subscription; this is only what the
   * subscription cannot know. */
  beginStep: LinkBeginStep;
  onBeginLink: () => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack: (() => void) | undefined;
}): ReactElement {
  let body: ReactElement;
  let primary: ReactElement | null = null;

  /** The act, in this pane's chrome: the pane's primary action, so Enter and
   * the pointer reach the same object. */
  const linkButton = (
    <button
      type="button"
      className={primaryCls}
      disabled={beginStep.kind === "pending"}
      onClick={onBeginLink}
    >
      {beginStep.kind === "pending" ? LINK_ACT_PENDING_LABEL : LINK_ACT_LABEL}
    </button>
  );

  switch (face.kind) {
    case "loading":
      body = <p className={factCls}>Asking this device about its node…</p>;
      break;
    case "unavailable":
      body = (
        <p className={factCls}>
          This daemon does not report link status, so there is nothing to connect from here.
          Everything local keeps working.
        </p>
      );
      break;
    case "offline":
      // UA-P-0g — the pane that used to be a dead end. The act starts here.
      primary = linkButton;
      body = (
        <div className="flex flex-col gap-1.5">
          <p className={factCls}>
            Not linked yet. Linking signs you in to Tailscale in your browser, and this pane names
            the account the moment it lands.
          </p>
          {beginStep.kind === "failed" && <WizardError reason={beginStep.reason} />}
        </div>
      );
      break;
    case "refused":
      if (face.canBegin) primary = linkButton;
      body = (
        <div className="flex flex-col gap-1.5">
          <p className={voiceCls}>{face.title}</p>
          <p className={factCls}>{face.detail}</p>
          {!face.canBegin && (
            <p className={factCls}>
              Linking is refused until that file is moved aside — this field never overwrites an
              identity record by guessing. You can carry on; everything local works without it.
            </p>
          )}
          {beginStep.kind === "failed" && <WizardError reason={beginStep.reason} />}
        </div>
      );
      break;
    case "capturing":
      primary =
        face.authUrl === null ? null : (
          <a href={face.authUrl} target="_blank" rel="noreferrer" className={primaryCls}>
            {LINK_ACT_LABEL}
          </a>
        );
      body = (
        <p className={factCls}>
          {face.authUrl === null
            ? "Asking the tailnet who this node is. The sign-in address appears here as soon as the node offers one — you can also carry on and let it land in the background."
            : "Finish signing in in your browser. This pane names the account as soon as the node comes up — you can also carry on and let it land in the background."}
        </p>
      );
      break;
    default:
      body = (
        <div className="flex flex-col gap-1.5">
          <p className={voiceCls}>
            Linked as <span className="font-medium">{face.link.login ?? "this device"}</span>
            {face.link.tailnet !== undefined && (
              <>
                {" on "}
                <span className="font-mono text-[13px]">{face.link.tailnet}</span>
              </>
            )}
            .
          </p>
          <p className={factCls}>
            <span className="tabular-nums">{readableTime(face.link.linkedAt)}</span>
            {face.nodeState !== null && ` · node ${face.nodeState}`}
          </p>
        </div>
      );
  }

  return (
    <WizardPane
      eyebrow="Your devices"
      title="Connect your devices."
      voice="Your devices, your tailnet — nobody else's. Everything here works locally without it; linking is what lets your other machines see the same field."
      onSubmit={onContinue}
      actions={
        <>
          {primary}
          <button type="submit" className={primary === null ? primaryCls : quietCls}>
            Continue
          </button>
          <SkipAction label="Skip" onSkip={onSkip} />
          <BackAction onBack={onBack} />
        </>
      }
    >
      {body}
    </WizardPane>
  );
}
