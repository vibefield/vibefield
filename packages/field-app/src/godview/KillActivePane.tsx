import { TerminalTerminateResult } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { type ReactElement, useEffect, useState } from "react";
import { getRendererLogger } from "../logging";
import type { DeckSession } from "./pane-faces";

// The kill affordance (GT-3, GT-D5): the deck's one way to END a session.
//
// GT-D5 splits two gestures that every other terminal app conflates. Closing a
// pane DETACHES — the window is a viewport, and the shell behind it keeps
// running on a floor that outlives the app. Killing is the other thing, and
// because it is the only irreversible act the deck offers it is deliberate,
// audited, and confirmed.
//
// It goes through fieldd's `terminal.terminate` and not through the workspace's
// own runtime, even though the runtime has a `terminate` and the connection is
// right there. That is the whole point: fieldd is the policy seat, and an act
// that ends a user's processes belongs on the record with an actor beside it.
// The bytes never come this way (EL2); one control call does.
//
// It lives here rather than on the pane because ghosttea's `decoratePane` seam
// spends its whole vocabulary on a label and an accent colour — there is no
// per-pane action slot in 0.8.0, and forking the library's pane chrome to add
// one would be a far larger commitment than this affordance is worth. So it is
// an overlay chip over the deck's top-right (DESIGN.md §5 overlay-chip tier),
// naming the ACTIVE pane, which is the one every workspace hotkey already acts
// on.

/** How the affordance currently reads. Two steps, never one: a click that ends
 * processes must be reachable only by meaning it (DESIGN.md §8, the destructive
 * uninstall precedent). */
type Step =
  | { kind: "idle" }
  | { kind: "arming" }
  | { kind: "killing" }
  | { kind: "failed"; reason: string };

export function KillActivePane({
  session,
  fieldd,
}: {
  session: DeckSession;
  fieldd: FielddClient;
}): ReactElement | null {
  const [step, setStep] = useState<Step>({ kind: "idle" });

  // A confirm belongs to the pane it was armed on. Switching panes with the
  // question still up would leave a "yes" pointing at a session the user was no
  // longer looking at — the worst possible kind of correct click.
  useEffect(() => setStep({ kind: "idle" }), [session.id]);

  // Esc disarms, consistently (DESIGN.md §7). Still not capture-phase, though
  // the reason changed on 2026-08-04: the overlay's own Escape ladder is gone
  // (⌘⎋ is the only Godview toggle now) and Escape belongs to whatever holds
  // focus. Bubble phase is how this stays the narrow exception — it is armed
  // only while a question is on screen, and a terminal that wants the key keeps
  // it, because a pane with a kill confirm up is not a pane being typed into.
  useEffect(() => {
    if (step.kind !== "arming") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setStep({ kind: "idle" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step.kind]);

  // A pane whose session already ended has nothing to kill, and offering it
  // would be chrome that lies about what it can do.
  if (session.exited === true) return null;

  const kill = async (): Promise<void> => {
    setStep({ kind: "killing" });
    try {
      const result = TerminalTerminateResult.parse(
        await fieldd.request("terminal.terminate", { sessionId: session.id }),
      );
      // `terminated: false` means the session was already gone — the desired
      // end state holds, so this is not a failure and says nothing. The pane's
      // own face is what reports the ending, from the floor's event, and it
      // will do so whether the ladder ran now or a moment ago.
      if (!result.terminated) {
        getRendererLogger()
          .child({ component: "godview" })
          .warn(
            "renderer.godview.kill_already_gone",
            `Session ${session.id} was already gone when the kill was asked for`,
          );
      }
      setStep({ kind: "idle" });
    } catch (cause) {
      setStep({
        kind: "failed",
        reason: cause instanceof Error ? cause.message : String(cause),
      });
      getRendererLogger()
        .child({ component: "godview" })
        .error("renderer.godview.kill_failed", `Session ${session.id} could not be ended`, cause);
    }
  };

  return (
    <div className="vf-godview-kill" data-kill-step={step.kind}>
      {step.kind === "arming" ? (
        <>
          <span className="vf-godview-kill-question">end this session and its processes?</span>
          <button
            type="button"
            className="vf-godview-kill-action is-destructive"
            onClick={() => void kill()}
          >
            kill
          </button>
          <button
            type="button"
            className="vf-godview-kill-action"
            onClick={() => setStep({ kind: "idle" })}
          >
            cancel
          </button>
        </>
      ) : (
        <>
          {step.kind === "failed" && (
            <span className="vf-godview-kill-question">{step.reason}</span>
          )}
          <button
            type="button"
            className="vf-godview-kill-action is-destructive"
            disabled={step.kind === "killing"}
            onClick={() => setStep({ kind: "arming" })}
          >
            {step.kind === "killing" ? "ending…" : "kill session"}
          </button>
        </>
      )}
    </div>
  );
}
