import type { FrameView } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { ProfileGlyph } from "@vibefield/puppeteer-view-sdk/react";
import { keyLegend } from "@vibefield/puppeteer-view-sdk/toolkit";
import { ChromeBoundary, type SnippetSegment } from "@vibefield/puppeteer-views";
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
import {
  isOffer,
  type PeekFieldToken,
  type PeekListItem,
  type PeekMenuGroup,
  type PeekPick,
} from "./peek-filters";
import { isLiveRow, type PeekListRow, type PeekLiveRow } from "./peek-live";
import {
  PEEK_ROW_LINES,
  type PeekLayout,
  type PeekLine,
  type PeekRow,
  type PeekScope,
} from "./peek-model";
import type { ViewKeys } from "./views";
import "./menu.css";
import "./peek.css";

// SEARCH — THE PEEK (DESIGN.md §8 "Search — the Peek", §5, §6, §10; One
// Frame §23, GV-D8/D9/D10/D3; SE-D1 A "Tokens", 2026-11-06) — controller-free,
// so the catalog mounts this exact markup over a fixture port. The frame's
// button with its key printed under it (and, in Godview, the filter it wears),
// and the layer: the scrim that blurs and dims the window, and the popup — the
// field with its tokens and its end (+ Filter and the small switch), the list
// beside the peek, the foot. What the Peek DOES lives in `Peek.tsx`, and what
// its filters say in `peek-filters.ts`; what it shows is all props.

/** The filter a search button wears (GV-D3): the chosen desktop, the chosen
 * profile, or both. */
export interface PeekToken {
  readonly desk: LiveDeskChoice | null;
  readonly profile: LiveProfileChoice | null;
}

/** GV-D11 — the button's step between the terminals' bar and the head: the
 * bar's control fading out where it stands, then the head's circle fading in
 * (`Peek.tsx` times them; `peek.css` draws them). */
export type PeekStep = "out" | "in";

/** The frame's search button at the head's right end, ⌘F printed under its
 * glyph (Ctrl F off the Mac). With a filter on, the glass grows a token
 * naming it — "studio · Work" — and an × that clears it (GV-D3): a filtered
 * view never looks unfiltered. It is one state with the field's tokens (SE-D2):
 * this × clears them too. */
