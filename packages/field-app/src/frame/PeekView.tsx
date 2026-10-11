import { ProfileGlyph } from "@vibecook/puppeteer-view-sdk/react";
import { keyLegend } from "@vibecook/puppeteer-view-sdk/toolkit";
import { ChromeBoundary, type SnippetSegment } from "@vibecook/puppeteer-views";
import type { FrameView } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import {
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useId,
} from "react";
import { OS_LABEL, OsMark } from "../godview/os-marks";
import type { LiveDeskChoice, LiveFilters, LiveProfileChoice } from "./find-door";
import { isLiveRow, type PeekListRow, type PeekLiveRow } from "./peek-live";
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
// under it (and, in Godview, the filter it wears), and the layer: the scrim
// that blurs and dims the window, and the popup — the field, the scope row,
// the list beside the peek, the foot. What the Peek DOES lives in `Peek.tsx`;
// what it shows is all props.

/** The filter a search button wears (GV-D3): the chosen desktop, the chosen
 * profile, or both. */
export interface PeekToken {
  readonly desk: LiveDeskChoice | null;
  readonly profile: LiveProfileChoice | null;
}

/** The frame's search button at the head's right end, ⌘F printed under its
 * glyph (Ctrl F off the Mac). With a filter on, the glass grows a token
 * naming it — "studio · Work" — and an × that clears it (GV-D3): a filtered
 * view never looks unfiltered. */
