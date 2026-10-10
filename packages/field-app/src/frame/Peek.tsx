import {
  type CursorKey,
  FIND_DEBOUNCE_MS,
  type HistoryPort,
  moveCursor,
} from "@vibecook/puppeteer-views";
import type { FrameView, IndexRecentSession, IndexSearchHit } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { isSearchChord, listenForProductChord } from "../field/product-chords";
import { openHistoryAt } from "../history/open-at";
import { getRendererLogger } from "../logging";
import {
  filterToken,
  type GodviewFindDoor,
  type LiveFeed,
  type LiveFeedSnapshot,
  type LiveFindAgent,
  type OpenLiveFeed,
  useGodviewFindDoor,
} from "./find-door";
import { type FrameSurface, foldSurface } from "./frame-surface";
import { openLiveRow } from "./live-open";
import { PeekButtonView, type PeekMenu, PeekView } from "./PeekView";
import {
  isLiveRow,
  type LiveFeedState,
  liveFoot,
  liveNone,
  type PeekListRow,
  type PeekLiveRow,
  peekLiveRows,
} from "./peek-live";
import {
  hasOpenQuote,
  latestRows,
  NO_PEEK_FILTERS,
  type PeekFilters,
  type PeekLayout,
  type PeekPhase,
  type PeekScope,
  type PeekTarget,
  peekAgents,
  peekFoot,
  peekLayout,
  peekNone,
  peekRows,
  unansweredWords,
} from "./peek-model";
import { LivePeekPane } from "./peek-pane/LivePeekPane";
import { type PeekPort, type PeekProject, peekPortOver } from "./peek-port";
import { useLiveFind } from "./use-live-find";
import { requestView } from "./view-state";
import type { ViewKeys } from "./views";

// SEARCH — THE PEEK'S CONTROLLER (DESIGN.md §8 "Search — the Peek"; One Frame
// §23, GV-D8/D9/D10/D3; built for History 2026-10-08, P1; Live now and
// Godview 2026-10-09, P2). It owns what the Peek DOES — the words asked of the
// index (debounced, the newest answer kept), your latest sessions before a
// word is typed, the filters, the hot row, the keys, the focus, the window it
// fits — and nothing it shows, which is `PeekView`'s. Whether it is open is
// NOT its own: that is the frame's one value (`frame-surface.ts`, `search`),
// which this reads and asks — so the palette, a drawer, the Me menu, Settings
// and a change of view fold it, and it folds them. What it reads comes
// through a port, so the catalog runs this exact controller over a fixture.
//
// LIVE NOW (P2): Godview's rows through the door its monitor publishes
// (`find-door.ts`, GV-D3's filters with them), or — in History — a feed of the
// Peek's own, opened only while Live now shows (docket PK5): asked through
// puppeteer's find model (`use-live-find.ts`) and drawn as the Peek's rows
// (`peek-live.ts`).

/** The views that search with the Peek: History and Godview (P2). */
export function viewSearchesWithPeek(view: FrameView): boolean {
  return view === "history" || view === "godview";
}

/** The scope a view opens on (GV-D9): Live now in Godview, Everything in History. */
export function ownScope(view: FrameView): PeekScope {
  return view === "godview" ? "live" : "everything";
}

const NO_RUNS: readonly LiveFindAgent[] = Object.freeze([]);
const NO_FEED_SNAPSHOT: LiveFeedSnapshot = Object.freeze({
  runs: NO_RUNS,
  state: { kind: "connecting" as const },
});
const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/** PK5 — History's own feed, held exactly while `shows`: opened when Live now
 * comes to show, disposed when it stops (a change of scope, the popup's close,
 * the view's change, unmount). */
function useLiveFeedWhile(
  openFeed: (() => LiveFeed) | undefined,
  shows: boolean,
): { feed: LiveFeed | null; snapshot: LiveFeedSnapshot } {
  const [feed, setFeed] = useState<LiveFeed | null>(null);
  useEffect(() => {
    if (!shows || openFeed === undefined) {
      setFeed(null);
      return;
    }
    const opened = openFeed();
    setFeed(opened);
    return () => opened.dispose();
  }, [shows, openFeed]);
  const subscribe = useCallback(
    (listener: () => void) => (feed === null ? NO_SUBSCRIPTION() : feed.subscribe(listener)),
    [feed],
  );
  const read = useCallback(() => (feed === null ? NO_FEED_SNAPSHOT : feed.read()), [feed]);
  return { feed, snapshot: useSyncExternalStore(subscribe, read, read) };
}

