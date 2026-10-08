import type { SnippetSegment } from "@vibecook/puppeteer-views";
import { FieldGlyph, type GlyphName } from "@vibefield/design-kit/glyphs";
import {
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useId,
} from "react";
import {
  PEEK_ROW_LINES,
  type PeekFilters,
  type PeekKind,
  type PeekLayout,
  type PeekLine,
  type PeekRow,
  type PeekScope,
} from "./peek-model";
import type { PeekProject } from "./peek-port";
import type { ViewKeys } from "./views";
import "./menu.css";
import "./peek.css";

// SEARCH — THE PEEK (DESIGN.md §8 "Search — the Peek", §5, §6, §10; One
// Frame §23, GV-D8/D9/D10/D3) — controller-free, so the catalog mounts this
// exact markup over a fixture port. The frame's button with its key printed
// under it, and the layer: the scrim that blurs and dims the window, and the
// popup — the field, the scope row, the list beside the peek, the foot. What
// the Peek DOES lives in `Peek.tsx`; what it shows is all props.

/** The frame's search button at the head's right end, ⌘F printed under its
 * glyph (Ctrl F off the Mac). */
export function PeekButtonView({
  keys,
  open,
  onPress,
  buttonRef,
}: {
  keys: ViewKeys;
  open: boolean;
  onPress: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}): ReactElement {
  const mac = keys === "mac";
  return (
    <button
      ref={buttonRef}
      type="button"
      className="vf-peek-button no-drag"
      aria-label="Search"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-keyshortcuts={mac ? "Meta+F" : "Control+F"}
      title={`Search  ${mac ? "⌘F" : "Ctrl+F"}`}
      onClick={onPress}
    >
      <FieldGlyph name="search" size={15} />
      {/* the key printed under the glyph, as the views track prints its keys */}
      <kbd className="vf-peek-key">
        <span>{mac ? "⌘" : "Ctrl"}</span>F
      </kbd>
    </button>
  );
}

/** A line's words, its matches marked — neutral, never a status colour (K1). */
function Marked({ segments }: { segments: readonly SnippetSegment[] }): ReactElement {
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index}>{segment.text}</mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

