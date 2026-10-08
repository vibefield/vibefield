import { type CursorKey, FIND_DEBOUNCE_MS, moveCursor } from "@vibecook/puppeteer-views";
import type { FrameView, IndexRecentSession, IndexSearchHit } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import {
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { isSearchChord, listenForProductChord } from "../field/product-chords";
import { openHistoryAt } from "../history/open-at";
import { type FrameSurface, foldSurface } from "./frame-surface";
import { PeekButtonView, type PeekMenu, PeekView } from "./PeekView";
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
import { type PeekPort, type PeekProject, peekPortOver } from "./peek-port";
import { requestView } from "./view-state";
import type { ViewKeys } from "./views";

// SEARCH — THE PEEK'S CONTROLLER (DESIGN.md §8 "Search — the Peek"; One Frame
// §23, GV-D8/D9/D10/D3; built for History 2026-10-08, P1). It owns what the
// Peek DOES — the words asked of the index (debounced, the newest answer
// kept), your latest sessions before a word is typed, the filters, the hot
// row, the keys, the focus, the window it fits — and nothing it shows, which
// is `PeekView`'s. Whether it is open is NOT its own: that is the frame's one
// value (`frame-surface.ts`, `search`), which this reads and asks — so the
// palette, a drawer, the Me menu, Settings and a change of view fold it, and
// it folds them. What it reads comes through a port, so the catalog runs this
// exact controller over a fixture.

/** The views that search with the Peek in this build: History. Godview keeps
 * its own Find (the bar's sheet, ⌘F) until P2 brings Live now here. */
export function viewSearchesWithPeek(view: FrameView): boolean {
  return view === "history";
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
  bindKeys = true,
  container,
  initialQuery = "",
  takeFocus = true,
  now = Date.now,
}: PeekProps): ReactElement | null {
  const open = surface === "search";
  const searches = viewSearchesWithPeek(view);
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<PeekScope>("everything");
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

  // Each open starts on the view's own scope — Everything in History (GV-D9)
  // — at the first row, and asks for what the list shows before a word is
  // typed and for the projects its dropdown names.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setScope("everything");
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
  useEffect(() => {
    if (!open) return;
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
  }, [open, port]);

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
  const rows = useMemo(
    () => (empty ? latestRows(latest, filters, now()) : peekRows(hits, filters, now())),
    [empty, latest, hits, filters, now],
  );
  const filtered = filters.project !== null || filters.agent !== null;
  let none: string | null = null;
  if (rows.length === 0) {
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
  const foot = peekFoot(scope, phase, rows);
  const hotIndex = rows.length === 0 ? -1 : Math.min(hot, rows.length - 1);

  // A new list starts at its first row (React's state-from-the-previous-render
  // pattern: no effect, no extra frame with a stale row hot).
  const [rowsSeen, setRowsSeen] = useState(rows);
  if (rowsSeen !== rows) {
    setRowsSeen(rows);
    setHot(0);
  }

  const openRow = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row === undefined) return;
      returnFocus.current = null;
      fold();
      onOpenPast(row.target);
    },
    [rows, fold, onOpenPast],
  );

  // ⌘F (Ctrl+F) — a product chord on the window's capture phase while a view
  // that searches is showing: it opens the Peek, or puts the caret back in its
  // field while it is open. Elsewhere (Godview, until P2) it is left alone.
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
        if (scope === "everything") openRow(hotIndex);
      }
    },
    [rows.length, scope, openRow, hotIndex, menu, fold],
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

  const target = container === undefined ? document.body : container;
  return (
    <>
      {searches && (
        <PeekButtonView
          keys={keys}
          open={open}
          buttonRef={buttonRef}
          onPress={() => (open ? fold() : onSurfaceChange("search"))}
        />
      )}
      {target !== null &&
        createPortal(
          <PeekView
            open={open}
            keys={keys}
            layout={layout}
            query={query}
            scope={scope}
            filters={filters}
            projects={projects}
            agents={agents}
            rows={rows}
            hot={hotIndex}
            foot={foot}
            none={none}
            menu={menu}
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

/** The Peek as the frame holds it (ChromeLayer): over this window's fieldd
 * client, a past row opening History's room at the line (`open-at.ts`) — and
 * asking for History first, should the Peek ever open elsewhere. */
export function FramePeek({
  view,
  keys,
  surface,
  onSurfaceChange,
}: {
  view: FrameView;
  keys: ViewKeys;
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
}): ReactElement | null {
  const fieldd = useFielddClient();
  const port = useMemo(() => peekPortOver(fieldd), [fieldd]);
  const openPast = useCallback(
    (target: PeekTarget) => {
      openHistoryAt(target);
      if (view !== "history") void requestView("history");
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
    />
  );
}
