import { UserFaceView } from "@vibefield/design-kit/face";
import type { ReactElement } from "react";
import { FaceDeck, FaceFrameSwitch } from "../../../account/FacePicker";
import { faceLabel } from "../../../account/faces";
import type { FieldUserFace } from "../../../host";
import { BackAction, eyebrowCls, primaryCls, WizardError, WizardPane } from "../wizard-ui";

/** Pane 2 (UA-D17) — the name, and the face the machine dealt before the pane
 * opened. Still one decision (W1: who this field is) and one mandatory field
 * (W2: the name): the face is never blank, so Continue never waits on it. The
 * picker is already open — the frame switch under the face, the deck beside the
 * name — and the whole pane fits its shell (DESIGN.md §2.8). */
export function OnboardingFieldPaneView({
  name,
  face,
  seed,
  held,
  writing,
  error,
  onNameChange,
  onFaceChange,
  onSubmit,
  onBack,
  eyebrow = "Your field",
  autoFocus = true,
  pickerName = "vf-wizard-face",
}: {
  name: string;
  face: FieldUserFace;
  /** The user id — the sticker's tilt. */
  seed: string;
  /** Faces other users on this machine wear (`faceKey` → name). */
  held: ReadonlyMap<string, string>;
  writing: boolean;
  error: string | null;
  onNameChange: (name: string) => void;
  onFaceChange: (face: FieldUserFace) => void;
  onSubmit: () => void;
  onBack: (() => void) | undefined;
  /** "New user" for a second user on this machine (§6.2). */
  eyebrow?: string;
  autoFocus?: boolean;
  pickerName?: string;
}): ReactElement {
  return (
    <WizardPane
      eyebrow={eyebrow}
      title="What should this field call you?"
      voice="A name and a face — both yours to change later in Settings."
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
      <div className="vf-wizard-identity">
        {/* Where a switch's face lands when it arrives in Setup (DESIGN.md §8). */}
        <div className="vf-wizard-face" data-vf-switch-home={seed}>
          {/* The sticker's one big moment — or, for a coin, its engraving. */}
          <UserFaceView
            emoji={face.emoji}
            frame={face.frame}
            size={96}
            seed={seed}
            label={faceLabel(name.trim().length > 0 ? name.trim() : "You", face)}
            legend={face.frame === "coin" ? name.trim() : undefined}
          />
          <FaceFrameSwitch
            value={face}
            onChange={onFaceChange}
            disabled={writing}
            size="small"
            className="vf-wizard-frames"
          />
        </div>
        <div className="vf-wizard-identity-fields">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={eyebrowCls}>Name</span>
            <input
              type="text"
              aria-label="Your name"
              value={name}
              disabled={writing}
              autoFocus={autoFocus}
              onChange={(event) => onNameChange(event.target.value)}
              className="h-10 rounded-[12px] border border-black/10 bg-white px-3.5 text-[15px] text-black/85 outline-none transition-[border-color,box-shadow] placeholder:text-black/30 focus:border-black/25 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.05)] motion-reduce:transition-none disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-white/25 dark:focus:shadow-[0_0_0_3px_rgba(255,255,255,0.07)]"
            />
          </label>
          <FaceDeck
            value={face}
            held={held}
            onChange={onFaceChange}
            disabled={writing}
            name={pickerName}
            rows={3}
            label="Face"
          />
        </div>
      </div>
      {error !== null && <WizardError reason={`That did not save. ${error}`} />}
    </WizardPane>
  );
}
