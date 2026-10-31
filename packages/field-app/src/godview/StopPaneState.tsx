import type { ReactElement, RefObject } from "react";
import { createPortal } from "react-dom";
import { useDeckAgentFacts } from "./monitor/GodviewAgentsProvider";
import { describeStop, type StopPaneFace } from "./pane-faces";

/**
 * DS-D4 (a) — THE PANE WHOSE RUN A PERSON'S STOP HAS NOT STOPPED (DESIGN.md §8
 * "A run a Stop has not stopped"; `pane-faces.ts` `describeStop` words it, the
 * field row's `stop` decides it). The held-edge readout's figure, as item 42's
 * seat draws it: over the veil, the word full and its rest at 40%, and one
 * caption line under them. **Ending the run** while fieldd ends a run whose
 * turn did not stop; **Still running** when fieldd will take the Stop no
 * further, with **End run**, the figure's one pointer target. Everything else
 * in the figure takes no pointer, so a click elsewhere reaches the pane.
 */
export function StopPaneStateView({
  face,
  onEndRun,
}: {
  face: StopPaneFace;
  onEndRun?: (() => void) | undefined;
}): ReactElement {
  return (
    <div className="vf-godview-stop-state" role="status" data-stop-state={face.state}>
      <div className="vf-godview-stop-state-veil" aria-hidden="true" />
      <div className="vf-godview-stop-state-bloom" aria-hidden="true" />
      <div className="vf-godview-stop-state-glow" aria-hidden="true" />
      <p className="vf-godview-stop-state-words">
        <span className="vf-godview-stop-state-word">{face.word}</span>{" "}
        <span className="vf-godview-stop-state-rest">{face.rest}</span>
      </p>
      <p className="vf-godview-stop-state-caption">
        {face.caption}
        {face.act === "end-run" && onEndRun !== undefined ? (
          <>
            {" "}
            <button type="button" className="vf-godview-stop-state-act" onClick={onEndRun}>
              End run
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * The controller: one pane's session, its run's Stop read from the deck's
 * facts (which change only when a drawn fact does), portaled into ghosttea's
 * pane element beside the frame. It appears when fieldd's hold reaches a state
 * the press cannot answer, plays its entrance once (its stylesheet), and goes
 * at once when the hold goes. `endRun` is a ref so the deck's stable frame
 * reads the current act.
 */
export function StopPaneState({
  pane,
  sessionId,
  endRun,
}: {
  pane: HTMLElement;
  sessionId: string;
  endRun: RefObject<(sessionId: string) => void>;
}): ReactElement | null {
  const { stops } = useDeckAgentFacts();
  const face = describeStop(stops.get(sessionId));
  if (face === undefined) return null;
  return createPortal(
    <StopPaneStateView face={face} onEndRun={() => endRun.current(sessionId)} />,
    pane,
  );
}
