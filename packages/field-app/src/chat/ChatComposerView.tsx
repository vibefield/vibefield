import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { SegmentedControl, UiPill } from "@vibefield/design-kit/primitives";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
import {
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useId,
} from "react";
import { CARD_INDEX } from "../frame/cards/CardFace";
import { menuRowId } from "./agent-chip-menu";
import { AT_WORDS, type AtAgentRow, type AtList, type AtRow, type AtSessionRow } from "./at-rows";
import { chipLabel, type DraftChip, type DraftPart, draftPlaceholder } from "./composer-draft";
import type { AgentMenuRow, EffortChoice } from "./new-spark";
import "./chat-composer.css";

// CHAT'S COMPOSER, THE VIEW (SP-1d; DESIGN.md §8 "Chat's composer"; LN-D3) — controller-free, so the catalog mounts
// this exact markup on fixtures. `draft mic send` at the thread's foot, on the line's glass, and @'s list grown upward
// from the caret: the agents to start and the sessions running (CH-D5 A), or, once an agent is taken, that agent's
// menu in the list's own box (its model and effort). Restored from the line's view in git
// (`0e2ad08bc:packages/field-app/src/frame/ComposerLine.tsx`) under the composer's own names; what it DOES is
// `ChatComposer.tsx`'s.

