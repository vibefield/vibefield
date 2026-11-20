import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { UiButton } from "@vibefield/design-kit/primitives";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import type { ReactElement } from "react";
import {
  CREW_PASSING_WORDS,
  CREW_STATE_WORDS,
  CREW_WORDS,
  type CrewCard,
  type CrewCardRow,
} from "./crew-card";
import "./crew-card.css";

// CHAT'S CREW CARD, DRAWN (SP-1e2's renderer half; DESIGN.md §8 "Chat's crew card"; RU-18, the Sparks page's
// `crewCard`) — controller-free, so the catalog draws this markup on fixtures. It hangs under its crew's act line in
// Vela's flow (`ThreadFlowView`): the head (its title, the shared model dim, the count and its ring), a row per member
// in the order they started, and the foot (Open in Godview, then its one line). A group named by its head; the rows
// that take a press, then Open in Godview, are buttons in its order, and an Ended row is not one. What it says is
// `crewCardsOf`'s (`crew-card.ts`).
// Since SP-1e4 (2026-11-19; DESIGN.md §8 "The crew's acts") Pause all and Stop all follow Open in Godview, 6 apart,
// while a member is at work, each handing the card as drawn to the controller; and a row's passing word ("Stopping
// agent…", "Pausing current turn…", "Still running") stands alone in its state's place, the row marked with it.

export interface CrewCardViewProps {
  card: CrewCard;
  /** a row pressed: that member's pane in Godview (absent: the catalog, where nothing opens) */
  onRow?: ((runtimeRunId: string) => void) | undefined;
  /** Open in Godview pressed (absent: the catalog) */
  onOpenGodview?: (() => void) | undefined;
  /** SP-1e4 — Pause all pressed, with the card as drawn (absent: the catalog) */
  onPauseAll?: ((card: CrewCard) => void) | undefined;
  /** SP-1e4 — Stop all pressed, with the card as drawn (absent: the catalog) */
  onStopAll?: ((card: CrewCard) => void) | undefined;
  /** the rows whose reveal runs now: each waits, and a second press does nothing */
  revealing?: ReadonlySet<string> | undefined;
}

/** The ring, 16 round, drawn from the top: a 2.5 track, and over it 2.5 filled by the members no longer at work. */
const RING_R = 6.75;
const RING_LENGTH = 2 * Math.PI * RING_R;

function Ring({ fill }: { fill: number }): ReactElement {
  return (
    <svg
      className="vf-crew-ring"
      data-fill={String(fill)}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle className="vf-crew-ring-track" cx="8" cy="8" r={RING_R} />
      <circle
        className="vf-crew-ring-fill"
        cx="8"
        cy="8"
        r={RING_R}
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH * (1 - Math.min(1, Math.max(0, fill)))}
      />
    </svg>
  );
}

function RowBody({ row }: { row: CrewCardRow }): ReactElement {
  // SP-1e4 — while a passing word holds it stands alone in the state's place: no breath, no check
  const drawn = row.passing === null ? row.state : null;
  const word =
    row.passing !== null
      ? CREW_PASSING_WORDS[row.passing]
      : row.state === null
        ? null
        : CREW_STATE_WORDS[row.state];
  return (
    <>
      <span className="vf-crew-mark" aria-hidden="true">
        <AgentIcon providerId={row.agent} />
      </span>
      <span className="vf-crew-name">{row.name}</span>
      <span className="vf-crew-model">{row.model ?? ""}</span>
      <span className="vf-crew-state">
        {drawn === "working" ? <span className="vf-crew-breath" aria-hidden="true" /> : null}
        {drawn === "done" ? <FieldGlyph name="check" size={12} /> : null}
        {word === null ? null : <span>{word}</span>}
      </span>
    </>
  );
}

export function CrewCardView({
  card,
  onRow,
  onOpenGodview,
  onPauseAll,
  onStopAll,
  revealing,
}: CrewCardViewProps): ReactElement {
  const { count } = card;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a card that reports and its buttons, not a fieldset of form inputs
    <div className="vf-crew-card" role="group" aria-label={card.label}>
      <div className="vf-crew-head">
        <span className="vf-crew-title">
          <b>{card.title}</b>
          {card.dim === "" ? null : <span className="vf-crew-dim">{card.dim}</span>}
        </span>{" "}
        {count.words === "" ? null : (
          <span className="vf-crew-count">
            {count.check ? <FieldGlyph name="check" size={13} /> : null}
            <span>{count.words}</span>
            {count.ring === null ? null : <Ring fill={count.ring} />}
          </span>
        )}
      </div>
      {card.rows.length === 0 ? null : (
        <div className="vf-crew-rows">
          {card.rows.map((row) => {
            const marks = {
              ...(row.state === null ? {} : { "data-state": row.state }),
              // SP-1e4 — its passing word, by which "Still running" takes the attention ink
              ...(row.passing === null ? {} : { "data-passing": row.passing }),
            };
            // an Ended row takes no press: its words are read as they stand
            if (!row.pressable)
              return (
                <div key={row.runtimeRunId} className="vf-crew-row" {...marks}>
                  <RowBody row={row} />
                </div>
              );
            const waiting = revealing?.has(row.runtimeRunId) === true;
            return (
              <button
                key={row.runtimeRunId}
                type="button"
                className="vf-crew-row"
                {...marks}
                aria-label={row.label}
                {...(waiting ? { "aria-busy": true, "data-waiting": "" } : {})}
                onClick={() => {
                  if (!waiting) onRow?.(row.runtimeRunId);
                }}
              >
                <RowBody row={row} />
              </button>
            );
          })}
        </div>
      )}
      <div className="vf-crew-foot">
        <div className="vf-crew-acts">
          <UiButton className="vf-crew-open" variant="quiet" onClick={() => onOpenGodview?.()}>
            <FieldGlyph name="panes" size={14} />
            <span>{CREW_WORDS.openGodview}</span>
          </UiButton>
          {/* SP-1e4 — each of the crew's acts stands while it has a member to take (S7): never a press that does
              nothing, so a crew whose only member at work waits on you shows neither */}
          {card.acts.pause.length === 0 ? null : (
            <UiButton
              className="vf-crew-act"
              variant="quiet"
              data-act="pause-all"
              onClick={() => onPauseAll?.(card)}
            >
              {CREW_WORDS.pauseAll}
            </UiButton>
          )}
          {card.acts.stop.length === 0 ? null : (
            <UiButton
              className="vf-crew-act"
              variant="quiet"
              data-act="stop-all"
              onClick={() => onStopAll?.(card)}
            >
              {CREW_WORDS.stopAll}
            </UiButton>
          )}
        </div>
        {card.line === null ? null : <p className="vf-crew-line">{card.line}</p>}
      </div>
    </div>
  );
}
