import type { ReactElement } from "react";
import { factCls, primaryCls, quietCls, WizardError, WizardPane } from "../wizard-ui";

// Setting up, then Ready (track AO, AO-D2; DESIGN.md §8 "The Setup Assistant's
// agent chapter", §6 "the hand-over"). The end of every path. The answers are
// recorded first; then the desk opens, warms and settles beneath the glass
// while this pane lists the real phases (W4: each a fact a door reports, never
// a bar of its own); then its title becomes the welcome in place (M1) and the
// glass hands the window to the desk it opened (W5).

export type OnboardingCompletionFlag =
  | { kind: "idle" }
  | { kind: "writing" }
  | { kind: "failed"; reason: string };

/** One line of Setting up. `live` breathes (DESIGN.md §6's loop); `done` takes
 * its check; `failed` says the plain reason (the splash's rule). */
export interface OnboardingSetupPhase {
  readonly key: string;
  readonly label: string;
  readonly state: "waiting" | "live" | "done" | "failed";
  /** What it is doing, in the words its door reports ("drawing the board"). */
  readonly detail?: string | undefined;
}

export function OnboardingSettingUpPaneView({
  phases,
  name,
  ready,
  flag,
  onRetryWrite,
  onContinueAnyway,
  onRetryPhase,
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

  const failed = phases.some((phase) => phase.state === "failed");
  const welcome = name !== null && ready;
  return (
    <WizardPane
      eyebrow={welcome ? "Ready" : "Setting up"}
      title={
        // One element (M1): both titles hold one cell from the start, so the
        // welcome cross-fades in place and nothing below it moves.
        <span className="vf-wizard-title-swap" data-ready={welcome ? "true" : "false"}>
          <span aria-hidden={welcome}>Getting your desk ready.</span>
          {name !== null && <span aria-hidden={!welcome}>Welcome to your field, {name}.</span>}
        </span>
      }
      actions={
        failed ? (
          <button type="submit" className={primaryCls}>
            Retry
          </button>
        ) : null
      }
      onSubmit={() => {
        if (failed) onRetryPhase();
      }}
    >
      <ul className="vf-wizard-phases" aria-label="Setting up">
        {phases.map((phase) => (
          <li key={phase.key} className="vf-wizard-phase" data-state={phase.state}>
            <span aria-hidden="true" className="vf-wizard-phase-mark">
              {phase.state === "done" ? "✓" : ""}
            </span>
            <span className="vf-wizard-phase-label">{phase.label}</span>
            {phase.detail !== undefined && (
              <span className="vf-wizard-phase-detail">{phase.detail}</span>
            )}
          </li>
        ))}
      </ul>
      {name !== null && (
        // DESIGN.md §8's discoverability, said once: a face does not say
        // "settings" the way the gear it replaced did. It arrives with the welcome.
        <p
          className={`vf-wizard-ready-line ${factCls}`}
          data-ready={welcome ? "true" : "false"}
          aria-hidden={!welcome}
        >
          Your face in the bottom-left corner opens Settings — so does {settingsChord}.
        </p>
      )}
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
