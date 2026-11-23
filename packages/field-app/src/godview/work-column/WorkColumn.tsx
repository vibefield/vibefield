import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  drawsGroup,
  type WorkAgent,
  type WorkFacets,
  type WorkProject,
  type WorkSession,
} from "../monitor/work-facets";
import { useCardAim, usePinHold, usePressedFocus } from "../profiles-column/column-hold";
import { handFocusHome } from "../profiles-column/column-parts";
import { useColumnPointer } from "../profiles-column/useColumnPointer";
import { WORK_PARTS, WorkColumnView, type WorkKey, workKey, workTargetOf } from "./WorkColumnView";

// WL-1 (DESIGN.md §8 "Godview's work column", 2026-11-23) — THE WORK COLUMN'S CONTROLLER, the stage's own chrome. It
// reads what the stage already holds — the groups and the sessions of the rows on the stage (`useMonitorAgents`), the
// lens as it stands — and keeps what is open: the card a pointer or the keyboard is on, or a click pinned. The lens is
// the stage's own filter (SE-D2, extended: one state with search's tokens), chosen through the stage's setters. Its
// reach, its focus and its closing are the profiles column's (`column-hold.ts`), its cards mirrored to its left.

/** What a press inside keeps a pinned card: the pill, or a stand of its cards. */
const WORK_INSIDE = ".vf-work-column, .vf-work-stand";

const NO_PROJECTS: readonly WorkProject[] = Object.freeze([]);
const NO_AGENTS: readonly WorkAgent[] = Object.freeze([]);

export interface WorkColumnProps {
  /** the groups of the rows on the stage (`workFacets`) */
  work: WorkFacets;
  /** the rows on the stage as the cards list them (`workSessions`) */
  sessions: readonly WorkSession[];
  /** the lens: the chosen project and agent as the stage has them (null = every one) */
  project: string | null;
  agent: string | null;
  /** the stage's setters: a project's or an agent's id, or null for every one */
  onProject: (id: string | null) => void;
  onAgent: (id: string | null) => void;
  /** the stage's cards layer (§8 "Where the cards stand"); absent, the cards stand in place */
  cardLayer?: HTMLElement | null | undefined;
  /** the terminals fill the window: no card opens or stands over them, and a circle still chooses */
  covered?: boolean | undefined;
}

function WorkColumnController({
  work,
  sessions,
  project,
  agent,
  onProject,
  onAgent,
  cardLayer,
  covered = false,
}: WorkColumnProps): ReactElement | null {
  // §8 "Which circles": a group of one value is drawn only while its choice stands
  const projects = drawsGroup(work.projects, project) ? work.projects : NO_PROJECTS;
  const agents = drawsGroup(work.agents, agent) ? work.agents : NO_AGENTS;
  const keys = useMemo(
    () =>
      new Set([
        ...projects.map((facet) => workKey({ group: "project", id: facet.id })),
        ...agents.map((facet) => workKey({ group: "agent", id: facet.id })),
      ]),
    [projects, agents],
  );
  const [pointed, setPointed] = useState<WorkKey | null>(null);
  const [pinned, setPinned] = useState<WorkKey | null>(null);
  // §8 "Focus is pointing": the keyboard's own target, beside the pointer's and the pin, with no timers
  const [keyboardTarget, setKeyboardTarget] = useState<WorkKey | null>(null);
  const pressed = usePressedFocus();
  // the pointer, then the keyboard, then the pin, as the profiles column orders them (c2), each only while its circle
  // stands: a pointer peeks over a keyboard's card as over a pinned one
  const open =
    [pointed, keyboardTarget, pinned].find((key) => key !== null && keys.has(key)) ?? null;
  const columnRef = useRef<HTMLDivElement>(null);
  const headingTo = useCardAim(open, cardLayer, columnRef, WORK_PARTS);
  const { point, clear } = useColumnPointer(open, setPointed, headingTo);
  // §8 "Pinned": closing is one act — the keyboard home if the card holds it, then the pin, the keyboard's card and
  // the pointer's hold, so the card stays closed until the pointer or the keyboard leaves and returns
  const closeCard = useCallback((): void => {
    handFocusHome(columnRef.current, WORK_PARTS);
    setPinned(null);
    setKeyboardTarget(null);
    clear();
  }, [clear]);
  // behind full-window terminals the pointer reaches no card
  const columnPoint = useCallback(
    (key: WorkKey | null): void => {
      if (!covered) point(key);
    },
    [covered, point],
  );
  // focus came onto a circle or its card, or left them: a press's focus is the pointer's and shows nothing, and a
  // pointer resting on another circle lets go, so the card the keyboard reached shows
  const keyboardPoint = (key: WorkKey | null): void => {
    if (key === null) {
      setKeyboardTarget(null);
      return;
    }
    if (pressed.current || covered) return;
    if (pointed !== null && pointed !== key && key !== keyboardTarget) clear();
    setKeyboardTarget(key);
  };
  // a circle that leaves the column (its last session ended) takes its pin and the keyboard's card along
  useEffect(() => {
    if (pinned !== null && !keys.has(pinned)) setPinned(null);
  }, [keys, pinned]);
  useEffect(() => {
    if (keyboardTarget !== null && !keys.has(keyboardTarget)) setKeyboardTarget(null);
  }, [keys, keyboardTarget]);
  // ruling 11's hold: a pinned card holds Godview's keys, Esc closes it, a press outside lets go of the pin
  const releasePin = useCallback((): void => setPinned(null), []);
  usePinHold(pinned, closeCard, releasePin, WORK_INSIDE);
  // GV-D11's other half: the terminals fill the window, so no card floats over them
  useEffect(() => {
    if (covered) closeCard();
  }, [covered, closeCard]);
  return (
    <WorkColumnView
      projects={projects}
      agents={agents}
      sessions={sessions}
      project={project}
      agent={agent}
      open={open}
      pinned={open !== null && open === pinned}
      pinnedKey={pinned}
      cardLayer={cardLayer}
      columnRef={columnRef}
      onPoint={columnPoint}
      onKeyboardTarget={keyboardPoint}
      onCircle={(key) => {
        const target = workTargetOf(key);
        if (target === null) return;
        // the lens: a click shows only its sessions and pins its card; on the chosen one, all again, closed
        const clears = (target.group === "project" ? project : agent) === target.id;
        const choose = target.group === "project" ? onProject : onAgent;
        choose(clears ? null : target.id);
        if (clears) closeCard();
        else if (!covered) setPinned(key);
      }}
      onClose={closeCard}
    />
  );
}

/** M195's rule for the stage's chrome: the monitor renders on every model publish, and the column renders only when
 * one of its own inputs moves (its groups and sessions are held while what they say is the same). */
export const WorkColumn = memo(WorkColumnController);
