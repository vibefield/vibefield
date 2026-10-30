import { uiButtonClass, uiLabelClass } from "@vibefield/design-kit";
import type { ReactElement } from "react";
import { PostureCards } from "../account/PostureCards";
import type { SyncPosture } from "../account/posture";

// TS-6 (track TS, TS-D13 = A; DESIGN.md §8 "The sync question") — the question,
// in the fields explorer in place of its tiles, when New field is asked while a
// link owes it. Controller-free: the head owns the choice, the fields added and
// the answer (`Head.tsx`); the catalog mounts this face on fixture props.

/** The question's words. The cards are `POSTURE_CHOICES`; these were ruled by
 * James on 2026-10-29 ("all four as drafted", and "projects", the cards' noun,
 * for the sheet's voice; DESIGN.md §8 "The sync question"). */
export const SYNC_QUESTION_WORDS = {
  title: "Sync new projects to your other computers?",
  voice: "This Mac is connected. You can change this in Settings → Devices.",
  earlier: "Projects from before you connected",
  earlierNote: "They stay on this Mac unless you add them.",
  act: "New field",
  cancel: "Cancel",
} as const;

export interface SyncQuestionField {
  docId: string;
  name: string;
  /** the tile's own caption: its relative time */
  caption: string;
}

export interface SyncQuestionViewProps {
  choice: SyncPosture;
  /** no live preferences, or the answer in flight */
  locked: boolean;
  earlier: readonly SyncQuestionField[];
  added: ReadonlySet<string>;
  /** the posture's refused write, in the daemon's words */
  error: string | null;
  onChoose?: (value: SyncPosture) => void;
  onToggle?: (docId: string) => void;
  onAnswer?: () => void;
  onCancel?: () => void;
}

export function SyncQuestionView({
  choice,
  locked,
  earlier,
  added,
  error,
  onChoose,
  onToggle,
  onAnswer,
  onCancel,
}: SyncQuestionViewProps): ReactElement {
  return (
    <form
      className="vf-head-question"
      aria-label="Sync question"
      onSubmit={(event) => {
        event.preventDefault();
        onAnswer?.();
      }}
    >
      <h2 className="vf-head-question-title">{SYNC_QUESTION_WORDS.title}</h2>
      <p className={uiLabelClass}>{SYNC_QUESTION_WORDS.voice}</p>
      <PostureCards
        value={choice}
        locked={locked}
        name="vf-sync-question"
        onChoose={(value) => onChoose?.(value)}
      />
      {earlier.length > 0 ? (
        <fieldset className="vf-head-question-earlier" disabled={locked}>
          <legend className="vf-head-question-legend">{SYNC_QUESTION_WORDS.earlier}</legend>
          <p className={uiLabelClass}>{SYNC_QUESTION_WORDS.earlierNote}</p>
          <ul className="vf-head-question-fields">
            {earlier.map((field) => (
              <li key={field.docId}>
                <label className="vf-head-question-field">
                  <input
                    type="checkbox"
                    checked={added.has(field.docId)}
                    onChange={() => onToggle?.(field.docId)}
                  />
                  <span className="vf-head-question-name">{field.name}</span>
                  <span className={uiLabelClass}>{field.caption}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      {error !== null ? (
        <p className="vf-head-question-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="vf-head-question-acts">
        <button type="button" className={uiButtonClass} onClick={() => onCancel?.()}>
          {SYNC_QUESTION_WORDS.cancel}
        </button>
        <button type="submit" className={uiButtonClass} data-primary="" disabled={locked}>
          {SYNC_QUESTION_WORDS.act}
        </button>
      </div>
    </form>
  );
}
