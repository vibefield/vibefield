import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { InlineNotice } from "@vibefield/design-kit/primitives";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import { type ReactElement, type ReactNode, useEffect, useId, useRef } from "react";
import {
  BackAction,
  factCls,
  primaryCls,
  quietCls,
  WizardPane,
} from "../boot/onboarding/wizard-ui";
import type { AgentsNotice } from "../panels/agents/AgentsView";
import { ProfileMark, SignInCard } from "../panels/agents/ProfilesView";
import type { ProfilesPaneModel, ThisMacRow } from "./profiles-pane";
import { PROFILES_WORDS } from "./profiles-words";
import "./profiles-pane.css";

// The Profiles pane (track AO, AO-5; DESIGN.md §8 "The Setup Assistant's agent
// chapter" — Profiles). Controller-free, so the catalog mounts the shipping
// face: This Mac as a card in the person's own sign-ins, the profiles beside
// it, and a dashed card, Add a profile…, that grows into the pane in place
// (M1) — a name, then the agent, then that agent's own login in the pane.

/** Where Add a profile… stands. */
export type AddProfileStep =
  | { readonly kind: "offer" }
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "agent"; readonly name: string }
  /** the profile, its sign-in and its login are being made */
  | { readonly kind: "making"; readonly name: string; readonly provider: string }
  /** the agent's own login runs in the pane (the sign-in slot) */
  | { readonly kind: "signing-in"; readonly name: string; readonly provider: string }
  /** its login ended before the agent said who: not kept yet (AO-D7) */
  | {
      readonly kind: "again";
      readonly name: string;
      readonly provider: string;
      /** the sentence that says so, in the agent's name */
      readonly said: string;
    }
  | { readonly kind: "ready"; readonly name: string };

/** A login running in the pane: This Mac's own, or the new profile's. */
export interface PaneSignIn {
  readonly at: "this-mac" | "add";
  readonly provider: string;
  readonly agentLabel: string;
  /** "This Mac", or the new profile's name */
  readonly where: string;
  readonly note: string;
  readonly cancelling: boolean;
  readonly onCancel: () => void;
  /** the terminal the login runs in — the shipping SignInTerminal, or a
   * catalog's still */
  readonly terminal: ReactNode;
}

function ThisMacRows({
  rows,
  holding,
  onSignIn,
}: {
  rows: readonly ThisMacRow[];
  /** a login is open: no second one starts */
  holding: boolean;
  onSignIn: (provider: string) => void;
}): ReactElement {
  return (
    <ul className="vf-profiles-pane-rows" aria-label="This Mac's agents">
      {rows.map((row) => (
        <li key={row.provider} className="vf-profiles-pane-row">
          <span className="vf-profiles-pane-mark" aria-hidden="true">
            <AgentIcon providerId={row.provider} />
          </span>
          <span className="vf-profiles-pane-text">
            <span className="vf-profiles-pane-label">{row.label}</span>
            <span className="vf-profiles-pane-fact">{row.fact}</span>
          </span>
          {row.canSignIn ? (
            <button
              type="button"
              className="vf-profiles-pane-act"
              disabled={holding}
              aria-label={`Sign in to ${row.label} on This Mac`}
              onClick={() => onSignIn(row.provider)}
            >
              {PROFILES_WORDS.signIn}
            </button>
          ) : row.plan !== undefined ? (
            <span className="vf-profiles-pane-plan">{row.plan}</span>
          ) : (
            <span />
          )}
        </li>
      ))}
    </ul>
  );
}

/** The login in the pane; it comes into view as it opens (the glass scrolls a
 * tall pane, and the login is the one thing the person must see). */
function SignInSlot({ signIn }: { signIn: PaneSignIn }): ReactElement {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    slot.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return (
    <div ref={slot}>
      <SignInCard
        agentLabel={signIn.agentLabel}
        where={signIn.where}
        note={signIn.note}
        cancelling={signIn.cancelling}
        onCancel={signIn.onCancel}
      >
        {signIn.terminal}
      </SignInCard>
    </div>
  );
}

