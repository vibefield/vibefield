import { UserFaceView } from "@vibefield/design-kit/face";
import type { ReactElement } from "react";
import { FacePicker } from "../../account/FacePicker";
import { faceLabel } from "../../account/faces";
import {
  LINK_ACT_LABEL,
  LINK_ACT_PENDING_LABEL,
  type LinkBeginStep,
  type LinkFace,
  readableTime,
} from "../../account/link";
import { POSTURE_CHOICES, type SyncPostureControl } from "../../account/posture";
import type { FieldUserFace } from "../../host";
import {
  eyebrowCls,
  factCls,
  primaryCls,
  quietCls,
  SkipAction,
  voiceCls,
  WizardError,
  WizardPane,
} from "./wizard-ui";

export type OnboardingCompletionFlag =
  | { kind: "idle" }
  | { kind: "writing" }
  | { kind: "failed"; reason: string };

function BackAction({ onBack }: { onBack: (() => void) | undefined }): ReactElement | null {
  if (onBack === undefined) return null;
  return (
    <button type="button" className={quietCls} onClick={onBack}>
      Back
    </button>
  );
}

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

/** Pane 2 (UA-D17) — the name, and the face the machine dealt before the pane
 * opened. Still one decision (W1: who this field is) and one mandatory field
 * (W2: the name): the face is never blank, so Continue never waits on it. */
