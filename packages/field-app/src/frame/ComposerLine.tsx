import type { FrameView } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type {
  ClipboardEvent,
  CSSProperties,
  DragEvent,
  FocusEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  ReactNode,
  Ref,
} from "react";
import { type AtList, type AtRow, atTakeable } from "./at-list";
import {
  type CreateAct,
  createActOf,
  type DraftChip,
  type DraftPart,
  type LineAim,
  linePlaceholder,
} from "./draft";
import type { ViewKeys } from "./views";
import "./composer.css";

// THE LINE (DESIGN.md §8 "The line", §5, §10; One Frame FR-2, FR-3, FC-D1,
// FC-D3, FC-D14) — the frame's foot, controller-free so the catalog mounts this
// exact markup on fixtures. `[views] create │ draft mic send`: the views track
// arrives as a slot (its own component, its own keys), the rest is drawn here.
// What the line DOES lives in `Composer.tsx`; what it shows is all props.

/** What the line's note says, and over which piece. `seq` counts notes, so
 * the same words said twice are said twice. */
export interface LineNote {
  readonly seq: number;
  readonly text: string;
  readonly at: "create" | "send";
}

/** The editor's own events — the controller's, passed through untouched. */
export interface LineEditorHandlers {
  onInput?: (event: FormEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void;
}

export interface ComposerLineViewProps {
  view: FrameView;
  keys: ViewKeys;
  /** The views track — its left end. */
  track: ReactNode;
  /** Objects is out (Canvas): create wears its ✕. */
  objectsOpen?: boolean;
  /** Why the create act waits, said in its tooltip; null when it can act. */
  createWaits?: string | null;
  /** Who the draft goes to — the chip that leads it. */
  aim?: LineAim | null;
  /** What the editor is drawn with. The editor is the person's while they
   * type; it is redrawn from this only when `revision` changes. */
  seed?: readonly DraftPart[];
  revision?: number;
  /** Nothing typed or set: the placeholder shows. */
  blank?: boolean;
  /** There is something to send: send is inverted. */
  canSend?: boolean;
  note?: LineNote | null;
  /** @'s list is open (the editor says so to assistive tech). */
  atOpen?: boolean;
  lineRef?: Ref<HTMLDivElement>;
  editorRef?: Ref<HTMLDivElement>;
  editor?: LineEditorHandlers;
  onCreate?: () => void;
  onSend?: () => void;
  onRemoveAim?: () => void;
}

const CREATE_GLYPHS = ["plus", "start", "resume"] as const;

/** @'s list, as the editor names the menu it controls while it is open. */
const AT_MENU_ID = "vf-line-at-menu";

function createTitle(act: CreateAct, open: boolean, waits: string | null): string {
  if (open) return "Close  Esc";
  if (waits !== null) return `${act.name} — ${waits}`;
  return act.key === null ? act.name : `${act.name}  ${act.key}`;
}

function createShortcut(act: CreateAct): string | undefined {
  if (act.key === null) return undefined;
  if (act.key === "B") return "B";
  return act.key.startsWith("⌘") ? "Meta+T" : "Control+T";
}

/** A chip, as the editor sets it in the sentence: never editable itself, so
 * the editor's Backspace takes it whole. The × is a glyph, not a letter. */
export function LineChipView({ chip }: { chip: DraftChip }): ReactElement {
  return (
    <span
      className="vf-line-chip"
      data-chip={chip.kind}
      data-chip-id={chip.id}
      contentEditable={false}
      title={chip.path}
    >
      <FieldGlyph name="capture" size={13} />
      <span>{chip.label}</span>
      <button
        type="button"
        className="vf-line-chip-x"
        data-chip-remove={chip.id}
        aria-label={`Remove ${chip.label}`}
        tabIndex={-1}
      >
        <FieldGlyph name="close" size={10} />
      </button>
    </span>
  );
}

export function ComposerLineView({
  view,
  keys,
  track,
  objectsOpen = false,
  createWaits = null,
  aim = null,
  seed = [],
  revision = 0,
  blank = true,
  canSend = false,
  note = null,
  atOpen = false,
  lineRef,
  editorRef,
  editor,
  onCreate,
  onSend,
  onRemoveAim,
}: ComposerLineViewProps): ReactElement {
  const act = createActOf(view, keys);
  const open = view === "canvas" && objectsOpen;
  const waits = open ? null : createWaits;
  const placeholder = linePlaceholder(aim);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the composer is a row of controls and an editor, not a fieldset of form inputs
    <div ref={lineRef} className="vf-line" role="group" aria-label="The composer" data-view={view}>
      {track}
      <button
        type="button"
        className="vf-line-create"
        data-view={view}
        aria-label={open ? "Close the objects" : act.name}
        title={createTitle(act, open, waits)}
        aria-keyshortcuts={open ? "Escape" : createShortcut(act)}
        {...(view === "canvas" ? { "aria-expanded": open } : {})}
        {...(waits !== null ? { "aria-disabled": true } : {})}
        onClick={() => {
          if (waits === null) onCreate?.();
        }}
      >
        {CREATE_GLYPHS.map((glyph) => (
          <span
            key={glyph}
            className="vf-line-create-glyph"
            data-glyph={glyph}
            {...(glyph === act.glyph ? { "data-shown": "true" } : {})}
          >
            <FieldGlyph name={glyph} size={16} />
          </span>
        ))}
      </button>
      <span className="vf-line-rule" aria-hidden="true" />
      <div className="vf-line-draft">
        {aim === null ? null : (
          <span className="vf-line-chip" data-chip="aim" title={`Goes to ${aim.name}`}>
            <span>@{aim.name}</span>
            <button
              type="button"
              className="vf-line-chip-x"
              aria-label={`Stop aiming at ${aim.name}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onRemoveAim?.()}
            >
              <FieldGlyph name="close" size={10} />
            </button>
          </span>
        )}
        <div className="vf-line-field">
          {/* biome-ignore lint/a11y/useSemanticElements: the draft is an editor with chips set in the sentence (D1), which no input or textarea can hold */}
          <div
            key={revision}
            ref={editorRef}
            className="vf-line-input"
            contentEditable
            suppressContentEditableWarning
            tabIndex={0}
            role="textbox"
            aria-label={aim === null ? "Message" : `Message ${aim.name}`}
            aria-placeholder={placeholder}
            aria-haspopup="menu"
            {...(atOpen ? { "aria-controls": AT_MENU_ID } : {})}
            spellCheck
            {...editor}
          >
            {/* Runs of text are bare text nodes, as typing makes them; a
                normalized draft never holds two side by side. */}
            {seed.map((part) =>
              part.kind === "text" ? (
                part.text
              ) : (
                <LineChipView key={part.chip.id} chip={part.chip} />
              ),
            )}
          </div>
          {blank ? (
            <span className="vf-line-ph" aria-hidden="true">
              {placeholder}
            </span>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="vf-line-mic"
        aria-disabled="true"
        aria-label="Dictation, not on the desktop yet"
        title="Dictation — not on the desktop yet"
      >
        <FieldGlyph name="mic" size={17} />
      </button>
      <button
        type="button"
        className="vf-line-send"
        aria-label={aim === null ? "Send" : `Send to ${aim.name}`}
        title="Send  ↩"
        {...(canSend ? { "data-armed": "true" } : { "aria-disabled": true })}
        onClick={() => {
          if (canSend) onSend?.();
        }}
      >
        <FieldGlyph name="arrow" size={17} />
      </button>
      {note === null ? null : (
        <div key={note.seq} className="vf-line-note" data-at={note.at} role="status">
          {note.text}
        </div>
      )}
    </div>
  );
}

export interface AtMenuViewProps {
  list: AtList;
  /** The highlighted row's id — what Return or Tab takes. */
  hot: string | null;
  /** The menu's left edge, in the frame's px: 10 before the @ it grew from. */
  left: number;
  /** Point at a row. */
  onHot?: (id: string) => void;
  /** Take a row; `mini` names the clipboard still pointed at, when one was. */
  onTake?: (row: AtRow, mini?: string) => void;
}

/** @'s list (DESIGN.md §8; FC-D1, FC-D14): a solid menu grown upward from the
 * caret, read bottom-up, nearest first. */
export function AtMenuView({ list, hot, left, onHot, onTake }: AtMenuViewProps): ReactElement {
  const row = (entry: AtRow, body: ReactNode, className = "vf-at-row"): ReactElement => {
    const takeable = atTakeable(entry);
    return (
      <button
        key={entry.id}
        type="button"
        role="menuitem"
        className={className}
        data-row={entry.id}
        tabIndex={-1}
        {...(hot === entry.id ? { "data-hot": "true" } : {})}
        {...(takeable ? {} : { "aria-disabled": true })}
        // The editor keeps the caret while a row is pointed at and taken.
        onMouseDown={(event) => event.preventDefault()}
        onPointerEnter={() => {
          if (takeable) onHot?.(entry.id);
        }}
        onClick={(event) => {
          if (!takeable) return;
          const mini = (event.target as Element)
            .closest?.("[data-mini]")
            ?.getAttribute("data-mini");
          onTake?.(entry, mini ?? undefined);
        }}
      >
        {body}
      </button>
    );
  };
  return (
    <div
      id={AT_MENU_ID}
      className="vf-at-menu"
      role="menu"
      aria-label="Send to, or add"
      style={{ left: `${left}px` } as CSSProperties}
    >
      {list.add.length === 0 ? null : (
        <>
          <div className="vf-at-eye">Add</div>
          {list.add.map((entry) =>
            entry.kind === "clip"
              ? row(
                  entry,
                  <>
                    {entry.minis.map((mini) => (
                      <span key={mini.id} className="vf-at-mini" data-mini={mini.id}>
                        {mini.url === null ? null : <img src={mini.url} alt="" draggable={false} />}
                      </span>
                    ))}
                    <span className="vf-at-label">
                      From the clipboard
                      <small>
                        {entry.count === 0
                          ? "Nothing in it yet"
                          : `${entry.count} in it, newest first`}
                      </small>
                    </span>
                  </>,
                  "vf-at-row vf-at-tiles",
                )
              : row(
                  entry,
                  <>
                    <span className="vf-at-ico">
                      <FieldGlyph name={entry.glyph} size={16} />
                    </span>
                    <span className="vf-at-label">
                      {entry.label}
                      {entry.why === null ? null : <small>{entry.why}</small>}
                    </span>
                  </>,
                ),
          )}
          <div className="vf-at-sep" />
        </>
      )}
      <div className="vf-at-eye">{list.sendEyebrow}</div>
      {list.send.map((entry) =>
        row(
          entry,
          <>
            <span className="vf-at-ico">
              <i className="vf-at-dot" {...(entry.dot === null ? {} : { "data-dot": entry.dot })} />
            </span>
            <span className="vf-at-label">
              <b>{entry.name}</b>
              <small>{entry.sub}</small>
            </span>
            {entry.state === "" ? null : <em>{entry.state}</em>}
          </>,
          "vf-at-row is-aim",
        ),
      )}
      {list.sendQuiet === null ? null : <div className="vf-at-quiet">{list.sendQuiet}</div>}
    </div>
  );
}
