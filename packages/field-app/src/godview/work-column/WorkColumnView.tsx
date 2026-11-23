import { type ReactElement, type Ref, useId, useRef } from "react";
import { plural } from "../../frame/peek-live";
import {
  sessionsUnder,
  type WorkAgent,
  type WorkProject,
  type WorkSession,
  type WorkTarget,
} from "../monitor/work-facets";
import { CardStand } from "../profiles-column/CardStand";
import {
  type ColumnParts,
  cardKeys,
  keepsKeyboard,
  useOverflowMark,
} from "../profiles-column/column-parts";
import { AgentMark, ProjectMark } from "./WorkMarks";
import "./work-column.css";

// WL-1 (DESIGN.md §8 "Godview's work column", 2026-11-23) — WHAT RUNS, AT THE STAGE'S TOP RIGHT: one circle per live
// project in its bodies' colour, then one per agent, in a pill that is the profiles column's twin, and each circle a
// lens. A card beside a circle lists the sessions under it, and its foot holds the click's own act. Controller-free:
// the stage's controller (`WorkColumn.tsx`) hands it the groups, the sessions, the lens, what is open and every act.

/** A circle's target as the column's pointer, keyboard and cards name it: its group, then its id. */
export type WorkKey = string;

export const workKey = (target: WorkTarget): WorkKey => `${target.group}:${target.id}`;

/** The target a key names; none for a key that names neither group. An id may hold a colon: only the first divides. */
export function workTargetOf(key: WorkKey): WorkTarget | null {
  const at = key.indexOf(":");
  const group = key.slice(0, at);
  const id = key.slice(at + 1);
  if (at < 0 || id === "") return null;
  if (group === "project") return { group, id };
  if (group === "agent") return { group, id };
  return null;
}

/** The work column's own parts (`column-parts.ts`): its cards stand LEFT of the pill, each item and stand named by
 * its key. */
export const WORK_PARTS: ColumnParts = {
  column: "vf-work-column",
  list: "vf-work-circles",
  item: "vf-work-item",
  circle: "vf-work-circle",
  stand: "vf-work-stand",
  tabStops: ".vf-work-circle",
  side: "left",
  targetOf: (node) => node.dataset.target,
};

/** The column's circle size, the profiles column's. */
const CIRCLE_MARK = { project: 18, agent: 16 } as const;

/** A circle in words (§8 "Said"): its name, its sessions, how many wait, and its lens. */
export function workCircleWords(facet: WorkProject | WorkAgent, chosen: boolean): string {
  const waiting = facet.waiting > 0 ? `, ${facet.waiting} waiting` : "";
  const lens = chosen ? ", showing only its sessions" : ", click to show only its sessions";
  return `${facet.label}, ${plural(facet.sessions, "session")}${waiting}${lens}`;
}

/** The card's one act: the click's own (§8 "Its foot"). */
export function workActWords(target: WorkTarget, label: string, chosen: boolean): string {
  if (!chosen) return `Show only ${label}`;
  return target.group === "project" ? "Show every project" : "Show every agent";
}

export interface WorkColumnViewProps {
  /** the projects the column draws, in the order their first sessions came; empty while the group is not drawn */
  projects: readonly WorkProject[];
  /** the agents, by the same rule */
  agents: readonly WorkAgent[];
  /** the sessions on the stage, as the cards list them */
  sessions: readonly WorkSession[];
  /** the lens: the chosen project and agent as the stage has them */
  project: string | null;
  agent: string | null;
  /** the circle whose card stands open, pointed at or pinned */
  open: WorkKey | null;
  /** the open card was clicked open (it holds the keys; Esc closes it) */
  pinned: boolean;
  /** the circle whose card a click pinned, whether its card shows or another circle peeks over it */
  pinnedKey: WorkKey | null;
  /** the stage's cards layer (§8 "Where the cards stand"); absent, the cards stand in place */
  cardLayer?: HTMLElement | null | undefined;
  /** the column's own element: the controller finds a circle through it to hand the keyboard home */
  columnRef?: Ref<HTMLDivElement> | undefined;
  /** the pointer came onto a circle, or left them (null) */
  onPoint: (key: WorkKey | null) => void;
  /** focus came onto a circle or its card, or left them (null); the controller counts only the keyboard's */
  onKeyboardTarget?: ((key: WorkKey | null) => void) | undefined;
  /** a circle, or its card's act: the lens, and the pin */
  onCircle: (key: WorkKey) => void;
  onClose: () => void;
}

