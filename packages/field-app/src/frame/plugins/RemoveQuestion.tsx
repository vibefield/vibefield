import { type ReactElement, useLayoutEffect, useRef } from "react";
import type { RemoveQuestion } from "./plugins-remove";
import { REMOVE_WORDS } from "./plugins-words";

// REMOVE…, AS DRAWN (MK-4f; DESIGN.md §8, Remove… drawn under "Real progress"; §8 "The destructive
// uninstall affordance"): at the second column's foot, and pressed, its question in place — the
// install card's look, its sentences, Cancel leading and focused, Remove trailing, and under them
// Remove it and its data… in the danger ink, which turns the question into its second, whose
// confirm is Remove data. One click is never irreversible. Its numbers are §8's, in `plugins.css`;
// its words are `plugins-words.ts`'s. The controller owns the question; this view moves the
// keyboard to Cancel as each question stands, and holds nothing else.

function QuestionView({
  question,
  sending,
  takeFocus,
  onFurther,
  onConfirm,
  onCancel,
}: {
  question: RemoveQuestion;
  sending: boolean;
  takeFocus: boolean;
  onFurther: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  const cancel = useRef<HTMLButtonElement>(null);
  // Cancel leads and holds the keyboard as the question stands (§8: one press is never
  // irreversible)
  useLayoutEffect(() => {
    if (takeFocus) cancel.current?.focus({ preventScroll: true });
  }, [takeFocus]);
  return (
    <section className="vf-plugins-card" aria-label={question.ask}>
      <h3 className="vf-plugins-card-ask">{question.ask}</h3>
      <div className="vf-plugins-card-part">
        {question.lines.map((line) => (
          <p key={line} className="vf-plugins-card-line">
            {line}
          </p>
        ))}
      </div>
      <div className="vf-plugins-card-acts">
        <button
          ref={cancel}
          type="button"
          className="vf-plugins-card-cancel"
          disabled={sending}
          onClick={onCancel}
        >
          {REMOVE_WORDS.cancel}
        </button>
        <button
          type="button"
          className="vf-plugins-act"
          data-tone={question.danger ? "danger" : undefined}
          disabled={sending}
          onClick={onConfirm}
        >
          {question.confirm}
        </button>
      </div>
      {question.further !== null && (
        <button
          type="button"
          className="vf-plugins-remove-data"
          disabled={sending}
          onClick={onFurther}
        >
          {question.further}
        </button>
      )}
    </section>
  );
}

export function RemoveView({
  question,
  sending,
  refused,
  live,
  takeFocus,
  onAsk,
  onFurther,
  onConfirm,
  onCancel,
}: {
  /** the question standing; null: Remove… alone */
  question: RemoveQuestion | null;
  sending: boolean;
  /** fieldd refused the last removal: said under Remove…, never its text */
  refused: boolean;
  /** whether Remove… takes a press (fieldd answers) */
  live: boolean;
  takeFocus: boolean;
  onAsk: () => void;
  onFurther: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  if (question !== null) {
    return (
      // a question of its own each step, so the keyboard goes to its Cancel as it stands
      <QuestionView
        key={question.ask}
        question={question}
        sending={sending}
        takeFocus={takeFocus}
        onFurther={onFurther}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }
  return (
    <div className="vf-plugins-remove">
      <button type="button" className="vf-plugins-card-cancel" disabled={!live} onClick={onAsk}>
        {REMOVE_WORDS.act}
      </button>
      {refused && <p className="vf-plugins-page-refused">{REMOVE_WORDS.refused}</p>}
    </div>
  );
}