/** The dashed card, and what it grows into. */
function AddProfileCard({
  step,
  addable,
  signIn,
  onAdd,
  onName,
  onNext,
  onPick,
  onCancel,
  onAgain,
}: {
  step: AddProfileStep;
  addable: ProfilesPaneModel["addable"];
  signIn: PaneSignIn | null;
  onAdd: () => void;
  onName: (name: string) => void;
  onNext: () => void;
  onPick: (provider: string) => void;
  onCancel: () => void;
  onAgain: () => void;
}): ReactElement {
  const name = useRef<HTMLInputElement>(null);
  const grown = useRef<HTMLDivElement>(null);
  const offerId = useId();
  const naming = step.kind === "name";
  useEffect(() => {
    if (naming) name.current?.focus();
  }, [naming]);
  // the glass scrolls a tall pane: each step of the add, the login above all,
  // comes into view as it opens
  const shown = step.kind;
  useEffect(() => {
    if (shown !== "offer") grown.current?.scrollIntoView?.({ block: "nearest" });
  }, [shown]);
  if (step.kind === "offer") {
    // named by its title; the offer is its description, not its name
    return (
      <button
        type="button"
        className="vf-profiles-pane-add"
        aria-label={PROFILES_WORDS.add}
        aria-describedby={offerId}
        onClick={onAdd}
      >
        <FieldGlyph name="plus" size={14} />
        <span className="vf-profiles-pane-add-title">{PROFILES_WORDS.add}</span>
        <span id={offerId} className="vf-profiles-pane-add-offer">
          {PROFILES_WORDS.offer}
        </span>
      </button>
    );
  }
  if (step.kind === "ready") {
    return (
      <div ref={grown} className="vf-profiles-pane-grown" data-step="ready" role="status">
        <span className="vf-profiles-pane-ready">
          <FieldGlyph name="check" size={14} />
          {PROFILES_WORDS.ready(step.name)}
        </span>
      </div>
    );
  }
  return (
    <div ref={grown} className="vf-profiles-pane-grown" data-step={step.kind}>
      {step.kind === "name" && (
        <>
          <label className="vf-profiles-pane-step" htmlFor="vf-profiles-pane-name">
            {PROFILES_WORDS.nameLabel}
          </label>
          <input
            ref={name}
            id="vf-profiles-pane-name"
            className="vf-profiles-pane-input"
            value={step.name}
            maxLength={64}
            spellCheck={false}
            placeholder={PROFILES_WORDS.namePlaceholder}
            onChange={(event) => onName(event.target.value)}
            onKeyDown={(event) => {
              // Enter takes the add's next step, never the pane's Continue
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (step.name.trim().length > 0) onNext();
            }}
          />
          <div className="vf-profiles-pane-step-acts">
            <button type="button" className={quietCls} onClick={onCancel}>
              {PROFILES_WORDS.cancel}
            </button>
            <button
              type="button"
              className={quietCls}
              disabled={step.name.trim().length === 0}
              onClick={onNext}
            >
              {PROFILES_WORDS.next}
            </button>
          </div>
        </>
      )}
      {step.kind === "agent" && (
        <>
          <span className="vf-profiles-pane-step">{PROFILES_WORDS.agentTitle(step.name)}</span>
          <ul className="vf-profiles-pane-rows" aria-label={PROFILES_WORDS.agentTitle(step.name)}>
            {addable.map((agent) => (
              <li key={agent.provider}>
                <button
                  type="button"
                  className="vf-profiles-pane-pick"
                  onClick={() => onPick(agent.provider)}
                >
                  <span className="vf-profiles-pane-mark" aria-hidden="true">
                    <AgentIcon providerId={agent.provider} />
                  </span>
                  <span className="vf-profiles-pane-label">{agent.label}</span>
                  <FieldGlyph name="chevron" size={12} />
                </button>
              </li>
            ))}
          </ul>
          <div className="vf-profiles-pane-step-acts">
            <button type="button" className={quietCls} onClick={onCancel}>
              {PROFILES_WORDS.cancel}
            </button>
          </div>
        </>
      )}
      {step.kind === "making" && <p className={factCls}>{PROFILES_WORDS.making}</p>}
      {step.kind === "again" && (
        <>
          <p className="vf-profiles-pane-note" role="status">
            {step.said}
          </p>
          <div className="vf-profiles-pane-step-acts">
            <button type="button" className={quietCls} onClick={onCancel}>
              {PROFILES_WORDS.cancel}
            </button>
            <button type="button" className={quietCls} onClick={onAgain}>
              {PROFILES_WORDS.againTitle}
            </button>
          </div>
        </>
      )}
      {step.kind === "signing-in" && signIn !== null && signIn.at === "add" && (
        <SignInSlot signIn={signIn} />
      )}
    </div>
  );
}