export function OnboardingFieldPaneView({
  name,
  face,
  seed,
  held,
  pickerOpen,
  writing,
  error,
  onNameChange,
  onFaceChange,
  onPickerToggle,
  onSubmit,
  onBack,
  autoFocus = true,
  pickerName = "vf-wizard-face",
}: {
  name: string;
  face: FieldUserFace;
  /** The user id — the sticker's tilt. */
  seed: string;
  /** Faces other users on this machine wear (`faceKey` → name). */
  held: ReadonlyMap<string, string>;
  pickerOpen: boolean;
  writing: boolean;
  error: string | null;
  onNameChange: (name: string) => void;
  onFaceChange: (face: FieldUserFace) => void;
  onPickerToggle: () => void;
  onSubmit: () => void;
  onBack: (() => void) | undefined;
  autoFocus?: boolean;
  pickerName?: string;
}): ReactElement {
  return (
    <WizardPane
      eyebrow="Your field"
      title="What should this field call you?"
      voice="A name and a face for this machine's user. The face was dealt to you — both are yours to change later."
      onSubmit={onSubmit}
      actions={
        <>
          <button type="submit" className={primaryCls} disabled={writing}>
            {writing ? "Saving…" : "Continue"}
          </button>
          <BackAction onBack={onBack} />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="vf-wizard-identity">
          <div className="vf-wizard-face">
            {/* The sticker's one big moment — or, for a coin, its engraving. */}
            <UserFaceView
              emoji={face.emoji}
              frame={face.frame}
              size={112}
              seed={seed}
              label={faceLabel(name.trim().length > 0 ? name.trim() : "You", face)}
              legend={face.frame === "coin" ? name.trim() : undefined}
            />
            <button
              type="button"
              className={quietCls}
              aria-expanded={pickerOpen}
              disabled={writing}
              onClick={onPickerToggle}
            >
              {pickerOpen ? "Done" : "Change face…"}
            </button>
          </div>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={eyebrowCls}>Name</span>
            <input
              type="text"
              aria-label="Your name"
              value={name}
              disabled={writing}
              autoFocus={autoFocus}
              onChange={(event) => onNameChange(event.target.value)}
              className="h-11 rounded-[12px] border border-black/10 bg-white px-3.5 text-[15px] text-black/85 outline-none transition-[border-color,box-shadow] placeholder:text-black/30 focus:border-black/25 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.05)] motion-reduce:transition-none disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-white/25 dark:focus:shadow-[0_0_0_3px_rgba(255,255,255,0.07)]"
            />
          </label>
        </div>
        {pickerOpen && (
          <FacePicker
            value={face}
            held={held}
            disabled={writing}
            name={pickerName}
            onChange={onFaceChange}
          />
        )}
        {error !== null && <WizardError reason={`That did not save. ${error}`} />}
      </div>
    </WizardPane>
  );
}

export function OnboardingSettingUpPaneView({
  stagesDone,
  onContinue,
}: {
  stagesDone: readonly string[];
  onContinue: () => void;
}): ReactElement {
  return (
    <WizardPane
      eyebrow="Setting up"
      title="Your field is already running."
      voice="Nothing to wait for — this all happened while you were reading."
      actions={
        <button type="submit" className={primaryCls}>
          Continue
        </button>
      }
      onSubmit={onContinue}
    >
      <ul className="flex flex-col gap-1.5">
        {stagesDone.map((stage) => (
          <li key={stage} className={`flex items-center gap-2 ${factCls}`}>
            <span aria-hidden="true" className="vf-wizard-stage-check">
              ✓
            </span>
            {stage}
          </li>
        ))}
      </ul>
    </WizardPane>
  );
}

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

export function OnboardingPosturePaneView({
  posture,
  onDone,
  onBack,
  radioName = "vf-wizard-posture",
}: {
  posture: SyncPostureControl;
  onDone: () => void;
  onBack: (() => void) | undefined;
  radioName?: string;
}): ReactElement {
  const locked = posture.unavailable || posture.pending;

  return (
    <WizardPane
      eyebrow="Your devices"
      title="What should new projects do?"
      voice="This is only the default for new documents. Any single one can go the other way afterwards."
      onSubmit={onDone}
      actions={
        <>
          <button type="submit" className={primaryCls}>
            Continue
          </button>
          <SkipAction label="Skip" onSkip={onDone} />
          <BackAction onBack={onBack} />
        </>
      }
    >
      <div role="radiogroup" aria-label="Sync posture" className="grid gap-2 sm:grid-cols-2">
        {POSTURE_CHOICES.map((card) => {
          const selected = posture.posture === card.value;
          return (
            <label
              key={card.value}
              className={`rounded-[14px] border p-3 text-left transition-[background-color,border-color,transform] focus-within:ring-2 focus-within:ring-[var(--vf-select)] motion-reduce:transition-none ${
                selected
                  ? "border-black/25 bg-black/[0.04] dark:border-white/30 dark:bg-white/[0.08]"
                  : "border-black/10 hover:bg-black/[0.02] dark:border-white/10 dark:hover:bg-white/[0.04]"
              } ${locked ? "cursor-not-allowed opacity-45" : "cursor-pointer active:scale-[0.99]"}`}
            >
              <input
                type="radio"
                name={radioName}
                className="sr-only"
                checked={selected}
                disabled={locked}
                onChange={() => void posture.set(card.value)}
              />
              <div className="text-[13px] font-medium leading-5 text-black/80 dark:text-white/80">
                {card.title}
              </div>
              <div className={`mt-0.5 ${factCls}`}>{card.description}</div>
            </label>
          );
        })}
      </div>
      {posture.unavailable && posture.status !== "loading" && (
        <p className={factCls}>
          This daemon is not reporting preferences, so the answer cannot be saved from here yet.
        </p>
      )}
      {posture.writeError !== null && <WizardError reason={posture.writeError} />}
    </WizardPane>
  );
}

export function OnboardingReadyPaneView({
  profileName,
  flag,
  onRetry,
  onContinueAnyway,
}: {
  profileName: string;
  flag: OnboardingCompletionFlag;
  onRetry: () => void;
  onContinueAnyway: () => void;
}): ReactElement {
  return (
    <WizardPane
      eyebrow="Ready"
      title={`Welcome to your field, ${profileName}.`}
      voice="Everything from here is the real thing."
      actions={
        flag.kind === "failed" ? (
          <>
            <button type="submit" className={primaryCls}>
              Try again
            </button>
            <button type="button" className={quietCls} onClick={onContinueAnyway}>
              Continue anyway
            </button>
          </>
        ) : null
      }
      onSubmit={() => {
        if (flag.kind === "failed") onRetry();
      }}
    >
      {flag.kind === "failed" && <CompletionFailure reason={flag.reason} />}
    </WizardPane>
  );
}

export function OnboardingFinishingPaneView({
  flag,
  onRetry,
  onContinueAnyway,
}: {
  flag: OnboardingCompletionFlag;
  onRetry: () => void;
  onContinueAnyway: () => void;
}): ReactElement {
  if (flag.kind !== "failed") {
    return (
      <div className="vf-wizard-pane w-full max-w-[30rem]">
        <span className={eyebrowCls}>Setup</span>
        <p className={`mt-2 ${factCls}`}>Finishing up…</p>
      </div>
    );
  }

  return (
    <WizardPane
      eyebrow="Setup"
      title="That did not save."
      actions={
        <>
          <button type="submit" className={primaryCls}>
            Try again
          </button>
          <button type="button" className={quietCls} onClick={onContinueAnyway}>
            Continue anyway
          </button>
        </>
      }
      onSubmit={onRetry}
    >
      <CompletionFailure reason={flag.reason} />
    </WizardPane>
  );
}

function CompletionFailure({ reason }: { reason: string }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <WizardError reason={`Setup could not be recorded. ${reason}`} />
      <span className={factCls}>Continuing without it means setup asks again next time.</span>
    </div>
  );
}
