import type { ReactElement } from "react";
import {
  factCls,
  primaryCls,
  quietCls,
  WizardError,
  WizardHold,
  WizardHoldOut,
  WizardPane,
  WizardStatus,
} from "../wizard-ui";

// Setting up, then the welcome (track AO, AO-D2; track FG, FG-D21 B; DESIGN.md
// §8 "The Setup Assistant's agent chapter" and "The Setup Assistant's glass",
// §6 "the hand-over"). The end of every path. The answers are recorded first;
// then the desk opens, warms and settles beneath the glass while one line under
// the logo says what the work is doing (W4: each a fact a door reports, never a
// bar of its own); then the line becomes the welcome in place, and the glass
// hands the window to the desk it opened (W5). What went wrong is a pane.

export type OnboardingCompletionFlag =
  | { kind: "idle" }
  | { kind: "writing" }
  | { kind: "failed"; reason: string };

/** One phase of Setting up: the line it says while it runs, and under it what
 * it is doing now, in the words its door reports ("drawing the board", "1,215
 * files checked"); `failed` says the plain reason (the splash's rule). */
export interface OnboardingSetupPhase {
  readonly key: string;
  readonly line: string;
  readonly state: "waiting" | "live" | "done" | "failed";
  readonly detail?: string | undefined;
}

/** The desk's line while it opens (FG-D21 B), over the boot machine's stage. */
export const DESK_LINE = "Opening your field…";

/** History's first pass has run 8s past the desk (AO-D4): said over Start now. */
export const START_NOW_LINE =
  "Finding sessions in a history this size takes longer. It carries on in History.";

export function OnboardingSettingUpPaneView({
  phases,
  name,
  ready,
  flag,
  onRetryWrite,
  onContinueAnyway,
  onRetryPhase,
  onStartNow,
  settingsChord = "⌘,",
}: {
  phases: readonly OnboardingSetupPhase[];
  /** Who the welcome greets; null for a second user, whose end has no welcome
   * (§6.2) — the glass hands over the moment the facts are in. */
  name: string | null;
  /** The facts are in and the welcome's beat has begun. */
  ready: boolean;
  /** The durable `onboarded` write the questions end with. */
  flag: OnboardingCompletionFlag;
  onRetryWrite: () => void;
  onContinueAnyway: () => void;
  /** A failed phase's one act — the boot's own Retry for the desk. */
  onRetryPhase: () => void;
  /** AO-D4 — present once History's first pass has run 8s past the desk: go on
   * without it, and History carries on reading. */
  onStartNow?: (() => void) | undefined;
  /** The Settings chord as this platform spells it. */
  settingsChord?: string;
}): ReactElement {
  if (flag.kind === "failed") {
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
        onSubmit={onRetryWrite}
      >
        <CompletionFailure reason={flag.reason} />
      </WizardPane>
    );
  }

  const failed = phases.find((phase) => phase.state === "failed");
  if (failed !== undefined) {
    return (
      <WizardPane
        eyebrow="Setting up"
        title="Getting your desk ready."
        actions={
          <button type="submit" className={primaryCls}>
            Retry
          </button>
        }
        onSubmit={onRetryPhase}
      >
        <WizardError reason={failed.detail ?? failed.line} />
      </WizardPane>
    );
  }

  // the line is the work still going on — the first phase not done — then the welcome
  const welcome = name !== null && ready;
  const live = phases.find((phase) => phase.state !== "done") ?? phases.at(-1);
  return (
    <WizardHold face="setting-up:line">
      {welcome ? (
        <WizardStatus
          line={`Welcome to your field, ${name}.`}
          // DESIGN.md §8's discoverability, said once: a face does not say
          // "settings" the way the gear it replaced did.
          sub={`Your face in the bottom-left corner opens Settings — so does ${settingsChord}.`}
          ink
        />
      ) : (
        <WizardStatus line={live?.line ?? DESK_LINE} sub={live?.detail} />
      )}
      {!welcome && onStartNow !== undefined && (
        <WizardHoldOut now>
          <p className={`vf-wizard-hold-why ${factCls}`}>{START_NOW_LINE}</p>
          <button type="button" className={primaryCls} onClick={onStartNow}>
            Start now
          </button>
        </WizardHoldOut>
      )}
    </WizardHold>
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