function WorkCardView({
  id,
  target,
  facet,
  chosen,
  sessions,
  onAct,
}: {
  id: string;
  target: WorkTarget;
  facet: WorkProject | WorkAgent;
  chosen: boolean;
  sessions: readonly WorkSession[];
  onAct: () => void;
}): ReactElement {
  const rows = sessionsUnder(sessions, target);
  const waiting = rows.filter((row) => row.dot === "blocked").length;
  return (
    <div id={id} className="vf-work-card" role="dialog" aria-label={facet.label}>
      <div className="vf-work-card-head">
        {"colour" in facet ? (
          <ProjectMark ink={facet.colour} size={15} />
        ) : (
          <AgentMark id={facet.id} shell={facet.shell} size={15} />
        )}
        <b className="vf-work-card-name">{facet.label}</b>
        <span className="vf-work-card-count">
          {plural(rows.length, "session")}
          {waiting > 0 ? <em>{` · ${waiting} waiting`}</em> : null}
        </span>
      </div>
      <div className="vf-work-card-rows">
        {rows.map((row) => (
          <div key={row.id} className="vf-work-card-row">
            <i className="vf-work-dot" data-dot={row.dot} aria-hidden="true" />
            {target.group === "agent" ? (
              <ProjectMark ink={row.project === undefined ? undefined : row.colour} size={14} />
            ) : row.agent !== undefined ? (
              <AgentMark id={row.agent} shell={row.shell} size={14} />
            ) : (
              <span aria-hidden="true" />
            )}
            <span className="vf-work-card-words">
              <span>{target.group === "agent" ? row.projectName : row.agentLabel}</span>
              <small>{row.state}</small>
            </span>
          </div>
        ))}
      </div>
      <div className="vf-work-card-foot">
        <button type="button" className="vf-work-card-act" onClick={onAct}>
          {workActWords(target, facet.label, chosen)}
        </button>
      </div>
    </div>
  );
}

export function WorkColumnView({
  projects,
  agents,
  sessions,
  project,
  agent,
  open,
  pinned,
  pinnedKey,
  cardLayer,
  columnRef,
  onPoint,
  onKeyboardTarget,
  onCircle,
  onClose,
}: WorkColumnViewProps): ReactElement | null {
  const cardId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const count = projects.length + agents.length;
  useOverflowMark(listRef, cardLayer !== null && cardLayer !== undefined, count);
  if (count === 0) return null;
  const circle = (target: WorkTarget, facet: WorkProject | WorkAgent): ReactElement => {
    const key = workKey(target);
    const chosen = (target.group === "project" ? project : agent) === target.id;
    const isOpen = open === key;
    return (
      // the pointer or the keyboard on a circle or its card shows the card; the circle is the control
      <div
        key={key}
        className="vf-work-item"
        data-target={key}
        {...(isOpen && pinned ? { "data-pinned": "" } : {})}
        onPointerEnter={() => onPoint(key)}
        onPointerLeave={() => onPoint(null)}
        onFocus={() => onKeyboardTarget?.(key)}
        onBlur={(event) => {
          if (!keepsKeyboard(event.relatedTarget, event.currentTarget, key, WORK_PARTS)) {
            onKeyboardTarget?.(null);
          }
        }}
        onKeyDown={
          isOpen
            ? (event) => cardKeys(event, cardLayer, key, pinned, onClose, WORK_PARTS)
            : undefined
        }
      >
        <button
          type="button"
          className="vf-work-circle"
          data-group={target.group}
          aria-label={workCircleWords(facet, chosen)}
          aria-pressed={chosen}
          aria-expanded={isOpen}
          {...(isOpen ? { "aria-controls": cardId, "data-open": "" } : {})}
          {...(pinnedKey === key ? { "data-pinned": "" } : {})}
          onClick={() => onCircle(key)}
        >
          {"colour" in facet ? (
            <ProjectMark ink={facet.colour} size={CIRCLE_MARK.project} />
          ) : (
            <AgentMark id={facet.id} shell={facet.shell} size={CIRCLE_MARK.agent} />
          )}
          {facet.waiting > 0 ? <i className="vf-work-blocked" aria-hidden="true" /> : null}
        </button>
        {isOpen ? (
          <CardStand layer={cardLayer} parts={WORK_PARTS} target={key}>
            <WorkCardView
              id={cardId}
              target={target}
              facet={facet}
              chosen={chosen}
              sessions={sessions}
              onAct={() => onCircle(key)}
            />
          </CardStand>
        ) : null}
      </div>
    );
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a column of buttons — the projects and the agents — not a fieldset of form inputs
    <div
      ref={columnRef}
      className="vf-work-column"
      role="group"
      aria-label="Projects and agents"
      {...(cardLayer ? { "data-cards": "layer" } : {})}
    >
      <div ref={listRef} className="vf-work-circles">
        {projects.map((facet) => circle({ group: "project", id: facet.id }, facet))}
        {projects.length > 0 && agents.length > 0 ? (
          <span className="vf-work-gap" aria-hidden="true" />
        ) : null}
        {agents.map((facet) => circle({ group: "agent", id: facet.id }, facet))}
      </div>
    </div>
  );
}