function boxOf(container: HTMLElement | null | undefined): { width: number; height: number } {
  if (container !== null && container !== undefined) {
    return { width: container.clientWidth, height: container.clientHeight };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

export interface PeekProps {
  view: FrameView;
  keys: ViewKeys;
  /** The frame's open surface, from its one owner. */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  port: PeekPort;
  /** Where a past row opens: History's room at the line, in the product. */
  onOpenPast: (target: PeekTarget) => void;
  /** Godview's live rows (`find-door.ts`), read while Godview is the view. */
  godview?: GodviewFindDoor | null;
  /** PK5 — History's own feed, opened only while Live now shows there. */
  openLiveFeed?: (() => LiveFeed) | undefined;
  /** Where a live row opens: in the terminals (`live-open.ts`, in the product). */
  onOpenLive?: (row: PeekLiveRow) => void;
  /** The live peek's picture: the run's own pane, watched. */
  renderLive?: (row: PeekLiveRow) => ReactNode;
  /** Whether ⌘F is heard on the window. The catalog's Peek binds none: its
   * page is not a window the frame owns. */
  bindKeys?: boolean;
  /** Where the scrim and the popup are drawn: the document's body in the
   * product (outside the field, so the field recedes under them), a catalog
   * plate's box in the catalog. */
  container?: HTMLElement | null;
  /** The words a catalog plate holds when it opens. */
  initialQuery?: string;
  /** Whether opening takes the keyboard (the field, the caret at its end). A
   * catalog plate drawn open must not take its page's focus. */
  takeFocus?: boolean;
  now?: () => number;
}

export function Peek({
  view,
  keys,
  surface,
  onSurfaceChange,
  port,
  onOpenPast,
  godview = null,
  openLiveFeed,
  onOpenLive,
  renderLive,
  bindKeys = true,
  container,
  initialQuery = "",
  takeFocus = true,
  now = Date.now,
}: PeekProps): ReactElement | null {
  const open = surface === "search";
  const searches = viewSearchesWithPeek(view);
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<PeekScope>(() => ownScope(view));
  const [filters, setFilters] = useState<PeekFilters>(NO_PEEK_FILTERS);
  const [menu, setMenu] = useState<PeekMenu | null>(null);
  const [hot, setHot] = useState(0);
  const [hits, setHits] = useState<readonly IndexSearchHit[]>([]);
  const [latest, setLatest] = useState<readonly IndexRecentSession[]>([]);
  const [latestPhase, setLatestPhase] = useState<{ answered: boolean; failed?: string }>({
    answered: false,
  });
  const [searchPhase, setSearchPhase] = useState<PeekPhase>({ kind: "searching" });
  const [projects, setProjects] = useState<readonly PeekProject[]>([]);
  const [box, setBox] = useState(() => boxOf(container));
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const findRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  const fold = useCallback(
    () => onSurfaceChange(foldSurface(surface, "search")),
    [onSurfaceChange, surface],
  );
  const focusField = useCallback(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, []);

  // Each open starts on the view's own scope — Live now in Godview, Everything
  // in History (GV-D9) — at the first row; Everything asks for what its list
  // shows before a word is typed and for the projects its dropdown names.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setScope(ownScope(view));
      setMenu(null);
      setHot(0);
      setBox(boxOf(container));
      // where the keyboard was, read BEFORE this render commits: the field
      // goes inert under the popup, and an inert subtree lets go of focus
      if (takeFocus) {
        const before = document.activeElement;
        returnFocus.current = before !== null && before !== document.body ? before : null;
      }
    }
  }
  const everythingShows = open && scope === "everything";
  useEffect(() => {
    if (!everythingShows) return;
    let current = true;
    setLatestPhase({ answered: false });
    port.latest().then(
      (answer) => {
        if (!current) return;
        setLatest(answer.rows);
        setLatestPhase({ answered: true });
      },
      (error: unknown) => {
        if (current)
          setLatestPhase({
            answered: true,
            failed: error instanceof Error ? error.message : String(error),
          });
      },
    );
    port.projects().then(
      (answer) => {
        if (current) setProjects(answer);
      },
      // the dropdown keeps Every project: a list it cannot read narrows nothing
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [everythingShows, port]);

  // The words, asked of the index: debounced (Find's 120ms), the newest ask's
  // answer kept and every older one dropped. An unanswered question keeps the
  // rows the last answer showed — never "no matches" for a question nobody
  // answered — and a quote still open asks nothing (rosetta refuses an
  // unterminated phrase).
  const words = query.trim();
  const openQuote = hasOpenQuote(words);
  const kind = filters.kind === "any" ? null : filters.kind;
  useEffect(() => {
    if (!open || scope !== "everything" || words === "" || openQuote) return;
    let current = true;
    setSearchPhase({ kind: "searching" });
    const timer = window.setTimeout(() => {
      port.search({ q: words, kind }).then(
        (result) => {
          if (!current) return;
          if (result.answered) setHits(result.hits);
          setSearchPhase({ kind: "answer", result });
        },
        (error: unknown) => {
          if (current)
            setSearchPhase({
              kind: "failed",
              reason: error instanceof Error ? error.message : String(error),
            });
        },
      );
    }, FIND_DEBOUNCE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [open, scope, words, openQuote, kind, port]);

  const phase: PeekPhase =
    words === ""
      ? { kind: "latest", ...latestPhase }
      : openQuote
        ? { kind: "open-quote" }
        : searchPhase;
  // The clock is read when the list changes, never every render.
  const empty = words === "";
  const pastRows = useMemo(
    () => (empty ? latestRows(latest, filters, now()) : peekRows(hits, filters, now())),
    [empty, latest, hits, filters, now],
  );

  // LIVE NOW: Godview's rows while Godview is the view; in History, the
  // Peek's own feed while Live now shows (PK5) — and none at all otherwise.
  const liveShows = open && scope === "live";
  const inGodview = view === "godview";
  const historyFeed = useLiveFeedWhile(openLiveFeed, liveShows && !inGodview);
  let liveRuns: readonly LiveFindAgent[] = NO_RUNS;
  let liveFeed: LiveFeedState = { kind: "connecting" };
  let liveHistory: HistoryPort | null = null;
  if (inGodview) {
    if (godview !== null) {
      liveRuns = godview.rows;
      liveFeed = { kind: "live" };
      liveHistory = godview.history;
    }
  } else if (openLiveFeed === undefined) {
    liveFeed = { kind: "unavailable", reason: "this window has no feed of what runs" };
  } else {
    liveRuns = historyFeed.snapshot.runs;
    liveFeed = historyFeed.snapshot.state;
    liveHistory = historyFeed.feed?.history ?? null;
  }
  const liveFilters = inGodview ? (godview?.filters ?? null) : null;
  const live = useLiveFind({
    active: liveShows,
    runs: liveRuns,
    history: liveHistory,
    query,
    now,
  });
  const liveRows = useMemo(
    () => peekLiveRows(live.found, liveRuns, query),
    [live.found, liveRuns, query],
  );
  const rows: readonly PeekListRow[] = scope === "live" ? liveRows : pastRows;

  const filtered =
    scope === "live"
      ? liveFilters !== null && (liveFilters.desk !== null || liveFilters.profile !== null)
      : filters.project !== null || filters.agent !== null;
  let none: string | null = null;
  if (rows.length === 0 && scope === "live") {
    none = liveNone(liveFeed, query, filtered);
  } else if (rows.length === 0) {
    if (phase.kind === "latest" && phase.answered) {
      none =
        phase.failed === undefined
          ? filtered
            ? "None of your latest sessions is in what the filters keep."
            : "Nothing to show yet — your latest sessions appear here once the index has read them."
          : "Your latest sessions could not be read.";
    } else if (phase.kind === "answer") {
      none = phase.result.answered
        ? peekNone(words, filtered)
        : `Search waits for the index — ${unansweredWords(phase.result)}.`;
    } else if (phase.kind === "failed") {
      none = "Search could not ask the index.";
    }
  }
  const foot =
    scope === "live"
      ? liveFoot({
          feed: liveFeed,
          query,
          rows: liveRows,
          status: live.status,
          searching: live.searching,
          answered: live.answered,
          clipped: live.clipped,
        })
      : peekFoot(phase, pastRows);
  const hotIndex = rows.length === 0 ? -1 : Math.min(hot, rows.length - 1);

  // A new list starts at its first row (React's state-from-the-previous-render
  // pattern: no effect, no extra frame with a stale row hot). Live now's list
  // is rebuilt as the runs move (a state, a clock), so it is new only when its
  // rows are — the find sheet's rule — and never under a walking cursor.
  const listSeen =
    scope === "live" ? `live\n${liveRows.map((row) => row.id).join("\n")}` : pastRows;
  const [rowsSeen, setRowsSeen] = useState<unknown>(listSeen);
  if (rowsSeen !== listSeen) {
    setRowsSeen(listSeen);
    setHot(0);
  }

  const openRow = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row === undefined) return;
      // a row opened is its view's to focus: the room's, or the pane's
      returnFocus.current = null;
      fold();
      if (isLiveRow(row)) onOpenLive?.(row);
      else onOpenPast(row.target);
    },
    [rows, fold, onOpenPast, onOpenLive],
  );

  // ⌘F (Ctrl+F) — a product chord on the window's capture phase while a view
  // that searches is showing (History and Godview): it opens the Peek, or puts
  // the caret back in its field while it is open. Elsewhere it is left alone.
  useEffect(() => {
    if (!bindKeys) return;
    return listenForProductChord(
      (event) => searches && isSearchChord(event, keys),
      (event) => {
        if (event.repeat) return;
        if (open) focusField();
        else onSurfaceChange("search");
      },
    );
  }, [bindKeys, searches, keys, open, focusField, onSurfaceChange]);

  // While open, Esc is the Peek's before anything else hears it: an open
  // dropdown's menu first, then the popup. A press outside an open menu folds
  // the menu.
  useEffect(() => {
    if (!open || !bindKeys) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (menu !== null) setMenu(null);
      else fold();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, bindKeys, menu, fold]);
  useEffect(() => {
    if (menu === null) return;
    const onPress = (event: PointerEvent): void => {
      const place = (event.target as Element | null)?.closest?.("[data-peek-dd]");
      if (place?.getAttribute("data-peek-dd") === menu) return;
      setMenu(null);
    };
    window.addEventListener("pointerdown", onPress, true);
    return () => window.removeEventListener("pointerdown", onPress, true);
  }, [menu]);

  // ↑ ↓ walk the rows and ↵ opens the hot one — from the field, which holds
  // the keyboard while the popup is open (a button keeps its own Return). Esc
  // inside the popup is heard here too: the catalog's Peek binds nothing on
  // its page's window, and in the product the window's listener above has
  // already taken it.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (menu !== null) setMenu(null);
        else fold();
        return;
      }
      if (event.target !== inputRef.current) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const key = event.key as CursorKey;
        setHot((at) => Math.max(0, moveCursor(at, key, rows.length)));
      } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        openRow(hotIndex);
      }
    },
    [rows.length, openRow, hotIndex, menu, fold],
  );

  // The keyboard: the field on open (the caret at its end), and back where it
  // was on a close of its own — a row opened is the room's to focus.
  useLayoutEffect(() => {
    if (open && takeFocus) focusField();
  }, [open, takeFocus, focusField]);
  useEffect(() => {
    if (open || !takeFocus) return;
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  }, [open, takeFocus]);

  // The hot row stays in sight as the keys walk it.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[data-hot="true"]');
    if (row !== null && row !== undefined && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [hotIndex]);

  // The window it fits (K6): measured on open, when its box is first known
  // (a catalog plate's, after its first render), and as the window resizes.
  useLayoutEffect(() => {
    setBox(boxOf(container));
  }, [container]);
  useEffect(() => {
    if (!open) return;
    const onResize = (): void => setBox(boxOf(container));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, container]);
  const layout: PeekLayout = useMemo(() => peekLayout(box.width, box.height), [box]);

  const agents = useMemo(() => peekAgents().map((row) => ({ id: row.id, label: row.label })), []);
  const changeFilters = useCallback((next: PeekFilters) => {
    setFilters(next);
    setMenu(null);
  }, []);
  const changeScope = useCallback(
    (next: PeekScope) => {
      setScope(next);
      setMenu(null);
      focusField();
    },
    [focusField],
  );

  // PK2: the button's width, published for the views whose own head shares its
  // band (Godview's bar ends one gap short of it, godview.css) — the circle's
  // 40, or wider while a filter token rides it. The window's own Peek only: a
  // catalog plate binds nothing on its page.
  useLayoutEffect(() => {
    const find = findRef.current;
    if (!searches || !bindKeys || find === null) return;
    const root = document.documentElement;
    const publish = (): void =>
      root.style.setProperty("--vf-peek-find-width", `${Math.round(find.offsetWidth)}px`);
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(find);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--vf-peek-find-width");
    };
  }, [searches, bindKeys]);

  // GV-D3: in Godview the button wears the filter that is on, and its × clears it
  const token = inGodview && godview !== null ? filterToken(godview.filters) : null;
  const clearToken = useCallback(() => {
    godview?.setDesk(null);
    godview?.setProfile(null);
  }, [godview]);
  const pickDesk = useCallback(
    (id: string | null) => {
      godview?.setDesk(id);
      setMenu(null);
    },
    [godview],
  );
  const pickProfile = useCallback(
    (id: string | null) => {
      godview?.setProfile(id);
      setMenu(null);
    },
    [godview],
  );

  const target = container === undefined ? document.body : container;
  return (
    <>
      {searches && (
        <PeekButtonView
          keys={keys}
          open={open}
          buttonRef={buttonRef}
          findRef={findRef}
          token={token}
          onClearToken={clearToken}
          onPress={() => (open ? fold() : onSurfaceChange("search"))}
        />
      )}
      {target !== null &&
        createPortal(
          <PeekView
            open={open}
            keys={keys}
            view={view}
            layout={layout}
            query={query}
            scope={scope}
            filters={filters}
            projects={projects}
            agents={agents}
            liveFilters={liveFilters}
            onLiveDesk={pickDesk}
            onLiveProfile={pickProfile}
            rows={rows}
            hot={hotIndex}
            foot={foot}
            none={none}
            menu={menu}
            {...(renderLive !== undefined ? { renderLive } : {})}
            inputRef={inputRef}
            listRef={listRef}
            onQuery={setQuery}
            onScope={changeScope}
            onMenu={setMenu}
            onFilters={changeFilters}
            onOpen={openRow}
            onClose={fold}
            onKeyDown={onKeyDown}
          />,
          target,
        )}
    </>
  );
}