/** The pane's body: the cards, the fact, a notice. Null model: the feed has
 * not answered yet. */
export function ProfilesPaneBody({
  model,
  step,
  signIn,
  notice,
  onSignIn,
  onAdd,
  onName,
  onNext,
  onPick,
  onCancelAdd,
  onAgain,
}: {
  model: ProfilesPaneModel | null;
  step: AddProfileStep;
  signIn: PaneSignIn | null;
  notice: AgentsNotice | null;
  onSignIn: (provider: string) => void;
  onAdd: () => void;
  onName: (name: string) => void;
  onNext: () => void;
  onPick: (provider: string) => void;
  onCancelAdd: () => void;
  onAgain: () => void;
}): ReactElement {
  if (model === null || model.thisMac === null) {
    return <p className="vf-profiles-pane-note">{PROFILES_WORDS.reading}</p>;
  }
  // Add a profile… grows into the pane (M1): while it is open, This Mac folds
  // to one line, so the new profile's steps and its login have the room
  const adding = step.kind !== "offer" && step.kind !== "ready";
  return (
    <div className="vf-profiles-pane">
      <div className="vf-profiles-pane-cards">
        <section className="vf-profiles-pane-card" aria-label="This Mac">
          <header className="vf-profiles-pane-card-head">
            <ProfileMark set={{ kind: "native", default: false }} size={16} />
            <span>This Mac</span>
          </header>
          {adding ? (
            <p className="vf-profiles-pane-fact">
              {model.thisMac.rows.map((row) => row.label).join(", ")}
            </p>
          ) : (
            <>
              <ThisMacRows
                rows={model.thisMac.rows}
                holding={signIn !== null}
                onSignIn={onSignIn}
              />
              {model.reading && <p className="vf-profiles-pane-note">{PROFILES_WORDS.reading}</p>}
              {signIn !== null && signIn.at === "this-mac" && <SignInSlot signIn={signIn} />}
            </>
          )}
        </section>
        {model.others.map((other) => (
          <section key={other.id} className="vf-profiles-pane-card" aria-label={other.label}>
            <header className="vf-profiles-pane-card-head">
              <ProfileMark
                set={{
                  kind: "managed",
                  default: false,
                  ...(other.glyph !== undefined ? { glyph: other.glyph } : {}),
                }}
                size={16}
              />
              <span>{other.label}</span>
            </header>
            {other.agents.length > 0 && (
              <p className="vf-profiles-pane-fact">{other.agents.join(", ")}</p>
            )}
          </section>
        ))}
        <AddProfileCard
          step={step}
          addable={model.addable}
          signIn={signIn}
          onAdd={onAdd}
          onName={onName}
          onNext={onNext}
          onPick={onPick}
          onCancel={onCancelAdd}
          onAgain={onAgain}
        />
      </div>
      <p className="vf-profiles-pane-note">{PROFILES_WORDS.fact}</p>
      {notice !== null && (
        <InlineNotice tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </InlineNotice>
      )}
    </div>
  );
}

/** The pane on the wizard's glass. Continue keeps what is there (This Mac,
 * and a profile made here); it waits while a login is open, which its own
 * Cancel ends. */
export function ProfilesWizardPaneView({
  body,
  holding,
  onContinue,
  onBack,
}: {
  body: ReactNode;
  /** a login is open in the pane */
  holding: boolean;
  onContinue: () => void;
  onBack?: (() => void) | undefined;
}): ReactElement {
  return (
    <WizardPane
      eyebrow={PROFILES_WORDS.eyebrow}
      title={PROFILES_WORDS.title}
      voice={PROFILES_WORDS.voice}
      onSubmit={() => {
        if (!holding) onContinue();
      }}
      actions={
        <>
          <button type="submit" className={primaryCls} disabled={holding}>
            Continue
          </button>
          <BackAction onBack={holding ? undefined : onBack} />
        </>
      }
    >
      {body}
      <p className={factCls}>{holding ? PROFILES_WORDS.finishFirst : PROFILES_WORDS.later}</p>
    </WizardPane>
  );
}
