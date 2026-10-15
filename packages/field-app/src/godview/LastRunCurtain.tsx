import { type ReactElement, useId } from "react";
import type { LastRunQuestion, LastRunState } from "./last-run";

/**
 * WHAT THE LAST RUN LEFT — the curtain (LR, James 2026-10-15; DESIGN.md §8,
 * the deck, "What the last run left").
 *
 * Godview opens on last run's picture: every view draws the board as the last
 * run left it, still (the window's feed over fieldd's picture, `last-run.ts`),
 * and this stands over it — a veil of the monitor's own ground, and in the
 * middle of the window the question in the readouts' voice: the count huge, a
 * mono line of what each answer does, and the two answers. Neither answer is
 * drawn as the safe one, because neither is (GT-3): restoring starts agents,
 * starting clean forgets them. The view circles stay above it (the head), so
 * every view's picture can be looked at before answering.
 */
export function LastRunCurtain({
  state,
  onRestore,
  onStartClean,
  onContinue,
  now = new Date(),
}: {
  state: LastRunState;
  onRestore: () => void;
  onStartClean: () => void;
  onContinue: () => void;
  /** the clock the eyebrow's "when" is read against (a seam for tests) */
  now?: Date;
}): ReactElement | null {
  const wordsId = useId();
  if (state.phase !== "asking" && state.phase !== "restoring" && state.phase !== "restored") {
    return null;
  }
  const { question } = state;
  const restoring = state.phase === "restoring";
  return (
    <div
      className="vf-last-run"
      role="dialog"
      aria-modal="true"
      aria-labelledby={wordsId}
      data-phase={state.phase}
    >
      <div className="vf-last-run-veil" aria-hidden="true" />
      <div className="vf-last-run-say">
        <p className="vf-last-run-eyebrow">{eyebrow(question, now)}</p>
        {state.phase === "restored" ? (
          <>
            <h2 id={wordsId} className="vf-last-run-words">
              {state.resumed} <i>of</i> {question.agents.length}{" "}
              {question.agents.length === 1 ? "agent" : "agents"} <i>resumed</i>
            </h2>
            <ul className="vf-last-run-failures">
              {state.failed.map((failure) => (
                <li key={`${failure.name}\0${failure.reason}`}>
                  <b>{failure.name}</b> — {failure.reason}
                </li>
              ))}
            </ul>
            <div className="vf-last-run-actions">
              {/* the curtain is modal: its one answer takes the keys */}
              <button type="button" className="vf-last-run-act" onClick={onContinue} autoFocus>
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id={wordsId} className="vf-last-run-words">
              {countWords(question)}
            </h2>
            <p className="vf-last-run-line" aria-live="polite">
              {restoring ? restoringLine(question) : answerLine(question)}
            </p>
            {question.unplaced > 0 && !restoring ? (
              <p className="vf-last-run-note">{unplacedLine(question.unplaced)}</p>
            ) : null}
            <div className="vf-last-run-actions">
              <button
                type="button"
                className="vf-last-run-act"
                onClick={onRestore}
                disabled={restoring}
                // the curtain is modal: its first answer takes the keys
                autoFocus
              >
                {restoring ? "Restoring…" : "Restore"}
              </button>
              <button
                type="button"
                className="vf-last-run-act"
                onClick={onStartClean}
                disabled={restoring}
              >
                Start clean
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The count, huge: the nouns at full ink, the joint at 40% (the readouts'
 * verb rule, §8). */
function countWords(question: LastRunQuestion): ReactElement {
  const agents = question.agents.length;
  const parts: string[] = [];
  if (agents > 0) parts.push(`${agents} ${agents === 1 ? "agent" : "agents"}`);
  if (question.shells > 0) {
    parts.push(`${question.shells} ${question.shells === 1 ? "terminal" : "terminals"}`);
  }
  return (
    <>
      {parts.map((part, index) => (
        <span key={part}>
          {index > 0 ? <i> · </i> : null}
          {part}
        </span>
      ))}
    </>
  );
}

/** What each answer does, in the numbers the words state (§9). */
export function answerLine(question: LastRunQuestion): string {
  const agents = question.agents.length;
  const conversations = agents === 1 ? "the agent's conversation" : "each agent's conversation";
  // GT-5c's honesty, kept: a shell reopens in its folder only when that folder
  // is on this machine; a peer's pane, or one that never said, opens at home
  const shells =
    question.shells === 1
      ? "opens a new shell in the terminal's folder (at home if it had none here)"
      : "opens a new shell in each terminal's folder (at home where one had none here)";
  const restore =
    agents > 0 && question.shells > 0
      ? `Restore resumes ${conversations} where it was and ${shells}.`
      : agents > 0
        ? `Restore resumes ${conversations} where it was.`
        : `Restore ${shells}.`;
  return `${restore} Start clean lets ${agents + question.shells === 1 ? "it" : "them"} go.`;
}

function restoringLine(question: LastRunQuestion): string {
  const agents = question.agents.length;
  if (agents === 0) return "Restoring…";
  return `Resuming ${agents} ${agents === 1 ? "agent" : "agents"}…`;
}

function unplacedLine(unplaced: number): string {
  return unplaced === 1
    ? "1 shell that had no pane can't come back."
    : `${unplaced} shells that had no pane can't come back.`;
}

/** "Last run · 15:39" — when the picture was last taken, as a clock on the
 * day it was, with the day when it was not today. No picture: "Last run". */
export function eyebrow(question: LastRunQuestion, now: Date): string {
  if (question.asOf === undefined) return "Last run";
  const at = new Date(question.asOf);
  if (Number.isNaN(at.getTime())) return "Last run";
  const clock = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = (date: Date): string => date.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(at) === day(now)) return `Last run · ${clock}`;
  if (day(at) === day(yesterday)) return `Last run · yesterday ${clock}`;
  const date = at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Last run · ${date} ${clock}`;
}
