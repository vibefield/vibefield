import type { FrameView, PluginRegistrySnapshot, PluginsCatalog } from "@vibefield/contracts";
import { useFielddClient, useFielddStatus, useSubscription } from "@vibefield/fieldd-client/react";
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
import { usePluginRegistrySnapshot } from "../../plugin-host/plugin-registry-store";
import { useGodviewFindDoor } from "../find-door";
import { type FrameSurface, foldSurface } from "../frame-surface";
import { CommunityTileView, useCommunitySwitch } from "./CommunityTile";
import { PluginSettings } from "./PluginSettings";
import { PluginsView } from "./PluginsView";
import {
  type CommunityStatementDoor,
  communityDoor,
  communityFrom,
  communityTile,
  statementDoor,
} from "./plugins-community";
import {
  claimWindowAsk,
  primePluginUpdates,
  takePluginUpdates,
  usePluginUpdates,
} from "./plugins-count";
import {
  catalogFoot,
  installedFoot,
  installedRows,
  type PluginsRead,
  type PluginsTab,
  pluginPage,
  pluginsLayout,
  powerSwitchOf,
  type Refusal,
  refusalStale,
  shelfState,
  switchable,
  switchKey,
  walkHot,
} from "./plugins-model";
import { type PluginsPort, pluginsPortOver } from "./plugins-port";
import {
  discoverShelf,
  isShelfKey,
  listedPage,
  shelfColumns,
  shelfOrder,
  shelfShows,
  walkShelf,
} from "./plugins-shelf";

// THE PLUGINS POPUP'S CONTROLLER (MK-4a; DESIGN.md §8 "Plugins — the frame's
// second popup"): the frame's second popup, built the way search is. It is one
// of the frame's open surfaces (`plugins`), so opening it folds the others and
// any of them, Settings or a change of view folds it; the field goes inert and
// recedes under it (`field.tsx`'s modal rule). Each opening shows the list
// fieldd holds at once (`catalog`) and reads it once (`refresh`, MK-D5: the
// person's act — no timer, no retry). Esc on the window's capture phase and a
// click on the scrim fold it; the keyboard goes back where it was. Installed
// reads the registry snapshot the window already holds. MK-4c: its rows open a
// plugin's page, read only, from that snapshot and the list this popup already
// read — no page asks fieldd anything — and ↑ ↓ walk its hot row, kept in
// sight, ↵ opening its page; Esc goes back from a page before it folds the
// popup; Updates carries the Me row's count. MK-4c2a: a Built in or
// Development plugin's one switch, on its row and its page, and its powers'
// switches (§8 "Its switches"), each a request Settings → Plugins sends today.
// A switch moves only when fieldd's next snapshot does; while its request is
// out it takes no press (a second press sends nothing), a refusal is said in
// §9's words (never the error's text) until a press or fieldd's snapshot shows
// the switch the way it was turning, and while fieldd isn't answering no switch
// takes a press. Every other plugin's page reads only (item 321). MK-4c2b: a
// Built in or Development plugin's settings on its page (§8 "Its settings"),
// a section the controller mounts once per page opening and hands the view, so
// the view holds no state; each setting reads and keeps its value over the
// requests Settings → Plugins sends today. No Undo and no Redo on the page
// (James's MK-O6 pick): going back stays in Settings. MK-4e: over a held list
// Discover draws its shelf (`plugins-shelf.ts`) from the list this popup
// already read and the snapshot the window holds; ↑ ↓ walk its tiles a row at
// a time and ← → one at a time while the field holds no words, kept in sight;
// a tile, or ↵ on the hot one, opens its page, and a set this desktop doesn't
// have opens a page read from the list alone. Community sets join only while
// community plugins are on (`community`, which the switch's slice feeds).
// Its doors (MK-4b) are the Me menu's Plugins… row and the palette's Plugins…
// and Check plugins for updates, each through ChromeLayer's `openPlugins`; the
// pegboard's pill is MK-4d's. The catalog mounts this controller over a
// fixture port (`design-system/PluginsPreview.tsx`).
// MK-O3D: Discover's community tile and its switch (§8 "The community tile",
// drawn 2026-11-14): the switch as fieldd's app preferences say it, the ask in
// place, which Esc answers first, and the one request. The statement is shown
// once on each desktop (James's MK-O1 pick B): this desktop's mark is read
// while the tile stands or community plugins are on, and its ask marks it. The
// tile mounts at Discover's end, and a held list's foot says "· community off"
// while it is off.