export function PeekButtonView({
  keys,
  open,
  onPress,
  buttonRef,
  findRef,
  token = null,
  onClearToken,
  bar = false,
  step = null,
}: {
  keys: ViewKeys;
  open: boolean;
  onPress: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  /** the glass itself, which the controller measures (the bar steps aside) */
  findRef?: Ref<HTMLDivElement>;
  token?: PeekToken | null;
  onClearToken?: () => void;
  /** Godview's terminals are maximized (GV-D11): the same button stands in
   * their title bar, folded to it — ⌘F beside the glyph, no glass, and no
   * filter named (there is no view for it to filter; the popup shows it). */
  bar?: boolean;
  /** Leaving the bar (GV-D11): `out` while the bar's control fades where it
   * stands, `in` while the head's circle fades back. */
  step?: PeekStep | null;
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
      data-scoped={token === null || bar ? undefined : "true"}
      data-bar={bar ? "true" : undefined}
      data-step={step ?? undefined}
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
      {token !== null && !bar && (
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
 * watch another desktop's terminal yet (K10, until DS-4's mirror). SKELETON
 * (SE-1c red): no head yet. */
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

export interface PeekViewProps {
  open: boolean;
  keys: ViewKeys;
  /** the view the Peek opens over: what a past row's Open says */
  view?: FrameView;
  layout: PeekLayout;
  query: string;
  scope: PeekScope;
  /** Godview's filters (GV-D3), null where the view lends none: what a live
   * row's profile is named by, and what Live now's filters are tried again for */
  liveFilters?: LiveFilters | null;
  /** the filters that are on, as the field's tokens (`peekFieldTokens`) */
  tokens: readonly PeekFieldToken[];
  /** + Filter's menu (`filterMenu`): empty, + Filter is not drawn */
  filterMenu: readonly PeekMenuGroup[];
  filterOpen: boolean;
  /** this device in its own word ("This Mac"): where a live run's head says it runs */
  here: string;
  /** the list: the sessions, a typed name's offer first while it stands */
  rows: readonly PeekListItem[];
  /** the hot row's index (−1 for none) */
  hot: number;
  /** the foot's one sentence */
  foot: string;
  /** the empty body's sentence when there are no rows, or null for none */
  none: string | null;
  /** the live peek's picture: the run's own pane, watched */
  renderLive?: (row: PeekLiveRow) => ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  listRef?: Ref<HTMLDivElement>;
  onQuery: (query: string) => void;
  onScope: (scope: PeekScope) => void;
  onFilterOpen: (open: boolean) => void;
  /** a menu row picked: a filter set, or TS-4's Connect… */
  onPick: (pick: PeekPick | "connect") => void;
  /** a token's ×: its one filter back to every one */
  onRemoveToken: (token: PeekFieldToken) => void;
  onOpen: (index: number) => void;
  onClose: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** PK3 — the past picture for the hot row (the room's reader at its line,
   * with the words typed); absent: the matched lines */
  pastReader?: ((row: PeekRow, query: string) => ReactNode) | undefined;
}

/** What Open says for a row (the kit's `openLabel`), and for the offer what
 * taking it does (SE-D1). */
export function openWords(row: PeekListItem, view: FrameView | undefined): string {
  if (isOffer(row)) return "Add the filter";
  if (isLiveRow(row)) return "Open in the terminals";
  if (view !== undefined && view !== "history") return "Open in History";
  return row.lines.length > 0 ? "Open at the line" : "Open the session";
}

/** MV-8b: Live now's rows are a chrome piece of their own, tried again for
 * the rows they list (the same array while their content is); Everything's
 * are the past's, drawn as they were. */
function liveBoundary(
  scope: PeekScope,
  rows: readonly PeekListItem[],
  items: ReactNode,
): ReactNode {
  return scope === "live" ? (
    <ChromeBoundary name="Live now" retryKey={rows}>
      {items}
    </ChromeBoundary>
  ) : (
    items
  );
}

/** A session's row, live or past: its head, then folder · agent — a peer's
 * saying where it runs (K10) — and its matched lines. SKELETON (SE-1c red): no
 * profile yet. */
function SessionRow({
  row,
  id,
  hot,
  onOpen,
}: {
  row: PeekListRow;
  id: string;
  hot: boolean;
  onOpen: () => void;
}): ReactElement {
  const where = whereWords(row);
  const live = isLiveRow(row);
  const remote = live ? row.remote : null;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the field holds the keys (↑ ↓ ↵), as a combobox's listbox does
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={hot}
      className="vf-peek-row"
      data-hot={hot ? "true" : undefined}
      data-kind={live ? "live" : "past"}
      data-floor-session={live ? (row.floorSessionId ?? undefined) : undefined}
      onClick={onOpen}
    >
      <span className="vf-peek-row-head">
        <i className="vf-peek-dot" data-state={live ? row.state : undefined} aria-hidden="true" />
        <b className="vf-peek-title">{row.title}</b>
        <span className="vf-peek-when">{row.when}</span>
      </span>
      {(where !== null || remote !== null) && (
        <span className="vf-peek-sub">
          {where}
          {remote !== null && (
            <span className="vf-peek-os" title={OS_LABEL[remote.os]}>
              <OsMark os={remote.os} size={11} />
              {remote.name}
            </span>
          )}
        </span>
      )}
      {row.lines.slice(0, PEEK_ROW_LINES).map((line) => (
        <RowLine key={line.id} line={line} />
      ))}
    </div>
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
    rows,
    hot,
    foot,
    none,
    renderLive,
    inputRef,
    listRef,
    onQuery,
    onScope,
    onOpen,
    onClose,
    onKeyDown,
    pastReader,
  } = props;
  const listId = useId();
  const optionId = (index: number): string => `${listId}-row-${index}`;
  const hotRow = hot >= 0 ? rows[hot] : undefined;
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
    let peek: ReactNode = null;
    // SKELETON (SE-1c red): an offer's peek is not drawn yet
    if (!layout.folded && hotRow !== undefined && !isOffer(hotRow)) {
      if (isLiveRow(hotRow)) {
        // MV-8b: the live peek is a chrome piece of its own, tried again for the run it shows
        peek = (
          <ChromeBoundary name="Live peek" retryKey={hotRow.floorSessionId ?? hotRow.id}>
            <PeekLive row={hotRow} renderLive={renderLive} />
          </ChromeBoundary>
        );
      } else {
        peek = <PeekPast row={hotRow} reader={pastReader?.(hotRow, query)} />;
      }
    }
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
            // SKELETON (SE-1c red): an offer's row is not drawn yet
            rows.map((row, index) =>
              isOffer(row) ? null : (
                <SessionRow
                  key={row.id}
                  row={row}
                  id={optionId(index)}
                  hot={index === hot}
                  onOpen={() => onOpen(index)}
                />
              ),
            ),
          )}
        </div>
        {peek}
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
          data-scope={scope}
          style={{ width: layout.width, height: layout.height }}
          onKeyDown={onKeyDown}
        >
          <div className="vf-peek-field">
            <FieldGlyph name="search" size={18} />
            {/* SKELETON (SE-1c red): the tokens are not drawn yet */}
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
            {/* SE-D1: the field's end — SKELETON (SE-1c red): the small switch
                alone, + Filter not drawn yet */}
            <div className="vf-peek-fend">
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
            </div>
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
                aria-keyshortcuts={isOffer(hotRow) ? "Tab" : "Enter"}
                onClick={() => onOpen(hot)}
              >
                {openWords(hotRow, view)}
                {/* the key that takes it, printed on it: ⇥ for the offer, ↵ for a row */}
                <kbd className="vf-peek-open-key">{isOffer(hotRow) ? "⇥" : "↵"}</kbd>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
