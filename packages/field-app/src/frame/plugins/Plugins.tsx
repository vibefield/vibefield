import type { FrameView, PluginRegistrySnapshot, PluginsCatalog } from "@vibefield/contracts";
import { useFielddClient, useFielddStatus } from "@vibefield/fieldd-client/react";
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
import { PluginsView } from "./PluginsView";
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
// takes a press. Every other plugin's page reads only (item 321).
// Its doors (MK-4b) are the Me menu's Plugins… row and the palette's Plugins…
// and Check plugins for updates, each through ChromeLayer's `openPlugins`; the
// pegboard's pill is MK-4d's. The catalog mounts this controller over a
// fixture port (`design-system/PluginsPreview.tsx`).

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
  /** A plugin whose page each opening starts on, from Installed (a plate's; the product passes none). */
  initialPage?: string | null;
  /** fieldd isn't answering this window (MK-4c2a): no switch takes a press. A plate passes a fixture's. */
  away?: boolean;
  now?: () => number;
}

/** The page shown in the body: its plugin, and the tab it opened from. */
interface OpenPage {
  readonly id: string;
  readonly from: PluginsTab;
}

const pageAt = (id: string | null | undefined): OpenPage | null =>
  id === null || id === undefined ? null : { id, from: "installed" };

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
  now = Date.now,
}: PluginsProps): ReactElement | null {
  const open = surface === "plugins";
  const [tab, setTab] = useState<PluginsTab>(initialTab);
  const [query, setQuery] = useState("");
  const [read, setRead] = useState<PluginsRead>({ kind: "asking" });
  const [reading, setReading] = useState(false);
  const [box, setBox] = useState(() => boxOf(container));
  const [page, setPage] = useState<OpenPage | null>(() => pageAt(initialPage));
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
      setPage(pageAt(initialPage));
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

  // While open, Esc is the popup's before anything else hears it, and answers
  // the nearest first (§8 "Keys"): a page goes back to its tab, then the popup
  // folds. No question stands yet (MK-4c builds none).
  useEffect(() => {
    if (!open || !bindKeys) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (page !== null) back();
      else fold();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, bindKeys, fold, page, back]);

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
  const foot = catalogFoot(read, reading, now());
  const catalog = read.kind === "answered" ? read.catalog : null;
  // Q6: the field's words filter Installed's rows; Discover's and Updates'
  // search waits for the shelf, and the words are kept across the switch.
  const installed = useMemo(
    () => (snapshot === null ? null : installedRows(snapshot, catalog, query)),
    [snapshot, catalog, query],
  );
  // the hot row, held to the rows there are
  const hotAt = installed === null ? 0 : Math.max(0, Math.min(hot, installed.length - 1));
  // a page reads the record the window holds; a plugin gone from it closes its page
  const shown = useMemo(() => {
    const record =
      page === null ? undefined : snapshot?.plugins.find((plugin) => plugin.id === page.id);
    return record === undefined || snapshot === null
      ? null
      : pluginPage(record, catalog, snapshot, onMac);
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
  const onTab = useCallback((next: PluginsTab) => {
    setTab(next);
    setPage(null);
    setHot(0);
  }, []);

  // The hot row stays in sight as the keys walk it (as the Peek's does).
  useEffect(() => {
    if (!open || page !== null || tab !== "installed") return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-hot="true"]');
    if (row !== null && row !== undefined && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [open, page, tab, hotAt]);

  // The field holds the keys (a row is no stop of Tab): on Installed ↑ ↓ walk
  // the hot row and ↵ opens its page; ↵ presses Show installed on Discover's
  // no-registry state. A page has no act yet, so ↵ there does nothing; a button
  // keeps its own Return.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing || page !== null) return;
      const rows = tab === "installed" && installed !== null ? installed : [];
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (event.target !== inputRef.current || rows.length === 0) return;
        event.preventDefault();
        const key = event.key;
        setHot((at) => walkHot(Math.min(at, rows.length - 1), key, rows.length));
        return;
      }
      if (event.key !== "Enter" || event.target instanceof HTMLButtonElement) return;
      if (tab === "discover" && shelf.kind === "unconfigured") {
        event.preventDefault();
        showInstalled();
        return;
      }
      const row = rows[hotAt];
      if (row !== undefined) {
        event.preventDefault();
        openPage(row.id);
      }
    },
    [tab, shelf.kind, showInstalled, page, installed, hotAt, openPage],
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
      page={shown}
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
 * (`useFielddStatus()`). */
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
    />
  );
}
