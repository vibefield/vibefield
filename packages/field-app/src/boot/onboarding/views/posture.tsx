import type { ReactElement } from "react";
import { POSTURE_CHOICES, type SyncPostureControl } from "../../../account/posture";
import { BackAction, factCls, primaryCls, SkipAction, WizardError, WizardPane } from "../wizard-ui";

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