function boxOf(container: HTMLElement | null | undefined): { width: number; height: number } {
  if (container !== null && container !== undefined) {
    return { width: container.clientWidth, height: container.clientHeight };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

export interface PluginsProps {
  /** The frame's open surface, from its one owner. */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  port: PluginsPort;
  /** The plugins this desktop has (`plugins.subscribe`); null: none held yet. */
  snapshot: PluginRegistrySnapshot | null;
  /** Whether Esc is heard on the window. A catalog plate binds none. */
  bindKeys?: boolean;
  /** Where the scrim and the popup are drawn: the document's body in the
   * product, a catalog plate's box in the catalog. */
  container?: HTMLElement | null;
  /** Whether opening takes the keyboard. A plate drawn open must not. */
  takeFocus?: boolean;
  /** The tab each opening starts on (Discover; a plate may start elsewhere). */
  initialTab?: PluginsTab;
  /** Over Godview the stage holds its keys while the popup stands (QL-D2). */
  holdKeys?: (() => () => void) | undefined;
  /** Every answer the popup takes, in the order it takes them (MK-4b: the Me row's count). A plate passes none. */
  onCatalog?: ((catalog: PluginsCatalog) => void) | undefined;
  /** Updates' count: the Me row's own value (MK-4c, VF-PM's C1); a plate passes a fixture's. */
  updates?: number | null;
  /** Whether a page says a power's Mac note (and "this Mac" where a power names the machine). */
  onMac?: boolean;
  /** A plugin whose page each opening starts on, from the tab it starts on (a plate's; the product passes none). */
  initialPage?: string | null;
  /** fieldd isn't answering this window (MK-4c2a): no switch takes a press. A plate passes a fixture's. */
  away?: boolean;
  /** MK-O3D: community plugins on or off, as fieldd's app preferences say; null: not read. */
  community?: boolean | null;
  /** MK-O3D: the community switch's request (`communityDoor`); none: the tile's switch takes no press. */
  onCommunity?: ((on: boolean) => Promise<void>) | undefined;
  /** MK-O3D (MK-O1 B): this desktop's statement mark (`statementDoor`); none: it asks each time. */
  statement?: CommunityStatementDoor | undefined;
  /** MK-O3D: a plate drawn with the community tile's ask standing. */
  initialAsk?: boolean;
  now?: () => number;
}

/** The page shown in the body: its plugin, and the tab it opened from. */
interface OpenPage {
  readonly id: string;
  readonly from: PluginsTab;
}

/** A plate's starting page, opened from the tab it starts on (MK-4e: a set's page from Discover). */
const pageAt = (id: string | null | undefined, from: PluginsTab): OpenPage | null =>
  id === null || id === undefined ? null : { id, from };

export function Plugins({
  surface,
  onSurfaceChange,
  port,
  snapshot,
  bindKeys = true,
  container,
  takeFocus = true,
  initialTab = "discover",
  holdKeys,
  onCatalog,
  updates = null,
  onMac = false,
  initialPage = null,
  away = false,
  community = null,
  onCommunity,
  statement,
  initialAsk = false,
  now = Date.now,
}: PluginsProps): ReactElement | null {
  const open = surface === "plugins";
  const [tab, setTab] = useState<PluginsTab>(initialTab);
  const [query, setQuery] = useState("");
  const [read, setRead] = useState<PluginsRead>({ kind: "asking" });
  const [reading, setReading] = useState(false);
  const [box, setBox] = useState(() => boxOf(container));
  const [page, setPage] = useState<OpenPage | null>(() => pageAt(initialPage, initialTab));
  const [hot, setHot] = useState(0);
  // the switches whose request is out, and those fieldd refused, by key (with
  // whose each is and the way it was turning); the set is also kept in a ref, so
  // a second press before React renders still sends nothing
  const underRef = useRef(new Set<string>());
  const [under, setUnder] = useState<ReadonlySet<string>>(() => new Set());
  const [refused, setRefused] = useState<ReadonlyMap<string, Refusal>>(() => new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useRef<Element | null>(null);
  // The read below runs once per opening; whoever hears its answers may change
  // without starting another read.
  const heard = useRef(onCatalog);
  useLayoutEffect(() => {
    heard.current = onCatalog;
  }, [onCatalog]);

  const fold = useCallback(
    () => onSurfaceChange(foldSurface(surface, "plugins")),
    [onSurfaceChange, surface],
  );

  // Each opening starts on its first tab with no words, where the keyboard
  // was read BEFORE this render commits (the field goes inert under it).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setTab(initialTab);
      setQuery("");
      setPage(pageAt(initialPage, initialTab));
      setHot(0);
      setRefused(new Map());
      // the last opening's "neither door answered" is not this one's: it says
      // the read until this one's doors answer (a held list stays, shown at once)
      setRead((was) => (was.kind === "away" ? { kind: "asking" } : was));
      setBox(boxOf(container));
      if (takeFocus) {
        const before = document.activeElement;
        returnFocus.current = before !== null && before !== document.body ? before : null;
      }
    }
  }

  // THE READ ON OPEN (MK-D5): one `catalog` for the list held, shown at once,
  // and one `refresh` per opening — never on a re-render, never on a timer.
  // A refresh that answers is the newer list, so a late `catalog` never
  // replaces it; neither door answering is said, never a blank.
  useEffect(() => {
    if (!open) return;
    let current = true;
    let fresh = false;
    let heldAnswered = false;
    let refreshFailed = false;
    setReading(true);
    port.catalog().then(
      (catalog) => {
        heldAnswered = true;
        if (current && !fresh) {
          setRead({ kind: "answered", catalog });
          heard.current?.(catalog);
        }
      },
      () => {
        heldAnswered = true;
        if (current && refreshFailed) {
          setRead((was) => (was.kind === "asking" ? { kind: "away" } : was));
        }
      },
    );
    port.refresh().then(
      (catalog) => {
        fresh = true;
        if (!current) return;
        setRead({ kind: "answered", catalog });
        setReading(false);
        heard.current?.(catalog);
      },
      () => {
        refreshFailed = true;
        if (!current) return;
        setReading(false);
        if (heldAnswered) setRead((was) => (was.kind === "asking" ? { kind: "away" } : was));
      },
    );
    return () => {
      current = false;
    };
  }, [open, port]);

  // A page goes back to the tab it opened from, the keyboard to the field.
  const back = useCallback(() => {
    setPage(null);
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [takeFocus]);

  // MK-O3D: Discover's community tile, at its end, while it stands (§8 "The
  // community tile"); the switch and its ask are held here so Esc answers the
  // ask first, and an ask stands only with its tile. Either way the ask goes,
  // the keyboard goes back to the field. This desktop's statement mark is read
  // while the tile stands or community plugins are on (MK-O1 B).
  const tile =
    page === null && tab === "discover"
      ? communityTile(
          shelfState(read, reading),
          read.kind === "answered" ? read.catalog : null,
          community,
        )
      : null;
  const communitySwitch = useCommunitySwitch({
    open,
    on: community,
    away,
    send: onCommunity,
    statement,
    markWanted: tile !== null || community === true,
    initialAsk,
  });
  const { cancel: dropAsk, confirm: takeAsk } = communitySwitch;
  const cancelAsk = useCallback(() => {
    dropAsk();
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [dropAsk, takeFocus]);
  const confirmAsk = useCallback(() => {
    takeAsk();
    if (takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [takeAsk, takeFocus]);
  const asking = communitySwitch.asking && tile !== null;

  // While open, Esc is the popup's before anything else hears it, and answers
  // the nearest first (§8 "Keys"): the community tile's ask goes back (MK-O3D),
  // a page goes back to its tab, then the popup folds.
  useEffect(() => {
    if (!open || !bindKeys) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (asking) cancelAsk();
      else if (page !== null) back();
      else fold();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, bindKeys, fold, page, back, asking, cancelAsk]);

  // QL-D2: over Godview, the stage holds its keys while the popup stands.
  const hold = open && bindKeys ? holdKeys : undefined;
  useEffect(() => {
    if (hold === undefined) return;
    return hold();
  }, [hold]);

  // The keyboard: the field on open, and back where it was on a close.
  useLayoutEffect(() => {
    if (open && takeFocus) inputRef.current?.focus({ preventScroll: true });
  }, [open, takeFocus]);
  useEffect(() => {
    if (open || !takeFocus) return;
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  }, [open, takeFocus]);

  // The window it fits (MK-E1): measured on open and as the window resizes.
  useLayoutEffect(() => {
    setBox(boxOf(container));
  }, [container]);
  useEffect(() => {
    if (!open) return;
    const onResize = (): void => setBox(boxOf(container));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, container]);
  const layout = useMemo(() => pluginsLayout(box.width, box.height), [box]);

  const shelf = shelfState(read, reading);
  const foot = catalogFoot(read, reading, now(), community === false);
  const catalog = read.kind === "answered" ? read.catalog : null;
  // Q6: the field's words filter Installed's rows and (MK-4e) Discover's shelf;
  // Updates' search waits for its rows, and the words are kept across the switch.
  const installed = useMemo(
    () => (snapshot === null ? null : installedRows(snapshot, catalog, query)),
    [snapshot, catalog, query],
  );
  // MK-4e: Discover's shelf, over a held list with a set to show or typed words to answer; its columns fit the
  // popup's width, and its tiles in the order the keys walk them
  const discover = useMemo(() => {
    if (catalog === null || shelf.kind !== "counted") return null;
    const built = discoverShelf(catalog, snapshot, query, community === true);
    return shelfShows(built) ? built : null;
  }, [catalog, shelf.kind, snapshot, query, community]);
  const columns = shelfColumns(layout.width);
  const tiles = useMemo(() => (discover === null ? [] : shelfOrder(discover)), [discover]);
  // the hot row or tile, held to those there are
  const walked =
    tab === "installed" ? (installed?.length ?? 0) : tab === "discover" ? tiles.length : 0;
  const hotAt = Math.max(0, Math.min(hot, walked - 1));
  // a page reads the record the window holds; a plugin gone from it closes its page, unless the list held
  // offers it (MK-4e: a set this desktop doesn't have, read from the list alone)
  const shown = useMemo(() => {
    if (page === null) return null;
    const record = snapshot?.plugins.find((plugin) => plugin.id === page.id);
    if (record !== undefined && snapshot !== null) {
      return pluginPage(record, catalog, snapshot, onMac);
    }
    const entry = catalog?.plugins.find((listed) => listed.id === page.id);
    return entry === undefined ? null : listedPage(entry);
  }, [page, snapshot, catalog, onMac]);

  // A switch's one request (§8 "Its switches"): none while fieldd isn't
  // answering or while its last is out; a refusal is kept to say it, and the
  // switch itself moves only on fieldd's next snapshot (the P5 law).
  const run = useCallback(
    (key: string, refusal: Refusal, ask: () => Promise<void>) => {
      if (away || underRef.current.has(key)) return;
      underRef.current.add(key);
      setUnder(new Set(underRef.current));
      setRefused((was) => {
        if (!was.has(key)) return was;
        const next = new Map(was);
        next.delete(key);
        return next;
      });
      ask()
        .then(
          () => undefined,
          () => setRefused((was) => new Map(was).set(key, refusal)),
        )
        .finally(() => {
          underRef.current.delete(key);
          setUnder(new Set(underRef.current));
        });
    },
    [away],
  );
  const recordOf = useCallback(
    (id: string) => snapshot?.plugins.find((plugin) => plugin.id === id),
    [snapshot],
  );
  const onTurn = useCallback(
    (id: string, on: boolean) => {
      const record = recordOf(id);
      if (record === undefined || !switchable(record)) return;
      run(switchKey.one(id), { id, capability: null, turningOn: on }, () =>
        on ? port.enable(id) : port.disable(id),
      );
    },
    [recordOf, run, port],
  );
  // a power's switch moves only where the page gives it one that takes a press
  // (`powerSwitchOf`, the page's own read): a request for any other is refused here
  const onTurnPower = useCallback(
    (id: string, capability: string, on: boolean) => {
      const record = recordOf(id);
      if (record === undefined || powerSwitchOf(record, capability)?.live !== true) return;
      run(switchKey.power(id, capability), { id, capability, turningOn: on }, () =>
        port.grant(id, capability, on),
      );
    },
    [recordOf, run, port],
  );
  // a refusal goes once fieldd's snapshot shows its switch the way it was being
  // turned (§8 "Installed", MK-4c2a's rider)
  useEffect(() => {
    if (snapshot === null) return;
    setRefused((was) => {
      const stale = [...was].filter(([, refusal]) => refusalStale(refusal, snapshot));
      if (stale.length === 0) return was;
      const next = new Map(was);
      for (const [key] of stale) next.delete(key);
      return next;
    });
  }, [snapshot]);

  const showInstalled = useCallback(() => {
    setTab("installed");
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  // A row opens its page in place (MK-D2); the keyboard stays in the field.
  const openPage = useCallback(
    (id: string) => {
      setPage({ id, from: tab });
      if (takeFocus) inputRef.current?.focus({ preventScroll: true });
    },
    [tab, takeFocus],
  );
  // Words typed on a page go back to its tab's list, filtered; a tab pressed on
  // a page leaves it for that tab. Either starts the hot row at the first.
  const onQuery = useCallback(
    (next: string) => {
      setQuery(next);
      setHot(0);
      if (page !== null) {
        setTab(page.from);
        setPage(null);
      }
    },
    [page],
  );
  // leaving Discover takes the community tile's ask back, unanswered (MK-O3D)
  const onTab = useCallback(
    (next: PluginsTab) => {
      setTab(next);
      setPage(null);
      setHot(0);
      if (next !== "discover") dropAsk();
    },
    [dropAsk],
  );

  // The hot row, or Discover's hot tile (MK-4e), stays in sight as the keys walk it (as the Peek's does).
  useEffect(() => {
    if (!open || page !== null || tab === "updates") return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-hot="true"]');
    if (row !== null && row !== undefined && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [open, page, tab, hotAt]);

  // The field holds the keys (a row or a tile is no stop of Tab): on Installed ↑ ↓ walk the hot row; on
  // Discover's shelf ↑ ↓ walk the tiles a row at a time and ← → one at a time while the field holds no words
  // (MK-4e; once it holds any, they move the caret); ↵ opens the hot one's page. ↵ presses Show installed on
  // Discover's no-registry state. A page has no act yet, so ↵ there does nothing; a button keeps its own Return.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing || page !== null) return;
      const rows = tab === "installed" && installed !== null ? installed : [];
      const key = event.key;
      if (tab === "discover" && discover !== null && isShelfKey(key)) {
        // once the field holds words, ← → are the caret's
        if ((key === "ArrowLeft" || key === "ArrowRight") && query !== "") return;
        if (event.target !== inputRef.current || tiles.length === 0) return;
        event.preventDefault();
        const featured = discover.featured !== null;
        setHot((at) => walkShelf(at, key, tiles.length, columns, featured));
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        if (event.target !== inputRef.current || rows.length === 0) return;
        event.preventDefault();
        setHot((at) => walkHot(Math.min(at, rows.length - 1), key, rows.length));
        return;
      }
      if (key !== "Enter" || event.target instanceof HTMLButtonElement) return;
      if (tab === "discover" && shelf.kind === "unconfigured") {
        event.preventDefault();
        showInstalled();
        return;
      }
      const id = tab === "discover" ? tiles[hotAt]?.id : rows[hotAt]?.id;
      if (id !== undefined) {
        event.preventDefault();
        openPage(id);
      }
    },
    [
      tab,
      shelf.kind,
      showInstalled,
      page,
      installed,
      hotAt,
      openPage,
      discover,
      tiles,
      query,
      columns,
    ],
  );

  const target = container === undefined ? document.body : container;
  if (target === null) return null;
  return createPortal(
    <PluginsView
      open={open}
      layout={layout}
      tab={tab}
      query={query}
      shelf={shelf}
      foot={foot}
      installed={installed}
      installedFoot={snapshot === null ? null : installedFoot(snapshot)}
      hot={hotAt}
      discover={discover}
      columns={columns}
      page={shown}
      pageSettings={
        shown !== null && shown.settings !== null ? (
          <PluginSettings
            key={shown.id}
            id={shown.id}
            settings={shown.settings}
            port={port}
            away={away}
          />
        ) : null
      }
      discoverEnd={
        tile === null ? null : (
          <CommunityTileView
            tile={tile}
            control={{ ...communitySwitch, cancel: cancelAsk, confirm: confirmAsk }}
            takeFocus={takeFocus}
          />
        )
      }
      pageFrom={page?.from ?? tab}
      updates={updates}
      away={away}
      under={under}
      refused={refused}
      onTurn={onTurn}
      onTurnPower={onTurnPower}
      inputRef={inputRef}
      listRef={listRef}
      onQuery={onQuery}
      onTab={onTab}
      onClose={fold}
      onShowInstalled={showInstalled}
      onOpenPage={openPage}
      onBack={back}
      onKeyDown={onKeyDown}
    />,
    target,
  );
}

/** The Me row's count takes every answer the popup takes. */
const takeCount = (catalog: PluginsCatalog): void => takePluginUpdates(catalog.updates);

/** The popup as the frame holds it (ChromeLayer): over this window's fieldd
 * client and the registry snapshot FieldView feeds, holding Godview's keys
 * while it stands there (QL-D2). It opens on the tab its door asked for
 * (`openOn`: the palette's Check plugins for updates asks for Updates, MK-E7).
 * As the window opens it asks fieldd once for the list fieldd already holds,
 * so the Me menu's row says what the last read found (MK-4b's ‹draft› line in
 * DESIGN.md §8 "The Me menu"; VF-PM's C1): never the registry, on no timer,
 * once per window; an answer that fails or comes late leaves the row with no
 * count and the window says nothing of it. Updates carries that same count
 * (MK-4c, VF-PM's C1), and a page says the Mac's notes on a Mac (`onMac`:
 * ChromeLayer's `getHost().platform === "darwin"`, the read it makes for the
 * Settings shortcut; with no platform named, no Mac note). MK-4c2a: its
 * switches take no press while this window's fieldd client isn't ready
 * (`useFielddStatus()`). MK-O3D: the community switch as this window's app
 * preferences say it (`storage.appPreferences.subscribe`, read as Settings'
 * sections read it), sent through the one setter fieldd audits, and this
 * desktop's statement mark over fieldd's two doors for it (MK-O1 B). */
export function FramePlugins({
  view,
  surface,
  onSurfaceChange,
  openOn = "discover",
  onMac = false,
}: {
  view: FrameView;
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  openOn?: PluginsTab;
  onMac?: boolean;
}): ReactElement | null {
  const fieldd = useFielddClient();
  const port = useMemo(() => pluginsPortOver(fieldd), [fieldd]);
  const snapshot = usePluginRegistrySnapshot();
  const godview = useGodviewFindDoor();
  const updates = usePluginUpdates();
  const away = useFielddStatus() !== "ready";
  const preferences = useSubscription<unknown>("storage.appPreferences.subscribe", {});
  const community = preferences.status === "live" ? communityFrom(preferences.data) : null;
  const onCommunity = useMemo(() => communityDoor(fieldd), [fieldd]);
  const statement = useMemo(() => statementDoor(fieldd), [fieldd]);
  useEffect(() => {
    if (!claimWindowAsk()) return;
    port.catalog().then(
      (catalog) => primePluginUpdates(catalog.updates),
      () => undefined,
    );
  }, [port]);
  return (
    <Plugins
      surface={surface}
      onSurfaceChange={onSurfaceChange}
      port={port}
      snapshot={snapshot}
      initialTab={openOn}
      holdKeys={view === "godview" ? godview?.holdKeys : undefined}
      onCatalog={takeCount}
      updates={updates}
      onMac={onMac}
      away={away}
      community={community}
      onCommunity={onCommunity}
      statement={statement}
    />
  );
}
