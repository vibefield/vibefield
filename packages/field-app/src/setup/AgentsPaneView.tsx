import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { type ReactElement, useId } from "react";
import {
  BackAction,
  factCls,
  primaryCls,
  quietCls,
  WizardPane,
} from "../boot/onboarding/wizard-ui";
import type { AgentsPaneModel, AgentsPaneRow } from "./agents-pane";
import { AGENTS_WORDS } from "./agents-words";
import "./agents-pane.css";

// The Agents pane (track AO, AO-5; DESIGN.md §8 "The Setup Assistant's agent
// chapter" — Agents). Controller-free, so the catalog mounts the shipping face:
// the agents on this Mac, each with its own mark, its version and how it stays
// current, and a green Ready; the supported agents this Mac does not have; the
// preview ones behind More agents. Get takes the missing rows' place with AO-7.

/** What the pane knows of this Mac's agents. */
export type AgentsInventory =
  /** the inventory has not answered yet */
  | { readonly kind: "looking" }
  /** fieldd could not read it in time; the pane says so and moves on */
  | { readonly kind: "unavailable" }
  | { readonly kind: "found"; readonly model: AgentsPaneModel };

function AgentsPaneRows({
  rows,
  label,
  id,
}: {
  rows: readonly AgentsPaneRow[];
  label: string;
  id?: string | undefined;
}): ReactElement {
  return (
    <ul id={id} className="vf-agents-pane-rows" aria-label={label}>
      {rows.map((row) => (
        <li key={row.provider} className="vf-agents-pane-row" data-state={row.state}>
          <span className="vf-agents-pane-mark" aria-hidden="true">
            <AgentIcon providerId={row.provider} />
          </span>
          <span className="vf-agents-pane-text">
            <span className="vf-agents-pane-label">{row.label}</span>
            {row.fact !== undefined && <span className="vf-agents-pane-fact">{row.fact}</span>}
          </span>
          {row.state === "ready" ? (
            <span className="vf-agents-pane-ready">
              <FieldGlyph name="check" size={14} />
              {AGENTS_WORDS.ready}
            </span>
          ) : (
            <span className="vf-agents-pane-missing">{AGENTS_WORDS.missing}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The pane's body for every inventory state: what it is doing, why it cannot
 * say, or the rows — and, with nothing installed, where a first agent appears. */
export function AgentsPaneBody({
  inventory,
  moreOpen,
  onToggleMore,
  lookingAgain = false,
  onLookAgain,
}: {
  inventory: AgentsInventory;
  moreOpen: boolean;
  onToggleMore: () => void;
  lookingAgain?: boolean | undefined;
  onLookAgain: () => void;
}): ReactElement {
  const moreId = useId();
  if (inventory.kind === "looking") {
    return <p className="vf-agents-pane-note">{AGENTS_WORDS.looking}</p>;
  }
  if (inventory.kind === "unavailable") {
    return (
      <div className="vf-agents-pane-first">
        <p className="vf-agents-pane-note">{AGENTS_WORDS.unavailable}</p>
        <button type="button" className={quietCls} disabled={lookingAgain} onClick={onLookAgain}>
          {lookingAgain ? AGENTS_WORDS.lookingAgain : AGENTS_WORDS.tryAgain}
        </button>
      </div>
    );
  }
  const { model } = inventory;
  return (
    <div className="vf-agents-pane">
      <AgentsPaneRows rows={model.rows} label="Agents on this Mac" />
      {model.more.length > 0 && (
        <>
          <button
            type="button"
            className="vf-agents-pane-more"
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? moreId : undefined}
            onClick={onToggleMore}
          >
            {AGENTS_WORDS.more}
            <FieldGlyph name="chevron" size={12} />
          </button>
          {moreOpen && <AgentsPaneRows id={moreId} rows={model.more} label={AGENTS_WORDS.more} />}
        </>
      )}
      {model.first && (
        <div className="vf-agents-pane-first">
          <p className="vf-agents-pane-note">{AGENTS_WORDS.firstFact}</p>
          <button type="button" className={quietCls} disabled={lookingAgain} onClick={onLookAgain}>
            {lookingAgain ? AGENTS_WORDS.lookingAgain : AGENTS_WORDS.lookAgain}
          </button>
        </div>
      )}
    </div>
  );
}

/** The voice says "VibeField found these" only once it has found them; before
 * that, and with none, it says what VibeField does with any agent. */
export function agentsVoice(inventory: AgentsInventory): string {
  return inventory.kind === "found" && !inventory.model.first
    ? AGENTS_WORDS.voice
    : AGENTS_WORDS.firstVoice;
}

/** The title claims only what the inventory said: ready agents, or none. */
export function agentsTitle(inventory: AgentsInventory): string {
  if (inventory.kind !== "found") return AGENTS_WORDS.plainTitle;
  return inventory.model.first ? AGENTS_WORDS.firstTitle : AGENTS_WORDS.title;
}

/** The pane on the wizard's glass: the title says what was found, Continue
 * moves on, and a Mac with no agent says where one appears later (W3). */
export function AgentsWizardPaneView({
  inventory,
  moreOpen,
  onToggleMore,
  lookingAgain,
  onLookAgain,
  onContinue,
  onBack,
}: {
  inventory: AgentsInventory;
  moreOpen: boolean;
  onToggleMore: () => void;
  lookingAgain?: boolean;
  onLookAgain: () => void;
  onContinue: () => void;
  onBack?: (() => void) | undefined;
}): ReactElement {
  const first = inventory.kind === "found" && inventory.model.first;
  return (
    <WizardPane
      eyebrow={AGENTS_WORDS.eyebrow}
      title={agentsTitle(inventory)}
      voice={agentsVoice(inventory)}
      onSubmit={onContinue}
      actions={
        <>
          <button type="submit" className={primaryCls}>
            Continue
          </button>
          <BackAction onBack={onBack} />
        </>
      }
    >
      <AgentsPaneBody
        inventory={inventory}
        moreOpen={moreOpen}
        onToggleMore={onToggleMore}
        lookingAgain={lookingAgain}
        onLookAgain={onLookAgain}
      />
      {first && <p className={factCls}>{AGENTS_WORDS.later}</p>}
    </WizardPane>
  );
}
