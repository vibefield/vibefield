import type { FrameView } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { AgentIcon, ProfileGlyph } from "@vibefield/puppeteer-view-sdk/react";
import { keyLegend } from "@vibefield/puppeteer-view-sdk/toolkit";
import { ChromeBoundary, type SnippetSegment } from "@vibefield/puppeteer-views";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useId,
} from "react";
import { OS_LABEL, OsMark } from "../godview/os-marks";
import type { LiveDeskChoice, LiveFilters, LivePlanChoice, LiveProfileChoice } from "./find-door";
import {
  isOffer,
  liveHeadWords,
  offerWords,
  type PeekFieldToken,
  type PeekListItem,
  type PeekMark,
  type PeekMenuGroup,
  type PeekMenuRow,
  type PeekOffer,
  type PeekPick,
  rowProfile,
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
  /** UM-5a — the plan chosen on a meter: after the profile's, its agent's mark */
  readonly plan?: LivePlanChoice;
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
      : [token.desk?.name, token.profile?.label, token.plan?.label]
          .filter((part) => part !== undefined)
          .join(" · ");
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
          {token.plan !== undefined && (token.desk !== null || token.profile !== null) && (
            <i className="vf-peek-token-sep" aria-hidden="true" />
          )}
          {token.plan !== undefined && (
            <span className="vf-peek-token-part">
              <span className="vf-peek-agent-mark" aria-hidden="true">
                <AgentIcon providerId={token.plan.provider} />
              </span>
              {token.plan.label}
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

/** A token's, a menu row's or an offer's mark (§8): the desktop's OS mark, the
 * profile's glyph (filled for the default), a FieldGlyph, or the agent's mark —
 * which draws at its text's size, so its box is 12, the one size the Peek
 * draws it (a token's and a menu row's). */
function Mark({ mark, size }: { mark: PeekMark; size: number }): ReactElement {
  switch (mark.kind) {
    case "os":
      return <OsMark os={mark.os} size={size} />;
    case "profile":
      return (
        <ProfileGlyph glyph={mark.glyph} kind={mark.profileKind} filled={mark.filled} size={size} />
      );
    case "glyph":
      return <FieldGlyph name={mark.name} size={size} />;
    case "agent":
      return (
        <span className="vf-peek-agent-mark" aria-hidden="true">
          <AgentIcon providerId={mark.id} />
        </span>
      );
  }
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
 * watch another desktop's terminal yet (K10, until DS-4's mirror). It wears a
 * head, the past peek's recipe (SE-D1): its title, and `head` under it — its
 * folder, agent, profile, where it runs and its state (`liveHeadWords`). */
export function PeekLive({
  row,
  head,
  renderLive,
}: {
  row: PeekLiveRow;
  head: string;
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
      <header className="vf-peek-past-head">
        <b>{row.title}</b>
        <small>{head}</small>
      </header>
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
  /** where a live run of this device's runs, in a sentence ("on this Mac",
   * `onThisDeviceWords`): what its head says */
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

/** MV-8b: Live now's filters, Godview's own, are chrome pieces of their own
 * where they stand — the field's tokens and + Filter — each tried again for the
 * filters they draw (held by content by the monitor); Everything's are the
 * popup's, drawn as they are. */
function filtersBoundary(
  name: string,
  liveFilters: LiveFilters | null,
  items: ReactNode,
): ReactNode {
  return liveFilters === null ? (
    items
  ) : (
    <ChromeBoundary name={name} retryKey={liveFilters}>
      {items}
    </ChromeBoundary>
  );
}

/** A menu row's mark size (§8 "The Filter menu"): a desktop's OS mark and the
 * ghost row's plus at 11; a profile's glyph, `folder` and an agent's mark at 12. */
const menuMarkSize = (mark: PeekMark): number =>
  mark.kind === "os" || (mark.kind === "glyph" && mark.name === "plus") ? 11 : 12;

/** SE-D1: the filters that are on, as tokens in the field — each its mark (12,
 * in secondary ink), its name and its ×, said "Remove ‹name›". */
function FieldTokens({
  tokens,
  onRemove,
}: {
  tokens: readonly PeekFieldToken[];
  onRemove: (token: PeekFieldToken) => void;
}): ReactElement {
  return (
    <span className="vf-peek-tokens">
      {tokens.map((token) => (
        <span key={token.filter} className="vf-peek-field-token" data-filter={token.filter}>
          <Mark mark={token.mark} size={12} />
          <span className="vf-peek-field-token-label">{token.label}</span>
          <button
            type="button"
            className="vf-peek-field-token-clear"
            aria-label={`Remove ${token.label}`}
            onClick={() => onRemove(token)}
          >
            <FieldGlyph name="close" size={8} />
          </button>
        </span>
      ))}
    </span>
  );
}

/** One row of + Filter's menu: a radio — the chosen one in the ready fill — or
 * TS-4's ghost row, an offer and not a choice, under a hairline. */
function FilterMenuRow({
  row,
  onPick,
}: {
  row: PeekMenuRow;
  onPick: (pick: PeekPick | "connect") => void;
}): ReactElement {
  const { mark, note, pick } = row;
  const lead =
    mark === null ? null : (
      <span className="vf-peek-menu-lead">
        <Mark mark={mark} size={menuMarkSize(mark)} />
      </span>
    );
  const said = note === null ? null : <em className="vf-peek-menu-note">{note}</em>;
  if (pick === "connect") {
    return (
      <>
        <hr className="vf-peek-menu-rule" />
        <button
          type="button"
          role="menuitem"
          className="vf-menu-row"
          data-ghost=""
          onClick={() => onPick(pick)}
        >
          {lead}
          <span className="vf-menu-label">{row.label}</span>
          {said}
        </button>
      </>
    );
  }
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={row.on}
      className="vf-menu-row"
      data-hot={row.on ? "" : undefined}
      data-quiet={row.quiet ? "" : undefined}
      onClick={() => onPick(pick)}
    >
      {lead}
      <span className="vf-menu-label">{row.label}</span>
      {said}
    </button>
  );
}

/** SE-D1: + Filter and its one menu — a solid menu, right-aligned 4 under it,
 * every choice under the menus' eyebrow. Each group is a radio set of its own,
 * so assistive tech hears it by its eyebrow and checks one row in it: Every
 * profile and All desktops are two sets' choices, never one's. */
function FilterButton({
  groups,
  open,
  onOpen,
  onPick,
}: {
  groups: readonly PeekMenuGroup[];
  open: boolean;
  onOpen: (open: boolean) => void;
  onPick: (pick: PeekPick | "connect") => void;
}): ReactElement {
  const menuId = useId();
  return (
    <span className="vf-peek-filter-place" data-peek-dd="filter">
      <button
        type="button"
        className="vf-peek-filter"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => onOpen(!open)}
      >
        <FieldGlyph name="plus" size={11} />
        Filter
      </button>
      {open && (
        <div id={menuId} className="vf-menu vf-peek-menu" role="menu" aria-label="Filter">
          {groups.map((group) => (
            // biome-ignore lint/a11y/useSemanticElements: a menu's group of radio rows (ARIA's group inside a menu), not a fieldset of form inputs
            <div
              key={group.eyebrow}
              role="group"
              aria-label={group.eyebrow}
              className="vf-peek-menu-group"
            >
              <div className="vf-menu-eye" aria-hidden>
                {group.eyebrow}
              </div>
              {group.rows.map((row) => (
                <FilterMenuRow key={row.key} row={row} onPick={onPick} />
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

/** SE-D1: a typed name's offer, first in the list — its mark at 15 in a 17
 * column, its words, its sessions, and ⇥ printed on a key cap. */
function OfferRow({
  offer,
  id,
  hot,
  onOpen,
}: {
  offer: PeekOffer;
  id: string;
  hot: boolean;
  onOpen: () => void;
}): ReactElement {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the field holds the keys (⇥ ↵), as a combobox's listbox does
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={hot}
      className="vf-peek-row"
      data-hot={hot ? "true" : undefined}
      data-kind="offer"
      onClick={onOpen}
    >
      <span className="vf-peek-row-head">
        <span className="vf-peek-offer-mark">
          <Mark mark={offer.mark} size={15} />
        </span>
        <b className="vf-peek-title">{offer.title}</b>
        <span className="vf-peek-when">{offer.note}</span>
        <kbd className="vf-peek-tab">⇥</kbd>
      </span>
    </div>
  );
}

/** A session's row, live or past: its head, then folder · agent — a run of
 * this desktop's saying its profile (SE-D1), a peer's where it runs (K10) — and
 * its matched lines. */
function SessionRow({
  row,
  profile,
  id,
  hot,
  onOpen,
}: {
  row: PeekListRow;
  profile: LiveProfileChoice | null;
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
      {(where !== null || profile !== null || remote !== null) && (
        <span className="vf-peek-sub">
          {where}
          {profile !== null && (
            <span className="vf-peek-prof">
              <ProfileGlyph
                glyph={profile.glyph}
                kind={profile.kind}
                filled={profile.isDefault === true}
                size={11}
              />
              {profile.label}
            </span>
          )}
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
    liveFilters = null,
    tokens,
    filterMenu,
    filterOpen,
    here,
    rows,
    hot,
    foot,
    none,
    renderLive,
    inputRef,
    listRef,
    onQuery,
    onScope,
    onFilterOpen,
    onPick,
    onRemoveToken,
    onOpen,
    onClose,
    onKeyDown,
    pastReader,
  } = props;
  const listId = useId();
  const optionId = (index: number): string => `${listId}-row-${index}`;
  const hotRow = hot >= 0 ? rows[hot] : undefined;
  const words = query.trim();
  // Live now's filters are Godview's (GV-D3); Everything draws none of them (UM-D28)
  const live = scope === "live" ? liveFilters : null;
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
    if (!layout.folded && hotRow !== undefined) {
      if (isOffer(hotRow)) {
        // SE-D1: what taking the offer does — a 56 circle holding its mark, and the words
        peek = (
          <section className="vf-peek-live" aria-label="What taking it does">
            <div className="vf-peek-live-words">
              <span className="vf-peek-offer-circle">
                <Mark mark={hotRow.mark} size={24} />
              </span>
              <p>{offerWords(hotRow)}</p>
            </div>
          </section>
        );
      } else if (isLiveRow(hotRow)) {
        // MV-8b: the live peek is a chrome piece of its own, tried again for the run it shows
        peek = (
          <ChromeBoundary name="Live peek" retryKey={hotRow.floorSessionId ?? hotRow.id}>
            <PeekLive
              row={hotRow}
              head={liveHeadWords(hotRow, rowProfile(hotRow, live), here)}
              renderLive={renderLive}
            />
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
            rows.map((row, index) =>
              isOffer(row) ? (
                <OfferRow
                  key={row.id}
                  offer={row}
                  id={optionId(index)}
                  hot={index === hot}
                  onOpen={() => onOpen(index)}
                />
              ) : (
                <SessionRow
                  key={row.id}
                  row={row}
                  profile={isLiveRow(row) ? rowProfile(row, live) : null}
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
        // its size is the controller's (K6); its height is lent to + Filter's
        // menu as `--vf-peek-h`, so the menu stays inside it (peek.css)
        <div
          className="vf-peek-pop"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          data-folded={layout.folded ? "true" : undefined}
          data-scope={scope}
          style={
            {
              width: layout.width,
              height: layout.height,
              "--vf-peek-h": `${layout.height}px`,
            } as CSSProperties
          }
          onKeyDown={onKeyDown}
        >
          <div className="vf-peek-field">
            <FieldGlyph name="search" size={18} />
            {tokens.length > 0 &&
              filtersBoundary(
                "Live filters",
                live,
                <FieldTokens tokens={tokens} onRemove={onRemoveToken} />,
              )}
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
            {/* SE-D1: the field's end — + Filter (not drawn with nothing to
                filter), then the small switch, the scope row's segment made small */}
            <div className="vf-peek-fend">
              {filterMenu.length > 0 &&
                filtersBoundary(
                  "Filter",
                  live,
                  <FilterButton
                    groups={filterMenu}
                    open={filterOpen}
                    onOpen={onFilterOpen}
                    onPick={onPick}
                  />,
                )}
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