/** The editor's own events — the controller's, passed through untouched. */
export interface ChatEditorHandlers {
  onInput?: (event: FormEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void;
}

/** What @'s box shows: its rows, or the menu of the agent just taken. `left` is the box's left in the composer's px,
 * 10 before the @ it grew from. */
export type AtShown =
  | {
      readonly kind: "rows";
      readonly left: number;
      readonly list: AtList;
      /** the hot row's id — what Return or Tab takes */
      readonly hot: string | null;
    }
  | {
      readonly kind: "menu";
      readonly left: number;
      /** the agent's menu (`agentChipMenuOf`): its head, Its own model, its picker's models */
      readonly rows: readonly AgentMenuRow[];
      readonly effort?: EffortChoice | undefined;
      /** the hot model row's id ("" for Its own model) — what Return or Tab keeps */
      readonly hot: string | null;
    };

export interface ChatComposerViewProps {
  /** the spark's name: who a message goes to */
  name: string;
  /** what the editor is drawn with; the editor is the person's while they type, redrawn from this only when
   * `revision` changes */
  seed?: readonly DraftPart[] | undefined;
  revision?: number | undefined;
  /** nothing typed or set: the placeholder shows */
  blank?: boolean | undefined;
  /** there is something to send: send is inverted */
  armed?: boolean | undefined;
  /** a send runs: send waits, and a second press does nothing */
  busy?: boolean | undefined;
  /** @'s list, or an agent's menu in its box, while it is open */
  at?: AtShown | null | undefined;
  /** the composer's own box: the hand's place for cards (the prompt target) */
  boxRef?: Ref<HTMLDivElement> | undefined;
  editorRef?: Ref<HTMLDivElement> | undefined;
  editor?: ChatEditorHandlers | undefined;
  onSend?: (() => void) | undefined;
  /** take a row of @'s list */
  onTake?: ((row: AtRow) => void) | undefined;
  /** point at a row of @'s list, or a model of an agent's menu */
  onHot?: ((id: string) => void) | undefined;
  /** choose a model of an agent's menu (null: Its own model) */
  onModel?: ((model: string | null) => void) | undefined;
  onEffort?: ((value: string) => void) | undefined;
}

/** An agent's menu, as a reader hears it: "Claude Code's model". */
function menuLabel(rows: readonly AgentMenuRow[]): string {
  const head = rows.find((row) => row.kind === "agent");
  return head?.kind === "agent" ? `${head.agent.label}'s model` : "Its model";
}

/** A chip's mark: an agent's or a session's, its agent's at 15; a card's, its kind's index glyph at 13. */
function ChipMark({ chip }: { chip: DraftChip }): ReactElement {
  if (chip.kind === "card") return <FieldGlyph name={CARD_INDEX[chip.card.kind]} size={13} />;
  return (
    <span className="vf-chat-chip-mark" aria-hidden="true">
      <AgentIcon providerId={chip.agent} />
    </span>
  );
}

/** The data a chip's element says of itself: its kind, and a card's kind. */
function chipData(chip: DraftChip): Record<string, string> {
  return chip.kind === "card"
    ? { "data-chip": "card", "data-card": chip.card.kind }
    : { "data-chip": chip.kind };
}

/** A chip, as the editor sets it in the sentence: never editable itself, so the editor's Backspace takes it whole.
 * Its × is a glyph, shown on hover. An agent's chip opens its menu again when it is pressed. */
export function ChatChipView({ chip }: { chip: DraftChip }): ReactElement {
  const label = chipLabel(chip);
  return (
    <span
      className="vf-chat-chip"
      {...chipData(chip)}
      data-chip-id={chip.id}
      contentEditable={false}
      title={label}
    >
      <ChipMark chip={chip} />
      <span className="vf-chat-chip-label">{label}</span>
      <button
        type="button"
        className="vf-chat-chip-x"
        data-chip-remove={chip.id}
        aria-label={`Remove ${label}`}
        tabIndex={-1}
      >
        <FieldGlyph name="close" size={10} />
      </button>
    </span>
  );
}

/** A row of @'s list: a button the editor never loses the caret to. */
function AtRowButton({
  row,
  hot,
  onTake,
  onHot,
  children,
}: {
  row: AtRow;
  hot: string | null;
  onTake: ((row: AtRow) => void) | undefined;
  onHot: ((id: string) => void) | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      className="vf-chat-at-row"
      data-row={row.id}
      data-kind={row.kind}
      tabIndex={-1}
      {...(hot === row.id ? { "data-hot": "true" } : {})}
      onPointerEnter={() => onHot?.(row.id)}
      onClick={() => onTake?.(row)}
    >
      {children}
    </button>
  );
}

function AgentRowBody({ row }: { row: AtAgentRow }): ReactElement {
  return (
    <>
      <span className="vf-chat-at-mark" aria-hidden="true">
        <AgentIcon providerId={row.agent} />
      </span>
      <span className="vf-chat-at-label">{row.label}</span>
      {row.pill === null ? null : <UiPill className="vf-chat-at-pill">{row.pill}</UiPill>}
    </>
  );
}

function SessionRowBody({ row }: { row: AtSessionRow }): ReactElement {
  return (
    <>
      <span className="vf-chat-at-mark" aria-hidden="true">
        <AgentIcon providerId={row.agent} />
      </span>
      <span className="vf-chat-at-label">
        <b>{row.handle}</b>
        <small>
          {row.label}
          {row.word === null ? null : (
            <>
              {" · "}
              <span {...(row.word === "Needs you" ? { "data-tone": "attention" } : {})}>
                {row.word}
              </span>
            </>
          )}
        </small>
      </span>
    </>
  );
}

/** @'s rows (DESIGN.md §8 "Chat's composer", @'s rows in Chat): read bottom-up, nearest first — "Start an agent"
 * above, "Running in its profiles" against the composer. A group with no rows is left out; one that can't be read yet
 * or at all says so in its rows' place. */
export function AtRowsView({
  list,
  hot,
  onTake,
  onHot,
}: {
  list: AtList;
  hot: string | null;
  onTake?: ((row: AtRow) => void) | undefined;
  onHot?: ((id: string) => void) | undefined;
}): ReactElement {
  return (
    <>
      {list.reading ? (
        <>
          <div className="vf-chat-at-eye">{AT_WORDS.agents}</div>
          <div className="vf-chat-at-quiet">{AT_WORDS.reading}</div>
        </>
      ) : null}
      {list.agents.length === 0 ? null : (
        <>
          <div className="vf-chat-at-eye">{AT_WORDS.agents}</div>
          {list.agents.map((row) => (
            <AtRowButton key={row.id} row={row} hot={hot} onTake={onTake} onHot={onHot}>
              <AgentRowBody row={row} />
            </AtRowButton>
          ))}
        </>
      )}
      {list.sessionsFailed ? (
        <>
          <div className="vf-chat-at-eye">{AT_WORDS.sessions}</div>
          <div className="vf-chat-at-quiet">{AT_WORDS.sessionsFailed}</div>
        </>
      ) : list.sessions.length === 0 ? null : (
        <>
          <div className="vf-chat-at-eye">{AT_WORDS.sessions}</div>
          {list.sessions.map((row) => (
            <AtRowButton key={row.id} row={row} hot={hot} onTake={onTake} onHot={onHot}>
              <SessionRowBody row={row} />
            </AtRowButton>
          ))}
        </>
      )}
      {list.quiet === null ? null : <div className="vf-chat-at-quiet">{list.quiet}</div>}
    </>
  );
}

/** An agent's menu, in @'s box (DESIGN.md §8 "Chat's composer", an agent's model and effort): the New spark sheet's
 * agent menu for the one agent — its head, Its own model, then its picker's models — and Effort under a model that
 * has one. */
export function AtAgentMenuView({
  rows,
  effort,
  hot,
  onModel,
  onEffort,
  onHot,
}: {
  rows: readonly AgentMenuRow[];
  effort?: EffortChoice | undefined;
  hot: string | null;
  onModel?: ((model: string | null) => void) | undefined;
  onEffort?: ((value: string) => void) | undefined;
  onHot?: ((id: string) => void) | undefined;
}): ReactElement {
  const chosen = effort?.values.find((value) => value.on)?.id;
  return (
    <>
      {rows.map((row, index) => {
        if (row.kind === "agent") {
          return (
            <div key={`agent-${row.agent.id}`} className="vf-chat-at-head">
              <span>{row.agent.label}</span>
              {row.under === undefined ? null : <small>{row.under}</small>}
            </div>
          );
        }
        if (row.kind === "note") {
          return (
            <div key={`note-${index}`} className="vf-chat-at-quiet">
              {row.words}
            </div>
          );
        }
        const id = menuRowId(row.id);
        return (
          <button
            key={`model-${id}`}
            type="button"
            role="menuitemradio"
            aria-checked={row.on}
            className="vf-chat-at-row"
            data-row={id}
            data-kind="model"
            tabIndex={-1}
            {...(hot === id ? { "data-hot": "true" } : {})}
            onPointerEnter={() => onHot?.(id)}
            onClick={() => onModel?.(row.id)}
          >
            <span className="vf-chat-at-label">{row.label}</span>
            {row.on ? <FieldGlyph name="check" size={12} /> : null}
          </button>
        );
      })}
      {effort === undefined || chosen === undefined ? null : (
        <div className="vf-chat-at-effort">
          <span>{effort.label}</span>
          <SegmentedControl
            size="small"
            label={effort.label}
            options={effort.values.map((value) => ({ id: value.id, label: value.label }))}
            value={chosen}
            onChange={(value) => onEffort?.(value)}
          />
        </div>
      )}
    </>
  );
}

export function ChatComposerView({
  name,
  seed = [],
  revision = 0,
  blank = true,
  armed = false,
  busy = false,
  at = null,
  boxRef,
  editorRef,
  editor,
  onSend,
  onTake,
  onHot,
  onModel,
  onEffort,
}: ChatComposerViewProps): ReactElement {
  const placeholder = draftPlaceholder(name);
  const atId = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: the composer is an editor and two buttons, not a fieldset of form inputs
    <div ref={boxRef} className="vf-chat-composer" role="group" aria-label={`Message ${name}`}>
      <div className="vf-chat-draft">
        {/* biome-ignore lint/a11y/useSemanticElements: the draft is an editor with chips set in the sentence (D1), which no input or textarea can hold */}
        <div
          key={revision}
          ref={editorRef}
          className="vf-chat-input"
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          role="textbox"
          aria-label={`Message ${name}`}
          aria-placeholder={placeholder}
          aria-haspopup="menu"
          {...(at === null ? {} : { "aria-controls": atId })}
          spellCheck
          {...editor}
        >
          {/* Runs of text are bare text nodes, as typing makes them; a normalized draft never holds two side by side. */}
          {seed.map((part) =>
            part.kind === "text" ? part.text : <ChatChipView key={part.chip.id} chip={part.chip} />,
          )}
        </div>
        {blank ? (
          <span className="vf-chat-ph" aria-hidden="true">
            {placeholder}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="vf-chat-mic"
        aria-disabled="true"
        aria-label="Dictation, not on the desktop yet"
        title="Dictation — not on the desktop yet"
      >
        <FieldGlyph name="mic" size={17} />
      </button>
      <button
        type="button"
        className="vf-chat-send"
        aria-label={`Send to ${name}`}
        title="Send  ↩"
        {...(armed ? { "data-armed": "true" } : { "aria-disabled": true })}
        {...(busy ? { "aria-busy": true } : {})}
        onClick={() => {
          if (armed && !busy) onSend?.();
        }}
      >
        <FieldGlyph name="arrow" size={17} />
      </button>
      {at === null ? null : (
        <div
          id={atId}
          className="vf-chat-at"
          role="menu"
          aria-label={at.kind === "rows" ? "Start an agent, or add a session" : menuLabel(at.rows)}
          data-at={at.kind}
          style={{ left: `${at.left}px` } as CSSProperties}
          // the editor keeps the caret while a row, a model or Effort is pressed
          onMouseDown={(event) => event.preventDefault()}
        >
          {at.kind === "rows" ? (
            <AtRowsView list={at.list} hot={at.hot} onTake={onTake} onHot={onHot} />
          ) : (
            <AtAgentMenuView
              rows={at.rows}
              effort={at.effort}
              hot={at.hot}
              onModel={onModel}
              onEffort={onEffort}
              onHot={onHot}
            />
          )}
        </div>
      )}
    </div>
  );
}