export function PeekButtonView({
  keys,
  open,
  onPress,
  buttonRef,
  findRef,
  token = null,
  onClearToken,
}: {
  keys: ViewKeys;
  open: boolean;
  onPress: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  /** the glass itself, which the controller measures (the bar steps aside) */
  findRef?: Ref<HTMLDivElement>;
  token?: PeekToken | null;
  onClearToken?: () => void;
}): ReactElement {
  const mac = keys === "mac";
  const words =
    token === null
      ? null
      : [token.desk?.name, token.profile?.label].filter((part) => part !== undefined).join(" · ");
  return (
    <div
      ref={findRef}
      className="vf-peek-find no-drag"
      data-scoped={token === null ? undefined : "true"}
    >
      <button
        ref={buttonRef}
        type="button"
        className="vf-peek-button"
        aria-label={words === null ? "Search" : `Search, filtered to ${words}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={mac ? "Meta+F" : "Control+F"}
        title={`Search  ${mac ? "⌘F" : "Ctrl+F"}`}
        onClick={onPress}
      >
        <FieldGlyph name="search" size={15} />
        {/* the key printed under the glyph, as the views track prints its keys */}
        <kbd className="vf-peek-key">
          <span>{mac ? "⌘" : "Ctrl"}</span>
          {keyLegend("f")}
        </kbd>
      </button>
      {token !== null && (
        <span className="vf-peek-token">
          {token.desk !== null && (
            <span className="vf-peek-token-part">
              <OsMark os={token.desk.os} size={12} />
              {token.desk.name}
            </span>
          )}
          {token.desk !== null && token.profile !== null && (
            <i className="vf-peek-token-sep" aria-hidden="true" />
          )}
          {token.profile !== null && (
            <span className="vf-peek-token-part">
              <ProfileGlyph
                glyph={token.profile.glyph}
                kind={token.profile.kind}
                filled={token.profile.isDefault === true}
                size={12}
              />
              {token.profile.label}
            </span>
          )}
          <button
            type="button"
            className="vf-peek-token-clear"
            aria-label="Clear the filters"
            title="Every desktop and profile again"
            onClick={onClearToken}
          >
            <FieldGlyph name="close" size={10} />
          </button>
        </span>
      )}
    </div>
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

/** THE PEEK (K8): what opening the row would show, under its title, folder ·
 * agent and time. PK3 (James's docket v9; built 2026-10-09): the room's own
 * read-only reader, landed at the matched line — handed in as `reader` by
 * the controller (the room's code rides the room's chunk); without one, the
 * session's matched lines in reading order, the line Open lands on in the
 * ready fill (`PeekPastLines`, also the reader's stand-in while it loads).
 * ONE component, so the reader replaces it whole. */
export function PeekPast({ row, reader }: { row: PeekRow; reader?: ReactNode }): ReactElement {
  const where = whereWords(row);
  return (
    <section className="vf-peek-past" aria-label="What opening it shows">
      <header className="vf-peek-past-head">
        <b>{row.title}</b>
        <small>{[where, row.when].filter(Boolean).join(" · ")}</small>
      </header>
      {reader === undefined || reader === null ? <PeekPastLines row={row} /> : reader}
    </section>
  );
}

/** THE LIVE PEEK (GV-D8): what opening a live row would show — the run's own
 * pane, resting, which the controller draws (`renderLive`, the watch-only
 * pane); a run on another desktop says where it runs, as nothing here can
 * watch another desktop's terminal yet (K10, until DS-4's mirror). */
export function PeekLive({
  row,
  renderLive,
}: {
  row: PeekLiveRow;
  renderLive?: ((row: PeekLiveRow) => ReactNode) | undefined;
}): ReactElement {
  let picture: ReactNode;
  if (row.remote !== null) {
    picture = (
      <div className="vf-peek-live-words">
        <span className="vf-peek-os">
          <OsMark os={row.remote.os} size={13} />
          {row.remote.name}
        </span>
        <p>
          It runs on {row.remote.name}. Search shows this desktop's terminals; Open brings its
          terminal into a pane here.
        </p>
      </div>
    );
  } else if (row.floorSessionId !== null && renderLive !== undefined) {
    picture = renderLive(row);
  } else {
    picture = (
      <div className="vf-peek-live-words">
        <p>
          {row.floorSessionId === null
            ? "Its terminal is not on this desktop's floor."
            : "Its terminal shows here in the window."}
        </p>
      </div>
    );
  }
  return (
    <section className="vf-peek-live" aria-label="What opening it shows">
      {picture}
    </section>
  );
}

/** The session's matched lines in reading order (K8's picture until PK3, and
 * the reader's stand-in). */
export function PeekPastLines({ row }: { row: PeekRow }): ReactElement {
  const lands = row.target.timelineId ?? null;
  const reading = [...row.lines].sort(
    (left, right) => (left.at ?? Number.POSITIVE_INFINITY) - (right.at ?? Number.POSITIVE_INFINITY),
  );
  return (
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

/** Which dropdown's menu is open: Everything's three, Live now's two. */
export type PeekMenu = "project" | "kind" | "agent" | "desk" | "profile";

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
  /** a mark before the name (a desktop's OS, a profile's glyph) */
  readonly lead?: ReactNode;
  /** a word after it (a desktop's agents or its standing) */
  readonly note?: string;
  /** a desktop that is not answering: drawn quiet */
  readonly quiet?: boolean;
}

function Dropdown({
  id,
  lead,
  label,
  open,
  onToggle,
  choices,
}: {
  id: PeekMenu;
  /** the mark before the name: a glyph, or the chosen desktop's or profile's */
  lead: ReactNode;
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
        <span className="vf-peek-dd-lead">{lead}</span>
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
              data-quiet={choice.quiet === true ? "" : undefined}
              onClick={choice.pick}
            >
              {choice.lead !== undefined && (
                <span className="vf-peek-menu-lead">{choice.lead}</span>
              )}
              <span className="vf-menu-label">{choice.label}</span>
              {choice.note !== undefined && <em className="vf-peek-menu-note">{choice.note}</em>}
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
  /** the view the Peek opens over: what a past row's Open says */
  view?: FrameView;
  layout: PeekLayout;
  query: string;
  scope: PeekScope;
  filters: PeekFilters;
  projects: readonly PeekProject[];
  agents: readonly { readonly id: string; readonly label: string }[];
  /** Live now's dropdowns (GV-D3, Godview's): null where the view has none */
  liveFilters?: LiveFilters | null;
  onLiveDesk?: (id: string | null) => void;
  onLiveProfile?: (id: string | null) => void;
  rows: readonly PeekListRow[];
  /** the hot row's index (−1 for none) */
  hot: number;
  /** the foot's one sentence */
  foot: string;
  /** the empty body's sentence when there are no rows, or null for none */
  none: string | null;
  menu: PeekMenu | null;
  /** the live peek's picture: the run's own pane, watched */
  renderLive?: (row: PeekLiveRow) => ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  listRef?: Ref<HTMLDivElement>;
  onQuery: (query: string) => void;
  onScope: (scope: PeekScope) => void;
  onMenu: (menu: PeekMenu | null) => void;
  onFilters: (filters: PeekFilters) => void;
  onOpen: (index: number) => void;
  onClose: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** PK3 — the past picture for the hot row (the room's reader at its line,
   * with the words typed); absent: the matched lines */
  pastReader?: ((row: PeekRow, query: string) => ReactNode) | undefined;
}

/** What Open says for a row (the kit's `openLabel`). */
export function openWords(row: PeekListRow, view: FrameView | undefined): string {
  if (isLiveRow(row)) return "Open in the terminals";
  if (view !== undefined && view !== "history") return "Open in History";
  return row.lines.length > 0 ? "Open at the line" : "Open the session";
}

/** MV-8b: Live now's rows are a chrome piece of their own, tried again for
 * the rows they list (the same array while their content is); Everything's
 * are the past's, drawn as they were. */
function liveBoundary(scope: PeekScope, rows: readonly PeekListRow[], items: ReactNode): ReactNode {
  return scope === "live" ? (
    <ChromeBoundary name="Live now" retryKey={rows}>
      {items}
    </ChromeBoundary>
  ) : (
    items
  );
}

/** The distinct OS marks of every desktop: what "All desktops" wears. */
function deskMarks(desks: readonly LiveDeskChoice[]): ReactNode {
  const seen = [...new Set(desks.map((desk) => desk.os))];
  return (
    <span className="vf-peek-marks">
      {seen.map((os) => (
        <OsMark key={os} os={os} size={11} />
      ))}
    </span>
  );
}

/** The layer: the scrim, and the popup over it while open. The scrim stays
 * mounted so it can fade out; the popup goes at once (DESIGN.md §6). */
export function PeekView(props: PeekViewProps): ReactElement {
  const {
    open,
    view,
    layout,
    query,
    scope,
    filters,
    projects,
    agents,
    liveFilters = null,
    onLiveDesk,
    onLiveProfile,
    rows,
    hot,
    foot,
    none,
    menu,
    renderLive,
    inputRef,
    listRef,
    onQuery,
    onScope,
    onMenu,
    onFilters,
    onOpen,
    onClose,
    onKeyDown,
    pastReader,
  } = props;
  const listId = useId();
  const optionId = (index: number): string => `${listId}-row-${index}`;
  const hotRow = hot >= 0 ? rows[hot] : undefined;
  const toggle = (which: PeekMenu) => () => onMenu(menu === which ? null : which);
  const project = projects.find((entry) => entry.id === filters.project);
  const agent = agents.find((entry) => entry.id === filters.agent);
  const words = query.trim();
  let body: ReactNode;
  if (rows.length === 0) {
    body = (
      <div className="vf-peek-list">
        {none !== null && (
          <div className="vf-peek-none">
            <p>{none}</p>
            {/* when nothing live holds the words, the way to the past (GV-D9) */}
            {scope === "live" && words !== "" && (
              <button type="button" className="vf-peek-widen" onClick={() => onScope("everything")}>
                {`Search everything for “${words}”`}
              </button>
            )}
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
          {liveBoundary(
            scope,
            rows,
            rows.map((row, index) => {
              const where = whereWords(row);
              const live = isLiveRow(row);
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
                  data-kind={live ? "live" : "past"}
                  data-floor-session={live ? (row.floorSessionId ?? undefined) : undefined}
                  onClick={() => onOpen(index)}
                >
                  <span className="vf-peek-row-head">
                    <i
                      className="vf-peek-dot"
                      data-state={live ? row.state : undefined}
                      aria-hidden="true"
                    />
                    <b className="vf-peek-title">{row.title}</b>
                    <span className="vf-peek-when">{row.when}</span>
                  </span>
                  {(where !== null || (live && row.remote !== null)) && (
                    <span className="vf-peek-sub">
                      {where}
                      {live && row.remote !== null && (
                        <span className="vf-peek-os" title={OS_LABEL[row.remote.os]}>
                          <OsMark os={row.remote.os} size={11} />
                          {row.remote.name}
                        </span>
                      )}
                    </span>
                  )}
                  {row.lines.slice(0, PEEK_ROW_LINES).map((line) => (
                    <RowLine key={line.id} line={line} />
                  ))}
                </div>
              );
            }),
          )}
        </div>
        {!layout.folded &&
          hotRow !== undefined &&
          (isLiveRow(hotRow) ? (
            // MV-8b: the live peek is a chrome piece of its own, tried again
            // for the run it shows
            <ChromeBoundary name="Live peek" retryKey={hotRow.floorSessionId ?? hotRow.id}>
              <PeekLive row={hotRow} renderLive={renderLive} />
            </ChromeBoundary>
          ) : (
            <PeekPast row={hotRow} reader={pastReader?.(hotRow, query)} />
          ))}
      </div>
    );
  }
  let dropdowns: ReactNode = null;
  if (scope === "everything") {
    dropdowns = (
      <div className="vf-peek-dds">
        <Dropdown
          id="project"
          lead={<FieldGlyph name="folder" size={13} />}
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
          lead={<FieldGlyph name="message" size={13} />}
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
          lead={<FieldGlyph name="agents" size={13} />}
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
    );
  } else if (
    liveFilters !== null &&
    (liveFilters.desks.length > 0 || liveFilters.profiles.length > 0)
  ) {
    // GV-D3: the desktops and the profiles — the view's own filters, which
    // filter the view too; each offered only when there is a choice to make
    const desk = liveFilters.desks.find((entry) => entry.id === liveFilters.desk);
    const profile = liveFilters.profiles.find((entry) => entry.id === liveFilters.profile);
    dropdowns = (
      // MV-8b: the scope row's filters are a chrome piece of their own, tried
      // again for the filters they draw (held by content by the monitor)
      <ChromeBoundary name="Live filters" retryKey={liveFilters}>
        <div className="vf-peek-dds">
          {liveFilters.desks.length > 0 && (
            <Dropdown
              id="desk"
              lead={
                desk === undefined ? (
                  deskMarks(liveFilters.desks)
                ) : (
                  <OsMark os={desk.os} size={12} />
                )
              }
              label={desk?.name ?? "All desktops"}
              open={menu === "desk"}
              onToggle={toggle("desk")}
              choices={[
                {
                  key: "all",
                  label: "All desktops",
                  on: liveFilters.desk === null,
                  pick: () => onLiveDesk?.(null),
                },
                ...liveFilters.desks.map((entry) => ({
                  key: entry.id,
                  label: entry.here ? `${entry.name} · here` : entry.name,
                  on: liveFilters.desk === entry.id,
                  pick: () => onLiveDesk?.(entry.id),
                  lead: <OsMark os={entry.os} size={11} />,
                  note: entry.note,
                  quiet: entry.quiet,
                })),
              ]}
            />
          )}
          {liveFilters.profiles.length > 0 && (
            <Dropdown
              id="profile"
              lead={
                profile === undefined ? (
                  <FieldGlyph name="person" size={13} />
                ) : (
                  <ProfileGlyph
                    glyph={profile.glyph}
                    kind={profile.kind}
                    filled={profile.isDefault === true}
                    size={13}
                  />
                )
              }
              label={profile?.label ?? "Every profile"}
              open={menu === "profile"}
              onToggle={toggle("profile")}
              choices={[
                {
                  key: "every",
                  label: "Every profile",
                  on: liveFilters.profile === null,
                  pick: () => onLiveProfile?.(null),
                },
                ...liveFilters.profiles.map((entry) => ({
                  key: entry.id,
                  label: entry.label,
                  on: liveFilters.profile === entry.id,
                  pick: () => onLiveProfile?.(entry.id),
                  lead: (
                    <ProfileGlyph
                      glyph={entry.glyph}
                      kind={entry.kind}
                      filled={entry.isDefault === true}
                      size={12}
                    />
                  ),
                  ...(entry.blocked === true ? { note: "waiting" } : {}),
                })),
              ]}
            />
          )}
        </div>
      </ChromeBoundary>
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
          data-scope={scope}
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
            {dropdowns}
          </div>
          <div className="vf-peek-body">{body}</div>
          <div className="vf-peek-foot">
            <span className="vf-peek-said" role="status">
              {foot}
            </span>
            {hotRow !== undefined && (
              <button
                type="button"
                className="vf-peek-open"
                aria-label={openWords(hotRow, view)}
                aria-keyshortcuts="Enter"
                onClick={() => onOpen(hot)}
              >
                {openWords(hotRow, view)}
                <kbd className="vf-peek-open-key">↵</kbd>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