/** The live peek in the product: the run's own pane, watched (GV-D8). */
const renderLivePane = (row: PeekLiveRow): ReactNode =>
  row.floorSessionId === null ? null : <LivePeekPane sessionId={row.floorSessionId} />;

/** The Peek as the frame holds it (ChromeLayer): over this window's fieldd
 * client, a past row opening History's room at the line (`open-at.ts`) —
 * asking for History first when the Peek opened in Godview — and a live row
 * opening in the terminals (`live-open.ts`): Godview's own select there, Jump
 * to's reveal from History, whose Live now reads the feed `openLiveFeed`
 * opens over this client (PK5). */
export function FramePeek({
  view,
  keys,
  surface,
  onSurfaceChange,
  openLiveFeed,
}: {
  view: FrameView;
  keys: ViewKeys;
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  openLiveFeed?: OpenLiveFeed;
}): ReactElement | null {
  const fieldd = useFielddClient();
  const port = useMemo(() => peekPortOver(fieldd), [fieldd]);
  const godview = useGodviewFindDoor();
  const openFeed = useMemo(
    () =>
      openLiveFeed === undefined
        ? undefined
        : () =>
            openLiveFeed({
              request: (method, params) => fieldd.request(method, params),
              subscribe: (method, params, onFrame, opts) =>
                fieldd.subscribe(method, params, onFrame, opts),
            }),
    [openLiveFeed, fieldd],
  );
  const openPast = useCallback(
    (target: PeekTarget) => {
      openHistoryAt(target);
      if (view !== "history") void requestView("history");
    },
    [view],
  );
  const openLive = useCallback(
    (row: PeekLiveRow) => {
      void openLiveRow(row, view).then((outcome) => {
        if (outcome.state === "refused") {
          getRendererLogger()
            .child({ component: "peek" })
            .info("renderer.peek.live_unshown", "a live row the Peek opened was not shown", {
              row: row.id,
              from: view,
              reason: outcome.reason,
            });
        }
      });
    },
    [view],
  );
  return (
    <Peek
      view={view}
      keys={keys}
      surface={surface}
      onSurfaceChange={onSurfaceChange}
      port={port}
      onOpenPast={openPast}
      godview={godview}
      openLiveFeed={openFeed}
      onOpenLive={openLive}
      renderLive={renderLivePane}
    />
  );
}