/** "folder · agent" — what a row and the peek say under a title. */
export function whereWords(row: Pick<PeekRow, "folder" | "agent">): string | null {
  const parts = [row.folder, row.agent].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** THE PEEK (K8, until the docket's PK3 rules): what opening the row would
 * show — today that session's matched lines in reading order under its title,
 * folder · agent and time, the line Open lands on in the ready fill. ONE
 * component, so an upstream reader or a timeline excerpt replaces it whole. */
export function PeekPast({ row }: { row: PeekRow }): ReactElement {
  const where = whereWords(row);
  const lands = row.target.timelineId ?? null;
  const reading = [...row.lines].sort(
    (left, right) => (left.at ?? Number.POSITIVE_INFINITY) - (right.at ?? Number.POSITIVE_INFINITY),
  );
  return (
    <section className="vf-peek-past" aria-label="What opening it shows">
      <header className="vf-peek-past-head">
        <b>{row.title}</b>
        <small>{[where, row.when].filter(Boolean).join(" · ")}</small>
      </header>
      <div className="vf-peek-past-lines">
        {reading.map((line) => (
          <div
            key={line.id}
            className="vf-peek-past-line"
            data-lands={line.timelineId === lands ? "true" : undefined}
          >
            <span className="vf-peek-who">{line.who}</span>
            <p>
              <Marked segments={line.whole} />
            </p>
          </div>
        ))}
        {reading.length === 0 && (
          <p className="vf-peek-past-summary">
            {row.summary ?? "Open it to read the session from its start."}
          </p>
        )}
      </div>
    </section>
  );
}

function RowLine({ line }: { line: PeekLine }): ReactElement {
  return (
    <span className="vf-peek-ev">
      <span className="vf-peek-who">{line.who}</span>
      <span className="vf-peek-tx">
        <Marked segments={line.row} />
      </span>
    </span>
  );
}

/** Which dropdown's menu is open. */
export type PeekMenu = "project" | "kind" | "agent";

const KIND_WORDS: Readonly<Record<PeekKind, string>> = {
  any: "Prompts and replies",
  user: "Prompts only",
  agent: "Replies only",
};

interface MenuChoice {
  readonly key: string;
  readonly label: string;
  readonly on: boolean;
  readonly pick: () => void;
}

function Dropdown({
  id,
  glyph,
  label,
  open,
  onToggle,
  choices,
}: {
  id: PeekMenu;
  glyph: GlyphName;
  label: string;
  open: boolean;
  onToggle: () => void;
  choices: readonly MenuChoice[];
}): ReactElement {
  const menuId = useId();
  return (
    <span className="vf-peek-dd-place" data-peek-dd={id}>
      <button
        type="button"
        className="vf-peek-dd"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={onToggle}
      >
        <FieldGlyph name={glyph} size={13} />
        <span className="vf-peek-dd-label">{label}</span>
        <FieldGlyph name="chevron" size={11} turn={90} className="vf-peek-dd-turn" />
      </button>
      {open && (
        <div id={menuId} className="vf-menu vf-peek-menu" role="menu" aria-label={label}>
          {choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              role="menuitemradio"
              aria-checked={choice.on}
              className="vf-menu-row"
              data-hot={choice.on ? "" : undefined}
              onClick={choice.pick}
            >
              <span className="vf-menu-label">{choice.label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export interface PeekViewProps {
  open: boolean;
  keys: ViewKeys;
  layout: PeekLayout;
  query: string;
  scope: PeekScope;
  filters: PeekFilters;
  projects: readonly PeekProject[];
  agents: readonly { readonly id: string; readonly label: string }[];
  rows: readonly PeekRow[];
  /** the hot row's index (−1 for none) */
  hot: number;
  /** the foot's one sentence */
  foot: string;
  /** the empty body's sentence when there are no rows, or null for none */
  none: string | null;
  menu: PeekMenu | null;
  inputRef?: Ref<HTMLInputElement>;
  listRef?: Ref<HTMLDivElement>;
  onQuery: (query: string) => void;
  onScope: (scope: PeekScope) => void;
  onMenu: (menu: PeekMenu | null) => void;
  onFilters: (filters: PeekFilters) => void;
  onOpen: (index: number) => void;
  onClose: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** The layer: the scrim, and the popup over it while open. The scrim stays
 * mounted so it can fade out; the popup goes at once (DESIGN.md §6). */
export function PeekView(props: PeekViewProps): ReactElement {
  const {
    open,
    keys,
    layout,
    query,
    scope,
    filters,
    projects,
    agents,
    rows,
    hot,
    foot,
    none,
    menu,
    inputRef,
    listRef,
    onQuery,
    onScope,
    onMenu,
    onFilters,
    onOpen,
    onClose,
    onKeyDown,
  } = props;
  const listId = useId();
  const optionId = (index: number): string => `${listId}-row-${index}`;
  const hotRow = hot >= 0 ? rows[hot] : undefined;
  const mac = keys === "mac";
  const toggle = (which: PeekMenu) => () => onMenu(menu === which ? null : which);
  const project = projects.find((entry) => entry.id === filters.project);
  const agent = agents.find((entry) => entry.id === filters.agent);
  let body: ReactNode;
  if (scope === "live") {
    // K9: in History, Live now says where the live sessions are searched
    body = (
      <div className="vf-peek-list">
        <div className="vf-peek-none">
          <p>
            In History, search reads your past. Live sessions are searched in Godview for now —{" "}
            {mac ? "⌘2, then ⌘F" : "Ctrl+2, then Ctrl+F"}.
          </p>
          <button type="button" className="vf-peek-widen" onClick={() => onScope("everything")}>
            {query.trim() === "" ? "Search everything" : `Search everything for “${query.trim()}”`}
          </button>
        </div>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="vf-peek-list">
        {none !== null && (
          <div className="vf-peek-none">
            <p>{none}</p>
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <div className="vf-peek-split" data-folded={layout.folded ? "true" : undefined}>
        <div
          ref={listRef}
          id={listId}
          className="vf-peek-list"
          role="listbox"
          aria-label="Sessions"
        >
          {rows.map((row, index) => {
            const where = whereWords(row);
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the field holds the keys (↑ ↓ ↵), as a combobox's listbox does
              <div
                key={row.id}
                id={optionId(index)}
                role="option"
                tabIndex={-1}
                aria-selected={index === hot}
                className="vf-peek-row"
                data-hot={index === hot ? "true" : undefined}
                onClick={() => onOpen(index)}
              >
                <span className="vf-peek-row-head">
                  <i className="vf-peek-dot" aria-hidden="true" />
                  <b className="vf-peek-title">{row.title}</b>
                  <span className="vf-peek-when">{row.when}</span>
                </span>
                {where !== null && <span className="vf-peek-sub">{where}</span>}
                {row.lines.slice(0, PEEK_ROW_LINES).map((line) => (
                  <RowLine key={line.id} line={line} />
                ))}
              </div>
            );
          })}
        </div>
        {!layout.folded && hotRow !== undefined && <PeekPast row={hotRow} />}
      </div>
    );
  }
  return (
    <div className="vf-peek" data-open={open ? "true" : "false"}>
      {/* the scrim is a pointer's way out; Esc is the keyboard's */}
      <div className="vf-peek-scrim" aria-hidden="true" onClick={onClose} />
      {open && (
        <div
          className="vf-peek-pop"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          data-folded={layout.folded ? "true" : undefined}
          style={{ width: layout.width, height: layout.height }}
          onKeyDown={onKeyDown}
        >
          <div className="vf-peek-field">
            <FieldGlyph name="search" size={18} />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Search"
              aria-expanded={rows.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={hotRow !== undefined ? optionId(hot) : undefined}
              spellCheck={false}
              autoComplete="off"
              placeholder={
                scope === "live"
                  ? "Words said in a live session, a folder, an agent…"
                  : "Search your whole agentic past…"
              }
              value={query}
              onChange={(event) => onQuery(event.target.value)}
            />
            <button
              type="button"
              className="vf-peek-esc"
              aria-label="Close search"
              onClick={onClose}
            >
              <FieldGlyph name="close" size={12} />
              <kbd className="vf-peek-key">esc</kbd>
            </button>
          </div>
          <div className="vf-peek-scope">
            <div className="vf-peek-seg" role="radiogroup" aria-label="What to search">
              {(["live", "everything"] as const).map((which) => (
                // biome-ignore lint/a11y/useSemanticElements: a segment, as the kit's primitives draw it
                <button
                  key={which}
                  type="button"
                  role="radio"
                  aria-checked={scope === which}
                  onClick={() => onScope(which)}
                >
                  {which === "live" ? "Live now" : "Everything"}
                </button>
              ))}
            </div>
            {scope === "everything" && (
              <div className="vf-peek-dds">
                <Dropdown
                  id="project"
                  glyph="folder"
                  label={project?.name ?? "Every project"}
                  open={menu === "project"}
                  onToggle={toggle("project")}
                  choices={[
                    { id: null, name: "Every project" },
                    ...projects.map((entry) => ({ id: entry.id, name: entry.name })),
                  ].map((entry) => ({
                    key: entry.id ?? "every",
                    label: entry.name,
                    on: filters.project === entry.id,
                    pick: () => onFilters({ ...filters, project: entry.id }),
                  }))}
                />
                <Dropdown
                  id="kind"
                  glyph="message"
                  label={KIND_WORDS[filters.kind]}
                  open={menu === "kind"}
                  onToggle={toggle("kind")}
                  choices={(["any", "user", "agent"] as const).map((kind) => ({
                    key: kind,
                    label: KIND_WORDS[kind],
                    on: filters.kind === kind,
                    pick: () => onFilters({ ...filters, kind }),
                  }))}
                />
                <Dropdown
                  id="agent"
                  glyph="agents"
                  label={agent?.label ?? "Any agent"}
                  open={menu === "agent"}
                  onToggle={toggle("agent")}
                  choices={[{ id: null, label: "Any agent" }, ...agents].map((entry) => ({
                    key: entry.id ?? "any",
                    label: entry.label,
                    on: filters.agent === entry.id,
                    pick: () => onFilters({ ...filters, agent: entry.id }),
                  }))}
                />
              </div>
            )}
          </div>
          <div className="vf-peek-body">{body}</div>
          <div className="vf-peek-foot">
            <span className="vf-peek-said" role="status">
              {foot}
            </span>
            {scope === "everything" && hotRow !== undefined && (
              <button
                type="button"
                className="vf-peek-open"
                aria-label={hotRow.lines.length > 0 ? "Open at the line" : "Open the session"}
                aria-keyshortcuts="Enter"
                onClick={() => onOpen(hot)}
              >
                {hotRow.lines.length > 0 ? "Open at the line" : "Open the session"}
                <kbd className="vf-peek-open-key">↵</kbd>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
